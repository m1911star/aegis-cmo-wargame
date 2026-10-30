// Compatibility facade for the modular deterministic simulation engine.
export {
  calculateRadarHorizonKm,
  getDistanceKm,
  getBearingDeg,
} from './geometry';
export {
  calculateAspectEffectiveRcsM2,
  calculateEffectiveRadarRangeKm,
  calculateSonarDetectionRangeKm,
  evaluateTargetEcmSuppression,
  buildAouPolygon,
  getContactSidc,
} from './sensors';
export { evaluateBattleAssessment } from './simulation/battleAssessment';
export { createRuntimeUnitFromPlacement } from './simulation/unitFactory';
export {
  advanceSimulation,
  initializeWorldContacts,
  stepSimulationWorld,
} from './simulation/worldStepper';
export type {
  SimulationStepResult,
  SimulationWorldState,
} from './simulation/types';
