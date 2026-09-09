const TAXES_HEADERS = [
  'Main',
  'Postavy v corp',
  'Aktivita hodin',
  'Povinnost ISK',
  'Zaplaceno ISK',
  'Zbývá ISK',
  'Stav',
  'Poslední platba',
  'Počet plateb',
  'Zdroj aktivity'
];

function getOrCreateTaxesSheet_() {
  var sheet = SpreadsheetApp.getActive().getSheetByName('TAXES');
  return sheet || SpreadsheetApp.getActive().insertSheet('TAXES');
}

function ensureTaxesLayout_(sheet) {
  var now = new Date();
  if (sheet.getMaxColumns() < TAXES_HEADERS.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), TAXES_HEADERS.length - sheet.getMaxColumns());
  }

  sheet.getRange(1, 1, 1, TAXES_HEADERS.length).breakApart().merge();
  sheet.getRange(1, 1)
    .setValue('Corporation Taxes')
    .setBackground('#14324a')
    .setFontColor('#ffffff')
    .setFontSize(15)
    .setFontWeight('bold');

  sheet.getRange(2, 1, 1, 2).merge().setValue('Rok');
  sheet.getRange(2, 3, 1, 2).merge().setValue('Měsíc');
  sheet.getRange(2, 5, 1, 2).merge().setValue('Daň na člověka');
  sheet.getRange(2, 7, 1, 2).merge().setValue('Limit aktivity');
  sheet.getRange(2, 9, 1, 2).merge().setValue('Počet lidí');
  sheet.getRange(3, 1, 1, 2).merge();
  sheet.getRange(3, 3, 1, 2).merge();
  sheet.getRange(3, 5, 1, 2).merge();
  sheet.getRange(3, 7, 1, 2).merge();
  sheet.getRange(3, 9, 1, 2).merge();

  if (!sheet.getRange(3, 1).getValue()) sheet.getRange(3, 1).setValue(now.getFullYear());
  if (!sheet.getRange(3, 3).getValue()) sheet.getRange(3, 3).setValue(now.getMonth() + 1);
  sheet.getRange(3, 5).setValue(250000000).setNumberFormat('#,##0 "ISK"');
  sheet.getRange(3, 7).setValue(10).setNumberFormat('0.0 "h"');

  sheet.getRange(2, 1, 1, TAXES_HEADERS.length)
    .setBackground('#eef6fb')
    .setFontColor('#486581')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
  sheet.getRange(3, 1, 1, 8)
    .setBackground('#fff8db')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
  sheet.getRange(4, 1, 1, TAXES_HEADERS.length).setValues([TAXES_HEADERS]);
  sheet.getRange(4, 1, 1, TAXES_HEADERS.length)
    .setBackground('#d7e9f5')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  sheet.setFrozenRows(4);
  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 320);
  sheet.setColumnWidth(3, 110);
  sheet.setColumnWidths(4, 3, 145);
  sheet.setColumnWidth(7, 190);
  sheet.setColumnWidth(8, 165);
  sheet.setColumnWidth(9, 110);
  sheet.setColumnWidth(10, 130);
}

function taxesStatusLabel_(item) {
  var status = item && item.status;
  var reasons = item && Array.isArray(item.exemptionReasons) ? item.exemptionReasons : [];
  if (status === 'exempt') {
    var shortMembership = reasons.indexOf('short_membership') !== -1;
    var lowActivity = reasons.indexOf('low_activity') !== -1;
    if (shortMembership && lowActivity) return 'VÝJIMKA – NOVÝ ČLEN + NÍZKÁ AKTIVITA';
    if (shortMembership) return 'VÝJIMKA – NOVÝ ČLEN';
  }
  var labels = {
    paid: 'ZAPLACENO',
    paid_late: 'ZAPLACENO POZDĚ',
    unpaid: 'NEZAPLACENO',
    partial: 'ČÁSTEČNĚ',
    exempt: 'VÝJIMKA – NÍZKÁ AKTIVITA',
    unmapped: 'CHYBÍ ALLIANCE AUTH MAPOVÁNÍ'
  };
  return labels[status] || String(status || '');
}

