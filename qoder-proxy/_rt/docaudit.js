/**
 * 文档一致性校验：把 README / FAQ / 历程记录里写的"可验证事实"逐条跟代码比对。
 * 任何一条对不上就是文档说谎。
 */
const fs = require('fs');
const path = require('path');

const PX = path.resolve(__dirname, '..');
const ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };

const readme = read(path.join(PX, 'README.md'));
const faqJs = read(path.join(PX, 'src', 'views', 'FAQ.js'));
const journal = read(path.join(PX, 'docs', '开发历程与问题记录.md'));
const admin = read(path.join(PX, 'admin.js'));
const proxy = read(path.join(PX, 'proxy.js'));
const patch = read(path.join(ROOT, 'experts-patch.js'));
const mainJs = read(path.join(PX, 'src', 'main.js'));

let pass = 0;
let fail = 0;
function check(name, expected, actual) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual);
  if (ok) pass += 1; else fail += 1;
  console.log('  ' + (ok ? 'OK  ' : 'FAIL') + ' ' + name.padEnd(30) + ' doc=' + JSON.stringify(expected) + ' code=' + JSON.stringify(actual));
}

console.log('=== 1. 补丁清单：README 表格 vs experts-patch.js ===');
const docRaw = [...readme.matchAll(/^\| (P[0-9a-c/]+) \|/gm)].map((m) => m[1]);
const docIds = [];
for (const raw of docRaw) {
  const parts = raw.split('/');
  const base = parts[0].replace(/[a-c]$/, '');   // "P5a" -> "P5"
  for (const part of parts) docIds.push(/^P\d/.test(part) ? part : base + part);
}
const codeIds = [...patch.matchAll(/id: '([^']+)'/g)].map((m) => m[1]);
check('补丁 ID 集合一致', [...new Set(codeIds)].sort(), [...new Set(docIds)].sort());

console.log('\n=== 2. 自愈守卫周期 ===');
const secDoc = (re) => Number((readme.match(re) || [])[1]);
const msCode = (re) => Number((admin.match(re) || [])[1]) / 1000;
check('代理存活周期(秒)', secDoc(/代理存活 \| (\d+) 秒/), msCode(/\}, (15000)\);/));
check('场景绑定周期(秒)', secDoc(/场景绑定 \| (\d+) 秒/), msCode(/repairSceneBindings\(\);[\s\S]{0,60}\}, (20000)\)/));
check('http.proxy 周期(秒)', secDoc(/http\.proxy \| (\d+) 秒/), msCode(/ide-proxy-guard[\s\S]{0,300}\}, (30000)\)/));

console.log('\n=== 3. 磁盘卫生参数 ===');
check('bodies 保留数', secDoc(/只留最近 (\d+) 个采样文件/), Number((admin.match(/BODY_KEEP = (\d+)/) || [])[1]));
check('日志滚动阈值(MB)', secDoc(/超过 (\d+) MB 滚动/), Number((admin.match(/LOG_MAX_BYTES = (\d+) \* 1024 \* 1024/) || [])[1]));

console.log('\n=== 4. 超大 chunk 阈值 ===');
check('切片阈值(KB)', secDoc(/超过 (\d+)KB 的 delta/), Number((proxy.match(/MAX_FORWARD_CHUNK = (\d+) \* 1024/) || [])[1]));

console.log('\n=== 5. 端口范围校验 ===');
check('proxyPort 1~65535 校验', true, /n > 0 && n < 65536/.test(admin));

const eps = [...new Set([...admin.matchAll(/url\.pathname === '(\/api\/[^']+)'/g)].map((m) => m[1]))];
console.log('\n=== 6. 端点 ===');
console.log('  代码里实际 ' + eps.length + ' 个 API 端点（README 未声称具体数量）');

console.log('\n=== 7. FAQ ===');
check('FAQ 条数', 17, (faqJs.match(/^  \{\n    q: '/gm) || []).length);

console.log('\n=== 8. 已删除内容不应出现在 README ===');
check('无 P7 行', false, /\| P7 \|/.test(readme));
check('无 P9 行', false, /\| P9 \|/.test(readme));
check('无 P2 行', false, /\| P2 \|/.test(readme));
const knownIds = ['P1', 'P4', 'P5a', 'P5b', 'P5c', 'P6', 'P12', 'P13'];
const usedIds = [...readme.matchAll(/--(?:only|skip)=([\w,]+)/g)].flatMap((m) => m[1].split(','));
check('示例里的补丁 ID 都真实存在', [], usedIds.filter((u) => !knownIds.includes(u)));

console.log('\n=== 9. 「5 秒自动刷新」是否属实 ===');
check('startPolling(5000) 存在', true, /startPolling\(5000\)/.test(mainJs));

console.log('\n=== 10. 文档引用的路径 ===');
const paths = [
  'qoder-proxy/README.md', 'qoder-proxy/proxy.js', 'qoder-proxy/admin.js',
  'qoder-proxy/docs/开发历程与问题记录.md', 'experts-patch.js', 'apply-all.ps1',
  'revert-all.ps1', 'fix-qoder-checksums.ps1', 'sync-qoder-model.ps1',
  'qoder-proxy/_rt/lib.js', 'qoder-proxy/src/views/FAQ.js', 'qoder-proxy/styles/components.css',
];
check('全部存在', [], paths.filter((p) => !fs.existsSync(path.join(ROOT, p))));

console.log('\n=== 11. 规模 ===');
console.log('  admin.js ' + admin.split('\n').length + ' 行 / proxy.js ' + proxy.split('\n').length
  + ' 行 / experts-patch.js ' + patch.split('\n').length + ' 行');
console.log('  README ' + readme.split('\n').length + ' 行 / 历程记录 ' + journal.split('\n').length + ' 行');

console.log('\n' + '='.repeat(60));
console.log('文档一致性: ' + pass + '/' + (pass + fail) + ' 通过' + (fail ? '（' + fail + ' 项不符）' : ' 全部通过'));
process.exit(fail ? 1 : 0);
