/**
 * popup.js — 設定面板：讀寫 chrome.storage.sync 的單一設定物件
 * Settings panel bound to the shared schema in src/config.js.
 *
 * Updated: 2026-08-02
 * v2.0 這裡寫的是 chrome.storage.local 的四個扁平鍵，content script 讀的卻是
 * chrome.storage.sync 的 yt_auto_resizer_settings —— 兩邊從來沒對上，設定完全無效。
 */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const elements = {
    enabled: document.getElementById('enabled-toggle'),
    quality: document.getElementById('quality-select'),
    removeSideGaps: document.getElementById('removeSideGaps-toggle'),
    resizeMainWindow: document.getElementById('resizeMainWindow-toggle'),
    status: document.getElementById('status-text'),
    modeRadios: document.querySelectorAll('input[name="resizeMode"]')
  };

  const STATUS_STYLE = {
    on: { text: '已啟用', color: '#00e676' },
    off: { text: '已停用', color: '#8e8e99' }
  };

  function renderStatus(enabled) {
    const style = enabled ? STATUS_STYLE.on : STATUS_STYLE.off;
    elements.status.textContent = style.text;
    elements.status.style.color = style.color;
  }

  function renderSettings(settings) {
    elements.enabled.checked = settings.enabled;
    elements.quality.value = settings.preferredQuality;
    elements.removeSideGaps.checked = settings.removeSideGaps;
    elements.resizeMainWindow.checked = settings.resizeMainWindow;

    const activeRadio = document.querySelector(`input[name="resizeMode"][value="${settings.resizeMode}"]`);
    if (activeRadio) activeRadio.checked = true;

    renderStatus(settings.enabled);
  }

  function readForm() {
    const checkedMode = document.querySelector('input[name="resizeMode"]:checked');
    return {
      enabled: elements.enabled.checked,
      resizeMode: checkedMode ? checkedMode.value : YAR_DEFAULT_SETTINGS.resizeMode,
      preferredQuality: elements.quality.value,
      removeSideGaps: elements.removeSideGaps.checked,
      resizeMainWindow: elements.resizeMainWindow.checked
    };
  }

  function handleChange() {
    const next = readForm();
    renderStatus(next.enabled);
    yarSaveSettings(next).catch((err) => {
      yarWarn('儲存設定失敗:', err.message);
      elements.status.textContent = '儲存失敗';
      elements.status.style.color = '#ff5252';
    });
  }

  yarLoadSettings().then(renderSettings);

  elements.enabled.addEventListener('change', handleChange);
  elements.quality.addEventListener('change', handleChange);
  elements.removeSideGaps.addEventListener('change', handleChange);
  elements.resizeMainWindow.addEventListener('change', handleChange);
  elements.modeRadios.forEach((radio) => radio.addEventListener('change', handleChange));
});
