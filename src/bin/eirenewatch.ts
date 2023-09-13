#!/usr/bin/env node

/* eslint-disable node/shebang */
/* eslint-disable require-atomic-updates */

import { Logger } from '../Logger';
import { type EirenewatchConfigurationInput } from '../mod/types';
import { type TurbowatchController } from '../types';
import { glob } from 'glob';
import jiti from 'jiti';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { hideBin } from 'yargs/helpers';
import yargs from 'yargs/yargs';

const log = Logger.child({
  namespace: 'eirenewatch',
});


// eslint-disable-next-line node/no-process-env
if (process.env.ROARR_LOG !== 'true') {
  // eslint-disable-next-line no-console
  console.warn(
    '[eirenewatch] running eirenewatch without logging enabled; set ROARR_LOG=true to enable logging. Install @roarr/cli to pretty-print logs.'
  );
}

const findEirenewatchScript = (inputPath: string): string | null => {
  let resolvedPath: string | null = null;

  const providedPath = path.resolve(process.cwd(), inputPath);

  const possiblePaths = [providedPath];

  if (path.extname(providedPath) === '') {
    possiblePaths.push(providedPath + '.ts', providedPath + '.js');
  }

  for (const possiblePath of possiblePaths) {
    if (existsSync(possiblePath)) {
      resolvedPath = possiblePath;
    }
  }

  return resolvedPath;
};

const main = async <Config, Data>() => {
  const abortController = new AbortController();

  let terminating = false;

  process.once('SIGINT', () => {
    if (terminating) {
      log.warn('already terminating; ignoring SIGINT');

      return;
    }

    terminating = true;

    log.warn('received SIGINT; gracefully terminating');

    abortController.abort();
  });

  process.once('SIGTERM', () => {
    if (terminating) {
      log.warn('already terminating; ignoring SIGTERM');

      return;
    }

    terminating = true;

    log.warn('received SIGTERM; gracefully terminating');

    abortController.abort();
  });

  const {
    watch,
  }: {
    watch: (
      configurationInput: EirenewatchConfigurationInput<Config, Data>
    ) => Promise<TurbowatchController>;
  } = jiti(__filename)('../mod/watch');

  const argv = await yargs(hideBin(process.argv))
    .command(
      '$0 [patterns...]',
      'Start eirenewatch',
      (commandYargs) => {
        commandYargs.positional('patterns', {
          array: true,
          default: ['eirenewatch.ts'],
          describe:
            'Script with eirenewatch instructions. Can provide multiple. It can also be a glob pattern, e.g. **/eirenewatch.ts',
          type: 'string',
        });
      }
    )
    .parse();

  const patterns = argv.patterns as readonly string[];

  const scriptPaths: string[] = [];

  for (const pattern of patterns) {
    if (pattern.includes('*')) {
      scriptPaths.push(...(await glob(pattern)));
    } else {
      scriptPaths.push(pattern);
    }
  }

  const resolvedScriptPaths: string[] = [];

  for (const scriptPath of scriptPaths) {
    const resolvedPath = findEirenewatchScript(scriptPath);

    if (!resolvedPath) {
      log.error('%s not found', scriptPath);

      process.exitCode = 1;

      return;
    }

    resolvedScriptPaths.push(resolvedPath);
  }

  for (const resolvedPath of resolvedScriptPaths) {
    const eirenewatchConfiguration = jiti(__filename)(resolvedPath)
      .default as EirenewatchConfigurationInput<Config, Data>;

    if (typeof eirenewatchConfiguration?.Watcher !== 'function') {
      log.error(
        'Expected user script to export an instance of eirenewatchController'
      );

      process.exitCode = 1;

      return;
    }

    await watch({
      abortController,
      cwd: path.dirname(resolvedPath),
      ...eirenewatchConfiguration,
    });
  }
};

void main();
