// Qoder IDE local chaining proxy.
//   client -> 127.0.0.1:8788 (this) -> 127.0.0.1:9940 (account-switcher proxy) -> qoder.sh
//
// For MITM_HOSTS it terminates TLS with the local leaf cert, logs request
// method/path/headers/body, then re-originates the request through the
// upstream proxy. Everything else is tunnelled raw, so the account switcher
// keeps working untouched.
const http = require('http');
const https = require('https');
const net = require('net');
const { StringDecoder } = require('string_decoder');
const tls = require('tls');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// Port precedence: env > config.json proxyPort > 8788
// NOTE: uses __dirname directly because CONFIG_PATH is declared further down
// and would be in the temporal dead zone at module init time.
function resolvePort() {
  if (process.env.PROXY_PORT) return Number(process.env.PROXY_PORT);
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
    if (cfg.proxyPort) return Number(cfg.proxyPort);
  } catch { /* ignore */ }
  return 8788;
}
const PORT = resolvePort();
// Optional chaining proxy (e.g. the account switcher on 9940). Empty = connect direct.
// Precedence: env UPSTREAM_PROXY > config.upstreamProxy > none.
const UPSTREAM_PROXY = (() => {
  let raw = process.env.UPSTREAM_PROXY;
  if (!raw) {
    try { raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')).upstreamProxy || ''; } catch { /* ignore */ }
  }
  if (!raw) return null;
  const [h, p] = String(raw).split(':');
  return { host: h || '127.0.0.1', port: Number(p || 80) };
})();
const MITM_HOSTS = new Set(
  (process.env.MITM_HOSTS || 'api3.qoder.sh,center.qoder.sh,openapi.qoder.sh,api2.qoder.sh,api1.qoder.sh')
    .split(',').map((s) => s.trim()).filter(Boolean)
);
const DIR = __dirname;
const LOG = path.join(DIR, 'proxy.log');
const BODY_DIR = path.join(DIR, 'bodies');
fs.mkdirSync(BODY_DIR, { recursive: true });

// 只给排障真正需要的请求留快照。以前是所有带 body 的请求都写盘，
// 心跳/APM/遥测每 15 秒一条，两天攒到 2 万多个文件、360MB。
const KEEP_BODY = /agent_chat_generation|codec|wiki|codebase\/file\/upload/i;
const BODY_TTL_MS = 24 * 60 * 60 * 1000;

// 启动后异步清一次过期快照（不阻塞监听）
function pruneBodies() {
  let removed = 0;
  let bytes = 0;
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(BODY_DIR)) {
      const fp = path.join(BODY_DIR, f);
      try {
        const st = fs.statSync(fp);
        if (st.isFile() && now - st.mtimeMs > BODY_TTL_MS) {
          bytes += st.size;
          fs.unlinkSync(fp);
          removed++;
        }
      } catch { /* 跳过正在写的文件 */ }
    }
  } catch { /* 目录不存在就算了 */ }
  if (removed) log({ kind: 'bodies-pruned', removed, mb: Math.round(bytes / 1048576) });
  return removed;
}
setTimeout(pruneBodies, 5000);

const key = fs.readFileSync(path.join(DIR, 'leaf.key'));
const cert = fs.readFileSync(path.join(DIR, 'leaf.crt'));
const secureContext = tls.createSecureContext({ key, cert });

const CONFIG_PATH = path.join(DIR, 'config.json');
let CONFIG = { upstream: {}, serveCustomModels: false, customSourceValues: [] };
// RepoWiki 生成是否用自定义模型。config.json 里 serveWiki:false 可关掉
// （目录生成阶段会失败并重试，关掉可避免白耗上游额度）。
function cfgServeWiki() {
  try { return loadConfig().serveWiki !== false; } catch { return true; }
}

// 读配置。admin.js 里那份失败返回空 upstream；这里刻意回落到启动快照，
// 保证配置文件一时读不到时代理也不会断路（详见 admin.js 同名函数的注释）。
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return CONFIG; }
}
CONFIG = loadConfig();

// Extra tool definitions injected when Qoder's own tool list is missing them
// (Qoder only hands out read tools on planning turns). Reloaded on file change.
let EXTRA_TOOLS = null;
let EXTRA_TOOLS_MTIME = 0;
function loadExtraTools() {
  try {
    const p = path.join(DIR, 'tools-extra.json');
    const st = fs.statSync(p);
    if (!EXTRA_TOOLS || st.mtimeMs !== EXTRA_TOOLS_MTIME) {
      const arr = JSON.parse(fs.readFileSync(p, 'utf8'));
      EXTRA_TOOLS = Array.isArray(arr) ? arr : [];
      EXTRA_TOOLS_MTIME = st.mtimeMs;
    }
    return EXTRA_TOOLS;
  } catch { return []; }
}
const ALPHA = '_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!';
const ALPHA_MAP = {};
for (let i = 0; i < ALPHA.length; i++) ALPHA_MAP[ALPHA[i]] = i;

