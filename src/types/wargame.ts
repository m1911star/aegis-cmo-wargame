// ============================================================================
// AEGIS-CMO // 核心领域类型定义 v2.0 (4-Layer Modular Catalog + Dynamic Scenario Engine)
// 架构原则：
// 1. 四层积木式装备库：原子组件(Sensor/Weapon) -> 挂载方案(Loadout) -> 平台裸机(Platform) -> 母舰机库(Hangar)
// 2. 动态可编程想定：随机开局散布(Jitter/Probability) + 事件触发器(Trigger -> Condition -> Action) + 胜负评估
// ============================================================================

export type Domain = 'air' | 'surface' | 'subsurface' | 'land';
export type SideId = 'RED' | 'BLUE' | 'NEUTRAL';
export type ActivePerspective = SideId | 'GOD';
export type TimeScale = 0 | 1 | 5 | 15 | 60;
export type PlayMode = 'command' | 'sandbox';

export interface GuidanceProfile {
  activationRangeKm: number;
  seekerRangeKm: number;
  seekerFovDeg: number; // Full angle, not half-angle.
  searchDurationSec: number;
  maxTrackAgeSec: number;
  maxUncertaintyKm: number;
  receivesUpdates: boolean;
  requiresSupport: boolean;
}

export type UnitCategory =
  | 'fighter'         // 制空/多用途战斗机
  | 'stealth_fighter' // 第五代隐身战机
  | 'ew_aircraft'     // 专用电子战咆哮者/伴随干扰机
  | 'awacs'           // 空中预警指挥机
  | 'tanker'          // 空中加油机
  | 'bomber'          // 远程战略/战术轰炸机
  | 'mpa_uav'         // 反潜巡逻机 / 长航时高空侦察无人机
  | 'decoy'           // 空射诱饵/高仿真假目标
  | 'sonobuoy'        // 航空投掷主/被动声呐浮标 (DIFAR/DICASS)
  | 'carrier'         // 航空母舰 / 两栖攻击舰 (具备 Hangar 母舰放飞能力)
  | 'amphibious'      // 两栖登陆舰 / 船坞登陆舰
  | 'destroyer'       // 大型防空/多用途驱逐舰
  | 'frigate'         // 护卫舰
  | 'ssn'             // 攻击型核潜艇 / AIP常规潜艇
  | 'sam_battery'     // 远程防空反导营
  | 'asm_battery'     // 岸基反舰/高超音速弹道导弹营
  | 'ground_force'    // 陆军合成装甲/机械化突击营
  | 'airbase'         // 军用机场/航空兵基地 (具备 Hangar 放飞能力)
  | 'radar_site';     // 远程战略预警/超视距雷达站

export type SensorType =
  | 'radar_air_surface' // 现代有源相控阵对空/对海搜索雷达 (AESA/PESA)
  | 'radar_oth'         // 超视距/米波反隐身预警雷达
  | 'esm'               // 被动电子支援/雷达告警接收机 (RWR/ESM)
  | 'ecm_jammer'        // 大功率有源电子对抗干扰吊舱/系统 (OECM)
  | 'sonar_passive'     // 被动拖曳线列阵/舰壳声呐
  | 'sonar_active'      // 主动低频声呐
  | 'irst_optical';     // 红外光电搜索跟踪系统 (IRST/EO)

export type GuidanceType =
  | 'active_radar'      // 主动雷达末制导 + 双向数据链中继
  | 'semi_active_radar' // 半主动雷达制导
  | 'infrared'          // 红外成像制导
  | 'hypersonic_glide'  // 高超音速滑翔 + 复合末制导
  | 'acoustic_homing'   // 主被动声自导鱼雷
  | 'anti_radiation';   // 反辐射被动雷达导引 (专门猎杀开机雷达/预警机)

// ----------------------------------------------------------------------------
// LEVEL 1: 原子传感器与武器组件 (Atomic Sensors & Weapons)
// ----------------------------------------------------------------------------

