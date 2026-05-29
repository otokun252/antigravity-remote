const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const express = require('express');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || process.env.ANTIGRAVITY_REMOTE_PORT || 4177);
const HOST = process.env.ANTIGRAVITY_REMOTE_HOST || '0.0.0.0';
const STATE_PATH = path.join(ROOT, 'antigravity_bridge.json');
const CONNECTION_PATH = path.join(ROOT, 'connection.txt');
const DIST_PATH = path.join(ROOT, 'dist');
const MEDIA_ROOT = path.join(ROOT, 'output', 'media');
const CAPTURE_ROOT = path.join(MEDIA_ROOT, 'captures');
const UPLOAD_ROOT = path.join(MEDIA_ROOT, 'uploads');
const DEFAULT_WORKSPACE = process.env.TARGET_WORKSPACE_PATH
  ? path.resolve(ROOT, process.env.TARGET_WORKSPACE_PATH)
  : ROOT;
const DEFAULT_MODELS = [
  'Auto',
  'Gemini 3 Pro',
  'Gemini 2.5 Pro',
  'Gemini 2.5 Flash',
  'Custom',
];
const DEFAULT_ANTIGRAVITY_MODELS = [
  'Gemini 3.5 Flash (Medium)',
  'Gemini 3.5 Flash (High)',
  'Gemini 3.5 Flash (Low)',
  'Gemini 3.1 Pro (Low)',
  'Gemini 3.1 Pro (High)',
  'Claude Sonnet 4.6 (Thinking)',
  'Claude Opus 4.6 (Thinking)',
  'GPT-OSS 120B (Medium)',
];
const EXCLUDED_NAMES = new Set([
  '.git',
  '.idea',
  '.vscode',
  'dist',
  'node_modules',
  'output',
  'antigravity_bridge.json',
  'connection.txt',
]);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogv']);
const TEXT_EXTENSIONS = new Set([
  '.md',
  '.txt',
  '.json',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.css',
  '.html',
  '.yml',
  '.yaml',
  '.xml',
  '.cjs',
  '.mjs',
  '.py',
  '.ps1',
  '.toml',
  '.ini',
  '.env',
]);
const TOKEN =
  process.env.ANTIGRAVITY_REMOTE_TOKEN ||
  process.env.ACCESS_TOKEN ||
  readExistingToken() ||
  crypto.randomBytes(18).toString('base64url');

function readExistingToken() {
  try {
    if (!fs.existsSync(CONNECTION_PATH)) return '';
    const match = fs.readFileSync(CONNECTION_PATH, 'utf8').match(/^TOKEN:\s*(.+)$/m);
    return match?.[1]?.trim() || '';
  } catch {
    return '';
  }
}

function loadState() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      const raw = fs.readFileSync(STATE_PATH, 'utf8').replace(/^\uFEFF/, '');
      return JSON.parse(raw);
    }
  } catch (error) {
    console.error('[state] failed to read:', error.message);
  }
  return {
    tasks: [],
    automationDrafts: [],
    workspacePath: DEFAULT_WORKSPACE,
    model: 'Auto',
    customModel: '',
    antigravityProject: '',
  };
}

function saveState(state) {
  const cleanState = {
    ...state,
    tasks: (state.tasks || []).slice(0, 80),
    automationDrafts: (state.automationDrafts || []).slice(0, 40),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(STATE_PATH, JSON.stringify(cleanState, null, 2), 'utf8');
  return cleanState;
}

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

ensureDir(MEDIA_ROOT);
ensureDir(CAPTURE_ROOT);
ensureDir(UPLOAD_ROOT);

function isImageFile(targetPath) {
  return IMAGE_EXTENSIONS.has(path.extname(String(targetPath || '')).toLowerCase());
}

function isVideoFile(targetPath) {
  return VIDEO_EXTENSIONS.has(path.extname(String(targetPath || '')).toLowerCase());
}

function isTextFile(targetPath) {
  return TEXT_EXTENSIONS.has(path.extname(String(targetPath || '')).toLowerCase());
}

function safeFileName(value) {
  return String(value || 'file')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 120);
}

function mediaUrlForAbsolute(absolutePath) {
  const relative = path.relative(MEDIA_ROOT, absolutePath).replace(/\\/g, '/');
  return `/media/${relative}`;
}

function getDesktopRoots() {
  const home = os.homedir();
  return [
    path.join(home, 'Desktop'),
    path.join(home, 'OneDrive', 'Desktop'),
    path.join(home, 'OneDrive', 'デスクトップ'),
  ].filter((value, index, list) => value && list.indexOf(value) === index);
}

function getWorkspacePath(state = loadState()) {
  const candidate = state.workspacePath || DEFAULT_WORKSPACE;
  try {
    const resolved = path.resolve(candidate);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      return resolved;
    }
  } catch {
    // Fall back below.
  }
  return DEFAULT_WORKSPACE;
}

function safeResolveInWorkspace(requestPath = '', state = loadState()) {
  const workspace = getWorkspacePath(state);
  const resolved = requestPath ? path.resolve(workspace, requestPath) : workspace;
  const relative = path.relative(workspace, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Workspace outside access is not allowed.');
  }
  return { workspace, resolved, relative };
}

function toRelative(workspace, absolutePath) {
  return path.relative(workspace, absolutePath).replace(/\\/g, '/');
}

function listDirectory(relativePath = '') {
  const state = loadState();
  const { workspace, resolved } = safeResolveInWorkspace(relativePath, state);
  const entries = fs
    .readdirSync(resolved, { withFileTypes: true })
    .filter((entry) => !EXCLUDED_NAMES.has(entry.name) && !entry.name.startsWith('.'))
    .map((entry) => {
      const absolutePath = path.join(resolved, entry.name);
      const stats = fs.statSync(absolutePath);
      return {
        name: entry.name,
        path: toRelative(workspace, absolutePath),
        isDir: entry.isDirectory(),
        size: entry.isDirectory() ? null : stats.size,
        modifiedAt: stats.mtime.toISOString(),
      };
    });

  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, 'ja');
  });
  return entries;
}

