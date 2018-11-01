const Terminal = require('xterm/lib/Terminal').Terminal;
const pty = require('xterm/node_modules/node-pty');
const perfContext = require('../lib/index').perfContext;
const before = require('../lib/index').before;
const RuntimeCase = require('../lib/index').RuntimeCase;

class TestTerminal extends Terminal {
  writeSync(data) {
    this.writeBuffer.push(data);
    this._innerWrite();
  }
}

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
  p.on('data', data => { content += data; });
  await new Promise(resolve => p.on('exit', () => resolve()));
});

perfContext('translateToString - JSArray', () => {
  let terminal;
  before(() => {
    terminal = new TestTerminal({
      cols: 80,
      rows: 25,
      scrollback: 10000,
      experimentalBufferLineImpl: 'JSArray'
    });
    terminal.writeSync(content);
  });
  new RuntimeCase('', () => {
    const strings = [];
    for (let i = 0; i < terminal.buffer.lines.length; ++i) {
      strings.push(terminal.buffer.translateBufferLineToString(i, true));
    }
    return strings;
  }, {fork: true}).showRuntime().showAverageRuntime();
});

perfContext('translateToString - TypedArray', () => {
  let terminal;
  before(() => {
    terminal = new TestTerminal({
      cols: 80,
      rows: 25,
      scrollback: 10000,
      experimentalBufferLineImpl: 'TypedArray'
    });
    terminal.writeSync(content);
  });
  new RuntimeCase('', () => {
    const strings = [];
    for (let i = 0; i < terminal.buffer.lines.length; ++i) {
      strings.push(terminal.buffer.translateBufferLineToString(i, true));
    }
    return strings;
  }, {fork: true}).showRuntime().showAverageRuntime();
});
