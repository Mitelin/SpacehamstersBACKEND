/*
 * EVE Rest Api clients
 */ 
// NOTE: Apps Script merges all .gs files into one global scope.
// Using `var` + `Eve ||` prevents hard failures if another file already declares `Eve`.
globalThis.Eve = globalThis.Eve || (()=>{
  const maxInt = 2147483647;
  const eveApi = 'https://esi.evetech.net/latest'  // Eve API URL
  const cookbookApi = 'https://evecookbook.com/api' // Eve Cookbook API URL
  const options_get = {
    'method' : 'get',
    "headers" : {    
      'accept': 'application/json',
      'Accept-Language' : 'en',
      'Cache-Control': 'no-cache'
    }, 
    'muteHttpExceptions' : true
  }  // default options for API GET call
  var options_post = {
    'method' : 'post',
    'contentType': 'application/json',
    "headers" : {    
      'accept': 'application/json',
      'Cache-Control': 'no-cache'
    }, 
    'muteHttpExceptions' : true
  } // default options for API POST call
 
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

  /* Returns options_get with authorization of corporate director user */
  var corp_authorized_options_get = function() {
    let ret = options_get;
    ret.headers.authorization = "Bearer " + Corporation.getAccessToken();
    return ret;
  }

  /* Returns options_post with authorization of current user */
  var corp_authorized_options_post = function() {
    let ret = options_post;
    ret.headers.authorization = "Bearer " + Corporation.getAccessToken();
    return ret;
  }

  return {
    /* 
    * Resolve a set of names to IDs in the following categories: agents, alliances, characters, constellations, corporations factions, inventory_types, regions, stations, and systems. 
    * Only exact matches will be returned
    * names: array of strings with names to resolve
    * out: array of entities matching names
    */
    resolveNames: function(names, category) {
      Logger.log(">>> Eve.resolveNames (" + names + ", " + category + ")");
      var options = options_post;
      options.payload = JSON.stringify(names)

      // Call EVE Api
      var url = eveApi + '/universe/ids/?datasource=tranquility&language=en-us'
      var response = UrlFetchApp.fetch(url, options);

      // evaluate response code
      var code = response.getResponseCode();
      if (code != 200) { 
        throw ("Eve.resolveNames(" + names + ") Error: " + code + " " + response.getContentText())
      }

      // parse response to object
      var json = response.getContentText();
      var data = JSON.parse(json);

      if (category) {
        // return parsed category
        return data[category]
      } else {
        // return all categories
        return data;
      }
    },

    /* 
    * Resolve a set of IDs to names 
    * Only exact matches will be returned
    * ids: array of numbers with IDs to resolve
    * out: array of entities matching IDs
    */
    names: function(ids) {
      Logger.log(">>> Eve.names (" + ids + ")");
      var options = options_post;
      options.payload = JSON.stringify(ids)

      // Call EVE Api
      var url = eveApi + '/universe/names/?datasource=tranquility&language=en-us'
      var response = UrlFetchApp.fetch(url, options);

      // evaluate response code
      var code = response.getResponseCode();
      if (code != 200) { 
        throw ("Eve.names(" + ids + ") Error: " + code + " " + response.getContentText())
      }

      // parse response to object
      var json = response.getContentText();
      var data = JSON.parse(json);

      return data;
    },

    /*
     * Return cost indices for solar systems
     */
    getIndusrtyCostIndices: function(systemId) {
      Logger.log(">>> Eve.getIndusrtyCostIndices ()");
      // Call EVE Api
      var url = eveApi + '/industry/systems/?datasource=tranquility&language=en-us'
      var response = UrlFetchApp.fetch(url, options_get);

      // evaluate response code
      var code = response.getResponseCode();
      if (code != 200) { 
        throw ("Eve.getIndusrtyCostIndices() Error: " + code + " " + response.getContentText())
      }

      // parse response to object
      var json = response.getContentText();
      var data = JSON.parse(json);

      if (systemId) {
        // find and return only indices for selected system
        let system = data.find(element => element.solar_system_id == systemId)
        return system;
      } else {
        // return all systems
        return data;
      }
    },

    /*
     * Return structure information
     * structureId: structure ID
     * out: JSON
     */
    getStructureInfo: function(structureId) {
      Logger.log(">>> Eve.getStructureInfo (" + structureId + ")");
//      Logger.log(">>> Eve.getStructureInfo (" + maxInt + ")");

      // Call EVE Api
      if (structureId > maxInt) {
        // location is a player structure
        var url = eveApi + '/universe/structures/' + structureId + '/?datasource=tranquility'
        var response = UrlFetchApp.fetch(url, authorized_options_get());

        // evaluate response code
        var code = response.getResponseCode();
        if (code != 200) { 
          throw ("Eve.getStructureInfo() Error: " + code + " " + response.getContentText())
        }

        // parse response to object
        var json = response.getContentText();
        var data = JSON.parse(json);
        data.type = "structures"
      } else {
        // location is a NPC station
        var url = eveApi + '/universe/stations/' + structureId + '/?datasource=tranquility'
        var response = UrlFetchApp.fetch(url, authorized_options_get());

        // evaluate response code
        var code = response.getResponseCode();
        if (code != 200) { 
          throw ("Eve.getStructureInfo() Error: " + code + " " + response.getContentText())
        }

        // parse response to object
        var json = response.getContentText();
        var data = JSON.parse(json);
        data.type = "stations"        
      }

      return data;
    },

    /*
     * Return type information
     * typeId: type ID
     * out: JSON
     */
    getTypeInfo: function(typeId) {
      Logger.log(">>> Eve.getTypeInfo (" + typeId + ")");
      // Call EVE Api
      var url = eveApi + '/universe/types/' + typeId + '/?datasource=tranquility'
      var response = UrlFetchApp.fetch(url, options_get);

      // evaluate response code
      var code = response.getResponseCode();
      if (code != 200) { 
        throw ("Eve.getTypeInfo() Error: " + code + " " + response.getContentText())
      }

      // parse response to object
      var json = response.getContentText();
      var data = JSON.parse(json);

      return data;
    },

    /*
     * Return group information
     * groupId: group ID
     * out: JSON
     */
    getGroupInfo: function(groupId) {
      Logger.log(">>> Eve.getGroupInfo (" + groupId + ")");
      // Call EVE Api
      var url = eveApi + '/universe/groups/' + groupId + '/?datasource=tranquility'
      var response = UrlFetchApp.fetch(url, options_get);

      // evaluate response code
      var code = response.getResponseCode();
      if (code != 200) { 
        throw ("Eve.getTypeInfo() Error: " + code + " " + response.getContentText())
      }

      // parse response to object
      var json = response.getContentText();
      var data = JSON.parse(json);

      return data;
    },

    /*
     * Return group information
     * categoryId: category ID
     * out: JSON
     */
    getCategoryInfo: function(categoryId) {
      Logger.log(">>> Eve.getCategoryInfo (" + categoryId + ")");
      // Call EVE Api
      var url = eveApi + '/universe/categories/' + categoryId + '/?datasource=tranquility'
      var response = UrlFetchApp.fetch(url, options_get);

      // evaluate response code
      var code = response.getResponseCode();
      if (code != 200) { 
        throw ("Eve.getCategoryInfo() Error: " + code + " " + response.getContentText())
      }

      // parse response to object
      var json = response.getContentText();
      var data = JSON.parse(json);

      return data;
    },

    /*
     * Return character public info
     */
    getCharacter: function(characterId) {
      Logger.log(">>> Eve.getCharacter (" + characterId + ")");
      // Call EVE Api
      var url = eveApi + '/characters/' + characterId + '/?datasource=tranquility&language=en-us'
      var response = UrlFetchApp.fetch(url, options_get);

      // evaluate response code
      var code = response.getResponseCode();
      if (code != 200) { 
        throw ("Eve.getCharacter() Error: " + code + " " + response.getContentText())
      }

      // parse response to object
      var json = response.getContentText();
      var data = JSON.parse(json);
      return data;
    },


    /*
     * Return personal assets
     * characterId: EVE Character ID associated with the user token
     * out: array of characters assets
     */
    getPersonalAssets: function(characterId) {
      Logger.log(">>> Eve.getPersonalAssets (" + characterId + ")");

      // prepare paging
      let page = 1;     // queried page
      let maxPage = 1;  // max pages
      let res = [];     // full response json
      let age = 0;      // data age in cache in seconds
      let cacheRefresh = 0;  // cache refresh in second

      do {
        // Call EVE Api
        var url = eveApi + '/characters/' + characterId + '/assets/?datasource=tranquility&page=' + page
        var response = UrlFetchApp.fetch(url, authorized_options_get());

        // evaluate response code
        var code = response.getResponseCode();
        if (code != 200) { 
          throw ("Eve.getPersonalAssets() Error: " + code + " " + response.getContentText())
        }

        // parse response to object
        var json = response.getContentText();
        var data = JSON.parse(json);
        
        // add partial response to complete response
        res = res.concat(data);
        
        // get max pages from response header
        let headers = response.getHeaders();
        maxPage = headers["x-pages"];
        let expires = Date.parse(headers["Expires"]);
        let date = Date.parse(headers["Date"]);
        let lastModified = Date.parse(headers["Last-Modified"]);
        age = (date - lastModified) / 1000;
        cacheRefresh = (expires - date) / 1000;
        console.log(">>> Response headers age " + age + " cacheRefresh " + cacheRefresh);

        page++;
      } while (page <= maxPage);

      return {age: age, cacheRefresh: cacheRefresh, data : res};
    },

    /*
     * Return personal assets
     * characterId: EVE Character ID associated with the user token
     * itemIds: array of number - itemId
     * out: array of characters assets
     */
    getPersonalAssetsNames: function(characterId, itemIds) {
      Logger.log(">>> Eve.getPersonalAssetsNames (" + characterId + ")");

      // Call EVE Api
      var url = eveApi + '/characters/' + characterId + '/assets/names/?datasource=tranquility'
      var options = authorized_options_post();
      options.payload = JSON.stringify(itemIds)
      var response = UrlFetchApp.fetch(url, options);

      // evaluate response code
      var code = response.getResponseCode();
      if (code != 200) { 
        throw ("Eve.getPersonalAssets() Error: " + code + " " + response.getContentText())
      }

      // parse response to object
      var json = response.getContentText();
      var data = JSON.parse(json);

      let headers = response.getHeaders();
      maxPage = headers["x-pages"];
      let expires = Date.parse(headers["Expires"]);
      let date = Date.parse(headers["Date"]);
      let lastModified = Date.parse(headers["Last-Modified"]);
      let age = (date - lastModified) / 1000;
      let cacheRefresh = (expires - date) / 1000;
      console.log(">>> Response headers age " + age + " cacheRefresh " + cacheRefresh);

      return data;
    },

    /*
     * Return personal jobs
     * characterId: EVE Character ID associated with the user token
     * includeCompleted: bool - include completed jobs
     * out: array of characters jobs
     */
    getPersonalJobs: function(characterId, includeCompleted) {
      Logger.log(">>> Eve.getPersonalJobs (" + characterId + ")");

      // Call EVE Api
      var url = eveApi + '/characters/' + characterId + '/industry/jobs/?datasource=tranquility&include_completed=' + includeCompleted.toString();
      var response = UrlFetchApp.fetch(url, authorized_options_get());

      // evaluate response code
      var code = response.getResponseCode();
      if (code != 200) { 
        throw ("Eve.getPersonalJobs() Error: " + code + " " + response.getContentText())
      }

      // parse response to object
      var json = response.getContentText();
      var data = JSON.parse(json);

      // get response header
      let headers = response.getHeaders();
      let expires = Date.parse(headers["Expires"]);
      let date = Date.parse(headers["Date"]);
      let lastModified = Date.parse(headers["Last-Modified"]);
      let age = (date - lastModified) / 1000;
      let cacheRefresh = (expires - date) / 1000;
      console.log(">>> Response headers age " + age + " cacheRefresh " + cacheRefresh);

      return {age: age, cacheRefresh: cacheRefresh, data : data};
    },

    /*
     * Return corporate assets
     * out: array of corporation assets
     */
    getCorporateAssets: function() {
      Logger.log(">>> Eve.getCorporateAssets ()");

      // prepare paging
      let page = 1;     // queried page
      let maxPage = 1;  // max pages
      let res = [];     // full response json
      let age = 0;      // data age in cache in seconds
      let cacheRefresh = 0;  // cache refresh in second
      let lastModified = 0;  // cache modification date
      let expires = 0;  // cache expiration date

      do {
        // Call EVE Api
        var url = eveApi + '/corporations/' + Corporation.getId() + '/assets/?datasource=tranquility&page=' + page
        var response = UrlFetchApp.fetch(url, corp_authorized_options_get());

        // evaluate response code
        var code = response.getResponseCode();
        if (code != 200) { 
          throw ("Eve.getCorporateAssets() Error: " + code + " " + response.getContentText())
        }

        // parse response to object
        var json = response.getContentText();
        var data = JSON.parse(json);
        
        // add partial response to complete response
        res = res.concat(data);
        
        // get max pages from response header
        let headers = response.getHeaders();
        maxPage = headers["x-pages"];
        expires = Date.parse(headers["Expires"]);
        let date = Date.parse(headers["Date"]);
        lastModified = Date.parse(headers["Last-Modified"]);
        console.log(">>> Response headers Modified " + lastModified + " date " + date + " expires " + expires);
        age = (date - lastModified) / 1000;
        cacheRefresh = (expires - date) / 1000;

        page++;
      } while (page <= maxPage);

      return {age: age, cacheRefresh: cacheRefresh, lastModified : lastModified, expires : expires, data : res};
    },

    /*
     * Return corporation asset names
     * itemIds: array of number - itemId
     * out: array of corporation asset names
     */
    getCorporateAssetsNames: function(itemIds) {
      Logger.log(">>> Eve.getCorporateAssetsNames ()");

      // Call EVE Api
      var url = eveApi + '/corporations/' + Corporation.getId() + '/assets/names/?datasource=tranquility'
      var options = corp_authorized_options_post();
      options.payload = JSON.stringify(itemIds)
      var response = UrlFetchApp.fetch(url, options);

      // evaluate response code
      var code = response.getResponseCode();
      if (code != 200) { 
        throw ("Eve.getCorporateAssetNames() Error: " + code + " " + response.getContentText())
      }

      // parse response to object
      var json = response.getContentText();
      var data = JSON.parse(json);
      
      return data;
    },

    /*
     * Return corporate blueprints
     * out: array of corporation assets
     */
    getCorporateBlueprints: function() {
      Logger.log(">>> Eve.getCorporateBlueprints ()");

      // prepare paging
      let page = 1;     // queried page
      let maxPage = 1;  // max pages
      let res = [];     // full response json
      let age = 0;      // data age in cache in seconds
      let cacheRefresh = 0;  // cache refresh in second
      let lastModified = 0;  // cache modification date
      let expires = 0;  // cache expiration date

      do {
        // Call EVE Api
        var url = eveApi + '/corporations/' + Corporation.getId() + '/blueprints/?datasource=tranquility&page=' + page
//        var response = UrlFetchApp.fetch(url, authorized_options_get());
        var response = UrlFetchApp.fetch(url, corp_authorized_options_get());

        // evaluate response code
        var code = response.getResponseCode();
        if (code != 200) { 
          throw ("Eve.getCorporateBlueprints() Error: " + code + " " + response.getContentText())
        }

        // parse response to object
        var json = response.getContentText();
        var data = JSON.parse(json);
        
        // add partial response to complete response
        res = res.concat(data);
        
        // get max pages from response header
        let headers = response.getHeaders();
        maxPage = headers["x-pages"];
        expires = Date.parse(headers["Expires"]);
        let date = Date.parse(headers["Date"]);
        lastModified = Date.parse(headers["Last-Modified"]);
//        console.log(">>> Response headers Modified " + lastModified + " date " + date + " expires " + expires + " etag " + eTag);
        age = (date - lastModified) / 1000;
        cacheRefresh = (expires - date) / 1000;

        page++;
      } while (page <= maxPage);

      return {age: age, cacheRefresh: cacheRefresh, lastModified : lastModified, expires : expires, data : res};
    },

    /*
     * Return corporate jobs
     * includeCompleted: bool - include completed jobs
     * out: array of corporate jobs
     */
    getCorporateJobs: function(includeCompleted) {
      const _TRACE = (() => {
        try {
          const v = PropertiesService.getScriptProperties().getProperty('DEBUG_TRACE');
          return String(v || '') === '1';
        } catch (e) {
          return false;
        }
      })();

      // prepare paging
      let page = 1;     // queried page
      let maxPage = 1;  // max pages
      let res = [];     // full response json
      let age = 0;      // data age in cache in seconds
      let cacheRefresh = 0;  // cache refresh in second
      let lastModified = 0;  // cache modification date
      let expires = 0;  // cache expiration date


      if (_TRACE) Logger.log(">>> Eve.getCorporateJobs ()");

      // Call first page to learn paging + headers
      const options = corp_authorized_options_get();
      const baseUrl = eveApi + '/corporations/' + Corporation.getId() + '/industry/jobs/?datasource=tranquility&include_completed=' + includeCompleted.toString() + '&page=';
      var response = UrlFetchApp.fetch(baseUrl + page, options);

      // evaluate response code
      var code = response.getResponseCode();
      if (code != 200) { 
        throw ("Eve.getCorporateJobs() Error: " + code + " " + response.getContentText())
      }

      // parse response to object
      var json = response.getContentText();
      var data = JSON.parse(json);
      res = res.concat(data);

      // get response header
      let headers = response.getHeaders();
      maxPage = headers["x-pages"];
      expires = Date.parse(headers["Expires"]);
      let date = Date.parse(headers["Date"]);
      lastModified = Date.parse(headers["Last-Modified"]);
      if (_TRACE) console.log(">>> Response headers Modified " + lastModified + " date " + date + " expires " + expires + " maxPage " + maxPage);
      age = (date - lastModified) / 1000;
      cacheRefresh = (expires - date) / 1000;

      // Fetch remaining pages (if any) in parallel
      page++;
      if (maxPage && page <= maxPage) {
        const requests = [];
        for (let p = page; p <= maxPage; p++) {
          requests.push(Object.assign({ url: baseUrl + p }, options));
        }

        const responses = UrlFetchApp.fetchAll(requests);
        for (let i = 0; i < responses.length; i++) {
          const r = responses[i];
          const rc = r.getResponseCode();
          if (rc != 200) {
            throw ("Eve.getCorporateJobs() Error: " + rc + " " + r.getContentText())
          }
          const body = r.getContentText();
          const parsed = JSON.parse(body);
          res = res.concat(parsed);
        }
      }

      return {age: age, cacheRefresh: cacheRefresh, lastModified : lastModified, expires : expires, data : res};
    },

    /*
     * Return personal contracts
     * out: array of personal contracts
     */
    getPersonalContracts: function() {
      // prepare paging
      let page = 1;     // queried page
      let maxPage = 1;  // max pages
      let res = [];     // full response json
      let age = 0;      // data age in cache in seconds
      let cacheRefresh = 0;  // cache refresh in second
      let lastModified = 0;  // cache modification date
      let expires = 0;  // cache expiration date


      Logger.log(">>> Eve.getPersonalContracts ()");

      do {
        // Call EVE Api
        var url = eveApi + '/characters/' + Security.getUserInfo().character_id + '/contracts/?datasource=tranquility&page=' + page;
        var response = UrlFetchApp.fetch(url, authorized_options_get());

        // evaluate response code
        var code = response.getResponseCode();
        if (code != 200) { 
          throw ("Eve.getPersonalContracts() Error: " + code + " " + response.getContentText())
        }

        // parse response to object
        var json = response.getContentText();
        var data = JSON.parse(json);
      
        // add partial response to complete response
        res = res.concat(data);

        // get response header
        let headers = response.getHeaders();
        maxPage = headers["x-pages"];
        expires = Date.parse(headers["Expires"]);
        let date = Date.parse(headers["Date"]);
        lastModified = Date.parse(headers["Last-Modified"]);
        console.log(">>> Response headers Modified " + lastModified + " date " + date + " expires " + expires + " maxPage " + maxPage);
        age = (date - lastModified) / 1000;
        cacheRefresh = (expires - date) / 1000;

        page++;
      } while (page <= maxPage);

      return {age: age, cacheRefresh: cacheRefresh, lastModified : lastModified, expires : expires, data : res};
    },

    /*
     * Return personal contract items
     * contractId: contract ID
     * out: array of personal contract items
     */
    getPersonalContractItems: function(contractId) {
      // prepare paging
      let age = 0;      // data age in cache in seconds
      let cacheRefresh = 0;  // cache refresh in second
      let lastModified = 0;  // cache modification date
      let expires = 0;  // cache expiration date


      Logger.log(">>> Eve.getPersonalContractItems ()");

      // Call EVE Api
      var url = eveApi + '/characters/' + Security.getUserInfo().character_id + '/contracts/' + contractId.toString() + '/items/?datasource=tranquility';
      var response = UrlFetchApp.fetch(url, authorized_options_get());

      // evaluate response code
      var code = response.getResponseCode();
      if (code != 200) { 
        throw ("Eve.getPersonalContractItems() Error: " + code + " " + response.getContentText())
      }

      // parse response to object
      var json = response.getContentText();
      var res = JSON.parse(json);
    
      // get response header
      let headers = response.getHeaders();
      maxPage = headers["x-pages"];
      expires = Date.parse(headers["Expires"]);
      let date = Date.parse(headers["Date"]);
      lastModified = Date.parse(headers["Last-Modified"]);
      console.log(">>> Response headers Modified " + lastModified + " date " + date + " expires " + expires + " maxPage " + maxPage);
      age = (date - lastModified) / 1000;
      cacheRefresh = (expires - date) / 1000;

      return {age: age, cacheRefresh: cacheRefresh, lastModified : lastModified, expires : expires, data : res};
    },

    /*
     * Return corporate contracts
     * out: array of corporate contracts
     */
    getCorporateContracts: function() {
      // prepare paging
      let page = 1;     // queried page
      let maxPage = 1;  // max pages
      let res = [];     // full response json
      let age = 0;      // data age in cache in seconds
      let cacheRefresh = 0;  // cache refresh in second
      let lastModified = 0;  // cache modification date
      let expires = 0;  // cache expiration date


      Logger.log(">>> Eve.getCorporateContracts ()");

      do {
        // Call EVE Api
        var url = eveApi + '/corporations/' + Corporation.getId() + '/contracts/?datasource=tranquility&page=' + page;
        var response = UrlFetchApp.fetch(url, corp_authorized_options_get());

        // evaluate response code
        var code = response.getResponseCode();
        if (code != 200) { 
          throw ("Eve.getCorporateContracts() Error: " + code + " " + response.getContentText())
        }

        // parse response to object
        var json = response.getContentText();
        var data = JSON.parse(json);
      
        // add partial response to complete response
        res = res.concat(data);

        // get response header
        let headers = response.getHeaders();
        maxPage = headers["x-pages"];
        expires = Date.parse(headers["Expires"]);
        let date = Date.parse(headers["Date"]);
        lastModified = Date.parse(headers["Last-Modified"]);
        console.log(">>> Response headers Modified " + lastModified + " date " + date + " expires " + expires + " maxPage " + maxPage);
        age = (date - lastModified) / 1000;
        cacheRefresh = (expires - date) / 1000;

        page++;
      } while (page <= maxPage);

      return {age: age, cacheRefresh: cacheRefresh, lastModified : lastModified, expires : expires, data : res};
    },

    /*
     * Return corporate contracts
     * contractId: contract ID
     * out: array of corporate contracts
     */
    getCorporateContractItems: function(contractId) {
      // prepare paging
      let age = 0;      // data age in cache in seconds
      let cacheRefresh = 0;  // cache refresh in second
      let lastModified = 0;  // cache modification date
      let expires = 0;  // cache expiration date


      Logger.log(">>> Eve.getCorporateContractItems ()");

      // Call EVE Api
      var url = eveApi + '/corporations/' + Corporation.getId() + '/contracts/' + contractId.toString() + '/items/?datasource=tranquility';
      var response = UrlFetchApp.fetch(url, corp_authorized_options_get());

      // evaluate response code
      var code = response.getResponseCode();
      if (code != 200) { 
        throw ("Eve.getCorporateContractItems() Error: " + code + " " + response.getContentText())
      }

      // parse response to object
      var json = response.getContentText();
      var res = JSON.parse(json);
    
      // get response header
      let headers = response.getHeaders();
      maxPage = headers["x-pages"];
      expires = Date.parse(headers["Expires"]);
      let date = Date.parse(headers["Date"]);
      lastModified = Date.parse(headers["Last-Modified"]);
      console.log(">>> Response headers Modified " + lastModified + " date " + date + " expires " + expires + " maxPage " + maxPage);
      age = (date - lastModified) / 1000;
      cacheRefresh = (expires - date) / 1000;

      return {age: age, cacheRefresh: cacheRefresh, lastModified : lastModified, expires : expires, data : res};
    },

    /*
     * Return corporate market orders
     * includeCompleted: bool - include completed jobs
     * out: array of corporate jobs
     */
    getCorporateMarketOrders: function() {
      Logger.log(">>> Eve.getCorporateMarketOrders ()");

      // prepare paging
      let page = 1;     // queried page
      let maxPage = 1;  // max pages
      let res = [];     // full response json
      let age = 0;      // data age in cache in seconds
      let cacheRefresh = 0;  // cache refresh in second

      do {
        // Call EVE Api
        var url = eveApi + '/corporations/' + Corporation.getId() + '/orders/?datasource=tranquility&page=' + page
//        var response = UrlFetchApp.fetch(url, authorized_options_get());
        var response = UrlFetchApp.fetch(url, corp_authorized_options_get());

        // evaluate response code
        var code = response.getResponseCode();
        if (code != 200) { 
          throw ("Eve.getCorporateMarketOrders() Error: " + code + " " + response.getContentText())
        }

        // parse response to object
        var json = response.getContentText();
        var data = JSON.parse(json);
        
        // add partial response to complete response
        res = res.concat(data);
        
        // get max pages from response header
        let headers = response.getHeaders();
        maxPage = headers["x-pages"];
        let expires = Date.parse(headers["Expires"]);
        let date = Date.parse(headers["Date"]);
        let lastModified = Date.parse(headers["Last-Modified"]);
        console.log(">>> Response headers Modified " + lastModified + " date " + date + " expires " + expires);
//        console.log(res[0]);
        age = (date - lastModified) / 1000;
        cacheRefresh = (expires - date) / 1000;

        page++;
      } while (page <= maxPage);

      return {age: age, cacheRefresh: cacheRefresh, data : res};
    },

    /*
     * Return corporate market orders
     * structureId: structure_id
     * out: array of corporate jobs
     */
    getStructureMarketOrders: function(structureId) {
      Logger.log(">>> Eve.getStructureMarketOrders ()");

      // prepare paging
      let page = 1;     // queried page
      let maxPage = 1;  // max pages
      let res = [];     // full response json
      let age = 0;      // data age in cache in seconds
      let cacheRefresh = 0;  // cache refresh in second

      do {
        // Call EVE Api
        var url = eveApi + '/markets/structures/' + structureId + '/?datasource=tranquility&page=' + page
//        var response = UrlFetchApp.fetch(url, authorized_options_get());
        var response = UrlFetchApp.fetch(url, corp_authorized_options_get());

        // evaluate response code
        var code = response.getResponseCode();
        if (code != 200) { 
          throw ("Eve.getStructureMarketOrders() Error: " + code + " " + response.getContentText())
        }

        // parse response to object
        var json = response.getContentText();
        var data = JSON.parse(json);
        
        // add partial response to complete response
        res = res.concat(data);
        
        // get max pages from response header
        let headers = response.getHeaders();
        maxPage = headers["x-pages"];
        let expires = Date.parse(headers["Expires"]);
        let date = Date.parse(headers["Date"]);
        let lastModified = Date.parse(headers["Last-Modified"]);
//        console.log(">>> Response headers Modified " + lastModified + " date " + date + " expires " + expires + " etag " + eTag);
        age = (date - lastModified) / 1000;
        cacheRefresh = (expires - date) / 1000;

        page++;
      } while (page <= maxPage);

      return {age: age, cacheRefresh: cacheRefresh, data : res};
    },

    /*
     * Return corporate wallet journal
     * division: division
     * out: array of corporate journal items
     */
    getCorporateWalletJournal: function(division ) {
      Logger.log(">>> Eve.getCorporateWalletJournal ()");

      // prepare paging
      let page = 1;     // queried page
      let maxPage = 1;  // max pages
      let res = [];     // full response json
      let age = 0;      // data age in cache in seconds
      let cacheRefresh = 0;  // cache refresh in second

      do {
        // Call EVE Api
        var url = eveApi + '/corporations/' + Corporation.getId() + '/wallets/' + division + '/journal/?datasource=tranquility&page=' + page;
        var response = UrlFetchApp.fetch(url, corp_authorized_options_get());

        // evaluate response code
        var code = response.getResponseCode();
        if (code != 200) { 
          throw ("Eve.getCorporateWalletJournal() Error: " + code + " " + response.getContentText())
        }

        // parse response to object
        var json = response.getContentText();
        var data = JSON.parse(json);
        
        // add partial response to complete response
        res = res.concat(data);
        
        // get max pages from response header
        let headers = response.getHeaders();
        maxPage = headers["x-pages"];
        let expires = Date.parse(headers["Expires"]);
        let date = Date.parse(headers["Date"]);
        let lastModified = Date.parse(headers["Last-Modified"]);
        console.log(">>> Response headers Modified " + lastModified + " date " + date + " expires " + expires);
        age = (date - lastModified) / 1000;
        cacheRefresh = (expires - date) / 1000;

        page++;
      } while (page <= maxPage);

      return {age: age, cacheRefresh: cacheRefresh, data : res};
    },

    /*
     * Return list of IDs matching search creteria
     * category: one of agent, alliance, character, constellation, corporation, faction, inventory_type, region, solar_system, station, structure
     * search: searched part of name
     * out: array of corporate jobs
     */
    search: function(catrgory, search) {
      Logger.log(">>> Eve.search ()");

      // Call EVE Api
      // API Search: https://esi.evetech.net/latest/characters/2117327790/search/?categories=structure&datasource=tranquility&language=en&search=zeus&strict=false
      var url = eveApi + '/characters/' + Personal.getId() + '/search/?categories=' + catrgory + '&datasource=tranquility&language=en&search=' + search + '&strict=false'
      var response = UrlFetchApp.fetch(url, authorized_options_get());

      // evaluate response code
      var code = response.getResponseCode();
      if (code != 200) { 
        throw ("Eve.search() Error: " + code + " " + response.getContentText())
      }

      // parse response to object
      var json = response.getContentText();
      var data = JSON.parse(json);
      
      /*
      // add partial response to complete response
      res = res.concat(data);
      
      // get max pages from response header
      let headers = response.getHeaders();
      maxPage = headers["x-pages"];
      let expires = Date.parse(headers["Expires"]);
      let date = Date.parse(headers["Date"]);
      let lastModified = Date.parse(headers["Last-Modified"]);
//        console.log(">>> Response headers Modified " + lastModified + " date " + date + " expires " + expires + " etag " + eTag);
      age = (date - lastModified) / 1000;
      cacheRefresh = (expires - date) / 1000;

*/
      return data;
    },

    /*
     * Return build cost of blueprints
     * blueprintTypeIds: number[] - IDs of blueprint typeIDs to be calculated
     * quantity: quantity (1)
     * priceMode: price mode (sell, buy) of jita prices
     * additionalCosts: additionalCosts (2000000)
     * baseMe: baseMe (10)
     * componentsMe: componentsMe (10)
     * system: system name (Q-02UL)
     * facilityTax: facilityTax (0)
     * industryStructureType: industryStructureType (Station, Raitaru, Azbel, Sotiyo)
     * industryRig: industryRig (null, T1, T2)
     * reactionStructureType: reactionStructureType (Athanor, Tatara)
     * reactionRig: reactionRig (null, T1, T2)
     * reactionFlag: flag to calculate reaction costs (null, Yes)
     * blueprintVersion: server type (dev, tq)
     * returns list of build costs
     */
    getBuildCosts: function(blueprintTypeIds, quantity, priceMode, additionalCosts, baseMe, componentsMe, system, facilityTax, industryStructureType, industryRig, reactionStructureType, reactionRig, reactionFlag, blueprintVersion) {
      Logger.log(">>> Eve.getBuildCosts ()");

      var url = cookbookApi + '/buildCost/' + 
        '?blueprintTypeId=' + blueprintTypeIds.join() +
        '&quantity=' + quantity + 
        '&priceMode=' + priceMode + 
        '&additionalCosts=' + additionalCosts +
        '&baseMe=' + baseMe +
        '&componentsMe=' + componentsMe +
        '&system=' + system +
        '&facilityTax=' + facilityTax +
        '&industryStructureType=' + industryStructureType +
        '&industryRig=' + industryRig + 
        '&reactionStructureType=' + reactionStructureType + 
        '&reactionRig=' + reactionRig +
        '&reactionFlag=' + reactionFlag +
        '&blueprintVersion=' + blueprintVersion

      Logger.log(">>> URL: " + url);

      var response = UrlFetchApp.fetch(url, options_get);
      
      // evaluate response code
      var code = response.getResponseCode();
      if (code != 200) { 
        throw ("Eve.getBuildCosts() Error: " + code + " " + response.getContentText())
      }

      // parse response to object
      var json = response.getContentText();
      var data = JSON.parse(json);

      return data;

    },

 };
})();


