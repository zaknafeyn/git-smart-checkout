import { defineConfig } from '@vscode/test-cli';

const root = process.cwd();
const e2eFiles = 'out/test/e2e/**/*.test.js';
const unitFiles = 'out/test/unit/**/*.test.js';
const baseLaunchArgs = [
  '--disable-workspace-trust',
  '--new-window',
  '--skip-release-notes',
  '--skip-welcome',
];
const quietLaunchArgs = [
  ...baseLaunchArgs,
  '--disable-updates',
  '--disable-gpu',
];

export default defineConfig([
  {
    label: 'e2e-ci',
    files: e2eFiles,
    launchArgs: [
      ...quietLaunchArgs,
      '--user-data-dir',
      `${root}/.vscode-test/user-data-e2e-ci`,
    ],
    env: {
      GSC_E2E_MODE: 'ci',
      GSC_DISABLE_TELEMETRY: '1',
    },
    mocha: {
      ui: 'bdd',
      timeout: 30000,
      reporter: 'mocha-junit-reporter',
      reporterOptions: {
        mochaFile: 'test-results/e2e-results.xml',
        suiteTitleSeparatedBy: ' > ',
      },
    },
  },
  {
    label: 'e2e-manual',
    files: e2eFiles,
    launchArgs: [
      ...baseLaunchArgs,
      '--user-data-dir',
      `${root}/.vscode-test/user-data-e2e-manual`,
      '--profile',
      'Git Smart Checkout E2E Manual',
    ],
    env: {
      GSC_E2E_MODE: 'manual',
      GSC_DISABLE_TELEMETRY: '1',
      GSC_E2E_VISUAL_DELAY_MS: process.env.GSC_E2E_VISUAL_DELAY_MS ?? '750',
    },
    mocha: {
      ui: 'bdd',
      timeout: 120000,
      reporter: 'spec',
    },
  },
  {
    label: 'unit',
    files: unitFiles,
    launchArgs: [
      ...quietLaunchArgs,
      '--user-data-dir',
      `${root}/.vscode-test/user-data-unit`,
    ],
    mocha: {
      ui: 'bdd',
      timeout: 10000,
      ...(process.env.CI && {
        reporter: 'mocha-junit-reporter',
        reporterOptions: {
          mochaFile: 'test-results/unit-results.xml',
          suiteTitleSeparatedBy: ' > ',
        },
      }),
    },
  },
]);
