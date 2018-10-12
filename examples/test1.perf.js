const timeit = require('../lib/index').timeit;
const before = require('../lib/index').before;
const beforeEach = require('../lib/index').beforeEach;
const after = require('../lib/index').after;
const afterEach = require('../lib/index').afterEach;
const perfContext = require('../lib/index').perfContext;

let a = 'grrrr';

before('hello', () => {
  console.log('before - file level');
  a = 'better';
});

beforeEach('bE', () => {
  console.log('beforeEach - file level');
});

after('after', () => {
  console.log('after - file level');
});

afterEach('aE', () => {
  console.log('afterEach - file level');
});

timeit('Hello World - file level', () => {
  const values = [];
  for (i = 0; i < 100000; ++i) {
    values.push(i);
  }
  return a;
});

perfContext('ctx1', () => {
  before('hello', () => {
    console.log('before - ctx1');
  });

  let b = 'nonono';
  
  beforeEach('bE', () => {
    console.log('beforeEach - ctx1');
    b = 'good';
  });
  
  after('after', () => {
    console.log('after - ctx1');
  });
  
  afterEach('aE', () => {
    console.log('afterEach - ctx1');
  });
  
  timeit('Hello World - ctx1', () => {
    const values = [];
    for (i = 0; i < 100000; ++i) {
      values.push(i);
    }
    return b;
  }, {isolated: true});

  perfContext('inner ctx', () => {

  });
});
