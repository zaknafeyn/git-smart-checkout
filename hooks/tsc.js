#!/usr/bin/env node

const { spawn } = require('child_process');

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: ['inherit', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });

    proc.on('error', (error) => {
      reject(error);
    });
  });
}

async function runTypeChecks() {
  try {
    // Run main TypeScript check
    const mainResult = await runCommand('yarn', ['check-types']);
    
    if (mainResult.code !== 0) {
      if (mainResult.stdout) {
        process.stderr.write(mainResult.stdout);
      }
      if (mainResult.stderr) {
        process.stderr.write(mainResult.stderr);
      }
      process.exit(2);
    }

    // Run webview TypeScript check
    const webviewResult = await runCommand('yarn', ['check-types-webview']);
    
    if (webviewResult.code !== 0) {
      if (webviewResult.stdout) {
        process.stderr.write(webviewResult.stdout);
      }
      if (webviewResult.stderr) {
        process.stderr.write(webviewResult.stderr);
      }
      process.exit(2);
    }

    // Both checks passed
    process.exit(0);

  } catch (error) {
    process.stderr.write(`Failed to run TypeScript checks: ${error.message}\n`);
    process.exit(2);
  }
}

runTypeChecks();
