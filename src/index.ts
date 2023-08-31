export { ChokidarWatcher } from './backends/ChokidarWatcher';
export { FileWatchingBackend } from './backends/FileWatchingBackend';
export { FSWatcher } from './backends/FSWatcher';
export { TurboWatcher } from './backends/TurboWatcher';
export { type ChangeEvent, type Expression, type TriggerInput } from './types';
export { type ProcessPromise } from 'zx';

export { defineConfigWatcher } from './mod/defineConfigWatcher';
export { watch } from './mod/watch';
