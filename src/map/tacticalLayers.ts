import type { Map, LayerSpecification, SourceSpecification } from 'maplibre-gl';

export type TacticalLayerHost = Pick<Map, 'getSource' | 'addSource' | 'getLayer' | 'addLayer'>;

// A style swap clears custom layers. Reinstall them without touching the simulation world.
export function installTacticalLayers(map: TacticalLayerHost) {
  const addSource = (id: string, source: SourceSpecification) => {
    if (!map.getSource(id)) map.addSource(id, source);
  };
  const addLayer = (layer: LayerSpecification) => {
    if (!map.getLayer(layer.id)) map.addLayer(layer);
  };
  // 注册所有战术数据源
  const emptyFC: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [],
  };
  addSource('terrain-source', { type: 'geojson', data: emptyFC });
  addSource('land-zones-source', { type: 'geojson', data: emptyFC });
  addSource('acoustic-zones-source', { type: 'geojson', data: emptyFC });
  addSource('weather-zones-source', { type: 'geojson', data: emptyFC });
  addSource('control-zones-source', { type: 'geojson', data: emptyFC });
  addSource('missions-source', { type: 'geojson', data: emptyFC });
  addSource('envelopes-source', { type: 'geojson', data: emptyFC });
  addSource('aou-source', { type: 'geojson', data: emptyFC });
  addSource('waypoints-line-source', { type: 'geojson', data: emptyFC });
  addSource('waypoints-node-source', { type: 'geojson', data: emptyFC });
  addSource('missiles-trail-source', { type: 'geojson', data: emptyFC });
  addSource('missiles-point-source', { type: 'geojson', data: emptyFC });
  addSource('rp-source', { type: 'geojson', data: emptyFC });
  addSource('explosions-source', { type: 'geojson', data: emptyFC });
  addSource('fire-control-source', { type: 'geojson', data: emptyFC });
  addSource('units-source', { type: 'geojson', data: emptyFC });
  addSource('ruler-source', { type: 'geojson', data: emptyFC });
  addSource('draw-polygon-source', { type: 'geojson', data: emptyFC });

  addLayer({
    id: 'land-zones-fill-layer',
    type: 'fill',
    source: 'land-zones-source',
    paint: {
      'fill-color': 'rgba(120, 113, 108, 0.16)',
    },
  });
  addLayer({
    id: 'land-zones-line-layer',
    type: 'line',
    source: 'land-zones-source',
    paint: {
      'line-color': 'rgba(168, 162, 158, 0.55)',
      'line-width': 1.2,
    },
  });
  addLayer({
    id: 'acoustic-zones-fill-layer',
    type: 'fill',
    source: 'acoustic-zones-source',
    paint: {
      'fill-color': [
        'match',
        ['get', 'kind'],
        'shallow',
        'rgba(20, 184, 166, 0.09)',
        'rgba(99, 102, 241, 0.10)',
      ],
    },
  });
  addLayer({
    id: 'acoustic-zones-line-layer',
    type: 'line',
    source: 'acoustic-zones-source',
    paint: {
      'line-color': [
        'match',
        ['get', 'kind'],
        'shallow',
        'rgba(45, 212, 191, 0.55)',
        'rgba(129, 140, 248, 0.6)',
      ],
      'line-width': 1.2,
      'line-dasharray': [3, 3],
    },
  });
  addLayer({
    id: 'draw-polygon-fill-layer',
    type: 'fill',
    source: 'draw-polygon-source',
    filter: ['==', '$type', 'Polygon'],
    paint: {
      'fill-color': 'rgba(52, 211, 153, 0.18)',
    },
  });
  addLayer({
    id: 'draw-polygon-line-layer',
    type: 'line',
    source: 'draw-polygon-source',
    filter: ['in', '$type', 'LineString', 'Polygon'],
    paint: {
      'line-color': '#34d399',
      'line-width': 2.2,
      'line-dasharray': [3, 2],
    },
  });
  addLayer({
    id: 'draw-polygon-vertex-layer',
    type: 'circle',
    source: 'draw-polygon-source',
    filter: ['==', '$type', 'Point'],
    paint: {
      'circle-radius': 4.5,
      'circle-color': '#34d399',
      'circle-stroke-color': '#020617',
      'circle-stroke-width': 1.5,
    },
  });

  // 0. 地形高程遮蔽区与区域夺控区图层
  addLayer({
    id: 'terrain-fill-layer',
    type: 'fill',
    source: 'terrain-source',
    paint: {
      'fill-color': 'rgba(180, 83, 9, 0.14)',
    },
  });
  addLayer({
    id: 'terrain-line-layer',
    type: 'line',
    source: 'terrain-source',
    paint: {
      'line-color': 'rgba(217, 119, 6, 0.45)',
      'line-width': 1.2,
      'line-dasharray': [2, 2],
    },
  });
  addLayer({
    id: 'terrain-extrusion-layer',
    type: 'fill-extrusion',
    source: 'terrain-source',
    layout: {
      visibility: 'none',
    },
    paint: {
      'fill-extrusion-color': '#b45309',
      'fill-extrusion-height': ['*', ['coalesce', ['get', 'elevationM'], 0], 4],
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': 0.38,
    },
  });
  addLayer({
    id: 'weather-zones-fill-layer',
    type: 'fill',
    source: 'weather-zones-source',
    paint: {
      'fill-color': 'rgba(56, 189, 248, 0.08)',
    },
  });
  addLayer({
    id: 'weather-zones-line-layer',
    type: 'line',
    source: 'weather-zones-source',
    paint: {
      'line-color': 'rgba(125, 211, 252, 0.45)',
      'line-width': 1.3,
      'line-dasharray': [4, 4],
    },
  });
  addLayer({
    id: 'weather-zones-label-layer',
    type: 'symbol',
    source: 'weather-zones-source',
    layout: {
      'text-font': ['Noto Sans Regular'],
      'text-field': ['get', 'label'],
      'text-size': 10,
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': '#bae6fd',
      'text-halo-color': '#020617',
      'text-halo-width': 1.8,
    },
  });
  addLayer({
    id: 'control-zones-fill-layer',
    type: 'fill',
    source: 'control-zones-source',
    paint: {
      'fill-color': 'rgba(16, 185, 129, 0.10)',
    },
  });
  addLayer({
    id: 'control-zones-line-layer',
    type: 'line',
    source: 'control-zones-source',
    paint: {
      'line-color': 'rgba(16, 185, 129, 0.8)',
      'line-width': 2.0,
      'line-dasharray': [5, 3],
    },
  });
  addLayer({
    id: 'control-zones-label-layer',
    type: 'symbol',
    source: 'control-zones-source',
    layout: {
      'text-font': ['Noto Sans Regular'],
      'text-field': ['get', 'label'],
      'text-size': 11,
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': '#6ee7b7',
      'text-halo-color': '#020617',
      'text-halo-width': 1.8,
    },
  });

  // 1. 巡逻区多边形图层
  addLayer({
    id: 'missions-fill-layer',
    type: 'fill',
    source: 'missions-source',
    paint: {
      'fill-color': [
        'match',
        ['get', 'side'],
        'RED',
        'rgba(244, 63, 94, 0.08)',
        'rgba(56, 189, 248, 0.08)',
      ],
    },
  });
  addLayer({
    id: 'missions-line-layer',
    type: 'line',
    source: 'missions-source',
    paint: {
      'line-color': [
        'match',
        ['get', 'side'],
        'RED',
        'rgba(244, 63, 94, 0.5)',
        'rgba(56, 189, 248, 0.5)',
      ],
      'line-width': 1.5,
      'line-dasharray': [4, 3],
    },
  });

  // 2. 传感器与武器射程包线图层
  addLayer({
    id: 'envelopes-fill-layer',
    type: 'fill',
    source: 'envelopes-source',
    paint: {
      'fill-color': [
        'match',
        ['get', 'ringKind'],
        'radar',
        'rgba(34, 211, 238, 0.035)',
        'weapon',
        'rgba(244, 63, 94, 0.04)',
        'nez',
        'rgba(251, 113, 133, 0.085)',
        'sonar',
        'rgba(16, 185, 129, 0.05)',
        'horizon',
        'rgba(245, 158, 11, 0.06)',
        'threat',
        'rgba(251, 146, 60, 0.055)',
        'rgba(34, 211, 238, 0.02)',
      ],
    },
  });
  addLayer({
    id: 'envelopes-line-layer',
    type: 'line',
    source: 'envelopes-source',
    paint: {
      'line-color': [
        'match',
        ['get', 'ringKind'],
        'radar',
        'rgba(34, 211, 238, 0.45)',
        'weapon',
        'rgba(244, 63, 94, 0.58)',
        'nez',
        'rgba(251, 113, 133, 0.92)',
        'sonar',
        'rgba(16, 185, 129, 0.55)',
        'horizon',
        'rgba(245, 158, 11, 0.75)',
        'threat',
        'rgba(251, 146, 60, 0.85)',
        '#22d3ee',
      ],
      'line-width': [
        'case',
        ['boolean', ['get', 'isSelected'], false],
        1.6,
        0.9,
      ],
      'line-dasharray': [
        'match',
        ['get', 'ringKind'],
        'weapon',
        ['literal', [6, 3]],
        'nez',
        ['literal', [3, 1.5]],
        'horizon',
        ['literal', [2, 2]],
        'threat',
        ['literal', [5, 3]],
        ['literal', [1, 0]],
      ],
    },
  });

  // 3. AOU 不确定性多边形图层
  addLayer({
    id: 'aou-fill-layer',
    type: 'fill',
    source: 'aou-source',
    paint: {
      'fill-color': 'rgba(245, 158, 11, 0.14)',
    },
  });
  addLayer({
    id: 'aou-line-layer',
    type: 'line',
    source: 'aou-source',
    paint: {
      'line-color': 'rgba(245, 158, 11, 0.78)',
      'line-width': 1.4,
      'line-dasharray': [3, 2],
    },
  });

  // 4. 机动航路点与航向矢量线图层
  addLayer({
    id: 'waypoints-line-layer',
    type: 'line',
    source: 'waypoints-line-source',
    paint: {
      'line-color': [
        'case',
        ['boolean', ['get', 'isVector'], false],
        'rgba(226, 232, 240, 0.55)',
        ['boolean', ['get', 'isSelected'], false],
        '#22d3ee',
        'rgba(34, 211, 238, 0.45)',
      ],
      'line-width': [
        'case',
        ['boolean', ['get', 'isVector'], false],
        1.2,
        ['boolean', ['get', 'isSelected'], false],
        2.2,
        1.3,
      ],
      'line-dasharray': [
        'case',
        ['boolean', ['get', 'isVector'], false],
        ['literal', [1, 0]],
        ['literal', [4, 3]],
      ],
    },
  });
  addLayer({
    id: 'waypoints-node-layer',
    type: 'circle',
    source: 'waypoints-node-source',
    paint: {
      'circle-radius': 4,
      'circle-color': '#050811',
      'circle-stroke-color': '#22d3ee',
      'circle-stroke-width': 2,
    },
  });

  // 5. 导弹尾迹与导弹本体图层
  addLayer({
    id: 'missiles-trail-layer',
    type: 'line',
    source: 'missiles-trail-source',
    paint: {
      'line-color': [
        'case',
        ['boolean', ['get', 'isInterceptor'], false],
        '#22d3ee',
        ['==', ['get', 'side'], 'RED'],
        '#fb7185',
        '#38bdf8',
      ],
      'line-width': 2.2,
      'line-opacity': 0.85,
    },
  });
  addLayer({
    id: 'missiles-point-layer',
    type: 'symbol',
    source: 'missiles-point-source',
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-rotate': ['get', 'heading'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'text-font': ['Noto Sans Regular'],
      'text-field': ['concat', ['get', 'name'], ' M', ['get', 'speedMach']],
      'text-size': 9,
      'text-offset': [0, 1.3],
      'text-anchor': 'top',
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': '#fde047',
      'text-halo-color': '#020617',
      'text-halo-width': 1.5,
    },
  });

  // 6. 参考点图层
  addLayer({
    id: 'rp-symbol-layer',
    type: 'symbol',
    source: 'rp-source',
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-allow-overlap': true,
      'text-font': ['Noto Sans Regular'],
      'text-field': ['get', 'name'],
      'text-size': 10,
      'text-offset': [0, 1.1],
      'text-anchor': 'top',
    },
    paint: {
      'text-color': '#f59e0b',
      'text-halo-color': '#020617',
      'text-halo-width': 1.5,
    },
  });

  // 7. 交战爆炸波纹圆环图层
  addLayer({
    id: 'explosions-circle-layer',
    type: 'circle',
    source: 'explosions-source',
    paint: {
      'circle-radius': [
        'match',
        ['get', 'type'],
        'destroy',
        26,
        'hit',
        18,
        'intercept',
        14,
        10,
      ],
      'circle-color': [
        'match',
        ['get', 'type'],
        'destroy',
        'rgba(244, 63, 94, 0.45)',
        'hit',
        'rgba(245, 158, 11, 0.4)',
        'intercept',
        'rgba(34, 211, 238, 0.35)',
        'rgba(148, 163, 184, 0.25)',
      ],
      'circle-stroke-color': [
        'match',
        ['get', 'type'],
        'destroy',
        '#f43f5e',
        'hit',
        '#f59e0b',
        'intercept',
        '#22d3ee',
        '#94a3b8',
      ],
      'circle-stroke-width': 2,
    },
  });
  addLayer({
    id: 'explosions-label-layer',
    type: 'symbol',
    source: 'explosions-source',
    layout: {
      'text-font': ['Noto Sans Regular'],
      'text-field': ['get', 'label'],
      'text-size': 11,
      'text-offset': [0, -1.5],
      'text-allow-overlap': true,
    },
    paint: {
      'text-color': '#fef08a',
      'text-halo-color': '#020617',
      'text-halo-width': 2,
    },
  });

  addLayer({
    id: 'ruler-line-layer',
    type: 'line',
    source: 'ruler-source',
    paint: {
      'line-color': '#facc15',
      'line-width': 2.2,
      'line-dasharray': [3, 2],
    },
  });
  addLayer({
    id: 'ruler-point-layer',
    type: 'circle',
    source: 'ruler-source',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': 4,
      'circle-color': '#facc15',
      'circle-stroke-color': '#020617',
      'circle-stroke-width': 1.5,
    },
  });

  addLayer({
    id: 'fire-control-line-layer',
    type: 'line',
    source: 'fire-control-source',
    filter: ['==', ['geometry-type'], 'LineString'],
    paint: {
      'line-color': [
        'match',
        ['get', 'linkKind'],
        'datalink',
        '#38bdf8',
        'aim_executable',
        '#34d399',
        'aim_risky',
        '#fbbf24',
        '#f87171',
      ],
      'line-width': [
        'match',
        ['get', 'linkKind'],
        'datalink',
        1.5,
        2.2,
      ],
      'line-dasharray': [
        'match',
        ['get', 'linkKind'],
        'datalink',
        ['literal', [2, 2]],
        ['literal', [5, 2]],
      ],
    },
  });
  addLayer({
    id: 'fire-control-label-layer',
    type: 'symbol',
    source: 'fire-control-source',
    filter: ['==', ['geometry-type'], 'Point'],
    layout: {
      'text-font': ['Noto Sans Regular'],
      'text-field': ['get', 'label'],
      'text-size': 10,
      'text-offset': [0, -0.8],
      'text-allow-overlap': true,
    },
    paint: {
      'text-color': '#fef08a',
      'text-halo-color': '#020617',
      'text-halo-width': 2,
    },
  });

  // 8. 顶层北约军标算子与情报接触图层 (Units & Contacts)
  addLayer({
    id: 'units-symbol-layer',
    type: 'symbol',
    source: 'units-source',
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'text-font': ['Noto Sans Regular'],
      'text-field': ['get', 'subLabel'],
      'text-size': 11,
      'text-offset': [0, 1.85],
      'text-anchor': 'top',
      'text-allow-overlap': false,
      'text-padding': 4,
      'text-optional': true,
    },
    paint: {
      'text-color': [
        'case',
        ['==', ['get', 'entityType'], 'contact'],
        '#fcd34d',
        ['==', ['get', 'side'], 'RED'],
        '#fda4af',
        '#7dd3fc',
      ],
      'text-halo-color': '#020617',
      'text-halo-width': 1.8,
    },
  });

}
