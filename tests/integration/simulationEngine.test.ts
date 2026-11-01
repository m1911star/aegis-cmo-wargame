import { describe, expect, test } from 'bun:test';
import {
  calculateRadarHorizonKm,
  calculateAspectEffectiveRcsM2,
  calculateEffectiveRadarRangeKm,
  calculateSonarDetectionRangeKm,
  evaluateBattleAssessment,
  stepSimulationWorld,
  getDistanceKm,
  type SimulationWorldState,
} from '../../src/engine/simulationEngine';
import {
  MASTER_EQUIPMENT_CATALOG,
  resolveEquipmentCatalog,
  validateCatalogIntegrity,
} from '../../src/catalog/equipmentCatalog';
import {
  SCENARIO_EAST_SEA_THUNDER,
  SCENARIO_DEEP_SEA_CARRIER_HUNT,
  instantiateScenarioUnits,
  validateAndParseScenarioJson,
  exportCurrentStateAsScenarioJson,
} from '../../src/scenarios/builtinScenarios';

describe('AEGIS-CMO // 物理公式与传感器视距测试 (Physics & Horizon Formulas)', () => {
  test('地球曲率雷达视距公式：水面舰艇对掠海导弹视距受限，高空预警机大幅扩展视距', () => {
    // 055驱逐舰天线架高 34m，探测 12m 超低空掠海反舰导弹
    const shipToSeaSkimmerKm = calculateRadarHorizonKm(0, 34, 12);
    expect(shipToSeaSkimmerKm).toBeGreaterThan(35);
    expect(shipToSeaSkimmerKm).toBeLessThan(42);

    // 空警-500 预警机在 9200m 高空，探测同一枚 12m 掠海导弹
    const awacsToSeaSkimmerKm = calculateRadarHorizonKm(9200, 0, 12);
    expect(awacsToSeaSkimmerKm).toBeGreaterThan(400);
    expect(awacsToSeaSkimmerKm).toBeGreaterThan(shipToSeaSkimmerKm * 9);

    // 水下 -180m 核潜艇对雷达完全不可见
    const radarToSubKm = calculateRadarHorizonKm(9200, 0, -180);
    expect(radarToSubKm).toBe(0);
  });

  test('RCS 四次方根探测折算与 VHF 反隐身米波雷达克制效应', () => {
    const xBandRadar = MASTER_EQUIPMENT_CATALOG.sensors.apg81_aesa;
    const vhfCounterStealth = MASTER_EQUIPMENT_CATALOG.sensors.land_jy27a_vhf;

    // 对普通 5.0 m² 目标 vs 0.005 m² 隐身战机 (高空无地球曲率瓶颈)
    const rangeNormalKm = calculateEffectiveRadarRangeKm(
      xBandRadar,
      5.0,
      10000,
      0,
      10000
    );
    const rangeStealthXBandKm = calculateEffectiveRadarRangeKm(
      xBandRadar,
      0.005,
      10000,
      0,
      10000
    );
    const rangeStealthVhfKm = calculateEffectiveRadarRangeKm(
      vhfCounterStealth,
      0.005,
      120,
      18,
      10000
    );

    expect(rangeNormalKm).toBeCloseTo(240, 0);
    // 0.005 m² 隐身目标使 X 波段雷达探测距离缩水至约 1/5.6 (~42.6 km)
    expect(rangeStealthXBandKm).toBeLessThan(50);
    // 而 VHF 反隐身米波雷达由于谐振效应仍可在 250km+ 距离发现隐身机
    expect(rangeStealthVhfKm).toBeGreaterThan(250);
  });

  test('水声声呐温跃层折射与主动声呐暴露效应', () => {
    const passiveTowed = MASTER_EQUIPMENT_CATALOG.sensors.towed_array_sonar;

    // 潜艇在深水 (-200m) 静默低速巡航，水面舰 (0m) 跨温跃层被动探测
    const quietAcrossThermoclineKm = calculateSonarDetectionRangeKm(
      passiveTowed,
      0,
      -200,
      95,
      8,
      false
    );

    // 同一潜艇在同深度 (-200m vs -190m) 且开启主动声呐 Ping
    const activePingRangeKm = calculateSonarDetectionRangeKm(
      passiveTowed,
      -190,
      -200,
      95,
      8,
      true
    );

    expect(activePingRangeKm).toBeGreaterThan(quietAcrossThermoclineKm * 3);
  });

  test('多向 RCS 剖面 (正前/侧向/尾向) 与有源电子干扰 (OECM) 烧穿距离压缩测试', () => {
    const j20Spec = MASTER_EQUIPMENT_CATALOG.platforms.j20_mighty_dragon;
    const xBandRadar = MASTER_EQUIPMENT_CATALOG.sensors.apg81_aesa;

    // 观察者在正东方 [125, 26]，目标在 [124, 26]
    // 1) 当歼-20 航向 90° (机头正对观察者，0°夹角) -> 正面隐身 RCS (~0.004 m²)
    const frontalRcs = calculateAspectEffectiveRcsM2(
      j20Spec,
      [125, 26],
      [124, 26],
      90,
      0
    );
    // 2) 当歼-20 航向 0° (正北飞行，侧翼 90° 暴露给观察者) -> 侧向 RCS (~0.14 m²)
    const beamRcs = calculateAspectEffectiveRcsM2(
      j20Spec,
      [125, 26],
      [124, 26],
      0,
      0
    );

    expect(frontalRcs).toBeLessThan(0.01);
    expect(beamRcs).toBeGreaterThan(frontalRcs * 20);

    // 3) 测试 OECM 有源电子压制对雷达探测距离的压缩
    const unjammedRangeKm = calculateEffectiveRadarRangeKm(
      xBandRadar,
      3.0,
      10000,
      0,
      10000,
      0
    );
    const jammedRangeKm = calculateEffectiveRadarRangeKm(
      xBandRadar,
      3.0,
      10000,
      0,
      10000,
      0.65 // 歼-16D / EA-18G 强伴随干扰
    );
    expect(jammedRangeKm).toBeLessThan(unjammedRangeKm * 0.65);
  });
});