export interface SensorSpec {
  id: string;
  name: string;
  codeName: string;
  type: SensorType;
  maxRangeKm: number;           // 对标准 RCS (5.0 m²) 或标准声源的基准探测距离
  isActiveEmitter: boolean;     // 是否主动辐射电磁波/声波（受 EMCON 管控）
  lookDownCapable: boolean;     // 是否具备下视抗海杂波能力
  detectDomains: Domain[];      // 可探测的目标域
  frequencyBand: string;        // 频段描述
  jammingPowerKw?: number;      // 若为电子战系统/AESA副瓣干扰，具备有源压制功率 (kW)
  coverageArcDeg?: number;      // 前向覆盖扇角 (10°~360°，默认 360° 全向)
  blindArcRearDeg?: number;     // 尾后推进器/挡音盲区角 (0°~180°，默认 0°)
  description: string;
}

export type WeaponFlightProfile =
  | 'cruise_flat'
  | 'sea_skimming'
  | 'ballistic_loft'
  | 'hypersonic_glide';

export interface WeaponSpec {
  id: string;
  name: string;
  codeName: string;
  category: 'aam' | 'sam' | 'ashm' | 'lacm' | 'torpedo' | 'arm';
  guidance: GuidanceType;
  targetDomains: Domain[];
  canInterceptMissile: boolean;
  maxRangeKm: number;
  minRangeKm: number;
  speedKts: number;             // 巡航/末端速度 (节，1马赫 ≈ 661节)
  cruiseAltitudeM: number;      // 典型飞行高度/潜深 (米)
  basePk: number;               // 基准命中概率 (0.0 - 1.0)
  warheadDamage: number;        // 毁伤值
  salvoDefault: number;         // 默认齐射发数 (WRA)
  flightProfile?: WeaponFlightProfile;
  interceptAltitudeBandM?: [number, number]; // 防空反导拦截射高包线 [最低米, 最高米]
  /**
   * Legacy catalog hint for midcourse support. GuidanceProfile defines actual capabilities.
   * Loss of optional support freezes/extrapolates the aimpoint; it is not a universal launch ban
   * or an arbitrary terminal Pk penalty after the seeker has independently acquired a target.
   */
  requiresDatalinkBeyondHorizon?: boolean;
  guidanceProfile?: Partial<GuidanceProfile>;
  launchMedium?: 'direct' | 'air_drop';
  airDropRangeKm?: number;
  airDropSpeedKts?: number;
  waterEntrySpeedKts?: number;
  waterEntryAltitudeM?: number;
  description: string;
}

// ----------------------------------------------------------------------------
// LEVEL 2: 战术挂载方案与配弹模板 (Tactical Loadouts & Magazine Profiles)
// ----------------------------------------------------------------------------

export interface PlatformMountTemplate {
  mountId: string;
  weaponId: string;
  maxAmmo: number;
  reloadTimeSec: number;
}

export interface LoadoutSpec {
  id: string;
  name: string;                 // 如 "歼-16 远程制空挂载 (PL-15×6 + PL-17×2)"
  codeName: string;             // 如 "CAP Long-Range BVR"
  role: 'aaw_cap' | 'asuw_strike' | 'sead_ew' | 'asw_patrol' | 'multi_mission';
  compatiblePlatformIds: string[]; // 适配的平台 ID 列表
  speedPenaltyKts?: number;     // 外挂重载导致的极速折损
  rcsPenaltyM2?: number;        // 外挂非隐身弹药导致的正面/侧面 RCS 增加量 (如F-35外挂野兽模式)
  combatRadiusMultiplier?: number; // 副油箱带来的续航时间倍率 (如 1.25)
  additionalSensorIds?: string[];  // 挂载的吊舱传感器 (如 KG-800 / ALQ-99 电子战吊舱)
  mounts: PlatformMountTemplate[];
  description: string;
}

