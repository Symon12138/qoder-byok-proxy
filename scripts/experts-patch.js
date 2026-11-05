// Qoder 专家团 / RepoWiki BYOK 补丁。
// 设计要点：
//  1) 每条补丁独立生效，互不依赖（P10/P11 曾是对 P8/P9 产物的二次改写，容易失效，已删除；
//     场景集合改为由 --quest 开关在生成 P8/P9 时一次写死）
//  2) 幂等：已打过的段落有"已应用"特征，重跑不会重复插入
//  3) 混淆名（如场景枚举 un/on）动态探测，不硬编码
// 用法：
//   node experts-patch.js [--dry] [--root "D:\Qoder IDE"] [--quest] [--only=P1,P2] [--skip=P8]
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
// --quest：历史开关。自定义模型改由 Qoder 原生「自定义」分组承载后，
// 已经不存在按场景注入的补丁，这个开关被接受但不起任何作用。
const argOf = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : '';
};
const ONLY = argOf('only') ? argOf('only').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : null;
const SKIP = argOf('skip') ? argOf('skip').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : [];
const rootIdx = argv.indexOf('--root');
const ROOT = rootIdx >= 0 ? argv[rootIdx + 1] : 'D:\\Qoder IDE';

const FILES = [
  path.join(ROOT, 'resources/app/out/lingma/agents-window/agents-window.desktop.main.js'),
  path.join(ROOT, 'resources/app/out/vs/workbench/workbench.desktop.main.js'),
];

// 每条补丁的开关存在 qoder-proxy/config.json 的 patches 字段里（Web 控制台可单独启停）。
// 没配置过的默认启用。命令行 --only / --skip 优先级高于配置文件。
const CONFIG_PATH = path.join(__dirname, 'qoder-proxy', 'config.json');
function patchToggles() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')).patches || {}; } catch { return {}; }
}
const TOGGLES = patchToggles();

// 场景枚举名（un / on …）随版本变化，运行时从 bundle 探测，见 detectEnum()
let ENUM = 'un';
// 注：自定义模型改由 Qoder 原生「自定义」分组承载后，已经没有任何补丁需要
// 按场景拼接条件了，所以原来的 scenes() 辅助函数和 --quest 开关都失效了。
// --quest 仍被接受（避免旧调用方报错），但不再影响任何补丁。

const ALL_PATCHES = [
  {
    id: 'P1',
    desc: '_isCustomModelExists 恒通过（消除初始化时序竞态）',
    find: /_isCustomModelExists\((\w+)\)\{const (\w+)=(\w+)\(\1\);return \2\?this\.customModelService\.getModels\(\)\.records\.some\((\w+)=>\4\.id===\2&&\4\.visible\):!1\}/g,
    repl: (_m, arg, _r, helper) => `_isCustomModelExists(${arg}){return!!${helper}(${arg})}`,
  },
  {
    id: 'P4',
    desc: '解除 experts 模式 BYOK 门控',
    // 变量名（这里是 userPlan 所在的对象）随构建变化，Q/Y 都见过，
    // 所以用捕获组回引，别再写死字母。
    find: /useMemo\)\(\(\)=>!\w+\((\w+)\.userPlan\?\.user_type,\1\.userInfo,\1\.userPlan\?\.is_personal_version\)\|\|(\w+),\[\1\.userPlan,\1\.userInfo,\2\]\)/g,
    repl: (_m, v, c) => `useMemo)(()=>!1,[${v}.userPlan,${v}.userInfo,${c}])`,
  },
  {
    id: 'P5a',
    desc: 'experts 模式 custom 列表不再置空',
    find: /(\w+)=\(0,(\w+)\.useMemo\)\(\(\)=>(\w+)\?\[\]:(\w+)\.filter\((\w+)\),\[\3,\4\]\)/g,
    repl: (_m, v, hook, flag, list, filt) => `${v}=(0,${hook}.useMemo)(()=>${list}.filter(${filt}),[${flag},${list}])`,
  },
  {
    id: 'P5b',
    desc: 'experts 模式显示 custom 标签页',
    find: /(\w+)=!c&&\(!(\w+)\|\|(\w+)\)/g,
    repl: (_m, v, a, b) => `${v}=!${a}||${b}`,
  },
  {
    id: 'P5c',
    desc: 'experts 模式显示真实模型名（不再强制 experts-auto）',
    find: /(\w+)=\(0,(\w+)\.useMemo\)\(\(\)=>(\w+)\?"experts-auto":(\w+),\[(\w+),(\w+)\]\)/g,
    repl: (_m, v, hook, _flag, val, d1, d2) => `${v}=(0,${hook}.useMemo)(()=>${val},[${d1},${d2}])`,
  },
  {
    id: 'P6',
    desc: '自定义模型不再产生 id 占位项',
    find: /(\w+)=!c&&(\w+)\((\w+)\);(?=!\w+\.some\()/g,
    repl: (_m, v, fn, arg) => `${v}=${fn}(${arg});`,
  },
  {
    id: 'P13',
    desc: 'isModelConfigAvailable 认可自定义模型（否则每次启动被判定不可用并回落 auto）',
    // 原始实现只看官方可用列表和企业模型，不看 customModelService。
    // 结果：用户信息加载完 -> _handleUserInfoChange -> isModelConfigAvailable=false
    // -> setModelConfig(默认模型)，把用户选的自定义模型覆盖掉。
    //
    // 两种写法都要认（都出现过）：
    //   旧：return(await this.getAvailableModelConfigs(r)).some(...)||...
    //   新：const n=await this.getAvailableModelConfigs(r);return this.isBlockedExpertsModel(...)?!1:n.some(...)||...
    // 函数体里没有花括号，所以 [^}]*? 能安全地吃到函数结尾；
    // 已打过时结尾变成 ...||this._isCustomModelExists(e)}，不再命中，天然幂等。
    // 追加在最外层 return 表达式末尾：blocked?!1:(A||B||custom)，优先级正确。
    find: /isModelConfigAvailable\((\w+),(\w+)\)\{([^}]*?_isDisabledByStrategy\(\w+\)\))\}/g,
    repl: (_m, model, type, body) => `isModelConfigAvailable(${model},${type}){${body}||this._isCustomModelExists(${model})}`,
  },
  {
    id: 'P12',
    desc: 'RepoWiki 商业门控：去掉「当前版本无法生成」的拦截，让生成按钮可用',
    // 负向预查保证幂等：已经打过（紧跟 return!1）的不再重复插入
    find: /static shouldShowCommercialMessage\((\w+),(\w+)\)\{(?!return!1)/g,
    repl: (_m, a, b) => `static shouldShowCommercialMessage(${a},${b}){return!1;`,
  },
];

