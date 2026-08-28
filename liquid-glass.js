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

  // Compact choice/tag surfaces used by TaskFlow, TaskHub and sibling pages.
  // Keep the explicit selectors for the existing pages, while also supporting
  // their common subject/gender/priority/importance naming variants.
  const TAG_SURFACE_SELECTORS = [
    '.subject-item > span',
    '.gender-item > span',
    '.priority-item > span',
    '.importance-item > span',
    '.subject-option > span',
    '.gender-option > span',
    '.priority-option > span',
    '.importance-option > span',
    '.priority-choice',
    '.importance-choice',
    '.tag-item > span',
    '[data-liquid-tag]'
  ];
  const TAG_SURFACE_SELECTOR = TAG_SURFACE_SELECTORS.join(', ');
  const TAG_ITEM_SELECTOR = [
    '.subject-item',
    '.gender-item',
    '.priority-item',
    '.importance-item',
    '.subject-option',
    '.gender-option',
    '.priority-option',
    '.importance-option',
    '.tag-item',
    '[data-liquid-tag-item]'
  ].join(', ');
  const TAG_GROUP_SELECTOR = [
    '.subject-box',
    '.gender-box',
    '.priority-box',
    '.importance-box',
    '.subject-options',
    '.gender-options',
    '.priority-options',
    '.importance-options',
    '.tag-box',
    '.tag-group',
    '[data-liquid-fusion-host]',
    '[data-liquid-tag-group]'
  ].join(', ');

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
    ...TAG_SURFACE_SELECTORS,
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
    // 液桥在真正接触前开始生长；桥体两端深入按钮内部，配合端部羽化消除接缝。
    // 接触口宽度接近按钮短边的 1/3、腰部略微收窄，呈现附图那样粗壮凝实的液桥。
    // Start the bridge far enough away for the eye to follow its complete
    // growth, instead of revealing it only during the last few drag pixels.
    fusionThreshold: 32,
    fusionOverlap: 1,
    fusionPadding: 4,
    // A separate entry phase prevents the first eligible bridge frame from
    // popping in at its complete length. Axis stretch leads width and opacity.
    fusionEntryDuration: 210,
    fusionExitDuration: 190,
    // Tags commonly use 0.15-0.25 source alpha. Give only subject / gender /
    // priority / importance pairs a stronger proportional lift: transparent
    // pixels remain transparent and their original gradient ratios stay intact.
    fusionTagAlphaGain: 4.60,
    // One bridge only; cap its software texture so gradient-accurate sampling
    // stays cheaper than adding more filtered compositor layers.
    fusionRasterPixelBudget: 20000,
    // 同一时刻只维持一条主液桥。多个相邻候选同时出现不但像重复色块，
    // 还会让 Chromium 为每条带滤镜的 SVG 分配独立合成表面。
    fusionMaxBridges: 1,
    defaultProfile: {
      isVerySmall: false,
      pressScale: 0.962,
      maxOffsetX: 9.4,
      maxOffsetY: 7.2,
      stretchFactor: 0.044,
      maxRot: 0.58,
      springStiffness: 0.34,
      springDamping: 0.44,
      moveRatio: 0.30,
      fluidSmooth: 0.56,
      stretchAxisDampX: 0.88,
      stretchAxisDampY: 0.92
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

    // 针对学科框、性别框、重要性框等胶囊微标签的专属灵敏物理画像（略微强化）
    if (isTag) {
      const maxOffsetX = clamp(width * 0.24, 14.0, 23.0);
      const maxOffsetY = clamp(height * 0.34, 10.5, 18.0);
      return {
        isVerySmall: true,
        pressScale: 0.935,
        maxOffsetX,
        maxOffsetY,
        stretchFactor: 0.102,
        maxRot: 2.55,
        springStiffness: 0.36,
        springDamping: 0.50,
        moveRatio: 0.49,
        fluidSmooth: 0.50,
        stretchAxisDampX: 1.0,
        stretchAxisDampY: 1.0
      };
    }

    if (isNoLight) {
      const maxOffset = clamp(minDim * 0.26, 8.5, 13.0);
      return {
        isVerySmall: true,
        pressScale: 0.940,
        maxOffsetX: maxOffset,
        maxOffsetY: maxOffset,
        stretchFactor: 0.068,
        maxRot: 1.38,
        springStiffness: 0.36,
        springDamping: 0.50,
        moveRatio: 0.34,
        fluidSmooth: 0.53,
        stretchAxisDampX: 1.0,
        stretchAxisDampY: 1.0
      };
    }

    // 判定是否为超小/图标类按钮 (如 32x32, 40x40, 44x44 图标按钮)
    const isVerySmall = (width <= 52 && height <= 52) || (maxDim <= 58 && aspectRatio <= 1.35);

    if (isVerySmall) {
      const maxOffset = clamp(minDim * 0.28, 9.2, 14.0);
      return {
        isVerySmall: true,
        pressScale: 0.935,
        maxOffsetX: maxOffset,
        maxOffsetY: maxOffset,
        stretchFactor: 0.086,
        maxRot: 1.48,
        springStiffness: 0.34,
        springDamping: 0.52, // 适度保留弹性 snapback，略增强弹性
        moveRatio: 0.36,
        fluidSmooth: 0.51,
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

    // 按压缩放比例：标准小按钮 0.958，随长度增加逐渐微调至 0.988，避免长条按钮产生明显的缩边空隙（略微增强按压感）
    const pressScale = lerp(0.958, 0.988, Math.pow(lengthFactor, 0.85));

    // 最大位移限制（各向异性）：水平方向允许适度流体跟随，垂直方向对长条元素更紧致收敛（整体增强 ~15%）
    const baseOffset = clamp(minDim * 0.21, 7.4, 13.0);
    const maxOffsetX = lerp(baseOffset, clamp(baseOffset * 0.82, 5.6, 9.2), lengthFactor);
    const maxOffsetY = lerp(clamp(minDim * 0.17, 5.8, 9.8), clamp(minDim * 0.10, 3.8, 5.8), lengthFactor);

    // 轴向拉伸系数：长条按钮显著抑制拉伸变形，杜绝橡胶/果冻感（略微放宽，保留流体感）
    const stretchFactor = lerp(0.048, 0.010, Math.pow(lengthFactor, 0.8));
    const stretchAxisDampX = lerp(0.90, 0.38, lengthFactor);
    const stretchAxisDampY = lerp(0.94, 0.54, lengthFactor);

    // 最大倾斜旋转角度：长条按钮强烈衰减旋转（长条如果旋转 1° 边缘翘动几像素，质感极差）—— 略微提升旋转上限
    const maxRot = lerp(0.68, 0.08, Math.pow(lengthFactor, 0.75));

    // 弹簧刚度与阻尼（速度保留率）：近临界阻尼，单次回弹干脆平滑收敛，彻底杜绝往复晃荡（略微降低刚度/阻尼以增强流体跟随）
    const springStiffness = lerp(0.33, 0.37, lengthFactor);
    const springDamping = lerp(0.46, 0.40, lengthFactor);

    // 拖拽跟随灵敏度（整体提升）
    const moveRatio = lerp(0.32, 0.21, lengthFactor);
    const fluidSmooth = lerp(0.56, 0.64, lengthFactor);

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
      // 融合桥接层状态
      this.fusionBridges = new Map(); // neighborEl -> bridgeEl
      this.fusionSequence = 0;
      this.fusionElementIds = new WeakMap();
      this.fusionElementSequence = 0;

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
        ${DEFAULT_SELECTOR} {
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
        .importance-item:hover span,
        .importance-item:hover .importance-choice,
        .subject-option:hover > span,
        .gender-option:hover > span,
        .priority-option:hover > span,
        .importance-option:hover > span,
        .tag-item:hover > span,
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
        .importance-item:active span,
        .importance-item:active input:checked + span,
        .subject-option:active > span,
        .gender-option:active > span,
        .priority-option:active > span,
        .importance-option:active > span,
        .tag-item:active > span,
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
      this.injectFusionStyles();
    }

    injectFusionStyles() {
      if (this.doc.getElementById('__alphaLiquidFusionStyle')) return;
      const s = this.doc.createElement('style');
      s.id = '__alphaLiquidFusionStyle';
      s.textContent = `
        .__lq-fusion-bridge {
          position: fixed !important;
          left: 0 !important;
          top: 0 !important;
          pointer-events: none !important;
          /* Bridges live in one document-level overlay. subject-box controls
             create their own transformed/isolated layers, so placing a bridge
             behind a label inside that box can make it disappear completely.
             Pointer-events stay disabled, therefore this never blocks clicks. */
          z-index: 2147480000 !important;
          overflow: visible !important;
          opacity: var(--lq-fusion-opacity, 0) !important;
          transform: translate3d(var(--lq-fusion-x, -9999px), var(--lq-fusion-y, -9999px), 0) !important;
          transform-origin: 0 0 !important;
          will-change: transform, opacity !important;
          transition: opacity 90ms linear !important;
          contain: layout style !important;
        }
        .__lq-fusion-bridge.__lq-fusion-exiting {
          /* Exit opacity is already sampled every animation frame. Disabling
             the extra CSS lag lets the final zero-alpha frame land before the
             SVG is removed, avoiding a last-frame pop. */
          transition: none !important;
        }
        /* Retained for pages that already use these markers. New bridges are
           deliberately document-level; see getFusionHost(). */
        .__lq-fusion-host {
          position: relative !important;
          isolation: isolate !important;
          overflow: visible !important;
        }
        .__lq-fusion-host > .subject-item,
        .__lq-fusion-host > .gender-item,
        .__lq-fusion-host > .priority-item,
        .__lq-fusion-host > .importance-item,
        .__lq-fusion-host > .subject-option,
        .__lq-fusion-host > .gender-option,
        .__lq-fusion-host > .priority-option,
        .__lq-fusion-host > .importance-option,
        .__lq-fusion-host > .tag-item,
        .__lq-fusion-peer {
          position: relative !important;
          z-index: 2 !important;
        }
        .__lq-fusion-bridge.__lq-fusion-local {
          position: fixed !important;
          z-index: 2147480000 !important;
        }
        .__lq-fusion-raster-host {
          width: 100% !important;
          height: 100% !important;
          overflow: visible !important;
          pointer-events: none !important;
        }
        .__lq-fusion-raster-stack {
          position: relative !important;
          width: 100% !important;
          height: 100% !important;
          display: block !important;
          overflow: visible !important;
          pointer-events: none !important;
          /* The backdrop is the visibility channel for very transparent glass.
             A practically transparent fill keeps Chromium's backdrop-filter
             active without tinting the bridge material. */
          background: rgba(255, 255, 255, 0.001) !important;
        }
        .__lq-fusion-raster {
          position: absolute !important;
          inset: 0 !important;
          width: 100% !important;
          height: 100% !important;
          display: block !important;
          pointer-events: none !important;
          image-rendering: auto;
        }
        .__lq-fusion-raster-highlight {
          mix-blend-mode: overlay;
        }
        .__lq-fusion-body {
          vector-effect: non-scaling-stroke;
          shape-rendering: geometricPrecision;
        }
        .__lq-fusion-rim {
          fill: none;
          stroke-width: 0.58px;
          stroke-linecap: round;
          stroke-linejoin: round;
          vector-effect: non-scaling-stroke;
          shape-rendering: geometricPrecision;
          /* No dark stroke/drop-shadow here: it produced a grey line along
             the lower edge. Visibility comes from backdrop refraction and a
             very soft upper specular highlight only. */
          filter: none;
        }
        /* Compact glass tags remain faithful to their sampled fill alpha. A
           slightly clearer upper liquid edge and a faster reveal envelope
           provide visibility without flattening their translucent gradient. */
        .__lq-fusion-bridge.__lq-fusion-tag-pair .__lq-fusion-rim {
          stroke-width: 0.90px;
          opacity: 0.96;
        }
        /* Once two controls physically overlap, the bridge becomes a broad
           dissolved lens. Suppress its outer rim so the original facing
           outlines are covered by sampled material instead of being replaced
           by another visible seam. */
        .__lq-fusion-bridge.__lq-fusion-overlap .__lq-fusion-rim {
          stroke-width: 0.24px;
          opacity: 0.34;
        }
        .alpha-reduce-motion .__lq-fusion-bridge {
          display: none !important;
        }
      `;
      (this.doc.head || this.doc.documentElement).appendChild(s);
    }

    // ===== 液态融合溶解逻辑 =====

    // 将 hsl/hsla 转为 rgb
    hslToRgb(h, s, l) {
      h = ((h % 360) + 360) % 360;
      s = Math.max(0, Math.min(100, s)) / 100;
      l = Math.max(0, Math.min(100, l)) / 100;
      const c = (1 - Math.abs(2 * l - 1)) * s;
      const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
      const m = l - c / 2;
      let r1 = 0, g1 = 0, b1 = 0;
      if (h < 60) { r1 = c; g1 = x; b1 = 0; }
      else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
      else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
      else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
      else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
      else { r1 = c; g1 = 0; b1 = x; }
      return { r: Math.round((r1 + m) * 255), g: Math.round((g1 + m) * 255), b: Math.round((b1 + m) * 255) };
    }

    parseColorString(str) {
      if (!str) return null;
      str = str.trim();
      if (/^transparent$/i.test(str)) return { r: 0, g: 0, b: 0, a: 0 };
      let hex = str.match(/^#([\da-f]{3,8})$/i);
      if (hex) {
        let raw = hex[1];
        if (raw.length === 3 || raw.length === 4) raw = raw.split('').map(ch => ch + ch).join('');
        if (raw.length === 6 || raw.length === 8) {
          return {
            r: parseInt(raw.slice(0, 2), 16),
            g: parseInt(raw.slice(2, 4), 16),
            b: parseInt(raw.slice(4, 6), 16),
            a: raw.length === 8 ? parseInt(raw.slice(6, 8), 16) / 255 : 1
          };
        }
      }
      // hsla / hsl
      let m = str.match(/^hsla?\(\s*([\d.+-]+)(?:deg)?(?:\s*,\s*|\s+)([\d.]+)%(?:\s*,\s*|\s+)([\d.]+)%\s*(?:[,/]\s*([\d.]+)%?\s*)?\)$/i);
      if (m) {
        const h = parseFloat(m[1]);
        const s = parseFloat(m[2]);
        const l = parseFloat(m[3]);
        const alphaToken = m[4];
        const a = alphaToken === undefined ? 1 : parseFloat(alphaToken) / (str.indexOf('%', str.lastIndexOf(alphaToken)) !== -1 ? 100 : 1);
        const rgb = this.hslToRgb(h, s, l);
        return { r: rgb.r, g: rgb.g, b: rgb.b, a };
      }
      m = str.match(/^rgba?\(\s*([\d.]+)%?[,\s]+([\d.]+)%?[,\s]+([\d.]+)%?(?:\s*[,/]\s*([\d.]+)%?)?\s*\)$/i);
      if (m) {
        const channelsArePercent = /^rgba?\(\s*[\d.]+%/i.test(str);
        const alphaIsPercent = m[4] !== undefined && new RegExp(m[4].replace('.', '\\.') + '%').test(str.slice(str.lastIndexOf(m[4])));
        const channelScale = channelsArePercent ? 2.55 : 1;
        return {
          r: Math.round(parseFloat(m[1]) * channelScale),
          g: Math.round(parseFloat(m[2]) * channelScale),
          b: Math.round(parseFloat(m[3]) * channelScale),
          a: m[4] === undefined ? 1 : parseFloat(m[4]) / (alphaIsPercent ? 100 : 1)
        };
      }
      return null;
    }

    // 只在顶层逗号处分割 CSS（不会误拆 rgba() 或 gradient() 内部参数）。
    splitCssList(value) {
      const result = [];
      let depth = 0;
      let start = 0;
      for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (ch === '(') depth++;
        else if (ch === ')') depth = Math.max(0, depth - 1);
        else if (ch === ',' && depth === 0) {
          result.push(value.slice(start, i).trim());
          start = i + 1;
        }
      }
      result.push(value.slice(start).trim());
      return result.filter(Boolean);
    }

    compositeColor(foreground, background) {
      const fa = clamp(foreground && foreground.a !== undefined ? foreground.a : 1, 0, 1);
      const ba = clamp(background && background.a !== undefined ? background.a : 1, 0, 1);
      const outA = fa + ba * (1 - fa);
      if (outA < 0.0001) return { r: 0, g: 0, b: 0, a: 0 };
      return {
        r: Math.round((foreground.r * fa + background.r * ba * (1 - fa)) / outA),
        g: Math.round((foreground.g * fa + background.g * ba * (1 - fa)) / outA),
        b: Math.round((foreground.b * fa + background.b * ba * (1 - fa)) / outA),
        a: outA
      };
    }

    interpolateColor(a, b, t) {
      t = clamp(t, 0, 1);
      const alpha = lerp(a.a, b.a, t);
      const leftWeight = a.a * (1 - t);
      const rightWeight = b.a * t;
      const weight = leftWeight + rightWeight;
      // CSS/SVG 透明渐变采用预乘 alpha。直接把 white 插值到 transparent
      // black 会制造灰边，正是半透明 tag 接触区轻微脏色的来源之一。
      const channel = (left, right) => weight > 0.000001
        ? Math.round((left * leftWeight + right * rightWeight) / weight)
        : 0;
      return {
        r: channel(a.r, b.r),
        g: channel(a.g, b.g),
        b: channel(a.b, b.b),
        a: alpha
      };
    }

    // Different materials need a perceptually even transition. Premultiplied
    // sRGB is correct for fading to transparency, but when two controls also
    // have very different alpha it visually holds the opaque hue for too long
    // and then flips near the centre. OKLab keeps the hue/lightness transition
    // continuous while alpha remains an independent physical channel.
    interpolateFusionColor(a, b, t) {
      t = clamp(t, 0, 1);
      const srgbToLinear = value => {
        const c = clamp(value / 255, 0, 1);
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      };
      const linearToSrgb = value => {
        const c = clamp(value, 0, 1);
        const encoded = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
        return Math.round(clamp(encoded, 0, 1) * 255);
      };
      const toOklab = color => {
        const r = srgbToLinear(color.r);
        const g = srgbToLinear(color.g);
        const bl = srgbToLinear(color.b);
        const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl);
        const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl);
        const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl);
        return {
          L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
          A: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
          B: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
        };
      };
      const left = toOklab(a);
      const right = toOklab(b);
      const L = lerp(left.L, right.L, t);
      const A = lerp(left.A, right.A, t);
      const B = lerp(left.B, right.B, t);
      const l = Math.pow(L + 0.3963377774 * A + 0.2158037573 * B, 3);
      const m = Math.pow(L - 0.1055613458 * A - 0.0638541728 * B, 3);
      const s = Math.pow(L - 0.0894841775 * A - 1.2914855480 * B, 3);
      return {
        r: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
        a: lerp(a.a, b.a, t)
      };
    }

    parseGradientStops(layer) {
      const open = layer.indexOf('(');
      const close = layer.lastIndexOf(')');
      if (open < 0 || close <= open) return null;
      const args = this.splitCssList(layer.slice(open + 1, close));
      const stops = [];
      let descriptor = '';
      const colorPattern = /^(transparent|#[\da-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))(?:\s+([+-]?[\d.]+)%?)?/i;
      args.forEach((arg, index) => {
        const match = arg.match(colorPattern);
        if (!match) {
          if (index === 0) descriptor = arg.trim().toLowerCase();
          return;
        }
        const color = this.parseColorString(match[1]);
        if (!color) return;
        let position = null;
        if (match[2] !== undefined) {
          const numeric = parseFloat(match[2]);
          position = arg.indexOf('%', match[0].indexOf(match[2])) !== -1 ? numeric / 100 : numeric;
        }
        stops.push({ color, position });
      });
      if (!stops.length) return null;
      if (stops[0].position === null) stops[0].position = 0;
      if (stops[stops.length - 1].position === null) stops[stops.length - 1].position = 1;
      let anchor = 0;
      while (anchor < stops.length - 1) {
        let next = anchor + 1;
        while (next < stops.length && stops[next].position === null) next++;
        const left = stops[anchor].position;
        const right = next < stops.length ? stops[next].position : 1;
        const span = next - anchor;
        for (let i = 1; i < span; i++) stops[anchor + i].position = lerp(left, right, i / span);
        anchor = next;
      }
      for (let i = 1; i < stops.length; i++) {
        stops[i].position = Math.max(stops[i - 1].position, stops[i].position);
      }
      return { descriptor, stops };
    }

    resolveRadialGeometry(descriptor, rect) {
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      let cx = width * 0.5;
      let cy = height * 0.5;
      const atMatch = descriptor.match(/\bat\s+(.+)$/i);
      if (atMatch) {
        const tokens = atMatch[1].trim().split(/\s+/);
        const resolvePosition = (token, size, axis) => {
          if (!token || token === 'center') return size * 0.5;
          if ((axis === 'x' && token === 'left') || (axis === 'y' && token === 'top')) return 0;
          if ((axis === 'x' && token === 'right') || (axis === 'y' && token === 'bottom')) return size;
          if (/%$/.test(token)) return size * parseFloat(token) / 100;
          if (/px$/.test(token)) return parseFloat(token);
          const value = parseFloat(token);
          return Number.isFinite(value) ? value : size * 0.5;
        };
        if (tokens.length === 1) {
          if (tokens[0] === 'top' || tokens[0] === 'bottom') cy = resolvePosition(tokens[0], height, 'y');
          else cx = resolvePosition(tokens[0], width, 'x');
        } else {
          cx = resolvePosition(tokens[0], width, 'x');
          cy = resolvePosition(tokens[1], height, 'y');
        }
      }

      const shape = /\bcircle\b/i.test(descriptor) ? 'circle' : 'ellipse';
      const sizePart = descriptor.replace(/\bat\s+.+$/i, '').trim();
      const keywordMatch = sizePart.match(/\b(closest-side|farthest-side|closest-corner|farthest-corner)\b/i);
      const keyword = keywordMatch ? keywordMatch[1].toLowerCase() : 'farthest-corner';
      const left = Math.max(0.0001, cx);
      const right = Math.max(0.0001, width - cx);
      const top = Math.max(0.0001, cy);
      const bottom = Math.max(0.0001, height - cy);

      if (shape === 'circle') {
        const explicit = sizePart.match(/circle\s+([\d.]+)(px|%)/i);
        if (explicit) {
          const value = parseFloat(explicit[1]);
          const radius = explicit[2] === '%' ? Math.hypot(width, height) * value / 100 : value;
          return { cx, cy, rx: Math.max(1, radius), ry: Math.max(1, radius) };
        }
        const sides = [left, right, top, bottom];
        const corners = [Math.hypot(left, top), Math.hypot(right, top), Math.hypot(left, bottom), Math.hypot(right, bottom)];
        const radius = keyword === 'closest-side' ? Math.min(...sides)
          : keyword === 'farthest-side' ? Math.max(...sides)
          : keyword === 'closest-corner' ? Math.min(...corners)
          : Math.max(...corners);
        return { cx, cy, rx: Math.max(1, radius), ry: Math.max(1, radius) };
      }

      const explicitEllipse = sizePart.match(/ellipse\s+([\d.]+)(px|%)\s+([\d.]+)(px|%)/i);
      if (explicitEllipse) {
        const rx = explicitEllipse[2] === '%' ? width * parseFloat(explicitEllipse[1]) / 100 : parseFloat(explicitEllipse[1]);
        const ry = explicitEllipse[4] === '%' ? height * parseFloat(explicitEllipse[3]) / 100 : parseFloat(explicitEllipse[3]);
        return { cx, cy, rx: Math.max(1, rx), ry: Math.max(1, ry) };
      }

      let rx = keyword.startsWith('closest') ? Math.min(left, right) : Math.max(left, right);
      let ry = keyword.startsWith('closest') ? Math.min(top, bottom) : Math.max(top, bottom);
      if (keyword.endsWith('corner')) {
        const cornerFactors = [
          Math.hypot(left / rx, top / ry),
          Math.hypot(right / rx, top / ry),
          Math.hypot(left / rx, bottom / ry),
          Math.hypot(right / rx, bottom / ry)
        ];
        const scale = keyword === 'closest-corner' ? Math.min(...cornerFactors) : Math.max(...cornerFactors);
        rx *= scale;
        ry *= scale;
      }
      return { cx, cy, rx: Math.max(1, rx), ry: Math.max(1, ry) };
    }

    resolveLinearGradientVector(descriptor, rect) {
      const angleMatch = String(descriptor || '').match(/([+-]?[\d.]+)deg/);
      if (angleMatch) {
        const rad = parseFloat(angleMatch[1]) * Math.PI / 180;
        return { x: Math.sin(rad), y: -Math.cos(rad) };
      }
      const value = String(descriptor || '').toLowerCase();
      const sx = /\bright\b/.test(value) ? 1 : (/\bleft\b/.test(value) ? -1 : 0);
      const sy = /\bbottom\b/.test(value) ? 1 : (/\btop\b/.test(value) ? -1 : 0);
      if (sx && sy) {
        // Corner keywords point from the centre to the real box corner; a
        // fixed 45deg vector is incorrect for non-square controls.
        const dx = sx * Math.max(1, rect.width);
        const dy = sy * Math.max(1, rect.height);
        const length = Math.hypot(dx, dy) || 1;
        return { x: dx / length, y: dy / length };
      }
      if (sx) return { x: sx, y: 0 };
      if (sy) return { x: 0, y: sy };
      return { x: 0, y: 1 };
    }

    sampleGradientLayer(layer, point, rect) {
      if (!layer || !/gradient\(/i.test(layer) || !rect || rect.width <= 0 || rect.height <= 0) return null;
      const parsed = this.parseGradientStops(layer);
      if (!parsed) return null;
      const localX = clamp(point.x - rect.left, 0, rect.width);
      const localY = clamp(point.y - rect.top, 0, rect.height);
      const nx = localX / rect.width;
      const ny = localY / rect.height;
      let t = 0.5;
      if (/^linear-gradient/i.test(layer.trim())) {
        const vector = this.resolveLinearGradientVector(parsed.descriptor, rect);
        const vx = vector.x;
        const vy = vector.y;
        // CSS defines the gradient line in physical box coordinates. Normalising X
        // and Y independently makes 135deg gradients wrong on wide pills.
        const lineLength = Math.max(0.0001, Math.abs(vx) * rect.width + Math.abs(vy) * rect.height);
        t = 0.5 + ((localX - rect.width * 0.5) * vx + (localY - rect.height * 0.5) * vy) / lineLength;
      } else {
        const radial = this.resolveRadialGeometry(parsed.descriptor, rect);
        t = Math.hypot((localX - radial.cx) / radial.rx, (localY - radial.cy) / radial.ry);
      }
      t = clamp(t, 0, 1);
      const stops = parsed.stops;
      if (t <= stops[0].position) return stops[0].color;
      for (let i = 1; i < stops.length; i++) {
        if (t <= stops[i].position) {
          const span = Math.max(0.0001, stops[i].position - stops[i - 1].position);
          return this.interpolateColor(stops[i - 1].color, stops[i].color, (t - stops[i - 1].position) / span);
        }
      }
      return stops[stops.length - 1].color;
    }

    sampleComputedBackground(style, point, rect) {
      let result = this.parseColorString(style && style.backgroundColor) || { r: 0, g: 0, b: 0, a: 0 };
      const image = style && style.backgroundImage;
      if (!image || image === 'none') return result;
      const layers = this.splitCssList(image);
      // CSS 第一层绘制在最上方，因此从最后一层开始合成。
      for (let i = layers.length - 1; i >= 0; i--) {
        const sampled = this.sampleGradientLayer(layers[i], point, rect);
        if (sampled) result = this.compositeColor(sampled, result);
      }
      return result;
    }

    prepareGradientLayer(layer, rect, parsedStops) {
      if (!layer || !/gradient\(/i.test(layer) || !rect || rect.width <= 0 || rect.height <= 0) return null;
      const parsed = parsedStops || this.parseGradientStops(layer);
      if (!parsed) return null;
      if (/^linear-gradient/i.test(layer.trim())) {
        const vector = this.resolveLinearGradientVector(parsed.descriptor, rect);
        const vx = vector.x;
        const vy = vector.y;
        return {
          type: 'linear',
          rect,
          vx,
          vy,
          lineLength: Math.max(0.0001, Math.abs(vx) * rect.width + Math.abs(vy) * rect.height),
          stops: parsed.stops
        };
      }
      return {
        type: 'radial',
        rect,
        radial: this.resolveRadialGeometry(parsed.descriptor, rect),
        stops: parsed.stops
      };
    }

    samplePreparedGradient(prepared, point) {
      if (!prepared || !point) return null;
      const rect = prepared.rect;
      const localX = clamp(point.x - rect.left, 0, rect.width);
      const localY = clamp(point.y - rect.top, 0, rect.height);
      let t;
      if (prepared.type === 'linear') {
        t = 0.5 + (
          (localX - rect.width * 0.5) * prepared.vx +
          (localY - rect.height * 0.5) * prepared.vy
        ) / prepared.lineLength;
      } else {
        const radial = prepared.radial;
        t = Math.hypot((localX - radial.cx) / radial.rx, (localY - radial.cy) / radial.ry);
      }
      t = clamp(t, 0, 1);
      const stops = prepared.stops;
      if (t <= stops[0].position) return stops[0].color;
      for (let i = 1; i < stops.length; i++) {
        if (t <= stops[i].position) {
          const span = Math.max(0.0001, stops[i].position - stops[i - 1].position);
          return this.interpolateColor(stops[i - 1].color, stops[i].color, (t - stops[i - 1].position) / span);
        }
      }
      return stops[stops.length - 1].color;
    }

    createComputedBackgroundTemplate(style) {
      const base = this.parseColorString(style && style.backgroundColor) || { r: 0, g: 0, b: 0, a: 0 };
      const image = style && style.backgroundImage;
      const layers = !image || image === 'none'
        ? []
        : this.splitCssList(image).map(layer => ({ layer, parsed: this.parseGradientStops(layer) })).filter(item => item.parsed);
      return { base, layers };
    }

    prepareComputedBackground(style, rect, template) {
      const source = template || this.createComputedBackgroundTemplate(style);
      const layers = source.layers
        .map(item => this.prepareGradientLayer(item.layer, rect, item.parsed))
        .filter(Boolean);
      return { base: source.base, layers };
    }

    samplePreparedBackground(prepared, point) {
      let result = prepared && prepared.base
        ? { r: prepared.base.r, g: prepared.base.g, b: prepared.base.b, a: prepared.base.a }
        : { r: 0, g: 0, b: 0, a: 0 };
      const layers = prepared && prepared.layers ? prepared.layers : [];
      for (let i = layers.length - 1; i >= 0; i--) {
        const sampled = this.samplePreparedGradient(layers[i], point);
        if (sampled) result = this.compositeColor(sampled, result);
      }
      return result;
    }

    createFusionMaterialSampler(el, ownRect, pseudoElement) {
      if (!el || !el.ownerDocument) return null;
      try {
        const win = el.ownerDocument.defaultView;
        if (!win || !win.getComputedStyle) return null;
        const style = win.getComputedStyle(el, pseudoElement || null);
        const backgroundTemplate = this.createComputedBackgroundTemplate(style);
        const hasVisibleMaterial = backgroundTemplate.base.a > 0.0001 || backgroundTemplate.layers.some(item => (
          item.parsed && item.parsed.stops && item.parsed.stops.some(stop => stop.color.a > 0.0001)
        ));
        const parsedOpacity = parseFloat(style.opacity);
        const opacity = Number.isFinite(parsedOpacity) ? clamp(parsedOpacity, 0, 1) : 1;
        const backdropFilter = style.backdropFilter || style.webkitBackdropFilter || 'none';
        let sourceRect = null;
        let prepared = null;
        const sampler = {
          key: this.getFusionKey(el),
          backdropFilter,
          mixBlendMode: style.mixBlendMode || 'normal',
          hasVisibleMaterial,
          setRect: nextRect => {
            sourceRect = nextRect || el.getBoundingClientRect();
            const materialWidth = sourceRect.shapeWidth || sourceRect.width;
            const materialHeight = sourceRect.shapeHeight || sourceRect.height;
            sampler.materialInset = clamp(
              Math.min(materialWidth * 0.22, materialHeight * 0.42),
              4,
              18
            );
            const centerPoint = {
              x: Number.isFinite(sourceRect.cx) ? sourceRect.cx : (sourceRect.left + sourceRect.right) * 0.5,
              y: Number.isFinite(sourceRect.cy) ? sourceRect.cy : (sourceRect.top + sourceRect.bottom) * 0.5
            };
            const baseGeometry = this.getFusionSamplingGeometry(centerPoint, sourceRect);
            prepared = this.prepareComputedBackground(style, baseGeometry.rect, backgroundTemplate);
          },
          sample: point => {
            const geometry = this.getFusionSamplingGeometry(point, sourceRect);
            const surface = this.samplePreparedBackground(prepared, geometry.point);
            return {
              r: surface.r,
              g: surface.g,
              b: surface.b,
              a: clamp(surface.a * opacity, 0, 1)
            };
          }
        };
        sampler.setRect(ownRect || el.getBoundingClientRect());
        return sampler;
      } catch (_) {
        return null;
      }
    }

    blendFusionBackdropFilters(leftValue, rightValue) {
      const left = String(leftValue || 'none').trim().toLowerCase();
      const right = String(rightValue || 'none').trim().toLowerCase();
      if (left === right) return left || 'none';
      const parse = value => {
        const result = new Map();
        if (!value || value === 'none') return result;
        const re = /([a-z-]+)\(\s*([+-]?[\d.]+)(px|%|deg)?\s*\)/g;
        let match;
        while ((match = re.exec(value))) {
          result.set(match[1], { value: parseFloat(match[2]), unit: match[3] || '' });
        }
        return result;
      };
      const a = parse(left);
      const b = parse(right);
      const neutral = {
        blur: { value: 0, unit: 'px' },
        saturate: { value: 100, unit: '%' },
        brightness: { value: 100, unit: '%' },
        contrast: { value: 100, unit: '%' },
        opacity: { value: 100, unit: '%' },
        grayscale: { value: 0, unit: '%' },
        invert: { value: 0, unit: '%' },
        sepia: { value: 0, unit: '%' },
        'hue-rotate': { value: 0, unit: 'deg' }
      };
      const order = ['blur', 'saturate', 'brightness', 'contrast', 'opacity', 'grayscale', 'invert', 'sepia', 'hue-rotate'];
      const parts = [];
      order.forEach(name => {
        if (!a.has(name) && !b.has(name)) return;
        const av = a.get(name) || neutral[name];
        const bv = b.get(name) || neutral[name];
        if (!av || !bv || av.unit !== bv.unit) return;
        const value = (av.value + bv.value) * 0.5;
        parts.push(name + '(' + Number(value.toFixed(3)) + av.unit + ')');
      });
      return parts.length ? parts.join(' ') : 'none';
    }

    isFusionTagSurface(el) {
      if (!el || !el.matches) return false;
      try {
        return el.matches(TAG_SURFACE_SELECTOR) || Boolean(el.closest(TAG_ITEM_SELECTOR));
      } catch (_) {
        return false;
      }
    }

    getFusionPeer(el) {
      if (!el || !el.closest || !this.isFusionTagSurface(el)) return el || null;
      try {
        const item = el.closest(TAG_ITEM_SELECTOR);
        if (item) return item;
        const label = el.closest('label');
        if (label && label.contains(el)) return label;
      } catch (_) {}
      return el;
    }

    getFusionTagGroup(el) {
      if (!this.isFusionTagSurface(el)) return null;
      try {
        const peer = this.getFusionPeer(el);
        const explicit = peer && peer.closest ? peer.closest(TAG_GROUP_SELECTOR) : null;
        if (explicit) return explicit;
        // Most of these controls are <label><input><span></span></label> peers.
        // Their direct parent is the safest generic host for TaskFlow-like pages:
        // it restores fusion without letting a tag connect to another field.
        const parent = peer && peer.parentElement;
        if (parent && parent !== this.doc.body && parent !== this.doc.documentElement) return parent;
      } catch (_) {}
      return null;
    }

    getFusionKey(el) {
      if (!el || !el.matches) return 'glass';
      try {
        if (el.matches(DANGER_SELECTOR) || el.closest(DANGER_SELECTOR)) return 'danger';
        if (el.classList.contains('primary')) return 'primary';
        const label = el.closest(TAG_ITEM_SELECTOR + ', label');
        const input = label && label.querySelector('input');
        if (input) {
          const family = input.type === 'radio' ? (input.name || 'radio') : (input.type || 'input');
          // 选中的高/中/低本来就是三种不同材质，不能再共用 tag-checked。
          // 未选中 tag 的视觉材质一致，因此仍共用一个 key，保持真正的同色溶解。
          return input.checked
            ? 'tag-selected:' + family + ':' + String(input.value || '')
            : 'tag-unselected:' + family;
        }
        if (el.classList.contains('secondary') || this.isFusionTagSurface(el) || label) return 'secondary';
        const win = el.ownerDocument && el.ownerDocument.defaultView;
        const cs = win && win.getComputedStyle ? win.getComputedStyle(el) : null;
        return cs ? 'custom:' + cs.backgroundImage + '|' + cs.backgroundColor : 'glass';
      } catch (_) { return 'glass'; }
    }

    getFusionElementId(el) {
      if (!el || (typeof el !== 'object' && typeof el !== 'function')) return 'none';
      let id = this.fusionElementIds.get(el);
      if (!id) {
        id = 'lq' + (++this.fusionElementSequence);
        this.fusionElementIds.set(el, id);
      }
      return id;
    }

    getFusionVisualStateKey(el) {
      if (!el) return 'none';
      try {
        const label = el.closest && el.closest(TAG_ITEM_SELECTOR + ', label');
        const input = label && label.querySelector('input');
        const inputState = input
          ? [input.type, input.name, input.value, input.checked ? 1 : 0, input.disabled ? 1 : 0].join(':')
          : '';
        const hover = el.matches && el.matches(':hover') ? 1 : 0;
        const active = el.matches && el.matches(':active') ? 1 : 0;
        return [this.getFusionElementId(el), this.getFusionKey(el), inputState, hover, active].join('|');
      } catch (_) {
        return this.getFusionElementId(el) + '|' + this.getFusionKey(el);
      }
    }

    getFusionSamplingGeometry(point, rect) {
      if (!rect || !point || !rect.shapeWidth || !rect.shapeHeight || Math.abs(rect.angle || 0) < 0.000001) {
        return { point, rect };
      }
      const cx = Number.isFinite(rect.cx) ? rect.cx : (rect.left + rect.right) * 0.5;
      const cy = Number.isFinite(rect.cy) ? rect.cy : (rect.top + rect.bottom) * 0.5;
      const cos = Math.cos(rect.angle);
      const sin = Math.sin(rect.angle);
      const dx = point.x - cx;
      const dy = point.y - cy;
      const localX = dx * cos + dy * sin;
      const localY = -dx * sin + dy * cos;
      return {
        point: { x: cx + localX, y: cy + localY },
        rect: {
          left: cx - rect.shapeWidth * 0.5,
          right: cx + rect.shapeWidth * 0.5,
          top: cy - rect.shapeHeight * 0.5,
          bottom: cy + rect.shapeHeight * 0.5,
          width: rect.shapeWidth,
          height: rect.shapeHeight,
          radius: rect.radius || 0
        }
      };
    }

    // 在与按钮相同的局部容器内渲染时，保留按钮材质自身的 alpha，
    // 让浏览器直接与真实 Panel / 动态环境光合成，而不是猜测最终背景色。
    getFusionSurfaceColor(el, point, ownRect) {
      const fallback = { r: 255, g: 255, b: 255, a: 0.16, key: this.getFusionKey(el) };
      if (!el || !el.ownerDocument) return fallback;
      try {
        const win = el.ownerDocument.defaultView;
        if (!win || !win.getComputedStyle) return fallback;
        const geometry = this.getFusionSamplingGeometry(point, ownRect || el.getBoundingClientRect());
        const rect = geometry.rect;
        const style = win.getComputedStyle(el);
        const surface = this.sampleComputedBackground(style, geometry.point, rect);
        const opacity = parseFloat(style.opacity);
        surface.a *= Number.isFinite(opacity) ? clamp(opacity, 0, 1) : 1;
        return {
          r: surface.r,
          g: surface.g,
          b: surface.b,
          a: clamp(surface.a, 0, 1),
          key: this.getFusionKey(el)
        };
      } catch (_) {
        return fallback;
      }
    }

    // 计算接触点处最终可见的颜色：按祖先背景从后向前做 alpha 合成，
    // 再叠加按钮自身当前的渐变。这样不会把 padding-box 主体、border-box
    // 描边和白色高光粗暴平均，也不会再次人为提亮。
    getFusionColor(el, point, ownRect) {
      const fallback = { r: 242, g: 242, b: 246, a: 1, key: this.getFusionKey(el) };
      if (!el || !el.ownerDocument) return fallback;
      try {
        const win = el.ownerDocument.defaultView;
        if (!win || !win.getComputedStyle) return fallback;
        const chain = [];
        let node = el;
        let depth = 0;
        while (node && node.nodeType === 1 && depth++ < 12) {
          const isOwn = node === el;
          let rect = isOwn && ownRect ? ownRect : node.getBoundingClientRect();
          if (rect && rect.width > 0 && rect.height > 0) {
            const geometry = isOwn ? this.getFusionSamplingGeometry(point, rect) : { point, rect };
            chain.push({ style: win.getComputedStyle(node), rect: geometry.rect, point: geometry.point });
          }
          node = node.parentElement;
        }
        let rendered = { r: 255, g: 255, b: 255, a: 1 };
        for (let i = chain.length - 1; i >= 0; i--) {
          const layer = this.sampleComputedBackground(chain[i].style, chain[i].point, chain[i].rect);
          rendered = this.compositeColor(layer, rendered);
        }

        // Liquid Glass 的 ::after 是按钮内部真实可见的指针高光。只采样这一层；
        // ::before 是边框蒙版，在液桥伸入的内部接触点不应参与主体颜色。
        try {
          const pseudo = win.getComputedStyle(el, '::after');
          const pseudoOpacity = clamp(parseFloat(pseudo.opacity) || 0, 0, 1);
          if (pseudoOpacity > 0.001 && pseudo.backgroundImage && pseudo.backgroundImage !== 'none') {
            const geometry = this.getFusionSamplingGeometry(point, ownRect || el.getBoundingClientRect());
            const highlight = this.sampleComputedBackground(pseudo, geometry.point, geometry.rect);
            highlight.a *= pseudoOpacity;
            if (pseudo.mixBlendMode === 'overlay') {
              const overlayChannel = (base, blend) => base < 128
                ? (2 * base * blend) / 255
                : 255 - (2 * (255 - base) * (255 - blend)) / 255;
              highlight.r = Math.round(overlayChannel(rendered.r, highlight.r));
              highlight.g = Math.round(overlayChannel(rendered.g, highlight.g));
              highlight.b = Math.round(overlayChannel(rendered.b, highlight.b));
            }
            rendered = this.compositeColor(highlight, rendered);
          }
        } catch (_) {}
        return { r: rendered.r, g: rendered.g, b: rendered.b, a: 1, key: this.getFusionKey(el) };
      } catch (_) {
        return fallback;
      }
    }

    getFusionHost(activeEl, neighborEl) {
      const rootHost = this.doc.body || this.doc.documentElement;
      // Do not put a bridge inside subject-box (or another choice group).
      // A selected tag commonly has transform/isolation/backdrop-filter, each
      // of which can paint over an in-container SVG even at a higher z-index.
      // The root overlay is also what lets two modal action buttons share the
      // exact same fusion path as ordinary buttons.
      return rootHost;
    }

    releaseFusionPeer(peer, excludingBridge) {
      if (!peer || !peer.classList) return;
      let inUse = false;
      try {
        this.fusionBridges.forEach(candidateBridge => {
          if (inUse || !candidateBridge || candidateBridge === excludingBridge || !candidateBridge.isConnected) return;
          const candidateRefs = candidateBridge.__lqFusion;
          if (candidateRefs && candidateRefs.isLocal && (
            candidateRefs.activePeer === peer || candidateRefs.neighborPeer === peer
          )) inUse = true;
        });
      } catch (_) {}
      if (!inUse) {
        try { peer.classList.remove('__lq-fusion-peer'); } catch (_) {}
      }
    }

    cleanupFusionBridgeHost(refs, bridge) {
      if (!refs) return;
      const peers = [refs.activePeer, refs.neighborPeer];
      peers.forEach(peer => this.releaseFusionPeer(peer, bridge));
      const host = refs.host;
      refs.activePeer = null;
      refs.neighborPeer = null;
      refs.host = null;
      refs.isLocal = false;
      if (host && host.classList) {
        try {
          if (!host.querySelector('.__lq-fusion-bridge.__lq-fusion-local')) {
            host.classList.remove('__lq-fusion-host');
          }
        } catch (_) {}
      }
    }

    configureFusionBridgeHost(bridge, activeEl, neighborEl) {
      if (!bridge) return;
      const refs = bridge.__lqFusion;
      const host = this.getFusionHost(activeEl, neighborEl);
      const rootHost = this.doc.body || this.doc.documentElement;
      const isLocal = host !== rootHost;
      // Every bridge uses the material channel. Restricting it to tag groups
      // made ordinary/modal buttons fall back to a flattened opaque colour,
      // which baked the page background into the bridge and caused mismatch.
      const materialPair = Boolean(activeEl && neighborEl);
      let tagPair = false;
      try {
        const activeGroup = this.getFusionTagGroup(activeEl);
        tagPair = Boolean(activeGroup && activeGroup === this.getFusionTagGroup(neighborEl));
      } catch (_) {}
      const previousHost = refs && refs.host;
      if (refs && refs.host !== host) {
        host.appendChild(bridge);
        refs.host = host;
        if (previousHost && previousHost.classList) {
          try {
            if (!previousHost.querySelector('.__lq-fusion-bridge.__lq-fusion-local')) {
              previousHost.classList.remove('__lq-fusion-host');
            }
          } catch (_) {}
        }
      }
      bridge.classList.toggle('__lq-fusion-local', isLocal);
      bridge.classList.toggle('__lq-fusion-tag-pair', tagPair);
      if (isLocal) {
        host.classList.add('__lq-fusion-host');
        const activePeer = this.getFusionPeer(activeEl);
        const neighborPeer = this.getFusionPeer(neighborEl);
        if (refs && refs.activePeer && refs.activePeer !== activePeer) this.releaseFusionPeer(refs.activePeer, bridge);
        if (refs && refs.neighborPeer && refs.neighborPeer !== neighborPeer) this.releaseFusionPeer(refs.neighborPeer, bridge);
        if (activePeer && activePeer.classList) activePeer.classList.add('__lq-fusion-peer');
        if (neighborPeer && neighborPeer.classList) neighborPeer.classList.add('__lq-fusion-peer');
        if (refs) {
          refs.activePeer = activePeer;
          refs.neighborPeer = neighborPeer;
        }
      } else if (refs) {
        this.releaseFusionPeer(refs.activePeer, bridge);
        this.releaseFusionPeer(refs.neighborPeer, bridge);
        refs.activePeer = null;
        refs.neighborPeer = null;
      }
      if (refs) {
        refs.isLocal = isLocal;
        // Material sampling and DOM placement are independent: the bridge can
        // stay in the root overlay while retaining either control's real alpha.
        refs.materialPair = materialPair;
        refs.tagPair = tagPair;
      }
    }

    ensureFusionBridge(neighborEl, activeEl) {
      let bridge = this.fusionBridges.get(neighborEl);
      if (bridge && bridge.isConnected) {
        const refs = bridge.__lqFusion;
        if (refs && refs.isExiting) this.cancelFusionBridgeExit(refs, bridge);
        if (refs && refs.removeTimer) {
          clearTimeout(refs.removeTimer);
          refs.removeTimer = 0;
        }
        this.configureFusionBridgeHost(bridge, activeEl, neighborEl);
        return bridge;
      }
      const svgNS = 'http://www.w3.org/2000/svg';
      const gradientId = '__lq-fusion-gradient-' + (++this.fusionSequence);
      const clipId = gradientId + '-clip';
      const rimGradientId = gradientId + '-rim';
      const rimMaskGradientId = gradientId + '-rim-mask-gradient';
      const rimMaskId = gradientId + '-rim-mask';
      bridge = this.doc.createElementNS(svgNS, 'svg');
      bridge.setAttribute('class', '__lq-fusion-bridge');
      bridge.setAttribute('aria-hidden', 'true');
      bridge.setAttribute('focusable', 'false');

      const defs = this.doc.createElementNS(svgNS, 'defs');
      const gradient = this.doc.createElementNS(svgNS, 'linearGradient');
      gradient.id = gradientId;
      gradient.setAttribute('gradientUnits', 'userSpaceOnUse');
      const offsets = ['0%', '5%', '18%', '36%', '50%', '64%', '82%', '95%', '100%'];
      const stops = offsets.map(offset => {
        const stop = this.doc.createElementNS(svgNS, 'stop');
        stop.setAttribute('offset', offset);
        gradient.appendChild(stop);
        return stop;
      });
      defs.appendChild(gradient);
      const rasterClip = this.doc.createElementNS(svgNS, 'clipPath');
      rasterClip.id = clipId;
      rasterClip.setAttribute('clipPathUnits', 'userSpaceOnUse');
      const rasterClipBody = this.doc.createElementNS(svgNS, 'path');
      rasterClip.appendChild(rasterClipBody);
      defs.appendChild(rasterClip);

      // The material itself is never made more opaque. This perimeter contains
      // only a faint upper specular highlight; its lower half is transparent,
      // so it cannot create a grey/dark line under the bridge.
      const rimGradient = this.doc.createElementNS(svgNS, 'linearGradient');
      rimGradient.id = rimGradientId;
      rimGradient.setAttribute('gradientUnits', 'userSpaceOnUse');
      [
        ['0%', 'rgb(255,255,255)', '0.18'],
        ['34%', 'rgb(255,255,255)', '0.065'],
        ['58%', 'rgb(255,255,255)', '0.018'],
        ['76%', 'rgb(255,255,255)', '0'],
        ['100%', 'rgb(255,255,255)', '0']
      ].forEach(spec => {
        const stop = this.doc.createElementNS(svgNS, 'stop');
        stop.setAttribute('offset', spec[0]);
        stop.setAttribute('stop-color', spec[1]);
        stop.setAttribute('stop-opacity', spec[2]);
        rimGradient.appendChild(stop);
      });
      defs.appendChild(rimGradient);

      const rimMaskGradient = this.doc.createElementNS(svgNS, 'linearGradient');
      rimMaskGradient.id = rimMaskGradientId;
      rimMaskGradient.setAttribute('gradientUnits', 'userSpaceOnUse');
      [['0%', '0'], ['10%', '1'], ['90%', '1'], ['100%', '0']].forEach(spec => {
        const stop = this.doc.createElementNS(svgNS, 'stop');
        stop.setAttribute('offset', spec[0]);
        stop.setAttribute('stop-color', 'white');
        stop.setAttribute('stop-opacity', spec[1]);
        rimMaskGradient.appendChild(stop);
      });
      defs.appendChild(rimMaskGradient);
      const rimMask = this.doc.createElementNS(svgNS, 'mask');
      rimMask.id = rimMaskId;
      rimMask.setAttribute('maskUnits', 'userSpaceOnUse');
      rimMask.setAttribute('maskContentUnits', 'userSpaceOnUse');
      const rimMaskRect = this.doc.createElementNS(svgNS, 'rect');
      rimMaskRect.setAttribute('x', '0');
      rimMaskRect.setAttribute('y', '0');
      rimMaskRect.setAttribute('width', '1');
      rimMaskRect.setAttribute('height', '1');
      rimMaskRect.setAttribute('fill', 'url(#' + rimMaskGradientId + ')');
      rimMask.appendChild(rimMaskRect);
      defs.appendChild(rimMask);

      // Local tag bridges use a tiny canvas texture. Unlike a one-dimensional
      // SVG colour stop, it preserves the source pill's radial/linear gradient
      // in both axes, so the neck is a continuation of the material itself.
      const rasterObject = this.doc.createElementNS(svgNS, 'foreignObject');
      rasterObject.setAttribute('class', '__lq-fusion-raster-host');
      rasterObject.setAttribute('x', '0');
      rasterObject.setAttribute('y', '0');
      rasterObject.setAttribute('width', '1');
      rasterObject.setAttribute('height', '1');
      rasterObject.setAttribute('clip-path', 'url(#' + clipId + ')');
      const rasterStack = this.doc.createElement('div');
      rasterStack.setAttribute('class', '__lq-fusion-raster-stack');
      const raster = this.doc.createElement('canvas');
      raster.setAttribute('class', '__lq-fusion-raster');
      raster.setAttribute('aria-hidden', 'true');
      let rasterContext = null;
      try { rasterContext = raster.getContext('2d', { alpha: true, desynchronized: true }); } catch (_) {}
      const rasterHighlight = this.doc.createElement('canvas');
      rasterHighlight.setAttribute('class', '__lq-fusion-raster __lq-fusion-raster-highlight');
      rasterHighlight.setAttribute('aria-hidden', 'true');
      let rasterHighlightContext = null;
      try { rasterHighlightContext = rasterHighlight.getContext('2d', { alpha: true, desynchronized: true }); } catch (_) {}
      rasterStack.appendChild(raster);
      rasterStack.appendChild(rasterHighlight);
      rasterObject.appendChild(rasterStack);

      const body = this.doc.createElementNS(svgNS, 'path');
      body.setAttribute('class', '__lq-fusion-body');
      body.setAttribute('fill', 'url(#' + gradientId + ')');
      const rim = this.doc.createElementNS(svgNS, 'path');
      rim.setAttribute('class', '__lq-fusion-rim');
      rim.setAttribute('stroke', 'url(#' + rimGradientId + ')');
      rim.setAttribute('mask', 'url(#' + rimMaskId + ')');
      bridge.appendChild(defs);
      bridge.appendChild(rasterObject);
      bridge.appendChild(body);
      bridge.appendChild(rim);
      bridge.__lqFusion = {
        gradient,
        stops,
        body,
        rim,
        rimGradient,
        rimMaskGradient,
        rimMaskRect,
        rasterObject,
        rasterStack,
        raster,
        rasterContext,
        rasterHighlight,
        rasterHighlightContext,
        rasterClipBody,
        lastRasterAt: 0,
        lastRasterWidth: 0,
        lastRasterHeight: 0,
        rasterDirty: true,
        overlapBucket: -1,
        paintKey: '',
        lastPaintAt: 0,
        lastActivePaint: null,
        lastNeighborPaint: null,
        lastActiveSampler: null,
        lastNeighborSampler: null,
        lastActiveHighlightSampler: null,
        lastNeighborHighlightSampler: null,
        removeTimer: 0,
        activeStateKey: '',
        neighborStateKey: '',
        transitionUntil: 0,
        isExiting: false,
        exitRaf: 0,
        lastFusionFrame: null,
        lastFusionOpacity: 0,
        host: null,
        isLocal: false,
        materialPair: false,
        tagPair: false,
        activePeer: null,
        neighborPeer: null
      };
      bridge.style.setProperty('--lq-fusion-opacity', '0');
      this.configureFusionBridgeHost(bridge, activeEl, neighborEl);
      this.fusionBridges.set(neighborEl, bridge);
      return bridge;
    }

    cancelFusionBridgeExit(refs, bridge) {
      if (!refs) return;
      try {
        const win = this.doc && this.doc.defaultView;
        const cancel = win && win.cancelAnimationFrame
          ? win.cancelAnimationFrame.bind(win)
          : (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : null);
        if (refs.exitRaf && cancel) cancel(refs.exitRaf);
      } catch (_) {}
      if (refs.removeTimer) {
        try { clearTimeout(refs.removeTimer); } catch (_) {}
      }
      refs.exitRaf = 0;
      refs.removeTimer = 0;
      refs.isExiting = false;
      if (bridge && bridge.classList) bridge.classList.remove('__lq-fusion-exiting');
    }

    hideFusionBridge(bridge) {
      if (!bridge) return;
      bridge.style.setProperty('--lq-fusion-opacity', '0');
      bridge.classList.remove('__lq-fusion-visible');
    }

    applyFusionExitGeometry(bridge, geometry, opacity) {
      const refs = bridge && bridge.__lqFusion;
      if (!refs || !geometry) return;
      const g = geometry;
      bridge.setAttribute('viewBox', '0 0 ' + g.width.toFixed(2) + ' ' + g.height.toFixed(2));
      bridge.setAttribute('width', g.width.toFixed(2));
      bridge.setAttribute('height', g.height.toFixed(2));
      bridge.style.width = g.width.toFixed(2) + 'px';
      bridge.style.height = g.height.toFixed(2) + 'px';
      let paintX = g.x;
      let paintY = g.y;
      if (refs.isLocal && refs.host) {
        const hostRect = refs.host.getBoundingClientRect();
        paintX -= hostRect.left + (refs.host.clientLeft || 0) - (refs.host.scrollLeft || 0);
        paintY -= hostRect.top + (refs.host.clientTop || 0) - (refs.host.scrollTop || 0);
      }
      bridge.style.setProperty('--lq-fusion-x', paintX.toFixed(2) + 'px');
      bridge.style.setProperty('--lq-fusion-y', paintY.toFixed(2) + 'px');
      bridge.style.setProperty('--lq-fusion-opacity', clamp(opacity, 0, 1).toFixed(3));
      refs.body.setAttribute('d', g.d);
      refs.rim.setAttribute('d', g.d);
      refs.rasterClipBody.setAttribute('d', g.d);
      refs.rasterObject.setAttribute('width', g.width.toFixed(2));
      refs.rasterObject.setAttribute('height', g.height.toFixed(2));
      refs.gradient.setAttribute('x1', g.gradientStart.x.toFixed(2));
      refs.gradient.setAttribute('y1', g.gradientStart.y.toFixed(2));
      refs.gradient.setAttribute('x2', g.gradientEnd.x.toFixed(2));
      refs.gradient.setAttribute('y2', g.gradientEnd.y.toFixed(2));
      refs.rimGradient.setAttribute('x1', g.rimStart.x.toFixed(2));
      refs.rimGradient.setAttribute('y1', g.rimStart.y.toFixed(2));
      refs.rimGradient.setAttribute('x2', g.rimEnd.x.toFixed(2));
      refs.rimGradient.setAttribute('y2', g.rimEnd.y.toFixed(2));
      refs.rimMaskGradient.setAttribute('x1', g.gradientStart.x.toFixed(2));
      refs.rimMaskGradient.setAttribute('y1', g.gradientStart.y.toFixed(2));
      refs.rimMaskGradient.setAttribute('x2', g.gradientEnd.x.toFixed(2));
      refs.rimMaskGradient.setAttribute('y2', g.gradientEnd.y.toFixed(2));
      refs.rimMaskRect.setAttribute('width', g.width.toFixed(2));
      refs.rimMaskRect.setAttribute('height', g.height.toFixed(2));
    }

    removeFusionBridge(neighborEl) {
      const b = this.fusionBridges.get(neighborEl);
      if (!b) return;
      try {
        const refs = b.__lqFusion;
        if (!refs || refs.isExiting) return;
        const frame = refs.lastFusionFrame;
        const finish = () => {
          if (this.fusionBridges.get(neighborEl) !== b || !refs.isExiting) return;
          this.hideFusionBridge(b);
          refs.exitRaf = 0;
          refs.isExiting = false;
          if (b.parentNode) {
            try { b.parentNode.removeChild(b); } catch (_) {}
          }
          this.cleanupFusionBridgeHost(refs, b);
          this.fusionBridges.delete(neighborEl);
        };
        if (!frame || !frame.activeRect || !frame.neighborRect) {
          this.hideFusionBridge(b);
          refs.isExiting = true;
          refs.removeTimer = setTimeout(finish, 120);
          return;
        }
        const win = this.doc && this.doc.defaultView;
        const request = win && win.requestAnimationFrame
          ? win.requestAnimationFrame.bind(win)
          : (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null);
        if (!request) {
          this.hideFusionBridge(b);
          refs.isExiting = true;
          refs.removeTimer = setTimeout(finish, 120);
          return;
        }
        refs.isExiting = true;
        b.classList.add('__lq-fusion-exiting');
        const startedAt = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        const startEntry = clamp(Number.isFinite(frame.entryProgress) ? frame.entryProgress : 1, 0.08, 1);
        const startOpacity = clamp(refs.lastFusionOpacity || 0, 0, 1);
        const step = now => {
          if (!refs.isExiting || this.fusionBridges.get(neighborEl) !== b) return;
          const t = clamp((now - startedAt) / CONFIG.fusionExitDuration, 0, 1);
          const eased = t * t * (3 - 2 * t);
          const reverseEntry = startEntry * (1 - eased);
          const geometry = this.buildFusionGeometry(
            frame.activeRect,
            frame.neighborRect,
            frame.progress,
            frame.isLocalPair,
            reverseEntry
          );
          const opacity = startOpacity * Math.pow(1 - eased, 0.72);
          if (geometry) this.applyFusionExitGeometry(b, geometry, opacity);
          if (t >= 1) finish();
          else refs.exitRaf = request(step);
        };
        refs.exitRaf = request(step);
      } catch (_) {}
    }

    clearAllFusionBridges() {
      if (!this.fusionBridges || this.fusionBridges.size === 0) return;
      Array.from(this.fusionBridges.keys()).forEach(neighbor => this.removeFusionBridge(neighbor));
    }

    // Measure the transformed border box itself. DOMQuad, when available,
    // represents the real CSS border box and never includes box-shadow or
    // filter:drop-shadow. The fallback remains getBoundingClientRect(), which
    // also excludes ordinary box-shadow but cannot retain a rotated box's
    // original width/height separately from its axis-aligned bounds.
    measureFusionBorderBox(el, measuredRect) {
      if (!el) return measuredRect || null;
      let viewportRect = measuredRect || null;
      if (!viewportRect) {
        try { viewportRect = el.getBoundingClientRect(); } catch (_) {}
      }
      try {
        if (typeof el.getBoxQuads === 'function') {
          const quads = el.getBoxQuads({ box: 'border' });
          const q = quads && quads[0];
          if (q && q.p1 && q.p2 && q.p3 && q.p4) {
            const points = [q.p1, q.p2, q.p3, q.p4];
            const xs = points.map(point => point.x);
            const ys = points.map(point => point.y);
            const shapeWidth = Math.hypot(q.p2.x - q.p1.x, q.p2.y - q.p1.y);
            const shapeHeight = Math.hypot(q.p4.x - q.p1.x, q.p4.y - q.p1.y);
            if (shapeWidth > 0 && shapeHeight > 0) {
              const quadCx = points.reduce((sum, point) => sum + point.x, 0) / 4;
              const quadCy = points.reduce((sum, point) => sum + point.y, 0) / 4;
              // Some Electron/zoom combinations expose DOMQuad coordinates in
              // page space while getBoundingClientRect is in viewport space.
              // Preserve the quad's physical size/angle, but anchor its centre
              // to the known viewport border box so long TaskHub pages do not
              // paint tag bridges off-screen by scrollY.
              const cx = viewportRect ? (viewportRect.left + viewportRect.right) * 0.5 : quadCx;
              const cy = viewportRect ? (viewportRect.top + viewportRect.bottom) * 0.5 : quadCy;
              const offsetX = cx - quadCx;
              const offsetY = cy - quadCy;
              return {
                left: Math.min(...xs) + offsetX,
                right: Math.max(...xs) + offsetX,
                top: Math.min(...ys) + offsetY,
                bottom: Math.max(...ys) + offsetY,
                width: Math.max(...xs) - Math.min(...xs),
                height: Math.max(...ys) - Math.min(...ys),
                cx,
                cy,
                shapeWidth,
                shapeHeight,
                angle: Math.atan2(q.p2.y - q.p1.y, q.p2.x - q.p1.x)
              };
            }
          }
        }
      } catch (_) {}
      const rect = viewportRect;
      if (!rect) return null;
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        cx: (rect.left + rect.right) * 0.5,
        cy: (rect.top + rect.bottom) * 0.5,
        shapeWidth: rect.width,
        shapeHeight: rect.height,
        angle: 0
      };
    }

    getElementFusionRadius(el, rect) {
      if (!el || !rect) return 0;
      try {
        const win = el.ownerDocument && el.ownerDocument.defaultView;
        const cs = win && win.getComputedStyle ? win.getComputedStyle(el) : null;
        if (!cs) return 0;
        const values = [
          cs.borderTopLeftRadius,
          cs.borderTopRightRadius,
          cs.borderBottomRightRadius,
          cs.borderBottomLeftRadius
        ].map(value => {
          const first = String(value || '0').trim().split(/[\s/]+/)[0];
          if (/%$/.test(first)) return Math.min(rect.shapeWidth || rect.width, rect.shapeHeight || rect.height) * parseFloat(first) / 100;
          return parseFloat(first) || 0;
        });
        return clamp(values.reduce((sum, value) => sum + value, 0) / values.length, 0, Math.min(rect.shapeWidth || rect.width, rect.shapeHeight || rect.height) * 0.5);
      } catch (_) {
        return 0;
      }
    }

    getElementFusionBorderWidths(el) {
      const empty = { top: 0, right: 0, bottom: 0, left: 0 };
      if (!el || !el.ownerDocument) return empty;
      try {
        const win = el.ownerDocument.defaultView;
        const cs = win && win.getComputedStyle ? win.getComputedStyle(el) : null;
        if (!cs) return empty;
        // Home and several modal themes paint their visible outline with a
        // border-box background layer while keeping border-color transparent.
        // Such a border is still real visual material and must be dissolved.
        const backgroundClips = this.splitCssList(cs.backgroundClip || cs.webkitBackgroundClip || '');
        const hasPaintedBorderBox = backgroundClips.some(value => String(value).trim().toLowerCase() === 'border-box');
        const readSide = side => {
          const style = String(cs['border' + side + 'Style'] || '').toLowerCase();
          if (style === 'none' || style === 'hidden') return 0;
          const width = parseFloat(cs['border' + side + 'Width']) || 0;
          const color = this.parseColorString(cs['border' + side + 'Color']);
          if (color && color.a <= 0.015 && !hasPaintedBorderBox) return 0;
          return clamp(width, 0, 4);
        };
        return {
          top: readSide('Top'),
          right: readSide('Right'),
          bottom: readSide('Bottom'),
          left: readSide('Left')
        };
      } catch (_) {
        return empty;
      }
    }

    createFusionRect(rect, radius, borderWidths) {
      // The input is the measured border box, explicitly excluding outer
      // shadows. Keep only a tiny anti-alias inset so the mouth lands on the
      // painted border instead of the shadow halo.
      const inset = 0.30;
      const cx = Number.isFinite(rect.cx) ? rect.cx : (rect.left + rect.right) * 0.5;
      const cy = Number.isFinite(rect.cy) ? rect.cy : (rect.top + rect.bottom) * 0.5;
      const angle = rect.angle || 0;
      const shapeWidth = Math.max(1, (rect.shapeWidth || rect.width) - inset * 2);
      const shapeHeight = Math.max(1, (rect.shapeHeight || rect.height) - inset * 2);
      const cos = Math.abs(Math.cos(angle));
      const sin = Math.abs(Math.sin(angle));
      const width = shapeWidth * cos + shapeHeight * sin;
      const height = shapeWidth * sin + shapeHeight * cos;
      const deflatedRadius = Math.max(0, radius - inset);
      return {
        left: cx - width * 0.5,
        right: cx + width * 0.5,
        top: cy - height * 0.5,
        bottom: cy + height * 0.5,
        width,
        height,
        cx,
        cy,
        shapeWidth,
        shapeHeight,
        angle,
        borderWidths: borderWidths || rect.borderWidths || { top: 0, right: 0, bottom: 0, left: 0 },
        radius: clamp(deflatedRadius, 0, Math.min(shapeWidth, shapeHeight) * 0.5)
      };
    }

    collectFusionCandidates(activeEl, activeRect, profile) {
      let candidates = [];
      const tagGroup = this.getFusionTagGroup(activeEl);
      try {
        // Tags only dissolve into peers in the same choice group. This both
        // restores TaskFlow/TaskHub groups and prevents a nearby field/button
        // from becoming an accidental colour sample.
        candidates = tagGroup
          ? tagGroup.querySelectorAll(TAG_SURFACE_SELECTOR)
          : this.doc.querySelectorAll(DEFAULT_SELECTOR);
      } catch (_) {}

      const travel = profile ? Math.hypot(profile.maxOffsetX || 0, profile.maxOffsetY || 0) : 24;
      const reach = CONFIG.fusionThreshold + CONFIG.fusionOverlap + travel + 8;
      const result = [];
      candidates.forEach(cand => {
        if (!cand || cand === activeEl || !cand.isConnected) return;
        if (cand.disabled || cand.classList.contains('disabled')) return;
        if (cand.matches && cand.matches(EXCLUDE_SELECTOR)) return;
        if (cand.closest && cand.closest('.no-liquid')) return;
        if (cand.contains(activeEl) || activeEl.contains(cand)) return;
        let rect;
        try { rect = this.measureFusionBorderBox(cand, cand.getBoundingClientRect()); } catch (_) { return; }
        if (!rect || rect.width <= 0 || rect.height <= 0) return;
        if (
          rect.right < activeRect.left - reach ||
          rect.left > activeRect.right + reach ||
          rect.bottom < activeRect.top - reach ||
          rect.top > activeRect.bottom + reach
        ) return;
        const shapedRect = this.createFusionRect(
          rect,
          this.getElementFusionRadius(cand, rect),
          this.getElementFusionBorderWidths(cand)
        );
        result.push({
          el: cand,
          rect: shapedRect,
          baseRect: shapedRect,
          rectSampleAt: 0,
          entryStartedAt: null,
          entryLastEligibleAt: -Infinity,
          key: this.getFusionKey(cand),
          isLocalPair: Boolean(tagGroup && this.getFusionTagGroup(cand) === tagGroup)
        });
      });
      return result;
    }

    getRectGap(a, b) {
      let gapX = 0;
      let gapY = 0;
      if (a.right < b.left) gapX = b.left - a.right;
      else if (b.right < a.left) gapX = a.left - b.right;
      if (a.bottom < b.top) gapY = b.top - a.bottom;
      else if (b.bottom < a.top) gapY = a.top - b.bottom;
      return Math.hypot(gapX, gapY);
    }

    getRectSeparationVector(a, b) {
      let x = 0;
      let y = 0;
      if (a.right <= b.left) x = b.left - a.right;
      else if (b.right <= a.left) x = b.right - a.left;
      if (a.bottom <= b.top) y = b.top - a.bottom;
      else if (b.bottom <= a.top) y = b.bottom - a.top;
      if (Math.abs(x) < 0.001 && Math.abs(y) < 0.001) {
        x = (b.left + b.right - a.left - a.right) * 0.5;
        y = (b.top + b.bottom - a.top - a.bottom) * 0.5;
      }
      return { x, y };
    }

    getAnimatedFusionRect(state) {
      const base = state && state.rect;
      if (!base) return null;
      const scaleX = Math.max(0.01, (state.scale || 1) * (state.sx || 1));
      const scaleY = Math.max(0.01, (state.scale || 1) * (state.sy || 1));
      const angle = (base.angle || 0) + (state.rot || 0) * Math.PI / 180;
      const cos = Math.abs(Math.cos(angle));
      const sin = Math.abs(Math.sin(angle));
      const rawW = (base.shapeWidth || base.width) * scaleX;
      const rawH = (base.shapeHeight || base.height) * scaleY;
      const width = rawW * cos + rawH * sin;
      const height = rawW * sin + rawH * cos;
      const cx = (base.left + base.right) * 0.5 + (state.x || 0);
      const cy = (base.top + base.bottom) * 0.5 + (state.y || 0);
      // 排除阴影：与 createFusionRect 保持一致，液桥应基于按钮实体边缘而非阴影外沿
      const inset = 0.30;
      const deflatedWidth = Math.max(1, width - inset * 2);
      const deflatedHeight = Math.max(1, height - inset * 2);
      const deflatedShapeW = Math.max(1, rawW - inset * 2);
      const deflatedShapeH = Math.max(1, rawH - inset * 2);
      const deflatedRadius = Math.max(0, (base.radius || 0) * Math.min(scaleX, scaleY) - inset);
      return {
        left: cx - deflatedWidth * 0.5,
        right: cx + deflatedWidth * 0.5,
        top: cy - deflatedHeight * 0.5,
        bottom: cy + deflatedHeight * 0.5,
        width: deflatedWidth,
        height: deflatedHeight,
        cx,
        cy,
        shapeWidth: deflatedShapeW,
        shapeHeight: deflatedShapeH,
        angle,
        borderWidths: base.borderWidths || { top: 0, right: 0, bottom: 0, left: 0 },
        radius: clamp(deflatedRadius, 0, Math.min(deflatedShapeW, deflatedShapeH) * 0.5)
      };
    }

    getRenderedActiveFusionRect(state, fallbackRect) {
      const el = state && state.el;
      if (!el || !el.isConnected) return fallbackRect || null;
      try {
        // Read the actual transformed border box after this frame's CSS
        // variables were applied. This absorbs modal/ancestor transforms,
        // Electron zoom and transform-order differences that cannot be
        // reconstructed reliably from state.x/scale alone.
        const measured = this.measureFusionBorderBox(el, el.getBoundingClientRect());
        if (!measured || measured.width <= 0 || measured.height <= 0) return fallbackRect || null;
        const base = state.rect || fallbackRect || measured;
        const measuredShapeW = measured.shapeWidth || measured.width;
        const measuredShapeH = measured.shapeHeight || measured.height;
        const baseShapeW = base.shapeWidth || base.width || measuredShapeW;
        const baseShapeH = base.shapeHeight || base.height || measuredShapeH;
        const radiusScale = Math.min(
          measuredShapeW / Math.max(1, baseShapeW),
          measuredShapeH / Math.max(1, baseShapeH)
        );
        const radius = (base.radius || 0) * radiusScale;
        return this.createFusionRect(
          measured,
          radius,
          this.getElementFusionBorderWidths(el)
        );
      } catch (_) {
        return fallbackRect || null;
      }
    }

    getFusionBorderAlong(rect, ux, uy) {
      const borders = rect && rect.borderWidths;
      if (!borders) return 0;
      const angle = rect.angle || 0;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const localUx = ux * cos + uy * sin;
      const localUy = -ux * sin + uy * cos;
      const ax = Math.abs(localUx);
      const ay = Math.abs(localUy);
      const horizontal = localUx >= 0 ? (borders.right || 0) : (borders.left || 0);
      const vertical = localUy >= 0 ? (borders.bottom || 0) : (borders.top || 0);
      return clamp((horizontal * ax + vertical * ay) / Math.max(0.0001, ax + ay), 0, 4);
    }

    getRectBoundaryPoint(rect, ux, uy) {
      const cx = Number.isFinite(rect.cx) ? rect.cx : (rect.left + rect.right) * 0.5;
      const cy = Number.isFinite(rect.cy) ? rect.cy : (rect.top + rect.bottom) * 0.5;
      const angle = rect.angle || 0;
      if (Math.abs(angle) > 0.000001 && rect.shapeWidth && rect.shapeHeight) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const localUx = ux * cos + uy * sin;
        const localUy = -ux * sin + uy * cos;
        const localRect = {
          left: -rect.shapeWidth * 0.5,
          right: rect.shapeWidth * 0.5,
          top: -rect.shapeHeight * 0.5,
          bottom: rect.shapeHeight * 0.5,
          width: rect.shapeWidth,
          height: rect.shapeHeight,
          radius: rect.radius || 0,
          angle: 0
        };
        const localPoint = this.getRectBoundaryPoint(localRect, localUx, localUy);
        return {
          x: cx + localPoint.x * cos - localPoint.y * sin,
          y: cy + localPoint.x * sin + localPoint.y * cos
        };
      }
      const shapeWidth = rect.shapeWidth || rect.width;
      const shapeHeight = rect.shapeHeight || rect.height;
      const radius = clamp(rect.radius || 0, 0, Math.min(shapeWidth, shapeHeight) * 0.5);
      if (radius > 0.01) {
        const halfW = shapeWidth * 0.5;
        const halfH = shapeHeight * 0.5;
        const absX = Math.abs(ux);
        const absY = Math.abs(uy);
        const flatHalfW = Math.max(0, halfW - radius);
        const flatHalfH = Math.max(0, halfH - radius);

        if (absX > 0.0001) {
          const tx = halfW / absX;
          if (absY * tx <= flatHalfH + 0.0001) {
            return { x: cx + ux * tx, y: cy + uy * tx };
          }
        }
        if (absY > 0.0001) {
          const ty = halfH / absY;
          if (absX * ty <= flatHalfW + 0.0001) {
            return { x: cx + ux * ty, y: cy + uy * ty };
          }
        }

        const cornerX = (ux < 0 ? -1 : 1) * flatHalfW;
        const cornerY = (uy < 0 ? -1 : 1) * flatHalfH;
        const projection = ux * cornerX + uy * cornerY;
        const discriminant = Math.max(0, projection * projection - (cornerX * cornerX + cornerY * cornerY - radius * radius));
        const t = projection + Math.sqrt(discriminant);
        return { x: cx + ux * t, y: cy + uy * t };
      }
      const tx = Math.abs(ux) > 0.0001 ? (shapeWidth * 0.5) / Math.abs(ux) : Infinity;
      const ty = Math.abs(uy) > 0.0001 ? (shapeHeight * 0.5) / Math.abs(uy) : Infinity;
      const t = Math.min(tx, ty);
      return { x: cx + ux * t, y: cy + uy * t };
    }

    getShapeGap(a, b) {
      const acx = Number.isFinite(a.cx) ? a.cx : (a.left + a.right) * 0.5;
      const acy = Number.isFinite(a.cy) ? a.cy : (a.top + a.bottom) * 0.5;
      const bcx = Number.isFinite(b.cx) ? b.cx : (b.left + b.right) * 0.5;
      const bcy = Number.isFinite(b.cy) ? b.cy : (b.top + b.bottom) * 0.5;
      const dx = bcx - acx;
      const dy = bcy - acy;
      const distance = Math.hypot(dx, dy);
      if (distance < 0.0001) return 0;
      const ux = dx / distance;
      const uy = dy / distance;
      const edgeA = this.getRectBoundaryPoint(a, ux, uy);
      const edgeB = this.getRectBoundaryPoint(b, -ux, -uy);
      return Math.max(0, (edgeB.x - edgeA.x) * ux + (edgeB.y - edgeA.y) * uy);
    }

    buildFusionGeometry(activeRect, neighborRect, progress, isLocalMaterial, entryProgress) {
      progress = clamp(progress, 0, 1);
      entryProgress = Number.isFinite(entryProgress) ? clamp(entryProgress, 0, 1) : 1;
      const acx = Number.isFinite(activeRect.cx) ? activeRect.cx : (activeRect.left + activeRect.right) * 0.5;
      const acy = Number.isFinite(activeRect.cy) ? activeRect.cy : (activeRect.top + activeRect.bottom) * 0.5;
      const bcx = Number.isFinite(neighborRect.cx) ? neighborRect.cx : (neighborRect.left + neighborRect.right) * 0.5;
      const bcy = Number.isFinite(neighborRect.cy) ? neighborRect.cy : (neighborRect.top + neighborRect.bottom) * 0.5;
      const centerDX = bcx - acx;
      const centerDY = bcy - acy;
      const centerDistance = Math.hypot(centerDX, centerDY);
      if (centerDistance < 0.01) return null;

      const ux = centerDX / centerDistance;
      const uy = centerDY / centerDistance;
      const edgeA = this.getRectBoundaryPoint(activeRect, ux, uy);
      const edgeB = this.getRectBoundaryPoint(neighborRect, -ux, -uy);
      const signedGap = (edgeB.x - edgeA.x) * ux + (edgeB.y - edgeA.y) * uy;
      const minEdge = Math.min(
        activeRect.shapeWidth || activeRect.width,
        activeRect.shapeHeight || activeRect.height,
        neighborRect.shapeWidth || neighborRect.width,
        neighborRect.shapeHeight || neighborRect.height
      );
      // A negative gap means the two real border boxes overlap. Turn that
      // penetration depth into a smooth dissolve phase instead of allowing
      // the bridge endpoints to cross and collapse into a thin/reversed path.
      const overlapDepth = Math.max(0, -signedGap);
      const overlapRatio = clamp(overlapDepth / Math.max(4, minEdge * 0.55), 0, 1);
      const overlapEase = overlapRatio * overlapRatio * (3 - 2 * overlapRatio);
      // Normally only an anti-alias-safe overlap is needed. If the contacting
      // side has a real CSS border, extend the matching source material just
      // beyond that stroke. This locally covers the outline at the mouth and
      // removes the visible seam without treating box-shadow as geometry.
      const baseOverlap = 0.55 + progress * 0.45;
      const borderA = this.getFusionBorderAlong(activeRect, ux, uy);
      const borderB = this.getFusionBorderAlong(neighborRect, -ux, -uy);
      const coverA = borderA > 0.25 ? Math.min(3.2, borderA + 0.45) : 0;
      const coverB = borderB > 0.25 ? Math.min(3.2, borderB + 0.45) : 0;
      // During overlap, extend both mouths through the complete intersection.
      // This produces one continuous sampled-material lens over the two facing
      // borders, which reads as dissolution rather than two stacked buttons.
      const dissolveExtension = overlapDepth > 0
        ? Math.min(overlapDepth + 0.70, Math.max(overlapDepth * 0.55 + 1.2, minEdge * 0.90))
        : 0;
      const overlapA = baseOverlap + coverA + dissolveExtension;
      const overlapB = baseOverlap + coverB + dissolveExtension;
      let start = { x: edgeA.x - ux * overlapA, y: edgeA.y - uy * overlapA };
      const fullEnd = { x: edgeB.x + ux * overlapB, y: edgeB.y + uy * overlapB };
      // Phase 1: a nearly zero-width thread grows out of the dragged control.
      // Ease-out stretching reaches across the gap before the slower width /
      // opacity envelope completes, creating a real filament-pull transition.
      const entryStretchEase = 1 - Math.pow(1 - entryProgress, 3);
      const entryStretch = lerp(0.035, 1, entryStretchEase);
      let end = {
        x: start.x + (fullEnd.x - start.x) * entryStretch,
        y: start.y + (fullEnd.y - start.y) * entryStretch
      };
      let dx = end.x - start.x;
      let dy = end.y - start.y;
      let length = Math.hypot(dx, dy);
      if (length < 1.8) {
        if (entryProgress < 0.999) {
          end = { x: start.x + ux * 1.8, y: start.y + uy * 1.8 };
        } else {
          const extra = (1.8 - length) * 0.5 + 0.45;
          start = { x: start.x - ux * extra, y: start.y - uy * extra };
          end = { x: end.x + ux * extra, y: end.y + uy * extra };
        }
        dx = end.x - start.x;
        dy = end.y - start.y;
        length = Math.hypot(dx, dy);
      }
      if (length < 0.01) return null;

      const sux = dx / length;
      const suy = dy / length;
      const nx = -suy;
      const ny = sux;
      const diagonal = Math.min(Math.abs(ux), Math.abs(uy)) * Math.SQRT2;
      // Use a broad, liquid mouth. Values are half-widths: the finished neck
      // occupies roughly 42-48% of a normal control's short edge, while small
      // tag controls stay slightly slimmer.
      const maxContact = isLocalMaterial
        ? clamp(minEdge * 0.220 * (1 - diagonal * 0.10), 3.2, 10.5)
        : clamp(minEdge * 0.240 * (1 - diagonal * 0.10), 3.6, 12.5);
      // Metaball growth uses the physical gap directly. The previous composite
      // "strength" saturated early on Home's adjacent alarm buttons, making
      // the bridge look equally thick through most of the drag.
      // Smoothstep deliberately keeps the distant bridge filament-thin, then
      // accelerates its swelling through the middle of the approach and eases
      // into the full liquid mouth near contact.
      const mouthGrowth = progress * progress * (3 - 2 * progress);
      const minimumHalf = isLocalMaterial ? 0.45 : 0.60;
      const distanceContactHalf = lerp(minimumHalf, maxContact, mouthGrowth);
      const overlapMaxHalf = isLocalMaterial
        ? clamp(minEdge * 0.40, maxContact, minEdge * 0.46)
        : clamp(minEdge * 0.44, maxContact, minEdge * 0.48);
      const dissolvedContactHalf = lerp(distanceContactHalf, overlapMaxHalf, overlapEase);
      const entryWidthEase = entryProgress * entryProgress * (3 - 2 * entryProgress);
      const contactHalf = lerp(0.10, dissolvedContactHalf, entryWidthEase);
      const normalWaistRatio = lerp(0.55, 0.76, progress);
      const waistHalf = Math.max(0.08, contactHalf * lerp(normalWaistRatio, 0.96, overlapEase));
      const mid = { x: (start.x + end.x) * 0.5, y: (start.y + end.y) * 0.5 };
      const shoulder = length * 0.20;
      const waistControl = length * 0.15;

      const point = (p, normalAmount, axisAmount) => ({
        x: p.x + nx * normalAmount + sux * axisAmount,
        y: p.y + ny * normalAmount + suy * axisAmount
      });
      const topA = point(start, -contactHalf, 0);
      const topB = point(end, -contactHalf, 0);
      const bottomB = point(end, contactHalf, 0);
      const bottomA = point(start, contactHalf, 0);
      const topMid = point(mid, -waistHalf, 0);
      const bottomMid = point(mid, waistHalf, 0);
      const topAControl = point(start, -contactHalf, shoulder);
      const topMidLeft = point(mid, -waistHalf, -waistControl);
      const topMidRight = point(mid, -waistHalf, waistControl);
      const topBControl = point(end, -contactHalf, -shoulder);
      const bottomBControl = point(end, contactHalf, -shoulder);
      const bottomMidRight = point(mid, waistHalf, waistControl);
      const bottomMidLeft = point(mid, waistHalf, -waistControl);
      const bottomAControl = point(start, contactHalf, shoulder);

      const padding = CONFIG.fusionPadding + (1 - progress) * 2;
      const minX = Math.min(start.x, end.x) - contactHalf - padding;
      const minY = Math.min(start.y, end.y) - contactHalf - padding;
      const maxX = Math.max(start.x, end.x) + contactHalf + padding;
      const maxY = Math.max(start.y, end.y) + contactHalf + padding;
      const localPoint = p => ({ x: p.x - minX, y: p.y - minY });
      const local = p => {
        const value = localPoint(p);
        return value.x.toFixed(2) + ' ' + value.y.toFixed(2);
      };
      const d = [
        'M ' + local(topA),
        'C ' + local(topAControl) + ' ' + local(topMidLeft) + ' ' + local(topMid),
        'C ' + local(topMidRight) + ' ' + local(topBControl) + ' ' + local(topB),
        'L ' + local(bottomB),
        'C ' + local(bottomBControl) + ' ' + local(bottomMidRight) + ' ' + local(bottomMid),
        'C ' + local(bottomMidLeft) + ' ' + local(bottomAControl) + ' ' + local(bottomA),
        'Z'
      ].join(' ');
      const rimNegative = point(mid, -contactHalf - 0.4, 0);
      const rimPositive = point(mid, contactHalf + 0.4, 0);
      const rimTop = rimNegative.y <= rimPositive.y ? rimNegative : rimPositive;
      const rimBottom = rimNegative.y <= rimPositive.y ? rimPositive : rimNegative;
      // Different-colour controls mix only around the waist while far apart.
      // As their real borders become very close, the transition expands toward
      // both mouths so the whole neck reads as one dissolved liquid volume.
      const distanceMixHalfSpan = lerp(0.16, 0.48, Math.pow(progress, 0.90));
      const mixHalfSpan = lerp(distanceMixHalfSpan, 0.499, overlapEase);
      return {
        x: minX,
        y: minY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY),
        d,
        canvasPath: {
          topA: localPoint(topA),
          topAControl: localPoint(topAControl),
          topMidLeft: localPoint(topMidLeft),
          topMid: localPoint(topMid),
          topMidRight: localPoint(topMidRight),
          topBControl: localPoint(topBControl),
          topB: localPoint(topB),
          bottomB: localPoint(bottomB),
          bottomBControl: localPoint(bottomBControl),
          bottomMidRight: localPoint(bottomMidRight),
          bottomMid: localPoint(bottomMid),
          bottomMidLeft: localPoint(bottomMidLeft),
          bottomAControl: localPoint(bottomAControl),
          bottomA: localPoint(bottomA)
        },
        sourcePoint: start,
        targetPoint: end,
        gradientStart: { x: start.x - minX, y: start.y - minY },
        gradientEnd: { x: end.x - minX, y: end.y - minY },
        mixStart: 0.5 - mixHalfSpan,
        mixEnd: 0.5 + mixHalfSpan,
        progress,
        signedGap,
        overlapDepth,
        overlapEase,
        isOverlapping: overlapDepth > 0.25,
        entryProgress,
        entryStretch,
        rimStart: localPoint(rimTop),
        rimEnd: localPoint(rimBottom)
      };
    }

    setFusionPaint(bridge, cA, cB, same, geometry) {
      const refs = bridge && bridge.__lqFusion;
      if (!refs) return;
      const alphaGain = refs.tagPair ? CONFIG.fusionTagAlphaGain : 1;
      const paintA = Object.assign({}, cA, { a: clamp(cA.a * alphaGain, 0, 1) });
      const paintB = Object.assign({}, cB, { a: clamp(cB.a * alphaGain, 0, 1) });
      const paintKey = [
        paintA.key, paintA.r, paintA.g, paintA.b, paintA.a.toFixed(3),
        paintB.key, paintB.r, paintB.g, paintB.b, paintB.a.toFixed(3),
        alphaGain.toFixed(3),
        same ? 1 : 0,
        geometry && Number.isFinite(geometry.mixStart) ? geometry.mixStart.toFixed(3) : '0.100',
        geometry && Number.isFinite(geometry.mixEnd) ? geometry.mixEnd.toFixed(3) : '0.900'
      ].join('|');
      if (refs.paintKey === paintKey) return;
      refs.paintKey = paintKey;
      // 每个 stop 的颜色与它的真实 offset 完全一致。两端 0% 与 100% 设为透明，
      // 在 5% / 95% 处即达到实色，仅留极短羽化；桥身中段保持完全凝实。
      const positions = [0, 0.05, 0.18, 0.36, 0.5, 0.64, 0.82, 0.95, 1];
      const colors = positions.map((position, idx) => {
        if (idx === 0) return { r: paintA.r, g: paintA.g, b: paintA.b, a: 0 };
        if (idx === positions.length - 1) return { r: paintB.r, g: paintB.g, b: paintB.b, a: 0 };
        if (idx === 1) return { r: paintA.r, g: paintA.g, b: paintA.b, a: paintA.a };
        if (idx === positions.length - 2) return { r: paintB.r, g: paintB.g, b: paintB.b, a: paintB.a };
        const mixStart = geometry && Number.isFinite(geometry.mixStart) ? geometry.mixStart : 0.10;
        const mixEnd = geometry && Number.isFinite(geometry.mixEnd) ? geometry.mixEnd : 0.90;
        const blendT = clamp((position - mixStart) / Math.max(0.001, mixEnd - mixStart), 0, 1);
        return same ? this.interpolateColor(paintA, paintB, blendT) : this.interpolateFusionColor(paintA, paintB, blendT);
      });
      refs.stops.forEach((stop, index) => {
        const color = colors[index];
        stop.setAttribute('stop-color', 'rgb(' + color.r + ',' + color.g + ',' + color.b + ')');
        const featherAlpha = (index === 0 || index === positions.length - 1) ? 0 : clamp(color.a, 0, 1);
        stop.setAttribute('stop-opacity', featherAlpha.toFixed(3));
      });
    }

    traceFusionCanvasPath(ctx, path) {
      if (!ctx || !path) return false;
      const p = path;
      ctx.beginPath();
      ctx.moveTo(p.topA.x, p.topA.y);
      ctx.bezierCurveTo(
        p.topAControl.x, p.topAControl.y,
        p.topMidLeft.x, p.topMidLeft.y,
        p.topMid.x, p.topMid.y
      );
      ctx.bezierCurveTo(
        p.topMidRight.x, p.topMidRight.y,
        p.topBControl.x, p.topBControl.y,
        p.topB.x, p.topB.y
      );
      ctx.lineTo(p.bottomB.x, p.bottomB.y);
      ctx.bezierCurveTo(
        p.bottomBControl.x, p.bottomBControl.y,
        p.bottomMidRight.x, p.bottomMidRight.y,
        p.bottomMid.x, p.bottomMid.y
      );
      ctx.bezierCurveTo(
        p.bottomMidLeft.x, p.bottomMidLeft.y,
        p.bottomAControl.x, p.bottomAControl.y,
        p.bottomA.x, p.bottomA.y
      );
      ctx.closePath();
      return true;
    }

    paintFusionRaster(canvas, ctx, geometry, samplerA, samplerB, rasterScale, alphaGain) {
      if (!canvas || !ctx || !samplerA || !samplerB) return false;
      const width = Math.max(1, Math.ceil(geometry.width * rasterScale));
      const height = Math.max(1, Math.ceil(geometry.height * rasterScale));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const image = ctx.createImageData(width, height);
      const data = image.data;
      const start = geometry.gradientStart;
      const end = geometry.gradientEnd;
      const axisX = end.x - start.x;
      const axisY = end.y - start.y;
      const axisLengthSq = Math.max(0.0001, axisX * axisX + axisY * axisY);
      const axisLength = Math.sqrt(axisLengthSq);
      const axisUnitX = axisX / axisLength;
      const axisUnitY = axisY / axisLength;
      const insetA = samplerA.materialInset || 0;
      const insetB = samplerB.materialInset || 0;
      let offset = 0;
      for (let py = 0; py < height; py++) {
        const localY = (py + 0.5) / rasterScale;
        for (let px = 0; px < width; px++) {
          const localX = (px + 0.5) / rasterScale;
          const axisT = clamp(((localX - start.x) * axisX + (localY - start.y) * axisY) / axisLengthSq, 0, 1);
          // Keep both mouths materially identical to their source control and
          // put the cross-colour transition only in the liquid waist.
          // Blend through most of the neck. A linear progress in OKLab gives a
          // visibly continuous transition; cubic smoothstep made the centre's
          // rate of colour change too steep and looked like a seam.
          const mixStart = Number.isFinite(geometry.mixStart) ? geometry.mixStart : 0.10;
          const mixEnd = Number.isFinite(geometry.mixEnd) ? geometry.mixEnd : 0.90;
          const mixT = clamp((axisT - mixStart) / Math.max(0.001, mixEnd - mixStart), 0, 1);
          const viewportPoint = { x: geometry.x + localX, y: geometry.y + localY };
          // The literal CSS edge is often transparent because the pill's
          // radial fill fades before its bright border/inset highlights. The
          // border is what dissolves, so extend the nearby interior material
          // into the neck instead of sampling an invisible outer pixel.
          const colorA = samplerA.sample({
            x: viewportPoint.x - axisUnitX * insetA,
            y: viewportPoint.y - axisUnitY * insetA
          });
          const colorB = samplerB.sample({
            x: viewportPoint.x + axisUnitX * insetB,
            y: viewportPoint.y + axisUnitY * insetB
          });
          const sameMaterial = samplerA.key === samplerB.key;
          const color = sameMaterial
            ? this.interpolateColor(colorA, colorB, mixT)
            : this.interpolateFusionColor(colorA, colorB, mixT);
          // Compact tags use a proportional gain rather than an alpha floor:
          // transparent pixels stay transparent and all gradient alpha ratios
          // remain intact, while their 0.15-0.25 glass fills become visible.
          const materialAlphaGain = Number.isFinite(alphaGain) ? Math.max(0, alphaGain) : 1;
          color.a = clamp(color.a * materialAlphaGain, 0, 1);
          const edgeDistance = Math.min(axisT, 1 - axisT) * axisLength;
          const featherT = clamp(edgeDistance / 0.90, 0, 1);
          const featherAlpha = featherT <= 0 ? 0 : featherT >= 1 ? 1 : featherT * featherT * (3 - 2 * featherT);
          color.a *= featherAlpha;
          data[offset++] = color.r;
          data[offset++] = color.g;
          data[offset++] = color.b;
          data[offset++] = Math.round(clamp(color.a, 0, 1) * 255);
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, width, height);
      ctx.putImageData(image, 0, 0);
      return true;
    }

    renderFusionMaterial(bridge, geometry, samplerA, samplerB, activeRect, neighborRect, highlightSamplerA, highlightSamplerB) {
      const refs = bridge && bridge.__lqFusion;
      if (!refs || !refs.materialPair || !refs.rasterContext || !samplerA || !samplerB || !geometry.canvasPath) return false;
      try {
        const cssWidth = Math.max(1, geometry.width);
        const cssHeight = Math.max(1, geometry.height);
        refs.rasterObject.setAttribute('width', cssWidth.toFixed(2));
        refs.rasterObject.setAttribute('height', cssHeight.toFixed(2));
        refs.rasterClipBody.setAttribute('d', geometry.d);
        refs.rasterObject.style.display = '';
        refs.body.style.display = 'none';

        // The SVG clip path follows the 60fps geometry. The small material
        // texture only needs a 20-25fps refresh and is stretched by sub-pixels
        // between refreshes, greatly reducing per-frame CPU/GC pressure.
        const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        const sizeChanged = Math.abs(cssWidth - refs.lastRasterWidth) > 1.25 || Math.abs(cssHeight - refs.lastRasterHeight) > 1.25;
        if (!refs.rasterDirty && !sizeChanged && now - refs.lastRasterAt < 44) return true;
        if (samplerA.setRect) samplerA.setRect(activeRect);
        if (samplerB.setRect) samplerB.setRect(neighborRect);
        const area = cssWidth * cssHeight;
        const rasterScale = clamp(Math.sqrt(CONFIG.fusionRasterPixelBudget / Math.max(1, area)), 0.55, 1);
        const canvas = refs.raster;
        const ctx = refs.rasterContext;
        // Base and highlight channels both preserve the source alpha. This is
        // the central invariant that prevents bridge colour drift.
        const baseAlphaGain = refs.tagPair ? CONFIG.fusionTagAlphaGain : 1;
        if (!this.paintFusionRaster(canvas, ctx, geometry, samplerA, samplerB, rasterScale, baseAlphaGain)) return false;

        const hasHighlight = Boolean(
          refs.rasterHighlightContext && highlightSamplerA && highlightSamplerB &&
          (highlightSamplerA.hasVisibleMaterial || highlightSamplerB.hasVisibleMaterial)
        );
        if (hasHighlight) {
          if (highlightSamplerA.setRect) highlightSamplerA.setRect(activeRect);
          if (highlightSamplerB.setRect) highlightSamplerB.setRect(neighborRect);
          this.paintFusionRaster(
            refs.rasterHighlight,
            refs.rasterHighlightContext,
            geometry,
            highlightSamplerA,
            highlightSamplerB,
            rasterScale,
            1
          );
          const blendMode = highlightSamplerA.mixBlendMode === highlightSamplerB.mixBlendMode
            ? highlightSamplerA.mixBlendMode
            : 'overlay';
          refs.rasterHighlight.style.display = '';
          refs.rasterHighlight.style.mixBlendMode = blendMode && blendMode !== 'normal' ? blendMode : 'overlay';
        } else {
          refs.rasterHighlight.style.display = 'none';
        }
        refs.lastRasterAt = now;
        refs.lastRasterWidth = cssWidth;
        refs.lastRasterHeight = cssHeight;
        refs.rasterDirty = false;

        // The enclosing SVG foreignObject is already clipped to the liquid
        // path. Preserve identical filters exactly; selected/unselected pairs
        // (for example TaskFlow 12px vs 20px blur) use their midpoint rather
        // than silently dropping backdrop-filter and changing the colour.
        const bridgeFilter = this.blendFusionBackdropFilters(
          samplerA.backdropFilter,
          samplerB.backdropFilter
        );
        refs.rasterStack.style.backdropFilter = bridgeFilter;
        refs.rasterStack.style.webkitBackdropFilter = bridgeFilter;
        canvas.style.backdropFilter = 'none';
        canvas.style.webkitBackdropFilter = 'none';
        return true;
      } catch (_) {
        refs.rasterDirty = true;
        try { refs.rasterObject.style.display = 'none'; } catch (_) {}
        try { refs.body.style.display = ''; } catch (_) {}
        return false;
      }
    }

    updateFusionBridges(activeState) {
      if (activeState && activeState.reduceMotion) {
        this.clearAllFusionBridges();
        return;
      }
      if (!activeState || !activeState.el || !activeState.isPressed) {
        // 非拖拽状态下，若已有桥接则淡出
        if (this.fusionBridges.size > 0) {
          // 延迟一帧后若仍无拖拽则清理（避免回弹动画期间闪烁）
          const stillPressed = this.activeState && this.activeState.isPressed;
          if (!stillPressed) this.clearAllFusionBridges();
        }
        return;
      }
      if (activeState.fusionDisabled) {
        this.clearAllFusionBridges();
        return;
      }
      const activeEl = activeState.el;
      const predictedActiveRect = this.getAnimatedFusionRect(activeState);
      const activeRect = this.getRenderedActiveFusionRect(activeState, predictedActiveRect);
      if (!activeRect || activeRect.width === 0 || activeRect.height === 0) {
        this.clearAllFusionBridges();
        return;
      }
      const threshold = CONFIG.fusionThreshold;
      // 用按钮真正显示出来的位移，而不是可被拖到几百像素外的原始指针距离。
      // 这能确保液桥只在控件确实向邻居靠近时出现。
      const moveDX = activeState.x || 0;
      const moveDY = activeState.y || 0;
      const moveLength = Math.hypot(moveDX, moveDY);
      if (moveLength < 0.35) {
        this.clearAllFusionBridges();
        return;
      }
      const candidates = activeState.fusionCandidates || [];
      const toCreate = [];
      const frameNow = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];
        const cand = candidate.el;
        if (!cand || cand === activeEl) continue;
        if (!cand.isConnected) continue;
        if (cand.disabled || cand.classList.contains('disabled')) continue;
        let cr = candidate.rect;
        if (!cr || cr.width === 0 || cr.height === 0) continue;
        const expandedLeft = activeRect.left - threshold;
        const expandedRight = activeRect.right + threshold;
        const expandedTop = activeRect.top - threshold;
        const expandedBottom = activeRect.bottom + threshold;
        if (cr.right < expandedLeft || cr.left > expandedRight || cr.bottom < expandedTop || cr.top > expandedBottom) continue;

        // 邻居可能在指针靠近后进入 :hover / selected transform。旧版一直沿用
        // pointerdown 时的矩形，tag 会抬高/缩放 1~2px，导致右下角的目标点漂移。
        // 只对已进入阈值包围盒的候选低频刷新，兼顾精度和性能。
        if (frameNow - (candidate.rectSampleAt || 0) >= 96) {
          try {
            const measured = this.measureFusionBorderBox(cand, cand.getBoundingClientRect());
            if (measured && measured.width > 0 && measured.height > 0) {
              const baseCandidateRect = candidate.baseRect || candidate.rect;
              const radiusScale = baseCandidateRect
                ? Math.min(measured.width / Math.max(1, baseCandidateRect.width), measured.height / Math.max(1, baseCandidateRect.height))
                : 1;
              const radius = baseCandidateRect
                ? (baseCandidateRect.radius || 0) * radiusScale
                : this.getElementFusionRadius(cand, measured);
              cr = this.createFusionRect(measured, radius, this.getElementFusionBorderWidths(cand));
              candidate.rect = cr;
              candidate.rectSampleAt = frameNow;
            }
          } catch (_) {}
        }

        const gap = this.getShapeGap(activeRect, cr);
        if (gap > threshold) continue;

        const baseGap = this.getShapeGap(activeState.rect, candidate.baseRect || cr);
        // 必须真的比按下时更接近。斜向把按钮拉离邻居时，即使仍在液桥
        // 阈值内也不会凭空生成一条桥。
        if (gap >= baseGap - 0.12) continue;

        const toward = this.getRectSeparationVector(activeState.rect, cr);
        const towardLength = Math.hypot(toward.x, toward.y) || 1;
        const alignment = (moveDX * toward.x + moveDY * toward.y) / (moveLength * towardLength);
        const minAlignment = Math.cos(58 * Math.PI / 180);
        if (alignment <= minAlignment) continue;

        const proximity = clamp(1 - gap / threshold, 0, 1);
        const distanceEase = proximity * proximity * (3 - 2 * proximity);
        const alignmentEase = clamp((alignment - minAlignment) / (1 - minAlignment), 0, 1);
        const approachEase = clamp((baseGap - gap) / Math.max(2, Math.min(baseGap, 10)), 0, 1);
        const strength = distanceEase * lerp(0.72, 1, alignmentEase) * lerp(0.72, 1, approachEase);
        if (strength <= 0.00035) continue;
        const progress = proximity;
        // Keep the far end faint but genuinely visible. The old 0.08 factor,
        // followed by another >1 power, effectively hid most of this range.
        const baseAppearance = Math.pow(progress, 0.92)
          * lerp(0.56, 1, approachEase)
          * lerp(0.94, 1, alignmentEase);
        const activeCenterX = Number.isFinite(activeRect.cx) ? activeRect.cx : (activeRect.left + activeRect.right) * 0.5;
        const activeCenterY = Number.isFinite(activeRect.cy) ? activeRect.cy : (activeRect.top + activeRect.bottom) * 0.5;
        const candidateCenterX = Number.isFinite(cr.cx) ? cr.cx : (cr.left + cr.right) * 0.5;
        const candidateCenterY = Number.isFinite(cr.cy) ? cr.cy : (cr.top + cr.bottom) * 0.5;
        const centerDistance = Math.hypot(
          candidateCenterX - activeCenterX,
          candidateCenterY - activeCenterY
        );
        toCreate.push({ candidate, cand, gap, strength, progress, baseAppearance, key: candidate.key, rect: cr, centerDistance });
      }
      // 只显示最靠近的少量液桥，既避免视觉噪点，也限制每帧 SVG 更新量。
      toCreate.sort((a, b) => (b.strength - a.strength) || (a.gap - b.gap) || (a.centerDistance - b.centerDistance));
      const limited = toCreate.slice(0, CONFIG.fusionMaxBridges);
      // Start the entry clock only for a bridge that is actually selected for
      // painting. Otherwise a hidden runner-up could finish its animation and
      // later replace the primary bridge at full length in a single frame.
      limited.forEach(item => {
        const candidate = item.candidate;
        const continuousEntry = Number.isFinite(candidate.entryLastEligibleAt)
          && frameNow - candidate.entryLastEligibleAt < 80;
        if (!continuousEntry || !Number.isFinite(candidate.entryStartedAt)) {
          candidate.entryStartedAt = frameNow;
        }
        candidate.entryLastEligibleAt = frameNow;
        item.entryProgress = clamp(
          (frameNow - candidate.entryStartedAt) / CONFIG.fusionEntryDuration,
          0,
          1
        );
        const entryReveal = item.entryProgress * item.entryProgress * (3 - 2 * item.entryProgress);
        item.appearance = item.baseAppearance * entryReveal;
        item.geometry = this.buildFusionGeometry(
          activeRect,
          item.rect,
          item.progress,
          candidate.isLocalPair,
          item.entryProgress
        );
      });
      const limitedSet = new Set(limited.map(it => it.cand));
      this.fusionBridges.forEach((bridge, neighbor) => {
        if (!limitedSet.has(neighbor)) {
          this.removeFusionBridge(neighbor);
        }
      });
      limited.forEach(item => {
        if (!item.geometry) return;
        const bridge = this.ensureFusionBridge(item.cand, activeEl);
        const refs = bridge.__lqFusion;
        const g = item.geometry;
        const now = frameNow;
        const overlapBucket = Math.round((g.overlapEase || 0) * 12);
        if (refs.overlapBucket !== overlapBucket) {
          refs.overlapBucket = overlapBucket;
          refs.rasterDirty = true;
          refs.paintKey = '';
        }
        bridge.classList.toggle('__lq-fusion-overlap', g.isOverlapping);
        const activeStateKey = this.getFusionVisualStateKey(activeEl);
        const neighborStateKey = this.getFusionVisualStateKey(item.cand);
        const stateChanged = refs.activeStateKey !== activeStateKey || refs.neighborStateKey !== neighborStateKey;
        if (stateChanged) {
          refs.activeStateKey = activeStateKey;
          refs.neighborStateKey = neighborStateKey;
          refs.lastPaintAt = 0;
          refs.lastActiveSampler = null;
          refs.lastNeighborSampler = null;
          refs.lastActiveHighlightSampler = null;
          refs.lastNeighborHighlightSampler = null;
          refs.rasterDirty = true;
          refs.transitionUntil = now + 360;
        }
        // Cover CSS state transitions at 64ms. Local material settles to 96ms
        // so pointer/specular position stays responsive without querying style
        // on every animation frame.
        const paintInterval = now < refs.transitionUntil ? 64 : (refs.materialPair ? 96 : 120);
        const paintMissing = refs.materialPair
          ? (!refs.lastActiveSampler || !refs.lastNeighborSampler)
          : (!refs.lastActivePaint || !refs.lastNeighborPaint);
        if (paintMissing || now - refs.lastPaintAt >= paintInterval) {
          if (refs.materialPair) {
            refs.lastActiveSampler = this.createFusionMaterialSampler(activeEl, activeRect);
            refs.lastNeighborSampler = this.createFusionMaterialSampler(item.cand, item.rect);
            refs.lastActiveHighlightSampler = this.createFusionMaterialSampler(activeEl, activeRect, '::after');
            refs.lastNeighborHighlightSampler = this.createFusionMaterialSampler(item.cand, item.rect, '::after');
            refs.rasterDirty = true;
            refs.lastActivePaint = refs.lastActiveSampler
              ? Object.assign({ key: refs.lastActiveSampler.key }, refs.lastActiveSampler.sample(g.sourcePoint))
              : this.getFusionSurfaceColor(activeEl, g.sourcePoint, activeRect);
            refs.lastNeighborPaint = refs.lastNeighborSampler
              ? Object.assign({ key: refs.lastNeighborSampler.key }, refs.lastNeighborSampler.sample(g.targetPoint))
              : this.getFusionSurfaceColor(item.cand, g.targetPoint, item.rect);
          } else {
            refs.lastActiveSampler = null;
            refs.lastNeighborSampler = null;
            refs.lastActiveHighlightSampler = null;
            refs.lastNeighborHighlightSampler = null;
            refs.lastActivePaint = this.getFusionColor(activeEl, g.sourcePoint, activeRect);
            refs.lastNeighborPaint = this.getFusionColor(item.cand, g.targetPoint, item.rect);
          }
          refs.lastPaintAt = now;
        }
        const activeColor = refs.lastActivePaint;
        const neighborColor = refs.lastNeighborPaint;
        const same = activeColor.key === neighborColor.key;
        bridge.setAttribute('viewBox', '0 0 ' + g.width.toFixed(2) + ' ' + g.height.toFixed(2));
        bridge.setAttribute('width', g.width.toFixed(2));
        bridge.setAttribute('height', g.height.toFixed(2));
        bridge.style.width = g.width.toFixed(2) + 'px';
        bridge.style.height = g.height.toFixed(2) + 'px';
        let paintX = g.x;
        let paintY = g.y;
        if (refs.isLocal && refs.host) {
          const hostRect = refs.host.getBoundingClientRect();
          paintX -= hostRect.left + (refs.host.clientLeft || 0) - (refs.host.scrollLeft || 0);
          paintY -= hostRect.top + (refs.host.clientTop || 0) - (refs.host.scrollTop || 0);
        }
        bridge.style.setProperty('--lq-fusion-x', paintX.toFixed(2) + 'px');
        bridge.style.setProperty('--lq-fusion-y', paintY.toFixed(2) + 'px');
        // Fade and thickness share the same proximity signal. Far away the
        // filament is faint; it becomes steadily more opaque as its mouth
        // thickens, reaching full material opacity only near contact.
        const revealT = clamp(item.appearance, 0, 1);
        const opacity = refs.tagPair
          ? Math.pow(revealT, 0.46)
          : Math.pow(revealT, 0.72);
        bridge.style.setProperty('--lq-fusion-opacity', opacity.toFixed(3));
        refs.lastFusionOpacity = opacity;
        refs.lastFusionFrame = {
          activeRect,
          neighborRect: item.rect,
          progress: item.progress,
          isLocalPair: item.candidate.isLocalPair,
          entryProgress: item.entryProgress
        };
        refs.body.setAttribute('d', g.d);
        refs.rim.setAttribute('d', g.d);
        refs.gradient.setAttribute('x1', g.gradientStart.x.toFixed(2));
        refs.gradient.setAttribute('y1', g.gradientStart.y.toFixed(2));
        refs.gradient.setAttribute('x2', g.gradientEnd.x.toFixed(2));
        refs.gradient.setAttribute('y2', g.gradientEnd.y.toFixed(2));
        refs.rimGradient.setAttribute('x1', g.rimStart.x.toFixed(2));
        refs.rimGradient.setAttribute('y1', g.rimStart.y.toFixed(2));
        refs.rimGradient.setAttribute('x2', g.rimEnd.x.toFixed(2));
        refs.rimGradient.setAttribute('y2', g.rimEnd.y.toFixed(2));
        refs.rimMaskGradient.setAttribute('x1', g.gradientStart.x.toFixed(2));
        refs.rimMaskGradient.setAttribute('y1', g.gradientStart.y.toFixed(2));
        refs.rimMaskGradient.setAttribute('x2', g.gradientEnd.x.toFixed(2));
        refs.rimMaskGradient.setAttribute('y2', g.gradientEnd.y.toFixed(2));
        refs.rimMaskRect.setAttribute('width', g.width.toFixed(2));
        refs.rimMaskRect.setAttribute('height', g.height.toFixed(2));
        let materialRendered = false;
        if (refs.materialPair && refs.lastActiveSampler && refs.lastNeighborSampler) {
          materialRendered = this.renderFusionMaterial(
            bridge,
            g,
            refs.lastActiveSampler,
            refs.lastNeighborSampler,
            activeRect,
            item.rect,
            refs.lastActiveHighlightSampler,
            refs.lastNeighborHighlightSampler
          );
        }
        if (!materialRendered) {
          refs.rasterObject.style.display = 'none';
          refs.body.style.display = '';
          this.setFusionPaint(bridge, activeColor, neighborColor, same, g);
        }
        bridge.classList.toggle('__lq-fusion-same', same);
        bridge.classList.add('__lq-fusion-visible');
      });
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
      const subjectSpan = target.closest(TAG_SURFACE_SELECTOR);
      if (subjectSpan) {
        const parentLabel = subjectSpan.closest('label');
        if (parentLabel && (parentLabel.hasAttribute('disabled') || parentLabel.classList.contains('disabled') || parentLabel.classList.contains('no-liquid'))) return null;
        return subjectSpan;
      }
      const subjectLabel = target.closest(TAG_ITEM_SELECTOR);
      if (subjectLabel) {
        if (subjectLabel.hasAttribute('disabled') || subjectLabel.classList.contains('disabled') || subjectLabel.classList.contains('no-liquid')) return null;
        const span = subjectLabel.querySelector(TAG_SURFACE_SELECTOR + ', span');
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
      const isTag = this.isFusionTagSurface(el);
      const measuredRect = this.measureFusionBorderBox(el, el.getBoundingClientRect());
      const rect = this.createFusionRect(
        measuredRect,
        this.getElementFusionRadius(el, measuredRect),
        this.getElementFusionBorderWidths(el)
      );
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
        if (isAlreadyAnimating) {
          const currentScaleX = Math.max(0.01, (state.scale || 1) * (state.sx || 1));
          const currentScaleY = Math.max(0.01, (state.scale || 1) * (state.sy || 1));
          const baseWidth = rect.width / currentScaleX;
          const baseHeight = rect.height / currentScaleY;
          const baseCenterX = (rect.left + rect.right) * 0.5 - (state.x || 0);
          const baseCenterY = (rect.top + rect.bottom) * 0.5 - (state.y || 0);
          state.rect = {
            left: baseCenterX - baseWidth * 0.5,
            right: baseCenterX + baseWidth * 0.5,
            top: baseCenterY - baseHeight * 0.5,
            bottom: baseCenterY + baseHeight * 0.5,
            width: baseWidth,
            height: baseHeight,
            borderWidths: rect.borderWidths || { top: 0, right: 0, bottom: 0, left: 0 },
            radius: clamp((rect.radius || 0) / Math.max(0.01, Math.min(currentScaleX, currentScaleY)), 0, Math.min(baseWidth, baseHeight) * 0.5)
          };
        } else {
          state.rect = rect;
        }
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
      state.reduceMotion = false;
      state.fusionDisabled = false;
      state.fusionCandidates = this.collectFusionCandidates(el, rect, profile);
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
          state.fusionDisabled = true;
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

        state.fusionDisabled = false;

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
      // 拖拽结束，液态溶解桥淡出
      try { this.clearAllFusionBridges(); } catch (_) {}
    }

    resetElement(el) {
      if (!el) return;
      const elements = [el, ...(el.querySelectorAll ? el.querySelectorAll(DEFAULT_SELECTOR) : [])];
      elements.forEach(target => {
        if (!target) return;
        const state = target.__alphaLiquidState;
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
          delete target.__alphaLiquidState;
        }
        this.animatingElements.forEach((s) => {
          if (s.el === target) {
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
        if (this.activeElement === target) {
          this.activeElement = null;
          this.activeState = null;
          this.isDragging = false;
        }
        if (target.style) {
          target.__alphaLqBorderSynced = false;
          target.style.removeProperty('--lq-tx');
          target.style.removeProperty('--lq-ty');
          target.style.removeProperty('--lq-scale');
          target.style.removeProperty('--lq-sx');
          target.style.removeProperty('--lq-sy');
          target.style.removeProperty('--lq-rot');
          target.style.removeProperty('--lq-lo');
          target.style.removeProperty('--lq-border-opacity');
          target.style.removeProperty('--lq-hover-sx');
          target.style.removeProperty('--lq-hover-sy');
          target.style.removeProperty('--lq-hover-ty');
          target.style.removeProperty('--lq-hover-scale');
          target.style.removeProperty('--lq-state-ty');
          target.style.removeProperty('--lq-state-scale');
          target.style.removeProperty('--lq-lx');
          target.style.removeProperty('--lq-ly');
        }
      });
      try {
        if (this.fusionBridges && this.fusionBridges.has(el)) this.removeFusionBridge(el);
        if (this.activeElement === el || (this.activeState && this.activeState.el === el)) {
          this.clearAllFusionBridges();
        }
      } catch (_) {}
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
      try { this.clearAllFusionBridges(); } catch (_) {}

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

          // 融合几何只在动画帧更新一次，避免 pointermove 与 RAF 重复查询和写样式。
          if (state.isPressed && state === this.activeState) {
            try { this.updateFusionBridges(state); } catch (_) {}
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
