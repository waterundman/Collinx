# verify — 契约对齐验证脚本

| 脚本 | 来源 | 说明 |
|---|---|---|
| `s0-verify-contract.ts` | 原 `W:/tmp/s0-verify/`（2026-10-07 归档） | S0 合约对齐实测：v1.22 (`e1fedfb`) vs 当前实现，对 v1.22 输入形态输出等价性。Collinx v1.22 阶段产物。 |

## 注意

`s0-verify-contract.ts` 保留原样归档，**当前不可直接运行**——其相对导入已失效：

- `./old/harmony-plan`、`./old/note-event`（v1.22 基线快照，未随归档）
- `../../项目仓库/Collinx-new/packages/core/src/model/harmony-plan`（旧相对路径，现应为 `../../packages/core/src/model/harmony-plan`）

如需复现该等价性实测，需先从 `e1fedfb` 导出 v1.22 的 `harmony-plan.ts` / `note-event.ts` 到本地 `old/` 并改写导入路径。