// 开关按「功能」给：experts 控制 P4（解锁门控）。自定义模型由 Qoder 原生的
// 「自定义」分组承载，不再往普通模型列表里注入 —— 之前 P2 的 concat 会让同一个
// 模型同时出现在「Auto/极致」那一层和「自定义」页里，属于重复展示。
// repowiki 控制 P12。其余是非关键的内部机制，永远应用。
const KEY_MAP = { experts: ['P4'], repowiki: ['P12'] };
const PATCHES = ALL_PATCHES.filter((p) => {
  if (ONLY) return ONLY.includes(p.id);
  if (SKIP.includes(p.id)) return false;
  for (const [name, ids] of Object.entries(KEY_MAP)) {
    if (ids.includes(p.id)) return TOGGLES[name] !== false;   // 关键：按功能开关
  }
  return true;                                                // 非关键：始终应用
});

function detectEnum(text) {
  let m = /\w+=(\w+)\|\|(\w+)\.ASSISTANT/.exec(text) || /(\w+)\.ASSISTANT/.exec(text);
  if (m) return m[2] || m[1];
  m = /(\w+)\.EXPERTS/.exec(text);
  return m ? m[1] : 'un';
}

/** 只保留最近 keep 份 .bak-experts-* 备份，其余删除 */
function pruneBackups(bundleFile, keep) {
  const dir = path.dirname(bundleFile);
  const prefix = path.basename(bundleFile) + '.bak-experts-';
  let olds = [];
  try {
    olds = fs.readdirSync(dir)
      .filter((f) => f.startsWith(prefix))
      .sort()
      .slice(0, -keep);            // 时间戳是字典序，前面的就是旧的
  } catch { return; }
  let freed = 0;
  for (const f of olds) {
    try {
      const full = path.join(dir, f);
      freed += fs.statSync(full).size;
      fs.unlinkSync(full);
    } catch { /* 占用或已删，跳过 */ }
  }
  if (olds.length) console.log(`  清理旧备份 ${olds.length} 份（释放 ${(freed / 1048576).toFixed(0)} MB）`);
}

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
let failed = false;

console.log('场景: 自定义模型走 Qoder 原生「自定义」分组，不做场景注入（--quest 已无作用）');
if (ONLY) console.log(`仅应用: ${ONLY.join(', ')}`);
if (SKIP.length) console.log(`跳过: ${SKIP.join(', ')}`);

for (const file of FILES) {
  const name = path.basename(file);
  if (!fs.existsSync(file)) { console.log(`\n[${name}] 不存在，跳过`); continue; }
  let text = fs.readFileSync(file, 'utf8');
  ENUM = detectEnum(text);
  console.log(`\n===== ${name} (${(text.length / 1048576).toFixed(1)} MB) =====`);
  console.log(`  场景枚举名: ${ENUM}`);
  const todo = [];
  const report = [];

  for (const p of PATCHES) {
    const n = (text.match(p.find) || []).length;
    report.push({ id: p.id, desc: p.desc, n });
    if (n > 0) todo.push(p);
  }
  for (const r of report) {
    console.log(`  ${r.id.padEnd(4)} ${r.n} 处  ${r.n ? '待应用' : '未找到/已应用'}  ${r.desc}`);
  }
  if (!todo.length) { console.log('  无需改动'); continue; }
  if (DRY) { console.log('  [dry] 不改文件'); continue; }

  // 备份后只保留最近 1 份。
  // 以前每次应用都留一份 53MB 的 .bak-experts-*，13 次应用就堆了 1.4GB。
  // 回滚并不依赖这些备份（revert 是反向替换补丁），它们只用于灾难恢复，
  // 留两份足够，多余的立刻删掉。
  fs.copyFileSync(file, `${file}.bak-experts-${stamp}`);
  pruneBackups(file, 1);
  let changed = 0;
  for (const p of todo) {
    const before = text;
    text = text.replace(p.find, p.repl);
    if (text !== before) { changed++; console.log(`  已应用 ${p.id}`); }
    else { console.log(`  !! ${p.id} 替换失败`); failed = true; }
  }
  fs.writeFileSync(file, text, 'utf8');
  console.log(`  写入完成（${changed}/${todo.length} 条生效）`);
}

console.log(`\n${failed ? 'FAILED' : 'DONE'}（${DRY ? 'dry-run' : '已写入'}）`);
process.exit(failed ? 1 : 0);
