/*
 * Sidebar object
 */ 
const Sidebar = (()=>{
  const userProperties = PropertiesService.getUserProperties();
  let itemsCache = null;
  let cacheInfoCache = null;
  let dirty = false;
  let lastFlushMs = 0;
  let uiShown = false;

  const flushIfDirty = (force = false) => {
    if (!dirty || !itemsCache) return;
    const now = Date.now();
    if (!force && (now - lastFlushMs) < 900) return;
    userProperties.setProperty("sidebarItems", JSON.stringify(itemsCache));
    dirty = false;
    lastFlushMs = now;
  };
  return {
    /*
     * Initializes and opens a new sidebar in active sheet
     */
    open: function(status) {
      this.clean();
      // Keep dynamic project name in the header property (shown in the footer in HTML).
      this.setHeader(status ? status : '');

      if (uiShown) return;

      var htmlOutput = HtmlService
        .createHtmlOutputFromFile('Sidebar-html')
        .setTitle('Aktualizace Projektu');
      SpreadsheetApp.getUi().showSidebar(htmlOutput);
      uiShown = true;
    },

    /*
     * sets the status header
     */
    setHeader: function(header) {
      /*
      items = logSheet.getRange(1,1).setValue(header);
      */
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
      itemsCache = [];
      cacheInfoCache = null;
      dirty = false;
      lastFlushMs = 0;
      userProperties.setProperty("sidebarHeader", '');
      userProperties.setProperty("sidebarItems",'[]');
      userProperties.setProperty("close", '0');
    },

    /*
     * Stores cache timing info to be shown in the sidebar footer.
     * Expected keys: assetsExpiresMs, jobsExpiresMs, blueprintsExpiresMs (all epoch ms).
     */
    setCacheInfo: function(partial) {
      if (!partial) return;
      if (!cacheInfoCache) {
        try {
          cacheInfoCache = JSON.parse(userProperties.getProperty('sidebarCacheInfo') || '{}') || {};
        } catch (e) {
          cacheInfoCache = {};
        }
      }

      cacheInfoCache = Object.assign({}, cacheInfoCache, partial, { updatedAtMs: Date.now() });
      userProperties.setProperty('sidebarCacheInfo', JSON.stringify(cacheInfoCache));
    },

    /*
     * Adds new line to sidebar
     */
    add: function(message) {
      /*
      logSheet.appendRow([message]);
      */
      if (!itemsCache) {
        const items = userProperties.getProperty("sidebarItems") || '[]';
        try {
          itemsCache = JSON.parse(items);
        } catch (e) {
          itemsCache = [];
        }
      }
      itemsCache.push(message);
      dirty = true;
      flushIfDirty(false);
    },

    flush: function() {
      flushIfDirty(true);
    },

    /*
     * closes the sidebar
     */
    close: function() {
      flushIfDirty(true);
      userProperties.setProperty("close", '1');
      uiShown = false;
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
      const safeParseItems = () => {
        const raw = userProperties.getProperty('sidebarItems');
        if (!raw) return [];
        try {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
          // Heal corrupted property to avoid repeated crashes.
          userProperties.setProperty('sidebarItems', '[]');
          return [];
        }
      };

      return {
        heading: userProperties.getProperty("sidebarHeader"),
        items: safeParseItems(),
        cacheInfo: (() => {
          try {
            return JSON.parse(userProperties.getProperty('sidebarCacheInfo') || '{}') || {};
          } catch (e) {
            return {};
          }
        })(),
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