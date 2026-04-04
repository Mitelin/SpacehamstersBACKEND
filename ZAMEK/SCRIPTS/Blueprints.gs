const Blueprints = (()=>{
  const maxJobs = 437     // maximalni pocet jobu (radek)
  const firstDataRow = 14 // prvni radka obsahujici data
  const colJobs = 12      // sloupec obsahujici mnozstvi vyrobku ve vyrobe
  const colRunCost = 23   // sloupec s cenou za beh jobu
  const colInput = 25     // prvni sloupec tabulky vstupnich materialu
  const colProduct = colInput + 31    // prvni slupec tabulky mezivyrobku
  const colManuf = colProduct + 7     // prvni sloupec tabulky vyrobniho hangaru
  const colReact = colManuf + 3       // prvni sloupec tabulky reakcniho hangaru
  const colManufBuffer = colReact + 3     // prvni sloupec tabulky vyrobniho bufferu
  const colReactBuffer = colManufBuffer + 3 // prvni sloupec tabulky reakcniho bufferu
  const colBPC = colReactBuffer + 3       // prvni sloupec tabulky BPC hangaru
  const colResearch = colBPC + 4       // prvni sloupec tabulky research hangaru
  const colResearchBuffer = colResearch + 3       // prvni sloupec tabulky research bufferu
  const colJobsList = colResearchBuffer + 3 // prvni sloupec tabulky bezicich jobu
  const colLog = 18    // prvni slupec tabulky mezivyrobku
  const colLock = 11   // zloupec zamku produkce
  const rowLock = 8    // radka zamku

  const _TRACE = PropertiesService.getScriptProperties().getProperty('DEBUG_TRACE') === '1';
  const trace = (...args) => {
    if (!_TRACE) return;
    // eslint-disable-next-line no-console
    console.log(...args);
  };

  const normalizeIndustryKeyPart = function(value) {
    if (value == null) return '';
    return String(value)
      .replace(/[\s\u00A0]+/g, ' ')
      .trim()
      .toLowerCase();
  };

  const isBlueprintLikeName = function(value) {
    const normalized = normalizeIndustryKeyPart(value);
    return normalized.endsWith(' blueprint')
      || normalized.endsWith(' reaction formula')
      || normalized.endsWith(' formula');
  };

  const buildBlueprintNameAliases = function(value) {
    const normalized = normalizeIndustryKeyPart(value);
    if (!normalized) return [];

    const aliases = [];
    const seen = new Set();
    const push = function(alias) {
      const v = normalizeIndustryKeyPart(alias);
      if (!v || seen.has(v)) return;
      seen.add(v);
      aliases.push(v);
    };

    push(normalized);

    if (normalized.endsWith(' blueprint')) {
      const base = normalized.slice(0, -' blueprint'.length).trim();
      push(base);
    } else if (normalized.endsWith(' reaction formula')) {
      const base = normalized.slice(0, -' reaction formula'.length).trim();
      push(base);
      push(base + ' formula');
    } else if (normalized.endsWith(' formula')) {
      const base = normalized.slice(0, -' formula'.length).trim();
      push(base);
      push(base + ' reaction formula');
    } else {
      push(normalized + ' blueprint');
      push(normalized + ' reaction formula');
      push(normalized + ' formula');
    }

    return aliases;
  };

  const buildProductBlueprintActionKeys = function(productName, blueprintName, actionName) {
    const productKey = normalizeIndustryKeyPart(productName);
    const actionKey = normalizeIndustryKeyPart(actionName);
    if (!productKey || !actionKey) return [];

    return buildBlueprintNameAliases(blueprintName).map(blueprintKey => (
      productKey + '\u0000' + blueprintKey + '\u0000' + actionKey
    ));
  };

  const buildBlueprintActionKeys = function(blueprintName, actionName) {
    const actionKey = normalizeIndustryKeyPart(actionName);
    if (!actionKey) return [];

    return buildBlueprintNameAliases(blueprintName).map(blueprintKey => (
      blueprintKey + '|' + actionKey
    ));
  };

  const buildProductActionKey = function(productName, actionName) {
    const productKey = normalizeIndustryKeyPart(productName);
    const actionKey = normalizeIndustryKeyPart(actionName);
    if (!productKey || !actionKey) return '';
    return productKey + '|' + actionKey;
  };

  const addQuantityRowsToMap = function(map, rows) {
    if (!map || !rows || rows.length === 0) return map;

    rows.forEach(row => {
      const key = normalizeIndustryKeyPart(row[0]);
      const quantity = Number(row[1]) || 0;
      if (!key || quantity === 0) return;
      map.set(key, (map.get(key) || 0) + quantity);
    });

    return map;
  };

  const addQuantityRowsToProductActionMap = function(map, rows) {
    if (!map || !rows || rows.length === 0) return map;

    rows.forEach(row => {
      const key = buildProductActionKey(row[0], row[2]);
      const quantity = Number(row[1]) || 0;
      if (!key || quantity === 0) return;
      map.set(key, (map.get(key) || 0) + quantity);
    });

    return map;
  };

  const getQuantityFromMap = function(map, name) {
    if (!map) return 0;
    const key = normalizeIndustryKeyPart(name);
    if (!key) return 0;
    return Number(map.get(key)) || 0;
  };

  const getQuantityFromProductActionMap = function(map, name, action) {
    if (!map) return 0;
    const key = buildProductActionKey(name, action);
    if (!key) return 0;
    return Number(map.get(key)) || 0;
  };

  const resolvePreferredProductRow = function(rowsByProductKey, rows, productName) {
    const key = normalizeIndustryKeyPart(productName);
    if (!key || !rowsByProductKey) return -1;

    const indices = rowsByProductKey.get(key) || [];
    if (indices.length === 0) return -1;
    if (indices.length === 1) return indices[0];

    const preferredActions = isBlueprintLikeName(productName)
      ? ['Copying']
      : ['Manufacturing', 'Reaction'];

    for (let i = 0; i < preferredActions.length; i++) {
      const preferredAction = preferredActions[i];
      const preferredIndex = indices.find(index => rows[index] && rows[index][3] === preferredAction);
      if (preferredIndex != null) return preferredIndex;
    }

    if (!isBlueprintLikeName(productName)) {
      const nonInventionIndex = indices.find(index => rows[index] && rows[index][3] !== 'Invention');
      if (nonInventionIndex != null) return nonInventionIndex;
    }

    return indices[0];
  };

  const parseJsonResponseSafe_ = function(response, sourceLabel, options) {
    if (typeof parseJsonResponse_ === 'function') {
      return parseJsonResponse_(response, sourceLabel, options);
    }

    options = options || {};

    const code = response && response.getResponseCode ? response.getResponseCode() : '';
    const rawText = response && response.getContentText ? response.getContentText() : '';
    const text = rawText ? rawText.replace(/^\uFEFF/, '').trim() : '';

    if (!text) {
      if (options.silent) {
        Logger.log('>>> ' + sourceLabel + ': empty response' + (code ? ' (' + code + ')' : ''));
        return null;
      }
      throw new Error(sourceLabel + ': empty response' + (code ? ' (' + code + ')' : ''));
    }

    try {
      return JSON.parse(text);
    } catch (e) {
      const preview = text.slice(0, 160).replace(/\s+/g, ' ');
      const message = sourceLabel + ': invalid JSON response' + (code ? ' (' + code + ')' : '') + ': ' + preview;
      if (options.silent) {
        Logger.log('>>> ' + message);
        return null;
      }
      throw new Error(message);
    }
  };

  const buildProjectHangarContext = function(manufacturingHangar, reactionHangar, researchHangar, capitalHangar, useBufferHangars) {
    const hangars = [];
    const manufacturingHangars = [];
    const researchBufferHangars = [];

    const pushHangar = function(target, hangar) {
      if (!hangar) return;
      target.push(hangar);
      hangars.push(hangar);
    };

    pushHangar(manufacturingHangars, Corporation.getHangarByName('Manufactoring', manufacturingHangar));
    pushHangar(manufacturingHangars, Corporation.getHangarByName('Capital', capitalHangar));

    const reactionHangarObj = Corporation.getHangarByName('Reaction', reactionHangar);
    if (reactionHangarObj) hangars.push(reactionHangarObj);

    const researchHangarObj = Corporation.getHangarByName('Research', researchHangar);
    if (researchHangarObj) hangars.push(researchHangarObj);

    let manufacturingBufferHangar = null;
    let reactionBufferHangar = null;
    if (useBufferHangars) {
      manufacturingBufferHangar = Corporation.getHangarByName('Manufactoring', 'Produkty - Prebytky');
      if (manufacturingBufferHangar) hangars.push(manufacturingBufferHangar);

      reactionBufferHangar = Corporation.getHangarByName('Reaction', 'Produkty - Prebytky');
      if (reactionBufferHangar) hangars.push(reactionBufferHangar);

      const researchBufferNames = ['Invention - Prebytky', 'Invention - Prebytky 2', 'Invention - Prebytky 3'];
      researchBufferNames.forEach(name => {
        const hangar = Corporation.getHangarByName('Research', name);
        if (!hangar) return;
        researchBufferHangars.push(hangar);
        hangars.push(hangar);
      });
    }

    return {
      hangars: hangars,
      bucketHangars: {
        1: manufacturingBufferHangar ? [manufacturingBufferHangar] : [],
        2: manufacturingHangars,
        3: reactionBufferHangar ? [reactionBufferHangar] : [],
        4: reactionHangarObj ? [reactionHangarObj] : [],
        5: researchHangarObj ? [researchHangarObj] : [],
        6: researchBufferHangars,
      }
    };
  };

  const toIntOrDefault = function(value, fallback) {
    if (value === '' || value == null) return fallback;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? fallback : parsed;
  };

  const toRequiredPositiveInt = function(value) {
    if (typeof value === 'number') {
      if (!isFinite(value) || value <= 0 || Math.floor(value) !== value) return null;
      return value;
    }

    const text = String(value == null ? '' : value).trim();
    if (!text || !/^\d+$/.test(text)) return null;

    const parsed = parseInt(text, 10);
    return parsed > 0 ? parsed : null;
  };

  /* 
  * Overi, jestli je povolene z aktivniho sheetu spoustet blueprint funkce
  */
  var validateActiveSheet = function(sheet) {
    let sheetName = sheet.getName();
    if (!(sheetName.startsWith("Industry") || sheetName.startsWith("Projekt"))) {
      throw ("Makro lze spustit jen z industry kalkulačky, nebo projektového sheetu")
    }
  }

  /* 
  * Zjisti ID typu blueprintu
  */
  var getBlueprintId = function (name) {
    // pokud je name číslo, vrať ho jako ID
    if (!isNaN(name)) {
      return parseInt(name);
    }

    // pokud name nekonci na Blueprint, tak dopln toto slovo
    if (!name.includes(" Blueprint")) {
      name = name + " Blueprint"
    }

    let type = Universe.searchType(name);
    return type.type_id;
  }

  /*
   * Nacti fit z DOKTRYNY DATASHEET
   */
  var getDoctrine = function (name) {
    // nacti doktryny
    var lastCol = doctrineSheet.getLastColumn();
    if (lastCol <= 1) {
      SpreadsheetApp.getUi().alert('Chyba!', 'prázdný sheet doktrýn', SpreadsheetApp.getUi().ButtonSet.OK);
      return null;
    }
    var doctrines = doctrineSheet.getRange(2, 1, 39, lastCol).getValues();

    // najdi doktrynu s danym nazvem
    var col = 0;
    while (col < lastCol) {
      trace(doctrines[0][col]);
      if (doctrines[0][col] == name) break;
      col ++;
    }

    if (col >= lastCol - 1) {
      SpreadsheetApp.getUi().alert('Chyba!', 'Doktrýna nenalezena', SpreadsheetApp.getUi().ButtonSet.OK);
      return null;
    }

    // nacti seznam typu a mnozstvi pro doktrynu
    let types = [];

    for (let row = 1; row < 39; row++) {
      let item = doctrines[row][col];
      item = item.trim();
      trace(item);
      if (item) {
        const amount = toRequiredPositiveInt(doctrines[row][col + 1]);
        if (amount == null) {
          SpreadsheetApp.getUi().alert(
            'Chyba!',
            'Nezadal jsi platný počet kusů pro blueprint ' + item + ' v doktríně ' + name + '.',
            SpreadsheetApp.getUi().ButtonSet.OK
          );
          return null;
        }

        // zsjisti a zapis ID blueptintu
        var blueprintTypeId = getBlueprintId (item);
        if (!blueprintTypeId) {
          SpreadsheetApp.getUi().alert('Chyba!', 'Blueprint ' + item + ' nenalezen', SpreadsheetApp.getUi().ButtonSet.OK);
          return null;
        }

        types.push({"typeId": blueprintTypeId, "amount": amount})
      }
    }

    return types;    
  }

  /*
   * Vypocita prirusek do hangaru z jobu dodanych po datu nacteni hangaru
   * in:
   * - plannedJobs, planovane joby blueprintu z prislusneho industry sheetu
   * - deliveredJobs, pole jobu, dokoncenych po datu nacteni hangaru
   * - (nepovinny) hangarId, ID ciloveho hangaru
   * out:
   * - pole obsahujici dva sloupce:
   *   - nazev produktu
   *   - vyrobene mnozstvi
   */
  var getFinishedJobProducts = function (plannedJobs, deliveredJobs, hangarId, includeAction) {
    var ret = [];
    if (!plannedJobs || plannedJobs.length === 0 || !deliveredJobs || deliveredJobs.length === 0) return ret;

    // Build (and cache) planned job index once per plannedJobs array.
    // Keyed by normalized productName + blueprintName + activityName.
    if (!plannedJobs.__indexByProductBlueprintAction) {
      const index = {};
      const byProductAction = {};
      for (let i = 0; i < plannedJobs.length; i++) {
        const row = plannedJobs[i];
        const keys = buildProductBlueprintActionKeys(row[0], row[1], row[3]);
        keys.forEach(key => {
          if (index[key] == null) index[key] = i;
        });
        const productActionKey = buildProductActionKey(row[0], row[3]);
        if (productActionKey && byProductAction[productActionKey] == null) byProductAction[productActionKey] = i;
      }
      plannedJobs.__indexByProductBlueprintAction = index;
      plannedJobs.__indexByProductAction = byProductAction;
    }

    // filter delivered jobs for output location in selected hangar
    let filteredJobs;
    if (hangarId) {
      // Build (and cache) delivered jobs by outputLocationId once per deliveredJobs array.
      if (!deliveredJobs.__byOutputLocationId) {
        const byOutput = {};
        for (let i = 0; i < deliveredJobs.length; i++) {
          const job = deliveredJobs[i];
          const out = job.outputLocationId;
          if (out == null) continue;
          if (!byOutput[out]) byOutput[out] = [];
          byOutput[out].push(job);
        }
        deliveredJobs.__byOutputLocationId = byOutput;
      }
      filteredJobs = deliveredJobs.__byOutputLocationId[hangarId] || [];
    } else {
      filteredJobs = deliveredJobs;
    }
    // console.log(filteredJobs);

    filteredJobs.forEach(job => {
//     console.log(job);

      // find blueprint info
        const keys = buildProductBlueprintActionKeys(job.productName, job.blueprintName, job.activityName);
        var plannedJob = null;
        for (let i = 0; i < keys.length; i++) {
          plannedJob = plannedJobs.__indexByProductBlueprintAction[keys[i]];
          if (plannedJob != null) break;
        }
        if (plannedJob == null && plannedJobs.__indexByProductAction) {
          const productActionKey = buildProductActionKey(job.productName, job.activityName);
          if (productActionKey) plannedJob = plannedJobs.__indexByProductAction[productActionKey];
        }
  //    console.log(plannedJob);
        if (plannedJob != null) {
          let batchSize = plannedJobs[plannedJob][8];
          let runs = job.successfulRuns;
          
          // apply Symmetry Decryptor bonus for invention
          if (job.activityName == 'Invention') batchSize += 2;

          // calculate copied BPC runs instead of number of BPCs
          if (job.activityName == 'Copying') {
            runs *= job.licensedRuns;
          }

          trace("Finished " + job.activityName + " " + runs + " runs of " + job.productName + " from " + job.blueprintName + " in batch of " + batchSize + " items");
          if (includeAction) {
            ret.push([job.productName, runs * batchSize, job.activityName])
          } else {
            ret.push([job.productName, runs * batchSize])
          }
      }
    })
    return ret;
  }

  /*
   * Vypocita odber z hangaru z jobu spustenych po datu nacteni hangaru
   * in:
   * - plannedJobs, planovane joby blueprintu z prislusneho industry sheetu
   * - newJobs, pole jobu, spustenych po datu nacteni hangaru
   * - blueprints, pole korporatnich blueprintu
   * out:
   * - pole obsahujici dva sloupce:
   *   - nazev produktu
   *   - odebrane mnozstvi
   *   - ID hangaru
   *   - priznak advanced vyroby
   */
  var getMaterialsForNewJobs = function (plannedJobs, newJobs, blueprints) {
    var ret = [];
    if (!plannedJobs || plannedJobs.length === 0 || !newJobs || newJobs.length === 0) return ret;

    // Cache planned jobs index (shared with getFinishedJobProducts).
    if (!plannedJobs.__indexByProductBlueprintAction) {
      const index = {};
      const byProductAction = {};
      for (let i = 0; i < plannedJobs.length; i++) {
        const row = plannedJobs[i];
        const keys = buildProductBlueprintActionKeys(row[0], row[1], row[3]);
        keys.forEach(key => {
          if (index[key] == null) index[key] = i;
        });
        const productActionKey = buildProductActionKey(row[0], row[3]);
        if (productActionKey && byProductAction[productActionKey] == null) byProductAction[productActionKey] = i;
      }
      plannedJobs.__indexByProductBlueprintAction = index;
      plannedJobs.__indexByProductAction = byProductAction;
    }

    // Cache blueprint ME by itemId.
    if (blueprints && !blueprints.__meByItemId) {
      const meById = {};
      for (let i = 0; i < blueprints.length; i++) {
        const bp = blueprints[i];
        if (bp && bp.itemId != null && meById[bp.itemId] == null) {
          meById[bp.itemId] = bp.materialEfficiency;
        }
      }
      blueprints.__meByItemId = meById;
    }

    newJobs.forEach(job => {
  //   console.log(job);
      // find blueprint info
      const keys = buildProductBlueprintActionKeys(job.productName, job.blueprintName, job.activityName);
      var plannedJob = null;
      for (let i = 0; i < keys.length; i++) {
        plannedJob = plannedJobs.__indexByProductBlueprintAction[keys[i]];
        if (plannedJob != null) break;
      }
      if (plannedJob == null && plannedJobs.__indexByProductAction) {
        const productActionKey = buildProductActionKey(job.productName, job.activityName);
        if (productActionKey) plannedJob = plannedJobs.__indexByProductAction[productActionKey];
      }
  //    console.log(plannedJob);
      if (plannedJob != null) {
          let materials = plannedJobs[plannedJob][7];
          let isAdvanced = plannedJobs[plannedJob][9];
          let roleBonus = 1;
          let rigBonus = 1;
          let bpME = 0

          // adjust bonuses according to the activity
          if (job.activityName == 'Manufacturing') {
            roleBonus = 0.99;
            rigBonus = 0.958;

            // find the blueprint to read its ME
            if (blueprints && blueprints.__meByItemId && blueprints.__meByItemId[job.blueprintId] != null) {
              bpME = blueprints.__meByItemId[job.blueprintId];
            }

          } else if (job.activityName == 'Reaction') {
            rigBonus = 0.974;
          }

          trace("Started " + job.activityName + " " + job.runs + " runs of " + job.productName + " from " + job.blueprintName + " id " + job.blueprintId + " ME " + bpME + " material " + materials + " advanced " + isAdvanced);

          materialsJSON = JSON.parse(materials);
          materialsJSON.forEach(material => {
  //          console.log("base quantity " + material.base_quantity + " roleBonus " + roleBonus + " rigBonus " + rigBonus + " bpME " + bpME)
            if (material.base_quantity) {
              let amount = Math.ceil(material.base_quantity * job.runs * roleBonus * rigBonus * (1.0 - bpME / 100.0));
              trace("loc: " + job.outputLocationId + " material " + material.type + " amount " + amount)

              let pos = ret.findIndex(i => i[0] == material.type && i[2] == job.outputLocationId && i[3] == isAdvanced && i[4] == job.activityName);
              if (pos > 0) {
                trace('updating at pos ' + pos)
                ret[pos][1] -= amount;
              } else {
                trace('inserting ...')
                ret.push([material.type, amount * (-1), job.outputLocationId, isAdvanced, job.activityName])
              }
            }
          })
      }
    })

    return ret;
  }

  return {
    test: function() {
      return getDoctrine('[GTC TFI]');
    },
    getBlueprintId: function(name) {
      return getBlueprintId(name);
    },

    /* 
    * Zavola custom API na spočítání výroby blueprintů
    */
    calculateBlueprints: function() {
      // Nacti aktivni sheet a over, ze z nej lze makro spustit
      var sheet = SpreadsheetApp.getActive().getActiveSheet();
      validateActiveSheet(sheet);
      var lastRow = sheet.getLastRow();
      var range;

      // smaz obsah sheetu od prvni datove radky 
      if (lastRow >= firstDataRow) {
        range = sheet.getRange(firstDataRow, 1, lastRow - firstDataRow + 1, 13);
        range.setValue("");
        range = sheet.getRange(firstDataRow, colInput, lastRow - firstDataRow + 1, 9);
        range.setValue("");
        range = sheet.getRange(firstDataRow, colProduct, lastRow - firstDataRow + 1, 4);
        range.setValue("");
      }

      // zjisti ze sheetu parametry blueprintu
      range = sheet.getRange(1, 2, 11, 1);
      var params = range.getValues();
      var useBufferHangars = (params[3][0] == 'Ne')?false:true;

      // zjisti ze sheetu vyrabene blueprinty a jejich ID
      range = sheet.getRange(2, 4, 10, 2);
      var blueprints = range.getValues();
      let types = [];

      for (let bpr = 0; bpr < 10; bpr++) {
        var item = blueprints[bpr][0]
        if (item) {
          const amount = toRequiredPositiveInt(blueprints[bpr][1]);
          if (amount == null) {
            SpreadsheetApp.getUi().alert(
              'Chyba!',
              'Nezadal jsi platný počet kusů pro blueprint ' + item + ' na řádku ' + (bpr + 2) + '.',
              SpreadsheetApp.getUi().ButtonSet.OK
            );
            return;
          }

          // pokud nazev itemu zacina na [, jedna se o nazev doktryny - nacti celou doktrynu
          if (item.startsWith('[')) {
            // nacti polozky z doktryny
            var docItems = getDoctrine(item);
            if (!docItems) return;

            // pridej jednotlive polozky do seznamu
            docItems.forEach(docItem => {
              types.push({"typeId": docItem.typeId, "amount": docItem.amount * amount})
            });

          } else {
            // zjisti a zapis ID blueptintu
            var blueprintTypeId = getBlueprintId (blueprints[bpr][0]);
            if (!blueprintTypeId) {
              SpreadsheetApp.getUi().alert('Chyba!', 'Blueprint nenalezen', SpreadsheetApp.getUi().ButtonSet.OK);
              return;
            }

            types.push({"typeId": blueprintTypeId, "amount": amount})
          }
        }
      }

      // priprav JSON objekt requestu
      var req = {}
      req.types = types;
      req.shipT1ME = toIntOrDefault(params[5][0], 0);
      req.shipT1TE = 10;
      req.shipT2ME = toIntOrDefault(params[6][0], 0);
      req.shipT2TE = 0;
      req.moduleT1ME = 10;
      req.moduleT1TE = 10;
      req.moduleT2ME = toIntOrDefault(params[7][0], 0);
      req.moduleT2TE = 0;
      req.produceFuelBlocks=(params[8][0] == 'Ne')?false:true;
      req.buildT1=(params[9][0] == 'Ne')?false:true;
      req.copyBPO=(params[10][0] == 'Ne')?false:true;

      // zavolej API kalkulace
      var options = {
        'method' : 'post',
        'contentType': 'application/json',
        'payload' : JSON.stringify(req),
        'muteHttpExceptions': true
      };
      var response = UrlFetchApp.fetch(aubiApi + '/blueprints/calculate', options);

      // parsuj odpoved do pole struktur
      var data = parseJsonResponseSafe_(response, 'Blueprint calculate types=' + req.types.length);
    //  console.log(data);

      // zapis runy jobu podle levelu sestupne
      data.jobs.sort(function (a, b) {
        return b.level - a.level;
      });
    //  console.log(data.jobs);

      // zapisuj joby z resultu
      row = firstDataRow;
      data.jobs.forEach(job => {
        range = sheet.getRange(row, 1, 1, 11);
        range.setValues([ [job.product, job.blueprint, job.level, job.type, job.runs, job.runs * job.time, job.runs * job.quantity, JSON.stringify(job.materials), job.quantity, job.isAdvanced, "čeká"] ]);

        // posun se na dalsi radku
        row++
      })
      
      // zapis material podle levelu sestupne
      data.materials.sort(function (a, b) {
        return b.level - a.level;
      });

      // zapisuj vstupni material z resultu
      row = firstDataRow;
      data.materials.forEach(material => {
        // zapisuj jen vstupni material
        if (material.isInput) {
          var quantityResearch = 0;
          action = '?'
          if (material.activityId == 1) action = 'Manufacturing';
          else if (material.activityId == 8) {
            action = 'Invention';
            quantityResearch = material.quantity;
          }
          else if (material.activityId == 11) action = 'Reaction';
          else if (material.activityId == 5) {
            action = 'Copying';
            quantityResearch = material.quantity;
          }

          range = sheet.getRange(row, colInput, 1, 9);
    //      range.setValues([ [material.material, material.level, action, material.quantity, "", material.materialTypeID] ]);
          range.setValues([ 
            [ material.material, 
              material.level, 
              action, 
              material.quantity,
              useBufferHangars ? material.quantityBasicManufacture : 0, 
              useBufferHangars ? material.quantityAdvancedManufacture : material.quantityAdvancedManufacture + material.quantityBasicManufacture, 
              useBufferHangars ? material.quantityBasicReaction : 0, 
              useBufferHangars ? material.quantityAdvancedReaction : material.quantityAdvancedReaction + material.quantityBasicReaction,
              quantityResearch
            ] ]);

          // posun se na dalsi radku
          row++
        }
      })

      // zapisuj mezivyrobek z resultu
      row = firstDataRow;
      data.materials.forEach(material => {
        // zapisuj jen vstupni material
        if (!material.isInput) {
          action = '?'
          if (material.activityId == 1) action = 'Manufacturing';
          else if (material.activityId == 8) action = 'Invention';
          else if (material.activityId == 11) action = 'Reaction';
          else if (material.activityId == 5) action = 'Copying';

          range = sheet.getRange(row, colProduct, 1, 4);
    //      range.setValues([ [material.material, material.level, action, material.quantity, "", material.materialTypeID] ]);
          range.setValues([ [material.material, material.level, action, material.quantity] ]);

          // posun se na dalsi radku
          row++
        }
      })
    },
  
    /*
    * Recalculates to-do jobs
    */
    recalculateProject: function(sheet, notify = true) {
      const _time = (label, fn) => (typeof Perf !== 'undefined' && Perf.time) ? Perf.time(label, fn) : fn();

      if (!sheet) {
        // zjisti otevreny sheet, ze ktereho je skript spusteny
        sheet = SpreadsheetApp.getActive().getActiveSheet();
        validateActiveSheet(sheet);
      }
      const _sheetName = sheet.getName();
      var lastRow = sheet.getLastRow();

      // open sidebar
//      Sidebar.open();
//      Sidebar.add("Mažu stav skladů a jobů");

      _time(_sheetName + ' recalc clear columns', () => {
        // clear running jobs column
        range = sheet.getRange(firstDataRow, colJobs, maxJobs, 1);
        range.setValue("");

        // required values must be reset before reading tables,
        // otherwise the next recalculation compounds the previous run.
        range = sheet.getRange(firstDataRow, colJobs + 1, maxJobs, 1);
        range.setValue(0);

        range = sheet.getRange(firstDataRow, colInput + 9, maxJobs, 6);
        range.setValue(0);

        // clear job run costs and note
        range = sheet.getRange(firstDataRow, colRunCost, maxJobs, 2);
        range.setValue("");
      });


      // initiate arrays
      var plannedJobs;
      var inputMaterials;
      let plannedCount = 0;
      let inputCount = 0;
      _time(_sheetName + ' recalc read tables', () => {
        // Avoid reading maxJobs rows just to find the used size.
        // We assume the key columns are contiguous until the first blank.
        const countContiguousRows = (startRow, col, maxRows) => {
          const firstVal = sheet.getRange(startRow, col, 1, 1).getValue();
          if (!firstVal) return 0;
          const lastDataRow = sheet.getRange(startRow, col, 1, 1)
            .getNextDataCell(SpreadsheetApp.Direction.DOWN)
            .getRow();
          const count = lastDataRow - startRow + 1;
          return Math.min(maxRows, Math.max(0, count));
        };

        plannedCount = countContiguousRows(firstDataRow, 1, maxJobs);
        inputCount = countContiguousRows(firstDataRow, colInput, maxJobs);

        plannedJobs = plannedCount > 0
          ? sheet.getRange(firstDataRow, 1, plannedCount, 22).getValues()
          : [];
        inputMaterials = inputCount > 0
          ? sheet.getRange(firstDataRow, colInput, inputCount, 21).getValues()
          : [];
      });

      // Build lookup maps to avoid repeated O(n) findIndex/find
      const plannedRowsByProductKey = new Map();
      const plannedIndexByBlueprintAction = new Map();
      const plannedIndexByProductAction = new Map();
      for (let r = 0; r < plannedCount; r++) {
        const productName = plannedJobs[r][0];
        const productKey = normalizeIndustryKeyPart(productName);
        if (productKey) {
          if (!plannedRowsByProductKey.has(productKey)) {
            plannedRowsByProductKey.set(productKey, []);
          }
          plannedRowsByProductKey.get(productKey).push(r);
        }
        const productActionKey = buildProductActionKey(plannedJobs[r][0], plannedJobs[r][3]);
        if (productActionKey && !plannedIndexByProductAction.has(productActionKey)) {
          plannedIndexByProductAction.set(productActionKey, r);
        }

        const blueprintName = plannedJobs[r][1];
        const actionName = plannedJobs[r][3];
        if (blueprintName && actionName) {
          const keys = buildBlueprintActionKeys(blueprintName, actionName);
          keys.forEach(key => {
            if (!plannedIndexByBlueprintAction.has(key)) {
              plannedIndexByBlueprintAction.set(key, r);
            }
          });
        }
      }
      const inputIndexByName = new Map();
      for (let r = 0; r < inputCount; r++) {
        const materialName = inputMaterials[r][0];
        if (materialName && !inputIndexByName.has(materialName)) {
          inputIndexByName.set(materialName, r);
        }
      }

      // Parse materials JSON once per planned job row
      const safeParseMaterials = (value) => {
        if (value === null || typeof value === 'undefined' || value === '') return null;
        try { return JSON.parse(value); } catch (e) { return null; }
      };
      const materialsByRow = new Array(plannedCount);
      for (let r = 0; r < plannedCount; r++) {
        materialsByRow[r] = safeParseMaterials(plannedJobs[r][7]);
      }
//      var manufactureMaterials = sheet.getRange(firstDataRow, colManuf, maxJobs, 2).getValues();
//      var reactionMaterials = sheet.getRange(firstDataRow, colReact, maxJobs, 2).getValues();
//      var interimMaterials = sheet.getRange(firstDataRow, colManufBuffer, maxJobs, 2).getValues();                      // asi rozsirit na dalsi hangar

      // read cost indices
      var costIndices;
      _time(_sheetName + ' recalc read params', () => {
        var range = sheet.getRange(3, 9, 8, 1);
        costIndices = range.getValues();
      });
      let manufacturingSystemCost = costIndices[0][0];
      let manufacturingBonus = costIndices[1][0];
      let reactionSystemCost = costIndices[2][0];
      let reactionBonus = costIndices[3][0];
      let copySystemCost = costIndices[4][0];
      let copyBonus = costIndices[5][0];
      let inventionSystemCost = costIndices[6][0];
      let inventionBonus = costIndices[7][0];

      // zjisti ze sheetu parametry blueprintu
      var params;
      _time(_sheetName + ' recalc read blueprint params', () => {
        range = sheet.getRange(1, 2, 11, 1);
        params = range.getValues();
      });
      var useBufferHangars = (params[3][0] == 'Ne')?false:true;
      const hangarContext = buildProjectHangarContext(
        params[1][0],
        params[2][0],
        params[4][0],
        params[10][0],
        useBufferHangars
      );

      // load prices
      _time(_sheetName + ' recalc load prices', () => priceList.init());

      /* 
      * Update quantities in running jobs
      */
      var jobs;
      _time(_sheetName + ' recalc read running jobs', () => {
        const rowsToRead = Math.min(maxJobs, Math.max(0, lastRow - firstDataRow + 1));
        if (rowsToRead > 0) {
          var range = sheet.getRange(firstDataRow, colJobsList, rowsToRead, 6);
          jobs = range.getValues();
        } else {
          jobs = [];
        }
      });
      
      _time(_sheetName + ' recalc apply running jobs', () => {
        jobs.forEach(job => {
          if (job[3]) {
            // find corresponding row in planned jobs
            const keys = buildBlueprintActionKeys(job[3], job[2]);
            let plannedJob = -1;
            for (let i = 0; i < keys.length; i++) {
              if (plannedIndexByBlueprintAction.has(keys[i])) {
                plannedJob = plannedIndexByBlueprintAction.get(keys[i]);
                break;
              }
            }
            if (plannedJob < 0) {
              const productActionKey = buildProductActionKey(job[5], job[2]);
              if (productActionKey && plannedIndexByProductAction.has(productActionKey)) {
                plannedJob = plannedIndexByProductAction.get(productActionKey);
              }
            }
            if (plannedJob >= 0) {
              // found!
              if (job[2] == "Copying") {
                // for copying activity count total BPC runs being produced: copies (runs) * licensedRuns
                plannedJobs[plannedJob][11] = (Number(job[1]) * Number(job[4])) + Number(plannedJobs[plannedJob][11]);
              } else if (job[2] == "Invention") {
                // for invention activity calculate number of output items ... apply Symetry Decryptor runs + 2 ... 
                // TODO: apply probability
                plannedJobs[plannedJob][11] = job[1] * (plannedJobs[plannedJob][8] + 2) + Number(plannedJobs[plannedJob][11]);
              } else {
                // for other activities calculate number of output items
                plannedJobs[plannedJob][11] = job[1] * plannedJobs[plannedJob][8] + Number(plannedJobs[plannedJob][11]);
              }
            }
          }
        })
      });

      const inProgressValues = plannedCount > 0
        ? plannedJobs.slice(0, plannedCount).map(r => [Number(r[11]) || 0])
        : [];

      /*
       * Calculate how much material is needed for each job
       */
      let i = plannedCount - 1;

      if (i == -1) {
        throw ("Není spočítaná výroba")
      }

      // process jobs from the final product
      _time(_sheetName + ' recalc compute requirements', () => {
      do {
        let product = plannedJobs[i][0];
        let action = plannedJobs[i][3];
        let total = plannedJobs[i][6];
        let materials = materialsByRow[i];
        let batchSize = plannedJobs[i][8];
        let isAdvanced = plannedJobs[i][9];
        let inprogress = plannedJobs[i][11];
        let ready = plannedJobs[i][13];

        /* if action is invention, increase required amount by running manufacturing jobs of the BPC */
        /* shouldnt be needed anymore as running blueprints are ignored from available BPC runs
        if (action == "Invention") {
          console.log("Invention, looking for manufacture jobs")
          let pos = plannedJobs.findIndex(element => element[1] == product);
          if (pos >= 0) {
            // increase required by manufacturing jobs required
            console.log("- job found, running " + plannedJobs[pos][11] + " required " + plannedJobs[pos][12] + " ready " + plannedJobs[pos][13]);
//            plannedJobs[i][12] += Number(plannedJobs[pos][11]);
// ko            let addInvention = Math.max(Number(plannedJobs[pos][12]) - Number(plannedJobs[pos][11]) - Number(plannedJobs[pos][13]), 0);
// ko           plannedJobs[i][12] += addInvention;
          }

        }
        */
        let required = plannedJobs[i][12];

        trace(">>> Product [" + i + "]: " + product + " action " + action + " Total: " + total + " batchSize: " + batchSize + " required: " + required + " inprogress: " + inprogress + " ready: " + ready);

        if (materials) {
          // job has input materials
          if (plannedJobs[i][2] == 1) {
            // final product at level 1 has required always empty, use total instead
            required = total;
            plannedJobs[i][12] = total
          }

          // how much needs to be done
          let todo = required - inprogress - ready;
//          let log = "Todo " + todo;

          // recalculate required to match batch size
          todo = Math.ceil(todo/batchSize) * batchSize;
//          console.log (">>> Todo: " + todo)
//          log = log + " -> " + todo + " total " + total;

          // if jobs needs to be run, increase required material amount
          if (todo > 0) {
            // find every material in job queue or input hangar
            materials.forEach(material => {
              trace("::: Material: " + material.type + " quantity: " + material.quantity);

              let pos = resolvePreferredProductRow(plannedRowsByProductKey, plannedJobs, material.type);
              if (pos >= 0) {
                // if job is found, increase job output amount
                // recalculate required amount by batchsize
                if (plannedJobs[pos][3] == "Copying") {
                  // BPO Copy activity, calculate needed BPC runs as todo / BPC batch size
                  plannedJobs[pos][12] += Math.ceil(todo / plannedJobs[pos][8]);
                  
                } else if (plannedJobs[pos][3] == "Invention") {
                  // BPC Invention activity, calculate needed items and deduct running T2 BPCs from available BPCs
                  trace("Invention [" + pos + "] " + plannedJobs[pos][0] + " in progress " + plannedJobs[pos][11] + " on stock " + plannedJobs[pos][13]);
                  trace("- manuf in progress " + inprogress + " ready " + ready + " required " + required);
                  trace("- material.quantity " + material.quantity + " todo " + todo + " total " + total);
                  plannedJobs[pos][12] += Math.ceil(material.quantity * todo / total);

                } else {
                  // other activity, calculate needed items
                  plannedJobs[pos][12] += Math.ceil(material.quantity * todo / total);
                }
//                  log = log + "\n" + material.type + " volume " + Math.ceil(material.quantity * todo / total)
              } else {
                // job not found, look in input materials
                let pos = inputIndexByName.has(material.type) ? inputIndexByName.get(material.type) : -1;
                if (pos >= 0) {
                  // if input material is found, increase required amount
                  let q = Math.ceil(material.quantity * todo / total);
                  inputMaterials[pos][9] += q;    // total quantity 

                  if (action == "Manufacturing") {
                    if (useBufferHangars && !isAdvanced) inputMaterials[pos][10] += q;     // use buffers and basic manufactoring
                    else inputMaterials[pos][11] += q;                                    // advanced manufactoring or no buffers used
                  }

                  if (action == "Reaction") {
                    if (useBufferHangars && !isAdvanced) inputMaterials[pos][12] += q;     // use buffers and basic reaction
                    else inputMaterials[pos][13] += q;                                    // advanced reaction or no buffers used
                  }

                  if (action == "Invention" ||action == "Copying") {
                    inputMaterials[pos][14] += q;                                       // research buffer
                  }

//                  log = log + "\n" + material.type + " volume " + Math.ceil(material.quantity * todo / total)
//                  log = log + " MQ " + material.quantity ;
                }            
              }
            });
          };

//          sheet.getRange(firstDataRow + i, colRunCost + 1, 1, 1).setValue(log);

        } else {
          // no input materials (invention/copying), required = total
          plannedJobs[i][12] = total
        }

        i--;
      } while (i >= 0);

      });

      const statusValues = Array.from({ length: plannedCount }, () => ['']);
      const requiredValues = Array.from({ length: plannedCount }, () => [0]);
      const runCostValues = Array.from({ length: plannedCount }, () => [0]);
      const runCostNoteValues = Array.from({ length: plannedCount }, () => ['']);

      for (let row = 0; row < plannedCount; row++) {
        requiredValues[row][0] = plannedJobs[row][12];
      }

      _time(_sheetName + ' recalc write requirements', () => {
        range = sheet.getRange(firstDataRow, colJobs + 1, maxJobs, 1);
        range.setValue(0);
        range = sheet.getRange(firstDataRow, colInput + 9, maxJobs, 6);
        range.setValue(0);

        if (plannedCount > 0) {
          sheet.getRange(firstDataRow, colJobs, plannedCount, 1).setValues(inProgressValues);
          sheet.getRange(firstDataRow, colJobs + 1, plannedCount, 1).setValues(requiredValues);
        }

        if (inputCount > 0) {
          const inputRequiredValues = inputMaterials.slice(0, inputCount).map(r => [r[9], r[10], r[11], r[12], r[13], r[14]]);
          sheet.getRange(firstDataRow, colInput + 9, inputCount, 6).setValues(inputRequiredValues);
        }

        SpreadsheetApp.flush();
      });

      const refreshedPlannedJobs = plannedCount > 0
        ? sheet.getRange(firstDataRow, 1, plannedCount, 22).getValues()
        : [];
      const refreshedInputMaterials = inputCount > 0
        ? sheet.getRange(firstDataRow, colInput, inputCount, 21).getValues()
        : [];

      // update the planned job status and run cost
      i = 0;
      let bpos;
      let allJobs;
      let allRunningJobs;
      let deliveredReadyByProduct;
      let deliveredReadyByBucket;
      let availableBlueprintRunsByName;
      _time(_sheetName + ' recalc load corp context', () => {
        bpos = Corporation.loadBPOs();                // load BPOs from cache
        const assetSnapshot = Corporation.getAssetsCached(hangarContext.hangars);
        const blueprintSnapshot = Corporation.getBlueprintsCached(hangarContext.hangars);
        allJobs = Corporation.getJobsCached(hangarContext.hangars, true);
        allRunningJobs = allJobs.data.filter(item => item.status == 'active');   // filter only running jobs

        const deliveredJobs = allJobs.data.filter(item => (
          item.status == 'delivered' && item.completedTime > assetSnapshot.lastModified
        ));

        deliveredReadyByProduct = addQuantityRowsToProductActionMap(
          new Map(),
          getFinishedJobProducts(plannedJobs, deliveredJobs, null, true)
        );
        deliveredReadyByBucket = new Map();
        Object.keys(hangarContext.bucketHangars).forEach(bucketKey => {
          const bucketHangars = hangarContext.bucketHangars[bucketKey] || [];
          const projectedRows = [];
          bucketHangars.forEach(hangar => {
            const rows = getFinishedJobProducts(plannedJobs, deliveredJobs, hangar.locationID, true);
            rows.forEach(row => projectedRows.push(row));
          });
          deliveredReadyByBucket.set(Number(bucketKey), addQuantityRowsToProductActionMap(new Map(), projectedRows));
        });

        const blueprintCopies = blueprintSnapshot.data
          .filter(item => Number(item.runs) >= 0)
          .map(item => ({ itemId: item.itemId, typeName: item.typeName, runs: Number(item.runs) || 0 }));
        const bpcJobRunsByBlueprintId = {};
        for (let j = 0; j < allJobs.data.length; j++) {
          const job = allJobs.data[j];
          const blueprintId = job.blueprintId;
          if (blueprintId == null) continue;
          if (bpcJobRunsByBlueprintId[blueprintId] != null) continue;
          if (job.status === 'active' || job.completedTime > blueprintSnapshot.lastModified) {
            bpcJobRunsByBlueprintId[blueprintId] = Number(job.runs) || 0;
          }
        }

        availableBlueprintRunsByName = new Map();
        blueprintCopies.forEach(bpc => {
          const runsInUse = bpcJobRunsByBlueprintId[bpc.itemId];
          const availableRuns = bpc.runs - (runsInUse != null ? runsInUse : 0);
          if (availableRuns > 0) {
            addQuantityRowsToMap(availableBlueprintRunsByName, [[bpc.typeName, availableRuns]]);
          }
        });

        const deliveredResearchJobs = allJobs.data.filter(item => (
          (item.activityName == 'Copying' || item.activityName == 'Invention')
          && item.status == 'delivered'
          && item.completedTime > blueprintSnapshot.lastModified
        ));
        addQuantityRowsToMap(
          availableBlueprintRunsByName,
          getFinishedJobProducts(plannedJobs, deliveredResearchJobs)
        );
      });
      trace(allRunningJobs);

      _time(_sheetName + ' recalc compute status & cost', () => {
      for (let row = 0; row < plannedCount; row++) {
        const refreshedJob = refreshedPlannedJobs[row] || plannedJobs[row];
        let product = refreshedJob[0];
        let blueprint = refreshedJob[1];
        let action = refreshedJob[3];
        let runs = refreshedJob[4];
        let materials = materialsByRow[row];
        let isAdvanced = refreshedJob[9];
        let inprogress = Number(refreshedJob[11]) || 0;
        let required = Number(refreshedJob[12]) || 0;
        let ready = Number(refreshedJob[13]) || 0;
        const deliveredReadyFallback = getQuantityFromProductActionMap(deliveredReadyByProduct, product, action);
        const effectiveReady = (ready < required && deliveredReadyFallback > 0)
          ? Math.min(required, ready + deliveredReadyFallback)
          : ready;

        // update job status
        if (effectiveReady >= required) {
          statusValues[row][0] = 'Hotovo';
        } else if (effectiveReady + inprogress >= required) {
          statusValues[row][0] = 'Běží';
        } else {
          // find if all required inputs are in right hangar
          let canStart = true;

          // identify the job input hangar
          let sourceHangar = 0      // hangar where the material must be located
          let sourceHangarAlt = 0  // alternative source hangar for the material
          if (action == "Manufacturing") {
            if (useBufferHangars && !isAdvanced) {
              sourceHangar = 1;     // use buffers and basic manufactoring
              sourceHangarAlt = 2;  // as an alternative, the blueprints and other materials can be also in the advanced industry hangar
            }
            else sourceHangar = 2;                                     // advanced manufactoring or no buffers used
          }

          if (action == "Reaction") {
            if (useBufferHangars && !isAdvanced) sourceHangar = 3      // use buffers and basic reaction
            else sourceHangar = 4;                                     // advanced reaction or no buffers used
          }

          if (action == "Copying") {
            if (useBufferHangars && !isAdvanced) sourceHangar = 5      // use buffers and basic reaction
            else sourceHangar = 6;                                     // advanced reaction or no buffers used
          }

          if (action == "Invention") {
            if (useBufferHangars && !isAdvanced) sourceHangar = 6      // use buffers and basic reaction
            else sourceHangar = 6;                                     // advanced reaction or no buffers used
          }

          let log = "Hangár č." + sourceHangar + " chybí:";

          if (materials) {
            materials.forEach(material => {
              let materialVolume = 0;
              const blueprintLikeMaterial = isBlueprintLikeName(material.type);

              // find amount in input materials
              let materialRecord = (inputIndexByName.has(material.type) ? refreshedInputMaterials[inputIndexByName.get(material.type)] : null);
              if (blueprintLikeMaterial) {
                materialVolume += getQuantityFromMap(availableBlueprintRunsByName, material.type);
              } else if (materialRecord) {
                materialVolume += materialRecord[15 + sourceHangar];
              }

              // find amount in job output
              let jobRecordIndex = resolvePreferredProductRow(plannedRowsByProductKey, refreshedPlannedJobs, material.type);
              let jobRecord = (jobRecordIndex >= 0) ? refreshedPlannedJobs[jobRecordIndex] : null;
              const materialAction = jobRecord ? jobRecord[3] : '';
              if (jobRecord && !blueprintLikeMaterial) {
                materialVolume += jobRecord[14 + sourceHangar];
                if (sourceHangarAlt) materialVolume += jobRecord[14 + sourceHangarAlt];
              }

              // material quantity for one run must be less than material available in hangar to start job
              let missingVolume = (material.quantity / runs) - materialVolume;
              if (missingVolume > 0 && !blueprintLikeMaterial) {
                let projectedDelivered = getQuantityFromProductActionMap(deliveredReadyByBucket.get(sourceHangar), material.type, materialAction);
                if (sourceHangarAlt) projectedDelivered += getQuantityFromProductActionMap(deliveredReadyByBucket.get(sourceHangarAlt), material.type, materialAction);
                if (projectedDelivered > 0) missingVolume -= projectedDelivered;
              }

              if (missingVolume > 0) {
                log = log + "\n" + material.type + " " + missingVolume
                canStart = false;
              }
            })
          }

          // BPO must be available for copy job
          if (action == "Copying" && canStart) {
            // find BPO
            let jobBPOs = bpos.filter(item => item.blueprint == blueprint);
            trace(jobBPOs);

            // find running job for every BPO
            let jobBPOsRunning = jobBPOs.map(a => ({
              itemId : a.blueprintId,
              job: allRunningJobs.find(item => item.blueprintId == a.blueprintId)
            }));
            trace(jobBPOsRunning)

            let jobFreeBPOs = jobBPOsRunning.filter(item => item.job == null);
            trace(jobFreeBPOs);

            if (jobFreeBPOs.length == 0) {
              canStart = false;
              log = log + "\n- Není volné BPO!";
            }

          }

          if (canStart) {
            statusValues[row][0] = 'Připraveno';
          } else {
            statusValues[row][0] = 'Čeká';
            runCostNoteValues[row][0] = log;
          }
        }

        // Update job run cost
        let runcost = 0;

        if (action == 'Manufacturing') {
          if (!materials) throw ("Výroba " + product + "nemá definovaný materiál");

          materials.forEach(material => {
            if (!material.type.endsWith("Blueprint")) {
              let price = priceList.getPrice(material.type);
              if (!price) throw ("Nenalezena cena za materiál: " + material.type);
              runcost = runcost + material.base_quantity * runs * price.eveAdjusted;
            }
          })

          runcost = runcost * manufacturingSystemCost;
          runcost = runcost + runcost * manufacturingBonus;

        } else if (action == 'Reaction') {
          if (!materials) throw ("Reakce " + product + "nemá definovaný materiál");

          materials.forEach(material => {
            let price = priceList.getPrice(material.type);
            if (!price) throw ("Nenalezena cena za materiál: " + material.type);
            runcost = runcost + material.base_quantity * runs * price.eveAdjusted;
          })

          runcost = runcost * reactionSystemCost;
          runcost = runcost + runcost * reactionBonus;

        } else if (action == 'Invention') {
          let finalProduct = product.substring(0, product.length - 10);
          let price = priceList.getPrice(finalProduct);
          if (!price) throw ("Nenalezena cena za materiál: " + finalProduct);
          runcost = runs * price.eveAdjusted * 0.02;

          runcost = runcost * inventionSystemCost;
          runcost = runcost + runcost * inventionBonus;
        }

        runCostValues[row][0] = runcost;
      }

      });

      _time(_sheetName + ' recalc write outputs', () => {
        if (plannedCount > 0) {
          sheet.getRange(firstDataRow, 11, plannedCount, 1).setValues(statusValues);
          sheet.getRange(firstDataRow, colRunCost, plannedCount, 1).setValues(runCostValues);
          sheet.getRange(firstDataRow, colRunCost + 1, plannedCount, 1).setValues(runCostNoteValues);
        }
      });


      // show result in notification window
      if (notify) {
        SpreadsheetApp.getUi().alert('Aktualizace dokončena.', '', SpreadsheetApp.getUi().ButtonSet.OK);
      }
    },

    /* 
    * Zkopiruje industry sheet na sheet projektu 
    */
    copyIndustrySheet: function () {
      // zjisti ze sheetu nazev projektu
      range = industrySheet.getRange(1, 2, 1, 1);
      var project = range.getValue();

      // zduplikuj sheet
      var spreadsheet = SpreadsheetApp.getActive()
      projectSheet = industrySheet.copyTo(spreadsheet);
      projectSheet.setName("Projekt " + project);
      projectSheet.activate();

      // smaz tlacitka
      var drawings = projectSheet.getDrawings();
      drawings.forEach(drawing => {
        let action = drawing.getOnAction();
        if (action == 'runCopyIndustrySheet') drawing.remove();
      })
    },

    /*
    * Updates hangar assets and running jobs
    */
    updateProject: function(sheet, notify = true) {
      const _time = (label, fn) => (typeof Perf !== 'undefined' && Perf.time) ? Perf.time(label, fn) : fn();

      if (!sheet) {
        // zjisti otevreny sheet, ze ktereho je skript spusteny
        sheet = SpreadsheetApp.getActive().getActiveSheet();
        validateActiveSheet(sheet);
      }
      const _sheetName = sheet.getName();

      var lastRow = sheet.getLastRow();

      Sidebar.open(sheet.getName());
      // zjisti, jestli neni sheet zamceny
      let lockVal = sheet.getRange(rowLock, colLock).getValue();
      if (lockVal) {
        // sheet je zamceny, preskakuj
        Sidebar.add("Zamčeno kvůli stěhování, neaktualizuju!");
        return;
      }

      Sidebar.add("Mažu stav skladů a jobů");

      // zjisti ze sheetu parametry blueprintu
      range = sheet.getRange(2, 2, 11, 1);
      var data = range.getValues();
      var hangarManufactoring = data[0][0];
      var hangarReaction = data[1][0];
      var useBufferHangar = (data[2][0]== 'Ne')?false:true;
      var hangarResearch = data[3][0];
      var hangarCapital = data[10][0];
      
      // zjisti ze sheetu osobni hangary
      var personalData = sheet.getRange(1, 13, 7, 1).getValues();
      var personalHangarManufactoring
      var personalHangarReaction
      var personalHangarManufactoringBuffer
      var personalHangars = [];
      var itemsPersonal
      var jobsPersonal
      var maxAge = 0;
      
      // Zjisti hangary, pouze pokud je prihlaseny vlastnik hangaru
      if (personalData[0][0] == Personal.getName()) {
        personalHangarManufactoring = personalData[1][0]
        if (!isNaN(personalHangarManufactoring)) personalHangars.push(personalHangarManufactoring)
        personalHangarReaction = personalData[3][0]
        if (!isNaN(personalHangarReaction)) personalHangars.push(personalHangarReaction)
        personalHangarManufactoringBuffer = personalData[5][0]
        if (!isNaN(personalHangarManufactoringBuffer)) personalHangars.push(personalHangarManufactoringBuffer)
        
        Sidebar.add("Čtu osobní sklad");
        itemsPersonal = _time(_sheetName + ' personal assets', () => Personal.getAssets(personalHangars));
        Sidebar.add("- počet " + itemsPersonal.data.length + " ks");
        Sidebar.add("- stáří " + (itemsPersonal.age / 60).toFixed(2) + " m");
        Sidebar.add("- refresh " + (itemsPersonal.cacheRefresh / 60).toFixed(2) + " m");
        if (itemsPersonal.age > maxAge) maxAge = itemsPersonal.age;
        sheet.getRange(5, colLog, 1, 1).setValue((itemsPersonal.age / 60).toFixed(2) + " m");
        sheet.getRange(5, colLog + 1, 1, 1).setValue((itemsPersonal.cacheRefresh / 60).toFixed(2) + " m");

        Sidebar.add("Čtu osobní joby");
        jobsPersonal = _time(_sheetName + ' personal jobs', () => Personal.getJobs(personalHangars));
        Sidebar.add("- počet " + jobsPersonal.data.length + " ks");
        Sidebar.add("- stáří " + (jobsPersonal.age / 60).toFixed(2) + " m");
        Sidebar.add("- refresh " + (jobsPersonal.cacheRefresh / 60).toFixed(2) + " m");
        if (jobsPersonal.age > maxAge) maxAge = jobsPersonal.age;
        sheet.getRange(6, colLog, 1, 1).setValue((jobsPersonal.age / 60).toFixed(2) + " m");
        sheet.getRange(6, colLog + 1, 1, 1).setValue((jobsPersonal.cacheRefresh / 60).toFixed(2) + " m");
      }

      // find the hangar identifications
      var hangars = [];
      var hangarsBPC = [];      // BPC runs only from research and manufactoring hangars - no interims

      // combine manufacturing and capital hangar together
      let hangarsTemp = [];
      hangarsTemp.push(Corporation.getHangarByName('Manufactoring', hangarManufactoring))
      hangarsTemp.push(Corporation.getHangarByName('Capital', hangarCapital))
      // drop null values
      var hangarM = hangarsTemp.filter(function (e) {return e; });
      hangars = hangars.concat(hangarM)
      hangarsBPC = hangarsBPC.concat(hangarM)

      var hangarR = Corporation.getHangarByName('Reaction', hangarReaction);
      if(hangarR) hangars.push(hangarR);
      var hangarRes = Corporation.getHangarByName('Research', hangarResearch);
      if(hangarRes) {
        hangars.push(hangarRes);
        hangarsBPC.push(hangarRes);
      }

      // add interim hangars with shared material buffer / production leftovovers
      if (useBufferHangar) {
        var hangarMB = Corporation.getHangarByName('Manufactoring', 'Produkty - Prebytky');
        if(hangarMB) hangars.push(hangarMB);
        var hangarRB = Corporation.getHangarByName('Reaction', 'Produkty - Prebytky');
        if(hangarRB) hangars.push(hangarRB);

 //       var hangarResB = Corporation.getHangarByName('Research', 'Invention - Prebytky');
        let hangarsTemp = [];
        hangarsTemp.push(Corporation.getHangarByName('Research', 'Invention - Prebytky'))
        hangarsTemp.push(Corporation.getHangarByName('Research', 'Invention - Prebytky 2'))
        hangarsTemp.push(Corporation.getHangarByName('Research', 'Invention - Prebytky 3'))
        // drop null values
        var hangarResB = hangarsTemp.filter(function (e) {return e; });
        hangars = hangars.concat(hangarResB)
      }
      trace(hangars)

      /* 
      * Update hangars 
      */

      _time(_sheetName + ' clear tables', () => {
        // clear sheet manufacturing hangar table contents
        range = sheet.getRange(firstDataRow, colManuf, lastRow - 10, 2);
        range.setValue('');

        // clear sheet reaction hangar table contents
        range = sheet.getRange(firstDataRow, colReact, lastRow - 10, 2);
        range.setValue('');

        // clear sheet manufactoring buffer hangar table contents
        range = sheet.getRange(firstDataRow, colManufBuffer, lastRow - 10, 2);
        range.setValue('');

        // clear sheet reaction buffer hangar table contents
        range = sheet.getRange(firstDataRow, colReactBuffer, lastRow - 10, 2);
        range.setValue('');

        // clear sheet reaction buffer hangar table contents
        range = sheet.getRange(firstDataRow, colBPC, lastRow - 10, 3);
        range.setValue('');

        // clear sheet research hangar table contents
        range = sheet.getRange(firstDataRow, colResearch, lastRow - 10, 2);
        range.setValue('');
        
        // clear sheet research buffer hangar table contents
        range = sheet.getRange(firstDataRow, colResearchBuffer, lastRow - 10, 2);
        range.setValue('');

        // clear sheet jobs table contents
        range = sheet.getRange(firstDataRow, colJobsList, lastRow - 10, 10);
        range.setValue('');
      });

      // get corporate hangars content
//      var items = getItemsDirect(hangars);
      Sidebar.add("Čtu korporátní sklad");
      var items = _time(_sheetName + ' corp assets', () => Corporation.getAssetsCached(hangars));
      Sidebar.add("- počet " + items.data.length + " ks");
      Sidebar.add("- stáří " + (items.age / 60).toFixed(2) + " m");
      Sidebar.add("- refresh " + (items.cacheRefresh / 60).toFixed(2) + " m");
      if (items.age > maxAge) maxAge = items.age;
      sheet.getRange(1, colLog, 1, 1).setValue(new Date());
      sheet.getRange(3, colLog, 1, 1).setValue((items.age / 60).toFixed(2) + " m");
      sheet.getRange(3, colLog + 1, 1, 1).setValue((items.cacheRefresh / 60).toFixed(2) + " m");

      Sidebar.add("Čtu korporátní joby");
      if (typeof Corporation !== 'undefined' && Corporation.syncJobs && (!Corporation.isMemoFrozen || !Corporation.isMemoFrozen())) {
        _time(_sheetName + ' sync jobs cache', () => Corporation.syncJobs());
      }
        var alljobs = _time(_sheetName + ' corp jobs (all)', () => Corporation.getJobsCached(hangars, true));
        var jobs = {
          age: alljobs.age,
          cacheRefresh: alljobs.cacheRefresh,
          lastModified: alljobs.lastModified,
          expires: alljobs.expires,
          data: alljobs.data.filter(job => job.status == 'active')
        };
      Sidebar.add("- počet " + jobs.data.length + " ks");
      Sidebar.add("- stáří " + (jobs.age / 60).toFixed(2) + " m");
      Sidebar.add("- refresh " + (jobs.cacheRefresh / 60).toFixed(2) + " m");
      if (jobs.age > maxAge) maxAge = jobs.age;
      Sidebar.add("<b>Nejstarší data " + (maxAge / 60).toFixed(2) + " m</b>");
      sheet.getRange(4, colLog, 1, 1).setValue((jobs.age / 60).toFixed(2) + " m");
      sheet.getRange(4, colLog + 1, 1, 1).setValue((jobs.cacheRefresh / 60).toFixed(2) + " m");

      // get corporation blueprints
      Sidebar.add("Čtu korporátní blueprinty");
      if (typeof Corporation !== 'undefined' && Corporation.syncBlueprints && (!Corporation.isMemoFrozen || !Corporation.isMemoFrozen())) {
        _time(_sheetName + ' sync blueprints cache', () => Corporation.syncBlueprints());
      }
      var bpcs = _time(_sheetName + ' corp blueprints', () => Corporation.getBlueprintsCached(hangarsBPC));
      Sidebar.add("- počet " + bpcs.data.length + " ks");
      Sidebar.add("- stáří " + (bpcs.age / 60).toFixed(2) + " m");
      Sidebar.add("- refresh " + (bpcs.cacheRefresh / 60).toFixed(2) + " m");
      if (bpcs.age > maxAge) maxAge = bpcs.age;


      // planned jobs, to get info of the blueprint
      // (Keep this read as small as possible; it was previously maxJobs×22.)
      var plannedJobs;
      _time(_sheetName + ' read planned jobs', () => {
        const firstVal = sheet.getRange(firstDataRow, 1, 1, 1).getValue();
        if (!firstVal) {
          plannedJobs = [];
          return;
        }
        const lastDataRow = sheet.getRange(firstDataRow, 1, 1, 1)
          .getNextDataCell(SpreadsheetApp.Direction.DOWN)
          .getRow();
        const plannedCount = Math.min(maxJobs, Math.max(0, lastDataRow - firstDataRow + 1));
        plannedJobs = plannedCount > 0
          ? sheet.getRange(firstDataRow, 1, plannedCount, 22).getValues()
          : [];
      });

      // Prepare job delta against the asset snapshot.
      // Use the all-jobs snapshot, not only currently active jobs, otherwise a job
      // that starts after assets were read and gets delivered before jobs are read
      // disappears from the correction logic until the next refresh.
      let newJobs = alljobs.data.filter(job => (
        job.startTime > items.lastModified &&
        (job.status == 'active' || job.status == 'delivered')
      ));
      let blueprintsAll = _time(_sheetName + ' all blueprints', () => Corporation.getBlueprintsCached());
      var newJobMaterials = _time(_sheetName + ' materials for new jobs', () => getMaterialsForNewJobs(plannedJobs, newJobs, blueprintsAll.data))
      trace(newJobMaterials);

      // prepare data for jobs delivered after hangars were updated
      // Delivered jobs must stop counting as running, but still need to project into stock until assets catch up.
      let deliveredJobs = alljobs.data.filter(job => job.status == 'delivered' && job.completedTime > items.lastModified);
      trace('deliveredJobs');
      trace(deliveredJobs);



      /* 
       * Manufacturing Hangar 
       */
      // filter items for corporation manufacturing hangar
      var corpItems = 0 // items in corporation hangar
      var persItems = 0 // items in personal hangar
      /*
      if (hangarM) {

        var itemsM = items.data.filter(item => {
          return (item.locationId == hangarM.locationID
              && (hangarM.locationType == "item"  // item in a box
              || (hangarM.locationType == "station" && item.locationFlag == hangarM.locationFlag))) // item in hangar root
        });
*/
      if (hangarM && (hangarM.length > 0)) {
        var itemsM = items.data.filter(item => {
          return (hangarM.some(hangar => (
            item.locationId == hangar.locationID 
            && (hangar.locationType == "item"  // item in a box
            || (hangar.locationType == "station" && item.locationFlag == hangar.locationFlag)) // item in hangar root
          ))) 
        });

        corpItems = itemsM.length

        // store items in hangar to sheet hangar table
        if (corpItems) {
          // store items in hangar to sheet hangar table
          var rows = itemsM.map(a => [a.typeName, a.quantity]);
          range = sheet.getRange(firstDataRow, colManuf, rows.length, 2);
          _time(_sheetName + ' write manuf hangar (corp)', () => range.setValues(rows));
        }
      }
      // filter items for personal manufacturing hangar
      if (personalHangarManufactoring) {
        var itemsM = itemsPersonal.data.filter(item => {return (item.location_id == personalHangarManufactoring)});
        persItems = itemsM.length

        // store items in hangar to sheet hangar table
        if (persItems) {
          // store items in hangar to sheet hangar table
          var rows = itemsM.map(a => [a.type_name, a.quantity]);
          range = sheet.getRange(firstDataRow + corpItems, colManuf, rows.length, 2);
          _time(_sheetName + ' write manuf hangar (personal)', () => range.setValues(rows));
        }
      }
      // add job products delivered after corporate items cache updated
//      let finishedItems = getFinishedJobProducts  (plannedJobs, deliveredJobs, hangarM.locationID);
      let finishedItems = []
      if (hangarM && (hangarM.length > 0)) {
        hangarM.forEach(hangar => finishedItems = finishedItems.concat(getFinishedJobProducts  (plannedJobs, deliveredJobs, hangar.locationID)))
      }

      if (finishedItems.length > 0) {
        trace(finishedItems);
        range = sheet.getRange(firstDataRow + corpItems + persItems + 1, colManuf, finishedItems.length, 2);
        _time(_sheetName + ' write manuf finished', () => range.setValues(finishedItems));
      }
      // deduct material usage from new jobs started after items cache updated
      let deductedItems;
      if (useBufferHangar) {
        // get only advanced production to the manufacturing hangar as only this production has source here
        deductedItems = newJobMaterials.filter(i => {
          return (hangarM.some(hangar => (
            i[2] == hangar.locationID && i[3] == true && i[4] == 'Manufacturing')))
          })
      } else {
        // get any production to the manufacturing hangar as it has source here
        deductedItems = newJobMaterials.filter(i => {
          return (hangarM.some(hangar => (
            i[2] == hangar.locationID && i[4] == 'Manufacturing')))
        })
      }
      if (deductedItems.length > 0) {
        trace(deductedItems);
        deductedItemsShort = deductedItems.map(i => ([i[0], i[1]]));
        trace(deductedItemsShort)
        range = sheet.getRange(firstDataRow + corpItems + persItems + finishedItems.length + 2, colManuf, deductedItems.length, 2);
        _time(_sheetName + ' write manuf deducted', () => range.setValues(deductedItemsShort));
      }


      /*
       * Reaction Hangar
       */
      // filter items for corporation reaction hangar
      corpItems = 0 // items in corporation hangar
      persItems = 0 // items in personal hangar
      if (hangarR) {
        var itemsR = items.data.filter(item => {
          return (item.locationId == hangarR.locationID
              && (hangarR.locationType == "item"  // item in a box
              || (hangarR.locationType == "station" && item.locationFlag == hangarR.locationFlag))) // item in hangar root
        });
        corpItems = itemsR.length

        // store items in hangar to sheet hangar table
        if (corpItems) {
          // store items in hangar to sheet hangar table
          var rows = itemsR.map(a => [a.typeName, a.quantity]);
          range = sheet.getRange(firstDataRow, colReact, rows.length, 2);
          _time(_sheetName + ' write react hangar (corp)', () => range.setValues(rows));
        }
      }
      // filter items for personal reaction hangar
      if (personalHangarReaction) {
        var itemsR = itemsPersonal.data.filter(item => {return (item.location_id == personalHangarReaction)});
        persItems = itemsR.length

        // store items in hangar to sheet hangar table
        if (persItems) {
          // store items in hangar to sheet hangar table
          var rows = itemsR.map(a => [a.type_name, a.quantity]);
          range = sheet.getRange(firstDataRow + corpItems, colReact, rows.length, 2);
          _time(_sheetName + ' write react hangar (personal)', () => range.setValues(rows));
        }
      }
      // add job products delivered after corporate items cache updated
      finishedItems = getFinishedJobProducts  (plannedJobs, deliveredJobs, hangarR.locationID);
      if (finishedItems.length > 0) {
        trace(finishedItems);
        range = sheet.getRange(firstDataRow + corpItems + persItems + 1, colReact, finishedItems.length, 2);
        _time(_sheetName + ' write react finished', () => range.setValues(finishedItems));
      }
      // deduct material usage from new jobs started after items cache updated
      if (useBufferHangar) {
        // get only advanced production to the manufacturing hangar as only this production has source here
        deductedItems = newJobMaterials.filter(i => i[2] == hangarR.locationID && i[3] == true && i[4] == 'Reaction')
      } else {
        // get any production to the manufacturing hangar as it has source here
        deductedItems = newJobMaterials.filter(i => i[2] == hangarR.locationID && i[4] == 'Reaction')
      }
      if (deductedItems.length > 0) {
        trace(deductedItems);
        deductedItemsShort = deductedItems.map(i => ([i[0], i[1]]));
        trace(deductedItemsShort)
        range = sheet.getRange(firstDataRow + corpItems + persItems + finishedItems.length + 2, colReact, deductedItems.length, 2);
        _time(_sheetName + ' write react deducted', () => range.setValues(deductedItemsShort));
      }


      /*
       * Manufacturing Buffer Hangar
       */
      // filter items for corporation manufacturing buffer hangars
      corpItems = 0 // items in corporation hangar
      persItems = 0 // items in personal hangar
      if (hangarMB) {
        var itemsI = items.data.filter(item => {
          return (item.locationId == hangarMB.locationID
              && (hangarMB.locationType == "item"  // item in a box
              || (hangarMB.locationType == "station" && item.locationFlag == hangarMB.locationFlag))) // item in hangar root
        });
        corpItems = itemsI.length

        // store items in hangar to sheet hangar table
        if (corpItems) {
          // store items in hangar to sheet hangar table
          var rows = itemsI.map(a => [a.typeName, a.quantity]);
          range = sheet.getRange(firstDataRow, colManufBuffer, rows.length, 2);
          _time(_sheetName + ' write manuf buffer (corp)', () => range.setValues(rows));
        }
      }
      // filter items for personal reaction hangar
      if (personalHangarManufactoringBuffer) {
        var itemsI = itemsPersonal.data.filter(item => {return (item.location_id == personalHangarManufactoringBuffer)});
        persItems = itemsI.length

        // store items in hangar to sheet hangar table
        if (persItems) {
          // store items in hangar to sheet hangar table
          var rows = itemsI.map(a => [a.type_name, a.quantity]);
          range = sheet.getRange(firstDataRow + corpItems, colManufBuffer, rows.length, 2);
          _time(_sheetName + ' write manuf buffer (personal)', () => range.setValues(rows));
        }
      }
      // add job products delivered after corporate items cache updated
      if (hangarMB) {
      finishedItems = getFinishedJobProducts  (plannedJobs, deliveredJobs, hangarMB.locationID);
        if (finishedItems.length > 0) {
          trace(finishedItems);
          range = sheet.getRange(firstDataRow + corpItems + persItems + 1, colManufBuffer, finishedItems.length, 2);
          _time(_sheetName + ' write manuf buffer finished', () => range.setValues(finishedItems));
        }
        // deduct material usage from new jobs started after items cache updated
        if (useBufferHangar) {
          // get only basic production to the manufacturing hangar as only this production has source in the buffer hangar
          deductedItems = newJobMaterials.filter(i => {
            return (hangarM.some(hangar => (
              i[2] == hangar.locationID && i[3] == false && i[4] == 'Manufacturing')))
          })
        } else {
          // no production should source from the manufacturing buffer hangar
          deductedItems = []
        }
        if (deductedItems.length > 0) {
          trace(deductedItems);
          deductedItemsShort = deductedItems.map(i => ([i[0], i[1]]));
          trace(deductedItemsShort)
          range = sheet.getRange(firstDataRow + corpItems + persItems + finishedItems.length + 2, colManufBuffer, deductedItems.length, 2);
          _time(_sheetName + ' write manuf buffer deducted', () => range.setValues(deductedItemsShort));
        }
      }


      /*
       * Reaction Buffer Hangar
       */
      // filter items for corporation reaction buffer hangars
      corpItems = 0 // items in corporation hangar
      persItems = 0 // items in personal hangar
      // interim reaction hangar
      if (hangarRB) {
        var itemsI = items.data.filter(item => {
          return (item.locationId == hangarRB.locationID
              && (hangarRB.locationType == "item"  // item in a box
              || (hangarRB.locationType == "station" && item.locationFlag == hangarRB.locationFlag))) // item in hangar root
        });
        corpItems = itemsI.length

        // store items in hangar to sheet hangar table
        if (corpItems) {
          // store items in hangar to sheet hangar table
          var rows = itemsI.map(a => [a.typeName, a.quantity]);
          range = sheet.getRange(firstDataRow, colReactBuffer, rows.length, 2);
          _time(_sheetName + ' write react buffer (corp)', () => range.setValues(rows));
        }
      }
      if (hangarRB) {
        // add job products delivered after corporate items cache updated
        finishedItems = getFinishedJobProducts  (plannedJobs, deliveredJobs, hangarRB.locationID);
        if (finishedItems.length > 0) {
          trace(finishedItems);
          range = sheet.getRange(firstDataRow + corpItems + persItems + 1, colReactBuffer, finishedItems.length, 2);
          _time(_sheetName + ' write react buffer finished', () => range.setValues(finishedItems));
        }
        // deduct material usage from new jobs started after items cache updated
        if (useBufferHangar) {
          // get only basic production to the manufacturing hangar as only this production has source in the buffer hangar
          deductedItems = newJobMaterials.filter(i => i[2] == hangarR.locationID && i[3] == false && i[4] == 'Reaction')
        } else {
          // no production should source from the manufacturing buffer hangar
          deductedItems = []
        }
        if (deductedItems.length > 0) {
          trace(deductedItems);
          deductedItemsShort = deductedItems.map(i => ([i[0], i[1]]));
          trace(deductedItemsShort)
          range = sheet.getRange(firstDataRow + corpItems + persItems + finishedItems.length + 2, colReactBuffer, deductedItems.length, 2);
          _time(_sheetName + ' write react buffer deducted', () => range.setValues(deductedItemsShort));
        }
      }



      /*
       * Research Hangar
       */
      // filter items for research hangar
      corpItems = 0 // items in corporation hangar
      persItems = 0 // items in personal hangar
      if (hangarRes) {
        var itemsRes = items.data.filter(item => {
          return (item.locationId == hangarRes.locationID
              && (hangarRes.locationType == "item"  // item in a box
              || (hangarRes.locationType == "station" && item.locationFlag == hangarRes.locationFlag))) // item in hangar root
        });
        corpItems = itemsRes.length

        // store items in hangar to sheet hangar table
        if (corpItems) {
          // store items in hangar to sheet hangar table
          var rows = itemsRes.map(a => [a.typeName, a.quantity]);
          range = sheet.getRange(firstDataRow, colResearch, rows.length, 2);
          _time(_sheetName + ' write research hangar (corp)', () => range.setValues(rows));
        }
      }
      // add job products delivered after corporate items cache updated
      finishedItems = getFinishedJobProducts  (plannedJobs, deliveredJobs, hangarRes.locationID);
      if (finishedItems.length > 0) {
        trace(finishedItems);
        range = sheet.getRange(firstDataRow + corpItems + persItems + 1, colResearch, finishedItems.length, 2);
        _time(_sheetName + ' write research finished', () => range.setValues(finishedItems));
      }


      /*
       * Research Buffer Hangar
       *         assetsFiltered = assets.data.filter(item => {
          return (hangars.some(hangar => hangar.locationID == item.location_id))
        });
      if (hangarResB.length > 0) {
        var itemsRes = items.data.filter(item => {
          return (item.locationId == hangarResB.locationID
              && (hangarResB.locationType == "item"  // item in a box
              || (hangarResB.locationType == "station" && item.locationFlag == hangarResB.locationFlag))) // item in hangar root
        });
       */
      // add research buffer hangar
      if (hangarResB && (hangarResB.length > 0)) {
        var itemsRes = items.data.filter(item => {
          return (hangarResB.some(hangar => (
            item.locationId == hangar.locationID 
            && (hangar.locationType == "item"  // item in a box
            || (hangar.locationType == "station" && item.locationFlag == hangar.locationFlag)) // item in hangar root
          ))) 
        });
        corpItems = itemsRes.length

        // store items in hangar to sheet hangar table
        if (corpItems) {
          // store items in hangar to sheet hangar table
          var rows = itemsRes.map(a => [a.typeName, a.quantity]);
          range = sheet.getRange(firstDataRow, colResearchBuffer, rows.length, 2);
          _time(_sheetName + ' write research buffer (corp)', () => range.setValues(rows));
        }
      }
      /*
      if (hangarResB) {
        // add job products delivered after corporate items cache updated
        finishedItems = getFinishedJobProducts  (plannedJobs, deliveredJobs, hangarResB.locationID);
      */
      if (hangarResB && (hangarResB.length > 0)) {
        // add job products delivered after corporate items cache updated
        finishedItems = []
        hangarResB.forEach(hangar => finishedItems = finishedItems.concat(getFinishedJobProducts  (plannedJobs, deliveredJobs, hangar.locationID)))
        if (finishedItems.length > 0) {
          trace(finishedItems);
          range = sheet.getRange(firstDataRow + corpItems + persItems + 1, colResearchBuffer, finishedItems.length, 2);
          _time(_sheetName + ' write research buffer finished', () => range.setValues(finishedItems));
        }
        // deduct material usage from new jobs started after items cache updated
        deductedItems = newJobMaterials.filter(i => (i[4] == 'Copying' || i[4] == 'Invention'))
        if (deductedItems.length > 0) {
          trace(deductedItems);
          deductedItemsShort = deductedItems.map(i => ([i[0], i[1]]));
          trace(deductedItemsShort)
          range = sheet.getRange(firstDataRow + corpItems + persItems + finishedItems.length + 2, colResearchBuffer, deductedItems.length, 2);
          _time(_sheetName + ' write research buffer deducted', () => range.setValues(deductedItemsShort));
        }
      }



      /*
       * Blueprints
       */
      bpcs.data.sort(function (a, b) {
        if (a.typeName < b.typeName) return -1;
        if (a.typeName > b.typeName) return 1;
        return 0;
      });
      
      // reduce runs of blueprints in use
      const bpcJobRunsByBlueprintId = {};
      for (let j = 0; j < alljobs.data.length; j++) {
        const job = alljobs.data[j];
        const blueprintId = job.blueprintId;
        if (blueprintId == null) continue;
        if (bpcJobRunsByBlueprintId[blueprintId] != null) continue; // keep first match (findIndex semantics)
        if (job.status === 'active' || job.completedTime > bpcs.lastModified) {
          bpcJobRunsByBlueprintId[blueprintId] = job.runs;
        }
      }

      bpcs.data.forEach(bpc => {
        trace(bpc);
        const runsInUse = bpcJobRunsByBlueprintId[bpc.itemId];
        if (runsInUse != null) bpc.runs -= runsInUse;
      });


      // store items to sheet BPC table
      if (bpcs.data.length > 0) {
        // store items in hangar to sheet hangar table
        var rows = bpcs.data.map(a => [a.typeName, a.runs, 1]);
        range = sheet.getRange(firstDataRow, colBPC, rows.length, 3);
        _time(_sheetName + ' write BPC table', () => range.setValues(rows));
      }

      // add copy and research job products delivered after corporate Blueptint cache updated
      let deliveredResearchJobs = alljobs.data.filter(job => (
        (job.activityName == 'Copying' || job.activityName == 'Invention') && 
        job.status == 'delivered' &&
        job.completedTime > bpcs.lastModified
      ))
      trace(deliveredResearchJobs);
      finishedItems = getFinishedJobProducts  (plannedJobs, deliveredResearchJobs);
      if (finishedItems.length > 0) {
        trace(finishedItems);
        range = sheet.getRange(firstDataRow + bpcs.data.length + 1, colBPC, finishedItems.length, 2);
        _time(_sheetName + ' write BPC finished', () => range.setValues(finishedItems));
      }
      /*
      // deduct BPC usage from new jobs started after items cache updated
      let deductedBPCs = newJobs.filter(i => (i.activityName == 'Invention' || i.activityName == 'Manufacturing'))
      console.log(deductedBPCs);
      if (deductedBPCs.length > 0) {
        console.log(deductedBPCs);
        deductedItemsShort = deductedBPCs.map(i => ([i.blueprintName, i.runs * (-1), 1]));
        console.log(deductedItemsShort)
        range = sheet.getRange(firstDataRow + bpcs.data.length + finishedItems.length + 2, colBPC, deductedItemsShort.length, 3);
        range.setValues(deductedItemsShort);
      }
*/

      /*
       * JOBS
       */

      var jobsFiltered = jobs.data;
      jobsFiltered.sort ((a, b) => a.endTime - b.endTime) 
      corpItems = jobsFiltered.length
      // store jobs to sheet jobs table
      if (corpItems) {
        // store items in hangar to sheet hangar table
        var rows = jobsFiltered.map(a => [(a.duration >0) ? Universe.durationToString(a.duration) : "Done", a.runs, a.activityName, a.blueprintName, a.licensedRuns, a.productName, '', a.installerName, a.startDate, a.endDate]);
        range = sheet.getRange(firstDataRow, colJobsList, rows.length, 10);
        _time(_sheetName + ' write jobs list (corp)', () => range.setValues(rows));
      }

      // store personal jobs
      if (jobsPersonal && jobsPersonal.data && jobsPersonal.data.length > 0) {
        // store items in hangar to sheet hangar table
        var rows = jobsPersonal.data.map(a => [(a.duration >0) ? Universe.durationToString(a.duration) : "Done", a.runs, a.activity_name, a.blueprint_name, '', a.product_name]);
        range = sheet.getRange(firstDataRow + corpItems, colJobsList, rows.length, 6);
        _time(_sheetName + ' write jobs list (personal)', () => range.setValues(rows));
      }

      SpreadsheetApp.flush();

      // recalculate project
      _time(_sheetName + ' recalculate project', () => this.recalculateProject(sheet, notify));

      Sidebar.close();
    },

    /*
    * Updates system cost indices
    */
    updateCostIndices: function() {
      // Nacti aktivni sheet a over, ze z nej lze makro spustit
      var sheet = SpreadsheetApp.getActive().getActiveSheet();
      validateActiveSheet(sheet);

      // read system name
      var systemName = sheet.getRange(1, 9, 1, 1).getValue();
      
      // find systemId
      let systems = Eve.resolveNames([systemName], "systems");
      console.log(systems);
      if (!systems) {
        throw ("updateCosts(): systém " + systemName + " nenalezen")
      }
      let systemId = systems[0].id
      sheet.getRange(2, 9, 1, 1).setValue(systemId);

      // find system cost indices
      let costIndices = Eve.getIndusrtyCostIndices(systemId);
      console.log(costIndices)

      // update cost indices
      var index = costIndices.cost_indices.find(element => element.activity == 'manufacturing')
      sheet.getRange(3, 9, 1, 1).setValue(index.cost_index);
      var index = costIndices.cost_indices.find(element => element.activity == 'reaction')
      sheet.getRange(5, 9, 1, 1).setValue(index.cost_index);
      var index = costIndices.cost_indices.find(element => element.activity == 'copying')
      sheet.getRange(7, 9, 1, 1).setValue(index.cost_index);
      var index = costIndices.cost_indices.find(element => element.activity == 'invention')
      sheet.getRange(9, 9, 1, 1).setValue(index.cost_index);

    },

    /*
    * Updates hangar assets for production buffer
    */
    updateBuffer: function() {
      // zjisti a zvaliduj otevreny sheet, ze ktereho je skript spusteny
      var sheet = SpreadsheetApp.getActive().getActiveSheet();
      let sheetName = sheet.getName();
      if (!(sheetName.startsWith("Buffer"))) {
        throw ("Makro lze spistit jen z sheetu buffer")
      }
      var lastRow = sheet.getLastRow();
      var colHangar1 = 29;

      // zjisti ze sheetu parametry skladu
      range = sheet.getRange(1, 2, 2, 3);
      var data = range.getValues();
      var hangarManufactoring = data[0][0];
      var hangarReaction = data[1][0];
      var hangarResearch = data[0][2];
      var hangarSalvage = data[1][2];
      
      // find the hangar identifications
      var hangars = [];
      var hangarM = Corporation.getHangarByName('Manufactoring', hangarManufactoring);
      if(hangarM) hangars.push(hangarM);
      var hangarR = Corporation.getHangarByName('Reaction', hangarReaction);
      if(hangarR) hangars.push(hangarR)
      else {
        hangarR = Corporation.getHangarByName('Manufactoring', hangarReaction);
        if(hangarR) hangars.push(hangarR)
      }
      var hangarRes = Corporation.getHangarByName('Research', hangarResearch);
      if(hangarRes) hangars.push(hangarRes)
      var hangarSal = Corporation.getHangarByName('Manufactoring', hangarSalvage);
      if(hangarSal) hangars.push(hangarSal)

      console.log(hangars)

      /* 
      * Update hangars 
      */

      // clear sheet hangar table contents
      range = sheet.getRange(4, colHangar1, lastRow, 11);
      range.setValue('');

      // For salvage buffer ead blueprints first
      if (sheetName == "Buffer Salvage" && lastRow > 3) {
        // read all types from column A and B
        var allTypes = sheet.getRange(4, 1, lastRow - 1, 2).getValues();

        // filter BPCs
        var bpcTypes = allTypes.filter(element => element[1] == "BPC")
//        console.log(bpcTypes)


        // fetch corporate Bluepeints
        var bpcs = Corporation.getBlueprintsCached();
//        console.log(bpcs.data)

        // filter copies of expected blueprints
        var bpcsFiltered = bpcs.data.filter(element => {
            if (bpcTypes.findIndex(t => t[0] == element.typeName) > -1
              && element.runs > -1) return true
            return false;
          });

        console.log(bpcsFiltered)

        corpItems = bpcsFiltered.length

        // store items in hangar to sheet hangar table
        if (corpItems) {
          // store items in hangar to sheet hangar table
          var rows = bpcsFiltered.map(a => [a.typeName, a.runs]);
          range = sheet.getRange(4, colHangar1 + 3, rows.length, 2);
          range.setValues(rows);
        }
      }

      // get corporate hangars content
      var items = Corporation.getAssetsCached(hangars);

      // filter items for corporation manufacturing hangar
      var corpItems = 0 // items in corporation hangar
      if (hangarM) {
        var itemsM = items.data.filter(item => {
          return (item.locationId == hangarM.locationID
              && (hangarM.locationType == "item"  // item in a box
              || (hangarM.locationType == "station" && item.locationFlag == hangarM.locationFlag))) // item in hangar root
        });
        corpItems = itemsM.length

        // store items in hangar to sheet hangar table
        if (corpItems) {
          // store items in hangar to sheet hangar table
          var rows = itemsM.map(a => [a.typeName, a.quantity]);
          range = sheet.getRange(4, colHangar1, rows.length, 2);
          range.setValues(rows);
        }
      }

      // filter items for corporation reaction hangar
      corpItems = 0 // items in corporation hangar
      if (hangarR) {
        var itemsR = items.data.filter(item => {
          return (item.locationId == hangarR.locationID
              && (hangarR.locationType == "item"  // item in a box
              || (hangarR.locationType == "station" && item.locationFlag == hangarR.locationFlag))) // item in hangar root
        });
        corpItems = itemsR.length

        // store items in hangar to sheet hangar table
        if (corpItems) {
          // store items in hangar to sheet hangar table
          var rows = itemsR.map(a => [a.typeName, a.quantity]);
          range = sheet.getRange(4, colHangar1 + 3, rows.length, 2);
          range.setValues(rows);
        }
      }

      // filter items for corporation research hangar
      corpItems = 0 // items in corporation hangar
      if (hangarRes) {
        var itemsRes = items.data.filter(item => {
          return (item.locationId == hangarRes.locationID
              && (hangarRes.locationType == "item"  // item in a box
              || (hangarRes.locationType == "station" && item.locationFlag == hangarRes.locationFlag))) // item in hangar root
        });
        corpItems = itemsRes.length

        // store items in hangar to sheet hangar table
        if (corpItems) {
          // store items in hangar to sheet hangar table
          var rows = itemsRes.map(a => [a.typeName, a.quantity]);
          range = sheet.getRange(4, colHangar1 + 6, rows.length, 2);
          range.setValues(rows);
        }
      }

      // filter items for corporation salvage hangar
      corpItems = 0 // items in corporation hangar
      if (hangarSal) {
        var itemsSal = items.data.filter(item => {
          return (item.locationId == hangarSal.locationID
              && (hangarSal.locationType == "item"  // item in a box
              || (hangarSal.locationType == "station" && item.locationFlag == hangarSal.locationFlag))) // item in hangar root
        });
        corpItems = itemsSal.length

        // store items in hangar to sheet hangar table
        if (corpItems) {
          // store items in hangar to sheet hangar table
          var rows = itemsSal.map(a => [a.typeName, a.quantity]);
          range = sheet.getRange(4, colHangar1 + 9, rows.length, 2);
          range.setValues(rows);
        }
      }

      // show result in notification window
      SpreadsheetApp.getUi().alert('Aktualizace dokončena, Data jsou stará ' + items.age / 60 + ' minut.', '', SpreadsheetApp.getUi().ButtonSet.OK);
    },

    /*
    * Updates BPO and BPC buffer
    */
    updateBPO: function() {
      var lastRow = bpoSheet.getLastRow();
      // clear sheet hangar table contents
      range = bpoSheet.getRange(4, 11, lastRow - 4, 10);
      range.setValue('');

      // get corporate BPO/C and reaction formulas
      var items = Corporation.getBlueprintsCached();
      items.data.sort(function (a, b) {
        if (a.typeName < b.typeName) return -1;
        if (a.typeName > b.typeName) return 1;
        return 0;
      });

      // filter BPOs and reaction formulas
      var bpos = items.data.filter(item => (item.runs == -1));
      console.log(bpos);

      // store items to sheet BPO table
      if (bpos.length > 0) {
        // store items in hangar to sheet hangar table
        var rows = bpos.map(a => [a.typeName, a.itemId, a.materialEfficiency, a.timeEfficiency]);
        range = bpoSheet.getRange(4, 11, rows.length, 4);
        range.setValues(rows);
      }

      // filter BPCs
      var bpcs = items.data.filter(item => (item.runs != -1));
      console.log(bpcs);

      // store items to sheet BPC table
      if (bpcs.length > 0) {
        // store items in hangar to sheet hangar table
        var rows = bpcs.map(a => [a.typeName, 1, a.materialEfficiency, a.timeEfficiency, a.runs]);
        range = bpoSheet.getRange(4, 16, rows.length, 5);
        range.setValues(rows);
      }

      // show result in notification window
      SpreadsheetApp.getUi().alert('Aktualizace dokončena, Data jsou stará ' + items.age / 60 + ' minut.', '', SpreadsheetApp.getUi().ButtonSet.OK);
    },

    /*
    * Updates BPO and BPC buffer
    */
    /*
    updateBPO: function() {
      var lastRow = bpoSheet.getLastRow();
      // clear sheet hangar table contents
      range = bpoSheet.getRange(4, 11, lastRow - 4, 10);
      range.setValue('');

      // get corporate BPO/C and reaction formulas
      var items = Corporation.getBlueprints();

      // filter BPOs and reaction formulas
      var bpos = items.data.filter(item => (item.is_blueprint_copy !== true));
      console.log(bpos);

      // store items to sheet BPO table
      if (bpos.length > 0) {
        // store items in hangar to sheet hangar table
        var rows = bpos.map(a => [a.type.type_name, a.quantity]);
        range = bpoSheet.getRange(4, 11, rows.length, 2);
        range.setValues(rows);
      }

      // filter BPCs
      var bpcs = items.data.filter(item => (item.is_blueprint_copy === true));
      console.log(bpcs);

      // store items to sheet BPC table
      if (bpcs.length > 0) {
        // store items in hangar to sheet hangar table
        var rows = bpcs.map(a => [a.type.type_name, a.quantity]);
        range = bpoSheet.getRange(4, 14, rows.length, 2);
        range.setValues(rows);
      }

      // show result in notification window
      SpreadsheetApp.getUi().alert('Aktualizace dokončena, Data jsou stará ' + items.age / 60 + ' minut.', '', SpreadsheetApp.getUi().ButtonSet.OK);
    },
*/

    
    /*
     * gets standard blueprint info from API
     */
    getBlueprint: function(typeId) {


      // priprav JSON objekt requestu
      var req = {}
      req.types = [{"typeId": typeId, "amount":1}];
      req.shipT1ME = 0;
      req.shipT1TE = 0;
      req.shipT2ME = 0;
      req.shipT2TE = 0;
      req.moduleT1ME = 0;
      req.moduleT1TE = 0;
      req.moduleT2ME = 0;
      req.moduleT2TE = 0;
      req.produceFuelBlocks = false;
      req.buildT1 = false;
      req.copyBPO = false;

      // zavolej API kalkulace
      var options = {
        'method' : 'post',
        'contentType': 'application/json',
        'payload' : JSON.stringify(req),
        'muteHttpExceptions': true
      };
      var response = UrlFetchApp.fetch(aubiApi + '/blueprints/calculate', options);

      // parsuj odpoved do pole struktur
      var data = parseJsonResponseSafe_(response, 'Blueprint calculate typeId=' + typeId);
      let blueprint = data.jobs.filter(item => item.level == 1);

      return blueprint[0];
    },

    updateBuildCosts: function() {

      var lastRow = buildCostSheet.getLastRow();
      // clear sheet hangar table contents
      range = buildCostSheet.getRange(3, 5, lastRow - 2, 4);
      range.setValue('');

      // get calculation parameters from the sheet
      range = buildCostSheet.getRange(1, 2, 1, 3);
      var params = range.getValues();
      var system = params[0][0];
      var runs = params[0][2];

      // get type names
      range = buildCostSheet.getRange(3, 1, lastRow - 3, 1);
      var blueprints = range.getValues();
      let types = [];

      for (let bpr = 0; bpr < 20; bpr++) {
        var item = blueprints[bpr][0]
        if (item) {
          // zjisti a zapis ID blueptintu
          var blueprintTypeId = getBlueprintId (blueprints[bpr][0]);
          if (!blueprintTypeId) {
            SpreadsheetApp.getUi().alert('Chyba!', 'Blueprint nenalezen', SpreadsheetApp.getUi().ButtonSet.OK);
            return;
          }

          types.push(blueprintTypeId)
        }
      }

      console.log(types)
      
      // todo: T1/T2

      // calculate the build costs
      var data = Eve.getBuildCosts(types, runs, 'sell', 0, 10, 10, system, 0, 'Sotiyo', 'T2', 'Tatara', 'T2', 'Yes', 'tq');

      for (let i = 0; i < data.length; i++) {
//        console.log (data[i]);
        // write only valid responses
        if (data[i].status == 200) {
          let m = data[i].message;
          buildCostSheet.getRange(3 + i, 5, 1, 4).setValues([[m.buildCostPerUnit, m.materialCost / runs, m.jobCost / runs, m.excessMaterialsValue / runs]])
        }
      }

/*
[ { error: 0,
    status: 200,
    message: 
     { materialCost: 254809912.41,
       jobCost: 53541276.03,
       additionalCost: 0,
       totalCost: 308351188.44,
       producedQuantity: 1,
       buildCostPerUnit: 308351188.44,
       excessMaterialsValue: 66148461.2,
       blueprintTypeId: 12018,
       blueprintName: 'Devoter Blueprint' } }]
*/



    },

    /* 
    * Zamkne sheet proti úpravám
    */
    lockProduction: function() {
      // Nacti aktivni sheet a over, ze z nej lze makro spustit
      var sheet = SpreadsheetApp.getActive().getActiveSheet();
      validateActiveSheet(sheet);

      let lockVal = sheet.getRange(rowLock, colLock).getValue();
      console.log(lockVal)

      if (lockVal) {
        // locked, unlock
        sheet.getRange(rowLock, colLock).setValue('');
      } else {
        // unlocked, lock
        sheet.getRange(rowLock, colLock).setValue(1);
      }
    },


  }
})()


