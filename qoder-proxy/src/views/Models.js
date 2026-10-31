/**
 * Qoder BYOK 控制台 - 模型能力（只读参考）
 *
 * 定位：只看「某个上游里有哪些模型、各支持什么」，不负责切换。
 * 切换模型属于「上游配置」——模型是当前上游的一个字段。
 */

import { state, actions, subscribe } from '../store.js';
import { Badge, Card, esc, Icon, Table } from '../components.js';
import { bindAll, unbindAll } from '../view-bind.js';
import toast from '../toast.js';

const fmt = (n) => (n ? Number(n).toLocaleString() : '—');

export default {
  unsubscribeFunctions: [],
  keyword: '',
  capability: '',
  profile: '',

  async render(container) {
    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-header__title">模型能力</h1>
        <p class="page-header__desc">对比各模型能力，决定用哪个。切换请到「上游配置」</p>
      </div>

      <div id="m-head" class="mb-5"></div>
      <div id="m-table"></div>
    `;

    const active = state.activeProfile || state.status?.config?.activeProfile || '';
    this.profile = active;
    try {
      await actions.loadModels(active);
    } catch {
      /* 表格里显示错误 */
    }

    this.renderHead();
    this.renderTable();
    this.setupSubscriptions();
  },

  setupSubscriptions() {
    this.unsubscribeFunctions.forEach((fn) => fn());
    this.unsubscribeFunctions = [];
    this.unsubscribeFunctions.push(
      subscribe('models', () => this.renderTable()),
      subscribe('status', () => {
        this.renderHead();
        this.renderTable();
      }),
      subscribe('profiles', () => this.renderHead())
    );
  },

  models() { return state.models || []; },
  current() { return state.status?.config?.upstream || {}; },
  profiles() { return state.profiles || []; },
  activeName() { return state.activeProfile || state.status?.config?.activeProfile || ''; },

  /* ---------- 一张卡：当前生效 + 数据来源 ---------- */
  renderHead() {
    const el = document.getElementById('m-head');
    if (!el) return;

    if (!state.status) {
      el.innerHTML = Card({ icon: Icon.cpu, iconVariant: 'accent', title: '当前模型', children: '<div class="skeleton skeleton--text" style="width:45%"></div>' });
      return;
    }

    const up = this.current();
    const m = this.models().find((x) => x.id === up.model);
    const list = this.profiles();
    const active = this.activeName();
    const sel = this.profile || active;
    const viewing = list.find((p) => p.name === sel);
    const isActive = sel === active;

    el.innerHTML = Card({
      icon: Icon.cpu,
      iconVariant: 'accent',
      title: '当前生效模型',
      subtitle: `上下文 ${fmt(up.contextLength || m?.context)} · 输出 ${fmt(up.maxTokens || m?.output)} · 思考 ${up.reasoningEffort || '关闭'}`,
      headerExtra: `<a class="btn btn--sm" href="#upstream">${Icon.arrowRight}<span>去上游配置切换</span></a>`,
      bodyClass: 'card__body--tight',
      children: `
        <div class="flex items-center gap-2 flex-wrap mb-4">
          <span style="font-family:var(--font-mono);font-size:17px;font-weight:var(--weight-bold);letter-spacing:-.02em">
            ${esc(up.displayName || up.model || '未设置')}
          </span>
          <span class="chip">${esc(up.model || '-')}</span>
        </div>

        <div class="flex items-end gap-3 flex-wrap">
          <div style="flex:1;min-width:220px">
            <label class="field__label" for="m-profile">查看哪个上游的模型</label>
            <select class="field__select" id="m-profile">
              ${list.map((p) => `<option value="${esc(p.name)}" ${p.name === sel ? 'selected' : ''}>${esc(p.name)}${p.name === active ? '（当前生效）' : ''}</option>`).join('')}
            </select>
          </div>
          <div class="flex items-center gap-2" style="padding-bottom:9px">
            <span class="chip">${esc(viewing?.baseUrl || '未设置地址')}</span>
            ${isActive ? '' : '<span class="badge badge--warning"><span class="badge__dot"></span>仅浏览</span>'}
          </div>
        </div>
      `,
    });
  },

  /* ---------- 表格（搜索/筛选收到卡片头） ---------- */
  renderTable() {
    const el = document.getElementById('m-table');
    if (!el) return;

    if (!state.status) {
      el.innerHTML = Card({ icon: Icon.box, iconVariant: 'violet', title: '模型列表', children: '<div class="skeleton skeleton--text" style="width:100%"></div>' });
      return;
    }

    const all = this.models();
    const list = this.filtered();
    const curModel = this.current().model;
    const active = this.activeName();
    const viewing = this.profile || active;
    const isActive = viewing === active;

    const toolbar = `
      <div class="flex items-center gap-2">
        <input class="field__input" id="m-q" placeholder="搜索模型" value="${esc(this.keyword)}"
               style="width:170px;min-height:32px;height:32px;font-size:12px">
        <select class="field__select" id="m-cap" style="width:118px;min-height:32px;height:32px;font-size:12px">
          <option value="">全部能力</option>
          <option value="vision" ${this.capability === 'vision' ? 'selected' : ''}>图片输入</option>
          <option value="reasoning" ${this.capability === 'reasoning' ? 'selected' : ''}>推理</option>
          <option value="tools" ${this.capability === 'tools' ? 'selected' : ''}>工具调用</option>
          <option value="thinking" ${this.capability === 'thinking' ? 'selected' : ''}>有思考档位</option>
        </select>
        <button class="btn btn--ghost btn--sm btn--icon" data-m="refresh" title="刷新">${Icon.refresh}</button>
      </div>
    `;

    if (!all.length) {
      el.innerHTML = Card({
        icon: Icon.box,
        iconVariant: 'violet',
        title: '模型列表',
        headerExtra: toolbar,
        children: `<p class="text-muted text-sm">「${esc(viewing || '当前上游')}」没返回模型${state.modelsError ? `：${esc(state.modelsError)}` : ''}。检查该上游的 Base URL 与 API Key。</p>`,
      });
      return;
    }

    el.innerHTML = Card({
      icon: Icon.box,
      iconVariant: 'violet',
      title: '模型列表',
      subtitle: `来自「${esc(viewing)}」· ${list.length} / ${all.length} 个${isActive ? '' : ' · 非当前生效，仅浏览'}`,
      headerExtra: toolbar,
      bodyClass: 'card__body--flush',
      children: Table({
        className: 'table--compact',
        columns: [
          { label: '模型', key: 'name' },
          { label: '上下文', key: 'ctx', width: '104px' },
          { label: '输出上限', key: 'out', width: '104px' },
          { label: '能力', key: 'caps' },
          { label: '思考档位', key: 'levels', width: '200px' },
        ],
        rows: list.map((m) => {
          const isCur = isActive && m.id === curModel;
          const caps = [
            m.vision ? Badge({ text: '图片', variant: 'info', dot: false }) : '',
            m.reasoning ? Badge({ text: '推理', variant: 'warning', dot: false }) : '',
            m.tools ? Badge({ text: '工具', variant: 'success', dot: false }) : '',
          ].filter(Boolean).join(' ');

          return {
            name: `
              <div style="min-width:0">
                <div style="font-weight:var(--weight-semibold);display:flex;align-items:center;gap:8px">
                  <span class="text-truncate" title="${esc(m.name || m.id)}">${esc(m.name || m.id)}</span>
                  ${isCur ? '<span class="badge badge--success"><span class="badge__dot"></span>当前</span>' : ''}
                </div>
                <div class="text-xs text-muted text-mono text-truncate" title="${esc(m.id)}" style="margin-top:2px">${esc(m.id)}</div>
              </div>
            `,
            ctx: `<span class="text-mono text-sm">${fmt(m.context)}</span>`,
            out: `<span class="text-mono text-sm">${fmt(m.output)}</span>`,
            caps: `<div class="flex gap-1 flex-wrap">${caps || '<span class="text-muted text-xs">—</span>'}</div>`,
            levels: `<div class="flex gap-1 flex-wrap">${(m.levels || []).length
              ? m.levels.map((lv) => `<span class="chip">${esc(lv)}</span>`).join(' ')
              : '<span class="text-muted text-xs">不支持</span>'}</div>`,
            _cls: isCur ? 'tr--current' : '',
          };
        }),
      }),
    });
  },

  filtered() {
    const kw = this.keyword.trim().toLowerCase();
    const cap = this.capability;
    return this.models().filter((m) => {
      if (cap === 'vision' && !m.vision) return false;
      if (cap === 'reasoning' && !m.reasoning) return false;
      if (cap === 'tools' && !m.tools) return false;
      if (cap === 'thinking' && !(m.levels || []).length) return false;
      if (!kw) return true;
      return `${m.id || ''} ${m.name || ''} ${(m.levels || []).join(' ')}`.toLowerCase().includes(kw);
    });
  },

  bindEvents() {
    bindAll(this);
    this.on(document, 'change', async (e) => {
      if (e.target.id === 'm-cap') {
        this.capability = e.target.value;
        this.renderTable();
        return;
      }
      if (e.target.id === 'm-profile') {
        this.profile = e.target.value;
        try {
          await actions.loadModels(this.profile);
        } catch (err) {
          toast.error(err.message || '拉取模型失败');
        }
        this.renderHead();
        this.renderTable();
      }
    });

    let timer = null;
    this.on(document, 'input', (e) => {
      if (e.target.id !== 'm-q') return;
      clearTimeout(timer);
      const v = e.target.value;
      timer = setTimeout(() => {
        this.keyword = v;
        this.renderTable();
        // 表格重渲染会替换输入框，需要把焦点和光标还原
        const q = document.getElementById('m-q');
        if (q) { q.focus(); q.setSelectionRange(v.length, v.length); }
      }, 250);
    });

    this.on(document, 'click', async (e) => {
      const btn = e.target.closest('[data-m]');
      if (!btn) return;
      if (!document.getElementById('m-table')) return;
      if (btn.dataset.m !== 'refresh') return;

      btn.disabled = true;
      try {
        await actions.loadModels(this.profile || this.activeName());
        this.renderHead();
        this.renderTable();
        toast.success(`已加载 ${this.models().length} 个模型`);
      } catch (err) {
        toast.error(err.message || '刷新失败');
      } finally {
        btn.disabled = false;
      }
    });
  },

  destroy() {
    unbindAll(this);
    this.unsubscribeFunctions.forEach((fn) => fn());
    this.unsubscribeFunctions = [];
  },
};
