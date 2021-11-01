import { IPerfCase, ICaseResult } from './interfaces';
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