function test_resolveNames() {
  console.log(Eve.resolveNames(["P-ZMZV"], "systems"));
  console.log(Eve.resolveNames(["Muninn Blueprint"], "inventory_types"));
  console.log(Eve.resolveNames(["P-ZMZV - Dracarys Prime"]));
}

function test_names() {
  console.log(Eve.names([2112870401,98652228,30004771]));
}

function test_getIndusrtyCostIndices() {
  console.log(Eve.getIndusrtyCostIndices(30002900));
}

function testGetStructureInfo () {
  console.log(Eve.getStructureInfo(1030049082711));
}

function testGetTypeInfo () {
  console.log(Eve.getTypeInfo(971));
}

function testGetGroupInfo () {
  console.log(Eve.getGroupInfo(1269));
  console.log(Eve.getGroupInfo(1317));
}

function testGetCategoryInfo () {
  console.log(Eve.getCategoryInfo(9));
}


function testGetCharacter () {
  console.log(Eve.getCharacter(2117327790));
}

function testPersonalAssets () {
  let assets = Eve.getPersonalAssets(2117699647);
  console.log(assets);

  // apply filter
  console.log(assets.data.filter(item => {return (item.location_flag == 'Hangar')}))
}

function testPersonalAssetsNames () {
  let assetsNames = Eve.getPersonalAssetsNames(2117699647, [1035396289048]);
  console.log(assetsNames);
}


