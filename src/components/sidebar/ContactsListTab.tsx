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
      <div className="p-2 rounded bg-amber-950/25 border border-amber-500/30 text-[11px] text-amber-200/90 leading-relaxed">
        <div className="font-bold flex items-center gap-1.5 text-amber-300 mb-0.5">
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>目标情报</span>
        </div>
        被动ESM电子截获或远距声呐会产生较大的 AOU 误差圆；开启预警机或主动雷达逼近后可收敛至精确火控级。
      </div>

      {visibleContacts.length === 0 ? (
        <div className="py-10 text-center text-xs text-slate-500">当前传感器未捕获敌方目标接触</div>
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
              className={`p-2.5 rounded border cursor-pointer transition ${
                isSelected ? 'bg-amber-500/20 border-amber-400' : 'bg-slate-950/75 border-slate-800 hover:border-amber-500/40'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-amber-300 truncate">{c.displayName}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded uppercase ${
                    c.classification === 'identified'
                      ? 'bg-rose-500/25 text-rose-300 border border-rose-500/40'
                      : c.classification === 'classified'
                        ? 'bg-amber-500/25 text-amber-300'
                        : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {classificationLabels[c.classification]}
                </span>
              </div>
              <div className="mt-1.5 grid grid-cols-3 gap-1 text-[10px] text-slate-300">
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
