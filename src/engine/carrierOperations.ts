import type { EquipmentCatalog, RuntimeUnit } from '../types/wargame';
import { createRuntimeUnitFromPlacement } from './simulation/unitFactory';
import { getUnitCapabilities, isActiveUnit } from './unitCapabilities';

/** Mutate one cloned world/store unit dictionary by launching a finite hangar sortie. */
export function launchCarrierSortie(
  units: Record<string, RuntimeUnit>,
  catalog: EquipmentCatalog,
  carrierUnitId: string,
  hangarSlotId: string,
  requestedLoadoutId?: string
): RuntimeUnit | undefined {
  const carrier = units[carrierUnitId];
  if (!carrier || !isActiveUnit(carrier) || !getUnitCapabilities(carrier).canFire) return undefined;
  const slot = carrier.hangar.find((candidate) => candidate.slotId === hangarSlotId);
  if (!slot || slot.readyAirframes <= 0 || slot.cooldownRemainingSec > 0) return undefined;
  const airSpec = catalog.platforms[slot.platformId];
  if (!airSpec) return undefined;
  const loadoutId = requestedLoadoutId || slot.selectedLoadoutId;
  const loadout = catalog.loadouts[loadoutId];
  if (!slot.availableLoadoutIds.includes(loadoutId) ||
      !loadout?.compatiblePlatformIds.includes(slot.platformId)) return undefined;

  const sortieNumber = slot.nextSortieNumber;
  const sortieId = `sortie_${carrier.id}_${slot.slotId}_${sortieNumber}`;
  if (units[sortieId]) return undefined;
  const slotIndex = carrier.hangar.indexOf(slot);
  const isLandAirbase = carrier.domain === 'land' || carrier.category === 'airbase';
  const offsetLon = isLandAirbase ? (carrier.side === 'RED' ? 0.04 : -0.04) : (carrier.side === 'RED' ? 0.12 : -0.12);
  const offsetLat = isLandAirbase ? 0.03 : 0.08;
  const callsignPrefix = isLandAirbase ? 'WING' : carrier.side === 'RED' ? 'HAIDONG' : 'STRIKE';
  const launched = createRuntimeUnitFromPlacement({
    id: sortieId,
    name: `${slot.squadronName} #${sortieNumber}波次`,
    callsign: `${callsignPrefix}-${sortieNumber}0${slotIndex + 1}`,
    side: carrier.side,
    platformId: slot.platformId,
    loadoutId,
    parentGroupId: carrier.parentGroupId,
    position: [
      Number((carrier.position[0] + offsetLon).toFixed(4)),
      Number((carrier.position[1] + offsetLat).toFixed(4)),
    ],
    altitudeM: isLandAirbase ? Math.max(airSpec.defaultAltitudeM, 1500) : airSpec.defaultAltitudeM,
    heading: carrier.heading,
  }, catalog);
  launched.hostCarrierId = carrier.id;
  launched.hostHangarSlotId = slot.slotId;

  slot.selectedLoadoutId = loadoutId;
  slot.readyAirframes -= 1;
  slot.cooldownRemainingSec = slot.launchCooldownSec;
  slot.activeSortieIds.push(sortieId);
  slot.nextSortieNumber += 1;
  units[sortieId] = launched;
  return launched;
}
