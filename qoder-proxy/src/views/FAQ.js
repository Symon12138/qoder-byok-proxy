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
