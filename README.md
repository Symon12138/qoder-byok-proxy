# Qoder BYOK

让 **Qoder IDE 用上你自己的任意第三方模型**（任何 OpenAI 兼容的 `/chat/completions`），
不依赖官方账号额度。做法是本地 MITM 代理 + 一组可独立开关的 bundle 补丁。

> 仅供自己在自己机器上使用。仓库为私有。

## 它由三部分组成

| 组件 | 位置 | 作用 |
|---|---|---|
| **代理** | `qoder-proxy/proxy.js` → `127.0.0.1:8788` | 用本地 CA 接管 Qoder 发往 `api3.qoder.sh` 的聊天请求，解码后改写成 OpenAI 格式转发到你配的上游；非自定义请求原样隧道回官方 |
| **控制台** | `qoder-proxy/admin.js` → `http://127.0.0.1:3426` | 网页界面：配上游、切模型、开关补丁、看请求日志、信任证书 |
| **补丁** | `scripts/experts-patch.js` + `scripts/patch-qoder-*.ps1` | 8 条针对 bundle 的定点修改，解除随版本变化的门控，让自定义模型出现在模型选择器里 |

请求链路：

```
Qoder IDE ──http.proxy──> 127.0.0.1:8788 ──┬─ 自定义模型 → 你的上游 /chat/completions
                                            └─ 其它请求   → 原样隧道 api3.qoder.sh
```

## 快速开始

```powershell
git clone https://github.com/Symon12138/qoder-byok-proxy.git
cd qoder-byok-proxy

# 1. 起服务（首次启动会用 openssl 现场生成 CA 与证书，需要 Git for Windows）
start.cmd

# 2. 信任 CA：打开 http://127.0.0.1:3426 → 维护 → 信任证书 → Windows 弹窗点「是」
# 3. 配置上游：复制模板改名后填自己的 key
Copy-Item qoder-proxy\config.example.json qoder-proxy\config.json
#    改 baseUrl / apiKey / model / displayName

# 4. 应用补丁（需要管理员，会弹 UAC）→「IDE 走代理」→ 重启 Qoder
```

装完之后 Qoder 的模型选择器里会出现名为 `displayName` 的自定义模型。

## 目录

```
qoder-byok-proxy/            ← clone 下来的目录名（本机这份叫 qoder-byok/）
├─ start.cmd / start.ps1     一键启动/停止/查状态 ← 日常只需要双击这个
├─ apply-all.ps1             提权打补丁（7 步流水线，内部调用 scripts/）
├─ revert-all.ps1            提权回滚到官方状态
├─ scripts/                  补丁与模型同步脚本（不直接运行，由 apply-all / 控制台调用）
│  ├─ experts-patch.js       8 条 bundle 补丁
│  ├─ run-experts-patch.ps1  apply-all 的中间层：找 node、读配置
│  ├─ patch-qoder-*.ps1      老一代补丁（byok / url / merge / live）+ 收尾修正
│  ├─ fix-qoder-checksums.ps1  修 product.json / featureFlags.json 的校验和
│  └─ sync-qoder-model.ps1   把模型能力写进 Qoder 的 sqlite 模型记录
└─ qoder-proxy/              代理 + 控制台 + 文档
   ├─ README.md              ★ 详细文档（配置字段、补丁清单、踩坑记录、排障）
   ├─ config.example.json    配置模板
   ├─ proxy.js / admin.js    代理与控制台后端
   ├─ src/ styles/ fonts/    控制台前端
   └─ _rt/                   回归与诊断工具（mitm-test / docaudit / finalcheck / cacheaudit / logaudit）
```

## 三条必须知道的限制

1. **服务不会自启** —— 重启/注销后要手动双击 `start.cmd`。忘了起服务时，IDE 会报「连不上代理」或「没有模型」。
2. **Qoder 更新会冲掉所有补丁** —— 升级后重跑 `apply-all.ps1` 即可。
3. **同一时刻只有一个自定义模型在线** —— 模型记录里只写一条，切换上游会覆盖它。

## 已验证环境

Qoder IDE `1.106.3`（Windows 11）+ Node 24。补丁锚点做过抗变量重命名的加固，
换版本后先用 `node scripts/experts-patch.js --dry --root "<原始 bundle 所在目录>"` 确认 8 条都还是「待应用」。

## 详细文档

**[qoder-proxy/README.md](qoder-proxy/README.md)** —— 配置字段逐个说明、8 条补丁的作用与开关、
请求体编解码、工具调用归一化、缓存命中率怎么读、运行日志怎么归类、以及一路踩过来的坑（i18n 错位、
证书信任、连接复用、压缩变量名变更……）。

`qoder-proxy/docs/开发历程与问题记录.md` 记录了方向选择与问题台账，排障时按症状检索更快。
