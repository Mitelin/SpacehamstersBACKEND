function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('EVE Data')
    .addItem('Login', 'openLogin')
    .addSeparator()
    .addSubMenu(ui.createMenu('Sales')
      .addItem('Copy Jita Sell Import', 'salesCopyJitaSellImport')
      )
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
    .addItem('Zasobovani: Nakup list', 'zasobovaniUpdateNakupList')
    .addSeparator()
    .addSubMenu(ui.createMenu('Debug')
      .addItem('Copy token → Corporate', 'copyPersonalTokenToCorporate')
      .addItem('Copy token → Shared (Full)', 'copyPersonalTokenToSharedFull')
      .addItem('Map Sheets (export MD)', 'sheetMapGenerateAndShow')
      .addItem('Timing: ON', 'perfTimingEnable')
      .addItem('Timing: OFF', 'perfTimingDisable'))
    .addToUi();
}

function openLogin() {
  var tpl = HtmlService.createTemplateFromFile('EveLogin');
  tpl.data = getLoginStatusSafe_();
  var html = tpl.evaluate()
    // Make the dialog fit the richer login descriptions.
    .setWidth(1020)
    .setHeight(900);
  SpreadsheetApp.getUi() // Or DocumentApp or SlidesApp or FormApp.
      .showModalDialog(html, 'EVE Login');
}

function getLoginStatusSafe_() {
  try {
    var status = getLoginStatus();

    // Normalize NaN/undefined expirations to 0
    if (!isFinite(Number(status.expirationFull))) status.expirationFull = 0;
    if (!isFinite(Number(status.expirationSales))) status.expirationSales = 0;
    if (!status.loginUrlSales) status.loginUrlSales = '';
    if (!status.loginUrlFull) status.loginUrlFull = '';
    status.error = '';
    return status;
  } catch (e) {
    return {
      loginUrlSales: '',
      loginUrlFull: '',
      expirationSales: 0,
      expirationFull: 0,
      error: String(e)
    };
  }
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
  status.loginUrlFull = Security.eveLoginUrl('');
  status.loginUrlSales = Security.eveLoginUrl('sales');
  status.loginUrlCorp = Security.eveLoginUrl('corp');
  // Backward compatibility
  status.loginUrl = status.loginUrlSales;

  // Debug: show what OAuth config the script actually uses
  status.clientId = Security.getClientId();
  status.clientIdSource = Security.getClientIdSource();
  status.redirectUri = Security.getRedirectUri();
  status.scopesSales = Security.getScopes('sales');
  status.scopesFull = Security.getScopes('');

  status.expirationFull = Personal.getTokenExpiration();
  status.expirationSales = Personal.getTokenExpiration('sales');
  status.expiration = status.expirationSales;

  // Corporate token (stored in ScriptProperties) used by Projects/Corp tooling.
  try {
    status.expirationCorp = (typeof Corporation !== 'undefined' && Corporation.getTokenExpiration)
      ? Corporation.getTokenExpiration()
      : 0;
  } catch (e) {
    status.expirationCorp = 0;
  }
  try {
    status.hasCorpRefreshToken = PropertiesService.getScriptProperties().getProperty('refresh_token') ? 1 : 0;
  } catch (e) {
    status.hasCorpRefreshToken = 0;
  }
  try {
    status.corpCharacterName = PropertiesService.getScriptProperties().getProperty('corp_character_name') || '';
    status.corpCharacterId = PropertiesService.getScriptProperties().getProperty('corp_character_id') || '';
  } catch (e) {
    status.corpCharacterName = '';
    status.corpCharacterId = '';
  }
  
  return status;
}

