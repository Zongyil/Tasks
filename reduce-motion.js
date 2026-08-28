/**
 * Alpha Reduce Motion Engine
 * Global Performance & Motion Reduction Suite
 * (c) Tasks Project
 *
 * 1. Clock animations eliminated, instantaneous digit replacement (0ms swap);
 * 2. Fluid liquid-glass effects eliminated, button hover float & active scale-bounce ONLY on buttons;
 * 3. Card/input mouse-follow glow effects eliminated, zero background CPU usage;
 * 4. Wrapper tab transitions eliminated, instantaneous bottom view cut;
 * 5. TaskHub analog clock red second hand eliminated;
 * 6. Blur filter radii significantly reduced across pages;
 * 7. Scroll bounce overscroll effect disabled;
 * 8. Unnecessary / subtle backdrop blur replaced with clean translucent alpha tints;
 * 9. Resizer bar clean transparent container with elegant pill handle;
 * 10. Ambient / streamer backgrounds cut off and replaced with a clean, slightly blue-tinted cool grayish-white solid color (#f0f4f9) on content pages WITHOUT touching Home.html and Focus.html wallpapers;
 * 11. Complete dormancy of all background observers, timers, and RAF loops.
 * 12. Home.html <-> Focus.html transitions replaced by a simple phone-style shade
 *     slide (Home sinks down, Focus covers over it from top; on the way back
 *     Home rises gently into place) instead of the fluid blur / clone / stage
 *     timeline, saving GPU compositing during page switches.
 */

