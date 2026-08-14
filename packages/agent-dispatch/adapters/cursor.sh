# cursor —— 档位编在模型编号里（gpt-5.3-codex-xhigh、kimi-k3-low 之类）。
# 走本机 cursor 包装，它内部转 cursor-agent；没有包装时退回裸 binary。
AX_CMD=cursor
AX_CMD_FALLBACK=cursor-agent
AX_EFFORT_STYLE=model-id
AX_NOTE="默认/--plan 都是 --mode plan（比只读更严，不能执行命令），--write 是 --force
          模型编号支持覆写，如 --model 'claude-opus-5[effort=high,fast=false]'"

ax_models() { "$AX_RUN" --list-models; }

ax_argv() {
  AX_ARGV=()
  [ -n "$AX_MODEL" ] && AX_ARGV+=(--model "$AX_MODEL")
  case "$AX_MODE" in
    write) AX_ARGV+=(--force) ;;
    *)     AX_ARGV+=(--mode plan) ;;
  esac
  [ -n "$AX_RESUME" ] && AX_ARGV+=(--continue)
  AX_ARGV+=(--output-format text -p "$AX_PROMPT")
}
