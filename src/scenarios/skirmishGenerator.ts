import { createForcePackagePlacements, FORCE_PACKAGES } from '../db/forcePackages';
import { EXPANSION_FORCE_PACKAGES } from '../db/expansion/catalogExpansion';
import { compileScenario } from './compileScenario';
import { MASTER_EQUIPMENT_CATALOG } from '../db';
import type {
  EquipmentCatalog,
  InitialUnitPlacement,
  ScenarioDefinition,
  ScenarioEnvironment,
  ScenarioWeather,
  SideId,
} from '../types/wargame';

export type SkirmishTheaterId = 'open_ocean' | 'coastal_strait' | 'island_archipelago' | 'inland_highland';

export interface SkirmishTheaterPreset {
  id: SkirmishTheaterId;
  name: string;
  subtitle: string;
  description: string;
  center: [number, number];
  zoom: number;
  redAnchor: [number, number];
  blueAnchor: [number, number];
  redHeading: number;
  blueHeading: number;
  defaultWeather: ScenarioWeather;
  environment: ScenarioEnvironment;
}

export const ALL_SKIRMISH_FORCE_PACKAGES = {
  ...FORCE_PACKAGES,
  ...EXPANSION_FORCE_PACKAGES,
};

export const SKIRMISH_THEATER_PRESETS: Record<SkirmishTheaterId, SkirmishTheaterPreset> = {
  open_ocean: {
    id: 'open_ocean',
    name: '远洋深海战区',
    subtitle: 'PHILIPPINE SEA // DEEP OCEAN',
    description: '开阔深海海域（声呐探测增益 1.25x），适合航母打击群、远洋驱护编队与核潜艇决战。',
    center: [129.0, 23.0],
    zoom: 6.4,
    redAnchor: [127.6, 23.0],
    blueAnchor: [130.4, 23.0],
    redHeading: 90,
    blueHeading: 270,
    defaultWeather: { condition: 'clear', seaState: 3, cloudFloorM: 2200, cloudCeilingM: 6000 },
    environment: {
      landPolygons: [],
      acousticZones: [
        {
          id: 'skirmish_deep_basin',
          name: '深海远洋声道区',
          kind: 'deep',
          sonarRangeFactor: 1.25,
          areaPolygon: [[126.5, 21.0], [131.5, 21.0], [131.5, 25.0], [126.5, 25.0]],
        },
      ],
    },
  },
  coastal_strait: {
    id: 'coastal_strait',
    name: '海峡浅海封锁区',
    subtitle: 'COASTAL STRAIT // SHALLOW WATER',
    description: '东西岸陆地夹峙的浅海海峡（声呐 0.75x），兼顾陆基防空、岸导与近海反潜。',
    center: [120.2, 24.0],
    zoom: 7.0,
    redAnchor: [119.8, 24.0],
    blueAnchor: [120.6, 24.0],
    redHeading: 90,
    blueHeading: 270,
    defaultWeather: { condition: 'overcast', seaState: 4, cloudFloorM: 1400, cloudCeilingM: 4800 },
    environment: {
      landPolygons: [
        {
          id: 'skirmish_west_coast',
          name: '西岸前沿陆基带',
          elevationM: 220,
          areaPolygon: [[117.8, 22.5], [119.35, 22.5], [119.35, 25.5], [117.8, 25.5]],
        },
        {
          id: 'skirmish_east_coast',
          name: '东岸岛链防御带',
          elevationM: 380,
          areaPolygon: [[121.05, 22.5], [122.4, 22.5], [122.4, 25.5], [121.05, 25.5]],
        },
      ],
      acousticZones: [
        {
          id: 'skirmish_strait_shallow',
          name: '海峡大陆架浅海声学区',
          kind: 'shallow',
          sonarRangeFactor: 0.75,
          areaPolygon: [[119.4, 22.5], [121.0, 22.5], [121.0, 25.5], [119.4, 25.5]],
        },
      ],
    },
  },
  island_archipelago: {
    id: 'island_archipelago',
    name: '岛礁群岛夺控区',
    subtitle: 'ARCHIPELAGO // JOINT LITTORAL',
    description: '中央岛礁高地形成低空雷达遮蔽（450m），适合海空协同与两栖/水面编队近岛交战。',
    center: [123.5, 25.2],
    zoom: 7.0,
    redAnchor: [122.1, 25.2],
    blueAnchor: [124.9, 25.2],
    redHeading: 90,
    blueHeading: 270,
    defaultWeather: { condition: 'overcast', seaState: 4, cloudFloorM: 1600, cloudCeilingM: 5200 },
    environment: {
      landPolygons: [
        {
          id: 'skirmish_central_island',
          name: '中央主岛山地防区',
          elevationM: 450,
          areaPolygon: [[123.2, 24.9], [123.8, 24.9], [123.8, 25.5], [123.2, 25.5]],
        },
      ],
      acousticZones: [
        {
          id: 'skirmish_littoral_shallow',
          name: '群岛周边浅水区',
          kind: 'shallow',
          sonarRangeFactor: 0.8,
          areaPolygon: [[122.7, 24.5], [124.3, 24.5], [124.3, 25.9], [122.7, 25.9]],
        },
      ],
    },
  },
  inland_highland: {
    id: 'inland_highland',
    name: '内陆山地空地战区',
    subtitle: 'HIGHLAND CORRIDOR // AIR-LAND',
    description: '全陆地高海拔山脊走廊（850m 雷达遮蔽），适合陆基防空网、地面合成旅与制空/对陆编组交锋。',
    center: [104.5, 31.0],
    zoom: 6.8,
    redAnchor: [103.3, 31.0],
    blueAnchor: [105.7, 31.0],
    redHeading: 90,
    blueHeading: 270,
    defaultWeather: { condition: 'clear', seaState: 0, cloudFloorM: 2500, cloudCeilingM: 6500 },
    environment: {
      landPolygons: [
        {
          id: 'skirmish_west_plateau',
          name: '西侧内陆高原走廊',
          elevationM: 500,
          areaPolygon: [[102.0, 29.5], [104.1, 29.5], [104.1, 32.5], [102.0, 32.5]],
        },
        {
          id: 'skirmish_central_ridge',
          name: '中部高海拔山脊遮蔽带',
          elevationM: 850,
          areaPolygon: [[104.2, 30.2], [104.8, 30.2], [104.8, 31.8], [104.2, 31.8]],
        },
        {
          id: 'skirmish_east_basin',
          name: '东侧内陆防区',
          elevationM: 450,
          areaPolygon: [[104.9, 29.5], [107.2, 29.5], [107.2, 32.5], [104.9, 32.5]],
        },
      ],
      acousticZones: [],
    },
  },
};

