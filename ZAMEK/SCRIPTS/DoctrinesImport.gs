/*
 * EFT fit importer for DOKTRYNY DATASHEET
 *
 * Usage:
 * - Paste an EFT fit text into any cell (typically next to a doctrine column)
 * - Select that cell
 * - Run: EVE Data -> Doktrýny -> Import EFT fit (z buňky)
 *
 * It will add missing items into the currently selected doctrine column block:
 * - slot column (A of the block): slot numbers 1..38 (not modified)
 * - item column (B of the block): item names
 * - amount column (C of the block): quantities
 * - Buildable section: rows 3..40 (slots 1..38)
 * - Buy list section: rows 43..62
 */

function doctrinesImportEftFitFromCell() {
  const sheet = SpreadsheetApp.getActiveSheet();
  if (!sheet || sheet.getName() !== 'DOKTRYNY DATASHEET') {
    SpreadsheetApp.getUi().alert('Chyba!', 'Musíš být na sheetu DOKTRYNY DATASHEET', SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }

  const range = sheet.getActiveRange();
  if (!range) {
    SpreadsheetApp.getUi().alert('Chyba!', 'Nejdřív vyber buňku s EFT fitem', SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }

  const fitTextRaw = String(range.getValue() == null ? '' : range.getValue()).trim();
  if (!fitTextRaw) {
    SpreadsheetApp.getUi().alert('Chyba!', 'Vybraná buňka je prázdná (čekám EFT fit text)', SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }

  const target = _doctrinesResolveTargetColumnPair_(sheet, range.getColumn());
  if (!target) {
    SpreadsheetApp.getUi().alert(
      'Chyba!',
      'Nedokážu určit cílovou doktrýnu (zkus kliknout do sloupce s názvem doktrýny v řádku 2)',
      SpreadsheetApp.getUi().ButtonSet.OK,
    );
    return;
  }

  const parsed = _doctrinesParseEftFit_(fitTextRaw);
  if (!parsed.items.length) {
    SpreadsheetApp.getUi().alert('Chyba!', 'Ve fitu nebyly nalezeny žádné položky', SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }

  _doctrinesUpsertItems_(sheet, target.itemCol, parsed);
}

/**
 * Reads EFT fit from a fixed staging area (multi-line paste), e.g. column B rows 70..200,
 * and imports it into the doctrine column-block inferred from the CURRENT selection.
 *
 * UX:
 * - Paste the EFT fit into B70:B200 (each EFT line in its own row)
 * - Click into the doctrine column you want to fill (ideally the item column under row 2 header)
 * - Click the button mapped to this function
 */
function doctrinesImportEftFitFromStaging() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const ui = SpreadsheetApp.getUi();
  if (!sheet || sheet.getName() !== 'DOKTRYNY DATASHEET') {
    ui.alert('Chyba!', 'Musíš být na sheetu DOKTRYNY DATASHEET', ui.ButtonSet.OK);
    return;
  }

  const activeRange = sheet.getActiveRange();
  if (!activeRange) {
    ui.alert('Chyba!', 'Nejdřív klikni do sloupce cílové doktrýny (řádek 2 má název)', ui.ButtonSet.OK);
    return;
  }

  const STAGING_COL = 2; // B
  const STAGING_START_ROW = 70;
  const STAGING_END_ROW = 200;

  const fitLines = sheet
    .getRange(STAGING_START_ROW, STAGING_COL, STAGING_END_ROW - STAGING_START_ROW + 1, 1)
    .getValues()
    .map(r => String(r[0] == null ? '' : r[0]).trim())
    .filter(s => s !== '');

  const titleLine = fitLines.length ? fitLines[0] : '';
  const fitTextRaw = fitLines.join('\n').trim();
  if (!fitTextRaw) {
    ui.alert('Chyba!', 'Staging oblast B70:B200 je prázdná (čekám EFT fit)', ui.ButtonSet.OK);
    return;
  }

  const parsed = _doctrinesParseEftFit_(fitTextRaw);
  if (!parsed.items.length) {
    ui.alert('Chyba!', 'Ve fitu nebyly nalezeny žádné položky', ui.ButtonSet.OK);
    return;
  }

  // Bulk-load sheet data once for fast checks/scans (avoids hundreds of getRange() calls).
  const pre = _doctrinesPreloadBlocks_(sheet);

  // Pre-flight duplicate detection: if header or configuration already exists anywhere, abort with no changes.
  if (titleLine && _doctrinesHeaderExistsAnywherePreloaded_(pre, titleLine)) {
    ui.alert('Doktryna jiz existuje.', 'Hlavicka uz existuje v jine doktryne.', ui.ButtonSet.OK);
    return;
  }
  const parsedSig = _doctrinesBuildParsedSignature_(parsed);
  if (_doctrinesConfigExistsAnywherePreloaded_(pre, parsedSig)) {
    ui.alert('Doktryna jiz existuje.', 'Stejna konfigurace (polozky + pocty) uz existuje v jine doktryne.', ui.ButtonSet.OK);
    return;
  }

  // Determine starting doctrine column-block from the current selection, then find the first empty block.
  const startItemCol = _doctrinesGuessItemColFromActiveCol_(sheet, activeRange.getColumn());
  if (!startItemCol) {
    ui.alert('Chyba!', 'Nedokážu určit startovní sloupec doktrýny (klikni do sloupce doktrýny)', ui.ButtonSet.OK);
    return;
  }

  const alignedStartItemCol = (startItemCol % 3 === 2) ? startItemCol : ((startItemCol % 3 === 1) ? startItemCol + 1 : startItemCol - 1);
  const freeItemCol = _doctrinesFindNextFreeDoctrineItemColPreloaded_(pre, alignedStartItemCol);
  if (!freeItemCol) {
    ui.alert('Chyba!', 'Nenašel jsem žádnou volnou doktrýnu vpravo (všechny páry sloupců jsou už vyplněné)', ui.ButtonSet.OK);
    return;
  }

  // Special rule: the first staging line (usually: [Hull, FitName]) becomes the doctrine name in row 2.
  if (titleLine) {
    sheet.getRange(2, freeItemCol).setValue(titleLine);
  }

  _doctrinesUpsertItems_(sheet, freeItemCol, parsed);
}

function _doctrinesGuessItemColFromActiveCol_(sheet, activeCol) {
  const lastCol = sheet.getLastColumn();
  if (!lastCol || lastCol < 2) return 0;

  const col = Math.max(1, Math.min(activeCol, lastCol));

  // In a 3-column block: (slot, item, amount)
  // slot columns are 1,4,7,... => col % 3 == 1
  // item columns are 2,5,8,... => col % 3 == 2
  // amount columns are 3,6,9,... => col % 3 == 0
  let guessItemCol = col;
  if (col % 3 === 1) guessItemCol = col + 1;
  else if (col % 3 === 0) guessItemCol = col - 1;

  if (guessItemCol < 2 || guessItemCol >= lastCol) return 0;

  // If header exists in row 2, prefer it. Otherwise still return the guessed item column.
  const h = String(sheet.getRange(2, guessItemCol).getValue() == null ? '' : sheet.getRange(2, guessItemCol).getValue()).trim();
  return guessItemCol;
}

function _doctrinesIsDoctrinePairEmpty_(sheet, itemCol) {
  const BUILD_START_ROW = 3;
  const BUILD_END_ROW = 40;
  const BUY_START_ROW = 43;
  const BUY_END_ROW = 62;

  // If doctrine header already exists (row 2), treat as occupied.
  const header = String(sheet.getRange(2, itemCol).getValue() == null ? '' : sheet.getRange(2, itemCol).getValue()).trim();
  if (header) return false;

  const buildVals = sheet.getRange(BUILD_START_ROW, itemCol, BUILD_END_ROW - BUILD_START_ROW + 1, 1).getValues();
  for (const r of buildVals) {
    if (String(r[0] == null ? '' : r[0]).trim()) return false;
  }

  const buyVals = sheet.getRange(BUY_START_ROW, itemCol, BUY_END_ROW - BUY_START_ROW + 1, 1).getValues();
  for (const r of buyVals) {
    if (String(r[0] == null ? '' : r[0]).trim()) return false;
  }

  return true;
}

function _doctrinesFindNextFreeDoctrineItemCol_(sheet, startItemCol) {
  const lastCol = sheet.getLastColumn();
  if (!lastCol || lastCol < 2) return 0;

  // Scan to the right by 3-column doctrine blocks (slotCol, itemCol, amountCol).
  for (let itemCol = startItemCol; itemCol < lastCol; itemCol += 3) {
    if (_doctrinesIsDoctrinePairEmpty_(sheet, itemCol)) return itemCol;
  }
  return 0;
}

function _doctrinesNormalizeHeader_(s) {
  return String(s == null ? '' : s).trim().toLowerCase();
}

function _doctrinesPreloadBlocks_(sheet) {
  const lastCol = sheet.getLastColumn();
  if (!lastCol || lastCol < 2) {
    return { lastCol: 0, headerRow: [], buildVals: [], buyVals: [] };
  }

  const headerRow = sheet.getRange(2, 1, 1, lastCol).getValues()[0];

  // Buildable rows 3..40 (38 rows), Buy rows 43..62 (20 rows)
  const buildVals = sheet.getRange(3, 1, 38, lastCol).getValues();
  const buyVals = sheet.getRange(43, 1, 20, lastCol).getValues();

  return { lastCol, headerRow, buildVals, buyVals };
}

function _doctrinesHeaderExistsAnywherePreloaded_(pre, headerText) {
  const want = _doctrinesNormalizeHeader_(headerText);
  if (!want || !pre || !pre.lastCol) return false;

  for (let itemCol = 2; itemCol <= pre.lastCol; itemCol += 3) {
    const h = _doctrinesNormalizeHeader_(pre.headerRow[itemCol - 1]);
    if (h && h === want) return true;
  }
  return false;
}

function _doctrinesIsBlockEmptyPreloaded_(pre, itemCol) {
  if (!pre || !pre.lastCol) return false;
  if (itemCol < 2 || itemCol > pre.lastCol) return false;

  // If doctrine header already exists (row 2), treat as occupied.
  const header = String(pre.headerRow[itemCol - 1] == null ? '' : pre.headerRow[itemCol - 1]).trim();
  if (header) return false;

  const itemIdx = itemCol - 1;

  for (let r = 0; r < pre.buildVals.length; r++) {
    if (String(pre.buildVals[r][itemIdx] == null ? '' : pre.buildVals[r][itemIdx]).trim()) return false;
  }
  for (let r = 0; r < pre.buyVals.length; r++) {
    if (String(pre.buyVals[r][itemIdx] == null ? '' : pre.buyVals[r][itemIdx]).trim()) return false;
  }

  return true;
}

function _doctrinesFindNextFreeDoctrineItemColPreloaded_(pre, startItemCol) {
  if (!pre || !pre.lastCol) return 0;

  for (let itemCol = startItemCol; itemCol <= pre.lastCol; itemCol += 3) {
    if (_doctrinesIsBlockEmptyPreloaded_(pre, itemCol)) return itemCol;
  }
  return 0;
}

function _doctrinesReadDoctrineSignaturePreloaded_(pre, itemCol) {
  const sig = new Map();
  const itemIdx = itemCol - 1;
  const amountIdx = itemCol; // amountCol is itemCol+1 (1-based) => index itemCol

  for (let r = 0; r < pre.buildVals.length; r++) {
    const name = String(pre.buildVals[r][itemIdx] == null ? '' : pre.buildVals[r][itemIdx]).trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const qty = _doctrinesToInt_(pre.buildVals[r][amountIdx]) || 1;
    sig.set(key, (sig.get(key) || 0) + qty);
  }

  for (let r = 0; r < pre.buyVals.length; r++) {
    const name = String(pre.buyVals[r][itemIdx] == null ? '' : pre.buyVals[r][itemIdx]).trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const qty = _doctrinesToInt_(pre.buyVals[r][amountIdx]) || 1;
    sig.set(key, (sig.get(key) || 0) + qty);
  }

  return sig;
}

function _doctrinesConfigExistsAnywherePreloaded_(pre, parsedSig) {
  if (!pre || !pre.lastCol) return false;
  if (!parsedSig || parsedSig.size === 0) return false;

  for (let itemCol = 2; itemCol <= pre.lastCol; itemCol += 3) {
    const header = String(pre.headerRow[itemCol - 1] == null ? '' : pre.headerRow[itemCol - 1]).trim();
    if (!header) continue;

    const sig = _doctrinesReadDoctrineSignaturePreloaded_(pre, itemCol);
    if (_doctrinesMapsEqual_(sig, parsedSig)) return true;
  }
  return false;
}

function _doctrinesHeaderExistsAnywhere_(sheet, headerText) {
  const want = _doctrinesNormalizeHeader_(headerText);
  if (!want) return false;

  const lastCol = sheet.getLastColumn();
  if (!lastCol || lastCol < 2) return false;

  // item columns are 2,5,8,...
  for (let itemCol = 2; itemCol <= lastCol; itemCol += 3) {
    const h = _doctrinesNormalizeHeader_(sheet.getRange(2, itemCol).getValue());
    if (h && h === want) return true;
  }
  return false;
}

function _doctrinesToInt_(v) {
  if (v == null || v === '') return 0;
  const n = (typeof v === 'number') ? v : parseFloat(String(v).replace(',', '.'));
  if (!isFinite(n)) return 0;
  return Math.round(n);
}

function _doctrinesBuildParsedSignature_(parsed) {
  const sig = new Map();
  for (const it of (parsed && parsed.items) ? parsed.items : []) {
    const name = String(it.name == null ? '' : it.name).trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const qty = _doctrinesToInt_(it.qty) || 1;
    sig.set(key, (sig.get(key) || 0) + qty);
  }
  return sig;
}

function _doctrinesReadDoctrineSignature_(sheet, itemCol) {
  const BUILD_START_ROW = 3;
  const BUILD_END_ROW = 40;
  const BUY_START_ROW = 43;
  const BUY_END_ROW = 62;
  const amountCol = itemCol + 1;

  const sig = new Map();

  const buildNames = sheet.getRange(BUILD_START_ROW, itemCol, BUILD_END_ROW - BUILD_START_ROW + 1, 1).getValues();
  const buildQtys = sheet.getRange(BUILD_START_ROW, amountCol, BUILD_END_ROW - BUILD_START_ROW + 1, 1).getValues();
  for (let i = 0; i < buildNames.length; i++) {
    const name = String(buildNames[i][0] == null ? '' : buildNames[i][0]).trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const qty = _doctrinesToInt_(buildQtys[i][0]) || 1;
    sig.set(key, (sig.get(key) || 0) + qty);
  }

  const buyNames = sheet.getRange(BUY_START_ROW, itemCol, BUY_END_ROW - BUY_START_ROW + 1, 1).getValues();
  const buyQtys = sheet.getRange(BUY_START_ROW, amountCol, BUY_END_ROW - BUY_START_ROW + 1, 1).getValues();
  for (let i = 0; i < buyNames.length; i++) {
    const name = String(buyNames[i][0] == null ? '' : buyNames[i][0]).trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const qty = _doctrinesToInt_(buyQtys[i][0]) || 1;
    sig.set(key, (sig.get(key) || 0) + qty);
  }

  return sig;
}

function _doctrinesMapsEqual_(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, v] of a.entries()) {
    if (!b.has(k)) return false;
    if (b.get(k) !== v) return false;
  }
  return true;
}

function _doctrinesConfigExistsAnywhere_(sheet, parsedSig) {
  const lastCol = sheet.getLastColumn();
  if (!lastCol || lastCol < 2) return false;

  // Only consider blocks that look like doctrines (have a header on row 2)
  for (let itemCol = 2; itemCol <= lastCol; itemCol += 3) {
    const header = String(sheet.getRange(2, itemCol).getValue() == null ? '' : sheet.getRange(2, itemCol).getValue()).trim();
    if (!header) continue;

    const sig = _doctrinesReadDoctrineSignature_(sheet, itemCol);
    if (_doctrinesMapsEqual_(sig, parsedSig)) return true;
  }
  return false;
}

function _doctrinesResolveTargetColumnPair_(sheet, activeCol) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 2) return null;

  // 3-column block: slotCol=itemCol-1, itemCol, amountCol=itemCol+1
  const col = Math.max(1, Math.min(activeCol, lastCol));
  let itemCol = col;
  if (col % 3 === 1) itemCol = col + 1; // slot -> item
  else if (col % 3 === 0) itemCol = col - 1; // amount -> item

  const slotCol = itemCol - 1;
  const amountCol = itemCol + 1;
  if (slotCol < 1 || amountCol > lastCol) return null;

  // Doctrine name is in row 2, item column.
  const doctrineName = String(sheet.getRange(2, itemCol).getValue() == null ? '' : sheet.getRange(2, itemCol).getValue()).trim();
  if (!doctrineName) return null;

  return { slotCol, itemCol, amountCol, doctrineName };
}

