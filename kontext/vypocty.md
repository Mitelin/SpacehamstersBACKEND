# Výpočty (blueprinty, materiály, job cost)

Tenhle dokument popisuje, jak dnes systém v Sheets/Apps Scriptu:
1) získá plán výroby (joby + materiály),
2) spočítá potřebné množství vstupů,
3) počítá „cenu za běh jobu“ (installation/job cost) a kde přesně se to bere.

Důležité: v aktuálním Apps Scriptu se **nepočítá kompletní „výrobní cena“ jako součet nákupních cen vstupů + job fee + další poplatky** v jednom místě. Systém primárně plánuje materiály a joby a k tomu dopočítává job cost (na adjusted price). Pro přesnější „total build cost“ existuje separátní integrace na externí API (viz níže), ale ta se používá jen v pomocném sheetu.

## 1) Zdroje dat pro blueprint výpočet

### A) Custom API „blueprints/calculate“ – plán jobů + materiály
Implementace: [ZAMEK/SCRIPTS/Blueprints.gs](../ZAMEK/SCRIPTS/Blueprints.gs)
- Funkce: `Blueprints.calculateBlueprints()`
- Request (POST JSON) na:
  - `http://www.spacehamsters.eu:8010/api/blueprints/calculate`
- Do requestu se posílá:
  - `types`: seznam `{typeId, amount}`
  - ME/TE parametry pro různé kategorie (ship/module T1/T2) z hlavičky projektu
  - flagy `produceFuelBlocks`, `buildT1`, `copyBPO`

Odpověď API obsahuje minimálně:
- `data.jobs[]`: joby pro jednotlivé „levely“ výroby
- `data.materials[]`: materiály (input i intermediate)
- `job.materials`: seznam materiálů pro konkrétní job (ukládá se jako JSON string do tabulky jobů)

Do sheetu projektu se to zapisuje takto:
- Tabulka jobů (řádky od `firstDataRow`):
  - `JSON.stringify(job.materials)` se ukládá do sloupce 8 v job tabulce
- Tabulka vstupních materiálů:
  - pro `material.isInput == true` se zapisují „potřebná množství“ rozdělená podle typu aktivity a (volitelně) buffer hangárů
- Tabulka mezivýrobků:
  - pro `material.isInput == false`

### B) Custom API „blueprints“ – detail jednoho blueprintu
Implementace: [ZAMEK/SCRIPTS/Blueprints.gs](../ZAMEK/SCRIPTS/Blueprints.gs)
- Funkce: `Blueprints.getBlueprint(typeId)`
- Volá stejný endpoint jako A), ale s `types=[{typeId, amount:1}]` a default parametry.

Použití v kódu je dnes spíš pomocné (např. v market výpočtech availability).

### C) Externí API „buildCost“ (cookbook-like) – přesnější náklady
Implementace: [ZAMEK/SCRIPTS/EveApi.gs](../ZAMEK/SCRIPTS/EveApi.gs)
- Funkce: `Eve.getBuildCosts(...)`
- URL pattern:
  - `{cookbookApi}/buildCost?blueprintTypeId=...&quantity=...&priceMode=...&baseMe=...&componentsMe=...&system=...&facilityTax=...&industryStructureType=...&industryRig=...&reactionStructureType=...&reactionRig=...&reactionFlag=...&blueprintVersion=...`

Poznámka: v aktuální verzi [ZAMEK/SCRIPTS/EveApi.gs](../ZAMEK/SCRIPTS/EveApi.gs) to vypadá, že při skládání URL chybí konkatenace (`+`) mezi parametry `reactionFlag` a `blueprintVersion`. Pokud by `updateBuildCosts` nefungovalo nebo vracelo divné výsledky, tohle je první věc ke kontrole.

Aktuálně se to používá jen v:
- `Blueprints.updateBuildCosts()` v [ZAMEK/SCRIPTS/Blueprints.gs](../ZAMEK/SCRIPTS/Blueprints.gs)

Tj. **neovlivňuje** standardní „Projekt“ workflow, je to spíš nástroj pro srovnání/kalibraci.

## 2) Přepočet projektu (recalculateProject): požadavky a job status

Implementace: [ZAMEK/SCRIPTS/Blueprints.gs](../ZAMEK/SCRIPTS/Blueprints.gs)
- Funkce: `Blueprints.recalculateProject(sheet, notify)`

Co dělá:
1) Načte tabulku jobů a tabulku input materiálů.
2) Pro každý job si jednou naparsuje `plannedJobs[row][7]` (JSON) do `materialsByRow[row]`.
3) Načte cost indexy/bonusy ze sheetu (rozsah `sheet.getRange(3, 9, 8, 1)`):
   - `manufacturingSystemCost`, `manufacturingBonus`
   - `reactionSystemCost`, `reactionBonus`
   - `copySystemCost`, `copyBonus`
   - `inventionSystemCost`, `inventionBonus`