function testGetBlueprint() {
  console.log(Blueprints.getBlueprint(57515));
}


function runCalculateBlueprints() {
  console.log(Blueprints.calculateBlueprints());
}

function runRecalculateProject() {
  console.log(Blueprints.recalculateProject());
}

function runCopyIndustrySheet() {
  console.log(Blueprints.copyIndustrySheet());
}

function runUpdateProject() {
  console.log(Blueprints.updateProject());
}

function runUpdateAllProjects() {
  const _time = (label, fn) => (typeof Perf !== 'undefined' && Perf.time) ? Perf.time(label, fn) : fn();

  // Pre-flight: Projects use corporate token stored in ScriptProperties.
  // If it was cleared (e.g. after invalid_grant), guide the user to re-login.
  try {
    const sp = PropertiesService.getScriptProperties();
    const rtCorp = sp.getProperty('refresh_token');
    const rtSharedFull = sp.getProperty('shared_full_refresh_token');
    if (!rtCorp && !rtSharedFull) {
      SpreadsheetApp.getUi().alert(
        'Chybí sdílený token pro Projekty.\n\nTenhle sheet je nastavený tak, že Projekty běží pod sdíleným Corporate/Full tokenem.\n\nKontaktuj admina, ať udělá Corporate login, nebo Full login a pak dá Debug → Copy token → Shared (Full).',
        SpreadsheetApp.getUi().ButtonSet.OK
      );
      return;
    }
  } catch (e) {
    // If UI isn't available, fall through; downstream calls will throw.
  }

  const _toEpochMs = (v) => {
    if (v == null) return null;
    if (typeof v === 'number') return isNaN(v) ? null : v;
    if (v instanceof Date) return v.getTime();
    // Try string/other coercions.
    const n = Number(v);
    if (!isNaN(n) && n > 0) return n;
    const t = Date.parse(String(v));
    return isNaN(t) ? null : t;
  };

  // Ensure per-execution caches start clean (Apps Script runtime may be warm).
  if (typeof Corporation !== 'undefined' && Corporation.resetMemo) {
    Corporation.resetMemo();
  }
  /*
  var sheet = SpreadsheetApp.getActive().getSheetByName('Projekt ALPRO 1')
  sheet.activate()
  Blueprints.updateProject(false);

  sheet = SpreadsheetApp.getActive().getSheetByName('Projekt ALPRO 2')
  sheet.activate()
  Blueprints.updateProject(false);

  sheet = SpreadsheetApp.getActive().getSheetByName('Projekt ALPRO 3')
  sheet.activate()
  Blueprints.updateProject(false);

  sheet = SpreadsheetApp.getActive().getSheetByName('Projekt ALPRO 4')
  sheet.activate()
  Blueprints.updateProject(false);

  sheet = SpreadsheetApp.getActive().getSheetByName('Projekt ALPRO 5')
  sheet.activate()
  Blueprints.updateProject(false);

  sheet = SpreadsheetApp.getActive().getSheetByName('Projekt ALPRO 6')
  sheet.activate()
  Blueprints.updateProject(false);

  sheet = SpreadsheetApp.getActive().getSheetByName('Projekt ALPRO 7')
  sheet.activate()
  Blueprints.updateProject(false);
  */

  _time('runUpdateAllProjects', () => {
    const ss = SpreadsheetApp.getActive();

    // Open sidebar immediately so cache warm-up steps are visible.
    if (typeof Sidebar !== 'undefined' && Sidebar.open) {
      Sidebar.open('');
      Sidebar.add('Načítám cache...');
    }

    // Freeze memo caches for the duration of this run.
    // This prevents short ESI cache lifetimes (e.g. jobs ~5 min) from forcing
    // mid-run refreshes when updating multiple projects.
    if (typeof Corporation !== 'undefined' && Corporation.freezeMemo) {
      Corporation.freezeMemo();
    }

    try {
      // Warm caches once (may trigger a single sync if expired).
      if (typeof Corporation !== 'undefined') {
        const warmed = {};
        if (Corporation.loadAssets) warmed.assets = _time('warm cache: assets', () => Corporation.loadAssets());
        if (Corporation.syncJobs) warmed.jobs = _time('warm cache: jobs', () => Corporation.syncJobs());
        else if (Corporation.loadJobs) warmed.jobs = _time('warm cache: jobs', () => Corporation.loadJobs());
        if (Corporation.syncBlueprints) warmed.blueprints = _time('warm cache: blueprints', () => Corporation.syncBlueprints());
        else if (Corporation.loadBlueprints) warmed.blueprints = _time('warm cache: blueprints', () => Corporation.loadBlueprints());

        // Publish cache expiry info for the sidebar footer.
        if (typeof Sidebar !== 'undefined' && Sidebar.setCacheInfo) {
          Sidebar.setCacheInfo({
            assetsExpiresMs: _toEpochMs(warmed.assets && warmed.assets.expires),
            jobsExpiresMs: _toEpochMs(warmed.jobs && warmed.jobs.expires),
            blueprintsExpiresMs: _toEpochMs(warmed.blueprints && warmed.blueprints.expires),
          });
        }
      }

      const names = [
        'Projekt ALPRO 1',
        'Projekt ALPRO 2',
        'Projekt ALPRO 3',
        'Projekt ALPRO 4',
        'Projekt ALPRO 5',
        'Projekt ALPRO 6',
        'Projekt ALPRO 7',
      ];

      names.forEach(name => {
        _time('update: ' + name, () => Blueprints.updateProject(ss.getSheetByName(name), false));
      });
    } finally {
      if (typeof Corporation !== 'undefined' && Corporation.unfreezeMemo) {
        Corporation.unfreezeMemo();
      }
    }
  });

  SpreadsheetApp.getUi().alert('Aktualizace dokončena', '', SpreadsheetApp.getUi().ButtonSet.OK);

}

