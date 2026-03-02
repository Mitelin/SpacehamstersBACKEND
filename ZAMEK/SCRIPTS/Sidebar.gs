/*
 * Sidebar object
 */ 
const Sidebar = (()=>{
  return {
    /*
     * Initializes and opens a new sidebar in active sheet
     */
    open: function(status) {
      this.clean();
      this.setHeader(status?status:'Status');

      var htmlOutput = HtmlService
        .createHtmlOutputFromFile('Sidebar-html')
        .setTitle(status?status:'Status');
      SpreadsheetApp.getUi().showSidebar(htmlOutput);
    },

    /*
     * sets the status header
     */
    setHeader: function(header) {
      /*
      items = logSheet.getRange(1,1).setValue(header);
      */
      var userProperties = PropertiesService.getUserProperties();
      userProperties.setProperty("sidebarHeader", header);
    },

    /*
     * removes all status lines
     */
    clean: function() {
      /*
      let len = logSheet.getLastRow();
      items = logSheet.getRange(2,1,len - 1,1).setValue('');
      */
      var userProperties = PropertiesService.getUserProperties();
      userProperties.setProperty("sidebarHeader", '');
      userProperties.setProperty("sidebarItems",'[]');
      userProperties.setProperty("close", '0');
    },

    /*
     * Adds new line to sidebar
     */
    add: function(message) {
      /*
      logSheet.appendRow([message]);
      */
      var userProperties = PropertiesService.getUserProperties();
      let items = userProperties.getProperty("sidebarItems");
      console.log(items);
      let json = JSON.parse(items);
      json.push(message);
      userProperties.setProperty("sidebarItems", JSON.stringify(json));
    },

    /*
     * closes the sidebar
     */
    close: function() {
      var userProperties = PropertiesService.getUserProperties();
      userProperties.setProperty("close", '1');
    },

    getData: function() {
      /*
      let len = logSheet.getLastRow();
      let items = [];
      if (len > 2) {
        items = logSheet.getRange(2,1,len - 1,1).getValues().flat();
      }
      return {
        heading: logSheet.getRange(1,1).getValue(),
        items: items
      }
      */
      var userProperties = PropertiesService.getUserProperties();
      return {
        heading: userProperties.getProperty("sidebarHeader"),
//        heading: 'hey ' + Date.now() + userProperties.getProperty("sidebarHeader"),
        items: JSON.parse(userProperties.getProperty("sidebarItems")),
        close: userProperties.getProperty("close")
      }

    },
    
  }

})()


/*
  var userProperties = PropertiesService.getUserProperties();
  var scriptProperties = PropertiesService.getScriptProperties();

  scriptProperties.setProperty("refresh_token", userProperties.getProperty("refresh_token"));
  scriptProperties.setProperty("access_token", userProperties.getProperty("access_token"));
*/

function getSidebarData(){
  return Sidebar.getData()
}

function showSidebar() {
  Sidebar.open('Test');
  Sidebar.add("line1");
  console.log(Sidebar.getData());
  Utilities.sleep(1*1000);
  Sidebar.add("line2");
  console.log(Sidebar.getData());
  Utilities.sleep(1*1000);
  Sidebar.add("line3");
  console.log(Sidebar.getData());
  Utilities.sleep(1*1000);
  Sidebar.add("line4");
  console.log(Sidebar.getData());
  Utilities.sleep(1*1000);
  Sidebar.add("line5");
  Sidebar.close();
  console.log(Sidebar.getData());
}