---
name: review-and-commit
description: 完成一次批量代码改动后，先派独立 subagent 审查本次 git 改动、把问题修到干净，再让用户确认提交信息后提交。当用户说“审查后提交/review 一下再提交/review-and-commit”，或刚做完多文件改动准备收尾提交时使用。绝不 push，提交前必须等用户确认，并把每次运行的改动规模与结论记录到本机遥测日志。
---

# review-and-commit

把“改完 → 派 subagent review → 有问题就修 → 干净后再提交”这套收尾习惯固化成一条可主动触发的流程。核心价值是：**提交前一定过一次独立审查**，而不是让写代码的同一个上下文自评自过。

本 skill 只在**用户主动触发**时运行；触发本身即视为“授权提交”，但提交前仍必须展示 commit message 并等用户确认。**任何情况下都不 push。**

## 何时用 / 何时跳过

- 用：刚完成一批改动（多文件、或改了逻辑/接口/配置）准备提交时。
- 可跳过：改动极小且低风险（单文件 typo、纯文案、改注释）。这类可以直接提交，不必强跑审查——但即便跳过审查，也建议跑一次 `log-run.mjs` 记录（`--verdict skipped`），让遥测数据完整，便于将来定“什么规模才该强制审查”的阈值。

## 前置检查

1. 确认在 git 仓库内（`git rev-parse --show-toplevel`），否则说明并退出。
2. 确认有改动：`git status --porcelain` 非空。无改动则直接告知用户“没有可提交的改动”，退出。
3. 记住仓库根路径，后续 git 命令都在该 cwd 执行。

## 工作流程

### 1. 汇总改动面

```bash
git status
git diff              # 未暂存
git diff --cached     # 已暂存
git ls-files --others --exclude-standard   # 未跟踪文件清单
```

先自己扫一遍，明确本次改了哪些文件、大致改了什么。未跟踪文件也要纳入审查范围（新增文件常是缺陷高发区）。

### 2. 派 subagent 独立审查

用 `Agent(subagent_type=general-purpose)` 起一个**独立**子代理来审查——关键在于它不带你写代码时的上下文偏见。给它的指令要点：

- 在当前仓库根目录用 git 自行读取本次全部改动（staged + unstaged + untracked 新文件），不要只看你转述的摘要。
- 审查重点：逻辑错误、边界/空值、安全问题（注入/越权/密钥泄露）、并发、健壮性、明显性能坑、以及是否破坏既有行为（回归）。
- 输出**结构化清单**：每条含 `文件:行`、`严重度(blocker/high/medium/low)`、`置信度(high/medium/low)`、问题描述、修复建议；没有问题就明确回 `clean`。
- 不要修改任何文件，只审查报告。

> 如果本机存在 `bits-code-guard` skill，可在子代理指令里让它复用该 skill 的审查清单与严重度定义，保持口径一致；但不强依赖，没有就用上面的标准。

### 3. 修复循环

- 若子代理报告全 `clean`（或只剩你和用户都接受的 low）→ 进入第 4 步。
- 若有 `blocker/high`（或你判断需修的 medium）→ 由你（主 agent）逐条修复，然后**重新派一个子代理复审**（同样独立读 git diff），直到干净。
- 最多 **3 轮**修复。超过 3 轮仍有 blocker/high，停下，把剩余问题清单交给用户人工判断，不要硬提交。记录时 `--verdict aborted`。

每轮修复要真正解决根因，不要为了过审查塞 workaround。

### 4. 提交前确认（必须）

1. 暂存合适的文件（`git add` 相关路径；不要盲目 `git add -A` 带进无关文件/产物）。
2. 生成 Conventional Commits 风格的 message，匹配本仓库风格（`feat/fix/docs/chore/refactor(scope): 描述`，可用中文描述）。message 末尾追加一行空行再加 trailer：

   ```
   Co-authored-by: TRAE CLI <noreply@bytedance.com>
   ```

3. 向用户展示：`git diff --cached --stat` 的 diff-stat + 完整 commit message + 审查结论（几轮、修了什么）。
4. **停下等用户确认**。用户明确同意后才提交；用户要改 message 就改；用户喊停就停（记录 `--verdict aborted`、`--committed false`）。

### 5. 提交并记录遥测

用户确认后：

```bash
git commit -m "<subject>" -m "<body>" -m "Co-authored-by: TRAE CLI <noreply@bytedance.com>"
```

**绝不 `git push`。** 提交完成后，取 commit hash，调用遥测脚本记录本次运行（脚本会自己算改动规模）：

```bash
node <skill目录>/scripts/log-run.mjs \
  --verdict <clean|fixed_then_clean|aborted|skipped> \
  --fix-rounds <N> \
  --committed <true|false> \
  --commit <hash或留空> \
  --before <本次提交前的HEAD>   # 见下方说明
```

> **规模统计口径**：`log-run.mjs` 默认统计“工作区相对 HEAD 的改动”。若已经 commit 完再记录，工作区已干净，统计会是 0。因此在**第 1 步汇总改动面时先记下 `git rev-parse HEAD`**（本次提交前的 HEAD），提交后把它作为 `--before` 传给脚本，让它用 `git diff <before>..HEAD` 统计本次实际提交的规模。若中止未提交，则不传 `--before`，脚本统计当前工作区改动。

即使用户中止提交，也要跑一次 `log-run.mjs`（`--committed false`），保证遥测数据不漏。

## 遥测数据

每次运行往 `~/.trae/review-and-commit/runs.jsonl` 追加一行 JSON，含时间、repo、分支、改动文件数/增删行数、是否命中敏感路径、审查结论、修复轮数、是否提交、commit hash。

这份数据的用途是：**观察你通常在什么规模/类型的改动上跑这个 skill**，为将来把它做成自动闸门（例如用 `PreToolUse` hook 拦 `git commit`，按阈值决定是否强制审查）积累依据。所以每次都记录，哪怕跳过了审查。

## 注意

- 绝不 `git push`、绝不 `--force`、绝不 `--no-verify`、绝不 `reset --hard`。
- 审查子代理必须是**独立**上下文，不要把你写代码的推理直接塞给它当结论。
- 遥测只记录规模与结论元数据，**不写 diff 内容**，避免源码泄露进日志。
- 提交信息不要包含任何 memory 引用块或与本次改动无关的内容。
