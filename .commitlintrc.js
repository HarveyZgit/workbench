const path = require('path');

module.exports = {
  extends: [
    require.resolve('@commitlint/config-conventional', {
      paths: [path.join(__dirname, 'tools/repo')],
    }),
  ],
  rules: {
    'subject-case': [0, 'never', ['sentence-case', 'start-case', 'pascal-case', 'upper-case']],
  },
};
