# Market (zdroje cen)

Tenhle dokument popisuje, odkud v Google Sheets/Apps Scriptu bereme ceny a jak je skládáme do jednotného „cenového objektu“, který pak používají další výpočty (např. job cost a oceňování reprocessu).

## 1) Zdroje cen

### EVE ESI (CCP) – average/adjusted
- Volá se ESI endpoint:
  - `GET https://esi.evetech.net/latest/markets/prices/?datasource=tranquility`
- Implementace: [ZAMEK/SCRIPTS/Ceník.gs](../ZAMEK/SCRIPTS/Ceník.gs)
  - funkce `pricelistFetchEVEPrices()`
- Do sheetu `Ceník` se ukládá:
  - `average_price`
  - `adjusted_price`
- Tyhle hodnoty jsou „globální“ (ne Jita buy/sell) a v kódu se používají hlavně pro výpočty průmyslových poplatků (job/installation cost), což odpovídá tomu, jak to počítá EVE (job cost je typicky navázaný na adjusted price).

### EVE Tycoon – Jita statistiky (Top 5% buy/sell)
- Volá se:
  - `GET https://evetycoon.com/api/v1/market/stats/10000002/{typeId}`
  - `10000002` = region The Forge (Jita)
- Implementace: [ZAMEK/SCRIPTS/Ceník.gs](../ZAMEK/SCRIPTS/Ceník.gs)
  - funkce `pricelistFetchTycoonPrices()`
  - u „on-demand“ doplnění typu: `priceList.getTypeIdPrice(typeId)`
- Ukládají se zejména:
  - `buyAvgFivePercent` (≈ „Jita buy top 5%“)
  - `sellAvgFivePercent` (≈ „Jita sell top 5%“)
  - volume a další pomocná data
  - expirace z headeru `Expires` (používá se pro rozhodnutí, jestli je potřeba cenu refreshnout)

### EVE Marketeer – Jita statistiky (alternativní zdroj)
- Volá se:
  - `GET https://api.evemarketer.com/ec/marketstat/json?regionlimit=10000002&typeid=...`
- Implementace: [ZAMEK/SCRIPTS/Ceník.gs](../ZAMEK/SCRIPTS/Ceník.gs)
  - funkce `pricelistFetchMarketeerPrices()`
- V praxi se používá buď Tycoon nebo Marketeer podle toho, kterou „refresh“ funkci spouštíš (`getPricesTycoon()` vs `getPricesMarketeer()`).

## 2) Jednotný cenový objekt (priceList)

Většina ostatních částí kódu nechce řešit, odkud cena přišla; bere si ji přes `priceList`.

Implementace: [ZAMEK/SCRIPTS/Ceník.gs](../ZAMEK/SCRIPTS/Ceník.gs)

### `priceList.init(force)`
- Načte celý sheet `Ceník` do paměti (`priceList.l_data`).
- Pokud není `force` a data už jsou v paměti, nečte znovu (memoizace v rámci jedné exekuce Apps Scriptu).

### `priceList.getPrice(typeName)`
- Najde řádek podle názvu typu (sloupec A v `Ceník`).
- Vrací objekt:
  - `eveAverage`
  - `eveAdjusted`
  - `jitaSplitTop5`
  - `jitaBuyTop5`
  - `jitaSellTop5`
- Pokud typ neexistuje, přidá řádek do sheetu a vrátí nuly (dokud se nenaplní skutečnými cenami).

### `priceList.getTypeIdPrice(typeId)`
- Najde řádek podle `typeId`.
- Pokud řádek neexistuje:
  1) stáhne detail typu (`Universe.getType(typeId)`),
  2) stáhne Tycoon stats,
  3) přidá nový řádek do interní cache i do sheetu.
- Vrací navíc i:
  - `name`, `group`, `category`
  - `buyout` (to je „naše“ interní výkupní cena)

## 3) „Buyout“ cena a odvozené oceňování

### Default buyout logika (95% Jita buy)
- V `priceList.getTypeIdPrice()` se pro většinu věcí nastaví buyout jako:
  - `buyout = 0.95 * JitaBuyTop5`
- Tohle se používá zejména v buyout/contract kalkulacích.

### Ore/asteroid výjimka (počítaná cena z mineralů)
- Pokud je typ kategorie `Asteroid` (a není to Ice), buyout se nastaví z kalkulace reprocessu (`calculateOrePrice`).
- Implementace reprocess kalkulace: [ZAMEK/SCRIPTS/Ore.gs](../ZAMEK/SCRIPTS/Ore.gs)
  - `downloadOreMinerals(typeName)` volá custom API `http://www.spacehamsters.eu:8010/api/ore/material`
  - `calculateOrePrice(typeName, efficiency, taxRate, margin, mineralsText)`
- `calculateOrePrice` oceňuje minerály přes `priceList.getPrice(mineral.typeName)` a vrací varianty:
  - `jitaBuy`, `jitaSplit`, `jitaSell`
  - (včetně daně z reprocessu přes `eveAdjusted * taxRate`)

## 4) Praktické poznámky a časté zdroje odchylek

- `eveAdjusted` není market buy/sell cena. Je to CCP „adjusted price“ a typicky se hodí na job cost, ne na reálnou nákupní cenu vstupů.
- U typů, které v ceniku chybí, `getPrice()` vrátí nuly (dokud neproběhne refresh). To může rozbít jakékoliv oceňování, které to bere jako „pravdu“.
- Tycoon refresh má caching přes `Expires` a refreshuje jen expirované řádky; výsledky se tedy můžou „lišit“ oproti online kalkulačkám jen proto, že pracuješ se staršími daty.
