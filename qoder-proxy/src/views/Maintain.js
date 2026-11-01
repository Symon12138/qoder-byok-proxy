/**
 * Qoder BYOK 控制台 - 维护
 *
 * 职责边界（避免与「补丁管理」重复）：
 *   - 补丁的应用/回滚在「补丁管理」，本视图不重复
 *   - 本视图只做：环境修复、代理重启、模型记录同步、配置备份、退出服务
 */

import { state, actions, subscribe } from '../store.js';
import { Card, Badge, Icon } from '../components.js';
import { bindAll, unbindAll } from '../view-bind.js';
import toast from '../toast.js';
import * as api from '../api.js';

export default {
  unsubscribeFunctions: [],

  async render(container) {
    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-header__title">维护</h1>
        <p class="page-header__desc">环境修复、配置备份、退出服务</p>
      </div>

      <div id="mt-env" class="mb-5"></div>

      <div class="grid grid--2">
        <div id="mt-config"></div>
        <div id="mt-danger"></div>
      </div>
    `;

    this.renderEnv();
    this.renderConfig();
    this.renderDanger();
    this.setupSubscriptions();
  },

  setupSubscriptions() {
    this.unsubscribeFunctions.forEach((fn) => fn());
    this.unsubscribeFunctions = [];
    const unsub = subscribe('status', () => {
      this.renderEnv();
    });
    this.unsubscribeFunctions.push(unsub);
  },

  renderEnv() {
    const el = document.getElementById('mt-env');
    if (!el) return;
    const st = state.status;
    const p = st?.patches;

    // 两列共用一个网格，标签用 max-content 轨道统一宽度，值才会左对齐。
    // 补丁状态用徽章，一眼能区分「已应用 / 缺失」。
    const okBadge = (on) => Badge({ text: on ? '已应用' : '缺失', variant: on ? 'success' : 'danger' });

    const cert = st?.cert || {};
    const certBadge = cert.trusted
      ? Badge({ text: '已信任', variant: 'success' })
      : (cert.exists
        ? Badge({ text: '未信任', variant: 'danger' })
        : Badge({ text: '未生成', variant: 'warning' }));

    const left = [
      {
        label: '本地代理',
        value: st?.proxy?.running
          ? Badge({ text: `运行中 :${st.proxy.port}`, variant: 'success' })
          : Badge({ text: '已停止', variant: 'danger' }),
      },
      { label: 'IDE 代理', value: st?.ide?.httpProxy ? `<code>${st.ide.httpProxy}</code>` : '未设置（直连）' },
      { label: '当前模型', value: st?.config?.upstream?.displayName || '未配置' },
      { label: '代理证书', value: certBadge },
    ];
    const right = [
      { label: 'BYOK 补丁', value: okBadge(p?.byok) },
      { label: '专家团', value: okBadge(p?.experts) },
      { label: '实时模型名', value: okBadge(p?.live) },
      { label: 'RepoWiki', value: okBadge(p?.repowiki) },
    ];

    const rows = Math.max(left.length, right.length);
    const cells = [];
    for (let i = 0; i < rows; i++) {
      cells.push(`<span class="kv-grid__label">${left[i] ? left[i].label : ''}</span>`);
      cells.push(`<span class="kv-grid__value">${left[i] ? left[i].value : ''}</span>`);
      cells.push(`<span class="kv-grid__label kv-grid__label--group">${right[i] ? right[i].label : ''}</span>`);
      cells.push(`<span class="kv-grid__value">${right[i] ? right[i].value : ''}</span>`);
    }

    el.innerHTML = Card({
      title: '环境状态',
      icon: Icon.pulse,
      iconVariant: 'accent',
      subtitle: '代理、IDE 指向、模型记录、补丁',
      children: `
        <div class="kv-grid">${cells.join('')}</div>
        <div class="text-xs text-muted mt-4">
          「一键修复环境」会依次：启动代理 → 同步模型记录 → <b>把 IDE 指向代理</b>。注意它会修改 IDE 的 http.proxy。
          补丁的应用/回滚请到「补丁管理」。
        </div>
      `,
      footer: `
        <div class="btn-group">
          <button class="btn btn--primary" data-mt="repair">一键修复环境</button>
          <button class="btn" data-mt="restart-proxy">重启代理</button>
          <button class="btn btn--ghost" data-mt="sync">同步模型记录</button>
          <button class="btn btn--ghost" data-mt="reset-setup" title="让「状态概览」重新显示首次引导">重新运行引导</button>
        </div>
        ${cert.trusted ? '' : `
        <div class="mt-4 p-3" style="background:var(--surface-2);border-radius:var(--radius-md)">
          <div class="text-sm" style="margin-bottom:8px">
            <strong>代理证书未被信任</strong>：Qoder 会因证书校验失败连不上本代理。
            点下面按钮，Windows 会弹一次安全警告，选「是」即可（不需要管理员）。
          </div>
          <button class="btn btn--primary" data-mt="trust-cert">信任证书</button>
        </div>`}
      `,
    });
  },

  renderConfig() {
    const el = document.getElementById('mt-config');
    if (!el) return;

    el.innerHTML = Card({
      title: '配置备份',
      icon: Icon.download,
      iconVariant: 'info',
      subtitle: '导出当前全部配置，或从文件恢复',
      children: `
        <div class="flex items-center gap-3 flex-wrap">
          <button class="btn btn--primary" data-mt="export">导出配置</button>
          <button class="btn" data-mt="import">导入配置</button>
          <input type="file" id="mt-import-file" accept="application/json" style="display:none">
        </div>
        <div class="text-xs text-muted mt-3">
          导出包含上游配置、代理端口、补丁开关等。API Key 也会一并导出，注意保管。
        </div>
      `,
    });
  },

  renderDanger() {
    const el = document.getElementById('mt-danger');
    if (!el) return;

    el.innerHTML = Card({
      title: '退出服务',
      icon: Icon.power,
      iconVariant: 'danger',
      subtitle: '完整恢复到官方状态后再关闭',
      className: 'card--danger',
      children: `
        <p class="text-sm text-muted mb-3">
          会依次：清空 BYOK 模型记录 → 把各场景模型切回官方值 → 移除 http.proxy → 停止本地代理 → 关闭本控制台。
          完成后 Qoder 可正常直连官方。
        </p>
        <button class="btn btn--danger" data-mt="shutdown">退出服务</button>
      `,
    });
  },

  bindEvents() {
    bindAll(this);
    this.on(document, 'click', async (e) => {
      const btn = e.target.closest('[data-mt]');
      if (!btn) return;
      if (!document.getElementById('mt-env')) return;

      const act = btn.dataset.mt;
      const orig = btn.innerHTML;
      let busy = false;

      const lock = (label) => { busy = true; btn.disabled = true; btn.innerHTML = label; };
      const unlock = () => { busy = false; btn.disabled = false; btn.innerHTML = orig; };

      try {
        if (act === 'repair') {
          if (!confirm('一键修复会：启动代理 → 同步模型记录 → 把 IDE 指向代理。\n\n这会修改 IDE 的 http.proxy 设置，继续？')) return;
          lock('修复中…');
          const r = await api.init();
          const bad = (r.steps || []).filter((s) => !s.ok);
          if (bad.length === 0) toast.success('环境已修复');
          else toast.warning(`部分步骤未成功：${bad.map((s) => s.step).join('、')}`);
          await actions.loadStatus();
        } else if (act === 'restart-proxy') {
          lock('重启中…');
          await api.proxyAction('stop');
          await new Promise((r) => setTimeout(r, 600));
          await api.proxyAction('start');
          await new Promise((r) => setTimeout(r, 1200));
          await actions.loadStatus();
          toast.success('代理已重启');
        } else if (act === 'sync') {
          lock('同步中…');
          await actions.syncRecord();
          toast.success('模型记录已同步');
        } else if (act === 'reset-setup') {
          await api.resetSetup();
          await actions.loadStatus();
          toast.success('已重置引导标记，「状态概览」会重新显示引导卡');
        } else if (act === 'trust-cert') {
          lock('等待确认…');
          try {
            const r = await api.trustCert();
            if (r.already) {
              await actions.loadStatus();
              toast.success('证书已在受信任根里，无需重复安装');
            } else {
              // 弹窗等用户点「是」，这里轮询到装好为止（最多约 3 分钟）
              let trusted = false;
              for (let i = 0; i < 90; i++) {
                await new Promise((res) => setTimeout(res, 2000));
                const c = await api.getCert();
                if (c.trusted) { trusted = true; break; }
              }
              await actions.loadStatus();
              if (trusted) toast.success('证书已信任，重启 Qoder 后生效');
              else toast.warning('没检测到信任完成。若弹窗被关掉，可再点一次「信任证书」');
            }
          } catch (err) {
            toast.error(err.message || '安装证书失败');
          }
        } else if (act === 'export') {
          lock('导出中…');
          const data = await api.exportConfig();
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `qoder-byok-config-${new Date().toISOString().slice(0, 10)}.json`;
          a.click();
          URL.revokeObjectURL(url);
          toast.success('配置已导出');
        } else if (act === 'import') {
          document.getElementById('mt-import-file')?.click();
          return;
        } else if (act === 'shutdown') {
          if (!confirm('退出服务会恢复官方状态并关闭控制台。\n\n继续？')) return;
          await actions.shutdown();
          document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;line-height:1.9;font-size:15px;color:#94A3B8">服务已退出<br>Qoder 已恢复官方状态，可正常直连使用</div>';
          return;
        }
        unlock();
      } catch (err) {
        if (!busy) unlock();
        else unlock();
        toast.error(err.message || '操作失败');
      }
    });

    // 导入文件
    this.on(document, 'change', async (e) => {
      if (e.target.id !== 'mt-import-file') return;
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text);
        await api.importConfig(data);
        await actions.loadInitialData();
        toast.success('配置已导入');
      } catch (err) {
        toast.error(err.message || '导入失败：文件不是合法 JSON');
      }
      e.target.value = '';
    });
  },

  destroy() {
    unbindAll(this);
    this.unsubscribeFunctions.forEach((fn) => fn());
    this.unsubscribeFunctions = [];
  },
};
