/**
 * Alpha Immersive Card Glow Engine
 * Specular Surface Highlight & Multi-Card Proximity Border Illumination
 * (c) Tasks Project - Liquid Glass Suite
 */

(function (global) {
  'use strict';

  // 1. 结构性大布局容器 (绝不作为卡片发光，确保布局与毛玻璃 100% 纯净)
  const STRUCTURAL_LAYOUT_SELECTORS = [
    '.panel',
    '.sidebar',
    '.main',
    '.focus-container',
    '.settings-container',
    '.home-layout',
    '.app',
    'body',
    'html',
    '#title-bar',
    '.tabs-container',
    '.tabs-wrapper',
    '#iframe-container',
    '.hero-wallpaper',
    '.alpha-ambient-bg'
  ];
  const STRUCTURAL_LAYOUT_SELECTOR = STRUCTURAL_LAYOUT_SELECTORS.join(', ');

  // 2. 独立小组件与免受干扰的选择器 (其内部任何子元素均不触发大卡片高光)
  const WIDGET_EXCLUDE_SELECTORS = [
    '.subject-box',
    '.gender-box',
    '.subject-item',
    '.gender-item',
    '.priority-item',
    '.priority-choice',
    '.no-card-glow',
    '[data-no-card-glow]',
    '.no-liquid',
    '.nav-card',
    '.window-controls-menu',
    '.menu-item',
    '.alpha-dropdown',
    '.flatpickr-calendar',
    '#alphaTooltip',
    '.sphere-modal',
    '.focus-transition-stage',
    '.flatpickr-innerContainer',
    '.toast-notification'
  ];
  const WIDGET_EXCLUDE_SELECTOR = WIDGET_EXCLUDE_SELECTORS.join(', ');

  // 3. 目标大卡片选择器体系 (仅限具体卡片)
  const CARD_SELECTORS = [
    '.task-card',
    '.side-card',
    '.account-card',
    '.settings-container .card',
    '.stats .card',
    '.stats-card',
    '.chart-card',
    '.chart-wrap',
    '.progress-item',
    '.progress-card',
    '.info-card',
    '.alarm-item',
    '[data-card-glow]',
    '[data-glow-card]'
  ];
  const CARD_SELECTOR = CARD_SELECTORS.join(', ');

  // 光照物理配置 (强化表面高光与边框发光光晕)
  const CONFIG = {
    borderLightRadius: 220,      // 跨卡片边框感知半径 (px)
    minSurfaceRadius: 340,       // 卡片表面高光最小半径 (px)
    maxSurfaceRadius: 520,       // 卡片表面高光最大半径 (px)
    surfaceLightIntensity: 0.38, // 表面高光增强强度 (呈现清晰透亮的增强光泽)
    borderLightIntensity: 1.0,   // 边框高光核心强度
    rectCacheDuration: 250       // 几何包围盒缓存有效时长 (ms)
  };

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  class CardGlowManager {
    constructor(targetDoc) {
      this.doc = targetDoc || (typeof document !== 'undefined' ? document : null);
      if (!this.doc) return;

      this.trackedCards = new Set();
      this.cardDataMap = new WeakMap();
      this.activeHoveredCard = null;
      this.pointerX = -9999;
      this.pointerY = -9999;
      this.isPointerInView = false;
      this.rafId = null;
      this.observer = null;
      this.lastRectCacheTime = 0;
      this.isRectCacheDirty = true;

      this.boundOnPointerMove = this.onPointerMove.bind(this);
      this.boundOnPointerLeave = this.onPointerLeave.bind(this);
      this.boundOnScroll = this.invalidateRectCache.bind(this);
      this.boundOnResize = this.invalidateRectCache.bind(this);

      this.init();
    }

    init() {
      if (!this.doc || this.doc.__alphaCardGlowInstalled) return;
      this.doc.__alphaCardGlowInstalled = true;

      this.injectStyles();
      this.scanAndAttachCards();
      this.setupObserver();
      this.bindEvents();
    }

    injectStyles() {
      if (this.doc.getElementById('__alphaCardGlowStyle')) return;

      const style = this.doc.createElement('style');
      style.id = '__alphaCardGlowStyle';
      style.textContent = `
        /* 确保目标卡片具备定位上下文 */
        .alpha-glow-card {
          position: relative;
        }

        /* 独立纯叠加宿主层: 零侵入, 继承圆角, 穿透所有事件 */
        .alpha-card-glow-host {
          position: absolute !important;
          inset: 0 !important;
          pointer-events: none !important;
          user-select: none !important;
          border-radius: inherit !important;
          overflow: hidden !important;
          z-index: 1 !important;
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
        }

        /* 表面增强高光层 (Surface Specular Glow) - 增强亮度与通透层次 */
        .alpha-card-glow-surface {
          position: absolute !important;
          inset: 0 !important;
          border-radius: inherit !important;
          pointer-events: none !important;
          background: radial-gradient(
            circle var(--cg-surface-radius, 400px) at var(--cg-surface-x, 50%) var(--cg-surface-y, 50%),
            rgba(255, 255, 255, ${CONFIG.surfaceLightIntensity}) 0%,
            rgba(255, 255, 255, ${CONFIG.surfaceLightIntensity * 0.55}) 24%,
            rgba(255, 255, 255, ${CONFIG.surfaceLightIntensity * 0.20}) 52%,
            rgba(255, 255, 255, 0.03) 74%,
            transparent 88%
          ) !important;
          opacity: var(--cg-surface-opacity, 0) !important;
          mix-blend-mode: overlay;
          transition: opacity 0.26s cubic-bezier(0.16, 1, 0.3, 1) !important;
          will-change: opacity;
          z-index: 1 !important;
        }

        /* 跨卡片邻近边框高光层 (Proximity Border Glow) - 精细描边 + 灵动发光光晕 */
        .alpha-card-glow-border {
          position: absolute !important;
          top: calc(-1 * var(--cg-bt, 1px)) !important;
          right: calc(-1 * var(--cg-br, 1px)) !important;
          bottom: calc(-1 * var(--cg-bb, 1px)) !important;
          left: calc(-1 * var(--cg-bl, 1px)) !important;
          padding: var(--cg-stroke, 1.6px) !important;
          box-sizing: border-box !important;
          border-radius: inherit !important;
          pointer-events: none !important;
          background: radial-gradient(
            circle var(--cg-border-radius, 220px) at var(--cg-border-x, -999px) var(--cg-border-y, -999px),
            rgba(255, 255, 255, 1) 0%,
            rgba(255, 255, 255, 0.82) 22%,
            rgba(255, 255, 255, 0.38) 50%,
            rgba(255, 255, 255, 0.08) 72%,
            transparent 82%
          ) !important;
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0) border-box !important;
          mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0) border-box !important;
          -webkit-mask-composite: xor !important;
          mask-composite: exclude !important;
          opacity: var(--cg-border-opacity, 0) !important;
          transition: opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1) !important;
          will-change: opacity;
          z-index: 2 !important;
        }

        /* 深色模式：统一减弱卡片 Glow 光效与边框反光浓度，避免过亮刺眼 */
        @media (prefers-color-scheme: dark) {
          .alpha-card-glow-surface {
            background: radial-gradient(
              circle var(--cg-surface-radius, 400px) at var(--cg-surface-x, 50%) var(--cg-surface-y, 50%),
              rgba(255, 255, 255, 0.16) 0%,
              rgba(255, 255, 255, 0.08) 24%,
              rgba(255, 255, 255, 0.02) 52%,
              rgba(255, 255, 255, 0.005) 74%,
              transparent 88%
            ) !important;
            opacity: calc(var(--cg-surface-opacity, 0) * 0.65) !important;
          }

          .alpha-card-glow-border {
            background: radial-gradient(
              circle var(--cg-border-radius, 220px) at var(--cg-border-x, -999px) var(--cg-border-y, -999px),
              rgba(255, 255, 255, 0.48) 0%,
              rgba(255, 255, 255, 0.36) 22%,
              rgba(255, 255, 255, 0.15) 50%,
              rgba(255, 255, 255, 0.02) 72%,
              transparent 82%
            ) !important;
            opacity: calc(var(--cg-border-opacity, 0) * 0.68) !important;
          }
        }
      `;

      (this.doc.head || this.doc.documentElement).appendChild(style);
    }

    isEligibleCard(el) {
      if (!el || !el.matches || !el.isConnected) return false;
      // 自身是结构大布局容器 -> 坚决不作为卡片
      if (el.matches(STRUCTURAL_LAYOUT_SELECTOR)) return false;
      // 自身或外层是受保护微组件/模态框 -> 不作为卡片
      if (el.matches(WIDGET_EXCLUDE_SELECTOR) || el.closest(WIDGET_EXCLUDE_SELECTOR)) return false;
      return el.matches(CARD_SELECTOR);
    }

    attachGlowToCard(card) {
      if (!card || !card.isConnected) return;
      if (!this.isEligibleCard(card)) return;

      if (!card.classList.contains('alpha-glow-card')) {
        card.classList.add('alpha-glow-card');
      }

      this.syncBorderMetrics(card);

      let host = card.querySelector(':scope > .alpha-card-glow-host');
      let surfaceEl = null;
      let borderEl = null;

      if (!host) {
        host = this.doc.createElement('div');
        host.className = 'alpha-card-glow-host';
        host.setAttribute('aria-hidden', 'true');

        surfaceEl = this.doc.createElement('div');
        surfaceEl.className = 'alpha-card-glow-surface';
        surfaceEl.setAttribute('aria-hidden', 'true');

        borderEl = this.doc.createElement('div');
        borderEl.className = 'alpha-card-glow-border';
        borderEl.setAttribute('aria-hidden', 'true');

        host.appendChild(surfaceEl);
        host.appendChild(borderEl);

        // 插入到卡片首位，保持在所有内容元素下方
        if (card.firstChild) {
          card.insertBefore(host, card.firstChild);
        } else {
          card.appendChild(host);
        }
      } else {
        surfaceEl = host.querySelector('.alpha-card-glow-surface');
        borderEl = host.querySelector('.alpha-card-glow-border');
      }

      const rect = card.getBoundingClientRect();
      const maxDim = Math.max(rect.width || 200, rect.height || 200);
      const surfaceRadius = clamp(Math.round(maxDim * 0.48), CONFIG.minSurfaceRadius, CONFIG.maxSurfaceRadius);

      card.style.setProperty('--cg-surface-radius', `${surfaceRadius}px`);
      card.style.setProperty('--cg-border-radius', `${CONFIG.borderLightRadius}px`);

      const cardData = {
        card,
        host,
        surfaceEl,
        borderEl,
        rect,
        surfaceRadius,
        borderRadius: CONFIG.borderLightRadius,
        borderOpacity: 0,
        surfaceOpacity: 0
      };

      this.cardDataMap.set(card, cardData);
      this.trackedCards.add(card);
    }

    detachGlowFromCard(card) {
      if (!card) return;
      this.trackedCards.delete(card);
      const host = card.querySelector(':scope > .alpha-card-glow-host');
      if (host) host.remove();
      card.classList.remove('alpha-glow-card');
      this.cardDataMap.delete(card);
    }

    scanAndAttachCards(root) {
      const container = root || this.doc;
      if (!container || !container.querySelectorAll) return;

      const elements = container.querySelectorAll(CARD_SELECTOR);
      elements.forEach(card => this.attachGlowToCard(card));
    }

    setupObserver() {
      if (typeof MutationObserver === 'undefined') return;

      this.observer = new MutationObserver((mutations) => {
        if (this.isSleeping) return;
        let needsScan = false;
        for (let i = 0; i < mutations.length; i++) {
          const m = mutations[i];
          if (m.type === 'childList') {
            if (m.target && m.target.classList && m.target.classList.contains('alpha-card-glow-host')) {
              continue;
            }
            let hasExternalChange = false;
            for (let j = 0; j < m.addedNodes.length; j++) {
              const node = m.addedNodes[j];
              if (node.nodeType === 1 && !node.classList?.contains('alpha-card-glow-host') && !node.classList?.contains('alpha-card-glow-surface') && !node.classList?.contains('alpha-card-glow-border')) {
                hasExternalChange = true;
                break;
              }
            }
            if (!hasExternalChange && m.removedNodes.length > 0) {
              for (let j = 0; j < m.removedNodes.length; j++) {
                const node = m.removedNodes[j];
                if (node.nodeType === 1 && !node.classList?.contains('alpha-card-glow-host') && !node.classList?.contains('alpha-card-glow-surface') && !node.classList?.contains('alpha-card-glow-border')) {
                  hasExternalChange = true;
                  break;
                }
              }
            }
            if (hasExternalChange) {
              needsScan = true;
              break;
            }
          }
        }

        if (needsScan) {
          this.scanAndAttachCards();
          this.invalidateRectCache();
        }
      });

      this.observer.observe(this.doc.body || this.doc.documentElement, {
        childList: true,
        subtree: true
      });
    }

    syncBorderMetrics(el) {
      if (!el || el.__alphaCgBorderSynced) return;
      el.__alphaCgBorderSynced = true;
      try {
        const win = el.ownerDocument ? (el.ownerDocument.defaultView || window) : window;
        if (!win || !win.getComputedStyle) return;
        const cs = win.getComputedStyle(el);
        const bt = parseFloat(cs.borderTopWidth) || 0;
        const br = parseFloat(cs.borderRightWidth) || 0;
        const bb = parseFloat(cs.borderBottomWidth) || 0;
        const bl = parseFloat(cs.borderLeftWidth) || 0;

        el.style.setProperty('--cg-bt', `${bt}px`);
        el.style.setProperty('--cg-br', `${br}px`);
        el.style.setProperty('--cg-bb', `${bb}px`);
        el.style.setProperty('--cg-bl', `${bl}px`);

        const maxBorder = Math.max(bt, br, bb, bl);
        const stroke = maxBorder > 0 ? Math.max(1.35, maxBorder) : 1.35;
        el.style.setProperty('--cg-stroke', `${stroke}px`);
      } catch (_) {}
    }

    invalidateRectCache() {
      this.isRectCacheDirty = true;
      if (this.isPointerInView) {
        this.requestUpdate();
      }
    }

    updateRectCache(force = false) {
      if (!force && !this.isRectCacheDirty) {
        return;
      }
      this.isRectCacheDirty = false;
      this.lastRectCacheTime = performance.now();

      const viewportH = (this.doc.defaultView || window).innerHeight || 800;
      const viewportW = (this.doc.defaultView || window).innerWidth || 1200;
      const MARGIN = CONFIG.borderLightRadius + 50;

      this.trackedCards.forEach(card => {
        if (!card.isConnected) {
          this.detachGlowFromCard(card);
          return;
        }

        const rect = card.getBoundingClientRect();
        const data = this.cardDataMap.get(card);
        if (data) {
          data.rect = rect;
          // 视口外剔除判定
          data.isInView = !(
            rect.bottom < -MARGIN ||
            rect.top > viewportH + MARGIN ||
            rect.right < -MARGIN ||
            rect.left > viewportW + MARGIN
          );
        }
      });
    }

    bindEvents() {
      this.boundOnSleep = () => this.sleep();
      this.boundOnWake = () => this.wake();

      this.doc.addEventListener('pointermove', this.boundOnPointerMove, { passive: true });
      this.doc.addEventListener('pointerleave', this.boundOnPointerLeave, { passive: true });
      this.doc.addEventListener('AlphaSleep', this.boundOnSleep);
      this.doc.addEventListener('AlphaWake', this.boundOnWake);

      const win = this.doc.defaultView || (typeof window !== 'undefined' ? window : null);
      if (win) {
        win.addEventListener('scroll', this.boundOnScroll, { passive: true, capture: true });
        win.addEventListener('resize', this.boundOnResize, { passive: true });
        win.addEventListener('blur', this.boundOnPointerLeave, { passive: true });
        win.addEventListener('AlphaSleep', this.boundOnSleep);
        win.addEventListener('AlphaWake', this.boundOnWake);
      }

      this.doc.addEventListener('visibilitychange', () => {
        if (this.doc.hidden) this.sleep();
        else this.wake();
      });
    }

    sleep() {
      this.isSleeping = true;
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      this.onPointerLeave();
    }

    wake() {
      this.isSleeping = false;
      this.invalidateRectCache();
    }

    findInnermostCard(target) {
      if (this.isSleeping) return null;
      if (!target || !target.closest) return null;
      // 如果处于受保护微组件/交互控件内部，不触发大卡片表面高光
      if (target.closest(WIDGET_EXCLUDE_SELECTOR) || target.closest('button, input, textarea, select')) {
        return null;
      }
      const card = target.closest(CARD_SELECTOR);
      if (!card || card.matches(STRUCTURAL_LAYOUT_SELECTOR) || card.closest(WIDGET_EXCLUDE_SELECTOR)) {
        return null;
      }
      return card;
    }

    onPointerMove(e) {
      if (typeof localStorage !== 'undefined' && localStorage.getItem('alpha_reduce_motion') === 'true') {
        this.sleep();
        return;
      }
      if (this.isSleeping) return;
      if (Math.abs(e.clientX - this.pointerX) < 1 && Math.abs(e.clientY - this.pointerY) < 1) {
        return;
      }
      this.pointerX = e.clientX;
      this.pointerY = e.clientY;
      this.isPointerInView = true;

      // 快速判定当前鼠标聚焦的最深层卡片
      const hovered = this.findInnermostCard(e.target);
      if (hovered !== this.activeHoveredCard) {
        if (this.activeHoveredCard) {
          const oldData = this.cardDataMap.get(this.activeHoveredCard);
          if (oldData) {
            oldData.card.style.setProperty('--cg-surface-opacity', '0');
          }
        }
        this.activeHoveredCard = hovered;
        if (hovered) {
          this.attachGlowToCard(hovered);
        }
      }

      this.requestUpdate();
    }

    onPointerLeave() {
      this.isPointerInView = false;
      this.pointerX = -9999;
      this.pointerY = -9999;

      if (this.activeHoveredCard) {
        const data = this.cardDataMap.get(this.activeHoveredCard);
        if (data) {
          data.card.style.setProperty('--cg-surface-opacity', '0');
        }
        this.activeHoveredCard = null;
      }

      this.trackedCards.forEach(card => {
        const data = this.cardDataMap.get(card);
        if (data) {
          card.style.setProperty('--cg-border-opacity', '0');
          card.style.setProperty('--cg-surface-opacity', '0');
        }
      });
    }

    requestUpdate() {
      if (this.rafId) return;
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        this.processGlowPhysics();
      });
    }

    processGlowPhysics() {
      if (!this.isPointerInView || this.isSleeping) return;

      this.updateRectCache();

      const cx = this.pointerX;
      const cy = this.pointerY;
      const lightRadius = CONFIG.borderLightRadius;

      // 1. 处理聚焦卡片的表面高光 (Surface Specular Glow)
      if (this.activeHoveredCard && this.activeHoveredCard.isConnected) {
        const activeData = this.cardDataMap.get(this.activeHoveredCard);
        if (activeData && activeData.rect) {
          const rect = activeData.rect;
          const sx = cx - rect.left;
          const sy = cy - rect.top;

          const sxStr = `${sx.toFixed(1)}px`;
          const syStr = `${sy.toFixed(1)}px`;

          if (activeData.lastSxStr !== sxStr) {
            activeData.card.style.setProperty('--cg-surface-x', sxStr);
            activeData.lastSxStr = sxStr;
          }
          if (activeData.lastSyStr !== syStr) {
            activeData.card.style.setProperty('--cg-surface-y', syStr);
            activeData.lastSyStr = syStr;
          }
          if (activeData.lastSurfaceOpacityStr !== '1') {
            activeData.card.style.setProperty('--cg-surface-opacity', '1');
            activeData.lastSurfaceOpacityStr = '1';
          }
        }
      }

      // 2. 跨卡片计算边框高光 (Proximity Border Glow) - 仅更新最邻近的至多 2 张卡片，避免多卡片重绘
      const inRangeCards = [];
      this.trackedCards.forEach(card => {
        const data = this.cardDataMap.get(card);
        if (!data || !data.isInView || !data.rect) return;

        const rect = data.rect;
        if (rect.width === 0 || rect.height === 0) return;

        const dx = Math.max(rect.left - cx, 0, cx - rect.right);
        const dy = Math.max(rect.top - cy, 0, cy - rect.bottom);
        const dist = Math.hypot(dx, dy);

        if (dist < lightRadius) {
          inRangeCards.push({ card, data, rect, dist });
        } else {
          if (data.borderOpacity !== 0) {
            card.style.setProperty('--cg-border-opacity', '0');
            data.borderOpacity = 0;
            data.lastBorderOpacityStr = '0';
          }
        }
      });

      // 仅保留距离最近的 2 张卡片
      if (inRangeCards.length > 2) {
        inRangeCards.sort((a, b) => a.dist - b.dist);
        for (let i = 2; i < inRangeCards.length; i++) {
          const item = inRangeCards[i];
          if (item.data.borderOpacity !== 0) {
            item.card.style.setProperty('--cg-border-opacity', '0');
            item.data.borderOpacity = 0;
            item.data.lastBorderOpacityStr = '0';
          }
        }
        inRangeCards.length = 2;
      }

      for (let i = 0; i < inRangeCards.length; i++) {
        const { card, data, rect, dist } = inRangeCards[i];
        const bx = cx - rect.left;
        const by = cy - rect.top;

        let borderOpacity = 0;
        if (dist === 0) {
          const distToEdge = Math.min(
            cx - rect.left,
            rect.right - cx,
            cy - rect.top,
            rect.bottom - cy
          );
          if (distToEdge < 180) {
            borderOpacity = clamp(1 - (distToEdge - 20) / 140, 0.50, 1.0);
          } else {
            borderOpacity = 0.30;
          }
        } else {
          const normDist = dist / lightRadius;
          borderOpacity = Math.pow(Math.max(0, 1 - normDist), 1.1) * 0.98;
        }

        const bxStr = `${bx.toFixed(1)}px`;
        const byStr = `${by.toFixed(1)}px`;
        const borderOpacityStr = borderOpacity.toFixed(3);

        if (data.lastBxStr !== bxStr) {
          card.style.setProperty('--cg-border-x', bxStr);
          data.lastBxStr = bxStr;
        }
        if (data.lastByStr !== byStr) {
          card.style.setProperty('--cg-border-y', byStr);
          data.lastByStr = byStr;
        }
        if (data.lastBorderOpacityStr !== borderOpacityStr) {
          card.style.setProperty('--cg-border-opacity', borderOpacityStr);
          data.lastBorderOpacityStr = borderOpacityStr;
        }
        data.borderOpacity = borderOpacity;
      }
    }
  }

  const AlphaCardGlow = {
    instances: new Set(),

    init(doc) {
      const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
      if (!targetDoc) return null;
      if (targetDoc.__alphaCardGlowManager) return targetDoc.__alphaCardGlowManager;

      const manager = new CardGlowManager(targetDoc);
      targetDoc.__alphaCardGlowManager = manager;
      this.instances.add(manager);

      return manager;
    },

    injectIntoDocument(doc) {
      return this.init(doc);
    },

    sleep(doc) {
      const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
      if (targetDoc && targetDoc.__alphaCardGlowManager) {
        targetDoc.__alphaCardGlowManager.sleep();
      } else {
        this.instances.forEach(m => m.sleep());
      }
    },

    wake(doc) {
      const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
      if (targetDoc && targetDoc.__alphaCardGlowManager) {
        targetDoc.__alphaCardGlowManager.wake();
      } else {
        this.instances.forEach(m => m.wake());
      }
    }
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => AlphaCardGlow.init(document));
    } else {
      AlphaCardGlow.init(document);
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AlphaCardGlow;
  }
  if (typeof window !== 'undefined') {
    window.AlphaCardGlow = AlphaCardGlow;
    window.AlphaImmersiveGlow = AlphaCardGlow;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.AlphaCardGlow = AlphaCardGlow;
    globalThis.AlphaImmersiveGlow = AlphaCardGlow;
  }
})(typeof window !== 'undefined' ? window : globalThis);
