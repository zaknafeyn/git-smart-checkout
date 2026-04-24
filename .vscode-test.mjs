import { defineConfig } from '@vscode/test-cli';

const isCI = Boolean(process.env.CI);

export default defineConfig([
  {
    label: 'e2e',
    files: 'out/test/e2e/**/*.test.js',
    mocha: {
      ui: 'bdd',
      timeout: 30000,
      ...(isCI && {
        reporter: 'mocha-junit-reporter',
        reporterOptions: {
          mochaFile: 'test-results/e2e-results.xml',
          suiteTitleSeparatedBy: ' > ',
        },
      }),
    },
  },
  {
    label: 'unit',
    files: 'out/test/unit/**/*.test.js',
    mocha: {
      ui: 'bdd',
      timeout: 10000,
      ...(isCI && {
        reporter: 'mocha-junit-reporter',
        reporterOptions: {
          mochaFile: 'test-results/unit-results.xml',
          suiteTitleSeparatedBy: ' > ',
        },
      }),
    },
  },
]);
