import { IPerfCase, ICaseResult } from './interfaces';
import { IEvent, ISummary } from 'chrome-timeline/lib/interfaces';
import { reshapeFn, descriptiveStats } from './helper';

/**
 * Predefined mixins for PerfCase
 */

 // ctor base
export type PerfCaseConstructor<T = IPerfCase> = new (...args: any[]) => T;

/**
 * Runtime mixin for PerfCase.
 * Appends `averageRuntime` to summary.
 */
export function Runtime<TBase extends PerfCaseConstructor>(Base: TBase) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...args);
      this.postAll((results: ICaseResult[]): void => {
        try {
          this.summary['averageRuntime'] = reshapeFn([
            ':zip', 'runtime',
            (el: any, fn: Function): any => {
              if (el instanceof Array) {
                const msecs = el.map(item => item[1] / 1000000 + item[0] * 1000);
                return fn(Object.assign({values: el, valuesMs: msecs}, descriptiveStats(msecs)));
              }
              return el;
            }
          ])(results);
        } catch (e) {
          console.error(e);
          console.error(`reshaped data was:\n${reshapeFn([':zip', 'runtime'])(results)}`);
          throw e;
        }
      });
    }
    public showRuntime(): this {
      this.postEach((result: ICaseResult): ICaseResult => {
        const msg = `${this.getIndent()}Case "${this.name}" : ${result.run} - runtime: `
                  + `${Number(result.runtime[1] / 1000000 + result.runtime[0] * 1000).toFixed(2)} ms`;
        console.log(msg);
        return result;
      });
      return this;
    }
    public showAverageRuntime(): this {
      this.postAll((results: ICaseResult[]): void => {
        const msg = `${this.getIndent()}Case "${this.name}" : ${results.length} runs - average runtime: `
                  + `${Number(this.summary['averageRuntime'].mean).toFixed(2)} ms`;
        console.log(msg);
      });
      return this;
    }
  };
}

interface ICaseResultThroughput extends ICaseResult {
  throughput: number;
}

/**
 * Throughput mixin for PerfCase.
 * Appends `throughput` to each ICaseResult and `averageThroughput` to summary in MB/s.
 * Expects the payload as {payloadSize: some_value} in the result.returnValue.
 */
export function Throughput<TBase extends PerfCaseConstructor>(Base: TBase) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...args);
      this.postEach((result: ICaseResult): void => {
        const msec = result.runtime[1] / 1000000 + result.runtime[0] * 1000;
        (result as ICaseResultThroughput).throughput = (result.returnValue && result.returnValue.payloadSize)
          ? 1000 / msec * result.returnValue.payloadSize / 1024 / 1024 : 0;
      });
      this.postAll((results: ICaseResultThroughput[]): void => {
        try {
          this.summary['averageThroughput'] = reshapeFn([
              ':zip', 'throughput',
              (el: any, fn: Function) => (el instanceof Array) ? fn(Object.assign({values: el}, descriptiveStats(el))) : el
            ])(results);
        } catch (e) {
          console.error(e);
          console.error(`reshaped data was:\n${reshapeFn([':zip', 'throughput'])(results)}`);
          throw e;
        }
      });
    }
    public showThroughput(): this {
      this.postEach((result: ICaseResultThroughput): void => {
        const msg = `${this.getIndent()}Case "${this.name}" : ${result.run} - `
                  + `throughput: ${Number(result.throughput).toFixed(2)} MB/s`;
        console.log(msg);
      });
      return this;
    }
    public showAverageThroughput(): this {
      this.postAll((results: ICaseResultThroughput[]): void => {
        const msg = `${this.getIndent()}Case "${this.name}" : ${results.length} runs - average throughput: `
                  + `${Number(this.summary['averageThroughput'].mean).toFixed(2)} MB/s`;
        console.log(msg);
      });
      return this;
    }
  };
}


type IExtractData = {[symbol: string]: IEvent};
interface ICaseResultTimelineData extends ICaseResult {
  extractedTopDownValues?: {[traceName: string]: IExtractData};
  extractedSummaries?: {[traceName: string]: {[key: string]: number}};
}

/**
 * Mixin to extract data from chrome-timeline reports.
 * `.averageTopDownValues()` appends `averageTimelineTopDown` to summary,
 * the data to be processed are determined by a previous call of
 * `.extractTopDownValues({'traceName': ['symbol1', 'symbol2', ...]})`.
 * `.averageSummaries()` appends `averageTimelineSummaries` to summary.
 */
