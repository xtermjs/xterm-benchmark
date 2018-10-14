/**
 * TODO:
 *    - timeout option
 *    - include timeline
 *    - refactor stack/tokens
 *        - make sub stacks local
 *        - separate primitives from context and case
 *        - separate options
 *    - remove globals
 *    - custom logformat
 *    - async error handling/propagation
 *    - test cases
 *    - git integration mixin
 */

interface IPerfOptions {
  fork: boolean;
  forkArgs?: string[];
  forkOptions?: any;
  timeout?: number;
  repeat: number;
}

export interface ICmdlineOverrides {
  repeat?: number;
  timeout?: number;
}

interface IStackToken {
  type: PerfType;
  options: IPerfOptions;
  name: string;
  callback(): void;
  instance?: PerfCase;
}

interface ICaseResult {
  name: string;
  path: string[];
  runtime: number[] | undefined;
  returnValue: any;
  run: number;
  repeat: number;
  error?: any;
}

interface IPerfTree {
  name: string;
  type: PerfType;
  path: string;
  children?: IPerfTree[];
}

const enum PerfType {
  perfContext,
  perfCase,
  before,
  beforeEach,
  after,
  afterEach
}

import * as path from 'path';
import { fork } from 'child_process';

const DEFAULT_OPTIONS: IPerfOptions = {
  fork: false,
  repeat: 1
};

function _logformat(result: ICaseResult, run: number): string {
  return `${result.name} : ${run} - ${result.runtime[1] / 1000000 + result.runtime[0] * 1000}ms ${result.returnValue}`;
}

/**
 * PerfContext
 * Runtime representation of a `perfContext` enclosure for perf cases with
 * `before`, `beforeEach`, `after` and `afterEach` support.
 * Note that a file will automatically get a toplevel context with
 * the filename as `.name`.
 * For the preparation/cleanup methods only of each kind is respected. This is
 * not enforced so a later definition will override an earlier one.
 * They can be defined at any position in the context callback (even top level),
 * beside that JS lexical scoping rules apply as expected.
 *
 * preparation/cleanup invocation logic for a single perf file:
 *    ctx.create
 *      ctx.before
 *      ctx.beforeEach
 *        perfcase.run | sub_ctx.create
 *      ctx.afterEach
 *      ctx.after
 *
 * Sub contexts are created lazy in `.run` when needed.
 * It is possible to run a single perf case from the cmdline. This will trigger
 * all preparation methods on the way down and all cleanup methods on the way up,
 * but not invoke any methods of siblings. Special care is needed if you rely
 * on state changes from neighbors (simply dont do it).
 */
class PerfContext {
  public before: () => void = () => {};
  public beforeEach: () => void = () => {};
  public after: () => void = () => {};
  public afterEach: () => void = () => {};
  // to preserve invocation order we put runners and sub contexts in just one list
  // and do the further tree expanding lazy in .run
  public contextsOrCases: IStackToken[] = [];

