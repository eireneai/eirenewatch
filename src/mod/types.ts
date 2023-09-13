import {
  type ActiveTask,
  type Debounce,
  type TeardownEvent,
  type Throttle,
  type WatcherConstructable,
} from '../types';
import { type Logger } from 'roarr';
import { type ProcessOutput } from 'zx';

export interface SpawnType {
  (
    pieces: TemplateStringsArray,
    ...args: any[]
  ): Promise<ProcessOutput>;
}

export type TaskContext<Config, Data> = {
  abortSignal?: AbortSignal;
  attempt: number;
  config: Config;
  data: Data;
  first: boolean;
  log: Logger;
  spawn: SpawnType;
  taskId: string;
};

export interface TaskLauncher<Config, Data> {
  (context: TaskContext<Config, Data>): Promise<unknown>;
}

export interface TeardownHandler {
  (context: TeardownEvent): Promise<void>;
}

export type Retry = {
  factor?: number;
  maxTimeout?: number;
  minTimeout?: number;
  retries: number;
};

export type TaskTemplateInput<Config, Data> = {
  initialRun?: boolean;
  interruptible?: boolean;
  name: string;
  launch: TaskLauncher<Config, Data>;
  teardown?: TeardownHandler;
  persistent?: boolean;
  retry?: Retry;
  throttleOutput?: Throttle;
};

export type TaskTemplate<Config, Data> = {
  abortSignal: AbortSignal;
  cwd?: string;
  id: string;
  initialRun: boolean;
  interruptible: boolean;
  name: string;
  launch: TaskLauncher<Config, Data>;
  teardown?: TeardownHandler;
  persistent: boolean;
  retry: Retry;
  throttleOutput: Throttle;
};

export type TaskManager<Config, Data> = {
  activeTask: ActiveTask | null;
  initialRun: boolean;
  persistent: boolean;
  teardown: () => Promise<void>;
  updateConfig: (config: Config, data: Data) => Promise<void>;
};

export type ManagerPool<T> = {
  teardown: () => Promise<void>;
  trigger: (event: T) => Promise<void>;
};

export type EirenewatchConfigurationInput<Config, Data> = {
  readonly Watcher?: WatcherConstructable;
  readonly abortController?: AbortController;
  readonly configPath: string;
  readonly parseConfig: (raw: string) => Config;
  readonly parseProcessData: (config: Config) => Data[];
  readonly onAfterEmit?: (
    config: Config,
    data: Data[]
  ) => void;
  readonly cwd?: string;
  readonly debounce?: Debounce;
  readonly task: TaskTemplateInput<Config, Data>;
};
