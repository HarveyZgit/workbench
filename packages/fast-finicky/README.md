# Fast Finicky

macOS 菜单栏应用：把链接按规则分流到指定浏览器的 Profile，默认使用 Chrome。当作默认浏览器使用。

只做这件事：

- 默认打开 Google Chrome，可逐条规则选择 Ego Lite
- 用 `host + path` 的小写包含匹配选 Profile
- 菜单栏常驻，没有设置窗口
- 配置是 JSON，不跑 JS、不做短链解析、不改写 URL

## 配置

默认路径：`~/.config/fast-finicky/config.json`

```json
{
  "defaultProfile": "Profile 1",
  "rules": [
    {
      "contains": ["antigravity.google"],
      "profile": "Profile 43"
    },
    {
      "contains": ["people-byte-my.byteintl.com", "samebyte"],
      "name": "Cloudvxz",
      "profile": "Profile 9"
    }
  ]
}
```

匹配输入是 `lowercase(hostname + pathname)`，忽略 query 和 hash。规则按顺序首条命中生效，未命中用 `defaultProfile`。`name` / `email` 只是对照 Chrome 里这个 profile 是谁，**不参与匹配**。

### 选择 Ego Lite

旧配置不需要修改。省略 `browser` 等同于 `"chrome"`；未命中规则始终使用 Chrome 的 `defaultProfile`。只有写了 `"browser": "ego"` 的规则才使用 Ego Lite：

```json
{
  "defaultProfile": "Profile 1",
  "rules": [
    {
      "contains": ["example.com/work"],
      "browser": "ego",
      "profile": "<Ego 的实际 profile ID>"
    },
    {
      "contains": ["example.org"],
      "browser": "chrome",
      "profile": "Profile 9"
    }
  ]
}
```

`browser` 只接受 `chrome` / `ego`。Chrome 的 `profile` 仍是目录名；Ego 的 `profile` 是区分大小写的实际 ID，不能填显示名称，也不能填表示当前 profile 的小写 `default`。实际 ID `Default` 可以使用。不同浏览器中同名的 profile 是不同目标。

先安装并打开 Ego Lite，完成其官方 CLI 设置。Fast Finicky 依次查找 `~/.local/bin/ego-browser`、`/opt/homebrew/bin/ego-browser`、`/usr/local/bin/ego-browser`，不依赖 GUI 应用的 `PATH`，不会安装 CLI 或自动授予权限。用官方 CLI 查询 ID：

```sh
~/.local/bin/ego-browser nodejs -e 'console.log(await profiles())'
```

不需要配置或了解 Space ID。Fast Finicky 枚举 Ego 的现有 Space，只保留 `profileId` 与规则 `profile` 完全相同、且 `ownership` 为 `user` 的项；排除 `agent`、`agentDelegatedToUser` 及未知状态。多个符合条件时，按 Ego API 返回顺序取第一个，不再弹窗，也不声称它是最近使用的窗口。没有符合项就报错，提示先在 Ego 打开这个 profile 的用户窗口，不自动创建 Space。

打开前再次检查所选项的 profile、名称和 ownership；变化时停止，不换另一个目标。随后暂时 claim 该用户 Space，用原生 `createTab(url)` 打开链接，再用 `completeTaskSpace()` 交还，保留原有标签。Ego 可能复用空白/新标签页，否则打开前台新标签。不调用关闭标签或 Space 的接口，也不等待网页资源加载。Ego 使用自己的 profile 数据，不会复用同名 Chrome profile 的登录状态。

**并发限制：** Ego 的公开 API 没有原子的“仅在仍属于 user 时 claim”接口。二次检查可以避免占用已观察到的 agent Space，但检查和 claim 之间仍有竞态，不能保证另一个 agent 同时开始工作时绝无冲突。claim 后再次检查 profile/名称/ownership；发现变化立即停止。不要把该流程当作跨 agent 的互斥锁。

找不到 CLI、无符合项、状态变化、原生错误或不确定结果时，不回退到 Chrome/其它 profile，不自动重试或清理。claim 后失败可能留下 agent 状态，需用户在 Ego 中接管；程序不会冒险再次 claim、结束别的任务或关闭标签。异步失败记录在 `[open] status=failed`、`exit_code` 与最多 8 KiB 的 CLI 错误详情。同一 Fast Finicky 进程内，同一个 Ego profile 的链接按到达顺序异步排队；前一条 CLI 完成后才启动下一条，避免连续点击误把自己的临时 agent 状态当作占用。不同 profile 可并行。排队不阻塞菜单栏/Apple Event 线程；`[route] result=queued` 表示已入队，`[open]` 记录最终结果。不同 CLI 进程或其它 agent 的竞争仍受上述并发限制。如果 Ego CLI 一直不结束，该 profile 的队列会暂停等待；为避免在 ownership 变更途中误操作，不自动超时杀进程或重试。CLI 非 dry-run 等待命令结束并返回失败退出码。`completed` 只表示原生创建标签与交还成功，不代表页面已经加载或内容正确。

Ego 支持路由 http/https/file URL；本地文件用完整 `file://` URL 传入。实际本地文件权限、冷启动、前台显示与 profile 隔离仍需在 macOS/Ego 上验证。Chrome 的原有直接启动、实例复用、文件启动和 keep-warm 路径不变。

