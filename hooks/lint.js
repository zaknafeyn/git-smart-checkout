#!/usr/bin/env node

const { spawn } = require('child_process');

function runLint() {
  const lint = spawn('yarn', ['lint'], {
    stdio: ['inherit', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';

  lint.stdout.on('data', (data) => {
    stdout += data.toString();
  });

  lint.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  lint.on('close', (code) => {
    if (code !== 0) {
      // Lint found errors
      if (stdout) {
        process.stderr.write(stdout);
      }
      if (stderr) {
        process.stderr.write(stderr);
      }
      process.exit(2);
    } else {
      // No lint errors
      process.exit(0);
    }
  });

  lint.on('error', (error) => {
    process.stderr.write(`Failed to run lint: ${error.message}\n`);
    process.exit(2);
  });
}

runLint();