import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Camera,
  ChevronLeft,
  Copy,
  FileImage,
  FileText,
  Film,
  FolderOpen,
  Goal,
  History,
  ImagePlus,
  MoreHorizontal,
  Paperclip,
  Plus,
  RefreshCw,
  Send,
  WandSparkles,
  X,
} from 'lucide-react';

function getInitialToken() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (token) {
    localStorage.setItem('antigravityRemoteToken', token);
    return token;
  }
  return localStorage.getItem('antigravityRemoteToken') || '';
}

function blockTitle(kind) {
  if (kind === 'user-turn') return 'You';
  if (kind === 'agent-turn') return 'Antigravity';
  return 'System';
}

function shortConversationTitle(title) {
  if (!title) return 'Untitled conversation';
  return title.length > 72 ? `${title.slice(0, 72)}...` : title;
}

function shortPathLabel(value) {
  const parts = String(value || '').split(/[/\\]/).filter(Boolean);
  return parts.at(-1) || value || 'folder';
}

function buildThreadSignatureFromState(state) {
  return (state?.threadBlocks || []).map((block) => `${block.id}:${block.text.length}`).join('|');
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read the file.'));
    reader.readAsDataURL(file);
  });
}

function attachmentInstructionLabel(item) {
  return item?.kind === 'video' ? 'Video attachment' : 'Image attachment';
}

const COMMAND_PRESETS = [
  { label: '/goal', value: '/goal ' },
  { label: '/automation', value: '/automation ' },
  { label: '/review', value: '/review ' },
  { label: '/memory', value: '/memory ' },
];

