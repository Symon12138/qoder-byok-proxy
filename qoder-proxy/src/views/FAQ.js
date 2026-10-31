/**
 * Qoder BYOK 控制台 - 帮助
 */

import { state, subscribe } from '../store.js';
import { Card, Icon, KVList, Badge, SectionTitle } from '../components.js';
import { bindAll, unbindAll } from '../view-bind.js';

const STEPS = [
  { t: '配置上游', d: '在「上游配置」填 Base URL、API Key，从下拉里选模型' },
  { t: '应用补丁', d: '在「补丁管理」点「应用补丁」，需要管理员权限，Qoder 会被关闭' },
  { t: 'IDE 走代理', d: '在「状态概览」点「IDE 走代理」，把 IDE 指向本地代理' },
  { t: '重启 Qoder', d: '重启后即可在 IDE 里看到并使用第三方模型' },
];

const QA = [
  {
    q: '如何切换模型？',
    a: '去「上游配置」，点当前生效的那套配置，在「模型」下拉里选一个，保存即生效。模型清单、上下文长度、思考等级都由「模型能力」页对比查看。',
  },
  {
    q: '补丁应用失败怎么办？',
    a: '先确认 Qoder 已完全退出（任务管理器里没有 Qoder 进程）。补丁需要管理员权限，UAC 弹窗要点「是」。仍失败时看「日志」页的报错，或先「回滚全部补丁」再重新应用。',
  },
  {
    q: '代理连不上怎么办？',
    a: '「状态概览」看本地代理是否「运行中」。端口被占用时可在「系统设置」改端口，然后到「维护」点「重启代理」。IDE 侧要确认 http.proxy 已指向 127.0.0.1:端口。',
  },
  {
    q: '模型名显示不对 / 专家团选不到自定义模型？',
    a: '这是 Qoder 自动更新把补丁冲掉了。Qoder 每次启动都会把自动更新重置为开启，关不掉。到「补丁管理」重新应用补丁，再重启 IDE 即可。',
  },
  {
    q: '怎么备份配置？',
    a: '「维护」页点「导出配置」存为 JSON；恢复时用「导入配置」。导出内容包含 API Key，注意保管。',
  },
  {
    q: '支持哪些模型？',
    a: '任何兼容 OpenAI /v1/chat/completions 的服务都行：OpenAI、Anthropic 兼容层、各类国产大模型、vLLM / Ollama / LiteLLM 等自建网关。',
  },
  {
    q: '上游挂了，IDE 里什么都不显示？',
    a: '以前是这样：Qoder 不认识代理发回去的自定义错误码，于是静默吞掉，界面只留你那条消息。现在代理会合成一条普通助手消息把错误写进对话——连不上、超时、HTTP 4xx/5xx、返回空流、输出到一半断流，都会显示「⚠️ ...」并附带处置建议。看到提示就按提示查上游，别以为是网络问题。',
  },
  {
    q: '中文回复里偶尔出现方块或乱码？',
    a: '这是按 TCP 分片逐块解码 UTF-8 造成的老问题：一个汉字 3 字节，被切在两块之间时会在边界产生替换字符。已改成用 StringDecoder 跨块拼字节。如果还见到方块，多半是上游本身返回了坏字符，可在「日志」页看原始响应。',
  },
  {
    q: '模型选择器里的自定义模型自己消失了？',
    a: 'Qoder 会把模型选择存在内存里，状态变更时整份写回 sqlite；当它认为"选中的模型不存在"，写回时这一项就是空值，整行被删掉。控制台每 20 秒检查一次，只在**整行不存在**时补回 custom:<recordId>，已有值（包括你手动选的官方模型）一律不动。',
  },
  {
    q: '用完之后关掉 Qoder，再打开就上不了网了？',
    a: 'Qoder 退出时会把它内存里的 settings 整份写回 settings.json，可能把 http.proxy 抹掉（表现为所有请求不再经过代理）。控制台每 30 秒核对一次，丢了就补回去（实测 8 秒内恢复）。只有你主动点「退出服务」时才不补——那时对应的标记一起清掉了。',
  },
  {
    q: '改了代理端口之后 Qoder 连不上了？',
    a: '端口一改，settings.json 里的 http.proxy 还指向老端口，等于指向一个没人监听的地址。现在保存端口时会自动把 http.proxy 同步到新端口。如果是手工改的 config.json，去「状态概览」点一次「IDE 走代理」也能修好。端口只接受 1~65535 的整数，非法值会被忽略并保持原值。',
  },
  {
    q: '磁盘被占满 / bodies 目录越来越大？',
    a: '代理每处理一条对话会在 bodies/ 落 3 个采样文件（原始包、解码文本、SSE 响应），长时间使用会累积。控制台启动 20 秒后跑一次清理、之后每 30 分钟一次：bodies/ 只留最近 400 个，proxy.log 超过 20MB 滚动成 proxy.log.1（只留一份历史）。手动清空 bodies/ 也安全，只是以后排障少了样本。',
  },
  {
    q: '点「同步模型记录」没反应，或改了名字 IDE 里还是旧的？',
    a: '检查模型名/显示名里有没有单引号（比如 "Bob\'s model"）。早期 SQL 是字符串拼接、没做转义，一个单引号就会让整条 UPDATE 解析失败，而且**静默**不报错。现在所有拼进 SQL 的值都过 sqlLit() 转义了。若仍异常，看「日志」页有没有 sync 的报错。',
  },
  {
    q: '上游一次吐了超长内容，Qoder 报 ENOSPC（磁盘其实还有空间）？',
    a: '这是单条消息体量过大触发的：实测上游在一个 SSE data 里塞 8MB，Qoder 能渲染但持久化时会报 "Disk quota exceeded or disk is full"，那一轮直接失败。代理现在把超过 64KB 的 delta 切成多片转发，和真实上游的流式行为一致。',
  },
  {
    q: '补丁应用完成了，但日志里中文是乱码？',
    a: '子脚本有的是 node（UTF-8 输出）、有的是 powershell（GBK 输出），混在一起就花了。apply-all.ps1 现在统一把控制台输出编码设成 UTF-8。历史日志里的乱码不影响功能，只影响阅读。',
  },
  {
    q: '能同时挂多个上游吗？怎么切？',
    a: '「上游配置」可以存多套（profiles），但同一时刻只有一套生效——Qoder 的模型记录里只有一条，切上游会覆盖它。点某行的「设为当前」即切换，并会自动同步模型记录与场景绑定。删除正在生效的那套：当前设置保持不变、activeProfile 置空，不会把配置弄坏。',
  },
  {
    q: '网页能被别的网站偷偷调用控制台接口吗？',
    a: '控制台监听 127.0.0.1 且没有 token，浏览器里任何网页本来都能发请求。带 application/json 的会被 CORS 预检挡下，但 text/plain 属于"简单请求"不触发预检——所以加了 Origin 校验：只放行控制台自己，其它来源一律 403。命令行 curl 不带 Origin，不受影响。',
  },
];

