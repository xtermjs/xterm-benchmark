export interface IPerfOptions {
  fork?: boolean;
  forkArgs?: string[];
  forkOptions?: any;
  timeout?: number;
  repeat?: number;
}

export interface ICmdlineOverrides {
  repeat?: number;
  timeout?: number;
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
  postEach(callback: (result: ICaseResult) => ICaseResult | void): this;
  postAll(callback: (results: ICaseResult[]) => ICaseResult[] | void): this;
  run(parentPath: string[], forked: boolean): Promise<void>;
  getIndent(): string;
}

export interface ICaseResult {
  name: string;
  path: string[];
  runtime: number[] | undefined;
  returnValue: any;
  run: number;
  repeat: number;
  error?: any;
}

export interface IPerfTree {
  name: string;
  type: string;
  path: string;
  children?: IPerfTree[];
}

export enum PerfType {
  Context,
  PerfCase,
  before,
  beforeEach,
  after,
  afterEach
}
