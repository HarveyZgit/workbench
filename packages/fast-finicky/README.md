# Fast Finicky

macOS 菜单栏应用：把链接按规则分流到指定的 Chrome Profile。当作默认浏览器使用。

只做这件事：

- 只打开 Google Chrome
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

菜单 **Setup** 或 `fast-finicky-cli --setup` 会扫描本机 Chrome，给还没有 rule 的 profile 追加一条，`contains` 留空。已有 rule 缺 `name`/`email` 时只补这两个对照字段，不改 `contains`/`profile`，也不删已有 rules。空 `contains` 不会命中任何 URL，链接仍走 `defaultProfile`，直到你填上真正的 host/path。邮箱来自 Chrome 登录账号；没登录 Google 账号的 profile 仍然没有 email。

首次启动时，如果配置文件还不存在，会写入一份当前常用规则的默认配置。已有配置不会被覆盖。

日志：`~/.local/state/fast-finicky/logs/YYYY-MM-DD.log`，只保留最近 7 天。

菜单：`Add Current Page…` / `Open Config` / `Reload Config` / `Setup` / `Open Log` / `Launch at Login` / `Quit`。

`Add Current Page…` 在 Google Chrome 为当前前台应用时可用。点开后读取当前标签 URL，选一个 profile，把规则插到 `rules` 最前面。输入框会填入当前 URL；保存时按 host + path 写入 `contains`（忽略 query/hash）。首次使用需允许控制 Chrome。

`Launch at Login` 勾选后写入 `~/Library/LaunchAgents/com.harvey.fastfinicky.plist`，开机用当前这个 `.app` 路径启动。再点一次取消勾选即关闭。

## 构建与测试

本包是 Swift Package，**不进 Rush**。需要 macOS 12+ 和 Swift 5.7（Xcode 14）。

```sh
cd packages/fast-finicky
swift test
./scripts/build-app.sh debug
```

产物：`packages/fast-finicky/dist/Fast Finicky.app`。把它设为默认浏览器即可。

## CLI

用来核对某个 URL 会进哪个 Profile，不启动菜单栏应用：

```sh
cd packages/fast-finicky
swift run fast-finicky-cli --setup
swift run fast-finicky-cli --url 'https://people-byte-my.byteintl.com/path?q=1' --dry-run
```

沙箱测试可以把 `FAST_FINICKY_HOME` 指到临时目录，避免读写真实 `~/.config`。