function sortTaxesSummary_(summary) {
  var statusOrder = {
    exempt: 0,
    paid: 1,
    unpaid: 2,
    paid_late: 3,
    partial: 4,
    unmapped: 5
  };
  return summary.slice().sort(function(left, right) {
    var leftOrder = Object.prototype.hasOwnProperty.call(statusOrder, left.status) ? statusOrder[left.status] : 99;
    var rightOrder = Object.prototype.hasOwnProperty.call(statusOrder, right.status) ? statusOrder[right.status] : 99;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return String(left.mainCharacterName || '').localeCompare(String(right.mainCharacterName || ''), 'cs');
  });
}

function writeTaxesReport_(sheet, report) {
  var startRow = 5;
  var clearRows = Math.max(0, sheet.getMaxRows() - startRow + 1);
  if (clearRows > 0) {
    sheet.getRange(startRow, 1, clearRows, TAXES_HEADERS.length).clearContent().clearFormat();
  }

  var summary = sortTaxesSummary_(Array.isArray(report.summary) ? report.summary : []);
  var rows = summary.map(function(item) {
    return [
      item.mainCharacterName || '',
      (item.characters || []).join(', '),
      Number(item.activityHours || 0),
      Number(item.requiredAmount || 0),
      Number(item.paidAmount || 0),
      Number(item.remainingAmount || 0),
      taxesStatusLabel_(item),
      item.lastPaymentAt ? new Date(item.lastPaymentAt) : '',
      Number(item.payments || 0),
      item.activitySource === 'intervals' ? 'Intervaly' : 'Měsíční odhad'
    ];
  });

  if (rows.length > 0) {
    var range = sheet.getRange(startRow, 1, rows.length, TAXES_HEADERS.length);
    range.setValues(rows).setVerticalAlignment('middle');
    sheet.getRange(startRow, 3, rows.length, 1).setNumberFormat('0.0 "h"');
    sheet.getRange(startRow, 4, rows.length, 3).setNumberFormat('#,##0 "ISK"');
    sheet.getRange(startRow, 8, rows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm');

    var backgrounds = summary.map(function(item, index) {
      var colors = {
        paid: '#d9ead3',
        paid_late: '#cfe2f3',
        unpaid: '#f4cccc',
        partial: '#fce5cd',
        exempt: '#d9eaf7',
        unmapped: '#fff2cc'
      };
      return new Array(TAXES_HEADERS.length).fill(colors[item.status] || (index % 2 ? '#f8fbfd' : '#ffffff'));
    });
    range.setBackgrounds(backgrounds);
    sheet.getRange(startRow, 1, rows.length, 1).setFontWeight('bold');
    sheet.getRange(startRow, 7, rows.length, 1).setFontWeight('bold');
  }

  var meta = report.meta || {};
  sheet.getRange(3, 5).setValue(Number(meta.requiredAmount || 250000000));
  sheet.getRange(3, 7).setValue(Number(meta.activityThresholdHours || 10));
  sheet.getRange(3, 9).setValue(Number(meta.peopleCount || 0));
}

function syncTaxes() {
  var sheet = getOrCreateTaxesSheet_();
  ensureTaxesLayout_(sheet);
  var year = Number(sheet.getRange(3, 1).getValue());
  var month = Number(sheet.getRange(3, 3).getValue());
  if (year < 2021 || year > 2100 || month < 1 || month > 12) {
    SpreadsheetApp.getUi().alert('Chyba!', 'Neplatný rok nebo měsíc v TAXES.', SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }

  var now = new Date();
  var currentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
  if (currentMonth) {
    try {
      Aubi.syncActivity({ silent: true });
      Aubi.syncWalletJournal(1, { silent: true });
    } catch (e) {
      SpreadsheetApp.getActive().toast('Synchronizace zdrojových dat nebyla úplná: ' + e, 'TAXES', 10);
    }
  }

  var report = Aubi.getTaxReport(year, month, 1);
  writeTaxesReport_(sheet, report);
  var warning = report.meta && report.meta.identitySyncWarning;
  SpreadsheetApp.getActive().toast(
    warning ? 'Report načten z poslední známé AA identity: ' + warning : 'Načteno ' + report.meta.peopleCount + ' lidí.',
    'TAXES',
    warning ? 10 : 5
  );
  return report;
}