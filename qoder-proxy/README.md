# Qoder IDE 自定义模型代理（任意 OpenAI 兼容端点）

把 Qoder IDE 的自定义模型请求接到你自己的网关，完全绕开 Qoder 服务端的 provider 白名单。

## 架构

```
Qoder IDE ──http.proxy──> 127.0.0.1:8788 (本代理)
                              │
                              ├─ 自定义模型请求 (X-Model-Key: custom_model)
                              │     → 解包 (zstd + 自定义 Base64) → messages
                              │     → POST 你的网关 /chat/completions (stream)
                              │     → 包成 Qoder SSE 信封回给 IDE
                              │
                              └─ 其他请求 → 原样隧道到 api3.qoder.sh

出站方向默认直连；如果外网需要经上游代理转发（例如换号器），
在环境变量 UPSTREAM_PROXY 或 config.upstreamProxy 里填地址即可，
不填就是直连。源码顶部注释里写的 9940 只是作者本机的示例值。
```

## 配置 `config.json`

```json
{
  "upstream": {
    "baseUrl": "https://你的网关/v1",
    "apiKey": "sk-...",
    "model": "你的模型名",
    "reasoningEffort": "high",
    "maxTokens": 8192,
    "temperature": 0.7,
    "topP": 0.95,
    "parallelToolCalls": true,
    "extra": { "任何额外字段": "原样透传给网关" }
  },
  "serveCustomModels": true,
  "customSourceValues": ["custom", "byok"],

  "proxyPort": 8788,
  "ideRoot": "D:\\Qoder IDE",
  "ideProxyPort": 8788,
  "recordId": "model_mocktest",
  "injectTools": true,
  "serveWiki": true,
  "activeProfile": "本地网关",
  "profiles": { "本地网关": { "baseUrl": "...", "apiKey": "...", "model": "..." } }
}
```

- `baseUrl` 支持 `http://` 和 `https://`，必须是 OpenAI 兼容的 `/chat/completions`（SSE 流式）。
- `reasoningEffort`（可选）：固定思考等级。若 Qoder 请求里自带 `reasoning_effort`，以请求为准。
- `maxTokens` / `temperature` / `topP` / `parallelToolCalls`（可选）：透传为同名参数。
- `extra`（可选）：任意对象，原样合并进请求体，用于网关特有参数。
- 改完**无需重启代理**，下一条消息生效（每次请求都会重读 config）。

与代理端口相关的三个字段，容易搞混：

| 字段 | 含义 | 谁写 |
|---|---|---|
| `proxyPort` | 代理监听端口（默认 8788，必须是 1~65535 的整数，非法值会被忽略） | 控制台「系统设置」 |
| `ideProxyPort` | 我们期望 IDE 指向哪个端口，用于被 Qoder 覆盖后自动恢复 | 点「IDE 走代理」时自动写 |
| `profiles` / `activeProfile` | 多套上游，同一时刻只有一套生效 | 控制台「上游配置」 |

改 `proxyPort` 时控制台会顺手把 `settings.json` 里的 `http.proxy` 一起改到新端口 ——
否则 IDE 会指向一个没人监听的端口，表现为 Qoder 静默失联。

## 支持的上游能力

| 能力 | 状态 | 说明 |
|---|---|---|
| 文本对话 | ✅ | messages（`contents[].text` → `content`） |
| 图片输入 | ✅ | `chat_context.imageUrls` → `image_url` 内容块 |
| 思考等级 | ✅ | 请求里的 `parameters.reasoning_effort`，否则用 config |
| 思考内容回显 | ✅ | `delta.reasoning_content` 原样透传，IDE 显示「深度思考」 |
| 输出上限 | ✅ | `config.upstream.maxTokens` → `max_tokens` |
| 上下文窗口 | ✅ | 模型记录 `max_input_tokens`（用同步脚本写入） |
| 工具调用 | ✅ 实测通过 | Qoder 用提示词内工具协议（工具描述在 system prompt，模型按约定输出，LS 解析执行），不需要 OpenAI `tools` 数组 |
| 采样参数 | ✅ | temperature / top_p / parallel_tool_calls / extra |

## 模型记录同步

网关的 `/v1/models` 返回每个模型的 `display_name`、`max_input_tokens`、`max_output_tokens`、`modalities`、`reasoning_levels`、`tool_call`。
用脚本按当前 `config.upstream.model` 自动写回 Qoder 的模型记录：

```powershell
pwsh -File E:\Project\AI\dsh\qoder-byok\sync-qoder-model.ps1
```

会更新显示名、上下文窗口、`is_vl`（是否支持图片）、`thinkingConfig`（等级选项）。改完重启 IDE 生效。

## 多模态（图片）

Qoder 不会把图片塞进请求体，而是**上传到自己的 OSS**，在 `chat_context.imageUrls` 里给出预签名 URL。

代理的处理：
1. 从解包后的 JSON 里取 `imageUrls` 数组；
2. 把**最后一条 user 消息**的 `content` 从字符串转成数组：`[{type:'text',text}, {type:'image_url', image_url:{url}}...]`；
3. 转发给网关（网关需能访问该 URL，公网预签名地址，实测可 GET）。

前提：模型记录里 `is_vl: true`，否则 Qoder 不会附带图片。

实测：粘贴一张写着 `MULTIMODAL 42` 的图，问「图里写了什么」，模型正确回答 `MULTIMODAL 42`。

## 工具调用（agent 能力）

Qoder 不使用 OpenAI 的 `tools` / `tool_calls` 协议。工具定义写在 **system prompt** 里，
模型按约定格式输出调用意图，由 Qoder 的语言服务（`Qoder.exe`）解析并执行，再把结果回填到下一轮消息。

