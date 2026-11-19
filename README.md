# AEGIS-CMO

> 浏览器中的现代多域半实时兵棋推演沙盘。

AEGIS-CMO 是一套受现代指挥推演产品启发的实验性 Web 兵棋系统，覆盖海、陆、空、潜、电磁等作战域。它强调**有限信息、固定步长、可解释火控和可扩展想定**，而不是单纯展示单位图标。

项目为纯前端应用，无需后端服务，使用 **Bun、React 19、TypeScript、Zustand、MapLibre GL、milsymbol 与 Turf.js** 构建。

> [!IMPORTANT]
> 本项目中的装备参数、命中率和战术规则均为可测试的游戏抽象，不构成现实装备效能评估，也不能用于实际导航或军事决策。

## 项目亮点

| 能力 | 说明 |
|---|---|
| 半实时推演 | 支持暂停、单步与多倍速；固定 `0.25s` 子步，`15x/60x` 由 Web Worker 异步批处理 |
| 战争迷雾与 BDA | 敌我视角分离、AOU 不确定区、超视距毁伤待复核（`[BDA?]`）与周期性侦察卫星过顶 |
| 多域传感器与气象 | 机载雷达前向视界、声呐尾流挡音盲区（Baffles）、云层/雨带光学衰减与高海况修正 |
| 可解释火控与 TOT | 制导通道饱和上限、NEZ/CEC/TOF 实时解算、导弹绕障转折点（Dogleg）与多单元 TOT 同秒齐射 |
| 导弹与分层反导 | 中段数据链、高超音速/弹道高抛轨迹、三层射高反导窗口、巡航弹地形跟随与低空撞山裁决 |
| 航空反潜与两栖 | 反潜机播撒主/被动声呐浮标（DIFAR/DICASS）、潜艇定期转向清盲区与两栖近岸抵滩投送 |
| 部位毁伤与损管 | 传感器/动力轴/武备甲板独立受损（反辐射致盲、鱼雷进水失速、甲板火灾停飞）与损管抢修 |
| 战术反应与战役 | 事件驱动 OPFOR 复合波次、BVR Crank/Pump、MALD/UAV 与五阶段兵力/弹药继承战役 |
| 确定性重放与多槽存档 | Recording v2 快照跳转回放、多槽位命名断点存档（`.save.json` 摘要校验）与独立 AAR |
| 高性能态势与批量指控 | 编译多边形 BBox 加速、MapLibre 军标、`Shift+拖拽` 框选多单元同步标绘航点与批量条令 |
| 可扩展内容 | 100+ 平台、60+ 武器、50+ 传感器、60+ 挂载与 30 套可直接部署的军队配置；支持 Scenario Builder、想定导入导出、Catalog Overlay 和事件规则 |
| WebGL 态势图 | MapLibre、军标、纯函数GeoJSON投影、测距尺、AOU和有限信息威胁圈 |

## 快速开始

### 环境要求