// ----------------------------------------------------------------------------
// LEVEL 3: 多向 RCS 剖面、电子战特征与母舰机库定义 (Platform Hull & Hangar)
// ----------------------------------------------------------------------------

/**
 * ★ 核心扩展：全向雷达反射截面积剖面 (Aspect-Dependent RCS Profile)
 * 隐身战机仅机头正前方 ±35° 具备极低 RCS；侧向 (Beam) 与尾向 (Rear) RCS 显著增大
 */
export interface RcsAspectProfile {
  frontalM2: number;            // 机头/舰首正前方向 (0° ± 35°)
  beamM2: number;               // 正侧翼方向 (35° ~ 135°，通常为正面的 8~35 倍)
  rearM2: number;               // 尾喷口方向 (135° ~ 180°，通常为正面的 4~15 倍)
}

/**
 * ★ 核心扩展：母舰/基地搭载的舰载机中队槽位 (Embarked Aircraft Squadron Slot)
 */
export interface EmbarkedHangarSlot {
  slotId: string;
  squadronName: string;         // 如 "歼-35 舰载隐身战斗机1中队"
  platformId: string;           // 派出的子平台模板 ID (如 j35_carrier_stealth / f35c_lightning)
  defaultLoadoutId: string;     // 默认挂载方案 ID
  availableLoadoutIds: string[];// 起飞前可切换的挂载方案列表
  totalAirframes: number;       // 机库总架数/编队批次上限
  readyAirframes: number;       // 当前甲板待命可立即弹射批次
  launchCooldownSec: number;    // 波次放飞冷却时间 (秒)
  turnaroundSec?: number;        // 回收后完成加油/挂弹的整备时间；旧目录默认 launchCooldownSec × 4
  turnaroundSupplyBatches?: number; // 可供回收机再次出动的有限补给批次；旧目录默认 totalAirframes
}

export interface PlatformSpec {
  id: string;
  name: string;
  className: string;
  origin: string;
  domain: Domain;
  category: UnitCategory;
  defaultSidcRed: string;
  defaultSidcBlue: string;
  maxSpeedKts: number;
  cruiseSpeedKts: number;
  defaultAltitudeM: number;
  minAltitudeM: number;
  maxAltitudeM: number;
  radarAntennaHeightM: number;
  maxFuelSec: number;
  maxHp: number;
  rcsM2: number;                // 标称基准正面 RCS (向后兼容)
  rcsProfile?: RcsAspectProfile;// 多向 RCS 剖面（若未提供则由 rcsM2 自动推导）
  ecmStrength?: number;         // 有源电子对抗压制强度 (0.0 - 0.75，开启 ECM 时压制敌方雷达探测距离与导弹命中率)
  acousticSignatureDb: number;
  hasDatalink: boolean;
  maxGuidanceChannels?: number; // 同时制导/中继通道上限
  ciwsDefenseProb: number;
  sensorIds: string[];
  defaultLoadoutId?: string;    // 默认挂载方案 ID
  availableLoadoutIds?: string[]; // 支持切换的挂载方案列表
  mounts: PlatformMountTemplate[]; // Default payload; an explicit Loadout replaces it completely.
  hangarSlots?: EmbarkedHangarSlot[]; // 若为航母/两栖攻击舰/空军基地，可搭载并放飞舰载机！
  aarFuelCapacitySec?: number;
  aarTransferRateSecPerSec?: number;
  canReceiveAar?: boolean;
  deployables?: { platformId: string; count: number }[];
  description: string;
}

export interface EquipmentCatalog {
  version: string;
  sensors: Record<string, SensorSpec>;
  weapons: Record<string, WeaponSpec>;
  loadouts: Record<string, LoadoutSpec>;
  platforms: Record<string, PlatformSpec>;
}

