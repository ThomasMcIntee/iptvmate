const { spawnSync } = require('node:child_process');
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
const result = spawnSync(process.execPath, [nxBin, 'run', target, ...extraArgs], {
  cwd: process.cwd(),
  env,
  stdio: 'inherit'
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);