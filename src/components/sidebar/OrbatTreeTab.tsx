import React, { useMemo } from 'react';
import { Anchor, ChevronDown, ChevronRight, Plane, Shield, Ship } from 'lucide-react';
import { useWargameStore } from '../../store/useWargameStore';
import type { Domain, RuntimeUnit } from '../../types/wargame';
import { perspectiveLabels } from '../../ui/labels';

function DomainIcon({ domain }: { domain: Domain }) {
  switch (domain) {
    case 'air':
      return <Plane className="w-3.5 h-3.5 text-cyan-400 shrink-0" />;
    case 'surface':
      return <Ship className="w-3.5 h-3.5 text-sky-400 shrink-0" />;
    case 'subsurface':
      return <Anchor className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    case 'land':
      return <Shield className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
  }
}

export const OrbatTreeTab: React.FC<{
  collapsedGroups: Record<string, boolean>;
  setCollapsedGroups: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}> = ({ collapsedGroups, setCollapsedGroups }) => {
  const groups = useWargameStore((s) => s.groups);
  const units = useWargameStore((s) => s.units);
  const activePerspective = useWargameStore((s) => s.activePerspective);
  const selectedUnitId = useWargameStore((s) => s.selectedUnitId);
  const selectUnit = useWargameStore((s) => s.selectUnit);
  const flyToPosition = useWargameStore((s) => s.flyToPosition);

  const visibleGroups = useMemo(
    () => groups.filter((group) => activePerspective === 'GOD' || group.side === activePerspective),
    [groups, activePerspective]
  );
  const unitsByGroup = useMemo(() => {
    const grouped = new Map<string, RuntimeUnit[]>();
    for (const unit of Object.values(units)) {
      const groupUnits = grouped.get(unit.parentGroupId) ?? [];
      groupUnits.push(unit);
      grouped.set(unit.parentGroupId, groupUnits);
    }
    return grouped;
  }, [units]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1 text-[10px] text-muted-foreground">
        <span>点击单元定位到地图</span>
        <span className="text-primary font-medium">{perspectiveLabels[activePerspective]}视角</span>
      </div>

      {visibleGroups.map((group) => {
        const groupUnits = unitsByGroup.get(group.id) ?? [];
        const isCollapsed = collapsedGroups[group.id] ?? false;
        const isRed = group.side === 'RED';

        return (
          <div key={group.id} className="rounded-lg border border-border bg-card/75 overflow-hidden shadow-xs">
            <button
              aria-expanded={!isCollapsed}
              onClick={() => setCollapsedGroups((prev) => ({ ...prev, [group.id]: !prev[group.id] }))}
              className={`w-full px-2.5 py-2 flex items-center justify-between text-left cursor-pointer transition-colors ${
                isRed
                  ? 'bg-rose-500/10 hover:bg-rose-500/15 border-b border-border text-rose-200'
                  : 'bg-sky-500/10 hover:bg-sky-500/15 border-b border-border text-sky-200'
              }`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                {isCollapsed ? (
                  <ChevronRight className="w-3.5 h-3.5 shrink-0 opacity-75" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-75" />
                )}
                <span className="text-xs font-semibold truncate">{group.name}</span>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-background/70 border border-border font-mono tabular-nums text-foreground">
                {groupUnits.filter((u) => u.hp > 0).length}/{groupUnits.length}
              </span>
            </button>

            {!isCollapsed && (
              <div className="divide-y divide-border/60">
                {groupUnits.map((unit) => {
                  const isSelected = unit.id === selectedUnitId;
                  const isDead = unit.hp <= 0 || unit.status === 'destroyed';
                  const totalAmmo = unit.mounts.reduce((acc, m) => acc + m.currentAmmo, 0);

                  return (
                    <button
                      key={unit.id}
                      onClick={() => {
                        selectUnit(unit.id);
                        flyToPosition(unit.position);
                      }}
                      aria-pressed={isSelected}
                      title={unit.name}
                      className={`unit-roster-row ${isSelected ? 'is-selected' : ''} ${isDead ? 'opacity-40 line-through' : ''}`}
                    >
                      <DomainIcon domain={unit.domain} />
                      <div className="min-w-0">
                        <div className="unit-roster-name">{unit.name}</div>
                        <div className="unit-roster-meta">
                          <span>{unit.callsign}</span>
                          <span>{Math.round(unit.speedKts)} 节 · {unit.doctrine.emconRadar ? '雷达开启' : '静默'}</span>
                        </div>
                        <div className="unit-roster-meta">
                          <span className={isDead ? 'text-rose-400' : 'text-emerald-400/90'}>
                            耐久 {Math.round(unit.hp)}/{unit.maxHp}
                          </span>
                          <span>弹药 {totalAmmo}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
