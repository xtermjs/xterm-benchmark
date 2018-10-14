const timeit = require('../lib/index').timeit;
const before = require('../lib/index').before;
const beforeEach = require('../lib/index').beforeEach;
const after = require('../lib/index').after;
const afterEach = require('../lib/index').afterEach;
const perfContext = require('../lib/index').perfContext;
const throughput = require('../lib/index').throughput;


let a = 'grrrr';

before(() => {
  console.log('before - file level');
  a = 'better';
});

beforeEach(() => {
  console.log('beforeEach - file level');
});

after(() => {
  console.log('after - file level');
});

afterEach(() => {
  console.log('afterEach - file level');
});

timeit('Hello World - file level', () => {
  const values = [];
  for (i = 0; i < 100000; ++i) {
    values.push(i);
  }
  return a;
}).showRuntime().showAverageRuntime();

perfContext('ctx1', () => {
  before(() => {
    console.log('before - ctx1');
  });

  let b = 'nonono';
  
  beforeEach(() => {
    console.log('beforeEach - ctx1');
    b = 'good';
  });
  
  after(() => {
    console.log('after - ctx1');
  });
  
  afterEach(() => {
    console.log('afterEach - ctx1');
  });
  
  timeit('Hello World - ctx1', () => {
    const values = [];
    for (i = 0; i < 1000000; ++i) {
      values.push(i);
    }
    return b;
  }, {repeat: 10}).showRuntime().showAverageRuntime();

  perfContext('inner ctx', () => {

  });

  throughput('yeah throughput', () => {
    const s = 'a'.repeat(100000);
    const values = [];
    for (i = 0; i < s.length; ++i) {
      values.push(s.charCodeAt(i));
    }
    return 10000;
  }, {repeat: 10}).showRuntime().showAverageRuntime().showThroughput().showAverageThroughput();
});