因此代理**不需要**转发 `tools` 数组——实测 payload 里 `tools=0`，agent 仍能正常读写文件。
实测：让它读 `.gitignore`，界面显示「已查看 .gitignore」「已处理 1 个操作」，返回内容与磁盘一致；
读不存在的 `pom.xml` 时返回真实的 `The system cannot find the file specified`。

一轮完整的工具调用会产生多次上游请求（messages 数量递增），代理按普通多轮对话处理即可。

## 思考模式

代理不改写上游返回的 chunk，`delta.reasoning_content` 会原样透传，Qoder 会渲染成「深度思考」折叠块。

实测：`wb/cn:deepseek-v4.1-flash` 有思考内容；`mimo-v2.6-pro` / `glm-5.3` / `kimi-k3.1-pro` 不返回。

思考等级目前通过 `config.upstream.reasoningEffort` 固定（Qoder 界面里的等级选择器未打通，不影响使用）。

## 模型显示

Qoder 模型选择器显示的是模型记录里的 `displayName`（存于 `aicoding.customModels`），与 `config.upstream.model` 无关。
想让界面显示真实模型名，把记录的 `displayName` 改成对应名字即可（设置 → 模型 → 点名称改别名也行）。

## 控制台（推荐入口）

```powershell
node E:\Project\AI\dsh\qoder-byok\qoder-proxy\admin.js
# 打开 http://127.0.0.1:3426
```

页面分 8 个视图（侧边栏切换，`Alt+1~8` 直达，`Alt+B` 收起侧边栏）：

- **状态概览**：4 张状态卡（本地代理 / IDE 代理 / 补丁状态 / 当前模型，5 秒自动刷新）、
  详细信息（代理、Qoder IDE、上游、补丁四组）、快捷操作（IDE 走代理 / 恢复原始 / 切换模型）、
  模型记录、状态同步。环境不完整时顶部出现 4 步引导卡，点「一键完成」按顺序执行。
- **上游配置**：左侧已保存的多套上游（点一行即编辑，可「设为当前 / 删除」），
  右侧表单：名称、BaseURL、APIKey、模型（下拉，末项「手动输入模型 ID」）、显示名、思考等级、
  输出上限 max_tokens、上下文长度、temperature、top_p；下方「测试连通性 / 刷新网关模型」。
  「创建并启用」「保存并生效」= 写回列表 + 立即生效 + 同步模型记录。
- **模型能力**（只读参考）：当前生效模型、上游切换、全部模型列表（搜索 + 能力筛选 + 刷新）。
  切换模型请到「上游配置」，这里不提供入口。
- **补丁管理**：bundle 状态（扫描已安装文件判断补丁在不在）、功能开关（专家团 / RepoWiki）、
  写入 Qoder（应用补丁 / 回滚 / 刷新）、什么时候会失效。
- **日志**：代理 / Agent / 渲染 / 全部，关键字过滤、行数、刷新、清空。
- **系统设置**：工具补全、Wiki 用自定义模型、代理端口、模型记录 ID。
- **维护**：环境状态、导出 / 导入配置、一键修复环境、重启代理、同步模型记录、
  重新运行引导、退出服务。
- **帮助**：功能说明、常见问题、快捷键。

**生效时机**（最容易搞错的一块）：

| 改动 | 什么时候生效 | 为什么 |
|---|---|---|
| 上游模型 / BaseURL / APIKey / temperature / top_p / maxTokens | 下一条消息 | 代理每次请求重读 `config.json` |
| 思考等级 / 输出上限 / 上下文长度 / 显示名 / 图片标记 | **重启 Qoder** | 写进 sqlite 模型记录，Qoder 启动时读 |
| 工具补全 / Wiki 用自定义模型 | 下一条消息 | 代理每请求读配置 |
| 补丁开关（勾选） | 下次「应用补丁」 | 只决定写不写进 bundle |
| 应用补丁 / 回滚 | **重启 Qoder** | 改的是 bundle 里的 JS |
| IDE 走代理 / 恢复原始 | **重启 Qoder** | `http.proxy` 启动时读取并缓存；实测删掉后不重启仍会走代理 |
| 代理端口 | 需点「重启代理」 | 只写配置，不会自动 rebind 监听 |

**思考等级的实际优先级**：Qoder 界面里选的档位 > 模型记录的 `defaultEffortKey`（由控制台同步）
> `config.upstream.reasoningEffort`（请求完全没带档位时兜底）。也就是 Qoder 有选择时以 Qoder 为准，
控制台只负责"新模型的初始默认值"。

**字体**：Fira Sans / Fira Code 的 latin 子集已下载到 `fonts/`（8 个 woff2 + `fira.css`，共 188KB），
由 `admin.js` 以 `/fonts/*` 提供，页面完全不访问外网。中文回退到系统字体（Fira 不含 CJK）。

`IDE 走代理` 在端口没服务时会自动拉起本代理，避免「先设代理再启动」的死结。

### 状态机：操作与撤销必须对称

只摘代理而留着 BYOK 记录，会留下「Qoder 直连后选中自定义模型发不出去」的坏状态。
所以每个正向操作都有对应的反向清理：

| 操作 | 做了什么 | 反操作 / 清理 |
|---|---|---|
| **IDE 走代理** | 写 `http.proxy` + **同步 BYOK 记录** | **恢复原始**（不设代理） |
| **应用补丁** | 写 bundle 补丁 + 重算校验值 | **全部回滚**（还原 bundle + 清 BYOK + 摘代理 + 重开自动更新） |
| **退出服务** | **清 BYOK** → 摘代理 → 停代理 → 关控制台 | 重启控制台 → 点「IDE 走代理」 |

