/**
 * 交付前应用侧验证：8 视图渲染 + FAQ 条目 + 关键端点 + 状态一致性
 */
const L = require('./lib');

const results = [];
function check(name, expected, actual) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual);
  results.push({ name, ok });
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name.padEnd(30)}${ok ? '' : ` 期望 ${JSON.stringify(expected)} / 实际 ${JSON.stringify(actual)}`}`);
  return ok;
}

async function main() {
  await L.ensureConsoleFresh();

  /* ---------- 端点 ---------- */
  console.log('=== 1. 关键端点 ===');
  const gets = ['/api/status', '/api/config', '/api/models', '/api/profiles', '/api/logs?n=5', '/api/export'];
  for (const ep of gets) {
    const r = await L.api(ep, undefined, 30000);
    check('GET ' + ep, true, !!(r && r.ok !== false && !r.error));
  }
  const posts = [['/api/tools', { injectTools: true }], ['/api/sync', {}]];
  for (const [ep, body] of posts) {
    const r = await L.api(ep, body, 120000);
    check('POST ' + ep, true, !!(r && r.ok !== false && !r.error));
  }

  /* ---------- 状态 ---------- */
  console.log('\n=== 2. 状态一致性 ===');
  const st = await L.api('/api/status');
  check('补丁 4 项全已写入', { b: true, e: true, l: true, r: true },
    { b: st.patches.byok, e: st.patches.experts, l: st.patches.live, r: st.patches.repowiki });
  check('代理在运行', true, st.proxy.running);
  check('IDE 指向代理', true, String(st.ide.httpProxy).includes(':' + st.proxy.port));
  check('安装目录正确', 'D:\\Qoder IDE', st.ide.root);
  const b = L.bindings();
  check('场景绑定 = 自定义模型', { a: 'custom:model_mocktest', e: 'custom:model_mocktest' },
    { a: b.assistant, e: b.experts });

  /* ---------- 8 视图 ---------- */
  console.log('\n=== 3. 界面渲染 ===');
  const c = await L.openConsole('overview', 11800, 'C:\\Windows\\Temp\\final1');
  try {
    const views = ['overview', 'upstream', 'models', 'patches', 'logs', 'settings', 'maintain', 'faq'];
    for (const v of views) {
      c.errors.length = 0;
      const len = await L.goto(c, v, 2800);
      const ok = len > 2500 && c.errors.length === 0;
      check('视图 ' + v, true, ok);
    }

    // FAQ 条目数
    await L.goto(c, 'faq', 2800);
    const faq = await c.ev("document.querySelectorAll('details.faq-item').length");
    check('FAQ 条目数', 17, faq);
    const steps = await c.ev("document.querySelectorAll('.step-item').length");
    check('快速开始步骤数', 4, steps);

    // 维护页环境状态徽章
    await L.goto(c, 'maintain', 2800);
    const badges = await c.ev("document.querySelectorAll('.kv-grid .badge').length");
    check('维护页状态徽章数', 5, badges);

    // 补丁页状态
    await L.goto(c, 'patches', 2800);
    const applied = await c.ev("(document.querySelectorAll('#pt-status .kv-list__item').length)");
    check('补丁页列出 4 个 bundle', 4, applied);

    // 对齐检查（老问题：标签与值参差）
    let misaligned = 0;
    for (const v of views) {
      await L.goto(c, v, 2400);
      const bad = JSON.parse(await c.ev(`(() => {
        const out = [];
        document.querySelectorAll('.kv-list').forEach((l, i) => {
          const L2 = [...l.querySelectorAll('.kv-list__label')].map(e => Math.round(e.getBoundingClientRect().left));
          const V = [...l.querySelectorAll('.kv-list__value')].map(e => Math.round(e.getBoundingClientRect().left));
          if (L2.length > 1 && (new Set(L2).size > 1 || new Set(V).size > 1)) out.push(i);
        });
        return JSON.stringify(out);
      })()`) || '[]');
      misaligned += bad.length;
    }
    check('全站 kv 列表对齐', 0, misaligned);
  } finally {
    c.close();
  }

  const bad = results.filter((r) => !r.ok).length;
  console.log('\n' + '='.repeat(58));
  console.log(`应用侧验证: ${results.length - bad}/${results.length} 通过`);
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.log('ERR ' + (e && e.stack || e)); process.exit(2); });
