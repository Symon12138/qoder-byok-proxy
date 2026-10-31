/**
 * 深挖：开关点击为什么不生效
 * 1) 直接测 /api/tools 前后端
 * 2) 在页面上挂 change 监听，判断点击是否真的触发了 change
 * 3) 判断 handler 是否执行（看按钮 disabled 状态 / toast）
 */
const L = require('./lib');

async function main() {
  await L.ensureConsoleFresh();

  /* ---------- 1) 后端 /api/tools ---------- */
  console.log('=== 1) /api/tools 直接调用 ===');
  for (const v of [true, false, true]) {
    const before = (L.readJSON(L.PROXY + '\\config.json') || {}).injectTools !== false;
    const r = await L.api('/api/tools', { enabled: v });
    await L.sleep(600);
    const after = (L.readJSON(L.PROXY + '\\config.json') || {}).injectTools !== false;
    console.log(`  设为 ${v}: 之前=${before} 之后=${after} 返回=${JSON.stringify(r).slice(0, 50)}  ${after === v ? '✅' : '❌'}`);
  }

  /* ---------- 2) 页面点击是否触发 change ---------- */
  console.log('\n=== 2) 点击开关是否触发 change 事件 ===');
  const c = await L.openConsole('settings', 11560, 'C:\\Windows\\Temp\\r3sw');
  await L.goto(c, 'settings');
  await L.sleep(1500);

  await c.ev(`(() => {
    window.__ev = [];
    document.addEventListener('change', (e) => {
      window.__ev.push({ t: 'change', id: e.target && e.target.dataset ? e.target.dataset.set : null, checked: e.target && e.target.checked, ts: Date.now() });
    }, true);
    document.addEventListener('click', (e) => {
      window.__ev.push({ t: 'click', tag: e.target.tagName, cls: String(e.target.className || '').slice(0, 30), ts: Date.now() });
    }, true);
  })()`);

  for (let i = 0; i < 5; i++) {
    const cfgB = (L.readJSON(L.PROXY + '\\config.json') || {}).injectTools !== false;
    await L.click(c, '[data-set="injectTools"]');
    await L.sleep(2000);
    const cfgA = (L.readJSON(L.PROXY + '\\config.json') || {}).injectTools !== false;
    const ev = await c.ev('JSON.stringify(window.__ev.slice(-4))');
    const checked = await c.ev("document.querySelector('[data-set=\"injectTools\"]')?.checked");
    console.log(`  #${i + 1} config ${cfgB}→${cfgA} ${cfgA !== cfgB ? '✅' : '❌'}  输入框checked=${checked}`);
    console.log(`      事件: ${String(ev).slice(0, 200)}`);
    await c.ev('window.__ev = []');
  }

  /* ---------- 3) 用 label 点击而不是 input ---------- */
  console.log('\n=== 3) 改点 label 容器（而不是 input 本体）===');
  for (let i = 0; i < 3; i++) {
    const cfgB = (L.readJSON(L.PROXY + '\\config.json') || {}).injectTools !== false;
    await L.click(c, 'label.switch:has([data-set="injectTools"])');
    await L.sleep(2000);
    const cfgA = (L.readJSON(L.PROXY + '\\config.json') || {}).injectTools !== false;
    console.log(`  #${i + 1} config ${cfgB}→${cfgA} ${cfgA !== cfgB ? '✅' : '❌'}`);
  }

  c.close();
  process.exit(0);
}
main().catch((e) => { console.log('ERR ' + (e && e.stack || e)); process.exit(2); });
