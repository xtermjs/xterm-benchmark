const Terminal = require('xterm/lib/Terminal').Terminal;
const pty = require('xterm/node_modules/node-pty');
const perfContext = require('../lib/index').perfContext;
const before = require('../lib/index').before;
const throughput = require('../lib/index').throughput;

class TestTerminal extends Terminal {
  writeSync(data) {
    this.writeBuffer.push(data);
    this._innerWrite();
  }
}

perfContext('terminal input throughput', () => {
  let content = '';
  let jsNo;
  let jsYes;
  let typedNo;
  let typedYes;

  before(async () => {
    // grab output from "ls -lR /usr/lib"
    const p = pty.spawn('ls', ['-lR', '/usr/lib'], {
      name: 'xterm-color',
      cols: 80,
      rows: 25,
      cwd: process.env.HOME,
      env: process.env
    });
    let fromPty = '';
    p.on('data', data => { fromPty += data; });
    await new Promise(resolve => p.on('exit', () => resolve()));
    while (content.length < 50000000)  // test with +50MB
      content += fromPty;
    
    /*
    jsNo = new TestTerminal({
      cols: 80,
      rows: 25,
      scrollback: 1000,
      experimentalBufferLineImpl: 'JSArray',
      experimentalPushRecycling: false
    });
    jsNo.writeSync(fromPty);

    jsYes = new TestTerminal({
      cols: 80,
      rows: 25,
      scrollback: 1000,
      experimentalBufferLineImpl: 'JSArray',
      experimentalPushRecycling: true
    });
    jsYes.writeSync(fromPty);

    typedNo = new TestTerminal({
      cols: 80,
      rows: 25,
      scrollback: 1000,
      experimentalBufferLineImpl: 'TypedArray',
      experimentalPushRecycling: false
    });
    typedNo.writeSync(fromPty);

    typedYes = new TestTerminal({
      cols: 80,
      rows: 25,
      scrollback: 1000,
      experimentalBufferLineImpl: 'TypedArray',
      experimentalPushRecycling: true
    });
    typedYes.writeSync(fromPty);
    */
  });

  perfContext('JS NO REC', () => {
    before(() => {
      jsNo = new TestTerminal({
        cols: 80,
        rows: 25,
        scrollback: 1000,
        experimentalBufferLineImpl: 'JSArray',
        experimentalPushRecycling: false
      });
    });
    throughput('JSArray no recycling', () => {
      jsNo.writeSync(content);
      return content.length;
    }, {fork: true}).showThroughput().showAverageThroughput();
  });

  throughput('JSArray with recycling', () => {
    jsYes = new TestTerminal({
      cols: 80,
      rows: 25,
      scrollback: 1000,
      experimentalBufferLineImpl: 'JSArray',
      experimentalPushRecycling: true
    });
    jsYes.writeSync(content);
    return content.length;
  }, {fork: true}).showThroughput();

  throughput('TypedArray no recycling', () => {
    typedNo = new TestTerminal({
      cols: 80,
      rows: 25,
      scrollback: 1000,
      experimentalBufferLineImpl: 'TypedArray',
      experimentalPushRecycling: false
    });
    typedNo.writeSync(content);
    return content.length;
  }, {fork: true}).showThroughput();

  perfContext('TA REC', () => {
    before(() => {
      typedYes = new TestTerminal({
        cols: 80,
        rows: 25,
        scrollback: 1000,
        experimentalBufferLineImpl: 'TypedArray',
        experimentalPushRecycling: true
      });
    });
    throughput('TypedArray with recycling', () => {
      typedYes.writeSync(content);
      return content.length;
    }, {fork: true}).showThroughput().showAverageThroughput();
  });
});
