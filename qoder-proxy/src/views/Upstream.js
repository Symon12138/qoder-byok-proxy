/**
 * Qoder BYOK 控制台 - 上游配置
 *
 * 职责边界：
 *   - 只管「单个上游」的字段：名称、Base URL、API Key、模型及其参数
 *   - 全局配置（代理端口、模型记录 ID、工具补全、RepoWiki 托管）在「系统设置」
 */

import { state, actions, subscribe } from '../store.js';
import { Card, Field, EmptyState, Icon } from '../components.js';
import { bindAll, unbindAll } from '../view-bind.js';
import toast from '../toast.js';
import * as api from '../api.js';

const EMPTY_FORM = {
  name: '',
  baseUrl: '',
  apiKey: '',
  model: '',
  displayName: '',
  reasoningEffort: '',
  maxTokens: '',
  contextLength: '',
  temperature: '',
  topP: '',
};

const LEVELS = [
  { value: '', label: '默认' },
  { value: 'low', label: '低 low' },
  { value: 'medium', label: '中 medium' },
  { value: 'high', label: '高 high' },
];

export default {
  unsubscribeFunctions: [],
  editing: null, // 正在编辑的 profile（null = 新建）
  apiKeyMasked: false,
  /** 当前表单可选的模型列表（按正在编辑的这套上游拉，不污染全局 state.models） */
  formModels: [],
  formSource: '__none__',

  async render(container) {
    this.editing = null;
    this.apiKeyMasked = false;
    this.formModels = [];
    this.formSource = '__none__';

    container.innerHTML = `
      <div class="page-header">
        <h1 class="page-header__title">上游配置</h1>
        <p class="page-header__desc">可以存多套配置，但同一时刻只有一套生效</p>
      </div>

      <div class="grid grid--sidebar">
        <div id="up-list"></div>
        <div id="up-form"></div>
      </div>
    `;

    await this.ensureFormModels('');
    this.renderList();
    this.renderForm();
    this.setupSubscriptions();
  },

  /** 按 profile 拉模型列表（'' = 当前生效上游）。同一来源不重复请求 */
  async ensureFormModels(profileName = '') {
    if (this.formSource === profileName && this.formModels.length) return this.formModels;
    try {
      const data = await api.getModels(profileName);
      this.formModels = data.models || [];
      this.formSource = profileName;
    } catch {
      this.formModels = [];
      this.formSource = profileName;
    }
    return this.formModels;
  },

  setupSubscriptions() {
    this.unsubscribeFunctions.forEach((fn) => fn());
    this.unsubscribeFunctions = [];
    const unsub = subscribe('profiles', () => {
      this.renderList();
    });
    const unsub2 = subscribe('status', () => {
      this.renderList();
    });
    this.unsubscribeFunctions.push(unsub, unsub2);
  },

  renderList() {
    const el = document.getElementById('up-list');
    if (!el) return;

    const list = state.profiles || [];
    const active = state.activeProfile || state.status?.config?.activeProfile || '';

    if (!list.length) {
      el.innerHTML = Card({
        title: '上游列表',
      icon: Icon.settings,
      iconVariant: 'info',
        children: EmptyState({
          icon: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>',
          title: '还没有上游配置',
          desc: '点右下角「新建」添加第一套',
        }),
        footer: `<button class="btn btn--primary" data-up="new">新建上游</button>`,
      });
      return;
    }

    el.innerHTML = Card({
      title: '上游列表',
      icon: Icon.settings,
      iconVariant: 'info',
      subtitle: `${list.length} 套配置 · 当前生效：${active || '无'}`,
      children: `
        <div class="flex flex-col gap-2">
          ${list.map((p) => {
            const isActive = p.active || p.name === active;
            const isEditing = this.editing?.name === p.name;
            return `
            <div class="up-item ${isActive ? 'active' : ''} ${isEditing ? 'is-editing' : ''}" data-up-edit="${this.esc(p.name)}" title="点击编辑">
              <div class="up-main">
                <div class="up-name">${this.esc(p.name)}</div>
                <div class="up-meta" title="${this.esc(p.baseUrl || '')}">${this.esc(p.model || '未选模型')}</div>
              </div>
              <div class="up-ops">
                ${isActive
                  ? `<span class="badge badge--success"><span class="badge__dot"></span>当前</span>`
                  : `<button class="btn btn--sm" data-up-activate="${this.esc(p.name)}">设为当前</button>`}
                <button class="btn btn--sm btn--ghost" data-up-delete="${this.esc(p.name)}" title="删除">删除</button>
              </div>
            </div>`;
          }).join('')}
        </div>
      `,
      footer: `
        <div class="btn-group">
          <button class="btn btn--ghost" data-up="refresh">刷新列表</button>
          <button class="btn btn--primary" data-up="new">新建上游</button>
        </div>
      `,
    });
  },

  renderForm() {
    const el = document.getElementById('up-form');
    if (!el) return;

    const isNew = !this.editing;
    const v = this.editing ? Object.assign({}, EMPTY_FORM, this.editing) : Object.assign({}, EMPTY_FORM);

    // API 不回传明文 key，只回传 apiKeySet
    this.apiKeyMasked = !isNew && !!this.editing.apiKeySet && !v.apiKey;

    const models = this.formModels || [];
    const picked = models.find((m) => m.id === v.model) || null;
    const inList = !v.model || models.some((m) => m.id === v.model);
    // 有些模型显示名重复（如两个 GPT-6.1 Sol），重名的补上 id 以便区分
    const nameCount = {};
    models.forEach((m) => { const n = m.name || m.id; nameCount[n] = (nameCount[n] || 0) + 1; });
    const label = (m) => {
      const n = m.name || m.id;
      const dup = nameCount[n] > 1;
      return `${n}${dup ? `（${m.id}）` : ''}`;
    };
    // 思考等级：优先用选中模型支持的档位，否则给通用几档
    const levelOptions = (picked && Array.isArray(picked.levels) && picked.levels.length)
      ? [{ value: '', label: '关闭' }, ...picked.levels.map((l) => ({ value: l, label: l }))]
      : LEVELS;
    const caps = picked
      ? [
          picked.vision ? '图片' : '',
          picked.reasoning ? '推理' : '',
          picked.tools ? '工具' : '',
        ].filter(Boolean).join(' / ')
      : '';

    el.innerHTML = Card({
      title: isNew ? '新建上游' : `编辑「${this.esc(v.name)}」`,
      subtitle: isNew ? '填好后保存，会立即生效' : '保存后立即生效并同步模型记录',
      icon: Icon.settings,
      iconVariant: 'info',
      children: `
        <form id="up-form-el" class="flex flex-col gap-4" autocomplete="off">
          <div class="form-grid form-grid--2">
            ${Field({ label: '名称', name: 'name', value: this.esc(v.name), placeholder: '例如：本地网关', required: true })}
            ${Field({ label: 'Base URL', name: 'baseUrl', value: this.esc(v.baseUrl), placeholder: 'http://127.0.0.1:3425/v1', required: true })}
          </div>

          <div class="form-grid form-grid--2">
            ${Field({
              label: 'API Key',
              name: 'apiKey',
              type: 'password',
              value: '',
              placeholder: this.apiKeyMasked ? '已保存（留空则不修改）' : 'sk-...',
              hint: this.apiKeyMasked ? '出于安全不回显已保存的 Key' : '',
            })}

            <div class="field">
              <label class="field__label" for="up-model">模型 <span style="color:var(--color-danger)">*</span></label>
              ${models.length ? `
                <select class="field__select" id="up-model" name="model">
                  ${!v.model ? '<option value="" selected>— 请选择 —</option>' : ''}
                  ${inList ? '' : `<option value="${this.esc(v.model)}" selected>${this.esc(v.model)}（不在当前列表）</option>`}
                  ${models.map((m) => `<option value="${this.esc(m.id)}" ${m.id === v.model ? 'selected' : ''}>${this.esc(label(m))}</option>`).join('')}
                  <option value="__custom__">＋ 手动输入模型 ID…</option>
                </select>
                <input class="field__input" id="up-model-custom" name="modelCustom" placeholder="输入模型 ID"
                       style="display:none;margin-top:6px">
              ` : `
                <input class="field__input" id="up-model" name="model" value="${this.esc(v.model)}"
                       placeholder="例如：wb/cn:glm-5.3" required>
              `}
              <p class="field__hint" id="up-model-hint">
                ${models.length
                  ? `${models.length} 个可用模型${caps ? ` · 当前支持 ${caps}` : ''}`
                  : '还没拉到模型列表。先填 Base URL 和 API Key，再点下方「刷新网关模型」'}
              </p>
            </div>
          </div>

          <div class="form-grid form-grid--3">
            ${Field({ label: '界面显示名', name: 'displayName', value: this.esc(v.displayName), placeholder: '留空则用模型 ID', hint: '换模型时会自动跟随模型名' })}
            ${Field({ label: '思考等级', name: 'reasoningEffort', type: 'select', value: v.reasoningEffort || '', options: levelOptions, hint: '仅当 Qoder 请求未指定档位时生效' })}
            ${Field({ label: '输出上限 max_tokens', name: 'maxTokens', type: 'number', value: v.maxTokens ?? '', placeholder: '留空跟随网关' })}
          </div>

          <div class="form-grid form-grid--3">
            ${Field({ label: '上下文长度', name: 'contextLength', type: 'number', value: v.contextLength ?? '', placeholder: '留空跟随网关' })}
            ${Field({ label: 'temperature', name: 'temperature', type: 'number', value: v.temperature ?? '', placeholder: '留空不发送' })}
            ${Field({ label: 'top_p', name: 'topP', type: 'number', value: v.topP ?? '', placeholder: '留空不发送' })}
          </div>
        </form>
      `,
      footer: `
        <div class="btn-group btn-group--between">
          <div class="btn-group">
            <button class="btn btn--ghost" data-up="test">测试连通性</button>
            <button class="btn btn--ghost" data-up="reload-models">刷新网关模型</button>
          </div>
          <div class="btn-group">
            ${isNew ? '' : '<button class="btn btn--ghost" data-up="cancel">取消编辑</button>'}
            <button class="btn btn--primary" data-up="save">${isNew ? '创建并启用' : '保存并生效'}</button>
          </div>
        </div>
      `,
    });
  },

  esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  bindEvents() {
    bindAll(this);
    // 选/改模型 → 自动带出该模型的默认参数（只填没被手动改过的空值）
    this.on(document, 'change', (e) => {
      if (e.target.id !== 'up-model' && e.target.id !== 'up-model-custom') return;
      if (!document.getElementById('up-form-el')) return;

      // 选了「手动输入」→ 露出输入框
      if (e.target.id === 'up-model' && e.target.value === '__custom__') {
        const custom = document.getElementById('up-model-custom');
        if (custom) {
          custom.style.display = '';
          custom.value = '';
          custom.focus();
        }
        const hint = document.getElementById('up-model-hint');
        if (hint) hint.textContent = '输入完整的模型 ID，例如 wb/cn:glm-5.3';
        return;
      }

      const customEl = document.getElementById('up-model-custom');
      const selEl = document.getElementById('up-model');
      const id = (e.target.id === 'up-model-custom'
        ? e.target.value
        : (selEl && selEl.value === '__custom__' ? (customEl ? customEl.value : '') : (selEl ? selEl.value : ''))
      ).trim();
      const m = (this.formModels || []).find((x) => x.id === id) || null;
      const hint = document.getElementById('up-model-hint');
      const form = document.getElementById('up-form-el');
      if (!form) return;

      if (!m) {
        if (hint) {
          hint.textContent = id
            ? `「${id}」不在当前网关列表里（可能是手填的，或列表没刷新）。仍可保存。`
            : '请填写模型 ID';
        }
        return;
      }

      const ctxEl = form.querySelector('[name="contextLength"]');
      const outEl = form.querySelector('[name="maxTokens"]');
      const nameEl = form.querySelector('[name="displayName"]');
      const lvEl = form.querySelector('[name="reasoningEffort"]');

      if (ctxEl && m.context) ctxEl.value = m.context;
      if (outEl && m.output) outEl.value = m.output;

      // 显示名跟着模型走：换模型就刷成该模型的名字。
      if (nameEl) nameEl.value = m.name || id;

      const levels = Array.isArray(m.levels) ? m.levels : [];
      if (lvEl) {
        const prev = lvEl.value;
        if (levels.length) {
          lvEl.innerHTML = `<option value="">关闭</option>${levels.map((l) => `<option value="${this.esc(l)}">${this.esc(l)}</option>`).join('')}`;
          lvEl.value = levels.includes(prev) ? prev : levels[0];
          lvEl.disabled = false;
        } else {
          lvEl.innerHTML = '<option value="">该模型不支持</option>';
          lvEl.value = '';
          lvEl.disabled = true;
        }
      }

      const caps = [m.vision ? '图片' : '', m.reasoning ? '推理' : '', m.tools ? '工具' : ''].filter(Boolean).join(' / ');
      if (hint) {
        hint.textContent = `上下文 ${m.context ? m.context.toLocaleString() : '未知'} · 输出 ${m.output ? m.output.toLocaleString() : '未知'}${caps ? ` · 支持 ${caps}` : ''}`;
      }
    });

    this.on(document, 'click', async (e) => {
      const el = e.target.closest('[data-up], [data-up-edit], [data-up-activate], [data-up-delete]');
      if (!el) return;
      if (!document.getElementById('up-list')) return; // 不在本视图

      // 编辑
      if (el.dataset.upEdit !== undefined) {
        const name = el.dataset.upEdit;
        const p = state.profiles.find((x) => x.name === name);
        if (!p) return;
        this.editing = p;
        await this.ensureFormModels(name);
        this.renderForm();
        this.renderList();
        return;
      }

      // 设为当前
      if (el.dataset.upActivate !== undefined) {
        e.stopPropagation();
        const name = el.dataset.upActivate;
        const orig = el.innerHTML;
        el.disabled = true;
        el.innerHTML = '切换中…';
        try {
          await actions.applyProfile(name);
          toast.success(`已切换到「${name}」`);
        } catch (err) {
          toast.error(err.message || '切换失败');
          el.disabled = false;
          el.innerHTML = orig;
        }
        return;
      }

      // 删除
      if (el.dataset.upDelete !== undefined) {
        e.stopPropagation();
        const name = el.dataset.upDelete;
        if ((state.profiles || []).length <= 1) {
          toast.warning('至少要保留一套上游配置');
          return;
        }
        if (!confirm(`删除上游「${name}」？\n\n若它正在生效，删除后当前设置不变但仍建议检查。`)) return;
        const orig = el.innerHTML;
        el.disabled = true;
        el.innerHTML = '删除中…';
        try {
          await actions.deleteProfile(name);
          if (this.editing?.name === name) {
            this.editing = null;
            this.renderForm();
          }
          toast.success(`已删除「${name}」`);
        } catch (err) {
          toast.error(err.message || '删除失败');
          el.disabled = false;
          el.innerHTML = orig;
        }
        return;
      }

      // 底部/空态按钮
      const act = el.dataset.up;
      if (!act) return;

      if (act === 'new') {
        this.editing = null;
        this.renderForm();
        this.renderList();
        return;
      }
      if (act === 'cancel') {
        this.editing = null;
        this.renderForm();
        this.renderList();
        return;
      }
      if (act === 'refresh') {
        try {
          await actions.loadProfiles();
          toast.success('列表已刷新');
        } catch (err) {
          toast.error(err.message || '刷新失败');
        }
        return;
      }
      if (act === 'reload-models') {
        el.disabled = true;
        const orig = el.innerHTML;
        el.innerHTML = '刷新中…';
        try {
          // 强制重新拉：按正在编辑的这套上游
          this.formSource = '__none__';
          await this.ensureFormModels(this.editing?.name || '');
          this.renderForm();
          if (this.formModels.length) toast.success(`已加载 ${this.formModels.length} 个模型`);
          else toast.warning('没拉到模型，检查 Base URL 和 API Key');
        } catch (err) {
          toast.error(err.message || '加载失败');
        } finally {
          el.disabled = false;
          el.innerHTML = orig;
        }
        return;
      }
      if (act === 'test') {
        el.disabled = true;
        const orig = el.innerHTML;
        el.innerHTML = '测试中…';
        try {
          const r = await actions.testUpstream();
          if (r.ok) toast.success(`连通正常（HTTP ${r.status}，${r.ms}ms）`);
          else toast.error(`连通失败：${r.error || 'HTTP ' + r.status}`);
        } catch (err) {
          toast.error(err.message || '测试失败');
        } finally {
          el.disabled = false;
          el.innerHTML = orig;
        }
        return;
      }
      if (act === 'save') {
        await this.handleSave(el);
      }
    });
  },

  async handleSave(btn) {
    const form = document.getElementById('up-form-el');
    if (!form) return;

    const fd = new FormData(form);
    const name = String(fd.get('name') || '').trim();
    const baseUrl = String(fd.get('baseUrl') || '').trim();
    const selModel = String(fd.get('model') || '').trim();
    const customModel = String(fd.get('modelCustom') || '').trim();
    const model = selModel === '__custom__' ? customModel : selModel;
    const apiKey = String(fd.get('apiKey') || '').trim();

    if (!name) return toast.error('请填写名称');
    if (!baseUrl) return toast.error('请填写 Base URL');
    if (!model) return toast.error('请填写模型 ID');

    const num = (k) => {
      const raw = String(fd.get(k) || '').trim();
      return raw === '' ? undefined : Number(raw);
    };

    const upstream = {
      baseUrl,
      model,
      displayName: String(fd.get('displayName') || '').trim(),
      reasoningEffort: String(fd.get('reasoningEffort') || '').trim() || undefined,
      maxTokens: num('maxTokens'),
      contextLength: num('contextLength'),
      temperature: num('temperature'),
      topP: num('topP'),
    };

    // 只有填了 key 才提交，否则沿用已保存的
    if (apiKey) upstream.apiKey = apiKey;

    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '保存中…';

    try {
      await actions.saveProfile({ name, upstream, activate: true });
      this.editing = null;
      this.apiKeyMasked = false;
      this.formSource = '__none__';
      await actions.loadProfiles();
      this.renderForm();
      this.renderList();
      toast.success(`已保存「${name}」并启用`);
    } catch (err) {
      toast.error(err.message || '保存失败');
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  },

  destroy() {
    unbindAll(this);
    this.unsubscribeFunctions.forEach((fn) => fn());
    this.unsubscribeFunctions = [];
    this.editing = null;
  },
};
