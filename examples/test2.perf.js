const timeit = require('../lib/index').timeit;

timeit('fork async example', async () => {
  return new Promise(resolve => setTimeout(() => resolve('this one!'), 200));
}, {fork: true, repeat: 10}).showRuntime().showAverageRuntime();

timeit('after async', () => {
  const values = [];
  for (i = 0; i < 100000; ++i) {
    values.push(i);
  }
  return 'after sync';
}).showRuntime().showAverageRuntime();

timeit('after async', () => {
  const values = [];
  for (i = 0; i < 100000; ++i) {
    values.push(i);
  }
  return 'after sync';
}).showRuntime().showAverageRuntime();

timeit('after async', () => {
  const values = [];
  for (i = 0; i < 100000; ++i) {
    values.push(i);
  }
  return 'after sync';
}).showRuntime().showAverageRuntime();
