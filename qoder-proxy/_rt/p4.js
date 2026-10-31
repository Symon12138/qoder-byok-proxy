/**
 * 第三轮 - 第 4 段：退出服务路径 + 完整复原（严格断言）
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const L = require('./lib');

const portOpen = async (port) => {
  try { await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2500) }); return true; }
  catch (e) { return false; }
};

async function main() {
  await L.ensureConsoleFresh();

  console.log('=== 退出前快照 ===');
  const st0 = await L.api('/api/status');
  const b0 = L.bindings();
  const hp0 = L.httpProxy();
  L.assert('快照', '代理在运行', true, st0.proxy.running);
  L.assert('快照', 'IDE 指向代理', true, hp0.includes(':8788'));
  L.assert('快照', '对话绑定是自定义模型', 'custom:model_mocktest', b0.assistant);

  /* ---------- 执行退出服务 ---------- */
  console.log('\n=== 执行退出服务 ===');
  const shut = await L.api('/api/shutdown', {});
  L.assertTruthy('退出', '接口返回步骤明细', Array.isArray(shut.steps) && shut.steps.length > 0, (shut.steps || []).join(' / ').slice(0, 120));
  await L.sleep(7000);

  /* ---------- 退出后的状态 ---------- */
  console.log('\n=== 退出后状态 ===');
  L.assert('退出后', '控制台 3426 已关闭', false, await portOpen(3426));
  L.assert('退出后', '代理 8788 已关闭', false, await portOpen(8788));
  const b1 = L.bindings();
  L.assert('退出后', '模型记录已清空', true, !b1.customModels || b1.customModels.length < 60);
  L.assert('退出后', '对话绑定回官方', 'auto', b1.assistant);
  L.assert('退出后', '专家团绑定回官方', 'experts-auto', b1.experts);
  L.assert('退出后', 'http.proxy 已移除', '', L.httpProxy());

  /* ---------- 复原 ---------- */
  console.log('\n=== 复原环境 ===');
  const child = spawn(L.NODE, [path.join(L.PROXY, 'admin.js')], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  const back = await L.ensureConsoleFresh();
  L.assertTruthy('复原', '控制台已重启', !!back, 'pid=' + back.pid);

  // 补丁
  const al = L.ROOT + '\\_apply_all_log.txt';
  try { fs.unlinkSync(al); } catch (e) {}
  await L.api('/api/apply', {});
  const applied = await L.waitLog(al, 'APPLY-ALL DONE', 300);
  L.assert('复原', '补丁重新应用完成', true, applied);
  const m = L.markers();
  L.assert('复原', 'bundle 标记齐全', { byok: true, p4: true, p13: true, live: true, repowiki: true },
    { byok: m.byok, p4: m.p4, p13: m.p13, live: m.live, repowiki: m.repowiki });

  await L.ensureConsoleFresh();
  // 记录 + 绑定
  const sync = await L.api('/api/sync', {}, 120000);
  L.assert('复原', '同步脚本成功', 0, sync && sync.sync ? sync.sync.code : 'undefined');
  await L.sleep(1500);
  const b2 = L.bindings();
  L.assert('复原', '对话绑定恢复', 'custom:model_mocktest', b2.assistant);
  L.assert('复原', '专家团绑定恢复', 'custom:model_mocktest', b2.experts);

  // 代理与 IDE 指向
  const ip = await L.api('/api/ide-proxy', { port: 8788 });
  L.assert('复原', 'IDE 重新指向代理', true, ip.ok === true);
  await L.sleep(2500);
  L.assert('复原', 'http.proxy 正确', true, L.httpProxy().includes(':8788'));

  // Qoder
  const q = await L.startQoder(12);
  L.assertTruthy('复原', 'Qoder 启动', q >= 10, q + ' 进程');
  await L.sleep(14000);
  const b3 = L.bindings();
  L.assert('复原', '重启后对话绑定保持', 'custom:model_mocktest', b3.assistant);
  L.assert('复原', '重启后专家团绑定保持', 'custom:model_mocktest', b3.experts);

  const stF = await L.api('/api/status');
  L.assert('复原', '补丁状态全绿', { b: true, e: true, l: true, r: true },
    { b: stF.patches.byok, e: stF.patches.experts, l: stF.patches.live, r: stF.patches.repowiki });
  L.assert('复原', '代理在运行', true, stF.proxy.running);

  const bad = L.summary('第 4 段（退出服务 + 复原）');
  L.saveResults('p4');
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.log('ERR ' + (e && e.stack || e)); process.exit(2); });
