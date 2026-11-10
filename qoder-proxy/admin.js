// Qoder BYOK 控制台：一键管理代理、上游模型、补丁与模型记录。
// 无外部依赖，Node 内置模块即可。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const net = require('net');
const crypto = require('crypto');

const DIR = __dirname;
const CONFIG = path.join(DIR, 'config.json');
const LOG = path.join(DIR, 'proxy.log');
const PORT = 3426;
const DEFAULT_PROXY_PORT = 8788;
/**
 * 代理端口，必须是 1~65535 的整数。
 *
 * 对抗测试发现：config 里写成 -1 / 99999 时，这个值会一路传到 portOpen()
 * 和状态组装，导致 /api/status 整个接口报错 —— 控制台所有页面一起空白。
 * 配置文件可以被手工编辑，所以这里必须自己兜底。
 */
function proxyPort() {
  const n = Number(loadConfig().proxyPort);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_PROXY_PORT;
}

// ---------------- Qoder 安装目录探测 ----------------
// 以前写死 'D:\Qoder IDE'。机器上可能同时存在启动器托管的多版本目录
// （D:\Qoder\.qoder-versions\...）和真正可打补丁的安装目录，写死一个很容易改错地方。
// 现在优先用配置文件里保存的路径，其次自动探测，最后才退回默认值。
const WB_REL = path.join('resources', 'app', 'out', 'vs', 'workbench', 'workbench.desktop.main.js');
const AW_REL = path.join('resources', 'app', 'out', 'lingma', 'agents-window', 'agents-window.desktop.main.js');
const DEFAULT_IDE_ROOT = 'D:\\Qoder IDE';

function looksLikeIdeRoot(dir) {
  try { return !!dir && fs.existsSync(path.join(dir, WB_REL)); } catch { return false; }
}

// 从正在运行的 Qoder 进程反推安装目录：最准，因为它就是用户实际在用的那套
function detectRootFromProcess() {
  try {
    const r = spawnSync('powershell', ['-NoProfile', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='Qoder.exe' or Name='Qoder IDE.exe'\" | Select-Object -ExpandProperty ExecutablePath"],
      { encoding: 'utf8', timeout: 8000, windowsHide: true });
    const exes = (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    for (const exe of exes) {
      let d = path.dirname(exe);
      for (let i = 0; i < 6; i++) {
        if (looksLikeIdeRoot(d)) return d;
        const parent = path.dirname(d);
        if (parent === d) break;
        d = parent;
      }
    }
  } catch { /* ignore */ }
  return null;
}

// 常见安装位置 + 启动器的多版本子目录
function detectRootFromCommonPaths() {
  const roots = [
    'D:\\Qoder IDE', 'C:\\Qoder IDE', 'D:\\Qoder', 'C:\\Qoder',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Qoder'),
    path.join(process.env.PROGRAMFILES || '', 'Qoder'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Qoder'),
  ].filter(Boolean);
  for (const base of roots) {
    if (looksLikeIdeRoot(base)) return base;
    const vers = path.join(base, '.qoder-versions');
    try {
      for (const d of fs.readdirSync(vers)) {
        const cand = path.join(vers, d);
        if (looksLikeIdeRoot(cand)) return cand;
      }
    } catch { /* ignore */ }
  }
  return null;
}

let _rootCache = { at: 0, root: null };
/**
 * 解析 Qoder 安装目录。
 *
 * 性能约束：/api/status 每次都会调 ideInfo()，而服务端是单线程的。
 * detectRootFromProcess() 要 spawn 一次 PowerShell（100ms~2s），如果放进
 * status 路径，每 30 秒就会把服务卡住一次 —— 界面上表现为"点击没反应"。
 * 所以这里只做纯文件系统判断；进程探测只在显式 force（点「重新探测」）时跑。
 */
function resolveIdeRoot(force) {
  const cfg = loadConfig();
  if (cfg.ideRoot && looksLikeIdeRoot(cfg.ideRoot)) return cfg.ideRoot;
  if (_rootCache.root) return _rootCache.root;                 // 一旦探明就长期复用
  if (force) {
    const found = detectRootFromProcess() || detectRootFromCommonPaths() || DEFAULT_IDE_ROOT;
    _rootCache = { at: Date.now(), root: found };
    return found;
  }
  // 非强制路径：先试静态常见位置（不 spawn 进程），探不到再退回默认值。
  const quick = detectRootFromCommonPaths();
  if (quick) {
    _rootCache = { at: Date.now(), root: quick };
    return quick;
  }
  return DEFAULT_IDE_ROOT;                                     // 不做进程探测，避免阻塞
}

/**
 * 代理证书状态：读 ca.crt 算指纹，再问 Windows 是否已信任。
 *
 * 用 certutil 的退出码判断（0=在受信任根里，0x80090011=没找到），
 * 不看输出文本 —— 它的输出是 GBK，跨编码解析不可靠。
 * 指纹用 Node 自带 X509Certificate 算，不依赖 openssl。
 */
// 证书状态缓存：查询要起 certutil 进程（约 0.15s），而 /api/status 每 5 秒被轮询一次，
// 每次都 spawn 一次纯属浪费，还会阻塞 0.15s 事件循环。缓存 20 秒。
let certCache = { at: 0, info: null };
const CERT_TTL = 20000;

function certInfo(force) {
  const fresh = force || !certCache.info || Date.now() - certCache.at > CERT_TTL;
  if (!fresh) return certCache.info;
  const info = computeCertInfo();
  certCache = { at: Date.now(), info };
  return info;
}

function computeCertInfo() {
  const caPath = path.join(DIR, 'ca.crt');
  if (!fs.existsSync(caPath)) {
    return { ok: false, trusted: false, exists: false, path: caPath, error: 'ca.crt 不存在（启动代理会自动生成）' };
  }
  try {
    const x = new crypto.X509Certificate(fs.readFileSync(caPath));
    const thumb = x.fingerprint.replace(/:/g, '');
    const r = spawnSync('certutil', ['-user', '-store', 'Root', thumb], {
      encoding: 'utf8', windowsHide: true, timeout: 15000,
    });
    return {
      ok: true,
      exists: true,
      trusted: r.status === 0,
      thumbprint: x.fingerprint,
      subject: x.subject.split('\n').pop(),
      expires: x.validTo,
      path: caPath,
    };
  } catch (e) {
    return { ok: false, exists: true, trusted: false, path: caPath, error: e.message };
  }
}

function ideInfo() {
  const root = resolveIdeRoot();
  const cfg = loadConfig();
  let version = '';
  try { version = JSON.parse(fs.readFileSync(path.join(root, 'resources', 'app', 'product.json'), 'utf8')).version || ''; } catch { /* ignore */ }
  return {
    root,
    version,
    bundleWb: fs.existsSync(path.join(root, WB_REL)),
    bundleAw: fs.existsSync(path.join(root, AW_REL)),
    configured: cfg.ideRoot || '',
    source: cfg.ideRoot ? 'config' : 'auto',
  };
}

function bundleWb() { return path.join(resolveIdeRoot(), WB_REL); }
function bundleAw() { return path.join(resolveIdeRoot(), AW_REL); }
const SETTINGS = path.join(process.env.APPDATA || '', 'Qoder', 'User', 'settings.json');
const APPJSON = path.join(process.env.APPDATA || '', 'Qoder', 'User', 'app.json');
const DB = path.join(process.env.APPDATA || '', 'Qoder', 'User', 'globalStorage', 'state.vscdb');
// 所有拼进 SQL 的值都必须过这里：单引号翻倍。
// 起因（对抗测试）：模型记录的 displayName / apiKey 里只要有一个单引号
// （例如给模型起名 "Bob's model"），UPDATE 语句就会解析失败，
// 整个写记录动作静默不生效 —— 表现是"同步了但 Qoder 里没变化"。
const sqlLit = (v) => String(v).replace(/'/g, "''");

// sqlite3 交给 PATH 解析：写成绝对路径会让别人机器上直接找不到。
// 找不到时 spawnSync 会返回 stderr，控制台照常报错，不会静默失败下面那句 SQL。
const SQLITE = process.env.SQLITE3 || 'sqlite3';

function readJSON(p, def) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return def; } }

/**
 * 只读日志文件的尾部，不整份载入。
 *
 * 起因（对抗测试）：proxy.log 长到 120MB 时，原来那句
 * readFileSync().split('\n') 单次要 489ms、RSS 涨 191MB，
 * 而服务是单线程的 —— 用户每点一次「日志」页面就卡半秒，
 * 文件越大越接近卡死。改成就读最后 2MB，实测 3ms。
 *
 * 从中间截断时第一行可能不完整，直接丢掉。
 */
function readTailLines(file, maxBytes = 2 * 1024 * 1024) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const buf = Buffer.alloc(size - start);
    if (buf.length) fs.readSync(fd, buf, 0, buf.length, start);
    const text = buf.toString('utf8');
    const lines = text.split('\n');
    if (start > 0) lines.shift();          // 截断处的半行丢掉
    return lines;
  } catch (e) {
    return [];
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* ignore */ } }
  }
}
function writeJSON(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8'); }
/**
 * 读配置。注意 proxy.js 里另有一份同名实现，失败行为刻意不同：
 *   - 这里（控制台）失败返回 { upstream: {} }，页面据此显示"未配置"，
 *     让用户看到真实状态，而不是拿一份过期配置骗自己；
 *   - proxy.js 失败回落到启动时的内存快照，保证代理不会因为一次读取
 *     失败就断路（哪怕显示的服务名旧一点，也比断网好）。
 * 改任何一份之前先想清楚这个差异是不是还想保留。
 */
function loadConfig() { return readJSON(CONFIG, { upstream: {} }); }

function portOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const s = new net.Socket();
    const done = (v) => { s.destroy(); resolve(v); };
    s.setTimeout(600, () => done(false));
    s.on('error', () => done(false));
    s.connect(port, host, () => done(true));
  });
}

