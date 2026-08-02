/**
 * pageScript.js — 主世界（MAIN world）畫質控制器
 * Applies the user's preferred playback quality through YouTube's native player API.
 *
 * Updated: 2026-08-02
 * v2.0 時本檔從未被任何程式載入（死碼），README 宣傳的「畫質鎖定」因此並不存在。
 * 現由 content.js 一併注入，並以 postMessage 接收指令。
 * 職責單一：只設定畫質，不偵測、不改版面。
 */

(function () {
  'use strict';

  const ACTION_TYPE = 'YT_AUTO_RESIZER_ACTION';
  const SET_QUALITY = 'SET_QUALITY';
  const APPLY_RETRY_MS = 500;
  const APPLY_MAX_RETRIES = 10;

  // 與 src/config.js 的 YAR_QUALITY_ALIAS 對應；主世界讀不到隔離世界的常數，故此處重複一份。
  const QUALITY_ALIAS = {
    '2160p': 'hd2160',
    '1440p': 'hd1440',
    '1080p': 'hd1080',
    '720p': 'hd720',
    '480p': 'large',
    '360p': 'medium',
    '240p': 'small',
    '144p': 'tiny'
  };

  function getPlayer() {
    return document.getElementById('movie_player') || document.querySelector('.html5-video-player');
  }

  /**
   * @returns {boolean} 是否已完成設定（false 代表播放器尚未就緒，值得重試）
   */
  function applyQuality(requestedLabel) {
    const requested = QUALITY_ALIAS[requestedLabel];
    if (!requested) return true; // 未知或 auto：不干預

    const player = getPlayer();
    if (!player || typeof player.getAvailableQualityLevels !== 'function') return false;

    try {
      const available = player.getAvailableQualityLevels();
      if (!available || available.length === 0) return false;

      // available 由高到低排序；沒有指定畫質時退而求其次選最接近的最高畫質
      const selected = available.includes(requested) ? requested : available[0];

      if (typeof player.setPlaybackQualityRange === 'function') {
        player.setPlaybackQualityRange(selected, selected);
      }
      if (typeof player.setPlaybackQuality === 'function') {
        player.setPlaybackQuality(selected);
      }
      return true;
    } catch (err) {
      console.warn('[YouTube Auto Resizer] 設定畫質失敗:', err.message);
      return true; // 失敗不重試，避免與使用者手動選擇互相拉扯
    }
  }

  function applyQualityWithRetry(label, attempt = 0) {
    if (applyQuality(label) || attempt >= APPLY_MAX_RETRIES) return;
    setTimeout(() => applyQualityWithRetry(label, attempt + 1), APPLY_RETRY_MS);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.type !== ACTION_TYPE || data.action !== SET_QUALITY) return;
    if (!data.payload || typeof data.payload.quality !== 'string') return;
    applyQualityWithRetry(data.payload.quality);
  });
})();
