import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWargameStore } from '../../store/useWargameStore';
import { buildLiveBoxSlice } from '../../tacview3d/boxSlice';

const LazyLocalAirSeaBox3D = React.lazy(() => import('./LocalAirSeaBox3D'));

export const DraggableTacviewViewport: React.FC = () => {
  const isOpen = useWargameStore((s) => s.tacview3dOpen);
  const toggleTacview3d = useWargameStore((s) => s.toggleTacview3d);

  const selectedUnitId = useWargameStore((s) => (isOpen ? s.selectedUnitId : null));
  const selectedContactId = useWargameStore((s) => (isOpen ? s.selectedContactId : null));
  const units = useWargameStore((s) => (isOpen ? s.units : null));
  const contacts = useWargameStore((s) => (isOpen ? s.contacts : null));
  const weaponsInFlight = useWargameStore((s) => (isOpen ? s.weaponsInFlight : null));
  const detectedMissileIds = useWargameStore((s) => (isOpen ? s.detectedMissileIds : null));
  const activePerspective = useWargameStore((s) => s.activePerspective);
  const playerSide = useWargameStore((s) => s.playerSide);
  const playMode = useWargameStore((s) => s.playMode);
  const catalog = useWargameStore((s) => s.catalog);
  const simTime = useWargameStore((s) => (isOpen ? s.simTime : 0));
  const environment = useWargameStore((s) => (isOpen ? s.environment : undefined));
  const scenarioCenter = useWargameStore((s) => s.currentScenario.initialCamera.center);

  const [isExpandedSize, setIsExpandedSize] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const windowRef = useRef<HTMLDivElement | null>(null);

  // Initialize default non-overlapping position inside center map stage on first open
  useEffect(() => {
    if (!isOpen || position !== null) return;
    const width = 460;
    const x = Math.max(24, Math.round((window.innerWidth - width) / 2));
    const y = Math.max(96, Math.round(window.innerHeight - 430));
    setPosition({ x, y });
  }, [isOpen, position]);

  const handleHeaderPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const rect = windowRef.current?.getBoundingClientRect();
      const originX = position?.x ?? rect?.left ?? 360;
      const originY = position?.y ?? rect?.top ?? 120;
      dragStateRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        originX,
        originY,
      };

      const onMove = (ev: PointerEvent) => {
        const drag = dragStateRef.current;
        if (!drag) return;
        const winWidth = windowRef.current?.offsetWidth ?? 460;
        const winHeight = windowRef.current?.offsetHeight ?? 340;
        const nextX = Math.max(8, Math.min(window.innerWidth - winWidth - 8, drag.originX + (ev.clientX - drag.startX)));
        const nextY = Math.max(56, Math.min(window.innerHeight - winHeight - 8, drag.originY + (ev.clientY - drag.startY)));
        setPosition({ x: nextX, y: nextY });
      };

      const onUp = () => {
        dragStateRef.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [position]
  );

  const slice = useMemo(() => {
    if (!isOpen || !units || !contacts || !weaponsInFlight) return null;

    const contact = selectedContactId ? contacts[selectedContactId] : undefined;
    const validContact =
      contact && (contact.observerSide === playerSide || playMode === 'sandbox' || activePerspective === 'GOD')
        ? contact
        : undefined;

    const unit = selectedUnitId ? units[selectedUnitId] : undefined;
    const validUnit =
      unit && (unit.side === playerSide || playMode === 'sandbox' || activePerspective === 'GOD')
        ? unit
        : undefined;

    const anchorCenter: [number, number] = validContact
      ? validContact.estimatedPosition
      : validUnit
        ? validUnit.position
        : scenarioCenter;
    const anchorLabel = validContact
      ? validContact.displayName
      : validUnit
        ? validUnit.callsign
        : '战区中心空海盒';
    const anchorId = validContact?.id ?? validUnit?.id ?? null;

    return buildLiveBoxSlice({
      anchorCenter,
      anchorLabel,
      anchorId,
      radiusKm: 120,
      activePerspective,
      units,
      contacts,
      weaponsInFlight,
      detectedMissileIds: detectedMissileIds ?? [],
      catalog,
      simTime,
      environment,
    });
  }, [
    isOpen,
    selectedUnitId,
    selectedContactId,
    units,
    contacts,
    weaponsInFlight,
    detectedMissileIds,
    activePerspective,
    playerSide,
    playMode,
    catalog,
    simTime,
    environment,
    scenarioCenter,
  ]);

  if (!isOpen || !slice) return null;

  const widthPx = isExpandedSize ? 640 : 460;
  const heightClass = isExpandedSize ? 'h-[420px]' : 'h-[300px]';

  return (
    <div
      id="tacview-3d-floating-window"
      ref={windowRef}
      role="region"
      aria-label="3D 空海剖面视窗"
      style={{
        left: position ? `${position.x}px` : 'calc(50% - 230px)',
        top: position ? `${position.y}px` : '140px',
        width: `min(${widthPx}px, calc(100vw - 16px))`,
      }}
      className="fixed z-35"
    >
      <Suspense
        fallback={
          <div className={`${heightClass} rounded-lg border border-cyan-500/40 bg-[#040813]/95 flex items-center justify-center text-xs text-cyan-300 font-mono shadow-2xl`}>
            正在按需加载 3D 视窗引擎...
          </div>
        }
      >
        <LazyLocalAirSeaBox3D
          slice={slice}
          heightClassName={heightClass}
          isExpandedSize={isExpandedSize}
          onToggleExpandedSize={() => setIsExpandedSize((prev) => !prev)}
          onHeaderPointerDown={handleHeaderPointerDown}
          onClose={() => toggleTacview3d(false)}
        />
      </Suspense>
    </div>
  );
};
