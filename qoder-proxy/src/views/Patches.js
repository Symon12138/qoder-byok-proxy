/**
 * Qoder BYOK 控制台 - 补丁管理
 *
 * 关键语义（之前的坑）：这里的开关只写 config.json 的 patches 字段，
 * **不会立刻改动 bundle**。要让开关真正生效必须再点「应用补丁」。
 * 所以 UI 必须显式区分「已启用」与「已写入 bundle」两种状态。
 */

import { state, actions, subscribe } from '../store.js';
import { Badge, Card, EmptyState, esc, Icon, KVList, Switch, Table } from '../components.js';
import { bindAll, unbindAll } from '../view-bind.js';
import toast from '../toast.js';


export default {
  unsubscribeFunctions: [],

  async render(container) {
    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-header__title">补丁管理</h1>
        <p class="page-header__desc">开关决定「哪些功能生效」，改完需要应用补丁才写进 Qoder</p>
      </div>

      <div id="pt-dirty" class="mb-4"></div>

      <div class="grid grid--sidebar-reverse">
        <div>
          <div id="pt-status" class="mb-5"></div>
          <div id="pt-list"></div>
        </div>
        <div class="flex flex-col gap-5">
          <div id="pt-actions"></div>
          <div id="pt-note"></div>
        </div>
      </div>
    `;

    this.renderDirty();
    this.renderStatus();
    this.renderList();
    this.renderActions();
    this.renderNote();
    this.setupSubscriptions();
  },

  setupSubscriptions() {
    this.unsubscribeFunctions.forEach((fn) => fn());
    this.unsubscribeFunctions = [];
    this.unsubscribeFunctions.push(
      subscribe('status', () => {
        this.renderDirty();
        this.renderStatus();
        this.renderList();
        this.renderActions();
      })
    );
  },

  items() {
    return state.status?.patches?.items || [];
  },

  /** 有开关状态与实际 bundle 不一致的项 */
  dirtyItems() {
    return this.items().filter((i) => i.enabled !== i.applied);
  },

  /* ---------- 未应用变更提示 ---------- */
  renderDirty() {
    const el = document.getElementById('pt-dirty');
    if (!el) return;

    const dirty = this.dirtyItems();
    if (!dirty.length) {
      el.innerHTML = '';
      return;
    }

    const lines = dirty.map((i) => {
      const want = i.enabled ? '启用' : '停用';
      const actual = i.applied ? '已写入' : '未写入';
      return `<div class="text-sm">· <b>${esc(i.name || i.id)}</b>：设置为${want}，但 bundle 目前${actual}</div>`;
    }).join('');

    el.innerHTML = `
      <div class="card card--accent">
        <div class="card__body">
          <div class="flex items-start gap-3">
            <span class="icon-box icon-box--warning icon-box--sm">${Icon.alert}</span>
            <div style="flex:1;min-width:0">
              <div style="font-weight:var(--weight-semibold);margin-bottom:6px">有 ${dirty.length} 项变更还没写进 Qoder</div>
              ${lines}
              <div class="text-xs text-muted mt-2">点右侧「应用补丁」才会真正生效（会关闭 Qoder 并请求管理员权限）。</div>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  /* ---------- 补丁应用状态（来自 bundle 扫描） ---------- */
  renderStatus() {
    const el = document.getElementById('pt-status');
    if (!el) return;

    const p = state.status?.patches;
    if (!p) {
      el.innerHTML = Card({
        title: 'bundle 状态',
        icon: Icon.shield,
        iconVariant: 'accent',
        children: '<div class="skeleton skeleton--text" style="width:100%"></div>',
      });
      return;
    }

    const row = (ok, name) => ({
      label: name,
      value: ok
        ? Badge({ text: '已写入', variant: 'success' })
        : Badge({ text: '缺失', variant: 'warning' }),
    });

    el.innerHTML = Card({
      title: 'bundle 状态',
      subtitle: '扫描已安装的 Qoder 文件，判断补丁是否真的在里面',
      icon: Icon.shield,
      iconVariant: 'accent',
      children: `
        ${KVList({ items: [
          row(p.byok, 'BYOK 解锁'),
          row(p.experts, '专家团'),
          row(p.live, '实时模型名'),
          row(p.repowiki, 'RepoWiki'),
        ] })}
      `
    });
  },

  /* ---------- 开关列表 ---------- */
  renderList() {
    const el = document.getElementById('pt-list');
    if (!el) return;

    if (!state.status) {
      el.innerHTML = Card({
        title: '功能开关',
        icon: Icon.zap,
        iconVariant: 'accent',
        children: '<div class="skeleton skeleton--text" style="width:100%"></div>',
      });
      return;
    }

    const items = this.items();
    if (!items.length) {
      el.innerHTML = Card({
        title: '功能开关',
        icon: Icon.zap,
        iconVariant: 'accent',
        children: EmptyState({ title: '没有可切换的功能', desc: '补丁清单为空，检查补丁脚本是否正常' }),
      });
      return;
    }

    el.innerHTML = Card({
      title: '功能开关',
      subtitle: '关掉某个功能后，应用补丁时就不会写入它对应的修改',
      icon: Icon.zap,
      iconVariant: 'accent',
      bodyClass: 'card__body--flush',
      children: Table({
        columns: [
          { label: '功能', key: 'name' },
          { label: '说明', key: 'desc' },
          { label: 'bundle', key: 'applied', width: '110px' },
          { label: '开关', key: 'enabled', width: '90px' },
        ],
        rows: items.map((item) => {
          const dirty = item.enabled !== item.applied;
          return {
            name: `
              <div style="min-width:0">
                <div style="font-weight:var(--weight-medium)">${esc(item.name || item.id)}</div>
                <div class="text-xs text-muted text-mono">${esc((item.covers || []).join(' ') || item.id)}</div>
              </div>
            `,
            desc: `<span class="text-xs text-dim">${esc(item.desc || '—')}</span>`,
            applied: item.applied
              ? Badge({ text: '已写入', variant: 'success' })
              : Badge({ text: '未写入', variant: 'default' }),
            enabled: Switch({
              checked: !!item.enabled,
              attrs: `data-patch-toggle="${esc(item.id)}"`,
            }),
            _cls: dirty ? 'tr--selected' : '',
          };
        }),
      }),
    });
  },

  /* ---------- 操作 ---------- */
  renderActions() {
    const el = document.getElementById('pt-actions');
    if (!el) return;

    const dirty = this.dirtyItems();

    el.innerHTML = Card({
      title: '写入 Qoder',
      subtitle: '会关闭 Qoder、覆盖 bundle、请求管理员权限',
      icon: Icon.play,
      iconVariant: 'accent',
      children: `
        <div class="text-xs text-muted" style="line-height:var(--leading-relaxed)">
          应用后需要手动重启 Qoder IDE。回滚会把所有补丁还原为官方版本，并重新打开自动更新。
        </div>
        ${dirty.length ? `<div class="mt-3 text-xs" style="color:var(--color-warning)">有 ${dirty.length} 项待写入</div>` : ''}
      `,
      footer: `
        <div class="flex flex-col gap-2">
          <button class="btn btn--primary w-full" data-pt="apply">${Icon.save}<span>应用补丁${dirty.length ? `（${dirty.length} 项变更）` : ''}</span></button>
          <div class="flex gap-2">
            <button class="btn btn--danger flex-1" data-pt="revert">回滚</button>
            <button class="btn btn--ghost flex-1" data-pt="refresh">${Icon.refresh}<span>刷新</span></button>
          </div>
        </div>
      `,
    });
  },

  /* ---------- 什么时候会失效 ---------- */
  renderNote() {
    const el = document.getElementById('pt-note');
    if (!el) return;
    el.innerHTML = Card({
      title: '什么时候会失效',
      icon: Icon.alert,
      iconVariant: 'warning',
      children: `
        <div class="text-xs text-dim" style="line-height:1.75">
          Qoder 每次启动都会把<b>自动更新</b>重置为开启，这个关不掉。它发布新版后覆盖安装，
          补丁就会被冲掉。
        </div>
        <div class="text-xs text-muted mt-3" style="line-height:1.75">
          症状：模型名显示不对 · 专家团选不到自定义模型 · RepoWiki 提示无法生成。
          重新点上面的「应用补丁」，再重启 IDE 即可恢复。
        </div>
      `,
    });
  },

  bindEvents() {
    bindAll(this);
    // 开关：只写 config.json，不立刻改 bundle
    this.on(document, 'change', async (e) => {
      const toggle = e.target.closest('[data-patch-toggle]');
      if (!toggle) return;
      if (!document.getElementById('pt-list')) return;

      const id = toggle.dataset.patchToggle;
      const enabled = toggle.checked;
      const name = this.items().find((i) => i.id === id)?.name || id;

      toggle.disabled = true;
      try {
        await actions.updatePatches({ [id]: enabled });
        await actions.loadStatus();
        toast.success(`「${name}」已设为${enabled ? '启用' : '停用'}，点「应用补丁」后生效`);
      } catch (err) {
        toggle.checked = !enabled;
        toast.error(err.message || '保存失败');
      } finally {
        toggle.disabled = false;
      }
    });

    // 操作按钮
    this.on(document, 'click', async (e) => {
      const btn = e.target.closest('[data-pt]');
      if (!btn) return;
      if (!document.getElementById('pt-list')) return;

      const act = btn.dataset.pt;
      const orig = btn.innerHTML;

      if (act === 'apply') {
        if (!confirm('应用补丁会关闭 Qoder、覆盖 bundle，需要管理员权限。\n\n继续？')) return;
        btn.disabled = true;
        btn.innerHTML = '应用中…';
        try {
          await actions.applyPatches();
          await actions.loadStatus();
          toast.success('补丁已应用，请重启 Qoder IDE');
        } catch (err) {
          toast.error(err.message || '应用失败');
        } finally {
          btn.disabled = false;
          btn.innerHTML = orig;
        }
        return;
      }

      if (act === 'revert') {
        if (!confirm('回滚会把补丁全部还原为官方版本，并重新打开自动更新。\n\n继续？')) return;
        btn.disabled = true;
        btn.innerHTML = '回滚中…';
        try {
          await actions.revertPatches();
          await actions.loadStatus();
          toast.success('已回滚，请重启 Qoder IDE');
        } catch (err) {
          toast.error(err.message || '回滚失败');
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
          await actions.loadStatus();
          toast.success('状态已刷新');
        } catch (err) {
          toast.error(err.message || '刷新失败');
        } finally {
          btn.disabled = false;
          btn.innerHTML = orig;
        }
      }
    });
  },

  destroy() {
    unbindAll(this);
    this.unsubscribeFunctions.forEach((fn) => fn());
    this.unsubscribeFunctions = [];
  },
};
