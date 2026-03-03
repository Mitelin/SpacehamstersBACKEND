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

  // Align with Cookbook defaults for comparisons.
  const DEFAULT_ME_T1 = 10;
  const DEFAULT_TE_T1 = 10;
  const DEFAULT_ME_T2 = 10;
  const DEFAULT_TE_T2 = 10;

  // Internal material pricing mode. Cookbook's `priceMode=sell` tracks our `jitaSplitTop5` very closely.
  // Keep configurable for future calibration.
  const INTERNAL_MATERIAL_PRICE_MODE = 'splitTop5'; // 'sellTop5' | 'buyTop5' | 'splitTop5'

  const MAX_DEBUG_MATERIAL_LINES = 30;
  const MAX_DEBUG_JOB_LINES = 30;
  const MAX_DEBUG_EXCESS_LINES = 20;

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

      // Backend optional: merge identical queued modules before expanding the chain.
      // This reduces rounding-driven overbuild for complex T2 trees.
      mergeModules: true,

      shipT1ME: DEFAULT_ME_T1,
      shipT1TE: DEFAULT_TE_T1,
      shipT2ME: DEFAULT_ME_T2,
      shipT2TE: DEFAULT_TE_T2,
      moduleT1ME: DEFAULT_ME_T1,
      moduleT1TE: DEFAULT_TE_T1,
      moduleT2ME: DEFAULT_ME_T2,
      moduleT2TE: DEFAULT_TE_T2,
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

  const priceBuy = (typeName) => {
    const p = priceList.getPrice(typeName);
    const v = p ? Number(p.jitaBuyTop5) : NaN;
    if (isNaN(v) || v <= 0) return null;
    return v;
  };

  const priceSplit = (typeName) => {
    const p = priceList.getPrice(typeName);
    const v = p ? Number(p.jitaSplitTop5) : NaN;
    if (isNaN(v) || v <= 0) return null;
    return v;
  };

  const priceMaterialInternal = (typeName) => {
    // Backward-compatible: return just the numeric unit price.
    const res = priceMaterialInternalDetailed(typeName);
    return res ? res.unit : null;
  };

  const priceMaterialInternalDetailed = (typeName) => {
    // Some items may be missing in one feed (e.g. splitTop5) but present in others.
    // For internal calculations we prefer INTERNAL_MATERIAL_PRICE_MODE but fall back
    // to other feeds to avoid failing whole rows.
    const preferred = String(INTERNAL_MATERIAL_PRICE_MODE || '').trim();
    const order = [];
    if (preferred === 'buyTop5') order.push('buyTop5', 'splitTop5', 'sellTop5');
    else if (preferred === 'sellTop5') order.push('sellTop5', 'splitTop5', 'buyTop5');
    else order.push('splitTop5', 'buyTop5', 'sellTop5');

    for (let i = 0; i < order.length; i++) {
      const mode = order[i];
      let unit = null;
      if (mode === 'buyTop5') unit = priceBuy(typeName);
      else if (mode === 'sellTop5') unit = priceSell(typeName);
      else unit = priceSplit(typeName);
      if (unit != null) return { unit, modeUsed: mode, preferredMode: preferred || 'splitTop5' };
    }
    return null;
  };

  const resolveMaterialMultipliers = (facility) => {
    // Mirror backend resolve_material_multipliers() for parity.
    const st = String((facility && facility.industryStructureType) || '').trim().toLowerCase();
    const manufacturingRoleBonus = (st === '' || st === 'station') ? 1.0 : 0.99;

    const rig = String((facility && facility.industryRig) || '').trim().toUpperCase();
    let manufacturingRigBonus = 1.0;
    if (rig === 'T1') manufacturingRigBonus = 0.976;
    else if (rig === 'T2') manufacturingRigBonus = 0.958;

    const rrig = String((facility && facility.reactionRig) || '').trim().toUpperCase();
    let reactionRigBonus = 1.0;
    if (rrig === 'T1') reactionRigBonus = 0.986;
    else if (rrig === 'T2') reactionRigBonus = 0.974;

    return {
      manufacturingRoleBonus,
      manufacturingRigBonus,
      reactionRigBonus,
    };
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
    const multipliers = resolveMaterialMultipliers(facility);

    // Some backend datasets may include intermediate items in `data.materials` with `isInput=true`.
    // For parity with Cookbook (and to avoid double-counting), treat any type produced by a job in the
    // chain (excluding the final requested output) as an intermediate and do not price it as an
    // external market input.
    const jobsAll = Array.isArray(data.jobs) ? data.jobs : [];
    const producedTypes = new Set();
    for (let j = 0; j < jobsAll.length; j++) {
      const job = jobsAll[j];
      if (!job) continue;
      if (Number(job.level) === 1) continue;
      const product = job.product;
      if (!product) continue;
      if (String(product).endsWith('Blueprint')) continue;
      producedTypes.add(String(product));
    }

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
      excess: [],
      jobs: [],
      skippedIntermediateInputs: [],
      materialCostGross: 0,
      materialCostBuyTop5: 0,
      materialCostSplitTop5: 0,
      skippedIntermediateInputsCost: 0,
      excessMaterialsValue: 0,
      materialCost: 0,
      materialCostNetIfSellExcess: 0,
      jobCost: 0,
      producedQuantity: null,
    } : null;

    // 1) Material cost (gross): use TOTAL INPUT materials (across the whole chain)
    // and price them by our pricelist (Cookbook sell-mode matches our splitTop5 closely).
    let materialCostGross = 0;
    let materialCostBuyTop5 = 0;
    let materialCostSplitTop5 = 0;
    let skippedIntermediateInputsCost = 0;
    const materials = Array.isArray(data.materials) ? data.materials : [];
    const inputs = materials.filter(m => m && m.isInput);
    for (let i = 0; i < inputs.length; i++) {
      const m = inputs[i];
      const name = m.material;
      const qty = Number(m.quantity);
      if (!name || isNaN(qty) || qty <= 0) continue;
      // Blueprint "materials" can show up in some datasets; they are not priced market inputs.
      if (String(name).endsWith('Blueprint')) continue;

      // If this type is produced inside the chain, do not treat it as an external input.
      if (producedTypes.has(String(name))) {
        if (dbg) {
          const priced = priceMaterialInternalDetailed(name);
          if (priced && priced.unit != null) {
            const cost = qty * priced.unit;
            skippedIntermediateInputsCost += cost;
            dbg.skippedIntermediateInputs.push({ type: name, qty, unit: priced.unit, priceModeUsed: priced.modeUsed, cost });
          }
        }
        continue;
      }

      const priced = priceMaterialInternalDetailed(name);
      if (!priced || priced.unit == null) {
        if (dbg) dbg.missingPrices.push({ type: name, price: 'material:' + INTERNAL_MATERIAL_PRICE_MODE });
        throw ('Chybí cena (material:' + INTERNAL_MATERIAL_PRICE_MODE + ') pro: ' + name);
      }
      materialCostGross += qty * priced.unit;

      // Debug-only: alternate price modes for explaining deltas.
      if (dbg) {
        const ub = priceBuy(name);
        if (ub != null) materialCostBuyTop5 += qty * ub;
        const us = priceSplit(name);
        if (us != null) materialCostSplitTop5 += qty * us;
      }

      if (dbg) {
        dbg.materials.push({ type: name, qty, unit: priced.unit, priceModeUsed: priced.modeUsed, cost: qty * priced.unit });
      }
    }

    // 1b) Excess materials value: value of over-produced intermediate items.
    // Cookbook reports `excessMaterialsValue` and typically nets it out from material cost.
    // We approximate it by comparing total produced vs total consumed for each intermediate type.
    let excessMaterialsValue = 0;
    {
      const producedByType = new Map();
      const consumedByType = new Map();

      const addMap = (m, k, v) => {
        if (!k || isNaN(v) || v === 0) return;
        m.set(k, (Number(m.get(k)) || 0) + v);
      };

      // Produced totals
      for (let j = 0; j < jobsAll.length; j++) {
        const job = jobsAll[j];
        if (!job) continue;
        // Do NOT treat the final requested output (level 1) as "excess".
        // Nothing consumes the finished product inside the chain, so it would always appear as leftover.
        if (Number(job.level) === 1) continue;
        const product = job.product;
        if (!product) continue;
        if (String(product).endsWith('Blueprint')) continue;
        const runs = Number(job.runs);
        const perRunOut = Number(job.quantity);
        if (isNaN(runs) || runs <= 0) continue;
        if (isNaN(perRunOut) || perRunOut <= 0) continue;
        addMap(producedByType, String(product), runs * perRunOut);
      }

      // Consumed totals (job.materials quantities are already totals for that job)
      for (let j = 0; j < jobsAll.length; j++) {
        const job = jobsAll[j];
        if (!job) continue;
        const mats = Array.isArray(job.materials) ? job.materials : [];
        for (let k = 0; k < mats.length; k++) {
          const mm = mats[k];
          if (!mm) continue;
          const t = mm.type;
          if (!t) continue;
          if (String(t).endsWith('Blueprint')) continue;
          const q = Number(mm.quantity);
          if (isNaN(q) || q <= 0) continue;
          addMap(consumedByType, String(t), q);
        }
      }

      // Excess = produced - consumed
      const lines = [];
      producedByType.forEach((producedQty, typeName) => {
        const consumedQty = Number(consumedByType.get(typeName)) || 0;
        const excessQty = producedQty - consumedQty;
        if (excessQty <= 0) return;
        const priced = priceMaterialInternalDetailed(typeName);
        if (!priced || priced.unit == null) return;
        const value = excessQty * priced.unit;
        if (value <= 0) return;
        excessMaterialsValue += value;
        if (dbg) lines.push({ type: typeName, qty: excessQty, unit: priced.unit, priceModeUsed: priced.modeUsed, value });
      });

      if (dbg && lines.length) {
        lines.sort((a, b) => Number(b.value) - Number(a.value));
        dbg.excess = lines.slice(0, MAX_DEBUG_EXCESS_LINES);
      }
    }

    // Cookbook's totalCost uses materialCost + jobCost; excessMaterialsValue is informational.
    // So for parity we keep materialCost == gross input cost.
    const materialCost = materialCostGross;
    const materialCostNetIfSellExcess = materialCostGross - excessMaterialsValue;

    // 2) Job cost: approximate installation cost using adjusted price + ESI system cost index.
    // IMPORTANT: SCC surcharge + facility tax are applied on the job BASE value (not on the index fee).
    // This matches common industry fee formulas and aligns better with Cookbook breakdowns.
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
        // Apply facility multipliers to job base (matches observed Cookbook parity).
        // Manufacturing: structure role bonus + rig bonus. Reactions: reaction rig bonus.
        let baseMultiplier = 1.0;
        if (esiActivity === 'manufacturing') baseMultiplier = multipliers.manufacturingRoleBonus * multipliers.manufacturingRigBonus;
        else if (esiActivity === 'reaction') baseMultiplier = multipliers.reactionRigBonus;

        const effBase = base * baseMultiplier;
        const fee = effBase * idx;
        const tax = facilityTaxRate > 0 ? effBase * facilityTaxRate : 0;
        const scc = SCC_SURCHARGE_RATE > 0 ? effBase * SCC_SURCHARGE_RATE : 0;
        const cost = fee + tax + scc;
        jobCost += cost;

        if (dbg) {
          dbg.jobs.push({
            type: job.type,
            esiActivity,
            runs: isNaN(runs) ? null : runs,
            baseValue: base,
            baseMultiplier,
            effectiveBaseValue: effBase,
            costIndex: idx,
            fee,
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
      dbg.materialCostGross = materialCostGross;
      dbg.materialCostBuyTop5 = materialCostBuyTop5;
      dbg.materialCostSplitTop5 = materialCostSplitTop5;
      dbg.skippedIntermediateInputsCost = skippedIntermediateInputsCost;
      dbg.excessMaterialsValue = excessMaterialsValue;
      dbg.materialCost = materialCost;
      dbg.materialCostNetIfSellExcess = materialCostNetIfSellExcess;
      dbg.jobCost = jobCost;
      dbg.producedQuantity = producedQty;

      if (Array.isArray(dbg.skippedIntermediateInputs) && dbg.skippedIntermediateInputs.length) {
        dbg.skippedIntermediateInputs.sort((a, b) => Number(b.cost) - Number(a.cost));
        if (dbg.skippedIntermediateInputs.length > MAX_DEBUG_MATERIAL_LINES) {
          dbg.skippedIntermediateInputs = dbg.skippedIntermediateInputs.slice(0, MAX_DEBUG_MATERIAL_LINES);
        }
      }

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

  const fetchBuildCosts = (blueprintTypeIds, systemName, priceMode) => {
    // Matches the defaults used in Blueprints.updateBuildCosts()
    return Eve.getBuildCosts(
      blueprintTypeIds,
      1, // quantity
      priceMode || 'sell',
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
          let dataBuy = null;
          try {
            data = fetchBuildCosts(batchIds, systemName, 'sell');
            // Debug-only: also fetch buy-mode so we can prove/disprove the "Cookbook always uses buy" hypothesis.
            if (debug) {
              try {
                dataBuy = fetchBuildCosts(batchIds, systemName, 'buy');
              } catch (e2) {
                dataBuy = null;
              }
            }
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

          // Build lookup for buy-mode response (debug only)
          const buyByBlueprintId = new Map();
          if (debug && Array.isArray(dataBuy)) {
            dataBuy.forEach(entry => {
              if (!entry) return;
              const status = (typeof entry.status === 'string') ? Number(entry.status) : entry.status;
              if (status !== 200) return;
              const msg = entry.message;
              if (!msg) return;
              const bpId =
                msg.blueprintTypeId ??
                msg.blueprintTypeID ??
                msg.blueprint_type_id ??
                msg.blueprintTypeid;
              if (bpId == null) return;
              buyByBlueprintId.set(String(bpId), msg);
            });
          }

          data.forEach(entry => {
            if (!entry) return;
            const status = (typeof entry.status === 'string') ? Number(entry.status) : entry.status;
            const message = entry.message;

            // If Cookbook returned a per-blueprint error, try to attach it to the right row.
            if (status !== 200) {
              if (debug && message && typeof message === 'object') {
                const bpIdErr = message.blueprintTypeId ?? message.blueprintTypeID ?? message.blueprint_type_id;
                if (bpIdErr != null) {
                  const rowsErr = rowByBlueprintId.get(String(bpIdErr)) || [];
                  rowsErr.forEach(r => setRowNote(sheet, r, COL_COOKBOOK, 'Cookbook status=' + status + '\n' + JSON.stringify(message, null, 2)));
                }
              }
              return;
            }

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

            if (debug) {
              const noteLines = [];
              noteLines.push('status: ' + status);
              if (message.blueprintName) noteLines.push('blueprint: ' + message.blueprintName);
              noteLines.push('blueprintTypeId: ' + blueprintTypeId);
              if (message.producedQuantity != null) noteLines.push('producedQuantity: ' + message.producedQuantity);
              if (message.materialCost != null) noteLines.push('materialCost: ' + formatIsk(message.materialCost));
              if (message.jobCost != null) noteLines.push('jobCost: ' + formatIsk(message.jobCost));
              if (message.excessMaterialsValue != null) noteLines.push('excessMaterialsValue: ' + formatIsk(message.excessMaterialsValue));
              if (message.totalCost != null) noteLines.push('totalCost: ' + formatIsk(message.totalCost));
              noteLines.push('buildCostPerUnit: ' + formatIsk(cost));

              // If we managed to fetch buy-mode too, print it for comparison.
              const buyMsg = buyByBlueprintId.get(String(blueprintTypeId));
              if (buyMsg) {
                noteLines.push('--- cookbook buy-mode (debug) ---');
                if (buyMsg.materialCost != null) noteLines.push('materialCost(buy): ' + formatIsk(buyMsg.materialCost));
                if (buyMsg.jobCost != null) noteLines.push('jobCost(buy): ' + formatIsk(buyMsg.jobCost));
                if (buyMsg.excessMaterialsValue != null) noteLines.push('excessMaterialsValue(buy): ' + formatIsk(buyMsg.excessMaterialsValue));
                if (buyMsg.totalCost != null) noteLines.push('totalCost(buy): ' + formatIsk(buyMsg.totalCost));
                if (buyMsg.buildCostPerUnit != null) noteLines.push('buildCostPerUnit(buy): ' + formatIsk(buyMsg.buildCostPerUnit));
              }

              noteLines.push('--- request params ---');
              noteLines.push('system: ' + systemName);
              noteLines.push('priceMode: sell');
              noteLines.push('baseMe: 10');
              noteLines.push('componentsMe: 10');
              const facility = getDefaultFacilityConfig();
              noteLines.push('industry: ' + facility.industryStructureType + ' rig ' + facility.industryRig);
              noteLines.push('reaction: ' + facility.reactionStructureType + ' rig ' + facility.reactionRig);
              noteLines.push('facilityTax%: ' + facility.facilityTax);
              rows.forEach(r => setRowNote(sheet, r, COL_COOKBOOK, noteLines.join('\n')));
            }
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
          lines.push('materialPriceMode(internal): ' + String(INTERNAL_MATERIAL_PRICE_MODE));
          lines.push('ME/TE T1: ' + String(DEFAULT_ME_T1) + '/' + String(DEFAULT_TE_T1));
          lines.push('ME/TE T2: ' + String(DEFAULT_ME_T2) + '/' + String(DEFAULT_TE_T2));
          if (dbg.facility) {
            lines.push('facilityTax%: ' + String(dbg.facility.facilityTax));
            lines.push('industry: ' + String(dbg.facility.industryStructureType) + ' rig ' + String(dbg.facility.industryRig));
            lines.push('reaction: ' + String(dbg.facility.reactionStructureType) + ' rig ' + String(dbg.facility.reactionRig));
          }
          lines.push('producedQty: ' + String(dbg.producedQuantity));
          // Cookbook semantics: totalCost = materialCost + jobCost; excess is informational.
          if (dbg.materialCost != null) lines.push('materialCost: ' + formatIsk(dbg.materialCost));
          if (dbg.materialCostBuyTop5 != null) lines.push('materialCost(buyTop5, internal debug): ' + formatIsk(dbg.materialCostBuyTop5));
          if (dbg.materialCostSplitTop5 != null) lines.push('materialCost(splitTop5, internal debug): ' + formatIsk(dbg.materialCostSplitTop5));
          if (dbg.skippedIntermediateInputsCost != null) lines.push('skippedIntermediateInputsCost: ' + formatIsk(dbg.skippedIntermediateInputsCost));
          if (dbg.excessMaterialsValue != null) lines.push('excessMaterialsValue: ' + formatIsk(dbg.excessMaterialsValue));
          if (dbg.materialCostNetIfSellExcess != null) lines.push('materialCostNetIfSellExcess: ' + formatIsk(dbg.materialCostNetIfSellExcess));
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
                ' mult=' + String(j.baseMultiplier) +
                ' effBase=' + formatIsk(j.effectiveBaseValue) +
                ' idx=' + String(j.costIndex) +
                ' fee=' + formatIsk(j.fee) +
                ' tax=' + formatIsk(j.tax) +
                ' scc=' + formatIsk(j.scc) +
                ' cost=' + formatIsk(j.jobCost)
              );
            });
          }

          if (Array.isArray(dbg.excess) && dbg.excess.length) {
            lines.push('--- excess (top by value) ---');
            dbg.excess.forEach(e => {
              lines.push(
                e.type +
                ' qty=' + String(e.qty) +
                ' unit=' + formatIsk(e.unit) +
                ' mode=' + String(e.priceModeUsed || '') +
                ' value=' + formatIsk(e.value)
              );
            });
          }

          if (Array.isArray(dbg.skippedIntermediateInputs) && dbg.skippedIntermediateInputs.length) {
            lines.push('--- skipped intermediate inputs (top by cost) ---');
            dbg.skippedIntermediateInputs.forEach(m => {
              lines.push(
                m.type +
                ' qty=' + String(m.qty) +
                ' unit=' + formatIsk(m.unit) +
                ' mode=' + String(m.priceModeUsed || '') +
                ' cost=' + formatIsk(m.cost)
              );
            });
          }

          if (Array.isArray(dbg.materials) && dbg.materials.length) {
            lines.push('--- materials (top by cost) ---');
            dbg.materials.forEach(m => {
              lines.push(
                m.type +
                ' qty=' + String(m.qty) +
                ' unit=' + formatIsk(m.unit) +
                ' mode=' + String(m.priceModeUsed || '') +
                ' cost=' + formatIsk(m.cost)
              );
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
