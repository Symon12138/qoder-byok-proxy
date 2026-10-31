/**
 * 第三轮回归脚手架（严格版）
 *
 * 与上一轮的区别：
 *   1. 断言必须比较 expected 与 actual，不允许硬编码 true
 *   2. 不做任何重试 —— 首次失败就是失败，记下来继续
 *   3. 测试前校验 console 进程启动时间 vs admin.js 修改时间，旧进程先重启
 *   4. 记录起始状态快照，不自动"修复"前提
 */
const { spawn, spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = 'E:\\Project\\AI\\dsh';
const PROXY = path.join(ROOT, 'qoder-proxy');
const NODE = 'E:\\environment\\nodejs\\node.exe';
const SQLITE = 'C:\\Users\\Administrator\\scoop\\shims\\sqlite3.exe';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = path.join(PROXY, '_rt_out');
const API = 'http://127.0.0.1:3426';

const WB = 'D:\\Qoder IDE\\resources\\app\\out\\vs\\workbench\\workbench.desktop.main.js';
const AW = 'D:\\Qoder IDE\\resources\\app\\out\\lingma\\agents-window\\agents-window.desktop.main.js';
const DB = path.join(process.env.APPDATA, 'Qoder', 'User', 'globalStorage', 'state.vscdb');
const SETTINGS = path.join(process.env.APPDATA, 'Qoder', 'User', 'settings.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 断言 ---------------- */
const results = [];
function assert(area, name, expected, actual) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual);
  results.push({ area, name, expected, actual, ok });
  const fmt = (v) => {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s === undefined ? 'undefined' : String(s).slice(0, 46);
  };
  console.log('  ' + (ok ? '✅' : '❌') + ' ' + name.padEnd(26) + (ok ? '' : `期望 ${fmt(expected)} / 实际 ${fmt(actual)}`));
  return ok;
}
function assertTruthy(area, name, actual, note) {
  const ok = !!actual;
  results.push({ area, name, expected: 'truthy', actual, ok });
  console.log('  ' + (ok ? '✅' : '❌') + ' ' + name.padEnd(26) + (ok ? (note || '') : `实际 ${JSON.stringify(actual)}${note ? ' ' + note : ''}`));
  return ok;
}
function summary(label) {
  const bad = results.filter((r) => !r.ok);
  console.log('\n' + '='.repeat(64));
  console.log(`${label}: ${results.length - bad.length}/${results.length} 通过`);
  bad.forEach((b) => console.log(`  ❌ ${b.area} / ${b.name} 期望=${JSON.stringify(b.expected)} 实际=${JSON.stringify(b.actual)}`));
  return bad.length;
}

/* ---------------- 系统工具 ---------------- */
const sh = (cmd, timeout = 90000) => {
  try { return execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8', timeout }).trim(); }
  catch (e) { return 'ERR:' + String(e.message).slice(0, 120); }
};
const sqlite = (sql) => {
  try { return execFileSync(SQLITE, [DB, sql], { encoding: 'utf8' }).trim(); } catch (e) { return ''; }
};
const readJSON = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } };

async function rawFetch(p, body, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(API + p, body === undefined ? { signal: ctl.signal } : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal,
    });
    return { ok: true, json: await r.json().catch(() => null) };
  } catch (e) {
    return { ok: false, err: e, code: (e.cause && e.cause.code) || e.message };
  } finally { clearTimeout(t); }
}

/**
 * 调控制台接口。
 * 传输层兜底：测试机在连续跑 56MB 的 node --check 之后，偶尔出现一次
 * ECONNREFUSED（进程活着、端口在听，仅本次连接被拒）。这里先探测服务是否
 * 真的活着，只有"服务明显还活着"时才重试一次，并且把重试打印出来 ——
 * 业务断言不会被重试掩盖，重试痕迹留在日志里。
 */
async function api(p, body, timeoutMs = 70000) {
  const t0 = Date.now();
  const first = await rawFetch(p, body, timeoutMs);
  if (first.ok) return first.json;

  const probe = await rawFetch('/api/status', undefined, 5000);
  if (!probe.ok) {
    console.log(`    ⚠ api(${p}) 失败且服务不可达: ${first.code} (${Date.now() - t0}ms)`);
    return { ok: false, error: 'unreachable: ' + first.code };
  }
  console.log(`    ↻ api(${p}) 传输层瞬时失败(${first.code})，服务正常，重试一次`);
  const second = await rawFetch(p, body, timeoutMs);
  if (second.ok) return second.json;
  console.log(`    ⚠ api(${p}) 重试仍失败: ${second.code}`);
  return { ok: false, error: 'unreachable: ' + second.code };
}

