var g_categories

/*
 * Reads spreadsheet content to global array of categories
 */
function initCategories () {
  // load categories from spreadsheet
  Logger.log ('### Loading Categories ...')
  var lastRow = categoriesSheet.getLastRow();

  if (lastRow > 1)
    g_categories = categoriesSheet.getRange(2, 1, lastRow - 1, 2).getValues();
}

/*
 * Downloads category detail
 */
function downloadCategory(category_id) {

  // GET request category detail
  var options = {
    'method' : 'get',
    "headers" : {    
      'accept': 'application/json'
    }
  };

  var url = eveApi + '/universe/categories/' + category_id.toString() + '/?datasource=tranquility'
  var response = UrlFetchApp.fetch(url, options);

  // parse response to object
  var json = response.getContentText();
  var data = JSON.parse(json);
  Logger.log('>>> category Detail:')
  Logger.log(data);

  // append category at the end of the categories worksheet
  var row = 
    [ category_id
    , data.name
    ]
  categoriesSheet.appendRow(row);
  
  // reload categories global array
  initCategories();

  return row;
}

/*
 * Translates category_id to name
 */
function getCategoryName(category_id) {
  if (!g_categories) initCategories();

  var category

  // look for vharacter in the global array of categories  
  if (g_categories)
    category = g_categories.find(element => element[0] == category_id)
  
  // if found, return category name in second column
  if (category) {
    return category[1]
  } else {
    // otherwise download the category detail
    category = downloadCategory(category_id)
    return category[1]
  }
}

/*
 * Translates category_id to name and group
 */
function getCategoryName(category_id) {
  if (!g_categories) initCategories();

  var category

  // look for vharacter in the global array of categories  
  if (g_categories)
    category = g_categories.find(element => element[0] == category_id)
  
  // if found, return category name in second column
  if (category) {
    return category[1]
  } else {
    // otherwise download the category detail
    category = downloadCategory(category_id)
    return category[1]
  }
}