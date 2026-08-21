/**
 * Alpha GPU Shader & Compositor Pre-warming Engine
 * Pre-compiles D3D11 / Skia Gaussian blur kernels, masks, radial gradients, and drop-shadows
 * into GPU driver VRAM at page boot to completely eliminate first-time animation jank & dropped frames.
 * (c) Tasks Project - Liquid Glass & Motion Suite
 */

(function (global) {
  'use strict';

  if (typeof document === 'undefined' || global.__ALPHA_GPU_PREWARMER_INSTALLED__) return;
  global.__ALPHA_GPU_PREWARMER_INSTALLED__ = true;

  function runGpuPrewarm() {
    if (!document.body) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runGpuPrewarm, { once: true });
      }
      return;
    }

    const sandbox = document.createElement('div');
    sandbox.setAttribute('aria-hidden', 'true');
    sandbox.style.cssText = `
      position: fixed !important;
      left: -9999px !important;
      top: -9999px !important;
      width: 8px !important;
      height: 8px !important;
      opacity: 0.005 !important;
      pointer-events: none !important;
      user-select: none !important;
      z-index: -99999 !important;
      overflow: hidden !important;
      contain: strict !important;
      transform: translate3d(0, 0, 0) !important;
    `;

    // 预热 40px 毛玻璃着色器、12px 遮罩着色器、投影着色器、复合径向渐变
    sandbox.innerHTML = `
      <div style="width:4px; height:4px; backdrop-filter: blur(40px) saturate(130%); transform: translateZ(0);"></div>
      <div style="width:4px; height:4px; backdrop-filter: blur(12px) saturate(140%); transform: translateZ(0);"></div>
      <div style="width:4px; height:4px; backdrop-filter: blur(20px) saturate(130%); transform: translateZ(0);"></div>
      <div style="width:4px; height:4px; -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0) border-box; filter: drop-shadow(0 0 4px #fff); transform: translateZ(0);"></div>
      <div style="width:4px; height:4px; background: radial-gradient(circle at center, rgba(255,255,255,0.8), transparent); transform: translateZ(0);"></div>
    `;

    document.body.appendChild(sandbox);

    // 维持 2 帧供 GPU Compositor 彻底完成管线烘焙与光栅化缓存
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          if (sandbox && sandbox.parentNode) {
            sandbox.parentNode.removeChild(sandbox);
          }
        } catch (_) {}
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runGpuPrewarm, { once: true });
  } else {
    // 异步微延迟启动预热，避开关键同步 DOM 解析
    setTimeout(runGpuPrewarm, 20);
  }
})(typeof window !== 'undefined' ? window : globalThis);
