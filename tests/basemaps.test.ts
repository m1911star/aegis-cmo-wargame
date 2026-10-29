import { afterEach, describe, expect, test } from 'bun:test';
import type { LayerSpecification, SourceSpecification, StyleSpecification } from 'maplibre-gl';
import { BasemapLoader, BASEMAP_PRESETS, DEFAULT_BASEMAP, prepareOnlineStyle, basemapFallbackImage, type BasemapState } from '../src/map/basemaps';
import { createOfflineBasemap } from '../src/map/offlineBasemap';
import { installTacticalLayers, type TacticalLayerHost } from '../src/map/tacticalLayers';
import { useWargameStore as store } from '../src/store/useWargameStore';
import { canonicalBattleState } from '../src/store/battleRecording';

const style = (name = 'test'): StyleSpecification => ({
  version: 8, name, center: [10, 40], zoom: 4, bearing: 90, pitch: 45,
  glyphs: 'https://example.test/fonts/{fontstack}/{range}.pbf',
  sources: { earth: { type: 'vector', url: 'https://example.test/tiles.json', attribution: 'Map data attribution' } },
  layers: [{ id: 'water', type: 'background', paint: { 'background-color': '#345678' } }],
});

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
function harness(fetcher: typeof fetch, timeout = 1000) {
  const applied: StyleSpecification[] = [];
  const states: BasemapState[] = [];
  const loader = new BasemapLoader({ fetcher, applyStyle: (value) => applied.push(value), onState: (value) => states.push(value),
    requestTimeoutMs: timeout, tileTimeoutMs: timeout });
  cleanups.push(() => loader.dispose());
  return { loader, applied, states };
}
const fakeFetch = (fn: (input: unknown, init?: RequestInit) => Promise<Response>) => fn as typeof fetch;

describe('Real geographic basemaps', () => {
  test('defaults to the no-key real geographic style, not a schematic or mislabeled satellite layer', () => {
    expect(DEFAULT_BASEMAP).toBe('geographic');
    expect(BASEMAP_PRESETS.geographic.styleUrl).toBe('https://tiles.openfreemap.org/styles/liberty');
    expect(BASEMAP_PRESETS.dark.styleUrl).toBe('https://tiles.openfreemap.org/styles/dark');
    expect(BASEMAP_PRESETS.offline.styleUrl).toBeUndefined();
    expect(BASEMAP_PRESETS.geographic.description).toContain('非卫星');
  });

  test('provider styles retain data, glyphs and attribution, but cannot recenter the scenario', () => {
    const input = style(); const before = structuredClone(input); const prepared = prepareOnlineStyle(input);
    expect(prepared.sources).toEqual(input.sources);
    expect(prepared.glyphs).toEqual(input.glyphs);
    expect(prepared.layers).toEqual(input.layers);
    for (const key of ['center', 'zoom', 'pitch', 'bearing']) expect(prepared).not.toHaveProperty(key);
    expect(prepared.sources).not.toHaveProperty('procedural-land');
    expect(input).toEqual(before);
  });

  test.each([null, {}, { version: 7 }, { version: 8, sources: {}, layers: [] },
    { version: 8, sources: {}, layers: [null] }])('invalid styles are rejected: %j', (input) => {
    expect(() => prepareOnlineStyle(input)).toThrow();
  });

  test('explicit offline fallback needs no tile, glyph or sprite network requests', () => {
    const offline = createOfflineBasemap();
    expect(offline.glyphs).toBeUndefined(); expect(offline.sprite).toBeUndefined();
    expect(Object.values(offline.sources).every((source) => source.type === 'geojson' && typeof source.data === 'object')).toBe(true);
    expect(offline.layers.some((layer) => layer.id === 'procedural-land-fill')).toBe(true);
  });

  test('missing place dots get a neutral geographic marker, never a military symbol', () => {
    const dot = basemapFallbackImage('circle-11')!;
    expect(dot.width).toBe(11); expect(dot.height).toBe(11);
    expect(dot.data[(5 * 11 + 5) * 4 + 3]).toBe(255);
    expect(dot.data[3]).toBe(0);
    expect(basemapFallbackImage('unknown-provider-icon')).toBeUndefined();
  });

  test('style switching is display-only and does not change commands or simulation state', () => {
    const before = canonicalBattleState(); const commands = store.getState().commandHistory;
    store.getState().setBasemapMode('dark');
    store.getState().setBasemapMode('offline');
    expect(canonicalBattleState()).toEqual(before);
    expect(store.getState().commandHistory).toBe(commands);
    store.getState().setBasemapMode(DEFAULT_BASEMAP);
  });
});

