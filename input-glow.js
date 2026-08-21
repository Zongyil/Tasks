/**
 * Alpha Input & Textarea Specular Glow Engine
 * Localized Surface Specular Illumination for Text Inputs, Textareas, and Field Boxes
 * (c) Tasks Project - Liquid Glass Suite
 */

(function (global) {
  'use strict';

  // 目标文本框、文本域与表单矩形控件选择器体系
  const INPUT_SELECTORS = [
    'input[type="text"]',
    'input[type="number"]',
    'input[type="password"]',
    'input[type="search"]',
    'input:not([type])',
    'textarea',
    '.pop-input-fx',
    '.list-trigger-container',
    '.pop-list-item',
    '.sync-code-box',
    '.menu-item',
    '.clock-container',
    '#clockFace',
    '[data-input-glow]'
  ];
  const INPUT_SELECTOR = INPUT_SELECTORS.join(', ');

  // 严格排除选择器 (单选、多选、按钮、滑块、隐藏域等)
  const EXCLUDE_SELECTORS = [
    'input[type="checkbox"]',
    'input[type="radio"]',
    'input[type="file"]',
    'input[type="button"]',
    'input[type="submit"]',
    'input[type="reset"]',
    'input[type="range"]',
    'input[type="color"]',
    'input[type="hidden"]',
    '.no-input-glow',
    '[data-no-input-glow]',
    '.no-liquid',
    '.alpha-switch',
    '.flatpickr-calendar',
    '.numInputWrapper input'
  ];
  const EXCLUDE_SELECTOR = EXCLUDE_SELECTORS.join(', ');

  const CONFIG = {
    minRadius: 110,
    maxRadius: 180,
    specularIntensity: 0.80,
    lerpSpeed: 0.38,
    fadeSpeed: 0.22
  };

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  class InputGlowManager {
    constructor(targetDoc) {
      this.doc = targetDoc || (typeof document !== 'undefined' ? document : null);
      if (!this.doc) return;

      this.activeElement = null;
      this.activeState = null;
      this.animatingStates = new Set();
      this.rafId = null;

      this.boundOnPointerMove = this.onPointerMove.bind(this);
      this.boundOnPointerLeave = this.onPointerLeave.bind(this);
      this.boundOnFocus = this.onFocus.bind(this);
      this.boundOnBlur = this.onBlur.bind(this);

      this.init();
    }

    init() {
      if (!this.doc || this.doc.__alphaInputGlowInstalled) return;
      this.doc.__alphaInputGlowInstalled = true;

      this.injectStyles();
      this.bindEvents();
    }

    injectStyles() {
      if (this.doc.getElementById('__alphaInputGlowStyle')) return;

      const style = this.doc.createElement('style');
      style.id = '__alphaInputGlowStyle';
      style.textContent = `
        /* 文本输入框与多行文本域高光受光底图配置 (浓郁透亮的局部核心高光 + 柔和边缘羽化) */
        ${INPUT_SELECTOR} {
          --ig-x: 50%;
          --ig-y: 50%;
          --ig-opacity: 0;
          --ig-radius: 140px;
          background-image: radial-gradient(
            circle var(--ig-radius, 140px) at var(--ig-x, 50%) var(--ig-y, 50%),
            rgba(255, 255, 255, calc(var(--ig-opacity, 0) * ${CONFIG.specularIntensity})) 0%,
            rgba(255, 255, 255, calc(var(--ig-opacity, 0) * ${CONFIG.specularIntensity * 0.68})) 20%,
            rgba(255, 255, 255, calc(var(--ig-opacity, 0) * ${CONFIG.specularIntensity * 0.28})) 48%,
            rgba(255, 255, 255, calc(var(--ig-opacity, 0) * ${CONFIG.specularIntensity * 0.06})) 72%,
            transparent 86%
          ) !important;
          background-repeat: no-repeat !important;
        }

        /* 保证添加到表单矩形控件的高光透亮叠加 */
        .list-trigger-container {
          --ig-x: 50%;
          --ig-y: 50%;
          --ig-opacity: 0;
          --ig-radius: 140px;
          background-image: radial-gradient(
            circle var(--ig-radius, 140px) at var(--ig-x, 50%) var(--ig-y, 50%),
            rgba(255, 255, 255, calc(var(--ig-opacity, 0) * ${CONFIG.specularIntensity})) 0%,
            rgba(255, 255, 255, calc(var(--ig-opacity, 0) * ${CONFIG.specularIntensity * 0.68})) 20%,
            rgba(255, 255, 255, calc(var(--ig-opacity, 0) * ${CONFIG.specularIntensity * 0.28})) 48%,
            rgba(255, 255, 255, calc(var(--ig-opacity, 0) * ${CONFIG.specularIntensity * 0.06})) 72%,
            transparent 86%
          ) !important;
        }

        /* 保证选择现有表单选项 (.pop-list-item) 带有动态高光与原有毛玻璃渐变完美合成叠加 */
        .pop-list-item,
        #alphaListModalOverlay .pop-list-item {
          --ig-x: 50%;
          --ig-y: 50%;
          --ig-opacity: 0;
          --ig-radius: 140px;
          background-image: radial-gradient(
            circle var(--ig-radius, 140px) at var(--ig-x, 50%) var(--ig-y, 50%),
            rgba(255, 255, 255, calc(var(--ig-opacity, 0) * ${CONFIG.specularIntensity})) 0%,
            rgba(255, 255, 255, calc(var(--ig-opacity, 0) * ${CONFIG.specularIntensity * 0.68})) 20%,
            rgba(255, 255, 255, calc(var(--ig-opacity, 0) * ${CONFIG.specularIntensity * 0.28})) 48%,
            rgba(255, 255, 255, calc(var(--ig-opacity, 0) * ${CONFIG.specularIntensity * 0.06})) 72%,
            transparent 86%
          ), linear-gradient(135deg, rgba(255, 255, 255, 0.45) 0%, rgba(255, 255, 255, 0.22) 100%) !important;
          background-repeat: no-repeat !important;
        }
        .pop-list-item:hover,
        #alphaListModalOverlay .pop-list-item:hover {
          background-image: radial-gradient(
            circle var(--ig-radius, 140px) at var(--ig-x, 50%) var(--ig-y, 50%),
            rgba(255, 255, 255, calc(var(--ig-opacity, 0) * ${CONFIG.specularIntensity})) 0%,
            rgba(255, 255, 255, calc(var(--ig-opacity, 0) * ${CONFIG.specularIntensity * 0.68})) 20%,
            rgba(255, 255, 255, calc(var(--ig-opacity, 0) * ${CONFIG.specularIntensity * 0.28})) 48%,
            rgba(255, 255, 255, calc(var(--ig-opacity, 0) * ${CONFIG.specularIntensity * 0.06})) 72%,
            transparent 86%
          ), linear-gradient(135deg, rgba(255, 255, 255, 0.48) 0%, rgba(255, 255, 255, 0.26) 100%) !important;
        }

        /* 菜单选项 (.menu-item) 动态高光配置，鼠标悬停时补充生动光效 */
        .menu-item {
          --ig-x: 50%;
          --ig-y: 50%;
          --ig-opacity: 0;
          --ig-radius: 120px;
          background-image: radial-gradient(
            circle var(--ig-radius, 120px) at var(--ig-x, 50%) var(--ig-y, 50%),
            rgba(255, 255, 255, calc(var(--ig-opacity, 0) * ${CONFIG.specularIntensity})) 0%,
            rgba(255, 255, 255, calc(var(--ig-opacity, 0) * ${CONFIG.specularIntensity * 0.68})) 20%,
            rgba(255, 255, 255, calc(var(--ig-opacity, 0) * ${CONFIG.specularIntensity * 0.28})) 48%,
            rgba(255, 255, 255, calc(var(--ig-opacity, 0) * ${CONFIG.specularIntensity * 0.06})) 72%,
            transparent 86%
          ) !important;
          background-repeat: no-repeat !important;
        }

        /* 针对淡红色危险/警示选项 (.menu-item.danger, .danger)，采用更加轻柔淡雅的高光，避免冲淡红色衬底 */
        .menu-item.danger,
        .pop-list-item.danger,
        .danger[data-input-glow],
        [data-danger] {
          --ig-x: 50%;
          --ig-y: 50%;
          --ig-opacity: 0;
          --ig-radius: 120px;
          background-image: radial-gradient(
            circle var(--ig-radius, 120px) at var(--ig-x, 50%) var(--ig-y, 50%),
            rgba(255, 255, 255, calc(var(--ig-opacity, 0) * ${CONFIG.specularIntensity * 0.42})) 0%,
            rgba(255, 255, 255, calc(var(--ig-opacity, 0) * ${CONFIG.specularIntensity * 0.42 * 0.68})) 20%,
            rgba(255, 255, 255, calc(var(--ig-opacity, 0) * ${CONFIG.specularIntensity * 0.42 * 0.28})) 48%,
            rgba(255, 255, 255, calc(var(--ig-opacity, 0) * ${CONFIG.specularIntensity * 0.42 * 0.06})) 72%,
            transparent 86%
          ) !important;
          background-repeat: no-repeat !important;
        }

        /* TaskHub 模拟时钟表盘高光配置 (.clock-container, #clockFace) - 增强型双层 3D 拟物液态玻璃高光与光晕 */
        .clock-container,
        #clockFace {
          --ig-x: 50%;
          --ig-y: 50%;
          --ig-opacity: 0;
          --ig-radius: 185px;
          background-image:
            radial-gradient(
              circle 110px at var(--ig-x, 50%) var(--ig-y, 50%),
              rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.95)) 0%,
              rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.75)) 25%,
              rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.38)) 55%,
              transparent 82%
            ),
            radial-gradient(
              circle var(--ig-radius, 185px) at var(--ig-x, 50%) var(--ig-y, 50%),
              rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.70)) 0%,
              rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.45)) 35%,
              rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.18)) 65%,
              transparent 88%
            ) !important;
          background-repeat: no-repeat !important;
        }

        /* 深色模式：统一减弱输入框与表单项的高光浓度 */
        @media (prefers-color-scheme: dark) {
          ${INPUT_SELECTOR} {
            background-image: radial-gradient(
              circle var(--ig-radius, 140px) at var(--ig-x, 50%) var(--ig-y, 50%),
              rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.28)) 0%,
              rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.18)) 20%,
              rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.08)) 48%,
              rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.015)) 72%,
              transparent 86%
            ) !important;
          }

          .list-trigger-container {
            background-image: radial-gradient(
              circle var(--ig-radius, 140px) at var(--ig-x, 50%) var(--ig-y, 50%),
              rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.28)) 0%,
              rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.18)) 20%,
              rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.08)) 48%,
              rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.015)) 72%,
              transparent 86%
            ) !important;
          }

          .pop-list-item,
          #alphaListModalOverlay .pop-list-item {
            background-image: radial-gradient(
              circle var(--ig-radius, 140px) at var(--ig-x, 50%) var(--ig-y, 50%),
              rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.28)) 0%,
              rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.18)) 20%,
              rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.08)) 48%,
              rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.015)) 72%,
              transparent 86%
            ), linear-gradient(135deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.05) 100%) !important;
          }

          .pop-list-item:hover,
          #alphaListModalOverlay .pop-list-item:hover {
            background-image: radial-gradient(
              circle var(--ig-radius, 140px) at var(--ig-x, 50%) var(--ig-y, 50%),
              rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.32)) 0%,
              rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.20)) 20%,
              rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.09)) 48%,
              rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.02)) 72%,
              transparent 86%
            ), linear-gradient(135deg, rgba(255, 255, 255, 0.16) 0%, rgba(255, 255, 255, 0.08) 100%) !important;
          }

          .menu-item {
            background-image: radial-gradient(
              circle var(--ig-radius, 120px) at var(--ig-x, 50%) var(--ig-y, 50%),
              rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.28)) 0%,
              rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.18)) 20%,
              rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.08)) 48%,
              rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.015)) 72%,
              transparent 86%
            ) !important;
          }

          .menu-item.danger,
          .pop-list-item.danger,
          .danger[data-input-glow],
          [data-danger] {
            background-image: radial-gradient(
              circle var(--ig-radius, 120px) at var(--ig-x, 50%) var(--ig-y, 50%),
              rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.18)) 0%,
              rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.12)) 20%,
              rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.05)) 48%,
              rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.01)) 72%,
              transparent 86%
            ) !important;
          }

          .clock-container,
          #clockFace {
            background-image:
              radial-gradient(
                circle 110px at var(--ig-x, 50%) var(--ig-y, 50%),
                rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.40)) 0%,
                rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.28)) 25%,
                rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.12)) 55%,
                transparent 82%
              ),
              radial-gradient(
                circle var(--ig-radius, 185px) at var(--ig-x, 50%) var(--ig-y, 50%),
                rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.28)) 0%,
                rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.16)) 35%,
                rgba(255, 255, 255, calc(var(--ig-opacity, 0) * 0.06)) 65%,
                transparent 88%
              ) !important;
          }
        }
      `;

      (this.doc.head || this.doc.documentElement).appendChild(style);
    }

    bindEvents() {
      this.boundOnSleep = () => {
        this.isSleeping = true;
        this.boundOnPointerLeave();
      };
      this.boundOnWake = () => {
        this.isSleeping = false;
      };

      this.doc.addEventListener('pointermove', this.boundOnPointerMove, { passive: true });
      this.doc.addEventListener('pointerleave', this.boundOnPointerLeave, { passive: true });
      this.doc.addEventListener('focusin', this.boundOnFocus, { passive: true });
      this.doc.addEventListener('focusout', this.boundOnBlur, { passive: true });
      this.doc.addEventListener('AlphaSleep', this.boundOnSleep);
      this.doc.addEventListener('AlphaWake', this.boundOnWake);

      const win = this.doc.defaultView || (typeof window !== 'undefined' ? window : null);
      if (win) {
        win.addEventListener('blur', this.boundOnPointerLeave, { passive: true });
        win.addEventListener('scroll', this.boundOnPointerLeave, { passive: true, capture: true });
        win.addEventListener('AlphaSleep', this.boundOnSleep);
        win.addEventListener('AlphaWake', this.boundOnWake);
      }

      this.doc.addEventListener('visibilitychange', () => {
        if (this.doc.hidden) this.boundOnPointerLeave();
      });
    }

    getInputTarget(target) {
      if (!target || !target.closest) return null;
      // 优先寻找合法的目标元素
      const el = target.closest(INPUT_SELECTOR);
      if (!el) return null;
      // 如果目标自身匹配排除器，则排除
      if (el.matches(EXCLUDE_SELECTOR)) return null;
      if (el.disabled || el.classList.contains('disabled')) return null;
      return el;
    }

    onPointerMove(e) {
      if (typeof localStorage !== 'undefined' && localStorage.getItem('alpha_reduce_motion') === 'true') {
        if (this.activeState) {
          this.activeState.targetOpacity = 0;
          this.activeState = null;
          this.activeElement = null;
        }
        return;
      }
      const el = this.getInputTarget(e.target);
      if (!el) {
        if (this.activeState) {
          this.activeState.targetOpacity = 0;
          this.activeState = null;
          this.activeElement = null;
          this.startLoop();
        }
        return;
      }

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      let state = el.__alphaInputGlowState;
      if (!state) {
        const maxDim = Math.max(rect.width, rect.height);
        const isClock = el.classList.contains('clock-container') || el.id === 'clockFace';
        const isArea = el.tagName === 'TEXTAREA' || el.classList.contains('pop-list-item');
        const isMenuItem = el.classList.contains('menu-item');
        const radius = isClock
          ? clamp(Math.round(maxDim * 0.75), 170, 230)
          : (isMenuItem
            ? clamp(Math.round(maxDim * 0.65), 110, 150)
            : (isArea
              ? clamp(Math.round(maxDim * 0.42), 140, CONFIG.maxRadius)
              : clamp(Math.round(rect.width * 0.38), CONFIG.minRadius, 160)));

        state = {
          el,
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          targetX: e.clientX - rect.left,
          targetY: e.clientY - rect.top,
          opacity: 0,
          targetOpacity: 1,
          radius,
          rect
        };
        el.__alphaInputGlowState = state;
        el.style.setProperty('--ig-radius', `${radius}px`);
      } else {
        state.rect = rect;
        state.targetX = e.clientX - rect.left;
        state.targetY = e.clientY - rect.top;
        state.targetOpacity = 1;
      }

      if (this.activeState && this.activeState !== state) {
        this.activeState.targetOpacity = 0;
      }

      this.activeElement = el;
      this.activeState = state;
      this.animatingStates.add(state);
      this.startLoop();
    }

    onPointerLeave() {
      if (this.activeState) {
        this.activeState.targetOpacity = 0;
        this.activeState = null;
        this.activeElement = null;
      }
      this.animatingStates.forEach(state => {
        state.targetOpacity = 0;
      });
      this.startLoop();
    }

    onFocus(e) {
      const el = this.getInputTarget(e.target);
      if (!el) return;
      let state = el.__alphaInputGlowState;
      if (state) {
        state.targetOpacity = 1;
        this.animatingStates.add(state);
        this.startLoop();
      }
    }

    onBlur(e) {
      const el = this.getInputTarget(e.target);
      if (!el) return;
      const state = el.__alphaInputGlowState;
      if (state && state !== this.activeState) {
        state.targetOpacity = 0;
        this.startLoop();
      }
    }

    startLoop() {
      if (this.rafId) return;

      const loop = () => {
        let hasActiveWork = false;

        this.animatingStates.forEach(state => {
          const el = state.el;
          if (!el || !el.isConnected) {
            this.animatingStates.delete(state);
            return;
          }

          // 平滑插值计算光标中心与高光透明度
          state.x += (state.targetX - state.x) * CONFIG.lerpSpeed;
          state.y += (state.targetY - state.y) * CONFIG.lerpSpeed;
          state.opacity += (state.targetOpacity - state.opacity) * CONFIG.fadeSpeed;

          el.style.setProperty('--ig-x', `${state.x.toFixed(1)}px`);
          el.style.setProperty('--ig-y', `${state.y.toFixed(1)}px`);
          el.style.setProperty('--ig-opacity', state.opacity.toFixed(3));

          const isSettled =
            Math.abs(state.x - state.targetX) < 0.1 &&
            Math.abs(state.y - state.targetY) < 0.1 &&
            Math.abs(state.opacity - state.targetOpacity) < 0.005;

          if (isSettled) {
            state.x = state.targetX;
            state.y = state.targetY;
            state.opacity = state.targetOpacity;
            el.style.setProperty('--ig-x', `${state.x.toFixed(1)}px`);
            el.style.setProperty('--ig-y', `${state.y.toFixed(1)}px`);
            el.style.setProperty('--ig-opacity', state.opacity.toFixed(3));
            if (state.targetOpacity === 0) {
              el.style.setProperty('--ig-opacity', '0');
              this.animatingStates.delete(state);
            }
          } else {
            hasActiveWork = true;
          }
        });

        if (hasActiveWork) {
          this.rafId = requestAnimationFrame(loop);
        } else {
          this.rafId = null;
        }
      };

      this.rafId = requestAnimationFrame(loop);
    }
  }

  const AlphaInputGlow = {
    instances: new Set(),

    init(doc) {
      const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
      if (!targetDoc) return null;
      if (targetDoc.__alphaInputGlowManager) return targetDoc.__alphaInputGlowManager;

      const manager = new InputGlowManager(targetDoc);
      targetDoc.__alphaInputGlowManager = manager;
      this.instances.add(manager);

      return manager;
    }
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => AlphaInputGlow.init(document));
    } else {
      AlphaInputGlow.init(document);
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AlphaInputGlow;
  }
  if (typeof window !== 'undefined') {
    window.AlphaInputGlow = AlphaInputGlow;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.AlphaInputGlow = AlphaInputGlow;
  }
})(typeof window !== 'undefined' ? window : globalThis);
