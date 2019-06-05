import { TimelinePerfCase, before, after } from '..';
import { ExtractFromTimeline } from '../mixins';
import { TimelineRunner } from 'chrome-timeline';
import { spawn, ChildProcess } from 'child_process';

function bashspawn(command: string): ChildProcess {
  return spawn('sh', ['-c', command], { stdio: ['ignore', 'ignore', 'inherit'], detached: true });
}

let child: ChildProcess;

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
  if (!runner.page) {
    return;
  }
  await runner.page.goto('http://localhost:3000', {waitUntil: 'networkidle2'});
  await runner.sleep(1000);
  await runner.tracingStart('TRACE_ABC');
  await runner.remote((done: () => void, window: Window) => {
    (window as any).term._core.handler('ls -lR /usr/lib\r');
    setTimeout(done, 3000);
  });
  await runner.tracingStop();
}, {repeat: 1})
.extractTopDownValues({'TRACE_ABC': ['EscapeSequenceParser.parse', 'InputHandler.print']})
.extractSummaries()
.averageSummaries()
.averageTopDownValues()
.showAverageSummaries()
.showAverageTopDownValues();
