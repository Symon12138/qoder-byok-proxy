/**
 * 隔离实验：console 在什么操作之后变得不可达
 */
const L = require('./lib');

const heavyCheck = () => {
  const a = L.sh(`& '${L.NODE}' --check '${L.WB}'; $LASTEXITCODE`);
  const b = L.sh(`& '${L.NODE}' --check '${L.AW}'; $LASTEXITCODE`);
  return [a, b];
};

async function main() {
  await L.ensureConsoleFresh();

  for (let round = 1; round <= 3; round++) {
    console.log(`\n--- 第 ${round} 轮 ---`);
    let p = L.consoleProc();
    console.log(`  起点 console: pid=${p ? p.pid : 'none'} born=${p ? p.createdIso : '-'}`);
    const s1 = await L.api('/api/status', undefined, 8000);
    console.log(`  status 可达: ${!!(s1 && s1.patches)}`);

    const t0 = Date.now();
    const [a, b] = heavyCheck();
    console.log(`  两次 node --check 耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s  (${String(a).trim().split(/\s+/).pop()} / ${String(b).trim().split(/\s+/).pop()})`);

    p = L.consoleProc();
    console.log(`  检查后 console: pid=${p ? p.pid : 'none'} born=${p ? p.createdIso : '-'}`);

    const portNow = L.sh("(Get-NetTCPConnection -LocalPort 3426 -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count");
    console.log(`  3426 监听中: ${portNow}`);

    const t1 = Date.now();
    const r = await L.api('/api/sync', {}, 90000);
    console.log(`  sync: code=${r && r.sync ? r.sync.code : 'undefined'}  耗时 ${((Date.now() - t1) / 1000).toFixed(1)}s  ${r && r.sync ? '✅' : '❌ ' + JSON.stringify(r).slice(0, 60)}`);

    await L.sleep(2000);
  }

  // 再单独测：不跑 node --check 直接 sync
  console.log('\n--- 对照：不跑 node --check，直接 sync ---');
  for (let i = 1; i <= 2; i++) {
    const r = await L.api('/api/sync', {}, 90000);
    console.log(`  #${i} code=${r && r.sync ? r.sync.code : 'undefined'} ${r && r.sync ? '✅' : '❌'}`);
  }
  process.exit(0);
}
main().catch((e) => { console.log('ERR ' + (e && e.stack || e)); process.exit(2); });
