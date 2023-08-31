import { TurboWatcher } from '../backends/TurboWatcher';
import { createFileChangeQueue } from '../createFileChangeQueue';
import { generateShortId } from '../generateShortId';
import { Logger } from '../Logger';
import type { JsonObject, TurbowatchController } from '../types';
import {
  type Subscription,
  type EirenewatchConfigurationInput,
} from './types';
import { serializeError } from 'serialize-error';
import { debounce } from 'throttle-debounce';
import * as fs from 'fs';

import { makeSubscribe } from './subscribe';

const log = Logger.child({
  namespace: 'watch',
});

export const watch = <T>(
  input: EirenewatchConfigurationInput<T>
): Promise<TurbowatchController> => {
  const {
    abortController,
    cwd,
    project,
    processes,
    debounce: userDebounce,
    parseConfig,
    configPath,
    Watcher,
  }: EirenewatchConfigurationInput<T> = {
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

  const subscriptions: Subscription<T>[] = [];
  const subscribe = makeSubscribe<T>();

  const watcher = new Watcher(configPath);

  let terminating = false;

  const shutdown = async () => {
    if (terminating) {
      return;
    }

    terminating = true;

    await watcher.close();

    abortController.abort();

    for (const subscription of subscriptions) {
      const { activeTask } = subscription;

      if (activeTask?.promise) {
        await activeTask?.promise;
      }
    }

    for (const subscription of subscriptions) {
      const { teardown } = subscription;

      if (teardown) {
        await teardown();
      }
    }
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

  for (const trigger of processes) {
    const initialRun = trigger.initialRun ?? true;
    const persistent = trigger.persistent ?? false;

    if (persistent && !initialRun) {
      throw new Error(
        'Persistent triggers must have initialRun set to true.'
      );
    }

    subscriptions.push(
      subscribe({
        abortSignal,
        cwd,
        id: generateShortId(),
        initialRun,
        interruptible: trigger.interruptible ?? true,
        name: trigger.name,
        onChange: trigger.onChange,
        onTeardown: trigger.onTeardown,
        persistent,
        retry: {
          retries: 3,
          ...trigger.retry,
        },
        throttleOutput: trigger.throttleOutput ?? { delay: 1_000 },
      })
    );
  }

  let ready = false;

  watcher.on(
    'change',
    debounce(userDebounce.wait, () => {
      if (!ready) {
        log.warn('ignoring change event before ready');

        return;
      }
      try {
        const rawConfig = fs.readFileSync(configPath, 'utf-8');
        const config = parseConfig(rawConfig);
        for (const subscription of subscriptions) {
          void subscription.trigger(config);
        }
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

    watcher.on('ready', () => {
      ready = true;

      if (!terminating) {
        log.info('triggering initial runs');

        try {
          const rawConfig = fs.readFileSync(configPath, 'utf-8');
          const config = parseConfig(rawConfig);
          for (const subscription of subscriptions) {
            if (subscription.initialRun) {
              void subscription.trigger(config);
            }
          }
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
