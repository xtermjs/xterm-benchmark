import * as commander from 'commander';
import { run, showTree, CMDLINE_OVERRIDES, LOGPATHS, showBaselineData, EVAL_CONFIG, DEFAULT_OPTIONS, evalRun } from './index';
import { ICmdlineOverrides, ReportType } from './interfaces';
import * as appRoot from 'app-root-path';
import * as fs from 'fs';
import * as path from 'path';
import { mapObjectValues } from './helper';

async function main(): Promise<void> {
  commander
    .name('xterm-benchmark')
    .usage('[files]')
    .version(require('../package.json').version, '-v, --version')

    /**
     * --tree <file>
     * Outputs a tree of contexts and perf cases defined
     * in <file>. This is useful to grab a single perf case path
     * and run it single with --single during development.
     */
    .option('-t, --tree <file>', 'show contex and perf case tree')

    /**
     * --single <path>
     * Runs <path> without the siblings. Path denotes a single context
     * or perf case, grab it from --tree.
     * A file always holds a root context, thus calling xterm-benchmark
     * for single file with -s <filepath> is the same as omitting -s.
     */
    .option('-s, --single <path>', 'run single context or perf case')

    /**
     * - repeat <num>
     * Cmdline override to repeat all perf cases <num> times.
     * Repeat setting precedence (least to highest):
     *    - 1 (defined as library default)
     *    - config file
     *    - individual setting at perf case
     *    - cmdline -r switch
     */
    .option('-r, --repeat <num>', 'repeat cases <num> times', parseInt)

    /**
     * TODO (same rules as repeat)
     */
    .option('-t, --timeout <num>', 'set timeout to <num> msec', parseInt)

    /**
     * --output <path>
     * Set the log output to <path>. The log output contains summaries
     * from all run perf cases as newline delimited json.
     * Defaults to <APP_PATH>/<EPOCH>.log (APP_PATH defaults to ./benchmark).
     */
    .option('-o, --output <path>', 'set output path (defaults to <APP_PATH>/<EPOCH>.log)')

    /**
     * --silent
     * Silent stdout. By default the console receives some useful
     * human readable information about running perf cases and results.
     * Note stderr is not affected by this setting.
     */
    .option('-S, --silent', 'no console log output')

    /**
     * --json
     * Silents the console (--silent) and sets output path to stdout.
     * Any other --output setting will be ignored.
     * The output format is newline delimited json.
     * Useful for post processing results by piping.
     */
    .option('-j, --json', 'output json to stdout, equals "-S -l /dev/stdout"')

    /**
     * --full
     * By default only aggregated perf case summaries are reported.
     * With this switch the reports will contain all results of
     * all iterations.
     */
    .option('-f, --full', 'include full results in reports')

    /**
     * --fail
     * For eval runs against a baseline missing results
     * are not handled as errors by default (will exit normally).
     * To ensure the eval set contains the same perf cases as
     * the baseline set this switch.
     */
    .option('-F, --fail', 'also fail on missings')

    /**
     * --baseline
     * Marks the current run as a baseline. Any later eval
     * run (--eval) will be tested against this baseline.
     * Note that any report from a previous run can act
     * as a baseline (see --against), this switch is merely
     * a convenient shortcut and will store the report data
     * under <APP_PATH>/baseline.log. Later calls with
     * --baseline will override this baseline.
     */
    .option('-b, --baseline', 'mark run as baseline data')

    /**
     * --config
     * Provide a config file for xterm-benchmark. Not
     * mandatory, still a must have for advanced setups to
     * fine tune the perf case and eval settings.
     */
    .option('-c, --config <path>', 'path to config file')

    /**
     * --eval
     * Evaluates perf case summary results reported by the current
     * run against a baseline. The baseline defaults to the last
     * run marked with --baseline, provide a custom baseline
     * with --against.
     * The automated evaluation happens on all summary results, that
     * contain statistical values. Those include by default a mean,
     * median, standard deviation and the coefficient of variation.
     * With a skiplist in the config file tests for unwanted values
     * can be skipped.
     * The automated evaluation compares the values against a given tolerance
     * and suceeds if the tested one is within the tolerance of the baseline.
     * Adjust the tolerance in the config file, the default range of
     * 0.25 - 4 is rather silly for most cases.
     * Reports the eval results afterwards and exits either
     * with 0 (success) or 2 (failure).
     */
    .option('-e, --eval', 'eval run against baseline data')

    /**
     * --against <path>
     * Give a report file under <path> as baseline and eval the current
     * run against this baseline.
     */
    .option('-a, --against <path>', 'baseline data path to eval against')
    .parse(process.argv);

  if (commander.tree) {
    showTree(commander.tree);
    return;
  }

  if (commander.json) {
    commander.silent = true;
    commander.output = '/dev/stdout';
  }

  let APP_PATH: string = path.join(appRoot.path, 'benchmark');
  if (commander.config) {
    try {
      const config = require(path.resolve(commander.config));

      if (config.APP_PATH) {
        APP_PATH = path.resolve(config.APP_PATH);
      }
      if (config.evalConfig) {
        EVAL_CONFIG.tolerance = Object.assign(EVAL_CONFIG.tolerance, config.evalConfig.tolerance);
        EVAL_CONFIG.skip = config.evalConfig.skip || EVAL_CONFIG.skip;
      }
      if (config.defaultOptions) {
        mapObjectValues(config.defaultOptions, (value: any, name: string) => DEFAULT_OPTIONS[name] = value);
      }
    } catch (e) {
      console.error(e);
      process.exit(1);
    }
  }
  if (!fs.existsSync(APP_PATH)) {
    fs.mkdirSync(APP_PATH);
  }

  const EPOCH: number = (new Date).getTime();
  LOGPATHS.push(commander.output ? path.resolve(commander.output) : path.join(APP_PATH, `${EPOCH}.log`));

  let baselinePath: string = '';
  if (commander.baseline) {
    baselinePath = path.join(APP_PATH, `baseline.log`);
    LOGPATHS.push(baselinePath);
  }
  let evalPath: string = '';
  if (commander.eval || commander.against) {
    if (commander.against) {
      baselinePath = path.resolve(commander.against);
    } else {
      baselinePath = path.join(APP_PATH, `baseline.log`);
    }
    evalPath = path.join(APP_PATH, `current.log`);
    LOGPATHS.push(evalPath);
  }
  LOGPATHS.forEach(path => fs.writeFileSync(path, ''));

  const overrides: ICmdlineOverrides = {};
  if (commander.repeat) {
    overrides.repeat = commander.repeat;
  }
  if (commander.timeout) {
    overrides.timeout = commander.timeout;
  }
  if (commander.full) {
    overrides.reportFullResults = true;
  }
  Object.assign(CMDLINE_OVERRIDES, overrides);

  if (commander.silent) {
    console.log = () => {};
  }

  try {
    if (commander.single) {
      const path = commander.single.split('|');
      await run(path);
    } else {
      const perfFiles = commander.args;
      for (let i = 0; i < perfFiles.length; ++i) {
        await run([perfFiles[i]]);
      }
    }
  } catch (error) {
    console.error(error);
    LOGPATHS.forEach(path => fs.appendFileSync(path, JSON.stringify({type: ReportType.Error, data: 'error'}, null) + '\n'));
    process.exit(1);
  }

  if (commander.baseline) {
    try {
      showBaselineData(baselinePath);
    } catch (error) {
      console.error(error);
      LOGPATHS.forEach(path => fs.appendFileSync(path, JSON.stringify({type: ReportType.Error, data: 'error'}, null) + '\n'));
      process.exit(1);
    }
  }

  if (commander.eval || commander.against) {
    try {
      const stats = evalRun(baselinePath, evalPath);
      if (stats.summary.failed) {
        process.exit(2);
      }
      if (stats.summary.missing && commander.fail) {
        process.exit(2);
      }
    } catch (error) {
      console.error(error);
      LOGPATHS.forEach(path => fs.appendFileSync(path, JSON.stringify({type: ReportType.Error, data: 'error'}, null) + '\n'));
      process.exit(1);
    }
  }
}

if (require.main === module) {
  main();
}
