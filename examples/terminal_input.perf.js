const Terminal = require('xterm/lib/Terminal').Terminal;
const pty = require('xterm/node_modules/node-pty');
const perfContext = require('../lib/index').perfContext;
const before = require('../lib/index').before;
const ThroughputRuntimeCase = require('../lib/index').ThroughputRuntimeCase;

class TestTerminal extends Terminal {
  writeSync(data) {
    this.writeBuffer.push(data);
    this._innerWrite();
  }
}

perfContext('Terminal: ls -lR /usr/lib', () => {
  let content = '';

  before(async () => {
    // grab output from "ls -lR /usr/lib"
    const p = pty.spawn('ls', ['--color=auto', '-lR', '/usr/lib'], {
      name: 'xterm-color',
      cols: 80,
      rows: 25,
      cwd: process.env.HOME,
      env: process.env
    });
    let fromPty = '';
    p.on('data', data => { fromPty += data; });
    await new Promise(resolve => p.on('exit', () => resolve()));
    // test with +50MB
    while (content.length < 50000000) {
      content += fromPty;
    }
  });

  perfContext('JSArray no recycling', () => {
    let terminal;
    before(() => {
      terminal = new TestTerminal({
        cols: 80,
        rows: 25,
        scrollback: 1000,
        experimentalBufferLineImpl: 'JSArray',
        experimentalBufferLineRecycling: false
      });
    });
    new ThroughputRuntimeCase('', () => {
      terminal.writeSync(content);
      return {payloadSize: content.length};
    }, {fork: true}).showRuntime().showThroughput().showAverageRuntime().showAverageThroughput();
  });

  perfContext('JSArray with recycling', () => {
    let terminal;
    before(() => {
      terminal = new TestTerminal({
        cols: 80,
        rows: 25,
        scrollback: 1000,
        experimentalBufferLineImpl: 'JSArray',
        experimentalBufferLineRecycling: true
      });
    });
    new ThroughputRuntimeCase('', () => {
      terminal.writeSync(content);
      return {payloadSize: content.length};
    }, {fork: true}).showRuntime().showThroughput().showAverageRuntime().showAverageThroughput();
  });
  
  perfContext('TypedArray no recycling', () => {
    let terminal;
    before(() => {
      terminal = new TestTerminal({
        cols: 80,
        rows: 25,
        scrollback: 1000,
        experimentalBufferLineImpl: 'TypedArray',
        experimentalBufferLineRecycling: false
      });
    });
    new ThroughputRuntimeCase('', () => {
      terminal.writeSync(content);
      return {payloadSize: content.length};
    }, {fork: true}).showRuntime().showThroughput().showAverageRuntime().showAverageThroughput();
  });

  perfContext('TypedArray with recycling', () => {
    let terminal;
    before(() => {
      terminal = new TestTerminal({
        cols: 80,
        rows: 25,
        scrollback: 1000,
        experimentalBufferLineImpl: 'TypedArray',
        experimentalBufferLineRecycling: true
      });
    });
    new ThroughputRuntimeCase('', () => {
      terminal.writeSync(content);
      return {payloadSize: content.length};
    }, {fork: true}).showRuntime().showThroughput().showAverageRuntime().showAverageThroughput();
    //}, {fork: true, forkOptions: {execArgv: ['--inspect-brk']}}).showRuntime().showThroughput().showAverageRuntime().showAverageThroughput();
  });
});
