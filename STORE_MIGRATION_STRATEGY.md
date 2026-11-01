# Store 架构集成策略调整

> **已废弃（2026-10-31）**：后续产品化实施确认三个子 Store 无任何消费者，且拆分权威状态会增加命令记录与回放事务风险，因此已删除 `scenarioStore.ts`、`simulationStore.ts`、`uiStore.ts`。当前唯一权威状态源为 `useWargameStore.ts`；最终证据见 `docs/FINAL_VERIFICATION.md`。

## 问题分析

原 `useWargameStore.ts` 包含：
- 935 行代码
- 复杂的推演逻辑 (`stepSingleTick`)
- 大量命令处理函数 (20+ actions)
- 与组件深度耦合 (11 个组件文件)

**直接替换风险**：
- 需修改 11+ 文件的导入
- 需重写复杂的 `stepSingleTick` 逻辑
- 测试回归工作量大（4-6 小时）

---

## 调整后策略：**Facade 模式渐进式重构**

### 方案：保留原 Store，内部组合三个子 Store

```typescript
// useWargameStore.ts (重构为 Facade)
export const useWargameStore = create((set, get) => ({
  // 从三个子 Store 获取状态
  ...useScenarioStore.getState(),
  ...useUIStore.getState(),
  ...useSimulationStore.getState(),

  // 保留原有 action 实现
  stepSingleTick: (...) => { /* 原逻辑 */ },
  loadScenario: (...) => { /* 更新三个子 Store */ },
}));
```

### 优势
1. ✅ **零破坏性**：组件代码无需修改
2. ✅ **渐进式**：后续可逐步迁移组件到子 Store
3. ✅ **架构清晰**：子 Store 仍然存在，可供新代码使用
4. ✅ **测试友好**：可独立测试子 Store

### 劣势
1. ⚠️ 初期有少量冗余（Facade 层开销）
2. ⚠️ 未完全解耦（但有清晰迁移路径）

---

## 执行计划

### 当前阶段（15 分钟）
1. ✅ 保留三个子 Store 文件（已创建）
2. ✅ 添加 facade 导出到 `useWargameStore`
3. ✅ 验证构建和测试

### 未来迁移（可选，按组件）
逐个组件从 `useWargameStore` 切换到子 Store：
- 简单组件优先（如 `TopCommandHeader`）
- 复杂组件最后（如 `TacticalMapCanvas`）

---

## 决策

**当前优化**: 创建子 Store 架构基础，保持向后兼容
**下一步**: 继续执行其他优化（拆分 simulationEngine.ts / UI 性能优化）
**长期**: 按需渐进式迁移组件到子 Store

这样既完成了架构现代化，又不影响当前项目稳定性。
