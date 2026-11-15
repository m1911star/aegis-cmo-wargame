import React from 'react';
import { classificationLabels, threatLabels } from '../../ui/labels';
import type { TacticalContact } from '../../types/wargame';
import { sanitizeMilsymbolSvg } from '../../validation/wargameSchemas';
import { FireControlDiagnostics } from '../FireControlDiagnostics';

interface Props {
  contact: TacticalContact;
  symbolSvgHtml: string;
}

export const ContactInspectorPanel: React.FC<Props> = ({ contact, symbolSvgHtml }) => {
  const safeSvg = sanitizeMilsymbolSvg(symbolSvgHtml);
  return (
  <aside className="z-20 w-full h-full flex flex-col overflow-y-auto p-3 space-y-3 inspector-content">
    <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/35">
      <div
        className="w-11 h-11 flex items-center justify-center rounded-md bg-background/60 border border-border shrink-0"
        dangerouslySetInnerHTML={{ __html: safeSvg }}
      />
      <div className="min-w-0">
        <div className="text-[10px] text-amber-400 uppercase font-semibold">情报目标</div>
        <div className="text-sm font-semibold text-foreground truncate">{contact.displayName}</div>
        <div className="text-[11px] text-amber-300">
          分类等级: {classificationLabels[contact.classification]} · 威胁: {threatLabels[contact.threatLevel]}
        </div>
      </div>
    </div>

    <div className="bg-card/85 border border-border space-y-1.5 text-xs">
      <div className="text-primary font-semibold text-[11px] mb-1">目标状态与定位误差</div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">观测坐标:</span>
        <span className="font-mono tabular-nums">{contact.estimatedPosition[1].toFixed(3)}°N, {contact.estimatedPosition[0].toFixed(3)}°E</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">定位几何:</span>
        <span className="text-amber-300 font-semibold">
          {contact.uncertaintyKind === 'bearing_corridor'
            ? '方位走廊'
            : contact.uncertaintyKind === 'ellipse'
              ? '交叉定位椭圆'
              : '误差圆'}{' '}
          · {contact.uncertaintyRadiusKm} km
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">解算航速 / 航向:</span>
        <span className="font-mono tabular-nums">{contact.speedKts} kts / {contact.heading}°</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">高度 / 深度:</span>
        <span className="font-mono tabular-nums">{contact.altitudeM} m</span>
      </div>
      <div className="flex justify-between items-center">
        <span className="text-muted-foreground">毁伤评估 (BDA):</span>
        <span
          className={
            contact.bdaStatus === 'kill_unconfirmed'
              ? 'text-amber-300 font-semibold'
              : contact.bdaStatus === 'damaged_suspected'
                ? 'text-rose-300 font-semibold'
                : 'text-emerald-300'
          }
        >
          {contact.bdaStatus === 'kill_unconfirmed'
            ? '回波消失 · 战果待侦察复核 [BDA?]'
            : contact.bdaStatus === 'damaged_suspected'
              ? '识别确认已受损降级'
              : '机动正常 / 未见显伤'}
        </span>
      </div>
      <div className="pt-1.5 border-t border-border text-[11px] text-cyan-300">
        探测传感器: {contact.detectedBySources.join(' , ')}
      </div>
    </div>

    <FireControlDiagnostics key={contact.id} contact={contact} />
  </aside>
  );
};
