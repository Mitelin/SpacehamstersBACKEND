const pricecolEVE = 16;    // prvni sloupec s cenou EVE

var g_pricelist;

/*
 * Main function, orchestrates price list refreshing
 */
function getPricesMarketeer() {
  Logger.log('>>> getPrices()');

  // Avoid concurrent refreshes (menu click, trigger, etc.)
  const lock = LockService.getScriptLock();
  const locked = lock.tryLock(5000);
  if (!locked) {
    SpreadsheetApp.getActive().toast('Ceník: refresh už běží (lock). Zkus to prosím za chvilku znovu.', 'Ceník', 7);
    return;
  }

  try {
    // activate the sheet
    pricelistSheet.activate()

    // delete current prices
    var lastRow = pricelistSheet.getLastRow();
//    pricelistSheet.getRange(2, pricecolEVE, lastRow - 1, 17).setValue("");

    // nacti ID komodit
    pricelistFetchItemIds();

    // nacti ceny komodit podle ID
    pricelistFetchEVEPrices();

    // nacti statistiky komodit z EVE Marketeeru
    const res = pricelistFetchMarketeerPrices();

    if (res && res.partial) {
      SpreadsheetApp.getActive().toast('Ceník: částečně hotovo (časový limit). Spusť znovu getPricesMarketeer() pro pokračování.', 'Ceník', 10);
      return;
    }

    // show result in notification window
    SpreadsheetApp.getUi().alert('Aktualizace dokončena.', '', SpreadsheetApp.getUi().ButtonSet.OK);
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/*
 * Main function, orchestrates price list refreshing
 */
function getPricesTycoon() {
  Logger.log('>>> getPrices()');

  // activate the sheet
  pricelistSheet.activate()

  // delete current prices
  var lastRow = pricelistSheet.getLastRow();
//  pricelistSheet.getRange(2, pricecolEVE, lastRow - 1, 17).setValue("");

  // nacti ID komodit
  pricelistFetchItemIds();

  // nacti ceny komodit podle ID
  pricelistFetchEVEPrices();

  // nacti statistiky komodit z EVE Tycoonu
  pricelistFetchTycoonPrices();

  // prepocitej cenu ore
  pricelistCalculateOre();

  // show result in notification window
  SpreadsheetApp.getUi().alert('Aktualizace dokončena.', '', SpreadsheetApp.getUi().ButtonSet.OK);
}

/*
 * Identifies new items in buouts, adds them to pricelist and fetches current prices
 */
function pricelistAddNewBuyouts () {
  // fetch pricelist item IDs
  pricelistFetchItemIds();

  // find the last row
  var lastPricelistRow = g_pricelist.length - 1;
  while (!g_pricelist[lastPricelistRow][0]) lastPricelistRow--;
  console.log('!!! last pricelist row ' + lastPricelistRow);

  // fetch items in the buyouts sheet
  var lastRow = buyoutSheet.getLastRow();
  var range = buyoutSheet.getRange(2, 2, lastRow, 1);
  var buyoutItems = range.getValues();

  // iterate through buyouts items
  var i = 0;
  var item;
  while (item = buyoutItems[i][0]) {
//    console.log(item);

    // find item in the pricelist
    var priceListItem = g_pricelist.find(e => e[0] == item);
//    console.log (priceListItem)

    if (!priceListItem) {
      console.log('### New item:' + item);

      try {
        // fetch item details
        let type = getTypeByName(item);
        console.log(type);

        // identify price formula
        // ice = 95% Jita buy
        // moon asteroids = calculated price
        // other = 95% Jita buy
        let formula = '=W' + (lastPricelistRow + 3) + ' *0,95';
        if (type.category_name == 'Asteroid') {
          if (type.group_name == 'Ice') '=W' + (lastPricelistRow + 3) + ' *0,95';
          else formula = '=I' + (lastPricelistRow + 3);
        }

        // add item to buyouts
        g_pricelist.push([item, type.type_id, type.name])
        pricelistSheet.getRange(lastPricelistRow + 3,1 , 1, 8).setValues([[
          item,
          type.type_id, 
          type.name, 
          type.group_name, 
          type.category_name,
          '',
          '=sumif(Sklady!D:D;A'+ (lastPricelistRow + 3) + ';Sklady!F:F)',
          formula
        ]]);

        // fetch tycoon price
        var response = UrlFetchApp.fetch('https://evetycoon.com/api/v1/market/stats/10000002/' + type.type_id);
        var json = response.getContentText();
        var data = JSON.parse(json);
        let headers = response.getHeaders();
        let expires = headers.Expires;

        pricelistSheet.getRange(lastPricelistRow + 3, pricecolEVE + 2, 1, 16).setValues(
          [[ (data.buyAvgFivePercent + data.sellAvgFivePercent) / 2,
            '', //item.buy.min,
            '', //item.buy.avg,
            '', //item.buy.wavg,
            '', //item.buy.median,
            data.buyAvgFivePercent,
            data.maxBuy,
            data.buyVolume,
            data.minSell,
            '', //item.sell.avg,
            '', //item.sell.wavg,
            '', //item.sell.median,
            '', //item.sell.max,
            data.sellAvgFivePercent,
            data.sellVolume,
            expires]]);

        lastPricelistRow++;
      
      } catch (e){
        console.log('!!! ' + e);
      }

    }

    // go to the next item
    i++;
  }
  


}


/*
 * Fetches and stores IDs, names and groups for new or changed items in the price list
 * Return: index of the last item
 */
function pricelistFetchItemIds() {
  Logger.log('>>> pricelistFetchItemIds()');

  // zjisti rozsah, ve kterem se nachazi komodity
  var lastRow = pricelistSheet.getLastRow();
  var range = pricelistSheet.getRange(2, 1, lastRow, 3);
  g_pricelist = range.getValues();

  // fetch item details for new or updated items
  var i = 0;

  while (g_pricelist[i][0]) {
    if (g_pricelist[i][0] != g_pricelist[i][2] || !g_pricelist[i][1]) { // different names, item changed, or no id fetched yet
      let type = getTypeByName(g_pricelist[i][0]);

      // update the types array
      g_pricelist[i][1] = type.type_id;
      g_pricelist[i][2] = type.name;

      // add extra ampersand to names starting with one
      if (type.name.charAt(0) == "'") {
        type.name = "'" + type.name;
      }

      // update the sheet
      pricelistSheet.getRange(2 + i, 2, 1, 4)
        .setValues([[type.type_id, type.name, type.group_name, type.category_name]]);
    }

    // move to the next item
    i++;
  }
}

/**
 * Fetches EVE prices and stores them to the sheet
 */
function pricelistFetchEVEPrices() {
  Logger.log('>>> pricelistFetchEVEPrices()');

  // GET request na EVE universe API pro market prices
  var url = eveApi + '/markets/prices/?datasource=tranquility'
  var response = UrlFetchApp.fetch(url);

  // parsuj odpoved do pole struktur
  var json = response.getContentText();
  var data = JSON.parse(json);
//  Logger.log(data);

  // update prices for items in sheet
  var i = 0;
  while (g_pricelist[i][0]) {
    // find the price for selected item
    let price = data.find(element => element.type_id == g_pricelist[i][1])

    if (price) {
      // price found, store it to the sheet
      pricelistSheet.getRange(2 + i, pricecolEVE, 1, 2)
        .setValues([[price.average_price, price.adjusted_price]]);
    }

    // move to the next item
    i++;
  }
}

/**
 * Fetches EVE Tycoon prices and stores them to the sheet
 */
function pricelistFetchTycoonPrices() {
  Logger.log('>>> pricelistFetchTycoonPrices()');

  // if run from scheduler, the pricelist global variable is not initialised
  if (!g_pricelist) {
    Logger.log('>>> reading type IDs');
    g_pricelist = pricelistSheet.getRange(2, 1, pricelistSheet.getLastRow(), 3).getValues();
  }
  
  // volej cti a zapisuj s balikem nekolika kusu
  let batch = 50
  var i = 0;

  // volej item po itemu
  while (i < g_pricelist.length) {

    // read batch of data from sheet
    Logger.log('>>> Reading sheet content from line ' + i);
    let sheetData = pricelistSheet.getRange(2 + i, pricecolEVE + 2, batch, 16).getValues();
  
    // prepare requests
    var requests = [] // tycoon URLs
    var rows = []     // row indexes
    var j = 0;
    while ((j < batch) && (g_pricelist[i + j][1])) {
    // get current item expiration
      let expiration = sheetData[j][15];
      let now = new Date();
      let exp = new Date(expiration);
      let expMinutes = (now.getTime() - exp.getTime()) / 60000

      // add only unexpired items
      if (expMinutes <60) {
//        console.log("Ignoring row " + j)
      } else {
//        console.log("Pushing row " + j)
        requests.push('https://evetycoon.com/api/v1/market/stats/10000002/' + g_pricelist[i + j][1])
        rows.push(j);
      }

      j += 1;
    }

    // call API only if there are requests to be done
    if (requests.length > 0) {
      // call batch of requests
      var responses = UrlFetchApp.fetchAll(requests);

      // process responses
      for (res = 0; res < responses.length; res++) {
        // parsuj odpoved do pole struktur
        var response = responses[res]
        var json = response.getContentText();
        var data = JSON.parse(json);
        let headers = response.getHeaders();
        let expires = headers.Expires;

        // IMPORTANT: Tycoon API does not provide avg/wavg; do NOT wipe existing values.
        // Keep whatever is already in columns buy.avg/buy.wavg/sell.avg/sell.wavg.
        let rowArr = sheetData[rows[res]];
        if (!rowArr || rowArr.length < 16) rowArr = new Array(16).fill('');
        rowArr[0] = (data.buyAvgFivePercent + data.sellAvgFivePercent) / 2;
        // rowArr[1] buy.min (not provided)
        // rowArr[2] buy.avg (preserve)
        // rowArr[3] buy.wavg (preserve)
        // rowArr[4] buy.median (not provided)
        rowArr[5] = data.buyAvgFivePercent;
        rowArr[6] = data.maxBuy;
        rowArr[7] = data.buyVolume;
        rowArr[8] = data.minSell;
        // rowArr[9] sell.avg (preserve)
        // rowArr[10] sell.wavg (preserve)
        // rowArr[11] sell.median (not provided)
        // rowArr[12] sell.max (not provided)
        rowArr[13] = data.sellAvgFivePercent;
        rowArr[14] = data.sellVolume;
        rowArr[15] = expires;
        sheetData[rows[res]] = rowArr;

        j += 1;
      }

      // Write batch of results to sheet
      Logger.log('>>> Updating sheet content');
      pricelistSheet.getRange(2 + i, pricecolEVE + 2, batch, 16).setValues(sheetData);
    } else {
      Logger.log('>>> No need to update this batch');
    }

    i+= batch;
  }
}

/**
 * Fetches EVE Marketeer prices and stores them to the sheet
 */
function pricelistFetchMarketeerPrices() {
  Logger.log('>>> pricelistFetchMarketeerPrices()');

  // If run from scheduler, the pricelist global variable may not be initialised.
  if (!g_pricelist) {
    Logger.log('>>> reading type IDs');
    g_pricelist = pricelistSheet.getRange(2, 1, pricelistSheet.getLastRow(), 3).getValues();
  }

  const props = PropertiesService.getScriptProperties();
  const resumeKey = 'pricelistFetchMarketeerPrices.nextIndex';
  let startIndex = Number(props.getProperty(resumeKey) || 0) || 0;

  // Time budget: Apps Script typically ~6 minutes max.
  const startedAt = Date.now();
  const MAX_MS = 5.25 * 60 * 1000; // keep margin

  const now = new Date();
  const nextExpires = new Date(now.getTime() + 60 * 60000);

  // batch size: larger = fewer sheet operations; keep response sizes reasonable.
  const batch = 200;
  let i = startIndex;
  while (i < g_pricelist.length) {
    if ((Date.now() - startedAt) > MAX_MS) {
      props.setProperty(resumeKey, String(i));
      return { partial: true, nextIndex: i };
    }

    // Determine how many rows are in this batch
    let j = 0;
    while ((i + j) < g_pricelist.length && g_pricelist[i + j][0] && j < batch) j++;
    if (j <= 0) break;

    // Read current data for this batch (incl expires at the end)
    // Range is 16 cols starting at (pricecolEVE + 2), where col[15] is Expires.
    const sheetData = pricelistSheet.getRange(2 + i, pricecolEVE + 2, j, 16).getValues();

    // Build list of typeIds that need refreshing (expired or empty)
    const typeIds = [];
    const localIdxByTypeId = new Map();
    for (let k = 0; k < j; k++) {
      const typeId = g_pricelist[i + k][1];
      if (!typeId) continue;

      // If avg/wavg columns are missing (common after Tycoon refresh), refresh regardless of Expires.
      // Indices are within the 16-col Marketeer/Tycoon block:
      // buy.avg=2, buy.wavg=3, sell.avg=9, sell.wavg=10.
      const rowBlock = sheetData[k] || [];
      const missingAvgWavg =
        rowBlock[2] === '' || rowBlock[2] == null ||
        rowBlock[3] === '' || rowBlock[3] == null ||
        rowBlock[9] === '' || rowBlock[9] == null ||
        rowBlock[10] === '' || rowBlock[10] == null;

      const expiration = sheetData[k] ? sheetData[k][15] : null;
      let expired = true;
      try {
        if (expiration) {
          const exp = new Date(expiration);
          const expMinutes = (now.getTime() - exp.getTime()) / 60000;
          expired = !(expMinutes < 60);
        }
      } catch (e) {
        expired = true;
      }

      if (expired || missingAvgWavg) {
        const tid = String(typeId);
        typeIds.push(tid);
        localIdxByTypeId.set(tid, k);
      }
    }

    if (!typeIds.length) {
      i += j;
      continue;
    }

    let updated = false;
    let usedFallback = false;

    // --- 1) Try legacy EVE Marketer API ---
    try {
      // Build query in chunks to keep URL length safe.
      const chunkSize = 80;
      for (let c = 0; c < typeIds.length; c += chunkSize) {
        const chunk = typeIds.slice(c, c + chunkSize);
        let q = '';
        chunk.forEach(tid => { q += '&typeid=' + encodeURIComponent(tid); });
        const resp = UrlFetchApp.fetch('https://api.evemarketer.com/ec/marketstat/json?regionlimit=10000002' + q, { muteHttpExceptions: true });
        const code = resp.getResponseCode();
        if (code !== 200) continue;
        const data = JSON.parse(resp.getContentText());
        if (!Array.isArray(data)) continue;
        data.forEach(function (item) {
          const typeId = (item && item.buy && item.buy.forQuery && item.buy.forQuery.types && item.buy.forQuery.types[0])
            ? (item.buy.forQuery.types[0]).toString()
            : null;
          if (!typeId) return;
          const localIdx = localIdxByTypeId.get(typeId);
          if (localIdx == null) return;

          // Write Marketeer block into 0..14; preserve expires col[15]
          sheetData[localIdx][0] = (item.buy.fivePercent + item.sell.fivePercent) / 2;
          sheetData[localIdx][1] = item.buy.min;
          sheetData[localIdx][2] = item.buy.avg;
          sheetData[localIdx][3] = item.buy.wavg;
          sheetData[localIdx][4] = item.buy.median;
          sheetData[localIdx][5] = item.buy.fivePercent;
          sheetData[localIdx][6] = item.buy.max;
          sheetData[localIdx][7] = item.buy.volume;
          sheetData[localIdx][8] = item.sell.min;
          sheetData[localIdx][9] = item.sell.avg;
          sheetData[localIdx][10] = item.sell.wavg;
          sheetData[localIdx][11] = item.sell.median;
          sheetData[localIdx][12] = item.sell.max;
          sheetData[localIdx][13] = item.sell.fivePercent;
          sheetData[localIdx][14] = item.sell.volume;
          sheetData[localIdx][15] = nextExpires;
          updated = true;
        });
      }
    } catch (e) {
      // ignore, fallback below
    }

    // --- 2) Fallback: Fuzzwork aggregates ---
    if (!updated) {
      usedFallback = true;
      try {
        // Fuzzwork supports comma-separated list.
        const url = 'https://market.fuzzwork.co.uk/aggregates/?region=10000002&types=' + encodeURIComponent(typeIds.join(','));
        const resp2 = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
        if (resp2.getResponseCode() === 200) {
          const obj = JSON.parse(resp2.getContentText());
          typeIds.forEach(tid => {
            const localIdx = localIdxByTypeId.get(tid);
            if (localIdx == null) return;
            const rec = obj ? obj[tid] : null;
            if (!rec || !rec.buy || !rec.sell) return;
            const buyW = Number(rec.buy.weightedAverage);
            const sellW = Number(rec.sell.weightedAverage);
            if (!isFinite(buyW) && !isFinite(sellW)) return;

            // Populate avg/wavg using weightedAverage (good enough for Calculator).
            if (isFinite(buyW) && buyW > 0) {
              sheetData[localIdx][2] = buyW;  // buy.avg
              sheetData[localIdx][3] = buyW;  // buy.wavg
            }
            if (isFinite(sellW) && sellW > 0) {
              sheetData[localIdx][9] = sellW;   // sell.avg
              sheetData[localIdx][10] = sellW;  // sell.wavg
            }

            // Optional: set split(mid) if empty.
            if (sheetData[localIdx][0] === '' || sheetData[localIdx][0] == null) {
              const parts = [];
              if (isFinite(buyW) && buyW > 0) parts.push(buyW);
              if (isFinite(sellW) && sellW > 0) parts.push(sellW);
              if (parts.length) sheetData[localIdx][0] = parts.reduce((a, b) => a + b, 0) / parts.length;
            }

            sheetData[localIdx][15] = nextExpires;
            updated = true;
          });
        }
      } catch (e2) {
        // ignore
      }
    }

    if (updated) {
      Logger.log('>>> Updating sheet content' + (usedFallback ? ' (Fuzzwork fallback)' : ''));
      pricelistSheet.getRange(2 + i, pricecolEVE + 2, j, 16).setValues(sheetData);
    } else {
      Logger.log('>>> Marketeer update skipped (no data)');
    }

    i += j;
  }

  props.deleteProperty(resumeKey);
  return { partial: false, nextIndex: null };
}

/*
function testxxx() {
  console.log(priceList.getPrice('PLEX'));
}
*/


/*
 * objekt ceniku
 */
var priceList = {
  l_data: null,       // nacteny cenik

  init: function (force) {
    if (!force && this.l_data) return;

    // nacti data ze sheetu
    var lastRow = pricelistSheet.getLastRow();
    if (lastRow <= 1) {
      this.l_data = [];
      return;
    }
    this.l_data = pricelistSheet.getRange(2, 1, lastRow - 1, pricecolEVE + 19).getValues();
//    console.log(this.l_data[0]);
  },

  /*
   * Returns prices of type Id
   * typeId : type ID
   * out: price object
   */
  getTypeIdPrice: function(typeId) {
    if (!this.l_data) this.init();
    var res = {};

    // najdi konkretni radku
    let row = this.l_data.find(element => element[1] == typeId);
    if (!row) {

      // find the last row
      var lastPricelistRow = this.l_data.length - 1;
      while (!this.l_data[lastPricelistRow][0]) lastPricelistRow--;
//        console.log('!!! last pricelist row ' + lastPricelistRow);

      // fetch item details
      let type = Universe.getType(typeId);
//        console.log(type);

      // fetch tycoon price
      var response = UrlFetchApp.fetch('https://evetycoon.com/api/v1/market/stats/10000002/' + type.type_id);
      var json = response.getContentText();
      var data = JSON.parse(json);
      let headers = response.getHeaders();
      let expires = headers.Expires;

      // identify price formula
      // ice = 95% Jita buy
      // moon asteroids = calculated price
      // other = 95% Jita buy
      let formula = '=W' + (lastPricelistRow + 3) + ' *0,95';
      let buyout = data.buyAvgFivePercent * 0.95;
      let minerals = '';
      let calcbuyout = '';
      if (type.category_name == 'Asteroid') {
        if (type.group_name == 'Ice') '=W' + (lastPricelistRow + 3) + ' *0,95';
        else {
          formula = '=I' + (lastPricelistRow + 3);
          ore = calculateOrePrice (type.type_name, 0.9, 0, 0.00, '');
          buyout = ore.jitaBuy;
          calcbuyout = buyout;
          minerals = JSON.stringify(ore.minerals);
        }
      }

      // add item to buyouts
      this.l_data.push([
        type.type_name, 
        type.type_id, 
        type.type_name,
        type.group,
        type.category_name,
        '',
        0,
        buyout,
        calcbuyout,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        (data.buyAvgFivePercent + data.sellAvgFivePercent) / 2,
        '', //item.buy.min,
        '', //item.buy.avg,
        '', //item.buy.wavg,
        '', //item.buy.median,
        data.buyAvgFivePercent,
        data.maxBuy,
        data.buyVolume,
        data.minSell,
        '', //item.sell.avg,
        '', //item.sell.wavg,
        '', //item.sell.median,
        '', //item.sell.max,
        data.sellAvgFivePercent,
        data.sellVolume,
        expires,
        '',
        minerals
      ])

      // add item to pricelist sheet
      pricelistSheet.getRange(lastPricelistRow + 3,1 , 1, 35).setValues([[
        type.type_name,
        type.type_id, 
        type.type_name, 
        type.group, 
        type.category_name,
        '',
        '=sumif(Sklady!D:D;A'+ (lastPricelistRow + 3) + ';Sklady!F:F)',
        formula,
        calcbuyout,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        (data.buyAvgFivePercent + data.sellAvgFivePercent) / 2,
        '', //item.buy.min,
        '', //item.buy.avg,
        '', //item.buy.wavg,
        '', //item.buy.median,
        data.buyAvgFivePercent,
        data.maxBuy,
        data.buyVolume,
        data.minSell,
        '', //item.sell.avg,
        '', //item.sell.wavg,
        '', //item.sell.median,
        '', //item.sell.max,
        data.sellAvgFivePercent,
        data.sellVolume,
        expires,
        '',
        minerals
      ]]);

      lastPricelistRow++;
      row = this.l_data[lastPricelistRow];
    }

    // vytvor objekt s rozparsovanou cenou
    // NOTE: `row[...]` is 0-based index into the range values, but `pricecolEVE` is 1-based column number.
    // Marketeer/Tycoon block is written starting at column (pricecolEVE + 2) with 15 values.
    // Therefore the FIRST value in that block ends up at `row[pricecolEVE + 1]`.
    res = {
      name: row[2],
      group: row[3],
      category: row[4],
      buyout: row[7],
      eveAverage: row[pricecolEVE - 1],
      eveAdjusted: row[pricecolEVE],
      // Marketeer/Tycoon block (15 cols starting at pricecolEVE+2)
      jitaSplitTop5: row[pricecolEVE + 1],
      jitaBuyAvg: row[pricecolEVE + 3],
      jitaBuyWavg: row[pricecolEVE + 4],
      jitaBuyTop5: row[pricecolEVE + 6],
      jitaSellAvg: row[pricecolEVE + 10],
      jitaSellWavg: row[pricecolEVE + 11],
      jitaSellTop5: row[pricecolEVE + 14]
    }

    return res;
  },

  getPrice: function(typeName) {
    if (!this.l_data) this.init();
    var res = {};

    // najdi konkretni radku
    let row = this.l_data.find(element => element[0] == typeName);
    if (!row) {
      pricelistSheet.appendRow([typeName]);
      this.l_data.push([typeName, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null])
      res = {
        "eveAverage": 0,
        "eveAdjusted": 0,
        "jitaSplitTop5": 0,
        "jitaBuyAvg": 0,
        "jitaBuyWavg": 0,
        "jitaBuyTop5": 0,
        "jitaSellAvg": 0,
        "jitaSellWavg": 0,
        "jitaSellTop5": 0
      }
    } else {

      // vytvor objekt s rozparsovanou cenou
      res = {
        "eveAverage": row[pricecolEVE - 1],
        "eveAdjusted": row[pricecolEVE],
        "jitaSplitTop5": row[pricecolEVE + 1],
        "jitaBuyAvg": row[pricecolEVE + 3],
        "jitaBuyWavg": row[pricecolEVE + 4],
        "jitaBuyTop5": row[pricecolEVE + 6],
        "jitaSellAvg": row[pricecolEVE + 10],
        "jitaSellWavg": row[pricecolEVE + 11],
        "jitaSellTop5": row[pricecolEVE + 14]
      }
    }

    return res;
  },

  getRow: function(typeName) {
    if (!this.l_data) this.init();

    // najdi konkretni radku
    let row = this.l_data.findIndex(element => element[0] == typeName);

    if (row == -1) return row;
    else return row + 2;
  }
}



/*
 * V Ceniku aktualizuje vykupni ceny ore
 */
function pricelistCalculateOre () {
  // activate the sheet
//  pricelistSheet.activate()

  // inicializuj cenik
  if (!priceList.l_data) priceList.init();

  // prochazej jednotlive polozky ceniku a zpracuj ty s kategorii Asteroid
  let i = 0
  do {
    let item = priceList.l_data[i];
    let type = item[0];
    let group = item[3];
    let category = item[4];
    let minerals = item[34];

    /*
    - vsechno ore 90% efektivita, 0% daně, 0% marže z Jita BUY 
    - salvage 50% efektvita, 5% daně, 0% marže z Jita BUY  (minerály potřebujeme pro výrobu)
    */
/*
    if (category == 'Asteroid' && item[3] == 'Ice') {
      let price = calculateOrePrice (type, 0.87, 0, 0.05, minerals);
      pricelistSheet.getRange(2 + i, 9, 1, 1).setValue(price.jitaBuy);
      if (!minerals) pricelistSheet.getRange(2 + i, 35, 1, 1).setValue(JSON.stringify(price.minerals));
    } else if (category == 'Asteroid' && group == 'Ubiquitous Moon Asteroids') {
      let price = calculateOrePrice (type, 0.87, 0, 0.07, minerals);
      pricelistSheet.getRange(2 + i, 9, 1, 1).setValue(price.jitaSell);
      if (!minerals) pricelistSheet.getRange(2 + i, 35, 1, 1).setValue(JSON.stringify(price.minerals));
    } else if (category == 'Asteroid' && group.includes("Moon")) {
      let price = calculateOrePrice (type, 0.87, 0, 0.05, minerals);
      pricelistSheet.getRange(2 + i, 9, 1, 1).setValue(price.jitaBuy);
      if (!minerals) pricelistSheet.getRange(2 + i, 35, 1, 1).setValue(JSON.stringify(price.minerals));
*/    
    if (category == 'Asteroid') {
      let price = calculateOrePrice (type, 0.9, 0, 0.00, minerals);
      pricelistSheet.getRange(2 + i, 9, 1, 1).setValue(price.jitaBuy);
      if (!minerals) pricelistSheet.getRange(2 + i, 35, 1, 1).setValue(JSON.stringify(price.minerals));
//    } else if (category == 'Module' || category == 'Drone' || category == 'Charge' || category == 'Ship') {
    } else if (category == 'Module' || category == 'Drone' || category == 'Charge') {
      let price = calculateOrePrice (type, 0.54, 0.02, 0, minerals);
      if (price.jitaBuy) {
        pricelistSheet.getRange(2 + i, 9, 1, 1).setValue(price.jitaBuy);
        if (!minerals) pricelistSheet.getRange(2 + i, 35, 1, 1).setValue(JSON.stringify(price.minerals));
      }
    }
    i++;
  } while (i < priceList.l_data.length);
}

/*
 * do ceniku nacte objemy nakupu a prodeje
 */
function pricelistGetVolumes () {
  // activate the sheet
  pricelistSheet.activate()

  var lastRow = pricelistSheet.getLastRow();
  pricelistSheet.getRange(2, 10, lastRow - 1, 4).setValue("");

 // inicializuj cenik
  priceList.init(true);
 
  // fetch volumes
  volumes = getTypeVolumes();

  volumes.forEach(function (item) {
    // najdi cislo radky v ceniku, ktere obsahuje dany typ
    row = priceList.getRow(item.typeName);

    if (row > 0) {
      // found
      pricelistSheet.getRange(row, 10, 1, 4).setValues([[item.sellQuantity, item.sellPrice, item.buyQuantity, item.buyPrice]])
    }
  });
}

function testBatch() {
  var response
  var a = new Date();
  response = UrlFetchApp.fetch('https://evetycoon.com/api/v1/market/stats/10000002/' + 46288);
  response = UrlFetchApp.fetch('https://evetycoon.com/api/v1/market/stats/10000002/' + 46289);
  response = UrlFetchApp.fetch('https://evetycoon.com/api/v1/market/stats/10000002/' + 46290);
  response = UrlFetchApp.fetch('https://evetycoon.com/api/v1/market/stats/10000002/' + 46291);
  response = UrlFetchApp.fetch('https://evetycoon.com/api/v1/market/stats/10000002/' + 46292);
  response = UrlFetchApp.fetch('https://evetycoon.com/api/v1/market/stats/10000002/' + 46293);
  response = UrlFetchApp.fetch('https://evetycoon.com/api/v1/market/stats/10000002/' + 46294);
  response = UrlFetchApp.fetch('https://evetycoon.com/api/v1/market/stats/10000002/' + 46295);
  response = UrlFetchApp.fetch('https://evetycoon.com/api/v1/market/stats/10000002/' + 46296);
  response = UrlFetchApp.fetch('https://evetycoon.com/api/v1/market/stats/10000002/' + 46297);
  response = UrlFetchApp.fetch('https://evetycoon.com/api/v1/market/stats/10000002/' + 46298);
  var b = new Date();

  response = UrlFetchApp.fetchAll([
    'https://evetycoon.com/api/v1/market/stats/10000002/' + 46288,
    'https://evetycoon.com/api/v1/market/stats/10000002/' + 46289,
    'https://evetycoon.com/api/v1/market/stats/10000002/' + 46290,
    'https://evetycoon.com/api/v1/market/stats/10000002/' + 46291,
    'https://evetycoon.com/api/v1/market/stats/10000002/' + 46292,
    'https://evetycoon.com/api/v1/market/stats/10000002/' + 46293,
    'https://evetycoon.com/api/v1/market/stats/10000002/' + 46294,
    'https://evetycoon.com/api/v1/market/stats/10000002/' + 46295,
    'https://evetycoon.com/api/v1/market/stats/10000002/' + 46296,
    'https://evetycoon.com/api/v1/market/stats/10000002/' + 46297,
    'https://evetycoon.com/api/v1/market/stats/10000002/' + 46298,
  ]);
  var c = new Date();

  console.log ("Test 1: " + (b.valueOf() - a.valueOf()) + " ms")
  console.log ("Test 2: " + (c.valueOf() - b.valueOf()) + " ms")

  console.log(response[0].getHeaders());
  console.log(response[0].getContentText());
}

function testGetTypeIdPrice () {
  console.log(priceList.getTypeIdPrice(87773));
  console.log(priceList.getTypeIdPrice(17429));
//  console.log(priceList.getTypeIdPrice(44992));
}