describe('AEGIS-CMO // 想定 Schema、装备目录Overlay与序列化测试', () => {
  test('四层积木式装备数据库 (Sensors/Weapons/Loadouts/Platforms/Hangar) 引用完整性校验 100% 通过', () => {
    const report = validateCatalogIntegrity(MASTER_EQUIPMENT_CATALOG);
    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
    expect(Object.keys(MASTER_EQUIPMENT_CATALOG.loadouts).length).toBeGreaterThanOrEqual(8);
  });

  test('内置两大海陆空想定剧本成功实例化且所有平台/传感器/武器引用完备', () => {
    const units1 = instantiateScenarioUnits(SCENARIO_EAST_SEA_THUNDER);
    const units2 = instantiateScenarioUnits(SCENARIO_DEEP_SEA_CARRIER_HUNT);

    expect(Object.keys(units1).length).toBeGreaterThanOrEqual(14);
    expect(Object.keys(units2).length).toBeGreaterThanOrEqual(14);

    // 验证涵盖 air, surface, subsurface, land 四大作战域
    const domains = new Set(Object.values(units1).map((u) => u.domain));
    expect(domains.has('air')).toBe(true);
    expect(domains.has('surface')).toBe(true);
    expect(domains.has('subsurface')).toBe(true);
    expect(domains.has('land')).toBe(true);
  });

  test('支持自定义装备 Overlay 扩展与想定 JSON 导出及重新导入验证', () => {
    const units = instantiateScenarioUnits(SCENARIO_EAST_SEA_THUNDER);
    const exportedJson = exportCurrentStateAsScenarioJson(
      SCENARIO_EAST_SEA_THUNDER,
      units
    );
    const parsed = validateAndParseScenarioJson(exportedJson);
    expect(parsed.valid).toBe(true);
    expect(parsed.scenario?.units.length).toBe(Object.keys(units).length);

    // 测试自定义新装备 Overlay
    const customCatalog = resolveEquipmentCatalog({
      weapons: {
        custom_railgun: {
          id: 'custom_railgun',
          name: '电磁轨道炮高超音速弹丸',
          codeName: 'EMRG-2030',
          category: 'ashm',
          guidance: 'hypersonic_glide',
          targetDomains: ['surface', 'land'],
          canInterceptMissile: false,
          maxRangeKm: 320,
          minRangeKm: 5,
          speedKts: 4200,
          cruiseAltitudeM: 15000,
          basePk: 0.85,
          warheadDamage: 55,
          salvoDefault: 2,
          description: '自定义扩展武器测试',
        },
      },
    });
    expect(customCatalog.weapons.custom_railgun.maxRangeKm).toBe(320);
  });
});