function zstdDecode(buf) {
  try { return zlib.zstdDecompressSync(buf); } catch { return null; }
}

// Qoder request body: zstd(qoder-codec(json)).
// The codec (reverse-engineered from Qoder.exe and confirmed against
// github.com/Zhengyuuuui/qoder2api/internal/cosy/encoding.go) is:
//   1) standard base64 of the JSON
//   2) rotate the base64 string: a = n/3, rearranged = std[n-a:] + std[a:n-a] + std[:a]
//   3) map each std alphabet char to the custom alphabet; '=' becomes '$'
// Missing step 2 is why the old decoder always started mid-JSON.
const CUSTOM_ALPHA = '_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!';
const STD_ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const C2S = Object.create(null);      // custom -> std，解码用
for (let i = 0; i < 64; i++) C2S[CUSTOM_ALPHA[i]] = STD_ALPHA[i];
C2S.$ = '=';

// 注：编码方向（把明文转回 qoder 的混淆格式）当前不需要 —— 回给 Qoder 的
// 每个 chunk 都是明文 JSON 信封，不经过这套字母表。原来那个 qoderEncode()
// 从来没有被调用过，已删除；如需恢复，就是本函数的逆变换（同样做三段轮转 +
// 字母表替换，末位 '=' 对应 '$'）。
function qoderDecode(encoded) {
  let mapped = '';
  for (const ch of encoded) {
    if (ch === '$') { mapped += '='; continue; }
    const m = C2S[ch];
    if (m === undefined) throw new Error(`char outside custom alphabet at ${mapped.length}: ${JSON.stringify(ch)}`);
    mapped += m;
  }
  const n = mapped.length;
  const a = Math.floor(n / 3);
  const std = mapped.slice(n - a) + mapped.slice(a, n - a) + mapped.slice(0, a);
  return Buffer.from(std, 'base64');
}




// Legacy alignment guessing kept as a fallback for bodies that are not qoder-coded.
function quality(s) {
  if (!s) return { score: -1, printable: 0, roles: 0, keys: 0 };
  const printable = (s.match(/[\x20-\x7E\u4e00-\u9fff]/g) || []).length;
  const ratio = s.length ? printable / s.length : 0;
  const roles = (s.match(/"role"\s*:/g) || []).length;
  const keys = (s.match(/"(messages|model_config|task_id|agent_id|tools)"/g) || []).length;
  // JSON structure dominates; raw base64 text is 100% printable but contains no fields,
  // so printability is only a tie-breaker and a readability gate (see decodeQoderBody).
  const score = roles * 1e6 + keys * 1e5 + ratio * 1e3;
  return { score, printable: ratio, roles, keys };
}

function decodeWithAlphabet(text, map, skip) {
  const out = [];
  let acc = 0, bits = 0;
  for (const ch of text.slice(skip)) {
    const v = map[ch];
    if (v === undefined) continue;
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 0xff); }
  }
  return Buffer.from(out).toString('utf8');
}

function decodeQoderBody(buf) {
  const raw = zstdDecode(buf);
  // Primary path: the real qoder codec. Produces clean JSON for every request type,
  // including the large experts bodies the old heuristic could not decode.
  if (raw) {
    try {
      const s = qoderDecode(raw.toString('utf8')).toString('utf8');
      if (s && s.trimStart().startsWith('{')) {
        lastDecodeInfo = { how: 'qoder-codec', printable: 1, roles: 0, keys: 0 };
        return s;
      }
    } catch { /* fall through to the legacy heuristics */ }
  }
  const candidates = [];
  if (raw) {
    const text = raw.toString('utf8');
    for (const skip of [0, 1, 2, 3]) {
      candidates.push({ how: `custom-b64/skip${skip}`, s: decodeWithAlphabet(text, ALPHA_MAP, skip) });
    }
    // standard base64 fallback
    try {
      const std = Buffer.from(text.replace(/\s+/g, ''), 'base64').toString('utf8');
      candidates.push({ how: 'std-b64', s: std });
    } catch { /* ignore */ }
    candidates.push({ how: 'zstd-plain', s: text });
  }
  // some bodies may not be zstd at all
  try { candidates.push({ how: 'plain', s: buf.toString('utf8') }); } catch { /* ignore */ }

  const scored = candidates.map((c) => ({ ...c, q: quality(c.s) }));
  // Readability gate: mojibake can still contain a stray "role":, so only consider
  // candidates that are mostly text; fall back to all of them if none qualifies.
  const readable = scored.filter((c) => c.q.printable >= 0.6);
  const pool = readable.length ? readable : scored;
  const best = pool.reduce((a, b) => (!a || b.q.score > a.q.score ? b : a), null);
  if (!best) return null;
  lastDecodeInfo = { how: best.how, printable: Number(best.q.printable.toFixed(3)), roles: best.q.roles, keys: best.q.keys };
  return best.s;
}
let lastDecodeInfo = null;

