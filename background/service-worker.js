/**
 * 自动播放雨课堂插件 - 后台服务
 * 负责：设置默认值、响应内容脚本的"标签页静音/取消静音"请求。
 */

const DEFAULTS = { muted: false };

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(DEFAULTS, (s) => {
    chrome.storage.sync.set({
      muted: s.muted != null ? s.muted : DEFAULTS.muted,
    });
  });
});

// 内容脚本请求静音/取消静音当前标签页（浏览器级静音，站点 JS 无法覆盖，杜绝声音闪烁）
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type || !sender.tab || sender.tab.id == null) return false;

  if (msg.type === 'muteTab') {
    chrome.tabs.update(sender.tab.id, { muted: true }, () => {
      if (chrome.runtime.lastError) { /* ignore */ }
    });
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'unmuteTab') {
    chrome.tabs.update(sender.tab.id, { muted: false }, () => {
      if (chrome.runtime.lastError) { /* ignore */ }
    });
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
