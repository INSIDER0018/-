/**
 * 自动播放雨课堂插件 - 主世界脚本
 *
 * 运行在页面主世界（通过 manifest 的 world: "MAIN" 注入），
 * 覆写 document.visibilityState / hidden / hasFocus，
 * 从而让站点 JS 认为页面始终可见、始终有焦点，
 * 规避"切标签页自动暂停视频"的检测。
 *
 * 注意：不要在这里做定时 play() 恢复，否则会与站点切换视频时的
 *       pause() 产生竞争（AbortError），导致视频卡住不前进。
 */
(function () {
  'use strict';
  if (window.__YK_ANTI_DETECT__) return;
  window.__YK_ANTI_DETECT__ = true;

  console.log('[雨课堂插件] 主世界脚本已注入');

  try {
    Object.defineProperty(Document.prototype, 'visibilityState', {
      get: function () { return 'visible'; },
      configurable: true,
    });
    Object.defineProperty(Document.prototype, 'hidden', {
      get: function () { return false; },
      configurable: true,
    });
  } catch (e) { /* ignore */ }

  try {
    Document.prototype.hasFocus = function () { return true; };
  } catch (e) { /* ignore */ }
})();
