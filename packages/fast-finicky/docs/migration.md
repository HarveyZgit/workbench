# Migration

## 迁移目标

迁移方式已经从“兼容旧 `.finicky.js`”改成“一次性翻译成新 JSON 配置”：

1. 不保留 JS 兼容层
2. 直接把现有规则收敛成更简单的新格式
3. 用新的菜单栏应用接管默认浏览器

## 新配置位置

- `~/.config/fast-finicky/config.json`

首次启动时，应用会自动生成一份默认配置，内容已经按你当前活跃规则翻译完成。

### 渐进式接管

建议按这个顺序切换：

1. 用 `fast-finicky-cli --url ... --dry-run` 验证几个关键 URL 的命中 profile
2. 检查 `~/.config/fast-finicky/config.json` 是否符合预期
3. 构建并打开 `dist/Fast Finicky.app`
4. 将它设为默认浏览器
5. 保留旧 Finicky 一段时间作为回退手段

## 已迁移的规则语义

新版本只保留这套固定语义：

- 匹配输入：`lowercase(hostname + pathname)`
- `contains` 为“任一命中”
- 按顺序首条命中生效
- 无命中回退 `defaultProfile`
- 忽略 query 和 hash

## 明确不迁移的能力

- `.finicky.js` / `.ts`
- 正则
- rewrite
- 短链解析
- 多浏览器分流
- 动态 JS 函数规则

## 下一步

如果继续迭代，最值得补的是：

1. 更完整的安装脚本
2. 可选的配置语法校验命令
3. 更好的菜单栏图标和签名打包
