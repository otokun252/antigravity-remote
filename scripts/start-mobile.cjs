const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const port = process.env.ANTIGRAVITY_REMOTE_PORT || process.env.PORT || '4177';
const wantsLocal = process.argv.includes('--local');
const wantsTunnel = !wantsLocal;

function writeTunnelConnectionFile(tunnelUrl) {
  const token = process.env.ANTIGRAVITY_REMOTE_TOKEN || (() => {
    const connectionPath = path.join(root, 'connection.txt');
    if (!fs.existsSync(connectionPath)) return '';
    return fs.readFileSync(connectionPath, 'utf8').match(/^TOKEN:\s*(.+)$/m)?.[1]?.trim() || '';
  })();
  const lines = [
    'Antigravity Remote',
    'MODE: tunnel',
    `PORT: ${port}`,
    ...(token ? [`TOKEN: ${token}`] : []),
    `URL: ${tunnelUrl}${token ? `?token=${token}` : ''}`,
    `TUNNEL_URL: ${tunnelUrl}${token ? `?token=${token}` : ''}`,
  ];
  fs.writeFileSync(path.join(root, 'connection.txt'), `${lines.join('\n')}\n`, 'utf8');
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

function hasCommand(command) {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [command], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  return result.status === 0;
}

run('npm', ['run', 'build']);

const server = spawn('node', ['server.cjs'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    ANTIGRAVITY_REMOTE_PORT: port,
  },
  shell: process.platform === 'win32',
});

const cloudflaredPath = fs.existsSync(path.resolve(root, '.local-bin/cloudflared.exe'))
  ? path.resolve(root, '.local-bin/cloudflared.exe')
  : 'cloudflared';

let tunnel = null;
if (wantsTunnel && !(hasCommand('cloudflared') || fs.existsSync(cloudflaredPath))) {
  console.error('cloudflared was not found. Install cloudflared or start explicitly with --local.');
  server.kill();
  process.exit(1);
}

if (wantsTunnel) {
  tunnel = spawn(cloudflaredPath, ['tunnel', '--url', `http://127.0.0.1:${port}`], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'inherit'],
    shell: process.platform === 'win32',
  });

  tunnel.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (match) {
      writeTunnelConnectionFile(match[0]);
    }
  });
}

function stop() {
  if (tunnel) tunnel.kill();
  server.kill();
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