// bundle 是两个 ~53MB 的 JS。以前 /api/status 每次都 readFileSync 读 4 遍
// （byok / experts / live / repowiki 各一次），单次响应要 1.4~2.8 秒，
// 而 Node 是单线程的，这期间其它请求全部排队 —— 页面每 5 秒轮询一次，
// 等于控制台周期性卡死，切页面时看着像"空白页"。
// 这里按 mtime 缓存布尔结果，文件没变就直接复用。
const bundleMarkerCache = new Map();

function bundleMarkers(file, markers) {
  let mtimeMs;
  try { mtimeMs = fs.statSync(file).mtimeMs; } catch { return markers.map((m) => ({ marker: m, ok: false })); }

  const key = `${file}|${markers.join('\u0001')}`;
  const hit = bundleMarkerCache.get(key);
  if (hit && hit.mtimeMs === mtimeMs) return hit.results;

  let results;
  try {
    const t = fs.readFileSync(file, 'utf8');
    // marker 可以是字符串，也可以是正则（产物里的压缩变量名不固定时用正则）
    results = markers.map((m) => ({ marker: m, ok: m instanceof RegExp ? m.test(t) : t.includes(m) }));
  } catch {
    results = markers.map((m) => ({ marker: m, ok: false }));
  }
  bundleMarkerCache.set(key, { mtimeMs, results });
  return results;
}

// 补丁状态来自各 bundle 里的特征串。
// 注意：特征串必须是「补丁应用之后」的形态，且不要依赖会被混淆改名或随版本变化的
// 枚举名（历史上这里写过 un.EXPERTS，而某些版本的 bundle 用的是 on.EXPERTS，
// 导致补丁其实打了但状态显示未打）。
// 与 experts-patch.js 保持一致。
// 页面上按「功能」给开关，不按补丁编号——用户关心的是「专家团能不能用第三方模型」，
// 而那需要 P4（解锁门控）+ P2（模型出现在列表里）两条同时生效，缺一不可，
// 所以合并成一个 experts 开关。
// key:true 的才显示；其余是内部实现机制，永远启用、不显示、也拒绝被修改。
const PATCH_IDS = [
  { id: 'experts', name: '专家团', desc: '专家团使用第三方模型（解除 BYOK 门控）', key: true, covers: ['P4'] },
  { id: 'repowiki', name: 'RepoWiki', desc: '解锁 RepoWiki 生成（关掉可省上游额度）', key: true, covers: ['P12'] },
  { id: 'P1', name: '自定义模型校验', desc: '消除初始化时序竞态', key: false, covers: ['P1'] },
  { id: 'P5a', name: '专家团列表', desc: 'custom 列表不再置空', key: false, covers: ['P5a'] },
  { id: 'P5b', name: '专家团标签页', desc: '显示 custom 标签页', key: false, covers: ['P5b'] },
  { id: 'P5c', name: '专家团模型名', desc: '显示真实模型名', key: false, covers: ['P5c'] },
  { id: 'P6', name: '占位项', desc: '不再产生 id 占位', key: false, covers: ['P6'] },
  { id: 'P13', name: '模型不回落', desc: '重启后保持自定义模型，不再被覆盖成官方默认', key: false, covers: ['P13'] },
];
// 非关键补丁：始终启用，不接受页面开关
const ALWAYS_ON = new Set(PATCH_IDS.filter((p) => !p.key).flatMap((p) => p.covers));
// 开关名 -> 它控制的补丁编号
const KEY_MAP = Object.fromEntries(PATCH_IDS.filter((p) => p.key).map((p) => [p.id, p.covers]));

// 判定方式与 experts-patch.js 完全一致：用各补丁的 find 正则去匹配 bundle，
// 匹配不到原始锚点 = 已应用（这样两条路径不会给出互相矛盾的结论）。
const PATCH_FIND = {
  P1: /_isCustomModelExists\((\w+)\)\{const (\w+)=(\w+)\(\1\);return \2\?this\.customModelService\.getModels\(\)\.records\.some\((\w+)=>\4\.id===\2&&\4\.visible\):!1\}/g,
  // P4/P13 的锚点不能写死压缩变量名：Qoder 每次构建都可能改（见过 Q→Y），
  // 写了就会"匹配不到 → 被误判成已应用"。改成捕获组回引，与 experts-patch.js 保持一致。
  P4: /useMemo\)\(\(\)=>!\w+\((\w+)\.userPlan\?\.user_type,\1\.userInfo,\1\.userPlan\?\.is_personal_version\)\|\|(\w+),\[\1\.userPlan,\1\.userInfo,\2\]\)/g,
  P5a: /(\w+)=\(0,(\w+)\.useMemo\)\(\(\)=>(\w+)\?\[\]:(\w+)\.filter\((\w+)\),\[\3,\4\]\)/g,
  P5b: /(\w+)=!c&&\(!(\w+)\|\|(\w+)\)/g,
  P5c: /(\w+)=\(0,(\w+)\.useMemo\)\(\(\)=>(\w+)\?"experts-auto":(\w+),\[(\w+),(\w+)\]\)/g,
  P6: /(\w+)=!c&&(\w+)\((\w+)\);(?=!\w+\.some\()/g,
  // 新旧两种写法都认：旧版直接 return(await ...)，新版先存局部变量并多一道 isBlockedExpertsModel
  P13: /isModelConfigAvailable\((\w+),(\w+)\)\{[^}]*?_isDisabledByStrategy\(\w+\)\)\}/g,
  P12: /static shouldShowCommercialMessage\((\w+),(\w+)\)\{(?!return!1)/g,
};

// 两个 bundle 各 ~53MB，每次状态请求都跑 10 条正则会非常慢（曾导致 /api/status 超时）。
// 按文件 mtime 缓存检测结果，文件没变就直接复用。
const appliedCache = new Map(); // key: `${id}|${file}` -> { mtimeMs, applied }
function patchApplied(id) {
  const re = PATCH_FIND[id];
  if (!re) return false;
  for (const f of [bundleWb(), bundleAw()]) {
    let st;
    try { st = fs.statSync(f); } catch { continue; }
    const key = `${id}|${f}`;
    const hit = appliedCache.get(key);
    if (hit && hit.mtimeMs === st.mtimeMs) { if (hit.applied) return true; continue; }
    let applied = false;
    try {
      const t = fs.readFileSync(f, 'utf8');
      re.lastIndex = 0;
      applied = !re.test(t);          // 原始锚点不存在 = 已应用
    } catch { applied = false; }
    appliedCache.set(key, { mtimeMs: st.mtimeMs, applied });
    if (applied) return true;
  }
  return false;
}

