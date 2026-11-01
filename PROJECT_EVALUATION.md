# AEGIS-CMO 兵棋推演系统 - 独立技术评估报告

> **历史基线说明（2026-10-31）**：本文是产品化实施前的独立评估，行数、测试数量和缺口清单不代表当前状态。已完成能力与最终门禁见 `docs/FINAL_VERIFICATION.md`。

**评估日期**: 2026-10-29
**项目规模**: ~11,900 行代码（TS/TSX: 10,554 行）
**技术栈**: Bun + React 19 + TypeScript + Zustand + MapLibre GL + Turf.js

---

## 执行摘要

AEGIS-CMO 是一个**野心与执行力兼具**的现代海陆空联合作战半实时兵棋推演系统。项目在 **架构设计、物理建模和工程质量** 三个维度上均达到了令人印象深刻的水准，但在 **测试覆盖、文档完整性和可维护性** 方面仍有改进空间。

**综合评级**: **A- (88/100)**

---

## 一、架构设计 (95/100) ⭐⭐⭐⭐⭐

### 1.1 分层架构清晰且合理

```
types/         ← 领域模型定义（4层装备库抽象）
  └─ wargame.ts (589行)
db/            ← 装备数据库（Sensors → Weapons → Loadouts → Platforms）
  ├─ sensors/
  ├─ weapons/
  ├─ loadouts/
  └─ platforms/
engine/        ← 核心物理与交战裁决引擎（12个模块）
  ├─ simulationEngine.ts  (978行) ← 主推演循环
  ├─ sensors.ts           (550行) ← 雷达视距/RCS/声呐
  ├─ fireControl.ts       (80行)  ← 火控解算
  ├─ guidance.ts                   ← 导弹制导逻辑
  ├─ geometry.ts                   ← 地球几何工具
  └─ ...
scenarios/     ← 想定定义与编译（支持自定义叠加）
store/         ← Zustand 全局状态管理（订阅优化）
components/    ← React UI 组件（7个）
map/           ← MapLibre GL WebGL 渲染层
```

**优点**:
- **关注点分离优秀**: 物理引擎(`engine/`)、数据模型(`db/`)、视图层(`components/`)完全解耦
- **模块化装备库**: 四层积木式设计（Sensor → Weapon → Loadout → Platform）实现了高度可扩展性，支持在想定 JSON 中无代码声明新装备
- **事件驱动架构**: 想定系统支持动态触发器（`Trigger → Condition → Action`），胜负评估与战役评级设计合理

**改进建议**:
- `simulationEngine.ts` (978行) 已成为 God Object，建议拆分为 `worldStepper.ts` + `collisionResolver.ts` + `damageCalculator.ts`
- `types/wargame.ts` (589行) 包含 50+ 接口定义，可考虑按领域拆分为 `types/{equipment,scenario,runtime,ui}.ts`

---

## 二、物理建模真实性 (92/100) ⭐⭐⭐⭐⭐

### 2.1 核心物理公式实现

项目实现了**军事仿真领域的关键真实物理模型**：

#### ✅ 地球曲率雷达视距公式
```typescript
// src/engine/geometry.ts
export function calculateRadarHorizonKm(
  observerAltM: number,
  observerAntennaM: number,
  targetAltM: number
): number {
  const h1 = Math.max(0, observerAltM + observerAntennaM);
  const h2 = Math.max(0, targetAltM);
  const d1 = 4.12 * Math.sqrt(h1);  // 地球曲率修正系数
  const d2 = 4.12 * Math.sqrt(h2);
  return d1 + d2;
}
```
**评价**: 准确复现了 12 米超低空掠海导弹突破舰载雷达视距盲区的战术机制。

#### ✅ RCS 四次方根探测折算与姿态角修正
```typescript
// src/engine/sensors.ts
export function calculateAspectEffectiveRcsM2(
  targetSpec: PlatformSpec,
  observerPosition: [number, number],
  targetPosition: [number, number],
  targetHeadingDeg: number,
  loadoutRcsPenaltyM2 = 0
): number {
  // 正前方 (0°~35°): frontalM2 (隐身最优)
  // 正侧向 (35°~135°): beamM2 (RCS 暴增 15~35 倍)
  // 尾喷口 (135°~180°): rearM2
  const aspectAngleDeg = ...;
  return baseRcs + loadoutRcsPenaltyM2;
}
```
**评价**: 模拟了五代隐身机正面 0.005 m² RCS 对 X 波段雷达的压缩效应，以及侧翼暴露时的强反射。

