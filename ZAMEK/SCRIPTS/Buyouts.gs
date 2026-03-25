/*
 * All functions to calculate buyout prices
 */ 
function getBuyOuts_() {
  if (globalThis.__zamekBuyOuts) return globalThis.__zamekBuyOuts;

  const getCachedTypeIdPrice_ = (typeId) => {
    priceList.init(true);
    const row = Array.isArray(priceList.l_data)
      ? priceList.l_data.find(element => element[1] == typeId)
      : null;
    if (!row) return null;

    return {
      name: row[2],
      group: row[3],
      category: row[4],
      buyout: row[7],
      eveAverage: row[pricecolEVE - 1],
      eveAdjusted: row[pricecolEVE],
      jitaSplitTop5: row[pricecolEVE + 1],
      jitaBuyAvg: row[pricecolEVE + 3],
      jitaBuyWavg: row[pricecolEVE + 4],
      jitaBuyTop5: row[pricecolEVE + 6],
      jitaSellAvg: row[pricecolEVE + 10],
      jitaSellWavg: row[pricecolEVE + 11],
      jitaSellTop5: row[pricecolEVE + 14]
    };
  };

  const getBuyoutPriceSafe_ = (typeId, allowNetworkFetch) => {
    try {
      if (allowNetworkFetch) return priceList.getTypeIdPrice(typeId);
    } catch (e) {
      // fall through to cached-only lookup
    }
    return getCachedTypeIdPrice_(typeId);
  };

  globalThis.__zamekBuyOuts = {

    /*
    * Fixes item names that start with an apostrophe - special char ignired by sheet when coopy/pasting
    */
    fixNames: function() {
      Logger.log('>>> BuyOuts.fixNames()');

      // activate the sheet
      buyoutSheet.activate()

      // fetch item names
      var lastRow = buyoutSheet.getLastRow();
      var range = buyoutSheet.getRange(2, 2, lastRow - 1, 1);
      let names = range.getValues();

      // fetch item details for new or updated items
      var i = 0;

      while (names[i][0]) {
        let name = names[i][0];
        let pos1 = name.indexOf(" '");
        let pos2 = name.indexOf("' ");
        if ((pos1 > pos2 || (pos1 == -1 && pos2 > 0)
            && name.charAt(0) != "'")) {
          Logger.log('>>> adding missing apostrophe at line ' + (i + 2));
          buyoutSheet.getRange(i + 2, 2, 1, 1).setValue("''" + name);
        }
        i++;
      }
      
    },

    /*
     * Copies calculated buout price to a new copy/paste friendly cell
     */
    copyPrice: function() {
      Logger.log('>>> BuyOuts.copyPrice()');

      // activate the sheet
      buyoutSheet.activate()

      var rangeIn = buyoutSheet.getRange(2, 11, 2, 1);
      let values = rangeIn.getValues();

      var rangeOut = buyoutSheet.getRange(2, 13, 2, 1);
      rangeOut.setValues([[Math.round(values[0][0])],[Math.round(values[1][0])]])
      
    },

    /*
     * Fetches all personal buyout contracts from EVE Api and calculates its buyout type and price
     */
    calculatePersonalContracts: function() {
      let allowNetworkFetch = true;
      try {
        refreshPricelistTycoon_({ silent: true });
      } catch (e) {
        allowNetworkFetch = false;
        try {
          SpreadsheetApp.getActive().toast(
            'Vykupy: refresh ceníku selhal, načítám kontrakty z posledních uložených cen.',
            'Vykupy',
            10
          );
        } catch (ee) {}
      }

      // Always reload the current pricelist sheet state before evaluating contracts.
      // If the refresh failed, this keeps the last known prices usable.
      priceList.init(true);

      // clear previous output
      buyoutSheet.getRange(2, 15, Math.max(1, buyoutSheet.getMaxRows() - 1), 9).clearContent();

      // fetch personal contracts
      let c = Eve.getPersonalContracts()
      //  console.log(c);

      // filter contracts
      let filtered = c.data.filter(x=> (
        x.status == 'outstanding' &&
        x.type == 'item_exchange'
      ))

      //  console.log(filtered);

      // map contract relevant data
      let rows = filtered.map(a => ([
        a.contract_id,
        Universe.getName(a.issuer_id).name,
        a.date_issued,
        a.date_expired,
        Universe.getLocationName(a.start_location_id),
        Number(a.price) || 0,
        0,
        '',
        a.title
      ]))

      console.log(rows);

      if (rows.length == 0) return;

      // process each contract
      rows.forEach(r => {
        let i = Eve.getPersonalContractItems(r[0]);
    //    console.log(i);

        // calculate contract price
        let buyout = 0;
        let category = ''
        let includedItems = i.data.filter(item => item.is_included !== false);
        let itemsToValue = includedItems.length > 0 ? includedItems : i.data;

        itemsToValue.forEach(item => {
          // get the item price
          let price = getBuyoutPriceSafe_(item.type_id, allowNetworkFetch);
          if (!price) return;
          buyout += price.buyout * item.quantity;
          
          // evaluate contract category
          if (category != 'loot') {
            if (!category) {
              // initial item decides on category
              if (price.category == 'Asteroid' || price.group == 'Mineral' || price.group == 'Ice Product'  || price.group == 'Moon Materials'  ) category = 'ore';
              else if (price.group == 'Salvaged Materials') category = 'salvage';
              else if (price.category == 'Planetary Commodities') category = 'PI';
              else category = 'loot'
              console.log ('initial category ' + category)
            } else {
              // check if category has changed
              if (category == 'ore' && !(price.category == 'Asteroid' || price.group == 'Mineral' || price.group == 'Ice Product'  || price.group == 'Moon Materials'  )) {
                category = 'loot';
                console.log ('changing category to ' + category)
              }
              if (category == 'salvage' && !(price.group == 'Salvaged Materials')) {
                category = 'loot';
                console.log ('changing category to ' + category)
              }
              if (category == 'PI' && !(price.category == 'Planetary Commodities')) {
                category = 'loot';
                console.log ('changing category to ' + category)
              }
            }
          }
        })

        // modify price based on category
        if (category == 'salvage') buyout = buyout / 0.95;

        // add calculated price to the row record
        r[6] = Math.round(buyout - r[5]);
        r[7] = category;
      })

      rows = rows.filter(r => Number(r[6]) >= 0);

      console.log(rows);

      if (rows.length == 0) return;

      buyoutSheet.getRange(2, 15, rows.length, 9).setValues(rows);

    }
  };

  return globalThis.__zamekBuyOuts;
}

/* Menu and Button friendly buyouts functions */
function fixBuyoutNames() {
  getBuyOuts_().fixNames();
}

function copyBuyoutPrice() {
  getBuyOuts_().copyPrice();
}

function calculatePersonalContracts() {
  getBuyOuts_().calculatePersonalContracts();
}
