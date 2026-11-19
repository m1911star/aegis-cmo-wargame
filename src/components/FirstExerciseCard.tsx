import { X } from 'lucide-react';
import { useWargameStore } from '../store/useWargameStore';
import type { ScenarioObjective, SideId, TacticalContact } from '../types/wargame';
import { classificationLabels, perspectiveLabels } from '../ui/labels';

type ExerciseContact = Pick<TacticalContact, 'id' | 'displayName' | 'classification' | 'uncertaintyRadiusKm' | 'estimatedPosition'>;

type FirstExerciseSummary = {
  primaryGoal: string;
  contact?: ExerciseContact;
};

export function projectFirstExerciseCard(
  playerSide: SideId,
  objectives: readonly ScenarioObjective[],
  contacts: Readonly<Record<string, TacticalContact>>,
): FirstExerciseSummary | null {
  const goal = objectives.find((objective) => objective.side === playerSide && objective.required);
  if (!goal) return null;

  const contact = Object.values(contacts).find((candidate) => candidate.observerSide === playerSide);
  if (!contact) return { primaryGoal: goal.title };

  const { id, displayName, classification, uncertaintyRadiusKm, estimatedPosition } = contact;
  return {
    primaryGoal: goal.title,
    contact: { id, displayName, classification, uncertaintyRadiusKm, estimatedPosition: [...estimatedPosition] },
  };
}

export function FirstExerciseCard({ onDismiss, onContactOpened }: {
  onDismiss: () => void;
  onContactOpened: () => void;
}) {
  const playerSide = useWargameStore((s) => s.playerSide);
  const objectives = useWargameStore((s) => s.objectives);
  const contacts = useWargameStore((s) => s.contacts);
  const summary = projectFirstExerciseCard(playerSide, objectives, contacts);
  if (!summary) return null;
  const { primaryGoal, contact } = summary;

  return (
    <section className="first-exercise-card tactical-panel" aria-labelledby="first-exercise-heading">
      <div className="flex items-center justify-between gap-2">
        <h2 id="first-exercise-heading" className="text-sm font-semibold text-slate-100">演练开局</h2>
        <button type="button" className="toolbar-button toolbar-button-subtle icon-button" aria-label="关闭开局卡" onClick={onDismiss}>
          <X aria-hidden="true" />
        </button>
      </div>
      <div>
        <p className="text-slate-400">{perspectiveLabels[playerSide]}主要目标</p>
        <p className="text-sm font-semibold text-slate-100">{primaryGoal}</p>
      </div>
      <div>
        <p className="mb-1 text-slate-400">本方情报</p>
        {contact ? (
          <button
            type="button"
            aria-controls="inspector-panel"
            aria-label={`查看接触：${contact.displayName}`}
            aria-describedby="first-exercise-contact-estimate"
            className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-amber-400/30 bg-amber-400/10 px-2.5 py-1.5 text-left text-amber-100 hover:bg-amber-400/20"
            onClick={() => {
              const { selectContact, flyToPosition } = useWargameStore.getState();
              selectContact(contact.id);
              flyToPosition(contact.estimatedPosition);
              onContactOpened();
            }}
          >
            <span className="min-w-0 wrap-anywhere">
              <span className="block font-medium">{contact.displayName}</span>
              <span id="first-exercise-contact-estimate" className="block text-[11px] text-amber-200/85">
                {classificationLabels[contact.classification]} · 定位误差 {contact.uncertaintyRadiusKm} km
              </span>
            </span>
            <span className="shrink-0">查看接触</span>
          </button>
        ) : <p className="text-slate-300">暂无情报</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="toolbar-button" onClick={() => useWargameStore.getState().setActiveModal('briefing')}>
          查看完整简报
        </button>
        <button type="button" className="toolbar-button" onClick={() => useWargameStore.getState().setTimeScale(5)}>
          以 5× 开始
        </button>
      </div>
    </section>
  );
}