export default {
  unsubscribeFunctions: [],

  async render(container) {
    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-header__title">帮助</h1>
        <p class="page-header__desc">上手步骤、常见问题、当前环境信息</p>
      </div>

      <div class="grid grid--sidebar-reverse">
        <div class="flex flex-col gap-5">
          <div id="faq-qa"></div>
          <div id="faq-keys"></div>
        </div>
        <div class="flex flex-col gap-5">
          <div id="faq-steps"></div>
          <div id="faq-sys"></div>
        </div>
      </div>
    `;

    this.renderSteps();
    this.renderQA();
    this.renderKeys();
    this.renderSys();
    this.setupSubscriptions();
  },

  setupSubscriptions() {
    this.unsubscribeFunctions.forEach((fn) => fn());
    this.unsubscribeFunctions = [];
    this.unsubscribeFunctions.push(subscribe('status', () => this.renderSys()));
  },

  renderSteps() {
    const el = document.getElementById('faq-steps');
    if (!el) return;

    el.innerHTML = Card({
      title: '快速开始',
      subtitle: '从零到能用，四步',
      icon: Icon.play,
      iconVariant: 'accent',
      children: STEPS.map(
        (s, i) => `
        <div class="step-item">
          <span class="step-item__num">${i + 1}</span>
          <div>
            <div class="step-item__title">${s.t}</div>
            <div class="step-item__desc">${s.d}</div>
          </div>
        </div>`
      ).join(''),
    });
  },

  renderQA() {
    const el = document.getElementById('faq-qa');
    if (!el) return;

    const chevron = `<svg class="faq-item__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;

    el.innerHTML = Card({
      title: '常见问题',
      subtitle: '点标题展开',
      icon: Icon.help,
      iconVariant: 'violet',
      children: QA.map(
        (x) => `
        <details class="faq-item">
          <summary class="faq-item__q">${chevron}<span>${x.q}</span></summary>
          <div class="faq-item__a">${x.a}</div>
        </details>`
      ).join(''),
    });
  },

  renderKeys() {
    const el = document.getElementById('faq-keys');
    if (!el) return;

    const kbd = (s) => `<span class="kbd">${s}</span>`;

    el.innerHTML = Card({
      title: '快捷键',
      icon: Icon.zap,
      iconVariant: 'info',
      children: KVList({
        items: [
          { label: '切换视图', value: `${kbd('Alt')} + ${kbd('1')} … ${kbd('8')}` },
          { label: '刷新页面', value: kbd('F5') },
          { label: '收起侧边栏', value: `${kbd('Alt')} + ${kbd('B')}` },
        ],
      }),
    });
  },

  renderSys() {
    const el = document.getElementById('faq-sys');
    if (!el) return;

    const st = state.status;
    const p = st?.patches;
    const patched = [p?.byok, p?.experts, p?.live, p?.repowiki].filter(Boolean).length;

    el.innerHTML = Card({
      title: '当前环境',
      subtitle: '实时读取，不是写死的',
      icon: Icon.info,
      iconVariant: 'muted',
      children: KVList({
        items: [
          { label: '控制台', value: `<span class="chip">${location.origin}</span>` },
          { label: '代理端口', value: st?.proxy?.running ? `<span class="chip">${st.proxy.port}</span>` : Badge({ text: '未运行', variant: 'danger' }) },
          { label: 'IDE 代理', value: st?.ide?.httpProxy ? `<span class="chip">${st.ide.httpProxy}</span>` : '未设置（直连）' },
          { label: '补丁', value: Badge({ text: `${patched}/4 已写入`, variant: patched === 4 ? 'success' : 'warning' }) },
          { label: '上游配置', value: `${(state.profiles || []).length} 套` },
        ],
      }),
    });
  },

  bindEvents() {
    bindAll(this);
    // 折叠项：同时只开一个
    this.on(document, 'click', (e) => {
      const summary = e.target.closest('.faq-item__q');
      if (!summary) return;
      const details = summary.parentElement;
      if (details.hasAttribute('open')) return; // 即将打开
      document.querySelectorAll('.faq-item[open]').forEach((d) => {
        if (d !== details) d.removeAttribute('open');
      });
    });

  },

  destroy() {
    unbindAll(this);
    this.unsubscribeFunctions.forEach((fn) => fn());
    this.unsubscribeFunctions = [];
  },
};
