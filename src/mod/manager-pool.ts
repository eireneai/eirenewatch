import { createSpawn } from '../createSpawn';
import { generateShortId } from '../generateShortId';
import { Logger } from '../Logger';
import { type ActiveTask } from '../types';
import { setTimeout } from 'node:timers/promises';
import { serializeError } from 'serialize-error';
import { TaskTemplate, ManagerPool, TaskManager } from './types';

const log = Logger.child({
  namespace: 'subscribe',
});

/**
 * Creates a trigger evaluation specific abort controller that inherits the abort signal from the trigger.
 * This abort controller is used to abort the the task that is currently running either because the trigger
 * has been interrupted or because the trigger has been triggered again.
 */
const createAbortController = (process: TaskTemplate<any, any>) => {
  const abortController = new AbortController();

  process.abortSignal.addEventListener('abort', () => {
    abortController.abort();
  });

  return abortController;
};

const runTask = async <Config, Data>({
  entryId,
  config,
  data,
  template,
  taskId,
  abortController,
  firstEvent,
}: {
  entryId: string;
  config: Config;
  data: Data;
  template: TaskTemplate<Config, Data>;
  abortController: AbortController;
  firstEvent: boolean;
  taskId: string;
}) => {
  if (template.initialRun && firstEvent) {
    log.debug('%s (%s): initial run...', template.name, taskId);
  }

  let failedAttempts = -1;

  while (true) {
    if (abortController.signal.aborted) {
      log.warn('%s (%s): task aborted', template.name, taskId);

      return;
    }

    failedAttempts++;

    if (failedAttempts > 0) {
      const retryFactor = template.retry.factor ?? 2;
      const minTimeout = template.retry.minTimeout ?? 1_000;
      const maxTimeout = template.retry.maxTimeout ?? 30_000;
      const delay = Math.min(
        failedAttempts * retryFactor * minTimeout,
        template.retry.maxTimeout ?? maxTimeout
      );

      log.debug('delaying retry by %dms...', delay);

      await setTimeout(delay);
    }

    try {
      await template.launch({
        entryId,
        abortSignal: abortController?.signal,
        attempt: failedAttempts,
        config,
        first: firstEvent,
        log,
        spawn: createSpawn(taskId, {
          abortSignal: abortController?.signal,
          cwd: template.cwd,
          throttleOutput: template.throttleOutput,
        }),
        taskId,
        data,
      });

      failedAttempts = 0;

      if (template.persistent) {
        log.debug(
          '%s (%s): re-running because the trigger is persistent',
          template.name,
          taskId
        );

        continue;
      }

      return;
    } catch (error) {
      if (error.name === 'AbortError') {
        log.warn('%s (%s): task aborted', template.name, taskId);

        return;
      }

      log.warn(
        {
          error: serializeError(error),
        },
        '%s (%s): routine produced an error',
        template.name,
        taskId
      );

      if (template.persistent) {
        log.warn(
          '%s (%s): retrying because the trigger is persistent',
          template.name,
          taskId
        );

        continue;
      }

      const retriesLeft = template.retry.retries - failedAttempts;

      if (retriesLeft < 0) {
        throw new Error(
          'Expected retries left to be greater than or equal to 0'
        );
      }

      if (retriesLeft === 0) {
        log.warn(
          '%s (%s): task will not be retried; attempts exhausted',
          template.name,
          taskId
        );

        throw error;
      }

      if (retriesLeft > 0) {
        log.warn(
          '%s (%s): retrying task %d/%d...',
          template.name,
          taskId,
          template.retry.retries - retriesLeft,
          template.retry.retries
        );

        continue;
      }

      throw new Error(
        'Expected retries left to be greater than or equal to 0'
      );
    }
  }

  throw new Error(
    'Expected while loop to be terminated by a return statement'
  );
};

