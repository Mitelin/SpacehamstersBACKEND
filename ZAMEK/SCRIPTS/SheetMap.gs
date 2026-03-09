/*
 * SheetMap — quick spreadsheet "map" generator for migration planning.
 *
 * Goal:
 * - Produce a Markdown summary of all sheets, their used ranges, and a heuristic
 *   guess of "input" (static) vs "output" (formula) areas.
 * - Output goes to a dedicated sheet `__MAP__` and also opens a copy-friendly dialog.
 *
 * Notes:
 * - This is heuristic. The intent is to speed up manual review, not replace it.
 * - Large sheets are sampled to avoid Apps Script timeouts.
 */

const SHEET_MAP_SHEET_NAME = "__MAP__";

function sheetMapGenerateAndShow() {
  const md = sheetMapGenerate_();
  sheetMapWriteToSheet_(md);
  sheetMapShowDialog_(md);
}

function sheetMapGenerateToSheetOnly() {
  const md = sheetMapGenerate_();
  sheetMapWriteToSheet_(md);
}

function sheetMapGenerate_() {
  const ss = SpreadsheetApp.getActive();
  const now = new Date();

  const lines = [];
  lines.push(`# Sheet map (auto)`);
  lines.push("");
  lines.push(`Generated: ${now.toISOString()}`);
  lines.push(`Spreadsheet: ${ss.getName()} (${ss.getId()})`);
  lines.push("");

  const namedRanges = ss.getNamedRanges() || [];
  if (namedRanges.length) {
    lines.push("## Named ranges");
    for (let i = 0; i < namedRanges.length; i++) {
      const nr = namedRanges[i];
      const r = nr.getRange();
      const sh = r.getSheet();
      lines.push(`- \`${nr.getName()}\`: \`${sh.getName()}!${r.getA1Notation()}\``);
    }
    lines.push("");
  }

  const sheets = ss.getSheets();
  lines.push("## Sheets");
  lines.push("");

  for (let i = 0; i < sheets.length; i++) {
    const sh = sheets[i];
    const info = sheetMapAnalyzeSheet_(sh);
    lines.push(`### ${info.name}`);
    lines.push(`- Used range: \`${info.usedRangeA1}\` (${info.usedRows}×${info.usedCols})`);
    if (info.sampled) {
      lines.push(`- Scan range: \`${info.scanRangeA1}\` (sampled to avoid timeouts)`);
    }
    lines.push(`- Cells scanned: \`${info.scannedCells}\``);
    lines.push(`- Formula cells: \`${info.formulaCells}\` (${info.formulaRatioPct}%)`);
    lines.push(`- Static non-empty cells: \`${info.staticCells}\``);
    if (info.candidateInputCols.length) {
      lines.push(`- Candidate input columns (static-heavy): ${info.candidateInputCols.map(c => `\`${c}\``).join(", ")}`);
    }
    if (info.candidateOutputCols.length) {
      lines.push(`- Candidate output columns (formula-heavy): ${info.candidateOutputCols.map(c => `\`${c}\``).join(", ")}`);
    }
    if (info.notes.length) {
      for (let n = 0; n < info.notes.length; n++) lines.push(`- Note: ${info.notes[n]}`);
    }
    lines.push("");
  }

  lines.push("## How to use this");
  lines.push("");
  lines.push("- Treat **candidate input columns** as starting points for manual review (what users edit).");
  lines.push("- Treat **candidate output columns** as likely computed/projection areas (what we can replace with DB/views).");
  lines.push("- If a sheet is heavily sampled, rerun after temporarily reducing formatting/used range, or add manual notes.");
  lines.push("");

  return lines.join("\n");
}

function sheetMapAnalyzeSheet_(sheet) {
  const name = sheet.getName();
  const usedRows = Math.max(0, Number(sheet.getLastRow() || 0));
  const usedCols = Math.max(0, Number(sheet.getLastColumn() || 0));

  const usedRangeA1 = usedRows > 0 && usedCols > 0
    ? `A1:${sheetMapA1_(usedRows, usedCols)}`
    : "empty";

  const notes = sheetMapNotesForName_(name);

  if (usedRows === 0 || usedCols === 0) {
    return {
      name,
      usedRows,
      usedCols,
      usedRangeA1,
      sampled: false,
      scanRangeA1: "empty",
      scannedCells: 0,
      formulaCells: 0,
      formulaRatioPct: "0.0",
      staticCells: 0,
      candidateInputCols: [],
      candidateOutputCols: [],
      notes,
    };
  }

  // Sampling guard: keep total scanned cells bounded.
  // Default targets are chosen to stay fast even on larger spreadsheets.
  const MAX_CELLS = 180000; // 180k
  const MAX_ROWS = 800;
  const MAX_COLS = 80;

  let scanRows = usedRows;
  let scanCols = usedCols;
  let sampled = false;

  // Clamp by absolute maxima first.
  if (scanRows > MAX_ROWS) {
    scanRows = MAX_ROWS;
    sampled = true;
  }
  if (scanCols > MAX_COLS) {
    scanCols = MAX_COLS;
    sampled = true;
  }

  // Clamp by total cell budget second.
  while ((scanRows * scanCols) > MAX_CELLS) {
    sampled = true;
    if (scanRows >= scanCols && scanRows > 50) scanRows = Math.floor(scanRows * 0.8);
    else if (scanCols > 20) scanCols = Math.floor(scanCols * 0.8);
    else break;
  }

  const scanRange = sheet.getRange(1, 1, scanRows, scanCols);
  const formulas = scanRange.getFormulasR1C1();
  const values = scanRange.getValues();

  let formulaCells = 0;
  let staticCells = 0;

  const formulaCountByCol = new Array(scanCols).fill(0);
  const staticCountByCol = new Array(scanCols).fill(0);

  for (let r = 0; r < scanRows; r++) {
    for (let c = 0; c < scanCols; c++) {
      const f = formulas[r][c];
      if (f) {
        formulaCells++;
        formulaCountByCol[c]++;
        continue;
      }
      const v = values[r][c];
      // Count only non-empty static cells.
      if (v !== "" && v != null) {
        staticCells++;
        staticCountByCol[c]++;
      }
    }
  }

  const scannedCells = scanRows * scanCols;
  const ratio = scannedCells ? (formulaCells / scannedCells) : 0;
  const formulaRatioPct = (ratio * 100).toFixed(1);

  const candidateInputCols = sheetMapPickColumns_(staticCountByCol, formulaCountByCol, {
    mode: "input",
    scanRows,
    max: 10,
  });
  const candidateOutputCols = sheetMapPickColumns_(staticCountByCol, formulaCountByCol, {
    mode: "output",
    scanRows,
    max: 10,
  });

  const scanRangeA1 = `A1:${sheetMapA1_(scanRows, scanCols)}`;

  return {
    name,
    usedRows,
    usedCols,
    usedRangeA1,
    sampled,
    scanRangeA1,
    scannedCells,
    formulaCells,
    formulaRatioPct,
    staticCells,
    candidateInputCols,
    candidateOutputCols,
    notes,
  };
}

function sheetMapPickColumns_(staticByCol, formulaByCol, opts) {
  const scanRows = Number(opts && opts.scanRows) || 0;
  const max = Number(opts && opts.max) || 10;
  const mode = String(opts && opts.mode || "").toLowerCase();

  const cols = [];
  for (let c = 0; c < staticByCol.length; c++) {
    const st = Number(staticByCol[c] || 0);
    const fo = Number(formulaByCol[c] || 0);
    const any = st + fo;
    if (!any) continue;

    // Heuristics:
    // - input columns: many static non-empty, few formulas
    // - output columns: many formulas, moderate presence
    const stRatio = scanRows ? (st / scanRows) : 0;
    const foRatio = scanRows ? (fo / scanRows) : 0;

    if (mode === "input") {
      if (st >= 6 && stRatio >= 0.08 && fo <= 1) cols.push({ c, score: st - fo * 10 });
    } else if (mode === "output") {
      if (fo >= 6 && foRatio >= 0.08) cols.push({ c, score: fo * 2 - st });
    }
  }

  cols.sort((a, b) => b.score - a.score);
  const out = [];
  for (let i = 0; i < cols.length && out.length < max; i++) {
    out.push(sheetMapColLetter_(cols[i].c + 1));
  }
  return out;
}

function sheetMapNotesForName_(sheetName) {
  const name = String(sheetName || "");
  const notes = [];

  if (/^Projekt\b/i.test(name)) {
    notes.push("Project sheet (Blueprints workflow): lock cell typically `K8` (row 8, col 11).");
    notes.push("Common tables start around row `14` (jobs + input materials).");
  }
  if (name === "Sklady") {
    notes.push("Assets cache sheet: columns usually `A..G` = locationId, locationType, locationFlag, hangar, typeId, typeName, quantity.");
  }
  if (name === "IndustryJobs") {
    notes.push("Jobs cache sheet (corp): written by `Corporation.syncJobs()`; headers contain cache timestamps.");
  }
  if (name === "Blueprinty") {
    notes.push("Blueprint cache sheet (corp): used for ME/TE and BPC/BPO availability in project computations.");
  }
  if (name === "Ceník") {
    notes.push("Price list sheet: contains ESI average/adjusted + Jita buy/sell statistics + buyout formula.");
  }
  if (name === "NAKUP LIST") {
    notes.push("Shopping list output: computed aggregation of unlocked project inputs minus stock.");
  }
  if (name === "Jita Sales") {
    notes.push("Sales helper sheet: user inputs names+qty, script fills prices and clipboard payload.");
  }
  if (name === "DOKTRYNY DATASHEET") {
    notes.push("Doctrine definitions: EFT importer writes item names + quantities into column blocks.");
  }

  return notes;
}

function sheetMapWriteToSheet_(markdownText) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET_MAP_SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_MAP_SHEET_NAME);

  // Clear only first ~3000 rows to avoid touching huge sheets.
  const maxRows = Math.min(3000, sh.getMaxRows());
  sh.getRange(1, 1, maxRows, Math.min(3, sh.getMaxColumns())).clearContent();

  const lines = String(markdownText || "").split("\n");
  const out = lines.map(s => [s]);
  if (out.length) sh.getRange(1, 1, out.length, 1).setValues(out);

  sh.getRange(1, 2).setValue("Copy-friendly output (Markdown) in column A.");
  sh.getRange(2, 2).setValue("Tip: run `sheetMapGenerateAndShow()` to open a dialog with a textarea.");

  try {
    sh.activate();
    sh.setActiveSelection("A1");
  } catch (e) {}
}

function sheetMapShowDialog_(markdownText) {
  const safe = String(markdownText || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const html = HtmlService.createHtmlOutput(
    [
      "<div style=\"font-family:Arial, sans-serif; padding:12px\">",
      "<h2 style=\"margin:0 0 8px 0\">Sheet map (Markdown)</h2>",
      "<p style=\"margin:0 0 8px 0; color:#444\">Zkopíruj text a vlož do repo (např. do <code>kontext/</code>).</p>",
      "<textarea style=\"width:100%; height:520px; font-family:Consolas, monospace; font-size:12px;\">",
      safe,
      "</textarea>",
      "</div>",
    ].join("")
  ).setWidth(980).setHeight(700);

  SpreadsheetApp.getUi().showModalDialog(html, "Sheet map export");
}

function sheetMapA1_(row, col) {
  return sheetMapColLetter_(col) + String(row);
}

function sheetMapColLetter_(col) {
  // 1-based col -> letters
  let n = Number(col || 0);
  if (!(n > 0)) return "A";
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

