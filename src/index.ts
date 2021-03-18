/**
 * TODO:
 *    - timeout option
 *    - test cases
 *    - TimelineRunner options
 */

import { IPerfOptions, ICmdlineOverrides, IStackToken, PerfType, IPerfTree, IPerfCase, ICaseResult, IBaselineEntry, EvalResultState, IEvalStatsSummary, IEvalConfig, IBaselineData, IEvalStats, ReportType, IPerfResult } from './interfaces';
import * as path from 'path';
import { fork } from 'child_process';
import { Runtime, Throughput } from './mixins';
import { TimelineRunner } from 'chrome-timeline';
import * as fs from 'fs';
import { mapObjectValues } from './helper';
const columnify: (data: any, config: any) => string = require('columnify');

// default perfcase settings, override with config file or cmdline options
export const DEFAULT_OPTIONS: IPerfOptions = {
  fork: false,
  repeat: 1
};
export const CMDLINE_OVERRIDES: ICmdlineOverrides = {};
const INDENT = '   ';
export const LOGPATHS: string[] = [];

// defaults for eval, override with a config file
const DEFAULT_TOLERANCE = [0.25, 4.0];
export const EVAL_CONFIG: IEvalConfig = {
  tolerance : {'*': DEFAULT_TOLERANCE},
  skip: [],
};

