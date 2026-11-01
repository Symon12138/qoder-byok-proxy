/**
 * 证书自举
 *
 * 新克隆下来的仓库里没有 ca.key / leaf.key（私钥不入库），代理启动时会因为
 * 读不到 leaf.key 直接崩掉。这里在启动前补上：缺了就现场生成一套，
 * 让「clone → 起代理」不再需要手工准备证书。
 *
 * 生成 CA 与 api3.qoder.sh 的签证书，SAN 取仓库里的 ext.cnf（六个别名）。
 * 依赖 openssl —— Windows 上一般由 Git for Windows 自带，不在 PATH 里也能找到。
 *
 * 注意：生成出来的 CA 需要被系统信任，MITM 才会生效。本机是把它装进了
 * 「当前用户 → 受信任的根证书颁发机构」（不需要管理员）。这一步不做自动化，
 * 因为往证书存储里写东西属于系统级改动，应该由人确认；启动时会给出提示。
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FILES = ['ca.key', 'ca.crt', 'leaf.key', 'leaf.crt'];

// PATH 优先，其次常见的 Git for Windows / scoop 安装位置
const OPENSSL_CANDIDATES = [
  'openssl',
  'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
  'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
  'C:\\Program Files (x86)\\Git\\usr\\bin\\openssl.exe',
  path.join(process.env.USERPROFILE || '', 'scoop', 'shims', 'openssl.exe'),
];

function findOpenSSL() {
  for (const c of OPENSSL_CANDIDATES) {
    if (!c) continue;
    const r = spawnSync(c, ['version'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    if (!r.error && r.status === 0 && /OpenSSL/i.test(r.stdout || '')) return c;
  }
  return null;
}

function run(ossl, args, cwd) {
  const r = spawnSync(ossl, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 60000 });
  if (r.error) throw new Error(r.error.message);
  if (r.status !== 0) {
    const msg = ((r.stderr || '') + (r.stdout || '')).trim().split('\n').slice(-2).join(' ');
    throw new Error(`openssl ${args[0]} 失败: ${msg}`);
  }
}

/**
 * 确保证书齐备。返回 { ok, created, error }
 * - created=true 表示这次现场生成了一套（调用方可以提示用户去信任 CA）
 */
function ensureCerts(dir) {
  const missing = FILES.filter((f) => !fs.existsSync(path.join(dir, f)));
  if (missing.length === 0) return { ok: true, created: false };

  const ossl = findOpenSSL();
  if (!ossl) {
    return {
      ok: false,
      created: false,
      error:
        '缺少证书（' + missing.join(', ') + '），且找不到 openssl。\n' +
        '  装一个 Git for Windows（自带 openssl）通常就够了，或把 openssl 放进 PATH。',
    };
  }

  const ext = path.join(dir, 'ext.cnf');
  if (!fs.existsSync(ext)) {
    return { ok: false, created: false, error: '缺少 ' + ext + '（证书 SAN 配置，仓库里应该有）' };
  }

  // 缺哪个补哪个：整套按顺序重来，避免出现"新 CA 配旧 leaf"这种半套证书
  for (const f of FILES) {
    try { fs.unlinkSync(path.join(dir, f)); } catch { /* 不存在就算了 */ }
  }
  try { fs.unlinkSync(path.join(dir, 'leaf.csr')); } catch { /* 同上 */ }
  try { fs.unlinkSync(path.join(dir, 'ca.srl')); } catch { /* 同上 */ }

  try {
    run(ossl, ['genrsa', '-out', 'ca.key', '2048'], dir);
    run(ossl, ['req', '-x509', '-new', '-key', 'ca.key', '-sha256', '-days', '3650',
      '-out', 'ca.crt', '-subj', '/CN=Qoder Lab Root CA'], dir);
    run(ossl, ['genrsa', '-out', 'leaf.key', '2048'], dir);
    run(ossl, ['req', '-new', '-key', 'leaf.key', '-out', 'leaf.csr',
      '-subj', '/CN=api3.qoder.sh'], dir);
    run(ossl, ['x509', '-req', '-in', 'leaf.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key',
      '-CAcreateserial', '-out', 'leaf.crt', '-days', '3650', '-sha256',
      '-extfile', 'ext.cnf'], dir);
    return { ok: true, created: true, caCert: path.join(dir, 'ca.crt') };
  } catch (e) {
    return { ok: false, created: false, error: '生成证书失败: ' + e.message };
  }
}

module.exports = { ensureCerts, findOpenSSL };
