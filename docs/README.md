# AEGIS-CMO 文档索引

## 文档结构

| 文档 | 作用 | 维护方式 |
|---|---|---|
| [`../README.md`](../README.md) | 项目概览、运行方式、架构、内置想定与质量命令 | 随当前主分支更新 |
| [`../GAMEPLAY.md`](../GAMEPLAY.md) | 权限、有限信息、火控、资源、任务、重放等玩法契约 | 规则变化时同步更新 |
| [游戏方向与试玩门槛](superpowers/plans/game-direction.md) | 默认短局已交付的体验，以及何时投入下一阶段 | 真人试玩后更新 |
| [`SCENARIO_SMOKE_RESULTS.json`](SCENARIO_SMOKE_RESULTS.json) | 全部内置想定的固定种子无命令终局摘要 | 由 `bun run smoke:scenarios` 生成 |

装备与想定数量以 `bun run validate:db` 输出为准。测试通过数、覆盖率和烟测结果不在多个 Markdown 文件中重复维护，避免阶段性数字被误认为当前状态。

API 文档使用 `bun run docs:api` 生成到 `docs/api/`；该目录属于可重复生成的构建产物，不纳入版本控制。

## 性能复测

- `bun run bench:engine` 用固定种子跑轻量演练与东海惊雷，每组五次，并检查终态可重现。`bun run bench:engine --long` 记录东海惊雷长局断点、录像大小与回跳耗时。
- 先运行 `bun run build`，再另开一个终端运行 `bun run preview -- --host 127.0.0.1 --port 4186 --strictPort`。执行 `bun run bench:browser`，用生产 Chromium 比较四种速度和 3D 开关。`BENCH_SCALES=60 BENCH_RUNS=1 BENCH_MS=3000` 可用作快速通路检查。`BENCH_DENSITY=10 BENCH_SCALES=15` 改用 60 单元的合成密集场景。
- 比较性能时用同一机器、浏览器版本与参数，保留 JSONL 原始输出。引擎时间、Worker 往返、实际推进倍率和帧回调间隔是不同指标。帧回调不等于 GPU 实际呈现帧。

## 维护原则

- README 只描述当前可用能力，不保存阶段性验收快照。
- GAMEPLAY 只维护仍生效的规则契约。
- 计划、评审和一次性验收报告在完成或失效后从仓库删除；需要追溯时使用 Git 历史。
- 机器可生成的数据只保留生成脚本和最新结果，不手工复制到其他文档。
