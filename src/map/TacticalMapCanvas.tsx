import { observeMissile } from '../engine/sensors';
import { getUnitCapabilities, isActiveUnit } from '../engine/unitCapabilities';
import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import ms from 'milsymbol';
import * as turf from '@turf/turf';
import { useWargameStore } from '../store/useWargameStore';
import { createOfflineBasemap } from './offlineBasemap';
import { installTacticalLayers } from './tacticalLayers';
import { BasemapLoader, BASEMAP_PRESETS, initialBasemapState, basemapFallbackImage, type BasemapMode, type BasemapState } from './basemaps';
import { calculateRadarHorizonKm } from '../engine/simulationEngine';
import { resolveUnitConfiguration } from '../db/unitConfiguration';

// ============================================================================
// AEGIS-CMO // MapLibre GL + milsymbol 高性能 WebGL 战术态势沙盘组件
// 架构亮点：通过 Zustand subscribe 直推 GeoJSON Source，60FPS 零 React VDOM 重绘抖动
// ============================================================================

export const TacticalMapCanvas: React.FC = () => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const basemapLoaderRef = useRef<BasemapLoader | null>(null);
  const basemapMode = useWargameStore((s) => s.basemapMode);
  const setBasemapMode = useWargameStore((s) => s.setBasemapMode);
  const [basemapState, setBasemapState] = useState<BasemapState>(() => initialBasemapState(basemapMode));
  const [cursorCoord, setCursorCoord] = useState<[number, number]>([124.2, 26.2]);

  const interactionMode = useWargameStore((s) => s.interactionMode);
  const selectedUnit = useWargameStore((s) =>
    s.selectedUnitId ? s.units[s.selectedUnitId] : null
  );
  const setInteractionMode = useWargameStore((s) => s.setInteractionMode);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const initialScenario = useWargameStore.getState().currentScenario;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      center: initialScenario.initialCamera.center,
      zoom: initialScenario.initialCamera.zoom,
      pitch: initialScenario.initialCamera.pitch ?? 0,
      bearing: initialScenario.initialCamera.bearing ?? 0,
      minZoom: 2,
      maxZoom: 18,
      attributionControl: { compact: false },
      style: createOfflineBasemap(),
    });

    mapRef.current = map;
    setCursorCoord(initialScenario.initialCamera.center);
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    const basemapLoader = new BasemapLoader({
      applyStyle: (style) => { map.setStyle(style, { diff: false }); },
      onState: setBasemapState,
    });
    basemapLoaderRef.current = basemapLoader;
    map.on('error', (event) => {
      const sourceId = 'sourceId' in event && typeof event.sourceId === 'string' ? event.sourceId : undefined;
      basemapLoader.reportResourceError(sourceId);
    });
    map.on('idle', () => {
      if (basemapLoader.baseSourceIds.some((id) => map.getSource(id) && map.isSourceLoaded(id))) basemapLoader.markReady();
    });
    map.on('sourcedata', (event) => {
      // Continuous panning or live tactical updates may prevent idle; a loaded base tile is enough.
      if (basemapLoader.baseSourceIds.includes(event.sourceId) && event.sourceDataType === 'content' &&
          'tile' in event && event.tile) basemapLoader.markReady();
    });

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
      if (e.id.startsWith('MISSILE_') || e.id.startsWith('RP_MARKER_') ||
          /^S[A-Z0-9-]+__(SELECTED|NORMAL|CONTACT)$/.test(e.id)) registerSpriteIcon(e.id);
      else {
        const image = basemapFallbackImage(e.id);
        if (image && !map.hasImage(e.id)) map.addImage(e.id, image);
      }
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

    map.on('style.load', () => {
      installTacticalLayers(map);
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
      if (!map.getLayer('units-symbol-layer')) return;
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

    const unsubscribeBasemap = useWargameStore.subscribe(
      (s) => s.basemapMode,
      (mode) => { void basemapLoader.select(mode); }
    );
    void basemapLoader.select(useWargameStore.getState().basemapMode);

    // Panel toggles and the log dock resize the canvas without a window resize.
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(mapContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      unsubscribeData();
      unsubscribeCamera();
      unsubscribeBasemap();
      basemapLoader.dispose();
      basemapLoaderRef.current = null;
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

      {basemapState.active === 'offline' && <div className="pointer-events-none absolute inset-0 tactical-scanlines opacity-55" />}

      <section className="basemap-controls tactical-panel" style={{ top: interactionMode === 'select' ? 12 : 70 }} aria-label="底图来源与状态">
        <select aria-label="底图选择" value={basemapMode} onChange={(e) => setBasemapMode(e.target.value as BasemapMode)}>
          {Object.entries(BASEMAP_PRESETS).map(([id, preset]) => <option key={id} value={id}>{preset.label}</option>)}
        </select>
        <p role="status" className={basemapState.status === 'error' || basemapState.status === 'degraded' ? 'text-amber-300' : 'text-slate-400'}>
          {basemapState.message ?? (basemapState.status === 'loading'
            ? `加载真实底图中 · 当前${BASEMAP_PRESETS[basemapState.active].label}`
            : basemapState.active === 'offline' ? '本地简化轮廓 · 非真实地理数据' : 'OpenFreeMap / OpenStreetMap · 非卫星影像')}
        </p>
        {(basemapState.status === 'error' || basemapState.status === 'degraded') && <div className="flex gap-2 mt-1">
          <button type="button" className="text-cyan-300 underline" onClick={() => { void basemapLoaderRef.current?.select(basemapMode, true); }}>重试在线地图</button>
          <button type="button" className="text-slate-300 underline" onClick={() => setBasemapMode('offline')}>使用离线示意</button>
        </div>}
      </section>

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
          <span className="text-cyan-400 font-semibold">光标</span>
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
