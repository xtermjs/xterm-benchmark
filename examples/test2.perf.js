const RuntimeCase = require('../lib/index').RuntimeCase;

new RuntimeCase('before async', () => {
  const values = [];
  for (i = 0; i < 100000; ++i) {
    values.push(i);
  }
  return 'after sync';
}).showRuntime().showAverageRuntime();

new RuntimeCase('fork async example', async () => {
  return new Promise(resolve => setTimeout(() => resolve('this one!'), 200));
}, {fork: true, repeat: 10}).showRuntime().showAverageRuntime();

new RuntimeCase('after async', () => {
  const values = [];
  for (i = 0; i < 100000; ++i) {
    values.push(i);
  }
  return 'after sync';
}).showRuntime().showAverageRuntime();
