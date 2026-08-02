/**
 * injected.js — 主世界（MAIN world）畫質偵測器
 * Detects the current playback quality / video dimensions and reports them
 * to the isolated world via a document CustomEvent.
 *
 * Updated: 2026-08-02
 * 主世界拿不到 src/config.js 的常數，故本檔自成一體。
 * 職責單一：只偵測與回報，不改動任何畫面。
 */

(function () {
  'use strict';

  const EVENT_NAME = 'YT_AUTO_RESIZER_QUALITY_CHANGED';
  const REQUEST_STATE_EVENT = 'YT_AUTO_RESIZER_REQUEST_STATE';
  const SAFETY_POLL_MS = 2000;      // 事件漏接時的保險輪詢
  const HOOK_RETRY_MS = 400;
  const HOOK_MAX_RETRIES = 25;
  const QUALITY_SETTLE_MS = 50;

  /** 畫質為 auto/未知時，用實際解析度回推畫質代碼 */
  const QUALITY_THRESHOLDS = [
    { quality: 'highres', minHeight: 3800, minWidth: 7000 },
    { quality: 'hd2160', minHeight: 2000, minWidth: 3500 },
    { quality: 'hd1440', minHeight: 1400, minWidth: 2500 },
    { quality: 'hd1080', minHeight: 1000, minWidth: 1800 },
    { quality: 'hd720', minHeight: 700, minWidth: 1200 },
    { quality: 'large', minHeight: 450, minWidth: 800 },
    { quality: 'medium', minHeight: 300, minWidth: 600 },
    { quality: 'small', minHeight: 200, minWidth: 0 }
  ];

  let lastSignature = '';
  let hookRetries = 0;
  let hookTimer = null;
  let boundVideo = null;

  function isWatchPage() {
    return window.location.pathname.startsWith('/watch') || !!document.querySelector('ytd-watch-flexy');
  }

  function getPlayer() {
    return document.getElementById('movie_player') || document.querySelector('.html5-video-player');
  }

  function mapDimensionsToQuality(width, height) {
    const match = QUALITY_THRESHOLDS.find((entry) => height >= entry.minHeight || (entry.minWidth && width >= entry.minWidth));
    return match ? match.quality : 'tiny';
  }

  function readVideoId(player) {
    if (!player || typeof player.getVideoData !== 'function') return '';
    try {
      return player.getVideoData().video_id || '';
    } catch (err) {
      return '';
    }
  }

  function checkQualityAndSize() {
    if (!isWatchPage()) return;

    const player = getPlayer();
    const video = document.querySelector('video');
    const videoWidth = video ? video.videoWidth : 0;
    const videoHeight = video ? video.videoHeight : 0;

    let quality = '';
    if (player && typeof player.getPlaybackQuality === 'function') {
      try {
        quality = player.getPlaybackQuality();
      } catch (err) {
        quality = '';
      }
    }
    if ((!quality || quality === 'auto') && videoHeight > 0) {
      quality = mapDimensionsToQuality(videoWidth, videoHeight);
    }
    if (!quality) return;

    const signature = `${quality}_${videoWidth}x${videoHeight}`;
    if (signature === lastSignature) return;
    lastSignature = signature;

    document.dispatchEvent(
      new CustomEvent(EVENT_NAME, {
        bubbles: true,
        detail: { quality, videoWidth, videoHeight, videoId: readVideoId(player) }
      })
    );
  }

  const onQualitySettled = () => setTimeout(checkQualityAndSize, QUALITY_SETTLE_MS);

  function bindVideoElement(video) {
    if (!video || video === boundVideo) return;
    boundVideo = video;
    ['resize', 'loadedmetadata', 'playing'].forEach((type) => {
      video.addEventListener(type, checkQualityAndSize);
    });
  }

  function initPlayerHooks() {
    const player = getPlayer();
    const video = document.querySelector('video');

    if (player && typeof player.addEventListener === 'function' && !player.dataset.yarHooked) {
      try {
        player.dataset.yarHooked = 'true';
        player.addEventListener('onPlaybackQualityChange', onQualitySettled);
        player.addEventListener('onPlayerStateChange', onQualitySettled);
      } catch (err) {
        /* 播放器 API 尚未就緒，交給下方的有界重試 */
      }
    }

    bindVideoElement(video);
    checkQualityAndSize();
    return !!(player && video);
  }

  /** 有界重試取代原本的全域 MutationObserver，避免在 YouTube 上長期監聽整棵 DOM */
  function scheduleHookInit() {
    if (hookTimer) clearTimeout(hookTimer);
    hookRetries = 0;
    const attempt = () => {
      hookTimer = null;
      if (initPlayerHooks() || !isWatchPage()) return;
      if (++hookRetries > HOOK_MAX_RETRIES) return;
      hookTimer = setTimeout(attempt, HOOK_RETRY_MS);
    };
    attempt();
  }

  function handleNavigation() {
    lastSignature = '';
    boundVideo = null;
    scheduleHookInit();
  }

  /*
   * 同一支影片的狀態只會廣播一次（靠 lastSignature 去重）。若隔離世界的 content script
   * 晚一步才註冊監聽器，就會永遠等不到事件；因此提供重播入口讓它主動索取。
   */
  document.addEventListener(REQUEST_STATE_EVENT, () => {
    lastSignature = '';
    checkQualityAndSize();
  });

  document.addEventListener('yt-navigate-finish', handleNavigation);
  document.addEventListener('yt-page-data-updated', handleNavigation);

  setInterval(checkQualityAndSize, SAFETY_POLL_MS);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleHookInit);
  } else {
    scheduleHookInit();
  }
})();