export interface SkirmishOptions {
  theaterId: SkirmishTheaterId;
  redPackageIds: string[];
  bluePackageIds: string[];
  durationSec?: number;
  weatherCondition?: ScenarioWeather['condition'];
  seaState?: number;
  title?: string;
}

function buildSideSkirmishPlacements(
  side: SideId,
  packageIds: string[],
  anchor: [number, number],
  heading: number,
  parentGroupId: string,
  environment: ScenarioEnvironment,
  catalog: EquipmentCatalog
): InitialUnitPlacement[] {
  const placements: InitialUnitPlacement[] = [];
  const total = packageIds.length;
  packageIds.forEach((packageId, index) => {
    const offsetLatDeg = (index - (total - 1) / 2) * 0.35;
    const packageAnchor: [number, number] = [anchor[0], anchor[1] + offsetLatDeg];
    const generated = createForcePackagePlacements(
      packageId,
      {
        idPrefix: `skirmish_${side.toLowerCase()}_${index + 1}`,
        side,
        parentGroupId,
        position: packageAnchor,
        heading,
        environment,
      },
      catalog,
      ALL_SKIRMISH_FORCE_PACKAGES
    );
    for (const unit of generated) {
      const platform = catalog.platforms[unit.platformId];
      placements.push({
        ...unit,
        speedKts: platform.domain === 'land' ? 0 : platform.cruiseSpeedKts,
        doctrine: {
          roe: 'tight',
          emconRadar: false,
          emconSonar: false,
          emconJamming: false,
          autoEvade: true,
        },
      });
    }
  });
  return placements;
}

