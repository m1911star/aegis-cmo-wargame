import * as turf from '@turf/turf';
import { canCommandUnit } from '../../engine/commandPolicy';
import { isRouteAllowed } from '../../engine/environment';
import { deriveMissionAssignments } from '../../engine/missions';
import { createRuntimeUnitFromPlacement } from '../../engine/simulationEngine';
import { emitActionFeedback } from '../actionFeedbackBus';
import type {
  CombatLogEntry,
  MissionType,
  OrbatGroup,
  RuntimeScenarioEvent,
  ScenarioObjective,
  SideId,
  TacticalMission,
  UnitDoctrine,
} from '../../types/wargame';
import type {
  AreaEventDraft,
  MissionReferencePointDraft,
  ObjectiveDraft,
  StoreSet,
  WargameStoreState,
} from '../types';

const MISSION_TYPES: readonly MissionType[] = [
  'aaw_patrol', 'asuw_patrol', 'asw_patrol', 'land_strike', 'aew_support', 'escort', 'sead', 'tanker_support',
];

function resolveMissionDraft(
  state: Pick<WargameStoreState, 'referencePoints' | 'units' | 'playerSide' | 'playMode' | 'battleResult'>,
  draft: MissionReferencePointDraft,
  requiredSide?: SideId
): { name: string; type: MissionType; side: SideId; areaPolygon: [number, number][]; prosecuteOutsideAreaKm: number; escortUnitId?: string; stationRadiusKm: number } | undefined {
  const name = typeof draft.name === 'string' ? draft.name.trim() : '';
  if (state.battleResult || !name || name.length > 80 || !MISSION_TYPES.includes(draft.type) ||
      !Number.isFinite(draft.prosecuteOutsideAreaKm) || draft.prosecuteOutsideAreaKm < 0 ||
      draft.prosecuteOutsideAreaKm > 2000 || !Array.isArray(draft.referencePointIds) ||
      draft.referencePointIds.length < 3 || new Set(draft.referencePointIds).size !== draft.referencePointIds.length) return undefined;
  const points = draft.referencePointIds.map((id) => state.referencePoints.find((point) => point.id === id));
  if (points.some((point) => !point)) return undefined;
  const side = points[0]!.side;
  if (side === 'NEUTRAL' || points.some((point) => point!.side !== side) || requiredSide && side !== requiredSide ||
      (state.playMode !== 'sandbox' && side !== state.playerSide)) return undefined;
  const areaPolygon = points.map((point) => [...point!.position] as [number, number]);
  if (new Set(areaPolygon.map(([longitude, latitude]) => `${longitude},${latitude}`)).size !== areaPolygon.length) return undefined;
  const polygon = turf.polygon([[...areaPolygon, areaPolygon[0]]]);
  if (turf.area(polygon) <= 1 || turf.kinks(polygon).features.length > 0) return undefined;
  const stationRadiusKm = draft.stationRadiusKm ?? 20;
  if (!Number.isFinite(stationRadiusKm) || stationRadiusKm < 1 || stationRadiusKm > 500) return undefined;
  const escortTarget = draft.escortUnitId ? state.units[draft.escortUnitId] : undefined;
  if (draft.type === 'escort' && (!escortTarget || escortTarget.side !== side) ||
      draft.type !== 'escort' && draft.escortUnitId) return undefined;
  return {
    name, type: draft.type, side, areaPolygon,
    prosecuteOutsideAreaKm: draft.prosecuteOutsideAreaKm,
    escortUnitId: draft.type === 'escort' ? draft.escortUnitId : undefined,
    stationRadiusKm,
  };
}

