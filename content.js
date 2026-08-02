(function() {
  'use strict';

  console.log('[YouTube Auto Resizer] Content Script initialized.');

  let config = {
    enabled: true,
    quality: '2160p',
    resizeMode: 'autoByQuality', // 'autoByQuality' | 'fitWindow' | 'theater' | 'default'
    removeSideGaps: true
  };

  let activeEffectiveMode = 'fitWindow';

  function injectPageScript() {
    if (document.getElementById('yt-auto-resizer-pagescript')) return;
    const script = document.createElement('script');
    script.id = 'yt-auto-resizer-pagescript';
    script.src = chrome.runtime.getURL('pageScript.js');
    (document.head || document.documentElement).appendChild(script);
    script.onload = function() {
      script.remove();
      applyCurrentSettings();
    };
  }

  // Update dynamic CSS rules
  function updateCSSRules() {
    let styleEl = document.getElementById('yt-auto-resizer-style');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'yt-auto-resizer-style';
      (document.head || document.documentElement).appendChild(styleEl);
    }

    if (!config.enabled) {
      styleEl.textContent = '';
      return;
    }

    let css = '';

    if (activeEffectiveMode === 'fitWindow' || activeEffectiveMode === 'theater') {
      css += `
        /* Dynamic 16:9 aspect-ratio height calculation & Zero Top/Bottom Gaps */
        ytd-watch-flexy[theater] {
          --ytd-watch-flex-max-player-height: min(calc(100vh - 56px), 56.25vw) !important;
          --ytd-watch-flex-min-player-height: min(calc(100vh - 56px), 56.25vw) !important;
          --ytd-watch-flex-max-player-width: 100vw !important;
        }

        ytd-watch-flexy[theater] #player-theater-container,
        ytd-watch-flexy[theater] #player-full-bleed-container {
          height: min(calc(100vh - 56px), 56.25vw) !important;
          min-height: unset !important;
          max-height: calc(100vh - 56px) !important;
        }

        /* Prevent overlap by cleanly placing #columns below the player */
        ytd-watch-flexy[theater] #columns {
          position: relative !important;
          margin-top: 0 !important;
          top: 0 !important;
          clear: both !important;
          z-index: 10 !important;
          max-width: 100% !important;
        }
      `;
    }

    if (config.removeSideGaps && (activeEffectiveMode === 'fitWindow' || activeEffectiveMode === 'theater')) {
      css += `
        ytd-watch-flexy[theater] #player-theater-container {
          width: 100% !important;
        }
        #page-manager.ytd-app {
          margin-left: 0 !important;
          margin-right: 0 !important;
        }
      `;
    }

    styleEl.textContent = css;
  }

  function postToPage(action, payload) {
    window.postMessage({
      type: 'YT_AUTO_RESIZER_ACTION',
      action: action,
      payload: payload
    }, '*');
  }

  // Ensure theater mode state matches target mode reliably
  function ensureTheaterState(targetEnable, attempts = 0) {
    const watchFlexy = document.querySelector('ytd-watch-flexy');
    const theaterBtn = document.querySelector('.ytp-size-button');

    if (watchFlexy) {
      const isTheater = watchFlexy.hasAttribute('theater');
      if (targetEnable && !isTheater) {
        if (theaterBtn) {
          const evt = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
          theaterBtn.dispatchEvent(evt);
        }
        watchFlexy.setAttribute('theater', '');
        window.dispatchEvent(new Event('resize'));
      } else if (!targetEnable && isTheater) {
        if (theaterBtn) {
          const evt = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
          theaterBtn.dispatchEvent(evt);
        }
        watchFlexy.removeAttribute('theater');
        window.dispatchEvent(new Event('resize'));
      }
    } else if (attempts < 15) {
      setTimeout(() => ensureTheaterState(targetEnable, attempts + 1), 250);
    }
  }

  // Map video quality level string to size mode
  function getModeFromQuality(quality) {
    if (!quality) return 'fitWindow';
    const q = String(quality).toLowerCase();
    if (q.includes('2160') || q.includes('1440') || q.includes('highres') || q.includes('4k') || q.includes('2k')) {
      return 'fitWindow'; // 4K / 2K -> Full Window Fit (Big Player)
    } else if (q.includes('1080')) {
      return 'theater';   // 1080p -> Theater Mode
    } else if (q.includes('720') || q.includes('large') || q.includes('medium') || q.includes('small') || q.includes('tiny')) {
      return 'default';   // SD / 720p -> Default Size
    }
    return 'fitWindow';   // Fallback to Fit Window
  }

  function applyCurrentSettings() {
    if (!config.enabled) return;

    if (config.resizeMode === 'autoByQuality') {
      activeEffectiveMode = getModeFromQuality(config.quality);
    } else {
      activeEffectiveMode = config.resizeMode;
    }

    updateCSSRules();

    if (activeEffectiveMode === 'fitWindow' || activeEffectiveMode === 'theater') {
      ensureTheaterState(true);
    } else if (activeEffectiveMode === 'default') {
      ensureTheaterState(false);
    }

    if (config.quality) {
      postToPage('SET_QUALITY', { quality: config.quality });
    }
  }

  function loadConfig() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['enabled', 'quality', 'resizeMode', 'removeSideGaps'], function(res) {
        if (res.enabled !== undefined) config.enabled = res.enabled;
        if (res.quality) config.quality = res.quality;
        if (res.resizeMode) config.resizeMode = res.resizeMode || 'autoByQuality';
        if (res.removeSideGaps !== undefined) config.removeSideGaps = res.removeSideGaps;

        applyCurrentSettings();
      });
    } else {
      applyCurrentSettings();
    }
  }

  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.onChanged.addListener(function(changes, namespace) {
      if (namespace === 'local') {
        for (let key in changes) {
          config[key] = changes[key].newValue;
        }
        applyCurrentSettings();
      }
    });
  }

  // Handle detected quality from page script
  window.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'YT_AUTO_RESIZER_QUALITY_DETECTED') {
      if (config.resizeMode === 'autoByQuality' && event.data.quality) {
        const matchedMode = getModeFromQuality(event.data.quality);
        if (matchedMode !== activeEffectiveMode) {
          activeEffectiveMode = matchedMode;
          updateCSSRules();
          ensureTheaterState(matchedMode === 'fitWindow' || matchedMode === 'theater');
        }
      }
    } else if (event.data && event.data.type === 'YT_AUTO_RESIZER_PAGE_NAVIGATED') {
      setTimeout(applyCurrentSettings, 500);
    }
  });

  function init() {
    injectPageScript();
    loadConfig();

    document.addEventListener('yt-navigate-finish', function() {
      setTimeout(applyCurrentSettings, 500);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
