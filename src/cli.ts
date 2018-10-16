import * as commander from 'commander';
import { run, showTree, CMDLINE_OVERRIDES } from './index';
import { ICmdlineOverrides } from './interfaces';

async function main(): Promise<void> {
  commander
    .name('xterm-benchmark')
    .usage('[files]')
    .version(require('../package.json').version, '-v, --version')
    .option('-t, --tree <file>', 'show perf case tree')
    .option('-s, --single <path>', 'run single context|case isolated')
    .option('-j, --json', 'newline delimited json output')
    .option('-r, --repeat <num>', 'repeat cases <num> times', parseInt)
    .option('-t, --timeout <num>', 'set timeout to <num> msec', parseInt)  // TODO
    .parse(process.argv);

  if (commander.tree) {
    showTree(commander.tree);
    return;
  }

  const overrides: ICmdlineOverrides = {};
  if (commander.repeat) {
    overrides['repeat'] = commander.repeat;
  }
  if (commander.timeout) {
    overrides['timeout'] = commander.timeout;
  }
  Object.assign(CMDLINE_OVERRIDES, overrides);

  if (commander.single) {
    const path = commander.single.split('|');
    await run(path);
    return;
  }

  const perfFiles = commander.args;
  for (let i = 0; i < perfFiles.length; ++i) {
    await run([perfFiles[i]]);
  }
}

if (require.main === module) {
  main();
}
