# Architecture

## 原版 Finicky 为什么会慢

原始 Finicky 在点击 URL 后的热路径大致是：

1. macOS `kAEGetURL` 事件进入 Objective-C 壳
2. 进入 Go 主循环
3. 先同步调用短链解析
4. 再执行 JS 配置求值
5. 再启动 `open`
6. 等待子进程完成并读取输出

最重的同步点是短链解析：命中短链域名时会先发 `HEAD`，超时 750ms，失败后再补一次 `GET`。单次点击可能平白损失 750ms 到 1500ms。

次级问题是启动 `open` 之后继续同步读取 `stdout/stderr` 并 `Wait`，也不该出现在点击热路径里。

## 新架构

### 1. 极简 App 壳

当前实现直接使用 `Swift + AppKit`：

- Apple Event 接收
- 菜单栏入口
- `Add Current Page… / Open Config / Reload Config / Setup / Open Log / Install Update… / Launch at Login / Quit`
- 无设置窗口、无 WebView

### 2. 极简规则引擎

路由层只保留真实需求：

- 读取 `JSON` 配置
- 计算 `lowercase(hostname + pathname)`
- 遍历 `contains` 规则
- 首条命中即返回对应 `browser + profile`（省略 browser 为 Chrome）
- 未命中则返回 Chrome 的默认 profile

### 3. Chrome 启动

点击链接时，先看 Chrome 是否已经在跑，以及 `Local State` 里当前 Profile 状态：

- 已在跑、`last_used` 就是目标 Profile、且没有其它 Profile 的窗口（`last_active_profiles` 至多一项）：把 URL 交给正在运行的 Chrome（Launch Services，不新建实例）。这是单 Profile 前台时的快路径，避免再 exec 一遍 Chrome 二进制。
- 多个 Profile 同时有窗口时不走快路径：Apple Event 只会进最前的窗口，不能指定 Profile。
- 否则才走带 `--profile-directory` 的启动：
  - Web URL：直接执行 `Contents/MacOS/Google Chrome --profile-directory=<profile> <url>`
  - 本地文件：`/usr/bin/open -n -a <Chrome.app> --args --profile-directory=<profile> <path>`；Chrome 已在跑时加 `-g`，避免新实例先抢前台

不要在 spawn 之后立刻 `activate` 已有 Chrome。那会先把旧窗口拉到前台，再等新进程 dyld + singleton 把 URL 交过去——表现为「先聚焦已打开的浏览器，过一会儿才打开链接」。激活只留给 Chrome 尚未运行的冷启动，并且只做一次立即尝试加一次短延迟补偿。

### 4. Keep-warm

`directBinary` 会 spawn 完整 Chrome 二进制。框架页被换出后冷启动可到数秒。`ChromeWarmer` 对 `Google Chrome Framework` 做 `mmap`。`mincore` 是系统级的：Chrome 自己已把框架留在 cache 时 mincore 也会很高，但 Fast Finicky 的页表里可能还没有 PTE，进程 RSS 仍然很小。因此首次 map（以及 inode 变化后的 remap）必须逐页 touch，把框架 fault 进本进程，让本进程 RSS ≈ 框架大小（~458MB / 0.5GB）。Activity Monitor 的 Memory 看的是 phys_footprint，干净的 file-backed 页经常不算进去，会显得很小；用 `ps -o rss=` 或 warm 日志的 `rss_mb`。timer tick 在已经 fault 过且 mincore ≥ 0.9 时可以跳过 touch。不做 `mlock`，页仍可回收。`Current` 符号链接换 inode 时重新 map。退出时在 isolation queue 上 `stop()` / unmap，避免 timer 与 `deinit` 并发。

### 5. 日志与热重载

- 日志目录固定为 `~/.local/state/fast-finicky/logs/`
- 日志按天写入 `YYYY-MM-DD.log`
- 只保留最近 `7` 天
- `[route] elapsed_ms` 只覆盖分流 + spawn/reuse 交出去的时间（`process.run()` 立刻返回）。Chrome 真正接住链接的墙钟时间写在后续 `[open]`：`elapsed_ms` + `status=ready|exited|timeout` + `chrome_was_running`。在热路径之外轮询，最多 20s。`directBinary` 在 Chrome 已运行时看子进程退出（singleton 交接）；冷启动看 `isFinishedLaunching`。
- 配置文件变更后自动 reload
- reload 失败时继续使用上一版有效配置
- 菜单 `Setup` 扫描 Chrome，给还没有 rule 的 profile **追加 rule**：`name`/`email` 作对照，`contains` 留空（空规则不匹配 URL）。已有 rule 缺 `name`/`email` 时只补这两个字段，不改 `contains`/`profile`，也不删 rules。邮箱先读 Local State `info_cache.user_name`（须含 `@`），没有再读该 profile 的 Preferences `account_info[].email`。
- 菜单 `Launch at Login` 开关 `~/Library/LaunchAgents/com.harvey.fastfinicky.plist`，用 `/usr/bin/open -ga <当前.app>` 开机启动；取消勾选则 unload 并删除 plist。启用时会清掉旧的 `dev.fastfinicky.app` agent。
- 菜单 `Add Current Page…`：Chrome 为前台时可用；AppleScript 读当前标签 URL，在菜单栏下方打开 utility 面板（当前页面只读、Profile 下拉、Contains 输入、Cancel/Add），新 rule 插到列表最前。
- 菜单 `Install Update…`：从本机 zip 安装。`ditto` 解压，校验 `com.harvey.fastfinicky`，`xattr -cr` 去掉隔离属性，把新 `.app` 放到当前 bundle 旁边，退出后 helper 替换并 `open`。不访问 GitHub。需要正在跑 `.app`（`swift run` 不可用）。


