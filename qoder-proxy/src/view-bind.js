/**
 * 视图级事件绑定
 *
 * 背景：视图的 bindEvents() 每次进入页面都会被 router 调一次，
 * 之前直接 document.addEventListener 且 destroy 不清理，
 * 于是每切换一次页面就多一份监听 —— 实测来回切 3 轮后
 * 点一次「刷新」会发出 5 个 /api/status 请求，写操作的按钮
 * 也会被执行多次。这里把所有监听记在视图实例上，离开时统一移除。
 */

export function bindAll(view) {
  view._offs = view._offs || [];
  view.on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    view._offs.push(() => {
      try {
        target.removeEventListener(type, fn, opts);
      } catch {
        /* target 已销毁，忽略 */
      }
    });
  };
}

export function unbindAll(view) {
  (view._offs || []).forEach((off) => off());
  view._offs = [];
  delete view.on;
}
