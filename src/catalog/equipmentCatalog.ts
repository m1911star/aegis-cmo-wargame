// 向后兼容桥接层：所有模块统一指向 src/db 四层积木式装备数据库
export {
  MODULAR_SENSORS as DEFAULT_SENSORS,
} from '../db';
export {
  MODULAR_WEAPONS as DEFAULT_WEAPONS,
} from '../db';
export {
  MODULAR_LOADOUTS as DEFAULT_LOADOUTS,
} from '../db';
export {
  MODULAR_PLATFORMS as DEFAULT_PLATFORMS,
  MASTER_EQUIPMENT_CATALOG,
  resolveEquipmentCatalog,
  resolveUnitConfiguration,
  validateCatalogIntegrity,
} from '../db/index';
