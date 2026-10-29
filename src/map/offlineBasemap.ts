import type { StyleSpecification } from 'maplibre-gl';
import { buildProceduralTheaterGeoJSON } from './proceduralTheaterGeo';

export function createOfflineBasemap(): StyleSpecification {
  const proceduralGeo = buildProceduralTheaterGeoJSON();
  return {
    version: 8,
    sources: {
      'procedural-land': {
        type: 'geojson',
        data: proceduralGeo.landPolygons,
      },
      'procedural-grid': {
        type: 'geojson',
        data: proceduralGeo.gridLines,
      },
      'procedural-zones': {
        type: 'geojson',
        data: proceduralGeo.tacticalZones,
      },
    },
    layers: [
      {
        id: 'background-ocean',
        type: 'background',
        paint: {
          'background-color': '#040914',
        },
      },
      {
        id: 'procedural-land-fill',
        type: 'fill',
        source: 'procedural-land',
        paint: {
          'fill-color': '#0c192c',
          'fill-opacity': 0.55,
        },
      },
      {
        id: 'procedural-land-outline',
        type: 'line',
        source: 'procedural-land',
        paint: {
          'line-color': '#1e4268',
          'line-width': 1.4,
          'line-opacity': 0.85,
        },
      },
      {
        id: 'procedural-grid-lines',
        type: 'line',
        source: 'procedural-grid',
        paint: {
          'line-color': [
            'case',
            ['boolean', ['get', 'isMajor'], false],
            'rgba(34, 211, 238, 0.16)',
            'rgba(34, 211, 238, 0.06)',
          ],
          'line-width': [
            'case',
            ['boolean', ['get', 'isMajor'], false],
            1.0,
            0.5,
          ],
        },
      },
      {
        id: 'procedural-island-chain-line',
        type: 'line',
        source: 'procedural-zones',
        paint: {
          'line-color': 'rgba(245, 158, 11, 0.28)',
          'line-width': 1.5,
          'line-dasharray': [6, 4],
        },
      },
    ],
  };
}