// Pull a JSON value (object/array) that follows "key": out of the decoded text.
function extractJsonValue(text, key) {
  const m = new RegExp('"' + key + '"\\s*:\\s*([\\[{])').exec(text);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) { try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

// Pull chat messages out of the decoded payload (best effort: the body can be a
// concatenation of JSON fragments).
// Qoder 的专家团/新会话把用户提问放在 chat_context.text 里，messages 里的 user 条目
// content 是空串。不回填的话上游只能收到一串空消息（模型会回 "What would you like help with?"）。
function fillExpertPrompt(messages, decodedText) {
  if (!messages || !messages.length || !decodedText) return;
  let body = null;
  try { body = JSON.parse(decodedText); } catch { /* ignore */ }
  const ctx = body && body.chat_context;
  const prompt = [];
  if (ctx && typeof ctx.text === 'string' && ctx.text.trim()) prompt.push(ctx.text.trim());
  if (ctx && typeof ctx.chatPrompt === 'string' && ctx.chatPrompt.trim()) prompt.push(ctx.chatPrompt.trim());
  const text = prompt.join('\n\n');
  if (text) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user' && !String(messages[i].content || '').trim()) {
        messages[i].content = text;
        break;
      }
    }
  }
  // 剩下的空消息没有信息量，发出去只会干扰模型。
  for (let i = messages.length - 1; i >= 0; i--) {
    if (!String(messages[i].content || '').trim()) messages.splice(i, 1);
  }
}

function extractMessages(text) {
  const msgs = [];
  const start = text.indexOf('"messages"');
  if (start >= 0) {
    const arrStart = text.indexOf('[', start);
    if (arrStart >= 0) {
      let depth = 0, inStr = false, esc = false, end = -1;
      for (let i = arrStart; i < text.length; i++) {
        const ch = text[i];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') { inStr = true; continue; }
        if (ch === '[' || ch === '{') depth++;
        else if (ch === ']' || ch === '}') { depth--; if (depth === 0 && ch === ']') { end = i; break; } }
      }
      if (end > arrStart) {
        try {
          const arr = JSON.parse(text.slice(arrStart, end + 1));
          for (const m of arr) {
            if (!m || typeof m !== 'object' || !m.role) continue;
            let content = '';
            const images = [];
            if (Array.isArray(m.contents)) {
              const texts = [];
              for (const c of m.contents) {
                if (!c || typeof c !== 'object') continue;
                if (c.type === 'text' && typeof c.text === 'string') texts.push(c.text);
                else if (c.type === 'image_url' && c.image_url) {
                  const u = typeof c.image_url === 'string' ? c.image_url : c.image_url.url;
                  if (u) images.push(u);
                } else if (c.type === 'input_image') {
                  const u = typeof c.image_url === 'string' ? c.image_url : (c.image_url && c.image_url.url);
                  if (u) images.push(u);
                } else if (c.type === 'image' && c.source) {
                  const u = c.source.url || (c.source.data ? `data:${c.source.media_type || 'image/png'};base64,${c.source.data}` : '');
                  if (u) images.push(u);
                }
              }
              content = texts.join('\n');
            }
            if (!content && typeof m.content === 'string') content = m.content;
            if (!content && typeof m.content === 'object' && m.content) content = JSON.stringify(m.content);
            const out = { role: m.role, content: content || '', images };
            // 多轮工具调用链不能断：assistant 的 tool_calls 与 tool 结果的
            // tool_call_id / name 必须保留，否则模型看到的是残缺对话
            // （wiki 目录生成就是靠这条链，丢了就 DIRECTORY_FAILED）。
            if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
              out.tool_calls = m.tool_calls.map((tc) => ({
                id: tc.id,
                type: tc.type || 'function',
                function: {
                  name: (tc.function && tc.function.name) || tc.name || '',
                  arguments: typeof (tc.function && tc.function.arguments) === 'string'
                    ? tc.function.arguments
                    : JSON.stringify((tc.function && tc.function.arguments) || {}),
                },
              })).filter((tc) => tc.function.name);
              if (!out.tool_calls.length) delete out.tool_calls;
            }
            if (m.role === 'tool') {
              if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
              if (m.name) out.name = m.name;
              if (m.tool_call_id == null && m.id) out.tool_call_id = m.id;
            }
            msgs.push(out);
          }
          if (msgs.length) return msgs;
        } catch { /* fall through to regex */ }
      }
    }
  }
  const re = /"role"\s*:\s*"(system|user|assistant)"\s*,\s*"content"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let content;
    try { content = JSON.parse('"' + m[2] + '"'); } catch { content = m[2]; }
    msgs.push({ role: m[1], content });
  }
  return msgs;
}

