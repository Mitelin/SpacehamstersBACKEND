/*
 * EVE Personal object
 */ 
const Personal = (()=>{
  var characterId;    // logged user character ID
  var characterName;  // logged user character name
  var userProperties = PropertiesService.getUserProperties(); // user properties holding access token
 
  /* Parses EVE Api acces token and fills internal variables */
  var parseAccessToken = function(accessToken) {
      if (!accessToken) {
        SpreadsheetApp.getUi().alert('Chyba!', 'Nejsi přihlášený! klikni Menu: EVE Data - Login', SpreadsheetApp.getUi().ButtonSet.OK);
        return;
      }
      let body = accessToken.split('.')[1];
      let decoded = Utilities.newBlob(Utilities.base64Decode(body)).getDataAsString();
      let json = JSON.parse(decoded);
      characterId = json.sub.split(':')[2];
      characterName = json.name;
  }

  return {
    /*
     * Returns character ID
     */
    getId: function() {
      if (!characterId) {
        // parse characterId from acces token
        parseAccessToken(this.getAccessToken())
      }
      return characterId;
    },

    /*
     * Returns character name
     */
    getName: function() {
      if (!characterId) {
        // parse characterId from acces token
        parseAccessToken(this.getAccessToken())
      }
      return characterName;
    },

    /*
     * Returns user access token expiration
     */
    getTokenExpiration: function() {
      return Security.getTokenExpiration(userProperties);
    },

    /*
     * Returns user access token
     */
    getAccessToken: function() {
      return Security.getAccessToken(userProperties);
    },
        
    /*
     * Returns personal hangars for specific industry
     * type: indutry type - manufacturing, reaction, research
     * out: array of JSONs
     */
    getHangars(type) {
      let structure;  // industry structure
      let res = [];        // response

      // get corporation structure for specific industry type
      if (type.toLowerCase() == 'manufacturing') structure = Corporation.getManufacturingStructure();
      else if (type.toLowerCase() == 'reaction') structure = Corporation.getReactionStructure();
      else if (type.toLowerCase() == 'research') structure = Corporation.getResearchStructure();
      else throw ("Personal.getHangars(" + type + "): Chyba, neznýmý typ hangáru")

      // push root location
      let item = {};
      item.location_id = structure.structure_id;
      item.name = structure.name;
      res.push(item);

      // get all personal assets
      let assets = Eve.getPersonalAssets(this.getId());

      // filter assets - in structure hangar, being singleton and one of container types
      let containers = assets.data.filter(item => {
        return ((item.type_id == 17366 || item.type_id == 17368) && item.is_singleton && item.location_id == structure.structure_id)
      });
  
      console.log(containers);
      let assetsNames = [];

      // get container names
      if (containers.length > 0) {
        var itemIds = containers.map(a => a.item_id);
        assetsNames = Eve.getPersonalAssetsNames(this.getId(), itemIds);
  //      console.log(assetsNames);
      }
      // push containers
//      res = res.concat(assetsNames.map(a => ({location_id: a.item_id, name: structure.name + "." + a.name})));
      res = res.concat(assetsNames.map(a => ({location_id: a.item_id, name: a.name})));
      return res;
    },

    /*
     * Returns personal jobs in specific hangars
     * hangars: array of numbers - location IDs of job outputs
     * out: array of JSONs
     */
    getJobs(hangars) {
      var jobs = Eve.getPersonalJobs(this.getId(), false);

      var jobsFiltered;
      
      if (hangars) {
        jobsFiltered = jobs.data.filter(item => {
          return (hangars.includes(item.output_location_id))
        });
      } else jobsFiltered = jobs.data;

//      console.log(jobsFiltered);

      var jobsTranslated = jobsFiltered.map(a => ({
          activity_id: a.activity_id,
          activity_name: Universe.getActivity(a.activity_id),
          blueprint_type_id: a.blueprint_type_id,
          blueprint_name: Universe.getType(a.blueprint_type_id).type_name,
          duration: a.duration,
          runs: a.runs,
          product_type_id: a.product_type_id,
          product_name: Universe.getType(a.product_type_id).type_name,
          status: a.status,
          output_location_id: a.output_location_id
        }));

      return {age: jobs.age, cacheRefresh: jobs.cacheRefresh, data : jobsTranslated};
    },

    /*
     * Returns personal assets in specific hangars
     * hangars: array of numbers - location IDs 
     * out: array of JSONs
     */
    getAssets(hangars) {
      var assets = Eve.getPersonalAssets(this.getId());

      var assetsFiltered = assets.data.filter(item => {
        return (hangars.includes(item.location_id))
      });

//      console.log(assetsFiltered);

      var assetsTranslated = assetsFiltered.map(a => ({
          type_id: a.type_id,
          type_name: Universe.getType(a.type_id).type_name,
          quantity: a.quantity,
          location_id: a.location_id
        }));

      return {age: assets.age, cacheRefresh: assets.cacheRefresh, data : assetsTranslated};
    },

  }
})()

function testPersonalGetId() {
  console.log(Personal.getId());
}

function testPersonalGetHangars() {
  console.log(Personal.getHangars('manufacturing'));
  console.log(Personal.getHangars('reaction'));
}

function testPersonalGetJobs() {
//  console.log(Personal.getJobs([1037711985818,1037711985777]));
  console.log(Personal.getJobs());
}

function testPersonalGetAssets() {
  console.log(Personal.getAssets([1037711985818]));
//  console.log(Personal.getAssets([1037711985818,1037711985777,1039175721437]));
}

/*
    status: 'active' } ]
    */