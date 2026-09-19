/**
 * 自动播放雨课堂插件 - 内容脚本
 *
 * 功能：
 *  1. 在左侧目录自动顺序播放视频（跳过"作业/测试题"）
 *  2. 可选静音
 *  3. 规避切标签页时视频被暂停
 *  4. 向 popup 提供课程名、当前节、运行状态
 *
 * 说明：目录是 Vue 异步渲染的，注入瞬间可能还不存在，
 *       因此用 MutationObserver 动态检测，消息监听器始终注册。
 */
(function () {
  'use strict';
  if (window.__YUKETANG_AUTOPLAY_LOADED__) return;
  window.__YUKETANG_AUTOPLAY_LOADED__ = true;

  console.log('[雨课堂插件] 内容脚本已注入');

  const DEFAULTS = { muted: false };

  const state = {
    muted: false,
    running: false,       // 自动播放循环是否正在跑
    currentIndex: -1,     // 当前视频下标
    catalogReady: false,  // 目录是否已渲染
  };

  let manualSelectIndex = -1; // 用户手动点击选择的视频下标（用于播放完后从它的下一条继续）

  const SEL = {
    leafBox: 'div.nav-item-leaf-box',
    leafItem: '.leaf-item',
    leafTag: '.leaf-item-tag',
    navItem: '.nav-item',
    navItemNode: '.nav-item-node',
    video: 'video',
    controlRight: '.control-right',
    courseName: '.learning-space-header__primary',
  };

  /* ======================================================================
   * 1. 规避切标签页暂停检测
   *    - 由 content/main-world.js（world: MAIN）覆写 visibilityState/hidden/hasFocus 完成。
   *    - 这里不再做定时 play() 恢复，避免与站点切换视频的 pause() 竞争（AbortError）。
   * ====================================================================== */
  function setAutoplayActive(active) {
    // 保留：如未来需要跨世界通信可复用（当前主世界脚本不监听）
  }

  /* ======================================================================
   * 2. DOM 工具
   * ====================================================================== */
  function hasCatalog() {
    return document.querySelectorAll(SEL.leafBox).length > 0;
  }

  function getLeafItems() {
    const boxes = document.querySelectorAll(SEL.leafBox);
    const items = [];
    for (const box of boxes) {
      const tag = box.querySelector(SEL.leafTag);
      const leaf = box.querySelector(SEL.leafItem) || box;
      const tagText = tag ? tag.textContent.trim() : '';
      items.push({
        element: box,
        leaf: leaf,
        tag: tagText,
        isVideo: tagText === '视频',
        active: leaf.classList.contains('is-active'),
      });
    }
    return items;
  }

  function getVideoItems() {
    return getLeafItems().filter((i) => i.isVideo);
  }

  function getActiveVideoIndex() {
    return getVideoItems().findIndex((i) => i.active);
  }

  function getVideo() {
    return document.querySelector(SEL.video);
  }

  // 监听用户的真实点击（手动选择视频）。isTrusted=true 表示是用户鼠标点击，
  // 而非程序化 item.leaf.click()（其 isTrusted=false）。记录下标，播放完后从下一条继续。
  document.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    const leaf = e.target && e.target.closest ? e.target.closest(SEL.leafItem) : null;
    if (!leaf) return;
    const box = leaf.closest ? leaf.closest(SEL.leafBox) : null;
    if (!box) return;
    const tag = box.querySelector(SEL.leafTag);
    if (tag && tag.textContent.trim() === '视频') {
      const videos = getVideoItems();
      const idx = videos.findIndex((v) => v.leaf === leaf);
      if (idx >= 0) {
        manualSelectIndex = idx;
        state.currentIndex = idx;
        console.log(`[雨课堂插件] 手动选择第 ${idx + 1} 条视频`);
        // 手动切换视频后，遮罩可能因视频容器重渲染而丢失，延迟刷新
        setTimeout(() => { if (state.running) refreshOverlay(); }, 800);
      }
    }
  }, true);

  function getCourseName() {
    const el = document.querySelector(SEL.courseName);
    if (el) {
      const t = el.textContent.trim();
      if (t) return t;
    }
    const all = document.querySelectorAll('div, span');
    for (const e of all) {
      const t = e.textContent.trim();
      if (t && t.includes('学分课') && t.length < 40) {
        return t.replace(/学分课[\s\S]*$/, '').trim();
      }
    }
    return '';
  }

  function getCurrentSection() {
    const active = document.querySelector(SEL.leafItem + '.is-active');
    if (!active) return '';
    let nav = active;
    while (nav && !nav.classList.contains('nav-item')) {
      nav = nav.parentElement;
    }
    if (nav) {
      const node = nav.querySelector(':scope > ' + SEL.navItemNode);
      const titleEl = node ? node.querySelector('.ellipsis, .text, span') : null;
      const title = (titleEl || node) ? (titleEl || node).textContent.trim() : '';
      if (title) return title;
    }
    return '';
  }

  /* ======================================================================
   * 3. 章节展开（目录折叠时先展开）
   * ====================================================================== */
  function expandAllSections() {
    const navItems = document.querySelectorAll(SEL.navItem);
    for (const ni of navItems) {
      const node = ni.querySelector(':scope > ' + SEL.navItemNode);
      const list = ni.querySelector(':scope > .nav-item-list');
      if (!node) continue;
      const collapsed = !list || list.getBoundingClientRect().height === 0;
      if (collapsed) {
        try { node.click(); } catch (e) { /* ignore */ }
      }
    }
  }

  /* ======================================================================
   * 4. 播放器控制
   * ====================================================================== */
  function ensurePlaying() {
    const v = getVideo();
    if (!v) return;
    try {
      v.muted = state.muted;
    } catch (e) { /* ignore */ }
    const dur = v.duration || 0;
    // 关键：已播放完（结尾/ended）的视频不要重新 play()，
    // 否则会与"自动跳下一条"冲突，导致同一条视频无限重播。
    const finished = v.ended || (dur > 0 && v.currentTime >= dur - 0.5);
    if (v.paused && !finished) {
      const p = v.play();
      if (p && p.catch) {
        p.catch(() => {
          try { v.muted = true; } catch (e) {}
          v.play().catch(() => {});
        });
      }
    }
  }

  function applyToVideo() {
    const v = getVideo();
    if (!v) return;
    try {
      v.muted = state.muted;
    } catch (e) { /* ignore */ }
  }

  /** 恢复视频原始音量（不静音） */
  function resetVideo() {
    const v = getVideo();
    if (!v) return;
    try {
      v.muted = false;
      v.playbackRate = 1.0;
    } catch (e) { /* ignore */ }
  }

  /**
   * 同步标签页静音状态到浏览器级（chrome.tabs.update muted）。
   * 浏览器级静音比 video.muted 更可靠，站点 JS 无法覆盖，
   * 可杜绝"声音突然漏一下"的闪烁问题。
   */
  function syncTabMute() {
    const shouldMute = state.running && state.muted;
    try {
      chrome.runtime.sendMessage({ type: shouldMute ? 'muteTab' : 'unmuteTab' })
        .catch(() => {});
    } catch (e) { /* ignore */ }
  }

  // 用 volumechange 事件精准重新应用静音
  document.addEventListener('volumechange', (e) => {
    if (!state.running) return;
    const v = e.target;
    if (v && v.tagName === 'VIDEO' && v.muted !== state.muted) {
      try { v.muted = state.muted; } catch (err) { /* ignore */ }
    }
  }, true);

  /* ======================================================================
   * 4.5 自动播放提示 UI（顶部提示 + 视频遮罩）
   * ====================================================================== */
  function ensureBanner() {
    let banner = document.getElementById('__yk_banner__');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = '__yk_banner__';
      banner.style.cssText =
        'position:fixed;top:0;left:0;right:0;z-index:2147483646;' +
        'background:#3367d6;color:#fff;text-align:center;padding:8px 12px;' +
        'font-size:14px;font-weight:600;box-shadow:0 2px 6px rgba(0,0,0,0.3);';
      banner.textContent = '▶ 正在自动播放网课，请勿手动操作';
      document.body.appendChild(banner);
    }
    return banner;
  }

  function ensureOverlay() {
    const v = getVideo();
    if (!v) return null;
    const container = v.parentElement;
    if (!container) return null;

    // 确保容器可定位，遮罩绝对定位覆盖其上
    const cs = getComputedStyle(container);
    if (cs.position === 'static') {
      container.style.position = 'relative';
    }

    let overlay = document.getElementById('__yk_overlay__');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = '__yk_overlay__';
      // 更透明，可看清视频内容
      overlay.style.cssText =
        'position:absolute;top:0;left:0;right:0;bottom:0;z-index:2147483645;' +
        'background:rgba(0,0,0,0.15);display:flex;align-items:center;' +
        'justify-content:center;pointer-events:auto;cursor:not-allowed;';
      const tip = document.createElement('div');
      tip.style.cssText =
        'color:#fff;font-size:15px;background:rgba(0,0,0,0.6);' +
        'padding:12px 20px;border-radius:8px;text-align:center;line-height:1.6;' +
        'opacity:0;transition:opacity 0.2s;pointer-events:none;';
      tip.textContent = '自动播放中，暂不可手动操作';
      overlay.appendChild(tip);
      // 鼠标移入遮罩时才显示文字
      overlay.addEventListener('mouseenter', () => { tip.style.opacity = '1'; });
      overlay.addEventListener('mouseleave', () => { tip.style.opacity = '0'; });
    }
    // 若视频换了容器，把遮罩移动到当前容器
    if (overlay.parentElement !== container) {
      try { container.appendChild(overlay); } catch (e) { /* ignore */ }
    }
    return overlay;
  }

  function refreshOverlay() {
    if (!state.running) return;
    const overlay = ensureOverlay();
    if (overlay) overlay.style.display = 'flex';
  }

  function showAutoplayUI() {
    try { ensureBanner().style.display = 'block'; } catch (e) { /* ignore */ }
    try { refreshOverlay(); } catch (e) { /* ignore */ }
  }

  function hideAutoplayUI() {
    try {
      const b = document.getElementById('__yk_banner__');
      if (b) b.style.display = 'none';
      const o = document.getElementById('__yk_overlay__');
      if (o) o.style.display = 'none';
    } catch (e) { /* ignore */ }
  }

  // 周期性刷新遮罩：手动切换视频时站点会重渲染视频容器，遮罩可能丢失，
  // 每 1 秒检查一次，若遮罩不在当前视频容器上则重新挂载。
  setInterval(() => {
    if (state.running) refreshOverlay();
  }, 1000);

  /* ======================================================================
   * 5. 自动播放主循环
   * ====================================================================== */
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function completionTimeout() {
    const v = getVideo();
    const dur = (v && v.duration > 0) ? v.duration : 600;
    // 按视频时长加足缓冲，避免提前超时跳转
    return Math.max(60000, dur * 1000 + 60000);
  }

  function waitForCompletion(timeoutMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        const v = getVideo();
        // 播放完成：ended 标志，或进度已到结尾。
        // 不再依赖 .control-right 的"已完成"（点击新视频瞬间它是上一条的旧状态，会误判）。
        if (v && (v.ended || (v.duration > 0 && v.currentTime >= v.duration - 0.3))) {
          resolve(true);
          return;
        }
        if (Date.now() - start > timeoutMs) {
          resolve(false);
          return;
        }
        setTimeout(check, 500);
      };
      check();
    });
  }

  async function autoPlayLoop() {
    notifyStatus();

    try {
      expandAllSections();
      await sleep(800);

      let idx = getActiveVideoIndex();
      if (idx < 0) idx = 0;

      while (state.running) {
        // 目录可能因站点重渲染而暂时为空，重试几次
        let videos = getVideoItems();
        for (let retry = 0; retry < 10 && videos.length === 0; retry++) {
          await sleep(500);
          videos = getVideoItems();
        }
        if (videos.length === 0) {
          console.warn('[雨课堂插件] 目录为空，退出自动播放');
          break;
        }
        if (idx >= videos.length) break;

        const item = videos[idx];
        state.currentIndex = idx;
        notifyStatus();

        console.log(`[雨课堂插件] 播放第 ${idx + 1}/${videos.length} 条视频`);

        try {
          item.leaf.scrollIntoView({ block: 'center', behavior: 'smooth' });
        } catch (e) { /* ignore */ }
        await sleep(300);

        item.leaf.click();
        await sleep(1500);

        ensurePlaying();
        showAutoplayUI();
        await sleep(500);

        const done = await waitForCompletion(completionTimeout());
        console.log(done ? '[雨课堂插件] 本条完成' : '[雨课堂插件] 本条超时，跳到下一条');

        if (manualSelectIndex >= 0) {
          // 用户手动点击选择了某条视频，播放完后从它的下一条继续，而非跳回之前跳过的视频
          idx = manualSelectIndex + 1;
          manualSelectIndex = -1;
          console.log(`[雨课堂插件] 从手动选择的下一条继续（第 ${idx + 1} 条）`);
        } else {
          idx++;
        }
      }

      console.log('[雨课堂插件] 全部视频播放完毕');
    } catch (e) {
      console.error('[雨课堂插件] 自动播放出错:', e);
    } finally {
      state.running = false;
      setAutoplayActive(false);
      hideAutoplayUI();
      resetVideo(); // 循环结束（全部播完）后恢复原音量和原速度
      syncTabMute(); // 取消标签页静音
      notifyStatus();
    }
  }

  function startAutoPlay() {
    if (state.running) return; // 防止重复启动
    state.running = true;
    setAutoplayActive(true);
    ensurePlaying();
    showAutoplayUI();
    syncTabMute(); // 若勾选了静音，则静音整个标签页
    autoPlayLoop();
  }

  function stopAutoPlay() {
    state.running = false;
    setAutoplayActive(false);
    hideAutoplayUI();
    resetVideo(); // 恢复原音量和原速度
    syncTabMute(); // 取消标签页静音
    notifyStatus();
  }

  /* ======================================================================
   * 6. 设置持久化（只持久化静音；运行状态是会话级的）
   * ====================================================================== */
  function persist() {
    try {
      chrome.storage.sync.set({ muted: state.muted });
    } catch (e) { /* ignore */ }
  }

  function loadSettings() {
    try {
      chrome.storage.sync.get(DEFAULTS, (s) => {
        state.muted = !!s.muted;
        // 不在加载时应用设置，等自动播放开始时再应用
      });
    } catch (e) { /* ignore */ }
  }

  /* ======================================================================
   * 7. 消息通信（始终注册；未识别课程页时 onCoursePage=false）
   * ====================================================================== */
  function buildStatus() {
    return {
      onCoursePage: state.catalogReady,
      courseName: state.catalogReady ? getCourseName() : '',
      section: state.catalogReady ? getCurrentSection() : '',
      muted: state.muted,
      running: state.running,
      currentIndex: state.currentIndex,
      totalVideos: state.catalogReady ? getVideoItems().length : 0,
    };
  }

  function notifyStatus() {
    try {
      chrome.runtime.sendMessage({ type: 'status', payload: buildStatus() })
        .catch(() => {});
    } catch (e) { /* ignore */ }
  }

  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || !msg.type) return false;
      switch (msg.type) {
        case 'getStatus':
          sendResponse(buildStatus());
          break;
        case 'setMuted':
          state.muted = !!msg.value;
          if (state.running) applyToVideo(); // 仅运行中即时生效
          syncTabMute(); // 同步标签页静音
          persist();
          sendResponse({ ok: true });
          break;
        case 'start':
          if (!state.catalogReady) {
            sendResponse({ ok: false, error: '未检测到课程页，请先打开雨课堂网课学习页' });
          } else {
            startAutoPlay();
            sendResponse({ ok: true });
          }
          break;
        case 'stop':
          stopAutoPlay();
          sendResponse({ ok: true });
          break;
        case 'ping':
          sendResponse({ ok: true, onCoursePage: state.catalogReady });
          break;
        default:
          sendResponse({ ok: false });
      }
      return false;
    });
  } catch (e) {
    console.error('[雨课堂插件] 注册消息监听失败:', e);
  }

  /* ======================================================================
   * 8. 初始化：动态检测目录
   * ====================================================================== */
  function updateCatalogReady() {
    state.catalogReady = hasCatalog();
  }

  try {
    updateCatalogReady();
    if (state.catalogReady) {
      console.log('[雨课堂插件] 已检测到课程目录');
    } else {
      // 目录异步渲染，监听 DOM 变化
      const catalogObserver = new MutationObserver(() => {
        if (hasCatalog()) {
          state.catalogReady = true;
          catalogObserver.disconnect();
          console.log('[雨课堂插件] 检测到课程目录');
          notifyStatus();
        }
      });
      catalogObserver.observe(document.documentElement, { childList: true, subtree: true });
      console.log('[雨课堂插件] 等待课程目录渲染…');
    }

    loadSettings();

    console.log('[雨课堂插件] 初始化完成');
  } catch (e) {
    console.error('[雨课堂插件] 初始化失败:', e);
  }
})();