  constructor(public name: string, public parent: PerfContext | null = null) {
    let entry;
    // Note: removes current items in the global stack
    // this is needed so any sub context can cleanly init
    while (entry = STACK.shift()) {
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

  public getPath(): string[] {
    let parents = [];
    let elem = this.parent;
    while (elem) {
      parents.splice(0, 0, elem.name);
      elem = elem.parent;
    }
    parents.push(this.name);
    return parents;
  }

  public getPathString(): string {
    return this.getPath().join('|');
  }

  public getRoot(): string {
    return this.getPath().shift();
  }

  public async runFull(): Promise<void> {
    console.log(`\nRunning ${this.name}:`);
    await this.before();
    for (let i = 0; i < this.contextsOrCases.length; ++i) {
      await this.beforeEach();
      if (this.contextsOrCases[i].type === PerfType.perfContext) {
        while (STACK.pop()) {}
        await this.contextsOrCases[i].callback();
        const ctx = new PerfContext(this.contextsOrCases[i].name, this);
        await ctx.runFull();
      } else {
        await this.contextsOrCases[i].instance.run(this);
      }
      await this.afterEach();
    }
    await this.after();
  }

  public async runSingle(treePath: string[], forked: boolean = false): Promise<void> {
    let needle = treePath.shift();
    if (!needle) {
      return this.runFull();
    }
    await this.before();
    for (let i = 0; i < this.contextsOrCases.length; ++i) {
      if (this.contextsOrCases[i].name === needle) {
        await this.beforeEach();
        if (this.contextsOrCases[i].type === PerfType.perfContext) {
          while (STACK.pop()) {}
          this.contextsOrCases[i].callback();
          const ctx = new PerfContext(this.contextsOrCases[i].name, this);
          await ctx.runSingle(treePath, forked);
        } else {
          await this.contextsOrCases[i].instance.run(this, forked);
        }
        await this.afterEach();
        await this.after();
        return;
      }
    }
    await this.after();
    console.error(`path not found: "${this.getPath().concat(needle).join('|')}"`);
  }

  /**
   * Get a tree representation of the context with sub contexts and cases.
   */
  public getTree(): IPerfTree {
    const path = this.getPathString();
    return {
      name: this.name,
      type: PerfType.perfContext,
      path: path,
      children: this.contextsOrCases.map(el => {
        if (el.type === PerfType.perfContext) {
          while (STACK.pop()) {}
          el.callback();
          const ctx = new PerfContext(el.name, this);
          return ctx.getTree();
        } else {
          return {
            name: el.name,
            type: PerfType.perfCase,
            path: path + '|' + el.name
          };
        }
      })
    };
  }
}

/**
 * PerfCase
 * Base class for performance cases.
 * Comes with the convenient methods `showRuntime` and `showAverageRuntime`.
 */
class PerfCase {
  public single: ((result: ICaseResult) => ICaseResult | void)[] = [];
  public all: ((result: ICaseResult[]) => ICaseResult[] | void)[] = [];
  public options: IPerfOptions;
  public results: ICaseResult[] = [];
  constructor(public name: string, public callback: () => void, opts: IPerfOptions) {
    // FIXME: name must be changed here!!!!!! + refactor stack abstraction
    this.options = Object.assign({}, DEFAULT_OPTIONS, opts, CMDLINE_OVERRIDES);
    const stackToken: IStackToken = {type: PerfType.perfCase, options: this.options, name, callback, instance: this};
    addToStack(stackToken, true);
    this.name = stackToken.name;
  }
  public postEach(callback: (result: ICaseResult) => ICaseResult | void): PerfCase {
    this.single.push(callback);
    return this;
  }
  public postAll(callback: (results: ICaseResult[]) => ICaseResult[] | void): PerfCase  {
    this.all.push(callback);
    return this;
  }
  private _processSingle(result: ICaseResult): void {
    for (let i = 0; i < this.single.length; ++i) {
      const altered = this.single[i](result);
      if (altered && altered !== result) {
        result = altered;
      }
    }
    this.results.push(result);
  }
  private _processFinal(): void {
    for (let i = 0; i < this.all.length; ++i) {
      const altered = this.all[i](this.results);
      if (altered && altered !== this.results) {
        this.results = altered;
      }
    }
  }
  public async run(ctx: PerfContext, forked: boolean = false): Promise<void> {
    // TODO: timeout
    if (this.options.fork && !forked) {
      const p = fork(path.join(module.filename), this.options.forkArgs, this.options.forkOptions);
      p.send({case: ctx.getPath().concat(this.name), cmdlineOverrides: CMDLINE_OVERRIDES});
      await new Promise(resolve => {
        p.on('message', (result: ICaseResult) => this._processSingle(result));
        p.on('exit', _ => resolve());
      });
    } else {
      for (let repeat = 0; repeat < this.options.repeat; ++repeat) {
        const start = process.hrtime();
        const returnValue = await this.callback();
        const runtime = process.hrtime(start);
        const result: ICaseResult = {
          name: this.name,
          path: ctx.getPath(),
          runtime,
          returnValue,
          run: repeat + 1,
          repeat: this.options.repeat
        }
        if (forked) {
          process.send(result);
        } else {
          this._processSingle(result);
        }
      }
    }
    if (!forked) {
      this._processFinal();
    }
  }
}

/**
 * Defaults mixins for PerfCase
 */
type PerfCaseConstructor<T = PerfCase> = new(...args: any[]) => T;

interface ICaseResultThroughput extends ICaseResult {
  throughput: number;
}

// report runtime
const MixinRuntime = function<TBase extends PerfCaseConstructor>(Base: TBase) {
  return class extends Base {
    public showRuntime(): PerfCase {
      this.single.push((result: ICaseResult): ICaseResult => {
        console.log(_logformat(result, result.run));
        return result;
      });
      return this;
    }
    public showAverageRuntime(): PerfCase  {
      this.all.push((results: ICaseResult[]): void => {
        let average = 0;
        for (let i = 0; i < results.length; ++i) {
          const result = results[i];
          average += (result.runtime[1] / 1000000 + result.runtime[0] * 1000);
        }
        console.log(`average over ${results.length} runs: ${average/results.length}ms`);
      });
      return this;
    }
  };
}

// report throughput
const MixinThroughput = function<TBase extends PerfCaseConstructor>(Base: TBase) {
  return class extends Base {
    public throughput(): PerfCase {
      this.single.push((result: ICaseResult): void => {
        const msec = result.runtime[1] / 1000000 + result.runtime[0] * 1000;
        (result as ICaseResultThroughput).throughput = 1000 / msec * result.returnValue / 1024 / 1024;
      });
      return this;
    }
    public showThroughput(): PerfCase {
      this.single.push((result: ICaseResultThroughput): void => {
        console.log(`${this.name} : ${result.run} - Throughput: ${Number(result.throughput).toFixed(2)} MB/s`);
      });
      return this;
    }
    public showAverageThroughput(): PerfCase {
      this.all.push((results: ICaseResultThroughput[]): void => {
        let average = 0;
        for (let i = 0; i < results.length; ++i) {
          average += results[i].throughput;
        }
        console.log(`${this.name} : Average throughput: ${Number(average / results.length).toFixed(2)} MB/s`);
      });
      return this;
    }
  };
}

// TODO: chrome-timeline perf case

/**
 * Global symbol stack.
 * This is used to load the symbols for the next context:
 *    - enclosing callback triggers exported symbols functions which add itself to the stack
 *    - PerfContext.constructor consumes the symbols (empties stack)
 *    - PerfContext.run calls symbols callbacks, which either:
 *        - enclose a child context -> spawn new context
 *        - trigger a perf cases
 *        - do some before/after work
 * Never change the underlying object, always pop from the original.
 */
const STACK: IStackToken[] = [];

function addToStack(token: IStackToken, enumNames: boolean = false): void {
  // we dont rely on unique names, but need identity for contexts and cases
  // therefore we fix names by appending an incrementing number
  if (enumNames) {
    const stackNames = STACK.map(el => el.name);
    if (stackNames.indexOf(token.name) !== -1) {
      let num = 0;
      while (stackNames.indexOf(token.name + '#' + ++num) !== -1);
      token.name += '#' + num;
    }
  }
  STACK.push(token);
}

export const CMDLINE_OVERRIDES: ICmdlineOverrides = {};

/**
 * Called once after entering a context.
 * Also applies to top level (a top level `before` will run when the file is entered).
 */
export function before(callback: () => void): void {
  addToStack({type: PerfType.before, options: DEFAULT_OPTIONS, name: '', callback});
}

/**
 * Called for every children before entering the child.
 * Also applies to top level.
 */
export function beforeEach(callback: () => void): void {
  addToStack({type: PerfType.beforeEach, options: DEFAULT_OPTIONS, name: '', callback});
}

/**
 * Called once before leaving a context.
 * Also applies to top level.
 */
export function after(callback: () => void): void {
  addToStack({type: PerfType.after, options: DEFAULT_OPTIONS, name: '', callback});
}

/**
 * Called for every children after leaving it.
 * Also applies to top level.
 */
export function afterEach(callback: () => void): void {
  addToStack({type: PerfType.afterEach, options: DEFAULT_OPTIONS, name: '', callback});
}

/**
 * Spawn a new perf context.
 */
export function perfContext(name: string, callback: () => void): void {
  addToStack({type: PerfType.perfContext, options: DEFAULT_OPTIONS, name, callback}, true);
}

/**
 * Simple runtime measuring perf case.
 */
export function timeit(name: string, callback: () => void, opts?: IPerfOptions): PerfCase {
  return new (MixinRuntime(PerfCase))(name, callback, opts);
}

/**
 * Simple throughput measuring.
 * Expects the payload in bytes as return value.
 */
export function throughput(name: string, callback: () => void, opts?: IPerfOptions): PerfCase {
  return new (MixinThroughput(MixinRuntime(PerfCase)))(name, callback, opts).throughput();
}


export async function run(treePath: string[]): Promise<void> {
  while (STACK.pop()) {}
  //try {
    const filename = treePath.shift();
    require(path.resolve(filename));
    const ctx = new PerfContext(filename, null);
    await ctx.runSingle(treePath);
  //} catch (e) {} // TODO: handle error
}

export function showTree(filename: string): void {
  try {
    require(path.resolve(filename));
    const ctx = new PerfContext(filename, null);
    console.log(JSON.stringify(ctx.getTree(), null, 2));
  } catch (e) { console.log(e); }
}

/**
 * A forked call for a single perf case.
 */
if (require.main === module) {
  if (process.send) {
    process.on('message', async msg => {
      Object.assign(CMDLINE_OVERRIDES, msg.cmdlineOverrides);
      try {
        const filename = msg.case.shift();
        require(path.resolve(filename));
        const ctx = new PerfContext(filename, null);
        await ctx.runSingle(msg.case, true);
      } catch (e) {
        // TODO: handle error
        console.log(e);
      }
      process.removeAllListeners('message');
    });
  }
}
