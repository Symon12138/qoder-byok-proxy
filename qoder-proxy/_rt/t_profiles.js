/**
 * 多上游切换测试（真实点击，走 UI）
 *
 * 上一版两个问题已修正：
 *   - 删除上游会弹 confirm()，无头页面会被阻塞 -> lib.js 现在自动接受对话框
 *   - 断言里写死了 'minimax'，但新建时会选中下拉里第一个模型（可能是别的），
 *     正确的断言应该是"记录与当前 upstream 一致"，而不是某个具体模型名
 */
const fs = require('fs');
const L = require('./lib');

const TEST_NAME = '切换测试_' + Date.now().toString(36).slice(-4);
const results = [];
function check(name, expected, actual) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual);
  results.push({ name, ok });
  console.log(`  ${ok ? '✅' : '❌'} ${name.padEnd(30)}${ok ? '' : ` 期望 ${JSON.stringify(expected)} / 实际 ${JSON.stringify(actual)}`}`);
  return ok;
}
const cfg = () => L.readJSON(L.PROXY + '\\config.json') || {};
const rawRecord = () => {
  const v = L.sqlite("SELECT value FROM ItemTable WHERE key='aicoding.customModels';");
  try { const a = JSON.parse(v); return Array.isArray(a) && a[0] ? a[0] : null; } catch { return null; }
};

async function main() {
  await L.ensureConsoleFresh();
  const before = cfg();
  const origActive = before.activeProfile;
  const origNames = Object.keys(before.profiles || {});
  console.log(`起始: activeProfile='${origActive}'  profiles=[${origNames.join(', ')}]`);

  const c = await L.openConsole('upstream', 11720, 'C:\\Windows\\Temp\\multi2');
  try {
    /* ---------- 1. 新建一套并启用 ---------- */
    console.log('\n[1] 新建一套 profile（创建并启用）');
    await L.goto(c, 'upstream', 4200);
    await L.click(c, '[data-up="new"]');
    await L.sleep(2200);
    check('表单进入新建态', true, await c.ev("(document.querySelector('#up-form .card__title')?.textContent||'').includes('新建')"));

    await L.typeInto(c, '[name="name"]', TEST_NAME);
    await L.typeInto(c, '[name="baseUrl"]', 'http://127.0.0.1:3425/v1');
    await L.sleep(500);
    const picked = await c.ev(`(() => {
      const s = document.getElementById('up-model');
      const o = [...s.options].find(x => x.value && x.value !== '__custom__');
      if (!o) return null;
      s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true }));
      return o.value;
    })()`);
    await L.sleep(900);
    const shownName = await c.ev("document.querySelector('[name=\"displayName\"]')?.value");
    await L.click(c, '[data-up="save"]');
    await L.sleep(5000);

    const cfg1 = cfg();
    check('profiles 新增一套', true, !!(cfg1.profiles || {})[TEST_NAME]);
    check('activeProfile 指向新配置', TEST_NAME, cfg1.activeProfile);
    check('upstream.baseUrl 已切换', 'http://127.0.0.1:3425/v1', (cfg1.upstream || {}).baseUrl);

    // 关键：模型记录必须跟着当前 upstream 走，而不是某个写死的名字
    const rec1 = rawRecord();
    check('模型记录存在', true, !!rec1);
    check('记录 displayName 跟当前 upstream 一致', (cfg1.upstream || {}).displayName, rec1 ? rec1.displayName : null);

    /* ---------- 2. 设为当前：切回原配置 ---------- */
    console.log(`\n[2] 设为当前：切回「${origActive}」`);
    await L.goto(c, 'upstream', 4200);
    await L.click(c, `[data-up-activate="${origActive}"]`);
    await L.sleep(5000);
    const cfg2 = cfg();
    check('activeProfile 切回', origActive, cfg2.activeProfile);
    check('upstream.model 来自该配置', (before.profiles[origActive] || {}).model, (cfg2.upstream || {}).model);
    const rec2 = rawRecord();
    check('记录 displayName 同步回原配置', (cfg2.upstream || {}).displayName, rec2 ? rec2.displayName : null);

    /* ---------- 3. 删除测试配置（会弹 confirm，harness 自动接受）---------- */
    console.log(`\n[3] 删除「${TEST_NAME}」`);
    await L.goto(c, 'upstream', 4200);
    check('删除按钮存在', true, await c.ev(`!!document.querySelector('[data-up-delete="${TEST_NAME}"]')`));
    await L.click(c, `[data-up-delete="${TEST_NAME}"]`);
    await L.sleep(4000);
    const cfg3 = cfg();
    check('profiles 已移除该配置', false, !!(cfg3.profiles || {})[TEST_NAME]);
    check('activeProfile 未被误改', origActive, cfg3.activeProfile);
    check('profiles 数量回到原值', origNames.length, Object.keys(cfg3.profiles || {}).length);
    check('列表里已看不到该条目', false, await c.ev(`!!document.querySelector('[data-up-delete="${TEST_NAME}"]')`));
  } finally {
    c.close();
  }

  /* ---------- 4. 边界 ---------- */
  console.log('\n[4] 边界情况');
  const r1 = await L.api('/api/profiles/apply', { name: '__不存在__' });
  check('apply 不存在的名字被拒', false, !!(r1 && r1.ok));
  const r2 = await L.api('/api/profiles/delete', { name: '__不存在__' });
  check('delete 不存在的名字被拒', false, !!(r2 && r2.ok));
  check('配置文件仍可解析', true, !!cfg().upstream);
  check('upstream 未被边界调用破坏', 'http://127.0.0.1:3425/v1', (cfg().upstream || {}).baseUrl);

  const bad = results.filter((r) => !r.ok).length;
  console.log('\n' + '='.repeat(58));
  console.log(`多上游切换: ${results.length - bad}/${results.length} 通过`);
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.log('ERR ' + (e && e.stack || e)); process.exit(2); });
