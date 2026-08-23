# DOM Comment

在自己的 Chrome 里标记页面元素或框选区域，写下评论，并让 Agent 通过 CLI / Skill 读取、回复。

本包是 `markdown-comment` 的兄弟产品，不共用存储或类型。

## 安装（本机）

三件套（扩展 / 本机 host / Skill）收成一条命令。Chrome 不允许脚本代装扩展，所以还剩一次手点：

```sh
cd packages/dom-comment
rushx setup
```

会构建、登记 Native Messaging host、若存在则把 Skill 链到 `~/.agents/skills`，并打开扩展目录。然后：

1. `chrome://extensions` → 开发者模式
2. 「加载已解压的扩展程序」→ 选中弹出的 `.output/chrome-mv3`

以后改代码再跑一次 `rushx setup`，刷新扩展即可。

拆开装仍可用：`install-host`、`install-skill --target <dir>`。

## 使用

1. 点工具栏打开弹窗，点「开始标记」。
2. 单击元素、划选文字，或直接拖出区域，写评论。保存时立刻落盘并裁切截图。
3. 打开工具栏弹窗，点「复制 skill prompt」得到 `/dom-comment tabid:…`。Esc 退出后页面上的钉子会收掉，数据还在。
4. 把这一行贴给 Agent。

复现：Agent 先看截图；`open --tab` 只聚焦原标签。不上 Playwright / CDP。

## CLI

```sh
node dist/cli.js list --open
node dist/cli.js list --tab 1847 --url 'https://example.com/app' --json
node dist/cli.js reply <threadId> '已处理'
node dist/cli.js resolve <threadId>
node dist/cli.js open --tab 1847
node dist/cli.js ping-host
```

评论和截图存在包内 `packages/dom-comment/data/`（已 gitignore），不写 `~/.dom-comment`。测试可用 `DOM_COMMENT_STORAGE_DIR`。

Chrome 的 profile 里扩展设置是 LevelDB，CLI/Agent 不能当 JSON 读，所以不用那套目录。Native Messaging 清单仍必须写在 Chrome 的 `NativeMessagingHosts/`（浏览器 API 要求）。

## 待办

- 安装形态：即便 `rushx setup` 合并了 host 和 Skill，加载解压扩展仍要手点。以后再想办法收。

## 开发

```sh
rush test --to dom-comment
rush typecheck --to dom-comment
rush build --to dom-comment
```

扩展用 esbuild 打 MV3（未上 WXT，UI 是 Shadow DOM + 接近 shadcn 的原生组件，避免 Rush 里再引一套 Vite）。OpenSpec change：`openspec/changes/reshape-annotation-loop`。
