import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import ms from 'milsymbol';
import { shallow } from 'zustand/shallow';
import { useWargameStore } from '../store/useWargameStore';
import { projectTacticalState } from './tacticalProjection';
import { createOfflineBasemap } from './offlineBasemap';
import { installTacticalLayers } from './tacticalLayers';
import { BasemapLoader, BASEMAP_PRESETS, initialBasemapState, basemapFallbackImage, type BasemapState } from './basemaps';
import { getBearingDeg, getDistanceKm } from '../engine/simulationEngine';
import { evaluateFireControl } from '../engine/fireControl';
import { sanitizeSidc } from '../validation/wargameSchemas';

// ============================================================================
// AEGIS-CMO // MapLibre GL + milsymbol 高性能 WebGL 战术态势沙盘组件
// 架构亮点：通过 Zustand subscribe 直推 GeoJSON Source，60FPS 零 React VDOM 重绘抖动
// ============================================================================

export const TacticalMapCanvas = React.memo(function TacticalMapCanvas({
  leftOpen = true,
  rightOpen = true,
}: {
  leftOpen?: boolean;
  rightOpen?: boolean;
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const basemapLoaderRef = useRef<BasemapLoader | null>(null);
  const basemapMode = useWargameStore((s) => s.basemapMode);
  const [basemapState, setBasemapState] = useState<BasemapState>(() => initialBasemapState(basemapMode));
  const cursorReadoutRef = useRef<HTMLSpanElement | null>(null);
  const cursorPendingRef = useRef<[number, number]>([124.2, 26.2]);
  const cursorRafRef = useRef<number | null>(null);
  const rulerRef = useRef<{ start?: [number, number]; end?: [number, number] }>({});
  const [rulerMeasurement, setRulerMeasurement] = useState<{ distanceKm: number; bearingDeg: number } | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [hoverEngageSummary, setHoverEngageSummary] = useState<string | null>(null);
  const hoveredContactIdRef = useRef<string | null>(null);
  const suppressNextClickRef = useRef(false);

  const interactionMode = useWargameStore((s) => s.interactionMode);
  const selectedCount = useWargameStore((s) => s.selectedUnitIds.length);
  const doglegCount = useWargameStore((s) => s.pendingStrikeWaypoints.length);
  const clearPendingStrikeWaypoints = useWargameStore((s) => s.clearPendingStrikeWaypoints);
  // The map layers subscribe imperatively; React only needs the stable banner label.
  const selectedUnitCallsign = useWargameStore((s) =>
    s.selectedUnitIds.length > 1
      ? `${s.selectedUnitIds.length} 个编组单元`
      : s.selectedUnitId
        ? s.units[s.selectedUnitId]?.callsign
        : undefined
  );
  const setInteractionMode = useWargameStore((s) => s.setInteractionMode);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const initialState = useWargameStore.getState();
    const initialScenario = initialState.currentScenario;
    const initialBasemapMode = initialState.basemapMode;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      center: initialScenario.initialCamera.center,
      zoom: initialScenario.initialCamera.zoom,
      pitch: initialScenario.initialCamera.pitch ?? 0,
      bearing: initialScenario.initialCamera.bearing ?? 0,
      minZoom: 2,
      maxZoom: 18,
      boxZoom: false,
      attributionControl: { compact: false },
      style: createOfflineBasemap(),
    });

    mapRef.current = map;
    cursorPendingRef.current = [...initialScenario.initialCamera.center];
    if (cursorReadoutRef.current) {
      cursorReadoutRef.current.textContent = `${initialScenario.initialCamera.center[1].toFixed(3)}°N, ${initialScenario.initialCamera.center[0].toFixed(3)}°E`;
    }
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-left');
    const basemapLoader = new BasemapLoader({
      applyStyle: (style) => { map.setStyle(style, { diff: false }); },
      onState: setBasemapState,
      initialOfflineApplied: true,
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
        const symbol = new ms.Symbol(sanitizeSidc(rawSidc, 'SUAPMF------'), {
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

    const syncRulerLayer = () => {
      const { start, end } = rulerRef.current;
      const features: GeoJSON.Feature[] = [];
      if (start) features.push({ type: 'Feature', properties: { endpoint: 'start' }, geometry: { type: 'Point', coordinates: start } });
      if (end) features.push({ type: 'Feature', properties: { endpoint: 'end' }, geometry: { type: 'Point', coordinates: end } });
      if (start && end) features.push({
        type: 'Feature', properties: { kind: 'ruler' },
        geometry: { type: 'LineString', coordinates: [start, end] },
      });
      (map.getSource('ruler-source') as maplibregl.GeoJSONSource)?.setData({ type: 'FeatureCollection', features });
    };

    // ------------------------------------------------------------------------
    // 初始化全部战术 GeoJSON 数据源与图层并绑定 Zustand 瞬态同步
    // ------------------------------------------------------------------------
    const syncStoreToLayers = () => {
      // Newly added GeoJSON sources can still be loading on the first frame.
      // Once the last tactical layer exists, it is safe to populate their data.
      if (!map.getLayer('units-symbol-layer')) return;
      const state = useWargameStore.getState();
      const projection = projectTacticalState({
        units: state.units,
        contacts: state.contacts,
        weaponsInFlight: state.weaponsInFlight,
        explosions: state.explosions,
        missions: state.missions,
        referencePoints: state.referencePoints,
        activePerspective: state.activePerspective,
        selectedUnitId: state.selectedUnitId,
        selectedUnitIds: state.selectedUnitIds,
        selectedContactId: state.selectedContactId,
        hoveredContactId: hoveredContactIdRef.current,
        pendingWeaponIdForEngage: state.pendingWeaponIdForEngage,
        pendingStrikeWaypoints: state.pendingStrikeWaypoints,
        mapLayers: state.mapLayers,
        catalog: state.catalog,
        simTime: state.simTime,
        environment: state.environment,
        objectives: state.objectives,
      });
      (map.getSource('terrain-source') as maplibregl.GeoJSONSource)?.setData({
        type: 'FeatureCollection', features: projection.terrainRidges,
      });
      if (map.getLayer('terrain-extrusion-layer')) {
        map.setLayoutProperty(
          'terrain-extrusion-layer',
          'visibility',
          state.mapLayers.show3dTerrain ? 'visible' : 'none'
        );
      }
      (map.getSource('weather-zones-source') as maplibregl.GeoJSONSource)?.setData({
        type: 'FeatureCollection', features: projection.weatherZones,
      });
      (map.getSource('control-zones-source') as maplibregl.GeoJSONSource)?.setData({
        type: 'FeatureCollection', features: projection.controlZones,
      });
      (map.getSource('missions-source') as maplibregl.GeoJSONSource)?.setData({
        type: 'FeatureCollection', features: projection.missions,
      });

      (map.getSource('envelopes-source') as maplibregl.GeoJSONSource)?.setData({
        type: 'FeatureCollection', features: projection.envelopes,
      });
      (map.getSource('aou-source') as maplibregl.GeoJSONSource)?.setData({
        type: 'FeatureCollection', features: projection.aou,
      });

      (map.getSource('waypoints-line-source') as maplibregl.GeoJSONSource)?.setData({
        type: 'FeatureCollection', features: projection.waypointLines,
      });
      (map.getSource('waypoints-node-source') as maplibregl.GeoJSONSource)?.setData({
        type: 'FeatureCollection', features: projection.waypointNodes,
      });
      (map.getSource('missiles-point-source') as maplibregl.GeoJSONSource)?.setData({
        type: 'FeatureCollection', features: projection.missilePoints,
      });
      (map.getSource('missiles-trail-source') as maplibregl.GeoJSONSource)?.setData({
        type: 'FeatureCollection', features: projection.missileTrails,
      });

      (map.getSource('units-source') as maplibregl.GeoJSONSource)?.setData({
        type: 'FeatureCollection', features: projection.units,
      });
      (map.getSource('rp-source') as maplibregl.GeoJSONSource)?.setData({
        type: 'FeatureCollection', features: projection.referencePoints,
      });
      (map.getSource('explosions-source') as maplibregl.GeoJSONSource)?.setData({
        type: 'FeatureCollection', features: projection.explosions,
      });
      (map.getSource('fire-control-source') as maplibregl.GeoJSONSource)?.setData({
        type: 'FeatureCollection', features: projection.fireControlLinks,
      });
      syncRulerLayer();
    };

    map.on('style.load', () => {
      installTacticalLayers(map);
      syncStoreToLayers();
    });

    // ------------------------------------------------------------------------
    // 地图鼠标移动与点击交互 (F3 航线标绘 / F1 手动交战 / 参考点 / 算子点选)
    // ------------------------------------------------------------------------
    map.on('mousemove', (e) => {
      cursorPendingRef.current = [e.lngLat.lng, e.lngLat.lat];
      if (cursorRafRef.current === null) {
        cursorRafRef.current = window.requestAnimationFrame(() => {
          cursorRafRef.current = null;
          if (cursorReadoutRef.current) {
            const [lng, lat] = cursorPendingRef.current;
            cursorReadoutRef.current.textContent = `${lat.toFixed(3)}°N, ${lng.toFixed(3)}°E`;
          }
        });
      }
      const state = useWargameStore.getState();
      if (state.interactionMode === 'manual_engage' && map.getLayer('units-symbol-layer')) {
        const hits = map.queryRenderedFeatures(e.point, { layers: ['units-symbol-layer'] });
        const contactHit = hits.find((f) => f.properties?.entityType === 'contact');
        const nextHoverId = contactHit?.properties?.id ? String(contactHit.properties.id) : null;
        if (nextHoverId !== hoveredContactIdRef.current) {
          hoveredContactIdRef.current = nextHoverId;
          syncStoreToLayers();
          if (nextHoverId && state.selectedUnitId) {
            const shooter = state.units[state.selectedUnitId];
            const contact = state.contacts[nextHoverId];
            const mount = shooter?.mounts.find(
              (m) => (!state.pendingWeaponIdForEngage || m.weaponId === state.pendingWeaponIdForEngage) && m.currentAmmo > 0
            ) ?? shooter?.mounts[0];
            const weapon = mount ? state.catalog.weapons[mount.weaponId] : undefined;
            if (shooter && contact && mount && weapon) {
              const sol = evaluateFireControl(
                shooter,
                contact,
                mount,
                weapon,
                state.catalog,
                state.units,
                state.simTime,
                'manual',
                state.weaponsInFlight,
                state.pendingStrikeWaypoints
              );
              const relay = sol.supportSourceIds.map((id) => state.units[id]?.callsign).filter(Boolean).join('/') || '自主盲飞';
              setHoverEngageSummary(
                `${weapon.codeName} → ${contact.displayName} · ${(sol.distanceKm ?? 0).toFixed(0)}km (${sol.withinNez ? 'NEZ高杀伤区' : `NEZ ${sol.nezRangeKm}km外`}) · 预计TOF ${sol.estimatedTofSec ?? 0}s · 中继:${relay}`
              );
            } else {
              setHoverEngageSummary(null);
            }
          } else {
            setHoverEngageSummary(null);
          }
        }
      } else if (hoveredContactIdRef.current) {
        hoveredContactIdRef.current = null;
        setHoverEngageSummary(null);
        syncStoreToLayers();
      }
    });

    map.on('click', (e) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        return;
      }
      const state = useWargameStore.getState();
      const clickedCoord: [number, number] = [
        Number(e.lngLat.lng.toFixed(4)),
        Number(e.lngLat.lat.toFixed(4)),
      ];

      if (state.interactionMode === 'measure') {
        const current = rulerRef.current;
        if (!current.start || current.end) {
          rulerRef.current = { start: clickedCoord };
          setRulerMeasurement(null);
        } else {
          rulerRef.current = { start: current.start, end: clickedCoord };
          setRulerMeasurement({
            distanceKm: getDistanceKm(current.start, clickedCoord),
            bearingDeg: getBearingDeg(current.start, clickedCoord),
          });
        }
        syncRulerLayer();
        return;
      }

      if (state.interactionMode === 'move_unit' && state.selectedUnitId) {
        state.moveUnitInSandbox(state.selectedUnitId, clickedCoord);
        return;
      }

      // 模式 A: F3 规划航路点（支持单选与多选编组同步标绘）
      if (state.interactionMode === 'plot_waypoint') {
        if (state.selectedUnitIds.length > 1) {
          state.batchAppendUnitWaypoint(state.selectedUnitIds, clickedCoord, false);
          return;
        }
        if (state.selectedUnitId) {
          state.appendUnitWaypoint(state.selectedUnitId, clickedCoord, false);
          return;
        }
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
          const targetId = props.id;
          const doglegs = state.pendingStrikeWaypoints.length > 0 ? state.pendingStrikeWaypoints : undefined;
          if (state.selectedUnitIds.length > 1) {
            state.scheduleTotStrike(state.selectedUnitIds, targetId, state.pendingSalvoCount, doglegs);
          } else {
            state.executeManualEngage(
              state.selectedUnitId,
              targetId,
              state.pendingWeaponIdForEngage || undefined,
              state.pendingSalvoCount,
              false,
              doglegs
            );
          }
          return;
        }

        if (props.entityType === 'unit') {
          if (e.originalEvent.shiftKey) {
            state.toggleUnitSelection(props.id);
          } else {
            state.selectUnit(props.id);
          }
        } else if (props.entityType === 'contact') {
          state.selectContact(props.id);
        }
      } else if (state.interactionMode === 'manual_engage' && state.selectedUnitId) {
        // 点击空白海域/山谷追加导弹绕障转折航点 (Dogleg Waypoint)
        state.appendPendingStrikeWaypoint(clickedCoord);
      }
    });

    // Shift+拖拽 或 框选模式 (box_select) 矩形框选多单元
    const containerEl = mapContainerRef.current;
    let boxStart: { x: number; y: number; additive: boolean } | null = null;
    const cancelBoxSelect = () => {
      if (!boxStart) return;
      boxStart = null;
      map.dragPan.enable();
      setSelectionBox(null);
    };
    const onPointerDown = (ev: MouseEvent) => {
      if (ev.button !== 0) {
        cancelBoxSelect();
        return;
      }
      const mode = useWargameStore.getState().interactionMode;
      if (!ev.shiftKey && mode !== 'box_select') return;
      const rect = containerEl.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      boxStart = { x, y, additive: ev.shiftKey };
      map.dragPan.disable();
      setSelectionBox({ x1: x, y1: y, x2: x, y2: y });
    };
    const onPointerMove = (ev: MouseEvent) => {
      if (!boxStart) return;
      if ((ev.buttons & 1) === 0) {
        cancelBoxSelect();
        return;
      }
      const rect = containerEl.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, ev.clientY - rect.top));
      setSelectionBox({ x1: boxStart.x, y1: boxStart.y, x2: x, y2: y });
    };
    const onBoxKeyCancel = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') cancelBoxSelect();
    };
    const onPointerUp = (ev: MouseEvent) => {
      if (!boxStart) return;
      const start = boxStart;
      boxStart = null;
      map.dragPan.enable();
      setSelectionBox(null);
      const rect = containerEl.getBoundingClientRect();
      const endX = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
      const endY = Math.max(0, Math.min(rect.height, ev.clientY - rect.top));
      if (Math.hypot(endX - start.x, endY - start.y) < 6) return;

      suppressNextClickRef.current = true;
      const minX = Math.min(start.x, endX);
      const maxX = Math.max(start.x, endX);
      const minY = Math.min(start.y, endY);
      const maxY = Math.max(start.y, endY);
      const sw = map.unproject([minX, maxY]);
      const ne = map.unproject([maxX, minY]);
      const minLng = Math.min(sw.lng, ne.lng);
      const maxLng = Math.max(sw.lng, ne.lng);
      const minLat = Math.min(sw.lat, ne.lat);
      const maxLat = Math.max(sw.lat, ne.lat);

      const s = useWargameStore.getState();
      const matched = Object.values(s.units)
        .filter(
          (u) =>
            u.hp > 0 &&
            u.status !== 'destroyed' &&
            u.status !== 'recovered' &&
            (s.playMode === 'sandbox' || u.side === s.playerSide) &&
            u.position[0] >= minLng &&
            u.position[0] <= maxLng &&
            u.position[1] >= minLat &&
            u.position[1] <= maxLat
        )
        .map((u) => u.id);
      s.selectMultipleUnits(matched, start.additive);
    };
    containerEl.addEventListener('mousedown', onPointerDown);
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);
    window.addEventListener('blur', cancelBoxSelect);
    window.addEventListener('contextmenu', cancelBoxSelect);
    window.addEventListener('keydown', onBoxKeyCancel);

    // 右键快速结束航线规划模式
    map.on('contextmenu', (e) => {
      e.preventDefault();
      cancelBoxSelect();
      const state = useWargameStore.getState();
      if (state.interactionMode !== 'select') {
        state.setInteractionMode('select');
      }
    });

    // 绑定 Zustand Store 瞬态更新订阅（使用 shallow 比较阻断无关 UI 弹窗/日志触发全量 GeoJSON 重算）
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
        selectedUnitIds: s.selectedUnitIds,
        selectedContactId: s.selectedContactId,
        pendingWeaponIdForEngage: s.pendingWeaponIdForEngage,
        pendingStrikeWaypoints: s.pendingStrikeWaypoints,
        interactionMode: s.interactionMode,
        mapLayers: s.mapLayers,
        environment: s.environment,
        objectives: s.objectives,
        catalog: s.catalog,
      }),
      () => {
        syncStoreToLayers();
      },
      { equalityFn: shallow }
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
    if (initialBasemapMode !== 'offline') {
      void basemapLoader.select(initialBasemapMode);
    }
    const unsubscribeTerrain3d = useWargameStore.subscribe(
      (s) => Boolean(s.mapLayers.show3dTerrain),
      (enabled) => {
        if (!mapRef.current) return;
        if (mapRef.current.getLayer('terrain-extrusion-layer')) {
          mapRef.current.setLayoutProperty('terrain-extrusion-layer', 'visibility', enabled ? 'visible' : 'none');
        }
        if (enabled && mapRef.current.getPitch() < 20) {
          mapRef.current.easeTo({ pitch: 45, duration: 450 });
        } else if (!enabled && mapRef.current.getPitch() > 0) {
          mapRef.current.easeTo({ pitch: 0, bearing: 0, duration: 400 });
        }
      }
    );

    // Panel toggles and the log dock resize the canvas without a window resize.
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(mapContainerRef.current);

    return () => {
      if (cursorRafRef.current !== null) {
        window.cancelAnimationFrame(cursorRafRef.current);
        cursorRafRef.current = null;
      }
      cancelBoxSelect();
      containerEl.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('mousemove', onPointerMove);
      window.removeEventListener('mouseup', onPointerUp);
      window.removeEventListener('blur', cancelBoxSelect);
      window.removeEventListener('contextmenu', cancelBoxSelect);
      window.removeEventListener('keydown', onBoxKeyCancel);
      resizeObserver.disconnect();
      unsubscribeData();
      unsubscribeCamera();
      unsubscribeBasemap();
      unsubscribeTerrain3d();
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
      {selectionBox && (
        <div
          className="pointer-events-none absolute z-30 border border-cyan-400 bg-cyan-400/15 rounded-xs shadow-lg"
          style={{
            left: Math.min(selectionBox.x1, selectionBox.x2),
            top: Math.min(selectionBox.y1, selectionBox.y2),
            width: Math.abs(selectionBox.x2 - selectionBox.x1),
            height: Math.abs(selectionBox.y2 - selectionBox.y1),
          }}
        />
      )}

      {/* Compact floating map tools: ruler + basemap status badge */}
      <div
        className="basemap-controls tactical-panel"
        style={{
          top: interactionMode === 'select' ? 10 : 56,
          right: rightOpen ? 'clamp(278px, calc(20vw + 18px), 310px)' : 12,
        }}
        aria-label="地图工具"
      >
        <span
          role="status"
          className={`text-[10px] ${basemapState.status === 'error' || basemapState.status === 'degraded' ? 'text-amber-300' : 'text-slate-400'}`}
          title={basemapState.message ?? BASEMAP_PRESETS[basemapMode].label}
        >
          {basemapState.active === 'offline' ? '离线底图' : 'OSM底图'}
        </span>
        <button
          aria-pressed={interactionMode === 'box_select'}
          onClick={() => setInteractionMode(interactionMode === 'box_select' ? 'select' : 'box_select')}
          title="框选多单元（也可按住 Shift 拖拽地图）"
          className={`px-2 py-0.5 rounded border text-[11px] cursor-pointer ${
            interactionMode === 'box_select'
              ? 'bg-cyan-400 text-slate-950 border-cyan-300 font-bold'
              : 'bg-cyan-500/15 border-cyan-500/40 text-cyan-200'
          }`}
        >
          框选{selectedCount > 1 ? ` (${selectedCount})` : ''}
        </button>
        <button
          aria-pressed={interactionMode === 'measure'}
          onClick={() => setInteractionMode(interactionMode === 'measure' ? 'select' : 'measure')}
          className={`px-2 py-0.5 rounded border text-[11px] cursor-pointer ${
            interactionMode === 'measure'
              ? 'bg-yellow-400 text-slate-950 border-yellow-300 font-bold'
              : 'bg-yellow-500/15 border-yellow-500/40 text-yellow-200'
          }`}
        >
          测距尺
        </button>
        {(basemapState.status === 'error' || basemapState.status === 'degraded') && (
          <button type="button" className="text-[10px] text-cyan-300 underline" onClick={() => { void basemapLoaderRef.current?.select(basemapMode, true); }}>
            重试
          </button>
        )}
      </div>

      {/* 顶部模式浮动战术横幅 (当处于 F3 航线标绘 / F1 手动交战 / 算子投放模式时高亮提示) */}
      {interactionMode !== 'select' && (
        <div
          className="absolute top-2.5 z-20 flex items-center gap-3 px-3.5 py-2 rounded-lg bg-zinc-950/95 border border-white/15 shadow-2xl backdrop-blur-xl text-xs text-zinc-100"
          style={{
            left: leftOpen ? 'clamp(248px, calc(18vw + 16px), 278px)' : 52,
            right: rightOpen ? 'clamp(278px, calc(20vw + 18px), 310px)' : 12,
          }}
        >
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          {interactionMode === 'box_select' && (
            <span className="text-cyan-200">
              [多单元框选模式] 在态势图拖拽矩形框选本方多个作战单元进行批量指控 · 也可随时按住 Shift 拖拽
            </span>
          )}
          {interactionMode === 'plot_waypoint' && (
            <span>
              [F3 航路点标绘模式] 点击海图追加机动航路点 ({selectedUnitCallsign}
              ) · 右键或按 ESC 完成
            </span>
          )}
          {interactionMode === 'manual_engage' && (
            <span className="text-rose-200 truncate">
              {hoverEngageSummary
                ? `[F1 火控解算${doglegCount > 0 ? ` · ${doglegCount}个转折点` : ''}] ${hoverEngageSummary}`
                : `[F1 火力分配${selectedCount > 1 ? ` · ${selectedCount}平台TOT同步齐射` : ''}] 点击空白处可添加绕障转折点${doglegCount > 0 ? `(已设${doglegCount}点)` : ''}，点击敌目标发射`}
            </span>
          )}
          {interactionMode === 'manual_engage' && doglegCount > 0 && (
            <button
              onClick={() => clearPendingStrikeWaypoints()}
              className="px-2 py-0.5 rounded bg-rose-500/20 border border-rose-400/40 text-rose-200 cursor-pointer shrink-0 whitespace-nowrap"
            >
              清空转折点 ({doglegCount})
            </button>
          )}
          {interactionMode === 'place_ref_point' && (
            <span className="text-amber-200">
              [参考点标绘模式] 点击海图任意位置部署战术参考点 · 右键取消
            </span>
          )}
          {interactionMode === 'measure' && (
            <span className="text-yellow-200">
              [测距尺] 依次点击起点和终点，显示大圆距离与真方位 · 再次点击开始新测量
            </span>
          )}
          {interactionMode === 'move_unit' && (
            <span className="text-emerald-200">
              [沙盒单位移动] 点击海图目标位置移动 {selectedUnitCallsign} · 海陆边界仍会校验
            </span>
          )}
          {interactionMode === 'spawn_unit' && (
            <span className="text-emerald-200">
              [实时兵力投放模式] 点击海图目标海域/空域立即部署新增作战算子 · 右键取消
            </span>
          )}
          <button
            onClick={() => setInteractionMode('select')}
            className="ml-auto px-2.5 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-white/10 text-zinc-100 cursor-pointer shrink-0 whitespace-nowrap transition-colors"
          >
            退出 [ESC]
          </button>
        </div>
      )}

      {/* 底部居中精简坐标与图例条 */}
      <div className="map-status tactical-panel" style={{ zIndex: 15 }}>
        <span ref={cursorReadoutRef} className="text-cyan-400 font-semibold font-mono">
          26.200°N, 124.200°E
        </span>
        {rulerMeasurement && (
          <span className="text-yellow-200 font-semibold">
            {rulerMeasurement.distanceKm.toFixed(1)} km · {rulerMeasurement.bearingDeg.toFixed(1)}°T
          </span>
        )}
        <div className="map-legend">
          <span><i className="w-2.5 h-0.5 bg-cyan-400 inline-block" /> 雷达</span>
          <span><i className="w-2.5 h-0.5 bg-rose-500 inline-block" /> 射程</span>
          <span><i className="w-2.5 h-0.5 bg-amber-400 inline-block" /> 误差/盲区</span>
          <span><i className="w-2.5 h-0.5 bg-emerald-400 inline-block" /> 声呐/夺控</span>
        </div>
      </div>
    </div>
  );
});
