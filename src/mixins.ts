import { IPerfCase, ICaseResult } from './interfaces';

/**
 * Predefined mixins for PerfCase
 */

 // ctor base
export type PerfCaseConstructor<T = IPerfCase> = new (...args: any[]) => T;

/**
 * Runtime mixin.
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
 * Throughput mixin.
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
