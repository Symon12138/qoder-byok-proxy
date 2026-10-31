/**
 * Qoder BYOK 控制台 - UI 组件库
 */

const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/* ==================== 图标（内联 SVG） ==================== */
export const Icon = {
  prompt: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 10.5 L14.5 16 L9.5 21.5"/><path d="M17.5 21.5 H23"/></svg>',
  server: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>',
  cpu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>',
  zap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
  arrowRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><polyline points="12 5 19 12 12 19"/></svg>',
  ban: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
  power: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14 9 11"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
  tool: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
  help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
  sliders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
  pulse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
};

/* ==================== Card ==================== */
export function Card({ title, subtitle, icon, iconVariant = 'accent', headerExtra, children, footer, className = '', bodyClass = '' }) {
  return `
    <div class="card ${className}">
      ${title ? `
        <div class="card__header">
          <div class="card__title-wrap">
            ${icon ? `<span class="icon-box icon-box--${iconVariant} icon-box--sm">${icon}</span>` : ''}
            <div style="min-width:0">
              <h3 class="card__title">${title}</h3>
              ${subtitle ? `<p class="card__subtitle">${subtitle}</p>` : ''}
            </div>
          </div>
          ${headerExtra ? `<div style="flex:none">${headerExtra}</div>` : ''}
        </div>
      ` : ''}
      <div class="card__body ${bodyClass}">${children}</div>
      ${footer ? `<div class="card__footer">${footer}</div>` : ''}
    </div>
  `;
}

/* ==================== Button ==================== */
export function Button({ text, icon, variant = 'default', size = 'md', disabled = false, attrs = '', className = '', type = 'button' }) {
  const classes = [
    'btn',
    variant !== 'default' ? `btn--${variant}` : '',
    size !== 'md' ? `btn--${size}` : '',
    className,
  ].filter(Boolean).join(' ');

  return `<button type="${type}" class="${classes}" ${disabled ? 'disabled' : ''} ${attrs}>${icon || ''}${text ? `<span>${text}</span>` : ''}</button>`;
}

/* ==================== Stat Card ==================== */
export function StatCard({ label, value, icon, iconVariant = 'accent', meta, valueClass = '' }) {
  return `
    <div class="stat-card">
      ${icon ? `<span class="icon-box icon-box--${iconVariant}">${icon}</span>` : ''}
      <div class="stat-card__main">
        <div class="stat-card__label">${label}</div>
        <div class="stat-card__value ${valueClass}">${value}</div>
        ${meta ? `<div class="stat-card__meta">${meta}</div>` : ''}
      </div>
    </div>
  `;
}

/* ==================== Field ==================== */
export function Field({ label, name, type = 'text', value = '', placeholder = '', hint, error, required = false, disabled = false, options, rows, className = '' }) {
  const id = `f-${name}`;
  let input = '';

  if (type === 'select' && options) {
    input = `<select id="${id}" name="${name}" class="field__select" ${disabled ? 'disabled' : ''} ${required ? 'required' : ''}>
      ${options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
    </select>`;
  } else if (type === 'textarea') {
    input = `<textarea id="${id}" name="${name}" class="field__textarea" placeholder="${esc(placeholder)}" ${rows ? `rows="${rows}"` : ''} ${disabled ? 'disabled' : ''}>${esc(value)}</textarea>`;
  } else {
    input = `<input type="${type}" id="${id}" name="${name}" class="field__input" value="${esc(value)}" placeholder="${esc(placeholder)}" ${required ? 'required' : ''} ${disabled ? 'disabled' : ''}>`;
  }

  return `
    <div class="field ${error ? 'field--error' : ''} ${className}">
      <label class="field__label" for="${id}">${esc(label)}${required ? '<span style="color:var(--color-danger)">*</span>' : ''}</label>
      ${input}
      ${hint ? `<p class="field__hint">${esc(hint)}</p>` : ''}
      ${error ? `<p class="field__error">${esc(error)}</p>` : ''}
    </div>
  `;
}

