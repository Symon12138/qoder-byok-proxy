/**
 * Qoder BYOK 控制台 - 响应式状态管理
 * 基于 Proxy + 发布订阅，自动同步 UI
 */

import * as api from './api.js';

// ==================== 响应式核心 ====================
function createStore(initialState) {
  const listeners = new Map();
  
  const state = new Proxy(initialState, {
    set(target, key, value) {
      const oldValue = target[key];
      target[key] = value;
      
      // 通知所有订阅者
      if (listeners.has(key)) {
        listeners.get(key).forEach((fn) => fn(value, oldValue));
      }
      
      // 通知通配符订阅者
      if (listeners.has('*')) {
        listeners.get('*').forEach((fn) => fn(key, value, oldValue));
      }
      
      return true;
    },
  });
  
  function subscribe(key, fn) {
    if (!listeners.has(key)) {
      listeners.set(key, new Set());
    }
    listeners.get(key).add(fn);
    
    // 返回取消订阅函数
    return () => listeners.get(key)?.delete(fn);
  }
  
  function unsubscribe(key, fn) {
    listeners.get(key)?.delete(fn);
  }
  
  return { state, subscribe, unsubscribe };
}

// ==================== 初始状态 ====================
const initialState = {
  // 状态数据
  status: null,
  models: [],
  modelsSource: '',
  modelsError: '',
  profiles: [],
  activeProfile: '',
  config: null,
  logs: [],
  
  // UI 状态
  loading: false,
  error: null,
  currentView: 'overview',
  sidebarCollapsed: false,
  
};

const { state, subscribe, unsubscribe } = createStore(initialState);

