/**
 * Qoder BYOK 控制台 - API 层
 * 统一封装 22 个 HTTP 接口，处理错误、加载状态
 */

const API_BASE = '';

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/**
 * 请求超时。以前完全没有超时，于是出现这个现象：
 * 打开「选择目录」对话框时，服务端在 spawnSync 里阻塞最长 300 秒，
 * 期间 5 秒一次的状态轮询全部挂在 TCP 队列里，对话框关掉后界面会
 * 一次性涌出十几个过期响应，表现为卡顿好几秒。
 * 现在按端点给不同上限：慢接口（挑目录 / 同步 / 应用补丁）单独放宽，
 * 其余 15 秒；轮询类调用方自己用短超时。
 */
const TIMEOUTS = {
  '/api/pick-folder': 320000,
  '/api/sync': 120000,
  '/api/apply': 30000,
  '/api/revert': 30000,
  '/api/import': 120000,
  '/api/test': 60000,
  '/api/status': 15000,
};
const DEFAULT_TIMEOUT = 20000;

async function request(path, options = {}) {
  const { method = 'GET', body, headers = {}, timeout } = options;

  const config = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };

  if (body && method !== 'GET') {
    config.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const ms = timeout !== undefined ? timeout : (TIMEOUTS[path] || DEFAULT_TIMEOUT);
  const ctl = ms > 0 ? new AbortController() : null;
  if (ctl) config.signal = ctl.signal;
  const timer = ctl ? setTimeout(() => ctl.abort(), ms) : null;

  try {
    const response = await fetch(`${API_BASE}${path}`, config);
    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(
        data.error || data.message || `HTTP ${response.status}`,
        response.status,
        data
      );
    }

    return data;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    if (error.name === 'AbortError') {
      throw new ApiError(`请求超时（${Math.round(ms / 1000)} 秒）：${path}`, 0, null);
    }
    throw new ApiError(error.message || 'Network error', 0, null);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ==================== 状态 ====================
export const getStatus = () => request('/api/status');

// ==================== 模型 ====================
/** 拉模型列表。传 profile = 该上游配置的网关；不传 = 当前生效上游 */
export const getModels = (profile) =>
  request('/api/models' + (profile ? `?profile=${encodeURIComponent(profile)}` : ''));

// ==================== 上游配置 ====================
export const getProfiles = () => request('/api/profiles');

export const saveProfile = (data) =>
  request('/api/profiles/save', { method: 'POST', body: data });

export const applyProfile = (name) =>
  request('/api/profiles/apply', { method: 'POST', body: { name } });

export const deleteProfile = (name) =>
  request('/api/profiles/delete', { method: 'POST', body: { name } });

// ==================== 模型切换 ====================
export const syncRecord = () => request('/api/sync', { method: 'POST' });

export const testUpstream = () => request('/api/test', { method: 'POST' });

// ==================== IDE ====================
export const setIdeProxy = (port) =>
  request('/api/ide-proxy', { method: 'POST', body: { port } });

export const shutdown = () => request('/api/shutdown', { method: 'POST' });

// ==================== 补丁 ====================
export const updatePatches = (patches) =>
  request('/api/patches', { method: 'POST', body: { patches } });

export const applyPatches = () => request('/api/apply', { method: 'POST' });

export const getApplyStatus = () => request('/api/apply-status');

export const revertPatches = () => request('/api/revert', { method: 'POST' });

export const getRevertStatus = () => request('/api/revert-status');

// ==================== 工具 ====================
export const setTools = (injectTools) =>
  request('/api/tools', { method: 'POST', body: { injectTools } });

// ==================== 配置 ====================
export const updateConfig = (data) =>
  request('/api/config', { method: 'POST', body: data });

export const exportConfig = () => request('/api/export');

export const importConfig = (data) =>
  request('/api/import', { method: 'POST', body: data });

/** 一键修复环境：起代理 → 同步模型记录 → 设置 IDE 代理（会改 IDE 设置！）*/
export const init = () => request('/api/init', { method: 'POST' });

// ==================== 首次引导 ====================
export const markSetupDone = () => request('/api/setup/done', { method: 'POST' });

export const resetSetup = () => request('/api/setup/reset', { method: 'POST' });

// ==================== 日志 ====================
export const getLogs = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return request(`/api/logs${query ? `?${query}` : ''}`);
};

export const clearLogs = (src = 'proxy') =>
  request('/api/logs/clear', { method: 'POST', body: { src } });

// ==================== Qoder 安装目录 ====================
export const pickFolder = (initial) =>
  request('/api/pick-folder', { method: 'POST', body: { initial } });

export const detectIde = (root) =>
  request('/api/ide-detect', { method: 'POST', body: root === undefined ? {} : { root } });

// ==================== 代理 ====================
export const proxyAction = (action) =>
  request('/api/proxy', { method: 'POST', body: { action } });

export { ApiError };
