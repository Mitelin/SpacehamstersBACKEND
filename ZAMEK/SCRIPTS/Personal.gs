/*
 * EVE Personal object
 */ 
const Personal = (()=>{
  // Cache decoded character info per token profile ('' vs 'sales').
  var characterIdByProfile = {};    // profile -> character ID
  var characterNameByProfile = {};  // profile -> character name
  var userProperties = PropertiesService.getUserProperties(); // user properties holding access token

  var normalizeProfile = function(profile) {
    profile = String(profile || '').trim().toLowerCase();
    return profile;
  }

  var profileSuffix = function(profile) {
    profile = normalizeProfile(profile);
    return profile ? (':' + profile) : '';
  }

  var scopedProps = function(characterId, profile) {
    var cid = String(characterId || '').trim();
    if (!cid) return userProperties;
    var suffix = profileSuffix(profile);
    return {
      getProperty: function(key) {
        return userProperties.getProperty(key + ':' + cid + suffix);
      },
      setProperty: function(key, value) {
        return userProperties.setProperty(key + ':' + cid + suffix, value);
      },
      deleteProperty: function(key) {
        return userProperties.deleteProperty(key + ':' + cid + suffix);
      }
    }
  }

  var activeKeyForProfile = function(profile) {
    profile = normalizeProfile(profile);
    if (profile === 'sales') return 'active_character_id_sales';
    return 'active_character_id';
  }

  var getActiveCharacterId = function(profile) {
    var v = userProperties.getProperty(activeKeyForProfile(profile));
    return v ? String(v).trim() : '';
  }

  var setActiveCharacterId = function(cid, profile) {
    cid = String(cid || '').trim();
    if (!cid) throw ('Character ID is empty');
    userProperties.setProperty(activeKeyForProfile(profile), cid);
    // clear caches so getId/getName re-parse
    profile = normalizeProfile(profile);
    delete characterIdByProfile[profile];
    delete characterNameByProfile[profile];
  }
 
  /* Parses EVE Api acces token and fills internal variables */
  var parseAccessToken = function(accessToken) {
      if (!accessToken) {
        SpreadsheetApp.getUi().alert('Chyba!', 'Nejsi přihlášený! klikni Menu: EVE Data - Login', SpreadsheetApp.getUi().ButtonSet.OK);
        return;
      }
      let body = accessToken.split('.')[1];
      let decoded = Utilities.newBlob(Utilities.base64Decode(body)).getDataAsString();
      let json = JSON.parse(decoded);
      return {
        characterId: json.sub.split(':')[2],
        characterName: json.name
      };
  }

  return {
    /*
     * Sets which stored character token should be used for Personal.* calls.
     * Requires that the character was previously logged in (token stored).
     */
    setActiveCharacter: function(cid, profile) {
      profile = normalizeProfile(profile);
      setActiveCharacterId(cid, profile);

      // Keep legacy keys aligned only for the default (full) token profile.
      // Sales/profiled tokens should not overwrite legacy keys.
      if (!profile) {
        var a = userProperties.getProperty('access_token:' + String(cid));
        var r = userProperties.getProperty('refresh_token:' + String(cid));
        var e = userProperties.getProperty('expires_in:' + String(cid));
        var i = userProperties.getProperty('issued:' + String(cid));
        if (a && r) {
          userProperties.setProperty('access_token', a);
          userProperties.setProperty('refresh_token', r);
          if (e) userProperties.setProperty('expires_in', e);
          if (i) userProperties.setProperty('issued', i);
        } else {
          throw ('Pro tento charakter nemáš uložený token. Přihlas se jako on přes EVE Data → Login.');
        }
      }
    },

    getActiveCharacterId: function(profile) {
      return getActiveCharacterId(profile);
    },

    /*
     * Returns character ID
     */
    getId: function(profile) {
      profile = normalizeProfile(profile);
      if (!characterIdByProfile[profile]) {
        var parsed = parseAccessToken(this.getAccessToken(profile));
        if (parsed) {
          characterIdByProfile[profile] = parsed.characterId;
          characterNameByProfile[profile] = parsed.characterName;
        }
      }
      return characterIdByProfile[profile];
    },

    /*
     * Returns character name
     */
    getName: function(profile) {
      profile = normalizeProfile(profile);
      if (!characterIdByProfile[profile]) {
        var parsed = parseAccessToken(this.getAccessToken(profile));
        if (parsed) {
          characterIdByProfile[profile] = parsed.characterId;
          characterNameByProfile[profile] = parsed.characterName;
        }
      }
      return characterNameByProfile[profile];
    },

    /*
     * Returns user access token expiration
     */
    getTokenExpiration: function(profile) {
      var cid = getActiveCharacterId(profile);
      profile = normalizeProfile(profile);
      // If sales-active character isn't set yet, fall back to full-active character.
      if (!cid && profile === 'sales') cid = getActiveCharacterId('');
      if (cid) return Security.getTokenExpiration(scopedProps(cid, profile));
      // Full profile may fall back to legacy keys.
      if (!profile) return Security.getTokenExpiration(userProperties);
      return 0;
    },

    /*
     * Returns user access token
     */
    getAccessToken: function(profile) {
      profile = normalizeProfile(profile);
      var cid = getActiveCharacterId(profile);
      // If sales-active character isn't set yet, fall back to full-active character.
      if (!cid && profile === 'sales') cid = getActiveCharacterId('');
      var token;
      if (cid) {
        try {
          token = Security.getAccessToken(scopedProps(cid, profile));
        } catch (e) {
          var msg = String(e);
          if (msg.indexOf('Missing refresh token') >= 0) {
            if (profile === 'sales') {
              throw ('Chybí Sales refresh token pro aktivní charakter. Otevři EVE Data → Login a udělej Sales login.');
            }
            throw ('Chybí Full refresh token pro aktivní charakter. Otevři EVE Data → Login a udělej Full login.');
          }
          throw e;
        }

        // Mirror to legacy keys so older code keeps working (full profile only).
        if (!profile && token) {
          userProperties.setProperty('access_token', token);
          var e = userProperties.getProperty('expires_in:' + cid);
          var i = userProperties.getProperty('issued:' + cid);
          if (e) userProperties.setProperty('expires_in', e);
          if (i) userProperties.setProperty('issued', i);
        }
      } else {
        try {
          token = Security.getAccessToken(userProperties);
        } catch (e) {
          var msg = String(e);
          if (msg.indexOf('Missing refresh token') >= 0) {
            throw ('Nejsi přihlášený. Otevři EVE Data → Login a udělej Full login (a případně i Sales login pro Jita Sales).');
          }
          throw e;
        }
      }
      return token;
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