function listFolderSuggestions(basePath) {
  const parent = basePath ? path.resolve(basePath) : path.dirname(getWorkspacePath());
  const entries = fs.existsSync(parent)
    ? fs
        .readdirSync(parent, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !EXCLUDED_NAMES.has(entry.name))
        .slice(0, 80)
        .map((entry) => ({
          name: entry.name,
          path: path.join(parent, entry.name),
        }))
    : [];
  return { parent, entries };
}

function normalizePathForCompare(value) {
  return String(value || '').replace(/\//g, '\\').toLowerCase();
}

function resolveWorkspacePathForProject(projectName, state = loadState()) {
  const name = String(projectName || '').trim();
  if (!name) return '';

  if (path.isAbsolute(name) && fs.existsSync(name) && fs.statSync(name).isDirectory()) {
    return path.resolve(name);
  }

  const currentWorkspace = getWorkspacePath(state);
  const candidates = [
    path.join(path.dirname(currentWorkspace), name),
    ...getDesktopRoots().map((root) => path.join(root, name)),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return path.resolve(candidate);
      }
    } catch {
      // Ignore bad candidate.
    }
  }

  const suggestions = listFolderSuggestions(currentWorkspace).entries || [];
  const exact = suggestions.find((entry) => normalizePathForCompare(entry.name) === normalizePathForCompare(name));
  return exact?.path ? path.resolve(exact.path) : '';
}

function syncWorkspacePathForProject(projectName) {
  const state = loadState();
  state.antigravityProject = String(projectName || '').trim();
  const resolved = resolveWorkspacePathForProject(projectName, state);
  if (!resolved) {
    saveState(state);
    return { state, path: getWorkspacePath(state), changed: false };
  }
  const previous = getWorkspacePath(state);
  state.workspacePath = resolved;
  saveState(state);
  return { state, path: resolved, changed: normalizePathForCompare(previous) !== normalizePathForCompare(resolved) };
}

function resolveWorkspaceRequest(requestedPath, state = loadState()) {
  const requested = String(requestedPath || '').trim();
  if (!requested) return '';

  const directCandidates = [requested];
  if (path.isAbsolute(requested)) {
    directCandidates.push(path.normalize(requested));
  }

  for (const candidate of directCandidates) {
    try {
      const resolved = path.resolve(candidate);
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        return resolved;
      }
    } catch {
      // Ignore and try fallback resolution.
    }
  }

  return resolveWorkspacePathForProject(requested, state);
}

function formatTaskForAntigravity(task) {
  const lines = [];
  if (task.model && task.model !== 'Auto') {
    lines.push(`希望モデル: ${task.model}`);
  }
  if (task.workspacePath) {
    lines.push(`作業フォルダ: ${task.workspacePath}`);
  }
  if (task.fileContext) {
    lines.push(`確認ファイル: ${task.fileContext.path}`);
    lines.push('');
    lines.push('--- ファイル内容 ---');
    lines.push(task.fileContext.content);
    lines.push('--- ファイル内容ここまで ---');
  }
  if (lines.length) lines.push('');
  lines.push(task.text);
  return lines.join('\n');
}

function getLocalUrls() {
  const urls = [`http://127.0.0.1:${PORT}`];
  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        urls.push(`http://${entry.address}:${PORT}`);
      }
    }
  }
  return [...new Set(urls)];
}

function getAntigravityStatus() {
  if (process.platform === 'win32') {
    const command = [
      '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ',
      '$OutputEncoding = [Console]::OutputEncoding; ',
      'Get-Process Antigravity -ErrorAction SilentlyContinue | ',
      'Select-Object Id,ProcessName,MainWindowTitle,Path | ConvertTo-Json -Compress',
    ].join('');
    try {
      const output = require('child_process')
        .execFileSync('powershell.exe', ['-NoProfile', '-Command', command], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 4000,
        })
        .trim();
      if (!output) return { running: false, processes: [], platform: process.platform };
      const parsed = JSON.parse(output);
      const processes = Array.isArray(parsed) ? parsed : [parsed];
      return { running: processes.length > 0, processes, platform: process.platform };
    } catch {
      return { running: false, processes: [], platform: process.platform };
    }
  }

  try {
    const output = require('child_process')
      .execFileSync('bash', ['-lc', "pgrep -fal 'Antigravity' || true"], {
        encoding: 'utf8',
        timeout: 4000,
      })
      .trim();
    const processes = output
      ? output.split(/\r?\n/).map((line) => {
          const firstSpace = line.indexOf(' ');
          return {
            Id: firstSpace > 0 ? Number(line.slice(0, firstSpace)) : null,
            ProcessName: 'Antigravity',
            MainWindowTitle: line.slice(firstSpace + 1),
            Path: '',
          };
        })
      : [];
    return { running: processes.length > 0, processes, platform: process.platform };
  } catch {
    return { running: false, processes: [], platform: process.platform };
  }
}

function requireToken(req, res, next) {
  const provided = req.query.token || req.get('x-antigravity-token');
  if (provided !== TOKEN) {
    return res.status(401).json({ error: 'Token is missing or invalid.' });
  }
  next();
}