4) Spočítá:
   - `required` (kolik je potřeba vyrobit)
   - `inprogress` (kolik je ve výrobě)
   - `ready` (kolik je hotovo/skladem)
   - a z toho určí status (`Hotovo`, `Běží`, `Připraveno`, `Čeká`)

Poznámka: inventní část má v kódu komentář `TODO: apply probability` – tj. pravděpodobnost invention success se zatím explicitně nepromítá.

## 3) Materiálové množství a zaokrouhlování (ceil)

### A) Dedukce materiálu u nově spuštěných jobů
Když systém zjistí, že po „update“ přibyly nové aktivní joby, odečítá materiál ze skladů.

Implementace: [ZAMEK/SCRIPTS/Blueprints.gs](../ZAMEK/SCRIPTS/Blueprints.gs)
- Funkce: `getMaterialsForNewJobs(plannedJobs, newJobs, blueprints)`

Klíčové body:
- Blueprint ME se bere z corp blueprint cache (`blueprints.materialEfficiency`) podle `job.blueprintId`.
- Pro Manufacturing jsou dnes natvrdo:
  - `roleBonus = 0.99`
  - `rigBonus = 0.958`
- Pro Reaction je natvrdo:
  - `rigBonus = 0.974`
- Finální odečítané množství pro jeden materiál:

$$\text{amount} = \left\lceil base\_quantity \cdot runs \cdot roleBonus \cdot rigBonus \cdot (1 - ME/100) \right\rceil$$

Tahle část je významná pro rozdíly oproti online kalkulačkám, protože:
- bonusy jsou hardcoded (neberou v úvahu konkrétní strukturu/rig tier/skills),
- `ceil` dělá konzervativní zaokrouhlení nahoru.

### B) Výpočet „requirements“ pro plán
V `recalculateProject` se pro rozpad požadavků používá `material.quantity` (ne `base_quantity`) a přepočet přes `todo/total` s `Math.ceil`.

To znamená, že „requirements“ pro upstream joby / input tabulku jsou konzervativně zaokrouhlované nahoru per materiál.

## 4) Job/installation cost („Run cost“ ve sloupci colRunCost)

Implementace: [ZAMEK/SCRIPTS/Blueprints.gs](../ZAMEK/SCRIPTS/Blueprints.gs)
- V části `recalc compute status & cost`

### Manufacturing
- Materiály se oceňují přes `priceList.getPrice(material.type).eveAdjusted`.
- Blueprinty jako input (materiál, jehož typ končí na `Blueprint`) se přeskočí.

Základ:

$$base = \sum_{m \in materials} (m.base\_quantity \cdot runs \cdot adjustedPrice(m))$$

A pak:

$$runCost = base \cdot manufacturingSystemCost \cdot (1 + manufacturingBonus)$$

### Reaction
Stejný princip, ale:

$$runCost = base \cdot reactionSystemCost \cdot (1 + reactionBonus)$$

### Invention
Aktuálně je to aproximace:
- vezme se `finalProduct = product.substring(0, product.length - 10)`
- pak:

$$base = runs \cdot adjustedPrice(finalProduct) \cdot 0.02$$

A pak:

$$runCost = base \cdot inventionSystemCost \cdot (1 + inventionBonus)$$

## 5) Proč se to může lišit od EVE-Cookbook / jiných online toolů

Typické zdroje odchylek v aktuální implementaci:
- **Cenový režim**: job cost používá `adjusted_price` (správné pro job fee), ale „výrobní cena“ v online toolu bývá z market buy/sell (Jita buy/sell/split) + další.
- **Hardcoded bonusy**: role/rig bonusy v `getMaterialsForNewJobs` jsou konstanty; online tool typicky bere konkrétní facility (Sotiyo/Azbel/Raitaru), rig tier (T1/T2), system/security a někdy i char skills.
- **Invention pravděpodobnost**: v kódu je naznačeno, že se zatím nepočítá (`TODO: apply probability`). Online tool to obvykle zahrnuje.
- **Zaokrouhlování**: `ceil` po materiálech může zvýšit spotřebu oproti toolu, který pracuje jinak (např. per batch / per run).
- **Excess materials value**: externí API (buildCost) vrací i `excessMaterialsValue`; náš interní job cost s tím nepracuje.

## 6) Co je dnes „pravda“ pro budoucí web kalkulačku

Pokud cílem je web kalkulačka, je potřeba si explicitně říct, co definujeme jako „výrobní cenu“:
- jen **material cost** (market buy/sell),
- **material cost + job cost**,
- nebo **total cost** včetně facility tax/additional costs, a jak počítat invention (probability, decryptory).

V kódu už existuje směr, jak to sjednotit:
- API `Eve.getBuildCosts(...)` umí vracet rozpad `materialCost`, `jobCost`, `totalCost` a parametry odpovídají industrial realitě.
- Naopak stávající projektový výpočet v Sheets je primárně „plánovač“ (co chybí v hangáru, co je ready/in progress) + orientační job cost.