// ==================== Actions ====================
const actions = {
  // 批量加载初始数据
  // 关键：用 allSettled 而不是 all —— status 必须独立成立，
  // 否则 models/profiles 任一失败会让 status 也拿不到，
  // 导致刷新后状态概览整片空白（这是之前的真实 bug）。
  async loadInitialData() {
    state.loading = true;
    state.error = null;

    const [statusRes, modelsRes, profilesRes] = await Promise.allSettled([
      api.getStatus(),
      api.getModels(),
      api.getProfiles(),
    ]);

    if (statusRes.status === 'fulfilled') {
      state.status = statusRes.value;
    } else {
      state.error = statusRes.reason?.message || '状态加载失败';
    }

    if (modelsRes.status === 'fulfilled') {
      state.models = modelsRes.value.models || [];
    }

    if (profilesRes.status === 'fulfilled') {
      // 注意：/api/profiles 返回的字段是 list（不是 profiles），之前读错导致列表永远为空
      state.profiles = profilesRes.value.list || [];
      state.activeProfile = profilesRes.value.active || '';
    }

    // 只要状态拿到了就说明连得上，清掉旧错误
    if (statusRes.status === 'fulfilled') state.error = '';

    state.loading = false;
    return { statusRes, modelsRes, profilesRes };
  },
  
  // 加载状态
  async loadStatus() {
    try {
      state.loading = true;
      state.error = null;
      const data = await api.getStatus();
      state.status = data;
      return data;
    } catch (error) {
      state.error = error.message;
      throw error;
    } finally {
      state.loading = false;
    }
  },
  
  // 加载模型（profile 为空 = 当前生效上游）
  async loadModels(profile = '') {
    try {
      const data = await api.getModels(profile);
      state.models = data.models || [];
      state.error = '';
      state.modelsSource = data.source || profile || '';
      state.modelsError = data.ok === false ? data.error || '拉取失败' : '';
      return state.models;
    } catch (error) {
      state.modelsError = error.message;
      state.error = error.message;
      throw error;
    }
  },
  
  // 加载上游列表
  async loadProfiles() {
    try {
      const data = await api.getProfiles();
      state.profiles = data.list || [];
      state.activeProfile = data.active || '';
      return state.profiles;
    } catch (error) {
      state.error = error.message;
      throw error;
    }
  },
  
  // 保存上游
  async saveProfile(profileData) {
    try {
      state.loading = true;
      const result = await api.saveProfile(profileData);
      await actions.loadProfiles();
      await actions.loadStatus();
      return result;
    } catch (error) {
      state.error = error.message;
      throw error;
    } finally {
      state.loading = false;
    }
  },
  
  // 切换上游
  async applyProfile(name) {
    try {
      state.loading = true;
      const result = await api.applyProfile(name);
      await actions.loadProfiles();
      await actions.loadStatus();
      await actions.loadModels();
      return result;
    } catch (error) {
      state.error = error.message;
      throw error;
    } finally {
      state.loading = false;
    }
  },
  
  // 删除上游
  async deleteProfile(name) {
    try {
      const result = await api.deleteProfile(name);
      await actions.loadProfiles();
      await actions.loadStatus();
      return result;
    } catch (error) {
      state.error = error.message;
      throw error;
    }
  },
  
  // 切换模型

  
  // 设置 IDE 代理
  async setIdeProxy(port) {
    try {
      const result = await api.setIdeProxy(port);
      await actions.loadStatus();
      return result;
    } catch (error) {
      state.error = error.message;
      throw error;
    }
  },
  
  // 退出服务
  async shutdown() {
    try {
      const result = await api.shutdown();
      return result;
    } catch (error) {
      state.error = error.message;
      throw error;
    }
  },
  
  // 更新补丁开关
  async updatePatches(patches) {
    try {
      const result = await api.updatePatches(patches);
      await actions.loadStatus();
      return result;
    } catch (error) {
      state.error = error.message;
      throw error;
    }
  },
  
  // 应用补丁
  async applyPatches() {
    try {
      state.loading = true;
      const result = await api.applyPatches();
      
      // 轮询直到完成
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const status = await api.getApplyStatus();
        if (status.done) break;
      }
      
      await actions.loadStatus();
      return result;
    } catch (error) {
      state.error = error.message;
      throw error;
    } finally {
      state.loading = false;
    }
  },
  
  // 回滚补丁
  async revertPatches() {
    try {
      state.loading = true;
      const result = await api.revertPatches();
      
      // 轮询直到完成
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const status = await api.getRevertStatus();
        if (status.done) break;
      }
      
      await actions.loadStatus();
      return result;
    } catch (error) {
      state.error = error.message;
      throw error;
    } finally {
      state.loading = false;
    }
  },
  
  
  // 加载日志
  async loadLogs(params) {
    try {
      const data = await api.getLogs(params);
      state.logs = data.lines || [];
      return state.logs;
    } catch (error) {
      state.error = error.message;
      throw error;
    }
  },
  
  // 清空日志
  async clearLogs(src) {
    try {
      const result = await api.clearLogs(src);
      await actions.loadLogs({ src });
      return result;
    } catch (error) {
      state.error = error.message;
      throw error;
    }
  },
  
  // 同步记录
  async syncRecord() {
    try {
      const result = await api.syncRecord();
      await actions.loadStatus();
      return result;
    } catch (error) {
      state.error = error.message;
      throw error;
    }
  },
  
  // 测试上游
  async testUpstream() {
    try {
      return await api.testUpstream();
    } catch (error) {
      state.error = error.message;
      throw error;
    }
  },
  
  // 设置视图
  setView(viewName) {
    state.currentView = viewName;
  },
  
  // 切换侧边栏
  toggleSidebar() {
    state.sidebarCollapsed = !state.sidebarCollapsed;
  },
  
  
  
};

// ==================== 自动轮询 ====================
let pollTimer = null;
let isPolling = false;

function startPolling(interval = 5000) {
  if (isPolling) return;
  isPolling = true;
  
  const poll = async () => {
    // 用户正在输入时跳过
    const activeEl = document.activeElement;
    const isInputFocused = activeEl && ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeEl.tagName);
    
    if (!isInputFocused) {
      try {
        await actions.loadStatus();
      } catch (e) {
        // 静默失败
      }
    }
    
    pollTimer = setTimeout(poll, interval);
  };
  
  poll();
}

function stopPolling() {
  isPolling = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

// ==================== 导出 ====================
export {
  state,
  subscribe,
  unsubscribe,
  actions,
  startPolling,
  stopPolling,
};

export default {
  state,
  subscribe,
  unsubscribe,
  actions,
  startPolling,
  stopPolling,
};
