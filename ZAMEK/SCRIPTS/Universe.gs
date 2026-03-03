/*
 * EVE Universe object
 */ 
const Universe = (()=>{
  var categoryMap;
  var groupMap;
  var typeMap;
  var charactersMap;
  var nameMap;
  var mainMap;
  var locationsMap;
  const activityMap = new Map();
  activityMap.set(1, 'Manufacturing');
  activityMap.set(3, 'Research TE');
  activityMap.set(4, 'Research ME');
  activityMap.set(5, 'Copying');
  activityMap.set(8, 'Invention');
  activityMap.set(9, 'Reaction');
  activityMap.set(11, 'Reaction');

  const _TRACE = (() => {
    try {
      const v = PropertiesService.getScriptProperties().getProperty('DEBUG_TRACE');
      return String(v || '') === '1';
    } catch (e) {
      return false;
    }
  })();

  /* Returns initialized category id-name map */
  var getCategoryMap = function() {
    if (!categoryMap) {
      // load categories from spreadsheet
      if (_TRACE) Logger.log('### Loading Categories ...')
      var lastRow = categoriesSheet.getLastRow();

      if (lastRow > 1) {
        // create map from the sheet contents
        let categories = categoriesSheet.getRange(2, 1, lastRow - 1, 3).getValues();

        categoryMap = new Map(categories.map(obj =>
            [obj[0],
            ({
              category_id: obj[0],
              category_name: obj[1],
            })]
        ));
      } else {
        // create an empty map
        categoryMap = new Map();
      }
    }
    return categoryMap;
  } 

  /* Returns initialized group id-name map */
  var getGroupMap = function() {
    if (!groupMap) {
      // load groups from spreadsheet
      if (_TRACE) Logger.log('### Loading Groups ...')
      var lastRow = groupsSheet.getLastRow();

      if (lastRow > 1) {
        // create map from the sheet contents
        let groups = groupsSheet.getRange(2, 1, lastRow - 1, 3).getValues();

        groupMap = new Map(groups.map(obj =>
            [obj[0],
            ({
              group_id: obj[0],
              group_name: obj[1],
              category_id: obj[2]
            })]
        ));
      } else {
        // create an empty map
        groupMap = new Map();
      }
    }
    return groupMap;
  } 

  /* Returns initialized type id-name map */
  var getTypeMap = function() {
    if (!typeMap) {
      // load types from spreadsheet
      if (_TRACE) Logger.log('### Loading Types ...')
      var lastRow = typesSheet.getLastRow();

      if (lastRow > 1) {
        // create map from the sheet contents
        let types = typesSheet.getRange(2, 1, lastRow - 1, 6).getValues();

        typeMap = new Map(types.map(obj =>
            [obj[0],
            ({
              type_id: obj[0],
              type_name: obj[1],
              group_id: obj[2],
              group: obj[3],
              category_id: obj[4],
              category_name: obj[5]
            })]
        ));
      } else {
        // create an empty map
        typeMap = new Map();
      }
    }
    return typeMap;
  } 

  /* Returns initialized characters id-name map */
  var getCharactersMap = function() {
    if (!charactersMap) {
      // load characters from spreadsheet
      if (_TRACE) Logger.log('### Loading Characters ...')
      var lastRow = charactersSheet.getLastRow();

      if (lastRow > 1) {
        // create map from the sheet contents
        let characters = charactersSheet.getRange(2, 1, lastRow - 1, 5).getValues();

        charactersMap = new Map(characters.map(obj =>
          [obj[0], 
            {
              character_id: obj[0],
              name: obj[1],
              description: obj[2],
              corporation_id: obj[3],
              alliance_id: obj[4]
            }
          ]
        ));
      } else {
        // create an empty map
        charactersMap = new Map();
      }
    }
    return charactersMap;
  } 

  /* Returns initialized id-name map */
  var getNamesMap = function() {
    if (!nameMap) {
      // load characters from spreadsheet
      if (_TRACE) Logger.log('### Loading Names ...')
      var lastRow = namesSheet.getLastRow();

      if (lastRow > 1) {
        // create map from the sheet contents
        let names = namesSheet.getRange(2, 1, lastRow - 1, 3).getValues();

        nameMap = new Map(names.map(obj =>
          [obj[0], 
            {
              id: obj[0],
              name: obj[1],
              category: obj[2]
            }
          ]
        ));
      } else {
        // create an empty map
        nameMap = new Map();
      }
    }
    return nameMap;
  } 

  /* Returns initialized id-name map */
  var getMainMap = function() {
    if (!mainMap) {
      // load characters from spreadsheet
      if (_TRACE) Logger.log('### Loading Mains ...')
      var lastRow = jobHistorySheet.getLastRow();

      if (lastRow > 1) {
        // create map from the sheet contents
        let names = jobHistorySheet.getRange(2, 1, lastRow - 1, 2).getValues();
        // filter empty values
        let namesFiltered = names.filter(i => i[0]);

        mainMap = new Map(namesFiltered.map(obj =>
          [obj[0], obj[1]]
        ));
      } else {
        // create an empty map
        mainMap = new Map();
      }
    }
    return mainMap;
  } 

  /* Returns initialized locations id-name map */
  var getLocationsMap = function() {
    if (!locationsMap) {
      // load locations from spreadsheet
      if (_TRACE) Logger.log('### Loading Locations ...')
      var lastRow = locationsSheet.getLastRow();

      if (lastRow > 1) {
        // create map from the sheet contents
        let locations = locationsSheet.getRange(2, 1, lastRow - 1, 3).getValues();

        locationsMap = new Map(locations.map(obj =>
            [obj[0], obj[2]]
        ));
      } else {
        // create an empty map
        locationsMap = new Map();
      }
    }
    return locationsMap;
  } 

  return {
    /* Returns Activity name by Id */
    getActivity: function(activityId) {
      return activityMap.get(activityId);
    },

    /*
     * Returns type by Id
     * typeId: type ID
     * out: JSON
     */
    getType: function(typeId) {
      // get the type map and initialize if needed
      const types = getTypeMap();
      let ret = types.get(typeId);

      if (!ret) {
        // item not found, query EVE api
        var json = Eve.getTypeInfo (typeId);

        // get the group info
        group = this.getGroup(json.group_id);

        // get category name
        category = this.getCategory(group.category_id);

        // append type at the end of the types worksheet
        var row = 
          [ json.type_id
          , json.name
          , json.group_id
          , group.group_name
          , group.category_id 
          , category.category_name         
          ]
        typesSheet.appendRow(row);

        // create the return type object
        ret = ({
                type_id: json.type_id,
                type_name: json.name,
                group_id: json.group_id,
                group: group.group_name,
                category_id: group.category_id,
                category_name: category.category_name
              })

        // add type to the map
        types.set(json.type_id, ret)
      }

      return ret;
    },

    /*
     * Returns group by Id
     * groupId: group ID
     * out: JSON
     */
    getGroup: function(groupId) {
      // get the type map and initialize if needed
      const groups = getGroupMap();
      let ret = groups.get(groupId);

      if (!ret) {
        // item not found, query EVE api
        var json = Eve.getGroupInfo (groupId);

        // append type at the end of the types worksheet
        var row = 
          [ json.group_id
          , json.name
          , json.category_id
          ]
        groupsSheet.appendRow(row);

        // create the return type object
        ret = ({
                group_id: json.group_id,
                group_name: json.name,
                category_id: json.category_id
              })

        // add type to the map
        groups.set(json.group_id, ret)
      }

      return ret;
    },

    /*
     * Returns category by Id
     * categoryId: category ID
     * out: JSON
     */
    getCategory: function(categoryId) {
      // get the type map and initialize if needed
      const categories = getCategoryMap();
      let ret = categories.get(categoryId);

      if (!ret) {
        // item not found, query EVE api
        var json = Eve.getCategoryInfo (categoryId);

        // append type at the end of the types worksheet
        var row = 
          [ json.category_id
          , json.name
          ]
        categoriesSheet.appendRow(row);

        // create the return type object
        ret = ({
                category_id: json.category_id,
                category_name: json.name,
              })

        // add type to the map
        categories.set(json.category_id, ret)
      }

      return ret;
    },

        /*
     * Searches type by Name
     * typeName: type name
     * out: JSON
     */
    searchType: function(typeName) {
      // get the type map and initialize if needed
      const types = getTypeMap();

      for (const entry of types) {
        if (entry[1].type_name == typeName) {
          return entry[1];
        }
      }

      // Type not found, query EVE Api
      let data = Eve.resolveNames([typeName], "inventory_types");

      // Api not returning right one record - throw exception
      if (!data) {
        throw ("Universe.searchType(" + typeName + "): typ nenalezen");
      }

      // one record found, reuse getType() to download type details and reinitialize the type map
      return this.getType(data[0].id)
    },

    /*
     * Returns character info
     * characterId: character ID
     * out: object
     */
    getCharacter: function(characterId) {
      // get the type map and initialize if needed
      const characters = getCharactersMap();
      let ret = characters.get(characterId);

      if (!ret) {
        // item not found, query EVE api
        json = Eve.getCharacter (characterId);
        json.character_id = characterId;

        // append character at the end of the charcters worksheet
        var row = 
          [ json.character_id
          , json.name
          , json.description
          , json.corporation_id
          , json.alliance_id
          ]
        charactersSheet.appendRow(row);

        // create the return type object
        ret = json;

        // add type to the map
        characters.set(characterId, json)
      }

      return ret;
    },

    /*
     * Returns character name by Id
     * characterId: character ID
     * out: string
     */
    getCharacterName: function(characterId) {
      var character = this.getCharacter(characterId);
      return character.name
    },

    /*
     * Returns location name by Id
     * locationId: location ID
     * out: string
     */
    getLocationName: function(locationId) {
      // get the type map and initialize if needed
      const locations = getLocationsMap();
      let ret = locations.get(locationId);

      if (!ret) {
        // item not found, query EVE api
        let json;
        try {
          json = Eve.getStructureInfo(locationId);
        } catch {
          json = {};
          json.name = "Unknown: " + locationId
        }

        // append type at the end of the types worksheet
        var row = 
          [ locationId
          , 'structures'
          , json.name
          ]
        locationsSheet.appendRow(row);

        // create the return type object
        ret = json.name;

        // add type to the map
        locationsMap.set(locationId, ret)
      }

      return ret;
    },

    /*
     * Returns name of an object as of /universe/name/ API
     * id: id
     * out: object
     */
    getName: function(id) {
      // get the type map and initialize if needed
      const names = getNamesMap();
      let ret = names.get(id);

      if (!ret) {
        // item not found, query EVE api
        let json = Eve.names ([id])[0];
  /*
  [ { category: 'character',
    id: 2121760525,
    name: 'Bruce Templeton' } ]
  */
        // append character at the end of the charcters worksheet
        var row = 
          [ json.id
          , json.name
          , json.category
          ]
        namesSheet.appendRow(row);
        // create the return type object
        ret = json;
        // add type to the map
        names.set(id, json)
      }
      return ret;
    },

    /*
     * Returns name of main character from mapping in History sheet
     * name: character name
     * out: character main name
     */
    getMainName: function(name) {
      // get the type map and initialize if needed
      const names = getMainMap();
      let ret = names.get(name);

      if (!ret) {
        // no main defined, return character name
        return name
      }
      return ret;
    },

    /*
     * Utility, translates duration in seconds to string
     * duration: duration in seconds
     * out: string
     */
    durationToString(duration) {
      const totalMinutes = Math.floor(duration / 60);

      const seconds = Math.floor(duration % 60);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;

      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
  }
})()

function testUniverseGetCategory() {
  console.log(Universe.getCategory(10));
}

function testUniverseGetType() {
  console.log(Universe.getType(979));
}

function testUniverseGetCharacterName() {
  console.log(Universe.getCharacterName(2117699646));
  console.log(Universe.getCharacterName(2117699646));
}

function testUniverseSearchType() {
  console.log(Universe.searchType("Nyx Blueprint"));
}

function testUnivetseDurationToString() {
  console.log(Universe.durationToString(12345));
}

function testUnivetsegetCharacter() {
  console.log(Universe.getCharacter('2117699647'));
}

function testUnivetseGetName() {
  console.log(Universe.getName(30004771));
  console.log(Universe.getName(30004769));
  console.log(Universe.getName(30004746));
  console.log(Universe.getName(30004017));
  console.log(Universe.getName(30004749));
  console.log(Universe.getName(30004745));
  console.log(Universe.getName(30004770));
  console.log(Universe.getName(30004768));
  console.log(Universe.getName(30004766));
  console.log(Universe.getName(30004748));
  console.log(Universe.getName(30004744));
}

function testUnivetseGetMainName() {
  console.log(Universe.getMainName('Picus'));
}

function testGetLocationName() {
  console.log(Universe.getLocationName(1036988766348));
}

/*
1044548001607	CorpSAG1	1036852552777
1042794917617	CorpSAG6	1041299687836
*/