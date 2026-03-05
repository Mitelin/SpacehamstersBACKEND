/*
 * ZASOBOVANI
 *
 * Aggregates required input materials across unlocked projects and produces a shopping list.
 *
 * Data sources:
 * - Project sheets: "Projekt ALPRO 1" .. "Projekt ALPRO 7"
 *   - lock: row 8, col 11 (non-empty => locked)
 *   - input materials table: starts at row 14, col 25 (width 21)
 *     - [0] material name
 *     - [9] total required quantity (computed by Blueprints.recalculateProject)
 * - Assets sheet: "Sklady" (written by Corporation.syncAssets)
 *   - columns: A..G = locationId, locationType, locationFlag, hangar, typeId, typeName, quantity
 *
 * Output:
 * - Sheet "NAKUP LIST": item + missing qty (+ optional debug columns)
 */

const Zasobovani = (() => {
  const NAKUP_SHEET_NAME = 'NAKUP LIST';
  const ASSETS_SHEET_NAME = 'Sklady';

  const PROJECT_NAMES = [
    'Projekt ALPRO 1',
    'Projekt ALPRO 2',
    'Projekt ALPRO 3',
    'Projekt ALPRO 4',
    'Projekt ALPRO 5',
    'Projekt ALPRO 6',
    'Projekt ALPRO 7',
  ];

  const LOCK_ROW = 8;
  const LOCK_COL = 11;

  const FIRST_DATA_ROW = 14;
  const COL_INPUT = 25;
  const INPUT_WIDTH = 21;
  const INPUT_COL_NAME = 0;
  const INPUT_COL_TOTAL_NEEDED = 9;

  // Project parameter cell containing the manufacturing hangar label (used only to infer division).
  // In Blueprints.updateProject(): range(2,2,11,1), so data[0][0] is B2.
  const PROJECT_MANUF_HANGAR_ROW = 2;
  const PROJECT_MANUF_HANGAR_COL = 2; // B

  // Fallback division label if no project has B2 filled.
  const DEFAULT_PROD_DIVISION = 'Industry skladka';

  const toNum_ = (v) => {
    const n = (typeof v === 'number') ? v : Number(String(v || '').trim().replace(/[\s,]/g, ''));
    return isFinite(n) ? n : 0;
  };

  const normalizeName_ = (name) => {
    const s = String(name || '').trim();
    return s;
  };

  const baseDivisionFromHangarLabel_ = (label) => {
    const s = String(label || '').trim();
    if (!s) return '';
    const idx = s.indexOf(' - ');
    return idx >= 0 ? s.slice(0, idx) : s;
  };

  const countContiguousRows_ = (sheet, startRow, col, maxRows) => {
    const firstVal = sheet.getRange(startRow, col, 1, 1).getValue();
    if (!firstVal) return 0;
    const lastDataRow = sheet.getRange(startRow, col, 1, 1)
      .getNextDataCell(SpreadsheetApp.Direction.DOWN)
      .getRow();
    const count = lastDataRow - startRow + 1;
    return Math.min(maxRows, Math.max(0, count));
  };

  const getOrCreateSheet_ = (ss, name) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    return sh;
  };

  const loadProjectNeeds_ = (ss) => {
    // Returns:
    // - needsByName: Map itemName -> totalRequired
    // - prodDivisions: Set base division names (used for stock filter)
    const needsByName = new Map();
    const prodDivisions = new Set();

    for (let i = 0; i < PROJECT_NAMES.length; i++) {
      const name = PROJECT_NAMES[i];
      const sh = ss.getSheetByName(name);
      if (!sh) continue;

      const lockVal = sh.getRange(LOCK_ROW, LOCK_COL, 1, 1).getValue();
      if (lockVal) continue;

      const manufHangar = sh.getRange(PROJECT_MANUF_HANGAR_ROW, PROJECT_MANUF_HANGAR_COL, 1, 1).getValue();
      const baseDiv = baseDivisionFromHangarLabel_(manufHangar);
      if (baseDiv) prodDivisions.add(baseDiv);

      const inputCount = countContiguousRows_(sh, FIRST_DATA_ROW, COL_INPUT, 1000);
      if (inputCount <= 0) continue;

      const table = sh.getRange(FIRST_DATA_ROW, COL_INPUT, inputCount, INPUT_WIDTH).getValues();
      for (let r = 0; r < table.length; r++) {
        const item = normalizeName_(table[r][INPUT_COL_NAME]);
        if (!item) continue;
        const need = toNum_(table[r][INPUT_COL_TOTAL_NEEDED]);
        if (!(need > 0)) continue;
        const prev = needsByName.get(item) || 0;
        needsByName.set(item, prev + need);
      }
    }

    if (prodDivisions.size === 0) prodDivisions.add(DEFAULT_PROD_DIVISION);
    return { needsByName, prodDivisions };
  };

  const loadStockByName_ = (ss, prodDivisions) => {
    // Sklady: A..G = locationId, locationType, locationFlag, hangar, typeId, typeName, quantity
    // Returns Map itemName -> qtyInStock (only for selected production divisions).
    const sh = ss.getSheetByName(ASSETS_SHEET_NAME);
    const out = new Map();
    if (!sh) return out;

    const lastRow = sh.getLastRow();
    if (!lastRow || lastRow < 2) return out;

    const rows = sh.getRange(2, 1, lastRow - 1, 7).getValues();
    const divisions = Array.from(prodDivisions || []);

    const isProdHangar_ = (hangarLabel) => {
      const h = String(hangarLabel || '');
      if (!h) return false;
      for (let i = 0; i < divisions.length; i++) {
        const base = divisions[i];
        if (!base) continue;
        // Includes root and containers: "Industry skladka" and "Industry skladka - Box"
        if (h === base || h.indexOf(base + ' - ') === 0) return true;
      }
      return false;
    };

    for (let i = 0; i < rows.length; i++) {
      const hangar = rows[i][3];
      if (!isProdHangar_(hangar)) continue;

      const item = normalizeName_(rows[i][5]);
      if (!item) continue;
      const qty = toNum_(rows[i][6]);
      if (!(qty > 0)) continue;

      const prev = out.get(item) || 0;
      out.set(item, prev + qty);
    }
    return out;
  };

  const writeNakupList_ = (ss, needsByName, stockByName, prodDivisions) => {
    const sh = getOrCreateSheet_(ss, NAKUP_SHEET_NAME);

    const rows = [];
    needsByName.forEach((need, item) => {
      const stock = stockByName.get(item) || 0;
      const toBuy = Math.max(0, need - stock);
      if (!(toBuy > 0)) return;
      rows.push([item, Math.ceil(toBuy), Math.ceil(need), Math.floor(stock)]);
    });

    rows.sort((a, b) => {
      const q = Number(b[1]) - Number(a[1]);
      if (q) return q;
      return String(a[0]).localeCompare(String(b[0]));
    });

    // Clear old contents
    const maxRows = Math.max(1, sh.getMaxRows());
    const clearRows = Math.min(2000, maxRows);
    sh.getRange(1, 1, clearRows, 10).clearContent();

    const divText = Array.from(prodDivisions || []).filter(Boolean).join(', ');
    sh.getRange(1, 1, 1, 4).setValues([['item', 'to_buy', 'needed_total', 'stock_prod']]);
    sh.getRange(1, 6, 1, 1).setValue('prod_divisions');
    sh.getRange(1, 7, 1, 1).setValue(divText);
    sh.getRange(2, 6, 1, 1).setValue('updated');
    sh.getRange(2, 7, 1, 1).setValue(new Date());

    if (rows.length) {
      sh.getRange(2, 1, rows.length, 4).setValues(rows);
    }

    try {
      sh.activate();
      sh.setActiveSelection('A1');
    } catch (e) {}

    SpreadsheetApp.getActive().toast(
      'Nakup list: ' + rows.length + ' polozek (divize: ' + divText + ').',
      'Zasobovani',
      8
    );
  };

  return {
    updateNakupList: function() {
      const ss = SpreadsheetApp.getActive();
      const { needsByName, prodDivisions } = loadProjectNeeds_(ss);
      const stockByName = loadStockByName_(ss, prodDivisions);
      writeNakupList_(ss, needsByName, stockByName, prodDivisions);
    }
  };
})();

// Menu/button entrypoint
function zasobovaniUpdateNakupList() {
  return Zasobovani.updateNakupList();
}

