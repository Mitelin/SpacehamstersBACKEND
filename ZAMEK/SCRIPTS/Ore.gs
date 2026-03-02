/* 
 * Ze sheetu načte název ore, zavolá API pro získání minerálů a zapíše do sheetu 
 */
function getOreMinerals() {
  oreSheet.activate();
  
  // zjisti nazev hledaneho ore a pripav payload dotazu
  var typeName = oreSheet.getRange(5,2,1,1).getValue();

  // vymaz puvodni hodnoty
  oreSheet.getRange(5,4,1,1).setValue('');
  oreSheet.getRange(6,2,8,1).setValue('');
  oreSheet.getRange(6,4,8,1).setValue('');

  var data = downloadOreMinerals(typeName);
//  console.log(data);

  if (data.length > 0) {
    // zapis mohutnost * 100
    oreSheet.getRange(5,4,1,1).setValue(data[0].portionSize * 100);
    for (let i = 0; i < data.length && i < 8; i++) {
      oreSheet.getRange(6 + i,2,1,1).setValue(data[i].typeName);
      oreSheet.getRange(6 + i,4,1,1).setValue(data[i].quantity * 100);
    }
  }
}


/* 
 * Zavola custom API na zpracovani blueprintu 
 */
function downloadOreMinerals (typeName) {
  var req = {}
  req.typeName = typeName

  // zavolej API kalkulace
  var options = {
    'method' : 'post',
    'contentType': 'application/json',
    'payload' : JSON.stringify(req)
  };
  var response = UrlFetchApp.fetch("https://aubi.synology.me:4444/api/ore/material", options);

  // parsuj odpoved do pole struktur
  var json = response.getContentText();
  var data = JSON.parse(json);

  return data;
}

function testOre() {
  console.log(calculateOrePrice('Clutch Restrained Warp Disruption Field Generator', 0.5, 0.1, 0.2, ''));
}

/*
 * Spocita varianty vykupni ceny
 * - typeName - nazev ore
 * - efficiency - efektivita reprocessu - desetinne cislo
 * - taxrate - sazba dane za reproces - desetinne cislo
 * - margin - pozadovana marze - desetinne cislo
 */
function calculateOrePrice (typeName, efficiency, taxRate, margin, mineralsText) {

  const multi = 100;    // s jakym nasobkem reprocessovaneho mnozstvi budeme kalkulovat - kvuli odpadu reprocessu po zaokrouhleni

  // stahni slozeni mineralu
  if (!mineralsText) {
    var minerals = downloadOreMinerals(typeName.trim());
    console.log(minerals)
  } else {
    var minerals = JSON.parse(mineralsText);
  }

//  if (!minerals[0]) throw (">" + typeName + "< nenalezen blueprint");
  if (!minerals[0]) return {};

  // spocitej ceny
  var value = 0;      // kumulativni cena mineralu
  var tax = 0;        // kumulativni zaplacena dan
  var jitaBuy = 0;    // kumulativni jira buy cena
  var jitaSplit = 0;  // kumulativni jita split cena
  var jitaSell = 0;   // kumulativni jita sell cena

  // zjisti reprocessovane mnozstvi ore
  var portionSize = minerals[0].portionSize;

  // zpracuj jednotlive mineraly
  minerals.forEach(function (mineral) {
    // zjisti cenu ore
    let price = priceList.getPrice(mineral.typeName);             // jednotkove ceny reprocseovaneho mineralu
    if (!price) throw (">" + typeName + "< nenalezena cena pro " + mineral.typeName);
    let reprocessed = mineral.quantity * multi * efficiency;      // mnozstvi reprocessovaneho mineralu
    tax += reprocessed * price.eveAdjusted * taxRate;             // dan za reproces, mnozstvi reprocesovaneho mineralu + eve Adjusted cena * sazba dane
    jitaBuy += reprocessed * price.jitaBuyTop5;
    jitaSplit += reprocessed * price.jitaSplitTop5;
    jitaSell += reprocessed * price.jitaSellTop5;
  })

  var res = {
    "jitaBuy": (jitaBuy - tax) / portionSize / multi * (1-margin),
    "jitaSplit": (jitaSplit - tax) / portionSize / multi * (1-margin),
    "jitaSell": (jitaSell - tax) / portionSize / multi * (1-margin),
    "minerals" : minerals
  }

  return res;
}
