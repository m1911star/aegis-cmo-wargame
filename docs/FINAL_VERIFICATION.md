# AEGIS-CMO 内容扩充最终验证报告

**验证日期**：2026-11-01

**内容计划**：[`CONTENT_EXPANSION_PLAN.md`](CONTENT_EXPANSION_PLAN.md)

**装备矩阵**：[`CONTENT_EXPANSION_MATRIX.md`](CONTENT_EXPANSION_MATRIX.md)

**巴士海峡设计**：[`BASHI_CHANNEL_SCENARIO.md`](BASHI_CHANNEL_SCENARIO.md)

**玩法契约**：[`../GAMEPLAY.md`](../GAMEPLAY.md)

## 1. 结论与版本

本轮在不改变固定 `0.25s` 步进、序列化 PRNG、Recording v2 和 `canonicalBattleState` 边界的前提下完成内容扩充机制、四层装备库、两个既有主力想定升级及第四主力想定《巴士海峡封锁》。装备参数是可测试的游戏抽象，不代表现实性能认证。

| 契约 | 当前值 |
|---|---|
| Catalog | `2026.12-CONTENT-EXPANSION-1` |
| Ruleset | `2026.12-ruleset-21` |
| Scenario Schema | `12` |
| Recording | `2`（旧版或任一版本不匹配均在替换战场前拒绝） |
| 固定步长 | `0.25s` |

## 2. 成功标准逐项验收

| # | 成功标准 | 实现证据 | 验收证据 |
|---|---|---|---|
| 1 | 源码核验扩充矩阵 | `CONTENT_EXPANSION_MATRIX.md` | 基线23/16/15/9与当前38/27/24/27、每个新增条目用途和想定消费位置完整列出 |
| 2 | 分层防空选弹 | `simulation/autoDefense.ts` | 枚举全部挂架，按可执行解、最小射程裕度、WRA、库存和全军在途量稳定选择；远中近乱序测试 |
| 3 | 分类事件与可靠出动 | `scenarioEvents.ts`、`eventResolver.ts`、`carrierOperations.ts` | `minimumClassification`只读Contact；甲板忙/无ready重试、延迟订单、真实库存、永久失败原因和跨批次重放测试 |
| 4 | 水面/水下撤离区 | `objectives.ts`、Schema/Compiler | 多边形、阵营、域、目标引用首Tick校验；授权单位进入后退出战场并独立结算 |
| 5 | 轻型空投鱼雷 | `fireControl.ts`、`weaponPhysics.ts` | Yu-11/Mk-54航空投放→入水→声自导；重型潜射/空投平台双向隔离测试 |
| 6 | Catalog数量与必含装备 | `src/db/*` | **38平台 / 27武器 / 24传感器 / 27挂载**；所有指定平台/武器存在，超过最低目标 |
| 7 | 无纯占位平台 | 四想定定义、显式消费测试 | 15个新增平台逐一进入初始兵力、增援或已实例化有限机库；全部27挂载逐一验证兼容/速度/续航/RCS/弹药 |
| 8 | 《东海惊雷》升级 | `builtinScenarios.ts` | 26初始算子/6事件；AIP/FFG浅海幕、运-9G、MALD、SEAD、B-1B饱和链及200秒契约测试 |
| 9 | 《深海猎杀》升级 | `builtinScenarios.ts` | 19初始算子/5事件；双完整舰载联队、classified加油前出、identified 0/10/20秒全挂载波次与库存测试 |
| 10 | 《巴士海峡封锁》 | `bashiChannelBlockade.ts` | 50分钟、19算子/10事件/12任务；双HVA preserve+withdraw、浅深海ASW、岸基拒止/SEAD、AAR和Turnaround轮换 |
| 11 | 四想定终局与双方路径 | `smokeScenarios.ts`、`SCENARIO_SMOKE_RESULTS.json` | 4固定种子无命令有限终局；巴士红/蓝主目标路径分别获胜，终局冻结且不重复计分 |
| 12 | 版本与Recording拒绝 | `battleRecording.ts` | Catalog/ruleset/schema均按变化递增；Recording v1、规则/目录/Schema不匹配原子拒绝与回滚测试 |
| 13 | 全部质量门禁 | 下节 | 164 Bun、13 E2E、DB、smoke、98.35% engine coverage、build、TypeDoc、diff均通过 |

## 3. Catalog与消费门禁

自动化测试不只检查数量：

- 15个新增平台逐一检查存在且被四个内置想定的单位、事件或母舰机库消费；
- 27套Loadout逐一实例化，检查平台兼容、速度惩罚、续航倍率、RCS惩罚和有限弹药；
- 11种新增武器逐一对合法观测Contact产生实际发射、拦截或空投；
- 24传感器全部具有合法平台/挂载外键；新增雷达、ESM/OECM、AIP阵和吊放声呐均有实际检测测试；
- `validate:db` 在Tick 0前编译所有单位、挂载、机库、任务、事件、目标、环境和动态增援引用。

当前想定校验摘要：

