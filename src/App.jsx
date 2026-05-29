import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  Copy,
  FileText,
  FolderOpen,
  History,
  MoreHorizontal,
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

function formatModelUsage(value) {
  const text = String(value || '').trim();
  return text;
}

export default function App() {
  const threadViewRef = useRef(null);
  const threadEndRef = useRef(null);
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
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [filesBusy, setFilesBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [showFolderPanel, setShowFolderPanel] = useState(false);
  const [showMorePanel, setShowMorePanel] = useState(false);
  const [selectedFileKind, setSelectedFileKind] = useState('');

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

  const loadFiles = useCallback(
    async (relativePath = '') => {
      if (!token) return;
      setFilesBusy(true);
      setSelectedFilePath('');
      setSelectedFileContent('');
      setSelectedFileKind('');
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
        setSelectedFileContent(result.content || '');
        setSelectedFileKind('file');
      } catch (error) {
        setNotice(error.message);
      } finally {
        setFilesBusy(false);
      }
    },
    [api],
  );

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const [statusResult, stateResult] = await Promise.all([
        api('/api/status'),
        api('/api/antigravity/state'),
      ]);
      setStatus(statusResult);
      setAgState(stateResult.state);
      setWorkspacePath(statusResult.workspacePath || '');
      setFolderInput((current) => current || statusResult.workspacePath || '');
    } catch (error) {
      setNotice(error.message);
    }
  }, [api, token]);

  const loadSuggestions = useCallback(async () => {
    if (!token) return;
    try {
      const result = await api('/api/workspace/suggestions');
      setFolderSuggestions(result.entries || []);
    } catch (error) {
      setNotice(error.message);
    }
  }, [api, token]);

  useEffect(() => {
    if (!token) return undefined;
    const firstLoad = setTimeout(() => {
      refresh();
      loadSuggestions();
      loadFiles('');
    }, 0);
    const timer = setInterval(() => {
      refresh();
    }, 1500);
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

  const threadSignature = useMemo(
    () => (agState?.threadBlocks || []).map((block) => `${block.id}:${block.text.length}`).join('|'),
    [agState?.threadBlocks],
  );

  useEffect(() => {
    const node = threadViewRef.current;
    const endNode = threadEndRef.current;
    if (!node || !endNode) return;
    if (!shouldAutoScrollRef.current) return;
    const scrollToEnd = () => {
      endNode.scrollIntoView({ block: 'end' });
      node.scrollTop = node.scrollHeight;
    };
    requestAnimationFrame(scrollToEnd);
    const timer = window.setTimeout(scrollToEnd, 120);
    return () => window.clearTimeout(timer);
  }, [agState?.currentConversation, threadSignature]);

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
  const modelUsage = useMemo(() => formatModelUsage(agState?.modelUsage), [agState?.modelUsage]);
  const compactWorkspaceLabel = useMemo(() => {
    const currentProject = String(agState?.currentProject || '').trim();
    const folderName = String(shortPathLabel(workspacePath) || '').trim();
    if (!folderName) return '';
    return currentProject && currentProject === folderName ? '' : folderName;
  }, [agState?.currentProject, workspacePath]);

  const modelOptions = (() => {
    const items = agState?.models || [];
    if (agState?.currentModel && !items.includes(agState.currentModel)) {
      return [agState.currentModel, ...items];
    }
    return items;
  })();

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
      setNotice(`Workspace changed to ${nextName}.`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendPrompt(sendNow) {
    const cleanText = text.trim();
    if (!cleanText) return;
    setBusy(true);
    setNotice('');
    try {
      const result = await api('/api/antigravity/send', {
        method: 'POST',
        body: JSON.stringify({ text: cleanText, send: sendNow }),
      });
      setAgState(result.state);
      setNotice(sendNow ? 'Prompt sent.' : 'Draft inserted into the desktop input.');
      if (sendNow) setText('');
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
          <p>Open the URL from `connection.txt`, or paste the token to connect.</p>
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
            <span>履歴</span>
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
          <span>{status?.antigravity?.running ? '接続中' : '未起動'}</span>
        </div>
        <div className="status-meta">
          <span>{agState?.currentProject || 'No project'}</span>
          {compactWorkspaceLabel ? <span>{compactWorkspaceLabel}</span> : null}
        </div>
      </section>

      <section ref={threadViewRef} className="thread-view" onScroll={handleThreadScroll}>
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

      <section className="composer-dock">
        {(agState?.pendingActions || []).length ? (
          <div className="approval-bar">
            <span className="approval-label">Review</span>
            <div className="approval-actions">
              {agState.pendingActions.map((action) => (
                <button
                  key={action.actionKey}
                  type="button"
                  className={/^(reject|deny|no|cancel)$/i.test(action.label) ? 'secondary-button' : 'tool-button primary compact-action'}
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
          {modelUsage ? (
            <div className="composer-submeta">
              <span className="usage-chip">{modelUsage}</span>
            </div>
          ) : null}
          <textarea
            id="task-input"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Antigravityに送りたい内容を書く"
            rows={2}
          />
          <div className="composer-actions">
            <button
              type="button"
              className="tool-button secondary"
              onClick={() => sendPrompt(false)}
              disabled={busy || !text.trim()}
            >
              <WandSparkles size={15} />
              <span>下書き</span>
            </button>
            <button
              type="button"
              className="tool-button primary send-primary"
              onClick={() => sendPrompt(true)}
              disabled={busy || !text.trim()}
            >
              <Send size={16} />
              <span>送信</span>
            </button>
          </div>
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
          <strong>履歴 / フォルダ</strong>
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
                      loadFiles(entry.path);
                    } else {
                      openFile(entry.path);
                    }
                  }}
                  disabled={filesBusy}
                >
                  <span className="browser-entry-main">
                    {entry.isDir ? <FolderOpen size={15} /> : <FileText size={15} />}
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
        {selectedFilePath && selectedFileKind === 'file' ? (
          <div className="file-sheet-backdrop" onClick={() => {
            setSelectedFilePath('');
            setSelectedFileContent('');
            setSelectedFileKind('');
          }} />
        ) : null}
        <div className={selectedFilePath && selectedFileKind === 'file' ? 'file-sheet open' : 'file-sheet'}>
          <div className="file-sheet-head">
            <div>
              <div className="section-label">File</div>
              <div className="file-sheet-name">{shortPathLabel(selectedFilePath)}</div>
              <div className="file-sheet-path">{selectedFilePath}</div>
            </div>
            <button type="button" className="icon-button light" onClick={() => {
              setSelectedFilePath('');
              setSelectedFileContent('');
              setSelectedFileKind('');
            }}>
              <X size={16} />
            </button>
          </div>
          <div className="file-sheet-actions">
            <button type="button" className="secondary-button" onClick={() => copyText(selectedFilePath, 'File path copied.')}>
              コピー
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => copyText(selectedFileContent, 'File content copied.')}
              disabled={!selectedFileContent}
            >
              本文コピー
            </button>
          </div>
          <div className="preview-card file-sheet-preview">
            <pre>{selectedFileContent || 'File preview will appear here.'}</pre>
          </div>
        </div>
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
          </div>
        </div>
      </aside>
    </main>
  );
}
