/*
 * EVE Corporation object
 */ 
const Corporation = (()=>{
  const corporationId = 98652228   // Corporation ID for "Space Hamsters CZ SK" found via /universe/ids API
  // refresh pomoci testSearch()
  const manufacturingStructure = {
    structure_id: 1047214915313,
    name: 'UALX-3 - Starforge of Bravery',
    owner_id: 98444656,
    position: { x: 1643732215390, y: -76999923447, z: -262765431005 },
    solar_system_id: 30004807,
    type_id: 35827,
    type: 'structures'
  }
  const researchStructure = {
    structure_id: 1047935338899,
    name: 'UALX-3 - The Science Lounge',
    owner_id: 98444656,
    position: { x: 1643734892081, y: -76999924958, z: -262765940237 },
    solar_system_id: 30004807,
    type_id: 35827,
    type: 'structures'
  }  
  const reactionStructure = { 
    structure_id: 1047040619810,
    name: 'UALX-3 - The Cauldron',
    owner_id: 98444656,
    position: { x: 1643731031055, y: -76999926349, z: -262765192663 },
    solar_system_id: 30004807,
    type_id: 35836,
    type: 'structures'
  }
  const capitalStructure = { 
    structure_id: 1049960174130,
    name: '4-P4FE - Capital & Large Ships',
    owner_id: 98444656,
    position: { x: -170027746963.0973,y: -4523340764.995761,z: -557103837857.858 },
    solar_system_id: 30004811,
    type_id: 35826,
    type: 'structures' 
  }
  const homeStructure = { 
    structure_id: 1034323745897,
    name: 'P-ZMZV - Dracarys Prime',
    owner_id: 98601548,
    position: { x: 2677074611170, y: 1487107231248, z: 4843291376560 },
    solar_system_id: 30003978,
    type_id: 35834
  }

  var corpProperties = PropertiesService.getScriptProperties();
  var sharedFullProps_ = function() {
    var prefix = 'shared_full_';
    return {
      getProperty: function(key) {
        return corpProperties.getProperty(prefix + key);
      },
      setProperty: function(key, value) {
        return corpProperties.setProperty(prefix + key, value);
      },
      deleteProperty: function(key) {
        return corpProperties.deleteProperty(prefix + key);
      }
    };
  };

  const _time = (label, fn) => (typeof Perf !== 'undefined' && Perf.time) ? Perf.time(label, fn) : fn();
  const _TRACE = (() => {
    try {
      const v = corpProperties.getProperty('DEBUG_TRACE');
      return String(v || '') === '1';
    } catch (e) {
      return false;
    }
  })();
  const trace = (...args) => {
    if (!_TRACE) return;
    try { Logger.log(args.map(a => String(a)).join(' ')); } catch (e) {}
    try { console.log(...args); } catch (e) {}
  };
  var hangarsRMap;  // corporate hangars for reaction jobs
  var hangarsMMap;  // corporate hangars for manufacturing jobs
  var hangarsResMap;  // corporate hangars for research jobs
  var hangarsCapMap;  // corporate hangars for capital manufacturing jobs

  // In-memory memoization for a single Apps Script execution.
  // Goal: avoid re-reading large cache sheets (Assets/IndustryJobs/Blueprinty) multiple times
  // during multi-project pipelines like runUpdateAllProjects().
  var _cacheMemo = {
    assets: null,
    jobs: null,
    blueprints: null,
    bpos: null,
  };

  // When true, reuse in-memory memo for the rest of the execution,
  // even if the sheet cache expiry passes mid-run.
  // Intended for long pipelines like runUpdateAllProjects().
  var _freezeMemo = false;

  var _resetMemo = function() {
    _cacheMemo.assets = null;
    _cacheMemo.jobs = null;
    _cacheMemo.blueprints = null;
    _cacheMemo.bpos = null;
  }

  var _setFreezeMemo = function(on) {
    _freezeMemo = on ? true : false;
  }

  var ACTIVITY_SUMMARY_START_ROW = 6;
  var ACTIVITY_SUMMARY_HEADERS = [
    'Pilot',
    'Main',
    'Aktivní dny',
    'Dnes viděn',
    'Odhad hodin',
    'Status',
    'Poslední login',
    'Poslední logout',
    'Poslední lokace',
    'Poslední ship',
    'V corp od',
    'Snapshotů měsíc',
    'Character ID'
  ];

  var _blueprintMatchesHangar = function(item, hangar) {
    if (!item || !hangar) return false;

    if (item.locationId == hangar.locationID) {
      if (hangar.locationType != 'station') return true;
      if (!hangar.locationFlag) return true;
      return item.locationFlag == hangar.locationFlag;
    }

    // Corporate blueprints can report a different station/root location ID than assets,
    // but still retain the correct division locationFlag.
    if (hangar.locationType == 'station' && hangar.locationFlag) {
      return item.locationFlag == hangar.locationFlag;
    }

    return false;
  }

  var _toIsoOrEmpty = function(value) {
    if (!value) return '';
    var dt = new Date(value);
    if (isNaN(dt.getTime())) return '';
    return dt.toISOString();
  }

  var _dateOnlyKey = function(value) {
    if (!value) return '';
    var dt = new Date(value);
    if (isNaN(dt.getTime())) return '';
    return dt.toISOString().slice(0, 10);
  }

  var _isLikelyOnline = function(item) {
    var logon = item && item.logonDate ? new Date(item.logonDate).getTime() : NaN;
    var logoff = item && item.logoffDate ? new Date(item.logoffDate).getTime() : NaN;
    if (isNaN(logon)) return false;
    if (isNaN(logoff)) return true;
    return logon > logoff;
  }

  var _formatDateTimeCell = function(isoValue) {
    if (!isoValue) return '';
    var dt = new Date(isoValue);
    return isNaN(dt.getTime()) ? '' : dt;
  }

  var _isValidActivityPeriod = function(year, month) {
    return year > 2020 && year < 2050 && month > 0 && month < 13;
  }

  var _readActivityPeriod = function(sheet) {
    var year = Number(sheet.getRange(3, 1).getValue());
    var month = Number(sheet.getRange(3, 3).getValue());
    return { year: year, month: month };
  }

  var _getOrCreateActivitySheet = function() {
    if (activitySheet) return activitySheet;
    activitySheet = SpreadsheetApp.getActive().getSheetByName('Activity');
    if (activitySheet) return activitySheet;
    activitySheet = SpreadsheetApp.getActive().insertSheet('Activity');
    return activitySheet;
  }

  var _ensureActivityLayout = function(sheet) {
    var now = new Date();
    sheet.getRange(1, 1, 5, ACTIVITY_SUMMARY_HEADERS.length).breakApart();
    sheet.getRange(1, 1).setValue('Corp Activity');
    sheet.getRange(1, 1, 1, ACTIVITY_SUMMARY_HEADERS.length).merge();
    sheet.getRange(1, 1)
      .setBackground('#14324a')
      .setFontColor('#ffffff')
      .setFontSize(15)
      .setFontWeight('bold')
      .setHorizontalAlignment('left')
      .setVerticalAlignment('middle');

    sheet.getRange(2, 1, 1, 2).merge().setValue('Rok');
    sheet.getRange(2, 3, 1, 2).merge().setValue('Měsíc');
    sheet.getRange(2, 5, 1, 2).merge().setValue('Poslední snapshot');
    sheet.getRange(2, 7, 1, 2).merge().setValue('Pilotů');
    sheet.getRange(2, 9, 1, 2).merge().setValue('Snapshotů');
    sheet.getRange(2, 11, 1, 2).merge().setValue('Report měsíc');
    sheet.getRange(2, 13, 2, 1).merge().setValue('Backend\n6x denně');

    sheet.getRange(3, 1, 1, 2).merge();
    sheet.getRange(3, 3, 1, 2).merge();
    sheet.getRange(3, 5, 1, 2).merge();
    sheet.getRange(3, 7, 1, 2).merge();
    sheet.getRange(3, 9, 1, 2).merge();
    sheet.getRange(3, 11, 1, 2).merge();

    if (!sheet.getRange(3, 1).getValue()) {
      sheet.getRange(3, 1).setValue(now.getFullYear());
    }
    if (!sheet.getRange(3, 3).getValue()) {
      sheet.getRange(3, 3).setValue(now.getMonth() + 1);
    }

    sheet.getRange(2, 1, 2, 12)
      .setBorder(true, true, true, true, true, true, '#d9e2ec', SpreadsheetApp.BorderStyle.SOLID);
    sheet.getRange(2, 1, 1, 12)
      .setFontWeight('bold')
      .setFontColor('#486581')
      .setBackground('#eef6fb')
      .setHorizontalAlignment('center');
    sheet.getRange(3, 1, 1, 4)
      .setBackground('#fff8db')
      .setHorizontalAlignment('center')
      .setFontWeight('bold');
    sheet.getRange(3, 5, 1, 8)
      .setBackground('#ffffff')
      .setHorizontalAlignment('center')
      .setFontWeight('bold');
    sheet.getRange(2, 13, 2, 1)
      .setBackground('#eef6fb')
      .setFontColor('#355468')
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle')
      .setWrap(true)
      .setBorder(true, true, true, true, false, false, '#d9e2ec', SpreadsheetApp.BorderStyle.SOLID);

    sheet.getRange(4, 1, 1, ACTIVITY_SUMMARY_HEADERS.length)
      .merge()
      .setValue('Activity běží z backend snapshotů 6x denně. Vyber rok a měsíc, pak spusť Načíst: Aktivita.')
      .setBackground('#eef6fb')
      .setFontColor('#355468')
      .setFontStyle('italic')
      .setHorizontalAlignment('left');

    sheet.getRange(5, 1, 1, ACTIVITY_SUMMARY_HEADERS.length).setValues([ACTIVITY_SUMMARY_HEADERS]);
    sheet.getRange(5, 1, 1, ACTIVITY_SUMMARY_HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#d7e9f5')
      .setHorizontalAlignment('center')
      .setBorder(true, true, true, true, true, true, '#cbd2d9', SpreadsheetApp.BorderStyle.SOLID);

    sheet.setFrozenRows(5);
    sheet.setRowHeights(1, 5, 28);
    sheet.setRowHeight(1, 34);
    sheet.setRowHeight(4, 26);

    sheet.setColumnWidths(1, ACTIVITY_SUMMARY_HEADERS.length, 124);
    sheet.setColumnWidth(1, 180);
    sheet.setColumnWidth(3, 70);
    sheet.setColumnWidth(2, 160);
    sheet.setColumnWidth(5, 105);
    sheet.setColumnWidth(6, 95);
    sheet.setColumnWidth(7, 150);
    sheet.setColumnWidth(8, 150);
    sheet.setColumnWidth(9, 160);
    sheet.setColumnWidth(10, 160);
    sheet.setColumnWidth(11, 120);
    sheet.setColumnWidth(13, 95);
  }

  var _translateActivityRows = function(items) {
    return items.map(function(item) {
      var pilot = String(item.characterName || '');
      var locationId = item.locationId || '';
      var shipTypeId = item.shipTypeId || '';
      return [
        pilot,
        Universe.getMainName(pilot),
        Number(item.activeDays || 0),
        item.seenToday ? 'ANO' : '',
        Number(item.estimatedHours || 0),
        String(item.status || ''),
        _formatDateTimeCell(item.lastLogin),
        _formatDateTimeCell(item.lastLogout),
        locationId ? Universe.getLocationName(locationId) : '',
        item.shipName || (shipTypeId ? Universe.getType(shipTypeId).type_name : ''),
        _formatDateTimeCell(item.startDate),
        Number(item.snapshotCount || 0),
        Number(item.characterId || 0)
      ];
    });
  }

  var _writeActivitySummary = function(sheet, rows, meta, year, month) {
    var clearRows = Math.max(0, sheet.getMaxRows() - ACTIVITY_SUMMARY_START_ROW + 1);
    if (clearRows > 0) {
      sheet.getRange(ACTIVITY_SUMMARY_START_ROW, 1, clearRows, ACTIVITY_SUMMARY_HEADERS.length).clearContent().clearFormat();
    }

    if (rows.length > 0) {
      sheet.getRange(ACTIVITY_SUMMARY_START_ROW, 1, rows.length, ACTIVITY_SUMMARY_HEADERS.length).setValues(rows);
      var rowBackgrounds = rows.map(function(row, idx) {
        var shade = idx % 2 === 0 ? '#ffffff' : '#f8fbfd';
        return new Array(ACTIVITY_SUMMARY_HEADERS.length).fill(shade);
      });
      sheet.getRange(ACTIVITY_SUMMARY_START_ROW, 1, rows.length, ACTIVITY_SUMMARY_HEADERS.length).setBackgrounds(rowBackgrounds);
      sheet.getRange(ACTIVITY_SUMMARY_START_ROW, 1, rows.length, 1).setFontWeight('bold');
      sheet.getRange(ACTIVITY_SUMMARY_START_ROW, 2, rows.length, 1).setFontColor('#52606d');
      sheet.getRange(ACTIVITY_SUMMARY_START_ROW, 3, rows.length, 1).setHorizontalAlignment('center');
      sheet.getRange(ACTIVITY_SUMMARY_START_ROW, 4, rows.length, 1).setHorizontalAlignment('center');
      sheet.getRange(ACTIVITY_SUMMARY_START_ROW, 5, rows.length, 1).setNumberFormat('0.0');
      sheet.getRange(ACTIVITY_SUMMARY_START_ROW, 7, rows.length, 2).setNumberFormat('yyyy-mm-dd hh:mm');
      sheet.getRange(ACTIVITY_SUMMARY_START_ROW, 11, rows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm');

      var statusColors = rows.map(function(row) {
        return [row[5] === 'online' ? '#d9f2d9' : '#f2f4f7'];
      });
      sheet.getRange(ACTIVITY_SUMMARY_START_ROW, 6, rows.length, 1).setBackgrounds(statusColors).setHorizontalAlignment('center');
      sheet.getRange(ACTIVITY_SUMMARY_START_ROW, 4, rows.length, 1).setBackground('#edfdf2');
      sheet.getRange(ACTIVITY_SUMMARY_START_ROW, 13, rows.length, 1).setFontColor('#7b8794').setHorizontalAlignment('center');
      sheet.getRange(ACTIVITY_SUMMARY_START_ROW, 1, rows.length, ACTIVITY_SUMMARY_HEADERS.length)
        .setBorder(true, true, true, true, false, false, '#d9e2ec', SpreadsheetApp.BorderStyle.SOLID);
    } else {
      sheet.getRange(ACTIVITY_SUMMARY_START_ROW, 1)
        .setValue('Pro zvolený měsíc zatím nejsou data.')
        .setFontStyle('italic')
        .setFontColor('#52606d');
    }

    sheet.getRange(3, 1).setValue(year);
    sheet.getRange(3, 3).setValue(month);
    sheet.getRange(3, 5).setValue(_formatDateTimeCell(meta.latestSnapshotAt || ''));
    sheet.getRange(3, 7).setValue(Number(meta.pilotCount || 0));
    sheet.getRange(3, 9).setValue(Number(meta.snapshotCount || 0));
    sheet.getRange(3, 11).setValue(String(meta.monthKey || (year + '-' + month)));
    sheet.getRange(3, 5).setNumberFormat('yyyy-mm-dd hh:mm');
  }

  const corpSAGMap = new Map();
  corpSAGMap.set('CorpSAG1', 'Research');
  corpSAGMap.set('CorpSAG2', 'Industry skladka');
  corpSAGMap.set('CorpSAG3', 'PVP');
  corpSAGMap.set('CorpSAG4', 'Invention');
  corpSAGMap.set('CorpSAG5', 'Ore');
  corpSAGMap.set('CorpSAG6', 'Produkty');
  corpSAGMap.set('CorpSAG7', 'Vykupy');

  const divisionMap = new Map();
  divisionMap.set(1, 'Research');
  divisionMap.set(2, 'Industry skladka');
  divisionMap.set(3, 'PVP');
  divisionMap.set(4, 'Invention');
  divisionMap.set(5, 'Ore');
  divisionMap.set(6, 'Produkty');
  divisionMap.set(7, 'Vykupy');

  /* Returns initialized reaction hangars id-name map */
  var getHangarsRMap = function() {
    if (!hangarsRMap) {
      // load hangars from spreadsheet
      trace('### Loading R Hangars ...')
      var lastRow = hangarsSheet.getLastRow();

      if (lastRow > 1) {
        // create map from the sheet contents
        let hangars = hangarsSheet.getRange(3, 8, lastRow - 1, 6).getValues();

        hangarsRMap = new Map(hangars.map(obj =>
            [obj[0], obj[5]]
        ));
      } else {
        // create an empty map
        hangarsRMap = new Map();
      }
    }
    return hangarsRMap;
  }


//locationID	locationType	locationFlag	hangar	container	
//1042655795391	station	CorpSAG1	Research		Research

  /* Returns initialized manufacturing hangars id-name map */
  var getHangarsMMap = function() {
    if (!hangarsMMap) {
      // load hangars from spreadsheet
      trace('### Loading M Hangars ...')
      var lastRow = hangarsSheet.getLastRow();

      if (lastRow > 1) {
        // create map from the sheet contents
        let hangars = hangarsSheet.getRange(3, 1, lastRow - 1, 6).getValues();

        hangarsMMap = new Map(hangars.map(obj =>
            [obj[0], obj[5]]
        ));
      } else {
        // create an empty map
        hangarsMMap = new Map();
      }
    }
    return hangarsMMap;
  }   

  /* Returns initialized research hangars id-name map */
  var getHangarsResMap = function() {
    if (!hangarsResMap) {
      // load hangars from spreadsheet
      trace('### Loading Res Hangars ...')
      var lastRow = hangarsSheet.getLastRow();

      if (lastRow > 1) {
        // create map from the sheet contents
        let hangars = hangarsSheet.getRange(3, 15, lastRow - 1, 6).getValues();

        hangarsResMap = new Map(hangars.map(obj =>
            [obj[0], obj[5]]
        ));
      } else {
        // create an empty map
        hangarsResMap = new Map();
      }
    }
    return hangarsResMap;
  }   

  /* Returns initialized research hangars id-name map */
  var getHangarsCapMap = function() {
    if (!hangarsCapMap) {
      // load hangars from spreadsheet
      trace('### Loading Cap Hangars ...')
      var lastRow = hangarsSheet.getLastRow();

      if (lastRow > 1) {
        // create map from the sheet contents
        let hangars = hangarsSheet.getRange(3, 22, lastRow - 1, 6).getValues();

        hangarsCapMap = new Map(hangars.map(obj =>
            [obj[0], obj[5]]
        ));
      } else {
        // create an empty map
        hangarsCapMap = new Map();
      }
    }
    return hangarsCapMap;
  }   

  return {
    /* Returns corporation ID */
    getId: function() {
      return corporationId;
    },
    getAccessToken: function() {
      try {
        return Security.getAccessToken(corpProperties);
      } catch (e) {
        var msg = String(e);
        if (msg.indexOf('Missing refresh token') >= 0) {
          // Allow using shared FULL token (ScriptProperties) for corporate tooling.
          // Full login scopes include corp scopes in this sheet.
          try {
            return Security.getAccessToken(sharedFullProps_());
          } catch (e2) {
            var msg2 = String(e2);
            if (msg2.indexOf('Missing refresh token') >= 0) {
              throw ('Corporate token není nastavený a sdílený Full token taky ne. Kontaktuj admina, ať udělá Corporate login nebo Full login + „Debug → Copy token → Shared (Full)“.');  
            }
            throw e2;
          }
        }
        throw ('Corporate token refresh failed. Do: EVE Data → Login → Corporate login. Details: ' + msg);
      }
    },
    getTokenExpiration: function() {
      return Security.getTokenExpiration(corpProperties);
    },
    /* Returns manufacturing structure */
    getManufacturingStructure: function() {
      return manufacturingStructure;
    },
    /* Returns research structure */
    getResearchStructure: function() {
      return researchStructure;
    },
    /* Returns reaction structure */
    getReactionStructure: function() {
      return reactionStructure;
    },
    /* Returns capital construction structure */
    getCapitalStructure: function() {
      return capitalStructure;
    },
    
    /* Returns corporation office name */
    getCorpSAGName: function(code) {
      return corpSAGMap.get(code);
    },

    /* Returns corporation division name */
    getDivisionName: function(code) {
      return divisionMap.get(code);
    },

    /*
     * Returns corporate assets in specific hangars
     * hangars: array of hangars - location IDs 
     * out: array of JSONs
     */
    getAssets(hangars) {
      var assets = Eve.getCorporateAssets(this.getId());

      var assetsFiltered;
      if (hangars != null) {
        assetsFiltered = assets.data.filter(item => {
          return (hangars.some(hangar => hangar.locationID == item.location_id))
        });
      } else assetsFiltered = assets.data;

//      console.log(assetsFiltered);

      var assetsTranslated = assetsFiltered.map(a => ({
          typeId: a.type_id,
          typeName: Universe.getType(a.type_id).type_name,
          quantity: a.quantity,
          locationId: a.location_id,
          locationType: a.location_type,
          locationFlag: a.location_flag,
          hangar: Corporation.getHangarName(a.location_id)
        }));

      return {age: assets.age, cacheRefresh: assets.cacheRefresh, lastModified: assets.lastModified, expires: assets.expires, data : assetsTranslated};
    },

    /*
     * Returns corporate blueprints in specific hangars
     * hangars: (optional) array of hangars - location IDs 
     * out: array of JSONs
     */
    getBlueprints(hangars) {
      var assets = Eve.getCorporateBlueprints();

      var assetsFiltered;
      
      if (hangars) {
        assetsFiltered = assets.data.filter(item => {
          return hangars.some(hangar => _blueprintMatchesHangar({
            locationId: item.location_id,
            locationFlag: item.location_flag,
          }, hangar));
        });
      } else assetsFiltered = assets.data;

//      console.log(assetsFiltered);

      var assetsTranslated = assetsFiltered.map(a => ({
          itemId: a.item_id,
          typeId: a.type_id,
          typeName: Universe.getType(a.type_id).type_name,
          quantity: a.quantity,
          locationId: a.location_id,
          locationFlag: a.location_flag,
          materialEfficiency: a.material_efficiency,
          timeEfficiency: a.time_efficiency,
          runs: a.runs,
          quantity: a.quantity,
          hangar: Corporation.getHangarName(a.location_id)
        }));

      return {age: assets.age, cacheRefresh: assets.cacheRefresh, lastModified: assets.lastModified, expires: assets.expires, data : assetsTranslated};
    },

    /*
     * Returns job report on specific month
     * year: requested year
     * month: requested month
     * out: array of JSONs
     */
    getJobsReport(year, month) {
      // read report from AubiApi
      var report = Aubi.getJobsReport(year, month);
//      console.log(report)

      // translate codes to names
      var reportTranslated = report.map(a=> ({
        installerName: Universe.getCharacterName(a.installerId),
        manufacturing: 0 + a.manufacturing / 3600,
        researchTE: 0 + a.researchTE / 3600,
        researchME: 0 + a.researchME / 3600,
        copying: 0 + a.copying / 3600,
        invention: 0 + a.invention / 3600,
        reaction: 0 + a.reaction / 3600,
        total: (0 + a.manufacturing + a.researchTE + a.researchME + a.copying + a.invention + a.reaction) / 3600
      }))
//      console.log(reportTranslated);

      return reportTranslated;

    },

    /*
     * Loads the job report to the job history sheet
     */
    updateHistorySheet() {
      // read report parameters
      range = jobHistorySheet.getRange(1, 16, 2, 1);
      var data = range.getValues();
      var year = data[0][0];
      var month = data[1][0];

      if (!(year > 2020 && year < 2050)) {
        SpreadsheetApp.getUi().alert('Chyba!', 'Neplatný rok ' + year, SpreadsheetApp.getUi().ButtonSet.OK);
        return;
      }
      if (!(month > 0 && month < 13)) {
        SpreadsheetApp.getUi().alert('Chyba!', 'Neplatný měsíc ' + month, SpreadsheetApp.getUi().ButtonSet.OK);
        return;
      }

      // clear last results
      var lastRow = jobHistorySheet.getLastRow();
      var dataRowCount = Math.max(0, lastRow - 1);
      if (dataRowCount > 0) {
        var range = jobHistorySheet.getRange(2, 5, dataRowCount, 8);
        range.setValue('');
      }

      const writeReportRows = function(rows) {
        if (rows.length <= 0) return false;
        range = jobHistorySheet.getRange(2, 5, rows.length, 8);
        range.setValues(rows);
        return true;
      };

      const syncMainMappingRows = function(report) {
        if (!report || report.length <= 0) return;

        const currentLastRow = jobHistorySheet.getLastRow();
        const existingNames = currentLastRow > 1
          ? jobHistorySheet.getRange(2, 1, currentLastRow - 1, 2).getValues()
              .map(row => String(row[0] || '').trim())
              .filter(Boolean)
          : [];
        const knownNames = new Set(existingNames);
        const missingRows = [];

        report.forEach(item => {
          const installerName = String(item && item.installerName || '').trim();
          if (!installerName || knownNames.has(installerName)) return;
          knownNames.add(installerName);
          missingRows.push([installerName, '']);
        });

        if (missingRows.length <= 0) return;

        jobHistorySheet
          .getRange(currentLastRow + 1, 1, missingRows.length, 2)
          .setValues(missingRows);

        if (Universe.resetMainMapCache) {
          Universe.resetMainMapCache();
        }
      };

      const toHistoryRows = function(report) {
        return report.map(a => [a.installerName, a.copying, a.invention, a.manufacturing, a.reaction, a.researchME, a.researchTE, a.total]);
      };

      let report = this.getJobsReport(year, month);
      syncMainMappingRows(report);
      var rows = toHistoryRows(report);
      if (writeReportRows(rows)) return;

      const now = new Date();
      const isCurrentMonth = Number(year) === now.getFullYear() && Number(month) === (now.getMonth() + 1);
      if (isCurrentMonth) {
        SpreadsheetApp.getActive().toast('Historie: backend vrátil prázdný report, zkouším synchronizaci Industry Jobs...', 'Historie', 8);
        try {
          Aubi.syncIndustryJobs({ silent: true });
          report = this.getJobsReport(year, month);
          syncMainMappingRows(report);
          rows = toHistoryRows(report);
          if (writeReportRows(rows)) {
            SpreadsheetApp.getActive().toast('Historie: data byla po synchronizaci načtena.', 'Historie', 5);
            return;
          }
        } catch (e) {
          SpreadsheetApp.getActive().toast('Historie: automatická synchronizace Industry Jobs selhala: ' + e, 'Historie', 10);
          return;
        }
      }

      const message = isCurrentMonth
        ? 'Pro aktuální měsíc backend nevrátil žádná data ani po synchronizaci Industry Jobs.'
        : 'Backend pro zvolený měsíc nevrátil žádná data.';
      SpreadsheetApp.getActive().toast(message, 'Historie', 8);
    },

    /*
     * updates bounty journal sheet
     */
    updateBountySheet() {
      // read report parameters
      range = bountySheet.getRange(1, 6, 2, 1);
      var data = range.getValues();
      var year = data[0][0];
      var month = data[1][0];

      if (!(year > 2020 && year < 2050)) {
        SpreadsheetApp.getUi().alert('Chyba!', 'Neplatný rok ' + year, SpreadsheetApp.getUi().ButtonSet.OK);
        return;
      }
      if (!(month > 0 && month < 13)) {
        SpreadsheetApp.getUi().alert('Chyba!', 'Neplatný měsíc ' + month, SpreadsheetApp.getUi().ButtonSet.OK);
        return;
      }

      // clear last results
      var lastRow = bountySheet.getLastRow();
      if (lastRow > 1) {
        var range = bountySheet.getRange(2, 1, lastRow - 1, 3);
        range.setValue('');
      }

/*
      // get bounty from EVE API - only last month available
      let bounty = this.getWalletJournal(1, 'bounty_prizes');
      var rows = bounty.data.map(a => [a.date, a.amount, a.party2, a.party1, a.description]);
      range = bountySheet.getRange(2, 1, rows.length, 5);
      range.setValues(rows);
*/
      const writeBountyRows = function(items) {
        if (items.length <= 0) return false;

        // translate party to name
        var translated = items.map(a => ({ amount : a.amount, name : Universe.getName(a.secondPartyId).name}));
        console.log(translated)

        // translate to rows and get character main name
        var rows = translated.map(a => 
          [ a.name,
            Universe.getMainName(a.name),
            a.amount
          ]);

        range = bountySheet.getRange(2, 1, rows.length, 3);
        range.setValues(rows);
        return true;
      };

      // get bounty from historized tables on AubiApi
      let bounty = Aubi.getWalletJournal(1, year, month, ['bounty_prizes','ess_escrow_transfer']);
      console.log(bounty);
/*
      [ { amount: 213685.44, secondPartyId: 92425760 },
        { amount: 37284562.32, secondPartyId: 93015796 },
*/
      if (writeBountyRows(bounty)) {
        return;
      }

      const now = new Date();
      const isCurrentMonth = Number(year) === now.getFullYear() && Number(month) === (now.getMonth() + 1);
      if (isCurrentMonth) {
        SpreadsheetApp.getActive().toast('Bounty: backend vrátil prázdný report, zkouším synchronizaci wallet journalu...', 'Bounty', 8);
        try {
          Aubi.syncWalletJournal(1, { silent: true });
          bounty = Aubi.getWalletJournal(1, year, month, ['bounty_prizes','ess_escrow_transfer']);
          if (writeBountyRows(bounty)) {
            SpreadsheetApp.getActive().toast('Bounty: data byla po synchronizaci načtena.', 'Bounty', 5);
            return;
          }
        } catch (e) {
          SpreadsheetApp.getActive().toast('Bounty: automatická synchronizace wallet journalu selhala: ' + e, 'Bounty', 10);
          return;
        }
      }

      const message = isCurrentMonth
        ? 'Pro aktuální měsíc backend nevrátil bounty data ani po synchronizaci wallet journalu.'
        : 'Backend pro zvolený měsíc nevrátil bounty data. To značí, že v backend DB chybí historická wallet data nebo měsíční snapshot pro tento měsíc.';
      SpreadsheetApp.getActive().toast(message, 'Bounty', 8);

    },

    /*
     * Returns corporate jobs in specific hangars
     * hangars: array of hangars - location IDs of job outputs
     * out: array of JSONs
     */
    getJobs(hangars, all = false) {
      var jobs = Eve.getCorporateJobs(all);

      var jobsFiltered;

      if (hangars.length > 0) {
        jobsFiltered = jobs.data.filter(item => {
          return (hangars.some(hangar => hangar.locationID == item.output_location_id))
        });
      } else jobsFiltered = jobs.data;

//      console.log(jobsFiltered);

      var jobsTranslated = jobsFiltered.map(a => ({
          jobId : a.job_id,
          activityId: a.activity_id,
          activityName: Universe.getActivity(a.activity_id),
          blueprintId : a.blueprint_id,
          blueprintLocationId: a.blueprint_location_id,
          blueprintTypeId: a.blueprint_type_id,
          blueprintName: Universe.getType(a.blueprint_type_id).type_name,
          duration: a.duration,
//          duration: (Date.parse(a.end_date) - Date.now()) / 1000,
          runs: a.runs,
          licensedRuns: a.licensed_runs,
          successfulRuns: a.successful_runs,
          productTypeId: a.product_type_id,
          productName: Universe.getType(a.product_type_id).type_name,
          status: a.status,
          facilityId : a.facility_id,
          locationId : a.location_id,
          locationName : Corporation.getHangarName(a.location_id),
          outputLocationId : a.output_location_id,
          outputLocationName : Corporation.getHangarName(a.output_location_id),
          installerName: Universe.getCharacterName(a.installer_id),
          probability : a.probability,
          startDate: a.start_date,
          endDate: a.end_date,
          completedDate: a.completed_date,
          startTime: new Date(a.start_date).getTime(),
          endTime: new Date(a.end_date).getTime(),
          completedTime: new Date(a.completed_date).getTime()
        }));

      return {age: jobs.age, cacheRefresh: jobs.cacheRefresh, lastModified : jobs.lastModified, expires : jobs.expires, data : jobsTranslated};
    },    

    /*
     * Returns corporate jobs in specific hangars
     * hangars: array of hangars - location IDs of job outputs
     * out: array of JSONs
     */
    getWalletJournal(division, type) {
      var journal = Eve.getCorporateWalletJournal(division);

      var journalFiltered;

      if (type) {
        journalFiltered = journal.data.filter(item => item.ref_type == type);
      } else journalFiltered = journal.data;
//      console.log(journalFiltered);

      var journalTranslated = journalFiltered.map(a => ({
          date : a.date,
          amount : a.amount,
          tax : a.tax,
          description : a.description,
          type : a.ref_type,
          party1 :  Universe.getName(a.first_party_id).name,
          party2 :  Universe.getName(a.second_party_id).name,
        }));

      return {age: journal.age, cacheRefresh: journal.cacheRefresh, lastModified : journal.lastModified, expires : journal.expires, data : journalTranslated};
    },  

    /*
     * Returns corporate market orders
     * type: 0 - all, 1 - buy, 2 - sell
     * out: array of JSONs
     */
    getMarketOrders(type = 0) {
      var orders = Eve.getCorporateMarketOrders();

      var ordersFiltered;

      // filter buy orders
      if (type == 1) {
        ordersFiltered = orders.data.filter(item => item.is_buy_order == true);
      }
      // filter sell orders
      else if (type == 2) {
        ordersFiltered = orders.data.filter(item => !item.is_buy_order);
      }
      // all orders
      else ordersFiltered = orders.data;

//      console.log(ordersFiltered);

      var ordersTranslated = ordersFiltered.map(a => ({
        issued: a.issued,
        issuedBy: Universe.getCharacterName(a.issued_by),
        locationId: a.location_id,
        locationName: Universe.getLocationName(a.location_id),
        orderId: a.order_id,
        price: a.price,
        range: a.range,
        regionId: a.region_id,
        typeId: a.type_id,
        typeName: Universe.getType(a.type_id).type_name,
        volumeRemain: a.volume_remain,
        volumeTotal: a.volume_total,
        walletDivision: this.getDivisionName(a.wallet_division)
/*
          activityId: a.activity_id,
          activityName: Universe.getActivity(a.activity_id),
          blueprintTypeId: a.blueprint_type_id,
          blueprintName: Universe.getType(a.blueprint_type_id).type_name,
//          duration: a.duration,
          duration: (Date.parse(a.end_date) - Date.now()) / 1000,
          runs: a.runs,
          licensedRuns: a.licensed_runs,
          productTypeId: a.product_type_id,
          productName: Universe.getType(a.product_type_id).type_name,
          status: a.status,
          locationId : a.location_id,
          locationName : Corporation.getHangarName(a.location_id),
          outputLocationId : a.output_location_id,
          outputLocationName : Corporation.getHangarName(a.output_location_id),
          installerName: Universe.getCharacterName(a.installer_id),
          startDate: a.start_date,
          endDate: a.end_date
          */
        }));

      return {age: orders.age, cacheRefresh: orders.cacheRefresh, data : ordersTranslated};
    },    

    getActivityReport: function(year, month) {
      var report = Aubi.getActivityReport(year, month) || {};
      var summary = Array.isArray(report.summary) ? report.summary : [];
      var meta = report.meta || {};
      return {
        summary: summary,
        meta: meta
      };
    },

    syncActivity: function() {
      var sheet = _getOrCreateActivitySheet();
      _ensureActivityLayout(sheet);

      var period = _readActivityPeriod(sheet);
      if (!_isValidActivityPeriod(period.year, period.month)) {
        SpreadsheetApp.getUi().alert('Chyba!', 'Neplatný rok nebo měsíc v Activity.', SpreadsheetApp.getUi().ButtonSet.OK);
        return;
      }

      var report = this.getActivityReport(period.year, period.month);
      var rows = _translateActivityRows(report.summary || []);
      if (rows.length > 0) {
        _writeActivitySummary(sheet, rows, report.meta || {}, period.year, period.month);
        SpreadsheetApp.getActive().toast('Activity: načteno ' + rows.length + ' pilotů.', 'Activity', 5);
        return report;
      }

      var now = new Date();
      var isCurrentMonth = Number(period.year) === now.getFullYear() && Number(period.month) === (now.getMonth() + 1);
      if (isCurrentMonth) {
        SpreadsheetApp.getActive().toast('Activity: backend zatím pro aktuální měsíc nic nevrátil, zkouším jednorázový sync...', 'Activity', 8);
        try {
          Aubi.syncActivity({ silent: true });
          report = this.getActivityReport(period.year, period.month);
          rows = _translateActivityRows(report.summary || []);
          _writeActivitySummary(sheet, rows, report.meta || {}, period.year, period.month);
          if (rows.length > 0) {
            SpreadsheetApp.getActive().toast('Activity: data byla po synchronizaci načtena.', 'Activity', 5);
            return report;
          }
        } catch (e) {
          SpreadsheetApp.getActive().toast('Activity: automatická synchronizace selhala: ' + e, 'Activity', 10);
          return;
        }
      }

      _writeActivitySummary(sheet, [], report.meta || {}, period.year, period.month);
      SpreadsheetApp.getActive().toast(
        isCurrentMonth
          ? 'Pro aktuální měsíc backend zatím nemá Activity data ani po jednorázové synchronizaci.'
          : 'Backend pro zvolený měsíc nevrátil Activity data.',
        'Activity',
        8
      );
      return report;
    },

    /*
     * Returns BPOs and reaction formulas in all hangars including those used in jobs
     * out: array of JSONs
     */
    /*
    getBlueprints() {
      // download all assets
      var assets = Eve.getCorporateAssets(this.getId());

      // add type and group info
      var assetsTranslated = assets.data.map(a => ({
          type: Universe.getType(a.type_id),
          item_id: a.item_id,
          is_blueprint_copy : a.is_blueprint_copy,
          quantity: a.quantity
        }));

      // filter BPOs
      var bpos = assetsTranslated.filter(item => (item.type.category_id == 9));
//      console.log(bpos);

      // download all jobs
      var jobs = Eve.getCorporateJobs(false);
      // console.log(jobs)

      // filter only reaction, upgrade and copy jobs => ignore manufacturong and invention
      var jobsFiltered = jobs.data.filter(item => (item.activity_id != 1 && item.activity_id != 8));
      // console.log(jobs)

      // add type and group info
      var jobsTranslated = jobsFiltered.map(a => ({
          type: Universe.getType(a.blueprint_type_id),
          quantity: 1
        }));
      // console.log(jobsTranslated);

      // merge assets and jobs and sort them by type name
      var result = bpos.concat(jobsTranslated)
      result.sort(function (a, b) {
        if (a.type.type_name < b.type.type_name) return -1;
        if (a.type.type_name > b.type.type_name) return 1;
        return 0;
      });

      return {age: assets.age, cacheRefresh: assets.cacheRefresh, data : result};
    },
*/
    /*
    * Helper function - finds hangar details for a hangar of specified type and name
    */
    getHangarByName (type, name) {
      var lastRow = hangarsSheet.getLastRow();
      var hangarArray;
      var hangar;

      // read data from sheet to array
      if (type == 'Research') hangarArray = hangarsSheet.getRange(3, 15, lastRow, 6).getValues();
      else if (type == 'Reaction') hangarArray = hangarsSheet.getRange(3, 8, lastRow, 6).getValues();
      else if (type == 'Capital') hangarArray = hangarsSheet.getRange(3, 22, lastRow, 6).getValues();
      else hangarArray = hangarsSheet.getRange(3, 1, lastRow, 6).getValues();

      // look for hangar in the array of hangars by name
      hangar = hangarArray.find(element => element[5] == name)

      // empty row means hangar not found
      if (!hangar) return null;

      var ret = {}
      ret.locationID = hangar[0];
      ret.locationType = hangar[1];
      ret.locationFlag = hangar[2];
      
      return ret;
    },

    /*
     * Returns hangar name by Id
     * typeId: hangar ID
     * out: string
     */
    getHangarName: function(hangarId) {
      // first get the reaction hangar map and initialize if needed
      const hangarsR = getHangarsRMap();
      let ret = hangarsR.get(hangarId);

      if (ret) {
        return ret;
      }

      // second get the manufacturing hangar map and initialize if needed
      const hangarsM = getHangarsMMap();
      ret = hangarsM.get(hangarId);

      if (ret) {
        return ret;
      }

      // third get the research hangar map and initialize if needed
      const hangarsRes = getHangarsResMap();
      ret = hangarsRes.get(hangarId);

      if (ret) {
        return ret;
      }

      // last get the research hangar map and initialize if needed
      const hangarsCap = getHangarsCapMap();
      ret = hangarsCap.get(hangarId);

      if (ret) {
        return ret;
      }

      return "-";
    },

    /*
    * fetches office hangars at corporate structure
    * structureId: corporate structure Id, f.eg. this.manufacturingStructure.structure_id
    * out: array of locationID, locationType, locationFlag, hangar, container
    */
    getStructureHangars: function(structureId) {
      // get all corp asssets from ESI
      var assets = Eve.getCorporateAssets(this.getId());
      console.log(assets);

      // get the office folder of the structure
      var officeFolders = assets.data.filter(item => item.location_id == structureId && item.location_flag == 'OfficeFolder');
      console.log(officeFolders);
      if (officeFolders.length == 0) return [];

      const officeFolder = officeFolders[0].item_id;

      // get list of containers in the office folder
      var officeContainers = assets.data.filter(item => item.location_id == officeFolder 
        && item.is_singleton == true
        && (item.type_id >= 17363 && item.type_id <= 17368 )
      );
      console.log(officeContainers);

      let officeContainersNames = null;

      // get container names from ESI
      if (officeContainers.length > 0) {
        var officeContainersIds = officeContainers.map(item => item.item_id);
        console.log(officeContainersIds);
        officeContainersNames = Eve.getCorporateAssetsNames(officeContainersIds);
        console.log(officeContainersNames)
      }

      //prepare empty result
      var result = [];
      
      // iterate through corporate office names
      const iterator = corpSAGMap.entries();

      for (const item of iterator) {
//        console.log(item);
        // add root hangar
        result.push({
          "locationId": officeFolder,
          "locationType": "station" ,
          "locationFlag": item[0],
          "hangar": item[1],
          "container": ""
        })

        // fiter all containers in this hangar
        if (officeContainers.length > 0) {
          var hangarContainers = officeContainers.filter(cont => cont.location_flag == item[0]);
          hangarContainers.forEach(i => {
            // find translation
            let itemName = officeContainersNames.find(e => e.item_id == i.item_id);

            result.push({
              "locationId": i.item_id,
              "locationType": "item",
              "locationFlag": item[0],
              "hangar": item[1],
              "container": itemName.name
            })
          })
        }

        // sort result
        result.sort(function (a, b) {
          if (a.locationFlag == b.locationFlag) {
            if (a.container < b.container) return -1;
            if (a.container > b.container) return 1;
            return 0;
          }
          if (a.locationFlag < b.locationFlag) return -1;
          return 1;
      });


      }

      return result;
    },

    /*
    * Updates corporate hangars sheet
    */
    syncHangars: function() {

      // smaz data
      var lastRow = hangarsSheet.getLastRow();
      var range = hangarsSheet.getRange(3, 1, lastRow, 31);
      range.clearContent();

      var hangar = Corporation.getStructureHangars(Corporation.getManufacturingStructure().structure_id);
      var rows = hangar.map(a => [a.locationId, a.locationType, a.locationFlag, a.hangar, a.container, a.hangar + (a.container ? " - " + a.container : "")]);
      range = hangarsSheet.getRange(3, 1, rows.length, 6);
      range.setValues(rows);

      hangar = Corporation.getStructureHangars(Corporation.getReactionStructure().structure_id);
      rows = hangar.map(a => [a.locationId, a.locationType, a.locationFlag, a.hangar, a.container, a.hangar + (a.container ? " - " + a.container : "")]);
      range = hangarsSheet.getRange(3, 8, rows.length, 6);
      range.setValues(rows);

      hangar = Corporation.getStructureHangars(Corporation.getResearchStructure().structure_id);
      rows = hangar.map(a => [a.locationId, a.locationType, a.locationFlag, a.hangar, a.container, a.hangar + (a.container ? " - " + a.container : "")]);
      range = hangarsSheet.getRange(3, 15, rows  .length, 6);
      range.setValues(rows);

      hangar = Corporation.getStructureHangars(Corporation.getCapitalStructure().structure_id);
      rows = hangar.map(a => [a.locationId, a.locationType, a.locationFlag, a.hangar, a.container, a.hangar + (a.container ? " - " + a.container : "")]);
      if (rows.length > 0) {
        range = hangarsSheet.getRange(3, 22, rows.length, 6);
        range.setValues(rows);
      }
            
      // show result in notification window
      SpreadsheetApp.getUi().alert('Synchronizace dokončena.', '', SpreadsheetApp.getUi().ButtonSet.OK);
    },

    /*
    * Updates corporate assets sheet
    */
    syncAssets: function() {
      // underlying sheet will be rewritten -> invalidate memo
      _cacheMemo.assets = null;

      // clear the sheet contents
      var lastRow = assetsSheet.getLastRow();
      var range;
      if (lastRow > 1) {
        range = assetsSheet.getRange(2, 1, lastRow - 1, 12);
        range.clearContent();
      }

      var assets = Corporation.getAssets();

      let modified = new Date(assets.lastModified);
      trace("Modified " + modified + "(" + assets.lastModified + ")" + " exp " + assets.expires);

      // log cache date info
      range = assetsSheet.getRange(1, 8, 1, 3);
      range.setValues([[modified, assets.lastModified, assets.expires]]);

      // filter only items in a hangar
      assetsFiltered = assets.data.filter(item => item.hangar != null);
      var rows = assetsFiltered.map(a => [a.locationId, a.locationType, a.locationFlag, a.hangar, a.typeId, a.typeName, a.quantity]);

      range = assetsSheet.getRange(2, 1, rows.length, 7);
      range.setValues(rows);
    },

    /*
     * Loads jobs stored in industry sheet
     * if data stored in sheet have expoired cache, re-sync sheet
     */ 
    loadAssets: function() {
      if (_cacheMemo.assets && _freezeMemo) {
        if (typeof Sidebar !== 'undefined' && Sidebar.setCacheInfo && _cacheMemo.assets.expires) {
          Sidebar.setCacheInfo({ assetsExpiresMs: Number(_cacheMemo.assets.expires) });
        }
        return _cacheMemo.assets;
      }

      // If runtime is warm and memo is present, only reuse it while it is still valid.
      if (_cacheMemo.assets && _cacheMemo.assets.expires && (new Date().getTime() <= _cacheMemo.assets.expires)) {
        if (typeof Sidebar !== 'undefined' && Sidebar.setCacheInfo) {
          Sidebar.setCacheInfo({ assetsExpiresMs: Number(_cacheMemo.assets.expires) });
        }
        return _cacheMemo.assets;
      }

      trace('### Loading corporate assets ...')

      let date = new Date().getTime()
      var assets = {};
      assets.data = [];
      assets.lastModified = assetsSheet.getRange(1,9,1,1).getValue();
      assets.expires = assetsSheet.getRange(1,10,1,1).getValue();
      assets.age = Math.trunc((date - assets.lastModified) / 1000);
      assets.cacheRefresh = Math.trunc((assets.expires - date) / 1000);

      if (typeof Sidebar !== 'undefined' && Sidebar.setCacheInfo) {
        Sidebar.setCacheInfo({ assetsExpiresMs: Number(assets.expires) });
      }

      // check if asset cache is expired and refresh it
      if (new Date().getTime() > assets.expires) {
        Sidebar.add("Aktualizuju cache skladu");
        this.syncAssets();
        date = new Date().getTime();
        assets.lastModified = assetsSheet.getRange(1,9,1,1).getValue();
        assets.expires = assetsSheet.getRange(1,10,1,1).getValue();
        assets.age = Math.trunc((date - assets.lastModified) / 1000);
        assets.cacheRefresh = Math.trunc((assets.expires - date) / 1000);

        if (typeof Sidebar !== 'undefined' && Sidebar.setCacheInfo) {
          Sidebar.setCacheInfo({ assetsExpiresMs: Number(assets.expires) });
        }
      } else {
        Sidebar.add("Cache skladu je platná do " + new Date(assets.expires));
      }

      var lastRow = assetsSheet.getLastRow();
      if (lastRow > 1) {
        // load assets from sheet from the sheet contents
        let assetsArray = assetsSheet.getRange(2, 1, lastRow - 1, 7).getValues();

        assets.data = assetsArray.map (a => ({
          locationId : a[0],
          locationType : a[1],
          locationFlag : a[2],
          hangar : a[3],
          typeId : a[4],
          typeName : a[5],
          quantity : a[6]
        }));

//        console.log(assets);

        _cacheMemo.assets = assets;
        return assets;

      }

      _cacheMemo.assets = assets;
      return assets;
    },

    /*
    * Updates corporate industry jobs sheet
    */
    syncJobs: function() {

      // underlying sheet will be rewritten -> invalidate memo
      _cacheMemo.jobs = null;

      // clean insustry jobs sheet
      _time('syncJobs clear sheet', () => {
        var lastRow = industryJobsSheet.getLastRow();
        if (lastRow > 1) {
          industryJobsSheet.getRange(2, 1, lastRow - 1, 19).clearContent();
        }
      });

      // get all running jobs
      var jobs = _time('syncJobs fetch ESI jobs', () => Corporation.getJobs([], true));

      let modified = new Date(jobs.lastModified);
      trace("Modified " + modified + "(" + jobs.lastModified + ")" + " exp " + jobs.expires);

      // log cache date info
      range = industryJobsSheet.getRange(1, 20, 1, 3);
      range.setValues([[modified, jobs.lastModified, jobs.expires]]);

      // store jobs to sheet
      var rows = jobs.data.map(a => [
        a.activityName, 
        a.status, 
        a.duration, 
        a.blueprintName, 
        a.productName, 
        a.locationName, 
        a.outputLocationName, 
        a.installerName,
        a.startDate,
        a.endDate,
        a.runs,
        a.blueprintId,
        a.blueprintLocationId,
        a.productTypeId,
        a.locationId,
        a.outputLocationId,
        a.completedDate,
        a.licensedRuns,
        a.successfulRuns
        ]);
      _time('syncJobs write sheet', () => {
        range = industryJobsSheet.getRange(2, 1, rows.length, 19);
        range.setValues(rows);
      });

      // keep the freshly-synced jobs in memo so callers don't have to re-read the sheet
      _cacheMemo.jobs = jobs;
      return jobs;

    /*

              jobId : a.job_id,
              activityId: a.activity_id,
              blueprintTypeId: a.blueprint_type_id,
              licensedRuns: a.licensed_runs,
              facilityId : a.facility_id,
              probability : a.probability,
    */
    },

    // loads jobs stored in industry sheet
    loadJobs: function() {
      if (_cacheMemo.jobs && _freezeMemo) {
        if (typeof Sidebar !== 'undefined' && Sidebar.setCacheInfo && _cacheMemo.jobs.expires) {
          Sidebar.setCacheInfo({ jobsExpiresMs: Number(_cacheMemo.jobs.expires) });
        }
        return _cacheMemo.jobs;
      }

      // If runtime is warm and memo is present, only reuse it while it is still valid.
      if (_cacheMemo.jobs && _cacheMemo.jobs.expires && (new Date().getTime() <= _cacheMemo.jobs.expires)) {
        if (typeof Sidebar !== 'undefined' && Sidebar.setCacheInfo) {
          Sidebar.setCacheInfo({ jobsExpiresMs: Number(_cacheMemo.jobs.expires) });
        }
        return _cacheMemo.jobs;
      }

      trace('### Loading corporate jobs ...')

      let date = new Date().getTime()
      var jobs = {};
      jobs.data = [];
      jobs.lastModified = industryJobsSheet.getRange(1,21,1,1).getValue();
      jobs.expires = industryJobsSheet.getRange(1,22,1,1).getValue();
      jobs.age = Math.trunc((date - jobs.lastModified) / 1000);
      jobs.cacheRefresh = Math.trunc((jobs.expires - date) / 1000);
      trace(jobs);

      if (typeof Sidebar !== 'undefined' && Sidebar.setCacheInfo) {
        Sidebar.setCacheInfo({ jobsExpiresMs: Number(jobs.expires) });
      }

      // check if asset cache is expired and refresh it
      if (date > jobs.expires) {
        Sidebar.add("Aktualizuju cache jobů");
        // syncJobs already returns the translated jobs object (and memoizes it)
        var syncedJobs = _time('syncJobs total', () => this.syncJobs());
        if (syncedJobs) {
          if (typeof Sidebar !== 'undefined' && Sidebar.setCacheInfo && syncedJobs.expires) {
            Sidebar.setCacheInfo({ jobsExpiresMs: Number(syncedJobs.expires) });
          }
          return syncedJobs;
        }

        // Fallback: re-read metadata from sheet (shouldn't normally happen)
        date = new Date().getTime();
        jobs.lastModified = industryJobsSheet.getRange(1,21,1,1).getValue();
        jobs.expires = industryJobsSheet.getRange(1,22,1,1).getValue();
        jobs.age = Math.trunc((date - jobs.lastModified) / 1000);
        jobs.cacheRefresh = Math.trunc((jobs.expires - date) / 1000);

        if (typeof Sidebar !== 'undefined' && Sidebar.setCacheInfo) {
          Sidebar.setCacheInfo({ jobsExpiresMs: Number(jobs.expires) });
        }
      } else {
        Sidebar.add("Cache jobů je platná do " + new Date(jobs.expires));
      }

      var lastRow = industryJobsSheet.getLastRow();
      if (lastRow > 1) {
        // load jobs from sheet from the sheet contents
        let jobsArray = industryJobsSheet.getRange(2, 1, lastRow - 1, 19).getValues();

        jobs.data = jobsArray.map (a => ({
          activityName : a[0],
          status : a[1],
          duration : a[2],
          blueprintName : a[3], 
          productName : a[4], 
          locationName : a[5], 
          outputLocationName : a[6], 
          installerName : a[7],
          startDate : a[8],
          endDate : a[9],
          runs : a[10],
          blueprintId : a[11],
          blueprintLocationId : a[12],
          productTypeId : a[13],
          locationId : a[14],
          outputLocationId : a[15],
          completedDate: a[16],
          licensedRuns: a[17],
          successfulRuns: a[18],
          startTime: new Date (a[8]).getTime(),
          endTime: new Date (a[9]).getTime(),
          completedTime: new Date (a[16]).getTime()
        }));

//        console.log(jobs);

        _cacheMemo.jobs = jobs;
        return jobs;

      }

      _cacheMemo.jobs = jobs;
      return jobs;
    },


    /*
    * Updates corporate blueprints sheet
    */
    syncBlueprints: function() {
      // underlying sheet will be rewritten -> invalidate memo
      _cacheMemo.blueprints = null;

      // clear the sheet contents
      var lastRow = blueprintsSheet.getLastRow();
      var range;
      if (lastRow > 1) {
        range = blueprintsSheet.getRange(2, 1, lastRow - 1, 10);
        range.clearContent();
      }

      var blueprints = Corporation.getBlueprints();

      let modified = new Date(blueprints.lastModified);
      trace("Modified " + modified + "(" + blueprints.lastModified + ")" + " exp " + blueprints.expires);

      // log cache date info
      range = blueprintsSheet.getRange(1, 11, 1, 3);
      range.setValues([[modified, blueprints.lastModified, blueprints.expires]]);

      // store to sheet
      var rows = blueprints.data.map(a => [a.locationId, a.locationFlag, a.itemId, a.hangar, a.typeId, a.typeName, a.quantity, a.runs, a.materialEfficiency, a.timeEfficiency]);
      range = blueprintsSheet.getRange(2, 1, rows.length, 10);
      range.setValues(rows);
    },

    /*
     * Loads corporate blueprints stored in blueprints sheet
     * if data stored in sheet have expired cache, re-sync sheet
     */ 
    loadBlueprints: function() {
      if (_cacheMemo.blueprints && _freezeMemo) {
        if (typeof Sidebar !== 'undefined' && Sidebar.setCacheInfo && _cacheMemo.blueprints.expires) {
          Sidebar.setCacheInfo({ blueprintsExpiresMs: Number(_cacheMemo.blueprints.expires) });
        }
        return _cacheMemo.blueprints;
      }

      // If runtime is warm and memo is present, only reuse it while it is still valid.
      if (_cacheMemo.blueprints && _cacheMemo.blueprints.expires && (new Date().getTime() <= _cacheMemo.blueprints.expires)) {
        if (typeof Sidebar !== 'undefined' && Sidebar.setCacheInfo) {
          Sidebar.setCacheInfo({ blueprintsExpiresMs: Number(_cacheMemo.blueprints.expires) });
        }
        return _cacheMemo.blueprints;
      }

      trace('### Loading corporate blueprints ...')

      let date = new Date().getTime()
      var blueprints = {};
      blueprints.data = [];
      blueprints.lastModified = blueprintsSheet.getRange(1,12,1,1).getValue();
      blueprints.expires = blueprintsSheet.getRange(1,13,1,1).getValue();
      blueprints.age = Math.trunc((date - blueprints.lastModified) / 1000);
      blueprints.cacheRefresh = Math.trunc((blueprints.expires - date) / 1000);

      if (typeof Sidebar !== 'undefined' && Sidebar.setCacheInfo) {
        Sidebar.setCacheInfo({ blueprintsExpiresMs: Number(blueprints.expires) });
      }

      // check if asset cache is expired and refresh it
      if (date > blueprints.expires) {
        Sidebar.add("Aktualizuju cache blueprintů");
        this.syncBlueprints();
        date = new Date().getTime();
        blueprints.lastModified = blueprintsSheet.getRange(1,12,1,1).getValue();
        blueprints.expires = blueprintsSheet.getRange(1,13,1,1).getValue();
        blueprints.age = Math.trunc((date - blueprints.lastModified) / 1000);
        blueprints.cacheRefresh = Math.trunc((blueprints.expires - date) / 1000);

        if (typeof Sidebar !== 'undefined' && Sidebar.setCacheInfo) {
          Sidebar.setCacheInfo({ blueprintsExpiresMs: Number(blueprints.expires) });
        }
      } else {
        Sidebar.add("Cache blueprintů je platná do " + new Date(blueprints.expires));
      }

      var lastRow = blueprintsSheet.getLastRow();
      if (lastRow > 1) {
        // load blueprints from the sheet contents
        let blueprintsArray = blueprintsSheet.getRange(2, 1, lastRow - 1, 10).getValues();

        blueprints.data = blueprintsArray.map (a => ({
          locationId : a[0],
          locationFlag : a[1],
          itemId : a[2],
          hangar : a[3],
          typeId : a[4],
          typeName : a[5],
          quantity : a[6],
          runs : a[7],
          materialEfficiency : a[8],
          timeEfficiency : a[9]
        }));


      var rows = blueprints.data.map(a => [a.locationId, a.locationFlag, a.itemId, a.hangar, a.typeId, a.typeName, a.quantity, a.runs, a.materialEfficiency, a.timeEfficiency]);

//        console.log(blueprints);

        _cacheMemo.blueprints = blueprints;
        return blueprints;

      }

      _cacheMemo.blueprints = blueprints;
      return blueprints;
    },

    // Manual memo reset (useful at the beginning of pipelines)
    resetMemo: function() {
      _resetMemo();
    },

    // Freeze/unfreeze memo reuse for the current Apps Script execution.
    // When frozen, loadAssets/loadJobs/loadBlueprints will NOT re-sync mid-run.
    freezeMemo: function() {
      _setFreezeMemo(true);
    },

    unfreezeMemo: function() {
      _setFreezeMemo(false);
    },

    isMemoFrozen: function() {
      return _freezeMemo;
    },


    /*
     * Get assets in hangars from cache
     */ 
    getAssetsCached(hangars) {
      trace('### Loading corporate assets from cache ...')

      // load corporate assets
      assets = this.loadAssets();

      var assetsFiltered;
      if (hangars != null) {
        assetsFiltered = assets.data.filter(item => {
          return (hangars.some(hangar => hangar.locationID == item.locationId))
        });
      } else {
        assetsFiltered = assets.data;
      }

//      console.log(assetsFiltered);
      return {age: assets.age, cacheRefresh: assets.cacheRefresh, lastModified: assets.lastModified, expires: assets.expires, data : assetsFiltered};
    },

    /*
     * Get jobs in hangars from cache
     * delivered 
     */ 
    getJobsCached(hangars, all = false) {
      trace('### Loading corporate jobs from cache ...')

      // load corporate jobs
      jobs = this.loadJobs();

      // filter by location
      var jobsFiltered;
      if (hangars != null) {
        jobsFiltered = jobs.data.filter(item => {
          return (hangars.some(hangar => hangar.locationID == item.outputLocationId))
        });
      } else {
        jobsFiltered = jobs.data;
      }

      // filter by status
      if (!all) {
          // Default jobs view is strictly "running" jobs.
          // Recently delivered jobs are compensated separately in Blueprints.gs against stale asset/blueprint caches.
        let jobsFilteredActive = jobsFiltered.filter(
          item => item.status == 'active' 
//          || (item.completedTime > assetsLastModified && (item.activityName == "Manufacturing" || item.activityName == "Reaction"))
//          || (item.completedTime > blueprintsLastModified && (item.activityName != "Manufacturing" && item.activityName != "Reaction"))
          );

        return {age: jobs.age, cacheRefresh: jobs.cacheRefresh, lastModified: jobs.lastModified, expires: jobs.expires, data : jobsFilteredActive};
      } else {
        // return all jobs in hangars
        return {age: jobs.age, cacheRefresh: jobs.cacheRefresh, lastModified: jobs.lastModified, expires: jobs.expires, data : jobsFiltered};
      }

    },

    /*
     * Get blueprints in hangars from cache
     */ 
    getBlueprintsCached(hangars) {
      trace('### Loading corporate blueprints from cache ...')

      // load corporate blueprints
      blueprints = this.loadBlueprints();

      var blueprintsFiltered;
      if (hangars != null) {
        blueprintsFiltered = blueprints.data.filter(item => {
          return hangars.some(hangar => _blueprintMatchesHangar(item, hangar));
        });
      } else {
        blueprintsFiltered = blueprints.data;
      }

//      console.log(blueprintsFiltered);
      return {age: blueprints.age, cacheRefresh: blueprints.cacheRefresh, lastModified: blueprints.lastModified, expires: blueprints.expires, data : blueprintsFiltered};
    },

    /*
     * Get jobs in hangars from cache
     * delivered 
     */ 
    loadBPOs(hangars, all = false) {
      // Memoize within this Apps Script execution (also covers freezeMemo pipelines).
      // Note: empty array is a valid cached value, so we must check against null.
      if (_cacheMemo.bpos !== null) {
        return _cacheMemo.bpos;
      }

      trace('### Loading corporate BPOs ...')

      var lastRow = bpoSheet.getLastRow();

      if (lastRow > 1) {
        // load assets from sheet from the sheet contents
        let assetsArray = bpoSheet.getRange(4, 11, lastRow - 4, 2).getValues();

        assets = assetsArray.map (a => ({
          blueprintId : a[1],
          blueprint : a[0]
        }));

//        console.log(assets);

        _cacheMemo.bpos = assets;

        return assets;

      } else {
        _cacheMemo.bpos = [];
        return [];
      }

    },

    /*
     * Calculates delta in assets based on
     * - jobs started from the hangar after the asset last modified date
     * - jobs finished in the hangar after the asset last modified date
     */ 
    getAssetsApplyJobs(hangars) {
      Logger.log ('### Loading corporate assets applying jobs ...')

      // load corporate assets
      assets = this.loadAssets();
      console.log ("Assets from " + assets.lastModified)

      // load corporate industry jobs
      jobs = this.loadJobs();

      var assetsFiltered;
      var jobsFiltered;
      if (hangars != null) {
        assetsFiltered = assets.data.filter(item => {
          return (hangars.some(hangar => hangar.locationID == item.locationId))
        });

        jobsFiltered = jobs.data.filter(item => {
          return (hangars.some(hangar => hangar.locationID == item.outputLocationId))
        });
      } else {
        assetsFiltered = assets.data;
        jobsFiltered = jobs.data;
      }

      console.log(assetsFiltered);
      console.log(jobsFiltered);


      // filter all jobs started after asset modification date
      // will not work as the API does not return input location id
      //let jobsStarted = jobsFiltered.filter(item => (item.startTime > assets.lastModified));
      // console.log("New jobs:")
      // console.log(jobsStarted);

      // filter all jobs completed after asset modification date
      // will not work either as we dont know the BPC details - how many products from one run
      let jobsCompleted = jobsFiltered.filter(item => (item.completedTime > assets.lastModified));
      
      console.log("Completed jobs:")
      console.log(jobsCompleted);

    }
 
  }

})()

function syncHangars() {
  Corporation.syncHangars();
}

function syncAssets() {
  Corporation.syncAssets();
}

function syncBlueprints() {
  Corporation.syncBlueprints();
}


function syncJobs() {
  Corporation.syncJobs();
}

function testCorpLoadJobs() {
  console.log(Corporation.loadJobs());
}

function testCorpLoadAssets() {
  console.log(Corporation.loadAssets());
}

function testCorpLoadBlueprints() {
  console.log(Corporation.loadBlueprints());
}

function testCorpLoadBPOs() {
  console.log(Corporation.loadBPOs());
}

function testCorpGetJobsCached() {
  console.log(Corporation.getJobsCached([{locationID: 1042820302945}]));
  console.log(Corporation.getJobs([{locationID: 1042820302945}]));
}

function testCorpGetAssetsApplyJobs() {
  Corporation.getAssetsApplyJobs([{locationID: 1042820302945}]);
}


function testCorporationGetId() {
  console.log(Corporation.getId());
}

function testCorporateGetAssets() {
  console.log(Corporation.getAssets([1037804830105]));
}

function testCorporateGetJobs() {
  /*
  console.log(Corporation.getJobs([ { locationID: 1037781591789,
    locationType: 'item',
    locationFlag: 'CorpSAG6' },
  { locationID: 1037796923983,
    locationType: 'station',
    locationFlag: 'CorpSAG6' },
  { locationID: 1037781603029,
    locationType: 'item',
    locationFlag: 'CorpSAG6' } ]));
*/
  let jobs = Corporation.getJobs([], true)
  console.log(jobs);

  let job = jobs.data.filter(item => item.blueprintId == 1022080985861);

  console.log (job);

}

function testGetHangarName() {
  console.log(Corporation.getHangarName(1039058151169));
  console.log(Corporation.getHangarName(1037781558058));
}

function testGetStructureHangars() {
  console.log(Corporation.getStructureHangars(Corporation.getResearchStructure().structure_id));
}

function testGetCorpSAGName() {
  console.log(Corporation.getCorpSAGName('CorpSAG1'));
}

function testGetCorpBlueprints() {
  var bp = Corporation.getBlueprints()
//  console.log(bp);

  var capitalBP = bp.data.filter(item => item.typeName.startsWith('Capital') && item.runs == -1);

  console.log(capitalBP);

}

function testGetCorpMarketOrders() {
//  console.log(Corporation.getMarketOrders(1));
  console.log(Corporation.getMarketOrders(2));
 // console.log(Corporation.getBlueprints());
}

function testGetCorpWalletJournal() {
//  console.log(Corporation.getWalletJournal(1));
  console.log(Corporation.getWalletJournal(1, 'bounty_prizes'));
  
}

function testGetCorpJobsReport() {
  console.log(Corporation.getJobsReport(2025,1));
}

function updateHistorySheet() {
  Corporation.updateHistorySheet();
}

function updateBountySheet() {
  Corporation.updateBountySheet();
}

function syncActivity() {
  Corporation.syncActivity();
}


/*
vyhledani corporatnich stanic:
API Search: https://esi.evetech.net/latest/characters/2117327790/search/?categories=structure&datasource=tranquility&language=en&search=zeus&strict=false
dostanu seznam ID struktur s odpovidajicim nazvem

Q-02UL - Nidavellir  - 1047193653453
Q-02UL - Mr Aligned -RAMI - 1047193697072
E3OI-U - Mothership Bellicose - 1040278453044

info o stanici:
API Structures: https://esi.evetech.net/latest/universe/structures/1047193653453/?datasource=tranquility

{
  "name": "Q-02UL - Nidavellir",
  "owner_id": 98444656,
  "position": {
    "x": 3470757428969.203,
    "y": -555068255661.844,
    "z": 300693791171.61304
  },
  "solar_system_id": 30004787,
  "type_id": 35827
}
*/

function searchStructures() {
  var ret = Eve.search('structure', '4-P4FE - Capital & Large Ships');
  console.log(ret);

  ret.structure.forEach(r=> {
    console.log(Eve.getStructureInfo(r));
  })
}