(function (global) {
  'use strict';

  const STORAGE_KEY = 'alpha_reduce_motion';
  const CSS_CLASS = 'alpha-reduce-motion';
  const STYLE_ID = 'alpha-reduce-motion-core-style';

  function isReduceMotionEnabled() {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch (_) {
      return false;
    }
  }

  const REDUCE_MOTION_CSS = `
    /* ==========================================================================
       Alpha Reduce Motion Core Stylesheet (Performance & Reduced Motion Mode)
       ========================================================================== */

    /* ① 时钟动画全部砍掉，时钟时间变化全部瞬切 */
    .alpha-reduce-motion .colon,
    .alpha-reduce-motion .home-clock .colon,
    .alpha-reduce-motion .digital-clock .hub-digit-slot.colon .hub-time-node,
    .alpha-reduce-motion .timer-digital-clock .timer-digit-slot.colon .timer-time-node,
    .alpha-reduce-motion .flatpickr-time-separator,
    .alpha-reduce-motion .clock-digit-slot.colon,
    .alpha-reduce-motion .hub-digit-slot.colon,
    .alpha-reduce-motion .timer-digit-slot.colon {
        animation: none !important;
        transform: none !important;
        opacity: 0.85 !important;
        transition: none !important;
    }
    .alpha-reduce-motion .clock-time-node,
    .alpha-reduce-motion .hub-time-node,
    .alpha-reduce-motion .timer-time-node,
    .alpha-reduce-motion .clock-digit-slot,
    .alpha-reduce-motion .hub-digit-slot,
    .alpha-reduce-motion .timer-digit-slot {
        transition: none !important;
        animation: none !important;
        filter: none !important;
    }
    .alpha-reduce-motion .clock-time-node.clock-enter,
    .alpha-reduce-motion .clock-time-node.clock-enter-active,
    .alpha-reduce-motion .clock-time-node.clock-exit,
    .alpha-reduce-motion .hub-time-node.clock-enter,
    .alpha-reduce-motion .hub-time-node.clock-enter-active,
    .alpha-reduce-motion .hub-time-node.clock-exit,
    .alpha-reduce-motion .timer-time-node.clock-enter,
    .alpha-reduce-motion .timer-time-node.clock-enter-active,
    .alpha-reduce-motion .timer-time-node.clock-exit {
        transition: none !important;
        animation: none !important;
        transform: none !important;
        filter: none !important;
    }

    /* ② 流体效果全部砍掉，仅对按钮与交互触发项施加悬停上浮与点按微缩回弹 (严禁作用于任何 Panel/Card 容器) */
    .alpha-reduce-motion [class*="liquid"]::before,
    .alpha-reduce-motion [class*="liquid"]::after,
    .alpha-reduce-motion button::before,
    .alpha-reduce-motion button::after,
    .alpha-reduce-motion .btn::before,
    .alpha-reduce-motion .btn::after,
    .alpha-reduce-motion .glass-btn::before,
    .alpha-reduce-motion .glass-btn::after,
    .alpha-reduce-motion .task-icon-button::before,
    .alpha-reduce-motion .task-icon-button::after,
    .alpha-reduce-motion .top-bar-btn::before,
    .alpha-reduce-motion .top-bar-btn::after,
    .alpha-reduce-motion .subject-item span::before,
    .alpha-reduce-motion .subject-item span::after,
    .alpha-reduce-motion .gender-item span::before,
    .alpha-reduce-motion .gender-item span::after,
    .alpha-reduce-motion .priority-item span::before,
    .alpha-reduce-motion .priority-item span::after,
    .alpha-reduce-motion .priority-choice::before,
    .alpha-reduce-motion .priority-choice::after {
        display: none !important;
        content: none !important;
        opacity: 0 !important;
        visibility: hidden !important;
    }

    /* 仅限具体按钮与微交互项，绝不包含任何 panel, card, setting-item, sidebar 等面板 */
    .alpha-reduce-motion button,
    .alpha-reduce-motion .btn,
    .alpha-reduce-motion .glass-btn,
    .alpha-reduce-motion button.primary,
    .alpha-reduce-motion button.secondary,
    .alpha-reduce-motion button.danger,
    .alpha-reduce-motion .top-bar-btn,
    .alpha-reduce-motion .task-icon-button,
    .alpha-reduce-motion .add-tab-btn,
    .alpha-reduce-motion .back-btn,
    .alpha-reduce-motion .filter-btn,
    .alpha-reduce-motion .subject-item > span,
    .alpha-reduce-motion .gender-item > span,
    .alpha-reduce-motion .priority-item > span,
    .alpha-reduce-motion .priority-choice,
    .alpha-reduce-motion .collapse-icon-wrap,
    .alpha-reduce-motion .glass-icon-btn,
    .alpha-reduce-motion .form-collapse-btn,
    .alpha-reduce-motion .monet-selector-item,
    .alpha-reduce-motion .tab-close,
    .alpha-reduce-motion .mini-app-icon {
        transition: transform 0.16s cubic-bezier(0.25, 1, 0.36, 1), background-color 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease !important;
        will-change: transform !important;
        filter: none !important;
        -webkit-filter: none !important;
    }
    .alpha-reduce-motion button:hover,
    .alpha-reduce-motion .btn:hover,
    .alpha-reduce-motion .glass-btn:hover,
    .alpha-reduce-motion button.primary:hover,
    .alpha-reduce-motion button.secondary:hover,
    .alpha-reduce-motion button.danger:hover,
    .alpha-reduce-motion .top-bar-btn:hover,
    .alpha-reduce-motion .task-icon-button:hover,
    .alpha-reduce-motion .add-tab-btn:hover,
    .alpha-reduce-motion .back-btn:hover,
    .alpha-reduce-motion .filter-btn:hover,
    .alpha-reduce-motion .subject-item:hover > span,
    .alpha-reduce-motion .gender-item:hover > span,
    .alpha-reduce-motion .priority-item:hover > span,
    .alpha-reduce-motion .priority-choice:hover,
    .alpha-reduce-motion .collapse-icon-wrap:hover,
    .alpha-reduce-motion .glass-icon-btn:hover,
    .alpha-reduce-motion .form-collapse-btn:hover,
    .alpha-reduce-motion .monet-selector-item:hover,
    .alpha-reduce-motion .tab-close:hover,
    .alpha-reduce-motion .mini-app-icon:hover {
        transform: translateY(-2.5px) !important;
    }
    .alpha-reduce-motion button:active,
    .alpha-reduce-motion .btn:active,
    .alpha-reduce-motion .glass-btn:active,
    .alpha-reduce-motion button.primary:active,
    .alpha-reduce-motion button.secondary:active,
    .alpha-reduce-motion button.danger:active,
    .alpha-reduce-motion .top-bar-btn:active,
    .alpha-reduce-motion .task-icon-button:active,
    .alpha-reduce-motion .add-tab-btn:active,
    .alpha-reduce-motion .back-btn:active,
    .alpha-reduce-motion .filter-btn:active,
    .alpha-reduce-motion .subject-item:active > span,
    .alpha-reduce-motion .gender-item:active > span,
    .alpha-reduce-motion .priority-item:active > span,
    .alpha-reduce-motion .priority-choice:active,
    .alpha-reduce-motion .collapse-icon-wrap:active,
    .alpha-reduce-motion .glass-icon-btn:active,
    .alpha-reduce-motion .form-collapse-btn:active,
    .alpha-reduce-motion .monet-selector-item:active,
    .alpha-reduce-motion .tab-close:active,
    .alpha-reduce-motion .mini-app-icon:active {
        transform: translateY(0px) scale(0.95) !important;
        transition-duration: 0.08s !important;
    }

    /* 明确锁定：所有 Panel, Card, Setting-item, Sidebar 绝对禁止任何 active 缩放形变与位移！ */
    .alpha-reduce-motion .panel,
    .alpha-reduce-motion section.panel,
    .alpha-reduce-motion .card,
    .alpha-reduce-motion .setting-item,
    .alpha-reduce-motion .settings-panel,
    .alpha-reduce-motion .sidebar,
    .alpha-reduce-motion .nav-card,
    .alpha-reduce-motion .task-card,
    .alpha-reduce-motion .account-card,
    .alpha-reduce-motion .settings-container,
    .alpha-reduce-motion .account-container {
        transform: none !important;
    }
    .alpha-reduce-motion .panel:active,
    .alpha-reduce-motion section.panel:active,
    .alpha-reduce-motion .card:active,
    .alpha-reduce-motion .setting-item:active,
    .alpha-reduce-motion .settings-panel:active,
    .alpha-reduce-motion .sidebar:active,
    .alpha-reduce-motion .nav-card:active,
    .alpha-reduce-motion .task-card:active,
    .alpha-reduce-motion .account-card:active {
        transform: none !important;
    }

    /* ③ 光效砍掉，就是 hover 时加一点衬底 */
    .alpha-reduce-motion .card-glow-overlay,
    .alpha-reduce-motion .input-glow-overlay,
    .alpha-reduce-motion .alpha-card-glow-host,
    .alpha-reduce-motion .alpha-card-glow-surface,
    .alpha-reduce-motion .alpha-card-glow-border,
    .alpha-reduce-motion canvas.glow-canvas {
        display: none !important;
        animation: none !important;
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
    }

    /* ④ wrapper.html 页面瞬切 */
    .alpha-reduce-motion .content-frame,
    .alpha-reduce-motion .content-frame.enter-left,
    .alpha-reduce-motion .content-frame.enter-right,
    .alpha-reduce-motion .content-frame.exit-left,
    .alpha-reduce-motion .content-frame.exit-right,
    .alpha-reduce-motion .content-frame.stationary {
        transition: none !important;
        animation: none !important;
        transform: none !important;
    }

    /* ⑤ TaskHub.html 的时钟模拟表盘砍掉红色的秒针 */
    .alpha-reduce-motion .second-hand,
    .alpha-reduce-motion #secondHand {
        display: none !important;
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
    }

    /* ⑥ 减弱页面中模糊效果的半径 */
    .alpha-reduce-motion * {
        --blur-heavy: 8px !important;
        --blur-medium: 6px !important;
        --blur-light: 4px !important;
    }
    .alpha-reduce-motion .sphere-modal,
    .alpha-reduce-motion .glass-sphere,
    .alpha-reduce-motion .flatpickr-calendar,
    .alpha-reduce-motion .sidebar,
    .alpha-reduce-motion section.panel,
    .alpha-reduce-motion .card,
    .alpha-reduce-motion .window-controls-menu {
        backdrop-filter: blur(8px) saturate(110%) !important;
        -webkit-backdrop-filter: blur(8px) saturate(110%) !important;
    }

    /* ⑦ / ⑧ 不必要/不明显的毛玻璃效果，改成半透明 */
    .alpha-reduce-motion .alpha-tooltip,
    .alpha-reduce-motion .controls-menu,
    .alpha-reduce-motion .menu-backdrop,
    .alpha-reduce-motion .modal-backdrop,
    .alpha-reduce-motion .toast-card,
    .alpha-reduce-motion .dropdown-menu,
    .alpha-reduce-motion .badge {
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
        background-color: rgba(255, 255, 255, 0.75) !important;
    }

    /* ⑨ 修复 TaskFlow, TaskHub, TaskTimer 中间 resizer 分隔条 */
    .alpha-reduce-motion .glass-resizer-bar {
        background: transparent !important;
        background-color: transparent !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
        box-shadow: none !important;
        border: none !important;
    }
    .alpha-reduce-motion .glass-resizer-bar::after {
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
        background: rgba(255, 255, 255, 0.65) !important;
        box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.9) !important;
    }

    /* ⑩ 流光背景砍掉；严格保留 Home.html 时钟下方模糊遮罩与壁纸！ */
    .alpha-reduce-motion .alpha-ambient-bg,
    .alpha-reduce-motion .ambient-motion-stage,
    .alpha-reduce-motion .stage-sunbeam,
    .alpha-reduce-motion .stage-orb-1,
    .alpha-reduce-motion .stage-orb-2,
    .alpha-reduce-motion .stage-orb-3 {
        display: none !important;
        animation: none !important;
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
    }

    /* Home.html 与 Focus.html 的壁纸容器与时钟模糊遮罩正常显示 */
    .alpha-reduce-motion .hero-wallpaper,
    .alpha-reduce-motion .wallpaper-layer,
    .alpha-reduce-motion .preview-board {
        display: block !important;
        visibility: visible !important;
    }

    .alpha-reduce-motion .hero-wallpaper:not(.no-clock)::before {
        display: block !important;
        opacity: 1 !important;
        visibility: visible !important;
    }

    .alpha-reduce-motion .hero-wallpaper.no-clock::before {
        display: none !important;
        opacity: 0 !important;
    }

    .alpha-reduce-motion .hero-wallpaper::after {
        display: block !important;
        opacity: 1 !important;
        visibility: visible !important;
    }

    /* ⑪ 标题栏与顶级宿主窗口 (wrapper.html) 必须严格保持 100% 透明，完全透出 Windows 系统材质 (Mica / Tabbed) */
    .alpha-reduce-motion html.wrapper-html,
    .alpha-reduce-motion html#wrapperHtml,
    .alpha-reduce-motion html:has(#title-bar),
    .alpha-reduce-motion body.wrapper-body,
    .alpha-reduce-motion body#wrapperBody,
    .alpha-reduce-motion body:has(#title-bar),
    .alpha-reduce-motion #title-bar {
        background: transparent !important;
        background-color: transparent !important;
    }

    /* 仅针对无壁纸的通用功能页 (TaskHub, TaskFlow, TaskTimer, settings, Account) 设置微蓝灰白纯色 (#f0f4f9) */
    .alpha-reduce-motion .settings-container,
    .alpha-reduce-motion .account-container,
    .alpha-reduce-motion .setup-layout {
        background-color: #f0f4f9 !important;
    }
    
    /* 针对 iframe 内的 TaskHub, TaskFlow, TaskTimer 等页面主体背景设置为 #f0f4f9，绝对排除顶级宿主 wrapper.html 与标题栏 */
    .alpha-reduce-motion body:not(.has-wallpaper):not(#homeBody):not(#focusBody):not(#wrapperBody):not(.wrapper-body):not(:has(#title-bar)):not(:has(#iframe-container)) {
        background-color: #f0f4f9 !important;
    }
  `;

  function applyToDocument(doc) {
    if (!doc || !doc.documentElement) return;
    const enabled = isReduceMotionEnabled();
    doc.documentElement.classList.toggle(CSS_CLASS, enabled);
    if (doc.body) {
      doc.body.classList.toggle(CSS_CLASS, enabled);
    }

    let styleEl = doc.getElementById(STYLE_ID);
    if (enabled) {
      if (!styleEl) {
        styleEl = doc.createElement('style');
        styleEl.id = STYLE_ID;
        styleEl.textContent = REDUCE_MOTION_CSS;
        (doc.head || doc.documentElement).appendChild(styleEl);
      }
    } else {
      if (styleEl && styleEl.parentNode) {
        styleEl.parentNode.removeChild(styleEl);
      }
    }
  }

  function setReduceMotion(enabled) {
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
    } catch (_) {}
    
    // Apply to current window document
    applyToDocument(document);

    // Apply to all iframes in this window
    try {
      const iframes = document.querySelectorAll('iframe');
      iframes.forEach(iframe => {
        try {
          if (iframe.contentDocument) {
            applyToDocument(iframe.contentDocument);
          }
          if (iframe.contentWindow) {
            iframe.contentWindow.postMessage({ type: 'alpha_reduce_motion', value: !!enabled }, '*');
          }
        } catch (_) {}
      });
    } catch (_) {}

    // Notify parent if inside iframe
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'alpha_reduce_motion', value: !!enabled }, '*');
      }
    } catch (_) {}

    // Dispatch custom event
    try {
      window.dispatchEvent(new CustomEvent('AlphaReduceMotionChanged', { detail: { enabled: !!enabled } }));
    } catch (_) {}
  }

  // Self initialize on load
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => applyToDocument(document));
    } else {
      applyToDocument(document);
    }
  }

  // Cross-tab and postMessage synchronization
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY) {
        applyToDocument(document);
        try {
          window.dispatchEvent(new CustomEvent('AlphaReduceMotionChanged', { detail: { enabled: e.newValue === 'true' } }));
        } catch (_) {}
      }
    });

    window.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'alpha_reduce_motion') {
        const enabled = !!e.data.value;
        try { localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false'); } catch (_) {}
        applyToDocument(document);
        try {
          window.dispatchEvent(new CustomEvent('AlphaReduceMotionChanged', { detail: { enabled } }));
        } catch (_) {}
      }
    });
  }

  global.AlphaReduceMotion = {
    isEnabled: isReduceMotionEnabled,
    set: setReduceMotion,
    init: applyToDocument,
    apply: applyToDocument
  };

})(typeof window !== 'undefined' ? window : globalThis);
