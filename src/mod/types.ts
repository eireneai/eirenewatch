import {
  type ActiveTask,
  type Debounce,
  type Expression,
  type FileChangeEvent,
  type TeardownEvent,
  type Throttle,
  type WatcherConstructable,
} from '../types';
import { type Logger } from 'roarr';
import { type ProcessOutput } from 'zx';

export type ChangeEvent<T> = {
  abortSignal?: AbortSignal;
  attempt: number;
  data: T;
  first: boolean;
  log: Logger;
  spawn: (
    pieces: TemplateStringsArray,
    ...args: any[]
  ) => Promise<ProcessOutput>;
  taskId: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OnChangeEventHandler<T> = (event: ChangeEvent<T>) => Promise<any>;

type OnTeardownEventHandler = (event: TeardownEvent) => Promise<void>;

type Retry = {
  factor?: number;
  maxTimeout?: number;
  minTimeout?: number;
  retries: number;
};

export type ProcessTemplateInput<T> = {
  initialRun?: boolean;
  interruptible?: boolean;
  name: string;
  onChange: OnChangeEventHandler<T>;
  onTeardown?: OnTeardownEventHandler;
  persistent?: boolean;
  retry?: Retry;
  throttleOutput?: Throttle;
};

export type ProcessTemplate<T> = {
  abortSignal: AbortSignal;
  cwd?: string;
  id: string;
  initialRun: boolean;
  interruptible: boolean;
  name: string;
  onChange: OnChangeEventHandler<T>;
  onTeardown?: OnTeardownEventHandler;
  persistent: boolean;
  retry: Retry;
  throttleOutput: Throttle;
};

export type Subscription<T> = {
  activeTask: ActiveTask | null;
  initialRun: boolean;
  persistent: boolean;
  teardown: () => Promise<void>;
  trigger: (event: T) => Promise<void>;
};

export type EirenewatchConfigurationInput<T> = {
  readonly Watcher?: WatcherConstructable;
  readonly abortController?: AbortController;
  readonly configPath: string;
  readonly parseConfig: (data: string) => T;
  readonly cwd?: string;
  readonly debounce?: Debounce;
  readonly expression: Expression;
  readonly processes: readonly ProcessTemplateInput<T>[];
  readonly project: string;
};
