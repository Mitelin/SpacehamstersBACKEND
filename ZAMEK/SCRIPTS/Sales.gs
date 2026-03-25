/*
 * Jita Sales helper
 *
 * Goal: one click -> generate list of sell orders limited by free market order slots,
 * based on a user-provided list of item names + quantities.
 *
 * Input:
 * - Column B (from row 5): item name (exact EVE type name)
 * - Column C (from row 5): quantity
 *
 * Output:
 * - Prices computed and filled into columns D..F
 * - Clipboard payload in A2, formatted for EVE Sell list import: name<TAB>price
 */

const Sales = (()=>{
  const SALES_SHEET_NAME = 'Jita Sales';
  const ESI_BASE = 'https://esi.evetech.net/latest';
  const THE_FORGE_REGION_ID = 10000002;
  const JITA_44_LOCATION_ID = 60003760; // Jita IV - Moon 4 - Caldari Navy Assembly Plant

  const JANICE_API_BASE = 'https://janice.e-351.com';
  const JANICE_MARKET_ID_JITA = 2; // Janice default market is 2 (Jita 4-4)
  const DEFAULT_PRICE_MULTIPLIER = 1.0;
  const LIVE_VERIFY_CANDIDATES = 100; // prefer live Jita for all consumed rows (free-slot cap)
  const LIVE_VERIFY_MAX_RATIO = 1.05; // override stale cache when off by >5%
  const LIVE_ORDER_TARGET_SHARE = 0.05; // 5% of visible sell-side volume

  const INPUT_START_ROW = 5;
  const COL_TYPE_ID = 1; // A
  const COL_NAME = 2;    // B (user input)
  const COL_QTY = 3;     // C (user input)
  const COL_UNIT = 4;    // D (computed)
  const COL_TOTAL = 5;   // E (computed)
  const COL_NOTE = 6;    // F (computed)
  const COL_MANUAL = 7;  // G (user input fallback unit price)

  // Skill IDs for market order slots
  const SKILL_TRADE = 3443;
  const SKILL_RETAIL = 3444;
  const SKILL_WHOLESALE = 16595;
  const SKILL_TYCOON = 18580;

  const toInt = (v) => {
    const n = Number(v);
    return isFinite(n) ? Math.trunc(n) : 0;
  };

  const normalizeEveName = (name) => {
    if (!name) return '';
    name = String(name)
      .replace(/\u00A0/g, ' ')
      .replace(/[\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      ;
    if (!name.trim()) return '';
    // Sheets escape for leading apostrophe: "''Foo" -> "'Foo"
    if (name.startsWith("''")) return name.slice(1);
    return name;
  };

  const normalizeEsiTypeName_ = (name) => {
    // Common cleanup for both input and ESI-returned names.
    return String(name || '')
      .trim()
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\u00A0/g, ' ')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/\s+/g, ' ');
  };

  const normalizeEsiRequestName_ = (name) => {
    // /universe/ids is exact-match. Make the string as close to canonical EVE type
    // names as possible, without doing lossy transformations like lowercasing.
    return normalizeEsiTypeName_(normalizeEveName(name))
      .replace(/[\u2018\u2019\u02BC\uFF07\u2032`\u00B4]/g, "'");
  };

  const normalizeEsiRequestNameExact_ = (name) => {
    // Exact-match string, but PRESERVE leading/trailing spaces.
    // (Some EVE types appear to include a leading space in the official name.)
    return String(normalizeEveName(name) || '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\u00A0/g, ' ')
      .replace(/[\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/[\u2018\u2019\u02BC\uFF07\u2032`\u00B4]/g, "'");
  };

  const stripLeadingCountFromName_ = (name) => {
    // Common paste/input issue: "17 Item Name" in the name column.
    // EVE type names almost never start with a bare integer token.
    const s = String(name || '');
    const m = s.match(/^\s*(\d{1,7})\s+([A-Za-z'"].*)$/);
    if (!m) return s;
    return m[2];
  };

  const looseTypeKey_ = (name) => {
    // Used only as a fallback match when ESI doesn't exact-match a name.
    // Removes punctuation/spaces so small differences don't block a match.
    return canonicalTypeKey_(name).replace(/[^a-z0-9]+/g, '');
  };

  const canonicalTypeKey_ = (name) => {
    // Canonical key for matching input names with ESI returned names.
    // Important: ESI exact-match happens on the raw string we send,
    // but our mapping should be tolerant to common apostrophe variants.
    let s = normalizeEsiTypeName_(normalizeEveName(name))
      .replace(/[\u2018\u2019\u02BC\uFF07\u2032`\u00B4]/g, "'");

    // Matching quirk: some EVE type names legitimately start with a quote, e.g. "'Arbalest' ...".
    // Google Sheets can hide/drop a leading apostrophe, so for matching we treat that leading quote
    // as optional when the string clearly contains a quoted token.
    if (s.startsWith("'") && /^'[^']+'\s/.test(s)) s = s.slice(1);
    return s.toLowerCase();
  };

  const getJaniceApiKey_ = () => {
    try {
      return String(PropertiesService.getScriptProperties().getProperty('JANICE_API_KEY') || '').trim();
    } catch (e) {
      return '';
    }
  };

  const janicePricerBatch_ = (itemTypes, marketId) => {
    // Returns Map canonicalKey -> { typeId, resolvedName, unitSell, unitSplit, unitBuy }
    // Uses Janice /api/rest/v2/pricer (text/plain, one item per line).
    const out = new Map();
    const key = getJaniceApiKey_();
    if (!key) return out;

    const uniq = [];
    const seen = new Set();
    for (let i = 0; i < itemTypes.length; i++) {
      const raw = normalizeEveName(itemTypes[i]);
      if (!raw) continue;
      const t = String(raw);
      if (seen.has(t)) continue;
      seen.add(t);
      uniq.push(t);
    }
    if (!uniq.length) return out;

    const body = uniq.join('\n');
    const url = JANICE_API_BASE + '/api/rest/v2/pricer?market=' + encodeURIComponent(String(marketId || JANICE_MARKET_ID_JITA));
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'text/plain',
      headers: {
        accept: 'application/json',
        'X-ApiKey': key,
      },
      payload: body,
      muteHttpExceptions: true,
    });

    if (res.getResponseCode() !== 200) {
      // Soft-fail: keep existing fallback pricing.
      return out;
    }

    let arr = [];
    try {
      arr = JSON.parse(res.getContentText() || '[]');
    } catch (e) {
      arr = [];
    }
    if (!Array.isArray(arr)) return out;

    for (let i = 0; i < arr.length; i++) {
      const it = arr[i];
      const itemType = it && it.itemType;
      const resolvedName = itemType && itemType.name ? String(itemType.name) : '';
      const typeId = Number(itemType && itemType.eid);
      if (!resolvedName || !typeId) continue;

      const immediate = it && it.immediatePrices;
      const top5 = it && it.top5AveragePrices;
      // Prefer top5AveragePrices (volume-aware) to avoid single tiny-volume outlier orders.
      const unitSell = Number((top5 && top5.sellPrice) || (immediate && immediate.sellPrice));
      const unitSplit = Number((top5 && top5.splitPrice) || (immediate && immediate.splitPrice));
      const unitBuy = Number((top5 && top5.buyPrice) || (immediate && immediate.buyPrice));
      const usedTop5 = isFinite(Number(top5 && top5.sellPrice)) && Number(top5 && top5.sellPrice) > 0;

      out.set(canonicalTypeKey_(resolvedName), {
        typeId,
        resolvedName,
        unitSell: (isFinite(unitSell) && unitSell > 0) ? unitSell : NaN,
        unitSplit: (isFinite(unitSplit) && unitSplit > 0) ? unitSplit : NaN,
        unitBuy: (isFinite(unitBuy) && unitBuy > 0) ? unitBuy : NaN,
        _usedTop5: usedTop5,
      });
    }
    return out;
  };

  const getPriceMultiplier_ = () => {
    try {
      const raw = String(PropertiesService.getScriptProperties().getProperty('SALES_PRICE_MULTIPLIER') || '').trim();
      if (!raw) return DEFAULT_PRICE_MULTIPLIER;
      const n = Number(raw);
      // Accept values like 0.99, 1, 1.02
      if (!isFinite(n) || n <= 0) return DEFAULT_PRICE_MULTIPLIER;
      // Avoid extreme accidents.
      if (n < 0.5 || n > 2.0) return DEFAULT_PRICE_MULTIPLIER;
      return n;
    } catch (e) {
      return DEFAULT_PRICE_MULTIPLIER;
    }
  };

  const resolveTypeIdsByNames_ = (names) => {
    // Returns: Map canonicalKey -> {typeId, resolvedName}
    const out = new Map();
    const unique = [];
    const reqSeen = new Set();
    const baseQueries = [];
    const seen = new Set();
    for (let i = 0; i < names.length; i++) {
      const raw = normalizeEveName(names[i]);
      const trimmed = String(raw || '').trim();
      if (!raw && !trimmed) continue;

      const key = canonicalTypeKey_(trimmed || raw);
      if (seen.has(key)) continue;
      seen.add(key);

      baseQueries.push({ key, raw, trimmed });

      const addReq_ = (s) => {
        if (!s) return;
        if (reqSeen.has(s)) return;
        reqSeen.add(s);
        unique.push(s);
        // Also try a variant with/without a leading apostrophe for "Word' <space>..." patterns,
        // because Sheets can hide/drop the first apostrophe in "'Word' ...".
        if (!s.startsWith("'") && /^[^']+'\s/.test(s)) {
          const v = "'" + s;
          if (!reqSeen.has(v)) {
            reqSeen.add(v);
            unique.push(v);
          }
        } else if (s.startsWith("'") && /^'[^']+'\s/.test(s)) {
          const v = s.slice(1);
          if (!reqSeen.has(v)) {
            reqSeen.add(v);
            unique.push(v);
          }
        }
      };

      // Try both raw (may include leading spaces) and trimmed.
      addReq_(normalizeEsiRequestNameExact_(raw));
      if (trimmed && trimmed !== raw) addReq_(normalizeEsiRequestNameExact_(trimmed));

      // Fallback variant for accidental "count + name" input in column B.
      const rawNoCount = stripLeadingCountFromName_(raw);
      const trimmedNoCount = stripLeadingCountFromName_(trimmed);
      if (rawNoCount && rawNoCount !== raw) addReq_(normalizeEsiRequestNameExact_(rawNoCount));
      if (trimmedNoCount && trimmedNoCount !== trimmed) addReq_(normalizeEsiRequestNameExact_(trimmedNoCount));
    }

    const CHUNK = 200;
    for (let i = 0; i < unique.length; i += CHUNK) {
      const chunk = unique.slice(i, i + CHUNK);
      const data = Eve.resolveNames(chunk, 'inventory_types') || [];
      for (let j = 0; j < data.length; j++) {
        const ent = data[j];
        const name = normalizeEsiTypeName_(ent && ent.name);
        const id = Number(ent && ent.id);
        if (!name || !id) continue;
        out.set(canonicalTypeKey_(name), { typeId: id, resolvedName: name });
      }
    }

    // If a row used a "count + name" variant, map it back by loose key.
    const outLoose = new Map(); // looseKey -> rec | null (ambiguous)
    out.forEach((rec) => {
      const lk = looseTypeKey_(rec && rec.resolvedName);
      if (!lk) return;
      if (!outLoose.has(lk)) outLoose.set(lk, rec);
      else outLoose.set(lk, null);
    });
    for (let i = 0; i < baseQueries.length; i++) {
      const b = baseQueries[i];
      if (out.has(b.key)) continue;
      const lk = looseTypeKey_(stripLeadingCountFromName_(b.trimmed || b.raw));
      const cand = lk ? outLoose.get(lk) : null;
      if (cand) out.set(b.key, cand);
    }

    // Fallback: Janice pricer can resolve names that ESI /universe/ids doesn't.
    // (ESI no longer provides a public /search endpoint; only character-auth search exists.)
    const unresolved = [];
    for (let i = 0; i < baseQueries.length; i++) {
      const b = baseQueries[i];
      if (!out.has(b.key)) unresolved.push(b);
    }
    if (unresolved.length) {
      const q = [];
      for (let i = 0; i < unresolved.length; i++) {
        q.push(unresolved[i].raw);
        if (unresolved[i].trimmed && unresolved[i].trimmed !== unresolved[i].raw) q.push(unresolved[i].trimmed);
      }
      const janice = janicePricerBatch_(q, JANICE_MARKET_ID_JITA);
      if (janice && janice.size) {
        // Build lookup maps for flexible matching.
        const exact = janice;
        const loose = new Map();
        exact.forEach((rec, k) => {
          const lk = looseTypeKey_(rec.resolvedName);
          if (!lk) return;
          if (!loose.has(lk)) loose.set(lk, rec);
          else loose.set(lk, null);
        });

        for (let i = 0; i < unresolved.length; i++) {
          const u = unresolved[i];
          let hit = exact.get(u.key);
          if (!hit) {
            const lk = looseTypeKey_(stripLeadingCountFromName_(u.trimmed || u.raw));
            const cand = lk ? loose.get(lk) : null;
            if (cand) hit = cand;
          }
          if (hit) out.set(u.key, { typeId: hit.typeId, resolvedName: hit.resolvedName });
        }
      }
    }

    // Local fallback: use the Types sheet cache (g_types) if ESI cannot resolve the name.
    // This is useful for edge-case names that exist in-game but are not resolvable via ESI.
    const stillUnresolved = [];
    for (let i = 0; i < baseQueries.length; i++) {
      const b = baseQueries[i];
      if (!out.has(b.key)) stillUnresolved.push(b);
    }
    if (stillUnresolved.length) {
      try {
        if (typeof initTypes === 'function') initTypes();
      } catch (e) {}

      try {
        if (Array.isArray(globalThis.g_types) && globalThis.g_types.length) {
          const exactByKey = new Map();
          const looseByKey = new Map(); // looseKey -> rec | null (ambiguous)
          for (let i = 0; i < globalThis.g_types.length; i++) {
            const row = globalThis.g_types[i];
            const typeId = Number(row && row[0]);
            const typeName = row && row[1];
            if (!typeId || !typeName) continue;
            const rec = { typeId, resolvedName: String(typeName) };
            const k = canonicalTypeKey_(rec.resolvedName);
            if (k && !exactByKey.has(k)) exactByKey.set(k, rec);
            const lk = looseTypeKey_(rec.resolvedName);
            if (!lk) continue;
            if (!looseByKey.has(lk)) looseByKey.set(lk, rec);
            else looseByKey.set(lk, null);
          }

          for (let i = 0; i < stillUnresolved.length; i++) {
            const u = stillUnresolved[i];
            let hit = exactByKey.get(u.key);
            if (!hit) {
              const lk = looseTypeKey_(stripLeadingCountFromName_(u.trimmed || u.raw));
              const cand = lk ? looseByKey.get(lk) : null;
              if (cand) hit = cand;
            }
            if (hit) out.set(u.key, hit);
          }
        }
      } catch (e) {
        // Ignore local fallback errors.
      }
    }

    // Local fallback: use Ceník cache by name to recover type_id even when ESI can't resolve.
    // This keeps Sales usable without JANICE_API_KEY for custom/legacy names already in Ceník.
    const stillUnresolved2 = [];
    for (let i = 0; i < baseQueries.length; i++) {
      const b = baseQueries[i];
      if (!out.has(b.key)) stillUnresolved2.push(b);
    }
    if (stillUnresolved2.length) {
      try {
        if (globalThis.priceList && typeof globalThis.priceList.init === 'function') {
          globalThis.priceList.init();
        }
      } catch (e) {}

      try {
        const pdata = (globalThis.priceList && Array.isArray(globalThis.priceList.l_data))
          ? globalThis.priceList.l_data
          : [];
        if (pdata.length) {
          const exactByKey = new Map();
          const looseByKey = new Map(); // looseKey -> rec | null (ambiguous)

          const addName_ = (typeId, typeName) => {
            const rec = { typeId: Number(typeId), resolvedName: String(typeName || '') };
            if (!rec.typeId || !rec.resolvedName) return;
            const k = canonicalTypeKey_(rec.resolvedName);
            if (k && !exactByKey.has(k)) exactByKey.set(k, rec);
            const lk = looseTypeKey_(rec.resolvedName);
            if (!lk) return;
            if (!looseByKey.has(lk)) looseByKey.set(lk, rec);
            else looseByKey.set(lk, null);
          };

          for (let i = 0; i < pdata.length; i++) {
            const row = pdata[i];
            const typeId = Number(row && row[1]);
            if (!typeId) continue;
            addName_(typeId, row && row[0]); // user/legacy input name
            addName_(typeId, row && row[2]); // resolved canonical type name
          }

          for (let i = 0; i < stillUnresolved2.length; i++) {
            const u = stillUnresolved2[i];
            let hit = exactByKey.get(u.key);
            if (!hit) {
              const lk = looseTypeKey_(stripLeadingCountFromName_(u.trimmed || u.raw));
              const cand = lk ? looseByKey.get(lk) : null;
              if (cand) hit = cand;
            }
            if (hit) out.set(u.key, hit);
          }
        }
      } catch (e) {
        // Ignore pricelist fallback errors.
      }
    }

    return out;
  };

  const jitaSellFromOrdersCache_ = new Map();
  const jitaBuyFromOrdersCache_ = new Map();
  const typeBasePriceCache_ = new Map();
  const typeMarketableCache_ = new Map();
  const getTypeBasePrice_ = (typeId) => {
    const tid = Number(typeId);
    if (!tid) return NaN;
    if (typeBasePriceCache_.has(tid)) return typeBasePriceCache_.get(tid);

    let v = NaN;
    try {
      const t = Eve.getTypeInfo(tid);
      const base = Number(t && t.base_price);
      if (isFinite(base) && base > 0) v = base;
    } catch (e) {
      // ignore
    }
    typeBasePriceCache_.set(tid, v);
    return v;
  };

  const isTypeMarketable_ = (typeId) => {
    const tid = Number(typeId);
    if (!tid) return false;
    if (typeMarketableCache_.has(tid)) return typeMarketableCache_.get(tid);

    let ok = false;
    try {
      const t = Eve.getTypeInfo(tid);
      ok = !!(t && Number(t.market_group_id) > 0);
    } catch (e) {
      ok = false;
    }
    typeMarketableCache_.set(tid, ok);
    return ok;
  };

  const getJitaSellFromOrders_ = (typeId) => {
    const tid = Number(typeId);
    if (!tid) return NaN;
    if (jitaSellFromOrdersCache_.has(tid)) return jitaSellFromOrdersCache_.get(tid);

    const jitaOrders = [];
    const regionOrders = [];
    try {
      // Read X-Pages from first request and scan only a few pages (enough for most items).
      const firstUrl = ESI_BASE + '/markets/' + THE_FORGE_REGION_ID + '/orders/?datasource=tranquility&order_type=sell&type_id=' + tid + '&page=1';
      const firstRes = UrlFetchApp.fetch(firstUrl, {
        method: 'get',
        headers: { accept: 'application/json', 'Cache-Control': 'no-cache' },
        muteHttpExceptions: true,
      });
      if (firstRes.getResponseCode() !== 200) throw new Error('orders http ' + firstRes.getResponseCode());
      const headers = firstRes.getHeaders ? firstRes.getHeaders() : {};
      const xPages = Number(headers && (headers['X-Pages'] || headers['x-pages']));
      const maxPages = Math.max(1, Math.min(3, isFinite(xPages) && xPages > 0 ? xPages : 1));

      const scanPage_ = (res) => {
        const arr = JSON.parse(res.getContentText() || '[]');
        if (!Array.isArray(arr)) return;
        for (let i = 0; i < arr.length; i++) {
          const o = arr[i];
          const price = Number(o && o.price);
          const vol = Number(o && o.volume_remain);
          if (!(isFinite(price) && price > 0)) continue;
          if (!(isFinite(vol) && vol > 0)) continue;
          regionOrders.push({ price, vol });
          if (Number(o && o.location_id) === JITA_44_LOCATION_ID) {
            jitaOrders.push({ price, vol });
          }
        }
      };

      scanPage_(firstRes);
      for (let p = 2; p <= maxPages; p++) {
        const url = ESI_BASE + '/markets/' + THE_FORGE_REGION_ID + '/orders/?datasource=tranquility&order_type=sell&type_id=' + tid + '&page=' + p;
        const res = UrlFetchApp.fetch(url, {
          method: 'get',
          headers: { accept: 'application/json', 'Cache-Control': 'no-cache' },
          muteHttpExceptions: true,
        });
        if (res.getResponseCode() !== 200) break;
        scanPage_(res);
      }
    } catch (e) {
      // ignore
    }

    const robustPrice_ = (orders) => {
      if (!orders || !orders.length) return NaN;
      const sorted = orders.slice().sort((a, b) => a.price - b.price);
      let totalVol = 0;
      for (let i = 0; i < sorted.length; i++) totalVol += sorted[i].vol;
      const targetVol = Math.max(1, Math.ceil(totalVol * LIVE_ORDER_TARGET_SHARE));
      let cum = 0;
      for (let i = 0; i < sorted.length; i++) {
        const o = sorted[i];
        cum += o.vol;
        if (cum >= targetVol) return o.price; // price level covering 5% depth
      }
      // thin/partial book: fall back to top price if we don't have enough depth
      return sorted[0].price;
    };

    const bestJita = robustPrice_(jitaOrders);
    const bestRegion = robustPrice_(regionOrders);
    const best = isFinite(bestJita) ? bestJita : (isFinite(bestRegion) ? bestRegion : NaN);
    jitaSellFromOrdersCache_.set(tid, best);
    return best;
  };

  const getJitaBuyFromOrders_ = (typeId) => {
    const tid = Number(typeId);
    if (!tid) return NaN;
    if (jitaBuyFromOrdersCache_.has(tid)) return jitaBuyFromOrdersCache_.get(tid);

    const jitaOrders = [];
    const regionOrders = [];
    try {
      const firstUrl = ESI_BASE + '/markets/' + THE_FORGE_REGION_ID + '/orders/?datasource=tranquility&order_type=buy&type_id=' + tid + '&page=1';
      const firstRes = UrlFetchApp.fetch(firstUrl, {
        method: 'get',
        headers: { accept: 'application/json', 'Cache-Control': 'no-cache' },
        muteHttpExceptions: true,
      });
      if (firstRes.getResponseCode() !== 200) throw new Error('orders http ' + firstRes.getResponseCode());
      const headers = firstRes.getHeaders ? firstRes.getHeaders() : {};
      const xPages = Number(headers && (headers['X-Pages'] || headers['x-pages']));
      const maxPages = Math.max(1, Math.min(3, isFinite(xPages) && xPages > 0 ? xPages : 1));

      const scanPage_ = (res) => {
        const arr = JSON.parse(res.getContentText() || '[]');
        if (!Array.isArray(arr)) return;
        for (let i = 0; i < arr.length; i++) {
          const o = arr[i];
          const price = Number(o && o.price);
          const vol = Number(o && o.volume_remain);
          if (!(isFinite(price) && price > 0)) continue;
          if (!(isFinite(vol) && vol > 0)) continue;
          regionOrders.push({ price, vol });
          if (Number(o && o.location_id) === JITA_44_LOCATION_ID) {
            jitaOrders.push({ price, vol });
          }
        }
      };

      scanPage_(firstRes);
      for (let p = 2; p <= maxPages; p++) {
        const url = ESI_BASE + '/markets/' + THE_FORGE_REGION_ID + '/orders/?datasource=tranquility&order_type=buy&type_id=' + tid + '&page=' + p;
        const res = UrlFetchApp.fetch(url, {
          method: 'get',
          headers: { accept: 'application/json', 'Cache-Control': 'no-cache' },
          muteHttpExceptions: true,
        });
        if (res.getResponseCode() !== 200) break;
        scanPage_(res);
      }
    } catch (e) {
      // ignore
    }

    const robustPrice_ = (orders) => {
      if (!orders || !orders.length) return NaN;
      const sorted = orders.slice().sort((a, b) => b.price - a.price);
      let totalVol = 0;
      for (let i = 0; i < sorted.length; i++) totalVol += sorted[i].vol;
      const targetVol = Math.max(1, Math.ceil(totalVol * LIVE_ORDER_TARGET_SHARE));
      let cum = 0;
      for (let i = 0; i < sorted.length; i++) {
        const o = sorted[i];
        cum += o.vol;
        if (cum >= targetVol) return o.price; // buy price level covering 5% depth
      }
      return sorted[0].price;
    };

    const bestJita = robustPrice_(jitaOrders);
    const bestRegion = robustPrice_(regionOrders);
    const best = isFinite(bestJita) ? bestJita : (isFinite(bestRegion) ? bestRegion : NaN);
    jitaBuyFromOrdersCache_.set(tid, best);
    return best;
  };

  const chooseBuyPrice_ = (priceObj) => {
    if (!priceObj) return NaN;
    const order = ['jitaBuyTop5', 'jitaBuyWavg', 'jitaBuyAvg'];
    for (let i = 0; i < order.length; i++) {
      const v = Number(priceObj[order[i]]);
      if (isFinite(v) && v > 0) return v;
    }
    return NaN;
  };

  const unitBuyFromPricelistRow_ = (row) => {
    if (!row) return NaN;
    const jitaBuyAvg = Number(row[19]);
    const jitaBuyWavg = Number(row[20]);
    const jitaBuyTop5 = Number(row[22]);
    return chooseBuyPrice_({
      jitaBuyTop5,
      jitaBuyWavg,
      jitaBuyAvg,
    });
  };

  const unitBuyFromPricelistObj_ = (obj) => {
    return chooseBuyPrice_(obj);
  };

  const getSalesSheet = () => {
    const ss = SpreadsheetApp.getActive();
    let sheet = ss.getSheetByName(SALES_SHEET_NAME);
    if (!sheet) sheet = ss.insertSheet(SALES_SHEET_NAME);
    return sheet;
  };

  const getSelectedCharacterName = (sheet) => {
    try {
      // B1 is user-editable character name
      const v = sheet.getRange(1, 2).getValue();
      return v ? String(v).trim() : '';
    } catch (e) {
      return '';
    }
  };

  const resolveCharacterIdByName = (name) => {
    name = String(name || '').trim();
    if (!name) return '';
    const matches = Eve.resolveNames([name], 'characters');
    if (matches && matches.length) return String(matches[0].id);
    return '';
  };

  const computeMaxOrderSlots = (skillsJson) => {
    const skills = (skillsJson && skillsJson.skills) ? skillsJson.skills : [];
    const byId = new Map(skills.map(s => [String(s.skill_id), toInt(s.active_skill_level)]));

    const trade = toInt(byId.get(String(SKILL_TRADE)));
    const retail = toInt(byId.get(String(SKILL_RETAIL)));
    const wholesale = toInt(byId.get(String(SKILL_WHOLESALE)));
    const tycoon = toInt(byId.get(String(SKILL_TYCOON)));

    // EVE personal market order slots formula:
    // base 5 + 4*Trade + 8*Retail + 16*Wholesale + 32*Tycoon
    return 5 + 4 * trade + 8 * retail + 16 * wholesale + 32 * tycoon;
  };

  const chooseUnitPrice = (priceObj) => {
    if (!priceObj) return NaN;
    const order = ['jitaSellWavg', 'jitaSellTop5', 'jitaSellAvg', 'jitaSplitTop5'];
    for (let i = 0; i < order.length; i++) {
      const k = order[i];
      const v = Number(priceObj[k]);
      if (isFinite(v) && v > 0) return v;
    }
    return NaN;
  };

  const formatEvePrice = (v) => {
    const n = Number(v);
    if (!isFinite(n)) return '';
    // Match EVE clipboard examples like: "Rifter 400,000.01".
    // i.e. comma thousands separator + dot decimal separator, 2 decimals.
    return n.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      useGrouping: true,
    });
  };

  const round2_ = (v) => {
    const n = Number(v);
    if (!isFinite(n)) return NaN;
    return Math.round(n * 100) / 100;
  };

  // EVE market uses price ticks (minimum increments) that scale with price magnitude.
  // This prevents “one-isking” on large prices.
  // Common schedule: <100 => 0.01, <1k => 0.1, <10k => 1, <100k => 10, <1m => 100, ...
  // Equivalent formula: tick = 10^(max(-2, floor(log10(price)) - 3)).
  const marketTick_ = (price) => {
    const p = Number(price);
    if (!isFinite(p) || p <= 0) return 0.01;
    const exp = Math.floor(Math.log10(p));
    const tickExp = Math.max(-2, exp - 3);
    return Math.pow(10, tickExp);
  };

  const decimalsForTick_ = (tick) => {
    const t = Number(tick);
    if (!isFinite(t) || t <= 0) return 2;
    if (t >= 1) return 0;
    // tick is power of 10 (0.1, 0.01)
    return Math.max(0, Math.round(-Math.log10(t)));
  };

  const quantizeToTick_ = (price, tick, direction) => {
    const p = Number(price);
    const t = Number(tick);
    if (!isFinite(p) || !isFinite(t) || t <= 0) return NaN;

    const q = p / t;
    let n;
    if (direction === 'up') n = Math.ceil(q - 1e-12);
    else if (direction === 'down') n = Math.floor(q + 1e-12);
    else n = Math.round(q);

    const d = decimalsForTick_(t);
    return Number((n * t).toFixed(d));
  };

  const quantizeToMarketTick_ = (price, direction) => {
    const p = Number(price);
    if (!isFinite(p) || p <= 0) return NaN;
    const t = marketTick_(p);
    return quantizeToTick_(p, t, direction);
  };

  const nextMarketPriceAbove_ = (price) => {
    const p = Number(price);
    if (!isFinite(p) || p <= 0) return 0.01;

    // Ensure we return a value that is strictly greater than `price` and valid
    // even across tick-size boundaries (e.g., 99.99 -> 100.0 changes tick).
    let v = p;
    for (let i = 0; i < 3; i++) {
      const t = marketTick_(v);
      const vUp = quantizeToTick_(v, t, 'up');
      const bumped = vUp + t;
      const t2 = marketTick_(bumped);
      const bumpedQ = quantizeToTick_(bumped, t2, 'up');
      if (isFinite(bumpedQ) && bumpedQ > p) return bumpedQ;
      v = bumped;
    }
    // Fallback
    return quantizeToMarketTick_(p + marketTick_(p), 'up');
  };

  const undercutOneTick_ = (price) => {
    const p = Number(price);
    if (!isFinite(p) || p <= 0) return NaN;

    // Start from a valid tick-aligned price.
    const pQ = quantizeToMarketTick_(p, 'down');
    if (!isFinite(pQ) || pQ <= 0) return NaN;

    const t = marketTick_(pQ);
    const p2 = pQ - t;
    if (!(isFinite(p2) && p2 > 0)) return pQ;

    // Re-quantize in case we crossed a tick-size boundary.
    return quantizeToMarketTick_(p2, 'down');
  };

  const appendPriceNoteTag_ = (note, tag) => {
    const base = String(note || '').trim();
    const extra = String(tag || '').trim();
    if (!extra) return base;
    return base ? (base + '+' + extra) : extra;
  };

  // Extract relevant price columns from priceList.l_data row.
  // Indices match the object assembled in Ceník.gs (priceList.getTypeIdPrice).
  const unitSellFromPricelistRow = (row) => {
    if (!row) return NaN;
    const jitaSplitTop5 = Number(row[17]);
    const jitaSellAvg = Number(row[26]);
    const jitaSellWavg = Number(row[27]);
    const jitaSellTop5 = Number(row[30]);
    return chooseUnitPrice({
      jitaSellWavg,
      jitaSellTop5,
      jitaSellAvg,
      jitaSplitTop5,
    });
  };

  const unitSellFromPricelistObj_ = (obj) => {
    return chooseUnitPrice(obj);
  };

  const writeSheet = (sheet, meta, exportText) => {
    // Layout:
    // Row 1: configuration (character name in B1) + meta
    // Row 2: export text
    // A4:G4: table header
    // Rows 5..: user input in B/C/G, computed output in A/D/E/F
    const maxClearRows = Math.max(1, sheet.getMaxRows());
    const clearRows = Math.min(Math.max(1, maxClearRows - 4), 2000);

    // Clear computed columns but keep user input in B/C/G.
    sheet.getRange(INPUT_START_ROW, COL_TYPE_ID, clearRows, 1).clearContent();
    sheet.getRange(INPUT_START_ROW, COL_UNIT, clearRows, 3).clearContent();

    sheet.getRange(1, 1).setValue('Character name');
    // B1 is intentionally left editable by user.
    sheet.getRange(1, 3).setValue('Resolved');
    sheet.getRange(1, 4).setValue(meta.characterName || '');
    sheet.getRange(1, 5).setValue(meta.characterId || '');
    sheet.getRange(1, 6).setValue('Free');
    sheet.getRange(1, 7).setValue(meta.freeSlots);

    sheet.getRange(2, 1).setValue(exportText || '');

    // Make export cell readable
    try {
      sheet.getRange(2, 1).setWrap(true);
    } catch (e) {}

    sheet.getRange(4, 1, 1, 7).setValues([[
      'type_id',
      'name (input)',
      'qty (input)',
      'unit_sell',
      'total_sell',
      'note',
      'manual_unit'
    ]]);

    sheet.activate();
    sheet.setActiveSelection('A2');
  };

  const showClipboardDialog = (payload, consumedCount, freeSlots, inputRowsCount) => {
    const tpl = HtmlService.createTemplateFromFile('SalesClipboard');
    tpl.payload = payload || '';
    tpl.consumedCount = Number(consumedCount) || 0;
    tpl.freeSlots = Number(freeSlots) || 0;
    tpl.inputRowsCount = Number(inputRowsCount) || 0;
    const html = tpl.evaluate().setWidth(700).setHeight(420);
    SpreadsheetApp.getUi().showModalDialog(html, 'Jita Sales – Copy');
  };

  const markSold_ = (consumedCount) => {
    const sheet = getSalesSheet();
    const nIn = toInt(consumedCount);
    if (nIn <= 0) return 'SOLD: nic ke smazání.';

    const lastRow = sheet.getLastRow();
    if (!lastRow || lastRow < INPUT_START_ROW) return 'SOLD: list je prázdný.';

    const numRows = lastRow - INPUT_START_ROW + 1;
    const src = sheet.getRange(INPUT_START_ROW, COL_NAME, numRows, 6).getValues(); // B:G
    const items = [];
    for (let i = 0; i < src.length; i++) {
      const nm = normalizeEveName(src[i][0]);
      if (!nm) continue;
      items.push([src[i][0], src[i][1], src[i][5]]);
    }
    if (!items.length) return 'SOLD: žádné položky v B/C.';

    const n = Math.min(nIn, items.length);
    const remain = items.slice(n);

    const maxClearRows = Math.max(1, sheet.getMaxRows());
    const clearRows = Math.min(Math.max(1, maxClearRows - 4), 2000);

    // Clear all computed/output cells and current input block.
    sheet.getRange(INPUT_START_ROW, COL_TYPE_ID, clearRows, 1).clearContent(); // A
    sheet.getRange(INPUT_START_ROW, COL_NAME, clearRows, 6).clearContent();    // B:G
    sheet.getRange(2, 1).clearContent(); // export payload

    if (remain.length) {
      const remainRows = remain.map(row => [row[0], row[1], '', '', '', row[2] || '']);
      sheet.getRange(INPUT_START_ROW, COL_NAME, remainRows.length, 6).setValues(remainRows);
    }

    SpreadsheetApp.getActive().toast(
      'Sales SOLD: smazáno ' + n + ', zbývá ' + remain.length + '.',
      'Sales',
      8
    );
    return 'SOLD: smazáno ' + n + ', zbývá ' + remain.length + '.';
  };

  return {
    copyJitaSellImport: function() {
      const lock = LockService.getScriptLock();
      const locked = lock.tryLock(5000);
      if (!locked) {
        SpreadsheetApp.getActive().toast('Sales: už běží (lock).', 'Sales', 5);
        return;
      }

      try {
        const sheet = getSalesSheet();
        // If user provided character name in B1, switch active character.
        const selectedName = getSelectedCharacterName(sheet);
        if (selectedName) {
          const cid = resolveCharacterIdByName(selectedName);
          if (!cid) throw ('Character nenalezen: ' + selectedName);
          Personal.setActiveCharacter(cid, 'sales');
        }

        // Ensure we have a valid token early
        const token = Personal.getAccessToken('sales');
        if (!token) throw ('Nejsi přihlášen pro Sales. Otevři EVE Data → Login a klikni „Sales login“ (minimální scopes).');

        const characterId = Personal.getId('sales');
        let characterName = '';
        try {
          characterName = Personal.getName ? Personal.getName('sales') : '';
        } catch (e) {}

        // A) free market order slots
        const ordersRes = Eve.getCharacterMarketOrders(characterId, 'sales');
        const openOrders = ordersRes && ordersRes.data ? ordersRes.data : [];
        const openOrderCount = openOrders.length;

        const skillsJson = Eve.getCharacterSkills(characterId, 'sales');
        const maxSlots = computeMaxOrderSlots(skillsJson);
        const freeSlotsRaw = Math.max(0, maxSlots - openOrderCount);
        // EVE hard cap for personal market orders is 100.
        const MAX_EXPORT_LINES = 100;
        const freeSlots = Math.min(freeSlotsRaw, MAX_EXPORT_LINES);

        if (freeSlots <= 0) {
          SpreadsheetApp.getUi().alert('Jita Sales', 'Nemáš volné market order sloty (max=' + maxSlots + ', open=' + openOrderCount + ').', SpreadsheetApp.getUi().ButtonSet.OK);
          return;
        }

        writeSheet(sheet, {
          characterId,
          characterName,
          maxSlots,
          openOrders: openOrderCount,
          freeSlots
        }, '');

        // B) read manual input list from sheet (B/C)
        const lastRow = sheet.getLastRow();
        if (!lastRow || lastRow < INPUT_START_ROW) {
          SpreadsheetApp.getUi().alert('Jita Sales', 'Doplň do sloupce B názvy itemů a do C počty (od řádku 5).', SpreadsheetApp.getUi().ButtonSet.OK);
          return;
        }

        const inputNumRows = lastRow - INPUT_START_ROW + 1;
  const inputRange = sheet.getRange(INPUT_START_ROW, COL_NAME, inputNumRows, 6); // B..G
        const inputVals = inputRange.getValues();

        const inputRows = []; // {rowOffset, nameRaw, nameNorm, key, qty, qtyOk, manualUnitF}
        const names = [];
        for (let i = 0; i < inputVals.length; i++) {
          const nameRaw = normalizeEveName(inputVals[i][0]);
          if (!nameRaw) continue;

          const qtyVal = inputVals[i][1];
          const qtyNum = (typeof qtyVal === 'number')
            ? qtyVal
            : Number(String(qtyVal || '').trim().replace(/[\s,]/g, ''));
          const qtyOk = isFinite(qtyNum) && qtyNum > 0;
          const qty = qtyOk ? Math.trunc(qtyNum) : 0;

          const manualFromG = Number(String(inputVals[i][5] || '').trim().replace(/[\s,]/g, ''));
          const manualUnitF = (isFinite(manualFromG) && manualFromG > 0) ? manualFromG : NaN;

          const nameNorm = normalizeEsiTypeName_(nameRaw);
          const key = canonicalTypeKey_(nameRaw);
          inputRows.push({ rowOffset: i, nameRaw, nameNorm, key, qty, qtyOk, manualUnitF });
          // Preserve raw cell text for type resolution (leading spaces/quotes can matter).
          names.push(nameRaw);
        }

        if (inputRows.length === 0) {
          SpreadsheetApp.getUi().alert('Jita Sales', 'V B/C od řádku 5 jsem nenašel žádné názvy itemů.', SpreadsheetApp.getUi().ButtonSet.OK);
          return;
        }

        // C) prices
        // Strategy:
        // - Prefer cached Ceník Jita sell prices (fast, no extra network).
        // - For types missing from Ceník, fall back to ESI global market prices (one call).
        // This scales to hundreds of distinct types without timing out.
        priceList.init(true);

        // Janice pricer (optional but preferred): resolve + Jita sell pricing by name.
        // If JANICE_API_KEY is missing, this quietly falls back to existing pricelist/ESI logic.
        const janiceApiKey = getJaniceApiKey_();
        const janiceByKey = janiceApiKey ? janicePricerBatch_(names, JANICE_MARKET_ID_JITA) : new Map();
        const priceMultiplier = getPriceMultiplier_();

        // Resolve type IDs from names in one (chunked) call.
        const typeByKey = resolveTypeIdsByNames_(names);

        const neededTypeIdSet = new Set();
        inputRows.forEach(r => {
          const t = typeByKey.get(r.key);
          if (t && t.typeId) neededTypeIdSet.add(Number(t.typeId));
        });

        // Fast lookup from cached price list rows.
        const pricelistRowByTypeId = new Map();
        if (priceList.l_data && priceList.l_data.length) {
          for (let i = 0; i < priceList.l_data.length; i++) {
            const row = priceList.l_data[i];
            const tid = Number(row && row[1]);
            if (!tid) continue;
            if (neededTypeIdSet.has(tid)) {
              pricelistRowByTypeId.set(tid, row);
            }
          }
        }

        // One-shot ESI fallback for missing types.
        const marketPriceByTypeId = new Map();
        try {
          const allPrices = Eve.getMarketPrices();
          if (Array.isArray(allPrices)) {
            for (let i = 0; i < allPrices.length; i++) {
              const mp = allPrices[i];
              const tid = Number(mp && mp.type_id);
              if (!tid || !neededTypeIdSet.has(tid)) continue;
              marketPriceByTypeId.set(tid, {
                average: Number(mp.average_price),
                adjusted: Number(mp.adjusted_price)
              });
            }
          }
        } catch (e) {
          // Still proceed with whatever is already in Ceník.
        }

        // Fill computed columns and build export for first X items in the user-provided order.
        const outTypeIds = new Array(inputNumRows).fill(['']);
        const outUnit = new Array(inputNumRows).fill(['']);
        const outTotal = new Array(inputNumRows).fill(['']);
        const outNote = new Array(inputNumRows).fill(['']);

        let missingType = 0;
        let missingPrice = 0;
        let skippedQty = 0;
        const exportLines = [];
        const exportCandidatesLen = Math.min(freeSlots, inputRows.length);
        let missingTypeCand = 0;
        let missingPriceCand = 0;
        let noMarketCand = 0;
        let skippedQtyCand = 0;
        let fetchedPrice = 0;

        const missingTypeCandRows = [];
        const missingPriceCandRows = [];
        const pushRow_ = (arr, r) => {
          if (arr.length >= 25) return;
          const sheetRow = INPUT_START_ROW + toInt(r.rowOffset);
          arr.push(sheetRow + ': ' + String(r.nameRaw || '').slice(0, 80));
        };

        for (let i = 0; i < inputRows.length; i++) {
          const r = inputRows[i];
          const rowIdx = r.rowOffset;
          const t = typeByKey.get(r.key);

          const isCandidate = i < exportCandidatesLen;

          if (!t || !t.typeId) {
            missingType++;
            outNote[rowIdx] = ['type?'];
            if (isCandidate) {
              missingTypeCand++;
              pushRow_(missingTypeCandRows, r);
            }
            continue;
          }

          const typeId = Number(t.typeId);
          outTypeIds[rowIdx] = [typeId];

          // Prefer Janice Jita sell unit price by canonical name key (if available).
          const j = janiceByKey.get(r.key) || null;
          let unit = (j && isFinite(j.unitSell) && j.unitSell > 0) ? Number(j.unitSell) : NaN;
          let note = (isFinite(unit) && unit > 0) ? ((j && j._usedTop5) ? 'janice:top5' : 'janice') : '';

          if (!(isFinite(unit) && unit > 0)) {
            const plRow = pricelistRowByTypeId.get(typeId);
            unit = unitSellFromPricelistRow(plRow);
            if (isFinite(unit) && unit > 0) note = 'fallback:pricelist';
          }

          // Last-resort price fetch for a small number of items missing from caches.
          if (!(isFinite(unit) && unit > 0) && fetchedPrice < 10) {
            try {
              const p = priceList.getTypeIdPrice(typeId);
              const u2 = unitSellFromPricelistObj_(p);
              if (isFinite(u2) && u2 > 0) {
                unit = u2;
                note = 'fallback:pricelist-fetch';
                fetchedPrice++;
              }
            } catch (e) {
              // keep as no price
            }
          }

          // Final fallback: query live sell orders in The Forge, prefer Jita 4-4.
          if (!(isFinite(unit) && unit > 0) && fetchedPrice < 10) {
            const u3 = getJitaSellFromOrders_(typeId);
            if (isFinite(u3) && u3 > 0) {
              unit = u3;
              note = 'fallback:orders';
              fetchedPrice++;
            }
          }

          // Global ESI average/adjusted as a late fallback (can differ from Jita).
          if (!isFinite(unit) || unit <= 0) {
            const mp = marketPriceByTypeId.get(typeId);
            const avg = mp ? Number(mp.average) : NaN;
            const adj = mp ? Number(mp.adjusted) : NaN;
            unit = (isFinite(avg) && avg > 0) ? avg : ((isFinite(adj) && adj > 0) ? adj : NaN);
            note = isFinite(unit) ? 'fallback:esi' : 'no price';
          }

          // Last fallback: static type base price from ESI type detail.
          // This keeps export unblocked for rare items with no live market data.
          if (!(isFinite(unit) && unit > 0) && fetchedPrice < 20) {
            const u4 = getTypeBasePrice_(typeId);
            if (isFinite(u4) && u4 > 0) {
              unit = u4;
              note = 'fallback:base';
              fetchedPrice++;
            }
          }

          // Manual fallback (for rare items without public market/price data):
          // allow explicit unit price in F.
          if (!(isFinite(unit) && unit > 0)) {
            if (isFinite(r.manualUnitF) && r.manualUnitF > 0) {
              unit = Number(r.manualUnitF);
              note = 'fallback:manual';
            }
          }

          // For top rows we actually export, verify with live Jita orders and override
          // clearly stale cached/global prices.
          if (isCandidate && i < LIVE_VERIFY_CANDIDATES) {
            const live = getJitaSellFromOrders_(typeId);
            if (isFinite(live) && live > 0) {
              const off =
                !(isFinite(unit) && unit > 0) ||
                (unit / live > LIVE_VERIFY_MAX_RATIO) ||
                (live / unit > LIVE_VERIFY_MAX_RATIO);
              if (off) {
                unit = live;
                note = appendPriceNoteTag_(note || 'fallback:orders', 'verified-orders');
              }
            }
          }

          // Optional price adjustment.
          // If `SALES_PRICE_MULTIPLIER` is < 1, we undercut by exactly one market tick.
          // (This matches in-game minimum price increments and avoids “one-isking” issues.)
          if (isFinite(unit) && unit > 0 && isFinite(priceMultiplier) && priceMultiplier !== 1) {
            if (priceMultiplier < 1) {
              const uTick = undercutOneTick_(unit);
              if (isFinite(uTick) && uTick > 0) unit = uTick;
              note = appendPriceNoteTag_(note || 'price', 'tick');
            } else {
              // Keep legacy behavior for markups (>1).
              unit = unit * priceMultiplier;
              note = appendPriceNoteTag_(note || 'price', 'mult');
            }
          }

          // If we undercut and we have a buy price (Janice), never go to or below buy.
          // Use the next valid market tick above buy.
          if (isFinite(unit) && unit > 0 && isFinite(priceMultiplier) && priceMultiplier < 1) {
            let buy = (j && isFinite(j.unitBuy) && j.unitBuy > 0) ? Number(j.unitBuy) : NaN;
            if (!(isFinite(buy) && buy > 0)) {
              const plRow = pricelistRowByTypeId.get(typeId);
              buy = unitBuyFromPricelistRow_(plRow);
            }
            if (!(isFinite(buy) && buy > 0)) {
              try {
                const pbuy = priceList.getTypeIdPrice(typeId);
                buy = unitBuyFromPricelistObj_(pbuy);
              } catch (e) {}
            }
            if (!(isFinite(buy) && buy > 0)) {
              buy = getJitaBuyFromOrders_(typeId);
            }
            if (isFinite(buy) && buy > 0) {
              // Quantize our sell price down to a valid tick first (we don't want rounding up
              // to defeat undercutting), then ensure it stays strictly above buy.
              const qDown = quantizeToMarketTick_(unit, 'down');
              if (isFinite(qDown) && qDown > 0) unit = qDown;
              if (unit <= buy) {
                unit = nextMarketPriceAbove_(buy);
              }
              note = appendPriceNoteTag_(note || 'price', 'buyguard');
            }
          }

          // Always quantize to a valid tick (even without undercutting), then round to 2
          // decimals for clipboard formatting stability.
          if (isFinite(unit) && unit > 0) {
            const q = quantizeToMarketTick_(unit, 'down');
            if (isFinite(q) && q > 0) unit = q;
            unit = round2_(unit);
          }

          outUnit[rowIdx] = [isFinite(unit) && unit > 0 ? unit : ''];
          const total = r.qtyOk ? ((isFinite(unit) && unit > 0 ? unit : 0) * toInt(r.qty)) : '';
          outTotal[rowIdx] = [total || ''];
          outNote[rowIdx] = [note];

          // IMPORTANT: no sorting. Export follows manual order from B5 downward.
          // Rules:
          // - we consider ONLY the first `freeSlots` rows (by position)
          // - if qty is missing, we skip export for that row BUT it still consumes a slot
          // - we never pull replacements from rows below
          if (!r.qtyOk) {
            skippedQty++;
            if (isCandidate) skippedQtyCand++;
            if (!note) outNote[rowIdx] = ['qty?'];
            continue;
          }

          if (!isCandidate) continue;

          if (!(isFinite(unit) && unit > 0)) {
            // If the type cannot be listed on market, do not block the whole export.
            if (!isTypeMarketable_(typeId)) {
              outNote[rowIdx] = ['no market'];
              noMarketCand++;
              continue;
            }
            missingPrice++;
            missingPriceCand++;
            pushRow_(missingPriceCandRows, r);
            continue;
          }

          const exportName = (t.resolvedName ? String(t.resolvedName) : r.nameRaw);
          exportLines.push(exportName + '\t' + formatEvePrice(unit));
        }

        // If any candidate rows with qty are missing type/price, don't show clipboard,
        // because export would start later and look like sorting.
        const candidateBlocking = (missingTypeCand > 0) || (missingPriceCand > 0);
        const exportText = candidateBlocking ? '' : exportLines.join('\n');

        // Write computed columns back.
        sheet.getRange(INPUT_START_ROW, COL_TYPE_ID, inputNumRows, 1).setValues(outTypeIds);
        sheet.getRange(INPUT_START_ROW, COL_UNIT, inputNumRows, 1).setValues(outUnit);
        sheet.getRange(INPUT_START_ROW, COL_TOTAL, inputNumRows, 1).setValues(outTotal);
        sheet.getRange(INPUT_START_ROW, COL_NOTE, inputNumRows, 1).setValues(outNote);
        sheet.getRange(2, 1).setValue(exportText || '');
        try {
          sheet.getRange(2, 1).setWrap(true);
        } catch (e) {}

        if (!candidateBlocking && exportLines.length) {
          showClipboardDialog(exportText, exportCandidatesLen, freeSlots, inputRows.length);
        } else {
          SpreadsheetApp.getUi().alert(
            'Jita Sales',
            candidateBlocking
              ? ((janiceApiKey ? '' : 'Pozn.: JANICE_API_KEY není nastavený (Sales pak nepoužije Janice API).\n')
                + 'V prvních ' + exportCandidatesLen + ' řádcích (dle freeSlots) chybí type/cena: type?=' + missingTypeCand + ', no price=' + missingPriceCand + '.\n'
                + (missingTypeCandRows.length ? ('Type? řádky: ' + missingTypeCandRows.join(' | ') + '\n') : '')
                + (missingPriceCandRows.length ? ('No price řádky: ' + missingPriceCandRows.join(' | ') + '\n') : '')
                + 'Oprav názvy/ceny v těch prvních řádcích (sloupec F) a spusť znovu.')
              : 'Nenašel jsem žádné řádky pro export. Zkontroluj, že máš vyplněné qty v C a že typy/ceny jdou dohledat.',
            SpreadsheetApp.getUi().ButtonSet.OK
          );
        }

        SpreadsheetApp.getActive().toast(
          'Sales: export ' + exportLines.length + '/' + exportCandidatesLen
            + ' (candidate: skip qty ' + skippedQtyCand + ', type? ' + missingTypeCand + ', no price ' + missingPriceCand + ', no market ' + noMarketCand + ').',
          'Sales',
          10
        );
      } catch (e) {
        SpreadsheetApp.getUi().alert('Jita Sales – chyba', String(e), SpreadsheetApp.getUi().ButtonSet.OK);
      } finally {
        try { lock.releaseLock(); } catch (e) {}
      }
    }
    ,
    markSold: function(consumedCount) {
      return markSold_(consumedCount);
    }
  };
})();

// Global function for menu/button
function salesCopyJitaSellImport() {
  return Sales.copyJitaSellImport();
}

function salesMarkSold(consumedCount) {
  return Sales.markSold(consumedCount);
}

