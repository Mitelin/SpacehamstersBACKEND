/*
 * Lightweight timing utilities for Apps Script.
 * Enable by setting Script Property: DEBUG_TIMING=1
 */
const Perf = (() => {
  function _isEnabled() {
    try {
      const v = PropertiesService.getScriptProperties().getProperty('DEBUG_TIMING');
      return String(v || '') === '1';
    } catch (e) {
      return false;
    }
  }

  function _nowMs() {
    return new Date().getTime();
  }

  function _logLine(line) {
    try { Logger.log(line); } catch (e) {}
    try {
      if (typeof Sidebar !== 'undefined' && Sidebar.add) {
        Sidebar.add(line);
      }
    } catch (e) {}
  }

  function _setEnabled(on) {
    try {
      PropertiesService.getScriptProperties().setProperty('DEBUG_TIMING', on ? '1' : '0');
    } catch (e) {}
  }

  return {
    enabled: function() {
      return _isEnabled();
    },

    time: function(label, fn) {
      if (!fn) return;
      if (!_isEnabled()) return fn();

      const t0 = _nowMs();
      try {
        return fn();
      } finally {
        const dt = _nowMs() - t0;
        _logLine('[PERF] ' + label + ': ' + (dt / 1000).toFixed(2) + ' s');
      }
    },

    mark: function(label) {
      if (!_isEnabled()) return;
      _logLine('[PERF] ' + label);
    },

    enable: function() {
      _setEnabled(true);
      _logLine('[PERF] Timing enabled');
    },

    disable: function() {
      _setEnabled(false);
      _logLine('[PERF] Timing disabled');
    }
  };
})();

function perfTimingEnable() {
  if (typeof Perf !== 'undefined' && Perf.enable) Perf.enable();
}

function perfTimingDisable() {
  if (typeof Perf !== 'undefined' && Perf.disable) Perf.disable();
}
