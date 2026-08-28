/**
 * Alpha Elastic Overscroll Engine
 * Precision Dual-Mode Spring-Damper Physics (Mouse Wheel & Precision Touchpad)
 * (c) Tasks Project - Liquid Glass & Motion Suite
 * 
 * - Monotonic Critically-Damped Recoil Lock: completely eliminates multi-bounce
 *   twitches caused by residual touchpad momentum;
 * - Intelligent input mode detection (Precision Touchpads vs. Mouse Wheels);
 * - High-DPI & subpixel-proof top & bottom boundary detection;
 * - High-performance zero-allocation RAF loop (0% idle CPU, zero GC pressure);
 * - Preserves 100% of panel box-shadows, backdrop-filters, and Liquid Glass vibrancy;
 * - Ambient lighting & background layers (.alpha-ambient-bg, wallpapers) remain 100% fixed & unaffected;
 * - Full support for Home.html when Focus is disabled on cold boot;
 * - Strictly excluded for lite/ sub-windows and viewport-locked views (Focus.html, splash.html).
 */

(function (global) {
  'use strict';

  // 1. Exclude lite/ popup windows, context menu, and splash screens
  if (typeof window !== 'undefined') {
    const path = (window.location.pathname || '') + (window.location.href || '');
    if (path.includes('/lite/') || path.includes('\\lite\\') || path.includes('lite/')) {
      return;
    }
  }

  // Prevent multiple initializations in the same window/frame
  if (global.__ALPHA_SCROLL_BOUNCE_INSTALLED__) {
    return;
  }
  global.__ALPHA_SCROLL_BOUNCE_INSTALLED__ = true;

  // Snappy & Smooth Physics Configuration
  const CONFIG = {
    maxStretchPage: 32,
    maxStretchContainer: 20,
    resistance: 0.42,
    springStiffness: 0.32,
    springDamping: 0.68,
    wheelIdleMsMouse: 65,
    wheelIdleMsTouchpad: 25,
    mouseSensitivity: 0.45,
    touchpadSensitivity: 0.22,
    touchSensitivity: 0.55
  };

  let activeElement = null;
  let cachedTargetElements = null;
  let activeMaxDistance = CONFIG.maxStretchPage;
  let rawDelta = 0;
  let targetY = 0;
  let currentY = 0;
  let velocity = 0;
  let lastInputTime = 0;
  let isTouching = false;
  let isTouchpadMode = false;
  let isRecoiling = false;
  let rafId = null;

  const STYLE_CACHE_MS = 32;
  const DRAG_QUERY_CACHE_MS = 32;
  const scrollStyleCache = new WeakMap();
  let lastDragQueryTime = -Infinity;
  let lastDragQueryResult = false;
  let targetsPrepared = false;
  let lastAppliedY = NaN;

  let boundaryProbeId = null;
  let pendingProbeElement = null;
  let pendingProbeBoundary = '';
  let pendingProbeIsPage = false;
  let pendingProbeDelta = 0;
  let pendingProbeSensitivity = 0;

  const scrollResult = {
    native: false,
    element: null,
    boundary: '',
    isPage: false,
    remaining: 0
  };

  let touchStartY = 0;
  let touchLastY = 0;

  function isExcluded(element) {
    if (!element) return true;
    if (element.closest && element.closest('.no-bounce, .no-overscroll, [data-no-overscroll], #title-bar')) {
      return true;
    }
    return false;
  }

  function hasActiveDrag(now) {
    const body = document.body;
    if (!body) return false;

    if (body.classList.contains('tab-drag-active') ||
        body.classList.contains('switch-dragging')) {
      return true;
    }

    if (now - lastDragQueryTime >= DRAG_QUERY_CACHE_MS) {
      lastDragQueryTime = now;
      lastDragQueryResult = !!document.querySelector('.tab.dragging');
    }
    return lastDragQueryResult;
  }

  function getScrollStyle(element, now) {
    let cached = scrollStyleCache.get(element);
    if (cached && now - cached.time < STYLE_CACHE_MS) {
      return cached;
    }

    const style = window.getComputedStyle(element);
    if (!cached) {
      cached = { time: 0, overflowY: '', overscrollNone: false };
      scrollStyleCache.set(element, cached);
    }
    cached.time = now;
    cached.overflowY = style.overflowY;
    cached.overscrollNone = style.overscrollBehaviorY === 'none' || style.overscrollBehavior === 'none';
    return cached;
  }

  function makeScrollResult(native, element, boundary, isPage, remaining) {
    scrollResult.native = native;
    scrollResult.element = element;
    scrollResult.boundary = boundary;
    scrollResult.isPage = isPage;
    scrollResult.remaining = remaining || 0;
    return scrollResult;
  }

  function detectInputMode(e) {
    if (e.deltaMode !== 0) {
      return false;
    }
    const absY = Math.abs(e.deltaY);
    const absX = Math.abs(e.deltaX || 0);

    if ((absY > 0 && absY < 45 && (absY % 1 !== 0 || absY % 10 !== 0)) || absX > 0.5) {
      return true;
    }
    if (absY >= 40 && absY % 10 === 0 && absX === 0) {
      return false;
    }
    return isTouchpadMode;
  }

  function getPageContentElements() {
    const elements = [];
    const body = document.body;
    if (!body) return elements;

    const children = body.children;
    const len = children.length;
    for (let i = 0; i < len; i++) {
      const child = children[i];
      const tag = child.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'LINK' || tag === 'TEMPLATE') {
        continue;
      }
      const cl = child.classList;
      const id = (child.id || '').toLowerCase();
      
      // Strictly exclude background, lighting layers, floating overlays, tooltips, dialogs, modals, and toasts
      if (cl.contains('alpha-ambient-bg') ||
          cl.contains('hero-wallpaper') ||
          cl.contains('wallpaper-layer') ||
          cl.contains('ambient-motion-stage') ||
          cl.contains('alpha-bg-snapshot') ||
          child.id === 'focus-return-boot-style' ||
          cl.contains('flatpickr-calendar') ||
          cl.contains('sphere-modal') ||
          cl.contains('modal') ||
          cl.contains('dialog') ||
          cl.contains('toast') ||
          cl.contains('popup') ||
          cl.contains('tooltip') ||
          cl.contains('chartjs-tooltip') ||
          cl.contains('no-bounce') ||
          cl.contains('no-overscroll') ||
          child.hasAttribute('data-no-overscroll') ||
          child.getAttribute('role') === 'tooltip' ||
          id.includes('tooltip') ||
          id.includes('modal') ||
          id.includes('dialog') ||
          id.includes('toast') ||
          id.includes('menu') ||
          child.style.position === 'fixed' ||
          window.getComputedStyle(child).position === 'fixed') {
        continue;
      }
      elements.push(child);
    }
    return elements;
  }

  function findScrollTarget(targetNode, deltaY, now) {
    if (!targetNode || Math.abs(deltaY) < 0.5 || hasActiveDrag(now)) return null;

    let el = targetNode.nodeType === 1 ? targetNode : targetNode.parentElement;

    while (el && el !== document.documentElement && el !== document.body) {
      if (isExcluded(el)) return null;

      if (el.scrollHeight > el.clientHeight + 4) {
        const style = getScrollStyle(el, now);
        const overflowY = style.overflowY;

        if (style.overscrollNone) {
          return null;
        }

        if (overflowY === 'auto' || overflowY === 'scroll') {
          const scrollTop = el.scrollTop;
          const clientHeight = el.clientHeight;
          const scrollHeight = el.scrollHeight;

          if (deltaY < 0) {
            if (scrollTop <= 1) return makeScrollResult(false, el, 'top', false, 0);
            return makeScrollResult(true, el, 'top', false, scrollTop);
          } else {
            if (scrollTop + clientHeight >= scrollHeight - 6) {
              return makeScrollResult(false, el, 'bottom', false, 0);
            }
            return makeScrollResult(
              true,
              el,
              'bottom',
              false,
              Math.max(0, scrollHeight - clientHeight - scrollTop)
            );
          }
        }
      }

      el = el.parentElement;
    }

    const docEl = document.documentElement;
    const bodyEl = document.body;
    if (!docEl || !bodyEl || isExcluded(bodyEl)) return null;

    const htmlOverflow = getScrollStyle(docEl, now).overflowY;
    const bodyOverflow = getScrollStyle(bodyEl, now).overflowY;

    if (htmlOverflow === 'hidden' || htmlOverflow === 'clip' ||
        bodyOverflow === 'hidden' || bodyOverflow === 'clip') {
      return null;
    }

    if (htmlOverflow.includes('none') || bodyOverflow.includes('none')) {
      return null;
    }

    const rootScrollHeight = Math.max(docEl.scrollHeight, bodyEl.scrollHeight);
    const rootClientHeight = window.innerHeight || docEl.clientHeight;

    if (rootScrollHeight <= rootClientHeight + 4) {
      if (deltaY < 0) {
        return makeScrollResult(false, bodyEl, 'top', true, 0);
      } else {
        return makeScrollResult(false, bodyEl, 'bottom', true, 0);
      }
    }

    const scrollTop = window.scrollY || docEl.scrollTop || bodyEl.scrollTop || 0;

    if (deltaY < 0) {
      if (scrollTop <= 1) return makeScrollResult(false, bodyEl, 'top', true, 0);
      return makeScrollResult(true, bodyEl, 'top', true, scrollTop);
    } else {
      if (scrollTop + rootClientHeight >= rootScrollHeight - 6) {
        return makeScrollResult(false, bodyEl, 'bottom', true, 0);
      }
      return makeScrollResult(
        true,
        bodyEl,
        'bottom',
        true,
        Math.max(0, rootScrollHeight - rootClientHeight - scrollTop)
      );
    }
  }

  function calculateTension(delta, maxDistance, resistance) {
    if (delta === 0) return 0;
    const sign = delta > 0 ? 1 : -1;
    const abs = Math.abs(delta);
    return sign * maxDistance * (1 - 1 / (1 + (resistance * abs) / maxDistance));
  }

  function applyStyles(targets, y) {
    if (!targets || targets.length === 0) return;

    if (Math.abs(y) < 0.08) {
      if (lastAppliedY === 0 && !targetsPrepared) return;
      for (let i = 0; i < targets.length; i++) {
        const el = targets[i];
        el.style.transform = '';
        el.style.willChange = '';
      }
      targetsPrepared = false;
      lastAppliedY = 0;
      return;
    }

    if (Math.abs(y - lastAppliedY) < 0.01) return;

    const transformVal = `translate3d(0, ${y.toFixed(2)}px, 0)`;

    if (!targetsPrepared) {
      for (let i = 0; i < targets.length; i++) {
        targets[i].style.willChange = 'transform';
      }
      targetsPrepared = true;
    }

    for (let i = 0; i < targets.length; i++) {
      const el = targets[i];
      el.style.transform = transformVal;
    }
    lastAppliedY = y;
  }

  function clearCachedTargets() {
    if (cachedTargetElements) {
      applyStyles(cachedTargetElements, 0);
      cachedTargetElements = null;
    }
    targetsPrepared = false;
    lastAppliedY = NaN;
  }

  function selectActiveElement(targetEl, isPage) {
    if (activeElement !== targetEl) {
      clearCachedTargets();
      activeElement = targetEl;
    }

    if (!cachedTargetElements) {
      cachedTargetElements = isPage ? getPageContentElements() : [targetEl];
      targetsPrepared = false;
      lastAppliedY = NaN;
    }
  }

  function cancelBoundaryProbe() {
    if (boundaryProbeId !== null) {
      cancelAnimationFrame(boundaryProbeId);
      boundaryProbeId = null;
    }
    pendingProbeElement = null;
    pendingProbeBoundary = '';
    pendingProbeDelta = 0;
  }

  function isAtBoundary(element, boundary, isPage) {
    if (isPage) {
      const docEl = document.documentElement;
      const bodyEl = document.body;
      if (!docEl || !bodyEl) return false;

      const scrollTop = window.scrollY || docEl.scrollTop || bodyEl.scrollTop || 0;
      if (boundary === 'top') return scrollTop <= 1;

      const scrollHeight = Math.max(docEl.scrollHeight, bodyEl.scrollHeight);
      const clientHeight = window.innerHeight || docEl.clientHeight;
      return scrollTop + clientHeight >= scrollHeight - 6;
    }

    if (!element || !element.isConnected) return false;
    if (boundary === 'top') return element.scrollTop <= 1;
    return element.scrollTop + element.clientHeight >= element.scrollHeight - 6;
  }

  function enterOverscroll(targetEl, boundary, isPage, delta, sensitivity, now) {
    cancelBoundaryProbe();
    activeMaxDistance = isPage ? CONFIG.maxStretchPage : CONFIG.maxStretchContainer;
    selectActiveElement(targetEl, isPage);
    isRecoiling = false;
    lastInputTime = now;

    rawDelta -= delta * sensitivity;
    if (boundary === 'top' && rawDelta < 0) rawDelta = 0;
    if (boundary === 'bottom' && rawDelta > 0) rawDelta = 0;

    targetY = calculateTension(rawDelta, activeMaxDistance, CONFIG.resistance);
    startPhysics();
  }

  function runBoundaryProbe() {
    boundaryProbeId = null;

    const targetEl = pendingProbeElement;
    const boundary = pendingProbeBoundary;
    const isPage = pendingProbeIsPage;
    const delta = pendingProbeDelta;
    const sensitivity = pendingProbeSensitivity;

    pendingProbeElement = null;
    pendingProbeBoundary = '';
    pendingProbeDelta = 0;

    if (!targetEl || !isAtBoundary(targetEl, boundary, isPage)) return;

    enterOverscroll(targetEl, boundary, isPage, delta, sensitivity, performance.now());
  }

  function scheduleBoundaryProbe(nativeResult, delta, sensitivity) {
    const overshoot = Math.abs(delta) - nativeResult.remaining;
    if (overshoot < 0.5) return;

    pendingProbeElement = nativeResult.element;
    pendingProbeBoundary = nativeResult.boundary;
    pendingProbeIsPage = nativeResult.isPage;
    pendingProbeDelta = delta < 0 ? -overshoot : overshoot;
    pendingProbeSensitivity = sensitivity;

    if (boundaryProbeId === null) {
      boundaryProbeId = requestAnimationFrame(runBoundaryProbe);
    }
  }

  function updatePhysics() {
    if (!activeElement || !cachedTargetElements) {
      rafId = null;
      return;
    }

    const now = performance.now();
    const idleTime = now - lastInputTime;
    const idleLimit = isTouchpadMode ? CONFIG.wheelIdleMsTouchpad : CONFIG.wheelIdleMsMouse;

    if (isTouching) {
      currentY += (targetY - currentY) * 0.65;
      velocity = 0;
    } else if (!isRecoiling && idleTime < idleLimit) {
      const followRate = isTouchpadMode ? 0.65 : 0.55;
      currentY += (targetY - currentY) * followRate;
      velocity = 0;
    } else {
      isRecoiling = true;
      targetY = 0;
      rawDelta = 0;

      const force = -CONFIG.springStiffness * currentY;
      velocity = (velocity + force) * CONFIG.springDamping;
      currentY += velocity;

      if (Math.abs(currentY) < 0.08 && Math.abs(velocity) < 0.05) {
        currentY = 0;
        velocity = 0;
        targetY = 0;
        rawDelta = 0;
        isRecoiling = false;
        clearCachedTargets();
        activeElement = null;
        rafId = null;
        return;
      }
    }

    if (cachedTargetElements) {
      applyStyles(cachedTargetElements, currentY);
    }

    rafId = requestAnimationFrame(updatePhysics);
  }

  function startPhysics() {
    if (!cachedTargetElements && activeElement) {
      selectActiveElement(activeElement, activeElement === document.body);
    }
    if (!rafId) {
      rafId = requestAnimationFrame(updatePhysics);
    }
  }

  function onWheel(e) {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('alpha_reduce_motion') === 'true') return;
    if (Math.abs(e.deltaY) < 0.5 || e.ctrlKey) return;

    isTouchpadMode = detectInputMode(e);
    const sensitivity = isTouchpadMode ? CONFIG.touchpadSensitivity : CONFIG.mouseSensitivity;

    let delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 24;
    else if (e.deltaMode === 2) delta *= 360;

    const now = performance.now();

    if (activeElement && Math.abs(currentY) > 0.3) {
      const isStretchedTop = (currentY > 0);
      const isStretchedBottom = (currentY < 0);

      if ((isStretchedTop && delta > 0) || (isStretchedBottom && delta < 0)) {
        isRecoiling = false;
        rawDelta -= delta * sensitivity;

        if ((isStretchedTop && rawDelta <= 0) || (isStretchedBottom && rawDelta >= 0)) {
          rawDelta = 0;
          targetY = 0;
          lastInputTime = 0;
        } else {
          targetY = calculateTension(rawDelta, activeMaxDistance, CONFIG.resistance);
          lastInputTime = now;
        }

        startPhysics();

        if (Math.abs(currentY) > 1.2 && e.cancelable) {
          e.preventDefault();
        }
        return;
      }

      if (isRecoiling) {
        return;
      }
    }

    const res = findScrollTarget(e.target, delta, now);

    if (!res) {
      return;
    }

    if (res.native) {
      if (isTouchpadMode) {
        scheduleBoundaryProbe(res, delta, sensitivity);
      }
      return;
    }

    enterOverscroll(res.element, res.boundary, res.isPage, delta, sensitivity, now);
  }

  function onTouchStart(e) {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('alpha_reduce_motion') === 'true') return;
    if (e.touches && e.touches.length === 1) {
      touchStartY = e.touches[0].clientY;
      touchLastY = touchStartY;
      isTouching = true;
      isRecoiling = false;
      lastInputTime = performance.now();
    }
  }

  function onTouchMove(e) {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('alpha_reduce_motion') === 'true') return;
    if (!isTouching || !e.touches || e.touches.length !== 1) return;

    const y = e.touches[0].clientY;
    const deltaY = (touchLastY - y);
    touchLastY = y;
    const now = performance.now();

    if (activeElement && Math.abs(currentY) > 0.3) {
      const isStretchedTop = (currentY > 0);
      const isStretchedBottom = (currentY < 0);

      if ((isStretchedTop && deltaY > 0) || (isStretchedBottom && deltaY < 0)) {
        isRecoiling = false;
        rawDelta -= deltaY * CONFIG.touchSensitivity;
        if ((isStretchedTop && rawDelta <= 0) || (isStretchedBottom && rawDelta >= 0)) {
          rawDelta = 0;
          targetY = 0;
          lastInputTime = 0;
        } else {
          targetY = calculateTension(rawDelta, activeMaxDistance, CONFIG.resistance);
          lastInputTime = now;
        }
        startPhysics();
        if (Math.abs(currentY) > 1.2 && e.cancelable) e.preventDefault();
        return;
      }
    }

    const res = findScrollTarget(e.target, deltaY, now);
    if (!res || res.native) {
      return;
    }

    enterOverscroll(
      res.element,
      res.boundary,
      res.isPage,
      deltaY,
      CONFIG.touchSensitivity,
      now
    );
  }

  function onTouchEnd() {
    isTouching = false;
    isRecoiling = true;
    lastInputTime = 0;
    targetY = 0;
    rawDelta = 0;
    startPhysics();
  }

  function onBlur() {
    cancelBoundaryProbe();
    clearCachedTargets();
    activeElement = null;
    currentY = 0;
    targetY = 0;
    velocity = 0;
    rawDelta = 0;
    isTouching = false;
    isRecoiling = false;
    lastInputTime = 0;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function init() {
    window.addEventListener('wheel', onWheel, { passive: false, capture: false });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) onBlur();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  global.AlphaScrollBounceEngine = {
    version: '13.1.0',
    getConfig: () => CONFIG
  };

})(typeof window !== 'undefined' ? window : globalThis);