export function ExtractFromTimeline<TBase extends PerfCaseConstructor>(Base: TBase) {
  return class extends Base {
    public extractTopDownValues(config: {[traceName: string]: string[]}): this {
      this.postEach((result: ICaseResult): void => {
        if (!result.returnValue) {
          return;
        }
        let collect: {[traceName: string]: IExtractData} = {};
        for (const traceName in config) {
          const record: ISummary = result.returnValue[traceName];
          if (!record) {
            continue;
          }
          const collectForTrace: IExtractData = {};
          const symbols = config[traceName];
          symbols.forEach(symbol => {
            let filteredEvents = record.topDown.filter((event: IEvent) => event.name.match(symbol));
            collectForTrace[symbol] = filteredEvents.reduce(
              (a, b) => (!a) ? b : {
                  id: -1,
                  parentId: -1,
                  name: (a.name === b.name) ? a.name : 'wrong reduce', // wrong reduces for weak matches
                  selfTime: a.selfTime + b.selfTime,
                  totalTime: a.totalTime + b.totalTime
                });
            if (collectForTrace[symbol].name === 'wrong reduce') {
              console.error(`ERROR - extractTopDownValues: wrong reduce for '${symbol}' in trace '${traceName}'`);
              throw new Error(`ERROR - extractTopDownValues: wrong reduce for '${symbol}' in trace '${traceName}'`);
            }
          });
          collect[traceName] = collectForTrace;
        }
        (result as ICaseResultTimelineData).extractedTopDownValues = Object.assign(
          {}, (result as ICaseResultTimelineData).extractedTopDownValues, collect);
      });
      return this;
    }
    public extractSummaries(): this {
      this.postEach((result: ICaseResult): void => {
        if (!result.returnValue) {
          return;
        }
        const summaries: {[traceName: string]: number} = {};
        for (const traceName in result.returnValue) {
          summaries[traceName] = Object.assign({}, result.returnValue[traceName].summary);
        }
        (result as ICaseResultTimelineData).extractedSummaries = Object.assign(
          {}, (result as ICaseResultTimelineData).extractedSummaries, summaries);
      });
      return this;
    }
    public averageTopDownValues(): this {
      this.postAll((results: ICaseResultTimelineData[]) => {
        try {
          this.summary['averageTimelineTopDown'] = reshapeFn([
            ':zip', 'extractedTopDownValues', ':zip', ':keys', ':zip', ':keys', ':zip',
            (el: any, fn: Function) => fn({name: el.name[0] || '<noname>', selfTime: el.selfTime, totalTime: el.totalTime}),
            ':keys',
            (el: any, fn: Function) => (el instanceof Array) ? fn(Object.assign({values: el}, descriptiveStats(el))) : el
          ])(results);
        } catch (e) {
          console.error(e);
          console.error(`reshaped data was:\n${reshapeFn([
            ':zip', 'extractedTopDownValues', ':zip', ':keys', ':zip', ':keys', ':zip'])(results)}`);
          throw e;
        }
      });
      return this;
    }
    public averageSummaries(): this {
      this.postAll((results: ICaseResultTimelineData[]) => {
        try {
          this.summary['averageTimelineSummaries'] = reshapeFn([
            ':zip', 'extractedSummaries', ':zip', ':keys', ':zip', ':keys',
            (el: any, fn: Function) => fn(Object.assign({values: el}, descriptiveStats(el)))
          ])(results);
        } catch (e) {
          console.error(e);
          console.error(`reshaped data was:\n${reshapeFn([
            ':zip', 'extractedSummaries', ':zip', ':keys', ':zip', ':keys'])(results)}`);
          throw e;
        }
      });
      return this;
    }
    public showAverageTopDownValues(): this {
      this.postAll((results: ICaseResultTimelineData[]) => {
        if (!this.summary['averageTimelineTopDown']) {
          console.error(`ERROR: showAverageTopDownValues - no data found`);
          return;
        }
        const record = this.summary['averageTimelineTopDown'];
        for (const traceName in record) {
          console.log(`${this.getIndent()}Trace "${traceName}" topDown symbols average over ${results.length} runs:`);
          for (const key in record[traceName]) {
            const msg = `${this.getIndent()}   ${key} ${Number(record[traceName][key].selfTime.mean).toFixed(0)} ms (self), `
                      + `${Number(record[traceName][key].totalTime.mean).toFixed(0)} ms (total)`;
            console.log(msg);
          }
        }
      });
      return this;
    }
    public showAverageSummaries(): this {
      this.postAll((results: ICaseResultTimelineData[]) => {
        if (!this.summary['averageTimelineSummaries']) {
          console.error(`ERROR: showAverageSummaries - no data found`);
          return;
        }
        const record = this.summary['averageTimelineSummaries'];
        for (const traceName in record) {
          console.log(`${this.getIndent()}Trace "${traceName}" summary average over ${results.length} runs:`);
          let s = this.getIndent();
          const entries = [];
          for (const key in record[traceName]) {
            entries.push(`${key}: ${Number(record[traceName][key].mean).toFixed(0)}`);
          }
          console.log(this.getIndent() + entries.join(' '));
        }
      });
      return this;
    }
  };
}
