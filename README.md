## xterm-benchmark

Library to create and run automated performance test cases.

### Cmdline options
```
Usage: xterm-benchmark [files]

Options:
  -v, --version         output the version number
  -t, --tree <file>     show contex and perf case tree
  -s, --single <path>   run single context or perf case
  -r, --repeat <num>    repeat cases <num> times
  -t, --timeout <num>   set timeout to <num> msec
  -o, --output <path>   set output path (defaults to <APP_PATH>/<EPOCH>.log)
  -S, --silent          no console log output
  -j, --json            output json to stdout, equals "-S -l /dev/stdout"
  -f, --full            include full results in reports
  -F, --fail            also fail on missings
  -b, --baseline        mark run as baseline data
  -c, --config <path>   path to config file
  -e, --eval            eval run against baseline data
  -a, --against <path>  baseline data path to eval against
  -h, --help            output usage information
```

### Quick usage

- create perf case files (see example below or `src/xterm_perfcases`)
- run a set of files to create the baseline data, e.g. `xterm-benchmark some_files* -b`
- after code changes run the same set of files against the baseline, e.g. `xterm-benchmark some_files* -e`

### Configuration

TODO...

### Creating perf cases

Perf cases are instances of a derived class of the base class `PerfCase`.
To keep it highly customizable, `PerfCase` can be extended by mixins (see `src/example/custom_mixin.ts`).

The library comes with several predefined perf case classes:
- RuntimeCase: contains mixin for runtime reports
- ThroughputRuntimeCase: contains runtime and throughput mixins
- TimelinePerfCase: base class for puppeteer based perf cases (TODO: merge with extract mixin)

A simple runtime reporting perf case would look like this:
```TS
import { RuntimeCase } from '..';

new RuntimeCase('Something to measure', async () => {
  // some work
  await new Promise(resolve => setTimeout(resolve, 1000));
})
.showRuntime()          // show runtime for single run
.showAverageRuntime();  // show aggregated runtime for multiple runs
```

Perf cases can be put into a context that support running preparation and cleanup code with `before`, `beforeEach`, `after` and `afterEach`. A single file automatically contains a toplevel context.
```TS
import { before, after, beforeEach, afterEach, perfContext } from '..';

before(() => console.log('run once upon entering the file (always first)'));
after(() => console.log('run once upon leaving the file (always last)'));
beforeEach(() => console.log('run before each perf case or context'));
afterEach(() => console.log('run after each perf case or context'));

perfContext('some ctx', () => {
  // perf cases or sub contexts...
});

// more perf cases or additional contexts...
```
