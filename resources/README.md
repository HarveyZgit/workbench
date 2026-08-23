# resources

独立 Agent Skills、Rules、Evals 是指向 [HarveyZgit/agents](https://github.com/HarveyZgit/agents) 的 git 符号链接（一个 submodule 只能占一个路径，因此只挂出这三个目录）：

| 路径 | 目标 |
| --- | --- |
| `resources/skills` | `../vendor/agents/skills` |
| `resources/rules` | `../vendor/agents/rules` |
| `resources/evals` | `../vendor/agents/evals` |

`vendor/agents` 是该仓库的 git submodule。克隆后先检出：

```sh
git submodule update --init vendor/agents
```

安装 Skills 到本机 Agent 宿主：

```sh
npx skills add HarveyZgit/agents
```
