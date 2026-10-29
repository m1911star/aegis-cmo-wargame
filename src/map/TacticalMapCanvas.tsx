import { observeMissile } from '../engine/sensors';
import { getUnitCapabilities, isActiveUnit } from '../engine/unitCapabilities';
import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import ms from 'milsymbol';
import * as turf from '@turf/turf';
import { useWargameStore } from '../store/useWargameStore';
import { buildProceduralTheaterGeoJSON } from './proceduralTheaterGeo';
import { calculateRadarHorizonKm } from '../engine/simulationEngine';
import { resolveUnitConfiguration } from '../db/unitConfiguration';

// ============================================================================
// AEGIS-CMO // MapLibre GL + milsymbol 高性能 WebGL 战术态势沙盘组件
// 架构亮点：通过 Zustand subscribe 直推 GeoJSON Source，60FPS 零 React VDOM 重绘抖动
// ============================================================================

export const TacticalMapCanvas: React.FC = () => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [cursorCoord, setCursorCoord] = useState<[number, number]>([124.2, 26.2]);

  const interactionMode = useWargameStore((s) => s.interactionMode);
  const selectedUnit = useWargameStore((s) =>
    s.selectedUnitId ? s.units[s.selectedUnitId] : null
  );
  const setInteractionMode = useWargameStore((s) => s.setInteractionMode);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const initialScenario = useWargameStore.getState().currentScenario;
    const proceduralGeo = buildProceduralTheaterGeoJSON();

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      center: initialScenario.initialCamera.center,
      zoom: initialScenario.initialCamera.zoom,
      minZoom: 3.5,
      maxZoom: 13,
      attributionControl: false,
      style: {
        version: 8,
        sources: {
          'carto-dark': {
            type: 'raster',
            tiles: [
              'https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png',
              'https://b.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png',
            ],
            tileSize: 256,
          },
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
            id: 'carto-dark-layer',
            type: 'raster',
            source: 'carto-dark',
            layout: { visibility: useWargameStore.getState().mapLayers.showSatelliteDarkTiles ? 'visible' : 'none' },
            paint: {
              'raster-opacity': 0.55,
              'raster-contrast': 0.25,
              'raster-brightness-max': 0.65,
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
      },
    });

    mapRef.current = map;

    // ------------------------------------------------------------------------
    // 动态注册北约 MIL-STD-2525C / APP-6 军标雪碧图与专用战术图标
    // ------------------------------------------------------------------------
    const registerSpriteIcon = (iconId: string) => {
      if (!iconId || map.hasImage(iconId)) return;

      // 导弹动态矢量图标：MISSILE_RED / MISSILE_BLUE / INTERCEPTOR
      if (iconId.startsWith('MISSILE_')) {
        const isRed = iconId.includes('RED');
        const isInterceptor = iconId.includes('INT');
        const size = 36;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d')!;
        ctx.translate(size / 2, size / 2);

        // 发光外焰与细长弹体（朝向正上方0度，由 icon-rotate 旋转）
        ctx.shadowColor = isInterceptor
          ? '#22d3ee'
          : isRed
          ? '#f43f5e'
          : '#38bdf8';
        ctx.shadowBlur = 8;
        ctx.fillStyle = isInterceptor
          ? '#67e8f9'
          : isRed
          ? '#fb7185'
          : '#7dd3fc';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.2;

        ctx.beginPath();
        ctx.moveTo(0, -13);
        ctx.lineTo(4.5, 6);
        ctx.lineTo(0, 3);
        ctx.lineTo(-4.5, 6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        const imgData = ctx.getImageData(0, 0, size, size);
        map.addImage(iconId, imgData, { pixelRatio: 2 });
        return;
      }

      // 参考点菱形准星图标
      if (iconId.startsWith('RP_MARKER_')) {
        const isRed = iconId.includes('RED');
        const size = 28;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d')!;
        ctx.translate(size / 2, size / 2);
        ctx.strokeStyle = isRed ? '#f59e0b' : '#38bdf8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -8);
        ctx.lineTo(8, 0);
        ctx.lineTo(0, 8);
        ctx.lineTo(-8, 0);
        ctx.closePath();
        ctx.stroke();

        ctx.fillStyle = isRed ? '#f59e0b' : '#38bdf8';
        ctx.beginPath();
        ctx.arc(0, 0, 2, 0, Math.PI * 2);
        ctx.fill();

        map.addImage(iconId, ctx.getImageData(0, 0, size, size), {
          pixelRatio: 2,
        });
        return;
      }

      // milsymbol 标准军标编码：格式 SIDC__SELECTED 或 SIDC__CONTACT
      const [rawSidc, modifier] = iconId.split('__');
      const isSelected = modifier === 'SELECTED';
      const isContact = modifier === 'CONTACT';

      try {
        const symbol = new ms.Symbol(rawSidc || 'SUAPMF------', {
          size: isSelected ? 32 : 27,
          frame: true,
          fill: true,
          strokeWidth: isSelected ? 4.5 : 3.5,
          outlineColor: isSelected
            ? '#22d3ee'
            : isContact
            ? '#f59e0b'
            : '#020617',
          outlineWidth: isSelected ? 4 : 2.5,
        });

        const symCanvas = symbol.asCanvas(2);
        const pad = 16;
        const outCanvas = document.createElement('canvas');
        outCanvas.width = symCanvas.width + pad * 2;
        outCanvas.height = symCanvas.height + pad * 2;
        const ctx = outCanvas.getContext('2d')!;

        if (isSelected) {
          // 为选中算子绘制荧光战术锁定方框
          ctx.strokeStyle = '#22d3ee';
          ctx.lineWidth = 2.5;
          const w = outCanvas.width - 8;
          const h = outCanvas.height - 8;
          const corner = 12;
          // 左上角
          ctx.beginPath();
          ctx.moveTo(4, 4 + corner);
          ctx.lineTo(4, 4);
          ctx.lineTo(4 + corner, 4);
          // 右上角
          ctx.moveTo(4 + w - corner, 4);
          ctx.lineTo(4 + w, 4);
          ctx.lineTo(4 + w, 4 + corner);
          // 右下角
          ctx.moveTo(4 + w, 4 + h - corner);
          ctx.lineTo(4 + w, 4 + h);
          ctx.lineTo(4 + w - corner, 4 + h);
          // 左下角
          ctx.moveTo(4 + corner, 4 + h);
          ctx.lineTo(4, 4 + h);
          ctx.lineTo(4, 4 + h - corner);
          ctx.stroke();
        }

        ctx.drawImage(symCanvas, pad, pad);
        const imgData = ctx.getImageData(0, 0, outCanvas.width, outCanvas.height);
        map.addImage(iconId, imgData, { pixelRatio: 2 });
      } catch {
        // Fallback safety
      }
    };

    map.on('styleimagemissing', (e) => {
      registerSpriteIcon(e.id);
    });

    // ------------------------------------------------------------------------
    // 初始化全部战术 GeoJSON 数据源与图层并绑定 Zustand 瞬态同步
    // ------------------------------------------------------------------------
    const syncStoreToLayers = () => {
      // Newly added GeoJSON sources can still be loading on the first frame.
      // Once the last tactical layer exists, it is safe to populate their data.
      if (!map.getLayer('units-symbol-layer')) return;
      const state = useWargameStore.getState();
      const {
        units,
        contacts,
        weaponsInFlight,
        explosions,
        missions,
        referencePoints,
        activePerspective,
        selectedUnitId: selUnitId,
        selectedContactId: selContactId,
        mapLayers,
        catalog,
      } = state;

      // 控制底图可见性
      if (map.getLayer('carto-dark-layer')) {
        map.setLayoutProperty(
          'carto-dark-layer',
          'visibility',
          mapLayers.showSatelliteDarkTiles ? 'visible' : 'none'
        );
      }

      // 1. 当前视角可见的真实单位 (Friendly / GOD)
      const visibleUnits = Object.values(units).filter(
        (u) =>
          isActiveUnit(u) &&
          (activePerspective === 'GOD' || u.side === activePerspective)
      );

      // 2. 当前视角可见的情报接触 (Contacts - 仅在 RED 或 BLUE 视角显示敌方接触)
      const visibleContacts =
        activePerspective === 'GOD'
          ? []
          : Object.values(contacts).filter(
              (c) => c.observerSide === activePerspective
            );

      // 3. 巡逻任务区域多边形 (Missions)
      const missionFeatures: GeoJSON.Feature[] = [];
      if (mapLayers.showMissions) {
        for (const m of missions) {
          if (activePerspective !== 'GOD' && m.side !== activePerspective)
            continue;
          if (m.areaPolygon.length >= 3) {
            const closedRing = [...m.areaPolygon, m.areaPolygon[0]];
            missionFeatures.push({
              type: 'Feature',
              properties: {
                id: m.id,
                name: `${m.name} [${m.isActive ? 'ACTIVE' : 'STANDBY'}]`,
                side: m.side,
                isActive: m.isActive,
              },
              geometry: {
                type: 'Polygon',
                coordinates: [closedRing],
              },
            });
          }
        }
      }
      (map.getSource('missions-source') as maplibregl.GeoJSONSource)?.setData({
        type: 'FeatureCollection',
        features: missionFeatures,
      });

      // 4. 传感器探测圈与武器射程包线 (Envelopes: Radar / Weapon / Sonar)
      const envelopeFeatures: GeoJSON.Feature[] = [];
      for (const u of visibleUnits) {
        const isSelected = u.id === selUnitId;
        const spec = catalog.platforms[u.platformId];
        if (!spec) continue;
        const configuration = resolveUnitConfiguration(catalog, u.platformId, u.activeLoadoutId);

        // 雷达包线 (开启全局雷达圈或当前选中该算子)
        if ((mapLayers.showRadarRings || isSelected) && u.doctrine.emconRadar && getUnitCapabilities(u).radarFactor > 0) {
          for (const sId of configuration.sensorIds) {
            const sensor = catalog.sensors[sId];
            if (
              sensor &&
              (sensor.type === 'radar_air_surface' || sensor.type === 'radar_oth')
            ) {
              // 同时展示最大对空探测包线，以及如果是选中舰艇则额外展示对12m掠海目标的地球曲率视距内圈！
              envelopeFeatures.push(
                turf.circle(u.position, sensor.maxRangeKm * getUnitCapabilities(u).radarFactor, {
                  steps: 64,
                  units: 'kilometers',
                  properties: {
                    ringKind: 'radar',
                    side: u.side,
                    isSelected,
                    label: `${u.callsign} 雷达包线 (${sensor.maxRangeKm}km)`,
                  },
                })
              );

              if (isSelected && u.domain === 'surface') {
                const seaSkimmerHorizonKm = calculateRadarHorizonKm(
                  u.altitudeM,
                  spec.radarAntennaHeightM,
                  12
                );
                envelopeFeatures.push(
                  turf.circle(u.position, seaSkimmerHorizonKm, {
                    steps: 48,
                    units: 'kilometers',
                    properties: {
                      ringKind: 'horizon',
                      side: u.side,
                      isSelected: true,
                      label: `掠海视距盲区界 (${seaSkimmerHorizonKm.toFixed(0)}km)`,
                    },
                  })
                );
              }
            }
          }
        }

        // 武器射程包线（为避免画面杂乱，选中单元必显，或开启全局武器圈时显示主战武器最大射程）
        if (mapLayers.showWeaponRings || isSelected) {
          const maxWeaponMount = u.mounts
            .filter((m) => m.currentAmmo > 0)
            .sort((a, b) => {
              const wa = catalog.weapons[a.weaponId]?.maxRangeKm || 0;
              const wb = catalog.weapons[b.weaponId]?.maxRangeKm || 0;
              return wb - wa;
            })[0];

          if (maxWeaponMount) {
            const wSpec = catalog.weapons[maxWeaponMount.weaponId];
            if (wSpec && (isSelected || u.category === 'sam_battery' || u.category === 'destroyer')) {
              envelopeFeatures.push(
                turf.circle(u.position, wSpec.maxRangeKm, {
                  steps: 64,
                  units: 'kilometers',
                  properties: {
                    ringKind: 'weapon',
                    side: u.side,
                    isSelected,
                    label: `${wSpec.codeName} 射程 (${wSpec.maxRangeKm}km)`,
                  },
                })
              );
            }
          }
        }

        // 声呐包线
        if (
          (mapLayers.showSonarRings || isSelected) &&
          (u.domain === 'subsurface' || u.domain === 'surface')
        ) {
          for (const sId of configuration.sensorIds) {
            const sensor = catalog.sensors[sId];
            if (sensor && sensor.type === 'sonar_passive') {
              envelopeFeatures.push(
                turf.circle(u.position, sensor.maxRangeKm * getUnitCapabilities(u).radarFactor, {
                  steps: 48,
                  units: 'kilometers',
                  properties: {
                    ringKind: 'sonar',
                    side: u.side,
                    isSelected,
                  },
                })
              );
            }
          }
        }
      }
      (map.getSource('envelopes-source') as maplibregl.GeoJSONSource)?.setData({
        type: 'FeatureCollection',
        features: envelopeFeatures,
      });

      // 5. AOU 不确定性区域多边形 (Area of Uncertainty)
      const aouFeatures: GeoJSON.Feature[] = [];
      if (mapLayers.showAouPolygons) {
        for (const c of visibleContacts) {
          if (c.uncertaintyPolygon && c.uncertaintyPolygon.length >= 4) {
            aouFeatures.push({
              type: 'Feature',
              properties: {
                id: c.id,
                radiusKm: c.uncertaintyRadiusKm,
                label: `AOU ±${c.uncertaintyRadiusKm}km`,
              },
              geometry: {
                type: 'Polygon',
                coordinates: [c.uncertaintyPolygon],
              },
            });
          }
        }
      }
      (map.getSource('aou-source') as maplibregl.GeoJSONSource)?.setData({
        type: 'FeatureCollection',
        features: aouFeatures,
      });

      // 6. 航路点与速度矢量线 (Waypoints & Heading Vectors)
      const waypointLineFeatures: GeoJSON.Feature[] = [];
      const waypointNodeFeatures: GeoJSON.Feature[] = [];
      if (mapLayers.showWaypoints) {
        for (const u of visibleUnits) {
          if (u.waypoints.length > 0) {
            const coords = [u.position, ...u.waypoints];
            waypointLineFeatures.push({
              type: 'Feature',
              properties: {
                unitId: u.id,
                side: u.side,
                isSelected: u.id === selUnitId,
              },
              geometry: {
                type: 'LineString',
                coordinates: coords,
              },
            });
            u.waypoints.forEach((wp, idx) => {
              waypointNodeFeatures.push({
                type: 'Feature',
                properties: {
                  unitId: u.id,
                  label: `WP-${idx + 1}`,
                  side: u.side,
                },
                geometry: {
                  type: 'Point',
                  coordinates: wp,
                },
              });
            });
          }

          // 绘制 90 秒预测航向速度矢量线
          if (u.speedKts > 5) {
            const vecKm = Math.min(45, Math.max(12, u.speedKts * 0.06));
            const tip = turf.destination(u.position, vecKm, u.heading, {
              units: 'kilometers',
            });
            waypointLineFeatures.push({
              type: 'Feature',
              properties: {
                unitId: u.id,
                side: u.side,
                isVector: true,
              },
              geometry: {
                type: 'LineString',
                coordinates: [u.position, tip.geometry.coordinates],
              },
            });
          }
        }
      }
      (map.getSource('waypoints-line-source') as maplibregl.GeoJSONSource)?.setData({
        type: 'FeatureCollection',
        features: waypointLineFeatures,
      });
      (map.getSource('waypoints-node-source') as maplibregl.GeoJSONSource)?.setData({
        type: 'FeatureCollection',
        features: waypointNodeFeatures,
      });

      // 7. 飞行中的导弹与尾迹 (Missiles & Trails)
      const missilePointFeatures: GeoJSON.Feature[] = [];
      const missileTrailFeatures: GeoJSON.Feature[] = [];
      for (const msl of Object.values(weaponsInFlight)) {
        // 迷雾下：己方发射的导弹始终可见；敌方发射的导弹在进入雷达/预警范围（280km内）或 GOD 视角可见
        const isVisible =
          activePerspective === 'GOD' ||
          msl.side === activePerspective ||
          !!observeMissile(activePerspective, msl, units, catalog, state.simTime);
        if (!isVisible) continue;

        const iconKey =
          msl.targetType === 'missile'
            ? 'MISSILE_INT'
            : msl.side === 'RED'
            ? 'MISSILE_RED'
            : 'MISSILE_BLUE';

        missilePointFeatures.push({
          type: 'Feature',
          properties: {
            id: msl.id,
            name: activePerspective === 'GOD' || msl.side === activePerspective ? msl.name : '来袭武器',
            side: msl.side,
            heading: msl.heading,
            icon: iconKey,
            speedMach: (msl.speedKts / 661).toFixed(1),
          },
          geometry: {
            type: 'Point',
            coordinates: msl.position,
          },
        });

        if (msl.trail.length >= 2 && (activePerspective === 'GOD' || msl.side === activePerspective)) {
          missileTrailFeatures.push({
            type: 'Feature',
            properties: {
              id: msl.id,
              side: msl.side,
              isInterceptor: msl.targetType === 'missile',
            },
            geometry: {
              type: 'LineString',
              coordinates: msl.trail,
            },
          });
        }
      }
      (map.getSource('missiles-point-source') as maplibregl.GeoJSONSource)?.setData({
        type: 'FeatureCollection',
        features: missilePointFeatures,
      });
      (map.getSource('missiles-trail-source') as maplibregl.GeoJSONSource)?.setData({
        type: 'FeatureCollection',
        features: missileTrailFeatures,
      });

      // 8. 算子符号与情报 Contact 符号图层
      const unitFeatures: GeoJSON.Feature[] = visibleUnits.map((u) => {
        const isSel = u.id === selUnitId;
        const iconId = `${u.sidc}__${isSel ? 'SELECTED' : 'NORMAL'}`;
        const altStr =
          u.domain === 'air'
            ? `FL${Math.round(u.altitudeM / 30.48)
                .toString()
                .padStart(3, '0')}`
            : u.domain === 'subsurface'
            ? `${Math.round(u.altitudeM)}m`
            : `${Math.round(u.speedKts)}kt`;

        return {
          type: 'Feature',
          properties: {
            id: u.id,
            entityType: 'unit',
            callsign: u.callsign,
            name: u.name,
            side: u.side,
            icon: iconId,
            subLabel: `${u.callsign} [${altStr}]`,
            hpPct: Math.round((u.hp / u.maxHp) * 100),
            emconStr: u.doctrine.emconRadar ? 'RADAR:ON' : 'EMCON',
          },
          geometry: {
            type: 'Point',
            coordinates: u.position,
          },
        };
      });

      const contactFeatures: GeoJSON.Feature[] = visibleContacts.map((c) => {
        const isSel = c.id === selContactId;
        const iconId = `${c.sidc}__${isSel ? 'SELECTED' : 'CONTACT'}`;
        return {
          type: 'Feature',
          properties: {
            id: c.id,
            entityType: 'contact',
            actualUnitId: c.actualUnitId,
            name: c.displayName,
            icon: iconId,
            subLabel: `${c.displayName} (±${c.uncertaintyRadiusKm}km)`,
          },
          geometry: {
            type: 'Point',
            coordinates: c.estimatedPosition,
          },
        };
      });

      (map.getSource('units-source') as maplibregl.GeoJSONSource)?.setData({
        type: 'FeatureCollection',
        features: [...unitFeatures, ...contactFeatures],
      });

      // 9. 参考点 (Reference Points)
      const rpFeatures: GeoJSON.Feature[] = mapLayers.showReferencePoints
        ? referencePoints
            .filter(
              (rp) =>
                activePerspective === 'GOD' || rp.side === activePerspective
            )
            .map((rp) => ({
              type: 'Feature',
              properties: {
                id: rp.id,
                name: rp.name,
                icon: rp.side === 'RED' ? 'RP_MARKER_RED' : 'RP_MARKER_BLUE',
              },
              geometry: {
                type: 'Point',
                coordinates: rp.position,
              },
            }))
        : [];
      (map.getSource('rp-source') as maplibregl.GeoJSONSource)?.setData({
        type: 'FeatureCollection',
        features: rpFeatures,
      });

      // 10. 爆炸与拦截波纹特效 (Explosions)
      const expFeatures: GeoJSON.Feature[] = explosions.filter((exp) => activePerspective === 'GOD' || exp.side === activePerspective).map((exp) => ({
        type: 'Feature',
        properties: {
          id: exp.id,
          type: exp.type,
          label: exp.label,
        },
        geometry: {
          type: 'Point',
          coordinates: exp.position,
        },
      }));
      (map.getSource('explosions-source') as maplibregl.GeoJSONSource)?.setData({
        type: 'FeatureCollection',
        features: expFeatures,
      });
    };

    map.on('load', () => {
      // 注册所有战术数据源
      const emptyFC: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: [],
      };
      map.addSource('missions-source', { type: 'geojson', data: emptyFC });
      map.addSource('envelopes-source', { type: 'geojson', data: emptyFC });
      map.addSource('aou-source', { type: 'geojson', data: emptyFC });
      map.addSource('waypoints-line-source', { type: 'geojson', data: emptyFC });
      map.addSource('waypoints-node-source', { type: 'geojson', data: emptyFC });
      map.addSource('missiles-trail-source', { type: 'geojson', data: emptyFC });
      map.addSource('missiles-point-source', { type: 'geojson', data: emptyFC });
      map.addSource('rp-source', { type: 'geojson', data: emptyFC });
      map.addSource('explosions-source', { type: 'geojson', data: emptyFC });
      map.addSource('units-source', { type: 'geojson', data: emptyFC });

      // 1. 巡逻区多边形图层
      map.addLayer({
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
      map.addLayer({
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
      map.addLayer({
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
            'sonar',
            'rgba(16, 185, 129, 0.05)',
            'horizon',
            'rgba(245, 158, 11, 0.06)',
            'rgba(34, 211, 238, 0.02)',
          ],
        },
      });
      map.addLayer({
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
            'sonar',
            'rgba(16, 185, 129, 0.55)',
            'horizon',
            'rgba(245, 158, 11, 0.75)',
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
            'horizon',
            ['literal', [2, 2]],
            ['literal', [1, 0]],
          ],
        },
      });

      // 3. AOU 不确定性多边形图层
      map.addLayer({
        id: 'aou-fill-layer',
        type: 'fill',
        source: 'aou-source',
        paint: {
          'fill-color': 'rgba(245, 158, 11, 0.14)',
        },
      });
      map.addLayer({
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
      map.addLayer({
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
      map.addLayer({
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
      map.addLayer({
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
      map.addLayer({
        id: 'missiles-point-layer',
        type: 'symbol',
        source: 'missiles-point-source',
        layout: {
          'icon-image': ['get', 'icon'],
          'icon-rotate': ['get', 'heading'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
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
      map.addLayer({
        id: 'rp-symbol-layer',
        type: 'symbol',
        source: 'rp-source',
        layout: {
          'icon-image': ['get', 'icon'],
          'icon-allow-overlap': true,
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
      map.addLayer({
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
      map.addLayer({
        id: 'explosions-label-layer',
        type: 'symbol',
        source: 'explosions-source',
        layout: {
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

      // 8. 顶层北约军标算子与情报接触图层 (Units & Contacts)
      map.addLayer({
        id: 'units-symbol-layer',
        type: 'symbol',
        source: 'units-source',
        layout: {
          'icon-image': ['get', 'icon'],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'text-field': ['get', 'subLabel'],
          'text-size': 11,
          'text-offset': [0, 1.85],
          'text-anchor': 'top',
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

      // 初次同步数据
      syncStoreToLayers();
    });

    // ------------------------------------------------------------------------
    // 地图鼠标移动与点击交互 (F3 航线标绘 / F1 手动交战 / 参考点 / 算子点选)
    // ------------------------------------------------------------------------
    map.on('mousemove', (e) => {
      setCursorCoord([
        Number(e.lngLat.lng.toFixed(3)),
        Number(e.lngLat.lat.toFixed(3)),
      ]);
    });

    map.on('click', (e) => {
      const state = useWargameStore.getState();
      const clickedCoord: [number, number] = [
        Number(e.lngLat.lng.toFixed(4)),
        Number(e.lngLat.lat.toFixed(4)),
      ];

      // 模式 A: F3 规划航路点
      if (state.interactionMode === 'plot_waypoint' && state.selectedUnitId) {
        state.appendUnitWaypoint(state.selectedUnitId, clickedCoord, false);
        return;
      }

      // 模式 B: 放置参考点
      if (state.interactionMode === 'place_ref_point') {
        state.addReferencePoint(clickedCoord);
        return;
      }

      // 模式 C: 实时投放新算子
      if (state.interactionMode === 'spawn_unit') {
        state.spawnUnitAtCoordinate(clickedCoord);
        return;
      }

      // 检查是否点击了算子或情报目标
      const features = map.queryRenderedFeatures(e.point, {
        layers: ['units-symbol-layer'],
      });

      if (features.length > 0) {
        const props = features[0].properties;
        if (!props) return;

        // 模式 D: F1 手动火力分配模式下点击敌方 Contact 或敌方 Unit
        if (state.interactionMode === 'manual_engage' && state.selectedUnitId) {
          const targetId =
            props.entityType === 'contact' ? props.id : props.id;
          state.executeManualEngage(
            state.selectedUnitId,
            targetId,
            state.pendingWeaponIdForEngage || undefined,
            state.pendingSalvoCount
          );
          return;
        }

        if (props.entityType === 'unit') {
          state.selectUnit(props.id);
        } else if (props.entityType === 'contact') {
          state.selectContact(props.id);
        }
      }
    });

    // 右键快速结束航线规划模式
    map.on('contextmenu', (e) => {
      e.preventDefault();
      const state = useWargameStore.getState();
      if (state.interactionMode !== 'select') {
        state.setInteractionMode('select');
      }
    });

    // 绑定 Zustand Store 瞬态更新订阅
    const unsubscribeData = useWargameStore.subscribe(
      (s) => ({
        simTime: s.simTime,
        units: s.units,
        contacts: s.contacts,
        weaponsInFlight: s.weaponsInFlight,
        explosions: s.explosions,
        missions: s.missions,
        referencePoints: s.referencePoints,
        activePerspective: s.activePerspective,
        selectedUnitId: s.selectedUnitId,
        selectedContactId: s.selectedContactId,
        mapLayers: s.mapLayers,
      }),
      () => {
        syncStoreToLayers();
      }
    );

    // 绑定相机跳转请求
    const unsubscribeCamera = useWargameStore.subscribe(
      (s) => s.cameraFlyToRequest,
      (req) => {
        if (req && mapRef.current) {
          mapRef.current.flyTo({
            center: req.center,
            zoom: req.zoom ?? mapRef.current.getZoom(),
            duration: 900,
          });
        }
      }
    );

    // Panel toggles and the log dock resize the canvas without a window resize.
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(mapContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      unsubscribeData();
      unsubscribeCamera();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div className="relative w-full h-full overflow-hidden select-none">
      {/* MapLibre WebGL 容器 */}
      <div
        ref={mapContainerRef}
        className={`w-full h-full ${
          interactionMode !== 'select' ? 'cursor-crosshair' : 'cursor-default'
        }`}
      />

      {/* CRT 军工扫描线微纹理层 (不阻挡鼠标事件) */}
      <div className="pointer-events-none absolute inset-0 tactical-scanlines opacity-55" />

      {/* 顶部模式浮动战术横幅 (当处于 F3 航线标绘 / F1 手动交战 / 算子投放模式时高亮提示) */}
      {interactionMode !== 'select' && (
        <div className="absolute top-3 left-3 right-3 z-20 flex items-center gap-3 px-3 py-2 rounded bg-cyan-950/90 border border-cyan-400/70 shadow-[0_0_25px_rgba(34,211,238,0.35)] text-xs font-mono text-cyan-200">
          <span className="inline-block w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
          {interactionMode === 'plot_waypoint' && (
            <span>
              [F3 航路点标绘模式] 点击海图追加机动航路点 ({selectedUnit?.callsign}
              ) · 右键或按 ESC 完成
            </span>
          )}
          {interactionMode === 'manual_engage' && (
            <span className="text-rose-200">
              [F1 手动火力分配模式] 请在态势图上点击敌方目标 实施导弹齐射 · 右键取消
            </span>
          )}
          {interactionMode === 'place_ref_point' && (
            <span className="text-amber-200">
              [参考点标绘模式] 点击海图任意位置部署战术参考点 · 右键取消
            </span>
          )}
          {interactionMode === 'spawn_unit' && (
            <span className="text-emerald-200">
              [实时兵力投放模式] 点击海图目标海域/空域立即部署新增作战算子 · 右键取消
            </span>
          )}
          <button
            onClick={() => setInteractionMode('select')}
            className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-cyan-500/40 text-cyan-300 cursor-pointer shrink-0 whitespace-nowrap"
          >
            退出 [ESC]
          </button>
        </div>
      )}

      {/* 左下角经纬度遥测坐标与图例浮窗 */}
      <div className="map-status tactical-panel">
        <div className="flex items-center gap-1.5">
          <span className="text-cyan-400 font-semibold">坐标</span>
          <span>
            {cursorCoord[1].toFixed(3)}°N, {cursorCoord[0].toFixed(3)}°E
          </span>
        </div>
        <div className="map-legend">
          <span className="flex items-center gap-1">
            <i className="w-2.5 h-0.5 bg-cyan-400 inline-block" /> 雷达视距圈
          </span>
          <span className="flex items-center gap-1">
            <i className="w-2.5 h-0.5 bg-rose-500 inline-block" /> 武器射程圈
          </span>
          <span className="flex items-center gap-1">
            <i className="w-2.5 h-0.5 bg-amber-400 inline-block" /> 盲区 / 定位误差
          </span>
          <span className="flex items-center gap-1">
            <i className="w-2.5 h-0.5 bg-emerald-400 inline-block" /> 水下声呐圈
          </span>
        </div>
      </div>
    </div>
  );
};