function testGetPersonalJobs () {
  console.log(Eve.getPersonalJobs(2117699647, true));
}

function testGetCorporateWalletJournal() {
  console.log(Eve.getCorporateWalletJournal(1));
}

function testGetCorporateAssets () {
  // get all assets
  let assets = Eve.getCorporateAssets();
//  console.log(assets);

  // apply filter
  /*
  console.log(assets.data.filter(item => {return (item.location_id == 1038741188154 && item.location_flag == 'OfficeFolder')})) // maze
  console.log(assets.data.filter(item => {return (item.location_flag == 'OfficeFolder')})) // granary
  console.log(assets.data.filter(item => {return (item.location_flag == 'Hangar')}))
  1042794917617 -> 1042655795391 -> 1039919635788
  1044548001607 -> 1044546536155 -> 1042023303246
  */
  console.log(assets.data.filter(item => {return (item.item_id == 1044546536155)})) // maze
  

  // unique location IDs
  let structureIds = assets.data
    .map((item) => item.location_id)
    .filter(
        (value, index, current_value) => current_value.indexOf(value) === index
        );

  // log ID and name
  structureIds.forEach(item => {
    try {
      console.log (Eve.getStructureInfo(item));
    } catch {
      console.log ("Unauthorized")
    }
  })

}


