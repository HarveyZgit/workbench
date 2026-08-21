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
- `Open Config / Reload Config / Open Log / Quit`
- 无设置窗口、无 WebView

### 2. 极简规则引擎

路由层只保留真实需求：

- 读取 `JSON` 配置
- 计算 `lowercase(hostname + pathname)`
- 遍历 `contains` 规则
- 首条命中即返回对应 `Chrome Profile`
- 未命中则返回默认 profile

### 3. Chrome 启动

当前实现按目标类型分成两条热路径：

- Web URL:
  - 定位 `Google Chrome.app`
  - 直接执行 `Contents/MacOS/Google Chrome`
  - 传入 `--profile-directory=<profile> <url>`
  - 不等待 Chrome 进程结束
- 本地文件:
  - 继续走 `/usr/bin/open -n -a <Chrome.app> --args --profile-directory=<profile> <path>`
  - 保留 HTML 文件打开兼容性

激活策略也保持尽量短：

- 先立即尝试一次 `activate`
- 只在首次没拿到运行中的 Chrome 时，再做一次短延迟补偿

### 4. 日志与热重载

- 日志目录固定为 `~/.local/state/fast-finicky/logs/`
- 日志按天写入 `YYYY-MM-DD.log`
- 只保留最近 `7` 天
- 配置文件变更后自动 reload
- reload 失败时继续使用上一版有效配置
