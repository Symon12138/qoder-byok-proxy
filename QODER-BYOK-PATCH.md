> **⚠️ 这是早期阶段方案的记录，已被取代。**
>
> 本文描述的是"解锁 Qoder 自带的 BYOK 功能"这条路（改 4 处 bundle 放行，让设置页能添加
> 第三方 provider 并直连）。它受限于 Qoder 内置的 15 个 provider 白名单，接不了任意网关。
>
> 后来改走**本地 MITM 代理 + bundle 补丁**的方案，可以接任何 OpenAI 兼容端点。
> 当前方案的完整说明见 `qoder-proxy/README.md`，演进过程见 `qoder-proxy/docs/开发历程与问题记录.md`。
>
> 本文保留是因为它记录的逆向结论（BYOK 链路、checksum 校验机制、内置 provider 列表）仍然有效。
# Qoder IDE — 第三方模型（BYOK）解锁补丁

目标：`D:\Qoder IDE`（Qoder IDE 1.106.3，VS Code 1.106 分支）
效果：解锁「设置 → 模型 → 添加」，可用自有 API Key 接入 Qoder 内置的第三方 Provider。

## 背景（逆向结论）

- Qoder IDE 的 AI 能力在 `resources/app/extensions/aicoding-agent`（渲染层 UI 在 `out/vs/workbench/workbench.desktop.main.js` 与 `out/lingma/agents-window/agents-window.desktop.main.js`）。
- 自定义模型（BYOK）链路：`CustomModelService` → 语言服务器 RPC `model/getByokConfig` / `model/checkByokConfig` → 原生 `Qoder.exe`（Go）直连厂商。
- 你的账号（`personal_standard` / Pro Trial）后端返回 `enabled=false`，把整个 BYOK 功能关掉；同时 `checkByokConfig` 服务端校验会拒绝添加模型。
- 原生层已内置 15 个 provider（bailian、bailian-intl、bailian-america、qwencloud-cn/sg、zhipu(-intl)、kimi、minimax(-intl)、deepseek、xiaomi-china 等），带 `api.openai.com` / `api.anthropic.com` / `dashscope` 直连能力。

## 补丁内容（每个 bundle 4 处，共 2 个 bundle）

| 名称 | 原逻辑 | 补丁后 |
|---|---|---|
| byok-remote-gate | `_applyByokRemoteEnabledFromResponse` 按后端 `enabled` 关闸 | 恒为 `true` |
| byok-config-enabled | 归一化 BYOK 配置时 `enabled: e.enabled ?? true` | 恒为 `true` |
| byok-check-bypass | `checkByokConfig` 走服务端校验 | 直接返回 `{success:true}` |
| byok-model-availability | `_getCustomModelDisabledReason` 会因 provider/model/API Key 判定不可用 | 直接放行 |

改动的文件：

- `D:\Qoder IDE\resources\app\out\vs\workbench\workbench.desktop.main.js`
- `D:\Qoder IDE\resources\app\out\lingma\agents-window\agents-window.desktop.main.js`
- `D:\Qoder IDE\resources\app\product.json`（刷新 2 个 checksum）
- `D:\Qoder IDE\resources\app\featureFlags.json`（刷新 2 个 checksum）

> 只改 JS 会触发启动期完整性校验并弹出「Qoder IDE 安装似乎损坏。请重新安装。」，所以必须同步刷新 `product.json` / `featureFlags.json` 里的 checksums（base64 无填充 SHA-256）。

## 使用

1. 以管理员身份运行 `patch-qoder-byok.ps1`（写入安装目录需要提权）。
2. 以管理员身份运行 `fix-qoder-checksums.ps1`（刷新完整性校验值）。
3. 重启 Qoder IDE → 设置 → 模型 → 添加 → 选 Provider、模型、填 API Key → 保存。
4. 聊天界面模型选择器的「自定义」页即可选用。

## 回滚

以管理员身份运行：
`E:\Project\AI\dsh\_qoder_byok_backup\20261029-110023\revert-qoder-byok.ps1`

（恢复两个 bundle + `product.json` / `featureFlags.json` 原件）

## 限制

- **任意 Base URL 未开放**：本版本添加模型表单只有 Provider/类型/模型/API Key，没有 Base URL 输入框（i18n 串存在但字段由 provider 的 `fields` 驱动，当前 15 个 provider 都是 `predefined`，`customProviderCount=0`）。要接自建网关需要额外注入一个 `source:"custom"` 的 provider 定义，属实验性改动，未验证。
- 模型请求由原生 `Qoder.exe` 直连厂商官方端点，Base URL 取后端下发的 provider 定义；改存储里的 `baseUrl` 不一定生效（未验证到请求层）。
- Qoder IDE 升级会覆盖 `resources/app`，补丁失效，需要重新打。
- 未验证：原生层在真正发请求时是否还会做账号级 BYOK 校验（需要真实 API Key 才能端到端验证）。
