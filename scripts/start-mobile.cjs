const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const port = process.env.ANTIGRAVITY_REMOTE_PORT || process.env.PORT || '4177';

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

let tunnel = null;
if (process.argv.includes('--tunnel') && hasCommand('cloudflared')) {
  tunnel = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${port}`], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'inherit'],
    shell: process.platform === 'win32',
  });

  tunnel.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (match) {
      const connectionPath = path.join(root, 'connection.txt');
      const existing = fs.existsSync(connectionPath) ? fs.readFileSync(connectionPath, 'utf8') : '';
      const token = existing.match(/^TOKEN:\s*(.+)$/m)?.[1]?.trim();
      fs.appendFileSync(
        connectionPath,
        `TUNNEL_URL: ${match[0]}${token ? `?token=${token}` : ''}\n`,
        'utf8',
      );
    }
  });
} else if (process.argv.includes('--tunnel')) {
  console.log('cloudflared was not found. LAN URLs in connection.txt are still available.');
}

function stop() {
  if (tunnel) tunnel.kill();
  server.kill();
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
