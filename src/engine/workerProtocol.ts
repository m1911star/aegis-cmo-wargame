import type { ActivePerspective, AutoPauseSettings, EquipmentCatalog } from '../types/wargame';
import type { SimulationStepResult, SimulationWorldState } from './simulation/types';
import { advanceSimulation } from './simulation/worldStepper';

export interface WorkerSyncCatalogRequest {
  type: 'SYNC_CATALOG';
  requestId: number;
  epoch: number;
  catalogKey: string;
  catalog: EquipmentCatalog;
}

export interface WorkerAdvanceBatchRequest {
  type: 'ADVANCE_BATCH';
  requestId: number;
  epoch: number;
  world: SimulationWorldState;
  catalogKey?: string;
  catalog?: EquipmentCatalog;
  seconds: number;
  autoPause: AutoPauseSettings;
  playerSide: ActivePerspective;
}

export interface WorkerCatalogSyncedResponse {
  type: 'CATALOG_SYNCED';
  requestId: number;
  epoch: number;
  catalogKey: string;
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

export type SimulationWorkerRequest = WorkerSyncCatalogRequest | WorkerAdvanceBatchRequest;
export type SimulationWorkerResponse =
  | WorkerCatalogSyncedResponse
  | WorkerAdvanceBatchResponse
  | WorkerErrorResponse;

const defaultCatalogCache = new Map<string, EquipmentCatalog>();
const MAX_CACHED_CATALOGS = 6;

function rememberCatalog(
  cache: Map<string, EquipmentCatalog>,
  key: string,
  catalog: EquipmentCatalog
): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, catalog);
  while (cache.size > MAX_CACHED_CATALOGS) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Execute a deterministic worker request using the shared simulation engine. */
export function handleSimulationWorkerRequest(
  request: SimulationWorkerRequest,
  catalogCache: Map<string, EquipmentCatalog> = defaultCatalogCache
): SimulationWorkerResponse {
  try {
    if (request.type === 'SYNC_CATALOG') {
      rememberCatalog(catalogCache, request.catalogKey, request.catalog);
      return {
        type: 'CATALOG_SYNCED',
        requestId: request.requestId,
        epoch: request.epoch,
        catalogKey: request.catalogKey,
      };
    }
    if (request.type !== 'ADVANCE_BATCH') {
      throw new Error(`Unsupported worker request type: ${String((request as { type?: unknown }).type)}`);
    }
    if (request.catalog && request.catalogKey) {
      rememberCatalog(catalogCache, request.catalogKey, request.catalog);
    }
    const catalog =
      request.catalog ??
      (request.catalogKey ? catalogCache.get(request.catalogKey) : undefined);
    if (!catalog) {
      throw new Error(`Missing cached equipment catalog for key: ${request.catalogKey ?? '<none>'}`);
    }
    const result = advanceSimulation(
      request.world,
      catalog,
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
