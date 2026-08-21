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
      "profile": "Profile 9"
    }
  ]
}
```

匹配输入是 `lowercase(hostname + pathname)`，忽略 query 和 hash。规则按顺序首条命中生效，未命中用 `defaultProfile`。

首次启动时，如果配置文件还不存在，会写入一份当前常用规则的默认配置。已有配置不会被覆盖。

日志：`~/.local/state/fast-finicky/logs/YYYY-MM-DD.log`，只保留最近 7 天。

菜单：`Open Config` / `Reload Config` / `Open Log` / `Quit`。

## 构建与测试

本包是 Swift Package，**不进 Rush**。需要 macOS 14+ 和 Swift 6。

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
swift run fast-finicky-cli --url 'https://people-byte-my.byteintl.com/path?q=1' --dry-run
```

沙箱测试可以把 `FAST_FINICKY_HOME` 指到临时目录，避免读写真实 `~/.config`。