// Normalise tool-call deltas so stricter clients (Qoder's parser) accept them:
// arguments must be a JSON string, and type must be "function".
function normalizeChunk(obj) {
  const choices = obj && obj.choices;
  if (!Array.isArray(choices)) return;
  for (const c of choices) {
    const calls = c && c.delta && c.delta.tool_calls;
    if (!Array.isArray(calls)) continue;
    for (const call of calls) {
      if (!call || typeof call !== 'object') continue;
      if (call.type == null) call.type = 'function';
      const fn = call.function;
      if (fn && typeof fn === 'object') {
        if (fn.arguments != null && typeof fn.arguments !== 'string') {
          try { fn.arguments = JSON.stringify(fn.arguments); } catch { fn.arguments = '{}'; }
        }
        if (fn.arguments == null) fn.arguments = '';
      }
    }
  }
}

function envelope(chunkObj) {
  const body = JSON.stringify(chunkObj);
  return 'data:' + JSON.stringify({
    headers: { 'Content-Type': ['application/json'] },
    body,
    statusCodeValue: 200,
    statusCode: 'OK',
  }) + '\n\n';
}

// Qoder 把图片放在 messages[].contents[] 里（{type:"image_url", image_url:{url}}），
// 与 chat_context.imageUrls 并存。上游要的是 OpenAI 的 content parts，这里做一次转换。
function applyMessageImages(messages) {
  if (!Array.isArray(messages)) return;
  for (const m of messages) {
    const images = Array.isArray(m.images) ? m.images.filter(Boolean) : [];
    delete m.images;
    if (!images.length) continue;
    const parts = [];
    for (const url of images) parts.push({ type: 'image_url', image_url: { url } });
    if (m.content) parts.push({ type: 'text', text: m.content });
    m.content = parts;
  }
}

// 上游错误四分类（语义参考 qoder2api internal/bridge/errors.go）：把上游的
// 无意义状态码翻译成客户端能看懂的原因，避免界面上只出现 llm_return_empty。
function mapUpstreamError(status, body) {
  let msg = '';
  try {
    const j = JSON.parse(body);
    msg = (j.error && (j.error.message || j.error.code || j.error.type)) || j.message || j.msg || '';
    if (typeof msg === 'object') msg = JSON.stringify(msg);
  } catch {
    msg = String(body || '').trim().slice(0, 300);
  }
  const low = String(body || '').toLowerCase();
  if (status === 401 || status === 403) return { code: 'auth_error', message: `上游鉴权失败 (${status}): ${msg}` };
  if (status === 429) return { code: 'rate_limited', message: `上游限流 (429): ${msg} — 稍后重试` };
  if (/content[_ -]?policy|moderation|inspect|sensitive|审核|违规/.test(low)) {
    return { code: 'content_policy_rejected', message: `上游内容审核拒绝: ${msg}` };
  }
  if (status >= 500) return { code: 'upstream_transient_error', message: `上游临时故障 (${status}): ${msg} — 可重试` };
  return { code: 'upstream_error', message: `上游返回 ${status}: ${msg}` };
}

/**
 * 把上游故障写成一条"助手消息"塞进流里。
 *
 * 起因：实测上游连不上 / 返回 500 时，Qoder 界面只显示用户那条消息，
 * 后面一片空白，既不报错也不结束——因为 Qoder 不认识 SSE 里自定义的
 * error.code（bundle 里搜不到 upstream_error / proxy_error 这些串）。
 * 与其猜它的错误 UI，不如合成一条普通的 assistant 文本，保证用户一定
 * 看得到发生了什么。
 */
function emitVisibleFailure(res, detail, advice) {
  const tail = advice || '请求没有送达模型。请检查上游网关是否在运行，或稍后重试。';
  const text = '⚠️ ' + String(detail || '').slice(0, 300) + '\n\n（' + tail + '）';
  const chunk = (delta, finish) => ({
    id: 'proxy-error', object: 'chat.completion.chunk', model: 'proxy',
    choices: [{ index: 0, delta, finish_reason: finish }],
  });
  try {
    res.write(envelope(chunk({ role: 'assistant', content: '' }, null)));
    res.write(envelope(chunk({ content: text }, null)));
    res.write(envelope(chunk({}, 'stop')));
  } catch { /* 流已断就算了 */ }
}