function patchStatus() {
  const byok = bundleMarkers(bundleWb(), ['_applyByokRemoteEnabledFromResponse(e){const r=!0;', 'checkByokConfig(e,r){return{success:!0};']);
  // P4 的产物：experts 模式 BYOK 门控被解除（自定义模型改由 Qoder 原生「自定义」分组承载）。
  // 用正则而不是固定字符串：产物里的对象名随构建变化（Q / Y 都见过）。
  const experts = bundleMarkers(bundleAw(), [/useMemo\)\(\(\)=>!1,\[\w+\.userPlan,\w+\.userInfo,\w+\]\)/]);
  const live = bundleMarkers(bundleWb(), ['_lm=this;setInterval']);
  // P12：RepoWiki 商业门控被去掉
  const repowiki = bundleMarkers(bundleWb(), ['shouldShowCommercialMessage(t,e){return!1;']);
  // 每条补丁的独立开关（config.json 的 patches 字段；未配置=启用）
  let toggles = {};
  try { toggles = loadConfig().patches || {}; } catch { toggles = {}; }
  const items = PATCH_IDS
    .filter((p) => p.key)                       // 页面只显示关键开关
    .map((p) => {
      const on = p.covers.some((id) => ALWAYS_ON.has(id));
      const enabled = on ? true : toggles[p.id] !== false;
      // 该功能下所有补丁都已应用，才算"已应用"
      const applied = p.covers.every((id) => patchApplied(id));
      return Object.assign({}, p, { enabled, applied });
    });
  return {
    byok: byok.every((x) => x.ok),
    experts: experts.every((x) => x.ok),
    live: live.every((x) => x.ok),
    repowiki: repowiki.every((x) => x.ok),
    items,
    detail: { byok, experts, live, repowiki },
  };
}