## Ego Lite 适配器

`EgoBrowserLauncher` 与原有 `BrowserLauncher` 分开，后者继续只管 Chrome。Ego 规则通过官方 `ego-browser nodejs -e <script>` 打开明确的 profile ID。JSONEncoder 把 URL / ID 编码为数据，Process 直接传 argv，不经过 shell，不依赖 shell 的环境变量或工作目录。

只用原生 API，不创建 TaskSpace、不采用 SDK 的 managed-page 清理：

1. `listTaskSpaces()` 按返回顺序筛选 profileId 精确匹配且 ownership=user 的 Space，选第一个。没有则失败，不创建或回退。
2. 再次枚举并核对选定项的 ID、profile、名称和 user ownership；变化则停止，不改选。
3. `claimTaskSpace(id)` 暂时取得控制，不传 name，不重命名。验证返回 ID，并再次枚举核对 profile/名称/agent ownership。
4. `useTaskSpace(id)` → `createTab(url)` → `completeTaskSpace()`。保留全部原有标签，不等待页面 load。createTab 可复用空白标签，否则打开前台新标签。
5. 每个原生 error 对象和 Promise 拒绝都停止流程；任何失败/不确定结果都不自动重试，也不在 finally 中 complete 或关闭 Space。claim 后失败可能留下 agent 状态，需用户手动接管。

公开 API 没有 compare-and-claim，二次检查不能消除与外部 agent 的并发竞态，不能承诺原子排他。只保证不会主动选择已观察到的 agent/agentDelegatedToUser/未知 ownership；变更后的已知不安全状态立即失败。

App 在进程退出回调写 `[open] browser=ego status=completed|failed exit_code=...`；`[route] result=queued` 仅代表已进入队列。completed 代表创建标签/交还成功，不代表网页加载成功。Ego 不走 ChromeOpenObserver，不触发 Chrome warmNow。CLI 等待退出并把失败转成非零退出码。stderr 后台持续读取，最多保留 8 KiB 错误详情。

`EgoLaunchScheduler` 是进程内共享的、按 exact profile ID 分组的 FIFO。enqueue 立即返回，启动和队列更新在独立串行调度队列中执行；异步 CLI 完成后才释放同 profile 的下一条。不同 profile 不互相等待，完成回调在 utility 队列执行。spawn 错误也释放排队请求且不重试。每个请求有内部 UUID，过期/重复回调不能错误释放后续请求。它不构成跨进程/跨 agent 的锁。挂起且不退出的 CLI 会阻塞该 profile 后续请求；不会在 ownership 结果不确定时自动超时终止或重试。

配置只新增可选 `browser`，不新增 Space ID 或 target 层。Browser enum 只支持 chrome/ego；旧规则与旧 RouteDecision 解码默认 Chrome。Chrome Setup 仅对 Chrome 规则补账号信息。ProfileOption 按 browser + profile 去重，保留 Ego ID 大小写。fallback 永远是 Chrome defaultProfile。

测试：BrowserRoutingTests / EgoBrowserLauncherTests / EgoLaunchSchedulerTests 覆盖数据与参数边界。Node 测试直接提取嵌入脚本并 mock 原生 API，覆盖第一项选择、零匹配、agent 排除、前后状态变化、错误对象/拒绝、未知结果和不重试。它不代替 macOS 构建或 Ego 实机验证。


## 便携核心验收边界

`Package.swift` 在 macOS 保留原有 `FastFinicky`、`fast-finicky-cli` 与 `FastFinickyCore` 产品和 macOS 12 最低版本。Linux 仅暴露核心库与 XCTest target，目的是在无 macOS SDK 的环境验收同一份核心源码，而不是新增桌面平台支持。

- 路由、配置、日志、Chrome profile 数据、Ego 脚本生成与 FIFO 调度直接跨平台编译。
- `BrowserLauncher` 的决策、参数组装和注入式测试保持跨平台；默认初始化与 NSWorkspace / NSRunningApplication 适配仅在 macOS 编译。Linux 不提供假冒的浏览器启动默认实现。
- `ChromeOpenObserver.observe` 接受全部平台探针，负责可测试的轮询状态机；原 macOS `wait` API 保留原生默认探针，并委托给它。
- `LaunchAtLogin` 使用 Darwin/Glibc 条件导入以测试 plist、回滚和命令计划；其 macOS launchctl 行为不变。
- `ChromeWarmer` 和 `ConfigWatcher` 保留原实现，只在 macOS 编译。3 项 warmer 测试与 2 项真实 app replacement 脚本测试在 Linux 明确跳过，macOS 不跳过。

`./scripts/test-core.sh` 聚合核心构建、Swift XCTest 和嵌入 JavaScript 契约测试。Linux 验收不能验证 Apple Events、菜单栏、LaunchServices 注册、原生窗口前台行为、文件权限或 Ego 浏览器实际 API；这些仍是 macOS 构建与实机验收的独立关卡。
