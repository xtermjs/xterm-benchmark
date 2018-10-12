import * as commander from 'commander';
import { _run, _runIsolated } from './index';

async function main() {
  if (process.send) {
    // run isolated perf from fork
    process.on('message', async message => {
      process.send(await _runIsolated(message.path, message.casename));
      process.exit();
    });
  } else {
    commander
      .name('xterm-benchmark')
      .usage('[files]')
      .version(require('../package.json').version, '-v, --version')
      .parse(process.argv);
    const perfFiles = commander.args;
    for (let i = 0; i < perfFiles.length; ++i) {
      await _run(perfFiles[i]);
    }
  }
}

if (require.main === module) {
  main();
}
