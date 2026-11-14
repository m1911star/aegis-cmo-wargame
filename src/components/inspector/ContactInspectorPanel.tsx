import React from 'react';
import { classificationLabels, threatLabels } from '../../ui/labels';
import type { TacticalContact } from '../../types/wargame';
import { FireControlDiagnostics } from '../FireControlDiagnostics';

interface Props {
  contact: TacticalContact;
  symbolSvgHtml: string;
}

export const ContactInspectorPanel: React.FC<Props> = ({ contact, symbolSvgHtml }) => (
  <aside className="z-20 w-full h-full tactical-panel border-l border-cyan-500/25 flex flex-col overflow-y-auto p-3 space-y-4 inspector-content">
    <div className="flex items-center gap-3 p-2.5 rounded bg-amber-950/30 border border-amber-500/40">
      <div
        className="w-12 h-12 flex items-center justify-center shrink-0"
        dangerouslySetInnerHTML={{ __html: symbolSvgHtml }}
      />
      <div className="min-w-0">
        <div className="text-[10px] text-amber-400 uppercase font-bold">情报目标</div>
        <div className="text-sm font-bold text-slate-100 truncate">{contact.displayName}</div>
        <div className="text-[11px] text-amber-300">
          分类等级: {classificationLabels[contact.classification]} · 威胁: {threatLabels[contact.threatLevel]}
        </div>
      </div>
    </div>

    <div className="p-2.5 rounded bg-slate-950/80 border border-slate-800 space-y-1.5 text-xs">
      <div className="text-cyan-400 font-bold text-[11px] mb-1">目标状态与定位误差</div>
      <div className="flex justify-between">
        <span className="text-slate-400">观测坐标:</span>
        <span>{contact.estimatedPosition[1].toFixed(3)}°N, {contact.estimatedPosition[0].toFixed(3)}°E</span>
      </div>
      <div className="flex justify-between">
        <span className="text-slate-400">定位几何:</span>
        <span className="text-amber-400 font-bold">
          {contact.uncertaintyKind === 'bearing_corridor'
            ? '方位走廊'
            : contact.uncertaintyKind === 'ellipse'
              ? '交叉定位椭圆'
              : '误差圆'}{' '}
          · {contact.uncertaintyRadiusKm} km
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-slate-400">解算航速 / 航向:</span>
        <span>{contact.speedKts} kts / {contact.heading}°</span>
      </div>
      <div className="flex justify-between">
        <span className="text-slate-400">高度 / 深度:</span>
        <span>{contact.altitudeM} m</span>
      </div>
      <div className="pt-1 border-t border-slate-900 text-[11px] text-cyan-300">
        探测传感器: {contact.detectedBySources.join(' , ')}
      </div>
    </div>

    <FireControlDiagnostics key={contact.id} contact={contact} />
  </aside>
);
