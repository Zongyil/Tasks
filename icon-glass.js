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

  // 物理配置：针对小图标、圆形头像与导航卡片特别调优的弹簧阻尼与聚光模型（略微强化流体感）
  const CONFIG = {
    // The bridge starts before the surfaces touch.  A larger threshold is
    // useful for the card-sized targets handled by this engine, while the
    // reveal animation keeps the first frame from flashing into view.
    fusionThreshold: 36,
    fusionOverlap: 1.25,
    fusionPadding: 14,
    fusionMaxBridges: 2,
    fusionCandidateLimit: 18,
    fusionEnterMs: 220,
    fusionExitMs: 190,
    fusionColorCacheMs: 500,
    avatar: {
      maxOffsetX: 8.5,
      maxOffsetY: 8.5,
      moveRatio: 0.22,
      stretchFactor: 0.032,
      maxRot: 1.45,
      pressScale: 0.965,
      hoverScale: 1.03,
      stiffness: 480,
      damping: 28,
      mass: 1.0,
      specularRadius: 90,
      specularIntensity: 0.60
    },
    navCard: {
      maxOffsetX: 9.5,
      maxOffsetY: 8.5,
      moveRatio: 0.19,
      stretchFactor: 0.032,
      maxRot: 1.45,
      pressScale: 0.955,
      hoverScale: 1.03,
      stiffness: 440,
      damping: 26,
      mass: 1.0,
      specularRadius: 140,
      specularIntensity: 0.80
    },
    icon: {
      maxOffsetX: 14,
      maxOffsetY: 12,
      moveRatio: 0.54,
      stretchFactor: 0.145,
      maxRot: 4.0,
      pressScale: 0.90,
      hoverScale: 1.12,
      stiffness: 380,
      damping: 22,
      mass: 0.9,
      specularRadius: 36,
      specularIntensity: 0.75
    }
  };

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function lerp(a, b, t) {
    return a + (b - a) * clamp(t, 0, 1);
  }

  class IconGlassManager {
    constructor(targetDoc) {
      this.doc = targetDoc || (typeof document !== 'undefined' ? document : null);
      if (!this.doc) return;

      this.elements = new WeakMap(); // el -> state; removed cards remain collectible
      this.activeStates = new Set();
      this.rafId = null;
      this.fusionBridges = new Map(); // neighborEl -> bridgeEl
      this.fusionSequence = 0;
      this.pressedState = null;
      this.fusionColorCache = new WeakMap();
      this.fusionBorderCache = new WeakMap();
      this.fusionElementsCache = null;
      this.fusionElementsDirty = true;

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
      this.observeFusionTargets();
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
      this.injectIconFusionStyles();
    }

    injectIconFusionStyles() {
      if (this.doc.getElementById('__alphaIconFusionStyle')) return;
      const s = this.doc.createElement('style');
      s.id = '__alphaIconFusionStyle';
      s.textContent = `
        .__ig-fusion-bridge {
          position: fixed !important;
          left: 0 !important;
          top: 0 !important;
          pointer-events: none !important;
          z-index: 10049 !important;
          overflow: visible !important;
          opacity: var(--ig-fusion-opacity, 0) !important;
          transform: translate3d(var(--ig-fusion-x, -9999px), var(--ig-fusion-y, -9999px), 0) !important;
          transform-origin: 0 0 !important;
          will-change: transform, opacity !important;
          contain: layout style paint !important;
        }
        .__ig-fusion-body,
        .__ig-fusion-glow {
          vector-effect: non-scaling-stroke;
          shape-rendering: geometricPrecision;
        }
        .__ig-fusion-glow {
          opacity: var(--ig-fusion-glow-opacity, 0.34);
          filter: blur(var(--ig-fusion-glow-blur, 2px));
        }
        .__ig-fusion-bridge.__ig-fusion-same .__ig-fusion-glow {
          opacity: var(--ig-fusion-glow-opacity, 0.18);
          filter: blur(var(--ig-fusion-glow-blur, 3px));
        }
        .__ig-fusion-shine {
          fill: none;
          stroke: rgba(255,255,255,0.18);
          stroke-width: 0.72px;
          stroke-linecap: round;
          opacity: var(--ig-fusion-shine-opacity, 0.16);
          mix-blend-mode: screen;
        }
        .alpha-reduce-motion .__ig-fusion-bridge {
          display: none !important;
        }
      `;
      (this.doc.head || this.doc.documentElement).appendChild(s);
    }

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
      let m = str.match(/^hsla?\(\s*([\d.+-]+)(?:\s*,\s*|\s+)([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+)\s*)?\)$/i);
      if (m) {
        const h = parseFloat(m[1]); const s = parseFloat(m[2]); const l = parseFloat(m[3]); const a = m[4]===undefined?1:parseFloat(m[4]);
        const rgb = this.hslToRgb(h,s,l); return { r: rgb.r, g: rgb.g, b: rgb.b, a };
      }
      m = str.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i);
      if (m) { return { r: Math.round(parseFloat(m[1])), g: Math.round(parseFloat(m[2])), b: Math.round(parseFloat(m[3])), a: m[4]===undefined?1:parseFloat(m[4]) }; }
      return null;
    }

    observeFusionTargets() {
      const win = this.doc && this.doc.defaultView;
      const Observer = win && win.MutationObserver;
      if (!Observer || !this.doc.documentElement) return;
      try {
        this.fusionObserver = new Observer(records => {
          // Only DOM membership affects the target list.  Attribute/style
          // changes are intentionally not observed: the engine itself writes
          // transform variables every frame and must not invalidate its cache.
          for (let i = 0; i < records.length; i++) {
            if (records[i].type === 'childList') {
              this.fusionElementsDirty = true;
              break;
            }
          }
        });
        this.fusionObserver.observe(this.doc.documentElement, { childList: true, subtree: true });
      } catch (_) {}
    }

    getFusionElements() {
      if (!this.fusionElementsDirty && this.fusionElementsCache) return this.fusionElementsCache;
      let list = [];
      try { list = Array.from(this.doc.querySelectorAll(ICON_SELECTOR)); } catch (_) {}
      this.fusionElementsCache = list;
      this.fusionElementsDirty = false;
      return list;
    }

    smoothstep(t) {
      t = clamp(t, 0, 1);
      return t * t * (3 - 2 * t);
    }

    rgbToOklab(c) {
      const linear = value => {
        value /= 255;
        return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
      };
      const r = linear(c.r), g = linear(c.g), b = linear(c.b);
      const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
      const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
      const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
      return {
        L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
      };
    }

    oklabToRgb(c) {
      const l = Math.pow(c.L + 0.3963377774 * c.a + 0.2158037573 * c.b, 3);
      const m = Math.pow(c.L - 0.1055613458 * c.a - 0.0638541728 * c.b, 3);
      const s = Math.pow(c.L - 0.0894841775 * c.a - 1.2914855480 * c.b, 3);
      const encode = value => {
        value = value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(Math.max(0, value), 1 / 2.4) - 0.055;
        return Math.round(clamp(value, 0, 1) * 255);
      };
      return {
        r: encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        g: encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        b: encode(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
      };
    }

    interpolateColor(cA, cB, t) {
      const a = this.rgbToOklab(cA);
      const b = this.rgbToOklab(cB);
      const rgb = this.oklabToRgb({
        L: lerp(a.L, b.L, t),
        a: lerp(a.a, b.a, t),
        b: lerp(a.b, b.b, t)
      });
      rgb.a = lerp(cA.a, cB.a, t);
      return rgb;
    }

    // ===== 图标融合逻辑（与 liquid-glass 同构，SVG 液桥）=====
    getIconFusionColor(el) {
      if (!el || !el.matches) return { r: 255, g: 255, b: 255, a: 0.26, key: 'secondary' };
      const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const cached = this.fusionColorCache.get(el);
      if (cached && now - cached.time < CONFIG.fusionColorCacheMs) return cached.color;
      let result = null;
      try {
        // 优先从 backgroundImage 提取（如图标也可能有渐变）
        try {
          const win = el.ownerDocument ? el.ownerDocument.defaultView : null;
          if (win && win.getComputedStyle) {
            const cs = win.getComputedStyle(el);
            const bgImage = cs.backgroundImage;
            if (bgImage && bgImage !== 'none' && bgImage.indexOf('gradient') !== -1) {
              const colorRegex = /(hsla?\([^)]+\))|(rgba?\([^)]+\))/gi;
              const matches = bgImage.match(colorRegex);
              if (matches && matches.length) {
                for (const mm of matches) {
                  const c = this.parseColorString(mm);
                  if (c && c.a > 0.02) {
                    result = { r: c.r, g: c.g, b: c.b, a: clamp(c.a, 0, 1), key: 'custom-' + c.r + '-' + c.g + '-' + c.b };
                    break;
                  }
                }
              }
            }
            if (result) {
              this.fusionColorCache.set(el, { time: now, color: result });
              return result;
            }
            const bg = cs.backgroundColor;
            if (bg && bg.indexOf('rgb') === 0) {
              const m = bg.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/);
              if (m) {
                const rr = Math.round(parseFloat(m[1]));
                const gg = Math.round(parseFloat(m[2]));
                const bb = Math.round(parseFloat(m[3]));
                const aa = m[4] === undefined ? 1 : parseFloat(m[4]);
                if (aa > 0.02) {
                  result = { r: rr, g: gg, b: bb, a: clamp(aa, 0, 1), key: 'custom-' + rr + '-' + gg + '-' + bb };
                }
              }
            }
          }
        } catch (_) {}
      } catch (_) {}
      if (!result && el.classList.contains('avatar-wrap')) result = { r: 255, g: 255, b: 255, a: 0.32, key: 'secondary' };
      if (!result && el.classList.contains('nav-card')) result = { r: 255, g: 255, b: 255, a: 0.28, key: 'secondary' };
      if (!result) result = { r: 255, g: 255, b: 255, a: 0.26, key: 'secondary' };
      this.fusionColorCache.set(el, { time: now, color: result });
      return result;
    }

    ensureIconFusionBridge(neighborEl) {
      let b = this.fusionBridges.get(neighborEl);
      if (b && b.isConnected) return b;
      const svgNS = 'http://www.w3.org/2000/svg';
      const gradientId = '__ig-fusion-gradient-' + (++this.fusionSequence);
      b = this.doc.createElementNS(svgNS, 'svg');
      b.setAttribute('class', '__ig-fusion-bridge');
      b.setAttribute('aria-hidden', 'true');
      b.setAttribute('focusable', 'false');

      const defs = this.doc.createElementNS(svgNS, 'defs');
      const gradient = this.doc.createElementNS(svgNS, 'linearGradient');
      gradient.id = gradientId;
      gradient.setAttribute('gradientUnits', 'userSpaceOnUse');
      const offsets = ['0%', '7%', '32%', '50%', '68%', '93%', '100%'];
      const stops = offsets.map(offset => {
        const stop = this.doc.createElementNS(svgNS, 'stop');
        stop.setAttribute('offset', offset);
        gradient.appendChild(stop);
        return stop;
      });
      defs.appendChild(gradient);

      const glow = this.doc.createElementNS(svgNS, 'path');
      glow.setAttribute('class', '__ig-fusion-glow');
      glow.setAttribute('fill', 'url(#' + gradientId + ')');
      const body = this.doc.createElementNS(svgNS, 'path');
      body.setAttribute('class', '__ig-fusion-body');
      body.setAttribute('fill', 'url(#' + gradientId + ')');
      const shine = this.doc.createElementNS(svgNS, 'path');
      shine.setAttribute('class', '__ig-fusion-shine');
      b.appendChild(defs);
      b.appendChild(glow);
      b.appendChild(body);
      b.appendChild(shine);
      b.__igFusion = {
        gradient, stops, glow, body, shine,
        paintKey: '',
        progress: 0,
        target: 0,
        lastTime: 0,
        descriptor: null,
        lastWrites: Object.create(null)
      };
      b.style.setProperty('--ig-fusion-opacity', '0');
      (this.doc.body || this.doc.documentElement).appendChild(b);
      this.fusionBridges.set(neighborEl, b);
      return b;
    }

    hideIconFusionBridge(bridge) {
      if (!bridge) return;
      if (bridge.__igFusion) bridge.__igFusion.target = 0;
    }

    removeIconFusionBridge(neighborEl) {
      const b = this.fusionBridges.get(neighborEl);
      if (!b) return;
      try {
        if (b.parentNode) b.parentNode.removeChild(b);
      } catch (_) {}
      this.fusionBridges.delete(neighborEl);
    }

    clearAllIconFusionBridges() {
      if (!this.fusionBridges || this.fusionBridges.size === 0) return;
      this.fusionBridges.forEach(bridge => this.hideIconFusionBridge(bridge));
      this.startLoop();
    }

    collectIconFusionCandidates(activeEl, activeRect, profile) {
      const travel = profile ? Math.hypot(profile.maxOffsetX || 0, profile.maxOffsetY || 0) : 16;
      const reach = CONFIG.fusionThreshold + CONFIG.fusionOverlap + travel + 8;
      const result = [];
      const elements = this.getFusionElements();
      for (let index = 0; index < elements.length; index++) {
        const cand = elements[index];
        if (!cand || cand === activeEl || !cand.isConnected) continue;
        if (cand.matches && cand.matches(EXCLUDE_SELECTOR)) continue;
        if (cand.contains(activeEl) || activeEl.contains(cand)) continue;
        let rect;
        try { rect = cand.getBoundingClientRect(); } catch (_) { continue; }
        if (!rect || rect.width <= 0 || rect.height <= 0) continue;
        // getBoundingClientRect is the actual border box; box-shadow does not
        // participate in it, so no arbitrary inset is needed here.
        const deflated = rect;
        if (
          deflated.right < activeRect.left - reach ||
          deflated.left > activeRect.right + reach ||
          deflated.bottom < activeRect.top - reach ||
          deflated.top > activeRect.bottom + reach
        ) continue;
        const dcx = (deflated.left + deflated.right - activeRect.left - activeRect.right) * 0.5;
        const dcy = (deflated.top + deflated.bottom - activeRect.top - activeRect.bottom) * 0.5;
        result.push({ el: cand, rect: deflated, color: this.getIconFusionColor(cand), initialDistance: Math.hypot(dcx, dcy) });
      }
      result.sort((a, b) => a.initialDistance - b.initialDistance);
      return result.slice(0, CONFIG.fusionCandidateLimit);
    }

    getAnimatedIconFusionRect(state) {
      const base = state && state.rect;
      if (!base) return null;
      const scaleX = Math.max(0.01, (state.scale || 1) * (state.sx || 1));
      const scaleY = Math.max(0.01, (state.scale || 1) * (state.sy || 1));
      const angle = Math.abs((state.rot || 0) * Math.PI / 180);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const rawW = base.width * scaleX;
      const rawH = base.height * scaleY;
      const width = rawW * cos + rawH * sin;
      const height = rawW * sin + rawH * cos;
      const cx = (base.left + base.right) * 0.5 + (state.x || 0);
      const cy = (base.top + base.bottom) * 0.5 + (state.y || 0);
      const deflatedWidth = Math.max(1, width);
      const deflatedHeight = Math.max(1, height);
      return {
        left: cx - deflatedWidth * 0.5,
        right: cx + deflatedWidth * 0.5,
        top: cy - deflatedHeight * 0.5,
        bottom: cy + deflatedHeight * 0.5,
        width: deflatedWidth,
        height: deflatedHeight
      };
    }

    getIconRectBoundaryPoint(rect, ux, uy) {
      const cx = (rect.left + rect.right) * 0.5;
      const cy = (rect.top + rect.bottom) * 0.5;
      const tx = Math.abs(ux) > 0.0001 ? (rect.width * 0.5) / Math.abs(ux) : Infinity;
      const ty = Math.abs(uy) > 0.0001 ? (rect.height * 0.5) / Math.abs(uy) : Infinity;
      const t = Math.min(tx, ty);
      return { x: cx + ux * t, y: cy + uy * t };
    }

    getFacingBorderWidth(el, ux, uy) {
      if (!el) return 0;
      try {
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        let cached = this.fusionBorderCache.get(el);
        if (!cached || now - cached.time >= CONFIG.fusionColorCacheMs) {
          const win = el.ownerDocument && el.ownerDocument.defaultView;
          const cs = win && win.getComputedStyle ? win.getComputedStyle(el) : null;
          if (!cs) return 0;
          cached = {
            time: now,
            left: clamp(parseFloat(cs.borderLeftWidth) || 0, 0, 6),
            right: clamp(parseFloat(cs.borderRightWidth) || 0, 0, 6),
            top: clamp(parseFloat(cs.borderTopWidth) || 0, 0, 6),
            bottom: clamp(parseFloat(cs.borderBottomWidth) || 0, 0, 6)
          };
          this.fusionBorderCache.set(el, cached);
        }
        if (Math.abs(ux) >= Math.abs(uy)) return ux >= 0 ? cached.right : cached.left;
        return uy >= 0 ? cached.bottom : cached.top;
      } catch (_) { return 0; }
    }

    buildIconFusionGeometry(activeRect, neighborRect, strength, reveal, activeEl, neighborEl, fallbackDirection) {
      const acx = (activeRect.left + activeRect.right) * 0.5;
      const acy = (activeRect.top + activeRect.bottom) * 0.5;
      const bcx = (neighborRect.left + neighborRect.right) * 0.5;
      const bcy = (neighborRect.top + neighborRect.bottom) * 0.5;
      const centerDX = bcx - acx;
      const centerDY = bcy - acy;
      const centerDistance = Math.hypot(centerDX, centerDY);
      let ux, uy;
      if (centerDistance < 0.01) {
        const fdx = fallbackDirection && fallbackDirection.x || 0;
        const fdy = fallbackDirection && fallbackDirection.y || 0;
        const fd = Math.hypot(fdx, fdy);
        if (fd < 0.01) return null;
        ux = fdx / fd;
        uy = fdy / fd;
      } else {
        ux = centerDX / centerDistance;
        uy = centerDY / centerDistance;
      }
      const edgeA = this.getIconRectBoundaryPoint(activeRect, ux, uy);
      const edgeB = this.getIconRectBoundaryPoint(neighborRect, -ux, -uy);
      const signedGap = (edgeB.x - edgeA.x) * ux + (edgeB.y - edgeA.y) * uy;
      const overlapDepth = Math.max(0, -signedGap);
      const overlapRatio = clamp(overlapDepth / Math.max(8, Math.min(activeRect.width, neighborRect.width) * 0.42), 0, 1);
      const coverA = this.getFacingBorderWidth(activeEl, ux, uy) + CONFIG.fusionOverlap + strength * 0.9;
      const coverB = this.getFacingBorderWidth(neighborEl, -ux, -uy) + CONFIG.fusionOverlap + strength * 0.9;
      let fullStart;
      let fullEnd;
      if (signedGap >= 0) {
        fullStart = { x: edgeA.x - ux * coverA, y: edgeA.y - uy * coverA };
        fullEnd = { x: edgeB.x + ux * coverB, y: edgeB.y + uy * coverB };
      } else {
        // In overlap, cover the complete intersection in the active-to-neighbour
        // axis.  Keeping the color endpoints attached to their own surfaces
        // makes the overlap read as dissolution, not as a reversed thin bridge.
        fullStart = { x: edgeA.x + ux * coverA, y: edgeA.y + uy * coverA };
        fullEnd = { x: edgeB.x - ux * coverB, y: edgeB.y - uy * coverB };
      }
      let fullDX = fullEnd.x - fullStart.x;
      let fullDY = fullEnd.y - fullStart.y;
      let fullLength = Math.hypot(fullDX, fullDY);
      if (fullLength < 1.8) {
        fullDX = ux * 1.8;
        fullDY = uy * 1.8;
        fullLength = 1.8;
      }

      reveal = clamp(reveal == null ? 1 : reveal, 0, 1);
      const lengthReveal = this.smoothstep(clamp(reveal / 0.72, 0, 1));
      const widthReveal = this.smoothstep(clamp((reveal - 0.08) / 0.92, 0, 1));
      const visibleLength = lerp(1.8, fullLength, lengthReveal);
      const axisX = fullDX / fullLength;
      const axisY = fullDY / fullLength;
      let start = fullStart;
      let end = { x: start.x + axisX * visibleLength, y: start.y + axisY * visibleLength };
      let dx = end.x - start.x;
      let dy = end.y - start.y;
      let length = Math.hypot(dx, dy);
      if (length < 0.01) return null;

      const sux = dx / length;
      const suy = dy / length;
      const nx = -suy;
      const ny = sux;
      const minEdge = Math.min(activeRect.width, activeRect.height, neighborRect.width, neighborRect.height);
      const diagonal = Math.min(Math.abs(ux), Math.abs(uy)) * Math.SQRT2;
      const maxContact = clamp(minEdge * (0.31 + overlapRatio * 0.12) * (1 - diagonal * 0.16), 7, 28);
      const distanceWidth = this.smoothstep(clamp(strength, 0, 1));
      const contactHalf = lerp(0.10, lerp(0.75, maxContact, distanceWidth), widthReveal);
      const waistFactor = lerp(0.42, 0.76, distanceWidth) + overlapRatio * 0.14;
      const waistHalf = Math.max(0.10, contactHalf * waistFactor);
      const mid = { x: (start.x + end.x) * 0.5, y: (start.y + end.y) * 0.5 };
      const shoulder = length * lerp(0.15, 0.23, distanceWidth);
      const waistControl = length * 0.16;

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

      const padding = CONFIG.fusionPadding + (1 - strength) * 2;
      const minX = Math.min(start.x, end.x) - contactHalf - padding;
      const minY = Math.min(start.y, end.y) - contactHalf - padding;
      const maxX = Math.max(start.x, end.x) + contactHalf + padding;
      const maxY = Math.max(start.y, end.y) + contactHalf + padding;
      const local = p => ((p.x - minX).toFixed(2) + ' ' + (p.y - minY).toFixed(2));
      const d = [
        'M ' + local(topA),
        'C ' + local(topAControl) + ' ' + local(topMidLeft) + ' ' + local(topMid),
        'C ' + local(topMidRight) + ' ' + local(topBControl) + ' ' + local(topB),
        'L ' + local(bottomB),
        'C ' + local(bottomBControl) + ' ' + local(bottomMidRight) + ' ' + local(bottomMid),
        'C ' + local(bottomMidLeft) + ' ' + local(bottomAControl) + ' ' + local(bottomA),
        'Z'
      ].join(' ');
      return {
        x: minX,
        y: minY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY),
        d,
        shineD: [
          'M ' + local(point(start, -contactHalf * 0.56, Math.min(1.1, length * 0.05))),
          'C ' + local(point(start, -contactHalf * 0.56, shoulder)) + ' ' +
          local(point(mid, -waistHalf * 0.62, -waistControl)) + ' ' +
          local(point(mid, -waistHalf * 0.62, 0)),
          'C ' + local(point(mid, -waistHalf * 0.62, waistControl)) + ' ' +
          local(point(end, -contactHalf * 0.56, -shoulder)) + ' ' +
          local(point(end, -contactHalf * 0.56, -Math.min(1.1, length * 0.05)))
        ].join(' '),
        gradientStart: { x: start.x - minX, y: start.y - minY },
        gradientEnd: { x: end.x - minX, y: end.y - minY },
        overlapRatio,
        signedGap
      };
    }

    setIconFusionPaint(bridge, cA, cB, same, strength, overlapRatio) {
      const refs = bridge && bridge.__igFusion;
      if (!refs) return;
      const mixSpan = same ? 0.34 : clamp(lerp(0.30, 0.88, this.smoothstep(strength)) + overlapRatio * 0.08, 0.30, 0.92);
      const mixBucket = Math.round(mixSpan * 50) / 50;
      const paintKey = cA.key + ':' + cA.a.toFixed(3) + '|' + cB.key + ':' + cB.a.toFixed(3) + '|' + (same ? '1' : '0') + '|' + mixBucket;
      if (refs.paintKey === paintKey) return;
      refs.paintKey = paintKey;
      const leftMix = Math.max(0.035, 0.5 - mixBucket * 0.5);
      const rightMix = Math.min(0.965, 0.5 + mixBucket * 0.5);
      const positions = [0, 0.018, leftMix, 0.5, rightMix, 0.982, 1];
      const mid = this.interpolateColor(cA, cB, 0.5);
      const quarter = this.interpolateColor(cA, cB, 0.22);
      const threeQuarter = this.interpolateColor(cA, cB, 0.78);
      const baseColors = [cA, cA, quarter, mid, threeQuarter, cB, cB];
      // Preserve the surfaces' real material alpha.  Visibility comes from the
      // distance/reveal channel and the very light specular edge, not from
      // secretly making translucent cards opaque.
      const baseAlphas = [0, cA.a, quarter.a, mid.a, threeQuarter.a, cB.a, 0];
      refs.stops.forEach((stop, index) => {
        const color = baseColors[index];
        const alpha = clamp(baseAlphas[index], 0, 1);
        stop.setAttribute('offset', (positions[index] * 100).toFixed(1) + '%');
        stop.setAttribute('stop-color', 'rgb(' + color.r + ',' + color.g + ',' + color.b + ')');
        stop.setAttribute('stop-opacity', alpha.toFixed(3));
      });
    }

    writeBridgeStyle(bridge, name, value) {
      const refs = bridge.__igFusion;
      const key = 's:' + name;
      if (refs.lastWrites[key] === value) return;
      refs.lastWrites[key] = value;
      bridge.style.setProperty(name, value);
    }

    writeBridgeAttr(node, bridge, name, value, scope) {
      const refs = bridge.__igFusion;
      const key = 'a:' + scope + ':' + name;
      if (refs.lastWrites[key] === value) return;
      refs.lastWrites[key] = value;
      node.setAttribute(name, value);
    }

    advanceBridgeProgress(bridge, now, target) {
      const refs = bridge.__igFusion;
      refs.target = target;
      if (!refs.lastTime) refs.lastTime = now - 16;
      const dt = clamp(now - refs.lastTime, 0, 50);
      refs.lastTime = now;
      const duration = target ? CONFIG.fusionEnterMs : CONFIG.fusionExitMs;
      refs.progress = clamp(refs.progress + (target ? 1 : -1) * dt / duration, 0, 1);
      return refs.progress;
    }

    renderIconFusionBridge(bridge, descriptor, now, target) {
      const refs = bridge.__igFusion;
      const progress = this.advanceBridgeProgress(bridge, now, target);
      if (!descriptor || progress <= 0) {
        this.writeBridgeStyle(bridge, '--ig-fusion-opacity', '0');
        return false;
      }
      if (!target) {
        // During the reverse animation keep both ends attached while the
        // pressed card springs home or a modal/card layout shifts.
        const activeState = this.elements.get(descriptor.activeEl);
        const animated = activeState && this.getAnimatedIconFusionRect(activeState);
        if (animated) descriptor.activeRect = animated;
        try {
          if (descriptor.cand && descriptor.cand.isConnected) {
            const rect = descriptor.cand.getBoundingClientRect();
            if (rect && rect.width > 0 && rect.height > 0) descriptor.neighborRect = rect;
          }
        } catch (_) {}
      }
      refs.descriptor = descriptor;
      const g = this.buildIconFusionGeometry(
        descriptor.activeRect,
        descriptor.neighborRect,
        descriptor.strength,
        this.smoothstep(progress),
        descriptor.activeEl,
        descriptor.cand,
        descriptor.direction
      );
      if (!g) return progress > 0;
      this.setIconFusionPaint(bridge, descriptor.activeColor, descriptor.color, descriptor.same, descriptor.strength, g.overlapRatio);

      const width = g.width.toFixed(2);
      const height = g.height.toFixed(2);
      this.writeBridgeAttr(bridge, bridge, 'viewBox', '0 0 ' + width + ' ' + height, 'svg');
      this.writeBridgeAttr(bridge, bridge, 'width', width, 'svg');
      this.writeBridgeAttr(bridge, bridge, 'height', height, 'svg');
      this.writeBridgeStyle(bridge, 'width', width + 'px');
      this.writeBridgeStyle(bridge, 'height', height + 'px');
      this.writeBridgeStyle(bridge, '--ig-fusion-x', g.x.toFixed(2) + 'px');
      this.writeBridgeStyle(bridge, '--ig-fusion-y', g.y.toFixed(2) + 'px');

      const revealOpacity = this.smoothstep(clamp((progress - 0.02) / 0.98, 0, 1));
      const distanceOpacity = Math.pow(clamp(descriptor.proximity, 0, 1), 0.66);
      const opacity = revealOpacity * distanceOpacity * descriptor.alignmentOpacity;
      this.writeBridgeStyle(bridge, '--ig-fusion-opacity', opacity.toFixed(3));
      this.writeBridgeStyle(bridge, '--ig-fusion-glow-opacity', lerp(0.035, descriptor.same ? 0.10 : 0.15, descriptor.strength).toFixed(3));
      this.writeBridgeStyle(bridge, '--ig-fusion-glow-blur', lerp(0.8, 2.2, descriptor.strength).toFixed(2) + 'px');
      this.writeBridgeStyle(bridge, '--ig-fusion-shine-opacity', (revealOpacity * lerp(0.06, 0.18, descriptor.strength)).toFixed(3));
      this.writeBridgeAttr(refs.body, bridge, 'd', g.d, 'body');
      this.writeBridgeAttr(refs.glow, bridge, 'd', g.d, 'glow');
      this.writeBridgeAttr(refs.shine, bridge, 'd', g.shineD, 'shine');
      this.writeBridgeAttr(refs.gradient, bridge, 'x1', g.gradientStart.x.toFixed(2), 'gradient');
      this.writeBridgeAttr(refs.gradient, bridge, 'y1', g.gradientStart.y.toFixed(2), 'gradient');
      this.writeBridgeAttr(refs.gradient, bridge, 'x2', g.gradientEnd.x.toFixed(2), 'gradient');
      this.writeBridgeAttr(refs.gradient, bridge, 'y2', g.gradientEnd.y.toFixed(2), 'gradient');
      bridge.classList.toggle('__ig-fusion-same', descriptor.same);
      bridge.classList.add('__ig-fusion-visible');
      return target ? progress < 1 || opacity > 0 : progress > 0;
    }

    updateIconFusionBridges(now) {
      now = now || ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
      const activeState = this.pressedState && this.pressedState.isPressed ? this.pressedState : null;
      const selected = [];

      if (activeState && activeState.el && activeState.el.isConnected) {
        const activeEl = activeState.el;
        const activeRect = this.getAnimatedIconFusionRect(activeState);
        const rawDX = activeState.x || 0;
        const rawDY = activeState.y || 0;
        const rawLength = Math.hypot(rawDX, rawDY);
        if (activeRect && activeRect.width > 0 && activeRect.height > 0 && rawLength >= 0.55) {
          if (!activeState.igFusionCandidates) {
            activeState.igFusionCandidates = this.collectIconFusionCandidates(activeEl, activeRect, activeState.profile);
            activeState.igFusionColor = this.getIconFusionColor(activeEl);
          }
          const threshold = CONFIG.fusionThreshold;
          const candidates = activeState.igFusionCandidates;
          const activeColor = activeState.igFusionColor || this.getIconFusionColor(activeEl);
          const minAlignment = Math.cos(80 * Math.PI / 180);
          for (let i = 0; i < candidates.length; i++) {
            const candidate = candidates[i];
            const cand = candidate.el;
            if (!cand || !cand.isConnected || cand === activeEl) continue;
            let cr;
            try { cr = cand.getBoundingClientRect(); } catch (_) { continue; }
            if (!cr || cr.width <= 0 || cr.height <= 0) continue;
            if (cr.right < activeRect.left - threshold || cr.left > activeRect.right + threshold ||
                cr.bottom < activeRect.top - threshold || cr.top > activeRect.bottom + threshold) continue;

            const gapX = activeRect.right < cr.left ? cr.left - activeRect.right : (cr.right < activeRect.left ? activeRect.left - cr.right : 0);
            const gapY = activeRect.bottom < cr.top ? cr.top - activeRect.bottom : (cr.bottom < activeRect.top ? activeRect.top - cr.bottom : 0);
            const gap = Math.hypot(gapX, gapY);
            if (gap >= threshold) continue;

            const toNX = (cr.left + cr.right - activeRect.left - activeRect.right) * 0.5;
            const toNY = (cr.top + cr.bottom - activeRect.top - activeRect.bottom) * 0.5;
            const distanceToNeighbor = Math.hypot(toNX, toNY);
            const alignment = distanceToNeighbor < 0.5 ? 1 : (rawDX * toNX + rawDY * toNY) / (rawLength * distanceToNeighbor);
            if (alignment <= minAlignment) continue;
            const proximity = clamp(1 - gap / threshold, 0, 1);
            const alignmentEase = clamp((alignment - minAlignment) / (1 - minAlignment), 0, 1);
            const strength = this.smoothstep(proximity) * lerp(0.82, 1, alignmentEase);
            const color = this.getIconFusionColor(cand);
            selected.push({
              cand, gap, strength, proximity,
              alignmentOpacity: lerp(0.72, 1, alignmentEase),
              activeRect, neighborRect: cr, activeEl,
              direction: { x: rawDX / rawLength, y: rawDY / rawLength },
              activeColor, color,
              same: activeColor.key === color.key
            });
          }
        }
      }

      selected.sort((a, b) => a.gap - b.gap);
      const limited = selected.slice(0, CONFIG.fusionMaxBridges);
      const limitedSet = new Set(limited.map(item => item.cand));
      let hasBridgeWork = false;

      for (let i = 0; i < limited.length; i++) {
        const item = limited[i];
        const bridge = this.ensureIconFusionBridge(item.cand);
        if (this.renderIconFusionBridge(bridge, item, now, 1)) hasBridgeWork = true;
      }

      const removals = [];
      this.fusionBridges.forEach((bridge, neighbor) => {
        if (limitedSet.has(neighbor)) return;
        const refs = bridge.__igFusion;
        if (this.renderIconFusionBridge(bridge, refs && refs.descriptor, now, 0)) {
          hasBridgeWork = true;
        } else if (!refs || refs.progress <= 0) {
          removals.push(neighbor);
        }
      });
      removals.forEach(neighbor => this.removeIconFusionBridge(neighbor));
      return hasBridgeWork;
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
        if (this.activeStates.size || this.fusionBridges.size) this.startLoop();
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
      if (e.relatedTarget && el.contains && el.contains(e.relatedTarget)) return;
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
      if (e.relatedTarget && el.contains && el.contains(e.relatedTarget)) return;
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
      let reduceMotion = false;
      try { reduceMotion = typeof localStorage !== 'undefined' && localStorage.getItem('alpha_reduce_motion') === 'true'; } catch (_) {}
      if (reduceMotion) {
        // 保持与 liquid 一致：减弱模式下仍保留基础按压但禁用融合预取
        const el0 = this.getTarget(e.target);
        if (!el0) return;
        const st0 = this.getState(el0);
        st0.isPressed = true;
        st0.pointerId = e.pointerId;
        st0.startX = e.clientX;
        st0.startY = e.clientY;
        st0.rect = el0.getBoundingClientRect();
        st0.targetScale = st0.profile.pressScale;
        st0.targetLo = 1;
        st0.igFusionCandidates = [];
        st0.igFusionColor = this.getIconFusionColor(el0);
        this.pressedState = st0;
        try { el0.setPointerCapture(e.pointerId); } catch (_) {}
        this.activeStates.add(st0);
        this.startLoop();
        return;
      }
      if (e.button !== 0) return;
      const el = this.getTarget(e.target);
      if (!el) return;

      const state = this.getState(el);
      state.isPressed = true;
      state.pointerId = e.pointerId;
      state.startX = e.clientX;
      state.startY = e.clientY;
      const rect = el.getBoundingClientRect();
      // 与 liquid 一致：处理已在动画中的元素的基准 rect 需逆变换回未缩放状态，避免连续按压时基准漂移
      if (state.x !== 0 || state.y !== 0 || state.scale !== 1 || state.sx !== 1 || state.sy !== 1) {
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
          height: baseHeight
        };
      } else {
        state.rect = rect;
      }
      state.targetScale = state.profile.pressScale;
      state.targetLo = 1;
      this.pressedState = state;
      state.igFusionColor = this.getIconFusionColor(el);
      try {
        state.igFusionCandidates = this.collectIconFusionCandidates(el, state.rect, state.profile);
      } catch (_) { state.igFusionCandidates = []; }

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
          if (state.pointerId !== e.pointerId) return;
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
          state.igFusionCandidates = null;

          try {
            state.el.releasePointerCapture(e.pointerId);
          } catch (_) {}
        }
      });
      if (this.pressedState && (this.pressedState.pointerId == null || this.pressedState.pointerId === e.pointerId || !this.pressedState.isPressed)) {
        this.pressedState = null;
      }
      try { this.clearAllIconFusionBridges(); } catch (_) {}
      this.startLoop();
    }

    startLoop() {
      if (this.rafId || this.isSleeping) return;

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

        let hasBridgeWork = false;
        try { hasBridgeWork = this.updateIconFusionBridges(now); } catch (_) {}

        if (hasActiveWork || hasBridgeWork) {
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