| 想定 | 初始算子 | 事件 | 搭载机库母舰 |
|---|---:|---:|---:|
| 东海惊雷 | 26 | 6 | 2 |
| 深海猎杀 | 19 | 5 | 2 |
| 巴士海峡封锁 | 19 | 10 | 4 |
| 有限信息演练 | 6 | 0 | 0 |

## 4. 四想定固定种子无命令烟测

可重复运行：

```bash
bun run smoke:scenarios
```

完整机器可读结果写入 [`SCENARIO_SMOKE_RESULTS.json`](SCENARIO_SMOKE_RESULTS.json)。

| 想定 / Seed | 终局 | 结果 | 损失 RED/BLUE | 发射 RED/BLUE | 出动 | AAR |
|---|---:|---|---:|---:|---:|---:|
| 东海惊雷 / 4242 | Tick 14400 / 3600s / time_limit | RED defeat / BLUE costly_victory | 5 / 8 | 180 / 166 | 2 | 268 |
| 深海猎杀 / 5252 | Tick 7385 / 1846.25s / critical | RED costly_victory / BLUE defeat | 1 / 4 | 100 / 120 | 0 | 168 |
| 巴士海峡 / 7373 | Tick 12000 / 3000s / time_limit | RED costly_victory / BLUE costly_victory | 4 / 9 | 124 / 142 | 5 | 218 |
| 有限信息 / 6262 | Tick 3600 / 900s / time_limit | RED defeat / BLUE victory | 0 / 0 | 0 / 0 | 0 | 0 |

四局均为finite状态、`status=pending`的sortie orders为0、无NaN、无无限循环；撤离后才到期的出动订单保留显式failed原因。该烟测证明确定性闭环，不替代真人策略平衡测试。《巴士海峡封锁》另有真实红/蓝指挥路径测试：分别切换合法控制席位，经COMMAND_ACTIONS下达防御WRA、航路与速度命令，在固定步进中实际航渡并完成withdraw与preserve；测试不修改单位位置、事件、Tick或仿真时间。

## 5. 最终门禁

```bash
bun test
bun run validate:db
bun run smoke:scenarios
bun run build
bun run test:e2e
bun run test:coverage
bun run docs:api
git diff --check
```

| 门禁 | 结果 |
|---|---|
| Bun unit/integration | **164 pass / 0 fail / 1199 assertions** |
| Playwright Chromium E2E | **13 pass / 0 fail** |
| Engine行覆盖率 | **98.35% (3342/3398)**，要求 ≥80% |
| Catalog/Scenario校验 | **38平台 / 27武器 / 24传感器 / 27挂载 / 4想定，全通过** |
| 固定种子终局 | **4/4通过** |
| TypeScript + Vite | **通过** |
| TypeDoc | **通过**，生成 `docs/api` |
| Diff whitespace | **通过** |

## 6. 有限信息与确定性负面审计

- 新AI、WRA、事件和SEAD只消费己方 `TacticalContact`；`targetCategory`只匹配已知的 `identifiedCategory`。
- 分层防空、协同释放、任务追击和威胁圈不接受隐藏平台对象；物理真值只在seeker观察、碰撞/毁伤和已建立Contact到物理目标映射中使用。
- 地图与组件不读取 `actualUnitId`；威胁估算只接收观察域、威胁级别和已识别类别。
- `src/engine`、`src/store`、`src/scenarios`无战局用 `Math.random`；引擎无战局用 `Date.now`/`crypto.getRandomValues`。
- 所有改变canonical状态的玩家操作进入 `COMMAND_ACTIONS`；显示切换、地图尺和重放scrubber不进入命令流。
- `canonicalBattleState`顶层键保持既有契约，显式不增加`pendingSortieOrders`；待执行订单仍由运行时世界状态按确定性规则重建并经Recording v2重放测试。撤离记录和鱼雷阶段保存在既有`units`/`weaponsInFlight`分支。
- 关键目标提前终局时，失败方为defeat；未同时关键失败的对手按自身损失获victory/costly_victory，避免双方因未到时间的required目标同时失败。

## 7. 已知限制

- 平台、弹药、传感器、命中率、环境和补给参数仅为玩法抽象，不代表现实实测或机密数据。
- 海陆与浅/深海是想定内简化多边形；没有全球DEM、水深、海况、大气波导或专业GIS。
- KLJ-5/APG-81近距对陆成像是SEAD玩法抽象；没有完整SAR、地杂波或目标识别模型。
- 分层WRA使用射程裕度、库存和威胁等级，不模拟完整NEZ/导弹能量学。
- OPFOR是可解释事件/任务状态机，不是通用战役规划器。
- Scenario Builder是Schema编辑器，不是专业任务规划/GIS工具；Replay仍从开局重放到目标Tick，没有通用全状态存档。
- 无多人联网或服务端权威状态。

## 8. 回滚边界

机制、Catalog包、两大想定升级和《巴士海峡封锁》均可按纵向切片回滚；详见 [`CONTENT_EXPANSION_PLAN.md`](CONTENT_EXPANSION_PLAN.md)。删除第四想定只需移除 `bashiChannelBlockade.ts`及BUILTIN注册，不要求撤销通用撤离区、可靠出动或轻型鱼雷机制。
