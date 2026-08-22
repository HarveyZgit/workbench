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
- `Add Current Page… / Open Config / Reload Config / Setup / Open Log / Launch at Login / Quit`
- 无设置窗口、无 WebView

### 2. 极简规则引擎

路由层只保留真实需求：

- 读取 `JSON` 配置
- 计算 `lowercase(hostname + pathname)`
- 遍历 `contains` 规则
- 首条命中即返回对应 `Chrome Profile`
- 未命中则返回默认 profile

### 3. Chrome 启动

点击链接时，先看 Chrome 是否已经在跑，以及 `Local State` 里当前 Profile 状态：

- 已在跑、`last_used` 就是目标 Profile、且没有其它 Profile 的窗口（`last_active_profiles` 至多一项）：把 URL 交给正在运行的 Chrome（Launch Services，不新建实例）。这是单 Profile 前台时的快路径，避免再 exec 一遍 Chrome 二进制。
- 多个 Profile 同时有窗口时不走快路径：Apple Event 只会进最前的窗口，不能指定 Profile。
- 否则才走带 `--profile-directory` 的启动：
  - Web URL：直接执行 `Contents/MacOS/Google Chrome --profile-directory=<profile> <url>`
  - 本地文件：`/usr/bin/open -n -a <Chrome.app> --args --profile-directory=<profile> <path>`；Chrome 已在跑时加 `-g`，避免新实例先抢前台

不要在 spawn 之后立刻 `activate` 已有 Chrome。那会先把旧窗口拉到前台，再等新进程 dyld + singleton 把 URL 交过去——表现为「先聚焦已打开的浏览器，过一会儿才打开链接」。激活只留给 Chrome 尚未运行的冷启动，并且只做一次立即尝试加一次短延迟补偿。

### 4. Keep-warm

`directBinary` 会 spawn 完整 Chrome 二进制。框架页被换出后冷启动可到数秒。`ChromeWarmer` 对 `Google Chrome Framework` 做 `mmap`，用 `mincore` 检查驻留，必要时再 `madvise(WILLNEED)` + 逐页 touch。`Current` 符号链接换 inode 时重新 map。退出时在 isolation queue 上 `stop()` / unmap，避免 timer 与 `deinit` 并发。

### 5. 日志与热重载

- 日志目录固定为 `~/.local/state/fast-finicky/logs/`
- 日志按天写入 `YYYY-MM-DD.log`
- 只保留最近 `7` 天
- 配置文件变更后自动 reload
- reload 失败时继续使用上一版有效配置
- 菜单 `Setup` 扫描 Chrome，给还没有 rule 的 profile **追加 rule**：`name`/`email` 作对照，`contains` 留空（空规则不匹配 URL）。不删、不改已有 rules。
- 菜单 `Launch at Login` 开关 `~/Library/LaunchAgents/com.harvey.fastfinicky.plist`，用 `/usr/bin/open -ga <当前.app>` 开机启动；取消勾选则 unload 并删除 plist。启用时会清掉旧的 `dev.fastfinicky.app` agent。
- 菜单 `Add Current Page…`：Chrome 为前台时可用；AppleScript 读当前标签 URL，在菜单栏下方打开 utility 面板（当前页面只读、Profile 下拉、Contains 输入、Cancel/Add），新 rule 插到列表最前。
