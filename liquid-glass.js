/**
 * Alpha Liquid Glass Engine
 * Apple Liquid Glass Fluid Deformation & Specular Physics Engine
 * (c) Tasks Project - Liquid Glass Upgrade
 * Enhanced Adaptive Physics & Dimension-Aware Fluid Dynamics
 */

(function (global) {
  'use strict';

  // Card container exclusions for inner buttons
  const CARD_EXCLUSIONS = ':not(.task-card button):not(.hub-card-wrap button):not(.task-card *):not(.hub-card-wrap *):not(.window-controls-menu *):not(.window-controls-menu):not(.menu-item):not(.menu-item *)';

  // Danger selectors for weakened glass aesthetic
  const DANGER_SELECTORS = [
    `.danger${CARD_EXCLUSIONS}`,
    `button.danger${CARD_EXCLUSIONS}`,
    '.task-icon-button.danger',
    '.delete-btn',
    '.btn-danger',
    '.task-card-actions .task-icon-button.danger',
    '.task-card-actions .danger'
  ];
  const DANGER_SELECTOR = DANGER_SELECTORS.join(', ');

  // Elements that receive fluid drag physics WITHOUT lighting pseudo-elements / specular reflection
  const NO_LIGHT_SELECTORS = [
    '.logo-icon-box',
    '[data-liquid-no-light]',
    '.no-light-liquid'
  ];
  const NO_LIGHT_SELECTOR = NO_LIGHT_SELECTORS.join(', ');

  // Base liquid elements that DO get specular lighting
  const LIGHT_SELECTORS = [
    `button${CARD_EXCLUSIONS}:not(.no-light-liquid):not([data-liquid-no-light])`,
    `.primary${CARD_EXCLUSIONS}`,
    `.secondary${CARD_EXCLUSIONS}`,
    `.danger${CARD_EXCLUSIONS}`,
    `.glass-btn${CARD_EXCLUSIONS}`,
    '.task-icon-button',
    '.delete-btn',
    '.add-tab-btn',
    '.top-bar-btn',
    '.logo-area.glass-btn',
    '.back-btn',
    `.btn-compact${CARD_EXCLUSIONS}`,
    '.subject-item > span',
    '.gender-item > span',
    '.priority-item > span',
    '.priority-choice',
    '.flatpickr-day',
    '.monet-selector-item',
    '.flatpickr-prev-month',
    '.flatpickr-next-month',
    '#closeAlphaModalX',
    '.collapse-icon-wrap',
    `[data-liquid]${CARD_EXCLUSIONS}`
  ];

  // All liquid elements that participate in the fluid motion engine
  const DEFAULT_SELECTORS = [
    ...LIGHT_SELECTORS,
    ...NO_LIGHT_SELECTORS
  ];

  const DEFAULT_SELECTOR = DEFAULT_SELECTORS.join(', ');
  const DEFAULT_HOVER_SELECTOR = DEFAULT_SELECTORS.map(s => `${s}:hover`).join(', ');
  const DEFAULT_ACTIVE_SELECTOR = DEFAULT_SELECTORS.map(s => `${s}:active`).join(', ');

  // Specular pseudo-elements are generated ONLY for light-enabled elements!
  const BEFORE_SELECTOR = LIGHT_SELECTORS.map(s => `${s}::before`).join(',\n        ');
  const AFTER_SELECTOR = LIGHT_SELECTORS.map(s => `${s}::after`).join(',\n        ');

  const EXCLUDE_SELECTOR = [
    '.no-liquid',
    '.disabled',
    '[disabled]',
    '.flatpickr-disabled',
    '.custom-monet-title',
    '.monet-year-btn',
    '.monet-month-btn',
    '.more-btn',
    '.app-icon',
    '.mini-app-icon',
    '.mini-app-icon *',
    '.dynamic-switcher-track',
    '.dynamic-switcher-track *',
    '.app-switcher-overlay',
    '.tab',
    '.tab-close',
    '.tab-title',
    '.tab-drag-placeholder',
    '.window-controls-menu',
    '.window-controls-menu *',
    '.menu-item',
    '.menu-item *',
    '.task-icon-button *',
    '.task-card button:not(.task-icon-button):not(.delete-btn)',
    '.task-card button:not(.task-icon-button):not(.delete-btn) *',
    '.task-card-actions *:not(.task-icon-button):not(.delete-btn)',
    '.hub-card-wrap button:not(.task-icon-button):not(.delete-btn)',
    '.hub-card-wrap button:not(.task-icon-button):not(.delete-btn) *',
    '.alpha-resizer',
    '#timerDragHandle',
    '.picker-icon',
    '.glass-icon-btn',
    '.icon-add',
    '.icon-timer',
    'input',
    'textarea'
  ].join(', ');

  const CONFIG = {
    lightRadius: 180,
    defaultProfile: {
      isVerySmall: false,
      pressScale: 0.968,
      maxOffsetX: 8.0,
      maxOffsetY: 6.0,
      stretchFactor: 0.035,
      maxRot: 0.45,
      springStiffness: 0.36,
      springDamping: 0.46,
      moveRatio: 0.26,
      fluidSmooth: 0.60,
      stretchAxisDampX: 0.80,
      stretchAxisDampY: 0.85
    }
  };

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function lerp(a, b, t) {
    return a + (b - a) * clamp(t, 0, 1);
  }

  function isNoLightTarget(el) {
    if (!el || !el.matches) return false;
    return el.matches(NO_LIGHT_SELECTOR);
  }

  function isDangerTarget(el) {
    if (!el || !el.matches) return false;
    return el.matches(DANGER_SELECTOR);
  }

  /**
   * 依据按钮的物理尺寸、长宽比与面积，动态计算专属于该元素的流体物理特征画像：
   * 1. 无光照/圆形小组件/App Switcher：敏捷灵动的高阶流体形变与弹簧回弹。
   * 2. 超小/图标按钮：保留轻快活跃的弹性响应与微旋转，触感生动。
   * 3. 中等标准按钮：微幅下沉，限制旋转与过度拉伸，回弹利落紧致。
   * 4. 宽条/全宽按钮：极大抑制旋转，微量均匀下压，独立轴各向异性限制位移，高阻尼极速收敛，质感稳重高级。
   */
  function computeElementProfile(rect, isNoLight = false, isTag = false) {
    const width = Math.max(1, (rect && rect.width) || 40);
    const height = Math.max(1, (rect && rect.height) || 40);
    const aspectRatio = width / height;
    const maxDim = Math.max(width, height);
    const minDim = Math.min(width, height);

    // 针对学科框、性别框、重要性框等胶囊微标签的专属灵敏物理画像
    if (isTag) {
      const maxOffsetX = clamp(width * 0.22, 12.0, 20.0);
      const maxOffsetY = clamp(height * 0.30, 9.0, 16.0);
      return {
        isVerySmall: true,
        pressScale: 0.940,
        maxOffsetX,
        maxOffsetY,
        stretchFactor: 0.085,
        maxRot: 2.2,
        springStiffness: 0.38,
        springDamping: 0.52,
        moveRatio: 0.44,
        fluidSmooth: 0.55,
        stretchAxisDampX: 1.0,
        stretchAxisDampY: 1.0
      };
    }

    if (isNoLight) {
      const maxOffset = clamp(minDim * 0.22, 7.5, 11.0);
      return {
        isVerySmall: true,
        pressScale: 0.945,
        maxOffsetX: maxOffset,
        maxOffsetY: maxOffset,
        stretchFactor: 0.055,
        maxRot: 1.15,
        springStiffness: 0.38,
        springDamping: 0.52,
        moveRatio: 0.30,
        fluidSmooth: 0.58,
        stretchAxisDampX: 1.0,
        stretchAxisDampY: 1.0
      };
    }

    // 判定是否为超小/图标类按钮 (如 32x32, 40x40, 44x44 图标按钮)
    const isVerySmall = (width <= 52 && height <= 52) || (maxDim <= 58 && aspectRatio <= 1.35);

    if (isVerySmall) {
      const maxOffset = clamp(minDim * 0.25, 8.0, 12.0);
      return {
        isVerySmall: true,
        pressScale: 0.940,
        maxOffsetX: maxOffset,
        maxOffsetY: maxOffset,
        stretchFactor: 0.070,
        maxRot: 1.25,
        springStiffness: 0.36,
        springDamping: 0.54, // 适度保留弹性 snapback
        moveRatio: 0.32,
        fluidSmooth: 0.56,
        stretchAxisDampX: 1.0,
        stretchAxisDampY: 1.0
      };
    }

    // 连续动态分级因子计算
    // 宽度因子: 60px -> 0, 400px+ -> 1
    const widthFactor = clamp((width - 60) / 340, 0, 1);
    // 长宽比因子: 1.5 -> 0, 6.0+ -> 1
    const aspectFactor = clamp((aspectRatio - 1.5) / 4.5, 0, 1);
    // 综合长度因子 (长条按钮特征)
    const lengthFactor = Math.max(widthFactor, aspectFactor * 0.85);

    // 按压缩放比例：标准小按钮 0.962，随长度增加逐渐微调至 0.990，避免长条按钮产生明显的缩边空隙
    const pressScale = lerp(0.962, 0.990, Math.pow(lengthFactor, 0.85));

    // 最大位移限制（各向异性）：水平方向允许适度流体跟随，垂直方向对长条元素更紧致收敛
    const baseOffset = clamp(minDim * 0.18, 6.5, 11.5);
    const maxOffsetX = lerp(baseOffset, clamp(baseOffset * 0.80, 5.0, 8.0), lengthFactor);
    const maxOffsetY = lerp(clamp(minDim * 0.15, 5.0, 8.5), clamp(minDim * 0.09, 3.5, 5.2), lengthFactor);

    // 轴向拉伸系数：长条按钮显著抑制拉伸变形，杜绝橡胶/果冻感
    const stretchFactor = lerp(0.040, 0.008, Math.pow(lengthFactor, 0.8));
    const stretchAxisDampX = lerp(0.85, 0.35, lengthFactor);
    const stretchAxisDampY = lerp(0.90, 0.50, lengthFactor);

    // 最大倾斜旋转角度：长条按钮强烈衰减旋转（长条如果旋转 1° 边缘翘动几像素，质感极差）
    const maxRot = lerp(0.58, 0.06, Math.pow(lengthFactor, 0.75));

    // 弹簧刚度与阻尼（速度保留率）：近临界阻尼，单次回弹干脆平滑收敛，彻底杜绝往复晃荡
    const springStiffness = lerp(0.35, 0.39, lengthFactor);
    const springDamping = lerp(0.48, 0.42, lengthFactor);

    // 拖拽跟随灵敏度
    const moveRatio = lerp(0.28, 0.18, lengthFactor);
    const fluidSmooth = lerp(0.60, 0.68, lengthFactor);

    return {
      isVerySmall: false,
      pressScale,
      maxOffsetX,
      maxOffsetY,
      stretchFactor,
      maxRot,
      springStiffness,
      springDamping,
      moveRatio,
      fluidSmooth,
      stretchAxisDampX,
      stretchAxisDampY
    };
  }

  class LiquidGlassManager {
    constructor(targetDoc) {
      this.doc = targetDoc || (typeof document !== 'undefined' ? document : null);
      if (!this.doc) return;

      this.activeElement = null;
      this.activeState = null;
      this.animatingElements = new Set();
      this.rafId = null;
      this.isDragging = false;

      this.boundOnPointerDown = this.onPointerDown.bind(this);
      this.boundOnPointerMove = this.onPointerMove.bind(this);
      this.boundOnPointerUp = this.onPointerUp.bind(this);
      this.boundOnPointerCancel = this.onPointerUp.bind(this);
      this.boundOnPointerEnter = this.onPointerEnter.bind(this);
      this.boundOnPointerLeave = this.onPointerLeave.bind(this);

      this.init();
    }

    init() {
      if (!this.doc || this.doc.__alphaLiquidInstalled) return;
      this.doc.__alphaLiquidInstalled = true;

      this.injectStyles();
      this.bindEvents();
    }

    injectStyles() {
      if (this.doc.getElementById('__alphaLiquidGlassStyle')) return;

      const style = this.doc.createElement('style');
      style.id = '__alphaLiquidGlassStyle';
      style.textContent = `
        ${DEFAULT_SELECTOR},
        .subject-item span,
        .subject-item > span,
        .gender-item span,
        .gender-item > span,
        .priority-item .priority-choice,
        .priority-choice {
          --lq-tx: 0px;
          --lq-ty: 0px;
          --lq-scale: 1;
          --lq-sx: 1;
          --lq-sy: 1;
          --lq-rot: 0deg;
          --lq-hover-ty: 0px;
          --lq-hover-scale: 1;
          --lq-hover-sx: 1;
          --lq-hover-sy: 1;
          --lq-state-ty: 0px;
          --lq-state-scale: 1;
          --lq-lx: 50%;
          --lq-ly: 50%;
          --lq-lo: 0;
          --lq-border-opacity: 0;
          --lq-bt: 1px;
          --lq-br: 1px;
          --lq-bb: 1px;
          --lq-bl: 1px;
          --lq-stroke: 1.4px;
          overflow: visible !important;
          transform: translate3d(
            var(--lq-tx, 0px),
            calc(var(--lq-ty, 0px) + var(--lq-hover-ty, 0px) + var(--lq-state-ty, 0px)),
            0
          ) scale(
            calc(var(--lq-scale, 1) * var(--lq-hover-scale, 1) * var(--lq-state-scale, 1))
          ) scaleX(calc(var(--lq-sx, 1) * var(--lq-hover-sx, 1))) scaleY(calc(var(--lq-sy, 1) * var(--lq-hover-sy, 1))) rotate(var(--lq-rot, 0deg)) !important;
          will-change: transform, box-shadow;
          touch-action: pan-y;
          user-select: none !important;
          -webkit-user-select: none !important;
          -webkit-user-drag: none !important;
          transition:
            transform 0.28s cubic-bezier(0.25, 1, 0.36, 1),
            background 0.3s ease,
            box-shadow 0.3s ease,
            border-color 0.3s ease;
        }

        /* 保持子元素与按钮处于同一个合成层，避免缩放期间文字和 SVG 各自取整。 */
        ${DEFAULT_SELECTOR} > * {
          position: relative;
          z-index: 1;
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
        }

        ${DEFAULT_HOVER_SELECTOR},
        .subject-item:hover span,
        .subject-item:hover > span,
        .gender-item:hover span,
        .gender-item:hover > span,
        .priority-item:hover .priority-choice,
        .priority-choice:hover {
          --lq-hover-ty: -1.5px !important;
          --lq-hover-scale: 1.014 !important;
          --lq-hover-sx: 1.010 !important;
          --lq-hover-sy: 0.990 !important;
        }

        .secondary:hover {
          --lq-hover-ty: -1.5px !important;
          --lq-hover-scale: 1.018 !important;
          --lq-hover-sx: 1.014 !important;
          --lq-hover-sy: 0.986 !important;
        }

        .add-tab-btn:hover {
          --lq-hover-ty: 0px !important;
          --lq-hover-scale: 1.06 !important;
        }

        /* 针对翻页小圆钮、弹窗关闭叉号和面板折叠圆钮配置生动有力的回弹上浮动效 (消除上浮生硬/不明显) */
        .flatpickr-prev-month,
        .flatpickr-next-month,
        #closeAlphaModalX,
        .collapse-icon-wrap {
          transition:
            transform 0.32s cubic-bezier(0.34, 1.56, 0.64, 1),
            background 0.25s ease,
            box-shadow 0.25s ease,
            border-color 0.25s ease !important;
        }

        .flatpickr-prev-month:hover,
        .flatpickr-next-month:hover,
        #closeAlphaModalX:hover,
        .collapse-icon-wrap:hover {
          --lq-hover-ty: -2.5px !important;
          --lq-hover-scale: 1.08 !important;
          --lq-hover-sx: 1.04 !important;
          --lq-hover-sy: 1.04 !important;
        }

        .flatpickr-prev-month:active,
        .flatpickr-next-month:active,
        #closeAlphaModalX:active,
        .collapse-icon-wrap:active {
          --lq-hover-ty: 0px !important;
          --lq-hover-scale: 0.90 !important;
          --lq-hover-sx: 0.94 !important;
          --lq-hover-sy: 0.94 !important;
        }

        .logo-icon-box:hover {
          --lq-hover-ty: 0px !important;
          --lq-hover-scale: 1.05 !important;
        }

        ${DEFAULT_ACTIVE_SELECTOR},
        .subject-item:active span,
        .subject-item:active > span,
        .subject-item:active input:checked + span,
        .gender-item:active span,
        .gender-item:active > span,
        .gender-item:active input:checked + span,
        .priority-item:active .priority-choice,
        .priority-item:active input:checked + .priority-choice,
        .priority-choice:active {
          --lq-hover-ty: 0px !important;
          --lq-hover-scale: 1 !important;
          --lq-hover-sx: 1 !important;
          --lq-hover-sy: 1 !important;
        }

        .primary {
          --lq-stroke: 1.25px;
        }

        .secondary {
          --lq-bt: 2px;
          --lq-stroke: 1.6px;
        }

        ${DANGER_SELECTORS.join(',\n        ')} {
          --lq-stroke: 1.2px;
          border: 1.2px solid transparent !important;
          background:
            linear-gradient(135deg,
              rgba(246, 122, 122, 0.85) 0%,
              rgba(238, 102, 102, 0.79) 52%,
              rgba(244, 116, 108, 0.82) 100%) padding-box,
            linear-gradient(135deg,
              rgba(255, 225, 225, 0.78) 0%,
              rgba(255, 185, 185, 0.45) 48%,
              rgba(255, 212, 206, 0.70) 100%) border-box !important;
          box-shadow:
            0 0 14px rgba(244, 114, 114, 0.22),
            0 8px 24px rgba(244, 114, 114, 0.25),
            inset 0 1.8px 2.2px rgba(255, 255, 255, 0.54),
            inset 0 -1.5px 2.5px rgba(150, 24, 24, 0.18) !important;
        }

        ${DANGER_SELECTORS.map(s => `${s}:hover`).join(',\n        ')} {
          background:
            linear-gradient(135deg,
              rgba(248, 134, 134, 0.89) 0%,
              rgba(240, 114, 114, 0.83) 52%,
              rgba(246, 128, 120, 0.86) 100%) padding-box,
            linear-gradient(135deg,
              rgba(255, 238, 238, 0.88) 0%,
              rgba(255, 202, 202, 0.58) 48%,
              rgba(255, 225, 220, 0.80) 100%) border-box !important;
          box-shadow:
            0 0 16px rgba(244, 114, 114, 0.26),
            0 10px 32px rgba(244, 114, 114, 0.30),
            inset 0 1.8px 2.5px rgba(255, 255, 255, 0.60),
            inset 0 -1px 2px rgba(160, 30, 30, 0.18) !important;
        }

        ${DANGER_SELECTORS.map(s => `${s}:active`).join(',\n        ')} {
          border: 1.2px solid transparent !important;
          outline: none !important;
          background:
            linear-gradient(135deg,
              rgba(238, 106, 106, 0.87) 0%,
              rgba(228, 90, 90, 0.81) 52%,
              rgba(234, 100, 92, 0.84) 100%) padding-box,
            linear-gradient(135deg,
              rgba(255, 220, 220, 0.72) 0%,
              rgba(255, 178, 178, 0.40) 48%,
              rgba(255, 206, 200, 0.64) 100%) border-box !important;
          box-shadow:
            0 4px 16px rgba(244, 114, 114, 0.18),
            0 6px 20px rgba(244, 114, 114, 0.20),
            inset 0 1.2px 1.8px rgba(255, 255, 255, 0.38),
            inset 0 -1px 1.5px rgba(160, 30, 30, 0.12) !important;
        }

        /* 纯流体无光照控件：彻底关闭光照伪元素 */
        ${NO_LIGHT_SELECTORS.map(s => `${s}::before,\n        ${s}::after`).join(',\n        ')} {
          display: none !important;
          content: none !important;
          opacity: 0 !important;
          pointer-events: none !important;
          visibility: hidden !important;
        }

        ${AFTER_SELECTOR} {
          content: '' !important;
          position: absolute !important;
          inset: 0 !important;
          box-sizing: border-box !important;
          border-radius: inherit !important;
          background: radial-gradient(
            circle ${CONFIG.lightRadius}px at var(--lq-lx, 50%) var(--lq-ly, 50%),
            rgba(255, 255, 255, 0.70) 0%,
            rgba(255, 248, 225, 0.30) 35%,
            rgba(255, 235, 180, 0.08) 65%,
            transparent 80%
          ) !important;
          opacity: var(--lq-lo, 0) !important;
          pointer-events: none !important;
          transition: opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1) !important;
          z-index: 2 !important;
          mix-blend-mode: overlay;
        }

        .primary::after {
          background: radial-gradient(
            circle ${CONFIG.lightRadius}px at var(--lq-lx, 50%) var(--lq-ly, 50%),
            rgba(255, 255, 255, 0.76) 0%,
            rgba(255, 250, 240, 0.38) 35%,
            rgba(255, 240, 220, 0.10) 65%,
            transparent 80%
          ) !important;
        }

        .danger::after,
        button.danger::after,
        .task-icon-button.danger::after,
        .delete-btn::after,
        .btn-danger::after,
        .task-card-actions .task-icon-button.danger::after,
        .task-card-actions .danger::after {
          background: radial-gradient(
            circle ${CONFIG.lightRadius}px at var(--lq-lx, 50%) var(--lq-ly, 50%),
            rgba(255, 255, 255, 0.45) 0%,
            rgba(255, 232, 232, 0.22) 35%,
            rgba(255, 195, 195, 0.06) 65%,
            transparent 80%
          ) !important;
        }

        ${BEFORE_SELECTOR} {
          content: '' !important;
          display: block !important;
          position: absolute !important;
          top: calc(-1 * var(--lq-bt, 1px)) !important;
          right: calc(-1 * var(--lq-br, 1px)) !important;
          bottom: calc(-1 * var(--lq-bb, 1px)) !important;
          left: calc(-1 * var(--lq-bl, 1px)) !important;
          box-sizing: border-box !important;
          padding: var(--lq-stroke, 1.4px) !important;
          border-radius: inherit !important;
          background: radial-gradient(
            circle 130px at var(--lq-lx, 50%) var(--lq-ly, 50%),
            rgba(255, 255, 255, 1) 0%,
            rgba(255, 255, 255, 0.75) 24%,
            rgba(255, 255, 255, 0.22) 54%,
            transparent 76%
          ) !important;
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0) border-box;
          mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0) border-box;
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          opacity: var(--lq-border-opacity, 0) !important;
          pointer-events: none !important;
          transition: opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1) !important;
          z-index: 3 !important;
        }

        .primary::before {
          background: radial-gradient(
            circle 120px at var(--lq-lx, 50%) var(--lq-ly, 50%),
            rgba(255, 255, 255, 0.88) 0%,
            rgba(255, 255, 255, 0.65) 24%,
            rgba(255, 255, 255, 0.18) 54%,
            transparent 76%
          ) !important;
        }

        .secondary::before {
          background: radial-gradient(
            circle 130px at var(--lq-lx, 50%) var(--lq-ly, 50%),
            rgba(255, 255, 255, 1) 0%,
            rgba(255, 255, 255, 0.75) 24%,
            rgba(255, 255, 255, 0.22) 54%,
            transparent 76%
          ) !important;
        }

        .danger::before,
        button.danger::before,
        .task-icon-button.danger::before,
        .delete-btn::before,
        .btn-danger::before,
        .task-card-actions .task-icon-button.danger::before,
        .task-card-actions .danger::before {
          background: radial-gradient(
            circle 110px at var(--lq-lx, 50%) var(--lq-ly, 50%),
            rgba(255, 255, 255, 0.70) 0%,
            rgba(255, 230, 230, 0.42) 26%,
            rgba(255, 200, 200, 0.12) 54%,
            transparent 76%
          ) !important;
        }

        /* 深色模式：统一减弱 Liquid Glass 按钮的表面高光与边缘描边光晕浓度 */
        @media (prefers-color-scheme: dark) {
          ${AFTER_SELECTOR} {
            background: radial-gradient(
              circle ${CONFIG.lightRadius}px at var(--lq-lx, 50%) var(--lq-ly, 50%),
              rgba(255, 255, 255, 0.30) 0%,
              rgba(255, 248, 225, 0.12) 35%,
              rgba(255, 235, 180, 0.03) 65%,
              transparent 80%
            ) !important;
            opacity: calc(var(--lq-lo, 0) * 0.65) !important;
          }

          .primary::after {
            background: radial-gradient(
              circle ${CONFIG.lightRadius}px at var(--lq-lx, 50%) var(--lq-ly, 50%),
              rgba(255, 255, 255, 0.34) 0%,
              rgba(255, 250, 240, 0.16) 35%,
              rgba(255, 240, 220, 0.04) 65%,
              transparent 80%
            ) !important;
          }

          .danger::after,
          button.danger::after,
          .task-icon-button.danger::after,
          .delete-btn::after,
          .btn-danger::after,
          .task-card-actions .task-icon-button.danger::after,
          .task-card-actions .danger::after {
            background: radial-gradient(
              circle ${CONFIG.lightRadius}px at var(--lq-lx, 50%) var(--lq-ly, 50%),
              rgba(255, 255, 255, 0.22) 0%,
              rgba(255, 232, 232, 0.10) 35%,
              rgba(255, 195, 195, 0.03) 65%,
              transparent 80%
            ) !important;
          }

          ${BEFORE_SELECTOR} {
            background: radial-gradient(
              circle 130px at var(--lq-lx, 50%) var(--lq-ly, 50%),
              rgba(255, 255, 255, 0.45) 0%,
              rgba(255, 255, 255, 0.30) 24%,
              rgba(255, 255, 255, 0.08) 54%,
              transparent 76%
            ) !important;
            opacity: calc(var(--lq-border-opacity, 0) * 0.68) !important;
          }

          .primary::before {
            background: radial-gradient(
              circle 120px at var(--lq-lx, 50%) var(--lq-ly, 50%),
              rgba(255, 255, 255, 0.40) 0%,
              rgba(255, 255, 255, 0.26) 24%,
              rgba(255, 255, 255, 0.07) 54%,
              transparent 76%
            ) !important;
          }

          .secondary::before {
            background: radial-gradient(
              circle 130px at var(--lq-lx, 50%) var(--lq-ly, 50%),
              rgba(255, 255, 255, 0.45) 0%,
              rgba(255, 255, 255, 0.30) 24%,
              rgba(255, 255, 255, 0.08) 54%,
              transparent 76%
            ) !important;
          }

          ${DANGER_SELECTORS.map(s => `${s}::before`).join(',\n          ')} {
            background: radial-gradient(
              circle 110px at var(--lq-lx, 50%) var(--lq-ly, 50%),
              rgba(255, 255, 255, 0.35) 0%,
              rgba(255, 200, 200, 0.20) 26%,
              rgba(255, 175, 175, 0.05) 54%,
              transparent 76%
            ) !important;
          }
        }
      `;

      (this.doc.head || this.doc.documentElement).appendChild(style);
    }

    bindEvents() {
      this.boundOnSleep = () => {
        this.isSleeping = true;
        this.releaseAll();
      };
      this.boundOnWake = () => {
        this.isSleeping = false;
      };

      this.doc.addEventListener('pointerdown', this.boundOnPointerDown, { passive: true, capture: true });
      this.doc.addEventListener('pointermove', this.boundOnPointerMove, { passive: true });
      this.doc.addEventListener('pointerup', this.boundOnPointerUp, { passive: true, capture: true });
      this.doc.addEventListener('pointercancel', this.boundOnPointerCancel, { passive: true, capture: true });
      this.doc.addEventListener('pointerover', this.boundOnPointerEnter, { passive: true });
      this.doc.addEventListener('pointerout', this.boundOnPointerLeave, { passive: true });
      this.doc.addEventListener('AlphaSleep', this.boundOnSleep);
      this.doc.addEventListener('AlphaWake', this.boundOnWake);

      this.doc.addEventListener('mouseleave', () => {
        if (!this.isDragging) this.releaseAll();
      }, { passive: true });

      const win = this.doc.defaultView || (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
      if (win && typeof win.addEventListener === 'function') {
        win.addEventListener('blur', () => this.releaseAll());
        win.addEventListener('pointerup', this.boundOnPointerUp, { passive: true });
        win.addEventListener('pointercancel', this.boundOnPointerCancel, { passive: true });
        win.addEventListener('mouseup', this.boundOnPointerUp, { passive: true });
        win.addEventListener('AlphaSleep', this.boundOnSleep);
        win.addEventListener('AlphaWake', this.boundOnWake);
      }

      this.doc.addEventListener('visibilitychange', () => {
        if (this.doc.hidden) this.releaseAll();
      });
    }

    getLiquidTarget(target) {
      if (!target || !target.closest) return null;

      // 1. 无光照控件优先判定 (App Switcher, Picker Icon, 折叠圆钮等)
      const noLightEl = target.closest(NO_LIGHT_SELECTOR);
      if (noLightEl) {
        if (noLightEl.disabled || noLightEl.classList.contains('disabled') || noLightEl.closest('.no-liquid')) return null;
        return noLightEl;
      }

      // 2. 任务卡片按钮需要单独获得流体效果
      const taskButton = target.closest('.task-icon-button');
      if (taskButton) {
        if (taskButton.disabled || taskButton.classList.contains('disabled')) return null;
        return taskButton;
      }

      // 3. 学科框、性别框、重要性框等微型拟态玻璃标签 (优先判定, 避免被大卡片判定拦截)
      const subjectSpan = target.closest('.subject-item > span, .gender-item > span, .priority-item > span, .priority-choice, .subject-item span, .gender-item span');
      if (subjectSpan) {
        const parentLabel = subjectSpan.closest('label');
        if (parentLabel && (parentLabel.hasAttribute('disabled') || parentLabel.classList.contains('disabled') || parentLabel.classList.contains('no-liquid'))) return null;
        return subjectSpan;
      }
      const subjectLabel = target.closest('.subject-item, .gender-item, .priority-item');
      if (subjectLabel) {
        if (subjectLabel.hasAttribute('disabled') || subjectLabel.classList.contains('disabled') || subjectLabel.classList.contains('no-liquid')) return null;
        const span = subjectLabel.querySelector('.priority-choice, span');
        if (span) return span;
      }

      // 4. Flatpickr 日历、Monet 年月选择器、弹窗关闭叉号与面板折叠圆钮专属判定
      const smallBtnTarget = target.closest('#closeAlphaModalX, .collapse-icon-wrap, .flatpickr-day, .monet-selector-item, .flatpickr-prev-month, .flatpickr-next-month');
      if (smallBtnTarget) {
        if (smallBtnTarget.disabled || smallBtnTarget.classList.contains('disabled') || smallBtnTarget.classList.contains('flatpickr-disabled') || smallBtnTarget.classList.contains('no-liquid')) return null;
        return smallBtnTarget;
      }

      if (target.closest('.task-card, .hub-card-wrap, .task-card-actions, .no-liquid')) {
        return null;
      }

      const el = target.closest(DEFAULT_SELECTOR);
      if (!el || el.closest(EXCLUDE_SELECTOR)) return null;
      if (el.disabled || el.classList.contains('disabled')) return null;

      return el;
    }

    syncBorderMetrics(el) {
      if (!el || el.__alphaLqBorderSynced) return;
      el.__alphaLqBorderSynced = true;
      try {
        const win = el.ownerDocument ? (el.ownerDocument.defaultView || window) : window;
        if (!win || !win.getComputedStyle) return;
        const cs = win.getComputedStyle(el);
        const bt = parseFloat(cs.borderTopWidth) || 0;
        const br = parseFloat(cs.borderRightWidth) || 0;
        const bb = parseFloat(cs.borderBottomWidth) || 0;
        const bl = parseFloat(cs.borderLeftWidth) || 0;

        el.style.setProperty('--lq-bt', `${bt}px`);
        el.style.setProperty('--lq-br', `${br}px`);
        el.style.setProperty('--lq-bb', `${bb}px`);
        el.style.setProperty('--lq-bl', `${bl}px`);

        const maxBorder = Math.max(bt, br, bb, bl);
        const stroke = maxBorder > 0 ? Math.max(1.35, maxBorder) : 1.35;
        el.style.setProperty('--lq-stroke', `${stroke}px`);
      } catch (_) {}
    }

    onPointerEnter(e) {
      const el = this.getLiquidTarget(e.target);
      if (!el) return;

      this.syncBorderMetrics(el);
      if (isNoLightTarget(el)) {
        el.style.setProperty('--lq-lo', '0');
        el.style.setProperty('--lq-border-opacity', '0');
        return;
      }

      this.updateLightPosition(el, e.clientX, e.clientY);
      const isDanger = isDangerTarget(el);
      el.style.setProperty('--lq-lo', isDanger ? '0.36' : '0.75');
      el.style.setProperty('--lq-border-opacity', isDanger ? '0.50' : '1');
    }

    onPointerLeave(e) {
      const el = this.getLiquidTarget(e.target);
      if (!el) return;
      if (e.relatedTarget && el.contains(e.relatedTarget)) return;

      if (this.activeElement !== el) {
        el.style.setProperty('--lq-lo', '0');
        el.style.setProperty('--lq-border-opacity', '0');
        el.style.removeProperty('--lq-hover-sx');
        el.style.removeProperty('--lq-hover-sy');
        el.style.removeProperty('--lq-rot');
      }
    }

    updateLightPosition(el, clientX, clientY, knownRect) {
      const rect = knownRect || el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const x = ((clientX - rect.left) / rect.width) * 100;
      const y = ((clientY - rect.top) / rect.height) * 100;

      el.style.setProperty('--lq-lx', `${x.toFixed(1)}%`);
      el.style.setProperty('--lq-ly', `${y.toFixed(1)}%`);
    }

    onPointerDown(e) {
      if (typeof localStorage !== 'undefined' && localStorage.getItem('alpha_reduce_motion') === 'true') return;
      if (e.button !== undefined && e.button !== 0) return;

      const el = this.getLiquidTarget(e.target);
      if (!el) return;

      this.syncBorderMetrics(el);
      const isDanger = isDangerTarget(el);
      const isNoLight = isNoLightTarget(el);
      const isTag = Boolean(el.closest('.subject-item, .gender-item, .priority-item, .subject-box, .gender-box, .priority-choice') || (el.matches && el.matches('.subject-item > span, .gender-item > span, .priority-item > span, .priority-choice')));
      const rect = el.getBoundingClientRect();
      const profile = computeElementProfile(rect, isNoLight, isTag);

      this.activeElement = el;
      this.isDragging = true;

      let state = el.__alphaLiquidState;
      const isAlreadyAnimating = state && this.animatingElements.has(state);

      const previousTransition = isAlreadyAnimating
        ? state.previousTransition
        : el.style.getPropertyValue('transition');

      const previousTransitionPriority = isAlreadyAnimating
        ? state.previousTransitionPriority
        : el.style.getPropertyPriority('transition');

      try {
        if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
      } catch (_) {}

      el.style.setProperty(
        'transition',
        'transform 0s, background 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease',
        'important'
      );

      if (!state) {
        state = {
          el,
          pointerId: e.pointerId,
          isTag,
          x: 0,
          y: 0,
          velX: 0,
          velY: 0,
          targetX: 0,
          targetY: 0,
          scale: 1,
          scaleVel: 0,
          targetScale: profile.pressScale,
          sx: 1,
          sxVel: 0,
          targetSx: 1,
          sy: 1,
          syVel: 0,
          targetSy: 1,
          rot: 0,
          rotVel: 0,
          targetRot: 0,
          isPressed: true,
          startX: e.clientX,
          startY: e.clientY,
          prevX: e.clientX,
          prevY: e.clientY,
          profile,
          rect,
          isNoLight,
          previousTransition,
          previousTransitionPriority
        };

        el.__alphaLiquidState = state;
      } else {
        state.pointerId = e.pointerId;
        state.isPressed = true;
        state.startX = e.clientX;
        state.startY = e.clientY;
        state.prevX = e.clientX;
        state.prevY = e.clientY;
        state.profile = profile;
        state.isTag = isTag;
        state.targetScale = profile.pressScale;
        state.rect = rect;
        state.isNoLight = isNoLight;
        state.previousTransition = previousTransition;
        state.previousTransitionPriority = previousTransitionPriority;

        state.targetX = 0;
        state.targetY = 0;
        state.targetSx = 1;
        state.targetSy = 1;
        state.targetRot = 0;

        if (!isAlreadyAnimating) {
          state.x = 0;
          state.y = 0;
          state.velX = 0;
          state.velY = 0;
          state.scale = 1;
          state.scaleVel = 0;
          state.sx = 1;
          state.sxVel = 0;
          state.sy = 1;
          state.syVel = 0;
          state.rot = 0;
          state.rotVel = 0;
        }
      }

      this.activeState = state;
      this.animatingElements.add(state);

      if (!isNoLight) {
        this.updateLightPosition(el, e.clientX, e.clientY, rect);
        el.style.setProperty('--lq-lo', isDanger ? '0.65' : '0.90');
        el.style.setProperty('--lq-border-opacity', isDanger ? '0.85' : '1');
      } else {
        el.style.setProperty('--lq-lo', '0');
        el.style.setProperty('--lq-border-opacity', '0');
      }

      this.startLoop();
    }

    onPointerMove(e) {
      if (typeof localStorage !== 'undefined' && localStorage.getItem('alpha_reduce_motion') === 'true') return;
      if (this.activeState && this.activeState.isPressed) {
        const state = this.activeState;

        if (
          e.pointerId !== undefined &&
          state.pointerId !== undefined &&
          e.pointerId !== state.pointerId
        ) {
          return;
        }

        state.prevX = e.clientX;
        state.prevY = e.clientY;

        const rect = state.el.getBoundingClientRect();
        const MARGIN = state.isTag ? 140 : 48;

        const isInsideHitArea = (
          e.clientX >= rect.left - MARGIN &&
          e.clientX <= rect.right + MARGIN &&
          e.clientY >= rect.top - MARGIN &&
          e.clientY <= rect.bottom + MARGIN
        );

        if (!isInsideHitArea) {
          state.targetX = 0;
          state.targetY = 0;
          state.targetScale = 1;
          state.targetSx = 1;
          state.targetSy = 1;
          state.targetRot = 0;
          state.el.style.setProperty('--lq-lo', '0');
          state.el.style.setProperty('--lq-border-opacity', '0');
          return;
        }

        const profile = state.profile || CONFIG.defaultProfile;
        state.targetScale = profile.pressScale;

        const totalDeltaX = e.clientX - state.startX;
        const totalDeltaY = e.clientY - state.startY;

        const maxOffsetX = profile.maxOffsetX;
        const maxOffsetY = profile.maxOffsetY;

        // 采用基于椭圆归一化的各向异性非线性位移与双曲正切阻尼限制
        const normDistSq = (totalDeltaX * totalDeltaX) / (maxOffsetX * maxOffsetX) +
                           (totalDeltaY * totalDeltaY) / (maxOffsetY * maxOffsetY);
        const normDist = Math.sqrt(normDistSq);

        if (normDist > 0.0001) {
          const dampedNormDist = Math.tanh(normDist / 1.15);
          const scaleRatio = dampedNormDist / normDist;

          state.targetX = totalDeltaX * scaleRatio;
          state.targetY = totalDeltaY * scaleRatio;

          const rawDist = Math.hypot(totalDeltaX, totalDeltaY);
          const cos = rawDist > 0 ? totalDeltaX / rawDist : 1;
          const sin = rawDist > 0 ? totalDeltaY / rawDist : 0;

          const stretch = dampedNormDist * profile.stretchFactor;
          state.targetSx = 1 + stretch * (cos * cos - 0.5 * sin * sin) * profile.stretchAxisDampX;
          state.targetSy = 1 + stretch * (sin * sin - 0.5 * cos * cos) * profile.stretchAxisDampY;

          // 角度依据归一化 X 位移与 profile 最大旋转角动态计算
          const normX = clamp(state.targetX / maxOffsetX, -1, 1);
          state.targetRot = normX * profile.maxRot;
        } else {
          state.targetX = 0;
          state.targetY = 0;
          state.targetSx = 1;
          state.targetSy = 1;
          state.targetRot = 0;
        }

        if (!state.isNoLight) {
          this.updateLightPosition(state.el, e.clientX, e.clientY, rect);
          const isDanger = isDangerTarget(state.el);
          state.el.style.setProperty('--lq-lo', isDanger ? '0.65' : '0.90');
          state.el.style.setProperty('--lq-border-opacity', isDanger ? '0.85' : '1');
        } else {
          state.el.style.setProperty('--lq-lo', '0');
          state.el.style.setProperty('--lq-border-opacity', '0');
        }
      } else {
        const el = this.getLiquidTarget(e.target);
        if (!el) return;

        this.syncBorderMetrics(el);
        const isNoLight = isNoLightTarget(el);
        if (isNoLight) {
          el.style.setProperty('--lq-lo', '0');
          el.style.setProperty('--lq-border-opacity', '0');
          return;
        }

        const rect = el.getBoundingClientRect();
        this.updateLightPosition(el, e.clientX, e.clientY, rect);

        if (rect.width > 0 && rect.height > 0) {
          const normX = clamp(((e.clientX - rect.left) / rect.width - 0.5) * 2, -1, 1);
          const normY = clamp(((e.clientY - rect.top) / rect.height - 0.5) * 2, -1, 1);

          const isSecondary = el.classList.contains('secondary');
          const intensity = isSecondary ? 0.014 : 0.008;
          const sx = (1 + intensity * (1 - Math.abs(normY) * 0.5)).toFixed(4);
          const sy = (1 - intensity * (1 - Math.abs(normX) * 0.5)).toFixed(4);
          el.style.setProperty('--lq-hover-sx', sx);
          el.style.setProperty('--lq-hover-sy', sy);
          el.style.setProperty('--lq-rot', `${(normX * 0.35).toFixed(2)}deg`);
        }

        const isDanger = isDangerTarget(el);
        el.style.setProperty('--lq-lo', isDanger ? '0.36' : '0.75');
        el.style.setProperty('--lq-border-opacity', isDanger ? '0.50' : '1');
      }
    }

    onPointerUp(e) {
      if (!this.activeState) return;

      const state = this.activeState;

      if (
        e.pointerId !== undefined &&
        state.pointerId !== undefined &&
        e.pointerId !== state.pointerId
      ) {
        return;
      }

      try {
        if (state.el.releasePointerCapture && state.pointerId !== undefined) {
          state.el.releasePointerCapture(state.pointerId);
        }
      } catch (_) {}

      state.isPressed = false;
      state.targetX = 0;
      state.targetY = 0;
      state.targetScale = 1;
      state.targetSx = 1;
      state.targetSy = 1;
      state.targetRot = 0;

      const pointTarget = Number.isFinite(e.clientX) && Number.isFinite(e.clientY) && typeof this.doc.elementFromPoint === 'function'
        ? this.doc.elementFromPoint(e.clientX, e.clientY)
        : null;

      const remainsHovered = pointTarget && state.el.contains(pointTarget);
      const isDanger = isDangerTarget(state.el);

      if (!state.isNoLight) {
        state.el.style.setProperty('--lq-lo', remainsHovered ? (isDanger ? '0.36' : '0.75') : '0');
        state.el.style.setProperty('--lq-border-opacity', remainsHovered ? (isDanger ? '0.50' : '1') : '0');
      } else {
        state.el.style.setProperty('--lq-lo', '0');
        state.el.style.setProperty('--lq-border-opacity', '0');
      }

      this.activeElement = null;
      this.activeState = null;
      this.isDragging = false;
    }

    resetElement(el) {
      if (!el) return;
      const state = el.__alphaLiquidState;
      if (state) {
        try {
          if (state.el && state.el.releasePointerCapture && state.pointerId !== undefined) {
            state.el.releasePointerCapture(state.pointerId);
          }
        } catch (_) {}
        this.animatingElements.delete(state);
        state.isPressed = false;
        state.x = 0;
        state.y = 0;
        state.velX = 0;
        state.velY = 0;
        state.targetX = 0;
        state.targetY = 0;
        state.scale = 1;
        state.scaleVel = 0;
        state.targetScale = 1;
        state.sx = 1;
        state.sxVel = 0;
        state.targetSx = 1;
        state.sy = 1;
        state.syVel = 0;
        state.targetSy = 1;
        state.rot = 0;
        state.rotVel = 0;
        state.targetRot = 0;
        this.restoreTransition(state);
        delete el.__alphaLiquidState;
      }
      this.animatingElements.forEach((s) => {
        if (s.el === el) {
          try {
            if (s.el && s.el.releasePointerCapture && s.pointerId !== undefined) {
              s.el.releasePointerCapture(s.pointerId);
            }
          } catch (_) {}
          this.animatingElements.delete(s);
          s.isPressed = false;
          s.x = 0;
          s.y = 0;
          s.velX = 0;
          s.velY = 0;
          s.targetX = 0;
          s.targetY = 0;
          s.scale = 1;
          s.scaleVel = 0;
          s.targetScale = 1;
          s.sx = 1;
          s.sxVel = 0;
          s.targetSx = 1;
          s.sy = 1;
          s.syVel = 0;
          s.targetSy = 1;
          s.rot = 0;
          s.rotVel = 0;
          s.targetRot = 0;
          this.restoreTransition(s);
        }
      });
      if (this.activeElement === el) {
        this.activeElement = null;
        this.activeState = null;
        this.isDragging = false;
      }
      el.style.removeProperty('--lq-tx');
      el.style.removeProperty('--lq-ty');
      el.style.removeProperty('--lq-scale');
      el.style.removeProperty('--lq-sx');
      el.style.removeProperty('--lq-sy');
      el.style.removeProperty('--lq-rot');
      el.style.removeProperty('--lq-lo');
      el.style.removeProperty('--lq-border-opacity');
      el.style.removeProperty('--lq-hover-sx');
      el.style.removeProperty('--lq-hover-sy');
      el.style.removeProperty('--lq-hover-ty');
      el.style.removeProperty('--lq-hover-scale');
      el.style.removeProperty('--lq-state-ty');
      el.style.removeProperty('--lq-state-scale');
      el.style.removeProperty('--lq-lx');
      el.style.removeProperty('--lq-ly');
    }

    releaseAll() {
      this.animatingElements.forEach((state) => {
        try {
          if (state.el && state.el.releasePointerCapture && state.pointerId !== undefined) {
            state.el.releasePointerCapture(state.pointerId);
          }
        } catch (_) {}

        state.isPressed = false;
        state.targetX = 0;
        state.targetY = 0;
        state.targetScale = 1;
        state.targetSx = 1;
        state.targetSy = 1;
        state.targetRot = 0;

        if (state.el) {
          state.el.style.setProperty('--lq-lo', '0');
          state.el.style.setProperty('--lq-border-opacity', '0');
        }
      });

      this.activeElement = null;
      this.activeState = null;
      this.isDragging = false;

      if (this.animatingElements.size > 0) this.startLoop();
    }

    restoreTransition(state) {
      const el = state && state.el;
      if (!el) return;

      if (state.previousTransition) {
        el.style.setProperty(
          'transition',
          state.previousTransition,
          state.previousTransitionPriority || ''
        );
      } else {
        el.style.removeProperty('transition');
      }
    }

    startLoop() {
      if (this.rafId) return;

      const loop = () => {
        let hasActiveWork = false;

        this.animatingElements.forEach((state) => {
          const el = state.el;

          if (!el || !el.isConnected) {
            this.animatingElements.delete(state);
            return;
          }

          const profile = state.profile || CONFIG.defaultProfile;

          if (state.isPressed) {
            const diffX = state.targetX - state.x;
            const diffY = state.targetY - state.y;

            state.velX += (diffX * profile.moveRatio - state.velX) * (1 - profile.fluidSmooth);
            state.velY += (diffY * profile.moveRatio - state.velY) * (1 - profile.fluidSmooth);

            state.x += state.velX;
            state.y += state.velY;

            state.scale += (state.targetScale - state.scale) * 0.42;
            state.scaleVel = 0;

            state.sx += (state.targetSx - state.sx) * 0.38;
            state.sy += (state.targetSy - state.sy) * 0.38;
            state.rot += (state.targetRot - state.rot) * 0.38;

            hasActiveWork = true;
          } else {
            // 松手回弹物理：基于专属刚度与阻尼，单次回弹干脆平滑收敛，彻底杜绝果冻晃动
            const springX = -state.x * profile.springStiffness;
            const springY = -state.y * profile.springStiffness;

            state.velX = (state.velX + springX) * profile.springDamping;
            state.velY = (state.velY + springY) * profile.springDamping;

            state.x += state.velX;
            state.y += state.velY;

            const springScale = (1 - state.scale) * profile.springStiffness;
            state.scaleVel = ((state.scaleVel || 0) + springScale) * profile.springDamping;
            state.scale += state.scaleVel;

            const springSx = (1 - state.sx) * profile.springStiffness;
            state.sxVel = ((state.sxVel || 0) + springSx) * profile.springDamping;
            state.sx += state.sxVel;

            const springSy = (1 - state.sy) * profile.springStiffness;
            state.syVel = ((state.syVel || 0) + springSy) * profile.springDamping;
            state.sy += state.syVel;

            const springRot = -state.rot * profile.springStiffness;
            state.rotVel = ((state.rotVel || 0) + springRot) * profile.springDamping;
            state.rot += state.rotVel;

            const isSettled =
              Math.abs(state.x) < 0.015 &&
              Math.abs(state.y) < 0.015 &&
              Math.abs(state.velX) < 0.015 &&
              Math.abs(state.velY) < 0.015 &&
              Math.abs(state.scale - 1) < 0.0015 &&
              Math.abs(state.scaleVel || 0) < 0.0015 &&
              Math.abs(state.sx - 1) < 0.0015 &&
              Math.abs(state.sy - 1) < 0.0015 &&
              Math.abs(state.rot) < 0.015 &&
              Math.abs(state.rotVel || 0) < 0.015;

            if (isSettled) {
              state.isPressed = false;
              state.x = 0;
              state.y = 0;
              state.velX = 0;
              state.velY = 0;
              state.targetX = 0;
              state.targetY = 0;
              state.scale = 1;
              state.scaleVel = 0;
              state.targetScale = 1;
              state.sx = 1;
              state.sxVel = 0;
              state.targetSx = 1;
              state.sy = 1;
              state.syVel = 0;
              state.targetSy = 1;
              state.rot = 0;
              state.rotVel = 0;
              state.targetRot = 0;

              el.style.removeProperty('--lq-tx');
              el.style.removeProperty('--lq-ty');
              el.style.removeProperty('--lq-scale');
              el.style.removeProperty('--lq-sx');
              el.style.removeProperty('--lq-sy');
              el.style.removeProperty('--lq-rot');

              this.restoreTransition(state);
              this.animatingElements.delete(state);
            } else {
              hasActiveWork = true;
            }
          }

          if (
            state.x !== 0 ||
            state.y !== 0 ||
            state.scale !== 1 ||
            state.sx !== 1 ||
            state.sy !== 1 ||
            state.rot !== 0
          ) {
            el.style.setProperty('--lq-tx', `${state.x.toFixed(2)}px`);
            el.style.setProperty('--lq-ty', `${state.y.toFixed(2)}px`);
            el.style.setProperty('--lq-scale', state.scale.toFixed(3));
            el.style.setProperty('--lq-sx', state.sx.toFixed(3));
            el.style.setProperty('--lq-sy', state.sy.toFixed(3));
            el.style.setProperty('--lq-rot', `${state.rot.toFixed(2)}deg`);
          }
        });

        if (hasActiveWork && this.animatingElements.size > 0) {
          this.rafId = requestAnimationFrame(loop);
        } else {
          this.rafId = null;
        }
      };

      this.rafId = requestAnimationFrame(loop);
    }
  }

  const AlphaLiquidGlass = {
    instances: new Set(),

    init(doc) {
      const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
      if (!targetDoc) return null;
      if (targetDoc.__alphaLiquidManager) return targetDoc.__alphaLiquidManager;

      const manager = new LiquidGlassManager(targetDoc);
      targetDoc.__alphaLiquidManager = manager;
      this.instances.add(manager);

      return manager;
    },

    injectIntoDocument(doc) {
      return this.init(doc);
    },

    resetElement(el) {
      if (!el) return;
      this.instances.forEach(manager => {
        try {
          manager.resetElement(el);
        } catch (_) {}
      });
    },

    releaseAll() {
      this.instances.forEach(manager => {
        try {
          manager.releaseAll();
        } catch (_) {}
      });
    }
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => AlphaLiquidGlass.init(document));
    } else {
      AlphaLiquidGlass.init(document);
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AlphaLiquidGlass;
  }
  if (typeof window !== 'undefined') {
    window.AlphaLiquidGlass = AlphaLiquidGlass;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.AlphaLiquidGlass = AlphaLiquidGlass;
  }
})(typeof window !== 'undefined' ? window : globalThis);
