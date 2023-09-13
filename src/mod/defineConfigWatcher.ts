import { TurboWatcher } from '../backends/TurboWatcher';
import { type EirenewatchConfigurationInput } from './types';

export const defineConfigWatcher = <Config, Data>(
  configurationInput: EirenewatchConfigurationInput<Config, Data>
): EirenewatchConfigurationInput<Config, Data> => {
  return {
    Watcher: TurboWatcher,
    ...configurationInput,
  };
};
