const Calculator = (() => {
  const START_ROW = 2;
  const END_ROW = 100;
  const ROW_COUNT = END_ROW - START_ROW + 1;

  const COL_ITEM = 1; // A
  const COL_COST = 2; // B
  const COL_COOKBOOK = 3; // C

  const FONT_OK = '#000000';
  const FONT_ERR = '#ff0000';

  // For now we calculate INTERNAL cost (not Cookbook).
  // Cookbook price can be pasted by hand into column C for comparisons.
  const CALC_MODE = 'internal'; // 'internal' | 'cookbook'

  // Installation cost typically includes an SCC surcharge in addition to facility tax.
  // Keep as a constant so we can calibrate against Cookbook if needed.
  const SCC_SURCHARGE_RATE = 0.04; // 4%

  const MAX_DEBUG_MATERIAL_LINES = 30;
  const MAX_DEBUG_JOB_LINES = 30;

  const getTargetSheet = (sheet) => {
    if (sheet) return sheet;
    const active = SpreadsheetApp.getActive().getActiveSheet();
    if (active && active.getName() === 'Calculator') return active;
    if (typeof calculatorSheet !== 'undefined' && calculatorSheet) return calculatorSheet;
    return active;
  };

  const normalizeName = (v) => {
    if (v == null) return '';
    return String(v).trim();
  };

  const toTitleCaseSimple = (s) => {
    // Conservative title-casing for user input like "phoenix" -> "Phoenix".
    // Intentionally not fuzzy: does not fix typos like "Peoenix".
    return String(s)
      .toLowerCase()
      .replace(/(^|[\s\-\/])([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase());
  };

  const resolveBlueprintTypeId = (rawInput) => {
    const raw = normalizeName(rawInput);
    if (!raw) return null;
    if (!isNaN(raw)) return parseInt(raw, 10);

    const hasBlueprintWord = /\bBlueprint\b/i.test(raw);
    const base = [];
    base.push(raw);
    if (raw === raw.toLowerCase()) base.push(toTitleCaseSimple(raw));

    const candidates = [];
    // IMPORTANT: If the user did not explicitly type "Blueprint",
    // prioritize resolving "<name> Blueprint" first. Otherwise we might
    // resolve to the product typeId (e.g. "Phoenix") instead of the blueprint.
    if (!hasBlueprintWord) {
      base.forEach(b => {
        const t = normalizeName(b);
        if (t) candidates.push(t + ' Blueprint');
      });
      base.forEach(b => {
        const t = normalizeName(b);
        if (t) candidates.push(t);
      });
    } else {
      // User already typed Blueprint, try normalized casing first.
      candidates.push(raw.replace(/\bblueprint\b/ig, 'Blueprint'));
      candidates.push(raw);
    }

    // Deduplicate while preserving order
    const seen = new Set();
    const deduped = [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (!c || seen.has(c)) continue;
      seen.add(c);
      deduped.push(c);
    }

    for (let i = 0; i < deduped.length; i++) {
      const c = deduped[i];
      try {
        const type = Universe.searchType(c);
        if (type && type.type_id) return type.type_id;
      } catch (e) {
        // try next candidate
      }
    }

    return null;
  };

  const setAllOkFormatting = (sheet) => {
    const r = sheet.getRange(START_ROW, COL_ITEM, ROW_COUNT, 1);
    r.setFontColor(FONT_OK);
    r.setFontLine('none');
  };

  const clearNotes = (sheet) => {
    // Notes are used only for debug mode; clear them so stale info doesn't stick.
    sheet.getRange(START_ROW, COL_ITEM, ROW_COUNT, 3).clearNote();
  };

  const markRowError = (sheet, rowIndex0) => {
    const row = START_ROW + rowIndex0;
    const r = sheet.getRange(row, COL_ITEM, 1, 1);
    r.setFontColor(FONT_ERR);
    r.setFontLine('underline');
  };

  const setRowNote = (sheet, rowIndex0, col, note) => {
    const row = START_ROW + rowIndex0;
    try {
      sheet.getRange(row, col, 1, 1).setNote(note ? String(note) : '');
    } catch (e) {
      // ignore note failures (quota/size)
    }
  };

  const getDefaultSystemName = () => {
    // Requested fixed defaults for now (do not depend on other sheets):
    // system: UALX-3
    return 'UALX-3';
  };

  const getDefaultFacilityConfig = () => {
    // Keep in sync with fetchBuildCosts() defaults (Cookbook-compatible params).
    return {
      facilityTax: 0,
      industryStructureType: 'Sotiyo',
      industryRig: 'T1',
      reactionStructureType: 'Tatara',
      reactionRig: 'T2',
      reactionFlag: 'Yes',
      blueprintVersion: 'tq',
    };
  };

  const formatIsk = (v) => {
    const n = Number(v);
    if (isNaN(n)) return String(v);
    // Avoid locale-dependent formatting; keep stable.
    return n.toFixed(2);
  };

  const getSystemIdByName = (systemName) => {
    const data = Eve.resolveNames([systemName], 'systems');
    if (!data || !data[0] || !data[0].id) throw ('System nenalezen: ' + systemName);
    return data[0].id;
  };

  const getCostIndexMapForSystem = (systemId) => {
    const sys = Eve.getIndusrtyCostIndices(systemId);
    const map = new Map();
    if (!sys || !Array.isArray(sys.cost_indices)) return map;
    sys.cost_indices.forEach(ci => {
      if (!ci) return;
      const activity = String(ci.activity || '').toLowerCase();
      const costIndex = Number(ci.cost_index);
      if (activity && !isNaN(costIndex)) map.set(activity, costIndex);
    });
    return map;
  };

  const fetchBlueprintCalculation = (blueprintTypeId) => {
    // Minimal request compatible with Blueprints.calculateBlueprints() endpoint.
    const facility = getDefaultFacilityConfig();
    const req = {
      types: [{ typeId: blueprintTypeId, amount: 1 }],
      shipT1ME: 10,
      shipT1TE: 10,
      shipT2ME: 10,
      shipT2TE: 0,
      moduleT1ME: 10,
      moduleT1TE: 10,
      moduleT2ME: 10,
      moduleT2TE: 0,
      produceFuelBlocks: false,
      buildT1: false,
      copyBPO: false,

      // Facility/rig configuration (newer backend understands these; older ignores safely)
      facilityTax: facility.facilityTax,
      industryStructureType: facility.industryStructureType,
      industryRig: facility.industryRig,
      reactionStructureType: facility.reactionStructureType,
      reactionRig: facility.reactionRig,
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(req),
      muteHttpExceptions: true,
    };

    const response = UrlFetchApp.fetch('http://www.spacehamsters.eu:8010/api/blueprints/calculate', options);
    const code = response.getResponseCode();
    if (code !== 200) {
      throw ('Blueprint calculate error: ' + code + ' ' + response.getContentText());
    }
    return JSON.parse(response.getContentText());
  };

  const priceSell = (typeName) => {
    const p = priceList.getPrice(typeName);
    const v = p ? Number(p.jitaSellTop5) : NaN;
    if (isNaN(v) || v <= 0) return null;
    return v;
  };

  const priceAdjusted = (typeName) => {
    const p = priceList.getPrice(typeName);
    const v = p ? Number(p.eveAdjusted) : NaN;
    if (isNaN(v) || v <= 0) return null;
    return v;
  };

  const mapActivityToEsi = (jobType) => {
    const t = String(jobType || '').toLowerCase();
    if (t === 'manufacturing') return 'manufacturing';
    if (t === 'reaction') return 'reaction';
    if (t === 'copying') return 'copying';
    if (t === 'invention') return 'invention';
    return '';
  };

  const computeInternalBuildCostPerUnit = (blueprintTypeId, systemCostIndexByActivity, debug) => {
    const data = fetchBlueprintCalculation(blueprintTypeId);
    const facility = getDefaultFacilityConfig();
    const facilityTaxRate = (Number(facility.facilityTax) || 0) / 100.0;

    const dbg = debug ? {
      blueprintTypeId,
      system: {
        name: getDefaultSystemName(),
        costIndexManufacturing: systemCostIndexByActivity ? systemCostIndexByActivity.get('manufacturing') : null,
        costIndexReaction: systemCostIndexByActivity ? systemCostIndexByActivity.get('reaction') : null,
      },
      facility,
      sccSurchargeRate: SCC_SURCHARGE_RATE,
      missingPrices: [],
      materials: [],
      jobs: [],
      materialCost: 0,
      jobCost: 0,
      producedQuantity: null,
    } : null;

    // 1) Material cost: use TOTAL INPUT materials (across the whole chain)
    // and price them by our pricelist Jita Sell Top5 (matches Cookbook priceMode=sell).
    let materialCost = 0;
    const materials = Array.isArray(data.materials) ? data.materials : [];
    const inputs = materials.filter(m => m && m.isInput);
    for (let i = 0; i < inputs.length; i++) {
      const m = inputs[i];
      const name = m.material;
      const qty = Number(m.quantity);
      if (!name || isNaN(qty) || qty <= 0) continue;
      const unit = priceSell(name);
      if (unit == null) {
        if (dbg) dbg.missingPrices.push({ type: name, price: 'jitaSellTop5' });
        throw ('Chybí cena (Jita sell) pro: ' + name);
      }
      materialCost += qty * unit;

      if (dbg) {
        dbg.materials.push({ type: name, qty, unit, cost: qty * unit });
      }
    }

    // 2) Job cost: approximate installation cost using adjusted price + ESI system cost index.
    // We sum manufacturing+reaction job costs across all jobs.
    let jobCost = 0;
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];
    for (let j = 0; j < jobs.length; j++) {
      const job = jobs[j];
      const esiActivity = mapActivityToEsi(job.type);
      if (!esiActivity) continue;
      const idx = systemCostIndexByActivity.get(esiActivity);
      if (idx == null) continue;

      const runs = Number(job.runs);
      const mats = Array.isArray(job.materials) ? job.materials : [];
      let base = 0;

      for (let k = 0; k < mats.length; k++) {
        const mm = mats[k];
        if (!mm) continue;
        const matName = mm.type;
        if (!matName) continue;
        if (String(matName).endsWith('Blueprint')) continue;

        const perRun = Number(mm.base_quantity ?? mm.quantity);
        if (isNaN(perRun) || perRun <= 0) continue;
        const adj = priceAdjusted(matName);
        if (adj == null) {
          if (dbg) dbg.missingPrices.push({ type: matName, price: 'eveAdjusted' });
          continue;
        }
        base += perRun * (isNaN(runs) || runs <= 0 ? 1 : runs) * adj;
      }

      if (base > 0) {
        let cost = base * idx;
        const tax = facilityTaxRate > 0 ? cost * facilityTaxRate : 0;
        cost += tax;
        const scc = SCC_SURCHARGE_RATE > 0 ? cost * SCC_SURCHARGE_RATE : 0;
        cost += scc;
        jobCost += cost;

        if (dbg) {
          dbg.jobs.push({
            type: job.type,
            esiActivity,
            runs: isNaN(runs) ? null : runs,
            baseValue: base,
            costIndex: idx,
            tax,
            scc,
            jobCost: cost,
          });
        }
      }
    }

    // 3) Per-unit
    const produced = (Array.isArray(data.jobs) ? data.jobs : [])
      .filter(j => j && Number(j.level) === 1)
      .reduce((acc, j) => acc + (Number(j.runs) || 0) * (Number(j.quantity) || 0), 0);

    const producedQty = produced > 0 ? produced : 1;
    const perUnit = (materialCost + jobCost) / producedQty;

    if (dbg) {
      dbg.materialCost = materialCost;
      dbg.jobCost = jobCost;
      dbg.producedQuantity = producedQty;

      // Sort material lines by cost desc and trim.
      dbg.materials.sort((a, b) => Number(b.cost) - Number(a.cost));
      if (dbg.materials.length > MAX_DEBUG_MATERIAL_LINES) {
        dbg.materials = dbg.materials.slice(0, MAX_DEBUG_MATERIAL_LINES);
      }

      // Keep job lines stable.
      if (dbg.jobs.length > MAX_DEBUG_JOB_LINES) {
        dbg.jobs = dbg.jobs.slice(0, MAX_DEBUG_JOB_LINES);
      }

      return { perUnit, debug: dbg };
    }

    return { perUnit, debug: null };
  };

  const fetchBuildCosts = (blueprintTypeIds, systemName) => {
    // Matches the defaults used in Blueprints.updateBuildCosts()
    return Eve.getBuildCosts(
      blueprintTypeIds,
      1, // quantity
      'sell',
      0, // additionalCosts
      10, // baseMe
      10, // componentsMe
      systemName,
      0, // facilityTax
      'Sotiyo',
      'T1',
      'Tatara',
      'T2',
      'Yes',
      'tq'
    );
  };

  return {
    calculate: function (sheet, options) {
      const debug = !!(options && options.debug);
      sheet = getTargetSheet(sheet);
      if (!sheet) throw ('Calculator sheet nenalezen');

      // Read all item names
      const names = sheet.getRange(START_ROW, COL_ITEM, ROW_COUNT, 1).getValues().map(r => normalizeName(r[0]));

      // Reset formatting first so old errors disappear
      setAllOkFormatting(sheet);

      if (debug) clearNotes(sheet);

      // Prepare outputs
      const outCosts = Array.from({ length: ROW_COUNT }, () => ['']);
      const outCookbook = Array.from({ length: ROW_COUNT }, () => ['']);

      // Row-level debug blobs (only used when debug=true)
      const rowDebug = debug ? new Array(ROW_COUNT).fill(null) : null;

      // Resolve blueprintTypeIds; keep mapping to row indexes
      const blueprintIds = [];
      const rowByBlueprintId = new Map();

      for (let i = 0; i < names.length; i++) {
        const name = names[i];
        if (!name) continue;

        try {
          const blueprintTypeId = resolveBlueprintTypeId(name);
          if (!blueprintTypeId) {
            markRowError(sheet, i);
            if (debug) setRowNote(sheet, i, COL_ITEM, 'Blueprint typeId nenalezen pro vstup: ' + name);
            continue;
          }

          // Handle duplicates: we still compute once and copy to all rows
          const key = String(blueprintTypeId);
          if (!rowByBlueprintId.has(key)) {
            rowByBlueprintId.set(key, []);
            blueprintIds.push(blueprintTypeId);
          }
          rowByBlueprintId.get(key).push(i);
        } catch (e) {
          markRowError(sheet, i);
          if (debug) setRowNote(sheet, i, COL_ITEM, 'Chyba při resolve blueprintu: ' + e);
        }
      }

      if (blueprintIds.length === 0) {
        // Nothing to do; still clear old outputs
        sheet.getRange(START_ROW, COL_COST, ROW_COUNT, 1).setValues(outCosts);
        sheet.getRange(START_ROW, COL_COOKBOOK, ROW_COUNT, 1).setValues(outCookbook);
        return;
      }

      const systemName = getDefaultSystemName();

      // Initialize pricelist once per run.
      try { priceList.init(); } catch (e) {}

      // Prepare system cost indices once per run (internal mode).
      let systemCostIndexByActivity = null;
      if (CALC_MODE === 'internal') {
        const systemId = getSystemIdByName(systemName);
        systemCostIndexByActivity = getCostIndexMapForSystem(systemId);
      }

      // Always try to fetch Cookbook prices into column C for comparison.
      // Cookbook may fail/rate-limit independently; we keep internal B intact.
      {
        const BATCH = 20;
        for (let start = 0; start < blueprintIds.length; start += BATCH) {
          const batchIds = blueprintIds.slice(start, start + BATCH);
          let data;
          try {
            data = fetchBuildCosts(batchIds, systemName);
          } catch (e) {
            if (debug) {
              batchIds.forEach(id => {
                const rows = rowByBlueprintId.get(String(id)) || [];
                rows.forEach(r => setRowNote(sheet, r, COL_COOKBOOK, 'Cookbook error: ' + e));
              });
            }
            continue;
          }

          if (!Array.isArray(data)) {
            if (debug) {
              batchIds.forEach(id => {
                const rows = rowByBlueprintId.get(String(id)) || [];
                rows.forEach(r => setRowNote(sheet, r, COL_COOKBOOK, 'Cookbook invalid response (not array)'));
              });
            }
            continue;
          }

          data.forEach(entry => {
            if (!entry) return;
            const status = (typeof entry.status === 'string') ? Number(entry.status) : entry.status;
            if (status !== 200) {
              if (debug) {
                // We don't know blueprintTypeId reliably here; skip per-row note.
              }
              return;
            }
            const message = entry.message;
            if (!message) return;
            const blueprintTypeId =
              message.blueprintTypeId ??
              message.blueprintTypeID ??
              message.blueprint_type_id ??
              message.blueprintTypeid;
            const cost = message.buildCostPerUnit;
            if (blueprintTypeId == null || cost == null) return;
            const rows = rowByBlueprintId.get(String(blueprintTypeId)) || [];
            rows.forEach(r => { outCookbook[r][0] = cost; });
          });
        }
      }

      if (CALC_MODE === 'cookbook') {
        // In cookbook-only mode mirror column C into B.
        for (let i = 0; i < ROW_COUNT; i++) {
          if (outCookbook[i][0] !== '' && outCookbook[i][0] != null) outCosts[i][0] = outCookbook[i][0];
        }
      } else {
        // INTERNAL mode: compute per blueprint (cached for duplicates).
        const costCache = new Map();
        const debugCache = debug ? new Map() : null;
        for (let i = 0; i < blueprintIds.length; i++) {
          const id = blueprintIds[i];
          const key = String(id);
          let cost = costCache.get(key);
          if (cost == null) {
            try {
              const res = computeInternalBuildCostPerUnit(id, systemCostIndexByActivity, debug);
              cost = res.perUnit;
              costCache.set(key, cost);
              if (debug && res.debug) debugCache.set(key, res.debug);
            } catch (e) {
              try { console.log('Calculator internal error for blueprintTypeId=' + id + ':', e); } catch (ee) {}
              costCache.set(key, null);
              if (debug) debugCache.set(key, { blueprintTypeId: id, error: String(e), facility: getDefaultFacilityConfig(), system: { name: getDefaultSystemName() } });
            }
          }

          const rows = rowByBlueprintId.get(key) || [];
          rows.forEach(r => {
            if (cost != null) outCosts[r][0] = cost;
            if (debug) rowDebug[r] = debugCache.get(key) || null;
          });
        }
      }

      // Any non-empty names with empty INTERNAL cost are treated as error.
      // Cookbook column C may be empty due to rate limit / invalid blueprint in Cookbook etc.
      for (let i = 0; i < names.length; i++) {
        if (names[i] && (outCosts[i][0] === '' || outCosts[i][0] == null)) {
          markRowError(sheet, i);
          if (debug && !sheet.getRange(START_ROW + i, COL_ITEM, 1, 1).getNote()) {
            setRowNote(sheet, i, COL_ITEM, 'Nevyšla interní cena (sloupec B prázdný). Mrkni do poznámky u sloupce B.');
          }
        }
      }

      // Write debug notes (only in debug mode)
      if (debug) {
        for (let i = 0; i < ROW_COUNT; i++) {
          const dbg = rowDebug[i];
          if (!dbg) continue;

          if (dbg.error) {
            setRowNote(sheet, i, COL_COST, 'ERROR\n' + String(dbg.error));
            continue;
          }

          // Human-readable breakdown note.
          const lines = [];
          lines.push('blueprintTypeId: ' + dbg.blueprintTypeId);
          if (dbg.system && dbg.system.name) lines.push('system: ' + dbg.system.name);
          if (dbg.facility) {
            lines.push('facilityTax%: ' + String(dbg.facility.facilityTax));
            lines.push('industry: ' + String(dbg.facility.industryStructureType) + ' rig ' + String(dbg.facility.industryRig));
            lines.push('reaction: ' + String(dbg.facility.reactionStructureType) + ' rig ' + String(dbg.facility.reactionRig));
          }
          lines.push('producedQty: ' + String(dbg.producedQuantity));
          lines.push('materialCost: ' + formatIsk(dbg.materialCost));
          lines.push('jobCost: ' + formatIsk(dbg.jobCost));
          lines.push('SCC surcharge: ' + String(dbg.sccSurchargeRate));
          if (dbg.system) {
            if (dbg.system.costIndexManufacturing != null) lines.push('idx manufacturing: ' + String(dbg.system.costIndexManufacturing));
            if (dbg.system.costIndexReaction != null) lines.push('idx reaction: ' + String(dbg.system.costIndexReaction));
          }

          if (Array.isArray(dbg.missingPrices) && dbg.missingPrices.length) {
            const uniq = [];
            const s = new Set();
            dbg.missingPrices.forEach(p => {
              const k = String(p.type) + '|' + String(p.price);
              if (!s.has(k)) { s.add(k); uniq.push(p); }
            });
            lines.push('missingPrices: ' + uniq.slice(0, 30).map(p => p.type + ' (' + p.price + ')').join(', '));
          }

          if (Array.isArray(dbg.jobs) && dbg.jobs.length) {
            lines.push('--- jobs ---');
            dbg.jobs.forEach(j => {
              lines.push(
                String(j.esiActivity) +
                ' runs=' + String(j.runs) +
                ' base=' + formatIsk(j.baseValue) +
                ' idx=' + String(j.costIndex) +
                ' tax=' + formatIsk(j.tax) +
                ' scc=' + formatIsk(j.scc) +
                ' cost=' + formatIsk(j.jobCost)
              );
            });
          }

          if (Array.isArray(dbg.materials) && dbg.materials.length) {
            lines.push('--- materials (top by cost) ---');
            dbg.materials.forEach(m => {
              lines.push(m.type + ' qty=' + String(m.qty) + ' unit=' + formatIsk(m.unit) + ' cost=' + formatIsk(m.cost));
            });
          }

          setRowNote(sheet, i, COL_COST, lines.join('\n'));
        }
      }

      // Write outputs
      sheet.getRange(START_ROW, COL_COST, ROW_COUNT, 1).setValues(outCosts);
      sheet.getRange(START_ROW, COL_COOKBOOK, ROW_COUNT, 1).setValues(outCookbook);
    },
  };
})();

// Button-friendly entrypoint
function runCalculator() {
  Calculator.calculate(null, { debug: false });
}

// Debug entrypoint (opt-in). Assign this one to a separate button when needed.
function runCalculatorDebug() {
  Calculator.calculate(null, { debug: true });
}