#### ✅ 水下温跃层与声呐遮蔽
```typescript
// src/engine/sensors.ts:104-120
const acrossThermocline =
  (observerAltM > -90 && targetAltM < -140) ||
  (observerAltM < -140 && targetAltM > -90);
const thermoclineFactor = acrossThermocline ? 0.68 : 1.0;
```
**评价**: 准确复现了 -120m 温跃层对水面声呐的遮蔽效应。

#### ✅ 电子战与 EMCON 管控
- 有源电子对抗（ECM/Jamming）压制雷达烧穿距离
- 电磁管控（EMCON）开关控制主动辐射设备
- 战争迷雾（Contacts & AOU 不确定性多边形）

**缺失**:
- ❌ 缺少大气折射对雷达探测的影响（尤其是海面波导层）
- ❌ 海况/天气对声呐性能的影响未建模
- ❌ 电子支援措施（ESM）被动截获距离公式过于简化

---

## 三、工程质量 (85/100) ⭐⭐⭐⭐

### 3.1 类型安全 ✅

```bash
$ tsc -b && vite build
✓ 2034 modules transformed.
✓ built in 2.81s
```

- **严格模式启用**: `"strict": true`，无 `any` 逃逸（仅 scripts/ 中有 4 处）
- **接口定义完整**: 50+ 接口覆盖装备、想定、运行时状态
- **类型推导准确**: 利用 TS 联合类型与判别联合实现类型安全的状态机

### 3.2 测试覆盖 ⚠️ (68/100)

```bash
$ bun test
 72 pass, 0 fail, 351 expect() calls
 Ran 72 tests across 3 files. [468ms]
```

**已覆盖**:
- ✅ 物理公式单元测试（雷达视距、RCS 折算、声呐探测）
- ✅ 装备目录完整性校验（外键引用、挂载兼容性）
- ✅ 想定序列化与边界验证（坐标、概率、重复 ID）
- ✅ 推演闭环测试（单位实例化、事件触发、任务分配）

**未覆盖**:
- ❌ UI 组件无测试（7 个 TSX 组件，0 测试）
- ❌ 火控解算逻辑缺乏边界用例（`fireControl.ts` 仅被集成测试调用）
- ❌ 导弹制导与拦截逻辑无专项测试
- ❌ MapLibre GL 渲染层无快照测试

**建议**: 优先为 `fireControl.ts` 和 `guidance.ts` 补充单元测试，目标覆盖率 80%+。

### 3.3 代码质量

**优点**:
- **命名清晰**: `calculateRadarHorizonKm`、`evaluateFireControl`、`buildAouPolygon` 等函数名准确表达意图
- **注释适度**: 关键物理公式附有简洁注释（如 `REFERENCE_RCS_M2 = 5.0 // 标准四代机基准`）
- **无技术债标记**: 0 个 `TODO/FIXME/HACK`
- **无调试残留**: 仅 scripts/ 中有 4 处 `console.log`

**改进空间**:
- 魔法数字未提取为常量（如 `0.68`、`4.12`、`-120` 等物理常数应提取到配置文件）
- `src/map/TacticalMapCanvas.tsx` (1228行) 过长，建议拆分为子组件

---

## 四、性能优化 (90/100) ⭐⭐⭐⭐⭐

### 4.1 渲染性能优化

```typescript
// src/store/useWargameStore.ts
export const useWargameStore = create<WargameStoreState>()(
  subscribeWithSelector((set, get) => { ... })
);

// src/map/TacticalMapCanvas.tsx:14
// 架构亮点：通过 Zustand subscribe 直推 GeoJSON Source，60FPS 零 React VDOM 重绘抖动
```

**优点**:
- ✅ 使用 `subscribeWithSelector` 精细订阅，避免高频仿真步进触发 React 全树重绘
- ✅ MapLibre GL GeoJSON 数据源直接更新，绕过 React Virtual DOM
- ✅ WebGL 渲染层与 React 组件层解耦

**数据支撑**:
- 构建产物 gzip 后 622KB（主包 136KB + MapLibre 285KB + Turf 181KB）
- 手动 chunk 分割合理（vendor-maplibre / vendor-turf-milsymbol / vendor-react）

**改进建议**:
- `useMemo`/`useCallback` 使用不足（仅 3 处），可能存在不必要的闭包重建
- 考虑使用 `React.memo` 包裹纯展示组件（如 `TopCommandHeader`）

---

## 五、可维护性 (78/100) ⭐⭐⭐⭐

### 5.1 文档

