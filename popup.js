/**
 * popup.js — 設定面板：讀寫 chrome.storage.sync 的單一設定物件
 * Settings panel bound to the shared schema in src/config.js.
 *
 * Updated: 2026-08-05
 * v2.0 這裡寫的是 chrome.storage.local 的四個扁平鍵，content script 讀的卻是
 * chrome.storage.sync 的 yt_auto_resizer_settings —— 兩邊從來沒對上，設定完全無效。
 * v3.0 起面板全面走 chrome.i18n（en / zh_TW / ja），HTML 裡的字只是 fallback。
 */

/** 把 data-i18n / data-i18n-aria-label 的節點就地換成在地化文字（`yarMessage` 來自 src/config.js） */
function yarLocalizeDocument(root) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    // fallback 用節點現有的文字，而不是空字串：翻譯缺漏時保留英文比留白好
    el.textContent = yarMessage(el.dataset.i18n, el.textContent.trim());
  });
  root.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    el.setAttribute(
      'aria-label',
      yarMessage(el.dataset.i18nAriaLabel, el.getAttribute('aria-label') || '')
    );
  });
  if (typeof chrome !== 'undefined' && chrome.i18n && typeof chrome.i18n.getUILanguage === 'function') {
    document.documentElement.lang = chrome.i18n.getUILanguage();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  yarLocalizeDocument(document);

  const elements = {
    enabled: document.getElementById('enabled-toggle'),
    quality: document.getElementById('quality-select'),
    removeSideGaps: document.getElementById('removeSideGaps-toggle'),
    resizeMainWindow: document.getElementById('resizeMainWindow-toggle'),
    displayAwareQuality: document.getElementById('displayAwareQuality-toggle'),
    autoQualityCeiling: document.getElementById('autoQualityCeiling-select'),
    popupTargetDisplay: document.getElementById('popupTargetDisplay-select'),
    displayList: document.getElementById('display-list'),
    status: document.getElementById('status-text'),
    versionBadge: document.getElementById('version-badge'),
    modeRadios: document.querySelectorAll('input[name="resizeMode"]')
  };

  const STATUS_STYLE = {
    on: { text: yarMessage('statusEnabled', 'Active'), color: '#00e676' },
    off: { text: yarMessage('statusDisabled', 'Paused'), color: '#8e8e99' }
  };

  const TIER_LABEL = {
    uhd: yarMessage('tierUhd', '4K'),
    hidpi: yarMessage('tierHidpi', 'HiDPI'),
    standard: yarMessage('tierStandard', 'Standard')
  };

  /*
   * 版本號從 manifest 讀，不寫死在 HTML 裡。
   * 這裡原本硬編碼 `v2.3`，而 manifest 是 `2.3.0` —— 兩份數字遲早會漂移，
   * 而且漂移的那一刻沒有任何測試會紅。
   */
  if (elements.versionBadge && typeof chrome !== 'undefined' && chrome.runtime
    && typeof chrome.runtime.getManifest === 'function') {
    elements.versionBadge.textContent = `v${chrome.runtime.getManifest().version}`;
  }

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
    elements.displayAwareQuality.checked = settings.displayAwareQuality;
    elements.autoQualityCeiling.value = settings.autoQualityCeiling;
    elements.popupTargetDisplay.value = settings.popupTargetDisplay;

    const activeRadio = document.querySelector(`input[name="resizeMode"][value="${settings.resizeMode}"]`);
    if (activeRadio) activeRadio.checked = true;

    renderStatus(settings.enabled);
  }

  /**
   * 每個欄位都必須列在這裡。漏掉一個，儲存時 yarNormalizeSettings 會拿預設值把它補回去，
   * 使用者的選擇就在下一次改動任何設定時被靜靜洗掉。
   */
  function readForm() {
    const checkedMode = document.querySelector('input[name="resizeMode"]:checked');
    return {
      enabled: elements.enabled.checked,
      resizeMode: checkedMode ? checkedMode.value : YAR_DEFAULT_SETTINGS.resizeMode,
      preferredQuality: elements.quality.value,
      removeSideGaps: elements.removeSideGaps.checked,
      resizeMainWindow: elements.resizeMainWindow.checked,
      displayAwareQuality: elements.displayAwareQuality.checked,
      autoQualityCeiling: elements.autoQualityCeiling.value,
      popupTargetDisplay: elements.popupTargetDisplay.value
    };
  }

  // ------------------------------------------------------------ 顯示器清單

  function buildDisplayRow(display, isCurrent) {
    const row = document.createElement('li');
    row.className = `display-row${isCurrent ? ' display-row--current' : ''}`;

    const name = document.createElement('span');
    name.textContent = isCurrent
      ? yarMessage('displayCurrent', `${display.label} (current)`, [display.label])
      : display.label;

    const tier = document.createElement('span');
    const tierKey = TIER_LABEL[display.tier] ? display.tier : 'standard';
    tier.className = `display-tier${tierKey === 'uhd' ? ' display-tier--uhd' : ''}`;
    tier.textContent = TIER_LABEL[tierKey];

    row.append(name, tier);
    return row;
  }

  function renderDisplays(response) {
    const list = elements.displayList;
    list.textContent = '';

    const displays = response && Array.isArray(response.displays) ? response.displays : [];
    if (displays.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'display-row display-row--empty';
      empty.textContent = yarMessage('displayUnavailable', 'Display information unavailable');
      list.append(empty);
      return;
    }

    displays.forEach((display) => {
      list.append(buildDisplayRow(display, display.id === response.currentId));
    });
  }

  /**
   * 顯示器資訊只有 service worker 拿得到（chrome.system.display 不開放給頁面）。
   * DPR 反過來只有這裡拿得到，所以一併送過去——service worker 會把它套用在
   * 「popup 目前所在的那一台」螢幕上（macOS 的 display API 完全不提供 dpi 資訊）。
   */
  function loadDisplays() {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return;
    chrome.runtime.sendMessage(
      { action: YAR_MSG.GET_DISPLAYS, dpr: window.devicePixelRatio },
      (response) => {
        if (chrome.runtime.lastError) {
          yarWarn('取得顯示器資訊失敗:', chrome.runtime.lastError.message);
          renderDisplays(null);
          return;
        }
        renderDisplays(response);
      }
    );
  }

  function handleChange() {
    const next = readForm();
    renderStatus(next.enabled);
    yarSaveSettings(next).catch((err) => {
      yarWarn('儲存設定失敗:', err.message);
      elements.status.textContent = yarMessage('statusSaveFailed', 'Save failed');
      elements.status.style.color = '#ff5252';
    });
  }

  yarLoadSettings().then(renderSettings);
  loadDisplays();

  [
    elements.enabled,
    elements.quality,
    elements.removeSideGaps,
    elements.resizeMainWindow,
    elements.displayAwareQuality,
    elements.autoQualityCeiling,
    elements.popupTargetDisplay
  ].forEach((el) => el.addEventListener('change', handleChange));
  elements.modeRadios.forEach((radio) => radio.addEventListener('change', handleChange));
});
