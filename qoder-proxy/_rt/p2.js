/**
 * 第三轮 - 第 2 段：补丁全流程（严格断言，无基线自愈，无重试）
 * 顺序：如实记录起始态 → 回滚 → 重启Qoder → 验证 → 应用 → 重启Qoder → 验证
 *       → 同步记录/绑定 → 再重启 → 验证模型保持
 */
const fs = require('fs');
const L = require('./lib');

const REVERT_LOG = L.ROOT + '\\_revert_all_log.txt';
const APPLY_LOG = L.ROOT + '\\_apply_all_log.txt';

async function ensureConsole() {
  const f = await L.ensureConsoleFresh();
  // 再加一层：确认连续两次请求都通，避免刚好撞上 socket 重建
  for (let i = 0; i < 8; i++) {
    const a = await L.api('/api/status', undefined, 6000);
    await L.sleep(700);
    const b = await L.api('/api/status', undefined, 6000);
    if (a && a.patches && b && b.patches) return f;
    await L.sleep(1500);
  }
  return f;
}

async function main() {
  console.log('=== 起始状态（如实记录，不做任何修复）===');
  await ensureConsole();
  const st0 = await L.api('/api/status');
  const m0 = L.markers();
  console.log(`  补丁状态: byok=${st0.patches.byok} experts=${st0.patches.experts} live=${st0.patches.live} repowiki=${st0.patches.repowiki}`);
  console.log(`  bundle 标记: byok=${m0.byok} p4=${m0.p4} p13=${m0.p13} live=${m0.live} repowiki=${m0.repowiki} 旧注入=${m0.oldInject}`);
  console.log(`  Qoder 进程: ${L.qoderCount()}`);
  const bind0 = L.bindings();
  console.log(`  绑定: assistant=${bind0.assistant} experts=${bind0.experts}`);
  // 只断言"控制台读数与 bundle 实物一致"，不断言必须已应用
  L.assert('起始', '控制台读数与 bundle 实物一致', { byok: m0.byok, experts: m0.p4, live: m0.live, repowiki: m0.repowiki },
    { byok: st0.patches.byok, experts: st0.patches.experts, live: st0.patches.live, repowiki: st0.patches.repowiki });

  /* ---------------- 回滚 ---------------- */
  console.log('\n=== 回滚（提权，会关掉 Qoder 和 console）===');
  try { fs.unlinkSync(REVERT_LOG); } catch (e) {}
  const rev = await L.api('/api/revert', {});
  L.assert('回滚', '接口接受', true, rev.ok === true);
  const revDone = await L.waitLog(REVERT_LOG, 'REVERT-ALL DONE', 240);
  L.assert('回滚', '日志出现 REVERT-ALL DONE', true, revDone);

  const revLog = fs.existsSync(REVERT_LOG) ? fs.readFileSync(REVERT_LOG, 'utf8') : '';
  L.assert('回滚', '日志记录的 root 正确', 'D:\\Qoder IDE', (revLog.match(/start root=(.+)/) || [])[1] || '');
  L.assertTruthy('回滚', '日志无 ABORT', !/ABORT/.test(revLog), revLog.includes('ABORT') ? '含 ABORT' : '');
  L.assert('回滚', '两个 bundle 都还原了', 2, (revLog.match(/restored bundle/g) || []).length);

  const mR = L.markers();
  L.assert('回滚', 'bundle 5 个标记全部消失',
    { byok: false, p4: false, p13: false, live: false, repowiki: false },
    { byok: mR.byok, p4: mR.p4, p13: mR.p13, live: mR.live, repowiki: mR.repowiki });

  await ensureConsole();
  const stR = await L.api('/api/status');
  L.assert('回滚', '控制台报未应用', { byok: false, experts: false, live: false, repowiki: false },
    { byok: stR.patches.byok, experts: stR.patches.experts, live: stR.patches.live, repowiki: stR.patches.repowiki });
  L.assert('回滚', 'http.proxy 已移除', '', L.httpProxy());
  const bindR = L.bindings();
  L.assertTruthy('回滚', '模型记录已清空', !bindR.customModels || bindR.customModels.length < 60, '长度=' + (bindR.customModels || '').length);

  /* ---------------- 重启 Qoder（回滚后） ---------------- */
  console.log('\n=== 重启 Qoder（回滚后）===');
  const q1 = await L.startQoder(12);
  L.assertTruthy('回滚后', 'Qoder 启动', q1 >= 12, q1 + ' 进程');
  await L.sleep(14000);
  const mR2 = L.markers();
  L.assert('回滚后', '重启不会把补丁"复活"', { byok: false, p4: false }, { byok: mR2.byok, p4: mR2.p4 });

  /* ---------------- 应用补丁 ---------------- */
  console.log('\n=== 应用补丁（提权）===');
  try { fs.unlinkSync(APPLY_LOG); } catch (e) {}
  const app = await L.api('/api/apply', {});
  L.assert('应用', '接口接受', true, app.ok === true);
  const appDone = await L.waitLog(APPLY_LOG, 'APPLY-ALL DONE', 300);
  L.assert('应用', '日志出现 APPLY-ALL DONE', true, appDone);

  const appLog = fs.existsSync(APPLY_LOG) ? fs.readFileSync(APPLY_LOG, 'utf8') : '';
  L.assert('应用', '日志记录的 root 正确', 'D:\\Qoder IDE', (appLog.match(/start root=(.+)/) || [])[1] || '');
  L.assertTruthy('应用', '双 bundle 校验通过', /bundle ok: both present/.test(appLog), '');
  L.assert('应用', '8 个步骤全部 exit=0', 0, (appLog.match(/exit=(?!0)\d+/g) || []).length);
  L.assertTruthy('应用', 'SUMMARY 里 experts 步骤存在', /experts=0/.test(appLog), (appLog.match(/SUMMARY.*/) || [''])[0].slice(0, 100));

  const mA = L.markers();
  L.assert('应用', 'bundle 5 个标记齐全',
    { byok: true, p4: true, p13: true, live: true, repowiki: true },
    { byok: mA.byok, p4: mA.p4, p13: mA.p13, live: mA.live, repowiki: mA.repowiki });
  L.assert('应用', '没有旧版注入残留', false, mA.oldInject);

  await ensureConsole();
  const stA = await L.api('/api/status');
  L.assert('应用', '控制台报已应用', { byok: true, experts: true, live: true, repowiki: true },
    { byok: stA.patches.byok, experts: stA.patches.experts, live: stA.patches.live, repowiki: stA.patches.repowiki });

  const syn = L.sh(`& '${L.NODE}' --check '${L.WB}'; $LASTEXITCODE`);
  L.assert('应用', 'workbench bundle 语法正确', 0, parseInt(String(syn).trim().split(/\s+/).pop(), 10));
  const syn2 = L.sh(`& '${L.NODE}' --check '${L.AW}'; $LASTEXITCODE`);
  L.assert('应用', 'agents-window bundle 语法正确', 0, parseInt(String(syn2).trim().split(/\s+/).pop(), 10));

  /* ---------------- 同步记录 + 绑定 ---------------- */
  console.log('\n=== 同步模型记录与场景绑定 ===');
  const sync = await L.api('/api/sync', {});   // 必须 POST，不传 body 会退化成 GET
  L.assert('同步', '同步脚本成功', 0, sync.sync && sync.sync.code);
  const lastLine = String((sync.sync && sync.sync.out) || '').split('\n').filter(Boolean).pop() || '';
  L.assertTruthy('同步', '返回里说明了绑定结果', /场景绑定 -> custom:/.test(lastLine), lastLine.slice(-60));
  await L.sleep(1500);
  const b1 = L.bindings();
  L.assert('同步', '对话绑定', 'custom:model_mocktest', b1.assistant);
  L.assert('同步', '专家团绑定', 'custom:model_mocktest', b1.experts);
  L.assertTruthy('同步', '模型记录含 minimax', b1.customModels.includes('minimax'), '长度=' + b1.customModels.length);

  // IDE 指向代理
  if (!L.httpProxy()) {
    const ip = await L.api('/api/ide-proxy', { port: 8788 });
    L.assert('同步', 'IDE 指向代理接口', true, ip.ok === true);
    await L.sleep(1500);
  }
  L.assert('同步', 'http.proxy 指向代理端口', true, (L.httpProxy() || '').includes(':8788'));

  /* ---------------- 重启 Qoder 验证保持 ---------------- */
  console.log('\n=== 重启 Qoder（应用后）===');
  const q2 = await L.startQoder(12);
  L.assertTruthy('应用后', 'Qoder 启动', q2 >= 12, q2 + ' 进程');
  await L.sleep(16000);

  const b2 = L.bindings();
  L.assert('应用后', '重启后 对话绑定保持', 'custom:model_mocktest', b2.assistant);
  L.assert('应用后', '重启后 专家团绑定保持', 'custom:model_mocktest', b2.experts);

  const mB = L.markers();
  L.assert('应用后', '重启后补丁标记仍在', { byok: true, p4: true, p13: true }, { byok: mB.byok, p4: mB.p4, p13: mB.p13 });

  // Qoder 自己日志里的模型判定
  const dirs = fs.readdirSync(L.ROOT.replace('\\dsh', '') && process.env.APPDATA + '\\Qoder\\logs').sort().reverse();
  const latest = dirs[0];
  let agentLog = '';
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = d + '\\' + f.name;
      if (f.isDirectory()) walk(p);
      else if (f.name === 'agent.log') agentLog += fs.readFileSync(p, 'utf8');
    }
  };
  try { walk(process.env.APPDATA + '\\Qoder\\logs\\' + latest); } catch (e) {}
  L.assertTruthy('应用后', 'Qoder 日志确认 assistant 用自定义模型', /sessionType=assistant, initialModel=custom:model_mocktest/.test(agentLog), '');
  L.assertTruthy('应用后', 'Qoder 日志确认 experts 用自定义模型', /sessionType=experts, initialModel=custom:model_mocktest/.test(agentLog), '');
  L.assert('应用后', '没有再被重置成 auto', false, /setting assistant to auto/.test(agentLog));

  const bad = L.summary('第 2 段（补丁全流程）');
  L.saveResults('p2');
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.log('ERR ' + (e && e.stack || e)); process.exit(2); });
