/**
 * 复现：状态轮询是否冲掉用户正在输入的表单值
 */
const L = require('./lib');

async function main() {
  const c = await L.openConsole('settings', 11520, 'C:\\Windows\\Temp\\r3poll');
  await L.sleep(2000);

  const readPort = () => c.ev("document.querySelector('[name=\"proxyPort\"]')?.value");
  const readRoot = () => c.ev("document.querySelector('[name=\"ideRoot\"]')?.value");

  console.log('\n=== 场景 A：在代理端口输入 8799，然后什么都不做，等 8 秒 ===');
  console.log('  初始值: ' + await readPort());
  await L.typeInto(c, '[name="proxyPort"]', '8799');
  await L.sleep(300);
  console.log('  输入后立即: ' + await readPort());
  for (const t of [2000, 4000, 6000, 8000]) {
    await c.ev('0'); // no-op
    await L.sleep(t === 2000 ? 2000 : 2000);
    console.log(`  +${t}ms: ` + await readPort());
  }

  console.log('\n=== 场景 B：在安装目录输入框输入内容，等 8 秒 ===');
  await L.typeInto(c, '[name="ideRoot"]', 'D:\\Qoder IDE');
  await L.sleep(300);
  console.log('  输入后立即: ' + JSON.stringify(await readRoot()));
  for (let i = 1; i <= 4; i++) {
    await L.sleep(2000);
    console.log(`  +${i * 2}s: ` + JSON.stringify(await readRoot()));
  }

  console.log('\n=== 场景 C：模拟真实用户 —— 输入后立刻点保存 ===');
  const port0 = (L.readJSON(L.PROXY + '\\config.json') || {}).proxyPort;
  await L.typeInto(c, '[name="proxyPort"]', '8797');
  await L.sleep(200);
  const vBeforeClick = await readPort();
  await L.click(c, '[data-set-act="save"]');
  await L.sleep(2500);
  const after = (L.readJSON(L.PROXY + '\\config.json') || {}).proxyPort;
  console.log(`  输入值=${vBeforeClick}  点保存后 config.proxyPort=${after}  ${Number(after) === 8797 ? '✅ 生效' : '❌ 未生效'}`);

  // 复原
  if (port0) {
    await L.typeInto(c, '[name="proxyPort"]', String(port0));
    await L.click(c, '[data-set-act="save"]');
    await L.sleep(2000);
  }

  console.log('\n=== 场景 D：设置页每 5 秒被重渲染几次（DOM 节点是否被替换）===');
  await c.ev(`window.__nodeRef = document.querySelector('#set-global')`);
  await L.sleep(6000);
  const same = await c.ev("window.__nodeRef === document.querySelector('#set-global')");
  console.log('  6 秒后 #set-global 是否还是同一个 DOM 节点: ' + same + (same ? ' (未重渲染)' : ' (已被重渲染替换)'));

  c.close();
  process.exit(0);
}
main().catch((e) => { console.log('ERR ' + (e && e.stack || e)); process.exit(2); });
