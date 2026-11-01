/**
 * 缓存命中率诊断：把 magpie 的用量记录按请求性质拆开，判断低命中是不是代理造成的。
 *
 * 用法：
 *   node _rt/cacheaudit.js                         # 用默认路径
 *   node _rt/cacheaudit.js <usage.jsonl> <proxy.log>
 *
 * 默认：%USERPROFILE%\.config\magpie\usage.jsonl 与 ../proxy.log
 *
 * 为什么不能只看总命中率：
 *   同一个 agent 名下混着几种完全不同的负载 —— 正常对话（工具集 28 个，历史追加式）、
 *   RepoWiki 生成（工具集 7 个，每页一个独立上下文）、一次性大任务（输入 30k+）。
 *   后者天然没有可复用的前缀，把它们算进平均会把正常对话的高命中稀释掉。
 *
 * 判定方法：
 *   1. 用代理日志里的 custom-serve-payload（记录了每次请求的 messages 条数、tools 个数）
 *      和 magpie 的用量记录按时间对齐，给每条调用贴上"请求形态"
 *   2. 分别统计各类的命中率
 *   3. 只有"常规对话"这一类命中率偏低，才说明代理改动了前缀
 *
 * 若真要查前缀，去看 bodies/decoded-*.json：把相邻两次请求的 messages 逐条比对，
 * 看共同前缀在第几条分叉。分叉点越靠前，越说明是请求本身变了（而非代理）。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const usagePath = process.argv[2] || path.join(os.homedir(), '.config', 'magpie', 'usage.jsonl');
const logPath = process.argv[3] || path.join(__dirname, '..', 'proxy.log');
const MATCH_MS = 8000;      // 用量记录与请求日志的时间对齐容差
const BIG_IN = 30000;       // 一次性大任务的输入门槛
const BIG_CR = 500;         // 且几乎没命中（说明是全新上下文）

if (!fs.existsSync(usagePath)) {
  console.error('找不到用量记录: ' + usagePath);
  console.error('（magpie 的用量在 ~/.config/magpie/usage.jsonl）');
  process.exit(1);
}

/* ---------- 用量记录 ---------- */
const recs = [];
for (const l of fs.readFileSync(usagePath, 'utf8').split('\n')) {
  let o;
  try { o = JSON.parse(l); } catch { continue; }
  const t = Date.parse(o.t);
  recs.push({
    t: isFinite(t) ? t : 0,
    agent: o.agent || '?',
    in: o.in || 0,
    cr: o.cache_read || 0,
  });
}
if (!recs.length) { console.error('用量记录为空'); process.exit(1); }

const pct = (v) => (v * 100).toFixed(1) + '%';
const agg = (arr) => ({
  n: arr.length,
  in: arr.reduce((a, r) => a + r.in, 0),
  cr: arr.reduce((a, r) => a + r.cr, 0),
  rate() { const p = this.in + this.cr; return p ? this.cr / p : 0; },
});

/* ---------- 1. 按 agent ---------- */
console.log('=== 按 agent 汇总（共 ' + recs.length + ' 条）===');
console.log('  ' + 'agent'.padEnd(18) + 'calls'.padStart(7) + 'uncached_in'.padStart(14) + 'cache_read'.padStart(14) + 'hit'.padStart(9));
const byAgent = new Map();
for (const r of recs) {
  if (!byAgent.has(r.agent)) byAgent.set(r.agent, []);
  byAgent.get(r.agent).push(r);
}
for (const [a, arr] of [...byAgent.entries()].sort((x, y) => agg(y[1]).cr - agg(x[1]).cr)) {
  const e = agg(arr);
  console.log('  ' + a.padEnd(16) + String(e.n).padStart(7) + String(e.in).padStart(14) +
    String(e.cr).padStart(14) + (e.in + e.cr ? pct(e.rate()) : '-').padStart(9));
}

/* ---------- 2. 请求日志 → 请求形态 ---------- */
const payloads = [];
if (fs.existsSync(logPath)) {
  for (const l of fs.readFileSync(logPath, 'utf8').split('\n')) {
    if (!l.includes('"custom-serve-payload"')) continue;
    try {
      const o = JSON.parse(l);
      payloads.push({ t: Date.parse(o.at), msgs: o.messages, tools: o.tools });
    } catch { /* ignore */ }
  }
  payloads.sort((a, b) => a.t - b.t);
}
function nearest(t) {
  let best = null, bd = Infinity;
  for (const p of payloads) {
    const d = Math.abs(p.t - t);
    if (d < bd) { bd = d; best = p; }
  }
  return bd <= MATCH_MS ? best : null;
}

