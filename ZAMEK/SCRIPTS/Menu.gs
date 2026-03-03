function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('EVE Data')
    .addItem('Login', 'openLogin')
    .addSeparator()
    .addSubMenu(ui.createMenu('Doktrýny')
      .addItem('Import EFT fit (z buňky)', 'doctrinesImportEftFitFromCell')
      .addItem('Import EFT fit (B70:B200)', 'doctrinesImportEftFitFromStaging'))
    .addSeparator()
    .addSubMenu(ui.createMenu('Synchronizace Databáze')
      .addItem('Wallet Journal', 'syncWalletJournal')
      .addItem('Wallet Transactions', 'syncWalletTransactions')
      .addItem('Industry Jobs', 'syncIndustryJobs')
      .addItem('Assets', 'syncAssets'))
    .addSeparator()
    .addItem('Načíst: Ceník (Marketeer)', 'getPricesMarketeer')
    .addItem('Načíst: Ceník (Tycoon)', 'getPricesTycoon')
    .addItem('Spočítat: Výkupní ceny Ore a Modulů', 'pricelistCalculateOre')
    .addItem('Spočítat: Objemy nákupu a prodeje', 'pricelistGetVolumes')
    .addItem('Načíst: Sklady', 'syncAssets')
//    .addItem('Načíst: P&L', 'downloadPL')
    .addItem('Načíst: Industry joby', 'syncJobs')
    .addItem('Načíst: Hangáry', 'syncHangars')
    .addItem('Projekty: Aktualizuj vše', 'runUpdateAllProjects')
    .addSeparator()
    .addSubMenu(ui.createMenu('Debug')
      .addItem('Timing: ON', 'perfTimingEnable')
      .addItem('Timing: OFF', 'perfTimingDisable'))
    .addToUi();
}

function openLogin() {
  var html = HtmlService.createTemplateFromFile('EveLogin').evaluate();
  SpreadsheetApp.getUi() // Or DocumentApp or SlidesApp or FormApp.
      .showModalDialog(html, 'EVE Login');
}

function getLoginStatus() {
  Logger.log ('### getLoginStatus called ...')

  // get access_token to force refresh if needed
  try {
    Personal.getAccessToken();
  } catch (e) {
    Logger.log ('>>> Refresh failed' + e)
  }
  
  var status = {}
  status.loginUrl = Security.eveLoginUrl();
  status.expiration = Personal.getTokenExpiration();
  
  return status;
}

