import React, { useMemo, useState } from 'react';
import { CheckCircle2, Circle, GraduationCap, X } from 'lucide-react';
import { useWargameStore } from '../store/useWargameStore';
import { SCENARIO_INTERACTIVE_TUTORIAL } from '../scenarios/tutorialScenario';

export const TutorialChecklistOverlay: React.FC<{ leftOpen?: boolean }> = ({ leftOpen = true }) => {
  const scenarioId = useWargameStore((s) => s.currentScenario.id);
  const tick = useWargameStore((s) => s.tick);
  const units = useWargameStore((s) => s.units);
  const contacts = useWargameStore((s) => s.contacts);
  const score = useWargameStore((s) => s.score);
  const playerSide = useWargameStore((s) => s.playerSide);
  const objectiveProgress = useWargameStore((s) => s.objectiveProgress);
  const [dismissedForScenario, setDismissedForScenario] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const steps = useMemo(() => {
    const friendly = Object.values(units).filter((u) => u.side === playerSide);
    const radarOn = friendly.some((u) => u.doctrine.emconRadar);
    const hasWaypoint = friendly.some((u) => u.waypoints.length > 0);
    const hasContact = Object.values(contacts).some((c) => c.observerSide === playerSide);
    const firedOrFree =
      (playerSide === 'RED' ? score.redMissilesFired : score.blueMissilesFired) > 0 ||
      friendly.some((u) => u.doctrine.roe === 'free');
    const primaryDone = Object.values(objectiveProgress).some((v) => v === 'achieved');

    return [
      { id: 'radar', label: '1. 选中单位并开启主动雷达（快捷键 F9）', done: radarOn },
      { id: 'route', label: '2. 规划前出航路点（快捷键 F3 点击海图）', done: hasWaypoint },
      { id: 'detect', label: '3. 启动推演并捕获敌方接触（Space）', done: tick > 0 && hasContact },
      { id: 'engage', label: '4. 发起人工打击（F1）或设为自由开火', done: firedOrFree },
      { id: 'objective', label: '5. 达成主要目标完成教学演练', done: primaryDone },
    ];
  }, [units, contacts, score, playerSide, tick, objectiveProgress]);

  if (scenarioId !== SCENARIO_INTERACTIVE_TUTORIAL.id || dismissedForScenario) {
    return null;
  }

  const completedCount = steps.filter((step) => step.done).length;

  return (
    <aside
      aria-label="新兵互动教学指引"
      style={{ left: leftOpen ? 'clamp(248px, calc(18vw + 16px), 276px)' : 12 }}
      className="absolute bottom-11 z-20 w-64 rounded-lg border border-cyan-400/50 bg-slate-950/90 backdrop-blur-md p-2.5 text-xs font-mono shadow-[0_0_25px_rgba(34,211,238,0.2)]"
    >
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => setCollapsed((prev) => !prev)}
          className="flex items-center gap-1.5 text-cyan-300 font-bold cursor-pointer text-left"
        >
          <GraduationCap className="w-4 h-4" />
          <span>指挥官教学指引 ({completedCount}/{steps.length})</span>
        </button>
        <button
          aria-label="关闭教学指引"
          onClick={() => setDismissedForScenario(true)}
          className="text-slate-400 hover:text-white cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {!collapsed && (
        <ul className="space-y-1.5 mt-2">
          {steps.map((step) => (
            <li
              key={step.id}
              className={`flex items-start gap-1.5 ${step.done ? 'text-emerald-300' : 'text-slate-300'}`}
            >
              {step.done ? (
                <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-400" />
              ) : (
                <Circle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-500" />
              )}
              <span>{step.label}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
};
