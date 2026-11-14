export interface ActionFeedbackMessage {
  id: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
}

type Listener = (feedback: ActionFeedbackMessage | null) => void;

const listeners = new Set<Listener>();
let currentFeedback: ActionFeedbackMessage | null = null;
let counter = 0;

export function emitActionFeedback(
  severity: ActionFeedbackMessage['severity'],
  message: string
): void {
  currentFeedback = {
    id: `fb_${++counter}`,
    severity,
    message,
  };
  for (const listener of listeners) listener(currentFeedback);
}

export function clearActionFeedback(): void {
  currentFeedback = null;
  for (const listener of listeners) listener(null);
}

export function subscribeActionFeedback(listener: Listener): () => void {
  listeners.add(listener);
  listener(currentFeedback);
  return () => {
    listeners.delete(listener);
  };
}
