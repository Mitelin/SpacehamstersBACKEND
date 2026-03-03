/*
 * Aubi Rest Api client
 */ 
const Aubi = (()=>{
  const aubiApi = 'http://www.spacehamsters.eu:8010/api'
  const options_get = {
    'method' : 'get',
    "headers" : {    
      'accept': 'application/json',
    }
  }
  const options_post = {
    'method' : 'post',
    'contentType': 'application/json',
    "headers" : {    
      'accept': 'application/json',
    }
  }

  /* Returns options_get with authorization of current user */
  var authorized_options_get = function() {
    let ret = options_get;
    ret.headers.authorization = "Bearer " + Personal.getAccessToken();
    return ret;
  }

  /* Returns options_post with authorization of current user */
  var authorized_options_post = function() {
    let ret = options_post;
    ret.headers.authorization = "Bearer " + Personal.getAccessToken();
    return ret;
  }

  return {
    /*
     * Stores user token to Aubi DB
     */
    syncUser: function(tokenInfo) {
      var options = options_post;
      options.payload = JSON.stringify(tokenInfo)

      var response = UrlFetchApp.fetch(aubiApi + '/userInfo', options);

      // parse response to object
      var res = response.getContentText();
      Logger.log(res);
    },

    /*
     * synchronizes industry jobs in Aubi DB
     * wallet: wallet number 1 - 7
     */
    syncIndustryJobs: function() {
      var response = UrlFetchApp.fetch(aubiApi + '/corporation/' + corporationId.toString() + '/jobs/sync', authorized_options_get());

      // parse response to object
      var res = response.getContentText();
      Logger.log(res);

      // show result in notification window
      SpreadsheetApp.getUi().alert('Synchronizace dokončena.', res, SpreadsheetApp.getUi().ButtonSet.OK);
    },

    /*
     * synchronizes wallet journal in Aubi DB
     * wallet: wallet number 1 - 7
     */
    syncWalletJournal: function(wallet) {
      var response = UrlFetchApp.fetch(aubiApi + '/corporation/' + corporationId.toString() + '/wallets/'+ wallet + '/journal/sync', authorized_options_get());

      // parse response to object
      var res = response.getContentText();
      Logger.log(res);

      // show result in notification window
      SpreadsheetApp.getUi().alert('Synchronizace dokončena.', res, SpreadsheetApp.getUi().ButtonSet.OK);
    },

    /*
     * synchronizes wallet transactions in Aubi DB
     */
    syncWalletTransactions: function() {
      var response = UrlFetchApp.fetch(aubiApi + '/corporation/' + corporationId.toString() + '/wallets/7/transactions/sync', authorized_options_get());

      // parse response to object
      var res = response.getContentText();
      Logger.log(res);

      // show result in notification window
      SpreadsheetApp.getUi().alert('Synchronizace dokončena.', res, SpreadsheetApp.getUi().ButtonSet.OK);
    },

    /*
     * synchronizes assets in Aubi DB
     */
    syncAssets: function() {
      var response = UrlFetchApp.fetch(aubiApi + '/corporation/' + corporationId.toString() + '/assets/sync', authorized_options_get());

      // parse response to object
      var res = response.getContentText();
      Logger.log(res);

      // show result in notification window
      SpreadsheetApp.getUi().alert('Synchronizace dokončena.', res, SpreadsheetApp.getUi().ButtonSet.OK);
    },

    
    /*
     * get all hangars at defined location from Aubi DB
     * locationId: location ID, f.eg. corp offices, or container in corp office
     */
    getHangars: function(locationId) {
      var response = UrlFetchApp.fetch(aubiApi + '/corporation/' + corporationId.toString() + '/assets/locations/' + locationId.toString(), authorized_options_get());

      // parse response to object
      var res = response.getContentText();
      var json = JSON.parse(res);

      var rows = json.map(a => [a.locationID, a.locationType, a.locationFlag, a.hangar, a.container, a.name]);

      return rows;
    },

    /*
     * get all items at defined location, type and flag from Aubi DB
     * locationId: location ID, f.eg. corp offices, or container in corp office
     */
    getItems: function(locationID, locationType, locationFlag) {
      // priprav JSON objekt requestu
      var req = {
        locationID : locationID,
        locationType : locationType,
        locationFlag : locationFlag
      }

      // zavolej API
      var options = authorized_options_post();
      options.payload = JSON.stringify(req)
      var response = UrlFetchApp.fetch(aubiApi + '/corporation/' + corporationId.toString() + '/assets', options);

      // parse response to object
      var res = response.getContentText();
      var json = JSON.parse(res);

      var rows = json.map(a => [a.typeName, a.quantity]);

      return rows;
    },

    /*
     * get report of corporation jobs in specific period
     * year: year
     * month: month
     */
    getJobsReport: function(year, month) {
      var response = UrlFetchApp.fetch(aubiApi + '/corporation/' + corporationId.toString() + '/jobs/report/' + year.toString() + '/' + month.toString(), authorized_options_get());

      // parse response to object
      var res = response.getContentText();
      var json = JSON.parse(res);

      return json;
    },

    /*
     * get report of corporation wallet journal in specific period
     * wallet: no effect yet
     * year: year
     * month: month
     * types: array of journal types included in report
     */
    getWalletJournal: function(wallet, year, month, types) {
      let body = {
        year: year,
        month: month,
        types: types
      }

      // call API
      var options = authorized_options_post();
      options.payload = JSON.stringify(body)
      var response = UrlFetchApp.fetch(aubiApi + '/corporation/' + corporationId.toString() + '/wallets/' + wallet.toString() + '/journal/report', options);

      // parse response to object
      var res = response.getContentText();
      var json = JSON.parse(res);

      return json;
    },

    /*
     * get report of corporation industry item velocity
     * categories: array of category IDs included in report
     */
    getIndustryVelocity: function(categories) {
      let body = {
        categories: categories
      }

      // call API
      var options = authorized_options_post();
      options.payload = JSON.stringify(body)
      var response = UrlFetchApp.fetch(aubiApi + '/corporation/' + corporationId.toString() + '/jobs/velocity', options);

      // parse response to object
      var res = response.getContentText();
      var json = JSON.parse(res);

      return json;
    },

    /*
     * get list of running jobs at location from Aubi DB
     * locationId: location ID, f.eg. corp offices, or container in corp office
     */
    getJobs: function(locationId) {
      var response = UrlFetchApp.fetch(aubiApi + '/corporation/' + corporationId.toString() + '/jobs/location/' + locationId.toString(), authorized_options_get());

      // parse response to object
      var res = response.getContentText();
      var json = JSON.parse(res);

      return json;
    },

    getTypeVolumes: function() {
      var response = UrlFetchApp.fetch(aubiApi + '/corporation/' + corporationId.toString() + '/wallets/7/volumes', authorized_options_get());

      // parse response to object
      var res = response.getContentText();
      var json = JSON.parse(res);

      return json;
    }

  }
})()