export function createMissionAndBuilderSlice(set: StoreSet) {
  return {
    assignUnitMission: (unitId: string, missionId: string | undefined) =>
      set((s) => {
        const unit = s.units[unitId];
        if (!canCommandUnit(s, unit)) return s;
        if (missionId && !s.missions.some((mission) => mission.id === missionId && mission.side === unit.side)) return s;
        const units = { ...s.units, [unitId]: { ...unit, assignedMissionId: missionId,
          navigationMode: missionId ? 'mission' as const : 'manual' as const,
          missionTargetId: undefined, missionState: missionId ? 'ingress' as const : undefined,
          missionRouteIndex: 0, formationLeaderId: undefined, formationOffset: undefined, waypoints: [] } };
        return {
          missions: deriveMissionAssignments(s.missions, units),
          units,
        };
      }),

    createMissionFromReferencePoints: (draft: MissionReferencePointDraft) => set((s) => {
      const resolved = resolveMissionDraft(s, draft);
      if (!resolved) {
        emitActionFeedback('warning', '任务多边形无效：需至少 3 个同阵营非共线/非自交参考点');
        return s;
      }
      const missionId = `mission_${resolved.side.toLowerCase()}_${s.tick}_${s.commandSequence}`;
      if (s.missions.some((mission) => mission.id === missionId)) return s;
      const mission: TacticalMission = {
        id: missionId,
        ...resolved,
        isActive: true,
        assignedUnitIds: [],
        description: `由 ${draft.referencePointIds.length} 个战术参考点创建的玩家任务区。`,
      };
      const log: CombatLogEntry = {
        id: `mission_created_${missionId}`,
        simTime: s.simTime,
        side: resolved.side,
        category: 'DOCTRINE',
        severity: 'info',
        title: `任务已创建：${resolved.name}`,
        message: `${resolved.type} · 区域参考点 ${draft.referencePointIds.length} 个 · 区外追击 ${resolved.prosecuteOutsideAreaKm} km。`,
      };
      return { missions: [...s.missions, mission], logs: [log, ...s.logs].slice(0, 250) };
    }),

    updateMissionFromReferencePoints: (missionId: string, draft: MissionReferencePointDraft) => set((s) => {
      const mission = s.missions.find((candidate) => candidate.id === missionId);
      if (!mission || (s.playMode !== 'sandbox' && mission.side !== s.playerSide)) return s;
      const resolved = resolveMissionDraft(s, draft, mission.side);
      if (!resolved) {
        emitActionFeedback('warning', '任务更新失败：多边形或参数无效');
        return s;
      }
      const missions = s.missions.map((candidate) => candidate.id === missionId
        ? { ...candidate, ...resolved, areaPolygon: resolved.areaPolygon.map((point) => [...point] as [number, number]) }
        : candidate);
      const log: CombatLogEntry = {
        id: `mission_updated_${missionId}_${s.tick}_${s.commandSequence}`,
        simTime: s.simTime,
        side: mission.side,
        category: 'DOCTRINE',
        severity: 'info',
        title: `任务已更新：${resolved.name}`,
        message: `${resolved.type} · 区域参考点 ${draft.referencePointIds.length} 个 · 区外追击 ${resolved.prosecuteOutsideAreaKm} km。`,
      };
      return { missions, logs: [log, ...s.logs].slice(0, 250) };
    }),

    updateMissionDoctrine: (missionId: string, override: Partial<UnitDoctrine>) => set((s) => {
      const mission = s.missions.find((candidate) => candidate.id === missionId);
      if (s.battleResult || !mission || (s.playMode !== 'sandbox' && mission.side !== s.playerSide)) return s;
      if (override.roe !== undefined && !['free', 'tight', 'hold'].includes(override.roe)) return s;
      if (override.salvoSize !== undefined && (!Number.isSafeInteger(override.salvoSize) || override.salvoSize < 1)) return s;
      const nextOverride: Partial<UnitDoctrine> = {
        ...(mission.doctrineOverride ?? {}),
        ...override,
      };
      const missions = s.missions.map((candidate) =>
        candidate.id === missionId ? { ...candidate, doctrineOverride: nextOverride } : candidate
      );
      const log: CombatLogEntry = {
        id: `mission_doctrine_${missionId}_${s.tick}_${s.commandSequence}`,
        simTime: s.simTime,
        side: mission.side,
        category: 'DOCTRINE',
        severity: 'info',
        title: `任务条令更新：${mission.name}`,
        message: `ROE=${(nextOverride.roe ?? '继承单位').toUpperCase()} · 识别后开火=${nextOverride.requireIdentifiedForAutoFire ? '是' : '否'}`,
      };
      return { missions, logs: [log, ...s.logs].slice(0, 250) };
    }),

    deleteMission: (missionId: string) => set((s) => {
      const mission = s.missions.find((candidate) => candidate.id === missionId);
      if (s.battleResult || !mission || (s.playMode !== 'sandbox' && mission.side !== s.playerSide)) return s;
      const units = Object.fromEntries(Object.entries(s.units).map(([id, unit]) => [id,
        unit.assignedMissionId === missionId
          ? { ...unit, assignedMissionId: undefined, navigationMode: 'manual' as const,
            missionTargetId: undefined, missionState: undefined, missionRouteIndex: 0, waypoints: [] }
          : unit,
      ]));
      const missions = deriveMissionAssignments(s.missions.filter((candidate) => candidate.id !== missionId), units);
      const log: CombatLogEntry = {
        id: `mission_deleted_${missionId}_${s.tick}_${s.commandSequence}`,
        simTime: s.simTime,
        side: mission.side,
        category: 'DOCTRINE',
        severity: 'warning',
        title: `任务已删除：${mission.name}`,
        message: '原配属算子已解除任务并切换为手动导航。',
      };
      return { units, missions, logs: [log, ...s.logs].slice(0, 250) };
    }),

    toggleMissionActive: (missionId: string) => set((s) => {
      const mission = s.missions.find((m) => m.id === missionId);
      if (s.battleResult || !mission || (s.playMode !== 'sandbox' && mission.side !== s.playerSide)) return s;
      return { missions: s.missions.map((m) => m.id === missionId &&
        (s.playMode === 'sandbox' || m.side === s.playerSide) ? { ...m, isActive: !m.isActive } : m) };
    }),

    moveUnitInSandbox: (unitId: string, coord: [number, number]) => set((s) => {
      const unit = s.units[unitId];
      if (s.playMode !== 'sandbox' || s.battleResult || !unit || !Array.isArray(coord) || coord.length !== 2 ||
          !Number.isFinite(coord[0]) || Math.abs(coord[0]) > 180 || !Number.isFinite(coord[1]) || Math.abs(coord[1]) > 90 ||
          !isRouteAllowed(unit.domain, unit.position, coord, s.environment)) return s;
      return { units: { ...s.units, [unitId]: { ...unit, position: [...coord], waypoints: [] } }, interactionMode: 'select' };
    }),

    updateScenarioGroup: (groupId: string, patch: Pick<OrbatGroup, 'name' | 'commandTitle' | 'description'>) => set((s) => {
      const group = s.groups.find((candidate) => candidate.id === groupId);
      const name = patch.name?.trim();
      const commandTitle = patch.commandTitle?.trim();
      const description = patch.description?.trim();
      if (s.playMode !== 'sandbox' || !group || !name || !commandTitle || !description ||
          name.length > 100 || commandTitle.length > 100 || description.length > 500) return s;
      return { groups: s.groups.map((candidate) => candidate.id === groupId
        ? { ...candidate, name, commandTitle, description } : candidate) };
    }),

    assignUnitGroup: (unitId: string, groupId: string) => set((s) => {
      const unit = s.units[unitId];
      const group = s.groups.find((candidate) => candidate.id === groupId);
      if (s.playMode !== 'sandbox' || !unit || !group || unit.side !== group.side || unit.parentGroupId === groupId) return s;
      return { units: { ...s.units, [unitId]: { ...unit, parentGroupId: groupId,
        formationLeaderId: undefined, formationOffset: undefined,
        navigationMode: unit.navigationMode === 'formation' ? unit.assignedMissionId ? 'mission' : 'manual' : unit.navigationMode } } };
    }),

    upsertObjective: (draft: ObjectiveDraft) => set((s) => {
      const title = draft.title?.trim();
      const id = draft.id ?? `objective_${s.tick}_${s.commandSequence}`;
      const allowedTypes: ScenarioObjective['type'][] = ['destroy', 'disable', 'preserve', 'observe', 'withdraw', 'control_area'];
      if (s.playMode !== 'sandbox' || !title || title.length > 120 || !['RED', 'BLUE'].includes(draft.side) ||
          !allowedTypes.includes(draft.type) || !Array.isArray(draft.unitIds) ||
          new Set(draft.unitIds).size !== draft.unitIds.length || draft.unitIds.some((unitId) => !s.units[unitId]) ||
          !Number.isSafeInteger(draft.points) || draft.points < 0 ||
          draft.criticalFailure && draft.type !== 'preserve' || draft.preserveCapability && draft.type !== 'preserve') return s;
      if (draft.type === 'control_area') {
        if (!draft.areaPolygon || draft.areaPolygon.length < 3) return s;
        const poly = turf.polygon([[...draft.areaPolygon, draft.areaPolygon[0]]]);
        if (turf.area(poly) <= 1 || turf.kinks(poly).features.length > 0) return s;
      } else if (draft.unitIds.length === 0) {
        return s;
      }
      if (draft.holdDurationSec !== undefined && (draft.type !== 'control_area' || !Number.isFinite(draft.holdDurationSec) || draft.holdDurationSec < 1)) {
        return s;
      }
      const objective: ScenarioObjective = { id, title, side: draft.side, type: draft.type,
        unitIds: [...draft.unitIds],
        areaPolygon: draft.areaPolygon ? draft.areaPolygon.map((pt) => [...pt] as [number, number]) : undefined,
        controlDomains: draft.controlDomains ? [...draft.controlDomains] : undefined,
        holdDurationSec: draft.holdDurationSec,
        required: draft.required, points: draft.points,
        criticalFailure: draft.criticalFailure, preserveCapability: draft.preserveCapability };
      const exists = s.objectives.some((candidate) => candidate.id === id);
      const objectiveProgress = { ...s.objectiveProgress }; delete objectiveProgress[id];
      return { objectives: exists ? s.objectives.map((candidate) => candidate.id === id ? objective : candidate)
        : [...s.objectives, objective], objectiveProgress };
    }),

    deleteObjective: (objectiveId: string) => set((s) => {
      if (s.playMode !== 'sandbox' || !s.objectives.some((objective) => objective.id === objectiveId)) return s;
      const objectiveProgress = { ...s.objectiveProgress }; delete objectiveProgress[objectiveId];
      return { objectives: s.objectives.filter((objective) => objective.id !== objectiveId), objectiveProgress };
    }),

    createAreaEventFromReferencePoints: (draft: AreaEventDraft) => set((s) => {
      if (s.playMode !== 'sandbox' || !draft.message?.trim()) return s;
      const resolved = resolveMissionDraft(s, {
        name: draft.name,
        type: 'aaw_patrol',
        referencePointIds: draft.referencePointIds,
        prosecuteOutsideAreaKm: 0,
      });
      if (!resolved || resolved.side !== draft.side) return s;
      const id = `event_area_${s.tick}_${s.commandSequence}`;
      const event: RuntimeScenarioEvent = {
        id, name: resolved.name, description: '由战术参考点创建的区域进入触发器。',
        trigger: { type: 'UNIT_ENTERS_AREA', side: draft.side, unitCategory: draft.unitCategory,
          areaPolygon: resolved.areaPolygon.map((point) => [...point] as [number, number]) },
        actions: [{ type: 'BROADCAST_MESSAGE', side: draft.side, severity: 'warning',
          title: resolved.name, message: draft.message.trim() }],
        hasFired: false, fireCount: 0, matchedUnitIds: [],
      };
      return { events: [...s.events, event] };
    }),

    deleteScenarioEvent: (eventId: string) => set((s) => {
      if (s.playMode !== 'sandbox' || !s.events.some((event) => event.id === eventId)) return s;
      return { events: s.events.filter((event) => event.id !== eventId),
        score: { ...s.score, firedEventIds: s.score.firedEventIds.filter((id) => id !== eventId) } };
    }),

    spawnUnitAtCoordinate: (coord: [number, number]) =>
      set((s) => {
        const cfg = s.pendingSpawnConfig;
        if (!cfg || s.playMode !== 'sandbox' || s.battleResult) return { interactionMode: 'select' };
        const spec = s.catalog.platforms[cfg.platformId];
        if (!spec) return { interactionMode: 'select' };

        const newId = `unit_spawn_${s.tick}_${s.commandSequence}`;
        const defaultGroup =
          s.currentScenario.groups.find((g) => g.side === cfg.side)?.id ||
          'custom_group';

        const newUnit = createRuntimeUnitFromPlacement(
          {
            id: newId,
            name: cfg.name || spec.name,
            callsign:
              cfg.callsign ||
              `${cfg.side}-${s.commandSequence + 100}`,
            side: cfg.side,
            platformId: spec.id,
            loadoutId: cfg.loadoutId || spec.defaultLoadoutId,
            parentGroupId: defaultGroup,
            position: [...coord],
            heading: cfg.side === 'RED' ? 95 : 275,
          },
          s.catalog
        );

        const spawnLog: CombatLogEntry = {
          id: `log_spawn_${s.tick}_${s.commandSequence}`,
          simTime: s.simTime,
          side: cfg.side,
          category: 'SYSTEM',
          severity: 'info',
          title: `战场实时增援算子已投放: ${newUnit.name}`,
          message: `已在坐标 [${coord[0].toFixed(2)}°E, ${coord[1].toFixed(
            2
          )}°N] 实时部署 ${spec.className} (${newUnit.callsign})。`,
          position: [...coord],
          unitId: newId,
        };

        return {
          units: {
            ...s.units,
            [newId]: newUnit,
          },
          selectedUnitId: newId,
          interactionMode: 'select',
          pendingSpawnConfig: null,
          logs: [spawnLog, ...s.logs].slice(0, 250),
        };
      }),
  };
}
