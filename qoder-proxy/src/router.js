/**
 * Qoder BYOK 控制台 - 路由系统
 * 管理视图切换、URL 同步、生命周期
 */

import { state, actions } from './store.js';

class Router {
  constructor() {
    this.routes = new Map();
    this.currentView = null;
    this.container = null;
  }
  
  // 注册路由
  register(name, viewModule) {
    this.routes.set(name, viewModule);
  }
  
  // 初始化路由
  init(container) {
    this.container = container;
    
    // 从 URL hash 读取初始路由
    const hash = window.location.hash.slice(1) || 'overview';
    this.navigate(hash);
    
    // 监听 hash 变化
    window.addEventListener('hashchange', () => {
      const hash = window.location.hash.slice(1) || 'overview';
      this.navigate(hash);
    });
  }
  
  // 导航到指定视图
  async navigate(name, params = {}) {
    const view = this.routes.get(name);
    if (!view) {
      console.warn(`View "${name}" not found, falling back to overview`);
      return this.navigate('overview');
    }
    
    // 销毁当前视图
    if (this.currentView && this.currentView.destroy) {
      this.currentView.destroy();
    }
    
    // 更新状态
    state.currentView = name;
    actions.setView(name);
    
    // 更新 URL（不触发 hashchange）
    if (window.location.hash !== `#${name}`) {
      window.location.hash = name;
    }
    
    // 渲染新视图
    this.container.innerHTML = '';
    
    if (view.render) {
      await view.render(this.container, params);
    }
    
    // 绑定事件
    if (view.bindEvents) {
      view.bindEvents();
    }
    
    // 视图入场动效：只在这里触发（轮询重渲染不会重播，避免闪烁）
    this.container.classList.remove('view-enter');
    void this.container.offsetWidth; // 强制重排，让动画能重新开始
    this.container.classList.add('view-enter');
    
    this.currentView = view;
  }
  
  // 刷新当前视图
  async refresh() {
    if (this.currentView) {
      const name = state.currentView;
      await this.navigate(name);
    }
  }
  
  // 获取当前视图名
  getCurrentView() {
    return state.currentView;
  }
}

// 单例
const router = new Router();

export default router;
export { Router };
