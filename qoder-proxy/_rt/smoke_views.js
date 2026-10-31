/**
 * 冒烟：改完 esc 之后 8 个视图是否仍正常渲染。
 * 只验渲染（长度 / JS 异常 / 关键内容），不是完整回归。
 */
const L = require('./lib');

const EXPECT = {
  overview: ['状态概览', '代理'],
  upstream: ['上游'],
  models: ['模型'],
  patches: ['补丁'],
  logs: ['日志'],
  settings: ['设置'],
  maintain: ['维护'],
  faq: ['帮助'],
};

async function main() {
  await L.ensureConsoleFresh();
  const c = await L.openConsole('overview', 11600, 'C:\\Windows\\Temp\\smoke1');
  let bad = 0;
  for (const [view, keys] of Object.entries(EXPECT)) {
    c.errors.length = 0;
    const len = await L.goto(c, view, 2600);
    const text = await c.ev("document.getElementById('content').innerText.slice(0, 400)");
    const hit = keys.every((k) => String(text || '').includes(k));
    const ok = len > 2500 && c.errors.length === 0 && hit;
    if (!ok) bad++;
    console.log(`  ${ok ? '✅' : '❌'} ${view.padEnd(10)} len=${String(len).padStart(6)} 关键词=${hit ? 'OK' : '缺失'}` +
      (c.errors.length ? '  err=' + c.errors[0].slice(0, 70) : ''));
  }
  // 转义是否真的生效：找一个含特殊字符的渲染点
  await L.goto(c, 'upstream', 3000);
  const escOk = await c.ev(`(() => {
    const html = document.getElementById('content').innerHTML;
    // 正常情况下不应出现裸的未转义尖括号标签残片
    return !/<script/i.test(html) && html.length > 1000;
  })()`);
  console.log(`  ${escOk ? '✅' : '❌'} 上游页 HTML 结构正常`);
  if (!escOk) bad++;
  c.close();
  console.log(bad ? `\n  ${bad} 个视图异常` : '\n  8/8 全部正常');
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.log('ERR ' + (e && e.stack || e)); process.exit(2); });
