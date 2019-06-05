// perf case options
export interface IPerfOptions {
  [key: string]: any;
  fork?: boolean;
  forkArgs?: string[];
  forkOptions?: any;
  timeout?: number;
  repeat?: number;
  reportFullResults?: boolean;
}

export interface ICmdlineOverrides {
  repeat?: number;
  timeout?: number;
  reportFullResults?: boolean;
}

export interface IStackToken {
  type: PerfType;
  options?: IPerfOptions;
  name: string;
  callback(...args: any[]): void;
}

export interface IPerfCase extends IStackToken {
  summary: { [key: string]: any };
  path: string[] | null;
  postEach(callback: (result: ICaseResult) => ICaseResult | void | null, perfCase?: this): this;
  postAll(callback: (results: ICaseResult[]) => ICaseResult[] | void, perfCase?: this): this;
  run(parentPath: string[], forked: boolean): Promise<void>;
  getIndent(): string;
}

// raw results for a single run of a perf case
export interface ICaseResult {
  name: string;
  path: string[];
  runtime: number[];
  returnValue: any;
  run: number;
  repeat: number;
  error?: any;
}

// context and perf case tree
export interface IPerfTree {
  name: string;
  type: string;
  path: string;
  children?: IPerfTree[];
}

// stack token type
export enum PerfType {
  Context,
  PerfCase,
  before,
  beforeEach,
  after,
  afterEach
}

export enum EvalResultState {
  Success,
  Missing,
  Skipped,
  Failed
}

// baseline data for a single endpoint (defaults to descriptive stats values)
export interface IBaselineEntry {
  stat: string;
  base: number;
  tolerance?: null | number[];
  value?: number;
  eval?: EvalResultState;
  change?: number;
}

// baseline data for a single perf case
export interface IBaselineData {
  [treePath: string]: {[dataPath: string]: IBaselineEntry[]};
}

export interface IEvalStatsSummary {
  success: number;
  missing: number;
  skipped: number;
  failed: number;
}

// report for baseline data
export interface IBaselineReport {
  type: ReportType.Base;
  data: IBaselineData;
}

// report for an eval run
export interface IEvalStats {
  type: ReportType.Eval;
  data: IBaselineData;
  summary: IEvalStatsSummary;
}

export interface IEvalConfig {
  tolerance: {[key: string]: number[]};
  skip: string[];
}

export const enum ReportType {
  PerfCase = 0,
  Base = 1,
  Eval = 2,
  Error = 3
}

// report for a single perf case
export interface IPerfResult {
  type: ReportType.PerfCase;
  name: string;
  path: string[];
  pathString: string;
  options: IPerfOptions;
  summary: {[key: string]: any};
  results?: ICaseResult[];
}
