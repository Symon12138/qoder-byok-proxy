/**
 * Qoder BYOK 控制台 - 日志
 */

import { state, actions, subscribe } from '../store.js';
import { Card, Icon, EmptyState } from '../components.js';
import { bindAll, unbindAll } from '../view-bind.js';
import toast from '../toast.js';

const SOURCES = [
  { value: 'proxy', label: '代理日志' },
  { value: 'agent', label: 'Agent 日志' },
  { value: 'renderer', label: '渲染日志' },
  { value: 'all', label: '全部日志' },
];

export default {
  unsubscribeFunctions: [],
  keyword: '',
  src: 'proxy',
  lines: 100,

  async render(container) {
    container.innerHTML = `
      <div class="page-header">
        <div class="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 class="page-header__title">日志</h1>
            <p class="page-header__desc">代理请求与错误记录，最新的在最下面</p>
          </div>
        </div>
      </div>

      <div class="card mb-5">
        <div class="card__body card__body--tight">
          <div class="toolbar">
            <div class="toolbar__fixed" style="width:170px">
              <label class="field__label" for="lg-src">日志源</label>
              <select class="field__select" id="lg-src">
                ${SOURCES.map((s) => `<option value="${s.value}" ${s.value === this.src ? 'selected' : ''}>${s.label}</option>`).join('')}
              </select>
            </div>
            <div class="toolbar__grow">
              <label class="field__label" for="lg-q">搜索</label>
              <input class="field__input" id="lg-q" placeholder="关键字过滤，留空显示全部" value="${this.esc(this.keyword)}">
            </div>
            <div class="toolbar__fixed" style="width:96px">
              <label class="field__label" for="lg-n">行数</label>
              <input class="field__input" id="lg-n" type="number" value="${this.lines}" min="10" max="800">
            </div>
            <div class="toolbar__fixed">
              <div class="btn-group">
                <button class="btn btn--primary" data-lg="refresh">${Icon.refresh}<span>刷新</span></button>
                <button class="btn btn--danger" data-lg="clear">${Icon.trash}<span>清空</span></button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div id="logs-content"></div>
    `;

    await this.reload();
    this.setupSubscriptions();
  },

  setupSubscriptions() {
    this.unsubscribeFunctions.forEach((fn) => fn());
    this.unsubscribeFunctions = [];
    this.unsubscribeFunctions.push(subscribe('logs', () => this.renderLogs()));
  },

  esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  level(line) {
    if (/\b(ERROR|FATAL|ERR)\b/.test(line)) return 'err';
    if (/\bWARN(ING)?\b/.test(line)) return 'warn';
    if (/\b(INFO|OK)\b/.test(line)) return 'ok';
    return '';
  },

  /** 把一行日志变成好读的摘要：时间 + 类型 + 关键字段 */
  summarize(line) {
    const raw = String(line);
    const t = (raw.match(/"at":"[^"]*T(\d{2}:\d{2}:\d{2})/) || raw.match(/(\d{2}:\d{2}:\d{2})/) || [])[1] || '';

    // 代理日志是 JSON 事件流，抽关键字段
    if (raw.trim().startsWith('{')) {
      try {
        const o = JSON.parse(raw);
        const kind = o.kind || '';
        if (kind === 'request') {
          const m = o.method || '';
          const u = String(o.url || '');
          const short = u.length > 92 ? `${u.slice(0, 92)}…` : u;
          return { t, tag: m || 'REQ', tid: 'req', text: short, raw };
        }
        if (kind === 'response') {
          const st = Number(o.status) || 0;
          const cls = st >= 400 ? 'err' : st >= 300 ? 'warn' : 'ok';
          return { t, tag: String(st), tid: cls, text: o.contentType || '', raw };
        }
        if (kind === 'response-end') {
          return { t, tag: '结束', tid: 'dim', text: '', raw };
        }
        return { t, tag: kind || 'JSON', tid: 'dim', text: '', raw };
      } catch {
        /* 不是合法 JSON，按普通文本处理 */
      }
    }

    // 文本日志：识别级别
    const lv = (raw.match(/\[(error|warn|info|debug)\]/i) || [])[1] || '';
    const tid = lv ? (lv.toLowerCase() === 'error' ? 'err' : lv.toLowerCase() === 'warn' ? 'warn' : lv.toLowerCase() === 'info' ? 'ok' : 'dim') : 'dim';
    const text = raw.replace(/^\[[a-z]+\]\s*/i, '').replace(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+/, '');
    return { t, tag: lv || '', tid, text, raw };
  },

  async renderLogs() {
    const el = document.getElementById('logs-content');
    if (!el) return;

    const logs = state.logs || [];
    const kw = this.keyword.trim().toLowerCase();
    const shown = kw ? logs.filter((l) => String(l).toLowerCase().includes(kw)) : logs;

    if (!logs.length) {
      el.innerHTML = Card({
        title: '日志内容',
        icon: Icon.file,
        iconVariant: 'muted',
        children: EmptyState({
          icon: Icon.file,
          title: '还没有日志',
          desc: '代理运行后产生请求时会写入这里。也可以点上方「刷新」再拉一次。',
          action: `<button class="btn btn--primary" data-lg="refresh">${Icon.refresh}<span>刷新</span></button>`,
        }),
      });
      return;
    }

    const rows = shown
      .map((l, i) => {
        const s = this.summarize(l);
        const tagCls = s.tid === 'err' ? 'badge--danger' : s.tid === 'warn' ? 'badge--warning' : s.tid === 'ok' ? 'badge--success' : '';
        return `<div class="log-row" title="${this.esc(s.raw)}">
  <span class="log-row__no">${i + 1}</span>
  <span class="log-row__time">${this.esc(s.t || '—')}</span>
  ${s.tag ? `<span class="log-row__tag ${tagCls}">${this.esc(s.tag)}</span>` : '<span class="log-row__tag"></span>'}
  <span class="log-row__text">${this.esc(s.text) || '<span class="text-faint">—</span>'}</span>
</div>`;
      })
      .join('');

    el.innerHTML = Card({
      title: '日志内容',
      icon: Icon.file,
      iconVariant: 'muted',
      subtitle: kw
        ? `匹配 ${shown.length} / ${logs.length} 行（关键字「${this.esc(this.keyword)}」）`
        : `${logs.length} 行 · ${SOURCES.find((x) => x.value === this.src)?.label || ''} · 悬停看原始内容`,
      bodyClass: 'card__body--tight',
      children: shown.length
        ? `<div class="log-view">${rows}</div>`
        : `<div class="log-view"><div class="text-muted text-xs">没有匹配「${this.esc(this.keyword)}」的日志</div></div>`,
    });
  },

  bindEvents() {
    bindAll(this);
    // 筛选控件
    this.on(document, 'change', (e) => {
      if (e.target.id !== 'lg-src') return;
      this.src = e.target.value;
      this.reload();
    });

    // 搜索：改完按回车/失焦再查，避免每敲一个字都拉一次
    this.on(document, 'keydown', (e) => {
      if (e.target.id === 'lg-q' && e.key === 'Enter') {
        this.keyword = e.target.value;
        this.reload();
      }
      if (e.target.id === 'lg-n' && e.key === 'Enter') {
        this.lines = Number(e.target.value) || 100;
        this.reload();
      }
    });
    this.on(document, 'change', (e) => {
      if (e.target.id === 'lg-q') { this.keyword = e.target.value; this.renderLogs(); }
      if (e.target.id === 'lg-n') { this.lines = Number(e.target.value) || 100; this.reload(); }
    });

    this.on(document, 'click', async (e) => {
      const btn = e.target.closest('[data-lg]');
      if (!btn) return;
      if (!document.getElementById('logs-content')) return;

      const act = btn.dataset.lg;
      const orig = btn.innerHTML;

      if (act === 'clear') {
        if (!confirm('清空当前来源的日志？不可恢复。')) return;
        btn.disabled = true;
        btn.innerHTML = '清空中…';
        try {
          await actions.clearLogs(this.src);
          await this.renderLogs();
          toast.success('日志已清空');
        } catch (err) {
          toast.error(err.message || '清空失败');
        } finally {
          btn.disabled = false;
          btn.innerHTML = orig;
        }
        return;
      }

      if (act === 'refresh') {
        btn.disabled = true;
        btn.innerHTML = '刷新中…';
        try {
          await this.reload();
          toast.success(`已加载 ${(state.logs || []).length} 行`);
        } catch (err) {
          toast.error(err.message || '刷新失败');
        } finally {
          btn.disabled = false;
          btn.innerHTML = orig;
        }
      }
    });
  },

  async reload() {
    await actions.loadLogs({ src: this.src, search: '', lines: this.lines });
    await this.renderLogs();
  },

  destroy() {
    unbindAll(this);
    this.unsubscribeFunctions.forEach((fn) => fn());
    this.unsubscribeFunctions = [];
  },
};
