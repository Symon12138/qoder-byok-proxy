/**
 * Qoder BYOK 控制台 - 系统设置
 *
 * 职责边界：
 *   - 本视图只放「全局配置」：对所有上游生效的设置
 *   - 单个上游的字段（baseUrl/apiKey/model/…）属于「上游配置」
 *   - 日志清空属于「日志」视图
 *   - 需要提权/破坏性的操作（应用补丁、回滚、导出导入、一键修复）属于「维护」
 */

import { state, actions, subscribe } from '../store.js';
import { Card, Field, Icon } from '../components.js';
import { bindAll, unbindAll } from '../view-bind.js';
import toast from '../toast.js';
import * as api from '../api.js';

export default {
  unsubscribeFunctions: [],

  async render(container) {
    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-header__title">系统设置</h1>
        <p class="page-header__desc">对所有上游生效的全局配置</p>
      </div>

      <div id="set-ide" class="mb-5"></div>
      <div id="set-switches" class="mb-5"></div>
      <div id="set-global"></div>
    `;

    this.renderIde();
    this.renderSwitches();
    this.renderGlobal();
    this.setupSubscriptions();
  },

  setupSubscriptions() {
    this.unsubscribeFunctions.forEach((fn) => fn());
    this.unsubscribeFunctions = [];
    this.unsubscribeFunctions.push(
      subscribe('status', () => {
        this.renderIde();
        this.renderSwitches();
        this.renderGlobal();
      })
    );
  },

  /* ---------- Qoder 安装目录（首次运行自动探测，可手动改） ---------- */
  renderIde() {
    const el = document.getElementById('set-ide');
    if (!el) return;

    const st = state.status;
    if (!st) {
      el.innerHTML = Card({ title: 'Qoder 安装目录', icon: Icon.box, iconVariant: 'warning', children: '<div class="skeleton skeleton--text" style="width:100%"></div>' });
      return;
    }

    const ide = st.ide || {};
    const ok = ide.bundleWb && ide.bundleAw;
    const root = ide.root || '(未检测到)';

    el.innerHTML = Card({
      title: 'Qoder 安装目录',
      subtitle: '补丁写到哪里 —— 装错目录会导致「显示已应用但界面没反应」',
      icon: Icon.box,
      iconVariant: ok ? 'accent' : 'danger',
      children: `
        <div class="flex flex-col gap-3">
          <div class="flex items-start justify-between gap-4">
            <div style="flex:1;min-width:0">
              <div class="text-xs text-muted">当前使用</div>
              <div class="mt-1" style="font-family:var(--font-mono);font-size:13px;word-break:break-all">${root}</div>
            </div>
            <span class="badge ${ok ? 'badge--success' : 'badge--danger'}">
              <span class="badge__dot"></span>${ok ? '可用' : '缺 bundle'}
            </span>
          </div>

          <div class="flex flex-wrap gap-2">
            <span class="chip">版本 ${ide.version || '未知'}</span>
            <span class="chip">${ide.source === 'config' ? '已手动指定' : '自动探测'}</span>
            <span class="chip">workbench ${ide.bundleWb ? '✓' : '✗'}</span>
            <span class="chip">agents-window ${ide.bundleAw ? '✓' : '✗'}</span>
          </div>

          <hr class="divider" style="margin:0">

          <div class="field" style="margin:0">
            <label class="field__label" for="f-ideRoot">安装目录</label>
            <div class="flex gap-2">
              <input class="field__input" id="f-ideRoot" name="ideRoot" value="${ide.configured || ''}" placeholder="留空 = 每次自动探测" style="flex:1;min-width:0">
              <button class="btn btn--ghost" type="button" data-ide-act="pick" style="flex:none">${Icon.box}<span>选择目录…</span></button>
            </div>
            <p class="field__hint">必须包含 resources\\app\\out\\vs\\workbench\\workbench.desktop.main.js</p>
          </div>
        </div>
      `,
      footer: `
        <div class="btn-group btn-group--end">
          <button class="btn btn--ghost" data-ide-act="detect">${Icon.refresh}<span>重新探测</span></button>
          <button class="btn btn--primary" data-ide-act="save">${Icon.save}<span>保存路径</span></button>
        </div>
      `,
    });
  },

  /* ---------- 真正可控的开关 ---------- */
  renderSwitches() {
    const el = document.getElementById('set-switches');
    if (!el) return;

    const st = state.status;
    if (!st) {
      el.innerHTML = Card({ title: '功能开关', icon: Icon.sliders, iconVariant: 'violet', children: '<div class="skeleton skeleton--text" style="width:100%"></div>' });
      return;
    }

    const injectTools = st.config?.injectTools !== false;
    const serveWiki = st.config?.serveWiki !== false;

    el.innerHTML = Card({
      title: '功能开关',
      subtitle: '改完立即生效，不用保存',
      icon: Icon.sliders,
      iconVariant: 'violet',
      children: `
        <div class="flex flex-col gap-4">
          <div class="flex items-start justify-between gap-4">
            <div style="flex:1;min-width:0">
              <div style="font-weight:var(--weight-semibold)">工具补全</div>
              <div class="text-xs text-muted mt-1">模型不支持原生工具调用时，注入 Write/Bash 等工具说明，让它用纯文本调用工具</div>
            </div>
            <label class="switch">
              <input type="checkbox" class="switch__input" data-set="injectTools" ${injectTools ? 'checked' : ''}>
              <div class="switch__track"><div class="switch__thumb"></div></div>
            </label>
          </div>

          <hr class="divider" style="margin:0">

          <div class="flex items-start justify-between gap-4">
            <div style="flex:1;min-width:0">
              <div style="font-weight:var(--weight-semibold)">Wiki 用自定义模型生成</div>
              <div class="text-xs text-muted mt-1">「补丁管理」里的 RepoWiki 负责让 IDE 出现生成入口；这个开关负责生成时走你的上游而不是官方。生成会大量调模型，关掉可省额度</div>
            </div>
            <label class="switch">
              <input type="checkbox" class="switch__input" data-set="serveWiki" ${serveWiki ? 'checked' : ''}>
              <div class="switch__track"><div class="switch__thumb"></div></div>
            </label>
          </div>
        </div>
      `,
    });
  },

  /* ---------- 全局配置 ---------- */
  renderGlobal() {
    const el = document.getElementById('set-global');
    if (!el) return;

    const cfg = state.status?.config;
    if (!cfg) {
      el.innerHTML = Card({ title: '全局配置', icon: Icon.settings, iconVariant: 'muted', children: '<div class="skeleton skeleton--text" style="width:100%"></div>' });
      return;
    }

    el.innerHTML = Card({
      title: '全局配置',
      subtitle: '不随上游切换而改变',
      icon: Icon.settings,
      iconVariant: 'muted',
      children: `
        <form id="set-global-form" class="form-grid form-grid--2">
          ${Field({
            label: '代理端口',
            name: 'proxyPort',
            type: 'number',
            value: cfg.proxyPort || 8788,
            hint: '本地代理监听端口。改完需重启代理（维护 → 重启代理）',
          })}
          ${Field({
            label: '模型记录 ID',
            name: 'recordId',
            value: cfg.recordId || 'model_mocktest',
            hint: '写进 Qoder 自定义模型列表的那条记录的 ID',
          })}
        </form>
        <div class="text-xs text-muted mt-4">
          Qoder 同时只认<b>一个</b>自定义模型记录，所以同一时刻只有一个第三方模型在线。
        </div>
      `,
      footer: `
        <div class="btn-group btn-group--end">
          <button class="btn btn--ghost" data-set-act="reload">重新读取</button>
          <button class="btn btn--primary" data-set-act="save">${Icon.save}<span>保存</span></button>
        </div>
      `,
    });
  },

  bindEvents() {
    bindAll(this);
    // 功能开关：立即生效
    this.on(document, 'change', async (e) => {
      const input = e.target.closest('[data-set]');
      if (!input) return;
      if (!document.getElementById('set-switches')) return;

      const which = input.dataset.set;
      const on = input.checked;
      input.disabled = true;

      try {
        if (which === 'injectTools') {
          await api.setTools(on);
          toast.success(`工具补全已${on ? '开启' : '关闭'}`);
        } else if (which === 'serveWiki') {
          await api.updateConfig({ serveWiki: on });
          toast.success(`Wiki 用自定义模型已${on ? '开启' : '关闭'}`);
        }
        await actions.loadStatus();
      } catch (err) {
        input.checked = !on;
        toast.error(err.message || '保存失败');
      } finally {
        input.disabled = false;
      }
    });

    // Qoder 安装目录：重新探测 / 保存路径
    this.on(document, 'click', async (e) => {
      const btn = e.target.closest('[data-ide-act]');
      if (!btn) return;
      if (!document.getElementById('set-ide')) return;

      const act = btn.dataset.ideAct;
      const orig = btn.innerHTML;

      // 选择目录：后端弹原生文件夹选择框（浏览器拿不到真实绝对路径）
      if (act === 'pick') {
        btn.disabled = true;
        btn.innerHTML = '选择中…';
        try {
          const picked = await api.pickFolder(document.getElementById('f-ideRoot')?.value || undefined);
          if (picked && picked.ok && picked.path) {
            const r = await api.detectIde(picked.path);
            if (r && r.ok) {
              await actions.loadStatus();
              toast.success(`安装目录已改为：${picked.path}`);
            } else {
              toast.error((r && r.error) || '选中的目录里找不到 bundle');
            }
          } else if (picked && picked.cancelled) {
            toast.info('已取消选择');
          } else {
            toast.error((picked && picked.error) || '没能打开目录选择框，可直接在输入框里填路径');
          }
        } catch (err) {
          toast.error(err.message || '打开目录选择框失败');
        } finally {
          btn.disabled = false;
          btn.innerHTML = orig;
        }
        return;
      }

      btn.disabled = true;
      btn.innerHTML = act === 'detect' ? '探测中…' : '保存中…';

      try {
        let payload;
        if (act === 'detect') {
          payload = undefined;                       // 不带 root → 触发自动探测
        } else {
          payload = String(document.getElementById('f-ideRoot')?.value || '').trim();  // 空串 = 恢复自动
        }
        const r = await api.detectIde(payload);
        if (r && r.ok) {
          await actions.loadStatus();
          const shown = r.found || (r.info && r.info.root) || '';
          toast.success(act === 'save' ? `安装目录已保存：${shown}` : `已探测到：${shown}`);
        } else {
          toast.error((r && r.error) || '未找到 Qoder 安装目录');
        }
      } catch (err) {
        toast.error(err.message || '操作失败');
      } finally {
        btn.disabled = false;
        btn.innerHTML = orig;
      }
    });

    // 全局配置
    this.on(document, 'click', async (e) => {
      const btn = e.target.closest('[data-set-act]');
      if (!btn) return;
      if (!document.getElementById('set-global')) return;

      const act = btn.dataset.setAct;

      if (act === 'reload') {
        await actions.loadStatus();
        toast.success('已重新读取');
        return;
      }

      if (act === 'save') {
        const form = document.getElementById('set-global-form');
        if (!form) return;

        const fd = new FormData(form);
        const proxyPort = Number(fd.get('proxyPort'));
        const recordId = String(fd.get('recordId') || '').trim();

        if (!proxyPort || proxyPort < 1 || proxyPort > 65535) {
          toast.error('代理端口需在 1-65535 之间');
          return;
        }
        if (!recordId) {
          toast.error('模型记录 ID 不能为空');
          return;
        }

        const orig = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '保存中…';
        try {
          await api.updateConfig({ proxyPort, recordId });
          await actions.loadStatus();
          toast.success('全局配置已保存');
        } catch (err) {
          toast.error(err.message || '保存失败');
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
