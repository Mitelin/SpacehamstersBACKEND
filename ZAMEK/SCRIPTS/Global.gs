/* Constants */
const corporationId = 98652228   // Corporation ID for "Space Hamsters CZ SK" found via /universe/ids API
const eveApi = 'https://esi.evetech.net/latest'
const aubiApi = 'https://www.spacehamsters.eu/api'


// var ui = SpreadsheetApp.getUi();

/* sheets */
var plSheet = SpreadsheetApp.getActive().getSheetByName('P&L');
var hangarsSheet = SpreadsheetApp.getActive().getSheetByName('Hangáry')
var industrySheet = SpreadsheetApp.getActive().getSheetByName('Industry kalkulačka')
var assetsSheet = SpreadsheetApp.getActive().getSheetByName('Sklady')
var industryJobsSheet = SpreadsheetApp.getActive().getSheetByName('IndustryJobs')
var blueprintsSheet = SpreadsheetApp.getActive().getSheetByName('Blueprinty')
var pricelistSheet = SpreadsheetApp.getActive().getSheetByName('Ceník')
var bpoSheet = SpreadsheetApp.getActive().getSheetByName('Buffer BPO')
var typesSheet = SpreadsheetApp.getActive().getSheetByName('Types')
var groupsSheet = SpreadsheetApp.getActive().getSheetByName('Groups')
var charactersSheet = SpreadsheetApp.getActive().getSheetByName('Characters')
var namesSheet = SpreadsheetApp.getActive().getSheetByName('Names')
var categoriesSheet = SpreadsheetApp.getActive().getSheetByName('Categories')
var locationsSheet = SpreadsheetApp.getActive().getSheetByName('Locations')
var oreSheet = SpreadsheetApp.getActive().getSheetByName('Reprocess Kalkulačka')
var buyoutSheet = SpreadsheetApp.getActive().getSheetByName('Výkupy')
var doctrineSheet = SpreadsheetApp.getActive().getSheetByName('DOKTRYNY DATASHEET')
var debugSheet = SpreadsheetApp.getActive().getSheetByName('_')
var marketSheet = SpreadsheetApp.getActive().getSheetByName('Market')
var t2marketSheet = SpreadsheetApp.getActive().getSheetByName('T2 Market')
var jobHistorySheet = SpreadsheetApp.getActive().getSheetByName('Historie')
var rigMarketSheet = SpreadsheetApp.getActive().getSheetByName('Rig Market')
var bountySheet = SpreadsheetApp.getActive().getSheetByName('Bounty')
var logSheet = SpreadsheetApp.getActive().getSheetByName('_log')
var industryVelocitySheet = SpreadsheetApp.getActive().getSheetByName('IndustryVelocity')
var buildCostSheet = SpreadsheetApp.getActive().getSheetByName('Build náklady')
var calculatorSheet = SpreadsheetApp.getActive().getSheetByName('Calculator')
