interface IPerfOptions {
  isolated: boolean
}

interface IPerfStack {
  type: PerfType;
  options: IPerfOptions;
  name: string;
  callback(): void;
  runtime?: any;
  result?: any;
}

interface ICHildData {
  runtime: any;
  result: any;
}

const enum PerfType {
  before,
  beforeEach,
  after,
  afterEach,
  perfContext,
  perfCase
}

import * as path from 'path';
import { fork } from 'child_process';

const DEFAULT_PERF_OPTIONS: IPerfOptions = {
  isolated: false
}

class PerfContext {
  public before: () => void = () => {};
  public beforeEach: () => void = () => {};
  public after: () => void = () => {};
  public afterEach: () => void = () => {};
  // to preserve invocation order we put runners and sub contexts in just one list
  public contextsOrCases: IPerfStack[] = [];

  constructor(public name, stack: IPerfStack[], public parent: PerfContext | null = null) {
    let entry;
    // Note: removes current items in the global stack
    // this is needed so any sub context can cleanly init
    while (entry = stack.shift()) {
      switch (entry.type) {
        case PerfType.before:
          this.before = entry.callback;
          break;
        case PerfType.beforeEach:
          this.beforeEach = entry.callback;
          break;
        case PerfType.after:
          this.after = entry.callback;
          break;
        case PerfType.afterEach:
          this.afterEach = entry.callback;
          break;
        case PerfType.perfContext:
          this.contextsOrCases.push(entry);
          break;
        case PerfType.perfCase:
          this.contextsOrCases.push(entry);
          break;
        default:
      }
    }
  }

  getTreePath(): string[] {
    let parents = [];
    let elem = this.parent;
    while (elem) {
      parents.splice(0, 0, elem.name);
      elem = elem.parent;
    }
    parents.push(this.name);
    return parents;
  }

  async run() {
    console.log(`\nRunning ${this.name}:`);
    await this.before();
    for (let i = 0; i < this.contextsOrCases.length; ++i) {
      await this.beforeEach();
      if (this.contextsOrCases[i].type === PerfType.perfContext) {
        this.contextsOrCases[i].callback();
        const perf = new PerfContext(this.contextsOrCases[i].name, STACK, this);
        await perf.run();
      } else {
        if (this.contextsOrCases[i].options.isolated) {
          const p = fork(path.join(__dirname, 'cli'));
          p.send({path: this.getTreePath(), casename: this.contextsOrCases[i].name});
          const childData = await new Promise(resolve => p.once('message', message => resolve(message)));
          this.contextsOrCases[i].result = (childData as ICHildData).result;
          this.contextsOrCases[i].runtime = (childData as ICHildData).runtime;
        } else {
          const start = process.hrtime();
          this.contextsOrCases[i].result = await this.contextsOrCases[i].callback();
          this.contextsOrCases[i].runtime = process.hrtime(start);
        }
        // TODO: postprocess results and runtime
        console.log(`perfCase "${this.contextsOrCases[i].name}": ${this.contextsOrCases[i].runtime[0]}s, ${this.contextsOrCases[i].runtime[1] / 1000000}ms`);
      }
      await this.afterEach();
    }
    await this.after();
  }

  async runIsolated(treePath: string[], casename: string) {
    let needle = treePath.shift();
    if (!needle) {
      needle = casename;
    }
    await this.before();
    for (let i = 0; i < this.contextsOrCases.length; ++i) {
      if (this.contextsOrCases[i].name === needle) {
        await this.beforeEach();
        let res;
        if (this.contextsOrCases[i].type === PerfType.perfContext) {
          this.contextsOrCases[i].callback();
          const perf = new PerfContext(this.contextsOrCases[i].name, STACK, this);
          res = await perf.runIsolated(treePath, casename);
        } else {
          // finally found the perf case
          const start = process.hrtime();
          const result = await this.contextsOrCases[i].callback();
          const runtime = process.hrtime(start);
          res = {result, runtime};
        }
        await this.afterEach();
        return res;
      }
    }
    await this.after();
    return {result: 'ERROR: not found', runtime: undefined};
  }
}

// invocation stack
const STACK: IPerfStack[] = [];

// grouping like describe in mocha
export function perfContext(name, callback) {
  STACK.push({type: PerfType.perfContext, options: {isolated: false}, name, callback});
}
export function before(name, callback) {
  STACK.push({type: PerfType.before, options: {isolated: false}, name, callback});
}
export function beforeEach(name, callback) {
  STACK.push({type: PerfType.beforeEach, options: {isolated: false}, name, callback});
}
export function after(name, callback) {
  STACK.push({type: PerfType.after, options: {isolated: false}, name, callback});
}
export function afterEach(name, callback) {
  STACK.push({type: PerfType.afterEach, options: {isolated: false}, name, callback});
}

// container for simple runtime measurement
export function timeit(name: string, callback: (done?: () => void) => void, opts?: IPerfOptions) {
  const options = Object.assign({}, DEFAULT_PERF_OPTIONS, opts);
  STACK.push({type: PerfType.perfCase, options, name, callback});
}

// TODO: chrome-timeline symbol

// normal run for a perf file
export async function _run(filename: string) {
  while (STACK.pop()) {}
  try {
    require(path.resolve(filename));
    const perf = new PerfContext(filename, STACK);
    await perf.run();
  } catch (e) { console.log(e); }
}

// isolated run for a perfcase within a file
export async function _runIsolated(treePath: string[], casename: string) {
  while (STACK.pop()) {}
  try {
    const filename = treePath.shift();
    require(path.resolve(filename));
    const perf = new PerfContext(filename, STACK);
    return await perf.runIsolated(treePath, casename);
  } catch (e) {
    return {result: 'ERROR: perfcase not found', runtime: undefined};
  }
}