export function TaskManager<Config, Data>(
  template: TaskTemplate<Config, Data>,
  entryId: string
): TaskManager<Config, Data> {
  /**
   * Indicates that the teardown process has been initiated.
   * This is used to prevent the trigger from being triggered again while the teardown process is running.
   */
  let outerTeardownInitiated = false;

  /**
   * Stores the currently active task.
   */
  let outerActiveTask: ActiveTask | null = null;

  /**
   * Identifies the first event in a series of events.
   */
  let outerFirstEvent = true;

  const updateConfig = async (config: Config, data: Data) => {
    let firstEvent = outerFirstEvent;

    if (outerFirstEvent) {
      firstEvent = true;
      outerFirstEvent = false;
    }

    if (outerActiveTask) {
      if (template.interruptible) {
        log.debug(
          '%s (%s): aborting task',
          template.name,
          outerActiveTask.id
        );

        if (!outerActiveTask.abortController) {
          throw new Error('Expected abort controller to be set');
        }

        outerActiveTask.abortController.abort();

        log.debug(
          '%s (%s): waiting for task to abort',
          template.name,
          outerActiveTask.id
        );

        if (outerActiveTask.queued) {
          return undefined;
        }

        outerActiveTask.queued = true;

        try {
          // Do not start a new task until the previous task has been
          // aborted and the shutdown routine has run to completion.
          await outerActiveTask.promise;
        } catch {
          // nothing to do
        }
      } else {
        if (template.persistent) {
          log.warn(
            '%s (%s): ignoring event because the trigger is persistent',
            template.name,
            outerActiveTask.id
          );

          return undefined;
        }

        log.warn(
          '%s (%s): waiting for task to complete',
          template.name,
          outerActiveTask.id
        );

        if (outerActiveTask.queued) {
          return undefined;
        }

        outerActiveTask.queued = true;

        try {
          await outerActiveTask.promise;
        } catch {
          // nothing to do
        }
      }
    }

    if (outerTeardownInitiated) {
      log.warn('teardown already initiated');

      return undefined;
    }

    const taskId = generateShortId();

    const abortController = createAbortController(template);

    const taskPromise = runTask({
      entryId,
      abortController,
      config,
      firstEvent,
      taskId,
      template,
      data,
    }) // eslint-disable-next-line promise/prefer-await-to-then
      .finally(() => {
        if (taskId === outerActiveTask?.id) {
          log.debug('%s (%s): completed task', template.name, taskId);

          outerActiveTask = null;
        }
      })
      // eslint-disable-next-line promise/prefer-await-to-then
      .catch((error) => {
        log.warn(
          {
            error: serializeError(error),
          },
          '%s (%s): task failed',
          template.name,
          taskId
        );
      });

    log.debug('%s (%s): started task', template.name, taskId);

    // eslint-disable-next-line require-atomic-updates
    outerActiveTask = {
      abortController,
      id: taskId,
      promise: taskPromise,
      queued: false,
    };

    return taskPromise;
  };

  return {
    activeTask: outerActiveTask,
    initialRun: template.initialRun,
    persistent: template.persistent,
    updateConfig,
    teardown: async () => {
      if (outerTeardownInitiated) {
        log.warn('teardown already initiated');

        return;
      }

      outerTeardownInitiated = true;

      if (outerActiveTask?.abortController) {
        await outerActiveTask.abortController.abort();
      }

      if (template.teardown) {
        const taskId = generateShortId();

        try {
          await template.teardown({
            spawn: createSpawn(taskId, {
              throttleOutput: template.throttleOutput,
            }),
          });
        } catch (error) {
          log.error(
            {
              error,
            },
            'teardown produced an error'
          );
        }
      }
    },
  };
}

export function ManagerPool<Config, Data>(
  template: TaskTemplate<Config, Data>
): ManagerPool<[Config, Data[]]> {
  const managers: Map<number, TaskManager<Config, Data>> = new Map();
  const teardown = async () => {
    for (const manager of managers.values()) {
      if (manager.activeTask?.promise) {
        await manager.activeTask?.promise;
      }
      await manager.teardown();
    }
  };
  const trigger = async ([config, data]) => {
    try {
      const maxLength = Math.max(data.length, managers.size);
      for (let i = 0; i < maxLength; i++) {
        const manager = managers.get(i);
        if (data[i] === undefined) {
          if (manager) {
            await manager.teardown();
            managers.delete(i);
          }
        } else {
          if (manager) {
            await manager.updateConfig(config, data[i]);
          } else {
            const manager = TaskManager(template, String(i));
            managers.set(i, manager);
            await manager.updateConfig(config, data[i]);
          }
        }
      }
    } catch (error) {
      log.error(
        {
          error,
        },
        'trigger produced an error'
      );
    }
  };

  return {
    teardown,
    trigger,
  };
}
