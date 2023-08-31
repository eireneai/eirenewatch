import { createSpawn } from '../createSpawn';
import { generateShortId } from '../generateShortId';
import { Logger } from '../Logger';
import {
  Expression,
  type ActiveTask,
  type FileChangeEvent,
  type Trigger,
} from '../types';
import { setTimeout } from 'node:timers/promises';
import { serializeError } from 'serialize-error';
import { ProcessTemplate, Subscription } from './types';

export function makeSubscribe<T>() {
  const log = Logger.child({
    namespace: 'subscribe',
  });

  /**
   * Creates a trigger evaluation specific abort controller that inherits the abort signal from the trigger.
   * This abort controller is used to abort the the task that is currently running either because the trigger
   * has been interrupted or because the trigger has been triggered again.
   */
  const createAbortController = (process: ProcessTemplate<T>) => {
    const abortController = new AbortController();

    process.abortSignal.addEventListener('abort', () => {
      abortController.abort();
    });

    return abortController;
  };

  const runTask = async ({
    data,
    template,
    taskId,
    abortController,
    firstEvent,
  }: {
    data: T;
    template: ProcessTemplate<T>;
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
        await template.onChange({
          abortSignal: abortController?.signal,
          attempt: failedAttempts,
          data,
          first: firstEvent,
          log,
          spawn: createSpawn(taskId, {
            abortSignal: abortController?.signal,
            cwd: template.cwd,
            throttleOutput: template.throttleOutput,
          }),
          taskId,
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

  return (
    template: ProcessTemplate<T>
  ): Subscription<T> => {
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

    /**
     * Stores the files that have changed since the last evaluation of the trigger
     */
    let outerChangedFiles: string[] = [];

    const handleSubscriptionEvent = async (data: T) => {
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
        abortController,
        data,
        firstEvent,
        taskId,
        template,
      }) // eslint-disable-next-line promise/prefer-await-to-then
        .finally(() => {
          if (taskId === outerActiveTask?.id) {
            log.debug(
              '%s (%s): completed task',
              template.name,
              taskId
            );

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
      teardown: async () => {
        if (outerTeardownInitiated) {
          log.warn('teardown already initiated');

          return;
        }

        outerTeardownInitiated = true;

        if (outerActiveTask?.abortController) {
          await outerActiveTask.abortController.abort();
        }

        if (template.onTeardown) {
          const taskId = generateShortId();

          try {
            await template.onTeardown({
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
      trigger: async (data: T) => {
        try {
          await handleSubscriptionEvent(data);
        } catch (error) {
          log.error(
            {
              error,
            },
            'trigger produced an error'
          );
        }
      },
    };
  };
}