function _doctrinesParseEftFit_(fitText) {
  const lines = String(fitText || '').split(/\r?\n/).map(l => String(l).trim());
  let hullName = null;

  /** keep insertion order */
  const ordered = [];
  const idxByKey = new Map();

  function add(name, qty, kind) {
    const n = String(name || '').trim();
    if (!n) return;

    // Skip EFT placeholders
    if (n.startsWith('[') && n.toLowerCase().includes('empty')) return;

    const key = kind + '::' + n.toLowerCase();
    const pos = idxByKey.get(key);
    if (pos === undefined) {
      idxByKey.set(key, ordered.length);
      ordered.push({ name: n, qty: qty, kind });
    } else {
      ordered[pos].qty += qty;
    }
  }

  function parseQtySuffix(rawName) {
    const s = String(rawName || '').trim();
    // Most common EFT: "Hobgoblin II x5"
    const m = s.match(/^(.*)\s+x(\d+)$/i);
    if (m) {
      return { base: String(m[1] || '').trim(), qty: parseInt(m[2], 10) || 1 };
    }
    return { base: s, qty: 1 };
  }

  for (const line of lines) {
    if (!line) continue;

    // Header: [Hull, Something]
    if (line.startsWith('[') && line.includes(']') && line.includes(',')) {
      const inside = line.slice(1, line.indexOf(']'));
      const hull = inside.split(',')[0];
      const hullTrim = String(hull || '').trim();
      if (hullTrim) {
        hullName = hullTrim;
        add(hullTrim, 1, 'item');
      }
      continue;
    }

    // Normal EFT item line: "Item" or "Item, Charge" or "Item x5" or "Item, Charge x500"
    const parts = line.split(',').map(p => String(p).trim()).filter(p => p !== '');
    if (!parts.length) continue;

    const { base: itemName, qty } = parseQtySuffix(parts[0]);
    if (itemName) add(itemName, qty, 'item');

    // Charges: simplest interpretation = always buy list; default qty = 1 stack (not multiplied by gun count)
    if (parts.length >= 2) {
      const { base: chargeName } = parseQtySuffix(parts.slice(1).join(', '));
      if (chargeName) add(chargeName, 1, 'charge');
    }
  }

  return { hullName, items: ordered };
}

