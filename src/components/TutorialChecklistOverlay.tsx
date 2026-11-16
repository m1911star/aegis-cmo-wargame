import React, { useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Circle, GraduationCap, Sparkles, X } from 'lucide-react';
import { useWargameStore } from '../store/useWargameStore';
import { SCENARIO_INTERACTIVE_TUTORIAL } from '../scenarios/tutorialScenario';

interface TutorialStep {
  id: string;
  label: string;
  shortcut: string;
  actionHint: string;
  done: boolean;
}

export const TutorialChecklistOverlay: React.FC<{ leftOpen?: boolean }> = ({ leftOpen = true }) => {
  const scenarioId = useWargameStore((s) => s.currentScenario.id);
  const tick = useWargameStore((s) => s.tick);
  const units = useWargameStore((s) => s.units);
  const contacts = useWargameStore((s) => s.contacts);
  const score = useWargameStore((s) => s.score);
  const playerSide = useWargameStore((s) => s.playerSide);
  const objectiveProgress = useWargameStore((s) => s.objectiveProgress);
  const [dismissedScenarioId, setDismissedScenarioId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const steps = useMemo<TutorialStep[]>(() => {
    const friendly = Object.values(units).filter((u) => u.side === playerSide);
    const radarOn = friendly.some((u) => u.doctrine.emconRadar);
    const hasWaypoint = friendly.some((u) => u.waypoints.length > 0);
    const hasContact = Object.values(contacts).some((c) => c.observerSide === playerSide);
    const firedOrFree =
      (playerSide === 'RED' ? score.redMissilesFired : score.blueMissilesFired) > 0 ||
      friendly.some((u) => u.doctrine.roe === 'free');
    const primaryDone = Object.values(objectiveProgress).some((v) => v === 'achieved');

    return [
      {
        id: 'radar',
        label: '1. 选中单位并开启主动雷达（快捷键 F9）',
        shortcut: 'F9',
        actionHint: '点击红方舰机后按 F9，或在右侧面板开启雷达辐射',
        done: radarOn,
      },
      {
        id: 'route',
        label: '2. 规划前出航路点（快捷键 F3 点击海图）',
        shortcut: 'F3',
        actionHint: '选中友军单位后按 F3，在海图东侧点击规划航路点',
        done: hasWaypoint,
      },
      {
        id: 'detect',
        label: '3. 启动推演并捕获敌方接触（Space）',
        shortcut: 'Space',
        actionHint: '按 Space 或点击顶部「开始推演」推进时钟并探测目标',
        done: tick > 0 && hasContact,
      },
      {
        id: 'engage',
        label: '4. 发起人工打击（F1）或设为自由开火',
        shortcut: 'F1',
        actionHint: '按 F1 点击敌方目标发射导弹，或在右侧将 ROE 设为自由开火',
        done: firedOrFree,
      },
      {
        id: 'objective',
        label: '5. 达成主要目标完成教学演练',
        shortcut: '主要目标',
        actionHint: '持续推进推演直至击伤或摧毁蓝方演练驱逐舰',
        done: primaryDone,
      },
    ];
  }, [units, contacts, score, playerSide, tick, objectiveProgress]);

  const isTutorialScenario =
    scenarioId === SCENARIO_INTERACTIVE_TUTORIAL.id || scenarioId === 'tutorial_joint_ops';

  if (!isTutorialScenario) {
    return null;
  }

  const completedCount = steps.filter((step) => step.done).length;
  const totalCount = steps.length;
  const progressPercent = Math.round((completedCount / totalCount) * 100);
  const activeStepIndex = steps.findIndex((step) => !step.done);
  const allCompleted = completedCount === totalCount;
  const dismissedForScenario = dismissedScenarioId === scenarioId;
  const leftOffset = leftOpen ? 'clamp(248px, calc(18vw + 16px), 278px)' : 12;

  if (dismissedForScenario) {
    return (
      <button
        type="button"
        aria-label={`重新打开教学指引 (${completedCount}/${totalCount})`}
        onClick={() => setDismissedScenarioId(null)}
        style={{ left: leftOffset }}
        className="absolute bottom-11 z-20 inline-flex items-center gap-2 rounded-full border border-cyan-400/50 bg-card/95 backdrop-blur-xl px-3.5 py-1.5 text-xs font-semibold text-cyan-200 shadow-xl hover:border-cyan-300/80 hover:bg-card cursor-pointer transition-colors"
      >
        {!allCompleted && (
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-400" />
          </span>
        )}
        <GraduationCap className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
        <span>教学指引 ({completedCount}/{totalCount})</span>
      </button>
    );
  }

  return (
    <aside
      aria-label="新兵互动教学指引"
      style={{ left: leftOffset }}
      className="absolute bottom-11 z-20 w-72 rounded-xl border border-border bg-card/95 backdrop-blur-xl p-3 text-xs shadow-xl"
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setCollapsed((prev) => !prev)}
          className="flex items-center gap-1.5 text-primary font-semibold cursor-pointer text-left min-w-0"
        >
          <GraduationCap className="w-4 h-4 text-cyan-300 shrink-0" />
          <span>指挥官教学指引 ({completedCount}/{steps.length})</span>
          {collapsed ? (
            <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          )}
        </button>
        <button
          type="button"
          aria-label="关闭教学指引"
          title="关闭教学指引（可随时通过左下角按钮重新打开）"
          onClick={() => setDismissedScenarioId(scenarioId)}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-secondary/80 cursor-pointer transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="mt-2 space-y-1">
        <div
          role="progressbar"
          aria-label="教学演练总体进度"
          aria-valuemin={0}
          aria-valuemax={totalCount}
          aria-valuenow={completedCount}
          className="h-1.5 w-full overflow-hidden rounded-full bg-secondary/90 border border-border/60"
        >
          <div
            style={{ width: `${progressPercent}%` }}
            className={`h-full rounded-full transition-all duration-300 ${
              allCompleted
                ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]'
                : 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.5)]'
            }`}
          />
        </div>
        {allCompleted && !collapsed && (
          <div className="flex items-center gap-1.5 rounded-md border border-emerald-500/35 bg-emerald-500/12 px-2 py-1 text-[11px] font-medium text-emerald-300">
            <Sparkles className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
            <span>全部演练科目已完成，可继续自由交战或结算。</span>
          </div>
        )}
      </div>

      {!collapsed && (
        <ul className="space-y-1.5 mt-2.5">
          {steps.map((step, index) => {
            const isActive = !step.done && index === activeStepIndex;

            return (
              <li
                key={step.id}
                aria-current={isActive ? 'step' : undefined}
                className={`rounded-lg border px-2 py-1.5 text-[11px] transition-colors ${
                  step.done
                    ? 'border-emerald-500/25 bg-emerald-500/8 text-emerald-200'
                    : isActive
                      ? 'border-cyan-400/70 bg-cyan-500/12 text-foreground shadow-[0_0_12px_rgba(34,211,238,0.14)]'
                      : 'border-transparent bg-transparent text-muted-foreground opacity-75'
                }`}
              >
                <div className="flex items-start gap-2">
                  {step.done ? (
                    <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-400" />
                  ) : isActive ? (
                    <span className="relative flex h-2.5 w-2.5 mt-1 shrink-0" aria-hidden="true">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-400" />
                    </span>
                  ) : (
                    <Circle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-500" />
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1.5">
                      <span className={step.done ? 'line-through decoration-emerald-400/60' : isActive ? 'font-medium text-cyan-50' : ''}>
                        {step.label}
                      </span>
                      {step.done && (
                        <span className="shrink-0 rounded bg-emerald-500/20 border border-emerald-400/35 px-1 py-0.5 text-[9px] font-semibold text-emerald-300">
                          已完成
                        </span>
                      )}
                    </div>

                    {isActive && (
                      <div className="mt-1.5 flex items-start gap-1.5 text-[10px] leading-snug text-cyan-200/90">
                        <kbd className="shrink-0 rounded border border-cyan-400/50 bg-cyan-500/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-cyan-100">
                          {step.shortcut}
                        </kbd>
                        <span>{step.actionHint}</span>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
};
