document.addEventListener('DOMContentLoaded', function() {
  const enabledToggle = document.getElementById('enabled-toggle');
  const qualitySelect = document.getElementById('quality-select');
  const resizeModeRadios = document.querySelectorAll('input[name="resizeMode"]');
  const removeSideGapsToggle = document.getElementById('removeSideGaps-toggle');
  const statusText = document.getElementById('status-text');

  chrome.storage.local.get(['enabled', 'quality', 'resizeMode', 'removeSideGaps'], function(res) {
    if (res.enabled !== undefined) {
      enabledToggle.checked = res.enabled;
    }
    if (res.quality) {
      qualitySelect.value = res.quality;
    }
    const mode = res.resizeMode || 'autoByQuality';
    const radio = document.querySelector(`input[name="resizeMode"][value="${mode}"]`);
    if (radio) radio.checked = true;

    if (res.removeSideGaps !== undefined) {
      removeSideGapsToggle.checked = res.removeSideGaps;
    }
    updateStatus();
  });

  function saveSettings() {
    const selectedMode = document.querySelector('input[name="resizeMode"]:checked')?.value || 'autoByQuality';
    const config = {
      enabled: enabledToggle.checked,
      quality: qualitySelect.value,
      resizeMode: selectedMode,
      removeSideGaps: removeSideGapsToggle.checked
    };

    chrome.storage.local.set(config, function() {
      updateStatus();
    });
  }

  function updateStatus() {
    if (enabledToggle.checked) {
      statusText.textContent = '已啟用';
      statusText.style.color = '#00e676';
    } else {
      statusText.textContent = '已停用';
      statusText.style.color = '#8e8e99';
    }
  }

  enabledToggle.addEventListener('change', saveSettings);
  qualitySelect.addEventListener('change', saveSettings);
  resizeModeRadios.forEach(radio => radio.addEventListener('change', saveSettings));
  removeSideGapsToggle.addEventListener('change', saveSettings);
});
