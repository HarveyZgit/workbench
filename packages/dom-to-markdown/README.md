# DOM to Markdown

一个完全在本地运行的 Manifest V3 Chrome 扩展：通过右键菜单把当前选区或页面正文转换为 Markdown，并写入剪贴板。

## 构建

该包是静态浏览器扩展，不是 Rslib library。构建脚本会把 `src/manifest.json`、后台脚本、内容脚本和 Turndown runtime 复制到 `dist/`：

```sh
emo run build --filter './packages/dom-to-markdown'
```

## 验证

测试会先重新构建，再检查 `dist/manifest.json` 引用的运行时文件是否完整：

```sh
emo run test --filter './packages/dom-to-markdown'
```