describe('AEGIS-CMO // 半实时推演闭环测试 (Kinematics, Fog of War, Missile Combat)', () => {
  test('推演步进生成红蓝情报接触 (Contacts)、AOU 不确定区、自动防空与导弹交战', () => {
    const units = instantiateScenarioUnits(SCENARIO_EAST_SEA_THUNDER);
    const initialDist = getDistanceKm(
      units.red_j20_alpha.position,
      units.red_j20_alpha.waypoints[0].position
    );

    let world: SimulationWorldState = {
      startTime: Date.parse(SCENARIO_EAST_SEA_THUNDER.startTimeIso),
      simTime: Date.parse(SCENARIO_EAST_SEA_THUNDER.startTimeIso),
      units,
      contacts: {},
      weaponsInFlight: {},
      explosions: [],
      missions: SCENARIO_EAST_SEA_THUNDER.missions,
      events: SCENARIO_EAST_SEA_THUNDER.events,
      victoryConditions: SCENARIO_EAST_SEA_THUNDER.victoryConditions,
      score: {
        redLosses: 0,
        blueLosses: 0,
        redMissilesFired: 0,
        blueMissilesFired: 0,
        redInterceptions: 0,
        blueInterceptions: 0,
        redScore: 0,
        blueScore: 0,
        firedEventIds: [],
        sortiesLaunched: 0,
      },
    };

    // 连续推进 15 个 Tick (每个 Tick 5 秒，共 75 秒)
    let totalLogs = 0;
    for (let i = 0; i < 15; i++) {
      const res = stepSimulationWorld(
        world,
        MASTER_EQUIPMENT_CATALOG,
        5,
        {
          onNewContact: true,
          onMissileDetected: true,
          onUnitHitOrDestroyed: true,
        },
        'RED',
        () => 0.42 // 固定伪随机数保证测试可复现
      );
      world = res.nextState;
      totalLogs += res.newLogs.length;
    }

    // 1. 算子应当向航路点机动前进
    const afterDist = getDistanceKm(
      world.units.red_j20_alpha.position,
      world.units.red_j20_alpha.waypoints[0].position
    );
    expect(afterDist).toBeLessThan(initialDist);

    // 2. 红蓝双方应当通过预警机、相控阵雷达与 ESM 截获建立 Contact 情报接触
    const contactList = Object.values(world.contacts);
    expect(contactList.length).toBeGreaterThan(4);
    expect(
      contactList.some((c) => c.observerSide === 'RED' && c.targetSide === 'BLUE')
    ).toBe(true);
    expect(
      contactList.some((c) => c.observerSide === 'BLUE' && c.targetSide === 'RED')
    ).toBe(true);

    // 3. 应当产生交战与探测日志，且射程内单位已自动发射导弹
    expect(totalLogs).toBeGreaterThan(0);
    expect(
      world.score.redMissilesFired + world.score.blueMissilesFired
    ).toBeGreaterThan(0);

    // 4. 推演至 75 秒 (>60秒) 应当触发动态战役事件 `ev_kadena_scramble_60s` 并刷出嘉手纳增援 F-35C
    expect(world.score.firedEventIds).toContain('ev_kadena_scramble_60s');
    expect(world.units.blue_f35c_kadena_reinforce).toBeDefined();
  });

  test('Loadout 挂载方案切换、航母母舰机库 (Hangar) 弹射起飞与胜负评级测试', async () => {
    const { useWargameStore } = await import('../../src/store/useWargameStore');
    const store = useWargameStore.getState();

    // 1. 载入想定 02《深海猎杀》(包含红方003福建舰与蓝方CVN-73核航母)
    store.loadScenario(SCENARIO_DEEP_SEA_CARRIER_HUNT);
    const fujian = useWargameStore.getState().units.red_cv18_fujian;
    expect(fujian).toBeDefined();
    expect(fujian.hangar.length).toBeGreaterThanOrEqual(2);

    // 2. 从福建舰机库弹射第 1 波次歼-35 舰载隐身战斗机编队升空
    const unitCountBefore = Object.keys(useWargameStore.getState().units).length;
    store.launchCarrierAircraft(
      'red_cv18_fujian',
      'hangar_j35_vf1',
      'loadout_j35_maritime_strike'
    );
    const afterState = useWargameStore.getState();
    expect(Object.keys(afterState.units).length).toBe(unitCountBefore + 1);
    expect(afterState.score.sortiesLaunched).toBe(1);

    // 3. 切换回想定 01，测试歼-20A 从默认隐身制空挂载切换为霹雳-17超远程猎杀预警机挂载
    store.loadScenario(SCENARIO_EAST_SEA_THUNDER);
    store.switchUnitLoadout('red_j20_alpha', 'loadout_j20_awacs_hunter');
    const updatedJ20 = useWargameStore.getState().units.red_j20_alpha;
    expect(updatedJ20.activeLoadoutId).toBe('loadout_j20_awacs_hunter');
    expect(updatedJ20.mounts.some((m) => m.weaponId === 'pl17_ulraam')).toBe(
      true
    );

    // 4. 验证战役胜负评级函数
    const assessment = evaluateBattleAssessment(
      {
        ...afterState.score,
        redScore: 500,
        blueScore: 50,
      },
      SCENARIO_EAST_SEA_THUNDER.victoryConditions
    );
    expect(assessment.grade).toBe('RED_DECISIVE_VICTORY');
  });

  test('Zustand C2 Store 参谋作业指令测试：F3 航路点、F9 EMCON、F1 手动齐射与实时算子投放', async () => {
    const { useWargameStore } = await import('../../src/store/useWargameStore');
    const store = useWargameStore.getState();

    // 1. 切换想定 02《深海猎杀》并切回想定 01
    store.loadScenario(SCENARIO_DEEP_SEA_CARRIER_HUNT);
    expect(useWargameStore.getState().currentScenario.id).toBe(
      SCENARIO_DEEP_SEA_CARRIER_HUNT.id
    );
    store.loadScenario(SCENARIO_EAST_SEA_THUNDER);
    expect(useWargameStore.getState().currentScenario.id).toBe(
      SCENARIO_EAST_SEA_THUNDER.id
    );

    // 2. F3 航路点追加与清空
    store.clearUnitWaypoints('red_055_nanchang');
    expect(useWargameStore.getState().units.red_055_nanchang.waypoints.length).toBe(0);
    store.appendUnitWaypoint('red_055_nanchang', [124.0, 26.0]);
    expect(useWargameStore.getState().units.red_055_nanchang.waypoints.length).toBe(1);

    // 3. EMCON 雷达静默切换
    store.updateUnitDoctrine('red_055_nanchang', { emconRadar: false });
    expect(
      useWargameStore.getState().units.red_055_nanchang.doctrine.emconRadar
    ).toBe(false);

    // 4. F1 手动齐射鹰击-21高超音速反舰导弹打击蓝方伯克级驱逐舰
    const prevFired = useWargameStore.getState().score.redMissilesFired;
    store.executeManualEngage(
      'red_055_nanchang',
      'blue_ddg125_lucas',
      'yj21_hypersonic',
      2
    );
    expect(useWargameStore.getState().score.redMissilesFired).toBe(prevFired + 2);

    // 5. 实时算子投放器测试
    store.setPlayMode('sandbox');
    const beforeCount = Object.keys(useWargameStore.getState().units).length;
    store.startSpawnUnitOnMap({
      platformId: 'j20_mighty_dragon',
      side: 'RED',
      name: '歼-20A 测试增援小队',
      callsign: 'TEST-J20',
    });
    store.spawnUnitAtCoordinate([123.5, 26.5]);
    expect(Object.keys(useWargameStore.getState().units).length).toBe(
      beforeCount + 1
    );
  });
});
