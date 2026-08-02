# resources/evals

Agent Skill 的统一评测目录。评测定义、夹具、评测辅助脚本和历史 iteration 产物按 Skill 名称隔离：

```text
resources/evals/<skill-name>/
├── evals.json
├── fixtures/
├── scripts/
├── tests/
└── workspace/
    └── iteration-N/
```

## 边界

- `resources/skills/<skill-name>/` 只保留安装后运行该 Skill 必需的文件。
- `resources/evals/<skill-name>/` 保存开发期评测资产，不随 Skill 全局安装。
- `evals.json` 中的 `files` 路径相对当前 Skill 的 eval 根目录。
- 评测命令从仓库根目录执行，避免依赖已安装 Skill 的软链位置。
- `workspace/` 保留 `skill-creator` 生成的 benchmark、grading 和静态 review，便于后续 iteration 对比。