// ----------------------------------------------------------------------------
// 2. 战场动态实例与条令 (Runtime Entities & Doctrine)
// ----------------------------------------------------------------------------

export type ROEStatus = 'free' | 'tight' | 'hold';
export type ThreatLevel = 'low' | 'medium' | 'high' | 'critical';

export interface UnitDoctrine {
  roe: ROEStatus;
  emconRadar: boolean;          // 主动雷达辐射开关
  emconSonar: boolean;          // 主动声呐 Ping 开关
  emconJamming: boolean;        // ★ 新增：有源电子干扰 (OECM) 压制开关
  autoEvade: boolean;
  engageOpportunityTargets: boolean;
  salvoSize: number;
  automaticFireRangeFraction: number;
  minimumWeaponReserve: number;
  automaticTargetDomains: Domain[];
  minimumAutomaticThreat: ThreatLevel;
  requireIdentifiedForAutoFire?: boolean;
  shootAndScoot?: boolean;
  bvrTactics?: 'standard' | 'crank_pump';
  baffleClearPeriodic?: boolean;
}

export interface RuntimeWeaponMount extends PlatformMountTemplate {
  weaponName: string;
  currentAmmo: number;
  cooldownRemainingSec: number;
}

export interface TurnaroundEntry {
  sortieId: string;
  previousLoadoutId?: string;
  readyAtSimTime: number;
}

export interface RuntimeHangarSlot {
  slotId: string;
  squadronName: string;
  platformId: string;
  selectedLoadoutId: string;
  availableLoadoutIds: string[];
  readyAirframes: number;
  totalAirframes: number;
  reserveAirframes: number;
  launchCooldownSec: number;
  cooldownRemainingSec: number;
  turnaroundSec: number;
  turnaroundSupplies: number;
  turnaroundQueue: TurnaroundEntry[];
  activeSortieIds: string[];
  nextSortieNumber: number;
}

export interface RouteLeg {
  position: [number, number];
  speedKts?: number;
  altitudeM?: number;
}

export interface CountermeasureInventory {
  chaff: number;
  flares: number;
  acousticDecoys: number;
  cooldownUntil: number;
}

export interface EvasionState {
  threatContactId: string;
  untilSimTime: number;
  resumeStatus: 'operational' | 'engaged';
  resumeNavigationMode?: RuntimeUnit['navigationMode'];
  resumeWaypoints: RouteLeg[];
  resumeMissionTargetId?: string;
  resumeMissionState?: RuntimeUnit['missionState'];
  resumeFormationLeaderId?: string;
  resumeFormationOffset?: RuntimeUnit['formationOffset'];
}

export interface AirRefuelState {
  tankerId: string;
  phase: 'rendezvous' | 'refueling';
  resumeNavigationMode?: RuntimeUnit['navigationMode'];
  resumeWaypoints: RouteLeg[];
  resumeMissionTargetId?: string;
  resumeMissionState?: RuntimeUnit['missionState'];
}

export interface RuntimeUnit {
  id: string;
  name: string;
  callsign: string;
  side: SideId;
  platformId: string;
  activeLoadoutId?: string;     // 当前挂载方案 ID
  hostCarrierId?: string;       // 若由航母/基地放飞，记录母舰 ID
  hostHangarSlotId?: string;
  recoveryPosition?: [number, number];
  navigationMode?: 'manual' | 'mission' | 'formation';
  formationLeaderId?: string;
  formationOffset?: { relativeBearingDeg: number; distanceKm: number };
  missionTargetId?: string;
  missionState?: 'ingress' | 'on_station' | 'engaging' | 'egress' | 'recovering';
  missionRouteIndex?: number;
  nextMissionDecisionTime?: number;
  returnReason?: 'fuel' | 'ammunition';
  coordinatedAttack?: { contactId: string; releaseAtSimTime: number };
  parentGroupId: string;
  domain: Domain;
  category: UnitCategory;
  sidc: string;

