# traex —— codex 系，prompt 走 exec 子命令的位置参数，effort 走配置覆写。
AX_CMD=traex
AX_EFFORT_STYLE=native
AX_EFFORT_VALUES="none minimal low medium high xhigh max"
AX_NOTE="默认/--plan 都是 -s read-only（能跑命令、不能写），--write 是 -s workspace-write
          唯一自带 apply：跑完可用 traex apply 决定 diff 落不落"

ax_models() { "$AX_RUN" models; }

ax_argv() {
  AX_ARGV=(exec)
  [ -n "$AX_MODEL" ]  && AX_ARGV+=(-m "$AX_MODEL")
  [ -n "$AX_EFFORT" ] && AX_ARGV+=(-c "model_reasoning_effort=$AX_EFFORT")
  case "$AX_MODE" in
    write) AX_ARGV+=(-s workspace-write) ;;
    *)     AX_ARGV+=(-s read-only) ;;
  esac
  [ -n "$AX_RESUME" ] && AX_ARGV+=(resume --last)
  # prompt 是位置参数，必须用 -- 隔开，否则以 - 开头的 prompt 会被当成选项。
  AX_ARGV+=(-- "$AX_PROMPT")
}
