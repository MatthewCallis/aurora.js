/* eslint no-console: 0 */
const { rollup } = require('rollup');
const babel = require('rollup-plugin-babel');
const json = require('rollup-plugin-json');
// const resolve = require('rollup-plugin-node-resolve');
// const commonjs = require('rollup-plugin-commonjs');

[
  'browser',
  'browser_slim',
  'node',
].forEach((format) => {
  rollup({
    entry: `./${format}.js`,
    plugins: [
      // resolve({
      //   jsnext: true,
      //   main: true,
      //   browser: true,
      // }),
      // commonjs(),
      json({
        exclude: ['node_modules/**'],
      }),
      // babel({
      //   exclude: 'node_modules/**',
      //   plugins: ['external-helpers'],
      // }),
    ],
  })
  .then(bundle => (
    bundle.write({
      format: 'es',
      moduleName: 'AV',
      dest: `lib/${format}.js`,
    })
  ))
  .then(() => {
    console.log(`${format} bundle created!`);
  })
  .catch((e) => {
    console.log(e);
  });
});
