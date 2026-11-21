import type { ActivePerspective, AutoPauseSettings, EquipmentCatalog } from '../types/wargame';
import type { SimulationStepResult, SimulationWorldState } from './simulation/types';
import {
  handleSimulationWorkerRequest,
  type SimulationWorkerResponse,
  type WorkerAdvanceBatchRequest,
} from './workerProtocol';

type BatchResult = SimulationStepResult & { remainingSec: number };

type PendingTask = {
  fallbackRequest: WorkerAdvanceBatchRequest;
  isCurrent: () => boolean;
  resolve: (result: BatchResult) => void;
  reject: (error: unknown) => void;
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

/** Cancellation or a superseded response, not a reason to retry on the main thread. */
export class StaleSimulationBatchError extends Error {
  constructor(message = 'Simulation batch is no longer current') {
    super(message);
    this.name = 'StaleSimulationBatchError';
  }
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

  private assertCurrent(epoch: number, isCurrent: () => boolean): void {
    if (epoch < this.latestEpoch || !isCurrent()) throw new StaleSimulationBatchError();
  }

  private runFallback(request: WorkerAdvanceBatchRequest, isCurrent: () => boolean): BatchResult {
    this.assertCurrent(request.epoch, isCurrent);
    const response = handleSimulationWorkerRequest(request);
    if (response.type !== 'ADVANCE_BATCH_RESULT') {
      throw new Error(response.type === 'ERROR' ? response.error : 'Unexpected worker response');
    }
    return response.result;
  }

  private terminateWorker() {
    const worker = this.worker;
    this.worker = null;
    this.syncedCatalogKeys.clear();
    try {
      worker?.terminate();
    } catch {
      // Ignore termination errors on a crashed worker.
    }
  }

  private recoverWorker(worker: WorkerLike) {
    if (worker !== this.worker) return;
    this.consecutiveFailures += 1;
    this.terminateWorker();
    for (const [id, task] of this.pending) {
      this.pending.delete(id);
      try {
        task.resolve(this.runFallback(task.fallbackRequest, task.isCurrent));
      } catch (error) {
        task.reject(error);
      }
    }
  }

  private ensureWorker(): WorkerLike | null {
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_WORKER_FAILURES) return null;
    if (!this.workerFactory && typeof Worker === 'undefined') return null;
    if (this.worker) return this.worker;
    try {
      const worker = this.createWorkerInstance();
      this.syncedCatalogKeys.clear();
      worker.onmessage = (event: MessageEvent<SimulationWorkerResponse>) => {
        if (worker !== this.worker) return;
        const message = event.data;
        const task = this.pending.get(message.requestId);
        if (!task) return;
        this.pending.delete(message.requestId);
        try {
          const { epoch } = task.fallbackRequest;
          if (message.epoch !== epoch) {
            throw new StaleSimulationBatchError(`Stale worker epoch: got ${message.epoch}, expected ${epoch}`);
          }
          this.assertCurrent(epoch, task.isCurrent);
          if (message.type !== 'ADVANCE_BATCH_RESULT') {
            throw new Error(message.type === 'ERROR' ? message.error : 'Unexpected worker response');
          }
          this.consecutiveFailures = 0;
          task.resolve(message.result);
        } catch (error) {
          task.reject(error);
        }
      };
      worker.onerror = () => this.recoverWorker(worker);
      this.worker = worker;
      return worker;
    } catch {
      this.consecutiveFailures += 1;
      return null;
    }
  }

  /** Default epochs increase for this client across batches, scenario reloads, and worker recovery. */
  async runBatch(
    world: SimulationWorldState,
    catalog: EquipmentCatalog,
    seconds: number,
    autoPause: AutoPauseSettings,
    playerSide: ActivePerspective,
    epoch = this.latestEpoch + 1,
    isCurrent: () => boolean = () => true
  ): Promise<SimulationStepResult & { remainingSec: number }> {
    this.assertCurrent(epoch, isCurrent);
    this.latestEpoch = epoch;
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
    if (!worker) return this.runFallback(fullRequest, isCurrent);

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
        fallbackRequest: fullRequest,
        isCurrent,
        resolve,
        reject,
      });
      try {
        worker.postMessage(wireRequest);
        if (needsCatalogSync && worker === this.worker) {
          this.syncedCatalogKeys.add(catalogKey);
        }
      } catch {
        this.recoverWorker(worker);
      }
    });
  }

  resetRecoveryState() {
    this.consecutiveFailures = 0;
  }

  dispose() {
    this.terminateWorker();
    for (const task of this.pending.values()) task.reject(new StaleSimulationBatchError());
    this.pending.clear();
  }
}

export const simulationWorkerClient = new SimulationWorkerClient();
