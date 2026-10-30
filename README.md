# AEGIS-CMO

> 浏览器中的现代多域半实时兵棋推演沙盘。

AEGIS-CMO 是一套受现代指挥推演产品启发的实验性 Web 兵棋系统，覆盖海、陆、空、潜、电磁等作战域。它强调**有限信息、固定步长、可解释火控和可扩展想定**，而不是单纯展示单位图标。

项目为纯前端应用，无需后端服务，使用 **Bun、React 19、TypeScript、Zustand、MapLibre GL、milsymbol 与 Turf.js** 构建。

> [!IMPORTANT]
> 本项目中的装备参数、命中率和战术规则均为可测试的游戏抽象，不构成现实装备效能评估，也不能用于实际导航或军事决策。

## 项目亮点

| 能力 | 说明 |
|---|---|
| 半实时推演 | 支持暂停、单步与多倍速；底层始终使用固定 `0.25s` 子步 |
| 战争迷雾 | 红方、蓝方与全局视角分离；接触、分类和 AOU 不确定区独立维护 |
| 多域传感器 | 雷达视距、RCS、VHF 反隐身、ESM、主动/被动声呐和温跃层遮蔽 |
| 可解释火控 | 自动与手动射击共用射程、弹药、冷却、目标域和制导支援判定 |
| 导弹制导 | 中段数据链、末段导引头、视场角、失锁搜索、拦截和 CIWS 裁决 |
| 任务与资源 | 燃油、返航、机库批次、挂载、任务配属、目标计分与战后结算 |
| 确定性重放 | 随机状态、指令 Tick 和执行顺序可记录，支持一致性重放 |
| 可扩展内容 | 装备四层数据库、想定 JSON、Catalog Overlay 和动态事件规则 |
| WebGL 态势图 | MapLibre GL、MIL-STD-2525C / APP-6 军标、包线、航迹和特效 |

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
| 手动分配火力 | `F1`，随后在地图选择目标 |
| 规划航路点 | `F3`，随后在地图连续点击 |
| 切换选中单位雷达 EMCON | `F9` |
| 退出当前交互模式 | `Esc` 或地图右键 |
| 切换观察视角 | 顶栏红方 / 蓝方 / 全局按钮 |
| 切换控制席位 | 开局且尚未推进 Tick 时选择 |
| 切换真实/深色/离线底图 | 左侧“包线图层”面板 |

观察视角与指挥权限相互独立：切换到另一方视角不会自动获得其控制权。跨阵营编辑和实时兵力投放需要显式进入沙盒模式。

## 内置想定

| 想定 | 重点 |
|---|---|
| **东海惊雷** | 海空一体夺控、防空反导、CEC 支援与动态增援 |
| **深海猎杀** | 双航母打击群、反潜搜索和远程饱和打击 |
| **有限信息演练** | 15 分钟短局，练习观察、风险射击、资源撤离与任务结算 |

想定入口位于 `src/scenarios/`。装备、传感器、武器和挂载数据位于 `src/db/`。

## 系统架构

```text
src/
├── components/              # 指挥 HUD、侧栏、遥测、日志与弹窗
├── map/                     # MapLibre 底图、战术图层和离线示意图
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
    ├─ 单位运动与资源
    ├─ 传感器与接触融合
    ├─ 自动防御与火力分配
    ├─ 武器制导与毁伤
    └─ 动态事件与目标结算
    ↓
MapLibre GeoJSON + React HUD
```

高频战术图层通过 Zustand `subscribeWithSelector` 直接更新 MapLibre GeoJSON Source，避免每个仿真 Tick 都驱动整棵 React 组件树重绘。

## 装备与想定扩展

装备目录采用四层结构：

```text
Sensor → Weapon → Loadout → Platform
```

`src/db/unitConfiguration.ts` 负责将平台与挂载合成为运行配置，包括武器替换、附加传感器、速度、续航和 RCS 修正。非法引用、不兼容挂载、重复 ID 和越界数值会在进入战场前被拒绝。

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
- 当前没有地形碰撞、陆地遮挡或海深裁决。

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
| `bun run validate:db` | 验证装备数据库完整性 |

首次运行 E2E 前安装浏览器：

```bash
bunx playwright install chromium
bun run test:e2e
```

当前基线：

- Bun unit / integration：**97 pass，0 fail**
- Playwright E2E：**3 pass，0 fail**
- Engine 聚合行覆盖率：**90.75%**

## API 文档

TypeDoc 覆盖 `src/engine`、`src/db` 和公开数据类型：

```bash
bun run docs:api
```

生成结果位于 `docs/api/index.html`。该目录是可重复生成的构建产物，不纳入版本控制。

## 当前边界

- 无多人联网、服务端权威状态或持久化战役后端。
- 装备参数和裁决模型服务于玩法验证，不代表现实机密或实测数据。
- 在线地图只是地理展示，不参与导航与地形裁决。
- 想定导出与指令重放用途不同，不能相互替代。
- Store 已具备分层结构，但旧 `useWargameStore` 兼容入口仍保留。

优化拆分、测试和文档生成的完成证据见 [OPTIMIZATION_COMPLETE.md](OPTIMIZATION_COMPLETE.md)。
