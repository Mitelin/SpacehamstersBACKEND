var g_types

/*
 * Reads spreadsheet content to global array of types
 */
function initTypes () {
  // load types from spreadsheet
  Logger.log ('### Loading Types ...')
  var lastRow = typesSheet.getLastRow();

  if (lastRow > 1)
    g_types = typesSheet.getRange(2, 1, lastRow - 1, 6).getValues();
}

/*
 * Downloads type detail
 */
function downloadType(type_id) {

  // GET request type detail
  var options = {
    'method' : 'get',
    "headers" : {    
      'accept': 'application/json',
      'Accept-Language' : 'en',
      'Cache-Control': 'no-cache'
    }, 
    'muteHttpExceptions' : true
  };

  var url = eveApi + '/universe/types/' + type_id.toString() + '/?datasource=tranquility&language=en'
  var response;
  let retries = 3; // number of retries
  let rescode;

  do {
    retries--;
    response = UrlFetchApp.fetch(url, options);
    rescode = response.getResponseCode();
  } while (rescode === 504 && retries > 0);

  if (rescode != 200) {
    // failed
    throw ("HTTP request failed, code" + rescode)
  }

  // parse response to object
  var json = response.getContentText();
  var data = JSON.parse(json);
  Logger.log('>>> type Detail:')
  Logger.log(data);

  // fetch the group details
  group = getGroupCategory (data.group_id)

  // append type at the end of the types worksheet
  var row = 
    [ type_id
    , data.name
    , data.group_id
    , group.name
    , group.category_id
    , group.category_name
    ]
  typesSheet.appendRow(row);
  
  // reload types global array
  initTypes();

  return row;
}

/*
 * Translates type_id to name
 */
function getTypeName(type_id) {
  if (!g_types) initTypes();

  var type

  // look for type in the global array of types  
  if (g_types)
    type = g_types.find(element => element[0] == type_id)
  
  // if found, return type name in second column
  if (type) {
    return type[1]
  } else {
    // otherwise download the type detail
    type = downloadType(type_id)
    return type[1]
  }
}

/*
 * Retrieves type name, group and category details
 */
function getTypeGroup(type_id) {
  if (!type_id) return {}

  if (!g_types) initTypes();

  var type

  // look for character in the global array of types  
  if (g_types)
    type = g_types.find(element => element[0] == type_id)
  
  // if not found, downolad the type by id
  if (!type) {
    type = downloadType(type_id)
  }

  var record = {}
  record.type_id = type_id
  record.name = type[1]
  record.group_id = type[2] 
  record.group_name = type[3]
  record.category_id = type[4]
  record.category_name = type[5]
  return record
}

function translateNameId(name) {

  // POST request EVE universe API translate name to ID
  var options = {
    'method' : 'post',
    'contentType': 'application/json',
    "headers" : {    
      'accept': 'application/json',
      'Cache-Control': 'no-cache'
    },
    'payload' : JSON.stringify([name])
  };

  var url = eveApi + '/universe/ids/?datasource=tranquility&language=en-us'
  var response = UrlFetchApp.fetch(url, options);

  // parse response to object
  var json = response.getContentText();
  var data = JSON.parse(json);
  Logger.log('>>> Name Detail:')
  Logger.log(data);

  if (!data.inventory_types) {
    throw ("Položka s názvem >" + name + "< nebyla nalezena  ")
  }

  return data;
}

/*
 * Retrieves type name, group and category details
 */
function getTypeByName(name) {
  if (!name) return {}

  if (!g_types) initTypes();

  var type

  // look for character in the global array of types  
  if (g_types)
    type = g_types.find(element => element[1] == name)
  
  // if not found, downolad the type by id
  if (!type) {
    // fetch all objects that match the given name
    let data = translateNameId(name);

    // find an object that is the inventory_types type and matching name
    let result = data.inventory_types.find(obj => {
      return obj.name === name
    })

    if (result) {
      type = downloadType(result.id);
    } else {
      type = {}
    }
  }

  var record = {}
  record.type_id = type[0]
  record.name = type[1]
  record.group_id = type[2] 
  record.group_name = type[3]
  record.category_id = type[4]
  record.category_name = type[5]
  return record
}

function test() {
  rec = getTypeGroup(4316)
  Logger.log(rec)
}

function test_getTypeByName() {
  Logger.log(getTypeByName('Armor Reinforcement Charge'));
}
