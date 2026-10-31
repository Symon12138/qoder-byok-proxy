/**
 * 第三轮 - 第 3 段：Qoder 端到端 + API 全端点 + 导入导出闭环（严格断言）
 */
const fs = require('fs');
const L = require('./lib');

async function main() {
  await L.ensureConsoleFresh();

  /* ---------- Qoder 进程与绑定 ---------- */
  console.log('=== Qoder 端到端 ===');
  const qn = L.qoderCount();
  L.assertTruthy('Qoder', '进程在运行', qn >= 10, qn + ' 进程');

  const b = L.bindings();
  L.assert('Qoder', '对话绑定', 'custom:model_mocktest', b.assistant);
  L.assert('Qoder', '专家团绑定', 'custom:model_mocktest', b.experts);
  L.assertTruthy('Qoder', '模型记录存在', b.customModels.includes('minimax'), '长度=' + b.customModels.length);

  /* ---------- 代理流量（按时间戳，不按行数）---------- */
  const countReq = async (mins) => {
    const r = await L.api('/api/logs?n=1000&src=proxy');
    const now = Date.now();
    return (r.lines || []).filter((l) => {
      try { const o = JSON.parse(l); if (o.kind !== 'request') return false; const t = Date.parse(o.at); return !isNaN(t) && (now - t) < mins * 60000; } catch (e) { return false; }
    }).length;
  };
  const before = await countReq(0.2);
  L.assertTruthy('代理', 'Qoder 有流量经过代理', before > 0, before + ' 个请求/12秒');

  /* ---------- 重启 Qoder，流量应继续 ---------- */
  console.log('\n=== 重启 Qoder，验证流量与模型保持 ===');
  const q2 = await L.startQoder(12);
  L.assertTruthy('Qoder', '重启后进程数', q2 >= 10, q2 + ' 进程');
  await L.sleep(15000);
  const after = await countReq(2);
  L.assertTruthy('Qoder', '重启后仍有代理流量', after > before, `${before} → ${after}`);

  const b2 = L.bindings();
  L.assert('Qoder', '重启后对话绑定保持', 'custom:model_mocktest', b2.assistant);
  L.assert('Qoder', '重启后专家团绑定保持', 'custom:model_mocktest', b2.experts);

  /* ---------- Qoder 自己的日志 ---------- */
  const logRoot = process.env.APPDATA + '\\Qoder\\logs';
  const latest = fs.readdirSync(logRoot).sort().reverse()[0];
  let agentLog = '';
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const f of entries) {
      const p = d + '\\' + f.name;
      if (f.isDirectory()) walk(p);
      else if (f.name === 'agent.log') { try { agentLog += fs.readFileSync(p, 'utf8'); } catch (e) {} }
    }
  };
  walk(logRoot + '\\' + latest);
  L.assertTruthy('Qoder', '日志确认 assistant=custom:model_mocktest',
    /sessionType=assistant, initialModel=custom:model_mocktest/.test(agentLog), '日志目录 ' + latest);
  L.assertTruthy('Qoder', '日志确认 experts=custom:model_mocktest',
    /sessionType=experts, initialModel=custom:model_mocktest/.test(agentLog), '');
  L.assert('Qoder', '日志中无回落 auto', false, /setting assistant to auto/.test(agentLog));

  /* ---------- API 全端点 ---------- */
  console.log('\n=== API 端点 ===');
  const gets = ['/api/status', '/api/config', '/api/models', '/api/logs?n=5&src=proxy', '/api/profiles', '/api/record'];
  for (const p of gets) {
    const r = await L.api(p, undefined, 30000);
    L.assertTruthy('API', 'GET ' + p, r && r.ok !== false && !r.error, r && r.error ? JSON.stringify(r).slice(0, 40) : '');
  }
  const posts = [
    ['/api/tools', { injectTools: true }],
    ['/api/ide-detect', {}],
    ['/api/ide-proxy', { port: 8788 }],
    ['/api/sync', {}],
  ];
  for (const [p, body] of posts) {
    const r = await L.api(p, body, 90000);
    L.assertTruthy('API', 'POST ' + p, r && r.ok !== false && !r.error, r && r.error ? JSON.stringify(r).slice(0, 40) : '');
  }

  /* ---------- 目录选择框取消路径 ---------- */
  console.log('\n=== 目录选择框 ===');
  const pickP = L.api('/api/pick-folder', {}, 120000);
  await L.sleep(6000);
  const closed = L.sh("Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;using System.Text;public class DX{public delegate bool EP(IntPtr h,IntPtr p);[DllImport(\"user32.dll\")]public static extern bool EnumWindows(EP c,IntPtr p);[DllImport(\"user32.dll\")]public static extern bool IsWindowVisible(IntPtr h);[DllImport(\"user32.dll\")]public static extern int GetClassName(IntPtr h,StringBuilder s,int n);[DllImport(\"user32.dll\")]public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);public static int Close(){int n=0;EnumWindows((h,p)=>{if(!IsWindowVisible(h))return true;var c=new StringBuilder(256);GetClassName(h,c,256);if(c.ToString()==\"#32770\"){PostMessage(h,0x0010,IntPtr.Zero,IntPtr.Zero);n++;}return true;},IntPtr.Zero);return n;}}' -ErrorAction SilentlyContinue; [DX]::Close()");
  const pick = await pickP;
  L.assertTruthy('对话框', '弹出了系统对话框', parseInt(String(closed).trim(), 10) >= 1, '关闭了 ' + String(closed).trim() + ' 个');
  L.assert('对话框', '取消后返回 cancelled', true, !!(pick && pick.cancelled === true));

  /* ---------- 导入导出闭环 ---------- */
  console.log('\n=== 导入导出闭环 ===');
  const cfgBefore = await L.api('/api/config');
  const exp = await L.api('/api/export');
  L.assertTruthy('导出', '导出含 config', exp && exp.config && typeof exp.config === 'object', Object.keys(exp || {}).join(','));
  L.assertTruthy('导出', '导出含 tools', Array.isArray(exp.tools), (exp && exp.tools ? exp.tools.length + ' 个' : ''));
  const imp = await L.api('/api/import', exp);
  L.assertTruthy('导入', '导入成功', imp && imp.ok !== false, JSON.stringify(imp || {}).slice(0, 50));
  await L.sleep(1200);
  const cfgAfter = await L.api('/api/config');
  const pick2 = (c) => ({ activeProfile: c.activeProfile, proxyPort: c.proxyPort, recordId: c.recordId, upstream: c.upstream });
  L.assert('导入', '导入后关键字段一致', pick2(cfgBefore), pick2(cfgAfter));

  const bad = L.summary('第 3 段（Qoder 端到端 + API）');
  L.saveResults('p3');
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.log('ERR ' + (e && e.stack || e)); process.exit(2); });