function copyToClipboard(text) {
  return new Promise((resolve, reject) => {
    const command =
      process.platform === 'darwin'
        ? ['pbcopy', []]
        : ['powershell.exe', ['-NoProfile', '-Command', 'Set-Clipboard -Value $input']];
    const child = spawn(command[0], command[1], {
      stdio: ['pipe', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let errorText = '';
    child.stderr.on('data', (chunk) => {
      errorText += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(errorText || `Set-Clipboard failed with code ${code}`));
    });
    child.stdin.end(text);
  });
}

function openAntigravity() {
  if (process.platform === 'darwin') {
    return new Promise((resolve, reject) => {
      execFile('open', ['-a', 'Antigravity'], (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  const defaultPath = path.join(
    os.homedir(),
    'AppData',
    'Local',
    'Programs',
    'Antigravity',
    'Antigravity.exe',
  );
  const command = fs.existsSync(defaultPath)
    ? `Start-Process -FilePath '${defaultPath.replace(/'/g, "''")}'`
    : 'Start-Process Antigravity';

  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function pasteToAntigravity(text) {
  const escapedText = Buffer.from(text, 'utf8').toString('base64');
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
Add-Type -AssemblyName System.Windows.Forms
$bytes = [Convert]::FromBase64String('${escapedText}')
$text = [Text.Encoding]::UTF8.GetString($bytes)
Set-Clipboard -Value $text
$proc = Get-Process Antigravity -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 } |
  Sort-Object StartTime -Descending |
  Select-Object -First 1
if (-not $proc) {
  $app = Join-Path $env:LOCALAPPDATA 'Programs\\Antigravity\\Antigravity.exe'
  if (Test-Path $app) { Start-Process -FilePath $app } else { Start-Process Antigravity }
  Start-Sleep -Seconds 3
  $proc = Get-Process Antigravity -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 } |
    Sort-Object StartTime -Descending |
    Select-Object -First 1
}
if (-not $proc) { throw 'Antigravity window was not found.' }
[Win32]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null
[Win32]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 500
[System.Windows.Forms.SendKeys]::SendWait('^v')
`;

  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-STA', '-Command', script],
      { windowsHide: true, timeout: 12000 },
      (error, stdout, stderr) => {
        if (error) reject(new Error(stderr || error.message));
        else resolve(stdout);
      },
    );
  });
}

async function withCdp(callback) {
  const portFileCandidates = process.platform === 'darwin'
    ? [
        path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort'),
        path.join(os.homedir(), 'Library', 'Application Support', 'antigravity', 'DevToolsActivePort'),
      ]
    : [path.join(os.homedir(), 'AppData', 'Roaming', 'Antigravity', 'DevToolsActivePort')];
  const portFile = portFileCandidates.find((candidate) => fs.existsSync(candidate));
  if (!portFile) {
    throw new Error('Antigravity DevToolsActivePort was not found.');
  }

  const [portLine] = fs.readFileSync(portFile, 'utf8').split(/\r?\n/);
  const port = Number(String(portLine || '').trim());
  if (!port) {
    throw new Error('Antigravity DevTools port is invalid.');
  }

  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  const target = targets.find((item) => String(item.url || '').includes('127.0.0.1:65480')) || targets[0];
  if (!target?.webSocketDebuggerUrl) {
    throw new Error('Antigravity page target was not found.');
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const pair = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) pair.reject(new Error(JSON.stringify(message.error)));
    else pair.resolve(message.result);
  };

  const call = (method, params = {}) => {
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  try {
    await call('Runtime.enable');
    await call('DOM.enable');
    await call('Page.bringToFront');
    return await callback({ call, target });
  } finally {
    ws.close();
  }
}

async function antigravityState() {
  const bridgeState = loadState();
  return withCdp(async ({ call, target }) => {
    const expression = `(() => {
      const projectSections = Array.from(document.querySelectorAll('[data-project-card="true"]'))
        .map((card) => card.parentElement)
        .filter(Boolean)
        .map((section, index) => {
          const card = section.querySelector('[data-project-card="true"]');
          const title = (card?.innerText || '').trim();
          const conversations = Array.from(section.querySelectorAll('[data-testid^="convo-pill-"]'))
            .map((el) => {
              const button = el.closest('[role="button"]');
              const titleText = (el.innerText || '').trim();
              const active = Boolean(button && String(button.className || '').includes('bg-sidebar-secondary'));
              return {
                id: String(el.getAttribute('data-testid') || '').replace(/^convo-pill-/, ''),
                title: titleText,
                active
              };
            })
            .filter((item) => item.title);
          const active = conversations.some((item) => item.active);
          return {
            id: title || String(index),
            title,
            expanded: card?.getAttribute('aria-expanded') === 'true',
            active,
            conversations
          };
        })
        .filter((item) => item.title);

      const conversationItems = projectSections.flatMap((section) => section.conversations);

      const threadRoot = Array.from(document.querySelectorAll('div'))
        .find((el) => String(el.className || '').includes('relative flex flex-col gap-y-3 px-4'));
      const threadBlocks = threadRoot
        ? Array.from(threadRoot.children).slice(-24).map((el, index) => {
            const text = (el.innerText || '').trim();
            const hasUserInput = Boolean(el.querySelector('[data-testid="user-input-step"]'));
            const hasReview = /\\bReview\\b/.test(text);
            const kind = hasUserInput ? 'user-turn' : hasReview ? 'agent-turn' : 'system-turn';
            return {
              id: String(index) + '-' + text.slice(0, 24),
              kind,
              text: text.slice(0, 6000)
            };
          }).filter((item) => item.text)
        : [];

      const modelButton = Array.from(document.querySelectorAll('[role="button"],button'))
        .find((el) => String(el.getAttribute('aria-label') || '').includes('Select model'));
      const workspaceButton = Array.from(document.querySelectorAll('button'))
        .find((el) => el.getAttribute('aria-haspopup') === 'dialog' && (el.innerText || '').trim());
      const modelOptions = Array.from(document.querySelectorAll('[role="button"],button'))
        .map((el) => (el.innerText || '').trim())
        .filter((text) => text && /(Gemini|Claude|GPT-OSS)/.test(text))
        .map((text) => text.split('\\n')[0].trim());

      const editor = document.querySelector('[contenteditable="true"][aria-label="Message input"]');
      const send = document.querySelector('[data-testid="send-button"]');
      const currentConversation =
        conversationItems.find((item) => item.active)?.title ||
        conversationItems[0]?.title ||
        '';
      const currentProject =
        (workspaceButton?.innerText || '').trim() ||
        ${JSON.stringify(bridgeState.antigravityProject || '')} ||
        projectSections.find((item) => item.conversations.some((entry) => entry.active))?.title ||
        projectSections.find((item) => item.conversations.some((entry) => entry.title === currentConversation))?.title ||
        projectSections.find((item) => item.expanded && item.conversations.length)?.title ||
        projectSections[0]?.title ||
        '';
      const currentModel =
        modelButton?.getAttribute('aria-label')?.replace(/^Select model, current:\\s*/, '') ||
        modelButton?.innerText?.trim() ||
        '';
      const modelUsage =
        Array.from(document.querySelectorAll('body *'))
          .filter((el) => !['STYLE', 'SCRIPT', 'NOSCRIPT'].includes(el.tagName))
          .filter((el) => el.childElementCount === 0)
          .map((el) => (el.innerText || '').trim())
          .filter((text) => text && text.length <= 80)
          .find((text) =>
            text.includes('%') ||
            /usage|remaining|limit|quota/i.test(text)
          ) ||
        '';
      const approvalPrompt = (() => {
        const candidates = Array.from(document.querySelectorAll('div,[role="dialog"],section'))
          .filter((el) => {
            const text = (el.innerText || '').trim();
            if (!text || text.length > 1400) return false;
            if (!el.querySelector('button,[role="button"]')) return false;
            return /allow .*access|permission|waiting for user input|always allow|allow this time|yes,|^1\s+yes|^2\s+yes|^3\s+yes|^4\s+no/m.test(text);
          })
          .sort((a, b) => (b.innerText || '').length - (a.innerText || '').length);

        for (const card of candidates) {
          const actions = Array.from(card.querySelectorAll('button,[role="button"]'))
            .map((el, index) => {
            const label = (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ');
            if (!label) return null;
            const lower = label.toLowerCase();
            if (!/^(submit|skip|yes\b|no\b|allow\b|deny\b|reject\b|cancel\b)/i.test(lower)) return null;
            const disabled = el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
            const kind = lower.startsWith('submit')
              ? 'submit'
              : lower.startsWith('skip')
                ? 'skip'
                : 'option';
            return {
              label,
              actionKey: kind === 'option' ? 'approval-option:' + index : kind,
              disabled,
              kind,
            };
          })
          .filter(Boolean);

          if (!actions.length) continue;

          return {
            title: ((card.querySelector('strong,h1,h2,h3')?.innerText || '').trim()) || 'Approval required',
            body: (card.innerText || '').trim(),
            actions,
          };
        }

        return null;
      })();

      const waitingForInput = /waiting for user input/i.test(document.body.innerText || '') ||
        threadBlocks.some((item) => /waiting for user input/i.test(item.text));

      const pendingActions = approvalPrompt
        ? approvalPrompt.actions
        : waitingForInput
          ? []
          : Array.from(document.querySelectorAll('button,[role="button"]'))
          .map((el) => {
            const label = (el.innerText || el.getAttribute('aria-label') || '').trim();
            if (!label || label.length > 40) return null;
            const match = label.toLowerCase().match(/^(approve|reject|allow|deny|yes|no|continue|cancel)\b/);
            if (!match) return null;
              const disabled =
                el.hasAttribute('disabled') ||
                el.getAttribute('aria-disabled') === 'true';
              return {
                label,
                actionKey: match[1],
                disabled,
                kind: 'simple',
              };
            })
            .filter(Boolean);

      return {
        url: location.href,
        title: document.title,
        currentProject,
        currentConversation,
        currentModel,
        modelUsage,
        models: (Array.from(new Set(modelOptions)).length >= 2
          ? Array.from(new Set(modelOptions))
          : ${JSON.stringify(DEFAULT_ANTIGRAVITY_MODELS)}).slice(0, 12),
        projects: projectSections.map((item) => item.title),
        projectSections,
        conversations: conversationItems,
        threadBlocks,
        approvalPrompt,
        pendingActions,
        draft: editor ? editor.innerText : '',
        canSend: send ? send.getAttribute('aria-label') === 'Send message' : false,
        canStop: send ? send.getAttribute('aria-label') !== 'Send message' : false,
        sendLabel: send ? send.getAttribute('aria-label') : null
      };
    })()`;

    const result = await call('Runtime.evaluate', { expression, returnByValue: true });
    const value = result.result.value || {};
    const filteredPendingActions = Array.isArray(value.pendingActions)
      ? value.pendingActions.filter((action) =>
          /^(submit|skip|yes\b|no\b|allow\b|deny\b|reject\b|cancel\b)/i.test(String(action?.label || '').trim()),
        )
      : [];
    const filteredApprovalPrompt =
      value.approvalPrompt && filteredPendingActions.length
        ? { ...value.approvalPrompt, actions: filteredPendingActions }
        : null;
    return {
      pageUrl: target.url,
      ...value,
        approvalPrompt: filteredApprovalPrompt,
        pendingActions: filteredPendingActions,
      };
  });
}

async function stopAntigravityRun() {
  return withCdp(async ({ call }) => {
    const result = await call('Runtime.evaluate', {
      expression: `(() => {
        const buttons = Array.from(document.querySelectorAll('button,[role="button"]'));
        const sendButton = document.querySelector('[data-testid="send-button"]');
        const isEnabled = (node) => node && !node.hasAttribute('disabled') && node.getAttribute('aria-disabled') !== 'true';
        const labelOf = (node) => ((node?.innerText || node?.getAttribute('aria-label') || '').trim());

        const sendLabel = labelOf(sendButton);
        if (sendButton && isEnabled(sendButton) && sendLabel && !/^send message$/i.test(sendLabel)) {
          sendButton.click();
          return { ok: true, label: sendLabel };
        }

        const stopButton = buttons.find((node) => {
          if (!isEnabled(node)) return false;
          const label = labelOf(node);
          return /^(stop|cancel)(\\b|\\s)|stop generating|cancel generation|interrupt/i.test(label);
        });
        if (stopButton) {
          stopButton.click();
          return { ok: true, label: labelOf(stopButton) };
        }

        return { ok: false, reason: 'stop button not found' };
      })()`,
      returnByValue: true,
    });
    const value = result.result.value;
    if (!value?.ok) {
      throw new Error(value?.reason || 'Stop action failed.');
    }
    return antigravityState();
  });
}

async function selectProject(projectName) {
  return withCdp(async ({ call }) => {
    const result = await call('Runtime.evaluate', {
      expression: `(() => {
        const fire = (node) => {
          ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
            node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
          });
        };

        const cards = Array.from(document.querySelectorAll('[data-project-card="true"]'));
        const targetCard = cards.find((el) => (el.innerText || '').trim() === ${JSON.stringify(projectName)});
        if (!targetCard) {
          return { ok: false, reason: 'project card not found', count: cards.length };
        }

        fire(targetCard);
        return { ok: true };
      })()`,
      returnByValue: true,
    });
    return result.result.value;
  });
}

async function switchProjectAndOpenConversation(projectName) {
  const result = await selectProject(projectName);
  if (!result?.ok) return result;
  await new Promise((resolve) => setTimeout(resolve, 250));
  const newConversationResult = await clickNewConversation();
  if (!newConversationResult?.ok) {
    return { ok: false, reason: newConversationResult?.reason || 'new conversation failed' };
  }
  await new Promise((resolve) => setTimeout(resolve, 350));
  return { ok: true };
}

async function selectConversation(conversationId) {
  return withCdp(async ({ call }) => {
    const result = await call('Runtime.evaluate', {
      expression: `(() => {
        const target = document.querySelector(${JSON.stringify(`[data-testid="convo-pill-${conversationId}"]`)});
        if (!target) return { ok: false, reason: 'conversation not found' };
        target.click();
        return { ok: true };
      })()`,
      returnByValue: true,
    });
    return result.result.value;
  });
}

async function clickNewConversation() {
  return withCdp(async ({ call }) => {
    const expression = `(() => {
      const target = Array.from(document.querySelectorAll('[role="button"],button'))
        .find((el) => (el.innerText || el.getAttribute('aria-label') || '').trim() === 'New Conversation');
      if (!target) return { ok: false, reason: 'new conversation not found' };
      target.click();
      return { ok: true };
    })()`;
    const result = await call('Runtime.evaluate', { expression, returnByValue: true });
    return result.result.value;
  });
}

async function selectModel(modelName) {
  return withCdp(async ({ call }) => {
    const openMenu = await call('Runtime.evaluate', {
      expression: `(() => {
        const trigger = Array.from(document.querySelectorAll('[role="button"],button'))
          .find((el) => String(el.getAttribute('aria-label') || '').includes('Select model'));
        if (!trigger) return { ok: false, reason: 'model selector not found' };
        trigger.click();
        return { ok: true };
      })()`,
      returnByValue: true,
    });
    if (!openMenu.result.value?.ok) {
      return openMenu.result.value;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));

    const choose = await call('Runtime.evaluate', {
      expression: `(() => {
        const options = Array.from(document.querySelectorAll('[role="button"],button'));
        const target = options.find((el) => {
          const text = (el.innerText || '').trim().split('\\n')[0].trim();
          return text === ${JSON.stringify(modelName)} && /group\\/popover-item/.test(String(el.className || ''));
        });
        if (!target) return { ok: false, reason: 'model option not found' };
        target.click();
        return { ok: true };
      })()`,
      returnByValue: true,
    });
    return choose.result.value;
  });
}

async function performPendingAction(actionKey) {
  return withCdp(async ({ call }) => {
    const result = await call('Runtime.evaluate', {
      expression: `(() => {
        const wanted = ${JSON.stringify(String(actionKey || '').toLowerCase())};
        const pageText = document.body.innerText || '';
        const inApprovalMode = /waiting for user input/i.test(pageText);
        let target = null;

        if (inApprovalMode) {
          const cards = Array.from(document.querySelectorAll('div,[role="dialog"],section'))
            .filter((el) => {
              const text = (el.innerText || '').trim();
              return text && text.length <= 1400 &&
                /allow .*access|permission|submit|skip|waiting for user input/i.test(text) &&
                el.querySelector('button,[role="button"]');
            })
            .sort((a, b) => (b.innerText || '').length - (a.innerText || '').length);
          const card = cards[0];
          const buttons = card ? Array.from(card.querySelectorAll('button,[role="button"]')) : [];

          if (wanted.startsWith('approval-option:')) {
            const index = Number(wanted.split(':')[1]);
            target = Number.isFinite(index) ? buttons[index] : null;
          } else if (wanted === 'submit' || wanted === 'skip') {
            target = buttons.find((el) => ((el.innerText || el.getAttribute('aria-label') || '').trim().toLowerCase().startsWith(wanted)));
          }
        }

        if (!target) {
          const buttons = Array.from(document.querySelectorAll('button,[role="button"]'));
          target = buttons.find((el) => {
            const label = (el.innerText || el.getAttribute('aria-label') || '').trim().toLowerCase();
            const disabled = el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
            if (disabled) return false;

            if (wanted === 'yes' || wanted === 'allow') {
              return label.startsWith('yes, allow') || label.includes('allow this time') || label === 'yes' || label === 'allow';
            }
            if (wanted === 'no' || wanted === 'deny') {
              return label.startsWith('no (') || label.includes('do instead') || label === 'no' || label === 'deny';
            }
            return label === wanted || label.startsWith(wanted);
          });
        }
        if (!target) return { ok: false, reason: 'pending action not found' };
        const disabled = target.hasAttribute('disabled') || target.getAttribute('aria-disabled') === 'true';
        if (disabled) return { ok: false, reason: 'pending action is disabled' };
        target.click();
        return { ok: true };
      })()`,
      returnByValue: true,
    });
    return result.result.value;
  });
}

async function sendPromptToAntigravity(text, { send = true } = {}) {
  return withCdp(async ({ call }) => {
    const documentTree = await call('DOM.getDocument', { depth: -1, pierce: true });
    const findEditorNode = (current) => {
      if (!current) return null;
      const attrs = current.attributes || [];
      const attrMap = {};
      for (let i = 0; i < attrs.length; i += 2) attrMap[attrs[i]] = attrs[i + 1];
      if (
        current.nodeName === 'DIV' &&
        attrMap.contenteditable === 'true' &&
        attrMap['aria-label'] === 'Message input'
      ) {
        return current;
      }
      for (const child of current.children || []) {
        const found = findEditorNode(child);
        if (found) return found;
      }
      return null;
    };

    const editorNode = findEditorNode(documentTree.root);
    if (!editorNode) throw new Error('Antigravity message editor was not found.');

    await call('DOM.focus', { nodeId: editorNode.nodeId });
    await call('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 17, code: 'ControlLeft', key: 'Control' });
    await call('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 65, code: 'KeyA', key: 'a', modifiers: 2 });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 65, code: 'KeyA', key: 'a', modifiers: 2 });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 17, code: 'ControlLeft', key: 'Control' });
    await call('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 8, code: 'Backspace', key: 'Backspace' });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 8, code: 'Backspace', key: 'Backspace' });
    await call('Input.insertText', { text });

    if (send) {
      const clickResult = await call('Runtime.evaluate', {
        expression: `(() => {
          const sendButton = document.querySelector('[data-testid="send-button"]');
          if (!sendButton) return { ok: false, reason: 'send button not found' };
          sendButton.click();
          return { ok: true };
        })()`,
        returnByValue: true,
      });
      if (!clickResult.result.value?.ok) {
        throw new Error(clickResult.result.value?.reason || 'Send button click failed.');
      }
    }

    return antigravityState();
  });
}

function writeConnectionFile(extra = {}) {
  const urls = getLocalUrls();
  const lines = [
    'Antigravity Remote',
    `MODE: ${extra.mode || 'local'}`,
    `PORT: ${PORT}`,
    `TOKEN: ${TOKEN}`,
    ...urls.map((url) => `URL: ${url}?token=${TOKEN}`),
  ];
  if (extra.tunnelUrl) lines.push(`TUNNEL_URL: ${extra.tunnelUrl}?token=${TOKEN}`);
  fs.writeFileSync(CONNECTION_PATH, `${lines.join(os.EOL)}${os.EOL}`, 'utf8');
  return urls;
}

function inferImageMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.bmp') return 'image/bmp';
  return 'application/octet-stream';
}

function inferVideoMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.m4v') return 'video/x-m4v';
  if (ext === '.ogv') return 'video/ogg';
  return 'video/mp4';
}

function findRecentMediaFiles(rootPath, maxCount = 10, depth = 3, prefix = '') {
  const found = [];
  const walk = (currentPath, currentDepth, relativePrefix) => {
    if (found.length >= maxCount * 3) return;
    let entries = [];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || EXCLUDED_NAMES.has(entry.name)) continue;
      const absolutePath = path.join(currentPath, entry.name);
      const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (currentDepth < depth) {
          walk(absolutePath, currentDepth + 1, relativePath);
        }
        continue;
      }
      if (!isImageFile(absolutePath) && !isVideoFile(absolutePath)) continue;
      try {
        const stats = fs.statSync(absolutePath);
        found.push({
          name: entry.name,
          path: relativePath.replace(/\\/g, '/'),
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
          kind: isVideoFile(absolutePath) ? 'video' : 'image',
          source: prefix || 'workspace',
        });
      } catch {
        // Ignore unreadable file.
      }
    }
  };
  if (fs.existsSync(rootPath)) {
    walk(rootPath, 0, '');
  }
  return found
    .sort((a, b) => String(b.modifiedAt).localeCompare(String(a.modifiedAt)))
    .slice(0, maxCount);
}

function getRecentMedia(state = loadState()) {
  const workspace = getWorkspacePath(state);
  const uploaded = findRecentMediaFiles(UPLOAD_ROOT, 8, 2, '');
  const captures = findRecentMediaFiles(CAPTURE_ROOT, 8, 2, '');
  const workspaceImages = findRecentMediaFiles(workspace, 12, 3, '');
  return {
    uploads: uploaded.map((item) => ({ ...item, url: mediaUrlForAbsolute(path.join(UPLOAD_ROOT, item.path)) })),
    captures: captures.map((item) => ({ ...item, url: mediaUrlForAbsolute(path.join(CAPTURE_ROOT, item.path)) })),
    workspaceImages: workspaceImages.map((item) => ({
      ...item,
      url: `/api/file-asset?path=${encodeURIComponent(item.path)}&token=${TOKEN}`,
    })),
  };
}

function saveDataUrlMedia(dataUrl, nameHint, destinationRoot) {
  const match = String(dataUrl || '').match(/^data:((?:image|video)\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Media data is invalid.');
  }
  const mime = match[1].toLowerCase();
  const ext =
    mime === 'image/png' ? '.png'
    : mime === 'image/jpeg' ? '.jpg'
    : mime === 'image/webp' ? '.webp'
    : mime === 'image/gif' ? '.gif'
    : mime === 'video/mp4' ? '.mp4'
    : mime === 'video/webm' ? '.webm'
    : mime === 'video/quicktime' ? '.mov'
    : mime === 'video/x-m4v' ? '.m4v'
    : mime === 'video/ogg' ? '.ogv'
    : '.png';
  const fallbackName = mime.startsWith('video/') ? 'video' : 'image';
  const baseName = safeFileName(path.basename(String(nameHint || fallbackName), path.extname(String(nameHint || fallbackName))));
  const fileName = `${Date.now()}-${baseName || fallbackName}${ext}`;
  ensureDir(destinationRoot);
  const absolutePath = path.join(destinationRoot, fileName);
  fs.writeFileSync(absolutePath, Buffer.from(match[2], 'base64'));
  return absolutePath;
}

function parseAutomationInstruction(instruction) {
  const text = String(instruction || '').trim();
  if (!text) {
    throw new Error('Automation instruction is required.');
  }

  const hourMatch = text.match(/(?:毎日|daily).{0,8}?(\d{1,2})(?::|時)(\d{1,2})?/i);
  const minute = hourMatch?.[2] ? Number(hourMatch[2]) : 0;
  const hour = hourMatch?.[1] ? Number(hourMatch[1]) : null;
  let rrule = 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0';
  if (hour !== null && Number.isFinite(hour)) {
    rrule = `FREQ=DAILY;BYHOUR=${hour};BYMINUTE=${minute};BYSECOND=0`;
  } else if (/毎週|weekly/i.test(text)) {
    rrule = 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0;BYSECOND=0';
  } else if (/毎時|hourly/i.test(text)) {
    rrule = 'FREQ=HOURLY;INTERVAL=1';
  }

  const title = text
    .replace(/^\/?automation\s*/i, '')
    .replace(/毎日.*$/u, '')
    .trim()
    .slice(0, 80) || 'Automation task';

  return {
    title,
    instruction: text,
    rrule,
    commandText: `/automation ${title}\nSchedule: ${rrule}\nTask: ${text}`,
  };
}

async function captureDesktopScreenshot() {
  ensureDir(CAPTURE_ROOT);
  const absolutePath = path.join(CAPTURE_ROOT, `${Date.now()}-desktop.png`);
  if (process.platform === 'darwin') {
    await new Promise((resolve, reject) => {
      execFile('screencapture', ['-x', absolutePath], (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  } else {
    const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size)
$bitmap.Save('${absolutePath.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
`;
    await new Promise((resolve, reject) => {
      execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { windowsHide: true }, (error, _stdout, stderr) => {
        if (error) reject(new Error(stderr || error.message));
        else resolve();
      });
    });
  }
  return {
    path: absolutePath,
    url: mediaUrlForAbsolute(absolutePath),
    name: path.basename(absolutePath),
  };
}

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use('/media', express.static(MEDIA_ROOT));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api', requireToken);

app.get('/api/status', (_req, res) => {
  const urls = writeConnectionFile();
  const state = loadState();
  const workspacePath = getWorkspacePath(state);
  res.json({
    ok: true,
    port: PORT,
    urls,
    antigravity: getAntigravityStatus(),
    platform: process.platform,
    taskCount: state.tasks.length,
    automationCount: (state.automationDrafts || []).length,
    workspacePath,
    model: state.model || 'Auto',
    customModel: state.customModel || '',
    models: DEFAULT_MODELS,
    recentMedia: getRecentMedia(state),
    updatedAt: state.updatedAt || null,
  });
});

app.get('/api/workspace', (_req, res) => {
  const state = loadState();
  res.json({
    path: getWorkspacePath(state),
    model: state.model || 'Auto',
    customModel: state.customModel || '',
  });
});

app.post('/api/workspace', (req, res) => {
  const requestedPath = String(req.body?.path || '').trim();
  if (!requestedPath) return res.status(400).json({ error: 'Folder path is required.' });
  const state = loadState();
  const resolved = resolveWorkspaceRequest(requestedPath, state);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return res.status(400).json({ error: 'Folder was not found.' });
  }
  state.workspacePath = resolved;
  saveState(state);
  res.json({ ok: true, path: resolved });
});

app.post('/api/workspace/select', async (req, res) => {
  const requestedName = String(req.body?.name || req.body?.path || '').trim();
  if (!requestedName) return res.status(400).json({ error: 'Folder name is required.' });
  const state = loadState();
  const resolved = resolveWorkspaceRequest(requestedName, state);
  if (!resolved || !fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return res.status(400).json({ error: 'Folder was not found.' });
  }
  state.workspacePath = resolved;
  saveState(state);
  let agState = null;
  try {
    const projectResult = await switchProjectAndOpenConversation(requestedName);
    if (projectResult?.ok) {
      const workspace = syncWorkspacePathForProject(requestedName);
      agState = await antigravityState();
      return res.json({ ok: true, path: workspace.path, state: agState, switchedProject: true });
    }
  } catch {
    // Keep plain workspace switch behavior when no matching Antigravity project exists.
  }
  res.json({ ok: true, path: resolved, state: agState, switchedProject: false });
});

app.get('/api/workspace/suggestions', (req, res) => {
  try {
    res.json(listFolderSuggestions(req.query.base));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/files', (req, res) => {
  try {
    res.json({
      workspacePath: getWorkspacePath(),
      path: String(req.query.path || ''),
      entries: listDirectory(String(req.query.path || '')),
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/file', (req, res) => {
  try {
    const requestedPath = String(req.query.path || '');
    if (!requestedPath) return res.status(400).json({ error: 'File path is required.' });
    const state = loadState();
    const { resolved } = safeResolveInWorkspace(requestedPath, state);
    const stats = fs.statSync(resolved);
    if (!stats.isFile()) return res.status(400).json({ error: 'Path is not a file.' });
    if (isImageFile(resolved)) {
      return res.json({
        path: requestedPath,
        kind: 'image',
        size: stats.size,
        assetUrl: `/api/file-asset?path=${encodeURIComponent(requestedPath)}&token=${TOKEN}`,
      });
    }
    if (isVideoFile(resolved)) {
      return res.json({
        path: requestedPath,
        kind: 'video',
        size: stats.size,
        assetUrl: `/api/file-asset?path=${encodeURIComponent(requestedPath)}&token=${TOKEN}`,
      });
    }
    if (!isTextFile(resolved)) {
      return res.json({
        path: requestedPath,
        kind: 'binary',
        size: stats.size,
      });
    }
    if (stats.size > 300000) return res.status(400).json({ error: 'File is too large to preview.' });
    const content = fs.readFileSync(resolved, 'utf8');
    res.json({ path: requestedPath, kind: 'text', content, size: stats.size });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/file-asset', (req, res) => {
  try {
    const requestedPath = String(req.query.path || '');
    if (!requestedPath) return res.status(400).json({ error: 'File path is required.' });
    const state = loadState();
    const { resolved } = safeResolveInWorkspace(requestedPath, state);
    const stats = fs.statSync(resolved);
    if (!stats.isFile() || (!isImageFile(resolved) && !isVideoFile(resolved))) {
      return res.status(400).json({ error: 'Media file was not found.' });
    }
    res.setHeader('Content-Type', isVideoFile(resolved) ? inferVideoMime(resolved) : inferImageMime(resolved));
    fs.createReadStream(resolved).pipe(res);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

function handleMediaUpload(req, res) {
  try {
    const dataUrl = String(req.body?.dataUrl || '');
    const name = String(req.body?.name || 'media');
    if (!dataUrl) return res.status(400).json({ error: 'Media data is required.' });
    const workspace = getWorkspacePath();
    const workspaceUploadRoot = path.join(workspace, 'Antigravity Remote Uploads');
    ensureDir(workspaceUploadRoot);
    const absolutePath = saveDataUrlMedia(dataUrl, name, workspaceUploadRoot);
    const relativePath = toRelative(workspace, absolutePath);
    const publicCopy = path.join(UPLOAD_ROOT, path.basename(absolutePath));
    fs.copyFileSync(absolutePath, publicCopy);
    const kind = isVideoFile(absolutePath) ? 'video' : 'image';
    res.json({
      ok: true,
      file: {
        name: path.basename(absolutePath),
        path: relativePath,
        absolutePath,
        kind,
        assetUrl: `/api/file-asset?path=${encodeURIComponent(relativePath)}&token=${TOKEN}`,
        mirrorUrl: mediaUrlForAbsolute(publicCopy),
      },
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}

app.post('/api/upload-media', handleMediaUpload);

app.post('/api/upload-image', (req, res) => {
  handleMediaUpload(req, res);
});

app.post('/api/screenshot', async (_req, res) => {
  try {
    const capture = await captureDesktopScreenshot();
    res.json({ ok: true, capture });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/media/recent', (_req, res) => {
  const state = loadState();
  res.json({ ok: true, recentMedia: getRecentMedia(state) });
});

app.post('/api/model', (req, res) => {
  const model = String(req.body?.model || 'Auto').trim() || 'Auto';
  const customModel = String(req.body?.customModel || '').trim();
  const state = loadState();
  state.model = model;
  state.customModel = customModel;
  saveState(state);
  res.json({ ok: true, model, customModel });
});

app.get('/api/antigravity/state', async (_req, res) => {
  const state = await antigravityState();
  res.json({ ok: true, state });
});

app.post('/api/antigravity/send', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Text is required.' });
  const send = req.body?.send !== false;
  const state = await sendPromptToAntigravity(text, { send });
  res.json({ ok: true, state });
});

app.post('/api/antigravity/stop', async (_req, res) => {
  const state = await stopAntigravityRun();
  res.json({ ok: true, state });
});

app.post('/api/antigravity/new-conversation', async (_req, res) => {
  const result = await clickNewConversation();
  if (!result.ok) return res.status(404).json({ error: result.reason || 'New conversation button was not found.' });
  const state = await antigravityState();
  res.json({ ok: true, state });
});

app.post('/api/antigravity/select-project', async (req, res) => {
  const project = String(req.body?.project || '').trim();
  if (!project) return res.status(400).json({ error: 'Project is required.' });
  const result = await selectProject(project);
  if (!result.ok) return res.status(404).json({ error: result.reason || 'Project was not found.' });
  syncWorkspacePathForProject(project);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const state = await antigravityState();
  res.json({ ok: true, state });
});

app.post('/api/antigravity/switch-project', async (req, res) => {
  const project = String(req.body?.project || '').trim();
  if (!project) return res.status(400).json({ error: 'Project is required.' });
  const result = await switchProjectAndOpenConversation(project);
  if (!result.ok) return res.status(404).json({ error: result.reason || 'Project switch failed.' });
  const workspace = syncWorkspacePathForProject(project);
  const state = await antigravityState();
  res.json({ ok: true, workspacePath: workspace.path, state });
});

app.post('/api/antigravity/select-conversation', async (req, res) => {
  const conversationId = String(req.body?.conversationId || '').trim();
  if (!conversationId) return res.status(400).json({ error: 'Conversation id is required.' });
  const result = await selectConversation(conversationId);
  if (!result.ok) return res.status(404).json({ error: result.reason || 'Conversation was not found.' });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const state = await antigravityState();
  res.json({ ok: true, state });
});

app.post('/api/antigravity/select-model', async (req, res) => {
  const model = String(req.body?.model || '').trim();
  if (!model) return res.status(400).json({ error: 'Model is required.' });
  const result = await selectModel(model);
  if (!result.ok) return res.status(404).json({ error: result.reason || 'Model was not found.' });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const state = await antigravityState();
  res.json({ ok: true, state });
});

app.post('/api/antigravity/pending-action', async (req, res) => {
  const actionKey = String(req.body?.actionKey || '').trim().toLowerCase();
  if (!actionKey) return res.status(400).json({ error: 'Action key is required.' });
  const result = await performPendingAction(actionKey);
  if (!result.ok) return res.status(404).json({ error: result.reason || 'Pending action was not found.' });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const state = await antigravityState();
  res.json({ ok: true, state });
});

app.get('/api/automation', (_req, res) => {
  const state = loadState();
  res.json({ ok: true, drafts: state.automationDrafts || [] });
});

app.post('/api/automation/parse', (req, res) => {
  try {
    const draft = parseAutomationInstruction(req.body?.instruction);
    res.json({ ok: true, draft });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/automation/create', async (req, res) => {
  try {
    const draft = parseAutomationInstruction(req.body?.instruction);
    const state = loadState();
    const record = {
      id: `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`,
      ...draft,
      createdAt: new Date().toISOString(),
    };
    state.automationDrafts = [record, ...(state.automationDrafts || [])];
    saveState(state);

    let agState = null;
    if (req.body?.sendToAntigravity !== false) {
      agState = await sendPromptToAntigravity(record.commandText, { send: true });
    }

    res.json({ ok: true, draft: record, drafts: state.automationDrafts, state: agState });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/tasks', (_req, res) => {
  const state = loadState();
  res.json({ tasks: state.tasks || [] });
});

app.post('/api/tasks', (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Text is required.' });

  const state = loadState();
  const model = String(req.body?.model || state.model || 'Auto');
  const customModel = String(req.body?.customModel || state.customModel || '').trim();
  const selectedModel = model === 'Custom' && customModel ? customModel : model;
  const task = {
    id: `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`,
    text,
    model: selectedModel,
    workspacePath: getWorkspacePath(state),
    fileContext: req.body?.fileContext || null,
    status: 'queued',
    createdAt: new Date().toISOString(),
  };
  state.tasks = [task, ...(state.tasks || [])];
  saveState(state);
  res.json({ task });
});

app.post('/api/tasks/:id/copy', async (req, res) => {
  const state = loadState();
  const task = (state.tasks || []).find((item) => item.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task was not found.' });

  await copyToClipboard(formatTaskForAntigravity(task));
  task.status = 'copied';
  task.copiedAt = new Date().toISOString();
  saveState(state);
  res.json({ ok: true, task });
});

app.post('/api/tasks/:id/paste', async (req, res) => {
  const state = loadState();
  const task = (state.tasks || []).find((item) => item.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task was not found.' });

  await pasteToAntigravity(formatTaskForAntigravity(task));
  task.status = 'pasted';
  task.pastedAt = new Date().toISOString();
  saveState(state);
  res.json({ ok: true, task });
});

app.post('/api/tasks/:id/complete', (req, res) => {
  const state = loadState();
  const task = (state.tasks || []).find((item) => item.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task was not found.' });

  task.status = 'done';
  task.response = String(req.body?.response || task.response || '').trim();
  task.completedAt = new Date().toISOString();
  saveState(state);
  res.json({ ok: true, task });
});

app.post('/api/open-antigravity', async (_req, res) => {
  await openAntigravity();
  res.json({ ok: true, antigravity: getAntigravityStatus() });
});

if (fs.existsSync(DIST_PATH)) {
  app.use(express.static(DIST_PATH));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(DIST_PATH, 'index.html'));
  });
}

app.listen(PORT, HOST, () => {
  const urls = writeConnectionFile();
  console.log('Antigravity Remote is running.');
  console.log(`Token: ${TOKEN}`);
  for (const url of urls) {
    console.log(`URL: ${url}?token=${TOKEN}`);
  }
  console.log(`Connection file: ${CONNECTION_PATH}`);
});
