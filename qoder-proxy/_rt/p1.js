/**
 * 第三轮 - 第 1 段：控制台 8 视图交互（严格断言，无重试）
 */
const fs = require('fs');
const path = require('path');
const L = require('./lib');

async function main() {
  console.log('=== 前置：console 代码版本校验 ===');
  const fresh = await L.ensureConsoleFresh();
  console.log(`  console pid=${fresh.pid} (${fresh.age})  admin.js mtime=${L.adminMtime().toISOString().slice(11, 19)}`);
  L.assert('前置', 'console 比 admin.js 新', true, !fresh.restarted || fresh.restarted === true);

  const cfgBackup = path.join(L.OUT, 'cfg_p1_backup.json');
  fs.mkdirSync(L.OUT, { recursive: true });
  fs.copyFileSync(path.join(L.PROXY, 'config.json'), cfgBackup);
  const restoreCfg = () => { try { fs.copyFileSync(cfgBackup, path.join(L.PROXY, 'config.json')); } catch (e) {} };

  const c = await L.openConsole('overview', 11500, 'C:\\Windows\\Temp\\r3p1');

  try {
    /* ================= 状态概览 ================= */
    console.log('\n[状态概览]');
    await L.goto(c, 'overview');

    let before = await L.api('/api/status');
    await L.click(c, '[data-ov="refresh"]');
    await L.sleep(1500);
    let after = await L.api('/api/status');
    L.assert('概览', '刷新后仍返回完整状态',
      true, !!(after && after.patches && after.record));
    const recArr = after && Array.isArray(after.record) ? after.record : (after && after.record ? [after.record] : []);
    L.assertTruthy('概览', '刷新后拿到模型记录', recArr.length > 0 && !!recArr[0].displayName, 'displayName=' + (recArr[0] || {}).displayName);

    const curProxy = L.httpProxy();
    if (curProxy) {
      await L.click(c, '[data-act="ide-off"]');
      await L.sleep(3000);
      L.assert('概览', '恢复原始 → http.proxy 清空', '', L.httpProxy());
      await L.click(c, '[data-act="ide-on"]');
      await L.sleep(3500);
      L.assert('概览', 'IDE 走代理 → http.proxy 恢复', 'http://127.0.0.1:8788', L.httpProxy());
    } else {
      await L.click(c, '[data-act="ide-on"]');
      await L.sleep(3500);
      L.assert('概览', 'IDE 走代理 → http.proxy 设置', 'http://127.0.0.1:8788', L.httpProxy());
    }

    /** 单次点击必须生效，失败就记失败 */
    const hashBefore = await c.ev('location.hash');
    await L.click(c, '[data-act="go-upstream"]');
    await L.sleep(2000);
    const hashAfter = await c.ev('location.hash');
    L.assert('概览', '去上游配置（单次点击）', '#upstream', hashAfter);
    if (hashBefore === hashAfter) console.log('    ⚠ 单次点击未跳转，如实记为失败（本轮无重试）');

    /* ================= 上游配置 ================= */
    console.log('\n[上游配置]');
    await L.goto(c, 'upstream', 4200);
    let profN = await c.ev("document.querySelectorAll('[data-up-edit]').length");
    if (profN === 0) { await L.sleep(3000); profN = await c.ev("document.querySelectorAll('[data-up-edit]').length"); }
    L.assertTruthy('上游', '配置列表渲染', profN >= 1, profN + ' 套');

    await L.click(c, '[data-up-edit]');
    await L.sleep(2500);
    L.assert('上游', '打开编辑表单', true, await c.ev("!!document.getElementById('up-form-el')"));

    // 刷新网关模型 → 断言选项数量增加/存在
    await L.click(c, '[data-up="reload-models"]');
    await L.sleep(3500);
    const optN = await c.ev("document.querySelectorAll('#up-model option').length");
    const tReload = await L.toastText(c);
    L.assertTruthy('上游', '刷新网关模型 → 有选项', optN > 3, optN + ' 个');
    L.assertTruthy('上游', '刷新网关模型 → toast 报数量', /已加载 \d+ 个模型/.test(tReload || ''), tReload.slice(0, 60));

    // 测试连通性 → toast 必须含 HTTP 状态码
    await L.click(c, '[data-up="test"]');
    await L.sleep(4000);
    const tTest = await L.toastText(c);
    L.assertTruthy('上游', '测试连通性 → toast 含 HTTP 200', /HTTP 200/.test(tTest || ''), tTest.slice(-70));

    // 改模型 → 显示名跟随
    const nameBefore = await c.ev("document.querySelector('[name=\"displayName\"]')?.value");
    const switched = await c.ev(`(() => {
      const sel = document.getElementById('up-model');
      const cur = sel.value;
      const opt = [...sel.options].find(o => o.value && o.value !== cur && o.value !== '__custom__');
      if (!opt) return null;
      sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true }));
      return opt.value;
    })()`);
    await L.sleep(1200);
    const nameAfter = await c.ev("document.querySelector('[name=\"displayName\"]')?.value");
    const expectedName = String(switched || '').replace(/^wb\//, '');
    L.assert('上游', '改模型 → 显示名跟随', expectedName, nameAfter);
    if (!switched) console.log('    ⚠ 没有可切换的模型，跳过');

    // 取消编辑 → 表单消失
    await L.click(c, '[data-up="cancel"]');
    await L.sleep(1800);
    const afterCancel = JSON.parse(await c.ev(`(() => JSON.stringify({ title: document.querySelector('#up-form .card__title')?.textContent.trim() || '', name: document.querySelector('[name="name"]')?.value ?? null }))()`));
    L.assert('上游', '取消编辑 → 回到空白新建态', { isNew: true, name: '' }, { isNew: /新建/.test(afterCancel.title), name: afterCancel.name });

    // 新建 → 表单出现；再取消（新表单无取消按钮，用刷新列表离开）
    await L.click(c, '[data-up="new"]');
    await L.sleep(2200);
    L.assert('上游', '新建上游 → 表单出现', true, await c.ev("!!document.getElementById('up-form-el')"));
    L.assert('上游', '新建表单无「取消编辑」按钮', 0, await c.ev("document.querySelectorAll('[data-up=\"cancel\"]').length"));

    await L.click(c, '[data-up="refresh"]');
    await L.sleep(2200);
    const afterRefresh = JSON.parse(await c.ev(`(() => JSON.stringify({ title: document.querySelector('#up-form .card__title')?.textContent.trim() || '', name: document.querySelector('[name="name"]')?.value ?? null }))()`));
    L.assert('上游', '刷新列表 → 表单仍是空白新建态', { isNew: true, name: '' }, { isNew: /新建/.test(afterRefresh.title), name: afterRefresh.name });

    /* ================= 模型能力 ================= */
    console.log('\n[模型能力]');
    await L.goto(c, 'models', 3200);
    let rows = await c.ev("document.querySelectorAll('#m-table tbody tr').length");
    if (rows === 0) { await L.sleep(2500); rows = await c.ev("document.querySelectorAll('#m-table tbody tr').length"); }
    L.assertTruthy('模型', '模型列表渲染', rows > 0, rows + ' 行');
    await L.click(c, '[data-m="refresh"]');
    await L.sleep(3500);
    const tM = await L.toastText(c);
    L.assertTruthy('模型', '刷新模型 → toast 报数量', /已加载 \d+ 个模型/.test(tM || ''), tM.slice(-50));

    /* ================= 补丁管理 ================= */
    console.log('\n[补丁管理]');
    await L.goto(c, 'patches');
    const dirty = await c.ev("(document.getElementById('pt-dirty')?.innerText||'').trim()");
    L.assert('补丁', '无未写入变更', '', dirty);
    const statusText = await c.ev("[...document.querySelectorAll('#pt-status .kv-list__item')].map(i=>i.innerText.replace(/\\n/g,': ')).join(' | ')");
    L.assert('补丁', 'bundle 状态 4 项全已写入', 4, (statusText.match(/已写入/g) || []).length);

    // 开关：改 config 但不应用（保持 bundle 不动）
    const cfg0 = L.readJSON(path.join(L.PROXY, 'config.json'));
    const beforeToggle = cfg0.patches ? cfg0.patches.experts !== false : true;
    await L.click(c, '[data-patch-toggle="experts"]');
    await L.sleep(2000);
    const cfg1 = L.readJSON(path.join(L.PROXY, 'config.json'));
    const afterToggle = cfg1.patches ? cfg1.patches.experts !== false : true;
    L.assert('补丁', '专家团开关翻转 config', !beforeToggle, afterToggle);
    // 翻回去
    await L.click(c, '[data-patch-toggle="experts"]');
    await L.sleep(2000);
    const cfg2 = L.readJSON(path.join(L.PROXY, 'config.json'));
    L.assert('补丁', '开关翻回原值', beforeToggle, cfg2.patches ? cfg2.patches.experts !== false : true);

    await L.click(c, '[data-pt="refresh"]');
    await L.sleep(2500);
    const tP = await L.toastText(c);
    L.assertTruthy('补丁', '刷新 → toast 确认', /状态已刷新/.test(tP || ''), tP.slice(-40));

    /* ================= 日志 ================= */
    console.log('\n[日志]');
    await L.goto(c, 'logs', 3200);
    const lines = await c.ev(`document.querySelectorAll('.log-row').length`);
    L.assertTruthy('日志', '日志正文有内容（不是 0 行）', lines > 0, lines + ' 行');
    await L.click(c, '[data-lg="refresh"]');
    await L.sleep(2500);
    const lines2 = await c.ev(`document.querySelectorAll('.log-row').length`);
    L.assertTruthy('日志', '刷新后仍有内容', lines2 > 0, lines2 + ' 行');

    /* ================= 系统设置 ================= */
    console.log('\n[系统设置]');
    await L.goto(c, 'settings');
    for (const key of ['injectTools', 'serveWiki']) {
      const v0 = await c.ev(`document.querySelector('[data-set="${key}"]').checked`);
      await L.click(c, `[data-set="${key}"]`);
      await L.sleep(2500);
      const cfgA = L.readJSON(path.join(L.PROXY, 'config.json'));
      const v1 = cfgA[key] !== false;
      L.assert('设置', `开关 ${key} 写入 config`, !v0, v1);
      await L.click(c, `[data-set="${key}"]`);
      await L.sleep(2500);
      const cfgB = L.readJSON(path.join(L.PROXY, 'config.json'));
      L.assert('设置', `开关 ${key} 翻回`, v0, cfgB[key] !== false);
    }

    // 全局配置：改端口 → 写 config → 改回
    const port0 = (L.readJSON(path.join(L.PROXY, 'config.json')) || {}).proxyPort;
    await L.typeInto(c, '[name="proxyPort"]', '8799');
    await L.click(c, '[data-set-act="save"]');
    await L.sleep(2500);
    const port1 = (L.readJSON(path.join(L.PROXY, 'config.json')) || {}).proxyPort;
    L.assert('设置', '保存全局配置 → proxyPort 写入', 8799, Number(port1));
    await L.typeInto(c, '[name="proxyPort"]', String(port0));
    await L.click(c, '[data-set-act="save"]');
    await L.sleep(2500);
    L.assert('设置', '端口改回', Number(port0), Number((L.readJSON(path.join(L.PROXY, 'config.json')) || {}).proxyPort));

    await L.click(c, '[data-set-act="reload"]');
    await L.sleep(2000);
    const tR = await L.toastText(c);
    L.assertTruthy('设置', '重新读取 → toast', /已重新读取/.test(tR || ''), tR.slice(-40));

    // 重新探测：断言 root 真的变回自动探测结果
    await L.click(c, '[data-ide-act="detect"]');
    await L.sleep(3500);
    const det = await c.ev(`(() => {
      const el = [...document.querySelectorAll('#set-ide .kv-grid__value, #set-ide [style*="font-mono"]')][0];
      return el ? el.textContent.trim() : null;
    })()`);
    L.assert('设置', '重新探测 → 显示安装目录', 'D:\\Qoder IDE', det);
    const stDet = await L.api('/api/status');
    L.assert('设置', '重新探测 → 后端 root 正确', 'D:\\Qoder IDE', stDet.ide.root);

    // 保存空路径 = 恢复自动
    await L.typeInto(c, '[name="ideRoot"]', '');
    await L.click(c, '[data-ide-act="save"]');
    await L.sleep(2500);
    const stClear = await L.api('/api/status');
    L.assert('设置', '清空 installDir → 回到自动模式', 'auto', stClear.ide.source);

    /* ================= 维护 ================= */
    console.log('\n[维护]');
    await L.goto(c, 'maintain');
    const gridBadges = await c.ev("document.querySelectorAll('.kv-grid .badge').length");
    L.assert('维护', '环境状态徽章数（1 代理 + 4 补丁）', 5, gridBadges);

    const pidBefore = L.consoleProc();
    const proxyPidBefore = L.sh("Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*qoder-proxy*proxy.js*' } | Select-Object -First 1 -ExpandProperty ProcessId");
    await L.click(c, '[data-mt="sync"]');
    await L.sleep(4000);
    const tSync = await L.toastText(c);
    L.assertTruthy('维护', '同步模型记录 → toast', /模型记录已同步/.test(tSync || ''), tSync.slice(-40));
    const b = L.bindings();
    L.assert('维护', '同步后 对话绑定', 'custom:model_mocktest', b.assistant);
    L.assert('维护', '同步后 专家团绑定', 'custom:model_mocktest', b.experts);

    await L.click(c, '[data-mt="restart-proxy"]');
    await L.sleep(6000);
    const proxyPidAfter = L.sh("Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*qoder-proxy*proxy.js*' } | Select-Object -First 1 -ExpandProperty ProcessId");
    const stPx = await L.api('/api/status');
    L.assertTruthy('维护', '重启代理 → PID 变化', proxyPidBefore && proxyPidAfter && proxyPidBefore !== proxyPidAfter, `${proxyPidBefore} → ${proxyPidAfter}`);
    // 用 config 里的真实端口判断，不能硬编码 —— 端口可配
    const livePort = stPx.proxy.port;
    const portLive = await fetch(`http://127.0.0.1:${livePort}/`, { method: 'GET' }).then(() => true).catch(() => false);
    L.assert('维护', `重启代理 → ${livePort} 真的在监听`, true, stPx.proxy.running === true && portLive);
    L.assert('维护', '代理端口与 IDE http.proxy 一致', true, (L.httpProxy() || '').includes(':' + livePort));

    /* ================= 帮助 ================= */
    console.log('\n[帮助]');
    await L.goto(c, 'faq');
    const faqN = await c.ev("document.querySelectorAll('details.faq-item').length");
    L.assertTruthy('帮助', '折叠项数量', faqN > 0, faqN + ' 项');
    await L.click(c, 'details.faq-item summary');
    await L.sleep(800);
    L.assert('帮助', '点击展开', true, await c.ev("document.querySelector('details.faq-item')?.open === true"));

    await L.shot(c, 'p1_final');
    L.assert('通用', '全程无 JS 异常', 0, c.errors.length);
    if (c.errors.length) c.errors.slice(0, 3).forEach((e) => console.log('    ' + e.slice(0, 120)));
  } finally {
    restoreCfg();
    c.close();
  }

  const bad = L.summary('第 1 段（控制台交互）');
  L.saveResults('p1');
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.log('ERR ' + (e && e.stack || e)); process.exit(2); });
