const standardPrettierConfig = require('./infra/node_modules/@byted/prettier-config-standard')

// 配置可参考 https://prettier.io/en/configuration.html
module.exports = {
  // https://bytedance.larkoffice.com/wiki/wikcnrGHuwRKpge1f2HTZQTdJHd
  ...standardPrettierConfig,

  // 使用较大的打印宽度，因为 Prettier 的换行设置似乎是针对没有注释的 JavaScript.
  printWidth: 110,

  // 使用 .gitattributes 来管理换行
  endOfLine: 'auto',

  // 单引号代替双引号
  singleQuote: true,
};