  position: [number, number];
  altitudeM: number;
  targetAltitudeM: number;
  heading: number;
  speedKts: number;
  targetSpeedKts: number;
  waypoints: RouteLeg[];

  hp: number;
  maxHp: number;
  fuelRemainingSec: number;
  maxFuelSec: number;
  status: 'operational' | 'engaged' | 'evading' | 'returning' | 'recovered' | 'destroyed';
  countermeasures: CountermeasureInventory;
  countermeasureEffect?: { chaff: boolean; flares: boolean; acoustic: boolean; expiresAtSimTime: number };
  evasionState?: EvasionState;
  baffleClearState?: {
    savedHeading: number;
    savedWaypoints: RouteLeg[];
    untilSimTime: number;
    nextAtSimTime: number;
  };
  aarFuelRemainingSec: number;
  aarQueue: string[];
  airRefuelState?: AirRefuelState;
  deployableInventory: Record<string, number>;
  deployedByUnitId?: string;
  completedWithdrawalObjectiveIds: string[];

  doctrine: UnitDoctrine;
  mounts: RuntimeWeaponMount[];
  weaponUsage: Record<string, { expended: number; cooldownUntil: number }>;
  hangar: RuntimeHangarSlot[];   // 母舰机库动态状态
  assignedMissionId?: string;
}

// 情报接触目标 (Contact)
export type ContactClassification = 'unknown' | 'classified' | 'identified';

export interface BearingObservation {
  sourceUnitId: string;
  origin: [number, number];
  bearingDeg: number;
  errorDeg: number;
  maxRangeKm: number;
}

export interface TacticalContact {
  id: string;
  actualUnitId: string;
  observerSide: SideId;
  targetSide: SideId;
  domain: Domain;
  classification: ContactClassification;
  identifiedCategory?: UnitCategory;
  displayName: string;
  sidc: string;
  estimatedPosition: [number, number];
  truePosition: [number, number];
  uncertaintyRadiusKm: number;
  uncertaintyKind?: 'circle' | 'bearing_corridor' | 'ellipse';
  uncertaintyPolygon?: [number, number][];
  bearingObservations?: BearingObservation[];
  heading: number;
  speedKts: number;
  altitudeM: number;
  firstDetectedTime: number;
  lastDetectedTime: number;
  detectedBySources: string[];
  sourceUnitIds?: string[];
  fireControlSourceIds?: string[];
  isJammingDetected?: boolean;  // 是否侦测到对方开启强电磁干扰
  emitterObserved?: boolean;    // 至少一个己方 ESM 来源当前实际截获了辐射
  lastEmitterDetectedTime?: number;
  threatLevel: ThreatLevel;
}

export interface WeaponInFlight {
  id: string;
  weaponId: string;
  name: string;
  side: SideId;
  shooterId: string;
  shooterName: string;
  targetId: string;
  targetType: 'unit' | 'missile' | 'area';
  position: [number, number];
  launchPosition: [number, number];
  trail: [number, number][];
  altitudeM: number;
  heading: number;
  speedKts: number;
  distanceRemainingKm: number;
  maxRangeKm: number;
  traveledKm: number;
  basePk: number;
  warheadDamage: number;
  requiresDatalinkBeyondHorizon?: boolean;
  datalinkSupported?: boolean;  // 当前帧是否获得己方预警机/雷达数据链中继支持
  isIntercepted?: boolean;
  aimPosition?: [number, number];
  aimHeading?: number;
  aimSpeedKts?: number;
  aimAltitudeM?: number;
  targetDomain?: Domain;
  lastTrackTime?: number;
  seekerState?: 'midcourse_datalink' | 'midcourse_blind' | 'terminal_searching' | 'terminal_locked' | 'lost';
  searchElapsedSec?: number;
  deliveryPhase?: 'air_drop' | 'water_search';
  waypoints?: [number, number][];
}