/* ==================== Table ==================== */
export function Table({ columns, rows, className = '' }) {
  return `
    <div class="table-wrapper">
      <table class="table ${className}">
        <thead class="table__header">
          <tr>${columns.map((c) => `<th style="${c.width ? `width:${c.width}` : ''}">${esc(c.label)}</th>`).join('')}</tr>
        </thead>
        <tbody class="table__body">
          ${rows.map((r) => `<tr class="${r._selected ? 'tr--selected' : ''} ${r._cls || ''}">${columns.map((c) => `<td>${r[c.key] ?? ''}</td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

/* ==================== Switch ==================== */
export function Switch({ checked, attrs = '', label, desc, disabled = false }) {
  return `
    <label class="switch">
      <input type="checkbox" class="switch__input" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} ${attrs}>
      <div class="switch__track"><div class="switch__thumb"></div></div>
      ${label ? `<div><div class="switch__label">${esc(label)}</div>${desc ? `<div class="switch__desc">${esc(desc)}</div>` : ''}</div>` : ''}
    </label>
  `;
}

/* ==================== Badge ==================== */
export function Badge({ text, variant = 'default', dot = true }) {
  return `<span class="badge ${variant !== 'default' ? `badge--${variant}` : ''}">${dot ? '<span class="badge__dot"></span>' : ''}${esc(text)}</span>`;
}

/* ==================== Chip ==================== */
export function Chip({ text, icon }) {
  return `<span class="chip">${icon || ''}${esc(text)}</span>`;
}

/* ==================== KV List ==================== */
export function KVList({ items }) {
  return `
    <div class="kv-list">
      ${items.map((i) => `<div class="kv-list__item"><span class="kv-list__label">${esc(i.label)}</span><span class="kv-list__value">${i.value}</span></div>`).join('')}
    </div>
  `;
}

/* ==================== Progress ==================== */
export function Progress({ value = 0, variant = 'default', label }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return `
    <div>
      ${label ? `<div class="flex items-center justify-between mb-2"><span class="text-xs text-muted">${esc(label)}</span><span class="text-xs text-mono text-dim">${v}%</span></div>` : ''}
      <div class="progress ${variant !== 'default' ? `progress--${variant}` : ''}"><div class="progress__bar" style="width:${v}%"></div></div>
    </div>
  `;
}

/* ==================== Segmented ==================== */
export function Segmented({ items, active, attr = 'data-seg' }) {
  return `
    <div class="segmented">
      ${items.map((it) => `<button class="segmented__item ${it.value === active ? 'segmented__item--active' : ''}" ${attr}="${esc(it.value)}">${esc(it.label)}</button>`).join('')}
    </div>
  `;
}

/* ==================== Section Title ==================== */
export function SectionTitle({ text, extra }) {
  return `<div class="section-title"><span>${esc(text)}</span><span class="section-title__line"></span>${extra ? `<span>${extra}</span>` : ''}</div>`;
}

/* ==================== Timeline ==================== */
export function Timeline({ items }) {
  return `
    <div class="timeline">
      ${items.map((it) => `
        <div class="timeline__item">
          <span class="timeline__dot ${it.state ? `timeline__dot--${it.state}` : ''}"></span>
          <div class="timeline__title">${esc(it.title)}</div>
          ${it.meta ? `<div class="timeline__meta">${esc(it.meta)}</div>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

/* ==================== Skeleton ==================== */
export function Skeleton({ lines = 3 }) {
  return `
    <div class="flex flex-col gap-3">
      ${Array.from({ length: lines }).map((_, i) => `<div class="skeleton skeleton--text" style="width:${i === lines - 1 ? '60%' : '100%'}"></div>`).join('')}
    </div>
  `;
}

export function SkeletonStat() {
  return `
    <div class="stat-card" style="opacity:.6">
      <div class="skeleton skeleton--circle" style="width:38px;height:38px;flex:none"></div>
      <div class="stat-card__main">
        <div class="skeleton skeleton--text" style="width:40%;margin-bottom:10px"></div>
        <div class="skeleton skeleton--value" style="margin-bottom:8px"></div>
        <div class="skeleton skeleton--text" style="width:55%"></div>
      </div>
    </div>
  `;
}

/* ==================== Empty / Loading ==================== */
const EMPTY_ART = `
  <svg class="empty__art" viewBox="0 0 132 96" fill="none" aria-hidden="true">
    <ellipse class="art-halo" cx="66" cy="60" rx="52" ry="26"/>
    <rect class="art-box" x="39" y="16" width="54" height="60" rx="9" stroke-width="1.5"/>
    <path class="art-line" d="M51 34h30M51 44h22M51 54h15" stroke-width="1.5" stroke-linecap="round"/>
    <circle class="art-dot" cx="101" cy="25" r="4"/>
    <circle class="art-dot" cx="28" cy="41" r="2.5"/>
  </svg>
`;

export function EmptyState({ icon, title, desc, action }) {
  return `
    <div class="empty">
      ${EMPTY_ART}
      <h3 class="empty__title">${esc(title)}</h3>
      <p class="empty__desc">${esc(desc)}</p>
      ${action || ''}
    </div>
  `;
}

export function Loading({ text = '加载中…' }) {
  return `
    <div class="loading flex-col gap-3">
      <div class="loading__spinner"></div>
      <span class="text-xs text-muted">${esc(text)}</span>
    </div>
  `;
}

/* ==================== Divider ==================== */
export function Divider({ text } = {}) {
  if (text) return `<div class="divider divider--with-text"><span class="divider__text">${esc(text)}</span></div>`;
  return '<hr class="divider">';
}

/* ==================== Grid ==================== */
export function Grid({ children, cols = 'auto-fit', className = '' }) {
  const cls = cols === 'auto-fit' ? 'grid--auto-fit' : `grid--${cols}`;
  return `<div class="grid ${cls} ${className}">${children}</div>`;
}

export { esc };
