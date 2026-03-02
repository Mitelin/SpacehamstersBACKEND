var g_groups

/*
 * Reads spreadsheet content to global array of groups
 */
function initGroups () {
  // load groups from spreadsheet
  Logger.log ('### Loading Groups ...')
  var lastRow = groupsSheet.getLastRow();

  if (lastRow > 1)
    g_groups = groupsSheet.getRange(2, 1, lastRow - 1, 3).getValues();
}

/*
 * Downloads group detail
 */
function downloadGroup(group_id) {

  // GET request group detail
  var options = {
    'method' : 'get',
    "headers" : {    
      'accept': 'application/json'
    }
  };

  var url = eveApi + '/universe/groups/' + group_id.toString() + '/?datasource=tranquility'
  var response = UrlFetchApp.fetch(url, options);

  // parse response to object
  var json = response.getContentText();
  var data = JSON.parse(json);
  Logger.log('>>> group Detail:')
  Logger.log(data);

  // append group at the end of the groups worksheet
  var row = 
    [ group_id
    , data.name
    , data.category_id
    ]
  groupsSheet.appendRow(row);
  
  // reload groups global array
  initGroups();

  return row;
}

/*
 * Translates group_id to name
 */
function getGroupName(group_id) {
  if (!g_groups) initGroups();

  var group

  // look for vharacter in the global array of groups  
  if (g_groups)
    group = g_groups.find(element => element[0] == group_id)
  
  // if found, return group name in second column
  if (group) {
    return group[1]
  } else {
    // otherwise download the group detail
    group = downloadGroup(group_id)
    return group[1]
  }
}

/*
 * Translates group_id to name and group
 */
function getGroupName(group_id) {
  if (!g_groups) initGroups();

  var group

  // look for vharacter in the global array of groups  
  if (g_groups)
    group = g_groups.find(element => element[0] == group_id)
  
  // if found, return group name in second column
  if (group) {
    return group[1]
  } else {
    // otherwise download the group detail
    group = downloadGroup(group_id)
    return group[1]
  }
}

/*
 * Retrieves group name and category details
 */
function getGroupCategory(group_id) {
  if (!g_groups) initGroups();

  var group
  var record = {}
  record.group_id = group_id

  // look for vharacter in the global array of groups  
  if (g_groups)
    group = g_groups.find(element => element[0] == group_id)
  
  // if found, return group name in second column
  if (group) {
    record.name = group[1]
    record.category_id = group[2]
  } else {
    // otherwise download the group detail
    group = downloadGroup(group_id)
    record.name = group[1]
    record.category_id = group[2]
  }

  record.category_name = getCategoryName(record.category_id)

  return record
}
