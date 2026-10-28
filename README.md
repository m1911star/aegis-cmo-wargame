# AEGIS-CMO // 现代海陆空联合作战半实时兵棋推演系统 (JADC2 Tactical Sandbox)

一套对标 **CMO (Command: Modern Operations)** 的纯前端、高拟真现代海陆空潜电联合作战半实时（RTwP）Web 兵棋推演平台。采用 **Bun + React 19 + TypeScript + Zustand + MapLibre GL + milsymbol + Turf.js** 构建。

## 核心特性

1. **高度抽象可扩展的装备参数数据库 (`src/catalog/equipmentCatalog.ts`) 与想定定义架构 (`src/scenarios/builtinScenarios.ts`)**
   - 平台（Platform）、传感器（Sensor）、武器（Weapon）与挂载（Mount）模板同战场动态实例（RuntimeUnit）彻底解耦。
   - 支持在任意想定 JSON 中通过 `customCatalogOverlay` 免改代码声明全新武器、传感器或作战平台。
   - 内置 2 个多域联合作战想定剧本：
     - **作战想定 01：《东海惊雷：海空一体夺控与防空反导》**（歼-20A、空警-500H、轰-6N、055万吨大驱、052DL、093B核潜艇、红旗-9B、鹰击-12B vs F-35C、E-2D、P-8A、阿利·伯克 Flight III、弗吉尼亚级核潜艇、爱国者-3 MSE）。
     - **作战想定 02：《深海猎杀：航母打击群反潜与高超音速饱和打击》**（双055大驱鹰击-21高超音速齐射 + 093B潜艇狼群 vs CVN核动力航母打击群）。

2. **真实物理公式与电磁/水声信息博弈内核 (`src/engine/simulationEngine.ts`)**
   - **地球曲率雷达视距公式**：$R_{\text{horizon}} = 4.12 \times (\sqrt{h_{\text{obs}}} + \sqrt{h_{\text{target}}})$。复现 12 米超低空掠海导弹突破舰载雷达视距盲区，以及 9200 米高空预警机通过 CEC 全军数据链超视距引导防空反导的战术机制。
   - **RCS 四次方根探测折算与米波反隐身**：模拟 0.005 m² 五代隐身机对 X 波段雷达探测圈的压缩效应，以及陆基 VHF 米波反隐身雷达的谐振探测优势。
   - **水下温跃层与主/被动声呐博弈**：复现 -120m 温跃层对水面声呐的遮蔽，以及潜艇开启主动声呐 Ping 暴露自身坐标的机制。
   - **EMCON 电磁管控与战争迷雾（Contacts & AOU）**：支持红方席位 / 蓝方席位 / 上帝真值三视角切换，被动 ESM 截获生成 AOU（不确定性多边形）。

3. **60FPS WebGL 战术态势沙盘与 C4ISR 参谋指控 HUD**
   - Zustand `subscribeWithSelector` 直推 MapLibre GL GeoJSON 数据源，避免高频仿真步进引发 React 全树重绘。
   - 动态注册北约 MIL-STD-2525C / APP-6 军标雪碧图、雷达/武器/声呐包线、导弹尾迹与拦截波纹特效。
   - 支持 CMO 经典快捷键：`Space`（暂停/推演）、`F3`（规划机动航路点）、`F1`（手动分配导弹齐射）、`F9`（切换主动雷达 EMCON）。

## 快速启动与验证（使用 Bun）

```bash
# 1. 安装依赖
bun install

# 2. 运行物理公式、传感器视距、想定序列化与推演闭环单元测试
bun test

# 3. 生产环境类型检查与打包构建
bun run build

# 4. 启动本地开发服务器
bun run dev
```

## 装备与想定模型约定

- `src/db/unitConfiguration.ts` 统一合成平台与挂载：挂载完整替换平台默认武器，附加传感器去重合并，速度、续航与 RCS 修正同步供引擎和界面使用。指定不存在或不兼容的挂载会被拒绝。
- 自动开火、反导和手动开火使用挂架的 `reloadTimeSec`；手动指令不能绕过冷却。实时换装仍是沙盘能力，但会保留已消耗的弹药、未结束的武器冷却及剩余燃油比例，不再通过来回切换补满弹药或燃油。
- 机库按现有的“编队批次”计数，采用配置的 `launchCooldownSec`；每次甲板整备结束可将一批预备机转为待命，总出动数不会超过初始库存。本模型暂不包含返航回收和重新补给。
- JSON 导入和程序直接加载都经过 `src/scenarios/compileScenario.ts`：验证完整结构、数值范围、装备引用、兼容关系、初始与增援 ID、任务及事件引用。错误会在替换当前战场前报告。
- 任务配属以单位的 `assignedMissionId` 为唯一来源，运行时任务名单由此派生。旧 JSON 中的 `missions[].assignedUnitIds` 会在导入时迁移；两侧互相矛盾的配属会被拒绝。
- 可重复时间事件必须指定 `repeatIntervalSec`（至少 1 秒），大步进会补执行跨过的周期。其他重复事件按每个单位的新毁伤、接触建立或区域进入触发，不会因条件持续成立而每 Tick 重复执行；增援波次使用独立 ID。

导出的是可重新开局的想定，不是完整战斗存档：保存当前存活单位的部署、挂载和任务配属，清理失效引用及已入场的一次性增援，不保存损伤、弹药消耗或事件执行进度。

新增契约回归测试位于 `tests/catalogScenarioContracts.test.ts`，随 `bun test` 一起执行。