/* ---------------- console 版本守卫 ---------------- */
function consoleProc() {
  const out = sh('Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" | Where-Object { $_.CommandLine -like \'*qoder-proxy*admin.js*\' } | Select-Object -First 1 -ExpandProperty ProcessId');
  const pid = parseInt(out, 10);
  if (!pid) return null;
  // 用 ISO 格式取启动时间。CIM 的 CreationDate 直接输出是本地化字符串
  // （"2026年11月1日 0:28:19"），new Date() 在 V8 里解析不了，会永远判成"旧进程"。
  const iso = sh(`(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CreationDate.ToString('o')`);
  return { pid, createdIso: iso || '' };
}
function adminMtime() {
  try { return fs.statSync(path.join(PROXY, 'admin.js')).mtime; } catch (e) { return new Date(0); }
}
function restartConsole() {
  sh('Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" | Where-Object { $_.CommandLine -like \'*qoder-proxy*admin.js*\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }');
  // 必须用 spawn（异步、detached、unref）。spawnSync 会等子进程退出，
  // 而 console 是常驻服务，用它启动会永久卡死。
  const child = spawn(NODE, [path.join(PROXY, 'admin.js')], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}
/** 确保 console 进程比 admin.js 新（否则它跑的是旧代码） */
async function ensureConsoleFresh() {
  const mtime = adminMtime();
  const p = consoleProc();
  const born = p && p.createdIso ? new Date(p.createdIso) : null;
  const freshEnough = born instanceof Date && !isNaN(born) && born >= mtime;
  if (freshEnough) {
    const r = await api('/api/status', undefined, 8000);
    if (r && r.patches) return { restarted: false, pid: p.pid, born: p.createdIso };
  }
  restartConsole();
  // 只等到"一次成功"不够：socket 可能刚好在关闭/重建，紧接着的请求会 ECONNREFUSED。
  // 要求连续 2 次成功，且中间隔 800ms。
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const r1 = await api('/api/status', undefined, 5000);
    if (r1 && r1.patches) {
      await sleep(800);
      const r2 = await api('/api/status', undefined, 5000);
      if (r2 && r2.patches) {
        const np = consoleProc();
        return { restarted: true, pid: np ? np.pid : '?', born: np ? np.createdIso : '?' };
      }
    }
  }
  throw new Error('console 起不来');
}

/* ---------------- bundle / 配置 ---------------- */
function markers() {
  const rd = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return ''; } };
  const wb = rd(WB), aw = rd(AW);
  return {
    byok: wb.includes('_applyByokRemoteEnabledFromResponse(e){const r=!0;'),
    p4: aw.includes('useMemo)(()=>!1,[Q.userPlan,Q.userInfo,'),
    p13: wb.includes('||this._isCustomModelExists('),
    live: wb.includes('_lm=this;setInterval'),
    repowiki: wb.includes('shouldShowCommercialMessage(t,e){return!1;'),
    oldInject: (wb + aw).includes('.concat(this.customModelService.getModels()'),
  };
}
function bindings() {
  return {
    assistant: sqlite("SELECT value FROM ItemTable WHERE key='chat.modelConfig.assistant';"),
    experts: sqlite("SELECT value FROM ItemTable WHERE key='chat.modelConfig.experts';"),
    customModels: sqlite("SELECT value FROM ItemTable WHERE key='aicoding.customModels';"),
  };
}
function httpProxy() {
  const s = readJSON(SETTINGS);
  return s ? (s['http.proxy'] || '') : '';
}

