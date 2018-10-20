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
    .option('-t, --tree <file>', 'show perf case tree')
    .option('-s, --single <path>', 'run single context|case isolated')
    .option('-r, --repeat <num>', 'repeat cases <num> times', parseInt)
    .option('-t, --timeout <num>', 'set timeout to <num> msec', parseInt)  // TODO
    .option('-l, --logpath <path>', 'set logpath (defaults to <APP_PATH>/<EPOCH>.log)')
    .option('-S, --silent', 'no console log output')
    .option('-j, --json', 'outputs NL delimited json, equals "-S -l /dev/stdout"')
    .option('-f, --full', 'include full results in reports')
    .option('-F, --fail', 'also fail on missings')
    .option('-b, --baseline', 'mark run as baseline data')
    .option('-c, --config <path>', 'path to config file')
    .option('-e, --eval', 'eval run against baseline data')
    .parse(process.argv);

  if (commander.tree) {
    showTree(commander.tree);
    return;
  }

  if (commander.json) {
    commander.silent = true;
    commander.logpath = '/dev/stdout';
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
  LOGPATHS.push(commander.logpath ? path.resolve(commander.logpath) : path.join(APP_PATH, `${EPOCH}.log`));

  let baselinePath: string = '';
  if (commander.baseline) {
    baselinePath = path.join(APP_PATH, `baseline.log`);
    LOGPATHS.push(baselinePath);
  }
  let evalPath: string = '';
  if (commander.eval) {
    baselinePath = path.join(APP_PATH, `baseline.log`);
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

  if (commander.eval) {
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
