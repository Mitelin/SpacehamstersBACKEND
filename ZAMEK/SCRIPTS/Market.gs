const Market = (()=>{
  const doctrinesCol = 12;     // first column with target doctrine names and amounts in the T2 Market sheet 
  const typesCol = 1;        // first column with target types and amounts in the T2 Market sheet 
  const buildCostCol = 11;    // K
  const t2AdjustmentsCol = 15; // O
  const t2AdjustmentHeaders = [
    'Type name',
    'Boost qty',
    'Base target',
    'Adjusted target',
    'Listed now',
    'In progress',
    'Sold 7d',
    'Sold 30d',
    'Sold 90d',
    'Avg daily',
    'Cover days',
    'Confidence',
    'Trend',
    'Multiplier',
    'Adjusted qty',
    'Action',
    'Reason'
  ];
  const t2AdjustmentStateSheetName = '_T2 Adjustment State';
  const T2_ADJUSTMENT_MIN_MULTIPLIER = 0.5;
  const T2_ADJUSTMENT_MAX_MULTIPLIER = 2.0;
  const T2_ADJUSTMENT_MAX_STEP = 0.25;
  const T2_ADJUSTMENT_COOLDOWN_DAYS = 7;
  const T2_ADJUSTMENT_WARMUP_DAYS = 21;
  const T2_ADJUSTMENT_NO_SALES_GRACE_DAYS = 42;
  const BUILD_COST_BATCH = 20;
  const getCanonicalMarketLocationName_ = (locationId, fallbackName) => {
    const id = Number(locationId);
    if (!isFinite(id) || id <= 0) return fallbackName;

    const knownMarkets = [
      1034323745897,
      1046664001931,
      1043661023026,
      1040278453044,
      1030049082711
    ];
    const market = knownMarkets.find(structureId => structureId === id);
    if (!market) return fallbackName;

    if (id === 1034323745897) return 'P-ZMZV - BIG-MOM';
    if (id === 1046664001931) return 'UALX-3 - Mothership Bellicose';
    if (id === 1043661023026) return 'K7D-II - Breadstar';
    if (id === 1040278453044) return 'E3OI-U - Mothership Bellicose';
    if (id === 1030049082711) return '1DQ1-A - 1-st Innominate Palace';
    return fallbackName;
  };
  const normalizeDoctrineName_ = (name) => {
    return String(name == null ? '' : name)
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };
  const toNumber_ = (value) => {
    if (typeof value === 'number') return value;
    if (value == null || value === '') return NaN;
    return Number(String(value).replace(/[\s\u00A0]/g, '').replace(',', '.'));
  };
  const clamp_ = (value, minValue, maxValue) => {
    return Math.min(Math.max(value, minValue), maxValue);
  };
  const toFiniteNumber_ = (value, fallbackValue) => {
    const n = toNumber_(value);
    return isFinite(n) ? n : fallbackValue;
  };
  const parseDate_ = (value) => {
    if (!value) return null;
    if (Object.prototype.toString.call(value) === '[object Date]') {
      return isNaN(value.getTime()) ? null : value;
    }
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
  };
  const diffDays_ = (fromDate, toDate) => {
    const from = parseDate_(fromDate);
    const to = parseDate_(toDate);
    if (!from || !to) return NaN;
    return Math.floor((to.getTime() - from.getTime()) / 86400000);
  };
  const safeRatio_ = (numerator, denominator) => {
    const a = toFiniteNumber_(numerator, NaN);
    const b = toFiniteNumber_(denominator, NaN);
    if (!isFinite(a) || !isFinite(b) || b === 0) return NaN;
    return a / b;
  };
  const roundMetric_ = (value, digits) => {
    const n = toFiniteNumber_(value, NaN);
    if (!isFinite(n)) return '';
    const factor = Math.pow(10, digits || 0);
    return Math.round(n * factor) / factor;
  };
  const roundUpToHighestPlace_ = (value) => {
    const n = Math.ceil(toNumber_(value));
    if (!isFinite(n) || n <= 0) return 0;
    if (n < 10) return n;

    const digits = String(n);
    const magnitude = Math.pow(10, digits.length - 1);
    const leading = Math.floor(n / magnitude);
    const remainder = n % magnitude;
    if (remainder === 0) return n;
    return (leading + 1) * magnitude;
  };
  const getAdjustmentStep_ = (baseTarget) => {
    const target = Math.max(1, Math.ceil(toFiniteNumber_(baseTarget, 1)));
    if (target >= 200) return 10;
    if (target >= 100) return 5;
    if (target >= 40) return 2;
    return 1;
  };
  const roundAdjustedTarget_ = (baseTarget, multiplier) => {
    const base = Math.max(1, Math.ceil(toFiniteNumber_(baseTarget, 1)));
    const factor = toFiniteNumber_(multiplier, 1);
    if (!isFinite(factor) || factor <= 0) return base;
    if (Math.abs(factor - 1) < 0.0001) return base;

    const rawTarget = base * factor;
    const step = getAdjustmentStep_(base);
    if (factor > 1) {
      return Math.max(base + step, Math.ceil(rawTarget / step) * step);
    }
    return Math.max(1, Math.floor(rawTarget / step) * step);
  };
  const getT2MarketBuildCostConfig_ = () => {
    const config = {
      quantity: 1,
      priceMode: 'sell',
      additionalCosts: 0,
      baseMe: 10,
      componentsMe: 10,
      system: 'Q-02UL',
      facilityTax: 0,
      industryStructureType: 'Sotiyo',
      industryRig: 'T2',
      reactionStructureType: 'Tatara',
      reactionRig: 'T2',
      reactionFlag: 'Yes',
      blueprintVersion: 'tq'
    };

    try {
      if (buildCostSheet) {
        const params = buildCostSheet.getRange(1, 2, 1, 3).getValues();
        const system = normalizeDoctrineName_(params[0][0]);
        const quantity = Math.trunc(toNumber_(params[0][2]));
        if (system) config.system = system;
        if (isFinite(quantity) && quantity > 0) config.quantity = quantity;
      }
    } catch (e) {
      // keep defaults when the build-cost sheet is unavailable
    }

    return config;
  };
  const getT2MarketBuildCostsByName_ = (typeNames) => {
    const out = new Map();
    const uniqueNames = [];
    const seenNames = new Set();
    const blueprintIds = [];
    const namesByBlueprintId = new Map();
    const seenBlueprintIds = new Set();

    typeNames.forEach(name => {
      const itemName = normalizeDoctrineName_(name);
      if (!itemName || seenNames.has(itemName)) return;
      seenNames.add(itemName);
      uniqueNames.push(itemName);
    });

    uniqueNames.forEach(name => {
      let blueprintTypeId = null;
      try {
        blueprintTypeId = Blueprints.getBlueprintId(name);
      } catch (e) {
        blueprintTypeId = null;
      }
      if (!blueprintTypeId) return;

      const key = String(blueprintTypeId);
      if (!namesByBlueprintId.has(key)) namesByBlueprintId.set(key, []);
      namesByBlueprintId.get(key).push(name);
      if (seenBlueprintIds.has(key)) return;
      seenBlueprintIds.add(key);
      blueprintIds.push(blueprintTypeId);
    });

    if (!blueprintIds.length) return out;

    const config = getT2MarketBuildCostConfig_();
    for (let start = 0; start < blueprintIds.length; start += BUILD_COST_BATCH) {
      const batchIds = blueprintIds.slice(start, start + BUILD_COST_BATCH);
      let data;
      try {
        data = Eve.getBuildCosts(
          batchIds,
          config.quantity,
          config.priceMode,
          config.additionalCosts,
          config.baseMe,
          config.componentsMe,
          config.system,
          config.facilityTax,
          config.industryStructureType,
          config.industryRig,
          config.reactionStructureType,
          config.reactionRig,
          config.reactionFlag,
          config.blueprintVersion
        );
      } catch (e) {
        continue;
      }
      if (!Array.isArray(data)) continue;

      data.forEach(entry => {
        if (!entry) return;
        const status = (typeof entry.status === 'string') ? Number(entry.status) : entry.status;
        const message = entry.message;
        if (status !== 200 || !message) return;

        const blueprintTypeId =
          message.blueprintTypeId ??
          message.blueprintTypeID ??
          message.blueprint_type_id ??
          message.blueprintTypeid;
        const buildCostPerUnit = toNumber_(message.buildCostPerUnit);
        if (blueprintTypeId == null || !isFinite(buildCostPerUnit) || buildCostPerUnit <= 0) return;

        const names = namesByBlueprintId.get(String(blueprintTypeId)) || [];
        names.forEach(name => out.set(name, buildCostPerUnit));
      });
    }

    return out;
  };
  const ensureT2AdjustmentStateSheet_ = () => {
    const ss = SpreadsheetApp.getActive();
    let sheet = ss.getSheetByName(t2AdjustmentStateSheetName);
    if (!sheet) {
      sheet = ss.insertSheet(t2AdjustmentStateSheetName);
      sheet.hideSheet();
    }

    const headers = ['typeName', 'lastMultiplier', 'lastChangeDate', 'lastDirection', 'firstSeenDate', 'lastSeenDate', 'lastRecommended', 'note'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return sheet;
  };
  const loadT2AdjustmentState_ = () => {
    const stateSheet = ensureT2AdjustmentStateSheet_();
    const lastRow = stateSheet.getLastRow();
    const out = new Map();
    if (lastRow < 2) return out;

    const rows = stateSheet.getRange(2, 1, lastRow - 1, 8).getValues();
    rows.forEach(row => {
      const typeName = normalizeDoctrineName_(row[0]);
      if (!typeName) return;
      out.set(typeName, {
        typeName: typeName,
        lastMultiplier: toFiniteNumber_(row[1], 1),
        lastChangeDate: parseDate_(row[2]),
        lastDirection: normalizeDoctrineName_(row[3]).toLowerCase(),
        firstSeenDate: parseDate_(row[4]),
        lastSeenDate: parseDate_(row[5]),
        lastRecommended: toFiniteNumber_(row[6], 1),
        note: row[7] || ''
      });
    });
    return out;
  };
  const persistT2AdjustmentState_ = (stateMap) => {
    const stateSheet = ensureT2AdjustmentStateSheet_();
    const rows = Array.from(stateMap.values())
      .sort((a, b) => a.typeName.localeCompare(b.typeName))
      .map(item => [
        item.typeName,
        roundMetric_(item.lastMultiplier, 4),
        item.lastChangeDate || '',
        item.lastDirection || '',
        item.firstSeenDate || '',
        item.lastSeenDate || '',
        roundMetric_(item.lastRecommended, 4),
        item.note || ''
      ]);

    const maxRows = Math.max(stateSheet.getMaxRows() - 1, 0);
    if (maxRows > 0) {
      stateSheet.getRange(2, 1, maxRows, 8).clearContent();
    }
    if (rows.length) {
      stateSheet.getRange(2, 1, rows.length, 8).setValues(rows);
    }
  };
  const getMarketListedByType_ = () => {
    const out = new Map();
    const lastRow = marketSheet ? marketSheet.getLastRow() : 0;
    if (!marketSheet || lastRow < 3) return out;

    const rows = marketSheet.getRange(3, 7, lastRow - 2, 3).getValues();
    rows.forEach(row => {
      const typeName = normalizeDoctrineName_(row[1]);
      const quantity = toFiniteNumber_(row[2], 0);
      if (!typeName || !isFinite(quantity) || quantity <= 0) return;
      out.set(typeName, (out.get(typeName) || 0) + quantity);
    });
    return out;
  };
  const getMapByTypeName_ = (rows) => {
    const out = new Map();
    (rows || []).forEach(row => {
      if (!row) return;
      const typeName = normalizeDoctrineName_(row.typeName);
      if (!typeName) return;
      out.set(typeName, row);
    });
    return out;
  };
  const getMapsByType_ = (rows) => {
    const byName = new Map();
    const byId = new Map();
    (rows || []).forEach(row => {
      if (!row) return;

      const typeName = normalizeDoctrineName_(row.typeName);
      const typeId = Number(
        row.typeID ??
        row.typeId ??
        row.productTypeID ??
        row.productTypeId ??
        row.id
      );

      if (typeName) byName.set(typeName, row);
      if (isFinite(typeId) && typeId > 0) byId.set(typeId, row);
    });
    return { byName: byName, byId: byId };
  };
  const resolveTypeIdByName_ = (() => {
    const memo = new Map();
    return (typeName) => {
      const normalizedName = normalizeDoctrineName_(typeName);
      if (!normalizedName) return null;
      if (memo.has(normalizedName)) return memo.get(normalizedName);

      let typeId = null;
      try {
        const type = Universe.searchType(normalizedName);
        const rawTypeId = Number(type && (type.type_id ?? type.typeID ?? type.id));
        if (isFinite(rawTypeId) && rawTypeId > 0) typeId = rawTypeId;
      } catch (e) {
        typeId = null;
      }

      memo.set(normalizedName, typeId);
      return typeId;
    };
  })();
  const getRowByType_ = (maps, typeName) => {
    if (!maps) return null;

    const normalizedName = normalizeDoctrineName_(typeName);
    const typeId = resolveTypeIdByName_(normalizedName);
    if (isFinite(typeId) && maps.byId && maps.byId.has(typeId)) {
      return maps.byId.get(typeId);
    }
    if (maps.byName && maps.byName.has(normalizedName)) {
      return maps.byName.get(normalizedName);
    }
    return null;
  };
  const getConfidenceLevel_ = (sales) => {
    const sold30d = toFiniteNumber_(sales && sales.sold30d, 0);
    const sold90d = toFiniteNumber_(sales && sales.sold90d, 0);
    const activeDays30d = toFiniteNumber_(sales && sales.activeDays30d, 0);
    const activeDays90d = toFiniteNumber_(sales && sales.activeDays90d, 0);

    if (sold30d >= 20 || activeDays30d >= 6) return 'high';
    if (sold90d >= 10 || activeDays90d >= 4) return 'medium';
    if (sold90d > 0 || activeDays90d > 0) return 'warmup';
    return 'none';
  };
  const getDemandPerDay_ = (sales) => {
    if (!sales) return 0;
    const sold7d = toFiniteNumber_(sales.sold7d, 0);
    const sold30d = toFiniteNumber_(sales.sold30d, 0);
    const sold90d = toFiniteNumber_(sales.sold90d, 0);
    const activeDays30d = toFiniteNumber_(sales.activeDays30d, 0);
    const activeDays90d = toFiniteNumber_(sales.activeDays90d, 0);
    const avgDaily30d = toFiniteNumber_(sales.avgDaily30d, NaN);
    const avgDaily90d = toFiniteNumber_(sales.avgDaily90d, NaN);

    if (sold30d >= 12 || activeDays30d >= 4) {
      return Math.max(isFinite(avgDaily30d) ? avgDaily30d : 0, sold30d / 30);
    }
    if (sold90d >= 10 || activeDays90d >= 4) {
      return Math.max(isFinite(avgDaily90d) ? avgDaily90d : 0, sold90d / 90);
    }
    if (sold7d > 0) {
      return sold7d / 7;
    }
    return 0;
  };
  const evaluateT2Adjustment_ = (params) => {
    const now = params.now;
    const state = params.state || {};
    const sales = params.sales || null;
    const jobs = params.jobs || null;
    const baseTarget = Math.max(1, Math.ceil(toFiniteNumber_(params.baseTarget, 1)));
    const listedNow = Math.max(0, Math.ceil(toFiniteNumber_(params.listedNow, 0)));
    const inProgress = Math.max(0, Math.ceil(toFiniteNumber_(jobs && jobs.w0, 0)));
    const sold7d = Math.max(0, Math.ceil(toFiniteNumber_(sales && sales.sold7d, 0)));
    const sold30d = Math.max(0, Math.ceil(toFiniteNumber_(sales && sales.sold30d, 0)));
    const sold90d = Math.max(0, Math.ceil(toFiniteNumber_(sales && sales.sold90d, 0)));
    const demandPerDay = getDemandPerDay_(sales);
    const confidence = getConfidenceLevel_(sales);
    const availableNow = listedNow + inProgress;
    const coverageDays = demandPerDay > 0 ? availableNow / demandPerDay : NaN;
    const trendRatio = sold30d > 0 ? safeRatio_((sold7d / 7), (sold30d / 30)) : (sold7d > 0 ? 1.5 : NaN);
    const prevMultiplier = clamp_(toFiniteNumber_(state.lastMultiplier, 1), T2_ADJUSTMENT_MIN_MULTIPLIER, T2_ADJUSTMENT_MAX_MULTIPLIER);
    const firstSeenDate = state.firstSeenDate || now;
    const trackedDays = Math.max(0, toFiniteNumber_(diffDays_(firstSeenDate, now), 0));
    const daysSinceChange = state.lastChangeDate ? toFiniteNumber_(diffDays_(state.lastChangeDate, now), NaN) : NaN;
    const inCooldown = isFinite(daysSinceChange) && daysSinceChange < T2_ADJUSTMENT_COOLDOWN_DAYS;
    let recommendedMultiplier = 1;
    let action = 'hold';
    let reason = 'Neutral zone';

    if (!sales) {
      if (trackedDays < T2_ADJUSTMENT_NO_SALES_GRACE_DAYS) {
        recommendedMultiplier = 1;
        reason = 'No sales history yet';
      } else if (availableNow > Math.max(baseTarget * 1.25, 3)) {
        recommendedMultiplier = 0.9;
        reason = 'No sales for grace period';
      } else {
        recommendedMultiplier = 1;
        reason = 'No sales signal, keep base';
      }
    } else if (confidence === 'warmup' || trackedDays < T2_ADJUSTMENT_WARMUP_DAYS) {
      if (sold7d > 0 && availableNow < Math.max(1, Math.ceil(baseTarget * 0.5))) {
        recommendedMultiplier = 1.1;
        reason = 'Warm-up demand with low stock';
      } else {
        recommendedMultiplier = 1;
        reason = 'Warm-up history, no penalty';
      }
    } else if (!isFinite(coverageDays)) {
      recommendedMultiplier = 1;
      reason = 'No stable demand signal';
    } else if (coverageDays < 7) {
      recommendedMultiplier = 1.25;
      reason = 'Critical stock coverage';
    } else if (coverageDays < 14) {
      recommendedMultiplier = 1.1;
      reason = 'Low stock coverage';
    } else if (coverageDays <= 35) {
      recommendedMultiplier = 1;
      reason = 'Healthy stock coverage';
    } else if (coverageDays <= 56) {
      recommendedMultiplier = 0.9;
      reason = 'Slow stock coverage';
    } else {
      recommendedMultiplier = 0.75;
      reason = 'Very slow stock coverage';
    }

    if (isFinite(trendRatio) && confidence !== 'warmup') {
      if (trendRatio >= 1.35 && recommendedMultiplier < 1.25) {
        recommendedMultiplier += 0.1;
        reason += ', rising trend';
      } else if (trendRatio <= 0.65 && isFinite(coverageDays) && coverageDays > 21 && recommendedMultiplier > 0.75) {
        recommendedMultiplier -= 0.1;
        reason += ', cooling trend';
      }
    }

    recommendedMultiplier = clamp_(recommendedMultiplier, T2_ADJUSTMENT_MIN_MULTIPLIER, T2_ADJUSTMENT_MAX_MULTIPLIER);
    let appliedMultiplier = prevMultiplier;
    if (inCooldown) {
      action = 'cooldown';
      reason += ', cooldown';
    } else if (Math.abs(recommendedMultiplier - prevMultiplier) < 0.05) {
      appliedMultiplier = recommendedMultiplier;
      action = 'hold';
    } else {
      const minStep = prevMultiplier * (1 - T2_ADJUSTMENT_MAX_STEP);
      const maxStep = prevMultiplier * (1 + T2_ADJUSTMENT_MAX_STEP);
      appliedMultiplier = clamp_(recommendedMultiplier, minStep, maxStep);
      action = appliedMultiplier > prevMultiplier ? 'boost' : 'penalty';
    }

    appliedMultiplier = clamp_(appliedMultiplier, T2_ADJUSTMENT_MIN_MULTIPLIER, T2_ADJUSTMENT_MAX_MULTIPLIER);
    const adjustedTarget = roundAdjustedTarget_(baseTarget, appliedMultiplier);
    const boostDelta = adjustedTarget - baseTarget;
    if (boostDelta === 0 && action !== 'cooldown') {
      action = 'hold';
    }

    return {
      baseTarget: baseTarget,
      listedNow: listedNow,
      inProgress: inProgress,
      sold7d: sold7d,
      sold30d: sold30d,
      sold90d: sold90d,
      avgDaily: roundMetric_(demandPerDay, 2),
      coverageDays: roundMetric_(coverageDays, 1),
      confidence: confidence,
      trend: roundMetric_(trendRatio, 2),
      recommendedMultiplier: roundMetric_(recommendedMultiplier, 4),
      appliedMultiplier: roundMetric_(appliedMultiplier, 4),
      boostDelta: boostDelta,
      adjustedTarget: adjustedTarget,
      action: action,
      reason: reason,
      state: {
        firstSeenDate: firstSeenDate,
        lastSeenDate: now,
        lastMultiplier: appliedMultiplier,
        lastRecommended: recommendedMultiplier,
        lastDirection: action,
        lastChangeDate: (action === 'boost' || action === 'penalty') ? now : state.lastChangeDate || '',
        note: reason
      }
    };
  };

  return {

    /*
    * Markets definition - from EVE API
    */
    marketJita : {
      "max_dockable_ship_volume": 50000000,
      "name": "Jita IV - Moon 4 - Caldari Navy Assembly Plant",
      "station_id": 60003760,
      "system_id": 30000142,
      "constellation_id": 20000020,
      "region_id": 10000002
    },
    marketPZMZV : {
      structure_id:1034323745897,
      "name": "P-ZMZV - BIG-MOM",
      "solar_system_id": 30003978
    },
    marketUALX : {
      structure_id:1046664001931,
      "name": "UALX-3 - Mothership Bellicose",
      "solar_system_id": 30004807
    },
    marketK7DII : {
      structure_id:1043661023026,
      "name": "K7D-II - Breadstar",
      "solar_system_id": 30003950
    },
    marketE3OIU : {
      structure_id:1040278453044,
      "name": "E3OI-U - Mothership Bellicose",
      "solar_system_id": 30004725
    },
    market1DQ1A : {
      structure_id:1030049082711,
      "name": "1DQ1-A - 1-st Innominate Palace",
      "solar_system_id": 30004759
    }   ,

    /* 
    * Calculates all types and amounts required to fit doctrines defined in the T2 Market sheet
    */
    calculateT2Market: function() {
      var targetTypes = [];   // array of target types
      var missingDoctrines = [];
      var invalidAmounts = [];

      // clear target types table
      const rowsToClear = Math.max(200, t2marketSheet.getMaxRows() - 2);
      t2marketSheet.getRange(3, typesCol, rowsToClear, 3).clearContent();
      t2marketSheet.getRange(3, buildCostCol, rowsToClear, 1).clearContent();

      // Load target doctrines from the market sheet
      var doctrines = t2marketSheet.getRange(3, doctrinesCol, 99, 2).getValues();
      
//      console.log (doctrines);
      var doctrineNames = t2marketSheet.getRange(3, doctrinesCol, 99, 1).getValues().flat().map(normalizeDoctrineName_);
//      console.log (doctrineNames);

      // check for duplicities
      let hasDuplicity = false;
//      console.log(t2marketSheet.getRange(3, doctrinesCol, 1, 1).getBackground())
      t2marketSheet.getRange(3, doctrinesCol, 99, 1).setBackground('#efefef');  
      t2marketSheet.getRange(3, doctrinesCol + 1, 99, 1).setBackground('#efefef');

      for (i = 0; i < 98; i++) {
        if (doctrineNames[i] != '') {
          console.log(doctrineNames[i]);
          let duplicity = doctrineNames.indexOf(doctrineNames[i], i + 1)
          console.log(duplicity);

          if (duplicity > 0) {
            // has duplicity, change both cells colour
            hasDuplicity = true;
            t2marketSheet.getRange(3 + i, doctrinesCol, 1, 1).setBackground('#ff0000');  
            t2marketSheet.getRange(3 + duplicity, doctrinesCol, 1, 1).setBackground('#ff0000');  
          }
        }
      }

      if (hasDuplicity) {
        throw ("Podbarvené doktrýny jsou duplicitní")
      }

      // go through Doctrines
      doctrines.forEach((doctrine, index) => {
        var doctrineName = normalizeDoctrineName_(doctrine[0]);
        var doctrineAmount = Number(doctrine[1]);
        var sheetRow = 3 + index;

        if (doctrineName != '') {
          console.log(doctrineName)
          var types = Doctrines.getDoctrine(doctrineName, { silent: true });
          console.log(types);

          if (!Array.isArray(types)) {
            missingDoctrines.push(sheetRow + ': ' + doctrineName);
            t2marketSheet.getRange(sheetRow, doctrinesCol, 1, 1).setBackground('#ff0000');
            return;
          }

          if (!isFinite(doctrineAmount) || doctrineAmount <= 0) {
            invalidAmounts.push(sheetRow + ': ' + doctrineName + ' (' + doctrine[1] + ')');
            t2marketSheet.getRange(sheetRow, doctrinesCol + 1, 1, 1).setBackground('#ff0000');
            return;
          }

          // merge types to target types
          types.forEach(type => {
//            console.log (type);
            var targetTypeIndex = targetTypes.findIndex(element => element[0] == type.type);
            if (targetTypeIndex >= 0) {
//              console.log (targetTypeIndex);
              targetTypes[targetTypeIndex][1] += type.amount * doctrineAmount;
            } else {
              targetTypes.push([type.type, type.amount * doctrineAmount, type.isBuy])
            }

          });

          console.log (targetTypes);
        }
      });

      if (missingDoctrines.length || invalidAmounts.length) {
        var problems = [];
        if (missingDoctrines.length) problems.push('Chybi doktryny: ' + missingDoctrines.join(' | '));
        if (invalidAmounts.length) problems.push('Neplatne pocty: ' + invalidAmounts.join(' | '));
        throw (problems.join('\n'));
      }

      targetTypes = targetTypes.map(type => [
        type[0],
        roundUpToHighestPlace_(type[1]),
        type[2]
      ]);
      let buildCostValues = targetTypes.map(() => ['']);
      try {
        const buildCostByName = getT2MarketBuildCostsByName_(targetTypes.map(type => type[0]));
        buildCostValues = targetTypes.map(type => {
          const cost = buildCostByName.get(type[0]);
          return [isFinite(cost) ? cost : ''];
        });
      } catch (e) {
        try {
          SpreadsheetApp.getActive().toast('T2 Market build cost error: ' + e, 'Market', 8);
        } catch (ee) {}
      }

      // store target types
      if (targetTypes.length) {
        t2marketSheet.getRange(3, typesCol, targetTypes.length, 3).setValues(targetTypes);
        t2marketSheet.getRange(3, buildCostCol, buildCostValues.length, 1).setValues(buildCostValues);
      }
    },

    /*
    * Fetches market orders of defined types in defined region and station
    * - typeIds, array od type IDs
    * - region, region ID
    * - locationId, (optional) public station ID
    */
    getPublicMarketOrders : function(types, regionId, locationId) {
      /* todo: 
        for each type 
          call /markets/{region_id}/orders/ with reionId and typeId
          filter on location if defined
          find best buy and sell order
          return price and amount
      */

    },

    /*
    * Fetches market orders of defined types in defined private structure
    * - typeIds, array od type IDs
    * - structureId, private structure ID
    */
    getPrivateMarketOrders : function(typeIds, structureId) {
      /* 
        call /markets/structures/{structure_id}/ for the structure
        for each type in types find the best sell order
        return the best prders
      */

      var ret = [];
      var orders = Eve.getStructureMarketOrders(structureId);
//      console.log(orders);

      typeIds.forEach(typeId => {
        // process only valid typeIds
        if (typeId && typeId != 0) {
          // prepare the item detail
          let item = {}
          item.type_id = typeId;

          // find sell orders for this type
          var sellOrdersTypeId = orders.data.filter(element => element.type_id == typeId && element.is_buy_order == false)
          if (sellOrdersTypeId.length > 0) {
            // sort by price ascending and find the best order
            sellOrdersTypeId.sort(function (a, b) { return a.price - b.price });
            item.topSell = sellOrdersTypeId[0];

            // calculate order volume
            item.volumeSell = 0
            sellOrdersTypeId.forEach(o => {item.volumeSell += o.volume_remain});
          }

          // find buy orders for this type and find the best order
          var buyOrdersTypeId = orders.data.filter(element => element.type_id == typeId && element.is_buy_order == true)
          if (buyOrdersTypeId.length > 0) {
            // sort by price descending
            buyOrdersTypeId.sort(function (a, b) { return b.price - a.price });
            item.topBuy = buyOrdersTypeId[0]

            // calculate order volume
            item.volumeBuy = 0
            buyOrdersTypeId.forEach(o => {item.volumeBuy += o.volume_remain});
          }

          ret.push(item)
        }
      })

      return ret;

    },

    /*
    * Updates market orders on a buffer sheet
    */
    updateBufferPrivateMarketOrders : function() {
      // check and validate the opened sheet name
      var sheet = SpreadsheetApp.getActive().getActiveSheet();
      let sheetName = sheet.getName();
      if (!(sheetName.startsWith("Buffer"))) {
        throw ("Makro lze spistit jen z sheetu buffer")
      }
      var lastRow = sheet.getLastRow();

      // read types from the sheet - will be a 2 dimensioanl array - many rows with one column
      var range = sheet.getRange(4, 12, lastRow - 1, 1).getValues();

      // flatten the array
      var typeIds = range.flat(1);
      console.log (typeIds);

      var markets = [
          {offset:0, structureId:this.marketUALX.structure_id},
//          {offset:3, structureId:this.marketE3OIU.structure_id},
//          {offset:6, structureId:this.marketK7DII.structure_id},
//          {offset:9, structureId:this.market1DQ1A.structure_id}
      ];

      // iterate through markets
      markets.forEach(market => {
        // fetch market orders at first private station
        var orders = this.getPrivateMarketOrders(typeIds, market.structureId);
  //      console.log (orders);

        // create the output array
        var out = []
        typeIds.forEach (typeId => {
          var order;
          
          // for valid typeId find the order
          if (typeId && typeId != 0) {
            order = orders.find (element => element.type_id == typeId)
            console.log(order);
          }

          if (order && order.topSell) { out.push([order.topSell.price, order.topSell.volume_remain])}
          else {out.push(['',''])}

        })

        console.log(out);

        // store result to the sheet
        var range = sheet.getRange(4, 16 + market.offset, lastRow - 1, 2).setValues(out);

      })
    },

    /*
    * Updates corporation market orders on the market sheet
    */
    updateMarketOrders: function() {
      // clear the sheet contents
      var lastRow = marketSheet.getLastRow();
      var range;
      if (lastRow > 1) {
        range = marketSheet.getRange(3, 7, lastRow, 8);
        range.setValue('');
      }

      // get all sell orders
      var orders = Corporation.getMarketOrders(2);

      // store orders to sheet
      var rows = orders.data.map(a => [
//        Market	Typ	Zbývá	Celkem	Cena	Datum	Hráč	Divize
        getCanonicalMarketLocationName_(a.locationId, a.locationName),
        a.typeName,
        a.volumeRemain,
        a.volumeTotal,
        a.price,
        a.issued,
        a.issuedBy,
        a.walletDivision
      ]);
      range = marketSheet.getRange(3, 7, rows.length, 8);
      range.setValues(rows);
    },

    /*
    * Updates Market Hub Stats
    */
    updateMarketHubStats : function() {
      // check and validate the opened sheet name
      var sheet = SpreadsheetApp.getActive().getActiveSheet();
      let sheetName = sheet.getName();
      if (!(sheetName.endsWith("Market"))) {
        throw ("Makro lze spistit jen z sheetu Market")
      }
      var lastRow = sheet.getLastRow();

      // Get the market strucuture Id - market name is in row 1 col 2
      let marketName = sheet.getRange(1, 2, 1, 1).getValue();
//      console.log(marketName)

      let marketId;
      if (marketName == this.marketE3OIU.name) marketId = this.marketE3OIU.structure_id;
      else if (marketName == this.market1DQ1A.name) marketId = this.market1DQ1A.structure_id;
      else if (marketName == this.marketK7DII.name) marketId = this.marketK7DII.structure_id;
      else if (marketName == this.marketPZMZV.name) marketId = this.marketPZMZV.structure_id;
      else if (marketName == this.marketUALX.name) marketId = this.marketUALX.structure_id;
      if (!marketId) {
        throw ("Market " + marketName + " nenalezen")
      }

      // read types from the sheet - will be a 2 dimensioanl array - many rows with one column
      var range = sheet.getRange(3, 6, lastRow - 1, 1).getValues();

      // flatten the array
      var typeIds = range.flat(1);
//      console.log (typeIds);

      // fetch market orders at first private station
      var orders = this.getPrivateMarketOrders(typeIds, marketId);
//      console.log (orders);

      // create the output array
      var out = []
      typeIds.forEach (typeId => {
        var order;
        
        // for valid typeId find the order
        if (typeId && typeId != 0) {
          order = orders.find (element => element.type_id == typeId)
          console.log(order);
        }

        if (order) {
          out.push([
            order.volumeSell?order.volumeSell:0,
            order.topSell?order.topSell.price?order.topSell.price:0:0,
            order.topSell?order.topSell.volume_remain?order.topSell.volume_remain:0:0,
            order.volumeBuy?order.volumeBuy:0,
            order.topBuy?order.topBuy.price?order.topBuy.price:0:0,
            order.topBuy?order.topBuy.volume_remain?order.topBuy.volume_remain:0:0,
            ])
        }
        else {out.push(['','','','','',''])}

      })

      console.log(out);

      // store result to the sheet
      var range = sheet.getRange(3, 8, lastRow - 1, 6).setValues(out);

    },

    /*
    * Updates item build availability - how much we can build from input hangar
    */
    updateItemBuildAvailability : function() {
      // check and validate the opened sheet name
      var sheet = SpreadsheetApp.getActive().getActiveSheet();
      let sheetName = sheet.getName();
      if (!(sheetName.endsWith("Market"))) {
        throw ("Makro lze spistit jen z sheetu Market")
      }
      if (sheetName === 'T2 Market') {
        throw ("Makro Item Build Availability nelze spustit nad T2 Market, protoze by prepsalo boost sloupce O:P a diagnostiku")
      }
      var lastRow = sheet.getLastRow();

      // Get the hangar Id - hangar name is in row 1 col 4
      let hangarName = sheet.getRange(1, 4, 1, 1).getValue();
//      console.log(hangarName);
      var hangarId = Corporation.getHangarByName('Manufactoring', hangarName);
//      console.log(hangarId);

      // load hangar content
      var hangarItems = Corporation.getAssetsCached([hangarId]);
//      console.log(hangarItems)

      // read types from the sheet - will be a 2 dimensioanl array
      var items = sheet.getRange(3, 1, lastRow - 1, 15).getValues();

      for (let i = 0; i < items.length; i++) {
        console.log(items[i][0])
        // process non empty lines
        if (items[i][0].length > 0) {
          console.log(items[i]);
          // check if we have right blueprint detail
          let blueprint;
          if ((items[i][5] == items[i][13]) && (items[i][14] != '')) {
            // we have right blueprint detail
            blueprint = JSON.parse(items[i][14]);
            console.log(blueprint);
          } else {
            // blueprint must be loaded from API
            let blueprintTypeId = Blueprints.getBlueprintId (items[i][0]);
//            console.log(blueprintTypeId);

            var req = {
              types: [{typeId: blueprintTypeId, amount: 10}],
              moduleT1ME: 10,
              moduleT2ME: 3,
              copyBPO: false
            }
            res = blueprintCalculate(req);
//            console.log(res);

            // fetch salvage only 
            blueprint = [];
            res.materials.forEach(m=> {
              material = Universe.getType(m.materialTypeID);
//              console.log(material);

              if (material.group_id == 754) {
                // material is in the salvage material group
                blueprint.push({
                  material : m.material,
                  materialTypeID : m.materialTypeID,
                  quantity : m.quantity
                })
              }
            })

            // store result
            sheet.getRange(3 + i, 14, 1, 2).setValues([[res.jobs[0].productTypeID,JSON.stringify(blueprint)]])
          }

          // calculate job availability
          let availability = 10000;
          let topMaterialNeeded = 'none';
          let materialList = '';
          blueprint.forEach(m => {
            // find item in hangar
            let hangarItem = hangarItems.data.filter(i => i.typeId == m.materialTypeID);
            console.log(hangarItem);

            // sum items quantities
            let quantity = 0;
            hangarItem.forEach(i => {quantity += i.quantity});
//            console.log("quantity in hangar: " + quantity);
//            console.log("quantity for 10 runs " + m.quantity)
            let materialAvailability = Math.floor(10 * quantity / m.quantity)
            materialList = materialList + m.material + ':' + materialAvailability + ' ';
//            console.log("materialAvailability: " + materialAvailability);
            if (availability > materialAvailability) {
              // material has lower stock than other material availability
              availability = materialAvailability;
              topMaterialNeeded = m.material;
            }
//            availability = availability > materialAvailability ? materialAvailability : availability;
//            console.log("availability: " + availability);
          })

          // store result
          sheet.getRange(3 + i, 16, 1, 3).setValues([[availability,topMaterialNeeded,materialList]]);
        }
      }
    },

    /*
    * Updates inustry velocity sheet
    */
    updateIndustryVelocity: function() {
      // clear the sheet contents
      var lastRow = industryVelocitySheet.getLastRow();
      var range;
      if (lastRow > 1) {
        range = industryVelocitySheet.getRange(2, 1, lastRow, 11);
        range.setValue('');
      }

      // get all sell orders
      var report = Aubi.getIndustryVelocity([6,7]);

      // store orders to sheet
      var rows = report.map(a => [
        a.typeName,
        a.w10,
        a.w9,
        a.w8,
        a.w7,
        a.w6,
        a.w5,
        a.w4,
        a.w3,
        a.w2,
        a.w1
      ]);
      range = industryVelocitySheet.getRange(2, 1, rows.length, 11);
      range.setValues(rows);
    },

    updateT2MarketAdjustments: function() {
      const now = new Date();
      const lastRow = t2marketSheet.getLastRow();
      const dataRows = Math.max(lastRow - 2, 0);
      const clearRows = Math.max(dataRows, 200);

      t2marketSheet.getRange(1, t2AdjustmentsCol, 1, t2AdjustmentHeaders.length).setValues([t2AdjustmentHeaders]);
      t2marketSheet.getRange(3, t2AdjustmentsCol, clearRows, t2AdjustmentHeaders.length).clearContent();
      if (!dataRows) return;

      const items = t2marketSheet.getRange(3, 1, dataRows, buildCostCol).getValues();
      const listedByType = getMarketListedByType_();
      const salesByType = getMapsByType_(Aubi.getSalesVelocity());
      const jobsByType = getMapsByType_(Aubi.getIndustryVelocity([6, 7]));
      const stateByType = loadT2AdjustmentState_();
      const rowsOut = [];

      items.forEach(row => {
        const typeName = normalizeDoctrineName_(row[0]);
        const baseTarget = Math.max(0, Math.ceil(toFiniteNumber_(row[1], 0)));
        if (!typeName || baseTarget <= 0) {
          rowsOut.push(new Array(t2AdjustmentHeaders.length).fill(''));
          return;
        }

        const state = stateByType.get(typeName) || {
          typeName: typeName,
          lastMultiplier: 1,
          firstSeenDate: now
        };
        const result = evaluateT2Adjustment_({
          now: now,
          state: state,
          sales: getRowByType_(salesByType, typeName),
          jobs: getRowByType_(jobsByType, typeName),
          listedNow: listedByType.get(typeName) || 0,
          baseTarget: baseTarget
        });

        stateByType.set(typeName, {
          typeName: typeName,
          lastMultiplier: result.state.lastMultiplier,
          lastChangeDate: result.state.lastChangeDate,
          lastDirection: result.state.lastDirection,
          firstSeenDate: result.state.firstSeenDate,
          lastSeenDate: result.state.lastSeenDate,
          lastRecommended: result.state.lastRecommended,
          note: result.state.note
        });

        rowsOut.push([
          typeName,
          result.boostDelta,
          result.baseTarget,
          result.adjustedTarget,
          result.listedNow,
          result.inProgress,
          result.sold7d,
          result.sold30d,
          result.sold90d,
          result.avgDaily,
          result.coverageDays,
          result.confidence,
          result.trend,
          result.appliedMultiplier,
          result.adjustedTarget,
          result.action,
          result.reason
        ]);
      });

      if (rowsOut.length) {
        t2marketSheet.getRange(3, t2AdjustmentsCol, rowsOut.length, t2AdjustmentHeaders.length).setValues(rowsOut);
      }
      persistT2AdjustmentState_(stateByType);
    },

   /*
    * Gets rigs in doctrines
    */
    updateRigsInDoctrines : function() {
      let rigs = [];

      // iterate through doctrines (column 2 + i*3)
      let maxCol = doctrineSheet.getLastColumn();
      let col = 2
      maxcol=30;
      while (col < maxCol) {
        let items = doctrineSheet.getRange(3, col, 30, 2).getValues();
//        console.log (items);

        // check if item is a rig
        items.forEach(i => {
          if (i[0] != '') {
            let type = Universe.searchType(i[0]);
//            console.log(type)

            // check rig
            if (type.group.startsWith('Rig ')) {
//              console.log(type)

              let rig = rigs.find(a => a.name == type.type_name);
              if (rig) {
                rig.amount += i[1];
              } else {
                rigs.push({
                  name: type.type_name,
                  amount: i[1]})
              }
            }
          }
        })

        col += 3;
      }

      console.log(rigs)

      // update rigs usage in doctrines count
      let lastRow = rigMarketSheet.getLastRow();
      let rows = rigMarketSheet.getRange(3, 1, lastRow - 3, 1).getValues();

      for (i = 0; i < rows.length; i++) {
        if (rows[i] != '') {
          console.log(rows[i])
          let rig = rigs.find(a => a.name == rows[i]);
          if (rig) {
            rigMarketSheet.getRange(3 + i, 2, 1, 1).setValue(rig.amount * 10);
          }
        }
      }

    },
  }
})()


function runCalculateT2Market() {
  Market.calculateT2Market();
  Market.updateT2MarketAdjustments();
}

function runUpdateBufferPrivateMarketOrders() {
  Market.updateBufferPrivateMarketOrders();
}

function runUpdateMarketOrders() {
  Aubi.syncWalletTransactions({ silent: true });
  Aubi.syncIndustryJobs({ silent: true });
  Market.updateMarketOrders();
  Market.updateT2MarketAdjustments();
}

function testGetPublicMarketOrders() {
  Market.getPublicMarketOrders([16636], Market.marketJita.region_id, Market.marketJita.station_id);  // silicates at Jita
}

function runUpdateMarketHubStats() {
  Market.updateMarketHubStats();
}

function runUpdateItemBuildAvailability() {
  Market.updateItemBuildAvailability();
}

function testGetPrivateMarketOrders() {
  console.log(Market.getPrivateMarketOrders([16636,34,4246,4247,44444], Market.marketE3OIU.structure_id));  // silicates at K7D
}

function runUpdateRigsInDoctrines () {
  Market.updateRigsInDoctrines();
}

function runUpdateIndustryVelocity() {
  Market.updateIndustryVelocity();
}

function runUpdateT2MarketAdjustments() {
  Market.updateT2MarketAdjustments();
}
