const pricecolEVE = 16;    // prvni sloupec s cenou EVE

var g_pricelist;

/*
 * Main function, orchestrates price list refreshing
 */
function getPricesMarketeer() {
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

  // nacti statistiky komodit z EVE Marketeeru
  pricelistFetchMarketeerPrices();

  // show result in notification window
  SpreadsheetApp.getUi().alert('Aktualizace dokončena.', '', SpreadsheetApp.getUi().ButtonSet.OK);
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

        sheetData[rows[res]] = 
          [ (data.buyAvgFivePercent + data.sellAvgFivePercent) / 2,
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
            expires]

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

  // volej API s balikem nekolika kusu
  let batch = 100
  var i = 0;
  while (i < g_pricelist.length) {
//  while (g_pricelist[i][0]) {
    // priprav ID polozek v nasledujicim baliku dotazu
    let typeIds = '';
    let j = 0;
    
    while (g_pricelist[i+j][0] && j < batch) {
      typeIds += '&typeid=' + g_pricelist[i+j][1];
      j++;
    }

    if(typeIds) {
      // GET request na EVE Marketeer API pro market prices
      Logger.log(typeIds);
      var response = UrlFetchApp.fetch('https://api.evemarketer.com/ec/marketstat/json?regionlimit=10000002' + typeIds);

      // parsuj odpoved do pole struktur
      var json = response.getContentText();
      var data = JSON.parse(json);
//      Logger.log(data);

      data.forEach(function (item) {
        // najdi spravnou radku ve sheetu
        typeId = (item.buy.forQuery.types[0]).toString();
//        Logger.log('TypeId: ' + typeId);

        // find the row for fetched price
        let row = g_pricelist.findIndex(element => element[1] == typeId)

        if (row >= 0) {
          // price found, store it to the sheet
          pricelistSheet.getRange(2 + row, pricecolEVE + 2, 1, 15)
            .setValues([[
              (item.buy.fivePercent + item.sell.fivePercent) / 2,
              item.buy.min,
              item.buy.avg,
              item.buy.wavg,
              item.buy.median,
              item.buy.fivePercent,
              item.buy.max,
              item.buy.volume,
              item.sell.min,
              item.sell.avg,
              item.sell.wavg,
              item.sell.median,
              item.sell.max,
              item.sell.fivePercent,
              item.sell.volume
            ]]);
        }
      });
    }

    i+= batch;
  }
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
    res = {
      name: row[2],
      group: row[3],
      category: row[4],
      buyout: row[7],
      eveAverage: row[pricecolEVE - 1],
      eveAdjusted: row[pricecolEVE],
      jitaSplitTop5: row[pricecolEVE + 1],
      jitaBuyTop5: row[pricecolEVE + 6],
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
        "jitaBuyTop5": 0,
        "jitaSellTop5": 0
      }
    } else {

      // vytvor objekt s rozparsovanou cenou
      res = {
        "eveAverage": row[pricecolEVE - 1],
        "eveAdjusted": row[pricecolEVE],
        "jitaSplitTop5": row[pricecolEVE + 1],
        "jitaBuyTop5": row[pricecolEVE + 6],
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