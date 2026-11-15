import type { ActivePerspective, AutoPauseSettings, EquipmentCatalog } from '../types/wargame';
import type { SimulationStepResult, SimulationWorldState } from './simulation/types';
import {
  handleSimulationWorkerRequest,
  type SimulationWorkerResponse,
  type WorkerAdvanceBatchRequest,
} from './workerProtocol';

type PendingTask = {
  epoch: number;
  fallbackRequest: WorkerAdvanceBatchRequest;
  resolve: (result: SimulationStepResult & { remainingSec: number }) => void;
  reject: (error: Error) => void;
};

const MAX_CONSECUTIVE_WORKER_FAILURES = 3;
const catalogIds = new WeakMap<EquipmentCatalog, string>();
let nextCatalogUid = 1;

function getCatalogIdentityKey(catalog: EquipmentCatalog): string {
  let key = catalogIds.get(catalog);
  if (!key) {
    key = `${catalog.version}#${nextCatalogUid++}`;
    catalogIds.set(catalog, key);
  }
  return key;
}

export interface WorkerLike {
  onmessage: ((event: MessageEvent<SimulationWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage: (message: unknown) => void;
  terminate: () => void;
}

/** Manages off-thread batch simulation with catalog deduplication, epoch validation, and crash recovery. */
export class SimulationWorkerClient {
  private worker: WorkerLike | null = null;
  private consecutiveFailures = 0;
  private nextRequestId = 1;
  private latestEpoch = 0;
  private syncedCatalogKeys = new Set<string>();
  private pending = new Map<number, PendingTask>();

  constructor(private readonly workerFactory?: () => WorkerLike) {}

  private createWorkerInstance(): WorkerLike {
    if (this.workerFactory) return this.workerFactory();
    return new Worker(new URL('./simulation.worker.ts', import.meta.url), {
      type: 'module',
    });
  }

  private ensureWorker(): WorkerLike | null {
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_WORKER_FAILURES) return null;
    if (!this.workerFactory && typeof Worker === 'undefined') return null;
    if (this.worker) return this.worker;
    try {
      const worker = this.createWorkerInstance();
      this.syncedCatalogKeys.clear();
      worker.onmessage = (event: MessageEvent<SimulationWorkerResponse>) => {
        const message = event.data;
        const task = this.pending.get(message.requestId);
        if (!task) return;
        this.pending.delete(message.requestId);
        if (message.epoch !== task.epoch || message.epoch < this.latestEpoch) {
          task.reject(new Error(`Stale worker epoch: got ${message.epoch}, expected ${task.epoch}`));
          return;
        }
        if (message.type === 'ERROR') {
          task.reject(new Error(message.error));
        } else if (message.type === 'ADVANCE_BATCH_RESULT') {
          this.consecutiveFailures = 0;
          task.resolve(message.result);
        }
      };
      worker.onerror = () => {
        this.consecutiveFailures += 1;
        try {
          worker.terminate();
        } catch {
          // ignore termination errors on crashed worker
        }
        this.worker = null;
        this.syncedCatalogKeys.clear();
        for (const [id, task] of this.pending.entries()) {
          this.pending.delete(id);
          const fallback = handleSimulationWorkerRequest(task.fallbackRequest);
          if (fallback.type === 'ADVANCE_BATCH_RESULT' && task.epoch >= this.latestEpoch) {
            task.resolve(fallback.result);
          } else {
            task.reject(
              new Error(fallback.type === 'ERROR' ? fallback.error : 'Simulation worker failed')
            );
          }
        }
      };
      this.worker = worker;
      return worker;
    } catch {
      this.consecutiveFailures += 1;
      return null;
    }
  }

  async runBatch(
    world: SimulationWorldState,
    catalog: EquipmentCatalog,
    seconds: number,
    autoPause: AutoPauseSettings,
    playerSide: ActivePerspective,
    epoch = 0
  ): Promise<SimulationStepResult & { remainingSec: number }> {
    if (epoch > this.latestEpoch) {
      this.latestEpoch = epoch;
    }
    const requestId = this.nextRequestId++;
    const catalogKey = getCatalogIdentityKey(catalog);
    const fullRequest: WorkerAdvanceBatchRequest = {
      type: 'ADVANCE_BATCH',
      requestId,
      epoch,
      world,
      catalogKey,
      catalog,
      seconds,
      autoPause,
      playerSide,
    };

    const worker = this.ensureWorker();
    if (!worker) {
      const response = handleSimulationWorkerRequest(fullRequest);
      if (response.type !== 'ADVANCE_BATCH_RESULT') {
        throw new Error(response.type === 'ERROR' ? response.error : 'Unexpected worker response');
      }
      return response.result;
    }

    const needsCatalogSync = !this.syncedCatalogKeys.has(catalogKey);
    const wireRequest: WorkerAdvanceBatchRequest = needsCatalogSync
      ? fullRequest
      : {
          type: 'ADVANCE_BATCH',
          requestId,
          epoch,
          world,
          catalogKey,
          seconds,
          autoPause,
          playerSide,
        };

    return new Promise((resolve, reject) => {
      this.pending.set(requestId, {
        epoch,
        fallbackRequest: fullRequest,
        resolve,
        reject,
      });
      try {
        worker.postMessage(wireRequest);
        if (needsCatalogSync) {
          this.syncedCatalogKeys.add(catalogKey);
        }
      } catch {
        this.pending.delete(requestId);
        this.consecutiveFailures += 1;
        try {
          worker.terminate();
        } catch {
          // ignore
        }
        this.worker = null;
        this.syncedCatalogKeys.clear();
        const fallback = handleSimulationWorkerRequest(fullRequest);
        if (fallback.type === 'ADVANCE_BATCH_RESULT') resolve(fallback.result);
        else reject(new Error(fallback.type === 'ERROR' ? fallback.error : 'Worker fallback error'));
      }
    });
  }

  resetRecoveryState() {
    this.consecutiveFailures = 0;
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.syncedCatalogKeys.clear();
    this.pending.clear();
  }
}

export const simulationWorkerClient = new SimulationWorkerClient();
