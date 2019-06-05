import { perfContext, PerfCase } from '..';
import { ICaseResult } from '../interfaces';
import { PerfCaseConstructor } from '../mixins';

interface IGreetResult extends ICaseResult {
  greet: boolean;
}
function GreeterMixin<TBase extends PerfCaseConstructor>(Base: TBase) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...args);
      // place necessary processing in ctor
      // here: mutate ICaseResults to contain greet depending on returnValue
      this.postEach((result: ICaseResult): void => {
        (result as IGreetResult).greet = (result.returnValue === 'grumpy') ? false : true;
      });
    }
    // optional processing for every single result
    // that can be called later on the perf case
    public greet(): this {
      return this.postEach((result: IGreetResult): void | null => {
        if (result.greet) {
          console.log(`${this.getIndent()}Hi there from "${this.name}"!`);
          return;
        }
        // do something with the grumpy result
        // explicit returning null will remove the record
        return null;
      });
    }
    // optional processing for all results
    // here: print some log and collect data in summary
    public greetingSummary(): this {
      return this.postAll((results: IGreetResult[]): void => {
        if (!this.options || !this.options.repeat) {
          return;
        }
        const grumpyRuns = this.options.repeat - results.length;
        console.log(`${this.getIndent()}${results.length} greetings received. (${grumpyRuns} being grumpy)`);
        this.summary['greetingsRatio'] = results.length / this.options.repeat;
      });
    }
  };
}

// construct the perfcase ctor and type
const GreeterPerfCase = GreeterMixin(PerfCase);
type GreeterPerfCaseType = InstanceType<typeof GreeterPerfCase>;

// use it
perfContext('ctx', (): void => {
  new GreeterPerfCase('custom', (): string => {
    const moods = ['grumpy', 'cheerful', 'hungry', 'excited'];
    return moods[Math.floor(Math.random() * 4)];
  }, {fork: false, repeat: 5})
    .greet()
    .greetingSummary();
});
