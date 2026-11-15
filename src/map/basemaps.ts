import type { StyleSpecification } from 'maplibre-gl';
import { createOfflineBasemap } from './offlineBasemap';

export type BasemapMode = 'geographic' | 'dark' | 'offline';
export const DEFAULT_BASEMAP: BasemapMode = 'geographic';

export const BASEMAP_PRESETS: Record<BasemapMode, { label: string; description: string; styleUrl?: string }> = {
  geographic: { label: '真实地理图', description: 'OpenStreetMap 地理数据与地表底色，非卫星照片',
    styleUrl: 'https://tiles.openfreemap.org/styles/liberty' },
  dark: { label: '深色地理图', description: '同样的真实地理数据，深色指挥台配色',
    styleUrl: 'https://tiles.openfreemap.org/styles/dark' },
  offline: { label: '离线示意图', description: '本地简化海岸线，仅用于离线演示，不是真实地图' },
};

export interface BasemapState {
  requested: BasemapMode;
  active: BasemapMode;
  status: 'loading' | 'online' | 'offline' | 'degraded' | 'error';
  message?: string;
}

export function initialBasemapState(mode: BasemapMode): BasemapState {
  return { requested: mode, active: 'offline', status: mode === 'offline' ? 'offline' : 'loading' };
}

export function prepareOnlineStyle(value: unknown): StyleSpecification {
  if (!value || typeof value !== 'object') throw new Error('Invalid map style');
  const style = value as StyleSpecification;
  if (style.version !== 8 || !style.sources || typeof style.sources !== 'object' ||
      Array.isArray(style.sources) || !Array.isArray(style.layers) || !style.layers.length) {
    throw new Error('Unsupported map style');
  }
  if (!style.layers.every((layer) => layer && typeof layer.id === 'string' && typeof layer.type === 'string')) {
    throw new Error('Invalid map layers');
  }
  // Provider defaults must not move the scenario camera when replacing the style.
  const result = structuredClone(style);
  delete result.center;
  delete result.zoom;
  delete result.bearing;
  delete result.pitch;
  return result;
}

// Some public dark styles reference this simple place marker without bundling it in the sprite.
export function basemapFallbackImage(id: string) {
  if (id !== 'circle-11') return undefined;
  const size = 11;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const offset = (y * size + x) * 4;
    data[offset] = data[offset + 1] = data[offset + 2] = 180;
    data[offset + 3] = Math.round(Math.max(0, Math.min(1, 4.5 - Math.hypot(x - 5, y - 5))) * 255);
  }
  return { width: size, height: size, data };
}

interface BasemapLoaderOptions {
  applyStyle: (style: StyleSpecification) => void;
  onState: (state: BasemapState) => void;
  fetcher?: typeof fetch;
  requestTimeoutMs?: number;
  tileTimeoutMs?: number;
  initialOfflineApplied?: boolean;
}

/** Loads display-only styles. It never advances or replaces simulation state. */
export class BasemapLoader {
  private current = initialBasemapState('offline');
  private appliedOffline: boolean;
  private request = 0;
  private controller?: AbortController;
  private requestTimer?: ReturnType<typeof setTimeout>;
  private tileTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private cache = new Map<BasemapMode, StyleSpecification>();
  baseSourceIds: string[] = [];

  constructor(private options: BasemapLoaderOptions) {
    this.appliedOffline = options.initialOfflineApplied === true;
  }

  get state(): BasemapState { return this.current; }

  private update(state: BasemapState) {
    if (this.disposed) return;
    this.current = state;
    this.options.onState(state);
  }

  private stopPending() {
    this.controller?.abort();
    clearTimeout(this.requestTimer);
    clearTimeout(this.tileTimer);
  }

  private fallback(mode: BasemapMode) {
    if (this.disposed) return;
    this.stopPending();
    this.baseSourceIds = [];
    this.update({ requested: mode, active: 'offline', status: 'error',
      message: '真实地图加载失败，当前为离线示意图。请检查网络后重试；推演仍可继续。' });
    if (!this.appliedOffline) {
      this.appliedOffline = true;
      this.options.applyStyle(createOfflineBasemap());
    }
  }

  async select(mode: BasemapMode, retry = false): Promise<void> {
    if (this.disposed) return;
    this.stopPending();
    const request = ++this.request;
    if (mode === 'offline') {
      this.baseSourceIds = [];
      this.update(initialBasemapState(mode));
      if (!this.appliedOffline || retry) {
        this.appliedOffline = true;
        this.options.applyStyle(createOfflineBasemap());
      }
      return;
    }
    this.update({ requested: mode, active: this.current.active, status: 'loading' });
    const controller = new AbortController();
    this.controller = controller;
    this.requestTimer = setTimeout(() => controller.abort(), this.options.requestTimeoutMs ?? 12000);
    try {
      let style = retry ? undefined : this.cache.get(mode);
      if (!style) {
        const response = await (this.options.fetcher ?? fetch)(BASEMAP_PRESETS[mode].styleUrl!, {
          signal: controller.signal, credentials: 'omit',
        });
        if (!response.ok) throw new Error(`Map service returned ${response.status}`);
        style = prepareOnlineStyle(await response.json());
      }
      if (this.disposed || request !== this.request) return;
      if (controller.signal.aborted) { this.fallback(mode); return; }
      clearTimeout(this.requestTimer);
      this.cache.set(mode, style);
      this.baseSourceIds = Object.keys(style.sources);
      this.update({ requested: mode, active: mode, status: 'loading' });
      this.appliedOffline = false;
      this.options.applyStyle(structuredClone(style));
      this.tileTimer = setTimeout(() => {
        if (request === this.request) this.fallback(mode);
      }, this.options.tileTimeoutMs ?? 20000);
    } catch {
      if (!this.disposed && request === this.request) this.fallback(mode);
    }
  }

  markReady() {
    if (this.current.active === 'offline' || this.disposed) return;
    clearTimeout(this.tileTimer);
    if (this.current.status === 'loading') this.update({ ...this.current, status: 'online' });
  }

  reportResourceError(sourceId?: string) {
    if (this.disposed || this.current.active === 'offline' || !sourceId || !this.baseSourceIds.includes(sourceId)) return;
    this.update({ ...this.current, status: 'degraded',
      message: '部分真实地图数据未能加载。可重试或切换离线示意图。' });
  }

  dispose() {
    this.disposed = true;
    this.request += 1;
    this.stopPending();
  }
}
