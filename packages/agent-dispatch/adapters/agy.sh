# agy —— 档位编在模型编号里（gemini-3.7-flash-high 之类）。
# 它另有 --effort flag，但与编号后缀冲突时谁赢未验证，这里一律不传，避免静默降级。
AX_CMD=agy
AX_EFFORT_STYLE=model-id
AX_NOTE="默认/--plan 都是 --mode plan（比只读更严，不能执行命令），--write 是 --dangerously-skip-permissions
          原生 --print-timeout 只有 5m，这里固定放宽到 30m
          没有 --cwd，跨目录用 --add-dir"

ax_models() { "$AX_RUN" models; }

ax_argv() {
  AX_ARGV=()
  [ -n "$AX_MODEL" ] && AX_ARGV+=(--model "$AX_MODEL")
  case "$AX_MODE" in
    write) AX_ARGV+=(--dangerously-skip-permissions) ;;
    *)     AX_ARGV+=(--mode plan) ;;
  esac
  [ -n "$AX_RESUME" ] && AX_ARGV+=(--continue)
  AX_ARGV+=(--print-timeout 30m --output-format text -p "$AX_PROMPT")
}
