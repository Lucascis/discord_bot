module.exports = {
  extends: ['next/core-web-vitals'],
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: './tsconfig.json'
  },
  rules: {
    '@next/next/no-html-link-for-pages': 'off'
  }
};
