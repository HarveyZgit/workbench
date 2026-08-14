# grok —— effort 主名是 --reasoning-effort。
# 输出固定 plain：实测 --output-format json 在 headless 下会挂住不返回。
AX_CMD=grok
AX_EFFORT_STYLE=native
AX_EFFORT_VALUES="low medium high xhigh"
AX_NOTE="默认/--plan 都是 --permission-mode plan，--write 是 --always-approve
          xhigh 是否可用取决于模型，以 grok 自己的报错为准
          会继承本仓库 .claude 的 skills/rules/agents/mcps/hooks（grok inspect 可查）"

ax_models() { "$AX_RUN" models; }

ax_argv() {
  AX_ARGV=()
  [ -n "$AX_MODEL" ]  && AX_ARGV+=(-m "$AX_MODEL")
  [ -n "$AX_EFFORT" ] && AX_ARGV+=(--reasoning-effort "$AX_EFFORT")
  case "$AX_MODE" in
    write) AX_ARGV+=(--always-approve) ;;
    # 注意不要用 dontAsk：它排在 acceptEdits 之后，语义是"不问直接批准"，比只读更宽松。
    *)     AX_ARGV+=(--permission-mode plan) ;;
  esac
  [ -n "$AX_RESUME" ] && AX_ARGV+=(--continue)
  AX_ARGV+=(--output-format plain -p "$AX_PROMPT")
}
