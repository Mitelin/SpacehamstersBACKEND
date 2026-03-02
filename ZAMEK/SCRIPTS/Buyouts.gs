/*
 * All functions to calculate buyout prices
 */ 
const BuyOuts = (()=>{
  return {

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
      // clear sheet
      buyoutSheet.getRange(2, 15, 20, 9).setValue('');

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
        a.price,
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
        i.data.forEach(item => {
          // get the item price
          let price = priceList.getTypeIdPrice(item.type_id);
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

      console.log(rows);

      buyoutSheet.getRange(2, 15, rows.length, 9).setValues(rows);

    }
  }
})()

/* Menu and Button friendly buyouts functions */
function fixBuyoutNames() {
  BuyOuts.fixNames();
}

function copyBuyoutPrice() {
  BuyOuts.copyPrice();
}

function calculatePersonalContracts() {
  BuyOuts.calculatePersonalContracts();
}