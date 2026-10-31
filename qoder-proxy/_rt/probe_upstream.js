/**
 * 确认：取消编辑 / 刷新列表 后表单的实际语义
 */
const L = require('./lib');

async function main() {
  const c = await L.openConsole('upstream', 11580, 'C:\\Windows\\Temp\\r3up');
  await L.goto(c, 'upstream', 4200);

  const state = () => c.ev(`(() => {
    const t = document.querySelector('#up-form .card__title')?.textContent.trim() || '';
    const name = document.querySelector('[name="name"]')?.value ?? null;
    const baseUrl = document.querySelector('[name="baseUrl"]')?.value ?? null;
    return JSON.stringify({ title: t, name, baseUrl, hasForm: !!document.getElementById('up-form-el') });
  })()`);

  console.log('  进入页面:        ' + await state());

  await L.click(c, '[data-up-edit]');
  await L.sleep(2500);
  console.log('  点开编辑:        ' + await state());

  await L.click(c, '[data-up="cancel"]');
  await L.sleep(2000);
  console.log('  点「取消编辑」后: ' + await state());

  await L.click(c, '[data-up="new"]');
  await L.sleep(2000);
  console.log('  点「新建上游」后: ' + await state());

  await L.click(c, '[data-up="refresh"]');
  await L.sleep(2200);
  console.log('  点「刷新列表」后: ' + await state());

  // 取消编辑后表单里是否还残留上一套的 baseUrl？
  await L.click(c, '[data-up-edit]');
  await L.sleep(2500);
  const editing = JSON.parse(await state());
  await L.click(c, '[data-up="cancel"]');
  await L.sleep(2000);
  const afterCancel = JSON.parse(await state());
  console.log('\n  编辑态 baseUrl=' + JSON.stringify(editing.baseUrl));
  console.log('  取消后 baseUrl=' + JSON.stringify(afterCancel.baseUrl));
  console.log('  取消后是否清空: ' + (afterCancel.baseUrl === '' ? '✅ 已清空' : '❌ 残留旧值'));

  c.close();
  process.exit(0);
}
main().catch((e) => { console.log('ERR ' + (e && e.stack || e)); process.exit(2); });
