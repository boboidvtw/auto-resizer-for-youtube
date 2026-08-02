(function() {
  'use strict';

  console.log('[YouTube Auto Resizer] PageScript loaded.');

  function getPlayer() {
    return document.getElementById('movie_player') || document.querySelector('.html5-video-player');
  }

  const QUALITY_MAP = {
    '2160p': 'hd2160',
    '1440p': 'hd1440',
    '1080p': 'hd1080',
    '720p': 'hd720',
    '480p': 'large',
    '360p': 'medium',
    '240p': 'small',
    '144p': 'tiny',
    'auto': 'auto'
  };

  function applyQuality(targetQuality) {
    const player = getPlayer();
    if (!player) return false;

    const requested = QUALITY_MAP[targetQuality] || targetQuality;

    try {
      if (typeof player.getAvailableQualityLevels === 'function') {
        const available = player.getAvailableQualityLevels();

        let selectedQuality = requested;
        if (available && available.length > 0 && !available.includes(requested) && requested !== 'auto') {
          selectedQuality = available[0];
        }

        if (typeof player.setPlaybackQualityRange === 'function') {
          player.setPlaybackQualityRange(selectedQuality, selectedQuality);
        }
        if (typeof player.setPlaybackQuality === 'function') {
          player.setPlaybackQuality(selectedQuality);
        }
        notifyCurrentQuality();
        return true;
      }
    } catch (err) {
      console.warn('[YouTube Auto Resizer] Quality error:', err);
    }
    return false;
  }

  function notifyCurrentQuality() {
    const player = getPlayer();
    if (player && typeof player.getPlaybackQuality === 'function') {
      const q = player.getPlaybackQuality();
      window.postMessage({
        type: 'YT_AUTO_RESIZER_QUALITY_DETECTED',
        quality: q
      }, '*');
    }
  }

  // Attach quality change listener
  setInterval(function() {
    notifyCurrentQuality();
  }, 1500);

  window.addEventListener('message', function(event) {
    if (event.source !== window || !event.data || event.data.type !== 'YT_AUTO_RESIZER_ACTION') {
      return;
    }

    const { action, payload } = event.data;

    if (action === 'SET_QUALITY') {
      applyQuality(payload.quality);
    }
  });

})();
