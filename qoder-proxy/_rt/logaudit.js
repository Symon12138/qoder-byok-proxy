/**
 * Qoder 运行日志审计：把 logs/ 下的 error/warning 聚合归类，并标出哪些与本项目有关。
 *
 * 用法：
 *   node _rt/logaudit.js                 # 最近 6 个会话
 *   node _rt/logaudit.js 12              # 最近 12 个会话
 *   node _rt/logaudit.js 6 --full        # 额外打印每类的前 3 条原文
 *
 * 判定依据（都是踩过的坑）：
 *   - 代理没跑      → ERR_PROXY_CONNECTION_FAILED / Failed to establish a socket connection to proxies
 *   - 代理没跑      → no model config found（拿不到模型列表，4 次重试后 refreshModelConfigs invalid）
 *   - 与本项目无关  → ENOTFOUND（客户端 DNS）、TreeError（VS Code 组件）、
 *                     i18n 缺键（扩展自带翻译）、marketplace 拉取失败（不在 MITM 列表）
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const LOGDIR = path.join(os.homedir(), 'AppData', 'Roaming', 'Qoder', 'logs');
const SESSIONS = Number(process.argv[2]) || 6;
const FULL = process.argv.includes('--full');

// 已知归属：命中即标注
const OURS = [
  ['代理没跑·连接', /ERR_PROXY_CONNECTION_FAILED|Failed to establish a socket connection to proxies/i],
  ['代理没跑·模型', /no model config found/i],
];
const NOT_OURS = [
  ['客户端 DNS', /ENOTFOUND|EAI_AGAIN|getaddrinfo/i],
  ['VS Code 组件', /TreeError|Cannot read propert|A container element needs to be set/i],
  ['i18n 缺键', /no string found in i18n bundle/i],
  ['扩展市场（直连）', /marketplace|controlUrl\.json/i],
  ['Java 项目', /publish diagnostics|build path|JavaSource/i],
  ['进程被终止', /terminated unexpectedly|terminated by itself/i],
  ['凭据解密', /BAD_DECRYPT|decrypt/i],
  ['Qoder Agent 内部', /no waiting tool call|common_dev_agent/i],
];

function sessions(n) {
  try {
    return fs.readdirSync(LOGDIR).filter((x) => /^\d{8}T\d{6}$/.test(x)).sort().slice(-n);
  } catch { return []; }
}
function walk(dir, out, depth) {
  if (depth > 3) return;
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, depth + 1);
    else if (/\.log$/i.test(e.name)) out.push(p);
  }
}
function normalize(line) {
  return line
    .replace(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+\s*/, '')
    .replace(/\[(error|warning|info|debug|trace)\]\s*/i, '')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b\d{4,}\b/g, '<n>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/"[^"]{40,}"/g, '"<str>"')
    .replace(/[A-Za-z]:[\\/][^\s"']+/g, '<path>')
    .slice(0, 150)
    .trim();
}
function classify(line) {
  for (const [name, re] of OURS) if (re.test(line)) return { name, ours: true };
  for (const [name, re] of NOT_OURS) if (re.test(line)) return { name, ours: false };
  return null;
}

const list = sessions(SESSIONS);
if (!list.length) { console.error('没找到日志目录: ' + LOGDIR); process.exit(1); }

const groups = new Map();
const tagged = new Map();   // 归类命中计数
let files = 0, errors = 0, warnings = 0;

for (const s of list) {
  const fs2 = [];
  walk(path.join(LOGDIR, s), fs2, 0);
  for (const f of fs2) {
    files++;
    let text; try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      const m = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\.\d+ \[(error|warning)\]/.exec(line);
      if (!m) continue;
      const level = m[2];
      if (level === 'error') errors++; else warnings++;
      const key = level + '|' + normalize(line);
      const g = groups.get(key) || { level, sample: line.trim(), count: 0, last: '', examples: [] };
      g.count++;
      if (m[1] > g.last) g.last = m[1];
      if (g.examples.length < 3) g.examples.push(line.trim());
      groups.set(key, g);
      const c = classify(line);
      if (c) {
        const t = tagged.get(c.name) || { name: c.name, ours: c.ours, count: 0, first: m[1], last: m[1], hours: new Map() };
        t.count++;
        if (m[1] < t.first) t.first = m[1];
        if (m[1] > t.last) t.last = m[1];
        t.hours.set(m[1].slice(11, 13), (t.hours.get(m[1].slice(11, 13)) || 0) + 1);
        tagged.set(c.name, t);
      }
    }
  }
}

console.log(`扫描 ${list.length} 个会话 / ${files} 个日志文件：error ${errors} 行、warning ${warnings} 行，归并为 ${groups.size} 类\n`);

console.log('===== 已知归属分类 =====');
const tags = [...tagged.values()].sort((a, b) => b.count - a.count);
if (!tags.length) console.log('  （没有命中已知模式）');
for (const t of tags) {
  const hours = [...t.hours.entries()].sort().map(([h, c]) => h + '时×' + c).join(' ');
  console.log(`  ${t.ours ? '⚠ 与本项目有关' : '✓ 与本项目无关'}  ${t.name.padEnd(18)} ${String(t.count).padStart(4)} 次  ${t.first} ~ ${t.last}`);
  console.log(`      ${hours}`);
}

console.log('\n===== 未归类的高频错误（前 12）=====');
const rest = [...groups.values()].filter((g) => g.level === 'error' && !classify(g.sample)).sort((a, b) => b.count - a.count).slice(0, 12);
if (!rest.length) console.log('  （无）');
for (const g of rest) {
  console.log(`  ×${String(g.count).padStart(4)}  最近 ${g.last}`);
  console.log('         ' + g.sample.slice(0, 180));
  if (FULL) for (const ex of g.examples) console.log('         · ' + ex.slice(0, 180));
}
