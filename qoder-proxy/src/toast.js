/**
 * Qoder BYOK 控制台 - Toast 消息提示
 * 全局单例，自动消失
 */

class Toast {
  constructor() {
    this.container = null;
    this.toasts = [];
    this.init();
  }
  
  init() {
    // 创建容器
    this.container = document.createElement('div');
    this.container.className = 'toast-container';
    document.body.appendChild(this.container);
  }
  
  show({ type = 'info', title, message, duration = 4000 }) {
    const id = Date.now() + Math.random();
    
    const icons = {
      success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
      error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    };
    
    const toastEl = document.createElement('div');
    toastEl.className = `toast toast--${type}`;
    toastEl.dataset.id = id;
    toastEl.innerHTML = `
      <div class="toast__icon">${icons[type]}</div>
      <div class="toast__content">
        ${title ? `<div class="toast__title">${title}</div>` : ''}
        <div class="toast__message">${message}</div>
      </div>
      <button class="toast__close" data-id="${id}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    `;
    
    this.container.appendChild(toastEl);
    this.toasts.push({ id, el: toastEl });
    
    // 绑定关闭按钮
    toastEl.querySelector('.toast__close').addEventListener('click', () => {
      this.hide(id);
    });
    
    // 自动消失
    if (duration > 0) {
      setTimeout(() => this.hide(id), duration);
    }
    
    return id;
  }
  
  hide(id) {
    const idx = this.toasts.findIndex(t => t.id === id);
    if (idx === -1) return;
    
    const { el } = this.toasts[idx];
    el.style.animation = 'toastOut 0.2s ease-out forwards';
    
    setTimeout(() => {
      el.remove();
      this.toasts.splice(idx, 1);
    }, 200);
  }
  
  success(message, title = '成功') {
    return this.show({ type: 'success', title, message });
  }
  
  error(message, title = '错误') {
    return this.show({ type: 'error', title, message, duration: 6000 });
  }
  
  warning(message, title = '警告') {
    return this.show({ type: 'warning', title, message });
  }
  
  info(message, title = '提示') {
    return this.show({ type: 'info', title, message });
  }
  
  clear() {
    this.toasts.forEach(({ id }) => this.hide(id));
  }
}

// 单例
const toast = new Toast();

export default toast;
export { Toast };
