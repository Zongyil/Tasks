/**
 * Alpha Switch Drag & Physical Gesture Interaction Engine
 * Direct-Manipulation Smooth Dragging & Snapping for .alpha-switch Controls
 * (c) Tasks Project - Liquid Glass Suite
 */

(function (global) {
  'use strict';

  const TRAVEL_DISTANCE = 14;  // 最大行程位移 (px): 36px 轨道 - 16px 滑块 - 3px 左边距 - 3px 右边距
  const DRAG_THRESHOLD = 2;    // 判定为拖拽的最小位移阈值 (px)
  const MAX_OVERSHOOT = 2.6;   // 边界最大弹性溢出极限 (px)，确保微量出去但最终绝对“拉不动”
  const SPRING_STIFFNESS = 20; // 弹簧阻尼硬度常数

  /**
   * 渐近线弹簧阻尼函数 (Asymptotic Rubber-Band Curve)
   * f(d) = M * (1 - 1 / (1 + d / K))
   * 距离越远阻力呈指数级增大，极限位移严格收敛于 maxOvershoot
   * @param {number} distance 超出边界的原始拉拽距离
   * @param {number} maxOvershoot 最大溢出上限 (px)
   * @param {number} stiffness 阻尼硬度
   * @returns {number}
   */
  function rubberBand(distance, maxOvershoot = MAX_OVERSHOOT, stiffness = SPRING_STIFFNESS) {
    if (distance <= 0) return 0;
    return maxOvershoot * (1 - 1 / (1 + distance / stiffness));
  }

  /**
   * 智能定位与开关关联的 switchEl 与 input[type="checkbox"] 元素
   * @param {Element} target 
   * @returns {{ switchEl: HTMLElement, checkbox: HTMLInputElement } | null}
   */
  function findSwitchAndCheckbox(target) {
    if (!target || !target.closest) return null;

    // 1. 直接点中 .alpha-switch 或其内部
    let switchEl = target.closest('.alpha-switch');
    if (switchEl) {
      const parent = switchEl.closest('label') || switchEl.closest('.switch-wrap') || switchEl.parentElement;
      const cb = (parent && parent.querySelector('input[type="checkbox"]')) || switchEl.previousElementSibling || switchEl.nextElementSibling;
      if (cb) return { switchEl, checkbox: cb };
    }

    // 2. 点中包装层 label 或 .switch-wrap
    const wrap = target.closest('label') || target.closest('.switch-wrap');
    if (wrap) {
      switchEl = wrap.querySelector('.alpha-switch');
      const cb = wrap.querySelector('input[type="checkbox"]');
      if (switchEl && cb) return { switchEl, checkbox: cb };
    }

    return null;
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  class SwitchDragManager {
    constructor(targetDoc) {
      this.doc = targetDoc || (typeof document !== 'undefined' ? document : null);
      if (!this.doc) return;

      this.activeSession = null;
      this.suppressClickUntil = 0;
      this.suppressClickElement = null;
      this.isDragTriggeredChange = false;

      this.boundOnPointerDown = this.onPointerDown.bind(this);
      this.boundOnPointerMove = this.onPointerMove.bind(this);
      this.boundOnPointerUp = this.onPointerUp.bind(this);
      this.boundOnPointerCancel = this.onPointerCancel.bind(this);
      this.boundOnClickCapture = this.onClickCapture.bind(this);
      this.boundOnChange = this.onChange.bind(this);
      this.boundOnKeyDown = this.onKeyDown.bind(this);

      this.init();
    }

    init() {
      if (!this.doc || this.doc.__alphaSwitchDragInstalled) return;
      this.doc.__alphaSwitchDragInstalled = true;

      this.injectStyles();
      this.bindEvents();
    }

    injectStyles() {
      if (this.doc.getElementById('__alphaSwitchDragStyle')) return;

      const style = this.doc.createElement('style');
      style.id = '__alphaSwitchDragStyle';
      style.textContent = `
        /* 拟态开关基础手势样式与柔和色彩过渡系统 */
        .alpha-switch {
          touch-action: none !important;
          -webkit-user-select: none !important;
          user-select: none !important;
          transition: border-color 0.24s cubic-bezier(.22,1,.36,1),
                      background-color 0.24s cubic-bezier(.22,1,.36,1),
                      box-shadow 0.24s cubic-bezier(.22,1,.36,1) !important;
        }

        /* 1. 正在拖拽跟手中 (is-dragging): 
           - 轨道外壳：设置轻柔平滑的过渡动画 (0.18s ease-out)，让边框高光与背景色平滑呼吸渐变，消除突亮硬切感
           - 滑块自身 (::after)：严格 transition: none，保持 1:1 绝对零延迟跟手 */
        input + .alpha-switch.is-dragging,
        input:checked + .alpha-switch.is-dragging,
        input:not(:checked) + .alpha-switch.is-dragging,
        .alpha-switch.is-dragging {
          animation: none !important;
          cursor: grabbing !important;
          transition: border-color 0.18s ease-out,
                      background-color 0.18s ease-out,
                      box-shadow 0.18s ease-out !important;
          background-color: color-mix(in srgb, rgba(109, 182, 255, 0.22) calc(var(--switch-p, 0) * 100%), rgba(150, 155, 165, 0.28)) !important;
          border-color: color-mix(in srgb, rgba(255, 255, 255, 0.75) calc(var(--switch-p, 0) * 100%), rgba(255, 255, 255, 0.25)) !important;
          box-shadow: 0 0 calc(var(--switch-p, 0) * 14px) rgba(239, 250, 255, calc(var(--switch-p, 0) * 0.55)),
                      0 2px calc(var(--switch-p, 0) * 8px) rgba(160, 220, 255, calc(var(--switch-p, 0) * 0.25)),
                      inset 0 2px 5px rgba(0, 0, 0, calc(0.22 - var(--switch-p, 0) * 0.03)),
                      inset 0 -1px 2px rgba(255, 255, 255, calc(0.15 + var(--switch-p, 0) * 0.35)) !important;
        }

        input + .alpha-switch.is-dragging::after,
        input:checked + .alpha-switch.is-dragging::after,
        input:not(:checked) + .alpha-switch.is-dragging::after,
        .alpha-switch.is-dragging::after {
          animation: none !important;
          transition: none !important;
          transform: translate(var(--drag-x, 0px), -50%) !important;
          width: var(--knob-w, 16px) !important;
          height: var(--knob-h, 16px) !important;
        }

        /* 2. 释放吸附与弹性回弹过渡中 (is-snapping): 阻尼弹簧曲线平滑过渡 */
        input + .alpha-switch.is-snapping,
        input:checked + .alpha-switch.is-snapping,
        input:not(:checked) + .alpha-switch.is-snapping,
        .alpha-switch.is-snapping {
          animation: none !important;
          transition: background-color 0.24s cubic-bezier(.22,1,.36,1),
                      border-color 0.24s cubic-bezier(.22,1,.36,1),
                      box-shadow 0.24s cubic-bezier(.22,1,.36,1) !important;
          background-color: color-mix(in srgb, rgba(109, 182, 255, 0.22) calc(var(--switch-p, 0) * 100%), rgba(150, 155, 165, 0.28)) !important;
          border-color: color-mix(in srgb, rgba(255, 255, 255, 0.75) calc(var(--switch-p, 0) * 100%), rgba(255, 255, 255, 0.25)) !important;
          box-shadow: 0 0 calc(var(--switch-p, 0) * 14px) rgba(239, 250, 255, calc(var(--switch-p, 0) * 0.55)),
                      0 2px calc(var(--switch-p, 0) * 8px) rgba(160, 220, 255, calc(var(--switch-p, 0) * 0.25)),
                      inset 0 2px 5px rgba(0, 0, 0, calc(0.22 - var(--switch-p, 0) * 0.03)),
                      inset 0 -1px 2px rgba(255, 255, 255, calc(0.15 + var(--switch-p, 0) * 0.35)) !important;
        }

        input + .alpha-switch.is-snapping::after,
        input:checked + .alpha-switch.is-snapping::after,
        input:not(:checked) + .alpha-switch.is-snapping::after,
        .alpha-switch.is-snapping::after {
          animation: none !important;
          transition: transform 0.24s cubic-bezier(.22,1,.36,1),
                      width 0.24s cubic-bezier(.22,1,.36,1),
                      height 0.24s cubic-bezier(.22,1,.36,1) !important;
          transform: translate(var(--drag-x, 0px), -50%) !important;
          width: 16px !important;
          height: 16px !important;
        }

        /* 3. 点按切换动画专属样式 (Click Animation) */
        input + .alpha-switch.alpha-animating-on,
        input:checked + .alpha-switch.alpha-animating-on {
          animation: alpha-bg-on .32s cubic-bezier(.22,1,.36,1) forwards !important;
        }
        input + .alpha-switch.alpha-animating-on::after,
        input:checked + .alpha-switch.alpha-animating-on::after {
          animation: alpha-slide-on .32s forwards !important;
        }

        input + .alpha-switch.alpha-animating-off,
        input:not(:checked) + .alpha-switch.alpha-animating-off {
          animation: alpha-bg-off .32s cubic-bezier(.22,1,.36,1) forwards !important;
        }
        input + .alpha-switch.alpha-animating-off::after,
        input:not(:checked) + .alpha-switch.alpha-animating-off::after {
          animation: alpha-slide-off .32s forwards !important;
        }

        /* 4. 静止常态 (仅在无拖拽、无吸附、无点按动画时生效) */
        input:checked + .alpha-switch:not(.is-dragging):not(.is-snapping):not(.alpha-animating-on):not(.alpha-animating-off) {
          animation: none !important;
          transition: border-color 0.24s cubic-bezier(.22,1,.36,1),
                      background-color 0.24s cubic-bezier(.22,1,.36,1),
                      box-shadow 0.24s cubic-bezier(.22,1,.36,1) !important;
          background-color: rgba(109, 182, 255, 0.19) !important;
          border-color: rgba(255, 255, 255, 0.75) !important;
          box-shadow: 0 0 14px rgba(239, 250, 255, 0.55), 0 2px 8px rgba(160, 220, 255, 0.25), inset 0 1px 2px rgba(255, 255, 255, 0.5) !important;
        }
        input:not(:checked) + .alpha-switch:not(.is-dragging):not(.is-snapping):not(.alpha-animating-on):not(.alpha-animating-off) {
          animation: none !important;
          transition: border-color 0.24s cubic-bezier(.22,1,.36,1),
                      background-color 0.24s cubic-bezier(.22,1,.36,1),
                      box-shadow 0.24s cubic-bezier(.22,1,.36,1) !important;
          background-color: rgba(150, 155, 165, 0.32) !important;
          border-color: rgba(255, 255, 255, 0.3) !important;
          box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.22), inset 0 -1px 2px rgba(255, 255, 255, 0.15) !important;
        }
        input:checked + .alpha-switch:not(.is-dragging):not(.is-snapping):not(.alpha-animating-on):not(.alpha-animating-off)::after {
          animation: none !important;
          transform: translate(14px, -50%) !important;
          width: 16px !important;
          height: 16px !important;
        }
        input:not(:checked) + .alpha-switch:not(.is-dragging):not(.is-snapping):not(.alpha-animating-on):not(.alpha-animating-off)::after {
          animation: none !important;
          transform: translate(0px, -50%) !important;
          width: 16px !important;
          height: 16px !important;
        }
      `;

      (this.doc.head || this.doc.documentElement).appendChild(style);
    }

    bindEvents() {
      this.doc.addEventListener('pointerdown', this.boundOnPointerDown, { passive: false });
      this.doc.addEventListener('pointermove', this.boundOnPointerMove, { passive: false });
      this.doc.addEventListener('pointerup', this.boundOnPointerUp, { passive: false });
      this.doc.addEventListener('pointercancel', this.boundOnPointerCancel, { passive: false });

      // 捕获阶段拦截拖拽释放后的原生 click 事件
      this.doc.addEventListener('click', this.boundOnClickCapture, { capture: true });

      // 监听 checkbox change 事件以触发点按物理动画
      this.doc.addEventListener('change', this.boundOnChange, { capture: true });

      // 键盘交互支持 (空格 / 回车)
      this.doc.addEventListener('keydown', this.boundOnKeyDown, { passive: true });
    }

    triggerClickAnimation(switchEl, isChecked) {
      if (!switchEl) return;

      if (switchEl.__animTimer) {
        clearTimeout(switchEl.__animTimer);
        switchEl.__animTimer = null;
      }
      if (switchEl.__snapTimer) {
        clearTimeout(switchEl.__snapTimer);
        switchEl.__snapTimer = null;
      }
      switchEl.classList.remove('is-dragging', 'is-snapping', 'alpha-animating-on', 'alpha-animating-off');
      switchEl.style.removeProperty('--drag-x');
      switchEl.style.removeProperty('--switch-p');
      switchEl.style.removeProperty('--knob-w');
      switchEl.style.removeProperty('--knob-h');

      void switchEl.offsetWidth;

      const animClass = isChecked ? 'alpha-animating-on' : 'alpha-animating-off';
      switchEl.classList.add(animClass);

      switchEl.__animTimer = setTimeout(() => {
        switchEl.classList.remove('alpha-animating-on', 'alpha-animating-off');
        switchEl.__animTimer = null;
      }, 340);
    }

    onChange(e) {
      if (e.target && e.target.type === 'checkbox') {
        const checkbox = e.target;
        if (this.isDragTriggeredChange) {
          return;
        }

        const parent = checkbox.closest('label') || checkbox.closest('.switch-wrap') || checkbox.parentElement;
        const switchEl = parent ? parent.querySelector('.alpha-switch') : checkbox.nextElementSibling;
        if (switchEl && switchEl.classList.contains('alpha-switch')) {
          this.triggerClickAnimation(switchEl, checkbox.checked);
        }
      }
    }

    onPointerDown(e) {
      if (e.button !== 0 && e.pointerType === 'mouse') return;

      const pair = findSwitchAndCheckbox(e.target);
      if (!pair) return;

      const { switchEl, checkbox } = pair;
      if (checkbox.disabled) return;

      if (switchEl.__animTimer) {
        clearTimeout(switchEl.__animTimer);
        switchEl.__animTimer = null;
      }
      if (switchEl.__snapTimer) {
        clearTimeout(switchEl.__snapTimer);
        switchEl.__snapTimer = null;
      }
      switchEl.classList.remove('is-snapping', 'alpha-animating-on', 'alpha-animating-off');

      const startChecked = !!checkbox.checked;
      const initialX = startChecked ? TRAVEL_DISTANCE : 0;

      this.activeSession = {
        pointerId: e.pointerId,
        switchEl,
        checkbox,
        startX: e.clientX,
        startY: e.clientY,
        startChecked,
        initialX,
        currentX: initialX,
        isDragging: false,
        hasMoved: false,
        startTime: performance.now()
      };

      try {
        switchEl.setPointerCapture(e.pointerId);
      } catch (_) {}
    }

    onPointerMove(e) {
      const session = this.activeSession;
      if (!session || session.pointerId !== e.pointerId) return;

      const deltaX = e.clientX - session.startX;

      if (!session.isDragging) {
        if (Math.abs(deltaX) >= DRAG_THRESHOLD) {
          session.isDragging = true;
          session.hasMoved = true;
          session.switchEl.classList.add('is-dragging');
        } else {
          return;
        }
      }

      if (e.cancelable) e.preventDefault();

      const rawX = session.initialX + deltaX;
      let currentX;
      let overshootRatio = 0;

      if (rawX < 0) {
        // 向左拉出边界：渐近阻尼弹性曲线，越拉阻力越强
        const overshoot = rubberBand(-rawX, MAX_OVERSHOOT, SPRING_STIFFNESS);
        currentX = -overshoot;
        overshootRatio = overshoot / MAX_OVERSHOOT;
      } else if (rawX > TRAVEL_DISTANCE) {
        // 向右拉出边界：渐近阻尼弹性曲线，越拉阻力越强
        const overshoot = rubberBand(rawX - TRAVEL_DISTANCE, MAX_OVERSHOOT, SPRING_STIFFNESS);
        currentX = TRAVEL_DISTANCE + overshoot;
        overshootRatio = overshoot / MAX_OVERSHOOT;
      } else {
        // 轨道内部正常 1:1 跟手移动
        currentX = rawX;
        overshootRatio = 0;
      }

      session.currentX = currentX;

      // 变色融合进度 [0.0, 1.0]
      const progress = clamp(currentX / TRAVEL_DISTANCE, 0, 1);

      // 弹簧挤压物理质感
      const squash = overshootRatio * 1.5;
      const knobW = (16 - squash * 0.4).toFixed(1);
      const knobH = (16 + squash * 0.4).toFixed(1);

      session.switchEl.style.setProperty('--drag-x', `${currentX.toFixed(2)}px`);
      session.switchEl.style.setProperty('--switch-p', `${progress.toFixed(3)}`);
      session.switchEl.style.setProperty('--knob-w', `${knobW}px`);
      session.switchEl.style.setProperty('--knob-h', `${knobH}px`);
    }

    onPointerUp(e) {
      const session = this.activeSession;
      if (!session || session.pointerId !== e.pointerId) return;

      this.activeSession = null;

      try {
        if (session.switchEl.hasPointerCapture(e.pointerId)) {
          session.switchEl.releasePointerCapture(e.pointerId);
        }
      } catch (_) {}

      if (session.isDragging) {
        if (e.cancelable) e.preventDefault();

        const deltaX = e.clientX - session.startX;
        const currentX = session.currentX;

        // 终态判定：中线阈值 (7px) 或强方向性手势 (> 4px)
        let targetChecked;
        if (Math.abs(deltaX) >= 4) {
          targetChecked = deltaX > 0;
        } else {
          targetChecked = currentX >= (TRAVEL_DISTANCE / 2);
        }

        const targetX = targetChecked ? TRAVEL_DISTANCE : 0;
        const stateChanged = (targetChecked !== session.startChecked);

        // 抑制后续浏览器默认合成的 click 事件，防止标签二次翻转
        this.suppressClickUntil = performance.now() + 350;
        this.suppressClickElement = session.switchEl;

        // 启动阻尼弹簧回弹吸附过渡 (is-snapping)
        session.switchEl.classList.remove('is-dragging');
        session.switchEl.classList.add('is-snapping');

        session.switchEl.style.setProperty('--drag-x', `${targetX}px`);
        session.switchEl.style.setProperty('--switch-p', `${targetChecked ? 1 : 0}`);
        session.switchEl.style.removeProperty('--knob-w');
        session.switchEl.style.removeProperty('--knob-h');

        if (session.checkbox.checked !== targetChecked) {
          this.isDragTriggeredChange = true;
          session.checkbox.checked = targetChecked;
          session.checkbox.dispatchEvent(new Event('change', { bubbles: true }));
          this.isDragTriggeredChange = false;
        }

        session.switchEl.__snapTimer = setTimeout(() => {
          session.switchEl.classList.remove('is-snapping');
          session.switchEl.style.removeProperty('--drag-x');
          session.switchEl.style.removeProperty('--switch-p');
          session.switchEl.__snapTimer = null;
        }, 240);
      } else {
        // 普通点按 (未拖拽): 不干预浏览器原生 click 处理，change 事件将自动触发点按动画
      }
    }

    onPointerCancel(e) {
      const session = this.activeSession;
      if (!session || session.pointerId !== e.pointerId) return;

      this.activeSession = null;

      try {
        if (session.switchEl.hasPointerCapture(e.pointerId)) {
          session.switchEl.releasePointerCapture(e.pointerId);
        }
      } catch (_) {}

      if (session.isDragging) {
        const targetX = session.startChecked ? TRAVEL_DISTANCE : 0;
        session.switchEl.classList.remove('is-dragging');
        session.switchEl.classList.add('is-snapping');
        session.switchEl.style.setProperty('--drag-x', `${targetX}px`);
        session.switchEl.style.setProperty('--switch-p', `${session.startChecked ? 1 : 0}`);
        session.switchEl.style.removeProperty('--knob-w');
        session.switchEl.style.removeProperty('--knob-h');

        session.switchEl.__snapTimer = setTimeout(() => {
          session.switchEl.classList.remove('is-snapping');
          session.switchEl.style.removeProperty('--drag-x');
          session.switchEl.style.removeProperty('--switch-p');
          session.switchEl.__snapTimer = null;
        }, 240);
      }
    }

    onClickCapture(e) {
      if (performance.now() < this.suppressClickUntil && this.suppressClickElement) {
        const switchEl = this.suppressClickElement;
        const parentLabel = switchEl.closest('label') || switchEl.closest('.switch-wrap') || switchEl.parentElement;
        
        if (
          e.target === switchEl ||
          switchEl.contains(e.target) ||
          e.target === parentLabel ||
          (parentLabel && parentLabel.contains(e.target))
        ) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        }
      }
    }

    onKeyDown(e) {
      // 键盘空格或回车触发原生切换，change 事件会自动捕获并触发动画
    }
  }

  const AlphaSwitchDrag = {
    instances: new Set(),

    init(doc) {
      const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
      if (!targetDoc) return null;
      if (targetDoc.__alphaSwitchDragManager) return targetDoc.__alphaSwitchDragManager;

      const manager = new SwitchDragManager(targetDoc);
      targetDoc.__alphaSwitchDragManager = manager;
      this.instances.add(manager);

      return manager;
    }
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => AlphaSwitchDrag.init(document));
    } else {
      AlphaSwitchDrag.init(document);
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AlphaSwitchDrag;
  }
  if (typeof window !== 'undefined') {
    window.AlphaSwitchDrag = AlphaSwitchDrag;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.AlphaSwitchDrag = AlphaSwitchDrag;
  }
})(typeof window !== 'undefined' ? window : globalThis);