/* ---------- 3. 本代理的调用分类 ---------- */
const mine = recs.filter((r) => r.agent === 'qoder' || r.agent === 'Go-http-client');
if (!mine.length) { console.log('\n没有 qoder / Go-http-client 的记录。'); process.exit(0); }

const buckets = {
  chat: [],      // 常规对话：工具集完整，历史追加
  wiki: [],      // RepoWiki / 小工具集：每页独立上下文
  noTools: [],   // 无工具：标题生成之类的小任务
  big: [],       // 一次性大任务
  unknown: [],   // 日志里对不上（早于日志起点，或时间错开太多）
};

for (const r of mine) {
  if (r.in >= BIG_IN && r.cr <= BIG_CR) { buckets.big.push(r); continue; }
  const p = nearest(r.t);
  if (!p) { buckets.unknown.push(r); continue; }
  if (p.tools >= 20) buckets.chat.push(r);
  else if (p.tools > 0) buckets.wiki.push(r);
  else buckets.noTools.push(r);
}

console.log('\n=== 本代理的调用按请求形态拆（agent = qoder / Go-http-client）===');
console.log('  ' + '形态'.padEnd(30) + 'calls'.padStart(6) + 'uncached_in'.padStart(14) + 'cache_read'.padStart(13) + 'hit'.padStart(9));
const labels = [
  ['chat', '常规对话（tools≥20，历史追加）'],
  ['wiki', 'RepoWiki/小工具集（每页独立）'],
  ['big', '一次性大任务（in≥30k）'],
  ['noTools', '无工具（标题生成之类）'],
  ['unknown', '无法对照请求日志'],
];
for (const [k, name] of labels) {
  const e = agg(buckets[k]);
  if (!e.n) continue;
  console.log('  ' + name.padEnd(28) + String(e.n).padStart(6) + String(e.in).padStart(14) +
    String(e.cr).padStart(13) + (e.in + e.cr ? pct(e.rate()) : '-').padStart(9));
}
const all = agg(mine);
console.log('  ' + '合计'.padEnd(29) + String(all.n).padStart(6) + String(all.in).padStart(14) +
  String(all.cr).padStart(13) + pct(all.rate()).padStart(9));

/* ---------- 4. 结论 ---------- */
console.log('\n=== 结论 ===');
const chat = agg(buckets.chat);
const unknown = agg(buckets.unknown);
if (chat.n >= 10) {
  const ok = chat.rate() >= 0.85;
  console.log('  常规对话命中 ' + pct(chat.rate()) + '（' + chat.n + ' 次）：' +
    (ok ? '正常，前缀没被代理改写 ✅' : '偏低，需要查前缀是否被改动 ⚠'));
} else {
  console.log('  常规对话样本只有 ' + chat.n + ' 次，不足以判断。');
  if (unknown.n >= 10) {
    const ok = unknown.rate() >= 0.85;
    console.log('  改用对不上请求日志的那批（' + unknown.n + ' 次，命中 ' + pct(unknown.rate()) + '）参考：' +
      (ok ? '正常 —— 这批多是正常对话，前缀复用良好 ✅' : '偏低，建议补日志后再查 ⚠'));
  }
  console.log('  常规对话为 0 通常是因为那段时间上游不是 magpie（用量不进这个文件），');
  console.log('  与代理无关；此时总命中率只反映 wiki/一次性任务，别当成聊天场景的指标。');
}
const bigIn = agg(buckets.big).in;
if (all.in) {
  console.log('  一次性大任务占总未命中 token ' + pct(bigIn / all.in) + '：' +
    (bigIn / all.in >= 0.3 ? '低命中主要来自它们（独立上下文，天然无前缀可复用）' : '不是主因'));
}
if (buckets.unknown.length) {
  console.log('  ' + buckets.unknown.length + ' 条记录对不上请求日志（早于日志起点或时间错开），已单列');
}

/* ---------- 5. 可疑样本 ---------- */
const sus = buckets.chat.filter((r) => { const p = r.in + r.cr; return p && r.cr / p < 0.3; });
console.log('\n=== 常规对话却低命中（可疑，需查前缀）' + sus.length + ' 条 ===');
for (const s of sus.slice(-10)) {
  const p = nearest(s.t) || {};
  console.log('  ' + new Date(s.t).toLocaleTimeString() + '  msgs=' + String(p.msgs || '?').padStart(3) +
    ' tools=' + String(p.tools || '?').padStart(3) + ' in=' + String(s.in).padStart(7) +
    ' cache=' + String(s.cr).padStart(7) + ' 命中 ' + pct(s.cr / (s.in + s.cr)));
}
if (!sus.length) console.log('  无。');