function dumpWikiSample(sample) {
  try {
    const f = path.join(BODY_DIR, 'wiki-out-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '.txt');
    fs.writeFileSync(f, sample.text, 'utf8');
    const m = /<documentation_structure>([\s\S]*?)<\/documentation_structure>/.exec(sample.text);
    let jsonOk = false, err = '';
    if (m) { try { JSON.parse(m[1].trim()); jsonOk = true; } catch (e) { err = e.message.slice(0, 90); } }
    log({ kind: 'wiki-sample-file', file: f, chars: sample.text.length, calls: sample.calls.length, tag: !!m, jsonOk, err });
  } catch { /* ignore */ }
}

function serveCustomModel(req, res, decodedText, cfg, rawBody) {
  const up = (cfg && cfg.upstream) || CONFIG.upstream;
  // 按请求隔离采样（wiki 会并发发多个请求，用全局会串扰）
  const sample = /"session_type"\s*:\s*"wiki"/.test(decodedText || '')
    ? { text: '', calls: [], done: false }
    : null;
  if (sample) {
    log({ kind: 'wiki-request', task: (/"task_id":"([^"]*)"/.exec(decodedText) || [])[1] || '', msgs: (decodedText.match(/"role":/g) || []).length });
  }
  const messages = extractMessages(decodedText || '');
  fillExpertPrompt(messages, decodedText);
  applyMessageImages(messages);
  if (rawBody && rawBody.length) {
    try { fs.writeFileSync(path.join(BODY_DIR, `raw-${Date.now()}.bin`), rawBody); } catch { /* ignore */ }
  }
  log({ kind: 'custom-serve', url: req.url, messages: messages.length, decode: lastDecodeInfo });
  if (decodedText) {
    const dump = path.join(BODY_DIR, `decoded-${Date.now()}.json`);
    fs.writeFileSync(dump, decodedText);
    log({ kind: 'custom-serve-body', file: dump, chars: decodedText.length });
  }
  if (!messages.length) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const err = { code: 'proxy_error', message: 'no messages decoded from request body' };
    res.write(envelope({ error: err }));
    res.end();
    return;
  }
  // 解码质量太差说明对齐错了：转发垃圾只会让上游报参数错误，不如明确失败。
  if (lastDecodeInfo && lastDecodeInfo.printable < 0.5) {
    log({ kind: 'decode-bad', decode: lastDecodeInfo, bytes: rawBody ? rawBody.length : 0 });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(envelope({ error: { code: 'proxy_error', message: `request body decode failed (printable=${lastDecodeInfo.printable}, via ${lastDecodeInfo.how})` } }));
    res.end();
    return;
  }
  // Qoder uploads attachments to its OSS and passes pre-signed URLs in chat_context.imageUrls.
  const imgMatch = /"imageUrls"\s*:\s*\[([^\]]*)\]/.exec(decodedText || '');
  const imageUrls = imgMatch
    ? [...imgMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/'))
    : [];
  if (imageUrls.length) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role !== 'user') continue;
      // content 可能已经是 parts 数组（图片来自 messages[].contents），此时直接追加。
      const parts = Array.isArray(messages[i].content)
        ? messages[i].content.slice()
        : [{ type: 'text', text: messages[i].content || '' }];
      const already = new Set(parts.filter((p) => p.type === 'image_url').map((p) => p.image_url && p.image_url.url));
      for (const u of imageUrls) {
        if (!already.has(u)) parts.push({ type: 'image_url', image_url: { url: u } });
      }
      messages[i].content = parts;
      break;
    }
  }

  const effortMatch = /"reasoning_effort"\s*:\s*"([^"]+)"/.exec(decodedText || '');
  const payloadObj = { model: up.model, messages, stream: true };

  // Forward the tool definitions Qoder ships with the request (OpenAI format).
  const tools = extractJsonValue(decodedText || '', 'tools');
  const forwarded = Array.isArray(tools) ? tools.slice() : [];
  // Qoder hides write/bash tools on read-only turns; the model still sees them in the
  // system prompt, so calls fail as "tool not available". Top up the list so the model
  // can actually invoke them. Configurable via injectTools (default on).
  // RepoWiki 自带 7 个检索工具（list_dir/read_file/grep_code/search_file/
  // search_codebase/recommend_file/search_symbol），且要求模型必须先用 search_codebase。
  // 注入 Write/Bash 等额外工具会干扰它，导致目录生成失败（DIRECTORY_FAILED）。
  const isWikiTaskLocal = /"session_type"\s*:\s*"wiki"/.test(decodedText || '');
  if (cfg.injectTools !== false && !isWikiTaskLocal) {
    const extras = loadExtraTools();
    const have = new Set(forwarded.map((t) => t && t.function && t.function.name));
    for (const t of extras) {
      if (t && t.function && !have.has(t.function.name)) forwarded.push(t);
    }
  }
  if (forwarded.length) payloadObj.tools = forwarded;
  const toolChoice = extractJsonValue(decodedText || '', 'tool_choice');
  if (toolChoice) payloadObj.tool_choice = toolChoice;

  const effort = (effortMatch && effortMatch[1]) || up.reasoningEffort;
  if (effort) payloadObj.reasoning_effort = effort;
  if (up.maxTokens) payloadObj.max_tokens = up.maxTokens;
  if (typeof up.temperature === 'number') payloadObj.temperature = up.temperature;
  if (typeof up.topP === 'number') payloadObj.top_p = up.topP;
  if (typeof up.parallelToolCalls === 'boolean') payloadObj.parallel_tool_calls = up.parallelToolCalls;
  if (up.extra && typeof up.extra === 'object') Object.assign(payloadObj, up.extra);

  const payload = JSON.stringify(payloadObj);
  log({
    kind: 'custom-serve-payload', messages: messages.length, images: imageUrls.length,
    tools: forwarded.length,
    tools_injected: forwarded.length - (Array.isArray(tools) ? tools.length : 0),
    reasoning_effort: effort || null, max_tokens: up.maxTokens || null,
  });
  const target = new URL(up.baseUrl.replace(/\/$/, '') + '/chat/completions');
  const transport = target.protocol === 'http:' ? http : https;
  const upstreamReq = transport.request({
    host: target.hostname, port: target.port || (target.protocol === 'http:' ? 80 : 443),
    path: target.pathname + target.search,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + up.apiKey,
      accept: 'text/event-stream',
    },
  }, (upRes) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream;charset=UTF-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const status = upRes.statusCode || 0;
    if (status >= 400) {
      // 上游用 JSON 报错时没有 data: 行，原样转发会让客户端收到空流（界面显示 llm_return_empty）。
      let errBody = '';
      upRes.on('data', (c) => { errBody += c.toString('utf8'); });
      upRes.on('end', () => {
        const mapped = mapUpstreamError(status, errBody);
        log({ kind: 'upstream-error', status, code: mapped.code, message: mapped.message, body: errBody.slice(0, 600) });
        res.write(envelope({ error: mapped }));
        emitVisibleFailure(res, mapped.message);
        res.end();
      });
      return;
    }
    let buffer = '';
    let emittedChars = 0;      // 真正转发给客户端的内容量，0 = 上游给了空响应
    let sawFinish = false;     // 上游有没有给出 finish_reason（缺了就是半截断流）
    // 必须用 StringDecoder 而不是 chunk.toString()：一个中文字符是 3 字节，
    // 被 TCP 分片切在两个 chunk 之间时，逐块 toString 会在边界产出替换字符 U+FFFD，
    // 然后被原样转发给 Qoder —— 表现为中文回复里偶发方块。StringDecoder 会
    // 把不完整的尾字节留到下一块再拼。这块风险只在中文/emoji 且发生分片时出现，
    // 靠普通测试抓不到，所以按代码事实直接修。
    const decoder = new StringDecoder('utf8');
    upRes.on('data', (chunk) => {
      buffer += decoder.write(chunk);
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const line = event.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        let obj;
        try { obj = JSON.parse(data); } catch { continue; }
        normalizeChunk(obj);
        // 统计真正发出去的内容量。上游"200 但空流 / 非 JSON / choices 为空"时
        // 这里会一直是 0 —— 那种情况 Qoder 界面上什么都不显示，必须补一条可见提示。
        const d0 = obj && obj.choices && obj.choices[0] && obj.choices[0].delta;
        if (d0) {
          if (typeof d0.content === 'string') emittedChars += d0.content.length;
          if (Array.isArray(d0.tool_calls)) emittedChars += d0.tool_calls.length;
        }
        const fr = obj && obj.choices && obj.choices[0] && obj.choices[0].finish_reason;
        if (fr) sawFinish = true;
        if (sample && !sample.done) {
          const d = obj && obj.choices && obj.choices[0] && obj.choices[0].delta;
          if (d && typeof d.content === 'string' && d.content) sample.text += d.content;
          if (d && d.tool_calls) {
            for (const tc of d.tool_calls) {
              if (tc && tc.function && tc.function.name) sample.calls.push(tc.function.name);
            }
          }
          if (sample.text.length > 500000) { sample.done = true; dumpWikiSample(sample); }
        }
        res.write(envelope(obj));
      }
    });
    upRes.on('end', () => {
      buffer += decoder.end();
      if (sample && !sample.done && sample.text.length > 200) { sample.done = true; dumpWikiSample(sample); }
      // 上游回了 200 却一个字节有效内容都没有：Qoder 不会自己报错，界面永远空白。
      // 对抗测试实测：空流 / 非 JSON / choices 为空 三种都会命中。
      if (emittedChars === 0) {
        log({ kind: 'empty-upstream-response', status });
        emitVisibleFailure(res, `上游返回了空响应（HTTP ${status}，没有任何内容）`,'请求已发出，但上游没有返回任何内容。检查上游服务是否正常。');
      } else if (!sawFinish) {
        // 已经吐了半句，上游就"正常"关闭了（没有 finish_reason）。
        // Qoder 不会报错，界面会永远停在这半句上，用户以为模型话说完了。
        log({ kind: 'truncated-upstream-response', status, emittedChars });
        emitVisibleFailure(res, '回复在输出中途断开了（上游正常关闭连接，但没有结束标记）', '这段回复不完整，需要的话请重发一次。');
      }
      log({ kind: 'custom-serve-end', emittedChars, sawFinish });
      res.end();
    });
  });
  upstreamReq.on('error', (e) => {
    log({ kind: 'custom-serve-error', message: e.message });
    if (!res.headersSent) res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(envelope({ error: { code: 'upstream_error', message: e.message } }));
    emitVisibleFailure(res, `无法连接上游 ${up.target || ''}：${e.message}`);
    res.end();
  });
  upstreamReq.end(payload);
}


