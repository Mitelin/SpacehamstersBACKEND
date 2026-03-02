const Market = (()=>{
  const doctrinesCol = 12;     // first column with target doctrine names and amounts in the T2 Market sheet 
  const typesCol = 1;        // first column with target types and amounts in the T2 Market sheet 

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

      // clear target types table
      t2marketSheet.getRange(3, typesCol, 200, 2).setValue(["",""]);

      // Load target doctrines from the market sheet
      var doctrines = t2marketSheet.getRange(3, doctrinesCol, 99, 2).getValues();
      
//      console.log (doctrines);
      var doctrineNames = t2marketSheet.getRange(3, doctrinesCol, 99, 1).getValues().flat();
//      console.log (doctrineNames);

      // check for duplicities
      let hasDuplicity = false;
//      console.log(t2marketSheet.getRange(3, doctrinesCol, 1, 1).getBackground())
      t2marketSheet.getRange(3, doctrinesCol, 99, 1).setBackground('#efefef');  

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
      doctrines.forEach(doctrine => {
        if (doctrine[0] != '') {
          console.log(doctrine[0])
          var types = Doctrines.getDoctrine(doctrine[0]);
          console.log(types);

          // merge types to target types
          types.forEach(type => {
//            console.log (type);
            var targetTypeIndex = targetTypes.findIndex(element => element[0] == type.type);
            if (targetTypeIndex >= 0) {
//              console.log (targetTypeIndex);
              targetTypes[targetTypeIndex][1] += type.amount * doctrine[1];
            } else {
              targetTypes.push([type.type, type.amount * doctrine[1], type.isBuy])
            }

          });

          console.log (targetTypes);
        }
      });

      // store target types
      t2marketSheet.getRange(3, typesCol, targetTypes.length, 3).setValues(targetTypes);
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
        a.locationName,
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
}

function runUpdateBufferPrivateMarketOrders() {
  Market.updateBufferPrivateMarketOrders();
}

function runUpdateMarketOrders() {
  Market.updateMarketOrders();
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