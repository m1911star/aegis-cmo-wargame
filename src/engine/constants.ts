// ============================================================================
// AEGIS-CMO // 物理常数与配置参数集中定义
// ============================================================================

// ---------------------------------------------------------------------------
// 雷达探测物理常数
// ---------------------------------------------------------------------------

/** 标准四代机基准 RCS (m²) */
export const REFERENCE_RCS_M2 = 5.0;

/** 地球曲率雷达视距公式系数 (km/√m) */
export const EARTH_CURVATURE_COEFFICIENT = 4.12;

/** RCS 姿态角区间阈值 (度) */
export const RCS_ASPECT_ANGLE = {
  /** 正前方隐身最优区上限 */
  FRONTAL_MAX: 35,
  /** 侧向强反射区上限 */
  BEAM_MAX: 135,
  /** 侧向峰值角度 (用于平滑过渡) */
  BEAM_PEAK: 85,
  /** 过渡区半宽 */
  TRANSITION_HALF_WIDTH: 55,
} as const;

/** 电子战压制系数 */
export const ECM_SUPPRESSION = {
  /** 最大雷达烧穿距离压缩比例 */
  MAX_BURN_THROUGH_REDUCTION: 0.65,
  /** 米波/数字阵列雷达抗干扰加成 */
  COUNTER_STEALTH_ECCM_BONUS: 0.35,
  /** 干扰压制后最小探测距离保留比例 */
  MIN_DETECTION_RATIO: 0.35,
} as const;

/** 海杂波下视能力折算 */
export const SEA_CLUTTER_FACTOR = 0.65;

/** 米波反隐身雷达最小有效 RCS (m²) */
export const COUNTER_STEALTH_MIN_RCS = 0.35;

// ---------------------------------------------------------------------------
// 声呐探测物理常数
// ---------------------------------------------------------------------------

/** 温跃层深度阈值 (米，负值表示水下) */
export const THERMOCLINE = {
  /** 温跃层上界 (约 -90m) */
  UPPER_BOUNDARY: -90,
  /** 温跃层下界 (约 -140m) */
  LOWER_BOUNDARY: -140,
  /** 跨温跃层探测折算系数 (默认) */
  CROSS_LAYER_FACTOR: 0.68,
  /** 舰壳声呐跨温跃层衰减系数 */
  HULL_CROSS_LAYER_FACTOR: 0.48,
  /** 拖曳阵/吊放/浮标等变深声呐跨温跃层衰减系数 */
  VARIABLE_DEPTH_CROSS_LAYER_FACTOR: 0.82,
  /** 同处深水层(温跃层下方)声道增益 */
  SAME_DEEP_LAYER_BONUS: 1.05,
} as const;

/** 主动声呐探测主动雷达目标的探测距离加成 */
export const ACTIVE_SONAR_PING_BONUS = 1.65;

/** 声呐探测计算参数 */
export const SONAR_DETECTION = {
  /** 基准声学强度 (dB) */
  BASELINE_ACOUSTIC_DB: 75,
  /** 声学强度归一化系数 */
  ACOUSTIC_NORMALIZATION: 40,
  /** 最小声学折算因子 */
  MIN_ACOUSTIC_FACTOR: 0.35,
  /** 航速噪声阈值 (节) */
  SPEED_NOISE_THRESHOLD: 10,
  /** 航速噪声系数 (非线性空化增益) */
  SPEED_NOISE_COEFFICIENT: 0.018,
  /** 航速噪声非线性指数 */
  SPEED_NOISE_EXPONENT: 1.5,
} as const;

// ---------------------------------------------------------------------------
// 导弹制导参数
// ---------------------------------------------------------------------------

/** 导弹制导配置默认值 */
export const GUIDANCE_DEFAULTS = {
  /** 声自导鱼雷导引头激活距离 (km) */
  ACOUSTIC_ACTIVATION_RANGE: 10,
  /** 红外制导激活距离 (km) */
  INFRARED_ACTIVATION_RANGE: 25,
  /** 主动雷达制导激活距离 (km) */
  ACTIVE_RADAR_ACTIVATION_RANGE: 35,
  /** 声自导鱼雷导引头搜索距离 (km) */
  ACOUSTIC_SEEKER_RANGE: 8,
  /** 红外导引头搜索距离 (km) */
  INFRARED_SEEKER_RANGE: 20,
  /** 主动雷达导引头搜索距离 (km) */
  ACTIVE_RADAR_SEEKER_RANGE: 30,
  /** 声自导鱼雷导引头视场角 (度) */
  ACOUSTIC_FOV: 120,
  /** 通用导引头视场角 (度) */
  DEFAULT_FOV: 90,
  /** 声自导鱼雷搜索持续时间 (秒) */
  ACOUSTIC_SEARCH_DURATION: 180,
  /** 通用搜索持续时间 (秒) */
  DEFAULT_SEARCH_DURATION: 45,
  /** 最大航迹陈旧时间 (秒) */
  MAX_TRACK_AGE: 5,
  /** 声自导鱼雷最大目标不确定半径 (km) */
  ACOUSTIC_MAX_UNCERTAINTY: 4,
  /** 通用最大目标不确定半径 (km) */
  DEFAULT_MAX_UNCERTAINTY: 8,
} as const;

// ---------------------------------------------------------------------------
// 单位转换常数
// ---------------------------------------------------------------------------

/** 节 (knots) 转换为 千米/小时 (km/h) */
export const KTS_TO_KMPH = 1.852;

/** 毫秒转秒 */
export const MS_TO_SEC = 1000;

// ---------------------------------------------------------------------------
// 低空飞行阈值
// ---------------------------------------------------------------------------

/** 低空海杂波影响高度阈值 (米) */
export const LOW_ALTITUDE_THRESHOLD = 50;

/** 最小低空高度 (米，用于下视能力判断) */
export const MIN_LOW_ALTITUDE = 0;
