/**
 * 完整性检查：git 跟踪的每个文件，是否在文档里被提到过。
 * 用于发现「代码加了、文档没跟上」的漏项。
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const P = path.resolve(__dirname, '..', '..');
const readme = fs.readFileSync(path.join(P, 'qoder-proxy', 'README.md'), 'utf8');
const journal = fs.readFileSync(path.join(P, 'qoder-proxy', 'docs', '开发历程与问题记录.md'), 'utf8');
const faq = fs.readFileSync(path.join(P, 'qoder-proxy', 'src', 'views', 'FAQ.js'), 'utf8');
const docs = readme + '\n' + journal + '\n' + faq;

const files = execFileSync('git', ['-c', 'core.quotePath=false', 'ls-files'], { cwd: P, encoding: 'utf8' })
  .split('\n').map((s) => s.trim()).filter(Boolean);

// 只关心"读者需要知道它存在"的文件：源码、脚本、文档；忽略字体/图标这类资源
const ignore = /(^qoder-proxy\/fonts\/|icon-|\.woff2$|^\.gitignore$|^README\.md$|^qoder-proxy\/README\.md$)/;

const missing = [];
const byDir = {};
for (const f of files) {
  if (ignore.test(f)) continue;
  const base = path.basename(f);
  const dirKey = path.dirname(f);
  byDir[dirKey] = (byDir[dirKey] || 0) + 1;
  // 覆盖判定：文件名出现，或它属于"集合目录"且该目录在文档里整体说明过
  // （views/ styles/ _rt/ fonts/ 下有几十个同类文件，逐个列进文档没意义）
  const COLLECTIONS = ['views', 'styles', '_rt', 'fonts'];
  const dirName = path.basename(dirKey);
  const dirMentioned = COLLECTIONS.includes(dirName) &&
    (docs.includes(dirName + '/') || docs.includes('/' + dirName));
  const mentioned = docs.includes(base) || docs.includes(f) || dirMentioned;
  if (!mentioned) missing.push(f);
}

console.log(`跟踪文件 ${files.length} 个，参与检查 ${files.length - files.filter((f) => ignore.test(f)).length} 个\n`);
console.log('按目录分布:');
for (const [d, n] of Object.entries(byDir).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${d.padEnd(28)} ${n}`);
}

console.log('\n文档里完全没提到的文件:');
if (missing.length === 0) console.log('  （无）');
for (const m of missing) console.log('  ⚠ ' + m);
console.log(`\n结论: ${missing.length === 0 ? '全部有说明' : missing.length + ' 个文件缺说明'}`);
