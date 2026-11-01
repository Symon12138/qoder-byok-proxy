// 端到端测试：不经过 IDE，直接对代理发一个真实的 agent_chat_generation 请求。
// 用逆向出的编码器构造 body → HTTP CONNECT 隧道 → TLS → POST → 解析 SSE。
// 用法：node mitm-test.js --text "你好" [--image _red.b64] [--tag normal]
const http = require('http');
const tls = require('tls');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const TEXT = arg('text', '只回复两个字：收到');
const IMAGE_FILE = arg('image', '');
const TAG = arg('tag', 'test');
const WIKI = argv.includes('--wiki');
const PROXY = { host: '127.0.0.1', port: Number(arg('proxy', '8788')) };
const HOST = 'api3.qoder.sh';
const URL_PATH = '/algo/api/v2/service/pro/sse/agent_chat_generation?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1';

// ---- qoder 编解码（与 proxy.js 保持一致） ----
const CUSTOM = '_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!';
const STD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const S2C = {};
for (let i = 0; i < 64; i++) S2C[STD[i]] = CUSTOM[i];
S2C['='] = '$';
function qoderEncode(bytes) {
  const std = bytes.toString('base64');
  const n = std.length;
  const a = Math.floor(n / 3);
  const rotated = std.slice(n - a) + std.slice(a, n - a) + std.slice(0, a);
  let out = '';
  for (const ch of rotated) out += ch === '=' ? '$' : S2C[ch];
  return out;
}

// ---- 构造请求体 ----
const contents = [];
if (IMAGE_FILE) {
  const b64 = fs.readFileSync(IMAGE_FILE, 'utf8').trim();
  contents.push({ type: 'image_url', image_url: { url: 'data:image/png;base64,' + b64 } });
}
contents.push({ type: 'text', text: TEXT });

const bodyObj = {
  request_id: 'mitm-test-' + Date.now(),
  request_set_id: 'mitm-test',
  stream: true,
  chat_task: 'FREE_INPUT',
  chat_context: { text: TEXT, imageUrls: IMAGE_FILE ? ['data:image/png;base64,' + fs.readFileSync(IMAGE_FILE, 'utf8').trim()] : null },
  messages: [
    { role: 'system', content: '', contents: [{ type: 'text', text: 'You are a helpful assistant. Reply briefly.' }] },
    { role: 'user', content: '', contents },
  ],
  tools: [],
  model_config: { key: 'custom_model' },
  parameters: { reasoning_effort: 'low' },
  ...(WIKI ? { session_type: 'wiki', task_id: 'deepwiki_catalog_generate', agent_id: 'agent_common' } : {}),
};

const encoded = qoderEncode(Buffer.from(JSON.stringify(bodyObj), 'utf8'));
const body = zlib.zstdCompressSync(Buffer.from(encoded, 'utf8'));

// ---- 通过代理建隧道 ----
console.log(`[${TAG}] body=${body.length}B 图片=${IMAGE_FILE ? '有' : '无'} 文本=${JSON.stringify(TEXT)}`);
const connectReq = http.request({
  host: PROXY.host, port: PROXY.port, method: 'CONNECT', path: `${HOST}:443`,
  headers: { Host: `${HOST}:443` },
});
connectReq.on('connect', (res, socket) => {
  if (res.statusCode !== 200) { console.error('CONNECT 失败', res.statusCode); process.exit(1); }
  const t = tls.connect({ socket, servername: HOST, rejectUnauthorized: false }, () => {
    const req = http.request({
      host: HOST, path: URL_PATH, method: 'POST', createConnection: () => t,
      headers: {
        'content-type': 'application/json',
        'content-length': body.length,
        'x-model-key': 'custom_model',
        'x-model-source': 'system',
        accept: 'text/event-stream',
      },
    }, (r) => {
      let raw = '';
      let text = '';
      let errors = [];
      let thinking = 0;
      r.on('data', (c) => {
        raw += c.toString('utf8');
        let idx;
        while ((idx = raw.indexOf('\n\n')) >= 0) {
          const ev = raw.slice(0, idx); raw = raw.slice(idx + 2);
          const line = ev.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          let env;
          try { env = JSON.parse(line.slice(5).trim()); } catch { continue; }
          let inner;
          try { inner = JSON.parse(env.body); } catch { continue; }
          if (inner.error) { errors.push(inner.error); continue; }
          const d = inner.choices && inner.choices[0] && inner.choices[0].delta;
          if (d && typeof d.content === 'string') text += d.content;
          if (d && d.reasoning_content) thinking += d.reasoning_content.length;
        }
      });
      r.on('end', () => {
        console.log(`[${TAG}] 状态=${r.statusCode} 内容长度=${text.length} 思考=${thinking} 错误=${errors.length}`);
        if (errors.length) console.log(`[${TAG}] 错误详情: ${JSON.stringify(errors[0]).slice(0, 300)}`);
        if (text) console.log(`[${TAG}] 回复: ${JSON.stringify(text.slice(0, 200))}`);
        process.exit(0);
      });
    });
    req.on('error', (e) => { console.error(`[${TAG}] 请求错误: ${e.message}`); process.exit(1); });
    req.end(body);
  });
  t.on('error', (e) => { console.error(`[${TAG}] TLS 错误: ${e.message}`); process.exit(1); });
});
connectReq.on('error', (e) => { console.error(`[${TAG}] CONNECT 错误: ${e.message}`); process.exit(1); });
connectReq.end();
setTimeout(() => { console.error(`[${TAG}] 超时`); process.exit(2); }, 90000);
