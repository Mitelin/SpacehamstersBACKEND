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
      console.log (doctrines[0][col]);
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
      console.log(item);
      if (item) {
        // zsjisti a zapis ID blueptintu
        var blueprintTypeId = getBlueprintId (item);
        if (!blueprintTypeId) {
          SpreadsheetApp.getUi().alert('Chyba!', 'Blueprint ' + item + ' nenalezen', SpreadsheetApp.getUi().ButtonSet.OK);
          return null;
        }

        types.push({"typeId": blueprintTypeId, "amount": doctrines[row][col + 1]})
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
  var getFinishedJobProducts = function (plannedJobs, deliveredJobs, hangarId) {
    var ret = [];
    // filter delivered jobs for output location in selected hangar
    let filteredJobs;
    if (hangarId) {
      filteredJobs = deliveredJobs.filter(item => item.outputLocationId == hangarId);
    } else {
      filteredJobs = deliveredJobs;
    }
    // console.log(filteredJobs);

    filteredJobs.forEach(job => {
//     console.log(job);

      // find blueprint info
      var plannedJob = plannedJobs.findIndex(element => element[0] == job.productName && element[1] == job.blueprintName);
  //    console.log(plannedJob);
      if (plannedJob >= 0) {
          let batchSize = plannedJobs[plannedJob][8];
          let runs = job.successfulRuns;
          
          // apply Symmetry Decryptor bonus for invention
          if (job.activityName == 'Invention') batchSize += 2;

          // calculate copied BPC runs instead of number of BPCs
          if (job.activityName == 'Copying') {
            runs *= job.licensedRuns;
          }

          console.log("Finished " + job.activityName + " " + runs + " runs of " + job.productName + " from " + job.blueprintName + " in batch of " + batchSize + " items");
          ret.push([job.productName, runs * batchSize])
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
    newJobs.forEach(job => {
  //   console.log(job);
      // find blueprint info
      var plannedJob = plannedJobs.findIndex(element => element[0] == job.productName && element[1] == job.blueprintName);
  //    console.log(plannedJob);
      if (plannedJob >= 0) {
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
            let blueprint = blueprints.findIndex(element => element.itemId == job.blueprintId);
            if (blueprint >= 0) {
              // console.log(blueprints.data[blueprint])
              bpME = blueprints[blueprint].materialEfficiency
            }

          } else if (job.activityName == 'Reaction') {
            rigBonus = 0.974;
          }

          console.log("Started " + job.activityName + " " + job.runs + " runs of " + job.productName + " from " + job.blueprintName + " id " + job.blueprintId + " ME " + bpME + " material " + materials + " advanced " + isAdvanced);

          materialsJSON = JSON.parse(materials);
          materialsJSON.forEach(material => {
  //          console.log("base quantity " + material.base_quantity + " roleBonus " + roleBonus + " rigBonus " + rigBonus + " bpME " + bpME)
            if (material.base_quantity) {
              let amount = Math.ceil(material.base_quantity * job.runs * roleBonus * rigBonus * (1.0 - bpME / 100.0));
              console.log("loc: " + job.outputLocationId + " material " + material.type + " amount " + amount)

              let pos = ret.findIndex(i => i[0] == material.type && i[2] == job.outputLocationId && i[3] == isAdvanced && i[4] == job.activityName);
              if (pos > 0) {
                console.log('updating at pos ' + pos)
                ret[pos][1] -= amount;
              } else {
                console.log('inserting ...')
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
          // pokud nazev itemu zacina na [, jedna se o nazev doktryny - nacti celou doktrynu
          if (item.startsWith('[')) {
            // nacti polozky z doktryny
            var docItems = getDoctrine(item);

            // pridej jednotlive polozky do seznamu
            docItems.forEach(docItem => {
              types.push({"typeId": docItem.typeId, "amount": docItem.amount * blueprints[bpr][1]})
            });

          } else {
            // zjisti a zapis ID blueptintu
            var blueprintTypeId = getBlueprintId (blueprints[bpr][0]);
            if (!blueprintTypeId) {
              SpreadsheetApp.getUi().alert('Chyba!', 'Blueprint nenalezen', SpreadsheetApp.getUi().ButtonSet.OK);
              return;
            }

            types.push({"typeId": blueprintTypeId, "amount": blueprints[bpr][1]})
          }
        }
      }

      // priprav JSON objekt requestu
      var req = {}
      req.types = types;
      req.shipT1ME = params[5][0];
      req.shipT1TE = 10;
      req.shipT2ME = params[6][0];
      req.shipT2TE = 0;
      req.moduleT1ME = 10;
      req.moduleT1TE = 10;
      req.moduleT2ME = params[7][0];
      req.moduleT2TE = 0;
      req.produceFuelBlocks=(params[8][0] == 'Ne')?false:true;
      req.buildT1=(params[9][0] == 'Ne')?false:true;
      req.copyBPO=(params[10][0] == 'Ne')?false:true;

      // zavolej API kalkulace
      var options = {
        'method' : 'post',
        'contentType': 'application/json',
        'payload' : JSON.stringify(req)
      };
      var response = UrlFetchApp.fetch(aubiApi + "/blueprints/calculate", options);

      // parsuj odpoved do pole struktur
      var json = response.getContentText();
      var data = JSON.parse(json);
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
      if (!sheet) {
        // zjisti otevreny sheet, ze ktereho je skript spusteny
        sheet = SpreadsheetApp.getActive().getActiveSheet();
        validateActiveSheet(sheet);
      }
      var lastRow = sheet.getLastRow();

      // open sidebar
//      Sidebar.open();
//      Sidebar.add("Mažu stav skladů a jobů");

      // clear running jobs column
      range = sheet.getRange(firstDataRow, colJobs, maxJobs, 1);
      range.setValue("");

      // clear required products column
      range = sheet.getRange(firstDataRow, colJobs + 1, maxJobs, 1);
      range.setValue(0);

      // clear required input materials
      range = sheet.getRange(firstDataRow, colInput + 9, maxJobs, 6);
      range.setValue(0);

      // clear job run costs and note
      range = sheet.getRange(firstDataRow, colRunCost, maxJobs, 2);
      range.setValue("");


      // initiate arrays
      var plannedJobs = sheet.getRange(firstDataRow, 1, maxJobs, 22).getValues();
      var inputMaterials = sheet.getRange(firstDataRow, colInput, maxJobs, 21).getValues();
//      var manufactureMaterials = sheet.getRange(firstDataRow, colManuf, maxJobs, 2).getValues();
//      var reactionMaterials = sheet.getRange(firstDataRow, colReact, maxJobs, 2).getValues();
//      var interimMaterials = sheet.getRange(firstDataRow, colManufBuffer, maxJobs, 2).getValues();                      // asi rozsirit na dalsi hangar

      // read cost indices
      var range = sheet.getRange(3, 9, 8, 1);
      var costIndices = range.getValues();
      let manufacturingSystemCost = costIndices[0][0];
      let manufacturingBonus = costIndices[1][0];
      let reactionSystemCost = costIndices[2][0];
      let reactionBonus = costIndices[3][0];
      let copySystemCost = costIndices[4][0];
      let copyBonus = costIndices[5][0];
      let inventionSystemCost = costIndices[6][0];
      let inventionBonus = costIndices[7][0];

      // zjisti ze sheetu parametry blueprintu
      range = sheet.getRange(1, 2, 11, 1);
      var params = range.getValues();
      var useBufferHangars = (params[3][0] == 'Ne')?false:true;

      // load prices
      priceList.init();

      /* 
      * Update quantities in running jobs
      */
      var range = sheet.getRange(firstDataRow, colJobsList, lastRow, 5);
      var jobs = range.getValues();
      
      jobs.forEach(job => {
        if (job[3]) {
          // find corresponding row in planned jobs
          var plannedJob = plannedJobs.findIndex(element => element[1] == job[3] && element[3] == job[2]);
          if (plannedJob >= 0) {
            // found!
            range = sheet.getRange(firstDataRow + plannedJob, colJobs, 1, 1);
    //        let quantity = range.getValue()
    //        range.setValue(job[1] * plannedJobs[plannedJob][8] + quantity);
            if (job[2] == "Copying") {
              // for copying activity calculate output BPC number of runs
              plannedJobs[plannedJob][11] = job[4] * job[1] * plannedJobs[plannedJob][8] + Number(plannedJobs[plannedJob][11]);
            } else if (job[2] == "Invention") {
              // for invention activity calculate number of output items ... apply Symetry Decryptor runs + 2 ... 
              // TODO: apply probability
              plannedJobs[plannedJob][11] = job[1] * (plannedJobs[plannedJob][8] + 2) + Number(plannedJobs[plannedJob][11]);
            } else {
              // for other activities calculate number of output items
              plannedJobs[plannedJob][11] = job[1] * plannedJobs[plannedJob][8] + Number(plannedJobs[plannedJob][11]);
            }
            range.setValue(plannedJobs[plannedJob][11]);
          }
        }
      })

      /*
       * Calculate how much material is needed for each job
       */
      let i = plannedJobs.length - 1;

      // skip empty rows at the end
      while (i >= 0) {
        if (plannedJobs[i][0]) break;
        i--;
      }

      if (i == -1) {
        throw ("Není spočítaná výroba")
      }

      // process jobs from the final product
      do {
        let product = plannedJobs[i][0];
        let action = plannedJobs[i][3];
        let total = plannedJobs[i][6];
        let materials = JSON.parse(plannedJobs[i][7]);
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

        console.log(">>> Product [" + i + "]: " + product + " action " + action + " Total: " + total + " batchSize: " + batchSize + " required: " + required + " inprogress: " + inprogress + " ready: " + ready);

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
              console.log("::: Material: " + material.type + " quantity: " + material.quantity);

              let pos = plannedJobs.findIndex(element => element[0] == material.type);
              if (pos >= 0) {
                // if job is found, increase job output amount
                // recalculate required amount by batchsize
                if (plannedJobs[pos][3] == "Copying") {
                  // BPO Copy activity, calculate needed BPC runs as todo / BPC batch size
                  plannedJobs[pos][12] += Math.ceil(todo / plannedJobs[pos][8]);
                  
                } else if (plannedJobs[pos][3] == "Invention") {
                  // BPC Invention activity, calculate needed items and deduct running T2 BPCs from available BPCs
                  console.log ("Invention [" + pos + "] " + plannedJobs[pos][0] + " in progress " + plannedJobs[pos][11] + " on stock " + plannedJobs[pos][13]);
                  console.log ("- manuf in progress " + inprogress + " ready " + ready + " required " + required);
                  console.log ("- material.quantity " + material.quantity + " todo " + todo + " total " + total);
                  plannedJobs[pos][12] += Math.ceil(material.quantity * todo / total);

                } else {
                  // other activity, calculate needed items
                  plannedJobs[pos][12] += Math.ceil(material.quantity * todo / total);
                }
//                  log = log + "\n" + material.type + " volume " + Math.ceil(material.quantity * todo / total)
              } else {
                // job not found, look in input materials
                let pos = inputMaterials.findIndex(element => element[0] == material.type);
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

      // update the planned job status and run cost
      i = 0;
      let bpos = Corporation.loadBPOs();                // load BPOs from cache
      let allJobs = Corporation.getJobsCached();    // load all corporation jobs in all hangars
      let allRunningJobs = allJobs.data.filter(item => item.status == 'active');   // filter only running jobs
      console.log(allRunningJobs)

      do {
        let product = plannedJobs[i][0];
        let blueprint = plannedJobs[i][1];
        let action = plannedJobs[i][3];
        let runs = plannedJobs[i][4];
        let materials = JSON.parse(plannedJobs[i][7]);
        let isAdvanced = plannedJobs[i][9];
        let inprogress = plannedJobs[i][11];
        let required = plannedJobs[i][12];
        let ready = plannedJobs[i][13];

        // update job status
        if (ready >= required) {
          sheet.getRange(firstDataRow + i, 11, 1, 1).setValue('Hotovo')
        } else if (ready + inprogress >= required) {
          sheet.getRange(firstDataRow + i, 11, 1, 1).setValue('Běží')
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

              // find amount in input materials
              let materialRecord = inputMaterials.find(element => element[0] == material.type);
              if (materialRecord) {
                materialVolume += materialRecord[15 + sourceHangar];
              }

              // find amount in job output
              let jobRecord = plannedJobs.find(element => element[0] == material.type);
              if (jobRecord) {
                materialVolume += jobRecord[14 + sourceHangar];
                if (sourceHangarAlt) materialVolume += jobRecord[14 + sourceHangarAlt];
              }



/*
              // find material in hangar
              let hangarRecord = null;
              let hangarRecordInterim = null;
              let materialVolume = 0;

              if (action =='Reaction') {
                hangarRecord = reactionMaterials.find(element => element[0] == material.type);
              } else {
                hangarRecord = manufactureMaterials.find(element => element[0] == material.type)
                hangarRecordInterim = interimMaterials.find(element => element[0] == material.type)
              }

              if (hangarRecord) {
                materialVolume = hangarRecord[1];
              }
              if (hangarRecordInterim) {
                materialVolume += hangarRecordInterim[1];
              }
*/
              // material quantity for one run must be less than material available in hangar to start job
              if ((material.quantity / runs) > materialVolume) {
                log = log + "\n" + material.type + " " + (material.quantity / runs - materialVolume)
                canStart = false;
              }
            })
          }

          // BPO must be available for copy job
          if (action == "Copying" && canStart) {
            // find BPO
            let jobBPOs = bpos.filter(item => item.blueprint == blueprint);
            console.log(jobBPOs);

            // find running job for every BPO
            let jobBPOsRunning = jobBPOs.map(a => ({
              itemId : a.blueprintId,
              job: allRunningJobs.find(item => item.blueprintId == a.blueprintId)
            }));

            console.log(jobBPOsRunning)

            let jobFreeBPOs = jobBPOsRunning.filter(item => item.job == null);
            console.log(jobFreeBPOs);

            if (jobFreeBPOs.length == 0) {
              canStart = false;
              log = log + "\n- Není volné BPO!";
            }

          }

          if (canStart)
            sheet.getRange(firstDataRow + i, 11, 1, 1).setValue('Připraveno')
          else {
            sheet.getRange(firstDataRow + i, 11, 1, 1).setValue('Čeká')
            sheet.getRange(firstDataRow + i, colRunCost + 1, 1, 1).setValue(log);
          }
        }

        // update required products amount
        sheet.getRange(firstDataRow + i, 13, 1, 1).setValue(required)


        // Update job run cost
        let runcost = 0;

        if (action == 'Manufacturing') {
          // calculate base input material cost * required runs
          if (!materials) throw ("Výroba " + product + "nemá definovaný materiál");

          // calculate Estimated item value as SUM (all materials with base quantity) Material base quantity x job runs × Material adjusted price 
          // (blueprints must not be included)
          materials.forEach(material => {
            if (!material.type.endsWith("Blueprint")) {
              // get adjusted material price
              let price = priceList.getPrice(material.type);
              if (!price) throw ("Nenalezena cena za materiál: " + material.type);
              // calculate 
              runcost = runcost + material.base_quantity * runs * price.eveAdjusted;
              console.log("Estimated item value: " + runcost)
            }
          })

          // apply Manufacturing: System cost Index
          runcost = runcost * manufacturingSystemCost;

          // apply Manufacturing: Tax+Struct. bonus
          runcost = runcost + runcost * manufacturingBonus;

        } else if (action == 'Reaction') {
          // calculate base input material cost * required runs
          if (!materials) throw ("Reakce " + product + "nemá definovaný materiál");

          // calculate Estimated item value as SUM (all materials) Material base quantity x job runs × Material adjusted price 
          materials.forEach(material => {
            // get adjusted material price
            let price = priceList.getPrice(material.type);
            if (!price) throw ("Nenalezena cena za materiál: " + material.type);
            // calculate 
            runcost = runcost + material.base_quantity * runs * price.eveAdjusted;
            console.log("Estimated item value: " + runcost)
          })

          // apply Manufacturing: System cost Index
          runcost = runcost * reactionSystemCost;

          // apply Manufacturing: Tax+Struct. bonus
          runcost = runcost + runcost * reactionBonus;

        } else if (action == 'Invention') {

          // calculate Estimated item value as Final product adjusted price
          let finalProduct = product.substring(0, product.length - 10);
          let price = priceList.getPrice(finalProduct);
          if (!price) throw ("Nenalezena cena za materiál: " + finalProduct);
          runcost = runs * price.eveAdjusted * 0.02;

          // apply Invention: System cost Index
          runcost = runcost * inventionSystemCost;

          // apply Invention: Tax+Struct. bonus
          runcost = runcost + runcost * inventionBonus;
        }

        // update job runcost
        sheet.getRange(firstDataRow + i, colRunCost, 1, 1).setValue(runcost);

        // move to the next item
        i++;
      } while (plannedJobs[i][0]);

      // update the input material requied amount
      i = 0;
      do {
        // update required products amount and status color
        let field = sheet.getRange(firstDataRow + i, colInput + 9, 1, 6);
        field.setValues([[inputMaterials[i][9], inputMaterials[i][10], inputMaterials[i][11], inputMaterials[i][12], inputMaterials[i][13], inputMaterials[i][14]]]);

        // move to the next item
        i++;
      } while (inputMaterials[i][0]);


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
      if (!sheet) {
        // zjisti otevreny sheet, ze ktereho je skript spusteny
        sheet = SpreadsheetApp.getActive().getActiveSheet();
        validateActiveSheet(sheet);
      }
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
        itemsPersonal = Personal.getAssets(personalHangars);
        Sidebar.add("- počet " + itemsPersonal.data.length + " ks");
        Sidebar.add("- stáří " + (itemsPersonal.age / 60).toFixed(2) + " m");
        Sidebar.add("- refresh " + (itemsPersonal.cacheRefresh / 60).toFixed(2) + " m");
        if (itemsPersonal.age > maxAge) maxAge = itemsPersonal.age;
        sheet.getRange(5, colLog, 1, 1).setValue((itemsPersonal.age / 60).toFixed(2) + " m");
        sheet.getRange(5, colLog + 1, 1, 1).setValue((itemsPersonal.cacheRefresh / 60).toFixed(2) + " m");

        Sidebar.add("Čtu osobní joby");
        jobsPersonal = Personal.getJobs(personalHangars);
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
      console.log(hangars)

      /* 
      * Update hangars 
      */

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

      // get corporate hangars content
//      var items = getItemsDirect(hangars);
      Sidebar.add("Čtu korporátní sklad");
      var items = Corporation.getAssetsCached(hangars);
      Sidebar.add("- počet " + items.data.length + " ks");
      Sidebar.add("- stáří " + (items.age / 60).toFixed(2) + " m");
      Sidebar.add("- refresh " + (items.cacheRefresh / 60).toFixed(2) + " m");
      if (items.age > maxAge) maxAge = items.age;
      sheet.getRange(1, colLog, 1, 1).setValue(new Date());
      sheet.getRange(3, colLog, 1, 1).setValue((items.age / 60).toFixed(2) + " m");
      sheet.getRange(3, colLog + 1, 1, 1).setValue((items.cacheRefresh / 60).toFixed(2) + " m");

      Sidebar.add("Čtu korporátní joby");
      var jobs = Corporation.getJobsCached(hangars);
      Sidebar.add("- počet " + jobs.data.length + " ks");
      Sidebar.add("- stáří " + (jobs.age / 60).toFixed(2) + " m");
      Sidebar.add("- refresh " + (jobs.cacheRefresh / 60).toFixed(2) + " m");
      if (jobs.age > maxAge) maxAge = jobs.age;
      Sidebar.add("<b>Nejstarší data " + (maxAge / 60).toFixed(2) + " m</b>");
      sheet.getRange(4, colLog, 1, 1).setValue((jobs.age / 60).toFixed(2) + " m");
      sheet.getRange(4, colLog + 1, 1, 1).setValue((jobs.cacheRefresh / 60).toFixed(2) + " m");

      // get corporation blueprints
      Sidebar.add("Čtu korporátní blueprinty");
      var bpcs = Corporation.getBlueprintsCached(hangarsBPC);
      Sidebar.add("- počet " + bpcs.data.length + " ks");
      Sidebar.add("- stáří " + (bpcs.age / 60).toFixed(2) + " m");
      Sidebar.add("- refresh " + (bpcs.cacheRefresh / 60).toFixed(2) + " m");
      if (bpcs.age > maxAge) maxAge = bpcs.age;


      // planned jobs, to get info of the blueprint
      var plannedJobs = sheet.getRange(firstDataRow, 1, maxJobs, 22).getValues();

      // prepare data for material used for jobs started after the hangars were updated
      let newJobs = jobs.data.filter(job => job.startTime > items.lastModified);
      let blueprintsAll = Corporation.getBlueprintsCached();
      var newJobMaterials = getMaterialsForNewJobs(plannedJobs, newJobs, blueprintsAll.data)
      console.log (newJobMaterials);

      // prepare data for jobs delivered after hangars were updated
      // all jobs, even those completed
      var alljobs = Corporation.getJobsCached(hangars, true);
      // filter all jobs delivered after the corporate items cache update
      let deliveredJobs = alljobs.data.filter(job => job.status == 'delivered' && job.completedTime > items.lastModified);
      console.log('deliveredJobs');
      console.log(deliveredJobs);


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
          range.setValues(rows);
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
          range.setValues(rows);
        }
      }
      // add job products delivered after corporate items cache updated
//      let finishedItems = getFinishedJobProducts  (plannedJobs, deliveredJobs, hangarM.locationID);
      let finishedItems = []
      if (hangarM && (hangarM.length > 0)) {
        hangarM.forEach(hangar => finishedItems = finishedItems.concat(getFinishedJobProducts  (plannedJobs, deliveredJobs, hangar.locationID)))
      }

      if (finishedItems.length > 0) {
        console.log(finishedItems);
        range = sheet.getRange(firstDataRow + corpItems + persItems + 1, colManuf, finishedItems.length, 2);
        range.setValues(finishedItems);
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
        console.log(deductedItems);
        deductedItemsShort = deductedItems.map(i => ([i[0], i[1]]));
        console.log(deductedItemsShort)
        range = sheet.getRange(firstDataRow + corpItems + persItems + finishedItems.length + 2, colManuf, deductedItems.length, 2);
        range.setValues(deductedItemsShort);
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
          range.setValues(rows);
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
          range.setValues(rows);
        }
      }
      // add job products delivered after corporate items cache updated
      finishedItems = getFinishedJobProducts  (plannedJobs, deliveredJobs, hangarR.locationID);
      if (finishedItems.length > 0) {
        console.log(finishedItems);
        range = sheet.getRange(firstDataRow + corpItems + persItems + 1, colReact, finishedItems.length, 2);
        range.setValues(finishedItems);
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
        console.log(deductedItems);
        deductedItemsShort = deductedItems.map(i => ([i[0], i[1]]));
        console.log(deductedItemsShort)
        range = sheet.getRange(firstDataRow + corpItems + persItems + finishedItems.length + 2, colReact, deductedItems.length, 2);
        range.setValues(deductedItemsShort);
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
          range.setValues(rows);
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
          range.setValues(rows);
        }
      }
      // add job products delivered after corporate items cache updated
      if (hangarMB) {
      finishedItems = getFinishedJobProducts  (plannedJobs, deliveredJobs, hangarMB.locationID);
        if (finishedItems.length > 0) {
          console.log(finishedItems);
          range = sheet.getRange(firstDataRow + corpItems + persItems + 1, colManufBuffer, finishedItems.length, 2);
          range.setValues(finishedItems);
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
          console.log(deductedItems);
          deductedItemsShort = deductedItems.map(i => ([i[0], i[1]]));
          console.log(deductedItemsShort)
          range = sheet.getRange(firstDataRow + corpItems + persItems + finishedItems.length + 2, colManufBuffer, deductedItems.length, 2);
          range.setValues(deductedItemsShort);
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
          range.setValues(rows);
        }
      }
      if (hangarRB) {
        // add job products delivered after corporate items cache updated
        finishedItems = getFinishedJobProducts  (plannedJobs, deliveredJobs, hangarRB.locationID);
        if (finishedItems.length > 0) {
          console.log(finishedItems);
          range = sheet.getRange(firstDataRow + corpItems + persItems + 1, colReactBuffer, finishedItems.length, 2);
          range.setValues(finishedItems);
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
          console.log(deductedItems);
          deductedItemsShort = deductedItems.map(i => ([i[0], i[1]]));
          console.log(deductedItemsShort)
          range = sheet.getRange(firstDataRow + corpItems + persItems + finishedItems.length + 2, colReactBuffer, deductedItems.length, 2);
          range.setValues(deductedItemsShort);
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
          range.setValues(rows);
        }
      }
      // add job products delivered after corporate items cache updated
      finishedItems = getFinishedJobProducts  (plannedJobs, deliveredJobs, hangarRes.locationID);
      if (finishedItems.length > 0) {
        console.log(finishedItems);
        range = sheet.getRange(firstDataRow + corpItems + persItems + 1, colResearch, finishedItems.length, 2);
        range.setValues(finishedItems);
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
          range.setValues(rows);
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
          console.log(finishedItems);
          range = sheet.getRange(firstDataRow + corpItems + persItems + 1, colResearchBuffer, finishedItems.length, 2);
          range.setValues(finishedItems);
        }
        // deduct material usage from new jobs started after items cache updated
        deductedItems = newJobMaterials.filter(i => (i[4] == 'Copying' || i[4] == 'Invention'))
        if (deductedItems.length > 0) {
          console.log(deductedItems);
          deductedItemsShort = deductedItems.map(i => ([i[0], i[1]]));
          console.log(deductedItemsShort)
          range = sheet.getRange(firstDataRow + corpItems + persItems + finishedItems.length + 2, colResearchBuffer, deductedItems.length, 2);
          range.setValues(deductedItemsShort);
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
      bpcs.data.forEach( bpc => {
        console.log(bpc);
        let i = alljobs.data.findIndex(j => (j.blueprintId == bpc.itemId && (j.status == 'active' || j.completedTime > bpcs.lastModified)));
        console.log (i);
        console.log(alljobs.data[i]);
        if (i>=0) bpc.runs -= alljobs.data[i].runs;
      })


      // store items to sheet BPC table
      if (bpcs.data.length > 0) {
        // store items in hangar to sheet hangar table
        var rows = bpcs.data.map(a => [a.typeName, a.runs, 1]);
        range = sheet.getRange(firstDataRow, colBPC, rows.length, 3);
        range.setValues(rows);
      }

      // add copy and research job products delivered after corporate Blueptint cache updated
      let deliveredResearchJobs = alljobs.data.filter(job => (
        (job.activityName == 'Copying' || job.activityName == 'Invention') && 
        job.status == 'delivered' &&
        job.completedTime > bpcs.lastModified
      ))
      console.log(deliveredResearchJobs);
      finishedItems = getFinishedJobProducts  (plannedJobs, deliveredResearchJobs);
      if (finishedItems.length > 0) {
        console.log(finishedItems);
        range = sheet.getRange(firstDataRow + bpcs.data.length + 1, colBPC, finishedItems.length, 2);
        range.setValues(finishedItems);
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
        var rows = jobsFiltered.map(a => [(a.duration >0) ? Universe.durationToString(a.duration) : "Done", a.runs, a.activityName, a.blueprintName, a.licensedRuns, '', '', a.installerName, a.startDate, a.endDate]);
        range = sheet.getRange(firstDataRow, colJobsList, rows.length, 10);
        range.setValues(rows);
      }

      // store personal jobs
      if (jobsPersonal && jobsPersonal.data && jobsPersonal.data.length > 0) {
        // store items in hangar to sheet hangar table
        var rows = jobsPersonal.data.map(a => [(a.duration >0) ? Universe.durationToString(a.duration) : "Done", a.runs, a.activity_name, a.blueprint_name]);
        range = sheet.getRange(firstDataRow + corpItems, colJobsList, rows.length, 4);
        range.setValues(rows);
      }

      // recalculate project
      this.recalculateProject(sheet, notify);

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
      req.moduleT1ME = 0;
      req.moduleT2ME = 0;
      req.moduleT2ME = 0;
      req.produceFuelBlocks = false;
      req.buildT1 = false;
      req.copyBPO = false;

      // zavolej API kalkulace
      var options = {
        'method' : 'post',
        'contentType': 'application/json',
        'payload' : JSON.stringify(req)
      };
      var response = UrlFetchApp.fetch(aubiApi + "/blueprints/calculate", options);

      // parsuj odpoved do pole struktur
      var json = response.getContentText();
      var data = JSON.parse(json);
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

  Blueprints.updateProject(SpreadsheetApp.getActive().getSheetByName('Projekt ALPRO 1'), false);
  Blueprints.updateProject(SpreadsheetApp.getActive().getSheetByName('Projekt ALPRO 2'), false);
  Blueprints.updateProject(SpreadsheetApp.getActive().getSheetByName('Projekt ALPRO 3'), false);
  Blueprints.updateProject(SpreadsheetApp.getActive().getSheetByName('Projekt ALPRO 4'), false);
  Blueprints.updateProject(SpreadsheetApp.getActive().getSheetByName('Projekt ALPRO 5'), false);
  Blueprints.updateProject(SpreadsheetApp.getActive().getSheetByName('Projekt ALPRO 6'), false);
  Blueprints.updateProject(SpreadsheetApp.getActive().getSheetByName('Projekt ALPRO 7'), false);

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