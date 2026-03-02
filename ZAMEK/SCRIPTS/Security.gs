/*
 * EVE Universe object
 */ 
const Security = (()=>{

  /* Constants */
  const eveSsoUrl = 'https://login.eveonline.com/v2/oauth/authorize?response_type=code'
  const eveTokenApi = 'https://login.eveonline.com/v2/oauth/token'
  const eveUserApi = 'https://login.eveonline.com/v2/oauth/verify'
  const scriptUrl = 'https://script.google.com/macros/d/1hZ_YxV-xgrgSRWEzpRHd6m6VFUKs-Ut8BwK0_Q4EQzV1GjOnvZO-ber4/usercallback';
  const scopes = 'esi-markets.read_corporation_orders.v1 esi-universe.read_structures.v1 esi-wallet.read_corporation_wallets.v1 esi-wallet.read_corporation_wallet.v1 esi-corporations.read_container_logs.v1 esi-assets.read_corporation_assets.v1 esi-industry.read_corporation_jobs.v1 esi-assets.read_assets.v1 esi-industry.read_character_jobs.v1 esi-corporations.read_blueprints.v1 esi-markets.structure_markets.v1 esi-search.search_structures.v1 esi-contracts.read_corporation_contracts.v1 esi-contracts.read_character_contracts.v1'
  const clientID = '7d2a7aff316448d497ca69f4b9f0cb6e'
  const clientSecret = PropertiesService.getScriptProperties().getProperty('EVE_CLIENT_SECRET')

  return {
    /*
    * Generates EVE Login URL with state leading to eveCallback function invocation
    */
    eveLoginUrl: function() {
      Logger.log ('### Security.eveLoginUrl() called ...')

      // generate the EVE login URL
      var stateToken = ScriptApp.newStateToken()
        .withMethod('eveCallback')
        .withTimeout(120)
        .createToken();

      var url = eveSsoUrl
              + '&redirect_uri=' + scriptUrl 
              + '&state=' + stateToken
              + '&client_id=' + clientID
              + '&scope=' + encodeURIComponent(scopes)

      console.log(url);
      return url;
    },

    /*
    * Callback function to be invoked after EVE OAuth login is completed
    */
    eveCallback: function(e) {
      // extract code or error
      var code = e.parameters.code[0];
      var error = e.parameters.error;

      if (code) {
        if (!clientSecret) throw('EVE_CLIENT_SECRET is not set in Script Properties')
        var req = {}
        req.grant_type = "authorization_code";
        req.code = code;

        // POST request to EVE token API
        var options = {
          'method' : 'post',
          'contentType': 'application/x-www-form-urlencoded',
          "headers" : {    
            'Authorization': 'Basic ' + Utilities.base64Encode(clientID + ':' + clientSecret)
          },
          'payload' : req
        };
        var response = UrlFetchApp.fetch(eveTokenApi, options);

        // parsuj odpoved do pole struktur
        var json = response.getContentText();
        var data = JSON.parse(json);
        var userProperties = PropertiesService.getUserProperties()

        userProperties.setProperty("access_token", data.access_token);
        userProperties.setProperty("refresh_token", data.refresh_token);
        userProperties.setProperty("expires_in", data.expires_in);
        userProperties.setProperty("issued", new Date());

        // zapis access token do Industry databaze
        Aubi.syncUser(data);

        return HtmlService.createHtmlOutput('<b>Success. You can close this window. !</b>')
      } else {
        return HtmlService.createHtmlOutput('<b>Failed. You can close this window. !</b>')

      }
    }, 

    /*
    * Retrieves the access_token from properties
    */
    getAccessToken: function(properties) {
      // check token expiration
      var expiration = this.getTokenExpiration(properties);

      // if token is about to expire or expired, refresh it
      if (expiration <= 30) {
        if (!clientSecret) throw('EVE_CLIENT_SECRET is not set in Script Properties')
        var req = {}
        req.grant_type = "refresh_token";
        req.refresh_token = properties.getProperty("refresh_token");

        // POST request to EVE token API
        var options = {
          'method' : 'post',
          'contentType': 'application/x-www-form-urlencoded',
          "headers" : {    
            'Authorization': 'Basic ' + Utilities.base64Encode(clientID + ':' + clientSecret)
          },
          'payload' : req
        };
        var response = UrlFetchApp.fetch(eveTokenApi, options);

        // parsuj odpoved do pole struktur
        var json = response.getContentText();
        var data = JSON.parse(json);

        properties.setProperty("access_token", data.access_token);
        properties.setProperty("expires_in", data.expires_in);
        properties.setProperty("issued", new Date());

        return data.access_token
      } else {
        return properties.getProperty("access_token");
      }
    },

    /*
    * Calculates the token expiration time
    */
    getTokenExpiration: function(properties) {
      var issued = Date.parse(properties.getProperty("issued"));
      var expiresIn = parseInt(properties.getProperty("expires_in"));
      var now = Date.parse(Date())

      var diffInSeconds = (now - issued) / 1000;
      return Math.max(expiresIn - diffInSeconds, 0);
    },

    /*
     * Gets user info from token
     */
    getUserInfo: function() {
      var userProperties = PropertiesService.getUserProperties();
      let token = userProperties.getProperty("access_token");
      let body = token.split('.')[1];
      let decoded = Utilities.newBlob(Utilities.base64Decode(body)).getDataAsString();
      let json = JSON.parse(decoded);
      let ret = {
        name: json.name,
        character_id: json.sub.substring(14) //: 'CHARACTER:EVE:2117327790'
      }
      return ret;
    },
  }
})()

/*
 * Callback function to be invoked after EVE OAuth login is completed
 */
function eveCallback(e) {
  return Security.eveCallback(e);
}

/*
* Copies current user access and refresh token to corporate access token
*/
function copyPersonalTokenToCorporate() {
  var userProperties = PropertiesService.getUserProperties();
  var scriptProperties = PropertiesService.getScriptProperties();

  scriptProperties.setProperty("refresh_token", userProperties.getProperty("refresh_token"));
  scriptProperties.setProperty("access_token", userProperties.getProperty("access_token"));
  scriptProperties.setProperty("expires_in", userProperties.getProperty("expires_in"));
  scriptProperties.setProperty("issued", userProperties.getProperty("issued"));
}


function testGetUserInfo() {
  console.log(Security.getUserInfo());
}