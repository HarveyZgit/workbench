## Context

安装面有三块：Chrome 扩展（只能手装）、Native Messaging host（CLI 可写清单）、Agent Skill（必须用户指定目录）。一个 npm 包把后两块和运行时收进 `dom-comment` 二进制。

## Goals

- GitHub Release 发 `dom-comment.zip`；`install.sh` 下载并装到用户目录，链出 `dom-comment` CLI。
- Skill 软链指向安装树里的源文件，并通过向上查找 `dist/cli.js` 定位运行时。
- 交互安装只列出本机已存在的 `~/.<name>/skills`，不写死宿主名。

## Decisions

1. **不新增依赖。** 交互用 `node:readline`。探测 skill 根目录的规则与 markdown-comment 相同（点目录下的 `skills/`），代码不共享包。
2. **扩展打进 `dist/chrome-mv3`。** `extension` 只打印绝对路径。构建不再以 `.output/` 为分发目录。
3. **存储。** 源码树（存在 `src/cli.ts`）继续 `package/data/`。zip 安装用 macOS `~/Library/Application Support/dom-comment`（其它平台 `~/.dom-comment`）。`DOM_COMMENT_STORAGE_DIR` 仍优先。Native host wrapper 写在存储目录。
4. **`setup` 作为 `install` 的别名**，避免旧文档立刻失效。
5. **Release tag `dom-comment-v*`。** 单仓多包，`install.sh` 不取 GitHub 的 `latest`，只认这个前缀下带 `dom-comment.zip` 的 Release。

## Risks

- Chrome 仍必须手装扩展：安装结束打印路径，并可用 `extension` 再取一次。
- 升级会替换 `pkg/`：Skill 软链若指向该树，重跑 `install.sh` 即可。
