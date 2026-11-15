import React, { useMemo, useState } from 'react';
import { Swords } from 'lucide-react';
import {
  ALL_SKIRMISH_FORCE_PACKAGES,
  SKIRMISH_THEATER_PRESETS,
  buildSkirmishScenario,
  type SkirmishTheaterId,
} from '../../scenarios/skirmishGenerator';
import { DEFAULT_SEED } from '../../engine/determinism';
import { useWargameStore } from '../../store/useWargameStore';
import type { ScenarioWeather } from '../../types/wargame';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ModalFooter, ModalHeader, ModalShell } from '../ui/dialog';
import { Input } from '../ui/input';
import { Select } from '../ui/select';

const PACKAGE_LIST = Object.values(ALL_SKIRMISH_FORCE_PACKAGES);

export const SkirmishModal: React.FC = () => {
  const catalog = useWargameStore((s) => s.catalog);
  const loadScenario = useWargameStore((s) => s.loadScenario);
  const setActiveModal = useWargameStore((s) => s.setActiveModal);

  const [theaterId, setTheaterId] = useState<SkirmishTheaterId>('open_ocean');
  const [redPackageId, setRedPackageId] = useState<string>('red_surface_group');
  const [bluePackageId, setBluePackageId] = useState<string>('blue_carrier_group');
  const [redAuxPackageId, setRedAuxPackageId] = useState<string>('none');
  const [blueAuxPackageId, setBlueAuxPackageId] = useState<string>('none');
  const [weatherCondition, setWeatherCondition] = useState<ScenarioWeather['condition']>('clear');
  const [seaState, setSeaState] = useState<number>(3);
  const [durationMin, setDurationMin] = useState<number>(40);
  const [seedInput, setSeedInput] = useState<string>(String(DEFAULT_SEED));
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const preset = SKIRMISH_THEATER_PRESETS[theaterId];
  const compatiblePackages = useMemo(
    () =>
      PACKAGE_LIST.filter((pkg) => {
        const domains = pkg.members.map((m) => catalog.platforms[m.platformId]?.domain).filter(Boolean);
        if (theaterId === 'inland_highland') {
          return domains.every((d) => d === 'air' || d === 'land');
        }
        if (theaterId === 'open_ocean' || theaterId === 'island_archipelago') {
          return domains.every((d) => d !== 'land');
        }
        return true;
      }),
    [catalog, theaterId]
  );
  const redSelection = useMemo(
    () => [redPackageId, ...(redAuxPackageId !== 'none' && redAuxPackageId !== redPackageId ? [redAuxPackageId] : [])],
    [redPackageId, redAuxPackageId]
  );
  const blueSelection = useMemo(
    () => [bluePackageId, ...(blueAuxPackageId !== 'none' && blueAuxPackageId !== bluePackageId ? [blueAuxPackageId] : [])],
    [bluePackageId, blueAuxPackageId]
  );

  const handleLaunchSkirmish = () => {
    try {
      setErrorMsg(null);
      const parsedSeed = Number.parseInt(seedInput.trim(), 10);
      const seed = Number.isSafeInteger(parsedSeed) && parsedSeed >= 0 && parsedSeed <= 0xffffffff
        ? parsedSeed
        : DEFAULT_SEED;
      const scenario = buildSkirmishScenario(
        {
          theaterId,
          redPackageIds: redSelection,
          bluePackageIds: blueSelection,
          durationSec: Math.max(10, Math.min(120, durationMin)) * 60,
          weatherCondition,
          seaState: theaterId === 'inland_highland' ? 0 : seaState,
        },
        catalog
      );
      loadScenario(scenario, false, seed);
      setActiveModal('none');
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : '无法生成遭遇战想定');
    }
  };

  return (
    <ModalShell className="max-w-3xl max-h-[90dvh] flex flex-col">
      <ModalHeader
        icon={<Swords className="w-4 h-4 text-cyan-400" />}
        title="QUICK SKIRMISH // 自由遭遇战生成器"
        onClose={() => setActiveModal('none')}
        closeLabel="关闭遭遇战生成器"
      />
      <div className="p-4 space-y-4 text-xs overflow-y-auto flex-1">
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-foreground" htmlFor="skirmish-theater">
            作战战区模板
          </label>
          <Select
            id="skirmish-theater"
            aria-label="作战战区模板"
            value={theaterId}
            onChange={(e) => {
              const nextId = e.target.value as SkirmishTheaterId;
              setTheaterId(nextId);
              const nextPreset = SKIRMISH_THEATER_PRESETS[nextId];
              setWeatherCondition(nextPreset.defaultWeather.condition);
              setSeaState(nextPreset.defaultWeather.seaState);
              const isPkgCompatible = (pkgId: string) => {
                const pkg = ALL_SKIRMISH_FORCE_PACKAGES[pkgId];
                if (!pkg) return false;
                const domains = pkg.members.map((m) => catalog.platforms[m.platformId]?.domain).filter(Boolean);
                if (nextId === 'inland_highland') return domains.every((d) => d === 'air' || d === 'land');
                if (nextId === 'open_ocean' || nextId === 'island_archipelago') return domains.every((d) => d !== 'land');
                return true;
              };
              if (nextId === 'inland_highland') {
                if (!isPkgCompatible(redPackageId)) setRedPackageId('red_layered_air_defense');
                if (!isPkgCompatible(bluePackageId)) setBluePackageId('blue_mobile_air_defense');
              } else {
                if (!isPkgCompatible(redPackageId)) setRedPackageId('red_surface_group');
                if (!isPkgCompatible(bluePackageId)) setBluePackageId('blue_carrier_group');
              }
              if (redAuxPackageId !== 'none' && !isPkgCompatible(redAuxPackageId)) setRedAuxPackageId('none');
              if (blueAuxPackageId !== 'none' && !isPkgCompatible(blueAuxPackageId)) setBlueAuxPackageId('none');
            }}
          >
            {Object.values(SKIRMISH_THEATER_PRESETS).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.subtitle})
              </option>
            ))}
          </Select>
          <p className="text-[11px] text-muted-foreground">{preset.description}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="p-3 rounded-lg border border-rose-500/35 bg-rose-500/5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-rose-300">红方作战编组 (RED)</span>
              <Badge variant="destructive">{redSelection.length} 套配置</Badge>
            </div>
            <Select aria-label="红方主力军队配置" value={redPackageId} onChange={(e) => setRedPackageId(e.target.value)}>
              {compatiblePackages.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>{pkg.origin} · {pkg.name}</option>
              ))}
            </Select>
            <Select aria-label="红方支援军队配置" value={redAuxPackageId} onChange={(e) => setRedAuxPackageId(e.target.value)}>
              <option value="none">无附加支援配置</option>
              {compatiblePackages.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>+ {pkg.origin} · {pkg.name}</option>
              ))}
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {ALL_SKIRMISH_FORCE_PACKAGES[redPackageId]?.members
                .map((m) => `${catalog.platforms[m.platformId]?.name ?? m.platformId}×${m.quantity}`)
                .join(' · ')}
            </p>
          </div>

          <div className="p-3 rounded-lg border border-sky-500/35 bg-sky-500/5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sky-300">蓝方作战编组 (BLUE)</span>
              <Badge variant="secondary">{blueSelection.length} 套配置</Badge>
            </div>
            <Select aria-label="蓝方主力军队配置" value={bluePackageId} onChange={(e) => setBluePackageId(e.target.value)}>
              {compatiblePackages.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>{pkg.origin} · {pkg.name}</option>
              ))}
            </Select>
            <Select aria-label="蓝方支援军队配置" value={blueAuxPackageId} onChange={(e) => setBlueAuxPackageId(e.target.value)}>
              <option value="none">无附加支援配置</option>
              {compatiblePackages.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>+ {pkg.origin} · {pkg.name}</option>
              ))}
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {ALL_SKIRMISH_FORCE_PACKAGES[bluePackageId]?.members
                .map((m) => `${catalog.platforms[m.platformId]?.name ?? m.platformId}×${m.quantity}`)
                .join(' · ')}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1" htmlFor="skirmish-weather">气象条件</label>
            <Select
              id="skirmish-weather"
              aria-label="气象条件"
              value={weatherCondition}
              onChange={(e) => setWeatherCondition(e.target.value as ScenarioWeather['condition'])}
            >
              <option value="clear">晴空</option>
              <option value="overcast">阴云层</option>
              <option value="rain_storm">雷暴锋面</option>
              <option value="typhoon">台风外围</option>
            </Select>
          </div>
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1" htmlFor="skirmish-sea-state">海况等级 (0-6)</label>
            <Input
              id="skirmish-sea-state"
              aria-label="海况等级"
              type="number"
              min={0}
              max={6}
              disabled={theaterId === 'inland_highland'}
              value={theaterId === 'inland_highland' ? 0 : seaState}
              onChange={(e) => setSeaState(Number(e.target.value) || 0)}
            />
          </div>
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1" htmlFor="skirmish-duration">交战时长 (分钟)</label>
            <Input
              id="skirmish-duration"
              aria-label="交战时长"
              type="number"
              min={10}
              max={120}
              value={durationMin}
              onChange={(e) => setDurationMin(Number(e.target.value) || 40)}
            />
          </div>
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1" htmlFor="skirmish-seed">随机种子</label>
            <Input
              id="skirmish-seed"
              aria-label="随机种子"
              value={seedInput}
              onChange={(e) => setSeedInput(e.target.value)}
            />
          </div>
        </div>

        {errorMsg && (
          <div className="p-2.5 rounded border border-rose-500/40 bg-rose-500/10 text-rose-300">
            {errorMsg}
          </div>
        )}
      </div>

      <ModalFooter>
        <Button variant="outline" onClick={() => setActiveModal('none')}>取消</Button>
        <Button variant="success" onClick={handleLaunchSkirmish}>生成遭遇战并开局</Button>
      </ModalFooter>
    </ModalShell>
  );
};
