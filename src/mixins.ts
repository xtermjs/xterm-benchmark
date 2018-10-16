import { IPerfCase, ICaseResult } from './interfaces';
import { IEvent, ISummary } from 'chrome-timeline/lib/interfaces';

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
        let average = 0;
        for (let i = 0; i < results.length; ++i) {
          average += (results[i].runtime[1] / 1000000 + results[i].runtime[0] * 1000);
        }
        this.summary['averageRuntime'] = average / results.length;
      });
    }
    public showRuntime(): this {
      this.postEach((result: ICaseResult): ICaseResult => {
        console.log(`${this.getIndent()}Case "${this.name}" : ${result.run} - runtime: ${Number(result.runtime[1] / 1000000 + result.runtime[0] * 1000).toFixed(2)} ms`);
        return result;
      });
      return this;
    }
    public showAverageRuntime(): this {
      this.postAll((results: ICaseResult[]): void => {
        console.log(`${this.getIndent()}Case "${this.name}" : ${results.length} runs - average runtime: ${Number(this.summary['averageRuntime']).toFixed(2)} ms`);
      });
      return this;
    }
  };
}

interface ICaseResultThroughput extends ICaseResult {
  throughput: number;
}

// throughput - aggregates throughtput and averageThroughput in MB/s
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
        let average = 0;
        for (let i = 0; i < results.length; ++i) {
          average += results[i].throughput;
        }
        this.summary['averageThroughput'] = average / results.length;
      });
    }
    public showThroughput(): this {
      this.postEach((result: ICaseResultThroughput): void => {
        console.log(`${this.getIndent()}Case "${this.name}" : ${result.run} - throughput: ${Number(result.throughput).toFixed(2)} MB/s`);
      });
      return this;
    }
    public showAverageThroughput(): this {
      this.postAll((results: ICaseResultThroughput[]): void => {
        console.log(`${this.getIndent()}Case "${this.name}" : ${results.length} runs - average throughput: ${Number(this.summary['averageThroughput'] / results.length).toFixed(2)} MB/s`);
      });
      return this;
    }
  };
}

// extract runtime data from chrome-timeline trace summary
type IExtractData = {[symbol: string]: IEvent};
interface ICaseResultTimelineData extends ICaseResult {
  extractedTopDownValues?: {[traceName: string]: IExtractData};
  extractedSummaries?: {[traceName: string]: {[key: string]: number}};
}
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
        const final: {[traceName: string]: any} = {};
        const counter: {[traceName: string]: any} = {};
        for (let i = 0; i < results.length; ++i) {
          for (const traceName in results[i].extractedTopDownValues) {
            if (!final[traceName]) {
              final[traceName] = {};
              counter[traceName] = {};
            }
            for (const symbol in results[i].extractedTopDownValues[traceName]) {
              if (!final[traceName][symbol]) {
                final[traceName][symbol] = {selfTime: 0, totalTime: 0, name: results[i].extractedTopDownValues[traceName][symbol].name};
                counter[traceName][symbol] = 0;
              }
              final[traceName][symbol].selfTime += results[i].extractedTopDownValues[traceName][symbol].selfTime;
              final[traceName][symbol].totalTime += results[i].extractedTopDownValues[traceName][symbol].totalTime;
              counter[traceName][symbol]++;
            }
          }
        }
        for (const traceName in final) {
          for (const symbol in final[traceName]) {
            final[traceName][symbol].selfTime /= counter[traceName][symbol];
            final[traceName][symbol].totalTime /= counter[traceName][symbol];
          }
        }
        this.summary['averageTimelineTopDown'] = final;
      });
      return this;
    }
    public averageSummaries(): this {
      this.postAll((results: ICaseResultTimelineData[]) => {
        const final: {[traceName: string]: any} = {};
        const counter: {[traceName: string]: any} = {};
        for (let i = 0; i < results.length; ++i) {
          for (const traceName in results[i].extractedSummaries) {
            if (!final[traceName]) {
              final[traceName] = {};
              counter[traceName] = {};
            }
            for (const key in results[i].extractedSummaries[traceName]) {
              if (!final[traceName][key]) {
                final[traceName][key] = 0;
                counter[traceName][key] = 0;
              }
              final[traceName][key] += results[i].extractedSummaries[traceName][key];
              counter[traceName][key]++;
            }
          }
        }
        for (const traceName in final) {
          for (const key in final[traceName]) {
            final[traceName][key] /= counter[traceName][key];
          }
        }
        this.summary['averageTimelineSummaries'] = final;
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
          console.log(`${this.getIndent()}Trace "${traceName}" topDown average for symbols over ${results.length} runs:`);
          for (const key in record[traceName]) {
            console.log(`${this.getIndent()}   ${key} ${Number(record[traceName][key].selfTime).toFixed(0)} ms (self), ${Number(record[traceName][key].totalTime).toFixed(0)} ms (total)`);
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
          console.log(`${this.getIndent()}Trace "${traceName}" average over ${results.length} runs:`);
          let s = this.getIndent();
          const entries = [];
          for (const key in record[traceName]) {
            entries.push(`${key}: ${Number(record[traceName][key]).toFixed(0)}`);
          }
          console.log(this.getIndent() + entries.join(' '));
        }
      });
      return this;
    }
  };
}