export function buildSkirmishScenario(
  options: SkirmishOptions,
  catalog: EquipmentCatalog = MASTER_EQUIPMENT_CATALOG
): ScenarioDefinition {
  const preset = SKIRMISH_THEATER_PRESETS[options.theaterId];
  if (!preset) throw new Error(`Unknown skirmish theater: ${options.theaterId}`);
  if (options.redPackageIds.length === 0 || options.bluePackageIds.length === 0) {
    throw new Error('Skirmish requires at least one force package for both RED and BLUE');
  }
  const durationSec = Math.max(600, Math.min(7200, Math.round(options.durationSec ?? 2400)));
  const weatherCondition = options.weatherCondition ?? preset.defaultWeather.condition;
  const seaState = (preset.id === 'inland_highland'
    ? 0
    : Math.max(0, Math.min(6, Math.round(options.seaState ?? preset.defaultWeather.seaState)))) as ScenarioWeather['seaState'];
  const environment: ScenarioEnvironment = {
    landPolygons: structuredClone(preset.environment.landPolygons),
    acousticZones: structuredClone(preset.environment.acousticZones),
    weather: {
      ...preset.defaultWeather,
      condition: weatherCondition,
      seaState,
    },
  };

  const redGroupId = 'skirmish_red_group';
  const blueGroupId = 'skirmish_blue_group';
  const redUnits = buildSideSkirmishPlacements(
    'RED',
    options.redPackageIds,
    preset.redAnchor,
    preset.redHeading,
    redGroupId,
    environment,
    catalog
  );
  const blueUnits = buildSideSkirmishPlacements(
    'BLUE',
    options.bluePackageIds,
    preset.blueAnchor,
    preset.blueHeading,
    blueGroupId,
    environment,
    catalog
  );

  const redNames = options.redPackageIds.map((id) => ALL_SKIRMISH_FORCE_PACKAGES[id]?.name ?? id).join(' + ');
  const blueNames = options.bluePackageIds.map((id) => ALL_SKIRMISH_FORCE_PACKAGES[id]?.name ?? id).join(' + ');
  const [cx, cy] = preset.center;
  const centerPolygon: [number, number][] = [
    [cx - 0.35, cy - 0.35],
    [cx + 0.35, cy - 0.35],
    [cx + 0.35, cy + 0.35],
    [cx - 0.35, cy + 0.35],
  ];

  const scenario: ScenarioDefinition = {
    id: `skirmish_${preset.id}_${Date.now().toString(36)}`,
    title: options.title?.trim() || `自由遭遇战 // ${preset.name}`,
    subtitle: preset.subtitle,
    theater: preset.name,
    difficulty: 'STANDARD',
    startTimeIso: '2027-09-01T06:00:00Z',
    initialCamera: {
      center: [...preset.center],
      zoom: preset.zoom,
      pitch: 0,
      bearing: 0,
    },
    briefing: {
      situation: `自定义遭遇战：红方【${redNames}】在${preset.name}与蓝方【${blueNames}】展开即时对抗。`,
      redObjective: '在时限内压制蓝方核心兵力并夺取战区主动权。',
      blueObjective: '在时限内遏制红方兵力推进并摧毁高价值目标。',
      tacticalTips: [
        preset.description,
        '双方均已开启有限交战授权（TIGHT）与雷达探测，可根据战场态势调整 EMCON 与航路点。',
      ],
    },
    environment,
    groups: [
      { id: redGroupId, name: '红方遭遇战特混编队', side: 'RED', commandTitle: 'RED TF', description: redNames },
      { id: blueGroupId, name: '蓝方遭遇战特混编队', side: 'BLUE', commandTitle: 'BLUE TF', description: blueNames },
    ],
    units: [...redUnits, ...blueUnits],
    missions: [],
    referencePoints: [
      { id: 'rp_skirmish_center', name: '交战中心基准点', side: 'NEUTRAL', position: [...preset.center], locked: true },
    ],
    events: [],
    victoryConditions: {
      durationSec,
      tacticalVictoryThreshold: 120,
      decisiveVictoryThreshold: 360,
    },
    objectives: [
      {
        id: 'skirmish_red_disable_lead',
        side: 'RED',
        title: `压制或摧毁蓝方核心 (${blueUnits[0].callsign})`,
        type: 'disable',
        unitIds: [blueUnits[0].id],
        required: true,
        points: 160,
      },
      {
        id: 'skirmish_red_control_center',
        side: 'RED',
        title: '控制战区中心交战区（累计保持 180 秒）',
        type: 'control_area',
        unitIds: [],
        areaPolygon: centerPolygon,
        holdDurationSec: 180,
        required: false,
        points: 100,
      },
      {
        id: 'skirmish_blue_disable_lead',
        side: 'BLUE',
        title: `压制或摧毁红方核心 (${redUnits[0].callsign})`,
        type: 'disable',
        unitIds: [redUnits[0].id],
        required: true,
        points: 160,
      },
      {
        id: 'skirmish_blue_control_center',
        side: 'BLUE',
        title: '控制战区中心交战区（累计保持 180 秒）',
        type: 'control_area',
        unitIds: [],
        areaPolygon: centerPolygon,
        holdDurationSec: 180,
        required: false,
        points: 100,
      },
    ],
  };

  return compileScenario(scenario, catalog).scenario;
}