let seq = 0;
function log(entry) {
  entry.at = new Date().toISOString();
  entry.id = (++seq).toString(36);
  fs.appendFileSync(LOG, JSON.stringify(entry) + '\n');
  return entry.id;
}

// HTTPS agent used for outbound requests made by the proxy itself.
// When UPSTREAM_PROXY is configured (e.g. the account-switcher on 9940) traffic is
// tunnelled through it; otherwise we connect directly — chaining to a proxy that is
// not running used to fail every request with ECONNREFUSED.
class UpstreamAgent extends https.Agent {
  constructor(opts = {}) { super({ keepAlive: false, ...opts }); }
  createConnection(options, cb) {
    if (!UPSTREAM_PROXY) {
      const sock = tls.connect({ host: options.host, port: options.port || 443, servername: options.host, rejectUnauthorized: false });
      sock.once('secureConnect', () => cb(null, sock));
      sock.once('error', (e) => cb(e));
      return;
    }
    const target = `${options.host}:${options.port || 443}`;
    const connectReq = http.request({
      host: UPSTREAM_PROXY.host, port: UPSTREAM_PROXY.port, method: 'CONNECT', path: target,
      headers: { Host: target },
    });
    connectReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) { cb(new Error('upstream CONNECT ' + res.statusCode)); socket.destroy(); return; }
      const tlsSock = tls.connect({ socket, servername: options.host, rejectUnauthorized: false });
      tlsSock.once('secureConnect', () => cb(null, tlsSock));
      tlsSock.once('error', (e) => cb(e));
    });
    connectReq.on('error', (e) => cb(e));
    connectReq.end();
  }
}
const agent = new UpstreamAgent();

