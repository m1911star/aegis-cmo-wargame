import type { ActivePerspective, AutoPauseSettings, EquipmentCatalog } from '../types/wargame';
import type { SimulationStepResult, SimulationWorldState } from './simulation/types';
import { advanceSimulation } from './simulation/worldStepper';

export interface WorkerAdvanceBatchRequest {
  type: 'ADVANCE_BATCH';
  requestId: number;
  epoch: number;
  world: SimulationWorldState;
  catalog: EquipmentCatalog;
  seconds: number;
  autoPause: AutoPauseSettings;
  playerSide: ActivePerspective;
}

export interface WorkerAdvanceBatchResponse {
  type: 'ADVANCE_BATCH_RESULT';
  requestId: number;
  epoch: number;
  result: SimulationStepResult & { remainingSec: number };
}

export interface WorkerErrorResponse {
  type: 'ERROR';
  requestId: number;
  epoch: number;
  error: string;
}

export type SimulationWorkerRequest = WorkerAdvanceBatchRequest;
export type SimulationWorkerResponse = WorkerAdvanceBatchResponse | WorkerErrorResponse;

/** Execute a deterministic worker request using the shared simulation engine. */
export function handleSimulationWorkerRequest(
  request: SimulationWorkerRequest
): SimulationWorkerResponse {
  try {
    if (request.type !== 'ADVANCE_BATCH') {
      throw new Error(`Unsupported worker request type: ${String((request as { type?: unknown }).type)}`);
    }
    const result = advanceSimulation(
      request.world,
      request.catalog,
      request.seconds,
      request.autoPause,
      request.playerSide
    );
    return {
      type: 'ADVANCE_BATCH_RESULT',
      requestId: request.requestId,
      epoch: request.epoch,
      result,
    };
  } catch (error) {
    return {
      type: 'ERROR',
      requestId: request.requestId,
      epoch: request.epoch,
      error: error instanceof Error ? error.message : 'Simulation worker error',
    };
  }
}