function _doctrinesUpsertItems_(sheet, itemCol, parsed) {
  const ui = SpreadsheetApp.getUi();

  const BUILD_START_ROW = 3;
  const BUILD_END_ROW = 40; // slots 1..38
  const BUY_START_ROW = 43;
  const BUY_END_ROW = 62;

  // Load existing items in both areas.
  const buildVals = sheet.getRange(BUILD_START_ROW, itemCol, BUILD_END_ROW - BUILD_START_ROW + 1, 1).getValues().flat();
  const buyVals = sheet.getRange(BUY_START_ROW, itemCol, BUY_END_ROW - BUY_START_ROW + 1, 1).getValues().flat();

  const existing = new Set();
  for (const v of [...buildVals, ...buyVals]) {
    const s = String(v ?? '').trim();
    if (s) existing.add(s.toLowerCase());
  }

  function findFirstEmptyRow(startRow, endRow) {
    const vals = sheet.getRange(startRow, itemCol, endRow - startRow + 1, 1).getValues();
    for (let i = 0; i < vals.length; i++) {
      const s = String(vals[i][0] ?? '').trim();
      if (!s) return startRow + i;
    }
    return 0;
  }

  function isBoosterOrDrug(typeName) {
    const n = String(typeName == null ? '' : typeName).trim().toLowerCase();
    if (!n) return false;

    // Ancillary exceptions: ONLY these module families are buy-list.
    // Avoid false-positives like "Medium Ancillary Current Router I" (a rig, buildable).
    if (n.includes('ancillary armor repairer')) return true;
    if (n.includes('ancillary shield booster')) return true;

    // Combat boosters / drugs: always buy list.
    // We must avoid false-positives like "Small Capacitor Booster II" or "Shield Booster" modules.
    // We therefore match ONLY combat-booster-specific patterns.

    // New-style combat boosters: "Agency 'Pyrolancea' DB3 Dose I" etc.
    if (n.includes(' dose ')) return true;
    if (n.endsWith(' dose i') || n.endsWith(' dose ii') || n.endsWith(' dose iii')) return true;
    if (n.includes("'pyrolancea'")) return true;

    // Legacy combat boosters: tier keyword + known booster family keyword + word "booster".
    // Examples: "Synth Blue Pill Booster", "Standard Exile Booster", "Improved X-Instinct Booster", "Strong Crash Booster".
    const hasTier = /\b(synth|standard|improved|strong)\b/i.test(typeName);
    const hasFamily = /(blue pill|exile|x-instinct|crash|drop|mindflood|frentix|sooth sayer|vitoc|nugoehuvi)/i.test(typeName);
    if (hasTier && hasFamily && n.includes('booster')) return true;

    return false;
  }

  function isBuildable(typeName) {
    // Charges always go to buy list.
    // For everything else: try to find a blueprint type ("X Blueprint").
    try {
      Universe.searchType(typeName + ' Blueprint');
      return true;
    } catch (e) {
      return false;
    }
  }

  let addedBuild = 0;
  let addedBuy = 0;
  let skippedExisting = 0;

  for (const it of parsed.items) {
    const name = it.name;
    const key = name.toLowerCase();
    if (existing.has(key)) {
      skippedExisting++;
      continue;
    }

    const toBuyList = (it.kind === 'charge') ? true : (isBoosterOrDrug(name) ? true : !isBuildable(name));

    if (!toBuyList) {
      const row = findFirstEmptyRow(BUILD_START_ROW, BUILD_END_ROW);
      if (!row) {
        ui.alert('Chyba!', 'Sloty 1–38 jsou plné. Nemám kam přidat: ' + name, ui.ButtonSet.OK);
        return;
      }
      sheet.getRange(row, itemCol, 1, 2).setValues([[name, it.qty]]);
      existing.add(key);
      addedBuild++;
    } else {
      const row = findFirstEmptyRow(BUY_START_ROW, BUY_END_ROW);
      if (!row) {
        ui.alert('Chyba!', 'Buy list je plný. Nemám kam přidat: ' + name, ui.ButtonSet.OK);
        return;
      }
      // For buy list we keep qty as parsed; charges default to 1.
      sheet.getRange(row, itemCol, 1, 2).setValues([[name, it.qty]]);
      existing.add(key);
      addedBuy++;
    }
  }

  ui.alert(
    'Hotovo',
    'Doplněno do doktrýny:\n'
      + '- buildable (sloty): ' + addedBuild + '\n'
      + '- buy list: ' + addedBuy + '\n'
      + '- přeskočeno (už existuje): ' + skippedExisting,
    ui.ButtonSet.OK,
  );
}