关键实现：`clearByok()`（admin.js）清空 `aicoding.customModels`、
把 `chat.modelConfig.{assistant,experts,quest}` 切回官方值、清 `chat.modelConfig.session.*`。
它在**退出服务**和**全部回滚**前调用。

**回滚后要做什么**：回滚会重新打开自动更新。所以顺序是
关自动更新 → IDE 走代理 → 应用全部补丁 → 重启 Qoder IDE。

**关于多上游**：Qoder 的 `x-model-key` 请求头恒为 `custom_model`，记录 id 从不出现在请求里，
所以代理无法按 IDE 里的模型记录分流——多上游是「存多套、切一套」，
切换时重写 config 里的 upstream，IDE 侧不需要任何改动。

**模型记录**由同步脚本自动维护（显示名、上下文、图片、思考档位），控制台不再提供编辑入口；
上下文长度可在「上游配置」里手动覆盖。

**切换模型做的事**：写 `config.json`（模型、显示名、`maxTokens`=模型输出上限、`reasoningEffort`=当前值或模型支持的第一个档位）
+ 跑 `sync-qoder-model.ps1`（上下文长度、图片、思考能力、档位写入模型记录）。IDE 里显示名 3 秒内自动更新。

### 补丁开关：按功能，不按编号

页面只给 2 个开关，各自控制一组补丁（缺一不可，所以合并）：

| 开关 | 控制的补丁 | 作用 |
|---|---|---|
| `experts` | P4 + P2 | 专家团使用第三方模型（解锁门控 + 模型进列表） |
| `repowiki` | P12 | 解锁 RepoWiki 生成（关掉可省上游额度） |

其余（P1 校验时序、P5a/b/c UI 细节、P6 占位项、P7/P9 合并时机）是内部实现机制，
**不显示、拒绝修改、始终应用**——关掉只会让功能残缺。

开关存 `config.json` 的 `patches` 字段（值为功能名，如 `{"experts":true,"repowiki":false}`）。
命令行 `--only=P1,P4` / `--skip=P12` 优先级高于配置文件（ID 见下方补丁清单）。

**注意**：勾选只决定「下次应用补丁时写不写这条」，要立刻生效需点**应用全部补丁**。

## 实时模型名

两个改动配合：
1. `workbench.html` / `agents-window.html` 的 CSP `connect-src` 增加 `http://127.0.0.1:8788`；
2. `CustomModelService` 构造里加 3 秒轮询 `http://127.0.0.1:8788/state`，把记录 `displayName` 改成当前上游显示名并触发 `onDidChangeModels`。

效果：`config.json` 改 `displayName` → IDE 模型选择器/输入框底部 3 秒内自动变，不用重启。

## 请求体编解码（关键，别再踩坑）

Qoder 的请求体是 **`zstd(自定义编解码(json))`**，自定义编解码不是普通 base64：

```
1) 标准 base64 编码 JSON          → std
2) 三段轮转：a = len(std)/3
   rearranged = std[len-a:] + std[a:len-a] + std[:a]
3) 逐字符映射到自定义字母表；'=' 映射成 '$'
```

字母表（64 字符，在 `Qoder.exe` 里也能找到）：

```
_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!
```