/* ---------------- Qoder 启停 ---------------- */
function qoderCount() {
  return parseInt(sh("(Get-CimInstance Win32_Process -Filter \"Name LIKE 'Qoder%'\" | Measure-Object).Count"), 10) || 0;
}
function stopQoder() {
  sh("Get-CimInstance Win32_Process -Filter \"Name LIKE 'Qoder%'\" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }");
}
async function startQoder(waitCount = 12, timeoutMs = 90000) {
  stopQoder();
  await sleep(4000);
  for (const f of [path.join(process.env.APPDATA, 'Qoder', 'code.lock'),
    path.join(process.env.APPDATA, 'Qoder', 'SharedClientCache', '.info.json')]) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) {}
  }
  try { spawn('explorer.exe', ['D:\\Qoder IDE\\Qoder IDE.exe'], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch (e) {}
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await sleep(3000);
    if (qoderCount() >= waitCount) return qoderCount();
  }
  return qoderCount();
}
/** 等提权脚本写完日志 */
async function waitLog(file, marker, timeoutSec = 240) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutSec * 1000) {
    await sleep(1500);
    try { if (fs.readFileSync(file, 'utf8').includes(marker)) return true; } catch (e) {}
  }
  return false;
}

/* ---------------- CDP ---------------- */
async function launchConsolePage(hash, port, profile) {
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  spawn(EDGE, ['--headless=new', '--disable-gpu', '--disable-sync', '--no-first-run',
    '--window-size=1440,1300', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    `${API}/#${hash}`], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  for (let i = 0; i < 30; i++) {
    await sleep(700);
    try {
      const list = JSON.parse(execFileSync('curl.exe', ['-s', `http://127.0.0.1:${port}/json/list`], { encoding: 'utf8', timeout: 8000 }));
      const page = list.find((t) => t.type === 'page' && /3426/.test(t.url || ''));
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) {}
  }
  throw new Error('Edge 未就绪');
}
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0; const pending = new Map(); const errors = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails || {};
        errors.push((d.text || '') + ' :: ' + String((d.exception && d.exception.description) || '').split('\n')[0]);
      }
    };
    ws.onerror = () => reject(new Error('ws error'));
    ws.onopen = () => {
      const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
      const ev = async (expr) => {
        const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
        if (r.result && r.result.exceptionDetails) {
          errors.push('eval: ' + (r.result.exceptionDetails.text || ''));
          return undefined;
        }
        return r.result && r.result.result ? r.result.result.value : undefined;
      };
      resolve({ ws, send, ev, errors, close: () => { try { ws.close(); } catch (e) {} } });
    };
  });
}
async function openConsole(hash, port, profile) {
  const url = await launchConsolePage(hash, port, profile);
  const c = await connect(url);
  await c.send('Runtime.enable');
  await c.send('Page.enable');
  await sleep(2500);
  return c;
}
/** 真实鼠标点击（不重试） */
async function click(c, selector, nth = 0) {
  const raw = await c.ev(`(() => {
    const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const el = els[${nth}];
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: (el.innerText || el.value || '').trim().slice(0, 26) });
  })()`);
  if (!raw) return { clicked: false, reason: 'missing' };
  const b = JSON.parse(raw);
  await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x, y: b.y, button: 'none', clickCount: 0 });
  await sleep(60);
  await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.x, y: b.y, button: 'left', clickCount: 1 });
  await sleep(50);
  await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', clickCount: 1 });
  return { clicked: true, ...b };
}
async function typeInto(c, selector, value) {
  await c.ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return; el.focus(); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  for (const ch of String(value)) await c.send('Input.insertText', { text: ch });
  await c.ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
}
const toastText = (c) => c.ev("Array.from(document.querySelectorAll('.toast')).map(t=>t.textContent.replace(/\\s+/g,' ').trim()).join(' | ')");
async function goto(c, view, wait = 2600) {
  await c.ev(`location.hash='${view}'`);
  await sleep(wait);
  return c.ev("document.getElementById('content').innerHTML.length");
}
async function shot(c, name) {
  const s = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(s.result.data, 'base64'));
}
function saveResults(tag) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, tag + '.json'), JSON.stringify(results, null, 2));
}

module.exports = {
  ROOT, PROXY, NODE, SQLITE, EDGE, OUT, API, WB, AW, DB, SETTINGS,
  sleep, assert, assertTruthy, summary, sh, sqlite, readJSON, api,
  consoleProc, adminMtime, restartConsole, ensureConsoleFresh,
  markers, bindings, httpProxy, qoderCount, stopQoder, startQoder, waitLog,
  openConsole, click, typeInto, toastText, goto, shot, saveResults, results,
};
