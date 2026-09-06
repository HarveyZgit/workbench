# DOM Comment

在自己的 Chrome 里标记页面元素或框选区域，写下评论，并让 Agent 通过 CLI / Skill 读取、回复。

本包是 `markdown-comment` 的兄弟产品，不共用存储或类型。

## 安装

仓库是私有的，匿名 `curl` 下载 Release 会 404。用已登录的 GitHub CLI 下载 tarball，再全局安装：

```sh
gh release download dom-comment-v0.1.0 --repo HarveyZgit/workbench -p 'dom-comment-*.tgz'
npm install -g ./dom-comment-0.1.0.tgz
dom-comment install-skill
dom-comment extension
```

然后把打印出的目录拿到 `chrome://extensions` → 开发者模式 →「加载已解压的扩展程序」。Chrome 不允许脚本代装扩展。要标注 `file://` 页面，在该扩展详情勾选「允许访问文件网址」（Chrome 无法从代码打开这项）。`chrome://` 仍不支持。

源码树开发：

```sh
cd packages/dom-comment
rushx build
node dist/cli.js install-skill
```

打 Release tarball（资源是 `dist/dom-comment-*.tgz`，不再发 zip 或 install.sh）：

```sh
cd packages/dom-comment
rushx pack-release
```

## 使用

1. **左键单击** Chrome 工具栏扩展图标进入标注模式（再点一次可退出；Esc / 刷新页面也会退出，刷新后不会恢复模式）。
2. 单击元素、划选文字，或直接拖出区域，写评论。保存时立刻落盘并裁切截图。
3. 右键工具栏图标或页面空白处，选「复制 skill prompt」得到 `/dom-comment tabid:…`。
4. 页内右下角悬浮球打开右侧评论抽屉：列表、解决、点击滚到锚点。Esc 先关抽屉，再 Esc 退出标注。
5. 把 skill prompt 贴给 Agent，或直接说「看看我刚才的网页标记」。

Agent 只根据评论和截图判断，不要把浏览器唤到前台。`open --tab` 仅在用户明确要求聚焦原标签时使用。不上 Playwright / CDP / headless。

## CLI

```sh
dom-comment install-skill [--target <skill-root>]
dom-comment extension
dom-comment list --open
dom-comment list --tab 1847 --url 'https://example.com/app' --json
dom-comment reply <threadId> '已处理'
dom-comment resolve <threadId>
dom-comment open --tab 1847
dom-comment ping-host
```

源码树里评论写在包内 `data/`（已 gitignore）。全局安装后写到用户目录（macOS 为 `~/Library/Application Support/dom-comment`）。测试可用 `DOM_COMMENT_STORAGE_DIR`。

Native Messaging 清单仍必须写在 Chrome 的 `NativeMessagingHosts/`（浏览器 API 要求）。

## 开发

```sh
rush test --to dom-comment
rush typecheck --to dom-comment
rush build --to dom-comment
```

扩展打进 `dist/chrome-mv3`。OpenSpec change：`openspec/changes/npm-cli-package`。

手工复跑见 [tests/manual/cases.md](tests/manual/cases.md)（先跑文首 15 分钟冒烟）。
