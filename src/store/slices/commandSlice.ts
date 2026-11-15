import { resolveUnitConfiguration } from '../../db/unitConfiguration';
import { deployCarriedUnitFromLauncher, launchCarrierSortie } from '../../engine/carrierOperations';
import { canCommandUnit, contactForUnit } from '../../engine/commandPolicy';
import { findShootAndScootDestination, isRouteAllowed } from '../../engine/environment';
import { evaluateFireControl } from '../../engine/fireControl';
import { launchGuidance } from '../../engine/guidance';
import { effectiveDoctrine } from '../../engine/operations';
import { createRuntimeUnitFromPlacement, getBearingDeg } from '../../engine/simulationEngine';
import { getUnitCapabilities } from '../../engine/unitCapabilities';
import { createRuntimeWeaponMounts, recordWeaponLaunch } from '../../engine/unitConfiguration';
import { emitActionFeedback } from '../actionFeedbackBus';
import type {
  CombatLogEntry,
  Domain,
  RouteLeg,
  RuntimeUnit,
  ScenarioEnvironment,
  SideId,
  ThreatLevel,
  UnitDoctrine,
} from '../../types/wargame';
import type { StoreSet, WargameStoreState } from '../types';

const TARGET_DOMAINS: readonly Domain[] = ['air', 'surface', 'subsurface', 'land'];
const THREAT_LEVELS: readonly ThreatLevel[] = ['low', 'medium', 'high', 'critical'];

function routeLegsAllowed(unit: RuntimeUnit, waypoints: RouteLeg[], environment: ScenarioEnvironment): boolean {
  let from = unit.position;
  for (const waypoint of waypoints) {
    if (!isRouteAllowed(unit.domain, from, waypoint.position, environment)) return false;
    from = waypoint.position;
  }
  return true;
}