function testGetCorporateBlueprints () {
  let bps = Eve.getCorporateBlueprints();

  console.log(bps.data.filter(item => {return (item.type_id == 31725)}))
  console.log(bps.data.filter(item => {return (item.type_id == 22457)}))

  console.log(bps.data.filter(item => {return (item.runs == -1)}))
//  var capitalBP = bp.data.filter(item => item.typeName.startsWith('Capital') && item.runs == -1);

  console.log(bps);

}


function testCorporateAssetsNames () {
  let assetsNames = Eve.getCorporateAssetsNames([1037773932055, 1037774676918]);

  console.log(assetsNames);
}

function testGetCorporateJobs () {
  var jobs = Eve.getCorporateJobs(true);
//  console.log(jobs);
//  var missJobs = jobs.data.filter(item => {return (item.location_id != item.output_location_id && item.runs == 1)})
//  var missJobs = jobs.data.filter(item => {return (item.location_id != item.output_location_id && item.activity_id == 9)})
  console.log(jobs.data.filter(item => {return (item.activity_id == 8)}))

//  console.log(missJobs);
}

function testGetCorporateMarketOrders () {
  let orders = Eve.getCorporateMarketOrders();

  console.log(orders);

}

function testGetPersonalContracts() {
  let c = Eve.getPersonalContracts()
  console.log(c);
  let id = c.data[0].contract_id
  let i = Eve.getPersonalContractItems(id);
  console.log(i);
}

