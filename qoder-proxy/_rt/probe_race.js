/**
 * 定量实验
 *  A) 重启代理 3 轮：每轮前后统计 proxy.js 进程数
 *  B) 开关点击 10 次：统计点击是否生效，并记录点击瞬间是否刚发生重渲染
 */
const L = require('./lib');

const countProxy = () => {
  const out = L.sh("Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*proxy.js*' } | Measure-Object | Select-Object -ExpandProperty Count");
  return parseInt(out, 10) || 0;
};

async function main() {
  await L.ensureConsoleFresh();
  const c = await L.openConsole('maintain', 11540, 'C:\\Windows\\Temp\\r3probe');

  /* ---------- A) 重启代理 ---------- */
  console.log('\n=== A) 「重启代理」进程数变化 ===');
  await L.goto(c, 'maintain');
  for (let i = 1; i <= 3; i++) {
    const before = countProxy();
    await L.click(c, '[data-mt="restart-proxy"]');
    await L.sleep(6000);
    const after = countProxy();
    console.log(`  第 ${i} 轮: ${before} → ${after}  ${after === 1 ? '✅' : '❌ 异常'}`);
  }

  /* ---------- B) 开关点击成功率 ---------- */
  console.log('\n=== B) 设置页开关点击 10 次 ===');
  await L.goto(c, 'settings');
  await L.sleep(1500);

  let ok = 0, fail = 0;
  const failures = [];
  for (let i = 0; i < 10; i++) {
    const key = i % 2 === 0 ? 'injectTools' : 'serveWiki';
    const cfgBefore = L.readJSON(L.PROXY + '\\config.json') || {};
    const before = cfgBefore[key] !== false;

    // 记录点击前 DOM 是否刚刚被重建
    await c.ev(`window.__mark = document.querySelector('#set-switches').firstElementChild`);
    const box = await L.click(c, `[data-set="${key}"]`);
    const sameNode = await c.ev("window.__mark === document.querySelector('#set-switches').firstElementChild");
    await L.sleep(2200);
    const cfgAfter = L.readJSON(L.PROXY + '\\config.json') || {};
    const after = cfgAfter[key] !== false;
    const changed = before !== after;

    if (changed) ok++; else { fail++; failures.push({ i, key, before, sameNode }); }
    console.log(`  #${i + 1} ${key.padEnd(11)} ${before}→${after} ${changed ? '✅' : '❌ 未生效'}  DOM同一节点=${sameNode}  点击=${box.clicked}`);
  }
  console.log(`  成功 ${ok}/10，失败 ${fail}`);

  /* ---------- C) 立刻连点两次同一按钮 ---------- */
  console.log('\n=== C) 保存按钮连点 2 次（模拟用户着急）===');
  const port0 = (L.readJSON(L.PROXY + '\\config.json') || {}).proxyPort;
  await L.typeInto(c, '[name="proxyPort"]', '8796');
  await L.click(c, '[data-set-act="save"]');
  await L.click(c, '[data-set-act="save"]');
  await L.sleep(3000);
  const port1 = (L.readJSON(L.PROXY + '\\config.json') || {}).proxyPort;
  console.log(`  期望 8796，实际 ${port1}  ${Number(port1) === 8796 ? '✅' : '❌'}`);
  if (port0) {
    await L.typeInto(c, '[name="proxyPort"]', String(port0));
    await L.click(c, '[data-set-act="save"]');
    await L.sleep(2000);
  }

  c.close();
  process.exit(0);
}
main().catch((e) => { console.log('ERR ' + (e && e.stack || e)); process.exit(2); });
