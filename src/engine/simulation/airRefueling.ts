import type { CombatLogEntry, EquipmentCatalog, RuntimeUnit } from '../../types/wargame';
import { resolveUnitConfiguration } from '../../db/unitConfiguration';
import { getDistanceKm } from '../geometry';
import { isActiveUnit } from '../unitCapabilities';

function restoreReceiver(receiver: RuntimeUnit): void {
  const state = receiver.airRefuelState;
  if (!state) return;
  if (receiver.status !== 'returning') {
    receiver.navigationMode = state.resumeNavigationMode;
    receiver.waypoints = state.resumeWaypoints.map((waypoint) => ({
      ...waypoint, position: [...waypoint.position] as [number, number],
    }));
    receiver.missionTargetId = state.resumeMissionTargetId;
    receiver.missionState = state.resumeMissionState;
  }
  receiver.airRefuelState = undefined;
}

export function advanceAirRefueling(
  units: Record<string, RuntimeUnit>,
  catalog: EquipmentCatalog,
  nextSimTime: number,
  dtSec: number,
  logs: CombatLogEntry[]
): void {
  for (const tanker of Object.values(units).sort((a, b) => a.id.localeCompare(b.id))) {
    if (!tanker.aarQueue.length) continue;
    const tankerSpec = catalog.platforms[tanker.platformId];
    const transferRate = tankerSpec?.aarTransferRateSecPerSec ?? 0;
    const unavailable = !isActiveUnit(tanker) || tanker.status === 'returning' ||
      transferRate <= 0 || tanker.aarFuelRemainingSec <= 0;
    tanker.aarQueue = [...new Set(tanker.aarQueue)].filter((receiverId) => {
      const receiver = units[receiverId];
      const valid = !!receiver && isActiveUnit(receiver) && receiver.side === tanker.side &&
        receiver.domain === 'air' && receiver.airRefuelState?.tankerId === tanker.id &&
        receiver.status !== 'returning';
      if (!valid && receiver?.airRefuelState?.tankerId === tanker.id) restoreReceiver(receiver);
      return valid;
    });
    if (unavailable) {
      for (const receiverId of tanker.aarQueue) {
        const receiver = units[receiverId];
        if (receiver) restoreReceiver(receiver);
      }
      tanker.aarQueue = [];
      continue;
    }

    const receiver = units[tanker.aarQueue[0]];
    if (!receiver?.airRefuelState) continue;
    const distanceKm = getDistanceKm(receiver.position, tanker.position);
    const altitudeDeltaM = Math.abs(receiver.altitudeM - tanker.altitudeM);
    const speedDeltaKts = Math.abs(receiver.speedKts - tanker.speedKts);
    if (distanceKm > 1.5 || altitudeDeltaM > 300 || speedDeltaKts > 60) {
      receiver.airRefuelState.phase = 'rendezvous';
      receiver.navigationMode = 'manual';
      receiver.waypoints = [{
        position: [...tanker.position],
        speedKts: tanker.targetSpeedKts,
        altitudeM: tanker.targetAltitudeM,
      }];
      continue;
    }

    receiver.airRefuelState.phase = 'refueling';
    receiver.navigationMode = 'manual';
    receiver.waypoints = [];
    receiver.targetSpeedKts = tanker.targetSpeedKts;
    receiver.targetAltitudeM = tanker.targetAltitudeM;
    const receiverConfig = resolveUnitConfiguration(catalog, receiver.platformId, receiver.activeLoadoutId);
    const deficit = Math.max(0, receiverConfig.maxFuelSec - receiver.fuelRemainingSec);
    const transfer = Math.min(
      deficit,
      tanker.aarFuelRemainingSec,
      transferRate * dtSec
    );
    receiver.fuelRemainingSec += transfer;
    tanker.aarFuelRemainingSec -= transfer;
    if (deficit - transfer <= 1e-6 || tanker.aarFuelRemainingSec <= 1e-6) {
      tanker.aarQueue.shift();
      restoreReceiver(receiver);
      logs.push({
        id: `aar_complete_${tanker.id}_${receiver.id}_${nextSimTime}`,
        simTime: nextSimTime,
        side: tanker.side,
        category: 'EVENT',
        severity: 'info',
        title: `${receiver.callsign} 空中加油结束`,
        message: `转移 ${transfer.toFixed(1)} 秒燃油预算；${tanker.callsign} 剩余可转移燃油 ${tanker.aarFuelRemainingSec.toFixed(1)} 秒。`,
        unitId: receiver.id,
      });
    }
  }
}
