// ============================================================================
// AEGIS-CMO // 离线/程序化西太平洋战略海陆矢量底图与经纬网格生成器
// 作用：即使在完全断网或瓦片受限环境，也能呈现高清硬核 AEGIS 军用战术海陆轮廓与第1岛链态势
// ============================================================================

export function buildProceduralTheaterGeoJSON(): {
  landPolygons: GeoJSON.FeatureCollection;
  gridLines: GeoJSON.FeatureCollection;
  tacticalZones: GeoJSON.FeatureCollection;
} {
  // 精细化西太平洋核心战区陆地与岛链轮廓 (中国东南沿海、台湾岛、琉球/宫古/石垣岛链、吕宋北部、九州南部)
  const landFeatures: GeoJSON.Feature[] = [
    {
      type: 'Feature',
      properties: { name: '中国大陆东南沿海战区', type: 'mainland' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [115.0, 32.5],
            [121.9, 31.5],
            [122.2, 30.0],
            [121.7, 28.4],
            [120.7, 27.2],
            [119.9, 26.0],
            [119.0, 24.9],
            [117.7, 23.6],
            [116.5, 22.8],
            [114.2, 22.2],
            [112.0, 21.6],
            [112.0, 32.5],
            [115.0, 32.5],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: '台湾岛', type: 'island' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [120.08, 25.15],
            [121.55, 25.3],
            [121.98, 25.0],
            [121.62, 23.95],
            [121.35, 23.1],
            [120.85, 21.92],
            [120.22, 22.65],
            [120.05, 23.55],
            [120.38, 24.45],
            [120.08, 25.15],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: '钓鱼岛及其附属岛屿', type: 'island' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [123.42, 25.78],
            [123.56, 25.78],
            [123.56, 25.71],
            [123.42, 25.71],
            [123.42, 25.78],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: '先岛群岛 · 石垣/西表岛', type: 'island' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [123.72, 24.48],
            [124.35, 24.55],
            [124.38, 24.28],
            [123.72, 24.25],
            [123.72, 24.48],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: '宫古岛', type: 'island' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [125.15, 24.88],
            [125.48, 24.85],
            [125.45, 24.68],
            [125.15, 24.71],
            [125.15, 24.88],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: '冲绳本岛', type: 'island' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [127.62, 26.1],
            [128.32, 26.88],
            [128.25, 26.95],
            [127.55, 26.18],
            [127.62, 26.1],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: '九州南部与大隅群岛', type: 'island' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [129.8, 31.2],
            [131.5, 31.5],
            [131.4, 30.2],
            [130.1, 30.3],
            [129.8, 31.2],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: '吕宋岛北部 (巴士海峡南岸)', type: 'island' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [120.4, 18.6],
            [122.3, 18.5],
            [122.5, 16.5],
            [120.1, 16.5],
            [120.4, 18.6],
          ],
        ],
      },
    },
  ];

  // 生成战术经纬网格线 (1度细网格 + 5度主网格)
  const gridFeatures: GeoJSON.Feature[] = [];
  for (let lon = 114; lon <= 134; lon += 1) {
    gridFeatures.push({
      type: 'Feature',
      properties: {
        isMajor: lon % 5 === 0,
        label: `${lon}°E`,
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [lon, 16],
          [lon, 33],
        ],
      },
    });
  }
  for (let lat = 16; lat <= 33; lat += 1) {
    gridFeatures.push({
      type: 'Feature',
      properties: {
        isMajor: lat % 5 === 0,
        label: `${lat}°N`,
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [114, lat],
          [134, lat],
        ],
      },
    });
  }

  // 第一岛链与关键海峡战术态势辅助标注线
  const tacticalZones: GeoJSON.Feature[] = [
    {
      type: 'Feature',
      properties: { name: '第一岛链战略封锁线 (FIRST ISLAND CHAIN)' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [129.5, 29.5],
          [127.8, 26.4],
          [125.3, 24.8],
          [124.0, 24.3],
          [121.8, 24.5],
          [121.0, 21.8],
          [121.5, 18.8],
        ],
      },
    },
  ];

  return {
    landPolygons: { type: 'FeatureCollection', features: landFeatures },
    gridLines: { type: 'FeatureCollection', features: gridFeatures },
    tacticalZones: { type: 'FeatureCollection', features: tacticalZones },
  };
}