**现有文档**:
- ✅ `README.md`: 清晰的快速启动指南与核心特性说明
- ✅ 行内注释: 关键物理公式有注释
- ❌ 缺少 API 文档: `engine/` 模块无导出函数说明
- ❌ 缺少架构文档: 无 ADR（Architecture Decision Records）
- ❌ 缺少部署指南

### 5.2 依赖管理

```json
{
  "dependencies": {
    "react": "^19.0.0",              // ⚠️ React 19 尚处于 RC 阶段
    "maplibre-gl": "^5.1.0",
    "@turf/turf": "^7.2.0",
    "zustand": "^5.0.3",
    "milsymbol": "^2.2.0"
  }
}
```

**风险**:
- ⚠️ React 19 尚未正式发布，可能存在 breaking changes
- ✅ 其他依赖均为稳定版本

### 5.3 Git 提交历史

```bash
$ git log --oneline
22c163d feat(gameplay): make tactical decisions bounded and reproducible
87d6d14 Initial commit: AEGIS-CMO wargame
```

**评价**: 仅 2 次提交，无法评估长期开发习惯。建议建立 Conventional Commits 规范。

---

## 六、创新性与业务价值 (94/100) ⭐⭐⭐⭐⭐

### 6.1 差异化竞争力

| 维度 | AEGIS-CMO | Command: Modern Operations (CMO) |
|------|-----------|-----------------------------------|
| 平台 | 纯 Web（跨平台） | Windows 桌面端 |
| 价格 | 开源 | $79.99 商业软件 |
| 物理建模 | 真实雷达视距/RCS/温跃层 | 工业级高保真 |
| 可扩展性 | JSON 想定 + 装备叠加 | 封闭数据库 |
| 学习曲线 | 中等 | 陡峭 |

**核心优势**:
1. **纯前端 Web 架构**: 无需安装，浏览器直接运行
2. **高度模块化**: 四层装备库 + 想定 JSON 支持无代码扩展
3. **真实物理**: 地球曲率、RCS 姿态角、温跃层遮蔽等关键机制
4. **战术仿真级**: 半实时（RTwP）+ EMCON + 战争迷雾

### 6.2 应用场景

- ✅ **军事教育**: 院校战术推演教学
- ✅ **兵棋爱好者**: 替代高价商业软件
- ✅ **AI 智能体训练**: 可接入 RL 强化学习（API 友好）
- ⚠️ **专业分析**: 需进一步验证模型精度

---

## 七、关键风险与改进建议

### 7.1 高优先级改进

| 问题 | 影响 | 建议 |
|------|------|------|
| React 19 不稳定 | 生产风险 | 回退至 React 18.3 稳定版 |
| 测试覆盖不足 | 回归风险 | 为火控/制导逻辑补充单元测试 |
| 魔法数字散布 | 可维护性 | 提取物理常数至 `engine/constants.ts` |
| 超大文件 | 认知负荷 | 拆分 `simulationEngine.ts`（978行）与 `TacticalMapCanvas.tsx`（1228行） |

### 7.2 中优先级改进

- 补充 API 文档（建议使用 TypeDoc）
- 建立 CI/CD 流水线（GitHub Actions）
- 添加 ESLint + Prettier 规范
- 编写架构决策记录（ADR）

### 7.3 长期演进建议

1. **多人在线对抗**: WebSocket + 服务端裁决
2. **回放系统**: 完整的战斗录像与分析
3. **AI 对手**: 基于行为树的战术 AI
4. **3D 可视化**: Three.js 辅助战术态势展示

---

## 八、总结

AEGIS-CMO 是一个**技术实力与领域深度兼具**的优秀项目：

**卓越之处**:
- ⭐ **架构设计清晰**: 分层合理，模块解耦优秀
- ⭐ **物理建模真实**: 雷达视距/RCS/声呐/电子战均有实现
- ⭐ **性能优化到位**: Zustand 精细订阅 + WebGL 渲染
- ⭐ **可扩展性强**: 四层装备库 + 想定 JSON 叠加机制

**待提升**:
- ⚠️ 测试覆盖率需提升至 80%+
- ⚠️ 文档完整性不足
- ⚠️ 部分模块过大需拆分

**最终评分**: **A- (88/100)**

**推荐场景**: 军事院校教学、兵棋爱好者、AI 智能体训练平台、商业兵棋系统原型验证。

---

*评估人: Claude Opus 4.8 (Independent Technical Reviewer)*
*评估方法: 静态代码分析 + 架构审查 + 测试执行 + 领域知识验证*
