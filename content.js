(function() {
  console.log('[YouTube Auto Resizer] Content script loaded.');

  const DEFAULT_SETTINGS = {
    enabledInPage: true,
    enabledPopup: true,
    resizeMainWindowInPage: true,
    maxScreenSafeguard: true,
    aspectRatioOffsetHeight: 80,
    aspectRatioOffsetWidth: 16,
    qualityMap: {
      'highres': { width: 7680, height: 4320 },
      'hd2160':  { width: 3840, height: 2160 },
      'hd1440':  { width: 2560, height: 1440 },
      'hd1080':  { width: 1920, height: 1080 },
      'hd720':   { width: 1280, height: 720 },
      'large':    { width: 854,  height: 480 },
      'medium':   { width: 640,  height: 360 },
      'small':    { width: 426,  height: 240 },
      'tiny':     { width: 256,  height: 144 }
    }
  };

  let currentSettings = Object.assign({}, DEFAULT_SETTINGS);
  let lastAppliedQuality = null;
  let lastAppliedVideoW = 0;
  let lastAppliedVideoH = 0;

  // Synchronously fetch and listen to storage
  function updateSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(['yt_auto_resizer_settings'], (result) => {
        if (result && result.yt_auto_resizer_settings) {
          currentSettings = Object.assign({}, DEFAULT_SETTINGS, result.yt_auto_resizer_settings);
          if (lastAppliedQuality) {
            applyInPagePlayerSize(lastAppliedQuality, lastAppliedVideoW, lastAppliedVideoH);
          }
        }
      });
    }
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        chrome.runtime.sendMessage({ action: 'GET_SETTINGS' }, (settings) => {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) return;
          if (settings) {
            currentSettings = Object.assign({}, DEFAULT_SETTINGS, settings);
            if (lastAppliedQuality) {
              applyInPagePlayerSize(lastAppliedQuality, lastAppliedVideoW, lastAppliedVideoH);
            }
          }
        });
      } catch (e) {}
    }
  }
  updateSettings();

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.yt_auto_resizer_settings) {
        currentSettings = Object.assign({}, DEFAULT_SETTINGS, changes.yt_auto_resizer_settings.newValue);
        if (lastAppliedQuality) {
          applyInPagePlayerSize(lastAppliedQuality, lastAppliedVideoW, lastAppliedVideoH);
        }
      }
    });
  }

  // Inject main world script with CSP safety check
  function injectMainWorldScript() {
    if (document.getElementById('yt-auto-resizer-injected-flag')) return;
    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function') {
      try {
        const s = document.createElement('script');
        s.id = 'yt-auto-resizer-injected-flag';
        s.src = chrome.runtime.getURL('injected.js');
        s.onload = function() {
          console.log('[YouTube Auto Resizer] Main world script attached.');
        };
        (document.head || document.documentElement).appendChild(s);
      } catch (e) {}
    }
  }
  injectMainWorldScript();
  document.addEventListener('yt-navigate-finish', injectMainWorldScript);
  document.addEventListener('DOMContentLoaded', injectMainWorldScript);

  // Style element for Scenario C dynamic player sizing
  let styleEl = document.getElementById('yt-auto-resizer-dynamic-style');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'yt-auto-resizer-dynamic-style';
    (document.head || document.documentElement).appendChild(styleEl);
  }

  function ensureStyleAttached() {
    let el = document.getElementById('yt-auto-resizer-dynamic-style');
    if (!el) {
      el = document.createElement('style');
      el.id = 'yt-auto-resizer-dynamic-style';
      (document.head || document.documentElement).appendChild(el);
    }
    styleEl = el;
  }

  // Scenario C: Apply In-page Player Size & Layout Adaptation
  function applyInPagePlayerSize(quality, videoW, videoH) {
    console.log('[YouTube Auto Resizer] applyInPagePlayerSize ENTERED with quality =', quality, videoW, videoH);
    lastAppliedQuality = quality;
    lastAppliedVideoW = videoW;
    lastAppliedVideoH = videoH;

    const activeSettings = currentSettings || DEFAULT_SETTINGS;
    if (!activeSettings.enabledInPage) {
      console.log('[YouTube Auto Resizer] enabledInPage is FALSE, clearing style.');
      if (styleEl) styleEl.textContent = '';
      return;
    }

    const isWatchPage = window.location.pathname.startsWith('/watch') || !!document.querySelector('ytd-watch-flexy');
    if (!isWatchPage) {
      console.log('[YouTube Auto Resizer] Not on a watch page, clearing dynamic style.');
      if (styleEl) styleEl.textContent = '';
      return;
    }

    ensureStyleAttached();

    const qMap = activeSettings.qualityMap || DEFAULT_SETTINGS.qualityMap;
    let targetW = 0;
    let targetH = 0;

    if (qMap[quality]) {
      targetW = qMap[quality].width;
      targetH = qMap[quality].height;
    } else if (videoW > 0 && videoH > 0) {
      targetW = videoW;
      targetH = videoH;
    }

    // Default fallback to 1280x720 only if unmapped/invalid
    if (!targetW || !targetH) {
      targetW = 1280;
      targetH = 720;
    }

    // Force 16:9 aspect ratio matching
    targetH = Math.round(targetW * 9 / 16);

    // Apply Screen Safeguard based on physical screen available width
    if (activeSettings.maxScreenSafeguard) {
      const availWidth = (window.screen && window.screen.availWidth) ? window.screen.availWidth : 1920;
      const availHeight = (window.screen && window.screen.availHeight) ? window.screen.availHeight : 1080;
      
      const maxPlayerW = Math.min(targetW, availWidth - 40);
      const maxPlayerH = Math.min(targetH, availHeight - 80);

      const scale = Math.min(maxPlayerW / targetW, maxPlayerH / targetH);
      if (scale < 1) {
        targetW = Math.round(targetW * scale);
        targetH = Math.round(targetW * 9 / 16);
      }
    }

    console.log(`[YouTube Auto Resizer] Applying Scenario C player size: ${targetW}x${targetH} (Quality: ${quality})`);

    // Inject CSS rule overriding player container & inner HTML5 video stream dimensions - strictly scoped to ytd-watch-flexy
    styleEl.textContent = `
      /* YouTube polymer layout variables - scoped to watch page */
      ytd-watch-flexy,
      ytd-watch-flexy[flexy],
      ytd-watch-flexy[is-two-columns_] {
        --ytd-watch-flexy-player-width: ${targetW}px !important;
        --ytd-watch-flexy-player-height: ${targetH}px !important;
        --ytd-watch-flexy-min-player-height: ${targetH}px !important;
        --ytd-watch-flexy-max-player-width-wide-screen: 9999px !important;
        --yt-player-width: ${targetW}px !important;
        --yt-player-height: ${targetH}px !important;
      }

      /* Container exact 16:9 sizing with high specificity - scoped to ytd-watch-flexy */
      ytd-watch-flexy[flexy] #player-container-outer.ytd-watch-flexy,
      ytd-watch-flexy[flexy] #player-container-inner.ytd-watch-flexy,
      ytd-watch-flexy[flexy] #player-container.ytd-watch-flexy,
      ytd-watch-flexy #player-container-outer,
      ytd-watch-flexy #player-container-inner,
      ytd-watch-flexy #player-container,
      ytd-watch-flexy #player,
      ytd-watch-flexy #ytd-player,
      ytd-watch-flexy #movie_player:not(.ytp-fullscreen),
      ytd-watch-flexy .html5-video-player:not(.ytp-fullscreen) {
        width: ${targetW}px !important;
        height: ${targetH}px !important;
        min-width: 0 !important;
        min-height: 0 !important;
        max-width: none !important;
        max-height: none !important;
        padding-top: 0 !important;
        transition: width 0.3s ease, height 0.3s ease !important;
      }

      /* Force HTML5 video stream to stretch to 100% of player container */
      ytd-watch-flexy .html5-video-container,
      ytd-watch-flexy .html5-main-video,
      ytd-watch-flexy video.video-stream,
      ytd-watch-flexy #movie_player video {
        width: 100% !important;
        height: 100% !important;
        top: 0 !important;
        left: 0 !important;
        min-width: 0 !important;
        min-height: 0 !important;
        max-width: none !important;
        max-height: none !important;
        object-fit: contain !important;
      }

      /* Ensure player containers stay 100% visible across all YouTube Polymer modes */
      ytd-watch-flexy #player,
      ytd-watch-flexy[theater] #player,
      ytd-watch-flexy[full-bleed-player] #player,
      ytd-watch-flexy #player-container,
      ytd-watch-flexy[theater] #player-container,
      ytd-watch-flexy[full-bleed-player] #player-container,
      ytd-watch-flexy #player-container-inner,
      ytd-watch-flexy #player-container-outer,
      ytd-watch-flexy #player-full-bleed-container,
      ytd-watch-flexy #full-bleed-container,
      ytd-watch-flexy #ytd-player,
      ytd-watch-flexy #movie_player {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
      }

      /* YouTube Settings Popup Menu (.ytp-popup) fixes */
      .ytp-popup,
      .ytp-settings-menu {
        z-index: 999999 !important;
      }

      /* Guide drawer left sidebar fix: solid background and high z-index stacking */
      tp-yt-app-drawer#guide,
      ytd-guide-renderer,
      #guide-wrapper,
      #guide-content {
        background-color: var(--yt-spec-base-background, #0f0f0f) !important;
        z-index: 99999 !important;
      }

      /* Page Layout Zero-Gap Auto-Adaptation & Left Alignment - strictly scoped under ytd-watch-flexy */
      ytd-watch-flexy #columns.ytd-watch-flexy {
        max-width: none !important;
        width: 100% !important;
        margin-left: 0 !important;
        margin-right: 0 !important;
        display: flex !important;
        flex-direction: row !important;
        justify-content: flex-start !important;
        align-items: flex-start !important;
        gap: 20px !important;
        padding: 0 16px !important;
      }
      ytd-watch-flexy #primary.ytd-watch-flexy,
      ytd-watch-flexy #primary-inner {
        width: ${targetW}px !important;
        max-width: ${targetW}px !important;
        min-width: 0 !important;
        flex: none !important;
        margin-left: 0 !important;
        padding-left: 0 !important;
        padding-right: 0 !important;
      }
      ytd-watch-flexy #secondary.ytd-watch-flexy {
        width: 400px !important;
        min-width: 300px !important;
        max-width: 420px !important;
        flex: none !important;
        margin-right: 0 !important;
        margin-top: 0 !important;
        padding-left: 0 !important;
        padding-top: 0 !important;
        top: 0 !important;
        position: relative !important;
      }
    `;

    // Dispatch window resize event so YouTube's Web Component re-evaluates layout bounds
    window.dispatchEvent(new Event('resize'));

    // Optionally sync Chrome main browser window size if enabled
    if (activeSettings.resizeMainWindowInPage && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      const totalWidth = targetW + 420;
      const totalHeight = targetH + 160;
      try {
        chrome.runtime.sendMessage({
          action: 'RESIZE_WINDOW',
          width: totalWidth,
          height: totalHeight
        });
      } catch (e) {}
    }
  }

  // Expose applyInPagePlayerSize on window for direct access
  window.YT_AUTO_RESIZER_APPLY = applyInPagePlayerSize;

  // Listen to main world quality change event on both document and window
  function handleQualityChange(event) {
    const { quality, videoWidth, videoHeight } = event.detail || {};
    console.log('[YouTube Auto Resizer] Quality change detected in content.js:', quality, videoWidth, videoHeight);
    if (quality) {
      applyInPagePlayerSize(quality, videoWidth, videoHeight);
    }
  }

  document.addEventListener('YT_AUTO_RESIZER_QUALITY_CHANGED', handleQualityChange);
  window.addEventListener('YT_AUTO_RESIZER_QUALITY_CHANGED', handleQualityChange);

  function handlePageNavigation() {
    const isWatchPage = window.location.pathname.startsWith('/watch') || !!document.querySelector('ytd-watch-flexy');
    if (!isWatchPage && styleEl) {
      styleEl.textContent = '';
      lastAppliedQuality = null;
    }
  }

  document.addEventListener('yt-navigate-finish', handlePageNavigation);
  document.addEventListener('yt-page-data-updated', handlePageNavigation);
  window.addEventListener('popstate', handlePageNavigation);

  // Inject Pop-up Player Button in YouTube Control Bar with TrustedTypes safe DOM elements
  function injectPopupButton() {
    const rightControls = document.querySelector('.ytp-right-controls');
    if (!rightControls || document.getElementById('yt-resizer-popup-btn')) return;

    try {
      const btn = document.createElement('button');
      btn.id = 'yt-resizer-popup-btn';
      btn.className = 'ytp-button';
      btn.title = '彈出式播放器 (Pop-up Player)';

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      svg.setAttribute('viewBox', '0 0 36 36');

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('fill', '#fff');
      path.setAttribute('d', 'M19,11 L25,11 L25,17 L23,17 L23,14.41 L17.41,20 L16,18.59 L21.59,13 L19,13 L19,11 Z M11,13 L15,13 L15,15 L13,15 L13,23 L21,23 L21,21 L23,21 L23,25 L11,25 L11,13 Z');

      svg.appendChild(path);
      btn.appendChild(svg);

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const video = document.querySelector('video');
        const urlParams = new URLSearchParams(window.location.search);
        const videoId = urlParams.get('v');
        const currentTime = video ? Math.floor(video.currentTime) : 0;
        
        const moviePlayer = document.getElementById('movie_player');
        const quality = (moviePlayer && typeof moviePlayer.getPlaybackQuality === 'function') ? moviePlayer.getPlaybackQuality() : 'hd1080';

        if (videoId && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          if (video) video.pause();
          chrome.runtime.sendMessage({
            action: 'OPEN_POPUP_PLAYER',
            videoId: videoId,
            quality: quality,
            startTime: currentTime
          });
        }
      });

      rightControls.insertBefore(btn, rightControls.firstChild);
    } catch (e) {}
  }

  setInterval(injectPopupButton, 1500);

})();
