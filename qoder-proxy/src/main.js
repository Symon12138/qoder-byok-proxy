/**
 * Qoder BYOK 控制台 - 主入口
 * 初始化应用、加载视图、启动轮询
 */

import router from './router.js';
import { state, actions, subscribe, startPolling } from './store.js';
import toast from './toast.js';
import { Icon } from './components.js';

// ==================== 视图模块 ====================
import Overview from './views/Overview.js';
import Upstream from './views/Upstream.js';
import Patches from './views/Patches.js';
import Models from './views/Models.js';
import Logs from './views/Logs.js';
import Settings from './views/Settings.js';
import Maintain from './views/Maintain.js';
import FAQ from './views/FAQ.js';

// ==================== 应用初始化 ====================
/** 与侧边栏顺序一致，Alt+1..8 对应这些视图 */
const VIEW_ORDER = ['overview', 'upstream', 'models', 'patches', 'logs', 'settings', 'maintain', 'faq'];

class App {
  constructor() {
    this.sidebar = null;
    this.content = null;
  }
  
  async init() {
    // 获取容器
    this.sidebar = document.getElementById('sidebar');
    this.content = document.getElementById('content');
    
    if (!this.sidebar || !this.content) {
      console.error('App containers not found');
      return;
    }
    
    // 注册路由
    router.register('overview', Overview);
    router.register('upstream', Upstream);
    router.register('patches', Patches);
    router.register('models', Models);
    router.register('logs', Logs);
    router.register('settings', Settings);
    router.register('maintain', Maintain);
    router.register('faq', FAQ);
    
    // 渲染侧边栏
    this.renderSidebar();
    
    // 先加载数据，再渲染视图 —— 顺序反了会导致首屏渲染时 status 为 null，
    // 状态概览直接空白（刷新后"组件消失"就是这个原因）
    await this.loadInitialData();
    
    // 侧边栏高亮跟随当前视图（刷新、hash 变化、快捷键都会更新）
    subscribe('currentView', (v) => this.updateActiveItem(v));

    // 初始化路由
    router.init(this.content);
    this.updateActiveItem(state.currentView);
    
    // 绑定侧边栏事件
    this.bindSidebarEvents();
    
    // 全局快捷键：只在这里绑一次，不随视图切换重复绑定
    this.bindShortcuts();

    // 启动轮询
    startPolling(5000);
    
    // 监听状态变化，更新顶栏
    this.renderErrorBar();
    this.setupTopbarSync();
    subscribe('error', () => this.renderErrorBar());
  }
  
  renderSidebar() {
    const menuItems = [
      { id: 'overview', label: '状态概览', icon: Icon.chart },
      { id: 'upstream', label: '上游配置', icon: Icon.settings },
      { id: 'models',   label: '模型能力', icon: Icon.cpu },
      { id: 'patches',  label: '补丁管理', icon: Icon.zap },
      { id: 'logs',     label: '日志',     icon: Icon.file },
      { id: 'settings', label: '系统设置', icon: Icon.sliders },
      { id: 'maintain', label: '维护',     icon: Icon.tool },
      { id: 'faq',      label: '帮助',     icon: Icon.help },
    ];

    this.sidebar.innerHTML = `
      <div class="sidebar__logo">
        <div class="sidebar__logo-icon">${Icon.prompt}</div>
        <div class="sidebar__logo-text">
          <div class="sidebar__logo-title">Qoder BYOK</div>
          <div class="sidebar__logo-subtitle">控制台</div>
        </div>
      </div>

      <nav class="sidebar__nav">
        <div class="sidebar__section">
          <div class="sidebar__section-title">主菜单</div>
          ${menuItems.map((item) => `
            <button type="button" class="sidebar__item" data-view="${item.id}" title="${item.label}">
              <span class="sidebar__item-icon">${item.icon}</span>
              <span class="sidebar__item-text">${item.label}</span>
            </button>
          `).join('')}
        </div>
      </nav>

      <div class="sidebar__footer">
        <button type="button" class="sidebar__item" id="sidebar-collapse" title="收起侧边栏" aria-label="收起侧边栏">
          <span class="sidebar__item-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><polyline points="8 8 4 12 8 16"/><polyline points="16 8 20 12 16 16"/></svg>
          </span>
          <span class="sidebar__item-text">收起侧边栏</span>
        </button>
      </div>
    `;
  }