// create regexp string for eval config filter
const FILTER_FN = (token: string) => token.replace('|', '[|]').replace('.', '[.]').replace('*', '.+?');

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
 *
 * Runtime representation of a `perfContext` enclosure for perf cases with
 * `before`, `beforeEach`, `after` and `afterEach` support.
 * Note that a file will automatically get a toplevel context with
 * the filename as `.name`.
 * For preparation/cleanup methods only one of each kind is respected. This is
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

  public async runFull(): Promise<void> {
    console.log(`${INDENT.repeat(this.getPath().length)}Context "${this.name}"`);
    try {
      await this.before();
      for (let i = 0; i < this.contextsOrCases.length; ++i) {
        try {
          await this.beforeEach();
          if (this.contextsOrCases[i].type === PerfType.Context) {
            while (STACK.pop()) { }
            await this.contextsOrCases[i].callback();
            const ctx = new PerfContext(this.contextsOrCases[i].name, this);
            await ctx.runFull();
          } else {
            await (this.contextsOrCases[i] as PerfCase).run(this.getPath());
          }
        } finally {
          await this.afterEach();
        }
      }
    } finally {
      await this.after();
    }
  }

  public async runSingle(treePath: string[], forked: boolean = false): Promise<void> {
    let needle = treePath.shift();
    if (!needle) {
      return this.runFull();
    }
    if (!forked) {
      console.log(`${INDENT.repeat(this.getPath().length)}Context "${this.name}"`);
    }
    try {
      await this.before();
      for (let i = 0; i < this.contextsOrCases.length; ++i) {
        if (this.contextsOrCases[i].name === needle) {
          try {
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
          } finally {
            await this.afterEach();
          }
        }
      }
    } finally {
      await this.after();
    }
    console.error(`path not found: "${this.getPath().concat(needle).join('|')}"`);
    throw new Error(`path not found: "${this.getPath().concat(needle).join('|')}"`);
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
 *
 * Base class for simple performance cases in nodejs.
 * Wraps a callback for runtime measuring and postprocessing.
 *
 * Possible Options:
 *
 *    - repeat
 *      Repeat callback n times. Defaults to 1. Forked perf cases repeat the callback
 *      within one child (no additional processes created).
 *
 *    - fork
 *      Run perf case in single mode in a child process. This is especially useful
 *      to get a clean process env without pending GC calls or busy event loop.
 *      The process is created by child_process.fork and can be customized with
 *      `forkArgs``and `forkOptions`.
 *      The results are send to the parent process via `process.send`.
 *      Note: The parent process will wait for forked perf cases results,
 *      they are not run in parallel to avoid false numbers due to heavy system usage.
 *
 * For a single run the runtime is measured with a high resolution timer, the result is stored
 * in ICaseResult along with the return value and additional run information.
 *
 * Postprocessing
 * After a single run post processing or filtering be can hooked in with `.postEach(cb)`,
 * after all runs it can be done with `.postAll(cb)`. The callbacks either get a single
 * ICaseResult or ICaseResult[] as argument. The callbacks are chained, thus for
 * `.postEach(cb1).postEach(cb2)` `cb2` will see the changes of `cb1`.
 * For often used or more complicated post actions consider using a mixin with convenient methods.
 * Note: ICaseResult is not set immutable, thus it is possible to alter and even to delete properties.
 * Altering entries is ok as long the expectations of following processors are still met.
 * Deleting is dangerous and likely to break things. Adding entries should be preferred.
 * `.postEach` has one special case - returning `null` will drop the current result,
 * thus later `.postEach` and all `postAll` callbacks will not see it
 * (useful as opt-out for unwanted results).
 *
 * TODO: Further data aggregation...
 */
export class PerfCase implements IPerfCase {
  public type: PerfType = PerfType.PerfCase;
  private _single: ((result: ICaseResult, perfCase: this) => ICaseResult | void | null)[] = [];
  private _all: ((result: ICaseResult[], perfCase: this) => ICaseResult[] | void)[] = [];
  public options: IPerfOptions;
  public results: ICaseResult[] = [];
  public summary: { [key: string]: any } = {};
  public path: string[] = [];
  constructor(public name: string, public callback: (...args: any[]) => void, opts?: IPerfOptions) {
    this.options = Object.assign({}, DEFAULT_OPTIONS, opts, CMDLINE_OVERRIDES);
    addToStack(this);
  }
  public postEach(callback: (result: ICaseResult, perfCase: this) => ICaseResult | void | null): this {
    this._single.push(callback);
    return this;
  }
  public postAll(callback: (results: ICaseResult[], perfCase: this) => ICaseResult[] | void): this {
    this._all.push(callback);
    return this;
  }
  protected async _processSingle(result: ICaseResult): Promise<void> {
    for (let i = 0; i < this._single.length; ++i) {
      const altered = await this._single[i](result, this);
      if (altered === null) {
        return;
      }
      if (altered && altered !== result) {
        result = altered;
      }
    }
    this.results.push(result);
  }
  protected async _processFinal(): Promise<void> {
    for (let i = 0; i < this._all.length; ++i) {
      const altered = await this._all[i](this.results, this);
      if (altered && altered !== this.results) {
        this.results = altered;
      }
    }
  }
  protected async _reportResults(): Promise<void> {
    const finalReport: IPerfResult = {
      type: ReportType.PerfCase,
      name: this.name,
      path: this.path,
      pathString: this.path.join('|'),
      options: this.options,
      summary: this.summary
    };
    if (this.options.reportFullResults) {
      finalReport.results = this.results;
    }
    LOGPATHS.forEach(path => fs.appendFileSync(path, JSON.stringify(finalReport, null) + '\n'));
  }
  public async run(parentPath: string[], forked: boolean = false): Promise<void> {
    // TODO: timeout
    this.path = parentPath.concat(this.name);
    if (this.options.fork && !forked) {
      const p = fork(path.join(module.filename), this.options.forkArgs || [], this.options.forkOptions);
      p.send({ case: this.path, cmdlineOverrides: CMDLINE_OVERRIDES });
      await new Promise<void>(resolve => {
        p.on('message', (result: ICaseResult) => this._processSingle(result));
        p.on('exit', _ => resolve());
      });
    } else {
      if (!this.options.repeat) {
        return;
      }
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
        if (forked && process.send) {
          process.send(result);
        } else {
          await this._processSingle(result);
        }
      }
    }
    if (!forked) {
      await this._processFinal();
      await this._reportResults();
    }
  }
  public getIndent(): string {
    return INDENT.repeat(this.path.length);
  }
}

/**
 * TimelinePerfCase
 *
 * Derived PerfCase to do puppeteer based runtime tracing.
 * Runs the callback in a TimelineRunner from chrome-timeline.
 * The callback gets the runner instance as argument.
 * Returns the trace summaries in `result.returnValue`.
 *
 * Options: TODO...
 */
export class TimelinePerfCase extends PerfCase {
  // override run to call into chrome-timeline
  // since the tests are meant for remote anyways
  // also disable fork variant
  public async run(parentPath: string[], _: boolean = false): Promise<void> {
    this.path = parentPath.concat(this.name);
    if (!this.options.repeat) {
      return;
    }
    for (let repeat = 0; repeat < this.options.repeat; ++repeat) {
      const runner = new TimelineRunner();
      await runner.start();
      let start;
      let runtime;
      try {
        start = process.hrtime();
        await runner.run(this.callback);
      } finally {
        runtime = process.hrtime(start);
        await runner.end();
      }
      const result: ICaseResult = {
        name: this.name,
        path: this.path,
        runtime,
        returnValue: runner.traceSummaries,
        run: repeat + 1,
        repeat: this.options.repeat
      };
      await this._processSingle(result);
    }
    await this._processFinal();
    await this._reportResults();
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
  const filename = treePath.shift();
  if (!filename) {
    return;
  }
  require(path.resolve(filename));
  const ctx = new PerfContext(filename, null);
  await ctx.runSingle(treePath);
}

/**
 * Log context tree to console.
 */
export function showTree(filename: string): void {
  require(path.resolve(filename));
  const ctx = new PerfContext(filename, null);
  console.log(JSON.stringify(ctx.getTree(), null, 2));
}

/**
 * Extract baselineData from a single perfcase log.
 */
function createBaselineData(summary: { [key: string]: any}): {[key: string]: IBaselineEntry[]} {
  const baselineData: {[key: string]: IBaselineEntry[]} = {};
  const descendWithPath = (el: any, path: string[]) => {
    mapObjectValues(el, (sub: any, name: string) => {
      if (!sub || sub instanceof Array || typeof sub === 'string' || typeof sub === 'number') {
        return;
      }
      if (sub.mean) {
        baselineData[path.concat(name).join('.')] = [
          {stat: 'mean', base: sub.mean},
          {stat: 'median', base: sub.median},
          {stat: 'dev', base: sub.dev},
          {stat: 'cv', base: sub.cv},
          {stat: 'runs', base: sub.values.length}
        ];
      } else {
        descendWithPath(sub, path.concat(name));
      }
    });
  };
  descendWithPath(summary, []);
  return baselineData;
}

/**
 * Get skip/tolerance values for treePath and dataPath.
 */
function getTolerance(treePath: string, dataPath: string): number[] | null {
  const path = treePath + '#' + dataPath;
  if (EVAL_CONFIG.skip.filter(el => path.match(FILTER_FN(el))).pop()) {
    return null;
  }
  return Object.getOwnPropertyNames(EVAL_CONFIG.tolerance).map(
      name => path.match(FILTER_FN(name)) ? EVAL_CONFIG.tolerance[name] : null
    ).filter(el => el).pop() || DEFAULT_TOLERANCE;
}

/**
 * Parse baselineData from a log output.
 * Also used for eval data (carried as intermediate baselineData and later merged with real baselineData).
 */
function getDataForBaseline(path: string): IBaselineData {
  const caseResults = fs.readFileSync(path, {encoding: 'utf8'}).split('\n').filter(line => line).map(line => JSON.parse(line));
  const baselineData: IBaselineData = {};
  caseResults.forEach(entry => {
    // skip any non perf case report data
    // also abort on erroneous data
    if (entry.type === ReportType.PerfCase) {
      baselineData[entry.pathString] = createBaselineData(entry.summary);
    } else if (entry.type === ReportType.Error) {
      throw new Error('refusing to eval erroneous data');
    }
  });
  return baselineData;
}

/**
 * Expand baselineData with tolerances.
 */
function applyTolerance(data: IBaselineEntry[], treePath: string, dataPath: string): void {
  data.forEach(el => el.tolerance = getTolerance(treePath, dataPath + '.' + el.stat));
}

/**
 * Format baselineData to show in console.
 * Handles both .showBaselineData and .runEval.
 */
function formatStats(values: IBaselineEntry[]): string {
  return columnify(values, {
    minWidth: 10,
    align: 'right',
    config: {
      stat: {
        align: 'left'
      },
      base: {
        dataTransform: (el: string) => (el !== '') ? Number(el).toFixed(2) : '<null>'
      },
      value: {
        dataTransform: (el: string) => (el !== '') ? Number(el).toFixed(2) : '<null>'
      },
      tolerance: {
        dataTransform: (el: string) => (el === '')
          ? '\x1b[36mskipped\x1b[0m'
          : el.split(',').map(el => Number(el).toFixed(2)).join('-')
      },
      change: {
        headingTransform: (_: string) => 'CHANGE(%)',
        dataTransform: (el: string) => (el !== '') ? Number(el).toFixed(2) : ''
      },
      eval: {
        dataTransform: (el: string) => {
          // columnify already made string of it so parse back :(
          switch (parseInt(el)) {
            case EvalResultState.Success:
              return '\x1b[32mOK\x1b[0m';
            case EvalResultState.Missing:
              return '\x1b[33mMISS\x1b[0m';
            case EvalResultState.Skipped:
              return '\x1b[36mSKIP\x1b[0m';
            case EvalResultState.Failed:
              return '\x1b[31mFAILED\x1b[0m';
            default:
              return '';
          }
        }
      }
    }
  });
}

/**
 * Show baseline stats to be accounted.
 */
export function showBaselineData(basePath: string) {
  const data = getDataForBaseline(basePath);
  console.log('\n### Baseline data ###');
  mapObjectValues(data, (value: {[key: string]: IBaselineEntry[]}, key: string) => {
    console.log(`"${key}"`);
    mapObjectValues(value, (vvalue: IBaselineEntry[], kkey: string) => {
      const tolerance = getTolerance(key, kkey);
      console.log(((!tolerance) ? '\x1b[36m' : '') + INDENT + '#' + kkey + ((!tolerance) ? ' - skipped' : '') + '\x1b[0m');
      applyTolerance(vvalue, key, kkey);
      const msg = formatStats(vvalue);
      console.log(INDENT.repeat(2) + msg.split('\n').join('\n' + INDENT.repeat(2)));
    });
  });
  LOGPATHS.forEach(path => fs.appendFileSync(path, JSON.stringify({type: ReportType.Base, data}, null) + '\n'));
}

/**
 * Expand baselineData with eval data and do the eval within the tolerances.
 */
function applyEval(baselineEntries: IBaselineEntry[], evalEntries: IBaselineEntry[] | undefined, treePath: string, dataPath: string, stats: IEvalStatsSummary): void {
  baselineEntries.forEach((el, idx) => {
    el.tolerance = getTolerance(treePath, dataPath + '.' + el.stat);
    el.value = (evalEntries && evalEntries[idx]) ? evalEntries[idx].base : undefined;
    if (typeof el.value === 'undefined') {
      el.eval = EvalResultState.Missing;
      stats.missing++;
      return;
    }
    if (!el.tolerance) {
      el.eval = EvalResultState.Skipped;
      stats.skipped++;
      return;
    }
    if (el.base === 0 && el.value === 0) {
      el.change = 0;
      el.eval = EvalResultState.Success;
      return;
    }
    const deviation = el.value / el.base;
    el.change = (el.value - el.base) / el.base * 100;
    if (deviation >= el.tolerance[0] && deviation <= el.tolerance[1]) {
      el.eval = EvalResultState.Success;
      stats.success++;
      return;
    }
    el.eval = EvalResultState.Failed;
    stats.failed++;
  });
}

/**
 * Eval run against baseline.
 */
export function evalRun(basePath: string, evalPath: string): IEvalStats {
  const baselineData = getDataForBaseline(basePath);
  const evalData = getDataForBaseline(evalPath);
  const stats: IEvalStatsSummary = {success: 0, missing: 0, skipped: 0, failed: 0};
  mapObjectValues(baselineData, (value: {[key: string]: IBaselineEntry[]}, key: string) => {
    console.log(`"${key}"`);
    const evalPart = evalData[key];
    mapObjectValues(value, (vvalue: IBaselineEntry[], kkey: string) => {
      const tolerance = getTolerance(key, kkey);
      console.log(((!tolerance) ? '\x1b[36m' : '') + INDENT + '#' + kkey + ((!tolerance) ? ' - skipped' : '') + '\x1b[0m');
      applyTolerance(vvalue, key, kkey);
      const evalSubPart = (evalPart) ? evalPart[kkey] : undefined;
      applyEval(vvalue, evalSubPart, key, kkey, stats);
      const msg = formatStats(vvalue);
      console.log(INDENT.repeat(2) + msg.split('\n').join('\n' + INDENT.repeat(2)));
    });
  });
  console.log('\n');
  console.log(`\x1b[32m Success: ${stats.success}\x1b[0m`);
  console.log(`\x1b[33m Missing: ${stats.missing}\x1b[0m`);
  console.log(`\x1b[36m Skipped: ${stats.skipped}\x1b[0m`);
  console.log(`\x1b[31m Failed: ${stats.failed}\x1b[0m`);
  const final: IEvalStats = {
    type: ReportType.Eval,
    data: baselineData,
    summary: stats
  };
  LOGPATHS.forEach(path => fs.appendFileSync(path, JSON.stringify(final, null) + '\n'));
  return final;
}

/**
 * A forked call for a single perf case.
 */
if (require.main === module) {
  if (process.send) {
    process.on('message', async msg => {
      Object.assign(CMDLINE_OVERRIDES, msg.cmdlineOverrides);
      const filename = msg.case.shift();
      require(path.resolve(filename));
      const ctx = new PerfContext(filename, null);
      await ctx.runSingle(msg.case, true);
      process.removeAllListeners('message');
    });
  }
}
