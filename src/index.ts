export { ChokidarWatcher } from './backends/ChokidarWatcher';
export { FileWatchingBackend } from './backends/FileWatchingBackend';
export { FSWatcher } from './backends/FSWatcher';
export { TurboWatcher } from './backends/TurboWatcher';
export { type ProcessPromise } from 'zx';

export * from './mod/types';
export { defineConfigWatcher } from './mod/defineConfigWatcher';
export { watch } from './mod/watch';
