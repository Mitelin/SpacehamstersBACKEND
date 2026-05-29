/*
 * Lightweight timing utilities for Apps Script.
 * Enable by setting Script Property: DEBUG_TIMING=1
 */
const Perf = (() => {
  var _entries = [];
  var _runStartMs = null;
  var _pendingRows = [];
  var _lastCheckpointPropMs = 0;
  const _debugSheetName = 'DEBUG Aktualizuj vse';
  const _debugSheetFlushRows = 80;

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
      const v = PropertiesService.getScriptProperties().getProperty('DEBUG_TIMING_SIDEBAR');
      if (String(v || '') === '1' && typeof Sidebar !== 'undefined' && Sidebar.add) {
        Sidebar.add(line);
      }
    } catch (e) {}
  }

  function _setEnabled(on) {
    try {
      PropertiesService.getScriptProperties().setProperty('DEBUG_TIMING', on ? '1' : '0');
    } catch (e) {}
  }

  function _isVerbose() {
    try {
      const v = PropertiesService.getScriptProperties().getProperty('DEBUG_TIMING_VERBOSE');
      return String(v || '') === '1';
    } catch (e) {
      return false;
    }
  }

  function _isSheetEnabled() {
    try {
      const v = PropertiesService.getScriptProperties().getProperty('DEBUG_TIMING_SHEET');
      return String(v || '') === '1';
    } catch (e) {
      return false;
    }
  }

  function _isSheetAppend() {
    try {
      const v = PropertiesService.getScriptProperties().getProperty('DEBUG_TIMING_APPEND');
      return String(v || '') === '1';
    } catch (e) {
      return false;
    }
  }

  function _setProp(name, value) {
    try {
      PropertiesService.getScriptProperties().setProperty(name, String(value));
    } catch (e) {}
  }

  function _getDebugSheet(reset) {
    const ss = SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : SpreadsheetApp.getActive();
    if (!ss) return null;
    var sheet = ss.getSheetByName(_debugSheetName);
    if (!sheet) sheet = ss.insertSheet(_debugSheetName);
    if (reset) {
      sheet.clearContents();
      sheet.getRange(1, 1, 1, 5).setValues([['time', 'elapsed_s', 'phase', 'label', 'duration_s']]);
      sheet.setFrozenRows(1);
    }
    return sheet;
  }

  function _flushCheckpoints(force) {
    if (!_isSheetEnabled()) return;
    if (_pendingRows.length === 0) return;
    if (!force && _pendingRows.length < _debugSheetFlushRows) return;

    try {
      const sheet = _getDebugSheet(false);
      if (!sheet) return;
      const rows = _pendingRows;
      _pendingRows = [];
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
    } catch (e) {}
  }

  function _writeCheckpoint(phase, label, ms) {
    const nowMs = _nowMs();
    const elapsedMs = _runStartMs ? (nowMs - _runStartMs) : 0;
    const duration = ms == null ? '' : (Number(ms) / 1000).toFixed(2);
    if (phase === 'RESET' || phase === 'SUMMARY' || phase === 'TOP 1' || (nowMs - _lastCheckpointPropMs) >= 5000) {
      _setProp('DEBUG_TIMING_LAST', new Date().toISOString() + ' | ' + phase + ' | ' + label + ' | +' + (elapsedMs / 1000).toFixed(2) + ' s');
      _lastCheckpointPropMs = nowMs;
    }
    if (!_isSheetEnabled()) return;
    _pendingRows.push([new Date(), (elapsedMs / 1000).toFixed(2), phase, String(label || ''), duration]);
    _flushCheckpoints(false);
  }

  function _record(label, ms) {
    _entries.push({ label: String(label || ''), ms: Number(ms) || 0 });
  }

  return {
    enabled: function() {
      return _isEnabled();
    },

    time: function(label, fn) {
      if (!fn) return;
      if (!_isEnabled()) return fn();

      const t0 = _nowMs();
      if (_isVerbose()) _logLine('[PERF] START ' + label);
      _writeCheckpoint('START', label, null);
      var thrown = null;
      try {
        return fn();
      } catch (e) {
        thrown = e;
        throw e;
      } finally {
        const dt = _nowMs() - t0;
        _record(label, dt);
        if (thrown) {
          _writeCheckpoint('ERROR', label + ': ' + (thrown && thrown.stack ? thrown.stack : String(thrown)), dt);
          _logLine('[PERF] ERROR ' + label + ': ' + (dt / 1000).toFixed(2) + ' s');
        } else {
          _writeCheckpoint('DONE', label, dt);
          _logLine('[PERF] ' + label + ': ' + (dt / 1000).toFixed(2) + ' s');
        }
      }
    },

    mark: function(label) {
      if (!_isEnabled()) return;
      _writeCheckpoint('MARK', label, null);
      _logLine('[PERF] ' + label);
    },

    enable: function() {
      _setEnabled(true);
      _logLine('[PERF] Timing enabled');
    },

    disable: function() {
      _setEnabled(false);
      _logLine('[PERF] Timing disabled');
    },

    reset: function(label) {
      _entries = [];
      _runStartMs = _nowMs();
      _pendingRows = [];
      _lastCheckpointPropMs = 0;
      if (_isSheetEnabled()) {
        try { _getDebugSheet(!_isSheetAppend()); } catch (e) {}
      }
      if (_isEnabled()) {
        _writeCheckpoint('RESET', label || 'run', null);
        _flushCheckpoints(true);
        _logLine('[PERF] START ' + (label || 'run'));
      }
    },

    summary: function(label, limit) {
      if (!_isEnabled()) return;
      const totalMs = _runStartMs ? (_nowMs() - _runStartMs) : _entries.reduce((sum, e) => sum + e.ms, 0);
      const sorted = _entries.slice().sort((a, b) => b.ms - a.ms);
      const maxRows = Math.max(1, Number(limit) || 25);
      _writeCheckpoint('SUMMARY', (label || 'run') + ': total ' + (totalMs / 1000).toFixed(2) + ' s, measured steps ' + _entries.length, totalMs);
      _logLine('[PERF] SUMMARY ' + (label || 'run') + ': total ' + (totalMs / 1000).toFixed(2) + ' s, measured steps ' + _entries.length);
      sorted.slice(0, maxRows).forEach((entry, index) => {
        _writeCheckpoint('TOP ' + (index + 1), entry.label, entry.ms);
        _logLine('[PERF] TOP ' + (index + 1) + ': ' + entry.label + ': ' + (entry.ms / 1000).toFixed(2) + ' s');
      });
      _flushCheckpoints(true);
      return { totalMs: totalMs, entries: _entries.slice() };
    },

    flush: function() {
      _flushCheckpoints(true);
    }
  };
})();

function perfTimingEnable() {
  if (typeof Perf !== 'undefined' && Perf.enable) Perf.enable();
}

function perfTimingDisable() {
  if (typeof Perf !== 'undefined' && Perf.disable) Perf.disable();
}
