# Volani Serveru Tahak

Tento soubor je prakticky tahak pro pristi praci se serverem. Cilem je rychle najit, jak backend opravdu volame z Google Sheets, odkud se bere bearer token a jak ten samy call spustit lokalne.

## Zdroj Pravdy Pro Volani

Hlavni zdroj pravdy je Google Apps Script klient:

- `ZAMEK/SCRIPTS/AubiApi.gs`
- `ZAMEK/SCRIPTS/Personal.gs`
- podle potreby i `ZAMEK/SCRIPTS/Security.gs`

Nejdulezitejsi pravidlo: kdyz je rozpor mezi domnenkou a `.gs` skripty, plati `.gs` skripty.

## Base URL

Produkce se vola na:

```text
https://www.spacehamsters.eu/api
```

V `ZAMEK/SCRIPTS/AubiApi.gs` je to promenna `aubiApi`.

## Authorization A Bearer

Google Sheets vola backend pres HTTP header:

```text
Authorization: Bearer <token>
```

V `AubiApi.gs` je to delane takto:

```javascript
ret.headers.authorization = "Bearer " + Personal.getAccessToken();
```

To znamena:

- bearer token je presne navratova hodnota `Personal.getAccessToken()`
- do lokalniho JSON configu patri jen samotny token bez prefixu `Bearer `
- bearer neni `refresh_token`
- bearer neni `EVE_CLIENT_ID`
- bearer neni `EVE_CLIENT_SECRET`
- bearer neni `JANICE_API_KEY`

V praxi je bearer obvykle jedna z techto hodnot z Google Script properties:

- `access_token`
- `shared_full_access_token`

Pokud tooling bezi pres sdileny full pristup, nejpravdepodobneji je spravna hodnota `shared_full_access_token`.

## Kde Se Bere Token

Logika je v `ZAMEK/SCRIPTS/Personal.gs`:

- `Personal.getAccessToken()` nejdriv zkusi aktivni user token
- kdyz neni k dispozici a jde o full profil, fallbackne na shared full token

Prakticky dusledek: kdyz potrebujeme lokalne simulovat volani ze Sheets, staci mit platny full access token, idealne ten stejny, ktery realne pouzivaji Sheets.

## Dulezite Endpointy Pro Activity

Pro activity jsou v `ZAMEK/SCRIPTS/AubiApi.gs` potvrzene tyto cally:

```text
GET /corporation/{corporationId}/activity/sync
GET /corporation/{corporationId}/activity/report/{year}/{month}
```

Aktualni corporation ID v lokalnim helperu je:

```text
98652228
```

Konkretne produkcni URL tedy vypadaji takto:

```text
https://www.spacehamsters.eu/api/corporation/98652228/activity/sync
https://www.spacehamsters.eu/api/corporation/98652228/activity/report/2026/5
```

## Lokalni Helper V Repu

Pro lokalni volani bez Google Sheets je v repu pripraveno:

- `tools/activity_api.local.json` - lokalni ignorovany config se secrety
- `tools/activity_api.example.json` - sablona configu bez secretu
- `tools/call_activity_api.py` - jednoduchy lokalni caller

Obsah `tools/activity_api.local.json`:

```json
{
  "baseUrl": "https://www.spacehamsters.eu/api",
  "corporationId": 98652228,
  "bearerToken": "SEM_PATRI_SAMOTNY_ACCESS_TOKEN"
}
```

Pozor: do `bearerToken` nepatri `Bearer ` prefix. Ten pridava skript sam.

## Jak To Pustit Lokalne

Z rootu repa:

```powershell
& "z:/PROGRAMOVANI VYVOJ APLIKACI/PROJECT EVE BACKEND/.venv/Scripts/python.exe" tools/call_activity_api.py
```

Pouze report bez syncu:

```powershell
& "z:/PROGRAMOVANI VYVOJ APLIKACI/PROJECT EVE BACKEND/.venv/Scripts/python.exe" tools/call_activity_api.py --skip-sync
```

Jiny mesic:

```powershell
& "z:/PROGRAMOVANI VYVOJ APLIKACI/PROJECT EVE BACKEND/.venv/Scripts/python.exe" tools/call_activity_api.py --year 2026 --month 4
```

## Co Cekat Od Odpovedi

Helper momentalne vypisuje:

- HTTP status pro sync
- telo odpovedi pro sync
- HTTP status pro report
- telo odpovedi pro report

To je zamerne jednoduche, aby bylo hned videt, co server opravdu vratil, bez dalsiho obalu.

## Posledni Overeny Stav

Pri zive zkousce 2026-05-05 server odpovedel takto:

- `SYNC 200` s telem `Chyba: list index out of range`
- `REPORT 200` s telem `Chyba: list index out of range`

To znamena, ze bearer token uz server prijal a request prosel dostatecne daleko na to, aby backend spadl na vlastni chybe aplikace. Problem uz nebyl v lokalnim volani, ale v server-side kodu.

## Doporuceny Postup Priste

Kdyz bude potreba znovu overit realne chovani serveru:

1. Otevrit `VOLANICONTEXT.md`.
2. Zkontrolovat `tools/activity_api.local.json`.
3. Overit, ze bearer je opravdu access token, ne refresh token.
4. Pustit `tools/call_activity_api.py`.
5. Kdyz server vrati chybu, trasovat nejblizsi sdilenou backend cestu pro dane endpointy.
