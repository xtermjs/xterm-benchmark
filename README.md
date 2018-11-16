## xterm-benchmark

Library to create and run automated performance test cases.

### Current state

The library and the cmdline tool are in pre alpha state and likely to see heavy API changes.
It is currently developed and hardlinked to xterm.js, to work properly this repo should be
checked out next to an existing xterm.js repo folder.

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

### Running Example Perf Case
- cd xterm-benchmark && npm install (If this throws puppeteer error then try deleting the whole puppeteer folder before doing npm install again.)
- npm run tsc ( Compiles ts files into js files which can be found under ./lib folder)
- node lib/cli.js lib/src/xterm_perfcases/parser.ts ( New perf case files should be under src/xterm_perfcases )


### Configuration

The config file currently supports the following settings:

- APP_PATH `string`<br>base folder path, logs get stored here
- defaultOptions:
  - fork `boolean`<br>whether to run cases in a separate process (overridable at individual perf case)
  - repeat `number`<br>repeat cases n times (overridable at individual perf case or at cmdline)
- evalConfig
  - tolerance `{[path: string]: value}`<br>`path` is a value path in the form `<perf_case_path>#<summaryEntry_name>.<value_name>.<aggregate_name>`,
  path supports simple matching rules (e.g. `'*'` will match all values in all perf cases,
  `"*.median"` will match all median values in all perf cases).
  value is an array in the form of `[low_border, high_border]`, where the border values are relative
  to the baseline value. Example: `{"*.mean": [0.5, 2]}` - eval runs will pass all mean tests if they
  are at least half and at most twice of the baseline value
  - skip `string[]`<br>list of value paths to be skipped during evaluation

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

### Baseline & Evaluation hints

- To get somewhat reliable baseline data it is important to run each perf case several times
(the more the better, do at least 10 times). This way individual run differences due to a slightly different
system load at a single run can be levelled out (see `-r` cmdline switch).
- To level out impact of previous perf cases within the same process consider running them as forked for
baseline and eval runs (TODO: always fork cmdline switch).
- Currrently an unusual constant high/low system load, that would affect all baseline runs, cannot be spotted. (This might change with future versions.) Therefore it is important not to create the baseline data during unusual usage scenarios to keep the baseline data clean.
- Implemented numercial results of a single run include:
  - number of runs (all perf case types)
  - total runtime in msec (`RuntimeCase`)
  - throughput in MB/s (`Throughput` mixin)
  - puppeteer perf cases (`ExtractFromTimeline` mixin):
      - summary values (devtools pie chart)
      - requested topDown values with self and total runtime
- Numercial baseline values are aggregated for all runs as following (basic descriptive statistics):
  - mean average (`mean`)
  - median average (`median`)
  - standard deviation (`dev`)
  - coefficient of variance (`cv`)
- Every aggregated value has a tolerance range given as `[low_border, high_border]`. The borders
are relative to the baseline value, currently it is not possible to set absolute values (might change).
- Individual tolerance ranges can be set in the config file by addressing a certain value (see Configuration).
- The automated evaluation is tested against the tolerance range, means if the evaluated value is within the tolerance of the baseline value it passes the test.
- What to make out of the statistical values?
  - standard deviation: should be as low as possible
  - problem high standard deviation: dataset should not be used as baseline or eval as it indicates that the indivual runs show very different behavior, possibly caused by low run number or high fluctuations in system load
  - coefficient of variance: shows the "quality" of the calculated mean value
  - problem high coefficient of variance: calculated mean value is highly uncertain, data should never be used for baseline or eval runs, to rule out system load fluctuations this value typically should stay far below 0.3
  - median: should not be used by default, still can be useful if the value clearly shows non normal distribution
  to still get some comparison running (example: due to ongoing JIT optimization some values might show a decreasing runtime over several runs, others might get worse due to heavier GC invocation)
- Unwanted values for evaluation can be skipped in the config file.
