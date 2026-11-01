/**
 * Qoder BYOK 控制台 - 状态概览
 */

import { state, actions, subscribe } from '../store.js';
import { Badge, Card, esc, Icon, KVList, SectionTitle, SkeletonStat, StatCard } from '../components.js';
import { bindAll, unbindAll } from '../view-bind.js';
import toast from '../toast.js';
import * as api from '../api.js';

const chip = (t) => `<span class="chip">${esc(t)}</span>`;
// 状态用小圆点表意，文字保持中性色 —— 避免整页绿色文字没有重点
const dot = (ok) => `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${ok ? 'var(--color-success)' : 'var(--color-warning)'};margin-right:7px;vertical-align:middle"></span>`;
const flag = (v) => (v
  ? `${dot(true)}<span style="color:var(--color-text)">已应用</span>`
  : `${dot(false)}<span style="color:#B45309">缺失</span>`);

export default {
  unsubscribeFunctions: [],

  async render(container) {
    container.innerHTML = `
      <div class="page-header">
        <div class="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 class="page-header__title">状态概览</h1>
            <p class="page-header__desc">代理、IDE、补丁的实时状态</p>
          </div>
          <button class="btn btn--ghost" data-ov="refresh">${Icon.refresh}<span>刷新</span></button>
        </div>
      </div>

      <div id="ov-setup" class="mb-5"></div>
      <div id="ov-stats" class="grid grid--4 mb-5"></div>

      <div class="grid grid--sidebar-reverse">
        <div id="ov-detail" class="flex flex-col gap-4"></div>
        <div id="ov-side" class="flex flex-col gap-4"></div>
      </div>
    `;

    this.renderAll();
    this.setupSubscriptions();
  },

  setupSubscriptions() {
    this.unsubscribeFunctions.forEach((fn) => fn());
    this.unsubscribeFunctions = [];
    this.unsubscribeFunctions.push(subscribe('status', () => this.renderAll()));
  },

  renderAll() {
    this.renderSetup();
    this.renderStats();
    this.renderDetail();
    this.renderSide();
  },

  /* ---------- 首次引导 ---------- */
  renderSetup() {
    const el = document.getElementById('ov-setup');
    if (!el) return;

    if (state.status && state.status.setupDone !== false) {
      el.innerHTML = '';
      return;
    }

    el.innerHTML = Card({
      title: '首次使用 · 环境未就绪',
      subtitle: '点「一键完成」会依次：启动代理 → 同步模型 → 指向 IDE（证书与补丁需单独点）',
      icon: Icon.info,
      iconVariant: 'warning',
      className: 'card--accent',
      children: `
        <div class="flex flex-col gap-3">
          ${['启动本地代理', '同步模型记录到 IDE', '把 IDE 指向代理', '信任代理证书（Windows 弹一次确认，点「是」）', '应用补丁（需管理员权限）']
            .map((t, i) => `<div class="flex items-center gap-3 text-sm"><span class="icon-box icon-box--muted icon-box--sm">${i + 1}</span><span>${t}</span></div>`)
            .join('')}
        </div>
        ${state.status && state.status.cert && !state.status.cert.trusted ? `
        <div class="mt-4 p-3" style="background:var(--surface-2);border-radius:var(--radius-md)">
          <div class="text-sm" style="margin-bottom:8px">
            证书还没被信任：Qoder 会因证书校验失败连不上本代理。
          </div>
          <button class="btn btn--primary" data-act="trust-cert">信任证书</button>
        </div>` : ''}
      `,
      footer: `
        <div class="btn-group">
          <button class="btn btn--primary" data-act="setup-run">一键完成</button>
          <button class="btn btn--ghost" data-act="setup-skip">稍后再说</button>
        </div>
      `,
    });
  },

  /* ---------- 状态卡 ---------- */
  renderStats() {
    const el = document.getElementById('ov-stats');
    if (!el) return;

    if (!state.status) {
      el.innerHTML = SkeletonStat().repeat(4);
      return;
    }

    const { proxy, ide, patches, config } = state.status;
    const patched = !!(patches?.byok && patches?.live);
    const model = config?.upstream?.displayName || config?.upstream?.model || '未配置';

    el.innerHTML = [
      StatCard({
        label: '本地代理',
        value: proxy?.running ? '运行中' : '已停止',
        icon: Icon.server,
        iconVariant: proxy?.running ? 'accent' : 'danger',
        meta: Badge({ text: `${proxy?.running ? '在线' : '离线'} · :${proxy?.port ?? '-'}`, variant: proxy?.running ? 'success' : 'danger' }),
      }),
      StatCard({
        label: 'IDE 代理',
        value: ide?.httpProxy ? '已启用' : '直连',
        icon: Icon.link,
        iconVariant: ide?.httpProxy ? 'accent' : 'muted',
        meta: ide?.httpProxy ? chip(ide.httpProxy) : '<span class="text-xs">未设置 http.proxy</span>',
      }),
      StatCard({
        label: '补丁状态',
        value: patched ? '已应用' : '未应用',
        icon: Icon.shield,
        iconVariant: patched ? 'accent' : 'warning',
        meta: Badge({ text: patched ? '正常' : '需要应用', variant: patched ? 'success' : 'warning' }),
      }),
      StatCard({
        label: '当前模型',
        value: `<span title="${esc(model)}">${esc(model)}</span>`,
        valueClass: 'stat-card__value--model',
        icon: Icon.cpu,
        iconVariant: 'violet',
        meta: config?.upstream?.reasoningEffort
          ? Badge({ text: `思考 ${config.upstream.reasoningEffort}`, variant: 'info', dot: false })
          : '<span class="text-xs">未设置思考等级</span>',
      }),
    ].join('');
  },

  /* ---------- 详情 ---------- */
  renderDetail() {
    const el = document.getElementById('ov-detail');
    if (!el) return;

    if (!state.status) {
      el.innerHTML = Card({
        title: '详细信息',
        icon: Icon.file,
        children: '<div class="skeleton skeleton--text" style="width:100%;margin-bottom:10px"></div><div class="skeleton skeleton--text" style="width:78%"></div>',
      });
      return;
    }

    const { proxy, ide, patches, config } = state.status;

    el.innerHTML = Card({
      title: '详细信息',
      subtitle: '代理、IDE、补丁、上游的完整配置',
      icon: Icon.file,
      children: `
        <div class="grid grid--2" style="gap:var(--space-6)">
          <div>
            ${SectionTitle({ text: '代理' })}
            ${KVList({ items: [
              { label: '监听端口', value: chip(proxy?.port ?? '-') },
              { label: '运行状态', value: proxy?.running ? `${dot(true)}<span style="color:var(--color-text)">运行中</span>` : `${dot(false)}<span style="color:#B45309">已停止</span>` },
            ] })}
          </div>
          <div>
            ${SectionTitle({ text: 'Qoder IDE' })}
            ${KVList({ items: [
              { label: 'http.proxy', value: ide?.httpProxy ? chip(ide.httpProxy) : '未设置' },
            ] })}
          </div>
          <div>
            ${SectionTitle({ text: '上游' })}
            ${KVList({ items: [
              { label: 'Base URL', value: chip(config?.upstream?.baseUrl || '-') },
              { label: '模型 ID', value: chip(config?.upstream?.model || '-') },
              { label: '思考等级', value: config?.upstream?.reasoningEffort || '—' },
            ] })}
          </div>
          <div>
            ${SectionTitle({ text: '补丁' })}
            ${KVList({ items: [
              { label: 'BYOK 解锁', value: flag(patches?.byok) },
              { label: '专家团', value: flag(patches?.experts) },
              { label: '实时模型名', value: flag(patches?.live) },
              { label: 'RepoWiki', value: flag(patches?.repowiki) },
            ] })}
          </div>
        </div>
      `,
    });

    // 状态同步放左栏底部，和右栏两张卡对齐
    el.insertAdjacentHTML('beforeend', this.syncCard());
  },

  /* ---------- 状态同步卡 ---------- */
  syncCard() {
    const now = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    return Card({
      title: '状态同步',
      icon: Icon.pulse,
      iconVariant: 'info',
      children: `
        ${KVList({ items: [
          { label: '最近同步', value: `<span class="text-mono">${now}</span>` },
          { label: '自动刷新', value: '每 5 秒' },
          { label: '数据状态', value: state.status ? Badge({ text: '已就绪', variant: 'success' }) : Badge({ text: '加载中', variant: 'warning' }) },
        ] })}
        <button class="btn btn--ghost w-full mt-3" data-ov="refresh">${Icon.refresh}<span>立即刷新</span></button>
      `,
    });
  },

  /* ---------- 模型记录卡 ---------- */
  modelRecordCard() {
    const st = state.status;
    if (!st) {
      return Card({ title: '模型记录', icon: Icon.box, iconVariant: 'violet', children: '<div class="skeleton skeleton--text" style="width:100%"></div>' });
    }
    const rec = Array.isArray(st.record) ? st.record[0] : st.record;
    const ctx = Number(rec?.max_input_tokens || st.config?.upstream?.contextLength || 0);

    return Card({
      title: '模型记录',
      subtitle: '写进 Qoder 的那一条',
      icon: Icon.box,
      iconVariant: 'violet',
      children: `
        ${KVList({ items: [
          { label: '记录 ID', value: chip(rec?.id || st.config?.recordId || '-') },
          { label: '显示名', value: rec?.displayName ? `<span class="chip">${esc(rec.displayName)}</span>` : '—' },
          { label: '上下文', value: ctx ? `<span class="chip">${ctx.toLocaleString()}</span>` : '—' },
          { label: '图片输入', value: rec?.is_vl ? '支持' : '不支持' },
          { label: '推理能力', value: rec?.is_reasoning ? '支持' : '不支持' },
        ] })}
      `,
    });
  },

  /* ---------- 右栏 ---------- */
  renderSide() {
    const el = document.getElementById('ov-side');
    if (!el) return;

    const now = new Date().toLocaleTimeString('zh-CN', { hour12: false });

    el.innerHTML = [
      Card({
        title: '快捷操作',
        icon: Icon.zap,
        iconVariant: 'accent',
        children: `
          <div class="flex flex-col gap-2">
            <button class="btn btn--primary w-full" data-act="ide-on">${Icon.arrowRight}<span>IDE 走代理</span></button>
            <button class="btn w-full" data-act="ide-off">${Icon.ban}<span>恢复原始（不设代理）</span></button>
            <button class="btn w-full" data-act="go-upstream">${Icon.cpu}<span>切换模型（上游配置）</span></button>
          </div>
        `,
      }),
      this.modelRecordCard(),
    
    ].join('');
  },

  bindEvents() {
    bindAll(this);
    this.on(document, 'click', async (e) => {
      const el = e.target.closest('[data-act], [data-ov]');
      if (!el) return;
      if (!document.getElementById('ov-stats')) return;

      const act = el.dataset.act || el.dataset.ov;
      const orig = el.innerHTML;
      el.disabled = true;

      try {
        if (act === 'ide-on') {
          el.innerHTML = '处理中…';
          await actions.setIdeProxy(8788);
          toast.success('IDE 已设置为走代理（重启 IDE 生效）');
        } else if (act === 'ide-off') {
          el.innerHTML = '处理中…';
          await actions.setIdeProxy(null);
          toast.success('IDE 已恢复为不设代理');
        } else if (act === 'go-upstream') {
          window.location.hash = 'upstream';
        } else if (act === 'refresh') {
          el.innerHTML = '刷新中…';
          await actions.loadInitialData();
          toast.success('状态已刷新');
        } else if (act === 'setup-run') {
          el.innerHTML = '执行中…';
          const r = await api.init();
          const bad = (r.steps || []).filter((s) => !s.ok);
          if (bad.length === 0) {
            await api.markSetupDone();
            toast.success('环境已就绪');
          } else {
            toast.warning(`部分步骤未完成：${bad.map((s) => s.step).join('、')}`);
          }
          await actions.loadStatus();
        } else if (act === 'trust-cert') {
          el.disabled = true;
          const origLabel = el.innerHTML;
          el.innerHTML = '等待确认…';
          try {
            const r = await api.trustCert();
            if (r.already) {
              await actions.loadStatus();
              toast.success('证书已在受信任根里');
            } else {
              let trusted = false;
              for (let i = 0; i < 90; i++) {
                await new Promise((res) => setTimeout(res, 2000));
                const c = await api.getCert();
                if (c.trusted) { trusted = true; break; }
              }
              await actions.loadStatus();
              if (trusted) toast.success('证书已信任，重启 Qoder 后生效');
              else toast.warning('没检测到信任完成，可在「维护」页重试');
            }
          } finally {
            el.disabled = false;
            el.innerHTML = origLabel;
          }
        } else if (act === 'setup-skip') {
          await api.markSetupDone();
          await actions.loadStatus();
        }
      } catch (err) {
        toast.error(err.message || '操作失败');
      } finally {
        el.disabled = false;
        el.innerHTML = orig;
      }
    });
  },

  destroy() {
    unbindAll(this);
    this.unsubscribeFunctions.forEach((fn) => fn());
    this.unsubscribeFunctions = [];
  },
};