// Qoder fires several internal tasks on the same endpoint (memory extraction, title
// generation, ...). Their model_config is empty and Qoder expects its own backend to
// answer them; serving them with our upstream model breaks the flow (the real user
// question never reaches the model). Detect and tunnel those instead.
function isInternalTask(text) {
  if (!text) return false;
  // RepoWiki 的 model_config 也是空的（不指定模型，走默认 auto），会被下面
  // 「空 model_config 即内部任务」误判。wiki 是真任务，先排除。
  if (cfgServeWiki() && /"session_type"\s*:\s*"wiki"/.test(text)) return false;
  // Distinctive prompts for Qoder's background tasks (survive a partially garbled decode).
  if (/You are the agent's memory system/i.test(text)) return true;
  if (/start extracting memories|extracting memories from/i.test(text)) return true;
  if (/You extract experience lessons/i.test(text)) return true;
  if (/"task_id":"(memory_generation|title_generation|summary|rename|naming|commit_message)/i.test(text)) return true;
  if (/"model_config":\{"key":"","display_name":""/.test(text)) return true;
  return false;
}

function forward(req, res, bodyChunks) {
  const host = (req.headers.host || '').split(':')[0];
  const headers = { ...req.headers };
  const body = Buffer.concat(bodyChunks);
  if (body.length) headers['content-length'] = String(body.length);
  delete headers['proxy-connection'];

  const modelSource = String(req.headers['x-model-source'] || '').toLowerCase();
  const modelKey = String(req.headers['x-model-key'] || '');
  const isChat = /agent_chat_generation/i.test(req.url || '');
  const cfg = loadConfig();
  // RepoWiki 生成走的就是同一个 agent_chat_generation，但头部是 x-model-key=auto /
  // x-model-source=system，所以不会被当成 custom。它的请求体里 session_type="wiki"、
  // task_id="deepwiki_generate"，据此识别并接管，让 wiki 也能用自定义模型。
  if (isChat) {
    let decoded = null;
    try { decoded = decodeQoderBody(body); } catch { decoded = null; }
    const wikiBody = !!decoded && /"session_type"\s*:\s*"wiki"/.test(decoded);
    // RepoWiki 接管开关：关掉时，wiki 任务一律不接管（走官方），
    // 避免失败重试时白耗上游额度。
    if (wikiBody && !cfgServeWiki()) {
      log({ kind: 'wiki-skip-by-switch', url: req.url });
      // fall through to the plain tunnel below
    } else {
      const isWikiTask = wikiBody;
      const isCustom = cfg.serveCustomModels &&
        (cfg.customSourceValues.includes(modelSource) || /custom/i.test(modelKey) || isWikiTask);
      if ((isCustom || isWikiTask) && cfg.serveCustomModels) {
        if (isInternalTask(decoded)) {
          log({ kind: 'internal-task-passthrough', url: req.url, task: (/"task_id":"([^"]*)"/.exec(decoded) || [])[1] || '' });
          // fall through to the plain tunnel below
        } else {
          serveCustomModel(req, res, decoded, cfg, body);
          return;
        }
      }
    }
  }

  const id = log({
    kind: 'request', host, method: req.method, url: req.url,
    headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, k.toLowerCase().includes('auth') || k.toLowerCase().includes('cookie') ? '<redacted>' : v])),
    bodyLength: body.length,
  });
  if (body.length && KEEP_BODY.test(req.url || '')) {
    fs.writeFileSync(path.join(BODY_DIR, `${id}-${(req.url || '').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 60)}.txt`), body);
  }

  const proxyReq = https.request({
    host, port: 443, path: req.url, method: req.method, headers, agent,
  }, (upRes) => {
    log({ kind: 'response', id, status: upRes.statusCode, contentType: upRes.headers['content-type'] });
    res.writeHead(upRes.statusCode, upRes.headers);
    const capture = /text\/event-stream/i.test(String(upRes.headers['content-type'] || '')) ||
      /agent_chat_generation/i.test(req.url || '');
    if (capture) {
      const file = path.join(BODY_DIR, `resp-${id}.sse`);
      const ws2 = fs.createWriteStream(file);
      upRes.on('data', (chunk) => ws2.write(chunk));
      upRes.on('end', () => { ws2.end(); log({ kind: 'response-body', id, file, bytes: ws2.bytesWritten }); });
      upRes.on('error', () => ws2.end());
    }
    upRes.pipe(res);
    upRes.on('end', () => log({ kind: 'response-end', id }));
  });
  proxyReq.on('error', (e) => {
    log({ kind: 'error', id, message: e.message });
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('proxy error: ' + e.message);
  });
  proxyReq.end(body);
}

const mitmServer = https.createServer({ key, cert }, (req, res) => {
  const chunks = [];
  let size = 0;
  req.on('data', (c) => { if (size < 4 * 1024 * 1024) { chunks.push(c); size += c.length; } });
  req.on('end', () => forward(req, res, chunks));
});

const server = http.createServer((req, res) => {
  // Small status API used by the admin page and by the IDE live-model patch.
  if (req.method === 'GET' && (req.url === '/state' || req.url === '/api/state')) {
    const cfg = loadConfig();
    const up = (cfg && cfg.upstream) || {};
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({
      ok: true,
      model: up.model || '',
      displayName: up.displayName || up.model || '',
      recordId: cfg.recordId || 'model_mocktest',
      baseUrl: up.baseUrl || '',
      reasoningEffort: up.reasoningEffort || null,
      maxTokens: up.maxTokens || null,
      upstreamHost: (() => { try { return new URL(up.baseUrl).host; } catch { return ''; } })(),
    }));
    return;
  }
  res.writeHead(400, { 'content-type': 'text/plain' });
  res.end('this proxy expects CONNECT');
});

