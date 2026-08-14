# agent-dispatch

把一次性执行任务转发给本机其他 CLI agent，省下主力 agent 的额度。

这一层只知道三件事：**有哪些 agent、模型编号怎么传、effort 怎么传**。
不做路由决策、不做后台任务、不做工作区隔离——那些是另一个东西。

纯 shell，没有构建产物，因此不在 `eden.monorepo.json` 的 packages 列表里
（与 `packages/http-cache-probe` 同）。

## 安装

```sh
ln -s "$PWD/packages/agent-dispatch/bin/ax" ~/.local/bin/ax
```

Skill 是 package-bound 的，不在仓库根 `resources/skills/` 下，所以
`scripts/link-skills.sh` 扫不到它（那个脚本只扫根目录的 skill 源）。直接软链：

```sh
ln -s "$PWD/packages/agent-dispatch/resources/skills/agent-dispatch" <skill-dir>/agent-dispatch
```

宿主中立与显式安装目标的约定见仓库根的
[resources/skills/README.md](../../resources/skills/README.md)。

## 用法

```sh
ax list                  # 有哪些 agent，各自 effort 与档位怎么传
ax list traex            # 该 agent 的实时模型清单

ax traex  --model gpt-5.6-luna --effort high --write "把 foo 改成 bar"
ax grok   --effort high "分析这个模块的依赖"
ax agy    --model gemini-3.7-flash-low --write "跑 codemod"
ax cursor --model 'claude-opus-5[effort=high]' --write "修测试"

ax traex --dry-run ...   # 只打印将要执行的命令，不真跑
ax traex -- --write 这句是 prompt   # -- 之后一律当字面 prompt
```

flag 可以出现在 prompt 前后任意位置。

## 三档权限的真实映射

`--write` 一律是"可以改文件"，但**默认档和 `--plan` 各后端语义不同**，`ax list` 里也有：

| adapter | 默认（不传） | `--plan` | `--write` |
|---|---|---|---|
| traex | `-s read-only`（能跑命令，不能写） | 同左 | `-s workspace-write` |
| grok | `--permission-mode plan` | 同左 | `--always-approve` |
| agy | `--mode plan`（比只读更严，不能执行命令） | 同左 | `--dangerously-skip-permissions` |
| cursor | `--mode plan` | 同左 | `--force` |

即 `--plan` 目前对四个后端都等于默认档，留着是为了让调用方能显式表达意图。

## wrapper

本机可能用 shell function 包装 CLI（代理检查等）。`ax` 会 source `$AX_PRELUDE`
（默认 `~/.cliproxyrc`，设成空字符串可关闭），再按函数名调用，所以包装照常生效，
**不会**绕过去直接打裸 binary。文件不存在就跳过，退回真实命令。

两个后果值得知道：

- **不能用 `exec` 调用**。`exec` 只做 execve，从不查 shell function 表，会静默绕过包装。
  所以 `ax` 多留一层进程，这是支持 function 包装的必要代价。
- **`$AX_PRELUDE` 指向的文件会以 `ax` 的完整权限被执行。** 它是这个包唯一的任意代码入口。
  source 的时机放在参数解析和 `ax_argv` 之后，所以它改不到已经解析好的参数。

## 加一个 agent

写 `adapters/<name>.sh`，定义：

| 变量 / 函数 | 作用 |
|---|---|
| `AX_CMD` | 调用名（优先用本机 wrapper 的名字） |
| `AX_CMD_FALLBACK` | 没有 wrapper 时退回的裸命令，可选 |
| `AX_EFFORT_STYLE` | `native`（传参）或 `model-id`（编在模型编号里） |
| `AX_EFFORT_VALUES` | `native` 时的合法档位，`ax` 用它做本地校验 |
| `AX_NOTE` | `ax list` 里显示的注意事项，权限档位映射写在这里 |
| `$AX_RUN` | 由 `ax` 解析好的实际调用名（wrapper 优先），`ax_models` / `ax_argv` 里直接用 |
| `ax_models()` | 列出模型 |
| `ax_argv()` | 按 `AX_MODEL` / `AX_EFFORT` / `AX_MODE` / `AX_RESUME` / `AX_PROMPT` 填 `AX_ARGV` 数组 |

adapter 不要引入自己的私有环境变量开关；要配置就进上面这张表。
删一个 agent 就是删一个文件。

## 各后端实测差异

**effort 分两类。** `grok` / `traex` 传参（traex 走 `-c model_reasoning_effort=`，合法值
`none minimal low medium high xhigh max`，写错会在配置解析阶段就报错，不产生模型调用）；
`cursor` / `agy` 编在模型编号里（`gpt-5.3-codex-xhigh`、`gemini-3.7-flash-low`）。

`grok` 的合法档位**随模型变**——探测时报 `xhigh, high, medium, low`，换个模型只剩
`high, medium, low`。`ax` 本地只挡明显的拼写错误，最终以 grok 自己的报错为准。

**`agy` 有 `--effort` flag，但 adapter 不传它。** 它的模型编号已经带档位后缀，两者冲突时
谁赢没验证过，传了可能静默降级。统一走编号。

**`grok` 的 `--output-format json` 在 headless 下会挂住不返回**（1.0.3 实测），
所以固定用 `plain`。它另有文档没写的 `streaming-messages-json`（Anthropic Messages 线格式），
未验证。

**不要给 grok 用 `--permission-mode dontAsk`。** 它在取值序列里排在 `acceptEdits` 之后，
语义是"不问直接批准"，比只读更宽松。

**`grok` 会继承仓库的 `.claude` 配置**——skills、rules、agents、mcps、hooks 全都读
（`grok inspect` 可查）。委派给它等于连你的 hook 一起跑，包括 Stop 钩子。

**`agy` 默认 `--print-timeout` 只有 5m**，adapter 固定放宽到 30m。它没有 `--cwd`，
跨目录用 `--add-dir`。

**`traex` 的 prompt 是位置参数**，必须 `-- <prompt>` 隔开，否则以 `-` 开头的 prompt 会被
当成选项。另外三个走 `-p <value>`，天然免疫。

**只有 `traex` 自带 `apply`**：跑完可以用 `traex apply` 决定那份 diff 落不落到工作树。
`cursor` 有 `-w/--worktree`；`grok` 也有，但 headless 下不生效。
