# AEGIS-CMO 文档索引

## 文档结构

| 文档 | 作用 | 维护方式 |
|---|---|---|
| [`../README.md`](../README.md) | 项目概览、运行方式、架构、内置想定与质量命令 | 随当前主分支更新 |
| [`../GAMEPLAY.md`](../GAMEPLAY.md) | 权限、有限信息、火控、资源、任务、重放等玩法契约 | 规则变化时同步更新 |
| [`SCENARIO_SMOKE_RESULTS.json`](SCENARIO_SMOKE_RESULTS.json) | 全部内置想定的固定种子无命令终局摘要 | 由 `bun run smoke:scenarios` 生成 |

装备与想定数量以 `bun run validate:db` 输出为准。测试通过数、覆盖率和烟测结果不在多个 Markdown 文件中重复维护，避免阶段性数字被误认为当前状态。

API 文档使用 `bun run docs:api` 生成到 `docs/api/`；该目录属于可重复生成的构建产物，不纳入版本控制。

## 维护原则

- README 只描述当前可用能力，不保存阶段性验收快照。
- GAMEPLAY 只维护仍生效的规则契约。
- 计划、评审和一次性验收报告在完成或失效后从仓库删除；需要追溯时使用 Git 历史。
- 机器可生成的数据只保留生成脚本和最新结果，不手工复制到其他文档。