export interface PendingTotStrikeOrder {
  orderId: string;
  shooterId: string;
  contactId: string;
  weaponId: string;
  salvoCount: number;
  launchAtSimTime: number;
  plannedImpactSimTime: number;
  doglegWaypoints?: [number, number][];
}

export interface TacticalExplosionEffect {
  id: string;
  position: [number, number];
  type: 'hit' | 'destroy' | 'intercept' | 'miss' | 'launch';
  side: SideId;
  label: string;
  createdAtSimTime: number;
  radiusKm: number;
}

export interface ReferencePoint {
  id: string;
  name: string;
  side: SideId;
  position: [number, number];
  locked: boolean;
}

export type MissionType =
  | 'aaw_patrol'
  | 'asuw_patrol'
  | 'asw_patrol'
  | 'land_strike'
  | 'aew_support'
  | 'escort'
  | 'sead'
  | 'tanker_support';

export interface MissionDefinition {
  id: string;
  name: string;
  side: SideId;
  type: MissionType;
  isActive: boolean;
  areaPolygon: [number, number][];
  assignedUnitIds?: string[]; // Legacy input only; normalized to placement.assignedMissionId.
  prosecuteOutsideAreaKm: number;
  escortUnitId?: string;
  stationRadiusKm?: number;
  doctrineOverride?: Partial<UnitDoctrine>;
  description: string;
}

export interface TacticalMission extends MissionDefinition {
  assignedUnitIds: string[]; // Derived from RuntimeUnit.assignedMissionId, never authoritative.
}

export interface OrbatGroup {
  id: string;
  name: string;
  side: SideId;
  commandTitle: string;
  description: string;
}

// ----------------------------------------------------------------------------
// 3. 动态可编程想定 Schema (Scenario Events: Trigger -> Condition -> Action)
// ----------------------------------------------------------------------------

export interface InitialUnitPlacement {
  id: string;
  name: string;
  callsign: string;
  side: SideId;
  platformId: string;
  loadoutId?: string;           // 可选：指定该单位开局采用的 Loadout 挂载方案！
  parentGroupId: string;
  position: [number, number];
  /**
   * ★ 核心扩展：开局随机散布半径 (km) 与出现概率 (0.0 - 1.0)
   * 用于潜艇伏击区、机动导弹发射车或游弋航母，防止玩家背板
   */
  spawnJitterKm?: number;
  appearProbability?: number;
  altitudeM?: number;
  heading: number;
  speedKts?: number;
  waypoints?: Array<[number, number] | RouteLeg>;
  doctrine?: Partial<UnitDoctrine>;
  assignedMissionId?: string;
  recoveryPosition?: [number, number];
}

export type ScenarioEventTrigger =
  | {
      type: 'TIME_ELAPSED';
      elapsedSec: number;       // 开战后经过多少秒触发
    }
  | {
      type: 'UNIT_DESTROYED';
      unitId?: string;          // 指定关键单元 ID 被击毁（如石垣岛防空阵地或CVN航母）
      targetSide?: SideId;
      targetCategory?: UnitCategory;
    }
  | {
      type: 'UNIT_DETECTED';
      observerSide: SideId;
      targetUnitId?: string;
      targetCategory?: UnitCategory; // 仅在 identifiedCategory 已知时匹配
      targetDomain?: Domain;
      minimumClassification?: ContactClassification;
    }
  | {
      type: 'UNIT_ENTERS_AREA';
      side: SideId;
      unitCategory?: UnitCategory;
      areaPolygon: [number, number][]; // 任意满足条件的算子进入多边形区域
    };

