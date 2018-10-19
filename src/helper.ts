import * as math from 'mathjs';

// zip a..n --> [[a.0 .. n.0] .. [a.X .. n.X]]
export function zip(...args: any[]) {
  const names = new Set();
  for (const argc of args) {
    for (const name in argc) {
      if (name === 'length') {
        continue;
      }
      names.add(name);
    }
  }
  const result: {[key: string]: any[]} = {};
  for (const name of names) {
    result[name] = [];
    for (const argc of args) {
      result[name].push(argc[name]);
    }
  }
  return result;
}

// map for object values
export function mapObjectValues(obj: any, fn: Function) {
  const clone = Object.assign({}, obj);
  Object.getOwnPropertyNames(clone).forEach(name => clone[name] = fn(clone[name], name));
  return clone;
}

/**
 * Generate a function to mutate deeply nested data structures.
 * Takes a list of predefined symbols or custom functions,
 * and returns a function to be applied to the data.
 * Custom functions should accept two arguments, the first
 * being the returned element of the previous function, the second
 * being the next function in the invocation chain to be applied.
 *
 * Predefined symbols:
 *    :index    map over array elements
 *    :values   map over object values (turns result in array)
 *    :keys     iterate over object values (preserves keys)
 *    :zip      [a..n] --> [[a.0 .. n.0] .. [a.X .. n.X]]
 *    :flatten  [[a, b], [c, d]] --> [a, b, c, d]
 *    property  property access
 *
 * Example:
 * const EXAMPLE = [
 *   {a: 11, b: [1, 2, 3]},
 *   {a: 12, b: [4, 5, 6]},
 *   {a: 13, b: [7, 8, 9]},
 * ];
 * reshapeFn([':index', 'a'])(EXAMPLE);
 * --> [ 11, 12, 13 ]
 * reshapeFn([':flatten'])(reshapeFn([':index', 'b'])(EXAMPLE));
 * --> [ 1, 2, 3, 4, 5, 6, 7, 8, 9 ]
 * reshapeFn([':index', ':keys', (el: any, fn: Function) => fn((el instanceof Array) ? el.map(n => ++n) : ++el) ])(EXAMPLE);
 * --> [ { a: 12, b: [ 2, 3, 4 ] },
 *   { a: 13, b: [ 5, 6, 7 ] },
 *   { a: 14, b: [ 8, 9, 10 ] } ]
 *
 * @param symbols list of predefined symbols or functions
 */
export function reshapeFn(symbols: any[]): (data: any) => any {
  const PREDEFINED: {[key: string]: Function} = {
    ':index': (ar: any, fn: Function) => (ar instanceof Array) ? ar.map(fn as any) : undefined,
    ':values': (obj: any, fn: Function) => Object.getOwnPropertyNames(obj).map(el => fn(obj[el])),
    ':zip': (obj: any, fn: Function) => (obj && typeof obj[Symbol.iterator] === 'function') ? fn(zip(...obj)) : undefined,
    ':keys': (obj: any, fn: Function) => (obj) ? mapObjectValues(obj, fn) : undefined,
    ':flatten': (ar: any, fn: Function) => (ar instanceof Array) ? fn(ar.reduce((acc, val) => acc.concat(val), [])) : undefined,
    'PROP': (obj: any, prop: string, fn: Function) => (obj && obj[prop] !== 'undefined') ? fn(obj[prop]) : undefined,
    'FUNC': (obj: any, func: Function, fn: Function) => (obj) ? func(obj, fn) : undefined
  };

  let tokens = symbols.slice(0);
  tokens.reverse();

  return tokens.reduce((fn, key) => (key instanceof Function)
    ? ((prev, token) => (el: any) => PREDEFINED['FUNC'](el, token, prev))(fn, key)
    : (PREDEFINED[key])
      ? ((prev) => (el: any) => PREDEFINED[key](el, prev))(fn)
      : ((prev) => (el: any) => PREDEFINED['PROP'](el, key, prev))(fn),
  (el: any) => el);
}

// rudimentary descriptive statistics
export function descriptiveStats(array: number[] | number[][] | math.Matrix) {
  const mean = math.mean(array);
  const median = math.median(array);
  const dev = math.std(array);
  const cv = dev / mean;
  return {mean, median, dev, cv};
}
