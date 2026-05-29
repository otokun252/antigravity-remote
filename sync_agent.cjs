const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// --- 簡易.envパーサー ---
let apiKey = '';
let defaultModel = 'gemini-3.5-flash';
try {
  const envPath = path.resolve(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8');
    envConfig.split(/\r?\n/).forEach(line => {
      if (line.trim().startsWith('#') || !line.includes('=')) return;
      const parts = line.split('=');
      const key = parts[0].trim();
      let value = parts.slice(1).join('=').trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.substring(1, value.length - 1);
      } else if (value.startsWith("'") && value.endsWith("'")) {
        value = value.substring(1, value.length - 1);
      }
      if (key === 'VITE_GEMINI_API_KEY') apiKey = value;
      if (key === 'VITE_GEMINI_DEFAULT_MODEL') defaultModel = value;
    });
  }
} catch (e) {
  console.error('[SyncAgent] .envのロードエラー:', e.message);
}

const SYNC_FILE_PATH = path.resolve(__dirname, 'chat_sync.json');

console.log('================================================================');
console.log('🌌 Antigravity 同期エージェント (sync_agent.cjs) が起動しました！');
console.log(`[SyncAgent] 監視ファイル: ${SYNC_FILE_PATH}`);
console.log(`[SyncAgent] 使用APIキー: ${apiKey ? '検出完了 (本物のAIで応答します)' : '未設定 (デモ応答を行います)'}`);
console.log(`[SyncAgent] デフォルトモデル: ${defaultModel}`);
console.log('================================================================');
console.log('[SyncAgent] メッセージの待機を開始します。3秒ごとにファイルをスキャンします...');

// Geminiの初期化
let genAI = null;
if (apiKey) {
  try {
    genAI = new GoogleGenerativeAI(apiKey);
  } catch (e) {
    console.error('[SyncAgent] Geminiの初期化に失敗しました:', e.message);
  }
}

// 同期ファイルの読み書きヘルパー
function readSyncFile() {
  try {
    if (fs.existsSync(SYNC_FILE_PATH)) {
      return JSON.parse(fs.readFileSync(SYNC_FILE_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('[SyncAgent] ファイルの読み込みに失敗しました:', e.message);
  }
  return { last_updated: new Date().toISOString(), messages: [], status: 'idle' };
}

function writeSyncFile(data) {
  try {
    data.last_updated = new Date().toISOString();
    fs.writeFileSync(SYNC_FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('[SyncAgent] ファイルの書き込みに失敗しました:', e.message);
  }
}

// AIでのメッセージ処理
async function processMessage(userMessage) {
  console.log('\n----------------------------------------------------------------');
  console.log(`📩 【新規メッセージ受信】: ${userMessage.user} から`);
  console.log(`💬 内容: "${userMessage.content}"`);
  if (userMessage.fileContext) {
    console.log(`📎 添付ファイル: ${userMessage.fileContext.path}`);
  }
  console.log('----------------------------------------------------------------');

  let replyText = '';

  // 1. 本物のAPIキーがある場合はGeminiで応答を生成
  if (genAI) {
    console.log(`🤖 Gemini ${defaultModel} に問い合わせています...`);
    try {
      const model = genAI.getGenerativeModel({
        model: defaultModel,
        systemInstruction: "You are Antigravity, a powerful agentic AI coding assistant designed by Google DeepMind. Answer in Japanese. Be premium, exact and extremely helpful."
      });
      
      let prompt = userMessage.content;
      if (userMessage.fileContext) {
        prompt = `【添付ファイル: ${userMessage.fileContext.path}】\n\n\`\`\`\n${userMessage.fileContext.content}\n\`\`\`\n\n質問: ${userMessage.content}`;
      }
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      replyText = response.text();
    } catch (e) {
      console.error('[SyncAgent] Gemini APIエラー:', e.message);
      replyText = `⚠️ Gemini APIでエラーが発生しました: ${e.message}`;
    }
  } else {
    // 2. APIキーがない場合のモック応答
    console.log('🤖 APIキー未設定のため、ローカル自動応答を生成しています...');
    await new Promise(r => setTimeout(r, 1000));
    
    if (userMessage.fileContext) {
      replyText = `📁 添付ファイル \`${userMessage.fileContext.path}\` をローカル中継エージェントが受け取りました！\n\n現在、\`.env\` ファイルに \`VITE_GEMINI_API_KEY\` が設定されていないため、実際のAIによるソースコード解析はスキップされました。\n\n**[ファイル内容のプレビュー]**:\n\`\`\`\n${userMessage.fileContext.content.substring(0, 300)}...\n\`\`\`\n\n**連携を本物にするには**:\nGoogle AI Studioで無料のAPIキーを取得し、\`.env\` に設定してください！`;
    } else {
      replyText = `🌌 Antigravity Console へようこそ！\n\nあなたのメッセージ **「${userMessage.content}」** は、ローカル中継サーバーを介してこの同期エージェントに正常に「直接送信」されました！\n\n現在はデモ中継状態です。本物のGemini 3.5の強大な知能で会話するには、\`.env\` ファイルに \`VITE_GEMINI_API_KEY\` を設定して、サーバーを再起動してください。`;
    }
  }

  console.log(`📤 【応答を送信】:`);
  console.log(`${replyText.substring(0, 100)}...`);
  console.log('----------------------------------------------------------------\n');
  
  return replyText;
}

// 監視・ポーリングループ
async function scanAndProcess() {
  const syncState = readSyncFile();
  const unreadMessage = syncState.messages.find(m => !m.processed);

  if (unreadMessage) {
    // ステータスを「思考中」に変更
    syncState.status = 'agent_thinking';
    writeSyncFile(syncState);

    // 応答の生成
    const responseText = await processMessage(unreadMessage);

    // 応答の書き込みとステータス復帰
    const freshSyncState = readSyncFile();
    const msgIndex = freshSyncState.messages.findIndex(m => m.id === unreadMessage.id);
    
    if (msgIndex !== -1) {
      freshSyncState.messages[msgIndex].processed = true;
      freshSyncState.messages[msgIndex].response = responseText;
      freshSyncState.messages[msgIndex].respondedAt = new Date().toISOString();
    }
    
    freshSyncState.status = 'idle';
    writeSyncFile(freshSyncState);
  }
}

// 3秒ごとに監視を実行
setInterval(scanAndProcess, 3000);
