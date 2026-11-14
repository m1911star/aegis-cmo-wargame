import { handleSimulationWorkerRequest, type SimulationWorkerRequest } from './workerProtocol';

self.onmessage = (event: MessageEvent<SimulationWorkerRequest>) => {
  self.postMessage(handleSimulationWorkerRequest(event.data));
};
