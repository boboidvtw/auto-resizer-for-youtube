(function() {
  console.log('[YouTube Auto Resizer] Main world injected script running.');

  let lastDimensions = '';

  function mapHeightToQuality(w, h) {
    if (h >= 3800 || w >= 7000) return 'highres';
    if (h >= 2000 || w >= 3500) return 'hd2160';
    if (h >= 1400 || w >= 2500) return 'hd1440';
    if (h >= 1000 || w >= 1800) return 'hd1080';
    if (h >= 700  || w >= 1200) return 'hd720';
    if (h >= 450  || w >= 800)  return 'large';
    if (h >= 300  || w >= 600)  return 'medium';
    if (h >= 200)               return 'small';
    return 'tiny';
  }

  function checkQualityAndSize() {
    const isWatchPage = window.location.pathname.startsWith('/watch') || !!document.querySelector('ytd-watch-flexy');
    if (!isWatchPage) return;

    const moviePlayer = document.getElementById('movie_player');
    const video = document.querySelector('video');
    
    let quality = '';
    if (moviePlayer && typeof moviePlayer.getPlaybackQuality === 'function') {
      quality = moviePlayer.getPlaybackQuality();
    }

    let videoW = video ? video.videoWidth : 0;
    let videoH = video ? video.videoHeight : 0;

    // If quality is auto or unknown, map from video dimensions
    if ((!quality || quality === 'auto') && videoH > 0) {
      quality = mapHeightToQuality(videoW, videoH);
    }

    if (!quality && videoH === 0) return;

    const dimKey = `${quality}_${videoW}x${videoH}`;
    if (dimKey !== lastDimensions) {
      lastDimensions = dimKey;

      console.log(`[YouTube Auto Resizer] Quality Event Dispatched: ${quality} (${videoW}x${videoH})`);

      // Dispatch event on document (shared between Main World and Isolated World)
      document.dispatchEvent(new CustomEvent('YT_AUTO_RESIZER_QUALITY_CHANGED', {
        bubbles: true,
        detail: {
          quality: quality,
          videoWidth: videoW,
          videoHeight: videoH,
          videoId: (moviePlayer && typeof moviePlayer.getVideoData === 'function') ? (moviePlayer.getVideoData().video_id || '') : ''
        }
      }));
    }
  }

  function initPlayerHooks() {
    const moviePlayer = document.getElementById('movie_player');
    const video = document.querySelector('video');

    if (moviePlayer && typeof moviePlayer.addEventListener === 'function') {
      try {
        moviePlayer.addEventListener('onPlaybackQualityChange', () => {
          setTimeout(checkQualityAndSize, 50);
        });
        moviePlayer.addEventListener('onPlayerStateChange', () => {
          setTimeout(checkQualityAndSize, 50);
        });
      } catch (e) {}
    }

    if (video) {
      video.removeEventListener('resize', checkQualityAndSize);
      video.removeEventListener('loadedmetadata', checkQualityAndSize);
      video.addEventListener('resize', checkQualityAndSize);
      video.addEventListener('loadedmetadata', checkQualityAndSize);
      video.addEventListener('playing', checkQualityAndSize);
    }

    checkQualityAndSize();
  }

  // Hook YouTube SPA navigation & DOM events
  document.addEventListener('yt-navigate-finish', initPlayerHooks);
  document.addEventListener('yt-page-data-updated', initPlayerHooks);
  document.addEventListener('spfdone', initPlayerHooks);

  const observer = new MutationObserver(() => {
    const video = document.querySelector('video');
    if (video && !video.dataset.ytResizerBound) {
      video.dataset.ytResizerBound = 'true';
      initPlayerHooks();
    }
  });

  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

  setInterval(checkQualityAndSize, 500);

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initPlayerHooks();
  } else {
    document.addEventListener('DOMContentLoaded', initPlayerHooks);
  }
})();
