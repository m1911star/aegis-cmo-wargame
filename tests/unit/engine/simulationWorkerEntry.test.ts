import { expect, test } from 'bun:test';
import type { SimulationWorkerResponse, WorkerSyncCatalogRequest } from '../../../src/engine/workerProtocol';

test('the worker entry forwards a catalog sync request and posts its response', async () => {
  const request: WorkerSyncCatalogRequest = {
    type: 'SYNC_CATALOG',
    requestId: 7,
    epoch: 3,
    catalogKey: 'worker-entry-test',
    catalog: { version: 'test', platforms: {}, sensors: {}, weapons: {}, loadouts: {} },
  };

  // Bun does not collect LCOV from a separate Worker. Execute the real entry
  // against a worker-shaped scope in the instrumented test context instead.
  const responses: SimulationWorkerResponse[] = [];
  const scope = {
    onmessage: null as ((event: MessageEvent<WorkerSyncCatalogRequest>) => void) | null,
    postMessage: (response: SimulationWorkerResponse) => { responses.push(response); },
  };
  const originalSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
  Object.defineProperty(globalThis, 'self', { configurable: true, value: scope });
  try {
    await import('../../../src/engine/simulation.worker');
    scope.onmessage?.(new MessageEvent('message', { data: request }));
    expect(responses).toEqual([{ type: 'CATALOG_SYNCED', requestId: 7, epoch: 3, catalogKey: 'worker-entry-test' }]);
  } finally {
    if (originalSelf) Object.defineProperty(globalThis, 'self', originalSelf);
    else Reflect.deleteProperty(globalThis, 'self');
  }
});