export default function App() {
  const threadViewRef = useRef(null);
  const threadEndRef = useRef(null);
  const composerDockRef = useRef(null);
  const fileInputRef = useRef(null);
  const shouldAutoScrollRef = useRef(true);
  const previousConversationRef = useRef('');
  const [token, setToken] = useState(getInitialToken);
  const [status, setStatus] = useState(null);
  const [agState, setAgState] = useState(null);
  const [workspacePath, setWorkspacePath] = useState('');
  const [folderInput, setFolderInput] = useState('');
  const [folderSuggestions, setFolderSuggestions] = useState([]);
  const [browserPath, setBrowserPath] = useState('');
  const [fileEntries, setFileEntries] = useState([]);
  const [selectedFilePath, setSelectedFilePath] = useState('');
  const [selectedFileContent, setSelectedFileContent] = useState('');
  const [selectedFileKind, setSelectedFileKind] = useState('');
  const [selectedFileAssetUrl, setSelectedFileAssetUrl] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [filesBusy, setFilesBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [showFolderPanel, setShowFolderPanel] = useState(false);
  const [showMorePanel, setShowMorePanel] = useState(false);
  const [recentMedia, setRecentMedia] = useState({ captures: [], uploads: [], workspaceImages: [] });
  const [attachments, setAttachments] = useState([]);
  const [automationInstruction, setAutomationInstruction] = useState('');
  const [automationDrafts, setAutomationDrafts] = useState([]);
  const [composerBottomOffset, setComposerBottomOffset] = useState(0);
  const [composerHeight, setComposerHeight] = useState(220);
  const [awaitingResponse, setAwaitingResponse] = useState(null);

  const api = useCallback(
    async (path, options = {}) => {
      const response = await fetch(path, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'x-antigravity-token': token,
          ...(options.headers || {}),
        },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || `Request failed: ${response.status}`);
      }
      return body;
    },
    [token],
  );

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const [statusResult, stateResult, automationResult] = await Promise.all([
        api('/api/status'),
        api('/api/antigravity/state'),
        api('/api/automation'),
      ]);
      setStatus(statusResult);
      setAgState(stateResult.state);
      if (
        awaitingResponse &&
        buildThreadSignatureFromState(stateResult.state) !== awaitingResponse.baselineSignature
      ) {
        setAwaitingResponse(null);
      }
      setWorkspacePath(statusResult.workspacePath || '');
      setFolderInput((current) => current || statusResult.workspacePath || '');
      setRecentMedia(statusResult.recentMedia || { captures: [], uploads: [], workspaceImages: [] });
      setAutomationDrafts(automationResult.drafts || []);
    } catch (error) {
      setNotice(error.message);
    }
  }, [api, awaitingResponse, token]);

  const loadSuggestions = useCallback(async () => {
    if (!token) return;
    try {
      const result = await api('/api/workspace/suggestions');
      setFolderSuggestions(result.entries || []);
    } catch (error) {
      setNotice(error.message);
    }
  }, [api, token]);

  const loadFiles = useCallback(
    async (relativePath = '') => {
      if (!token) return;
      setFilesBusy(true);
      setSelectedFilePath('');
      setSelectedFileContent('');
      setSelectedFileKind('');
      setSelectedFileAssetUrl('');
      try {
        const result = await api(`/api/files?path=${encodeURIComponent(relativePath)}`);
        setBrowserPath(result.path || '');
        setFileEntries(result.entries || []);
      } catch (error) {
        setNotice(error.message);
      } finally {
        setFilesBusy(false);
      }
    },
    [api, token],
  );

  const openFile = useCallback(
    async (relativePath) => {
      if (!relativePath) return;
      setFilesBusy(true);
      try {
        const result = await api(`/api/file?path=${encodeURIComponent(relativePath)}`);
        setSelectedFilePath(result.path);
        setSelectedFileKind(result.kind || 'text');
        setSelectedFileContent(result.content || '');
        setSelectedFileAssetUrl(result.assetUrl || '');
      } catch (error) {
        setNotice(error.message);
      } finally {
        setFilesBusy(false);
      }
    },
    [api],
  );

  useEffect(() => {
    if (!token) return undefined;
    const firstLoad = setTimeout(() => {
      refresh();
      loadSuggestions();
      loadFiles('');
    }, 0);
    const timer = setInterval(() => {
      refresh();
    }, 1800);
    return () => {
      clearTimeout(firstLoad);
      clearInterval(timer);
    };
  }, [loadFiles, loadSuggestions, refresh, token]);

  useEffect(() => {
    const currentConversation = agState?.currentConversation || '';
    if (currentConversation !== previousConversationRef.current) {
      previousConversationRef.current = currentConversation;
      shouldAutoScrollRef.current = true;
    }
  }, [agState?.currentConversation]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return undefined;
    const updateOffset = () => {
      const next = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setComposerBottomOffset(next);
    };
    updateOffset();
    viewport.addEventListener('resize', updateOffset);
    viewport.addEventListener('scroll', updateOffset);
    window.addEventListener('orientationchange', updateOffset);
    return () => {
      viewport.removeEventListener('resize', updateOffset);
      viewport.removeEventListener('scroll', updateOffset);
      window.removeEventListener('orientationchange', updateOffset);
    };
  }, []);

  useEffect(() => {
    const node = composerDockRef.current;
    if (!node) return undefined;
    const updateHeight = () => {
      setComposerHeight(node.getBoundingClientRect().height || 220);
    };
    updateHeight();
    if (!window.ResizeObserver) return undefined;
    const observer = new ResizeObserver(updateHeight);
    observer.observe(node);
    return () => observer.disconnect();
  }, [agState?.pendingActions, attachments.length, notice, text, composerBottomOffset]);

  const threadSignature = useMemo(() => buildThreadSignatureFromState(agState), [agState]);

  useEffect(() => {
    const node = threadViewRef.current;
    const endNode = threadEndRef.current;
    if (!node || !endNode || !shouldAutoScrollRef.current) return;
    const scrollToEnd = () => {
      endNode.scrollIntoView({ block: 'end' });
      node.scrollTop = node.scrollHeight;
    };
    requestAnimationFrame(scrollToEnd);
    const timer = window.setTimeout(scrollToEnd, 120);
    return () => window.clearTimeout(timer);
  }, [agState?.currentConversation, threadSignature, recentMedia]);

  const handleThreadScroll = useCallback(() => {
    const node = threadViewRef.current;
    if (!node) return;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 80;
  }, []);

  const currentConversationTitle = useMemo(
    () => shortConversationTitle(agState?.currentConversation),
    [agState?.currentConversation],
  );

  const threadBottomPadding = Math.max(240, Math.ceil(composerHeight + composerBottomOffset + 24));

  const modelOptions = (() => {
    const items = agState?.models || [];
    if (agState?.currentModel && !items.includes(agState.currentModel)) {
      return [agState.currentModel, ...items];
    }
    return items;
  })();

  const compactWorkspaceLabel = useMemo(() => {
    const currentProject = String(agState?.currentProject || '').trim();
    const folderName = String(shortPathLabel(workspacePath) || '').trim();
    if (!folderName) return '';
    return currentProject && currentProject === folderName ? '' : folderName;
  }, [agState?.currentProject, workspacePath]);

  const mediaItems = useMemo(
    () => [...(recentMedia.workspaceImages || []), ...(recentMedia.uploads || []), ...(recentMedia.captures || [])].slice(0, 12),
    [recentMedia],
  );

  async function connect(event) {
    event.preventDefault();
    localStorage.setItem('antigravityRemoteToken', token);
    await refresh();
    await loadSuggestions();
    await loadFiles('');
  }

  async function openAntigravity() {
    setBusy(true);
    setNotice('');
    try {
      await api('/api/open-antigravity', { method: 'POST' });
      await refresh();
      setNotice('Desktop app started.');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function startNewConversation() {
    setBusy(true);
    setNotice('');
    try {
      const result = await api('/api/antigravity/new-conversation', { method: 'POST' });
      setAgState(result.state);
      setShowHistoryPanel(false);
      setNotice('Opened a new conversation.');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function switchProject(project) {
    setBusy(true);
    setNotice('');
    try {
      const result = await api('/api/antigravity/switch-project', {
        method: 'POST',
        body: JSON.stringify({ project }),
      });
      setAgState(result.state);
      if (result.workspacePath) {
        setWorkspacePath(result.workspacePath);
        setFolderInput(result.workspacePath);
      }
      setSelectedFilePath('');
      setSelectedFileContent('');
      setSelectedFileKind('');
      setSelectedFileAssetUrl('');
      await loadFiles('');
      setShowHistoryPanel(false);
      setNotice(`Project switched to ${project}.`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function selectConversation(conversationId) {
    setBusy(true);
    setNotice('');
    try {
      const result = await api('/api/antigravity/select-conversation', {
        method: 'POST',
        body: JSON.stringify({ conversationId }),
      });
      setAgState(result.state);
      setShowHistoryPanel(false);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function selectModel(model) {
    setBusy(true);
    setNotice('');
    try {
      const result = await api('/api/antigravity/select-model', {
        method: 'POST',
        body: JSON.stringify({ model }),
      });
      setAgState(result.state);
      setNotice(`Model switched to ${model}.`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function performPendingAction(actionKey) {
    setBusy(true);
    setNotice('');
    try {
      const result = await api('/api/antigravity/pending-action', {
        method: 'POST',
        body: JSON.stringify({ actionKey }),
      });
      setAgState(result.state);
      setNotice(`Action sent: ${actionKey}`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function updateWorkspace(path) {
    const nextPath = String(path || folderInput).trim();
    if (!nextPath) return;
    setBusy(true);
    setNotice('');
    try {
      const result = await api('/api/workspace', {
        method: 'POST',
        body: JSON.stringify({ path: nextPath }),
      });
      setWorkspacePath(result.path);
      setFolderInput(result.path);
      setSelectedFilePath('');
      setSelectedFileContent('');
      setSelectedFileKind('');
      setSelectedFileAssetUrl('');
      await loadSuggestions();
      await loadFiles('');
      setNotice('Workspace path updated.');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function selectWorkspaceSuggestion(name) {
    const nextName = String(name || '').trim();
    if (!nextName) return;
    setBusy(true);
    setNotice('');
    setSelectedFilePath('');
    setSelectedFileContent('');
    setSelectedFileKind('');
    setSelectedFileAssetUrl('');
    try {
      const result = await api('/api/workspace/select', {
        method: 'POST',
        body: JSON.stringify({ name: nextName }),
      });
      setWorkspacePath(result.path);
      setFolderInput(result.path);
      if (result.state) {
        setAgState(result.state);
      }
      await loadSuggestions();
      await loadFiles('');
      await refresh();
      setNotice(`Workspace changed to ${nextName}.`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  function buildOutgoingText(baseText) {
    const cleanText = String(baseText || '').trim();
    const attachmentLines = attachments.map((item) => `${attachmentInstructionLabel(item)}: ${item.path}`);
    if (!attachmentLines.length) return cleanText;
    return `${cleanText}\n\n${attachmentLines.join('\n')}\nUse these local files when responding.`;
  }

  async function sendPrompt(sendNow) {
    const cleanText = text.trim();
    if (!cleanText) return;
    setBusy(true);
    setNotice('');
    try {
      const result = await api('/api/antigravity/send', {
        method: 'POST',
        body: JSON.stringify({ text: buildOutgoingText(cleanText), send: sendNow }),
      });
      setAgState(result.state);
      setNotice(sendNow ? 'Prompt sent.' : 'Draft inserted into the desktop input.');
      if (sendNow) {
        setAwaitingResponse({
          baselineSignature: buildThreadSignatureFromState(result.state),
          startedAt: Date.now(),
        });
        setText('');
        setAttachments([]);
      }
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function stopPrompt() {
    setBusy(true);
    setNotice('');
    try {
      const result = await api('/api/antigravity/stop', { method: 'POST' });
      setAgState(result.state);
      setAwaitingResponse(null);
      setNotice('Stopped.');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function copyText(value, label = 'Copied.') {
    const textValue = String(value || '');
    if (!textValue) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(textValue);
      } else {
        const area = document.createElement('textarea');
        area.value = textValue;
        area.setAttribute('readonly', 'true');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
      }
      setNotice(label);
    } catch (error) {
      setNotice(error.message || 'Copy failed.');
    }
  }

  function insertCommand(value) {
    setText((current) => (current.trim() ? `${current}\n${value}` : value));
    setShowMorePanel(false);
  }

  async function uploadSelectedMedia(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setNotice('');
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const result = await api('/api/upload-media', {
        method: 'POST',
        body: JSON.stringify({ name: file.name, dataUrl }),
      });
      setAttachments((current) => [result.file, ...current].slice(0, 4));
      await loadFiles('');
      await refresh();
      setNotice(`${result.file.kind === 'video' ? 'Video' : 'Image'} attached: ${result.file.name}`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      event.target.value = '';
      setBusy(false);
    }
  }

  async function captureScreenshot() {
    setBusy(true);
    setNotice('');
    try {
      const result = await api('/api/screenshot', { method: 'POST' });
      setRecentMedia((current) => ({
        ...current,
        captures: [result.capture, ...(current.captures || [])].slice(0, 8),
      }));
      setNotice('Desktop screenshot captured.');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function createAutomation(sendToAntigravity = true) {
    const instruction = automationInstruction.trim();
    if (!instruction) return;
    setBusy(true);
    setNotice('');
    try {
      const result = await api('/api/automation/create', {
        method: 'POST',
        body: JSON.stringify({ instruction, sendToAntigravity }),
      });
      setAutomationDrafts(result.drafts || []);
      if (result.state) {
        setAgState(result.state);
      }
      setAutomationInstruction('');
      setNotice(sendToAntigravity ? 'Automation command sent to Antigravity.' : 'Automation draft saved.');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  const openParentFolder = () => {
    if (!browserPath) return;
    const parts = browserPath.split('/').filter(Boolean);
    parts.pop();
    loadFiles(parts.join('/'));
  };

  if (!token) {
    return (
      <main className="login-shell">
        <section className="login-panel">
          <FolderOpen size={34} />
          <h1>Antigravity Remote</h1>
          <p>Open the URL from connection.txt, or paste the token to connect.</p>
          <form onSubmit={connect} className="login-form">
            <input value={token} onChange={(event) => setToken(event.target.value)} placeholder="token" />
            <button type="submit">Connect</button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="mobile-shell">
      <header className="topbar">
        <div className="topbar-left">
          <button
            type="button"
            className="nav-chip"
            onClick={() => {
              setShowHistoryPanel(true);
              setShowFolderPanel(false);
              setShowMorePanel(false);
            }}
          >
            <History size={16} />
            <span>髯橸ｽｻ繝ｻ・･髮弱・・ｽ・ｴ</span>
          </button>
          <div className="title-slot">
            <strong>{currentConversationTitle}</strong>
          </div>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            className="icon-button light"
            title="Folders"
            onClick={() => {
              setShowFolderPanel((current) => !current);
              setShowHistoryPanel(false);
              setShowMorePanel(false);
              setSelectedFilePath('');
              setSelectedFileContent('');
              setSelectedFileKind('');
              setSelectedFileAssetUrl('');
            }}
          >
            <FolderOpen size={18} />
          </button>
          <button
            type="button"
            className="icon-button light"
            title="More"
            onClick={() => {
              setShowMorePanel((current) => !current);
              setShowHistoryPanel(false);
              setShowFolderPanel(false);
            }}
          >
            <MoreHorizontal size={18} />
          </button>
        </div>
      </header>

      <section className="status-row">
        <div className={status?.antigravity?.running ? 'status-pill ok' : 'status-pill'}>
          <span className="dot" />
          <span>{status?.antigravity?.running ? 'Connected' : 'Offline'}</span>
        </div>
        {awaitingResponse ? (
          <div className="status-pill working">
            <span className="dot" />
            <span>Working</span>
          </div>
        ) : null}
        <div className="status-meta">
          <span>{agState?.currentProject || 'No project'}</span>
          {compactWorkspaceLabel ? <span>{compactWorkspaceLabel}</span> : null}
          {awaitingResponse ? <span>Waiting for output</span> : null}
          {status?.platform ? <span>{status.platform}</span> : null}
        </div>
      </section>

      <section
        ref={threadViewRef}
        className="thread-view"
        onScroll={handleThreadScroll}
        style={{ paddingBottom: `${threadBottomPadding}px`, scrollPaddingBottom: `${threadBottomPadding}px` }}
      >
        {mediaItems.length ? (
          <section className="media-strip">
            <div className="thread-card-head">Recent media</div>
            <div className="media-grid">
              {mediaItems.map((item) => (
                <button
                  key={`${item.source || 'media'}-${item.path || item.name}`}
                  type="button"
                  className="media-card"
                  onClick={() => {
                    if (item.path) {
                      setSelectedFilePath(item.path);
                      setSelectedFileKind(item.kind || (isVideoFileName(item.name) ? 'video' : 'image'));
                      setSelectedFileAssetUrl(item.url);
                      setSelectedFileContent('');
                      setShowFolderPanel(true);
                      setShowHistoryPanel(false);
                      setShowMorePanel(false);
                    }
                  }}
                >
                  {item.kind === 'video' || isVideoFileName(item.name) ? (
                    <video src={item.url} muted playsInline preload="metadata" />
                  ) : (
                    <img src={item.url} alt={item.name || 'media'} />
                  )}
                  <span>{shortPathLabel(item.path || item.name)}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {(agState?.threadBlocks || []).length ? (
          <>
            {agState.threadBlocks.map((block) => (
              <article key={block.id} className={`thread-card ${block.kind}`}>
                <div className="thread-card-head">{blockTitle(block.kind)}</div>
                <pre>{block.text}</pre>
              </article>
            ))}
            <div ref={threadEndRef} className="thread-end-anchor" />
          </>
        ) : (
          <p className="empty">No conversation content has been mirrored yet.</p>
        )}
      </section>

      <section
        ref={composerDockRef}
        className={composerBottomOffset > 0 ? 'composer-dock keyboard-open' : 'composer-dock'}
        style={{ bottom: `${composerBottomOffset}px` }}
      >
        {(agState?.pendingActions || []).length ? (
          <div className="approval-bar">
            <span className="approval-label">Review</span>
            {agState?.approvalPrompt?.title ? <strong className="approval-title">{agState.approvalPrompt.title}</strong> : null}
            {agState?.approvalPrompt?.body ? <p className="approval-body">{agState.approvalPrompt.body}</p> : null}
            <div className="approval-actions">
              {agState.pendingActions.map((action) => (
                <button
                  key={action.actionKey}
                  type="button"
                  className={
                    /^(reject|deny|no|cancel|skip)/i.test(action.label)
                      ? 'secondary-button'
                      : action.kind === 'submit'
                        ? 'tool-button primary compact-action'
                        : 'tool-button secondary compact-action'
                  }
                  onClick={() => performPendingAction(action.actionKey)}
                  disabled={busy || action.disabled}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {notice ? <p className="notice dock-notice">{notice}</p> : null}
        {awaitingResponse ? <p className="notice dock-notice">Sent. Showing working state until output appears.</p> : null}
        <div className="composer-card">
          <div className="composer-meta">
            <label className="model-field">
              <span className="meta-label">Model</span>
              <select
                value={agState?.currentModel || ''}
                onChange={(event) => selectModel(event.target.value)}
                disabled={busy || !modelOptions.length}
              >
                {modelOptions.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="chip-list command-list">
            {COMMAND_PRESETS.map((command) => (
              <button
                key={command.label}
                type="button"
                className="chip-button"
                onClick={() => insertCommand(command.value)}
                disabled={busy}
              >
                {command.label}
              </button>
            ))}
          </div>

          {attachments.length ? (
            <div className="attachment-list">
              {attachments.map((item) => (
                <div key={item.path} className="attachment-chip">
                  <Paperclip size={14} />
                  <span>{shortPathLabel(item.path)}</span>
                  <small>{item.kind === 'video' ? 'video' : 'image'}</small>
                  <button type="button" className="tiny-button" onClick={() => setAttachments((current) => current.filter((entry) => entry.path !== item.path))}>
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <textarea
            id="task-input"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Write a message for Antigravity"
            rows={3}
          />
          <div className="composer-actions">
            <button
              type="button"
              className="tool-button secondary"
              onClick={() => sendPrompt(false)}
              disabled={busy || !text.trim()}
            >
              <WandSparkles size={15} />
              <span>Draft</span>
            </button>
            <button
              type="button"
              className="tool-button secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            >
              <ImagePlus size={15} />
              <span>Attach media</span>
            </button>
            <button
              type="button"
              className="tool-button stop-button"
              onClick={stopPrompt}
              disabled={busy || (!awaitingResponse && !agState?.canStop)}
            >
              <X size={15} />
              <span>Stop</span>
            </button>
            <button
              type="button"
              className="tool-button primary send-primary"
              onClick={() => sendPrompt(true)}
              disabled={busy || !text.trim()}
            >
              <Send size={16} />
              <span>Send</span>
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/mp4,video/webm,video/quicktime,video/x-m4v,video/ogg,.mov,.m4v,.ogv"
            hidden
            onChange={uploadSelectedMedia}
          />
        </div>
      </section>

      {showHistoryPanel || showFolderPanel || showMorePanel ? (
        <div
          className="overlay-backdrop"
          onClick={() => {
            setShowHistoryPanel(false);
            setShowFolderPanel(false);
            setShowMorePanel(false);
          }}
        />
      ) : null}

      <aside className={showHistoryPanel ? 'side-drawer open' : 'side-drawer'} aria-hidden={!showHistoryPanel}>
        <div className="drawer-top">
          <strong>髯橸ｽｻ繝ｻ・･髮弱・・ｽ・ｴ / 驛｢譎・ｽｼ譁青ｰ驛｢譎｢・ｽ・ｫ驛｢謨鳴</strong>
          <button type="button" className="icon-button light" onClick={() => setShowHistoryPanel(false)}>
            <X size={16} />
          </button>
        </div>
        <div className="drawer-section">
          <button type="button" className="wide-button primary-alt" onClick={startNewConversation} disabled={busy}>
            <Plus size={16} />
            <span>New Conversation</span>
          </button>
        </div>
        <div className="drawer-section grow">
          <div className="section-label">Projects</div>
          <div className="drawer-list">
            {(agState?.projectSections || []).map((section) => (
              <div key={section.id} className="project-section">
                <button
                  type="button"
                  className={section.title === agState?.currentProject ? 'list-item active' : 'list-item'}
                  onClick={() => switchProject(section.title)}
                  disabled={busy}
                >
                  <span>{section.title}</span>
                  <span className="item-meta">{section.conversations?.length || 0}</span>
                </button>
                {section.conversations?.length ? (
                  <div className="conversation-sublist">
                    {section.conversations.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={item.active ? 'sub-item active' : 'sub-item'}
                        onClick={() => selectConversation(item.id)}
                        disabled={busy}
                      >
                        {shortConversationTitle(item.title)}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </aside>

      <aside className={showFolderPanel ? 'right-panel open' : 'right-panel'} aria-hidden={!showFolderPanel}>
        <div className="drawer-top">
          <strong>Folders</strong>
          <button type="button" className="icon-button light" onClick={() => setShowFolderPanel(false)}>
            <X size={16} />
          </button>
        </div>
        <div className="drawer-section">
          <div className="panel-head">
            <div className="section-label">Current workspace</div>
            <button
              type="button"
              className="tiny-button"
              onClick={() => copyText(workspacePath, 'Workspace path copied.')}
              disabled={!workspacePath}
            >
              <Copy size={14} />
            </button>
          </div>
          <div className="path-card">{workspacePath || 'No workspace selected'}</div>
        </div>
        <div className="drawer-section grow">
          <div className="panel-head">
            <div className="section-label">Current folder</div>
            <div className="panel-actions">
              <button type="button" className="tiny-button" onClick={openParentFolder} disabled={filesBusy || !browserPath}>
                <ChevronLeft size={14} />
              </button>
              <button
                type="button"
                className="tiny-button"
                onClick={() => copyText(browserPath || '.', 'Folder path copied.')}
              >
                <Copy size={14} />
              </button>
              <button type="button" className="tiny-button" onClick={() => loadFiles(browserPath)} disabled={filesBusy}>
                <RefreshCw size={14} />
              </button>
            </div>
          </div>
          <div className="path-inline">{browserPath || '.'}</div>
          <div className="drawer-list browser-list single-column">
            {fileEntries.map((entry) => (
              <div key={entry.path} className={selectedFilePath === entry.path ? 'browser-item active' : 'browser-item'}>
                <button
                  type="button"
                  className="browser-entry"
                  onClick={() => {
                    if (entry.isDir) {
                      setSelectedFilePath('');
                      setSelectedFileContent('');
                      setSelectedFileKind('');
                      setSelectedFileAssetUrl('');
                      loadFiles(entry.path);
                    } else {
                      openFile(entry.path);
                    }
                  }}
                  disabled={filesBusy}
                >
                  <span className="browser-entry-main">
                    {entry.isDir ? <FolderOpen size={15} /> : isVideoFileName(entry.name) ? <Film size={15} /> : isImageFileName(entry.name) ? <FileImage size={15} /> : <FileText size={15} />}
                    <span className="browser-entry-copy">
                      <span className="browser-entry-name">{entry.name}</span>
                      <span className="browser-entry-path">{entry.path}</span>
                    </span>
                  </span>
                  <span className="item-meta">{entry.isDir ? 'dir' : 'file'}</span>
                </button>
                <button
                  type="button"
                  className="tiny-button browser-copy"
                  onClick={() => copyText(entry.path, 'Path copied.')}
                >
                  <Copy size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
        <details className="workspace-switcher">
          <summary>Workspace switcher</summary>
          <div className="drawer-section">
            <input
              value={folderInput}
              onChange={(event) => setFolderInput(event.target.value)}
              placeholder="C:\\path\\to\\workspace"
            />
            <div className="button-row">
              <button type="button" onClick={() => updateWorkspace()} disabled={busy || !folderInput.trim()}>
                Use this folder
              </button>
              <button type="button" className="secondary-button" onClick={loadSuggestions} disabled={busy}>
                Refresh
              </button>
            </div>
            <div className="chip-list">
              {folderSuggestions.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  className="chip-button"
                  onClick={() => {
                    setFolderInput(entry.path);
                    selectWorkspaceSuggestion(entry.name);
                  }}
                  disabled={busy}
                >
                  {entry.name}
                </button>
              ))}
            </div>
          </div>
        </details>
        {selectedFilePath && selectedFileKind ? (
          <>
            <div
              className="file-sheet-backdrop"
              onClick={() => {
                setSelectedFilePath('');
                setSelectedFileContent('');
                setSelectedFileKind('');
                setSelectedFileAssetUrl('');
              }}
            />
            <div className="file-sheet open">
          <div className="file-sheet-head">
            <div>
              <div className="section-label">File</div>
              <div className="file-sheet-name">{shortPathLabel(selectedFilePath)}</div>
              <div className="file-sheet-path">{selectedFilePath}</div>
            </div>
            <button
              type="button"
              className="icon-button light"
              onClick={() => {
                setSelectedFilePath('');
                setSelectedFileContent('');
                setSelectedFileKind('');
                setSelectedFileAssetUrl('');
              }}
            >
              <X size={16} />
            </button>
          </div>
          <div className="file-sheet-actions">
            <button type="button" className="secondary-button" onClick={() => copyText(selectedFilePath, 'File path copied.')}>
              驛｢・ｧ繝ｻ・ｳ驛｢譎・ｱ堤ｹ晢ｽｻ
            </button>
            {selectedFileKind === 'text' ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => copyText(selectedFileContent, 'File content copied.')}
                disabled={!selectedFileContent}
              >
                髫ｴ蟷｢・ｽ・ｬ髫ｴ竏壹・邵ｺ諷包ｽｹ譎・ｱ堤ｹ晢ｽｻ
              </button>
            ) : null}
          </div>
          <div className="preview-card file-sheet-preview">
            {selectedFileKind === 'image' ? (
              <img className="preview-image" src={selectedFileAssetUrl} alt={shortPathLabel(selectedFilePath)} />
            ) : selectedFileKind === 'video' ? (
              <video className="preview-video" src={selectedFileAssetUrl} controls playsInline preload="metadata" />
            ) : selectedFileKind === 'binary' ? (
              <pre>Binary file preview is not available.</pre>
            ) : (
              <pre>{selectedFileContent || 'File preview will appear here.'}</pre>
            )}
          </div>
            </div>
          </>
        ) : null}
      </aside>

      <aside className={showMorePanel ? 'bottom-panel open' : 'bottom-panel'} aria-hidden={!showMorePanel}>
        <div className="drawer-top">
          <strong>More</strong>
          <button type="button" className="icon-button light" onClick={() => setShowMorePanel(false)}>
            <X size={16} />
          </button>
        </div>
        <div className="drawer-section">
          <div className="section-label">Desktop</div>
          <div className="button-row">
            <button type="button" onClick={refresh} disabled={busy}>
              <RefreshCw size={15} />
              <span>Refresh</span>
            </button>
            <button type="button" className="secondary-button" onClick={openAntigravity} disabled={busy}>
              Open app
            </button>
            <button type="button" className="secondary-button" onClick={captureScreenshot} disabled={busy}>
              <Camera size={15} />
              <span>Screenshot</span>
            </button>
          </div>
        </div>
        <div className="drawer-section">
          <div className="section-label">Commands</div>
          <div className="chip-list">
            {COMMAND_PRESETS.map((command) => (
              <button key={command.label} type="button" className="chip-button" onClick={() => insertCommand(command.value)}>
                {command.label}
              </button>
            ))}
          </div>
        </div>
        <div className="drawer-section">
          <div className="section-label">Automation</div>
          <textarea
            value={automationInstruction}
            onChange={(event) => setAutomationInstruction(event.target.value)}
            placeholder="髣懆侭繝ｻ 髮惹ｺ･蜿呵輔・髫ｴ蠑ｱ・・ｫ企ｼ姉dex Remote驍ｵ・ｺ繝ｻ・ｮ髫ｰ・ｾ繝ｻ・ｹ髯懈ｺ倥・隲橸ｽｾ髮手｣懊・繝ｻ蟶晢ｿ｡繝ｻ・ｺ鬮ｫ・ｱ鬮ｦ・ｪ繝ｻ・ｰ驍ｵ・ｺ繝ｻ・ｦ髯懶ｽ｣繝ｻ・ｱ髯ｷ・ｻ驗呻ｽｫ繝ｻ・ｰ驍ｵ・ｺ繝ｻ・ｦ"
            rows={3}
          />
          <div className="button-row">
            <button type="button" onClick={() => createAutomation(true)} disabled={busy || !automationInstruction.trim()}>
              <Bot size={15} />
              <span>Send to Antigravity</span>
            </button>
            <button type="button" className="secondary-button" onClick={() => createAutomation(false)} disabled={busy || !automationInstruction.trim()}>
              <Goal size={15} />
              <span>Save draft</span>
            </button>
          </div>
          {automationDrafts.length ? (
            <div className="automation-list">
              {automationDrafts.slice(0, 6).map((draft) => (
                <div key={draft.id} className="automation-card">
                  <strong>{draft.title}</strong>
                  <span>{draft.rrule}</span>
                  <button type="button" className="tiny-button" onClick={() => copyText(draft.commandText, 'Automation command copied.')}>
                    <Copy size={13} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </aside>
    </main>
  );
}

function isImageFileName(name) {
  return /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(String(name || ''));
}

function isVideoFileName(name) {
  return /\.(mp4|webm|mov|m4v|ogv)$/i.test(String(name || ''));
}
