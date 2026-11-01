# AEGIS-CMO 优化路线完成报告

> 本文记录 2026-10-30 的上一轮架构优化基线；后续完整兵棋产品化交付与最新测试数据见 [`docs/FINAL_VERIFICATION.md`](docs/FINAL_VERIFICATION.md)。

**完成日期**：2026-10-30  
**状态**：本轮四项遗留工作全部完成  
**范围**：仿真引擎模块化、指定 UI 渲染优化、测试金字塔、TypeDoc API 文档

---

## 1. `simulationEngine.ts` 模块化 ✅

`src/engine/simulationEngine.ts` 已由 978 行收敛为 **25 行兼容 Facade**。原有调用方仍可从该路径导入公开函数和类型，无需迁移。

核心职责拆入 `src/engine/simulation/` 的 8 个模块：

| 模块 | 职责 |
|---|---|
| `worldStepper.ts` | 单步推进、固定步长批处理、传感器阶段与模块协调 |
| `unitPhysics.ts` | 单位冷却、机库整备、任务航路、运动学 |
| `autoDefense.ts` | 自动拦截、条令火力分配、导弹告警 |
| `weaponPhysics.ts` | 飞行制导、拦截、CIWS、命中与毁伤裁决 |
| `eventResolver.ts` | 动态事件动作与目标结算 |
| `unitFactory.ts` | 想定单位实例化和出生点散布 |
| `battleAssessment.ts` | 战局评分等级评估 |
| `types.ts` | 仿真世界、步进结果和协调器共享类型 |

验证证据：

- 原有 `simulationEngine` 导入路径保持可用。
- 90 个既有测试语义全部通过。
- 确定性回放、固定步长和战斗裁决测试通过。
- 模块导入图检查无循环依赖。
- 提交：`b1ccf67 refactor: modularize simulation engine`

---

## 2. UI 渲染优化 ✅

本轮没有机械添加无效 `memo`，而是针对实际订阅和重复计算路径调整：

| 组件 | 已落实优化 |
|---|---|
| `TopCommandHeader` | `React.memo`；父级开关回调改为稳定 `useCallback`；UTC 时钟按可见秒订阅；高频 Tick 显示隔离到小组件 |
| `BattleObjectivesPanel` | `React.memo`；目标过滤使用 `useMemo`；目标进度使用浅比较；倒计时只在显示秒变化时更新 |
| `LeftOrbatMissionSidebar` | `React.memo`；可见编组/接触/任务使用 `useMemo`；单位按编组一次性建立索引，避免每个编组重复扫描全部单位 |
| `RightUnitTelemetryInspector` | `React.memo`；从订阅整个单位/接触表改为精确订阅选中实体；缓存装备解析、军标 SVG、能力、雷达视距与任务过滤 |
| `TacticalMapCanvas` | `React.memo`；保留 Zustand → MapLibre 的命令式 GeoJSON 订阅；React 只订阅稳定的选中单位 callsign，不再因单位对象每 Tick 克隆而重绘 VDOM |

这些改动有明确的代码级作用，但**没有声称未经 Profiler 测量的“30–50% 性能提升”**。

验证证据：

- TypeScript/Vite 生产构建通过。
- 原有 90 个测试语义全部通过。
- 提交：`ff0a3ef perf: reduce avoidable UI renders`

---

## 3. 测试金字塔 ✅

测试现已按层组织：

```text
tests/
  unit/
    engine/simulationModules.test.ts
    map/basemaps.test.ts
  integration/
    simulationEngine.test.ts
    gameplayContracts.test.ts
    catalogScenarioContracts.test.ts
  e2e/
    tacticalScenario.e2e.ts
```

新增脚本：

```bash
bun run test:unit
bun run test:integration
bun run test:coverage
bun run test:e2e
```

当前结果：

- Unit + integration：**97 pass，0 fail，423 assertions**。
- 原有 **90 个测试语义全部保留**，另增加 7 个模块边界测试。
- Engine 聚合行覆盖率：**90.75%（2011/2216）**。
- `scripts/checkEngineCoverage.ts` 将 80% 作为可执行门禁。
- Playwright Chromium E2E：**3 pass，0 fail**。

E2E 场景：

1. 打开指挥工作区并切换完整战术想定。
2. 展开/收起左右指挥侧栏，验证工作区交互。
3. 从顶栏开始推演、确认 Tick 推进并暂停。

提交：`e21c3ad test: establish unit integration and e2e layers`

---

## 4. TypeDoc API 文档 ✅

已增加：

- `typedoc` 开发依赖。
- `typedoc.json` 配置。
- `bun run docs:api` 脚本。
- `src/engine`、`src/db` 和其公开签名依赖的 `src/types/wargame.ts` 文档入口。

生成结果：

- `bun run docs:api` 零错误、零警告。
- 输出目录：`docs/api`。
- 当前生成 **168 个文件，约 2.2 MB**。
- 包含 **93 个 engine 页面**和 **13 个 db 页面**。
- `docs/api` 为可重复生成产物，已加入 `.gitignore`。

提交：`673504c docs: add TypeDoc API generation`

---

## 最终验证命令

以下命令均须保持零失败：

```bash
bun test
bun test --coverage
bun run test:coverage
bun run build
bun run test:e2e
bun run docs:api
```

最终验证结果：

| 验证项 | 结果 |
|---|---|
| Bun unit/integration 测试 | 97 pass / 0 fail |
| Engine 行覆盖率门禁 | 90.75% / 目标 ≥80% |
| Vite 生产构建 | 通过 |
| Playwright Chromium E2E | 3 pass / 0 fail |
| TypeDoc API 生成 | 通过，0 warnings |

---

## 本轮未包含的工作

以下内容不属于本轮目标，仍可作为后续独立路线：

- Store 全量迁移。
- `TacticalMapCanvas` 进一步拆分。
- CI/CD。
- ADR、部署指南和新人指南。
- 新游戏功能或视觉改版。

本报告只记录有代码、测试和命令输出支持的完成状态。