export function createCommandSlice(set: StoreSet) {
  return {
    appendUnitWaypoint: (
      unitId: string,
      coord: [number, number],
      replaceAll = false,
      speedKts?: number,
      altitudeM?: number
    ) =>
      set((s) => {
        const unit = s.units[unitId];
        if (!canCommandUnit(s, unit) || !Array.isArray(coord) || coord.length !== 2 ||
            !Number.isFinite(coord[0]) || Math.abs(coord[0]) > 180 ||
            !Number.isFinite(coord[1]) || Math.abs(coord[1]) > 90) return s;
        const configuration = resolveUnitConfiguration(s.catalog, unit.platformId, unit.activeLoadoutId);
        if (speedKts !== undefined && (!Number.isFinite(speedKts) || speedKts < 0 || speedKts > configuration.maxSpeedKts) ||
            altitudeM !== undefined && (!Number.isFinite(altitudeM) || altitudeM < configuration.platform.minAltitudeM ||
              altitudeM > configuration.platform.maxAltitudeM)) return s;
        const leg: RouteLeg = { position: [...coord], speedKts, altitudeM };
        const nextWaypoints = replaceAll ? [leg] : [...unit.waypoints, leg];
        if (!routeLegsAllowed(unit, nextWaypoints, s.environment)) {
          emitActionFeedback('warning', `${unit.callsign} 航路被海陆地形边界阻挡，未添加航点`);
          return s;
        }
        const nextHeading = nextWaypoints.length > 0
          ? getBearingDeg(unit.position, nextWaypoints[0].position) : unit.heading;
        const nextSpeed = unit.speedKts < 1 && configuration.maxSpeedKts > 0
          ? configuration.cruiseSpeedKts : unit.speedKts;

        const newLog: CombatLogEntry = {
          id: `log_wp_${s.tick}_${s.commandSequence}_${unitId}`,
          simTime: s.simTime,
          side: unit.side,
          category: 'DOCTRINE',
          severity: 'info',
          title: `${unit.callsign} 机动航路点已更新`,
          message: `${unit.name} 设定新航向 ${Math.round(nextHeading)}°，共 ${nextWaypoints.length} 个规划航段` +
            `${speedKts !== undefined ? ` · ${speedKts}kt` : ''}${altitudeM !== undefined ? ` · ${altitudeM}m` : ''}。`,
          position: [...coord],
          unitId,
        };

        return {
          units: {
            ...s.units,
            [unitId]: {
              ...unit,
              waypoints: nextWaypoints,
              navigationMode: 'manual', missionTargetId: undefined,
              formationLeaderId: undefined, formationOffset: undefined,
              heading: nextHeading,
              speedKts: nextSpeed,
              targetSpeedKts: Math.max(unit.targetSpeedKts, nextSpeed),
            },
          },
          logs: [newLog, ...s.logs].slice(0, 250),
        };
      }),

    updateUnitWaypoint: (unitId: string, index: number, patch: Partial<RouteLeg>) => set((s) => {
      const unit = s.units[unitId];
      if (!canCommandUnit(s, unit) || !Number.isSafeInteger(index) || index < 0 || index >= unit.waypoints.length) return s;
      const configuration = resolveUnitConfiguration(s.catalog, unit.platformId, unit.activeLoadoutId);
      const current = unit.waypoints[index];
      const position = patch.position ?? current.position;
      const speedKts = patch.speedKts ?? current.speedKts;
      const altitudeM = patch.altitudeM ?? current.altitudeM;
      if (!Array.isArray(position) || position.length !== 2 || !Number.isFinite(position[0]) || Math.abs(position[0]) > 180 ||
          !Number.isFinite(position[1]) || Math.abs(position[1]) > 90 ||
          speedKts !== undefined && (!Number.isFinite(speedKts) || speedKts < 0 || speedKts > configuration.maxSpeedKts) ||
          altitudeM !== undefined && (!Number.isFinite(altitudeM) || altitudeM < configuration.platform.minAltitudeM ||
            altitudeM > configuration.platform.maxAltitudeM)) return s;
      const waypoints = unit.waypoints.map((waypoint, waypointIndex) => waypointIndex === index
        ? { position: [...position] as [number, number], speedKts, altitudeM }
        : waypoint);
      if (!routeLegsAllowed(unit, waypoints, s.environment)) return s;
      return { units: { ...s.units, [unitId]: { ...unit, waypoints } } };
    }),

    removeUnitWaypoint: (unitId: string, index: number) => set((s) => {
      const unit = s.units[unitId];
      if (!canCommandUnit(s, unit) || !Number.isSafeInteger(index) || index < 0 || index >= unit.waypoints.length) return s;
      return { units: { ...s.units, [unitId]: { ...unit,
        waypoints: unit.waypoints.filter((_, waypointIndex) => waypointIndex !== index) } } };
    }),

    clearUnitWaypoints: (unitId: string) =>
      set((s) => {
        const unit = s.units[unitId];
        if (!canCommandUnit(s, unit)) return s;
        return {
          units: {
            ...s.units,
            [unitId]: { ...unit, waypoints: [], navigationMode: 'manual', missionTargetId: undefined,
              formationLeaderId: undefined, formationOffset: undefined },
          },
        };
      }),

    batchAppendUnitWaypoint: (
      unitIds: string[],
      coord: [number, number],
      replaceAll = false
    ) =>
      set((s) => {
        if (!Array.isArray(unitIds) || unitIds.length === 0 || !Array.isArray(coord) || coord.length !== 2 ||
            !Number.isFinite(coord[0]) || Math.abs(coord[0]) > 180 ||
            !Number.isFinite(coord[1]) || Math.abs(coord[1]) > 90) return s;
        const uniqueSorted = [...new Set(unitIds)].sort((a, b) => a.localeCompare(b));
        const nextUnits = { ...s.units };
        let appliedCount = 0;
        let skippedCount = 0;
        let logSide: SideId = s.playerSide;

        for (const id of uniqueSorted) {
          const unit = s.units[id];
          if (!canCommandUnit(s, unit)) continue;
          const configuration = resolveUnitConfiguration(s.catalog, unit.platformId, unit.activeLoadoutId);
          const leg: RouteLeg = { position: [...coord] };
          const nextWaypoints = replaceAll ? [leg] : [...unit.waypoints, leg];
          if (!routeLegsAllowed(unit, nextWaypoints, s.environment)) {
            skippedCount += 1;
            continue;
          }
          const nextHeading = nextWaypoints.length > 0
            ? getBearingDeg(unit.position, nextWaypoints[0].position) : unit.heading;
          const nextSpeed = unit.speedKts < 1 && configuration.maxSpeedKts > 0
            ? configuration.cruiseSpeedKts : unit.speedKts;
          nextUnits[id] = {
            ...unit,
            waypoints: nextWaypoints,
            navigationMode: 'manual',
            missionTargetId: undefined,
            formationLeaderId: undefined,
            formationOffset: undefined,
            heading: nextHeading,
            speedKts: nextSpeed,
            targetSpeedKts: Math.max(unit.targetSpeedKts, nextSpeed),
          };
          logSide = unit.side;
          appliedCount += 1;
        }

        if (appliedCount === 0) {
          if (skippedCount > 0) {
            emitActionFeedback('warning', '所选编组航路均被海陆边界阻挡，未更新航点');
          }
          return s;
        }
        if (skippedCount > 0) {
          emitActionFeedback('info', `已为 ${appliedCount} 个单元标绘航点（${skippedCount} 个因海陆域不匹配跳过）`);
        }
        const batchLog: CombatLogEntry = {
          id: `log_batch_wp_${s.tick}_${s.commandSequence}`,
          simTime: s.simTime,
          side: logSide,
          category: 'DOCTRINE',
          severity: 'info',
          title: `[编组批量机动] ${appliedCount} 个单元同步更新航路点`,
          message: `目标坐标 [${coord[0].toFixed(2)}°E, ${coord[1].toFixed(2)}°N]${skippedCount > 0 ? `（跳过 ${skippedCount} 个跨域受阻单元）` : ''}。`,
          position: [...coord],
        };
        return {
          units: nextUnits,
          logs: [batchLog, ...s.logs].slice(0, 250),
        };
      }),

    batchClearUnitWaypoints: (unitIds: string[]) =>
      set((s) => {
        if (!Array.isArray(unitIds) || unitIds.length === 0) return s;
        const uniqueSorted = [...new Set(unitIds)].sort((a, b) => a.localeCompare(b));
        const nextUnits = { ...s.units };
        let changed = false;
        for (const id of uniqueSorted) {
          const unit = s.units[id];
          if (!canCommandUnit(s, unit)) continue;
          nextUnits[id] = {
            ...unit,
            waypoints: [],
            navigationMode: 'manual',
            missionTargetId: undefined,
            formationLeaderId: undefined,
            formationOffset: undefined,
          };
          changed = true;
        }
        return changed ? { units: nextUnits } : s;
      }),

    setGroupFormation: (groupId: string, leaderUnitId?: string, spacingKm = 10) => set((s) => {
      if (s.battleResult || !Number.isFinite(spacingKm) || spacingKm < 1 || spacingKm > 100) return s;
      const members = Object.values(s.units).filter((unit) => unit.parentGroupId === groupId &&
        unit.hp > 0 && unit.status !== 'destroyed' && unit.status !== 'recovered').sort((a, b) => a.id.localeCompare(b.id));
      if (members.length === 0 || (s.playMode !== 'sandbox' && members.some((unit) => unit.side !== s.playerSide))) return s;
      if (!leaderUnitId) {
        if (!members.some((unit) => unit.navigationMode === 'formation' || unit.formationLeaderId)) return s;
        const units = { ...s.units };
        for (const member of members) units[member.id] = {
          ...member,
          navigationMode: member.assignedMissionId ? 'mission' : 'manual',
          formationLeaderId: undefined,
          formationOffset: undefined,
          waypoints: [],
        };
        return { units };
      }
      const leader = members.find((member) => member.id === leaderUnitId);
      if (!leader || !canCommandUnit(s, leader) || members.length < 2) return s;
      const units = { ...s.units, [leader.id]: {
        ...leader,
        navigationMode: leader.navigationMode === 'formation'
          ? leader.assignedMissionId ? 'mission' as const : 'manual' as const
          : leader.navigationMode,
        formationLeaderId: undefined,
        formationOffset: undefined,
      } };
      members.filter((member) => member.id !== leader.id).forEach((member, index) => {
        const rank = Math.floor(index / 2) + 1;
        units[member.id] = {
          ...member,
          navigationMode: 'formation',
          formationLeaderId: leader.id,
          formationOffset: {
            relativeBearingDeg: index % 2 === 0 ? 150 : 210,
            distanceKm: spacingKm * rank,
          },
          waypoints: [],
          missionTargetId: undefined,
        };
      });
      const log: CombatLogEntry = {
        id: `formation_${groupId}_${s.tick}_${s.commandSequence}`,
        simTime: s.simTime,
        side: leader.side,
        category: 'DOCTRINE',
        severity: 'info',
        title: `编队领航：${leader.callsign}`,
        message: `${members.length} 个单位按 ${spacingKm} km 间隔同步跟进；返航优先于编队。`,
        unitId: leader.id,
      };
      return { units, logs: [log, ...s.logs].slice(0, 250) };
    }),

    requestAirRefuel: (receiverUnitId: string, tankerUnitId: string) => set((s) => {
      const receiver = s.units[receiverUnitId];
      const tanker = s.units[tankerUnitId];
      const tankerSpec = tanker ? s.catalog.platforms[tanker.platformId] : undefined;
      const receiverSpec = receiver ? s.catalog.platforms[receiver.platformId] : undefined;
      if (!canCommandUnit(s, receiver) || !tanker || getUnitCapabilities(tanker).speedFactor <= 0 ||
          tanker.domain !== 'air' || tanker.category !== 'tanker' || tanker.side !== receiver.side || receiver.domain !== 'air' || receiver.category === 'tanker' ||
          receiverSpec?.canReceiveAar === false || !tankerSpec?.aarFuelCapacitySec ||
          !tankerSpec.aarTransferRateSecPerSec || tanker.aarFuelRemainingSec <= 0 || receiver.airRefuelState ||
          tanker.aarQueue.includes(receiver.id) || receiver.fuelRemainingSec >= receiver.maxFuelSec) {
        emitActionFeedback('warning', '当前无法请求空中加油（需本方受油机且油箱未满、加油机有余油）');
        return s;
      }
      const receiverClone: RuntimeUnit = {
        ...receiver,
        navigationMode: 'manual',
        missionTargetId: undefined,
        waypoints: [{ position: [...tanker.position], speedKts: tanker.targetSpeedKts, altitudeM: tanker.targetAltitudeM }],
        airRefuelState: {
          tankerId: tanker.id,
          phase: 'rendezvous',
          resumeNavigationMode: receiver.navigationMode,
          resumeWaypoints: receiver.waypoints.map((waypoint) => ({
            ...waypoint, position: [...waypoint.position] as [number, number],
          })),
          resumeMissionTargetId: receiver.missionTargetId,
          resumeMissionState: receiver.missionState,
        },
      };
      const tankerClone = { ...tanker, aarQueue: [...tanker.aarQueue, receiver.id] };
      const log: CombatLogEntry = {
        id: `aar_request_${s.tick}_${s.commandSequence}_${receiver.id}`,
        simTime: s.simTime,
        side: receiver.side,
        category: 'DOCTRINE',
        severity: 'info',
        title: `${receiver.callsign} 请求空中加油`,
        message: `已加入 ${tanker.callsign} 队列第 ${tankerClone.aarQueue.length} 位。`,
        unitId: receiver.id,
      };
      return { units: { ...s.units, [receiver.id]: receiverClone, [tanker.id]: tankerClone },
        logs: [log, ...s.logs].slice(0, 250) };
    }),

    deployCarriedPlatform: (launcherUnitId: string, platformId: string) => set((s) => {
      const launcher = s.units[launcherUnitId];
      if (!canCommandUnit(s, launcher)) return s;
      const outcome = deployCarriedUnitFromLauncher(
        s.units,
        launcher,
        platformId,
        s.catalog,
        s.environment,
        s.simTime,
        `${s.tick}_${s.commandSequence}`,
        s.commandSequence + 1
      );
      if (!outcome.deployed) {
        if (outcome.errorReason) emitActionFeedback('warning', outcome.errorReason);
        return s;
      }
      const remaining = launcher.deployableInventory[platformId] ?? 1;
      const launcherClone = {
        ...launcher,
        deployableInventory: {
          ...launcher.deployableInventory,
          [platformId]: Math.max(0, remaining - 1),
        },
      };
      return {
        units: { ...s.units, [launcher.id]: launcherClone, [outcome.deployed.id]: outcome.deployed },
        selectedUnitId: outcome.deployed.id,
        logs: outcome.log ? [outcome.log, ...s.logs].slice(0, 250) : s.logs,
      };
    }),

    deployCountermeasure: (unitId: string, kind: 'chaff' | 'flares' | 'acousticDecoys') => set((s) => {
      const unit = s.units[unitId];
      if (!canCommandUnit(s, unit)) return s;
      const available = unit.countermeasures[kind] ?? 0;
      if (available <= 0) {
        emitActionFeedback('warning', `${unit.callsign} 所选软杀伤诱饵库存已耗尽`);
        return s;
      }
      if (unit.countermeasures.cooldownUntil > s.simTime) {
        emitActionFeedback('warning', `${unit.callsign} 诱饵投放冷却中`);
        return s;
      }
      const nextCountermeasures = {
        ...unit.countermeasures,
        [kind]: available - 1,
        cooldownUntil: s.simTime + 30000,
      };
      const prevEffect = unit.countermeasureEffect && unit.countermeasureEffect.expiresAtSimTime > s.simTime
        ? unit.countermeasureEffect
        : { chaff: false, flares: false, acoustic: false, expiresAtSimTime: s.simTime };
      const countermeasureEffect = {
        chaff: prevEffect.chaff || kind === 'chaff',
        flares: prevEffect.flares || kind === 'flares',
        acoustic: prevEffect.acoustic || kind === 'acousticDecoys',
        expiresAtSimTime: s.simTime + 20000,
      };
      const label = kind === 'chaff' ? '箔条干扰' : kind === 'flares' ? '红外诱饵弹' : '水声声诱饵';
      const log: CombatLogEntry = {
        id: `cm_manual_${s.tick}_${s.commandSequence}_${unit.id}`,
        simTime: s.simTime,
        side: unit.side,
        category: 'DOCTRINE',
        severity: 'info',
        title: `${unit.callsign} 手动投放${label}`,
        message: `持续有效 20 秒，剩余库存 ${available - 1}。`,
        position: [...unit.position],
        unitId: unit.id,
      };
      emitActionFeedback('info', `${unit.callsign} 已投放${label}`);
      return {
        units: {
          ...s.units,
          [unit.id]: { ...unit, countermeasures: nextCountermeasures, countermeasureEffect },
        },
        logs: [log, ...s.logs].slice(0, 250),
      };
    }),

    cancelUnitReturn: (unitId: string) => set((s) => {
      const unit = s.units[unitId];
      if (!canCommandUnit(s, unit) || unit.status !== 'returning') return s;
      if (unit.fuelRemainingSec <= 0) {
        emitActionFeedback('warning', `${unit.callsign} 燃油已耗尽，无法取消返航`);
        return s;
      }
      const log: CombatLogEntry = {
        id: `cancel_rtb_${s.tick}_${s.commandSequence}_${unit.id}`,
        simTime: s.simTime,
        side: unit.side,
        category: 'DOCTRINE',
        severity: 'warning',
        title: `${unit.callsign} 人工取消返航指令`,
        message: '算子已恢复手动控制，请注意剩余燃油与弹药风险。',
        position: [...unit.position],
        unitId: unit.id,
      };
      emitActionFeedback('info', `${unit.callsign} 已取消返航，恢复人工接管`);
      return {
        units: {
          ...s.units,
          [unit.id]: {
            ...unit,
            status: 'operational',
            returnReason: undefined,
            navigationMode: 'manual',
            missionState: undefined,
          },
        },
        logs: [log, ...s.logs].slice(0, 250),
      };
    }),

    updateUnitDoctrine: (unitId: string, patch: Partial<UnitDoctrine>) =>
      set((s) => {
        const unit = s.units[unitId];
        if (!canCommandUnit(s, unit)) return s;
        if (patch.salvoSize !== undefined && (!Number.isSafeInteger(patch.salvoSize) || patch.salvoSize < 1) ||
            patch.automaticFireRangeFraction !== undefined && (!Number.isFinite(patch.automaticFireRangeFraction) ||
              patch.automaticFireRangeFraction < 0.05 || patch.automaticFireRangeFraction > 1) ||
            patch.minimumWeaponReserve !== undefined && (!Number.isSafeInteger(patch.minimumWeaponReserve) || patch.minimumWeaponReserve < 0) ||
            patch.minimumAutomaticThreat !== undefined && !THREAT_LEVELS.includes(patch.minimumAutomaticThreat) ||
            patch.bvrTactics !== undefined && !['standard', 'crank_pump'].includes(patch.bvrTactics) ||
            patch.baffleClearPeriodic !== undefined && typeof patch.baffleClearPeriodic !== 'boolean' ||
            patch.automaticTargetDomains !== undefined && (!Array.isArray(patch.automaticTargetDomains) ||
              new Set(patch.automaticTargetDomains).size !== patch.automaticTargetDomains.length ||
              patch.automaticTargetDomains.some((domain) => !TARGET_DOMAINS.includes(domain)))) return s;
        const updatedDoctrine = {
          ...unit.doctrine,
          ...patch,
          automaticTargetDomains: patch.automaticTargetDomains
            ? [...patch.automaticTargetDomains] : [...unit.doctrine.automaticTargetDomains],
        };
        const newLog: CombatLogEntry = {
          id: `log_doc_${s.tick}_${s.commandSequence}_${unitId}`,
          simTime: s.simTime,
          side: unit.side,
          category: 'DOCTRINE',
          severity: 'info',
          title: `${unit.callsign} 作战条令/EMCON变更`,
          message: `${unit.name} 条令更新: ROE=${updatedDoctrine.roe.toUpperCase()} | 主动雷达=${
            updatedDoctrine.emconRadar ? '辐射开机' : 'EMCON静默'
          } | 电子干扰=${updatedDoctrine.emconJamming ? '有源压制ON' : '关闭'}。`,
          position: [...unit.position],
          unitId,
        };
        return {
          units: {
            ...s.units,
            [unitId]: {
              ...unit,
              doctrine: updatedDoctrine,
            },
          },
          logs: [newLog, ...s.logs].slice(0, 250),
        };
      }),

    batchUpdateUnitDoctrine: (unitIds: string[], patch: Partial<UnitDoctrine>) =>
      set((s) => {
        if (!Array.isArray(unitIds) || unitIds.length === 0) return s;
        if (patch.salvoSize !== undefined && (!Number.isSafeInteger(patch.salvoSize) || patch.salvoSize < 1) ||
            patch.automaticFireRangeFraction !== undefined && (!Number.isFinite(patch.automaticFireRangeFraction) ||
              patch.automaticFireRangeFraction < 0.05 || patch.automaticFireRangeFraction > 1) ||
            patch.minimumWeaponReserve !== undefined && (!Number.isSafeInteger(patch.minimumWeaponReserve) || patch.minimumWeaponReserve < 0) ||
            patch.minimumAutomaticThreat !== undefined && !THREAT_LEVELS.includes(patch.minimumAutomaticThreat) ||
            patch.bvrTactics !== undefined && !['standard', 'crank_pump'].includes(patch.bvrTactics) ||
            patch.baffleClearPeriodic !== undefined && typeof patch.baffleClearPeriodic !== 'boolean' ||
            patch.automaticTargetDomains !== undefined && (!Array.isArray(patch.automaticTargetDomains) ||
              new Set(patch.automaticTargetDomains).size !== patch.automaticTargetDomains.length ||
              patch.automaticTargetDomains.some((domain) => !TARGET_DOMAINS.includes(domain)))) return s;

        const uniqueSorted = [...new Set(unitIds)].sort((a, b) => a.localeCompare(b));
        const nextUnits = { ...s.units };
        let appliedCount = 0;
        let logSide: SideId = s.playerSide;

        for (const id of uniqueSorted) {
          const unit = s.units[id];
          if (!canCommandUnit(s, unit)) continue;
          nextUnits[id] = {
            ...unit,
            doctrine: {
              ...unit.doctrine,
              ...patch,
              automaticTargetDomains: patch.automaticTargetDomains
                ? [...patch.automaticTargetDomains]
                : [...unit.doctrine.automaticTargetDomains],
            },
          };
          logSide = unit.side;
          appliedCount += 1;
        }
        if (appliedCount === 0) return s;
        const batchLog: CombatLogEntry = {
          id: `log_batch_doc_${s.tick}_${s.commandSequence}`,
          simTime: s.simTime,
          side: logSide,
          category: 'DOCTRINE',
          severity: 'info',
          title: `[编组批量条令] 已同步调整 ${appliedCount} 个作战单元交战/电磁管控`,
          message: `批量指令已原子下发至所选 ${appliedCount} 个单元。`,
        };
        return {
          units: nextUnits,
          logs: [batchLog, ...s.logs].slice(0, 250),
        };
      }),

    updateUnitKinematics: (unitId: string, speedKts?: number, altitudeM?: number) =>
      set((s) => {
        const unit = s.units[unitId];
        if (!canCommandUnit(s, unit)) return s;
        const configuration = resolveUnitConfiguration(s.catalog, unit.platformId, unit.activeLoadoutId);
        const spec = configuration.platform;
        const clampedSpeed =
          speedKts !== undefined && spec
            ? Math.max(0, Math.min(configuration.maxSpeedKts, speedKts))
            : unit.targetSpeedKts;
        const clampedAlt =
          altitudeM !== undefined && spec
            ? Math.max(
                spec.minAltitudeM,
                Math.min(spec.maxAltitudeM, altitudeM)
              )
            : unit.targetAltitudeM;

        return {
          units: {
            ...s.units,
            [unitId]: {
              ...unit,
              targetSpeedKts: clampedSpeed,
              speedKts: clampedSpeed,
              targetAltitudeM: clampedAlt,
            },
          },
        };
      }),

    switchUnitLoadout: (unitId: string, loadoutId: string) =>
      set((s) => {
        const unit = s.units[unitId];
        const loadout = s.catalog.loadouts[loadoutId];
        if (!canCommandUnit(s, unit) || !loadout || unit.activeLoadoutId === loadoutId) return s;
        if (s.tick > 0 && s.playMode !== 'sandbox') {
          emitActionFeedback('warning', '推演已开始，仅沙盒模式可现场更换挂载方案');
          return s;
        }
        if (!loadout.compatiblePlatformIds.includes(unit.platformId)) return s;
        const previous = resolveUnitConfiguration(s.catalog, unit.platformId, unit.activeLoadoutId);
        const configuration = resolveUnitConfiguration(s.catalog, unit.platformId, loadoutId);
        const nextMounts = createRuntimeWeaponMounts(configuration, s.catalog, unit.weaponUsage, s.simTime);
        const adjustSpeed = (speed: number) => Math.abs(speed - previous.cruiseSpeedKts) < 0.5
          ? configuration.cruiseSpeedKts : Math.min(speed, configuration.maxSpeedKts);

        const loadoutLog: CombatLogEntry = {
          id: `log_loadout_${s.tick}_${s.commandSequence}_${unitId}`,
          simTime: s.simTime,
          side: unit.side,
          category: 'DOCTRINE',
          severity: 'info',
          title: `${unit.callsign} 切换战术挂载方案: ${loadout.codeName}`,
          message: `${unit.name} 已换装 [${loadout.name}]。`,
          position: [...unit.position],
          unitId,
        };

        return {
          units: {
            ...s.units,
            [unitId]: {
              ...unit,
              activeLoadoutId: loadoutId,
              mounts: nextMounts,
              maxFuelSec: configuration.maxFuelSec,
              fuelRemainingSec: unit.maxFuelSec > 0
                ? configuration.maxFuelSec * Math.max(0, Math.min(1, unit.fuelRemainingSec / unit.maxFuelSec))
                : 0,
              speedKts: adjustSpeed(unit.speedKts),
              targetSpeedKts: adjustSpeed(unit.targetSpeedKts),
            },
          },
          logs: [loadoutLog, ...s.logs].slice(0, 250),
        };
      }),

    launchCarrierAircraft: (carrierUnitId: string, hangarSlotId: string, customLoadoutId?: string) =>
      set((s) => {
        const carrier = s.units[carrierUnitId];
        if (!canCommandUnit(s, carrier)) return s;
        const carrierClone: RuntimeUnit = {
          ...carrier,
          hangar: carrier.hangar.map((slot) => ({
            ...slot,
            activeSortieIds: [...slot.activeSortieIds],
            turnaroundQueue: slot.turnaroundQueue.map((entry) => ({ ...entry })),
          })),
        };
        const units = { ...s.units, [carrier.id]: carrierClone };
        const launchedUnit = launchCarrierSortie(units, s.catalog, carrierUnitId, hangarSlotId, customLoadoutId);
        if (!launchedUnit) return s;
        const loadoutId = launchedUnit.activeLoadoutId!;
        const launchLog: CombatLogEntry = {
          id: `log_sortie_${s.tick}_${s.commandSequence}_${launchedUnit.id}`,
          simTime: s.simTime,
          side: carrier.side,
          category: 'EVENT',
          severity: 'info',
          title: `[甲板弹射升空] ${carrier.callsign} 放飞 ${launchedUnit.name}`,
          message: `${carrier.name} 电磁弹射放飞 ${launchedUnit.name} (${launchedUnit.callsign})，挂载方案: ${
            s.catalog.loadouts[loadoutId]?.name || loadoutId
          }。`,
          position: [...launchedUnit.position],
          unitId: launchedUnit.id,
          aarType: 'sortie',
        };
        return {
          units,
          score: { ...s.score, sortiesLaunched: (s.score.sortiesLaunched || 0) + 1 },
          selectedUnitId: launchedUnit.id,
          logs: [launchLog, ...s.logs].slice(0, 250),
        };
      }),

    executeManualEngage: (
      attackerId: string,
      targetId: string,
      weaponId?: string,
      salvoCount?: number,
      acceptRisk = false
    ) => set((s) => {
      const attacker = s.units[attackerId];
      if (!canCommandUnit(s, attacker)) return s;
      const contact = s.contacts[targetId] ?? contactForUnit(s.contacts, attacker.side, targetId);
      const mounts = attacker.mounts.filter((m) => !weaponId || m.weaponId === weaponId);
      const solutions = mounts.flatMap((mount) => {
        const weapon = s.catalog.weapons[mount.weaponId];
        return weapon ? [{ mount, weapon, solution: evaluateFireControl({ ...attacker, doctrine: effectiveDoctrine(attacker, s.missions) }, contact, mount, weapon, s.catalog, s.units, s.simTime) }] : [];
      });
      const chosen = solutions.find((entry) => entry.solution.status === 'executable') ??
        solutions.find((entry) => entry.solution.status === 'risky') ?? solutions[0];
      const requestedSalvo = salvoCount ?? attacker.doctrine.salvoSize;
      if (!Number.isSafeInteger(requestedSalvo) || requestedSalvo <= 0) return s;
      if (!chosen || chosen.solution.status === 'blocked' || !contact) {
        const reason = chosen?.solution.hardBlockReasons.join('；') || '无匹配武器或情报接触';
        emitActionFeedback('warning', `火力未执行：${reason}`);
        const log: CombatLogEntry = { id: `fire_rejected_${s.tick}_${s.commandSequence}`, simTime: s.simTime,
          side: attacker.side, category: 'DOCTRINE', severity: 'warning', title: '火力指令未执行',
          message: reason, unitId: attacker.id };
        return { pendingRiskEngagement: null, interactionMode: 'select', logs: [log, ...s.logs].slice(0, 250) };
      }
      const { mount, weapon, solution } = chosen;
      if (solution.status === 'risky' && !acceptRisk) return {
        timeScale: 0, interactionMode: 'select',
        pendingRiskEngagement: { attackerId, contactId: contact.id, weaponId: weapon.id, salvoCount: requestedSalvo, solution },
      };
      const salvo = Math.min(requestedSalvo, mount.currentAmmo);
      const weaponsInFlight = { ...s.weaponsInFlight };
      const areaAttack = weapon.guidance === 'anti_radiation' && contact.lastEmitterDetectedTime !== undefined;
      for (let i = 0; i < salvo; i++) {
        const id = `manual_${s.tick}_${s.commandSequence}_${attacker.id}_${i}`;
        weaponsInFlight[id] = { id, weaponId: weapon.id, name: weapon.codeName, side: attacker.side,
          shooterId: attacker.id, shooterName: attacker.callsign,
          targetId: areaAttack ? contact.id : contact.actualUnitId,
          targetType: areaAttack ? 'area' : 'unit',
          position: [...attacker.position], launchPosition: [...attacker.position], trail: [[...attacker.position]],
          altitudeM: weapon.launchMedium === 'air_drop' ? attacker.altitudeM : weapon.cruiseAltitudeM,
          heading: getBearingDeg(attacker.position, contact.estimatedPosition),
          speedKts: weapon.launchMedium === 'air_drop' ? weapon.airDropSpeedKts! : weapon.speedKts,
          distanceRemainingKm: solution.distanceKm!,
          maxRangeKm: weapon.launchMedium === 'air_drop' ? weapon.airDropRangeKm! : weapon.maxRangeKm,
          traveledKm: 0, basePk: weapon.basePk, warheadDamage: weapon.warheadDamage,
          requiresDatalinkBeyondHorizon: weapon.requiresDatalinkBeyondHorizon,
          datalinkSupported: solution.supportSourceIds.length > 0,
          deliveryPhase: weapon.launchMedium === 'air_drop' ? 'air_drop' : undefined,
          ...launchGuidance(contact) };
      }
      const updatedAttacker = { ...attacker, status: 'engaged' as const, mounts: attacker.mounts.map((m) =>
        m.mountId === mount.mountId ? { ...m, currentAmmo: m.currentAmmo - salvo,
          cooldownRemainingSec: m.reloadTimeSec * getUnitCapabilities(attacker).reloadFactor } : m) };
      if (
        updatedAttacker.domain === 'land' &&
        updatedAttacker.doctrine.shootAndScoot &&
        updatedAttacker.waypoints.length === 0 &&
        updatedAttacker.navigationMode !== 'formation'
      ) {
        const maxSpeed = s.catalog.platforms[updatedAttacker.platformId]?.maxSpeedKts ?? 0;
        if (maxSpeed > 0) {
          const scootTarget = findShootAndScootDestination(
            updatedAttacker.position,
            s.environment,
            4.5,
            Math.round(updatedAttacker.heading + 90)
          );
          if (scootTarget) {
            updatedAttacker.waypoints = [{ position: scootTarget, speedKts: maxSpeed }];
            updatedAttacker.targetSpeedKts = maxSpeed;
          }
        }
      }
      recordWeaponLaunch(updatedAttacker, mount, salvo, s.simTime);
      const score = { ...s.score };
      if (attacker.side === 'RED') score.redMissilesFired += salvo; else score.blueMissilesFired += salvo;
      const log: CombatLogEntry = { id: `manual_log_${s.tick}_${s.commandSequence}`, simTime: s.simTime,
        side: attacker.side, category: 'LAUNCH', severity: 'warning', title: `${attacker.callsign} 发射 ${salvo} 枚 ${weapon.codeName}`,
        message: `${areaAttack ? '按最近辐射方位/AOU发射，不绑定隐藏平台' : `瞄准 ${contact.displayName}`}（估计距离 ${solution.distanceKm!.toFixed(1)} km）。${solution.riskWarnings.join('；')}`,
        unitId: attacker.id, position: [...attacker.position], weaponId: weapon.id,
        targetUnitId: areaAttack ? undefined : contact.actualUnitId, quantity: salvo };
      return { units: { ...s.units, [attacker.id]: updatedAttacker }, score, weaponsInFlight,
        pendingRiskEngagement: null, pendingWeaponIdForEngage: null, interactionMode: 'select', logs: [log, ...s.logs].slice(0, 250) };
    }),

    addReferencePoint: (coord: [number, number], side?: SideId) =>
      set((s) => {
        const rpSide: SideId =
          s.playMode === 'sandbox' ? (side || s.playerSide) : s.playerSide;
        const idx = s.referencePoints.length + 1;
        const newRp = {
          id: `rp_${s.tick}_${s.commandSequence}`,
          name: `RP-${idx} (${coord[0].toFixed(1)}E,${coord[1].toFixed(1)}N)`,
          side: rpSide,
          position: [...coord] as [number, number],
          locked: false,
        };
        return {
          referencePoints: [...s.referencePoints, newRp],
          interactionMode: 'select',
        };
      }),

    removeReferencePoint: (rpId: string) =>
      set((s) => ({
        referencePoints: s.referencePoints.filter((r) => r.id !== rpId || r.locked || (s.playMode !== 'sandbox' && r.side !== s.playerSide)),
      })),
  };
}