/* global functions available for menu and buttons */
function syncIndustryJobs() {
  Aubi.syncIndustryJobs();
}

function syncWalletJournal() {
  Aubi.syncWalletJournal(1);
}

function syncWalletTransactions() {
  Aubi.syncWalletTransactions()
}

function syncAssets() {
  Aubi.syncAssets();
}


/* test functions */
function testAubiGetHangars() {
  console.log(Aubi.getHangars(1037774100310));
}

function testAubiGetJobs() {
  console.log(Aubi.getJobs(1047694921094));
  // installer, activity, duration,  filtr start date
}

function testAubiGetJobsReport() {
  console.log(Aubi.getJobsReport(2025, 1));
}

function testAubiGetWalletJournal() {
  let journal = Aubi.getWalletJournal(1, 2025, 5, ['bounty_prizes','ess_escrow_transfer'])
  console.log(journal);
  let sum = journal.reduce( (x, y) => { return x + y.amount}, 0)
  console.log(sum);

  journal = Aubi.getWalletJournal(1, 2025, 5, ['bounty_prizes'])
  console.log(journal);
  sum = journal.reduce( (x, y) => { return x + y.amount}, 0)
  console.log(sum);

  journal = Aubi.getWalletJournal(1, 2025, 5, ['ess_escrow_transfer'])
  console.log(journal);
  sum = journal.reduce( (x, y) => { return x + y.amount}, 0)
  console.log(sum);
}

function testAubiGetIndustryVelocity() {
  console.log(Aubi.getIndustryVelocity([6,7]));
}
