/**
 * TODO:
 *    - timeout option
 *    - json option not working anymore
 *    - include timeline
 *    - remove global CMDLINE_OVERRIDE
 *    - async error handling/propagation
 *    - test cases
 *    - git integration mixin
 */

import { IPerfOptions, ICmdlineOverrides, IStackToken, PerfType, IPerfTree, IPerfCase, ICaseResult } from './interfaces';
import * as path from 'path';
import { fork } from 'child_process';
import { Runtime, Throughput } from './mixins';


const DEFAULT_OPTIONS: IPerfOptions = {
  fork: false,
  repeat: 1
};
export const CMDLINE_OVERRIDES: ICmdlineOverrides = {}; // FIXME: get rid of export
const INDENT = '   ';

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

function addToStack(token: IStackToken): void {
  // we dont rely on unique names, but need identity for contexts and cases
  // therefore we fix names by appending an incrementing number
  if (token.type === PerfType.Context || token.type === PerfType.PerfCase) {
    const stackNames = STACK.map(el => el.name);
    if (stackNames.indexOf(token.name) !== -1) {
      let num = 0;
      while (stackNames.indexOf(token.name + '#' + ++num) !== -1);
      token.name += '#' + num;
    }
  }
  STACK.push(token);
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
  public before: () => void = () => { };
  public beforeEach: () => void = () => { };
  public after: () => void = () => { };
  public afterEach: () => void = () => { };
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
        case PerfType.Context:
          this.contextsOrCases.push(entry);
          break;
        case PerfType.PerfCase:
          this.contextsOrCases.push(entry);
          break;
        default:
      }
    }
  }

  public getPath(): string[] {
    let parents: string[] = [];
    let elem = this.parent;
    while (elem) {
      parents.unshift(elem.name);
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
    console.log(`${INDENT.repeat(this.getPath().length)}Context "${this.name}"`);
    await this.before();
    for (let i = 0; i < this.contextsOrCases.length; ++i) {
      await this.beforeEach();
      if (this.contextsOrCases[i].type === PerfType.Context) {
        while (STACK.pop()) { }
        await this.contextsOrCases[i].callback();
        const ctx = new PerfContext(this.contextsOrCases[i].name, this);
        await ctx.runFull();
      } else {
        await (this.contextsOrCases[i] as PerfCase).run(this.getPath());
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
    if (!forked) {
      console.log(`${INDENT.repeat(this.getPath().length)}Context "${this.name}"`);
    }
    await this.before();
    for (let i = 0; i < this.contextsOrCases.length; ++i) {
      if (this.contextsOrCases[i].name === needle) {
        await this.beforeEach();
        if (this.contextsOrCases[i].type === PerfType.Context) {
          while (STACK.pop()) { }
          this.contextsOrCases[i].callback();
          const ctx = new PerfContext(this.contextsOrCases[i].name, this);
          await ctx.runSingle(treePath, forked);
        } else {
          await (this.contextsOrCases[i] as PerfCase).run(this.getPath(), forked);
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
      type: PerfType[PerfType.Context],
      path: path,
      children: this.contextsOrCases.map(el => {
        if (el.type === PerfType.Context) {
          while (STACK.pop()) { }
          el.callback();
          const ctx = new PerfContext(el.name, this);
          return ctx.getTree();
        } else {
          return {
            name: el.name,
            type: PerfType[PerfType.PerfCase],
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
 */
export class PerfCase implements IPerfCase {
  public type: PerfType = PerfType.PerfCase;
  private _single: ((result: ICaseResult) => ICaseResult | void)[] = [];
  private _all: ((result: ICaseResult[]) => ICaseResult[] | void)[] = [];
  public options: IPerfOptions;
  public results: ICaseResult[] = [];
  public summary: { [key: string]: any } = {};
  public path: string[] | null = null;
  constructor(public name: string, public callback: () => void, opts?: IPerfOptions) {
    this.options = Object.assign({}, DEFAULT_OPTIONS, opts, CMDLINE_OVERRIDES);
    addToStack(this);
  }
  public postEach(callback: (result: ICaseResult) => ICaseResult | void): this {
    this._single.push(callback);
    return this;
  }
  public postAll(callback: (results: ICaseResult[]) => ICaseResult[] | void): this {
    this._all.push(callback);
    return this;
  }
  private async _processSingle(result: ICaseResult): Promise<void> {
    for (let i = 0; i < this._single.length; ++i) {
      const altered = await this._single[i](result);
      if (altered === null) {
        return;
      }
      if (altered && altered !== result) {
        result = altered;
      }
    }
    this.results.push(result);
  }
  private async _processFinal(): Promise<void> {
    for (let i = 0; i < this._all.length; ++i) {
      const altered = await this._all[i](this.results);
      if (altered && altered !== this.results) {
        this.results = altered;
      }
    }
  }
  public async run(parentPath: string[], forked: boolean = false): Promise<void> {
    // TODO: timeout
    this.path = parentPath.concat(this.name);
    if (this.options.fork && !forked) {
      const p = fork(path.join(module.filename), this.options.forkArgs || [], this.options.forkOptions);
      p.send({ case: this.path, cmdlineOverrides: CMDLINE_OVERRIDES });
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
          path: this.path,
          runtime,
          returnValue,
          run: repeat + 1,
          repeat: this.options.repeat
        };
        if (forked) {
          process.send(result);
        } else {
          await this._processSingle(result);
        }
      }
    }
    if (!forked) {
      await this._processFinal();
    }
  }
  public getIndent(): string {
    return INDENT.repeat(this.path.length);
  }
}

/**
 * Called once after entering a context.
 * Also applies to top level (a top level `before` will run when the file is entered).
 */
export function before(callback: () => void): void {
  addToStack({ type: PerfType.before, name: '', callback });
}

/**
 * Called for every children before entering the child.
 * Also applies to top level.
 */
export function beforeEach(callback: () => void): void {
  addToStack({ type: PerfType.beforeEach, name: '', callback });
}

/**
 * Called once before leaving a context.
 * Also applies to top level.
 */
export function after(callback: () => void): void {
  addToStack({ type: PerfType.after, name: '', callback });
}

/**
 * Called for every children after leaving it.
 * Also applies to top level.
 */
export function afterEach(callback: () => void): void {
  addToStack({ type: PerfType.afterEach, name: '', callback });
}

/**
 * Spawn a new perf context.
 */
export function perfContext(name: string, callback: () => void): void {
  addToStack({ type: PerfType.Context, name, callback });
}

/**
 * Some default ctors and types.
 */
export const RuntimeCase = Runtime(PerfCase);
export type RuntimeCaseType = InstanceType<typeof RuntimeCase>;

export const ThroughputRuntimeCase = Throughput(Runtime(PerfCase));
export type ThroughputRuntimeCaseType = InstanceType<typeof ThroughputRuntimeCase>;


/**
 * Run context tree path.
 * Main entry for the cli.
 */
export async function run(treePath: string[]): Promise<void> {
  while (STACK.pop()) { }
  // try {
  const filename = treePath.shift();
  require(path.resolve(filename));
  const ctx = new PerfContext(filename, null);
  await ctx.runSingle(treePath);
  // } catch (e) {} // TODO: handle error
}

/**
 * Log context tree to console.
 */
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