export type ScenarioEventAction =
  | {
      type: 'SPAWN_REINFORCEMENTS';
      units: InitialUnitPlacement[]; // 动态刷出第二波次增援机群/潜艇/特遣队
    }
  | {
      type: 'ACTIVATE_MISSION';
      missionId: string;
      isActive: boolean;
    }
  | {
      type: 'UPDATE_SIDE_DOCTRINE';
      side: SideId;
      groupId?: string;
      doctrinePatch: Partial<UnitDoctrine>;
    }
  | {
      type: 'LAUNCH_SORTIE';
      carrierUnitId: string;
      hangarSlotId: string;
      loadoutId?: string;
      assignedMissionId?: string;
      launchDelaySec?: number;
    }
  | {
      type: 'DEPLOY_CARRIED';
      launcherUnitId: string;
      platformId: string;
      count?: number;
      targetWaypoint?: [number, number];
      assignedMissionId?: string;
    }
  | {
      type: 'ASSIGN_MISSION';
      side: SideId;
      unitId?: string;
      groupId?: string;
      missionId?: string;
    }
  | {
      type: 'TOGGLE_SIDE_EMCON';
      side: SideId;
      groupId?: string;
      sensor: 'radar' | 'sonar' | 'jamming';
    }
  | {
      type: 'COORDINATE_ATTACK';
      side: SideId;
      groupId?: string;
      targetDomain?: Domain;
      delaySec: number;
    }
  | {
      type: 'BROADCAST_MESSAGE';
      side: SideId | 'SYSTEM';
      severity: 'info' | 'warning' | 'critical';
      title: string;
      message: string;
      position?: [number, number];
    }
  | {
      type: 'AWARD_SCORE';
      side: SideId;
      points: number;
      reason: string;
    };

export interface ScenarioEventRule {
  id: string;
  name: string;
  description: string;
  repeatable?: boolean;
  repeatIntervalSec?: number; // Required for repeatable TIME_ELAPSED rules.
  trigger: ScenarioEventTrigger;
  actions: ScenarioEventAction[];
}

export interface PendingSortieOrder {
  orderId: string;
  eventId: string;
  carrierUnitId: string;
  hangarSlotId: string;
  loadoutId?: string;
  assignedMissionId?: string;
  earliestLaunchTime: number;
  attempts: number;
  status: 'pending' | 'failed';
  failureReason?: string;
}

export interface RuntimeScenarioEvent extends ScenarioEventRule {
  hasFired?: boolean;
  fireCount?: number;
  matchedUnitIds?: string[];
}

export interface VictoryConditionRule {
  durationSec: number;          // 想定标准推演时长 (秒)
  decisiveVictoryThreshold: number; // 净胜分 >= 此值判定决定性胜利
  tacticalVictoryThreshold: number; // 净胜分 >= 此值判定战术胜利
  keyTargetBonuses?: {
    unitId?: string;
    category?: UnitCategory;
    victimSide: SideId;
    bonusPoints: number;
    label: string;
  }[];
}

export interface ScenarioObjective {
  id: string;
  side: 'RED' | 'BLUE';
  title: string;
  type: 'destroy' | 'disable' | 'preserve' | 'observe' | 'withdraw' | 'control_area';
  unitIds: string[];
  areaPolygon?: [number, number][];
  controlDomains?: Domain[];
  holdDurationSec?: number;
  required: boolean;
  points: number;
  criticalFailure?: boolean;
  preserveCapability?: boolean;
  withdrawAreaPolygon?: [number, number][];
  withdrawUnitDomains?: Domain[];
}

export type ObjectiveProgress = Record<string, 'pending' | 'achieved' | 'failed'>;
export type ObjectiveHoldProgress = Record<string, number>;
export interface BattleResult {
  endedAt: number;
  reason: 'time_limit' | 'critical_objective';
  outcomes: Record<'RED' | 'BLUE', 'victory' | 'costly_victory' | 'defeat' | 'draw'>;
}

export interface EnvironmentPolygon {
  id: string;
  name: string;
  areaPolygon: [number, number][];
  elevationM?: number;
}

export interface AcousticZone extends EnvironmentPolygon {
  kind: 'shallow' | 'deep';
  sonarRangeFactor: number;
}

