import { TurboWatcher } from '../backends/TurboWatcher';
import { type EirenewatchConfigurationInput } from './types';

export const defineConfigWatcher = <T>(
  configurationInput: EirenewatchConfigurationInput<T>
): EirenewatchConfigurationInput<T> => {
  return {
    Watcher: TurboWatcher,
    ...configurationInput,
  };
};