  bindSidebarEvents() {
    // 导航点击
    this.sidebar.addEventListener('click', (e) => {
      const item = e.target.closest('[data-view]');
      if (item) {
        const view = item.dataset.view;
        router.navigate(view);
        
        // 更新激活状态
        this.updateActiveItem(view);
      }
    });
    
    // 收起侧边栏
    document.getElementById('sidebar-collapse')?.addEventListener('click', () => {
      actions.toggleSidebar();
      this.updateSidebarCollapse();
    });
  }
  
  updateActiveItem(viewName) {
    this.sidebar.querySelectorAll('.sidebar__item').forEach(item => {
      item.classList.remove('sidebar__item--active');
    });
    
    const activeItem = this.sidebar.querySelector(`[data-view="${viewName}"]`);
    if (activeItem) {
      activeItem.classList.add('sidebar__item--active');
    }
  }
  

  /* ---------- 全局快捷键：只在 init 里绑一次 ---------- */
  bindShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;

      if (/^[1-8]$/.test(e.key)) {
        e.preventDefault();
        const view = VIEW_ORDER[Number(e.key) - 1];
        if (view) window.location.hash = view;
        return;
      }

      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        actions.toggleSidebar();
        this.updateSidebarCollapse();
      }
    });
  }

  /* ---------- 全局错误条 ---------- */
  renderErrorBar() {
    const el = document.getElementById('error-bar');
    if (!el) return;
    if (!state.error) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = `
      <div class="error-bar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <span class="error-bar__text">${String(state.error).replace(/</g, '&lt;')}</span>
        <button class="error-bar__btn" id="error-retry">重试</button>
      </div>
    `;
    document.getElementById('error-retry')?.addEventListener('click', async () => {
      state.error = null;
      await this.loadInitialData();
    });
  }

  updateSidebarCollapse() {
    const app = document.querySelector('.app');
    if (state.sidebarCollapsed) {
      app.classList.add('app--collapsed');
    } else {
      app.classList.remove('app--collapsed');
    }
  }
  
  async loadInitialData() {
    try {
      await actions.loadInitialData();
    } catch (error) {
      console.error('Failed to load initial data:', error);
      toast.error('加载初始数据失败，请刷新页面重试');
    }
  }
  
  setupTopbarSync() {
    const topbarStatus = document.getElementById('topbar-status');
    
    const updateTopbar = () => {
      if (!topbarStatus || !state.status) return;
      
      const { proxy, ide, patches, config } = state.status;
      const proxyUp = proxy?.running;
      const ideOn = !!ide?.httpProxy;
      const patched = patches?.byok && patches?.live;
      const modelName = config?.upstream?.displayName || '未配置';
      
      topbarStatus.innerHTML = `
        <span class="badge ${proxyUp ? 'badge--success' : 'badge--danger'}">
          <span class="badge__dot"></span>
          代理 ${proxyUp ? '在线' : '离线'}
        </span>
        <span class="badge ${ideOn ? 'badge--success' : 'badge--default'}">
          <span class="badge__dot"></span>
          IDE ${ideOn ? '走代理' : '直连'}
        </span>
        <span class="badge ${patched ? 'badge--success' : 'badge--warning'}">
          <span class="badge__dot"></span>
          补丁 ${patched ? '已应用' : '缺失'}
        </span>
        <span class="badge">${modelName}</span>
      `;
    };
    
    // 初始更新
    updateTopbar();
    
    // 订阅状态变化
    subscribe('status', updateTopbar);
  }
  

}

// ==================== 启动应用 ====================
const app = new App();

document.addEventListener('DOMContentLoaded', () => {
  app.init();
});

export default app;