export interface ScenarioEnvironment {
  landPolygons: EnvironmentPolygon[];
  acousticZones: AcousticZone[];
}

export interface ScenarioDefinition {
  id: string;
  title: string;
  subtitle: string;
  theater: string;
  difficulty: 'STANDARD' | 'HARD' | 'EXTREME';
  startTimeIso: string;
  initialCamera: {
    center: [number, number];
    zoom: number;
    pitch?: number;
    bearing?: number;
  };
  briefing: {
    situation: string;
    redObjective: string;
    blueObjective: string;
    tacticalTips: string[];
  };
  groups: OrbatGroup[];
  units: InitialUnitPlacement[];
  missions: MissionDefinition[];
  referencePoints: ReferencePoint[];
  environment?: ScenarioEnvironment;
  events?: ScenarioEventRule[]; // ★ 动态事件触发器列表
  victoryConditions?: VictoryConditionRule; // ★ 胜负评估规则
  objectives?: ScenarioObjective[];
  customCatalogOverlay?: Partial<EquipmentCatalog>;
}

// ----------------------------------------------------------------------------
// 4. 战报日志与统计指标 (Combat Logs & Telemetry)
// ----------------------------------------------------------------------------

export type CombatLogCategory =
  | 'DETECTION'
  | 'LAUNCH'
  | 'INTERCEPT'
  | 'HIT'
  | 'DESTROYED'
  | 'DOCTRINE'
  | 'EVENT'         // ★ 新增：战役脚本触发事件 (援军抵达/参谋部急电/阶段转换)
  | 'SYSTEM';

export type AarEventKind = 'launch' | 'hit' | 'intercept' | 'loss' | 'sortie' | 'recovery' | 'turnaround' | 'hangar_loss' | 'miss';

export interface CombatLogEntry {
  id: string;
  simTime: number;
  side: SideId | 'SYSTEM';
  category: CombatLogCategory;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  position?: [number, number];
  unitId?: string;
  contactId?: string;
  weaponId?: string;
  targetUnitId?: string;
  quantity?: number;
  aarType?: AarEventKind;
  aarSide?: SideId;
  aarShooterId?: string;
  aarOutcome?: 'hit' | 'destroy' | 'intercept' | 'softkill' | 'miss';
}

export interface AarEventRecord {
  id: string;
  tick: number;
  simTime: number;
  side: SideId | 'SYSTEM';
  kind: AarEventKind;
  title: string;
  unitId?: string;
  targetUnitId?: string;
  weaponId?: string;
  quantity: number;
  shooterId?: string;
  outcome?: 'hit' | 'destroy' | 'intercept' | 'softkill' | 'miss';
}

export interface AarTrackSample {
  tick: number;
  simTime: number;
  unitId: string;
  side: SideId;
  position: [number, number];
  altitudeM: number;
  status: RuntimeUnit['status'];
}

export interface BattleAarLedger {
  events: AarEventRecord[];
  tracks: AarTrackSample[];
}

export interface AutoPauseSettings {
  onNewContact: boolean;
  onMissileDetected: boolean;
  onUnitHitOrDestroyed: boolean;
}

export type BattleAssessmentGrade =
  | 'RED_DECISIVE_VICTORY'
  | 'RED_TACTICAL_VICTORY'
  | 'STRATEGIC_DRAW'
  | 'BLUE_TACTICAL_VICTORY'
  | 'BLUE_DECISIVE_VICTORY';

export interface ScoreLedger {
  redLosses: number;
  blueLosses: number;
  redMissilesFired: number;
  blueMissilesFired: number;
  redInterceptions: number;
  blueInterceptions: number;
  redScore: number;
  blueScore: number;
  firedEventIds: string[];      // 已触发的动态战役事件 ID 列表
  sortiesLaunched: number;      // 母舰/基地累计放飞舰载机波次
}
