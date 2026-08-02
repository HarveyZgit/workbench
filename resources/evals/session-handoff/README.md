# session-handoff evals

`session-handoff` Skill 的评测入口。评测资产与安装后的 Skill 分离：

- Skill：`resources/skills/session-handoff/`
- Evals：`resources/evals/session-handoff/`
- Iteration workspace：`resources/evals/session-handoff/workspace/`

## skill-creator 适配

本仓库覆盖 `skill-creator` 的默认相邻目录约定。运行或迭代时显式使用：

- Skill path：`resources/skills/session-handoff`
- Eval definition：`resources/evals/session-handoff/evals.json`
- Workspace：`resources/evals/session-handoff/workspace/iteration-N`

`evals.json` 中的 `files` 相对本目录解析，不相对 Skill 根目录。

生成评审页面：

```sh
python3 ~/.agents/skills/skill-creator/eval-viewer/generate_review.py \
  resources/evals/session-handoff/workspace/iteration-1 \
  --skill-name session-handoff \
  --benchmark resources/evals/session-handoff/workspace/iteration-1/benchmark.json \
  --static resources/evals/session-handoff/workspace/iteration-1/review.html
```

## 本地验证

```sh
python3 resources/evals/session-handoff/tests/test_validate_handoff.py
python3 resources/evals/session-handoff/tests/test_setup_eval_workspace.py
```
