const timeit = require('../lib/index').timeit;

timeit('async example', async () => {
  return new Promise(resolve => setTimeout(() => resolve('this one!'), 2000));
});

timeit('after async', () => {
  const values = [];
  for (i = 0; i < 100000; ++i) {
    values.push(i);
  }
  return 'after sync';
});