`Setup` 仍只扫描 Chrome，绝不会用 Chrome 账号信息覆盖 Ego 规则。`Add Current Page…` 仍从前台 Chrome 读取链接，但目标列表包含已配置的 Ego profile。

参考：[Ego 原生 API](https://github.com/citrolabs/ego-lite/wiki/Ego-Native-API-Reference)、[CLI 架构](https://github.com/citrolabs/ego-lite/wiki/Ego-Browser-CLI-Architecture)。

菜单 **Setup** 或 `fast-finicky-cli --setup` 会扫描本机 Chrome，给还没有 rule 的 profile 追加一条，`contains` 留空。已有 rule 缺 `name`/`email` 时只补这两个对照字段，不改 `contains`/`profile`，也不删已有 rules。空 `contains` 不会命中任何 URL，链接仍走 `defaultProfile`，直到你填上真正的 host/path。邮箱来自 Chrome 登录账号；没登录 Google 账号的 profile 仍然没有 email。

首次启动时，如果配置文件还不存在，会写入一份当前常用规则的默认配置。已有配置不会被覆盖。

日志：`~/.local/state/fast-finicky/logs/YYYY-MM-DD.log`，只保留最近 7 天。`[route] elapsed_ms` 是分流自己的耗时；每次打开的体感耗时看 `[open] elapsed_ms`（Chrome 的 `status` 为 `ready` / `exited` / `timeout`；Ego 为 `completed` / `failed`）。

菜单：`Add Current Page…` / `Open Config` / `Reload Config` / `Setup` / `Open Log` / `Install Update…` / `Launch at Login` / `Quit`。

`Add Current Page…` 在 Google Chrome 为当前前台应用时可用。点开后读取当前标签 URL，选一个 profile，把规则插到 `rules` 最前面。输入框会填入当前 URL；保存时按 host + path 写入 `contains`（忽略 query/hash）。首次使用需允许控制 Chrome。

`Install Update…` 选一份 Fast Finicky 的 release zip（默认打开「下载」）。校验 bundle id 后清掉隔离属性，替换正在运行的 `.app` 并重启。以后升级不用再手敲 `xattr`。第一次从浏览器解压安装仍可能要 `xattr` 一次（未签名 + 隔离属性）。不请求 GitHub API。

`Launch at Login` 勾选后写入 `~/Library/LaunchAgents/com.harvey.fastfinicky.plist`，开机用当前这个 `.app` 路径启动。再点一次取消勾选即关闭。

## 构建与测试

本包是 Swift Package，**不进 Rush**。桌面应用需要 macOS 12+ 和 Swift 5.7+（Xcode 14+）。Linux 可用于核心测试，不生成 macOS 应用，也不提供 Linux 浏览器分流产品。

```sh
cd packages/fast-finicky
swift test
./scripts/build-app.sh debug
# 可选：无浏览器的 Ego 脚本契约测试（需要 Node.js 18+）
node --test scripts/test-ego-opener.mjs
```

产物：`packages/fast-finicky/dist/Fast Finicky.app`。把它设为默认浏览器即可。

核心验收（macOS 或安装了官方 Swift 工具链的 Linux）：

```sh
./scripts/test-core.sh
```

Linux 构建同一份 `FastFinickyCore` 源码并运行 XCTest，不替换成另一语言的模拟实现。覆盖路由、配置持久化、profile 隔离、Chrome 启动参数与状态判断、Ego 脚本生成、同 profile 排队，以及真实子进程的参数、退出码和 stderr 读取。Node 契约测试再执行实际嵌入脚本，但使用 mock Ego API。

Linux 不编译 AppKit/Carbon 菜单栏应用或原生 CLI，不编译 `ChromeWarmer` / `ConfigWatcher`，不调用 NSWorkspace。3 项原生内存映射测试和 2 项 macOS 更新脚本集成测试明确标为 skipped；它们在 macOS 上仍运行。LaunchAgent 和更新 bundle 的便携测试使用临时文件与注入命令，不代表 launchctl / ditto / xattr 已在 macOS 实测。核心通过不等于 macOS 构建、默认浏览器注册、前台显示或 Ego 实机联调通过。


## CLI

用来核对某个 URL 会进哪个 Profile，不启动菜单栏应用：

```sh
cd packages/fast-finicky
swift run fast-finicky-cli --setup
swift run fast-finicky-cli --url 'https://people-byte-my.byteintl.com/path?q=1' --dry-run
```

沙箱测试可以把 `FAST_FINICKY_HOME` 指到临时目录，避免读写真实 `~/.config`。


### 多浏览器验证清单

- `swift test`：旧 JSON、浏览器选择、配置保存/Setup、同名 profile、Ego 参数编码及错误路径。
- `node --test scripts/test-ego-opener.mjs`：使用 mock 执行 Swift 中实际嵌入的脚本，不连接浏览器。
- macOS 手测：Chrome web/file 与原有实例复用；Ego 正确 profile 的 web/file、多个用户 Space 取第一项、排除 agent Space、无符合项、连续点击、CLI 缺失、用户接管、冷启动及前台显示。
- `--dry-run` 输出含 `browser`，不会连接 Ego 或打开任何浏览器。
