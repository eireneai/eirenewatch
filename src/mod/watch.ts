import { TurboWatcher } from '../backends/TurboWatcher';
import { generateShortId } from '../generateShortId';
import { Logger } from '../Logger';
import type { JsonObject, TurbowatchController } from '../types';
import { type EirenewatchConfigurationInput } from './types';
import { serializeError } from 'serialize-error';
import { debounce } from 'throttle-debounce';
import * as fs from 'fs';

import { ManagerPool } from './manager-pool';

const log = Logger.child({
  namespace: 'watch',
});

export const watch = <Config, Data>(
  input: EirenewatchConfigurationInput<Config, Data>
): Promise<TurbowatchController> => {
  const {
    abortController,
    cwd,
    task,
    debounce: userDebounce,
    parseConfig,
    parseProcessData,
    configPath,
    onAfterEmit = () => Promise.resolve(undefined),
    Watcher,
  }: EirenewatchConfigurationInput<Config, Data> = {
    abortController: new AbortController(),
    // as far as I can tell, this is a bug in unicorn/no-unused-properties
    // https://github.com/sindresorhus/eslint-plugin-unicorn/issues/2051
    // eslint-disable-next-line unicorn/no-unused-properties
    debounce: {
      wait: 1_000,
    },

    // eslint-disable-next-line unicorn/no-unused-properties
    Watcher: TurboWatcher,
    ...input,
  };

  const abortSignal = abortController.signal;

  const initialRun = task.initialRun ?? true;
  const persistent = task.persistent ?? false;

  if (persistent && !initialRun) {
    throw new Error(
      'Persistent triggers must have initialRun set to true.'
    );
  }

  const managerPool = ManagerPool<Config, Data>({
    abortSignal,
    cwd,
    id: generateShortId(),
    initialRun,
    interruptible: task.interruptible ?? true,
    name: task.name,
    launch: task.launch,
    teardown: task.teardown,
    persistent,
    retry: {
      retries: 3,
      ...task.retry,
    },
    throttleOutput: task.throttleOutput ?? { delay: 1_000 },
  });

  const watcher = new Watcher(configPath);

  let terminating = false;

  const shutdown = async () => {
    if (terminating) {
      return;
    }

    terminating = true;

    await watcher.close();

    abortController.abort();

    await managerPool.teardown();
  };

  if (abortSignal) {
    abortSignal.addEventListener(
      'abort',
      () => {
        shutdown();
      },
      {
        once: true,
      }
    );
  }

  let ready = false;

  watcher.on(
    'change',
    debounce(userDebounce.wait, async () => {
      if (!ready) {
        log.warn('ignoring change event before ready');

        return;
      }
      try {
        const rawConfig = fs.readFileSync(configPath, 'utf-8');
        const config = parseConfig(rawConfig);
        const data = parseProcessData(config);
        void managerPool.trigger([config, data]);
        onAfterEmit(config, data);
      } catch (err) {
        log.error(
          {
            error: serializeError(err) as unknown as JsonObject,
          },
          'could not read config file'
        );
      }
    })
  );

  return new Promise((resolve, reject) => {
    watcher.on('error', (error) => {
      log.error(
        {
          error: serializeError(error) as unknown as JsonObject,
        },
        `could not watch ${configPath}`
      );

      if (ready) {
        shutdown();
      } else {
        reject(error);
      }
    });

    watcher.on('ready', async () => {
      ready = true;

      if (!terminating) {
        log.info('triggering initial runs');

        try {
          const rawConfig = fs.readFileSync(configPath, 'utf-8');
          const config = parseConfig(rawConfig);
          const data = parseProcessData(config);
          void managerPool.trigger([config, data]);
          onAfterEmit(config, data);
        } catch (err) {
          log.error(
            {
              error: serializeError(err) as unknown as JsonObject,
            },
            'could not read config file'
          );
        }

        log.info('ready for file changes');
      }

      resolve({
        shutdown,
      });
    });
  });
};