async function gatewayModels(cfg) {
  const up = cfg.upstream || {};
  if (!up.baseUrl) return { ok: false, error: 'baseUrl 未配置', models: [] };
  const url = up.baseUrl.replace(/\/+$/, '') + '/models';
  try {
    const res = await fetch(url, { headers: { authorization: `Bearer ${up.apiKey || ''}` }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, models: [] };
    const j = await res.json();
    const models = (j.data || []).map((m) => ({
      id: m.id,
      name: m.display_name || m.id,
      context: m.max_input_tokens || m.context_length || 0,
      output: m.max_output_tokens || 0,
      vision: (m.modalities?.input || []).includes('image'),
      reasoning: !!m.reasoning,
      levels: m.reasoning_levels || [],
      tools: !!m.tool_call,
    }));
    return { ok: true, models };
  } catch (e) {
    return { ok: false, error: e.message, models: [] };
  }
}

// 每次轮询都 spawnSync 一次 sqlite 也在阻塞事件循环（几十~几百毫秒）。
// 数据库文件没变化时直接复用上次结果。
let recordCache = { mtimeMs: -1, value: null };

function readRecord() {
  let mtimeMs;
  try { mtimeMs = fs.statSync(DB).mtimeMs; } catch { mtimeMs = -1; }
  if (mtimeMs === recordCache.mtimeMs) return recordCache.value;

  try {
    const r = spawnSync(SQLITE, [DB, "SELECT value FROM ItemTable WHERE key='aicoding.customModels';"], { encoding: 'utf8', timeout: 8000 });
    const v = (r.stdout || '').trim();
    const value = v ? (() => { try { const a = JSON.parse(v); return Array.isArray(a) ? a : null; } catch { return null; } })() : null;
    recordCache = { mtimeMs, value };
    return value;
  } catch {
    recordCache = { mtimeMs, value: null };
    return null;
  }
}

// Qoder 每次启动会新建一个 logs/<timestamp> 目录，取最新的那个
function latestLogDir() {
  try {
    const root = path.join(process.env.APPDATA || '', 'Qoder', 'logs');
    const dirs = fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => ({ name: d.name, t: fs.statSync(path.join(root, d.name)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    return dirs.length ? path.join(root, dirs[0].name) : null;
  } catch { return null; }
}

const UPSTREAM_FIELDS = ['baseUrl', 'apiKey', 'model', 'displayName', 'reasoningEffort', 'maxTokens', 'contextLength'];
function pickUpstream(src) {
  const out = {};
  for (const k of UPSTREAM_FIELDS) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

function writeRecords(arr) {
  const json = JSON.stringify(arr);
  const r = spawnSync(SQLITE, [DB, `UPDATE ItemTable SET value = CAST('${sqlLit(json)}' AS TEXT) WHERE key='aicoding.customModels';`], { encoding: 'utf8', timeout: 8000 });
  return r.status === 0 ? null : (r.stderr || 'sqlite failed').slice(0, 300);
}

// 退出服务前的清理：把 IDE 恢复成"没有 BYOK"的官方状态。
// 只摘代理是不够的——自定义模型记录还在，Qoder 直连后选中它就发不出去。
function clearByok() {
  const steps = [];
  const run = (sql) => {
    const r = spawnSync(SQLITE, [DB, sql], { encoding: 'utf8', timeout: 8000 });
    return r.status === 0;
  };
  // 1) 清空自定义模型记录
  if (run(`UPDATE ItemTable SET value = CAST('[]' AS TEXT) WHERE key='aicoding.customModels';`)) {
    steps.push('自定义模型记录已清空');
  } else { steps.push('清空模型记录失败'); }
  // 2) 把各场景的当前模型切回官方默认值
  const official = { assistant: 'auto', experts: 'experts-auto', quest: 'quest-auto' };
  for (const [scene, val] of Object.entries(official)) {
    const key = `chat.modelConfig.${scene}`;
    run(`DELETE FROM ItemTable WHERE key='${sqlLit(key)}';`);
    const ins = spawnSync(SQLITE,
      [DB, `INSERT OR IGNORE INTO ItemTable(key,value) VALUES('${sqlLit(key)}', CAST('${sqlLit(val)}' AS TEXT));`],
      { encoding: 'utf8', timeout: 8000 });
    if (ins.status === 0) steps.push(`${scene} -> ${val}`);
  }
  // 3) 清掉会话里的模型记忆，避免旧会话恢复时又指向自定义模型
  run(`DELETE FROM ItemTable WHERE key LIKE 'chat.modelConfig.session.%';`);
  steps.push('会话模型记忆已清除');
  return steps;
}

function syncRecord() {
  const r = spawnSync('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(DIR, '..', 'scripts', 'sync-qoder-model.ps1')], { encoding: 'utf8', timeout: 60000 });
  // Manual context-length override: the gateway does not always report max_input_tokens,
  // and the record is the only place Qoder reads it from.
  const cfg = loadConfig();
  const override = Number((cfg.upstream && cfg.upstream.contextLength) || 0);
  let note = '';
  if (override > 0) {
    const arr = readRecord();
    if (arr && arr.length) {
      const idx = Math.max(0, arr.findIndex((x) => x.id === cfg.recordId));
      if (arr[idx].max_input_tokens !== override) {
        arr[idx].max_input_tokens = override;
        const err = writeRecords(arr);
        note = err ? ` (context override failed: ${err})` : ` (context override ${override})`;
      }
    }
  }
  // 同时把场景绑定指向自定义模型。回滚会把绑定清成 auto/experts-auto，
  // 只写模型记录的话，用户还得手动去 Qoder 里再选一次。
  // 但要先确认同步真的成功、记录真的存在：否则绑定指向一条不存在的模型，
  // 会出现「选中了但发不出去」，比留在 auto 更糟。
  let bindNote = ' (场景绑定未改：同步未成功)';
  if (r.status === 0) {
    const recs = readRecord();
    const want = cfg.recordId || 'model_mocktest';
    const exists = Array.isArray(recs) && recs.some((x) => x && x.id === want);
    bindNote = exists ? bindScenesToCustom(want) : ' (场景绑定未改：模型记录不存在)';
  }
  return { code: r.status, out: ((r.stdout || '') + (r.stderr || '')).trim().slice(0, 1200) + note + bindNote };
}

/** 把对话 / 专家团的场景绑定指向自定义模型 */
function bindScenesToCustom(recordId) {  const key = `custom:${recordId}`;
  const scenes = { assistant: key, experts: key };
  const done = [];
  for (const [scene, val] of Object.entries(scenes)) {
    const k = `chat.modelConfig.${scene}`;
    const del = spawnSync(SQLITE, [DB, `DELETE FROM ItemTable WHERE key='${sqlLit(k)}';`], { encoding: 'utf8', timeout: 8000 });
    const ins = spawnSync(SQLITE,
      [DB, `INSERT OR REPLACE INTO ItemTable(key,value) VALUES('${sqlLit(k)}', CAST('${sqlLit(val)}' AS TEXT));`],
      { encoding: 'utf8', timeout: 8000 });
    if (del.status === 0 && ins.status === 0) done.push(scene);
  }
  return done.length ? ` (场景绑定 -> ${key})` : ' (场景绑定失败)';
}

/**
 * 场景绑定自愈。
 *
 * 现象：chat.modelConfig.assistant 会整行消失（不是被改成 auto，是键都不存在），
 * 之后模型选择器就不再挂着自定义模型，用户得手动点一次「同步模型记录」。
 * 已排除的诱因：上游请求失败 —— 实测 100 秒窗口内跑一次必然失败的对话，三个键原样不动。
 * 实际诱因是 Qoder 自己：它把模型选择放在内存里，状态变更时整份写回 sqlite；
 * 当它此刻认为"选中的模型不存在"（例如刚跑过退出服务、记录被清空），
 * 写回时这一项就是空值，行被删掉。
 *
 * 处理原则：只在**整行不存在**时补回。
 *   - 行存在且是 custom:xxx  → 用户选的，不动
 *   - 行存在且是 auto/experts-auto → 用户切回官方，不动
 *   - 行不存在 → 本来就等于"没有选择"，补回我们管理的自定义模型
 */
const BIND_SCENES = ['assistant', 'experts'];

function readBindValue(scene) {
  const r = spawnSync(SQLITE, [DB, `SELECT value FROM ItemTable WHERE key='chat.modelConfig.${sqlLit(scene)}';`],
    { encoding: 'utf8', timeout: 8000 });
  if (r.status !== 0) return null;          // 查询失败：不知道，别乱动
  return (r.stdout || '').trim();           // '' = 整行不存在
}

function repairSceneBindings() {
  const cfg = loadConfig();
  const want = cfg.recordId || 'model_mocktest';
  const recs = readRecord();
  if (!Array.isArray(recs) || !recs.some((x) => x && x.id === want)) return [];  // 记录都没有就别写
  const fixed = [];
  for (const scene of BIND_SCENES) {
    const cur = readBindValue(scene);
    if (cur === null || cur !== '') continue;      // 查询失败 或 行还在 → 不动
    const k = `chat.modelConfig.${scene}`;
    const r = spawnSync(SQLITE,
      [DB, `INSERT OR REPLACE INTO ItemTable(key,value) VALUES('${sqlLit(k)}', CAST('custom:${sqlLit(want)}' AS TEXT));`],
      { encoding: 'utf8', timeout: 8000 });
    if (r.status === 0) fixed.push(scene);
  }
  if (fixed.length) console.log(`[binding-guard] restored scene bindings: ${fixed.join(',')} -> custom:${want}`);
  return fixed;
}

function startProxy() {
  const node = process.execPath;
  const child = spawn(node, [path.join(DIR, 'proxy.js')], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}
function stopProxy() {
  // Get-Process 没有 CommandLine 属性（取到的是 null），这个 Where 永远筛不出东西，
  // 所以以前点「重启代理」实际一个进程都没停，界面却提示成功。
  // 改用 Get-CimInstance 取命令行，并用 -like 避开多层反斜杠转义。
  const ps = "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
    "Where-Object { $_.CommandLine -like '*qoder-proxy*proxy.js*' } | " +
    "ForEach-Object { Stop-Process -Id $_.ProcessId -Force }";
  const r = spawnSync('powershell', ['-NoProfile', '-Command', ps],
    { encoding: 'utf8', timeout: 15000 });
  return r.status;
}

function setIdeProxy(port) {
  const s = readJSON(SETTINGS, {});
  // 记一笔"我们期望 IDE 指向哪个端口"，供守卫在被 Qoder 覆盖后恢复。
  const cfg = loadConfig();
  if (port === null || port === 0 || port === '') {
    // Restore factory state: no proxy key at all.
    delete s['http.proxy'];
    writeJSON(SETTINGS, s);
    if (cfg.ideProxyPort) { delete cfg.ideProxyPort; writeJSON(CONFIG, cfg); }
    return '';
  }
  s['http.proxy'] = `http://127.0.0.1:${port}`;
  writeJSON(SETTINGS, s);
  if (cfg.ideProxyPort !== Number(port)) { cfg.ideProxyPort = Number(port); writeJSON(CONFIG, cfg); }
  return s['http.proxy'];
}
function autoUpdateState() {
  const s = readJSON(SETTINGS, {});
  const a = readJSON(APPJSON, {});
  return {
    settings: s?.app?.configAdvancedAutoUpdate,
    appjson: a?.config?.advanced?.autoUpdate,
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const send = (code, obj, type = 'application/json') => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(typeof obj === 'string' ? obj : JSON.stringify(obj));
  };
  const body = () => new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 2e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
  });

  /**
   * 同源校验：挡掉浏览器发起的跨站请求。
   *
   * 控制台绑在 127.0.0.1 且没有 token，浏览器里任何网页都能对本机发请求。
   * 带 application/json 的会被 CORS 预检挡住，但 text/plain 属于"简单请求"
   * 不触发预检 —— 而 body() 只看内容不看头部，于是恶意页面可以用表单提交的
   * 方式调 /api/apply（本机 UAC 是静默提权）或 /api/config（改上游地址）。
   * 这里只看 Origin：只放行控制台自己。命令行 curl 不带 Origin，不受影响。
   */
  const origin = req.headers.origin || '';
  if (origin && origin !== `http://127.0.0.1:${PORT}` && origin !== `http://localhost:${PORT}`) {
    return send(403, { ok: false, error: 'cross-origin request rejected' });
  }

  try {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return send(200, fs.readFileSync(path.join(DIR, 'index.html'), 'utf8'), 'text/html; charset=utf-8');
    }

    // 站点图标 / PWA
    if (url.pathname === '/icon.svg' || url.pathname === '/favicon.svg' || url.pathname === '/favicon.ico') {
      const file = path.join(DIR, 'icon.svg');
      if (!fs.existsSync(file)) return send(404, { ok: false, error: 'not found' });
      res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=604800' });
      return res.end(fs.readFileSync(file));
    }

    if (url.pathname === '/icon-192.png' || url.pathname === '/icon.png' || url.pathname === '/apple-touch-icon.png') {
      const file = path.join(DIR, 'icon-192.png');
      if (!fs.existsSync(file)) return send(404, { ok: false, error: 'not found' });
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=604800' });
      return res.end(fs.readFileSync(file));
    }

    // 本地字体（离线可用）
    if (url.pathname.startsWith('/fonts/')) {
      const rel = url.pathname.slice('/fonts/'.length);
      if (!/^[a-z0-9._-]+$/i.test(rel)) return send(400, { ok: false, error: 'bad path' });
      const file = path.join(DIR, 'fonts', rel);
      if (!fs.existsSync(file)) return send(404, { ok: false, error: 'not found' });
      const type = rel.endsWith('.woff2') ? 'font/woff2' : rel.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/octet-stream';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=86400' });
      return res.end(fs.readFileSync(file));
    }
    
    // 样式文件
    // 本地工具，改完就该立刻看到 —— 不能让它被浏览器缓存，
    // 否则改了 CSS 用户刷新后还是旧样式（踩过这个坑）
    if (url.pathname.startsWith('/styles/')) {
      const rel = url.pathname.slice('/styles/'.length);
      if (!/^[a-z0-9._-]+$/i.test(rel)) return send(400, { ok: false, error: 'bad path' });
      const file = path.join(DIR, 'styles', rel);
      if (!fs.existsSync(file)) return send(404, { ok: false, error: 'not found' });
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-store, must-revalidate' });
      return res.end(fs.readFileSync(file));
    }
    
    // JS 模块
    if (url.pathname.startsWith('/src/')) {
      const rel = url.pathname.slice('/src/'.length);
      // 支持子目录（views/）
      if (!/^[a-z0-9._/-]+$/i.test(rel)) return send(400, { ok: false, error: 'bad path' });
      const file = path.join(DIR, 'src', rel);
      if (!fs.existsSync(file)) return send(404, { ok: false, error: 'not found' });
      const type = rel.endsWith('.js') ? 'application/javascript; charset=utf-8' : 'application/octet-stream';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store, must-revalidate' });
      return res.end(fs.readFileSync(file));
    }

    if (url.pathname === '/api/status') {
      const cfg = loadConfig();
      const [proxyUp] = await Promise.all([portOpen(proxyPort())]);
      const settings = readJSON(SETTINGS, {});
      return send(200, {
      cert: certInfo(),
        proxy: { running: proxyUp, port: proxyPort() },
        ide: { httpProxy: settings['http.proxy'] || '', autoUpdate: autoUpdateState(), ...ideInfo() },
        patches: patchStatus(),
        config: cfg,
        setupDone: cfg.setupDone === true,
        record: readRecord(),
      });
    }

    // 首次引导完成后打标记，避免每次打开都弹
    if (url.pathname === '/api/setup/done' && req.method === 'POST') {
      const cfg = loadConfig();
      cfg.setupDone = true;
      writeJSON(CONFIG, cfg);
      return send(200, { ok: true, setupDone: true });
    }
    if (url.pathname === '/api/setup/reset' && req.method === 'POST') {
      const cfg = loadConfig();
      cfg.setupDone = false;
      writeJSON(CONFIG, cfg);
      return send(200, { ok: true, setupDone: false });
    }

    if (url.pathname === '/api/models') {
      const cfg = loadConfig();
      // ?profile=<名称> 用指定上游配置的网关拉模型；不传则用当前生效的
      const profileName = url.searchParams.get('profile');
      let target = cfg;
      if (profileName) {
        const p = (cfg.profiles || {})[profileName];
        if (!p) return send(404, { ok: false, error: `没有名为 ${profileName} 的上游配置`, models: [] });
        target = Object.assign({}, cfg, { upstream: Object.assign({}, cfg.upstream, p) });
      }
      const out = await gatewayModels(target);
      return send(200, Object.assign({}, out, {
        source: profileName || cfg.activeProfile || '',
        baseUrl: (target.upstream || {}).baseUrl || '',
      }));
    }

    if (url.pathname === '/api/config' && req.method === 'GET') {
      return send(200, loadConfig());
    }

    if (url.pathname === '/api/config' && req.method === 'POST') {
      const incoming = await body();
      const cfg = loadConfig();
      const oldPort = Number(cfg.proxyPort || DEFAULT_PROXY_PORT);
      cfg.upstream = Object.assign({}, cfg.upstream, incoming.upstream || {});
      if (incoming.recordId) cfg.recordId = incoming.recordId;
      if (typeof incoming.injectTools === 'boolean') cfg.injectTools = incoming.injectTools;
      if (typeof incoming.serveWiki === 'boolean') cfg.serveWiki = incoming.serveWiki;
      if (incoming.proxyPort) {
        // 只接受 1~65535 的整数。非法值会让 /api/status 整体失败（见 proxyPort 注释）。
        const np = Number(incoming.proxyPort);
        if (Number.isInteger(np) && np > 0 && np < 65536) cfg.proxyPort = np;
      }
      writeJSON(CONFIG, cfg);
      // 端口一变，IDE 里记着的 http.proxy 就指向一个没人监听的端口 —— Qoder 会静默失联。
      // 之前只在 hint 里写「改完需重启代理」，没人会想到还要重新指向 IDE。
      let portNote = '';
      const newPort = Number(cfg.proxyPort || DEFAULT_PROXY_PORT);
      if (newPort !== oldPort && newPort > 0 && newPort < 65536) {
        const cur = readJSON(SETTINGS, {})['http.proxy'] || '';
        const m = /127\.0\.0\.1:(\d+)/.exec(cur);
        if (m && Number(m[1]) === oldPort) {
          setIdeProxy(newPort);
          portNote = ` http.proxy 已同步改为 ${newPort}`;
        } else if (cur) {
          portNote = ` 注意：IDE 的 http.proxy 仍指向 ${cur}，需手动改到 ${newPort}`;
        }
      }
      let sync = null;
      if (incoming.sync !== false) sync = syncRecord();
      return send(200, { ok: true, config: cfg, sync, portNote });
    }

    if (url.pathname === '/api/sync' && req.method === 'POST') {
      return send(200, { ok: true, sync: syncRecord() });
    }

    // ---- 多套上游：Qoder 的 x-model-key 是常量 custom_model，无法按记录分流，
    // 所以这里是"存多套、切一套"的做法 ----

    if (url.pathname === '/api/profiles' && req.method === 'GET') {
      const cfg = loadConfig();
      const profiles = cfg.profiles || {};
      const list = Object.keys(profiles).map((name) => ({
        name,
        active: name === cfg.activeProfile,
        baseUrl: profiles[name].baseUrl || '',
        apiKeySet: !!profiles[name].apiKey,
        model: profiles[name].model || '',
        displayName: profiles[name].displayName || '',
        reasoningEffort: profiles[name].reasoningEffort || '',
        maxTokens: profiles[name].maxTokens || null,
        contextLength: profiles[name].contextLength || null,
      }));
      return send(200, { ok: true, active: cfg.activeProfile || '', list });
    }
    if (url.pathname === '/api/profiles/save' && req.method === 'POST') {
      const p = await body();
      const clean = String(p.name || '').trim();
      if (!clean) return send(400, { ok: false, error: '名字不能为空' });
      const cfg = loadConfig();
      cfg.profiles = cfg.profiles || {};
      const merged = Object.assign({}, cfg.profiles[clean] || {}, pickUpstream(p.upstream || {}));
      if (p.renameFrom && p.renameFrom !== clean && cfg.profiles[p.renameFrom]) delete cfg.profiles[p.renameFrom];
      cfg.profiles[clean] = merged;
      // shared settings that live outside a profile
      const sh = p.shared || {};
      if (sh.recordId) cfg.recordId = sh.recordId;
      if (typeof sh.injectTools === 'boolean') cfg.injectTools = sh.injectTools;
      if (typeof sh.serveWiki === 'boolean') cfg.serveWiki = sh.serveWiki;
      if (sh.proxyPort) cfg.proxyPort = Number(sh.proxyPort);
      // 保存当前正在编辑的这一套时，同步生效（同样先清掉由 profile 管理的字段）
      if (p.activate !== false) {
        const base = Object.assign({}, cfg.upstream);
        for (const k of UPSTREAM_FIELDS) delete base[k];
        cfg.upstream = Object.assign(base, pickUpstream(merged));
        cfg.activeProfile = clean;
      }
      writeJSON(CONFIG, cfg);
      const sync = p.activate !== false ? syncRecord() : null;
      return send(200, { ok: true, active: cfg.activeProfile, sync });
    }
    if (url.pathname === '/api/profiles/apply' && req.method === 'POST') {
      const { name } = await body();
      const cfg = loadConfig();
      const p = (cfg.profiles || {})[name];
      if (!p) return send(404, { ok: false, error: `没有名为 ${name} 的配置` });
      // Reset profile-managed fields first: Object.assign alone would keep values the
      // previous upstream had but this profile does not define (e.g. contextLength),
      // and a stale override then overwrites the freshly synced record.
      const base = Object.assign({}, cfg.upstream);
      for (const k of UPSTREAM_FIELDS) delete base[k];
      cfg.upstream = Object.assign(base, pickUpstream(p));
      cfg.activeProfile = name;
      writeJSON(CONFIG, cfg);
      const sync = syncRecord();
      return send(200, { ok: true, config: cfg, upstream: cfg.upstream, sync });
    }
    if (url.pathname === '/api/profiles/delete' && req.method === 'POST') {
      const { name } = await body();
      const cfg = loadConfig();
      if (!cfg.profiles || !cfg.profiles[name]) return send(404, { ok: false, error: '不存在' });
      delete cfg.profiles[name];
      if (cfg.activeProfile === name) cfg.activeProfile = '';
      writeJSON(CONFIG, cfg);
      return send(200, { ok: true, active: cfg.activeProfile });
    }

    // 连通性自测：直接打一次上游（非流式、极小输出）
    if (url.pathname === '/api/test' && req.method === 'POST') {
      const cfg = loadConfig();
      const up = cfg.upstream || {};
      if (!up.baseUrl) return send(400, { ok: false, error: 'baseUrl 未配置' });
      const target = new URL(up.baseUrl.replace(/\/$/, '') + '/chat/completions');
      const t0 = Date.now();
      try {
        const res = await fetch(target, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${up.apiKey || ''}` },
          body: JSON.stringify({ model: up.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 8 }),
          signal: AbortSignal.timeout(25000),
        });
        const text = await res.text();
        return send(200, { ok: res.ok, status: res.status, ms: Date.now() - t0, sample: text.slice(0, 400) });
      } catch (e) {
        return send(200, { ok: false, error: e.message, ms: Date.now() - t0 });
      }
    }

    if (url.pathname === '/api/proxy' && req.method === 'POST') {
      const { action } = await body();
      if (action === 'start') {
        if (!(await portOpen(proxyPort()))) startProxy();
        await new Promise((r) => setTimeout(r, 1200));
        return send(200, { ok: true, running: await portOpen(proxyPort()) });
      }
      if (action === 'stop') {
        stopProxy();
        await new Promise((r) => setTimeout(r, 800));
        return send(200, { ok: true, running: await portOpen(proxyPort()) });
      }
      return send(400, { ok: false, error: 'unknown action' });
    }

    // 退出服务：先把 Qoder 恢复成「不设代理」，再停本地代理，最后退出控制台。
    // 顺序很重要——不先摘掉 IDE 的代理指向，关闭代理后 Qoder 会连不上网。
    if (url.pathname === '/api/shutdown' && req.method === 'POST') {
      const steps = [];
      // 顺序很重要：先让 IDE 回到官方模型与官方网络，再停服务。
      // 只摘代理而留着 BYOK 记录的话，Qoder 直连后选中自定义模型就发不出去。
      try { steps.push(...clearByok()); }
      catch (e) { steps.push('清理 BYOK 失败：' + e.message); }
      try { setIdeProxy(null); steps.push('Qoder 已恢复为不设代理'); }
      catch (e) { steps.push('恢复代理失败：' + e.message); }
      try { stopProxy(); await new Promise((r) => setTimeout(r, 700)); steps.push('本地代理已停止'); }
      catch (e) { steps.push('停止代理失败：' + e.message); }
      setTimeout(() => { try { process.exit(0); } catch (e) { /* ignore */ } }, 400);
      return send(200, { ok: true, steps });
    }

    // 弹原生目录选择框，返回用户选中的路径（取消返回 cancelled）
    // 控制台和 Qoder 跑在同一台机器上，所以由后端开 WinForms 对话框，
    // 浏览器侧拿不到真实绝对路径，只能这样做。
    if (url.pathname === '/api/pick-folder' && req.method === 'POST') {
      const { initial } = await body().catch(() => ({}));
      const start = String(initial || resolveIdeRoot()).replace(/'/g, "''");
      const script = [
        '$ErrorActionPreference = "SilentlyContinue"',
        'Add-Type -AssemblyName System.Windows.Forms',
        '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
        "$d.Description = '选择 Qoder 安装目录（包含 resources\\app 的那一层）'",
        '$d.ShowNewFolderButton = $false',
        `$d.SelectedPath = '${start}'`,
        '$r = $d.ShowDialog()',
        'if ($r -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output ("PICKED:" + $d.SelectedPath) } else { Write-Output "CANCELLED" }',
      ].join('\r\n');
      const enc = Buffer.from(script, 'utf16le').toString('base64');
      const r = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-OutputFormat', 'Text', '-EncodedCommand', enc], {
        encoding: 'utf8', timeout: 300000, windowsHide: false,
      });
      // PowerShell 会把 Add-Type 等的输出以 CLIXML 形式混进 stdout/stderr，
      // 所以两个流都扫一遍，逐行找标记。
      const all = (String(r.stdout || '') + '\n' + String(r.stderr || '')).split(/\r?\n/);
      for (const line of all) {
        const m = /PICKED:(.+)/.exec(line);
        if (m) return send(200, { ok: true, path: m[1].trim() });
      }
      if (all.some((l) => /CANCELLED/.test(l))) return send(200, { ok: false, cancelled: true });
      return send(200, { ok: false, error: '未能打开目录选择框（可能当前没有交互桌面）' });
    }

    // 证书状态与一键信任
  if (url.pathname === '/api/cert' && req.method === 'GET') {
    return send(200, certInfo());
  }
  // 把 ca.crt 装进「当前用户 → 受信任的根证书颁发机构」。
  //
  // 同步执行（spawnSync）：certutil 会弹「安全警告」框等用户点「是」，点完才返回。
  // 期间控制台的主线程被占住、其它请求排队 —— 这是刻意接受的代价：
  // 一次点击 = 一次完整尝试，结果直接返回，失败就再点一次，没有"后台任务"这种中间状态。
  // （异步版要轮询、要处理残留任务，反而更难重新操作。）
  if (url.pathname === '/api/trust-cert' && req.method === 'POST') {
    const before = certInfo(true);
    if (!before.exists) return send(400, { ok: false, error: 'ca.crt 不存在，请先启动代理（会自动生成证书）' });
    if (before.trusted) return send(200, { ok: true, already: true, trusted: true, cert: before });

    const t0 = Date.now();
    const r = spawnSync('certutil', ['-user', '-addstore', 'Root', before.path], {
      encoding: 'utf8', windowsHide: false, timeout: 300000,
    });
    const after = certInfo(true);
    const seconds = Math.round((Date.now() - t0) / 100) / 10;
    if (after.trusted) return send(200, { ok: true, trusted: true, seconds, cert: after });

    const detail = ((r.stderr || '') + (r.stdout || '')).trim().split('\n').slice(-2).join(' ');
    return send(500, {
      ok: false,
      error: '证书未装上：' + (detail || (r.error ? r.error.message : 'certutil 未返回成功，可能是弹窗里选了「否」')),
      seconds,
      cert: after,
    });
  }
  if (url.pathname === '/api/ide-proxy' && req.method === 'POST') {
      const { port } = await body();
      // port === null 表示恢复原样（删除 http.proxy，不用任何代理）
      if (port !== null && port !== 0 && !(await portOpen(port))) {
        // 指向本代理时自动拉起，避免"先设代理再启动"的死结
        if (Number(port) === proxyPort()) {
          startProxy();
          await new Promise((r) => setTimeout(r, 1500));
        }
        if (!(await portOpen(port))) return send(400, { ok: false, error: `端口 ${port} 没有服务在监听` });
      }
      const v = setIdeProxy(port);
      // 让 IDE 走代理 = 启用第三方模型，所以同时把 BYOK 记录写回去。
      // 否则只设了代理但模型列表里没有自定义模型（或被清过），功能不完整。
      let sync = null;
      if (port !== null && port !== 0) {
        try { sync = syncRecord(); } catch (e) { sync = { code: -1, out: String(e.message || e) }; }
      }
      return send(200, { ok: true, httpProxy: v, sync });
    }

    // 每条补丁的独立开关（Web 控制台勾选，存 config.json 的 patches 字段）
    if (url.pathname === '/api/patches' && req.method === 'GET') {
      const cfg = loadConfig();
      return send(200, { ok: true, patches: cfg.patches || {}, ids: PATCH_IDS.filter((p) => p.key) });
    }

    if (url.pathname === '/api/patches' && req.method === 'POST') {
      const incoming = await body();
      const cfg = loadConfig();
      cfg.patches = Object.assign({}, cfg.patches || {});
      // 只接受关键开关；内部机制补丁一律忽略，避免被关掉导致功能残缺
      for (const [name, v] of Object.entries(incoming.patches || {})) {
        if (!KEY_MAP[name]) continue;            // 不是可开关的功能名，忽略
        cfg.patches[name] = v !== false;
      }
      writeJSON(CONFIG, cfg);
      return send(200, { ok: true, patches: cfg.patches });
    }

    // 全部回滚：恢复 Qoder 原样（原 bundle、原 CSP、无代理、自动更新开），需要 UAC 提权
    if (url.pathname === '/api/revert' && req.method === 'POST') {
      const script = path.join(DIR, '..', 'revert-all.ps1');
      if (!fs.existsSync(script)) return send(500, { ok: false, error: 'revert-all.ps1 不存在' });
      const logFile = path.join(DIR, '..', '_revert_all_log.txt');
      try { fs.unlinkSync(logFile); } catch { /* ignore */ }
      // 回滚 = 恢复官方状态。revert-all.ps1 默认保留模型记录，
      // 那会留下"补丁没了 + 代理没了，但自定义模型还在"的坏状态（选中发不出去）。
      // 所以发起回滚前先清 BYOK。
      let byok = [];
      try { byok = clearByok(); } catch (e) { byok = ['清理 BYOK 失败：' + e.message]; }
      const args = ['-NoProfile', '-Command',
        `Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${script.replace(/'/g, "''")}','-Root','"${resolveIdeRoot().replace(/"/g, '""')}"'`];
      // 同 /api/apply：必须等启动器跑完，否则提权进程不会真正拉起
      try {
        spawnSync('powershell.exe', args, { encoding: 'utf8', timeout: 20000, windowsHide: true });
      } catch { /* ignore */ }
      return send(200, { ok: true, started: true, note: '已弹出 UAC，请在系统弹窗中确认；完成后重启 Qoder IDE。' });
    }

    if (url.pathname === '/api/revert-status') {
      const logFile = path.join(DIR, '..', '_revert_all_log.txt');
      let lines = [];
      try { lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean); } catch { /* none */ }
      return send(200, { ok: true, lines, done: lines.some((l) => l.includes('REVERT-ALL DONE')) });
    }

    // 应用全部补丁（重装/升级 Qoder 后使用），需要 UAC 提权
    if (url.pathname === '/api/apply' && req.method === 'POST') {
      const script = path.join(DIR, '..', 'apply-all.ps1');
      if (!fs.existsSync(script)) return send(500, { ok: false, error: 'apply-all.ps1 不存在' });
      const applyLog = path.join(DIR, '..', '_apply_all_log.txt');
      try { fs.unlinkSync(applyLog); } catch { /* ignore */ }
      // 必须等这个「启动器」powershell 跑完，提权进程才真的会被拉起来。
      // 以前用 spawn(detached + stdio:'ignore') 发完就 unref，结果提权命令
      // 根本没有执行 —— 界面上点「应用补丁」永远没反应，也不报错。
      const args = ['-NoProfile', '-Command',
        `Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${script.replace(/'/g, "''")}','-Root','"${resolveIdeRoot().replace(/"/g, '""')}"'`];
      try {
        spawnSync('powershell.exe', args, { encoding: 'utf8', timeout: 20000, windowsHide: true });
      } catch { /* 提权被拒也继续，日志里能看到 */ }
      return send(200, { ok: true, started: true, note: '已弹出 UAC，请确认；完成后重启 Qoder IDE。' });
    }

    if (url.pathname === '/api/apply-status') {
      let lines = [];
      try { lines = fs.readFileSync(path.join(DIR, '..', '_apply_all_log.txt'), 'utf8').split('\n').filter(Boolean); } catch { /* none */ }
      return send(200, { ok: true, lines, done: lines.some((l) => l.includes('APPLY-ALL DONE')) });
    }

    // 重新探测 Qoder 安装目录，或手动指定
    if (url.pathname === '/api/ide-detect' && req.method === 'POST') {
      const payload = await body();
      const hasRoot = Object.prototype.hasOwnProperty.call(payload, 'root');
      const root = hasRoot ? String(payload.root || '').trim() : null;

      // 传了空串 = 清掉手动指定，恢复「每次自动探测」
      if (hasRoot && !root) {
        const cfgR = loadConfig();
        delete cfgR.ideRoot;
        writeJSON(CONFIG, cfgR);
        _rootCache = { at: 0, root: null };
        return send(200, { ok: true, cleared: true, info: ideInfo() });
      }

      if (root) {
        const clean = String(root).replace(/[\\/]+$/, '');
        if (!looksLikeIdeRoot(clean)) {
          return send(400, { ok: false, error: '这个目录下找不到 workbench.desktop.main.js，不是有效的安装目录', info: ideInfo() });
        }
        const cfg0 = loadConfig();
        cfg0.ideRoot = clean;
        writeJSON(CONFIG, cfg0);
        _rootCache = { at: 0, root: null };
        return send(200, { ok: true, saved: true, info: ideInfo() });
      }
      const found = detectRootFromProcess() || detectRootFromCommonPaths();
      if (found) {
        const cfg1 = loadConfig();
        cfg1.ideRoot = found;
        writeJSON(CONFIG, cfg1);
        _rootCache = { at: 0, root: null };
        return send(200, { ok: true, found, saved: true, info: ideInfo() });
      }
      return send(200, { ok: false, error: '未自动找到 Qoder 安装目录，请手动指定', info: ideInfo() });
    }

    // 工具补全开关（写）
    // 之前只有 GET 分支，前端的 POST 会被 GET 吞掉并返回当前状态，
    // 于是界面提示「已关闭」但配置根本没变 —— 实测抓到的 bug。
    if (url.pathname === '/api/tools' && req.method === 'POST') {
      const { injectTools } = await body();
      const cfg = loadConfig();
      if (typeof injectTools === 'boolean') cfg.injectTools = injectTools;
      writeJSON(CONFIG, cfg);
      return send(200, { ok: true, enabled: cfg.injectTools !== false });
    }

    // 当前注入的工具清单（只读展示）
    if (url.pathname === '/api/tools') {
      let names = [];
      try {
        const arr = JSON.parse(fs.readFileSync(path.join(DIR, 'tools-extra.json'), 'utf8'));
        names = arr.map((t) => (t.function && t.function.name) || '?');
      } catch { /* none */ }
      const cfg = loadConfig();
      return send(200, { ok: true, enabled: cfg.injectTools !== false, injected: names });
    }

    // 导出 / 导入配置（换机或备份用）
    if (url.pathname === '/api/export') {
      let tools = [];
      try { tools = JSON.parse(fs.readFileSync(path.join(DIR, 'tools-extra.json'), 'utf8')); } catch { /* none */ }
      return send(200, { ok: true, config: loadConfig(), tools });
    }
    if (url.pathname === '/api/import' && req.method === 'POST') {
      const p = await body();
      if (!p || typeof p !== 'object') return send(400, { ok: false, error: '无效内容' });
      const cfg = loadConfig();
      const next = Object.assign({}, cfg, p.config || {});
      writeJSON(CONFIG, next);
      if (Array.isArray(p.tools) && p.tools.length) {
        fs.writeFileSync(path.join(DIR, 'tools-extra.json'), JSON.stringify(p.tools, null, 2), 'utf8');
      }
      // 导入后立即同步模型记录，否则 config 与 IDE 里的记录会不一致
      const sync = syncRecord();
      return send(200, { ok: true, config: next, sync });
    }

    // 首次使用引导：把不需要提权的事一次做完
    if (url.pathname === '/api/init' && req.method === 'POST') {
      const steps = [];
      const cfg = loadConfig();
      // 1) 代理
      if (!(await portOpen(proxyPort()))) { startProxy(); await new Promise((r) => setTimeout(r, 1500)); }
      steps.push({ step: 'proxy', ok: await portOpen(proxyPort()) });
      // 2) 证书信任：只报告状态，**不在这里安装**。
      //    certutil 会弹「安全警告」等用户点「是」，装进一键流程会让整个请求挂住，
      //    用户在弹窗上花多久，控制台就卡多久。安装交给「信任证书」按钮（异步 + 轮询）。
      try {
        const ci = certInfo();
        steps.push({
          step: 'cert',
          ok: ci.trusted,
          needConfirm: !ci.trusted,
          detail: ci.trusted ? '已信任' : (ci.exists ? '未信任，需在维护页点「信任证书」' : '证书未生成'),
        });
      } catch (e) { steps.push({ step: 'cert', ok: false, error: e.message }); }

      // 3) 模型记录
      try {
        const s = syncRecord();
        steps.push({ step: 'record', ok: s.code === 0, out: (s.out || '').split('\n').slice(-3).join(' | ') });
      } catch (e) { steps.push({ step: 'record', ok: false, error: e.message }); }
      // 4) IDE 代理
      try { setIdeProxy(proxyPort()); steps.push({ step: 'ide-proxy', ok: true, value: `http://127.0.0.1:${proxyPort()}` }); }
      catch (e) { steps.push({ step: 'ide-proxy', ok: false, error: e.message }); }
      // 5) 补丁状态（需要提权，仅报告）
      const pat = patchStatus();
      steps.push({ step: 'patches', ok: pat.byok && pat.live, needAdmin: !(pat.byok && pat.live), detail: { byok: pat.byok, live: pat.live } });
      return send(200, { ok: true, steps, config: cfg });
    }

    // 日志：支持来源选择、关键字过滤、清空
    if (url.pathname === '/api/logs') {
      const n = Math.min(Number(url.searchParams.get('n') || 120), 800);
      const src = String(url.searchParams.get('src') || 'proxy');
      const q = String(url.searchParams.get('q') || '');
      let lines = [];
      const sources = src === 'all' ? ['proxy', 'agent', 'renderer'] : [src];
      for (const s of sources) {
        let p = LOG;
        if (s !== 'proxy') {
          const latest = latestLogDir();
          if (!latest) continue;
          p = path.join(latest, 'window1', s === 'agent' ? 'agent.log' : 'renderer.log');
        }
        try {
          let part = readTailLines(p).filter(Boolean);
          if (q) part = part.filter((l) => l.toLowerCase().includes(q.toLowerCase()));
          part = part.slice(-n).map((l) => (s === 'proxy' ? l : `[${s}] ${l}`));
          lines = lines.concat(part);
        } catch { /* missing */ }
      }
      return send(200, { ok: true, lines: lines.slice(-n), src, q });
    }
    if (url.pathname === '/api/logs/clear' && req.method === 'POST') {
      const { src } = await body();
      let cleared = [];
      if (!src || src === 'proxy') { try { fs.writeFileSync(LOG, '', 'utf8'); cleared.push('proxy'); } catch { /* ignore */ } }
      return send(200, { ok: true, cleared });
    }

    return send(404, { ok: false, error: 'not found' });
  } catch (e) {
    return send(500, { ok: false, error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Qoder BYOK console: http://127.0.0.1:${PORT}`);
  // 启动时把安装目录探明一次（要 spawn PowerShell，约 200ms）。
  // 放在这里而不是 /api/status 里，避免每次轮询都把单线程服务卡住。
  try {
    const r = resolveIdeRoot(true);
    console.log(`Qoder install root: ${r}`);
  } catch (e) { /* 探测失败就退回默认值，不影响启动 */ }
});

// Watchdog: if the IDE is pointed at our proxy but it is not listening (crash, kill,
// reboot), bring it back so the IDE does not sit there with no network.
setInterval(async () => {
  try {
    const s = readJSON(SETTINGS, {});
    const proxy = String(s['http.proxy'] || '');
    if (!proxy.includes(`:${proxyPort()}`)) return;
    if (await portOpen(proxyPort())) return;
    startProxy();
    await new Promise((r) => setTimeout(r, 1500));
    const up = await portOpen(proxyPort());
    console.log(`[watchdog] proxy was down, restart ${up ? 'ok' : 'failed'}`);
  } catch { /* ignore */ }
}, 15000);

// 场景绑定守卫：Qoder 状态写回时可能把 chat.modelConfig.* 整行删掉（见 repairSceneBindings 注释）。
// 20 秒查一次，只在整行缺失时补回，20 秒延迟用户基本感知不到。
setInterval(() => {
  try { repairSceneBindings(); } catch { /* 数据库被占用等情况忽略，下一轮再试 */ }
}, 20000);

/**
 * http.proxy 守卫。
 *
 * Qoder 退出时会把它内存里的 settings 整份写回 settings.json，曾观察到
 * http.proxy 被抹掉（表现为 Qoder 恢复直连、所有请求不再经过我们）。
 * 只要用户没有主动点「退出服务」，config.ideProxyPort 就还在，这里发现
 * 指向丢了就补回去。用户主动退出服务时 setIdeProxy(null) 会清掉这个标记，
 * 所以不会跟用户的操作打架。
 */
setInterval(() => {
  try {
    const want = Number(loadConfig().ideProxyPort || 0);
    if (!want) return;
    const cur = String(readJSON(SETTINGS, {})['http.proxy'] || '');
    if (cur === `http://127.0.0.1:${want}`) return;
    writeJSON(SETTINGS, Object.assign(readJSON(SETTINGS, {}), { 'http.proxy': `http://127.0.0.1:${want}` }));
    console.log(`[ide-proxy-guard] http.proxy was "${cur}", restored to :${want}`);
  } catch { /* 文件被占用，下轮再试 */ }
}, 30000);

/* ================= 磁盘卫生 ================= */
/**
 * bodies/ 与 proxy.log 都没有上限：代理每处理一条对话就落 3 个文件
 * （raw 原始包 / decoded 解码文本 / resp SSE），长时间使用会一直涨。
 * 这里做两件事，都是纯增量清理，不动任何配置：
 *   1. bodies 目录按 mtime 只留最近 400 个文件
 *   2. proxy.log 超过 20MB 就滚动成 proxy.log.1（只留一份历史）
 * proxy.js 用的是 appendFileSync（每次重新打开），所以改名不会丢写入。
 */
const BODY_DIR = path.join(DIR, 'bodies');
const BODY_KEEP = 400;
const LOG_MAX_BYTES = 20 * 1024 * 1024;

function pruneBodies() {
  let files = [];
  try {
    files = fs.readdirSync(BODY_DIR)
      .map((f) => { const p = path.join(BODY_DIR, f); try { return { p, m: fs.statSync(p).mtimeMs }; } catch { return null; } })
      .filter(Boolean)
      .sort((a, b) => b.m - a.m);
  } catch { return 0; }
  if (files.length <= BODY_KEEP) return 0;
  let n = 0;
  for (const f of files.slice(BODY_KEEP)) {
    try { fs.unlinkSync(f.p); n++; } catch { /* 占用就跳过 */ }
  }
  if (n) console.log(`[disk-guard] bodies: removed ${n} old files (kept ${BODY_KEEP})`);
  return n;
}

function rotateLog() {
  try {
    const st = fs.statSync(LOG);
    if (st.size <= LOG_MAX_BYTES) return false;
    const old = LOG + '.1';
    try { fs.unlinkSync(old); } catch { /* 没有旧的 */ }
    fs.renameSync(LOG, old);
    console.log(`[disk-guard] proxy.log ${(st.size / 1048576).toFixed(1)}MB -> proxy.log.1`);
    return true;
  } catch { return false; }
}

function diskHousekeeping() {
  try { pruneBodies(); } catch { /* ignore */ }
  try { rotateLog(); } catch { /* ignore */ }
}
setTimeout(diskHousekeeping, 20000);          // 启动后先跑一次
setInterval(diskHousekeeping, 30 * 60 * 1000); // 之后每 30 分钟