server.on('connect', (req, clientSocket, head) => {
  const [host, portStr] = (req.url || '').split(':');
  const port = Number(portStr || 443);
  clientSocket.on('error', () => {});

  if (!MITM_HOSTS.has(host)) {
    // transparent tunnel; optionally chained through UPSTREAM_PROXY
    if (!UPSTREAM_PROXY) {
      const up = net.connect(port, host, () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head && head.length) up.write(head);
      });
      up.on('data', (d) => clientSocket.write(d));
      clientSocket.on('data', (d) => up.write(d));
      up.on('error', () => clientSocket.destroy());
      clientSocket.on('error', () => up.destroy());
      return;
    }
    const up = net.connect(UPSTREAM_PROXY.port, UPSTREAM_PROXY.host, () => {
      up.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
    });
    let established = false;
    up.on('data', (chunk) => {
      if (!established) {
        const marker = chunk.indexOf('\r\n\r\n');
        if (marker < 0) return;
        established = true;
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        const rest = chunk.subarray(marker + 4);
        if (rest.length) clientSocket.write(rest);
        return;
      }
      clientSocket.write(chunk);
    });
    clientSocket.on('data', (d) => up.write(d));
    up.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => up.destroy());
    return;
  }

  clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
  if (head && head.length) clientSocket.unshift(head);
  // Let the https server perform the TLS handshake on the raw socket.
  mitmServer.emit('connection', clientSocket);
});

server.listen(PORT, '127.0.0.1', () => {
  const _chain = UPSTREAM_PROXY ? `${UPSTREAM_PROXY.host}:${UPSTREAM_PROXY.port}` : 'direct';
  log({ kind: 'listening', port: PORT, upstream: _chain, mitm: [...MITM_HOSTS] });
  console.log(`proxy listening on 127.0.0.1:${PORT} -> ${_chain}`);
});