describe('Loading, failure and lifecycle', () => {
  test('fetches without credentials and only reports ready after map resources load', async () => {
    let credentials: RequestCredentials | undefined;
    const h = harness(fakeFetch(async (_, init) => { credentials = init?.credentials; return Response.json(style()); }));
    await h.loader.select('geographic');
    expect(credentials).toBe('omit'); expect(h.loader.state.status).toBe('loading');
    expect(h.loader.state.active).toBe('geographic');
    expect(h.applied[0].sources).toHaveProperty('earth');
    h.loader.markReady(); expect(h.loader.state.status).toBe('online');
  });

  test('HTTP failure explicitly reports a local schematic fallback; retry can recover', async () => {
    let calls = 0;
    const h = harness(fakeFetch(async () => ++calls === 1 ? new Response('', { status: 503 }) : Response.json(style())));
    await h.loader.select('geographic');
    expect(h.loader.state.status).toBe('error'); expect(h.loader.state.active).toBe('offline');
    expect(h.loader.state.message).toContain('离线示意');
    expect(h.applied[0].sources).toHaveProperty('procedural-land');
    await h.loader.select('geographic', true); h.loader.markReady();
    expect(h.loader.state.status).toBe('online'); expect(calls).toBe(2);
  });

  test('request timeouts cannot leave the app permanently waiting for a real map', async () => {
    const h = harness(fakeFetch(async (_, init) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })), 5);
    await h.loader.select('geographic');
    expect(h.loader.state.status).toBe('error'); expect(h.loader.state.active).toBe('offline');
  });

  test('a style whose tiles never become ready also falls back with a visible error', async () => {
    const h = harness(fakeFetch(async () => Response.json(style())), 5);
    await h.loader.select('geographic');
    await Bun.sleep(15);
    expect(h.loader.state.active).toBe('offline'); expect(h.loader.state.status).toBe('error');
  });

  test('late network results cannot overwrite a newer theme or offline selection', async () => {
    let resolve!: (response: Response) => void;
    const h = harness(fakeFetch(async () => new Promise<Response>((done) => { resolve = done; })));
    const pending = h.loader.select('geographic');
    await h.loader.select('offline');
    resolve(Response.json(style())); await pending;
    expect(h.loader.state.status).toBe('offline'); expect(h.applied.length).toBe(1);
    expect(h.applied[0].sources).toHaveProperty('procedural-land');
  });

  test('unmount aborts work without applying styles or publishing state afterward', async () => {
    let resolve!: (response: Response) => void;
    const h = harness(fakeFetch(async () => new Promise<Response>((done) => { resolve = done; })));
    const pending = h.loader.select('dark'); const changes = h.states.length;
    h.loader.dispose(); resolve(Response.json(style())); await pending;
    expect(h.states.length).toBe(changes); expect(h.applied).toEqual([]);
  });

  test('source failures remain visible even after partial load, while tactical errors are not mislabeled', async () => {
    const h = harness(fakeFetch(async () => Response.json(style())));
    await h.loader.select('dark');
    h.loader.reportResourceError('units-source'); expect(h.loader.state.status).toBe('loading');
    h.loader.reportResourceError('earth'); h.loader.markReady();
    expect(h.loader.state.status).toBe('degraded'); expect(h.loader.state.active).toBe('dark');
  });
});

test('all tactical overlays reinstall after a style change, without duplicate registration', () => {
  const sources = new Map<string, SourceSpecification>();
  const layers = new Map<string, LayerSpecification>();
  const host = {
    getSource: (id: string) => sources.get(id), getLayer: (id: string) => layers.get(id),
    addSource: (id: string, value: SourceSpecification) => { if (sources.has(id)) throw new Error('Duplicate source'); sources.set(id, value); },
    addLayer: (value: LayerSpecification) => { if (layers.has(value.id)) throw new Error('Duplicate layer'); layers.set(value.id, value); },
  } as unknown as TacticalLayerHost;
  installTacticalLayers(host);
  const sourceIds = [...sources.keys()]; const layerIds = [...layers.keys()];
  installTacticalLayers(host);
  expect([...sources.keys()]).toEqual(sourceIds); expect([...layers.keys()]).toEqual(layerIds);
  sources.clear(); layers.clear(); // MapLibre setStyle(..., {diff:false}) semantics.
  installTacticalLayers(host);
  expect([...sources.keys()]).toEqual(sourceIds); expect([...layers.keys()]).toEqual(layerIds);
  expect(layerIds.at(-1)).toBe('units-symbol-layer');
  for (const layer of layers.values()) if (layer.type === 'symbol') {
    expect(layer.layout?.['text-font']).toEqual(['Noto Sans Regular']);
  }
});
