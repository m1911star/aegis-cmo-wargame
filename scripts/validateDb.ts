import {
  MASTER_EQUIPMENT_CATALOG,
  validateCatalogIntegrity,
} from '../src/db/index';
import {
  BUILTIN_SCENARIOS,
  instantiateScenarioUnits,
} from '../src/scenarios/builtinScenarios';

console.log('=== AEGIS-CMO // 4-Layer Modular Catalog & Scenario Validator ===');

const integrity = validateCatalogIntegrity(MASTER_EQUIPMENT_CATALOG);
if (!integrity.valid) {
  console.error('❌ 装备库引用完整性校验失败:', integrity.errors);
  process.exit(1);
}

console.log(
  `✓ 装备库 [${MASTER_EQUIPMENT_CATALOG.version}] 校验通过：` +
    `${Object.keys(MASTER_EQUIPMENT_CATALOG.platforms).length} 型平台 | ` +
    `${Object.keys(MASTER_EQUIPMENT_CATALOG.loadouts).length} 套战术挂载(Loadouts) | ` +
    `${Object.keys(MASTER_EQUIPMENT_CATALOG.weapons).length} 型武器 | ` +
    `${Object.keys(MASTER_EQUIPMENT_CATALOG.sensors).length} 型传感器 | ` +
    `${Object.keys(MASTER_EQUIPMENT_CATALOG.mounts ?? {}).length} 型发射架(Mounts) | ` +
    `${Object.keys(MASTER_EQUIPMENT_CATALOG.warheads ?? {}).length} 型战斗部(Warheads) | ` +
    `${Object.keys(MASTER_EQUIPMENT_CATALOG.propulsions ?? {}).length} 型推进系统`
);

for (const sc of BUILTIN_SCENARIOS) {
  const units = instantiateScenarioUnits(sc);
  const carrierCount = Object.values(units).filter(
    (u) => u.hangar && u.hangar.length > 0
  ).length;
  console.log(
    `✓ 想定 [${sc.id}] 校验通过：${Object.keys(units).length} 个初始算子 | ` +
      `${sc.events?.length || 0} 条动态触发器事件 | ${carrierCount} 艘搭载机库母舰`
  );
}
