/**
 * Qoder BYOK 控制台 - 基础视图类
 * 提供通用的视图生命周期管理
 */

import { EventManager } from './event-manager.js';

export class BaseView {
  constructor() {
    this.eventManager = new EventManager();
    this.container = null;
    this.initialized = false;
  }
  
  /**
   * 初始化视图
   */
  async init(container) {
    this.container = container;
    await this.render();
    this.bindEvents();
    this.initialized = true;
  }
  
  /**
   * 渲染视图（子类实现）
   */
  async render() {
    throw new Error('render() must be implemented by subclass');
  }
  
  /**
   * 绑定事件（子类实现）
   */
  bindEvents() {
    // 子类可选实现
  }
  
  /**
   * 刷新视图
   */
  async refresh() {
    await this.render();
  }
  
  /**
   * 销毁视图，清理资源
   */
  destroy() {
    // 移除所有事件监听器
    this.eventManager.removeAll();
    
    // 清空容器
    if (this.container) {
      this.container.innerHTML = '';
    }
    
    this.initialized = false;
  }
  
  /**
   * 添加事件监听器
   */
  addEventListener(element, event, handler, options) {
    return this.eventManager.add(element, event, handler, options);
  }
  
  /**
   * 查询元素
   */
  $(selector) {
    return this.container?.querySelector(selector);
  }
  
  /**
   * 查询所有元素
   */
  $$(selector) {
    return this.container?.querySelectorAll(selector) || [];
  }
  
  /**
   * 显示加载状态
   */
  showLoading(element) {
    if (!element) return;
    
    const originalText = element.textContent;
    element.disabled = true;
    element.dataset.originalText = originalText;
    element.innerHTML = `
      <span class="loading-spinner" style="display: inline-block; width: 16px; height: 16px; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 8px;"></span>
      加载中...
    `;
  }
  
  /**
   * 隐藏加载状态
   */
  hideLoading(element) {
    if (!element) return;
    
    element.disabled = false;
    if (element.dataset.originalText) {
      element.textContent = element.dataset.originalText;
      delete element.dataset.originalText;
    }
  }
  
  /**
   * 显示错误
   */
  showError(message) {
    console.error(`[${this.constructor.name}]`, message);
  }
}

export default BaseView;
