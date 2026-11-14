import React, { useEffect, useState } from 'react';
import { AlertTriangle, Info, X, XCircle } from 'lucide-react';
import {
  clearActionFeedback,
  subscribeActionFeedback,
  type ActionFeedbackMessage,
} from '../store/actionFeedbackBus';

export const ActionFeedbackToast: React.FC = () => {
  const [feedback, setFeedback] = useState<ActionFeedbackMessage | null>(null);

  useEffect(() => subscribeActionFeedback(setFeedback), []);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => clearActionFeedback(), 4500);
    return () => window.clearTimeout(timer);
  }, [feedback?.id]);

  if (!feedback) return null;

  const toneClass =
    feedback.severity === 'error'
      ? 'bg-card/98 border-rose-500/60 text-rose-200'
      : feedback.severity === 'warning'
        ? 'bg-card/98 border-amber-500/60 text-amber-200'
        : 'bg-card/98 border-cyan-500/50 text-cyan-200';

  const Icon =
    feedback.severity === 'error'
      ? XCircle
      : feedback.severity === 'warning'
        ? AlertTriangle
        : Info;

  return (
    <div
      role={feedback.severity === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      className={`fixed top-20 right-4 z-50 max-w-md rounded-lg border px-3.5 py-2.5 shadow-2xl backdrop-blur-xl flex items-center gap-2.5 text-xs ${toneClass}`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="flex-1 leading-relaxed">{feedback.message}</span>
      <button
        aria-label="关闭操作提示"
        onClick={() => clearActionFeedback()}
        className="opacity-75 hover:opacity-100 cursor-pointer"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
