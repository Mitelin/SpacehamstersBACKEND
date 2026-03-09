/*
 * EVE Universe object
 */ 
const Security = (()=>{

  /* Constants */
  const eveSsoUrl = 'https://login.eveonline.com/v2/oauth/authorize?response_type=code'
  const eveTokenApi = 'https://login.eveonline.com/v2/oauth/token'
  const eveUserApi = 'https://login.eveonline.com/v2/oauth/verify'
  const esiApi = 'https://esi.evetech.net/latest'
  const fallbackCorporationId = 98652228
  var getScriptUrl_ = function() {
    // OAuth redirect for Apps Script StateToken callbacks.
    // Use current project Script ID so copies of the project keep working.
    return 'https://script.google.com/macros/d/' + ScriptApp.getScriptId() + '/usercallback';
  }
  // NOTE: EVE SSO validates scopes only after login; keeping scopes small improves reliability.
  // Full login (legacy): keep existing corp tooling working.
  // IMPORTANT: `esi-markets.read_character_orders.v1` is requested via the separate Sales login.
  const scopesFull = 'esi-markets.read_corporation_orders.v1 esi-skills.read_skills.v1 esi-universe.read_structures.v1 esi-wallet.read_corporation_wallets.v1 esi-corporations.read_container_logs.v1 esi-assets.read_corporation_assets.v1 esi-industry.read_corporation_jobs.v1 esi-assets.read_assets.v1 esi-industry.read_character_jobs.v1 esi-corporations.read_blueprints.v1 esi-markets.structure_markets.v1 esi-search.search_structures.v1 esi-contracts.read_corporation_contracts.v1 esi-contracts.read_character_contracts.v1'
  // Sales login: minimal personal scopes needed by Sales.gs
  const scopesSales = 'esi-assets.read_assets.v1 esi-skills.read_skills.v1 esi-markets.read_character_orders.v1'
  // Corporate login: stores tokens into ScriptProperties for corp tooling (Projects).
  // Keep scopes aligned with Full to avoid accidental capability loss.
  const scopesCorp = scopesFull;
  const clientIDFromProps = PropertiesService.getScriptProperties().getProperty('EVE_CLIENT_ID')
  // Fallback client id should point at the primary app registration for this sheet.
  const clientID = clientIDFromProps || 'f30674c36daf42e59a64011c41018cc7'
  const clientIdSource = clientIDFromProps ? 'scriptProperties' : 'fallback'
  const clientSecret = PropertiesService.getScriptProperties().getProperty('EVE_CLIENT_SECRET')

  const PROFILE_FULL = '';
  const PROFILE_SALES = 'sales';
  const PROFILE_CORP = 'corp';

  var normalizeScopes = function(scopeStr) {
    return String(scopeStr || '').replace(/\s+/g, ' ').trim();
  }

  var scopeForProfile = function(profile) {
    profile = String(profile || '').trim().toLowerCase();
    if (profile === PROFILE_SALES) return scopesSales;
    if (profile === PROFILE_CORP) return scopesCorp;
    return scopesFull;
  }

  var callbackMethodForProfile = function(profile) {
    profile = String(profile || '').trim().toLowerCase();
    if (profile === PROFILE_SALES) return 'eveCallbackSales';
    if (profile === PROFILE_CORP) return 'eveCallbackCorp';
    return 'eveCallbackFull';
  }

  var profileSuffixForCharacter = function(profile) {
    profile = String(profile || '').trim().toLowerCase();
    return profile ? (':' + profile) : '';
  }

  var activeCharacterKeyForProfile = function(profile) {
    profile = String(profile || '').trim().toLowerCase();
    if (profile === PROFILE_SALES) return 'active_character_id_sales';
    return 'active_character_id';
  }

  // Decode basic character info from EVE access token (JWT) without verifying signature.
  // We only use it to derive character_id/name for storage/selection.
  var decodeTokenInfo = function(accessToken) {
    try {
      if (!accessToken) return null;
      let body = accessToken.split('.')[1];
      let decoded = Utilities.newBlob(Utilities.base64Decode(body)).getDataAsString();
      let json = JSON.parse(decoded);
      return {
        name: json.name,
        character_id: String(json.sub).split(':')[2]
      };
    } catch (e) {
      return null;
    }
  }

  var escapeHtml_ = function(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  var getGrantedScopes_ = function(verifyInfo, accessToken) {
    if (verifyInfo && verifyInfo.Scopes) return normalizeScopes(verifyInfo.Scopes);
    try {
      let body = accessToken.split('.')[1];
      let decoded = Utilities.newBlob(Utilities.base64Decode(body)).getDataAsString();
      let json = JSON.parse(decoded);
      if (Array.isArray(json.scp)) return normalizeScopes(json.scp.join(' '));
      if (json.scp) return normalizeScopes(json.scp);
      if (json.scope) return normalizeScopes(json.scope);
    } catch (e) {}
    return '';
  }

  var getMissingScopes_ = function(grantedScopes, requiredScopes) {
    var granted = normalizeScopes(grantedScopes).split(' ').filter(Boolean);
    var required = normalizeScopes(requiredScopes).split(' ').filter(Boolean);
    var grantedSet = new Set(granted);
    return required.filter(scope => !grantedSet.has(scope));
  }

  var authorizedGetWithToken_ = function(url, accessToken) {
    return UrlFetchApp.fetch(url, {
      method: 'get',
      headers: {
        Authorization: 'Bearer ' + accessToken
      },
      muteHttpExceptions: true
    });
  }

  var verifyAccessToken_ = function(accessToken) {
    var response = authorizedGetWithToken_(eveUserApi, accessToken);
    var code = response.getResponseCode();
    var body = response.getContentText();
    if (code !== 200) {
      throw('Nepodařilo se ověřit EVE token. HTTP ' + code + ': ' + body);
    }
    return JSON.parse(body);
  }

  var getCandidateCorporationId_ = function(characterId) {
    if (!characterId) return null;
    var response = UrlFetchApp.fetch(
      esiApi + '/characters/' + encodeURIComponent(characterId) + '/?datasource=tranquility',
      { method: 'get', muteHttpExceptions: true }
    );
    if (response.getResponseCode() !== 200) return null;
    try {
      var data = JSON.parse(response.getContentText());
      return data && data.corporation_id ? String(data.corporation_id) : null;
    } catch (e) {
      return null;
    }
  }

  var getCorporateId_ = function() {
    try {
      if (typeof Corporation !== 'undefined' && Corporation.getId) return String(Corporation.getId());
    } catch (e) {}
    return String(fallbackCorporationId);
  }

  var validateCorporateAccess_ = function(accessToken) {
    var verifyInfo = verifyAccessToken_(accessToken);
    var characterId = String(verifyInfo.CharacterID || '');
    var characterName = String(verifyInfo.CharacterName || '');
    var grantedScopes = getGrantedScopes_(verifyInfo, accessToken);
    var missingScopes = getMissingScopes_(grantedScopes, scopesCorp);
    var corpId = getCorporateId_();
    var characterCorpId = getCandidateCorporationId_(characterId);

    if (characterCorpId && characterCorpId !== corpId) {
      throw(
        'NEJSI POVERENA OSOBA. ' +
        (characterName ? ('Character ' + characterName + ' ') : '') +
        'není členem správné korporace pro corporate tooling. Původní corporate token zůstal beze změny.'
      );
    }

    if (missingScopes.length > 0) {
      throw(
        'NEJSI POVERENA OSOBA. Přihlášení nemá potřebné scope pro corporate tooling: ' +
        missingScopes.join(', ') +
        '. Původní corporate token zůstal beze změny.'
      );
    }

    var checks = [
      {
        label: 'industry jobs',
        url: esiApi + '/corporations/' + corpId + '/industry/jobs/?datasource=tranquility&include_completed=false&page=1'
      },
      {
        label: 'corporate assets',
        url: esiApi + '/corporations/' + corpId + '/assets/?datasource=tranquility&page=1'
      },
      {
        label: 'corporate blueprints',
        url: esiApi + '/corporations/' + corpId + '/blueprints/?datasource=tranquility&page=1'
      }
    ];

    for (var i = 0; i < checks.length; i++) {
      var check = checks[i];
      var response = authorizedGetWithToken_(check.url, accessToken);
      var code = response.getResponseCode();
      if (code === 200) continue;

      var details = response.getContentText();
      if (code === 401 || code === 403 || code === 404) {
        throw(
          'NEJSI POVERENA OSOBA. ' +
          (characterName ? ('Character ' + characterName + ' ') : '') +
          'nemá potřebná corp oprávnění pro ' + check.label + '. ' +
          'Původní corporate token zůstal beze změny. ' +
          'HTTP ' + code + ': ' + details
        );
      }

      throw(
        'Corporate token validation failed for ' + check.label + '. ' +
        'Původní corporate token zůstal beze změny. ' +
        'HTTP ' + code + ': ' + details
      );
    }

    return {
      characterId: characterId,
      characterName: characterName,
      scopes: grantedScopes
    };
  }

  var storeCharacterTokens = function(userProperties, cid, data, profile) {
    var suffix = profileSuffixForCharacter(profile);
    userProperties.setProperty(activeCharacterKeyForProfile(profile), cid);

    userProperties.setProperty('access_token:' + cid + suffix, data.access_token);
    userProperties.setProperty('refresh_token:' + cid + suffix, data.refresh_token);
    userProperties.setProperty('expires_in:' + cid + suffix, data.expires_in);
    userProperties.setProperty('issued:' + cid + suffix, new Date());
  }

  var storeCorpTokens = function(scriptProperties, data) {
    scriptProperties.setProperty('access_token', data.access_token);
    scriptProperties.setProperty('refresh_token', data.refresh_token);
    scriptProperties.setProperty('expires_in', data.expires_in);
    scriptProperties.setProperty('issued', new Date());

    var info = decodeTokenInfo(data.access_token);
    if (info && info.character_id) scriptProperties.setProperty('corp_character_id', String(info.character_id));
    if (info && info.name) scriptProperties.setProperty('corp_character_name', String(info.name));
  }

  var handleCallback = function(e, profile) {
    // extract code or error
    var code = e && e.parameters && e.parameters.code ? e.parameters.code[0] : null;
    var error = e && e.parameters ? e.parameters.error : null;

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

      var info = decodeTokenInfo(data.access_token);
      var cid = info && info.character_id ? String(info.character_id) : '';
      if (cid) {
        storeCharacterTokens(userProperties, cid, data, profile);

        // Legacy keys are used all over the old codebase.
        // Keep them aligned ONLY for the full profile.
        if (!profile) {
          userProperties.setProperty("access_token", data.access_token);
          userProperties.setProperty("refresh_token", data.refresh_token);
          userProperties.setProperty("expires_in", data.expires_in);
          userProperties.setProperty("issued", new Date());
        }
      }

      // zapis access token do Industry databaze (legacy)
      if (!profile) {
        Aubi.syncUser(data);
      }

      return HtmlService.createHtmlOutput('<b>Success. You can close this window. !</b>')
    }

    if (error) {
      return HtmlService.createHtmlOutput('<b>Failed: ' + error + '. You can close this window. !</b>')
    }
    return HtmlService.createHtmlOutput('<b>Failed. You can close this window. !</b>')
  }

  var handleCallbackCorp = function(e) {
    var code = e && e.parameters && e.parameters.code ? e.parameters.code[0] : null;
    var error = e && e.parameters ? e.parameters.error : null;

    if (code) {
      if (!clientSecret) throw('EVE_CLIENT_SECRET is not set in Script Properties')
      var req = {}
      req.grant_type = 'authorization_code';
      req.code = code;

      var options = {
        'method': 'post',
        'contentType': 'application/x-www-form-urlencoded',
        'headers': {
          'Authorization': 'Basic ' + Utilities.base64Encode(clientID + ':' + clientSecret)
        },
        'payload': req,
        'muteHttpExceptions': true
      };

      var response = UrlFetchApp.fetch(eveTokenApi, options);
      var status = response.getResponseCode();
      var json = response.getContentText();
      var data;
      try { data = JSON.parse(json); } catch (e) { data = null; }

      if (status !== 200) {
        var err = data && data.error ? String(data.error) : ('HTTP ' + status);
        var desc = data && data.error_description ? String(data.error_description) : json;
        throw ('EVE SSO corp login failed: ' + err + (desc ? (' - ' + desc) : ''));
      }

      try {
        validateCorporateAccess_(data.access_token);
      } catch (validationError) {
        return HtmlService.createHtmlOutput(
          '<b>' + escapeHtml_(validationError) + '</b><br><br>' +
          'Corporate token nebyl uložen. Můžeš zavřít tohle okno.'
        );
      }

      var scriptProperties = PropertiesService.getScriptProperties();
      storeCorpTokens(scriptProperties, data);
      return HtmlService.createHtmlOutput('<b>Success (Corporate). You can close this window.</b>')
    }

    if (error) {
      return HtmlService.createHtmlOutput('<b>Failed: ' + error + '. You can close this window.</b>')
    }
    return HtmlService.createHtmlOutput('<b>Failed. You can close this window.</b>')
  }

  return {
    // Debug helpers for UI
    getClientId: function() {
      return clientID;
    },

    getClientIdSource: function() {
      return clientIdSource;
    },

    getRedirectUri: function() {
      return getScriptUrl_();
    },

    getScopes: function(profile) {
      return normalizeScopes(scopeForProfile(profile));
    },

    validateCorporateAccess: function(accessToken) {
      return validateCorporateAccess_(accessToken);
    },

    /*
    * Generates EVE Login URL with state leading to eveCallback function invocation
    */
    eveLoginUrl: function(profile) {
      Logger.log ('### Security.eveLoginUrl() called ...')

      profile = String(profile || '').trim().toLowerCase();
      var methodName = callbackMethodForProfile(profile);
      var normalizedScopes = normalizeScopes(scopeForProfile(profile));

      // generate the EVE login URL
      var stateToken = ScriptApp.newStateToken()
        .withMethod(methodName)
        .withTimeout(120)
        .createToken();

      var url = eveSsoUrl
        + '&redirect_uri=' + encodeURIComponent(getScriptUrl_())
        + '&state=' + encodeURIComponent(stateToken)
        + '&client_id=' + encodeURIComponent(clientID)
        + '&scope=' + encodeURIComponent(normalizedScopes)

      Logger.log('### EVE SSO profile: ' + (profile || 'full'))
      Logger.log('### EVE SSO scopes: ' + normalizedScopes)
      Logger.log('### EVE SSO login URL: ' + url)
      console.log(url);
      return url;
    },

    /*
    * Callback function to be invoked after EVE OAuth login is completed
    */
    eveCallbackFull: function(e) {
      return handleCallback(e, PROFILE_FULL);
    },

    eveCallbackSales: function(e) {
      return handleCallback(e, PROFILE_SALES);
    },

    eveCallbackCorp: function(e) {
      return handleCallbackCorp(e);
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

        if (!req.refresh_token) {
          throw('Missing refresh token.');
        }

        // POST request to EVE token API
        var options = {
          'method' : 'post',
          'contentType': 'application/x-www-form-urlencoded',
          "headers" : {    
            'Authorization': 'Basic ' + Utilities.base64Encode(clientID + ':' + clientSecret)
          },
          'payload' : req,
          // Allow reading error body for invalid_grant etc.
          'muteHttpExceptions': true
        };
        var response = UrlFetchApp.fetch(eveTokenApi, options);

        var status = response.getResponseCode();

        // parsuj odpoved do pole struktur
        var json = response.getContentText();
        var data;
        try {
          data = JSON.parse(json);
        } catch (e) {
          data = null;
        }

        if (status !== 200) {
          var err = data && data.error ? String(data.error) : ('HTTP ' + status);
          var desc = data && data.error_description ? String(data.error_description) : json;

          // If refresh token is invalid/revoked, clear stored tokens so next run forces re-auth.
          if (String(err).toLowerCase() === 'invalid_grant') {
            try { if (properties.deleteProperty) properties.deleteProperty('refresh_token'); } catch (e) {}
            try { if (properties.deleteProperty) properties.deleteProperty('access_token'); } catch (e) {}
            try { if (properties.deleteProperty) properties.deleteProperty('expires_in'); } catch (e) {}
            try { if (properties.deleteProperty) properties.deleteProperty('issued'); } catch (e) {}
          }

          throw ('EVE SSO refresh failed: ' + err + (desc ? (' - ' + desc) : ''));
        }

        properties.setProperty("access_token", data.access_token);
        properties.setProperty("expires_in", data.expires_in);
        properties.setProperty("issued", new Date());

        // Some OAuth servers rotate refresh tokens. Persist a new one if provided.
        if (data && data.refresh_token) {
          properties.setProperty("refresh_token", data.refresh_token);
        }

        return data.access_token
      } else {
        return properties.getProperty("access_token");
      }
    },

    /*
    * Calculates the token expiration time
    */
    getTokenExpiration: function(properties) {
      var issuedRaw = properties.getProperty("issued");
      var expiresRaw = properties.getProperty("expires_in");

      var issued = Date.parse(issuedRaw);
      var expiresIn = parseInt(expiresRaw);
      var now = Date.parse(Date())

      // Missing/invalid values should force refresh.
      if (!isFinite(issued) || !isFinite(expiresIn) || expiresIn <= 0) return 0;

      var diffInSeconds = (now - issued) / 1000;
      if (!isFinite(diffInSeconds)) return 0;
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
  // Backward compatibility: old state tokens call `eveCallback`.
  return Security.eveCallbackFull(e);
}

function eveCallbackFull(e) {
  return Security.eveCallbackFull(e);
}

function eveCallbackSales(e) {
  return Security.eveCallbackSales(e);
}

function eveCallbackCorp(e) {
  return Security.eveCallbackCorp(e);
}

function buildTemporaryTokenProperties_(accessToken, refreshToken, expiresIn, issued) {
  var store = {};
  if (accessToken) store.access_token = accessToken;
  if (refreshToken) store.refresh_token = refreshToken;
  if (expiresIn) store.expires_in = expiresIn;
  if (issued) store.issued = issued;

  return {
    getProperty: function(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setProperty: function(key, value) {
      store[key] = value;
      return this;
    },
    deleteProperty: function(key) {
      delete store[key];
      return true;
    }
  };
}

/*
* Copies current user access and refresh token to corporate access token
*/
function copyPersonalTokenToCorporate() {
  var userProperties = PropertiesService.getUserProperties();
  var scriptProperties = PropertiesService.getScriptProperties();

  // Prefer the active character's stored FULL-profile tokens.
  var cid = String(userProperties.getProperty('active_character_id') || '').trim();
  var a = cid ? userProperties.getProperty('access_token:' + cid) : '';
  var r = cid ? userProperties.getProperty('refresh_token:' + cid) : '';
  var e = cid ? userProperties.getProperty('expires_in:' + cid) : '';
  var i = cid ? userProperties.getProperty('issued:' + cid) : '';

  // Fall back to legacy keys.
  if (!a) a = userProperties.getProperty("access_token");
  if (!r) r = userProperties.getProperty("refresh_token");
  if (!e) e = userProperties.getProperty("expires_in");
  if (!i) i = userProperties.getProperty("issued");

  if (!r) throw ('No personal FULL refresh token found. Do EVE Data → Login (Full) first. (Sales login tokens are stored separately and are not used for corporate tooling.)');

  var tempProps = buildTemporaryTokenProperties_(a, r, e, i);
  var validatedAccessToken = Security.getAccessToken(tempProps);
  var info = Security.validateCorporateAccess(validatedAccessToken);

  scriptProperties.setProperty("refresh_token", tempProps.getProperty('refresh_token'));
  scriptProperties.setProperty("access_token", tempProps.getProperty('access_token'));
  scriptProperties.setProperty("expires_in", tempProps.getProperty('expires_in'));
  scriptProperties.setProperty("issued", tempProps.getProperty('issued'));

  if (info && info.characterId) scriptProperties.setProperty('corp_character_id', String(info.characterId));
  if (info && info.characterName) scriptProperties.setProperty('corp_character_name', String(info.characterName));
}

/*
 * Copies current user's FULL token into shared (ScriptProperties) storage so other users can run tooling
 * without having their own EVE login (web app / shared sheet use-case).
 *
 * NOTE: Anyone who can run this function can overwrite the shared token. Keep it in Debug.
 */
function copyPersonalTokenToSharedFull() {
  var userProperties = PropertiesService.getUserProperties();
  var scriptProperties = PropertiesService.getScriptProperties();

  // Prefer the active character's stored FULL-profile tokens.
  var cid = String(userProperties.getProperty('active_character_id') || '').trim();
  var a = cid ? userProperties.getProperty('access_token:' + cid) : '';
  var r = cid ? userProperties.getProperty('refresh_token:' + cid) : '';
  var e = cid ? userProperties.getProperty('expires_in:' + cid) : '';
  var i = cid ? userProperties.getProperty('issued:' + cid) : '';

  // Fall back to legacy keys.
  if (!a) a = userProperties.getProperty("access_token");
  if (!r) r = userProperties.getProperty("refresh_token");
  if (!e) e = userProperties.getProperty("expires_in");
  if (!i) i = userProperties.getProperty("issued");

  if (!r) throw ('No personal FULL refresh token found. Do EVE Data → Login (Full) first.');

  var tempProps = buildTemporaryTokenProperties_(a, r, e, i);
  var validatedAccessToken = Security.getAccessToken(tempProps);
  Security.validateCorporateAccess(validatedAccessToken);

  scriptProperties.setProperty("shared_full_refresh_token", tempProps.getProperty('refresh_token'));
  scriptProperties.setProperty("shared_full_access_token", tempProps.getProperty('access_token'));
  scriptProperties.setProperty("shared_full_expires_in", tempProps.getProperty('expires_in'));
  scriptProperties.setProperty("shared_full_issued", tempProps.getProperty('issued'));
}


function testGetUserInfo() {
  console.log(Security.getUserInfo());
}
