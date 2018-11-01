import { TimelinePerfCase, before, after } from '..';
import { ExtractFromTimeline } from '../mixins';
import { TimelineRunner } from 'chrome-timeline';
import { spawn, ChildProcess } from 'child_process';

function bashspawn(command: string): ChildProcess {
  return spawn('sh', ['-c', command], { stdio: ['ignore', 'ignore', 'inherit'], detached: true });
}

let child: ChildProcess = null;

before(async () => {
  child = bashspawn('cd ../xterm.js && npm start');
  await new Promise(resolve => setTimeout(resolve, 7000));
});

function killChild() {
  try {
    process.kill(-child.pid);
  } catch (e) {
    try {
      child.kill();
    } catch (e) {}
  }
}

process.once('SIGINT', () => {
  killChild();
  process.kill(process.pid, 'SIGINT');
});
after(killChild);

const TimelineRuntime = ExtractFromTimeline(TimelinePerfCase);
new TimelineRuntime('timeline', async (runner: TimelineRunner) => {
  await runner.page.goto('http://localhost:3000', {waitUntil: 'networkidle2'});
  await runner.sleep(1000);
  await runner.tracingStart('LS_INPUT');
  await runner.remote((done: () => void, window: Window) => {
    (window as any).term.setOption('experimentalBufferLineRecycling', true);
    (window as any).term.setOption('experimentalBufferLineImpl', 'TypedArray');
    (window as any).term._core.handler('ls -lR /usr/lib\r');
    setTimeout(done, 3000);
  });
  await runner.tracingStop();
})
.extractTopDownValues({'LS_INPUT': [
  'EscapeSequenceParser.parse',   // self: parsing cost, total: input cost
  'InputHandler.print',           // total: cost for adding printables to buffer
  'Terminal.scroll',              // total: cost for adding new lines at bottom
  'TextRenderLayer._forEachCell', // total: canvas text renderer cost
  'drawImage'                     // self: low level canvas drawing cost
]})
.extractSummaries()
.averageSummaries()
.averageTopDownValues()
.showAverageSummaries()
.showAverageTopDownValues();