参考实现：[qoder2api `internal/cosy/encoding.go`](https://github.com/Zhengyuuuui/qoder2api/blob/main/internal/cosy/encoding.go)。

**不实现第 2 步会怎样**：解出来像是「从 JSON 中间开始」，开头约 100 字符丢失、messages 数组不闭合。
之前用「猜字符偏移 + 猜位偏移」硬对齐，最大只能到 99% 可打印且 JSON 解析失败。

**`$` 是填充符**（等价于 `=`），当成未知字符跳过会导致其后全部错位。

## 用户提问在哪（专家团 vs 普通对话）

普通对话的 `messages` 里 user 条目带真实内容；**专家团的 `messages` 里 user 条目 content 全是空串**，
真正的提问在顶层 `chat_context.text`（`chatPrompt` 字段通常也是空）。

只转发 `messages` 的话，上游会收到一串空消息，模型只能回 `What would you like help with?`。
代理里的 `fillExpertPrompt()` 负责用 `chat_context.text` 回填最后一条空 user 消息，并清掉其余空消息。

实测效果：专家团一轮对话 `chunks=175 characters=947`，正常返回。

## 代理自测（不需要 IDE）

`E:\Project\AI\dsh\qoder-byok\mitm-test.js` —— 用 qoder 编码器构造真实请求，经 HTTP CONNECT 隧道打到本代理，
直接验证「解码 → 提取 → 转发上游 → SSE 封包」整条链路：

```powershell
node mitm-test.js --text "只回复：OK"                      # 文本
node mitm-test.js --text "这图什么颜色？" --image x.b64     # 多模态（纯 base64 文件）
```

实测（2026-10-30）：文本回复「OK」、纯红图回复「红色」、错误映射 5/5 通过。

## 图片与错误映射

**图片有两个来源**，代理两条都读：

1. `chat_context.imageUrls`（Qoder 把附件传到 OSS，给预签名 HTTPS URL）
2. `messages[].contents[]` 里的 `{type:"image_url", image_url:{url}}` 部件
   （官方实现见 [qoder2api `internal/bridge/messages.go`](https://github.com/Zhengyuuuui/qoder2api/blob/main/internal/bridge/messages.go)）

两者都会转成 OpenAI 的 content parts（图片在前、文本在后），随请求发给上游。

## RepoWiki 使用第三方模型

RepoWiki 的生成在 **Go 语言服务（`Qoder.exe`）** 里跑本地 agent，不经过渲染进程发 HTTP。
渲染层只发 `startWikiGeneration` 给 LS，LS 再走 `agent_chat_generation`
（`AgentId=deepwiki_generate`，请求体 `session_type:"wiki"`、`task_id:"deepwiki_generate"`）
——**和专家团、普通对话是同一个拦截点**。

要让 wiki 用自定义模型需要三件事：

1. **P12（`experts-patch.js`）**：把 `fge.shouldShowCommercialMessage` 改成恒 `false`，
   去掉「你当前的版本无法生成 Repo Wiki + 升级订阅计划」的拦截，生成按钮才会正常渲染。
   （按钮不会被禁用，配额为 0 时只是文案变成「生成」并请求 Credits）
2. **代理识别 wiki 任务**：`forward()` 里对 `session_type:"wiki"` 强制走 custom 路径
3. **别把 wiki 误判成内部任务**：`isInternalTask()` 有一条
   「`model_config` 为空即内部任务」的规则，而 wiki 的 `model_config` 恰好为空
   （它不指定模型，走默认 `auto`），会被误判走隧道。已在函数开头排除 wiki。

入口：活动栏（左侧图标栏）的 **Repo Wiki** 图标 → 选语言 → 「生成」；
中途变 PAUSED 时点「继续」恢复。

**实测状态（2026-10-30，已完整跑通）**：

```
WIKI_INIT → INITIALIZING → DIRECTORY_GENERATING → DOCUMENT_GENERATING → 完成
```

| 阶段 | 结果 |
|---|---|
| UI 门控（P12） | ✅ 去除，生成按钮可用 |
| `wiki/queue` / `wiki/finish` | ✅ 全部 200，服务端不拒绝 |
| 模型接管 | ✅ 100+ 次 `custom-serve`，全走自定义模型 |
| 目录生成（`deepwiki_catalog_generate`） | ✅ 产出 `meta/repowiki-metadata.json`（约 1MB，52 章节） |
| 文档生成（`deepwiki_content_generate`） | ✅ 产出 `content/` 下 18 篇 Markdown（约 2.3MB） |
| 日志错误 | ✅ 无 |

**踩过的四个坑（都已修）**：

1. **被误判成内部任务**：`isInternalTask()` 有「`model_config` 为空即内部任务」的规则，
   而 wiki 的 `model_config` 恰好为空（它不指定模型，走默认 `auto`），导致走隧道不接管。
2. **额外工具污染**：wiki 自带 7 个检索工具（`search_codebase`/`list_dir`/`read_file` 等），
   我们又注入了 Write/Bash 等 5 个，干扰了模型。已改为 wiki 不注入。
3. **多轮工具调用链断裂**（主因）：`extractMessages()` 原本只取 `content`，丢掉了 assistant 的
   `tool_calls` 与 tool 结果的 `tool_call_id`/`name`。wiki 目录生成是 20 条消息的多轮工具链，
   丢了就崩。已保留完整字段。
4. **排障时自己的采样串扰**：wiki 会并发发多个 `agent_chat_generation`，
   采样若用全局变量会把多个流的内容混在一起，看着像「模型输出错乱」。已改为按请求隔离。

**开关**：控制台「系统设置」里有 **Wiki 用自定义模型** 开关，切换后立即生效（无需点保存），
对应 `config.json` 的 `serveWiki`。也可直接编辑配置：

```json
"serveWiki": false
```

关闭后 wiki 生成走官方模型（目录/文档阶段失败时会重试并大量调用模型，
关掉可避免白耗上游额度）。默认开启。

代理侧 `cfgServeWiki()` 每次请求实时读 `config.json`，所以控制台改完无需重启代理。


**上游错误映射**：上游返回 JSON 错误时**没有 SSE 的 `data:` 行**，原样转发会让客户端收到空流，
界面只显示 `llm_return_empty`，完全看不出原因。现在按四类映射（语义参考 qoder2api `errors.go`）：

| 上游状态 | 映射后 code | 含义 |
|---|---|---|
| 401 / 403 | `auth_error` | 鉴权失败 |
| 429 | `rate_limited` | 限流，可稍后重试 |
| 含审核关键词的 400 | `content_policy_rejected` | 内容审核拒绝，重试无效 |
| 5xx | `upstream_transient_error` | 临时故障，可重试 |
| 其他 4xx | `upstream_error` | 带原始状态码与上游 message |

## ⚠️ Qoder 更新会冲掉全部补丁（必读）

Qoder 自动更新时会**覆盖 `out/vs/workbench/*.js` 与 `out/lingma/agents-window/*.js`**，
所有补丁（P1–P12）被还原成官方原始版本，`.bak-experts-*` 备份也会被清掉。

**表现**：某天突然发现模型名显示不对、专家团选不到自定义模型，或 RepoWiki 又出现
「你当前的版本无法生成 Repo Wiki + 升级订阅计划」。

**排查**：看 bundle 修改时间是否晚于打补丁的时间：

```powershell
Get-Item 'D:\Qoder IDE\resources\app\out\vs\workbench\workbench.desktop.main.js' |
  Select-Object LastWriteTime
```

**修复**：补丁脚本幂等，重跑即可（会关闭 Qoder，跑完手动重开）：

```powershell
node E:\Project\AI\dsh\qoder-byok\experts-patch.js --dry   # 先看哪些待应用（0 处 = 已应用）
node E:\Project\AI\dsh\qoder-byok\experts-patch.js          # 需要管理员权限
```

之后必须重跑 `fix-qoder-checksums.ps1`（`apply-all.ps1` 会自动做）。

> **注意**：不要指望「关掉自动更新」来避免——实测 Qoder 每次启动都会把它重置为 `true`
> （见「自动更新（Qoder 会强制重置，注意）」）。真正的防线是**发现症状后重打补丁**。
> 当前版本已是最新时（代理日志查到 `1.38.0`，与已安装一致）不会真的更新，补丁是安全的。

## 工具能力边界（实测）

Qoder 当前给模型的工具清单是**只读**的：

```
SwitchMode, CreatePlan, createGoal, updateGoal, getGoal, CallMcpTool, Glob, Read, SearchCodebase
```

没有 `Write` / `Edit` / `Bash`。实测：
- 让 agent 读 `.gitignore` → 成功（`已查看 .gitignore`，内容与磁盘一致）
- 让 agent 写文件 + 跑终端 → 模型明确回答「没有可用的写操作工具」，磁盘无变化

所以写/终端是 Qoder 的产品门控，代理层补不出来（请求里就没有这些工具定义）。

## 工具补全（Write / Bash / DeleteFile …）

实测发现：Qoder 只在部分轮次下发完整工具表（抓到过 28 个工具，含 `Write`、`Bash`、`GetTerminalOutput`、
`DeleteFile`），普通提问只给 4–10 个只读工具；而这些写类工具的说明**写在 system prompt 里**，
模型看得见却没有对应 schema，于是会回答「没有可用的写操作工具」。

代理侧的补法：`tools-extra.json` 里存这几个工具的 schema，转发时按名字合并进 `tools`
（已存在的跳过，不重复）。开关是 `config.json` 的 `injectTools`（默认 true）。

```json
{ "injectTools": true }
```

代理日志会打印 `tools` 和 `tools_injected`，可据此确认是否生效。

**实测通过（Bash）**：

- 代理日志：`tools: 5, tools_injected: 5`
- 语言服务收到真实调用：`{"command":"echo hello","command_names":["echo"],"cwd":"e:\\Project\\NcbProject\\bte","has_risk":false,"run_mode":"autoReview","timeout":18000}`
- 终端执行：`exitCode=0`，耗时 104ms，`tool_call_update` 回传
- 界面显示真实 PowerShell 输出：`PS E:\Project\NcbProject\bte> echo hello` / `hello`

参数名 `command` / `command_names` / `has_risk` / `is_background` 与 `tools-extra.json` 里作者写的 schema 完全一致，
说明 LS 按名字接受并校验了我们补充的工具定义。

**实测通过（Write）**：让它「在项目根目录创建 _agent_tooltest/hello.txt，内容写 hello-from-agent」，
磁盘上真实出现该文件（18 字节，内容一致），日志 `applyFileEdit completed` / `status=APPLIED`。
同一轮里它还先用 Bash 执行了 `New-Item -ItemType Directory -Force -Path ...` 建目录，
说明写文件和终端两类可以连续调用。

## 工具调用格式归一化

上游返回的 `delta.tool_calls` 如果 `arguments` 是对象（部分模型会这样），Qoder 的解析器会拒收。
代理在转发每个 chunk 前统一处理：`arguments` 一律转成 JSON 字符串，`type` 缺省补 `function`。
文本 chunk 不受影响。

## 专家团（已打通）

模型列表来自 `aicoding.modelConfigs.cache.experts`，但 **Qoder 启动时会用服务端的模型表整体覆盖它**
（日志 `Model classes refreshed`），所以单纯注入存储条目会被冲掉。

关键点：**聊天面板跑在 `workbench.desktop.main.js` 里**，不是 `agents-window` 那个 bundle。
两个 bundle 都要打补丁，且压缩变量名不同：

| 补丁 | agents-window | workbench |
|---|---|---|
| A `refreshModelConfigs` | `dgl` | `Yfl` |
| B `model/refresh` 通知循环 | `wnt` | `_nt` |
| C `_persistModelConfigsCache` | `dgl` | `Yfl` |
| P1 存在性校验 | `Tce` | `Pce` |
| P4 BYOK 门控 | `HY` | `jY` |

```powershell
# 都需要管理员
powershell -ExecutionPolicy Bypass -File E:\Project\AI\dsh\qoder-byok\patch-qoder-experts-refresh.ps1
node E:\Project\AI\dsh\qoder-byok\patch-wb-experts.js     # 主 bundle 的 P1/P4/P5
node E:\Project\AI\dsh\qoder-byok\patch-wb-p5b.js         # 主 bundle 的 P5b（3 处）
```

实测：专家团下拉出现 `deepseek-v4.1-flash`，选中后 `chat.modelConfig.experts = custom:model_mocktest` 落库。
`cache.experts` 从 6 条变 7 条（合并去重，不重复累积）。

## 项目结构

```
qoder-byok/
├─ experts-patch.js          8 条 bundle 补丁，每条独立可关；备份自动轮转
├─ apply-all.ps1             提权应用：8 步流水线，先校验两个 bundle 再逐条打
├─ revert-all.ps1            提权回滚：反向替换，不依赖备份文件
├─ fix-qoder-checksums.ps1   修 product.json / featureFlags.json 的校验和
├─ sync-qoder-model.ps1      把网关模型能力写进 Qoder 的 sqlite 模型记录
├─ run-experts-patch.ps1     apply-all 的中间层：找 node、读配置
├─ mitm-test.js              不经 IDE 的端到端自测：构真实请求 → 隧道 → 解析 SSE
├─ QODER-BYOK-PATCH.md       早期"解锁 Qoder 自带 BYOK"方案的记录（已被取代）
├─ .gitignore                白名单式（先忽略全部，再逐个放行）
└─ qoder-proxy/
   ├─ proxy.js               MITM 代理（8788）：解包 → 转发网关 → 包回 SSE 信封
   ├─ admin.js               控制台后端（3426）：27 个端点 + 三个自愈守卫
   ├─ certs.js               证书自举：缺失时用 openssl 现场生成 CA + 签证书
   ├─ admin.html             控制台外壳
   ├─ index.html             入口页
   ├─ config.json            运行时配置（含明文 apiKey → 不入库）
   ├─ ca.crt / ca.key        MITM 用的本地 CA（私钥不入库）
   ├─ leaf.crt / leaf.key    api3.qoder.sh 的签证书（私钥不入库）
   ├─ ext.cnf                leaf 证书的扩展配置
   ├─ tools-extra.json       工具补全用的额外工具定义
   ├─ icon.svg / icon-192.png  站点图标
   ├─ src/                   零依赖前端（原生 ES Modules，无构建步骤）
   │  ├─ main.js             启动、全局快捷键、视图挂载
   │  ├─ router.js           路由（Alt+1~8 直达）
   │  ├─ store.js            状态管理 + 5 秒轮询（输入时跳过）
   │  ├─ api.js              请求封装，按端点设超时
   │  ├─ components.js       UI 组件 + 全站唯一的 esc()
   │  ├─ event-manager.js    事件委托
   │  ├─ base-view.js        视图基类
   │  ├─ view-bind.js        视图数据绑定
   │  ├─ toast.js            操作提示条
   │  └─ views/              8 个视图：概览 / 上游 / 模型能力 / 补丁 / 日志 / 设置 / 维护 / 帮助
   ├─ styles/                设计令牌 → 布局 → 组件（tokens / layout / components / base）
   ├─ fonts/                 Fira Sans/Code 的 latin 子集（8 个 woff2 + fira.css，188 KB），不走外网
   ├─ docs/
   │  └─ 开发历程与问题记录.md   方向选择、问题台账、验证方法学（回看用）
   ├─ _rt/                   回归脚手架：lib + p1~p4 + 多上游 + 文档一致性 + 界面冒烟
   └─ _regress/              历史回归产物（截图/JSON，不入库）
```

代码规模（按行）：`admin.js` 1177、`proxy.js` 905、`experts-patch.js` 191、
`src/` 9 个文件 3771、`styles/` 4 个文件 1562。

**入库与不入库**：`.gitignore` 用白名单，只放行源码与文档。
以下只在本地存在、不进版本库 —— `config.json`（明文 apiKey）、`ca.key` / `leaf.key`
（CA 私钥泄漏等于任何人都能伪造任意站点）、`proxy.log*`、`bodies/`、`_regress/`、
`_qoder_byok_backup/`（约 2.9 GB 的原始 bundle 快照，`revert-all.ps1` 的兜底来源）。

## 目录无关性（可以整体搬动）

整个 `qoder-byok/` 目录搬到哪都能用，不依赖它所在的位置，也不依赖你从哪个目录启动。
两类位置依赖都已消除：

| 依赖类型 | 处理方式 |
|---|---|
| 启动时的工作目录（`cwd`） | 代码里**没有一处** `process.cwd()`；配置、日志、采样、证书全部按 `__dirname` 定位 |
| 脚本里的绝对路径 | `.ps1` 用 `$PSScriptRoot`，`.js` 用 `__dirname`，不再写死盘符 |

实测（把服务的工作目录设成 `C:\` 后启动）：

```
控制台   Qoder BYOK console: http://127.0.0.1:3426
代理     proxy listening on 127.0.0.1:8788 -> direct
状态接口 补丁 4/4、代理在运行、安装目录 D:\Qoder IDE 正常识别
文件落点 proxy.log 与 bodies/ 仍写在项目内，C:\ 根下无任何残留
端到端   mitm-test 状态 200，custom-serve-end sawFinish=true
脚本     apply-all.ps1 / run-experts-patch.ps1 从 C:\ 调用可正确定位兄弟脚本
```

`config.json` 里唯一带盘符的字段是 `ideRoot`（**被改的 Qoder 装在哪**，不是本项目在哪）。
它会按「配置 → 缓存 → 常见路径 → 进程」四步自动探测，Qoder 换盘也能自己找到。

## 启动

```powershell
# 1. 起代理
node E:\Project\AI\dsh\qoder-byok\qoder-proxy\proxy.js

# 2. 让 IDE 走代理（IDE 设置 → 高级 → 代理 → 手动 → http://127.0.0.1:8788，
#    或直接改 %APPDATA%\Qoder\User\settings.json 里的 "http.proxy"）
```

重启 IDE 生效。**代理不运行时 IDE 会断网**，所以停用时应走「退出服务」或「恢复原始（不设代理）」，
它会正确地把 `http.proxy` 删掉并清掉 BYOK 记录（不要手动改成某个别的地址——早期文档里的 9940
是已不存在的端口，改过去会直接断网）。

## 证书信任（必须做，否则 Qoder 连不上代理）

代理要给 `api3.qoder.sh` 出示自己签的证书，Qoder 必须认这张 CA。

**方式 A：在控制台点一下（推荐）**

「维护 → 环境状态」里如果显示 `代理证书 未信任`，会有一个 **信任证书** 按钮。
点它之后 Windows 会弹一个「安全警告」框，选 **是** 即可 —— 不需要管理员权限。
「状态概览」的首次引导卡里也有同一个按钮。

装完之后状态会变成 `已信任`，重启 Qoder 生效。

> 实现细节（踩过坑）：这一步**不能同步执行**。`certutil -user -addstore` 会一直等到用户点完
> 弹窗才返回，如果用 `spawnSync` 就会把整个控制台卡死（状态轮询、页面操作全停）。
> 所以服务端是后台起进程、立刻返回，前端每 2 秒查一次 `/api/cert` 直到 `trusted` 变 true。

**方式 B：命令行（与控制台等价）**

```powershell
certutil -user -addstore Root "<项目路径>\qoder-proxy\ca.crt"
```

同样会弹确认框，选「是」。`-user` 表示只影响当前用户，不需要管理员。
卸载：`certutil -user -delstore Root <指纹>`（删除同样会弹框），
指纹用 `certutil -user -store Root | findstr Qoder` 查。

**方式 C：让 Qoder 跳过证书校验**

编辑 `%USERPROFILE%\.qoder\argv.json`，加一行 `"ignore-certificate-errors": true`，重启 IDE。

⚠️ 两个坑（都是实测踩到的）：

- **argv.json 会被 Qoder 重写**。本机就发生过：曾经写过这一行，后来 Qoder 自己刷新 argv.json
  （写 crash-reporter-id 之类）时把它丢了 —— 所以别假设"写过一次就永久有效"，
  怀疑证书问题时先打开看一眼现在还在不在。
- 早期版本的这份文档写着「不需要往系统根证书区装 CA」，**那是错的**。本机实际生效的是方式 A
  （CA 确实在 `Cert:\CurrentUser\Root` 里），argv.json 里当前没有那一行。

## 新环境部署（从 clone 到能用）

克隆下来只有 67 个源码文件，下面这些必须由本机补齐 —— 前两项代理启动时**会自动处理**：

| # | 需要什么 | 谁负责 |
|---|---|---|
| 1 | `ca.key` / `leaf.key` / 两个证书 | **自动**：首次启动代理时用 openssl 现场生成（缺了会提示装 Git for Windows） |
| 2 | `bodies/` 采样目录 | **自动**：启动时 `mkdir -p` |
| 3 | CA 被系统信任 | **点一下**：控制台「维护 → 信任证书」→ Windows 弹窗点「是」（见上一节） |
| 4 | `config.json`（上游地址 / API Key / 模型） | 手动：没有也能启动，控制台会走首次引导，填完即生效 |
| 5 | Qoder IDE 本体 | 手动：装好即可，控制台会自动探测安装目录 |
| 6 | 管理员权限 | 手动：仅在「应用补丁 / 回滚」时需要（改 bundle 与 checksum） |
| 7 | `_qoder_byok_backup/` | 可选：只有 revert 的反向替换失效时才会拿它兜底 |

一句话概括：**clone → 装 Git for Windows（提供 openssl）→ 起代理（自动生成证书）→
信任 CA → 起控制台填上游 → 应用补丁（管理员）→ 让 IDE 走代理 → 重启 Qoder**。

## 自动更新（Qoder 会强制重置，注意）

实测结论：**Qoder 每次启动都会把自动更新重新打开**，所以这个设置关不掉：

| 场景 | `app.configAdvancedAutoUpdate` |
|---|---|
| Qoder 关闭时通过本工具关闭 | `false` ✅ 写入成功 |
| 启动 Qoder 之后 | 被重置为 `true` ⚠️ |

也就是说「关闭自动更新」只在 Qoder 关闭期间有效，无法持久生效。这是 Qoder 的自我保护行为。

**应对方式**（已验证）：只要当前版本已是最新（代理日志里查询的是 `1.38.0`，与已安装一致），
就不会真的下载更新，补丁也不会被冲掉。真正需要担心的是 **Qoder 发布了新版本**——那时它会更新
并覆盖补丁，症状是：模型名不对 / 专家团选不到自定义模型 / RepoWiki 又提示「无法生成」。

**发现被冲掉后怎么办**：在「高级 · 维护」点**应用全部补丁**，或跑 `experts-patch.js --quest`，然后重启 Qoder。
详见「⚠️ Qoder 更新会冲掉全部补丁（必读）」。

相关文件：

- `%APPDATA%\Qoder\User\settings.json` → `app.configAdvancedAutoUpdate`
- `%APPDATA%\Qoder\User\app.json` → `config.advanced.autoUpdate`
- 备份文件：`*.bak-noautoupdate`

## 补丁清单（experts-patch.js）

移植自 [wqzhellohhwy/qoder-experts-enable](https://github.com/wqzhellohhwy/qoder-experts-enable)，
并针对本版本做了重构与扩展。**10 条，每条独立生效、互不依赖**（早期的 P8/P10/P11 是对其他补丁产物的
二次改写，已删除；场景集合改为在生成时就写死）。

| 补丁 | 作用 | 可否关 |
|---|---|---|
| P1 | 自定义模型存在性校验恒通过（消除初始化时序竞态） | 否（内部） |
| P4 | 解除专家团模式的 BYOK 门控 | 是（随 `experts`） |
| P5a/b/c | 专家团下显示 custom 列表 / 标签页 / 真实模型名 | 否（内部） |
| P6 | 不再产生 id 占位项 | 否（内部） |
| P13 | 模型可用性判定放行自定义模型（否则每次启动被重置成默认模型） | 否（内部，但缺了它模型选择会丢） |
| P12 | 去掉 RepoWiki「当前版本无法生成」的商业门控 | 是（`repowiki`） |

用法：

```powershell
node E:\Project\AI\dsh\qoder-byok\experts-patch.js --dry              # 只看哪些待应用（0 处 = 已应用）
node E:\Project\AI\dsh\qoder-byok\experts-patch.js                    # 应用
node E:\Project\AI\dsh\qoder-byok\experts-patch.js --only=P1,P4       # 只应用指定几条
node E:\Project\AI\dsh\qoder-byok\experts-patch.js --skip=P12         # 跳过指定几条

\`--quest\` 是历史开关，现在无任何作用（自定义模型改由 Qoder 原生「自定义」分组承载，
已经没有按场景注入的补丁了），传了也不会报错。
```

之后必须重跑 `fix-qoder-checksums.ps1`（`apply-all.ps1` 会自动做）。

备份文件是 `<bundle>.bak-experts-<时间戳>`，每个 bundle 只保留最近 1 份 ——
早期没有轮转，13 次应用堆了 1.4 GB。回滚并不依赖这些备份（revert 是反向替换补丁），
它们只用于灾难恢复。

**场景枚举名（如 `un` / `on`）会随 Qoder 版本变化**，脚本从 bundle 动态探测并打印，不要硬编码——
早期写死 `un.EXPERTS` 曾导致某次更新后合并判断恒为 false、补丁静默失效。

补丁开关在控制台「补丁项」里按功能给出（`experts` / `repowiki`），见上文「补丁开关：按功能，不按编号」。

### 关键坑（实测）

- `chat.modelConfig.experts` **不能手写**——设成任何非 `experts-auto` 的值（含系统自带 `gmodel`）
  都会让 `workbench.contrib.modelConfig` 崩溃（`t.startsWith is not a function`），界面报 `Something went wrong`。
  只能由 UI 自己写（或让 `clearByok()` 统一恢复）。
- `aicoding.modelConfigs.cache.experts` 注入条目会因 schema 不匹配导致
  `failed to parse cached model configs`，且启动时被服务端覆盖 —— 不要走这条路。正确做法是运行时合并，不碰数据库。
- 专家团是多角色编排，它发给模型的是规划类提示词；普通对话模型可能按字面回答，
  出现「正在处理…」卡住或答非所问。链路（选中 → 发请求 → 走代理）是通的，编排行为取决于模型本身。


## 已验证链路

- IDE 发出的自定义模型请求：`POST api3.qoder.sh/algo/api/v2/service/pro/sse/agent_chat_generation`
- 请求头：`X-Model-Key: custom_model`（`X-Model-Source` 为空）
- 请求体：`zstd` 压缩 + 自定义 Base64（字母表 `_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!`）
- 解出后是 Qoder 的请求 JSON：`messages[].contents[].text` 为正文
- 回包格式：`data:{"headers":{"Content-Type":["application/json"]},"body":"<OpenAI chunk>","statusCodeValue":200,"statusCode":"OK"}\n\n`

实测：代理把 12 条消息（含完整系统提示）发给本地 mock，mock 返回 `MOCK_OK`，IDE 正常接收并在下一轮把该回复带入历史。

## 自愈守卫（后台定时检查）

Qoder 会在退出时把它内存里的 settings / 模型状态整份写回，覆盖掉我们写的东西。
与其和它抢，不如定期核对并补回。控制台里跑着三个定时器：

| 守卫 | 周期 | 做什么 | 触发条件 |
|---|---|---|---|
| 代理存活 | 15 秒 | IDE 指向本代理但端口没在监听时自动拉起 | `http.proxy` 匹配且端口不通 |
| 场景绑定 | 20 秒 | `chat.modelConfig.assistant` / `.experts` **整行不存在**时补回 `custom:<recordId>` | 只补缺失的行，已有值一律不动 |
| http.proxy | 30 秒 | `config.ideProxyPort` 有值但 settings.json 里的指向丢了，补回去 | 只补丢失的指向 |

外加磁盘卫生（启动后 20 秒跑一次，之后每 30 分钟）：
`bodies/` 只留最近 400 个采样文件；`proxy.log` 超过 20 MB 滚动成 `proxy.log.1`。

设计原则：**只补"缺失"，不覆盖"已有"**。用户主动把模型切回官方（值是 `auto`）、
主动点「退出服务」清掉代理指向，守卫都不会插手 —— 因为那时对应的标记也一起清掉了。

## 已知限制

- **同一时刻只有一个自定义模型在线**：Qoder 的模型记录里只有一条（默认 `model_mocktest`），
  切换上游会覆盖它。控制台可存多套上游，但不是多个模型并行（见「常见问题」第 9 条）。
- **代理/控制台进程偶发退出**：现在有两层自愈（见「自愈守卫」），仍失效时重新点「IDE 走代理」。
- **上游排队**：`queue.full` / `queue.waiting` 是网关侧排队，换模型即可。
- **Qoder 升级会冲掉补丁**：需重跑 `apply-all` 或 `experts-patch`，平时关闭自动更新（见「必读」章节）。
- **场景枚举名随版本变化**：脚本动态探测，不要硬编码。
- **控制台没有 token 鉴权**，只监听 127.0.0.1，并用 `Origin` 校验挡掉浏览器跨站请求。
  本机上以命令行方式调用不受限制（这是刻意的，方便脚本化）。
- **单块超大内容会拆成 64KB 转发**：上游若在一个 SSE data 里塞 8MB，Qoder 会因单条消息过大
  在持久化环节报 `ENOSPC`（磁盘其实还有空间）。代理现在把超过 64KB 的 delta 切片转发。
  极端情况下（8MB 单块）代理自身 RSS 会冲到约 690MB，正常使用不会遇到。

已不再是限制（此前记录、现已实现）：图片/多模态（两个来源都转 OpenAI content parts）、
工具调用（透传 + 补全 + 格式归一化）、多轮工具链（`tool_calls` / `tool_call_id` 完整保留）。