function runUpdateCostIndices() {
  console.log(Blueprints.updateCostIndices());
}

function runUpdateBuffer() {
  console.log(Blueprints.updateBuffer());
}


function runBlueprintTest() {
  console.log(Blueprints.test());
}

function runUpdateBPO() {
  console.log(Blueprints.updateBPO());
}

function runUpdateBuildCosts() {
  Blueprints.updateBuildCosts();
}

function lockProduction() {
  Blueprints.lockProduction();
}


function runGetBPOs() {
  var allBPs = Corporation.getBlueprints(); 
  var bpos = allBPs.data.filter(item => {return (item.runs == -1)});
  var names = bpos.map(a => ([a.typeName]));
  range = debugSheet.getRange(1, 1, names.length, 1);
  range.setValues(names);

  console.log(names);
}

function testHan() {
  var hangars = [];
  var hangarMB = Corporation.getHangarByName('Manufactoring', 'Produkty - Prebytky');
  if(hangarMB) hangars.push(hangarMB);

  var han = [];
  han.push(Corporation.getHangarByName('Research', 'Invention - Prebytky'))
  han.push(Corporation.getHangarByName('Research', 'Invention - Prebytky 2'))
  han.push(Corporation.getHangarByName('Research', 'Invention - Prebytky 3'))
  // drop null values
  let han2 = han.filter(function (e) {return e; });
  console.log(han2);

  hangars = hangars.concat(han2)
  console.log(hangars);
}
