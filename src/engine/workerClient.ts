import type { ActivePerspective, AutoPauseSettings, EquipmentCatalog } from '../types/wargame';
import type { SimulationStepResult, SimulationWorldState } from './simulation/types';
import {
  handleSimulationWorkerRequest,
  type SimulationWorkerResponse,
  type WorkerAdvanceBatchRequest,
} from './workerProtocol';

type PendingTask = {
  resolve: (result: SimulationStepResult & { remainingSec: number }) => void;
  reject: (error: Error) => void;
};

/** Manages off-thread batch simulation with seamless synchronous fallback. */
export class SimulationWorkerClient {
  private worker: Worker | null = null;
  private workerFailed = false;
  private nextRequestId = 1;
  private pending = new Map<number, PendingTask>();

  private ensureWorker(): Worker | null {
    if (this.workerFailed || typeof Worker === 'undefined') return null;
    if (this.worker) return this.worker;
    try {
      const worker = new Worker(new URL('./simulation.worker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (event: MessageEvent<SimulationWorkerResponse>) => {
        const message = event.data;
        const task = this.pending.get(message.requestId);
        if (!task) return;
        this.pending.delete(message.requestId);
        if (message.type === 'ERROR') {
          task.reject(new Error(message.error));
        } else {
          task.resolve(message.result);
        }
      };
      worker.onerror = () => {
        this.workerFailed = true;
        this.worker = null;
        for (const [id, task] of this.pending.entries()) {
          this.pending.delete(id);
          task.reject(new Error('Simulation worker failed'));
        }
      };
      this.worker = worker;
      return worker;
    } catch {
      this.workerFailed = true;
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
    const request: WorkerAdvanceBatchRequest = {
      type: 'ADVANCE_BATCH',
      requestId: this.nextRequestId++,
      epoch,
      world,
      catalog,
      seconds,
      autoPause,
      playerSide,
    };

    const worker = this.ensureWorker();
    if (!worker) {
      const response = handleSimulationWorkerRequest(request);
      if (response.type === 'ERROR') throw new Error(response.error);
      return response.result;
    }

    return new Promise((resolve, reject) => {
      this.pending.set(request.requestId, { resolve, reject });
      try {
        worker.postMessage(request);
      } catch {
        this.pending.delete(request.requestId);
        this.workerFailed = true;
        const fallback = handleSimulationWorkerRequest(request);
        if (fallback.type === 'ERROR') reject(new Error(fallback.error));
        else resolve(fallback.result);
      }
    });
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}

export const simulationWorkerClient = new SimulationWorkerClient();