- [Bun](https://bun.sh/)
- 支持 WebGL 的现代浏览器

### 安装与运行

```bash
bun install
bun run dev
```

按终端提示打开本地地址即可进入指挥界面。生产构建：

```bash
bun run build
bun run preview
```

## 基本操作

| 操作 | 快捷键 / 入口 |
|---|---|
| 暂停或继续推演 | `Space` 或顶栏播放按钮 |
| 手动分配火力（含 Dogleg 转折点 / TOT 齐射） | `F1`，点击空白处加绕障转折点，点击敌目标发射（多选时自动装订 TOT 同步齐射） |
| 规划单机或编组航路点 | `F3`，随后在地图连续点击 |
| 框选多单元批量指控 | 按住 `Shift` 拖拽地图，或开启地图右上“框选” |
| 切换选中单元/编组雷达 EMCON | `F9` |
| 退出当前交互模式 | `Esc` 或地图右键 |
| 切换观察视角 | 顶栏红方 / 蓝方 / 全局按钮 |
| 切换控制席位 | 开局且尚未推进 Tick 时选择 |
| 切换真实/深色/离线底图 | 左侧“包线图层”面板 |
| 创建/编辑任务 | 左侧“巡逻任务”，勾选至少三个同阵营参考点 |
| 想定编辑 | 切换沙盒后使用顶栏“想定编辑”；选择军队配置后点击地图可批量部署，并导出为想定 |
| 重放与AAR | “想定管理”生成Recording v2；战后或沙盒打开“战后复盘” |
| 测距 | 地图右上底图面板“测距尺” |

观察视角与指挥权限相互独立：切换到另一方视角不会自动获得其控制权。跨阵营编辑和实时兵力投放需要显式进入沙盒模式。

## 内置想定

| 想定 | 重点 |
|---|---|
| **东海惊雷** | 浅海AIP/护卫舰反潜幕、运-9G电子支援、诱饵、SEAD与B-1B饱和波次 |
| **深海猎杀** | 双航母隐身制空、多用途重锤、电子伴随、侦察分类、加油前出与可靠分波次出动 |
| **巴士海峡封锁** | 50分钟双两栖核心preserve+withdraw、浅深海ASW、岸基拒止/SEAD和Turnaround护航轮换 |
| **联合登岛** | 海陆空立体夺控、两栖投送、陆基机场压制与滩头控制 |
| **山谷突防** | 纯陆+空内陆山地攻防、山脊雷达遮蔽与合成旅通道夺控 |
| **有限信息演练** | 默认 15 分钟短局。红方登记标志船接触，蓝方把标志船送到交接点。两方都能不开火完成任务；结算后可按原席位、原种子再试。 |
| **联合作战教学** | 10 分钟互动指引演练，覆盖雷达、航路、推演与火控 |

想定入口位于 `src/scenarios/`。装备、传感器、武器、挂载和可复用编组数据位于 `src/db/`。当前主目录版本 `2026.12-CONTENT-EXPANSION-4` 包含 **102 平台、61 武器、50 传感器、68 挂载、30 套编组**；名称与参数均为可测试游戏抽象，编组是想定模板而非现实标准编制复刻。

## 系统架构

```text
src/
├── components/              # 指挥 HUD、侧栏、遥测、日志与弹窗
├── map/                     # MapLibre 生命周期、纯函数战术投影、底图和离线示意图
├── store/                   # Zustand 指挥、UI 与仿真状态
├── scenarios/               # 内置想定、编译和导入导出
├── db/                      # 传感器、武器、挂载与平台数据库
├── validation/              # JSON 与装备数据边界校验
└── engine/
    ├── simulationEngine.ts  # 保持旧导入路径的兼容 Facade
    ├── simulation/          # 推演协调、物理、火力、事件与评分
    ├── sensors.ts           # 传感器、接触和 AOU
    ├── fireControl.ts       # 统一火控判定
    ├── guidance.ts          # 导弹制导与碰撞
    ├── operations.ts        # 燃油、返航与任务运行
    └── objectives.ts        # 目标和战后结算
```

### 推演数据流

```text
指令 / 想定
    ↓
Zustand Store
    ↓
固定 0.25s World Step
    ├─ 单位运动、编队、Turnaround与空中加油
    ├─ 环境、Bearing-only ESM与接触融合
    ├─ 任务、OPFOR反应、规避与自动防御
    ├─ 武器制导、软杀伤与毁伤
    └─ 动态事件、目标、AAR与结算
    ↓
MapLibre GeoJSON + React HUD
```

高频战术图层通过 Zustand `subscribeWithSelector` 直接更新 MapLibre GeoJSON Source，避免每个仿真 Tick 都驱动整棵 React 组件树重绘。

## 装备与想定扩展

装备目录采用四层结构：

```text
Sensor → Weapon → Loadout → Platform
```

`src/db/unitConfiguration.ts` 负责将平台与挂载合成为运行配置，包括武器替换、附加传感器、速度、续航和 RCS 修正。非法引用、不兼容挂载、重复 ID 和越界数值会在进入战场前被拒绝。当前扩充包括J-15T、F/A-18E/F、运-9G、B-1B、F-35B、054B、星座级、039C、大鲸级、075/America及红蓝有机反潜直升机；自动防空会从全部可执行挂架中按射程裕度、WRA、库存和在途量分层选弹。

新增内容有两种方式：

1. 在 `src/db/` 与 `src/scenarios/` 中添加代码定义。
2. 在想定 JSON 中使用 `customCatalogOverlay` 声明自定义装备。

所有 JSON 导入都会经过 `src/scenarios/compileScenario.ts`。导出的想定用于**重新开局**，不会保存当前损伤、弹药消耗或事件执行进度；完整过程复现应使用指令重放。

详细玩法边界、火控和重放契约见 [GAMEPLAY.md](GAMEPLAY.md)。

## 地图与外部数据

默认在线底图来自 [OpenFreeMap](https://openfreemap.org/)，基础数据来自 OpenStreetMap。项目保留相应署名，并提供深色样式和完全本地的离线示意图。

- 在线服务当前不需要 API Key，但不保证持续可用。
- 加载失败或超时会提示并回退到离线示意图。
- 项目不会批量下载或离线缓存第三方瓦片。
- 切换底图不会重置战场或改变仿真 Tick。
- 仿真只使用想定内版本化的简化海陆禁区、高地海拔视线遮挡（`elevationM`）和浅/深海声学区；在线瓦片不参与裁决。当前不包含全球高精度 DEM 高程栅格或全球水深数据库。

底图配置位于 `src/map/basemaps.ts`。

## 测试与质量门禁

测试采用 unit / integration / e2e 三层结构：

```text
tests/
├── unit/
├── integration/
└── e2e/
```

| 命令 | 用途 |
|---|---|
| `bun test` | 运行全部 Bun 单元与集成测试 |
| `bun run test:unit` | 仅运行单元测试 |
| `bun run test:integration` | 仅运行集成与契约测试 |
| `bun run test:coverage` | 生成覆盖率并执行 engine ≥80% 门禁 |
| `bun run test:e2e` | 运行 Playwright Chromium 关键流程 |
| `bun run build` | TypeScript 检查与 Vite 生产构建 |
| `bun run validate:db` | 验证装备数据库与全部想定首Tick完整性 |
| `bun run smoke:scenarios` | 以固定种子无命令运行全部内置想定并更新可复核JSON摘要 |

首次运行 E2E 前安装浏览器：

```bash
bunx playwright install chromium
bun run test:e2e
```

当前门禁结果以命令输出为准，避免在多个文档中复制容易过期的测试快照。`test:coverage` 强制执行 engine 聚合行覆盖率 ≥80%；全部内置想定的固定种子摘要见 [`docs/SCENARIO_SMOKE_RESULTS.json`](docs/SCENARIO_SMOKE_RESULTS.json)。

## API 文档

TypeDoc 覆盖 `src/engine`、`src/db` 和公开数据类型：

```bash
bun run docs:api
```

生成结果位于 `docs/api/index.html`。该目录是可重复生成的构建产物，不纳入版本控制。

## 当前边界

- 无多人联网、服务端权威状态或持久化战役后端。
- 装备参数和裁决模型服务于玩法验证，不代表现实机密或实测数据。
- 在线地图只是地理展示；仿真仅使用随想定分发的简化海陆、高地遮挡与声学环境。
- 想定导出、断点存档（`BattleSaveState`）与指令重放（Recording v2）用途不同，不能相互替代。
- `useWargameStore` 是唯一权威状态源，以保证跨仿真、命令记录和回放的原子更新；显示态通过细粒度 selector 隔离。

当前文档入口与历史材料说明见 [docs/README.md](docs/README.md)。
