import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useWargameStore } from '../../store/useWargameStore';
import type { TacticalContact } from '../../types/wargame';
import { classificationLabels } from '../../ui/labels';

interface Props {
  visibleContacts: TacticalContact[];
}

export const ContactsListTab: React.FC<Props> = ({ visibleContacts }) => {
  const selectedContactId = useWargameStore((s) => s.selectedContactId);
  const selectContact = useWargameStore((s) => s.selectContact);
  const flyToPosition = useWargameStore((s) => s.flyToPosition);

  return (
    <div className="space-y-2">
      <div className="p-2.5 rounded-lg bg-amber-500/8 border border-amber-500/25 text-[11px] text-amber-200/90 leading-relaxed">
        <div className="font-semibold flex items-center gap-1.5 text-amber-300 mb-1">
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>目标情报</span>
        </div>
        被动ESM电子截获或远距声呐会产生较大的 AOU 误差圆；开启预警机或主动雷达逼近后可收敛至精确火控级。
      </div>

      {visibleContacts.length === 0 ? (
        <div className="py-10 text-center text-xs text-muted-foreground rounded-lg border border-dashed border-border">
          当前传感器未捕获敌方目标接触
        </div>
      ) : (
        visibleContacts.map((c) => {
          const isSelected = c.id === selectedContactId;
          return (
            <div
              key={c.id}
              onClick={() => {
                selectContact(c.id);
                flyToPosition(c.estimatedPosition);
              }}
              className={`p-2.5 rounded-lg border cursor-pointer transition-colors ${
                isSelected ? 'bg-amber-500/15 border-amber-400/70' : 'bg-card/85 border-border hover:border-amber-500/40 hover:bg-accent/40'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-amber-300 truncate">{c.displayName}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-md border font-medium shrink-0 ${
                    c.classification === 'identified'
                      ? 'bg-rose-500/15 text-rose-300 border-rose-500/35'
                      : c.classification === 'classified'
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/35'
                        : 'bg-secondary text-muted-foreground border-border'
                  }`}
                >
                  {classificationLabels[c.classification]}
                </span>
              </div>
              <div className="mt-1.5 grid grid-cols-3 gap-1 text-[10px] text-muted-foreground font-mono tabular-nums">
                <div>航速: {c.speedKts}kt</div>
                <div>航向: {c.heading}°</div>
                <div className="text-amber-400">
                  {c.uncertaintyKind === 'bearing_corridor'
                    ? '方位走廊'
                    : c.uncertaintyKind === 'ellipse'
                      ? '交叉AOU'
                      : 'AOU'}
                  : {c.uncertaintyRadiusKm}km
                </div>
              </div>
              <div className="mt-1 text-[10px] text-cyan-400/90 truncate">探测源: {c.detectedBySources.join(' + ')}</div>
            </div>
          );
        })
      )}
    </div>
  );
};
