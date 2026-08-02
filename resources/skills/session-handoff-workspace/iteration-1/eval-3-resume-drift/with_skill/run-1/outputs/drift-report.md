# Resume Blocked

检测到阻断性漂移，未执行 Handoff 中的 `Immediate Next Action`：

- Handoff branch 是 `legacy-retry`，当前 branch 是 `replacement-retry`。
- Handoff 指定的起点 `src/retry.ts` 已不存在。
- 当前仓库只有采用不同 API 的 `src/retry-v2.ts`，且 `AGENTS.md` 明确禁止未经确认重建旧文件。

已保持 `src/retry-v2.ts` 不变。请确认应切回包含旧实现的分支继续，还是改为基于 replacement design 重新规划；这两种路径不能由旧 Handoff 自动决定。
