/**
 * Alpha Icon & Avatar Liquid Glass Engine
 * Fluid Elastic Deformation & Specular Highlight for Embedded Icons & Avatars (Edge-light Castrated)
 * (c) Tasks Project - Liquid Glass Suite
 */

(function (global) {
  'use strict';

  // 目标图标与头像组件选择器体系
  const ICON_SELECTORS = [
    '.avatar-wrap',
    '.nav-card',
    '.picker-icon',
    '.time-wrap .time-icon',
    '.time-icon',
    '[data-icon-glass]'
  ];
  const ICON_SELECTOR = ICON_SELECTORS.join(', ');

  // 严格排除选择器
  const EXCLUDE_SELECTORS = [
    '.no-liquid',
    '.no-icon-glass',
    '[data-no-icon-glass]'
  ];
  const EXCLUDE_SELECTOR = EXCLUDE_SELECTORS.join(', ');

  // 物理配置：针对小图标、圆形头像与导航卡片特别调优的弹簧阻尼与聚光模型
  const CONFIG = {
    avatar: {
      maxOffsetX: 7,
      maxOffsetY: 7,
      moveRatio: 0.18,
      stretchFactor: 0.025,
      maxRot: 1.2,
      pressScale: 0.97,
      hoverScale: 1.025,
      stiffness: 520,
      damping: 30,
      mass: 1.0,
      specularRadius: 90,
      specularIntensity: 0.60
    },
    navCard: {
      maxOffsetX: 8,
      maxOffsetY: 7,
      moveRatio: 0.16,
      stretchFactor: 0.025,
      maxRot: 1.2,
      pressScale: 0.96,
      hoverScale: 1.025,
      stiffness: 480,
      damping: 28,
      mass: 1.0,
      specularRadius: 140,
      specularIntensity: 0.80
    },
    icon: {
      maxOffsetX: 12,
      maxOffsetY: 10,
      moveRatio: 0.48,
      stretchFactor: 0.12,
      maxRot: 3.5,
      pressScale: 0.92,
      hoverScale: 1.10,
      stiffness: 420,
      damping: 26,
      mass: 0.9,
      specularRadius: 36,
      specularIntensity: 0.75
    }
  };

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  class IconGlassManager {
    constructor(targetDoc) {
      this.doc = targetDoc || (typeof document !== 'undefined' ? document : null);
      if (!this.doc) return;

      this.elements = new Map(); // el -> state
      this.activeStates = new Set();
      this.rafId = null;

      this.boundOnPointerDown = this.onPointerDown.bind(this);
      this.boundOnPointerMove = this.onPointerMove.bind(this);
      this.boundOnPointerUp = this.onPointerUp.bind(this);
      this.boundOnPointerEnter = this.onPointerEnter.bind(this);
      this.boundOnPointerLeave = this.onPointerLeave.bind(this);

      this.init();
    }

    init() {
      if (!this.doc || this.doc.__alphaIconGlassInstalled) return;
      this.doc.__alphaIconGlassInstalled = true;

      this.injectStyles();
      this.bindEvents();
    }

    injectStyles() {
      if (this.doc.getElementById('__alphaIconGlassStyle')) return;

      const style = this.doc.createElement('style');
      style.id = '__alphaIconGlassStyle';
      style.textContent = `
        /* 图标与头像流体形变基类 (支持基线 translateY 补偿，阉割边缘描边) */
        ${ICON_SELECTOR} {
          --ig-tx: 0px;
          --ig-ty: 0px;
          --ig-scale: 1;
          --ig-sx: 1;
          --ig-sy: 1;
          --ig-rot: 0deg;
          --ig-lx: 50%;
          --ig-ly: 50%;
          --ig-lo: 0;
          --ig-base-ty: 0%;
          transform: translateY(var(--ig-base-ty, 0%)) translate3d(
            var(--ig-tx, 0px),
            var(--ig-ty, 0px),
            0
          ) scale(var(--ig-scale, 1)) scaleX(var(--ig-sx, 1)) scaleY(var(--ig-sy, 1)) rotate(var(--ig-rot, 0deg)) !important;
          will-change: transform;
          touch-action: none;
          user-select: none !important;
          -webkit-user-select: none !important;
          -webkit-user-drag: none !important;
        }

        /* 绝对定位并垂直居中的 picker-icon 特别指定 base-ty 为 -50% */
        .picker-icon {
          --ig-base-ty: -50% !important;
        }

        /* 纯净晶莹的表面聚光反射层 (::after 叠加，无外围描边与边框光) */
        .avatar-wrap::after,
        .nav-card::after,
        .picker-icon::after,
        .time-wrap .time-icon::after,
        .time-icon::after,
        [data-icon-glass]::after {
          content: '' !important;
          position: absolute !important;
          inset: 0 !important;
          border-radius: inherit !important;
          pointer-events: none !important;
          opacity: var(--ig-lo, 0) !important;
          background: radial-gradient(
            circle var(--ig-spec-radius, 40px) at var(--ig-lx, 50%) var(--ig-ly, 50%),
            rgba(255, 255, 255, 0.85) 0%,
            rgba(255, 255, 255, 0.45) 35%,
            rgba(255, 255, 255, 0.12) 65%,
            transparent 80%
          ) !important;
          mix-blend-mode: overlay !important;
          transition: opacity 0.25s ease !important;
          z-index: 10 !important;
        }

        .avatar-wrap > *,
        .nav-card > *,
        .picker-icon > *,
        .time-icon > * {
          pointer-events: none;
        }

        /* 深色模式：统一减弱图标与头像的表面高光聚光浓度 */
        @media (prefers-color-scheme: dark) {
          .avatar-wrap::after,
          .nav-card::after,
          .picker-icon::after,
          .time-wrap .time-icon::after,
          .time-icon::after,
          [data-icon-glass]::after {
            background: radial-gradient(
              circle var(--ig-spec-radius, 40px) at var(--ig-lx, 50%) var(--ig-ly, 50%),
              rgba(255, 255, 255, 0.35) 0%,
              rgba(255, 255, 255, 0.16) 35%,
              rgba(255, 255, 255, 0.04) 65%,
              transparent 80%
            ) !important;
            opacity: calc(var(--ig-lo, 0) * 0.65) !important;
          }
        }
      `;

      (this.doc.head || this.doc.documentElement).appendChild(style);
    }

    getTarget(target) {
      if (!target || !target.closest) return null;
      const el = target.closest(ICON_SELECTOR);
      if (!el || el.matches(EXCLUDE_SELECTOR)) return null;
      return el;
    }

    getState(el) {
      let state = this.elements.get(el);
      if (!state) {
        const isNavCard = el.classList.contains('nav-card');
        const isAvatar = el.classList.contains('avatar-wrap');
        const profile = isNavCard ? CONFIG.navCard : (isAvatar ? CONFIG.avatar : CONFIG.icon);
        state = {
          el,
          isNavCard,
          isAvatar,
          profile,
          // 物理模拟量
          x: 0, y: 0, vx: 0, vy: 0,
          sx: 1, sy: 1, vsx: 0, vsy: 0,
          rot: 0, vrot: 0,
          scale: 1, vscale: 0,
          targetScale: 1,
          targetSx: 1, targetSy: 1,
          targetRot: 0,
          // 光照模拟量
          lx: 50, ly: 50,
          lo: 0, targetLo: 0,
          // 手势状态
          isPressed: false,
          isHovered: false,
          startX: 0, startY: 0,
          pointerId: null,
          rect: null,
          lastTime: performance.now()
        };
        el.style.setProperty('--ig-spec-radius', `${profile.specularRadius}px`);
        this.elements.set(el, state);
      }
      return state;
    }

    bindEvents() {
      this.boundOnSleep = () => {
        this.isSleeping = true;
        if (this.rafId) {
          cancelAnimationFrame(this.rafId);
          this.rafId = null;
        }
      };
      this.boundOnWake = () => {
        this.isSleeping = false;
      };

      this.doc.addEventListener('pointerdown', this.boundOnPointerDown, { passive: false });
      this.doc.addEventListener('pointermove', this.boundOnPointerMove, { passive: true });
      this.doc.addEventListener('pointerup', this.boundOnPointerUp, { passive: true });
      this.doc.addEventListener('pointercancel', this.boundOnPointerUp, { passive: true });
      this.doc.addEventListener('pointerover', this.boundOnPointerEnter, { passive: true });
      this.doc.addEventListener('pointerout', this.boundOnPointerLeave, { passive: true });
      this.doc.addEventListener('AlphaSleep', this.boundOnSleep);
      this.doc.addEventListener('AlphaWake', this.boundOnWake);

      const win = this.doc.defaultView || (typeof window !== 'undefined' ? window : null);
      if (win) {
        win.addEventListener('AlphaSleep', this.boundOnSleep);
        win.addEventListener('AlphaWake', this.boundOnWake);
      }
    }

    onPointerEnter(e) {
      const el = this.getTarget(e.target);
      if (!el) return;
      const state = this.getState(el);
      state.isHovered = true;
      if (!state.isPressed) {
        state.targetScale = state.profile.hoverScale;
      }
      state.targetLo = 1;
      this.activeStates.add(state);
      this.startLoop();
    }

    onPointerLeave(e) {
      const el = this.getTarget(e.target);
      if (!el) return;
      const state = this.getState(el);
      state.isHovered = false;
      if (!state.isPressed) {
        state.targetScale = 1;
        state.targetSx = 1;
        state.targetSy = 1;
        state.targetRot = 0;
        state.targetLo = 0;
      }
      this.activeStates.add(state);
      this.startLoop();
    }

    onPointerDown(e) {
      if (e.button !== 0) return;
      const el = this.getTarget(e.target);
      if (!el) return;

      const state = this.getState(el);
      state.isPressed = true;
      state.pointerId = e.pointerId;
      state.startX = e.clientX;
      state.startY = e.clientY;
      state.rect = el.getBoundingClientRect();
      state.targetScale = state.profile.pressScale;
      state.targetLo = 1;

      try {
        el.setPointerCapture(e.pointerId);
      } catch (_) {}

      this.activeStates.add(state);
      this.startLoop();
    }

    onPointerMove(e) {
      const targetEl = this.getTarget(e.target);
      if (targetEl) {
        const state = this.getState(targetEl);
        if (!state.isHovered) {
          state.isHovered = true;
          if (!state.isPressed) state.targetScale = state.profile.hoverScale;
          state.targetLo = 1;
        }
        this.activeStates.add(state);
        this.startLoop();
      }

      // 遍历所有处于按压拖拽或悬停中的状态
      this.activeStates.forEach(state => {
        if (!state.el.isConnected) {
          this.activeStates.delete(state);
          return;
        }

        const rect = state.rect || state.el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        // 计算局部光标坐标百分比
        const localX = clamp(((e.clientX - rect.left) / rect.width) * 100, 0, 100);
        const localY = clamp(((e.clientY - rect.top) / rect.height) * 100, 0, 100);
        state.lx += (localX - state.lx) * 0.35;
        state.ly += (localY - state.ly) * 0.35;

        if (state.isPressed) {
          const dx = e.clientX - state.startX;
          const dy = e.clientY - state.startY;
          const profile = state.profile;

          // 物理弹性位移限制
          const tx = clamp(dx * profile.moveRatio, -profile.maxOffsetX, profile.maxOffsetX);
          const ty = clamp(dy * profile.moveRatio, -profile.maxOffsetY, profile.maxOffsetY);

          state.x = tx;
          state.y = ty;

          // 速度拉伸与倾斜
          const dist = Math.hypot(dx, dy);
          const stretch = Math.min(dist * 0.005, profile.stretchFactor || 0.08);
          state.targetSx = 1 + stretch * (Math.abs(dx) >= Math.abs(dy) ? 1 : -0.5);
          state.targetSy = 1 + stretch * (Math.abs(dy) > Math.abs(dx) ? 1 : -0.5);
          state.targetRot = clamp((dx / profile.maxOffsetX) * profile.maxRot, -profile.maxRot, profile.maxRot);
        }
      });
    }

    onPointerUp(e) {
      this.activeStates.forEach(state => {
        if (state.pointerId === e.pointerId || !state.isPressed) {
          state.isPressed = false;
          state.pointerId = null;
          state.targetScale = state.isHovered ? state.profile.hoverScale : 1;
          state.targetSx = 1;
          state.targetSy = 1;
          state.targetRot = 0;
          if (!state.isHovered) {
            state.targetLo = 0;
          }

          try {
            state.el.releasePointerCapture(e.pointerId);
          } catch (_) {}
        }
      });
      this.startLoop();
    }

    startLoop() {
      if (this.rafId) return;

      const loop = (now) => {
        let hasActiveWork = false;

        this.activeStates.forEach(state => {
          const el = state.el;
          if (!el || !el.isConnected) {
            this.activeStates.delete(state);
            return;
          }

          const dt = Math.min((now - state.lastTime) / 1000, 0.033) || 0.016;
          state.lastTime = now;
          const profile = state.profile;

          // 1. 位置弹簧力学 (松手回弹目标为 0,0)
          if (!state.isPressed) {
            const fx = -profile.stiffness * state.x - profile.damping * state.vx;
            const fy = -profile.stiffness * state.y - profile.damping * state.vy;
            state.vx += (fx / profile.mass) * dt;
            state.vy += (fy / profile.mass) * dt;
            state.x += state.vx * dt;
            state.y += state.vy * dt;
          }

          // 2. 缩放与形变插值
          state.scale += (state.targetScale - state.scale) * 0.28;
          state.sx += (state.targetSx - state.sx) * 0.28;
          state.sy += (state.targetSy - state.sy) * 0.28;
          state.rot += (state.targetRot - state.rot) * 0.25;

          // 3. 高光透明度插值
          state.lo += (state.targetLo - state.lo) * 0.22;

          // 应用样式变量
          el.style.setProperty('--ig-tx', `${state.x.toFixed(2)}px`);
          el.style.setProperty('--ig-ty', `${state.y.toFixed(2)}px`);
          el.style.setProperty('--ig-scale', state.scale.toFixed(3));
          el.style.setProperty('--ig-sx', state.sx.toFixed(3));
          el.style.setProperty('--ig-sy', state.sy.toFixed(3));
          el.style.setProperty('--ig-rot', `${state.rot.toFixed(2)}deg`);
          el.style.setProperty('--ig-lx', `${state.lx.toFixed(1)}%`);
          el.style.setProperty('--ig-ly', `${state.ly.toFixed(1)}%`);
          el.style.setProperty('--ig-lo', state.lo.toFixed(3));

          // 判定是否达到静止状态
          const isSettled =
            !state.isPressed &&
            Math.abs(state.x) < 0.05 && Math.abs(state.y) < 0.05 &&
            Math.abs(state.vx) < 0.05 && Math.abs(state.vy) < 0.05 &&
            Math.abs(state.scale - state.targetScale) < 0.005 &&
            Math.abs(state.sx - 1) < 0.005 && Math.abs(state.sy - 1) < 0.005 &&
            Math.abs(state.rot) < 0.05 &&
            Math.abs(state.lo - state.targetLo) < 0.005;

          if (isSettled) {
            state.x = 0;
            state.y = 0;
            state.vx = 0;
            state.vy = 0;
            state.scale = state.targetScale;
            state.sx = 1;
            state.sy = 1;
            state.rot = 0;
            state.lo = state.targetLo;

            el.style.setProperty('--ig-tx', '0px');
            el.style.setProperty('--ig-ty', '0px');
            el.style.setProperty('--ig-scale', state.targetScale.toString());
            el.style.setProperty('--ig-sx', '1');
            el.style.setProperty('--ig-sy', '1');
            el.style.setProperty('--ig-rot', '0deg');
            el.style.setProperty('--ig-lo', state.targetLo.toString());

            this.activeStates.delete(state);
          } else {
            hasActiveWork = true;
          }
        });

        if (hasActiveWork && this.activeStates.size > 0) {
          this.rafId = requestAnimationFrame(loop);
        } else {
          this.rafId = null;
        }
      };

      this.rafId = requestAnimationFrame(loop);
    }
  }

  const AlphaIconGlass = {
    init(doc) {
      const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
      if (!targetDoc) return null;
      if (targetDoc.__alphaIconGlassManager) return targetDoc.__alphaIconGlassManager;

      const manager = new IconGlassManager(targetDoc);
      targetDoc.__alphaIconGlassManager = manager;
      return manager;
    }
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => AlphaIconGlass.init(document));
    } else {
      AlphaIconGlass.init(document);
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AlphaIconGlass;
  }
  if (typeof window !== 'undefined') {
    window.AlphaIconGlass = AlphaIconGlass;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.AlphaIconGlass = AlphaIconGlass;
  }
})(typeof window !== 'undefined' ? window : globalThis);
