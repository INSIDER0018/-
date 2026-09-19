/**
 * 自动播放雨课堂插件 - popup 脚本
 */
(function () {
  'use strict';

  const DEFAULTS = { muted: false };

  const els = {
    courseName: document.getElementById('courseName'),
    section: document.getElementById('section'),
    progress: document.getElementById('progress'),
    muteToggle: document.getElementById('muteToggle'),
    startBtn: document.getElementById('startBtn'),
    message: document.getElementById('message'),
  };

  let currentState = {
    muted: DEFAULTS.muted,
    running: false,
    onCoursePage: false,
  };

  /* ---------- 消息提示 ---------- */
  function showMessage(text, type) {
    if (!els.message) return;
    els.message.textContent = text;
    els.message.className = 'message ' + (type || 'info');
    els.message.style.display = 'block';
    clearTimeout(showMessage._t);
    showMessage._t = setTimeout(() => {
      els.message.style.display = 'none';
    }, 3000);
  }

  /* ---------- 与当前标签页的内容脚本通信 ---------- */
  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0];
  }

  function sendToContent(msg) {
    return new Promise((resolve) => {
      getActiveTab().then((tab) => {
        if (!tab || !tab.id) { resolve(null); return; }
        chrome.tabs.sendMessage(tab.id, msg, (resp) => {
          if (chrome.runtime.lastError) {
            resolve(null); // 内容脚本未响应（不在课程页或未注入）
            return;
          }
          resolve(resp);
        });
      });
    });
  }

  /* ---------- 状态刷新 ---------- */
  async function refreshStatus() {
    const status = await sendToContent({ type: 'getStatus' });

    if (!status) {
      // 内容脚本没响应：不在匹配域名的页面，或页面未刷新
      currentState.onCoursePage = false;
      currentState.running = false;
      renderNotDetected();
      return;
    }

    currentState = { ...currentState, ...status };
    currentState.onCoursePage = !!status.onCoursePage;
    currentState.running = !!status.running;

    if (currentState.onCoursePage) {
      render(status);
    } else {
      renderNotDetected();
    }
  }

  function renderNotDetected() {
    els.courseName.textContent = '未检测到课程页';
    els.section.textContent = '请打开雨课堂网课学习页';
    els.progress.textContent = '—';
    renderStartBtn();
  }

  function render(status) {
    els.courseName.textContent = status.courseName || '—';
    els.section.textContent = status.section || '—';
    if (status.totalVideos > 0) {
      const idx = status.currentIndex >= 0 ? status.currentIndex + 1 : '—';
      els.progress.textContent = `${idx} / ${status.totalVideos}`;
    } else {
      els.progress.textContent = '—';
    }

    els.muteToggle.checked = !!status.muted;

    currentState.running = !!status.running;
    renderStartBtn();
  }

  function renderStartBtn() {
    if (currentState.running) {
      els.startBtn.textContent = '停止自动播放';
      els.startBtn.classList.add('running');
    } else {
      els.startBtn.textContent = '开始自动播放';
      els.startBtn.classList.remove('running');
    }
  }

  /* ---------- 设置读写 ---------- */
  function loadSettings() {
    chrome.storage.sync.get(DEFAULTS, (s) => {
      currentState.muted = !!s.muted;
      els.muteToggle.checked = currentState.muted;
    });
  }

  /* ---------- 事件绑定 ---------- */
  els.muteToggle.addEventListener('change', async () => {
    currentState.muted = els.muteToggle.checked;
    await sendToContent({ type: 'setMuted', value: currentState.muted });
  });

  els.startBtn.addEventListener('click', async () => {
    if (currentState.running) {
      // 停止
      await sendToContent({ type: 'stop' });
      currentState.running = false;
      renderStartBtn();
      return;
    }

    // 启动前：先确认当前是否在课程页
    if (!currentState.onCoursePage) {
      showMessage('未检测到课程页，请先打开雨课堂网课学习页', 'error');
      return;
    }

    const resp = await sendToContent({ type: 'start' });
    if (resp && resp.ok === false) {
      showMessage(resp.error || '启动失败', 'error');
      currentState.running = false;
      renderStartBtn();
      return;
    }
    if (resp && resp.ok) {
      currentState.running = true;
      renderStartBtn();
      showMessage('已开始自动播放', 'success');
    } else {
      showMessage('未检测到课程页，请先打开雨课堂网课学习页', 'error');
    }

    setTimeout(refreshStatus, 600);
  });

  /* ---------- 监听内容脚本状态推送 ---------- */
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'status' && msg.payload) {
      currentState = { ...currentState, ...msg.payload };
      currentState.onCoursePage = !!msg.payload.onCoursePage;
      currentState.running = !!msg.payload.running;
      if (currentState.onCoursePage) {
        render(msg.payload);
      } else {
        renderNotDetected();
      }
    }
  });

  /* ---------- 初始化 ---------- */
  loadSettings();
  refreshStatus();
})();