function testGetCorporateContracts () {
  let c = Eve.getCorporateContracts();
//  console.log(c);
  let f = c.data.filter(x=> (
    // x.assignee_id == 2117327790   // Aubi
//     x.acceptor_id == 98652228
//    x.availability == 'personal'
//    && x.status == 'outstanding'
//    x.status != 'finished' &&
//     x.type == 'item_exchange'
//    x.days_to_complete > 0 &&
    x.date_accepted == null &&
    x.date_expired == null &&

    x.title != ''
  ))

//  f = f.sort((a,b) => (a.date_issued < b.date_issued) ? 1 : -1);

//  console.log(f);
  let l = f.map(a => ({
    ...a,
//    title : a.title,
    contract_id : a.contract_id,
//    acceptor : Universe.getName(a.acceptor_id).name,
    issuer: Universe.getName(a.issuer_id).name,
//    assignee : Universe.getName(a.assignee_id).name
//    start_location : Universe.getName(a.start_location_id).name
  }))

  console.log(l);

  let f2 = l.filter(x=> (x.issuer == 'Janka Slovakia'));

  console.log(f2);
}

function testGetStructureMarketOrders () {
  console.log(Eve.getStructureMarketOrders(1043661023026))
}

function testSearch() {
  var ret = Eve.search('structure', 'Q-02UL');
  console.log(ret);

  ret.structure.forEach(r=> {
    console.log(Eve.getStructureInfo(r));
  })
}


function testGetBuildCosts() {
  console.log (Eve.getBuildCosts([683,685], 1, 'sell', 0, 10, 10, 'Q-02UL', 0, 'Sotiyo', 'T2', 'Tatara', 'T2', 'Yes', 'tq'))
}