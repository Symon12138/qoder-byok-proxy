/**
 * Qoder BYOK 控制台 - 事件管理器
 * 统一管理事件监听器，防止内存泄漏
 */

export class EventManager {
  constructor() {
    this.listeners = new Map();
    this.nextId = 1;
  }
  
  /**
   * 添加事件监听器
   * @param {Element} element - 目标元素
   * @param {string} event - 事件类型
   * @param {Function} handler - 事件处理函数
   * @param {Object} options - 事件选项
   * @returns {number} 监听器 ID
   */
  add(element, event, handler, options = {}) {
    if (!element || !event || !handler) {
      console.warn('EventManager.add: invalid parameters');
      return 0;
    }
    
    const id = this.nextId++;
    const key = `${event}-${id}`;
    
    // 绑定事件
    element.addEventListener(event, handler, options);
    
    // 记录监听器
    if (!this.listeners.has(key)) {
      this.listeners.set(key, []);
    }
    this.listeners.get(key).push({
      id,
      element,
      event,
      handler,
      options,
    });
    
    return id;
  }
  
  /**
   * 移除指定监听器
   * @param {number} id - 监听器 ID
   */
  remove(id) {
    for (const [key, listeners] of this.listeners.entries()) {
      const index = listeners.findIndex(l => l.id === id);
      if (index !== -1) {
        const listener = listeners[index];
        listener.element.removeEventListener(
          listener.event,
          listener.handler,
          listener.options
        );
        listeners.splice(index, 1);
        
        if (listeners.length === 0) {
          this.listeners.delete(key);
        }
        
        return true;
      }
    }
    return false;
  }
  
  /**
   * 移除指定元素上的所有监听器
   * @param {Element} element - 目标元素
   */
  removeFromElement(element) {
    if (!element) return;
    
    let removed = 0;
    for (const [key, listeners] of this.listeners.entries()) {
      for (let i = listeners.length - 1; i >= 0; i--) {
        const listener = listeners[i];
        if (listener.element === element) {
          listener.element.removeEventListener(
            listener.event,
            listener.handler,
            listener.options
          );
          listeners.splice(i, 1);
          removed++;
        }
      }
      
      if (listeners.length === 0) {
        this.listeners.delete(key);
      }
    }
    
    return removed;
  }
  
  /**
   * 移除所有监听器
   */
  removeAll() {
    let removed = 0;
    
    for (const listeners of this.listeners.values()) {
      for (const listener of listeners) {
        listener.element.removeEventListener(
          listener.event,
          listener.handler,
          listener.options
        );
        removed++;
      }
    }
    
    this.listeners.clear();
    return removed;
  }
  
  /**
   * 获取监听器数量
   */
  count() {
    let total = 0;
    for (const listeners of this.listeners.values()) {
      total += listeners.length;
    }
    return total;
  }
  
  /**
   * 检查是否有监听器
   */
  has(element, event) {
    for (const listeners of this.listeners.values()) {
      for (const listener of listeners) {
        if (listener.element === element && listener.event === event) {
          return true;
        }
      }
    }
    return false;
  }
}

// 创建全局实例
export const globalEventManager = new EventManager();

// 便捷方法
export function addListener(element, event, handler, options) {
  return globalEventManager.add(element, event, handler, options);
}

export function removeListener(id) {
  return globalEventManager.remove(id);
}

export function removeAllListeners() {
  return globalEventManager.removeAll();
}

export default EventManager;
