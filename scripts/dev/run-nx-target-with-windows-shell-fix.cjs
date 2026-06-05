const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const target = process.argv[2];
const extraArgs = process.argv.slice(3);

if (!target) {
  console.error('Usage: node scripts/dev/run-nx-target-with-windows-shell-fix.cjs <project:target[:configuration]> [...args]');
  process.exit(1);
}

const env = { ...process.env };

if (process.platform === 'win32') {
  const systemRoot = env.SystemRoot || env.WINDIR || 'C:\\Windows';
  const system32 = path.join(systemRoot, 'System32');
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'Path';
  const pathValue = env[pathKey] || '';

  if (!pathValue.toLowerCase().split(';').includes(system32.toLowerCase())) {
    env[pathKey] = `${system32};${pathValue}`;
  }

  if (!env.ComSpec) {
    env.ComSpec = path.join(system32, 'cmd.exe');
  }
}

const nxBin = require.resolve('nx/bin/nx.js');

function runNx(args) {
  return spawnSync(process.execPath, [nxBin, 'run', target, ...args], {
    cwd: process.cwd(),
    env,
    stdio: 'inherit'
  });
}

function hasOutputPathArg(args) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg.startsWith('--outputPath=')) {
      return true;
    }

    if (arg === '--outputPath') {
      return true;
    }
  }

  return false;
}

function isMakeNativeTarget(targetName) {
  return targetName.endsWith(':make-native') || targetName.includes(':make-native:');
}

function pruneOldRetryOutputFolders() {
  const distDir = path.join(process.cwd(), 'dist');
  const retryPrefix = 'executables-retry-';
  const now = Date.now();
  const maxAgeMs = 3 * 24 * 60 * 60 * 1000;

  if (!fs.existsSync(distDir)) {
    return;
  }

  const entries = fs.readdirSync(distDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(retryPrefix)) {
      continue;
    }

    const timestampText = entry.name.slice(retryPrefix.length);
    const timestamp = Number(timestampText);

    if (!Number.isFinite(timestamp)) {
      continue;
    }

    if (now - timestamp <= maxAgeMs) {
      continue;
    }

    const folderPath = path.join(distDir, entry.name);

    try {
      fs.rmSync(folderPath, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Could not prune old retry folder ${folderPath}: ${error.message}`);
    }
  }
}

const result = runNx(extraArgs);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

const initialExitCode = result.status ?? 1;
const shouldRetryWithFreshOutputPath =
  process.platform === 'win32' &&
  initialExitCode !== 0 &&
  isMakeNativeTarget(target) &&
  !hasOutputPathArg(extraArgs);

if (shouldRetryWithFreshOutputPath) {
  pruneOldRetryOutputFolders();
  const fallbackOutputPath = `dist/executables-retry-${Date.now()}`;
  console.warn('Retrying make-native with a fresh output path to bypass a locked dist/executables folder.');
  console.warn(`Fallback output path: ${fallbackOutputPath}`);

  const retryResult = runNx([...extraArgs, `--outputPath=${fallbackOutputPath}`]);

  if (retryResult.error) {
    console.error(retryResult.error);
    process.exit(1);
  }

  process.exit(retryResult.status ?? 1);
}

process.exit(initialExitCode);