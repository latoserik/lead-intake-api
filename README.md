# lead-intake-api

Supabase Edge Function, ami egy kapcsolatfelvételi űrlapról érkező megkeresést
fogad. Validálja a bemenetet, egy LLM-mel besorolja, elmenti a `leads` táblába,
és ha a lead sürgős, küld egy értesítést Discord webhookra.

Deployolt végpont:
`https://nqhkdwqgymjwlswyzmzt.supabase.co/functions/v1/lead-intake`

## Mi történik egy kéréssel

1. Ha nem `POST`, `405`. Ha a törzs nem érvényes JSON, `400`.
2. Validáljuk a mezőket. Hibánál `400`, és egyszerre visszaadjuk az összes
   hibás mezőt, hogy az űrlap egy körben javítható legyen.
3. Megnézzük, szerepel-e már az email a táblában. Ha igen, `409`.
4. Meghívjuk az Anthropic API-t. Az visszaadja a kategóriát, a prioritást és
   egy magyar összefoglaló mondatot.
5. Elmentjük a rekordot.
6. Ha a prioritás `1`, megy az értesítés a webhookra.
7. Válasz: `201` és a mentett rekord.

Az egész úgy van megírva, hogy lead ne veszhessen el. Ha az LLM nem elérhető,
vagy olyan választ ad, amit nem tudunk értelmezni, a lead akkor is bekerül az
adatbázisba `category = ismeretlen`, `priority = 2`, `classified = false`
értékekkel. Ha a webhook elbukik, azt csak logoljuk, a válasz marad `201`.
Hibát csak akkor adunk vissza, ha maga a mentés nem sikerült.

## Projektstruktúra

```
supabase/
  config.toml                              verify_jwt = false
  migrations/
    20260908160000_create_leads_table.sql  a leads tábla és az RLS
  functions/lead-intake/
    index.ts         belépési pont, a lépések sorrendje, HTTP válaszok
    config.ts        környezeti változók és alapértelmezések
    validation.ts    bemenet-validáció
    classifier.ts    Anthropic hívás, a válasz ellenőrzése, fallback
    repository.ts    duplikátum-keresés és mentés
    notifier.ts      Discord webhook
    http.ts          JSON válasz, CORS, fetch időtúllépéssel
tests/
  validation_test.ts   9 teszt a bemenet-validációra
  classifier_test.ts   9 teszt az LLM-válasz ellenőrzésére
  assert.ts            pár soros assert helper, hogy ne kelljen függőség
scripts/
  smoke-test.sh        a deployolt végpont végigtesztelése (8 eset)
```

## Adatbázis

A séma: [`supabase/migrations/20260908160000_create_leads_table.sql`](supabase/migrations/20260908160000_create_leads_table.sql)

| oszlop | típus | megjegyzés |
|---|---|---|
| `id` | `uuid` | elsődleges kulcs, `gen_random_uuid()` |
| `name` | `text` | kötelező |
| `email` | `text` | kötelező, egyedi |
| `company` | `text` | opcionális |
| `message` | `text` | kötelező |
| `category` | `text` | kötelező: `arajanlat`, `hibabejelentes`, `altalanos` vagy `ismeretlen` |
| `priority` | `integer` | kötelező, `CHECK (priority in (1,2,3))` |
| `summary` | `text` | egy magyar mondat, `null` ha nem sikerült a besorolás |
| `classified` | `boolean` | alapértelmezés `true`, fallback esetén `false` |
| `created_at` | `timestamptz` | alapértelmezés `now()` |

A táblán be van kapcsolva az RLS, és nincs hozzá egyetlen policy sem. RLS
mellett policy nélkül a nem privilegizált szerepkörök nem látnak sort és nem
tudnak írni. Emellett a migráció visszavonja az `anon` és `authenticated`
szerepkörök tábla-szintű jogait is, amiket a Supabase alapból megad. Így az
anon kulccsal küldött kérés jogosultsági hibát kap, nem üres listát. A
`service_role` kulcs megkerüli az RLS-t, ezért az Edge Function működik.

Ellenőrzés anon kulccsal, olvasásra és írásra:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  "$SUPABASE_URL/rest/v1/leads?select=*" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY"
# 401

curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "$SUPABASE_URL/rest/v1/leads" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"name":"anon","email":"anon@example.com","message":"anon","category":"altalanos","priority":2}'
# 401
```

Mindkettőt a `scripts/smoke-test.sh` is lefuttatja.

## Környezeti változók

Minden titok környezeti változóból jön, a repóban nincs valódi kulcs. A minta:
[`.env.example`](.env.example). A `.env` a `.gitignore`-ban van.

| Változó | Kötelező | Leírás |
|---|---|---|
| `SUPABASE_URL` | igen | A projekt URL-je. A Supabase futtatókörnyezetben automatikusan be van állítva, lokálisan kell megadni. |
| `SUPABASE_SERVICE_ROLE_KEY` | igen | Service role kulcs. Szintén automatikus a platformon. |
| `ANTHROPIC_API_KEY` | nem | Ha nincs beállítva, a függvény logol egy hibát, és minden lead `classified = false`-szal mentődik. |
| `ANTHROPIC_MODEL` | nem | Alapértelmezés: `claude-haiku-4-5-20251001`. |
| `WEBHOOK_URL` | nem | Ha nincs beállítva, az értesítés kimarad. A lead mentődik. |
| `LLM_TIMEOUT_MS` | nem | Alapértelmezés `10000`. |
| `WEBHOOK_TIMEOUT_MS` | nem | Alapértelmezés `5000`. |
| `DB_TIMEOUT_MS` | nem | Alapértelmezés `5000`. |

A `SUPABASE_ANON_KEY` a függvénynek nem kell, csak a `scripts/smoke-test.sh`
használja az RLS-ellenőrzéshez.

## Telepítés

Kell hozzá a [Supabase CLI](https://supabase.com/docs/guides/cli), egy Supabase
projekt, és a tesztekhez [Deno](https://deno.com/).

```bash
git clone https://github.com/latoserik/lead-intake-api.git
cd lead-intake-api
cp .env.example .env      # töltsd ki a saját értékeiddel

supabase login
supabase link --project-ref <a-te-project-refed>
supabase db push          # létrehozza a leads táblát az RLS-sel együtt
```

## Futtatás

Lokálisan, Dockerrel:

```bash
supabase start
supabase functions serve lead-intake --env-file .env --no-verify-jwt
# http://localhost:54321/functions/v1/lead-intake
```

Típusellenőrzés, lint és unit tesztek Docker nélkül is mennek:

```bash
deno task check
deno task lint
deno task test
```

## Deploy

```bash
supabase secrets set \
  ANTHROPIC_API_KEY='sk-ant-...' \
  ANTHROPIC_MODEL='claude-haiku-4-5-20251001' \
  WEBHOOK_URL='https://discord.com/api/webhooks/...'

supabase functions deploy lead-intake
```

A `SUPABASE_URL` és a `SUPABASE_SERVICE_ROLE_KEY` nem állítható be titokként,
ezeket a platform adja a futtatókörnyezetnek.

A `supabase/config.toml`-ban `verify_jwt = false`, mert a végpontot egy
publikus űrlap hívja, tehát nem várhatunk Supabase JWT-t a kéréstől.

## API

`POST /functions/v1/lead-intake`, `Content-Type: application/json`

| mező | típus | kötelező | megkötés |
|---|---|---|---|
| `name` | string | igen | nem üres, max 200 karakter |
| `email` | string | igen | érvényes formátum, max 254 karakter, kisbetűsítve tároljuk |
| `company` | string | nem | max 200 karakter, a `null` és a `""` is azt jelenti, hogy nincs megadva |
| `message` | string | igen | nem üres, max 5000 karakter |

Válaszkódok:

| kód | mikor |
|---|---|
| `201` | sikeres feldolgozás, a törzs a mentett rekord |
| `400` | érvénytelen JSON vagy hibás mező |
| `405` | nem `POST` kérés |
| `409` | az email cím már szerepel a táblában |
| `413` | 64 KB-nál nagyobb kérés-törzs |
| `500` | hiányzik egy kötelező szerveroldali beállítás |
| `503` | a mentés nem sikerült, a hívó újrapróbálhatja |

## curl példák

### Érvényes kérés

```bash
curl -i -X POST 'https://nqhkdwqgymjwlswyzmzt.supabase.co/functions/v1/lead-intake' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Kovács Anna",
    "email": "anna.kovacs@example.com",
    "company": "Acme Kft.",
    "message": "Szeretnék árajánlatot kérni egy céges weboldal fejlesztésére. Nem sürgős, a jövő hónapban indulna a projekt."
  }'
```

```
HTTP/2 201
content-type: application/json; charset=utf-8

{
  "id": "96c7d99f-ca70-4031-a94d-45d11e8666bc",
  "category": "arajanlat",
  "priority": 2,
  "summary": "A küldő árajánlatot kér egy céges weboldal fejlesztésére, jövő hónapi kezdéssel.",
  "classified": true,
  "created_at": "2026-09-11T08:25:04.816886+00:00"
}
```

### Hibás kérés

```bash
curl -i -X POST 'https://nqhkdwqgymjwlswyzmzt.supabase.co/functions/v1/lead-intake' \
  -H 'Content-Type: application/json' \
  -d '{"name": "", "email": "nem-email", "company": 42}'
```

```
HTTP/2 400

{
  "error": "validation_failed",
  "message": "A kérés érvénytelen mezőket tartalmaz.",
  "fields": [
    { "field": "name",    "code": "empty",          "message": "A 'name' mező nem lehet üres." },
    { "field": "message", "code": "missing",        "message": "A 'message' mező kötelező." },
    { "field": "email",   "code": "invalid_format", "message": "Az 'email' mező nem érvényes email cím." },
    { "field": "company", "code": "wrong_type",     "message": "A 'company' mezőnek szövegnek kell lennie." }
  ]
}
```

### Duplikált email

```bash
curl -i -X POST 'https://nqhkdwqgymjwlswyzmzt.supabase.co/functions/v1/lead-intake' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Kovács Anna",
    "email": "anna.kovacs@example.com",
    "message": "Ugyanaz az email cím másodszor."
  }'
```

```
HTTP/2 409

{
  "error": "duplicate_email",
  "message": "Ezzel az email címmel már érkezett megkeresés.",
  "field": "email"
}
```

### Amikor az LLM nem elérhető

Ilyenkor is `201` jön, csak fallback értékekkel:

```
{
  "id": "7781c476-9204-41ce-9f32-9696cb2f1bd3",
  "category": "ismeretlen",
  "priority": 2,
  "summary": null,
  "classified": false,
  "created_at": "2026-09-11T08:26:33.110377+00:00"
}
```

## A webhookra küldött üzenet

Ha a mentett lead `priority` értéke `1`, a függvény `POST`-ol a `WEBHOOK_URL`-re
`Content-Type: application/json` fejléccel. A törzs Discord webhook formátumú:

```json
{
  "username": "Lead Intake",
  "content": "🚨 **Sürgős lead érkezett**",
  "embeds": [
    {
      "title": "Nagy Péter — Példa Zrt.",
      "description": "Az éles rendszer leállt és a megrendelések nem mennek át, azonnali megoldás szükséges.",
      "color": 15548997,
      "timestamp": "2026-09-11T08:25:04.816886+00:00",
      "fields": [
        { "name": "Email",          "value": "nagy.peter@pelda.hu",                  "inline": true },
        { "name": "Kategória",      "value": "hibabejelentes",                       "inline": true },
        { "name": "Prioritás",      "value": "1 (sürgős)",                           "inline": true },
        { "name": "Üzenet",         "value": "Leállt az éles rendszerünk, ..." },
        { "name": "Lead azonosító", "value": "96c7d99f-ca70-4031-a94d-45d11e8666bc" }
      ]
    }
  ]
}
```

- `title`: a küldő neve, és ha megadta, a cég neve is
- `description`: az LLM összefoglalója, vagy egy jelzés, ha nincs
- `color`: `15548997`, azaz piros
- `timestamp`: a lead `created_at` értéke
- `fields`: email, kategória, prioritás, az eredeti üzenet és a lead azonosítója

Az üzenetet 1000 karakternél levágjuk, mert a Discord 1024-nél többet nem
fogad el egy mezőben. Ha valaki Slacket vagy Make.com-ot használna, elég a
`notifier.ts` `buildPayload()` függvényét átírni.

## Hibakezelés

| Eset | Mit csinálunk | Válasz |
|---|---|---|
| Hiányzó, rossz típusú vagy rossz formátumú mező | egyszerre visszaadjuk az összeset | `400` |
| Érvénytelen JSON | | `400` |
| Nem `POST` metódus | | `405` |
| Az email már szerepel a táblában | előzetes keresés, plusz unique constraint az inserten | `409` |
| Az LLM időtúllépésbe fut vagy 5xx-et ad | egy újrapróbálkozás, utána fallback | `201`, `classified: false` |
| Az LLM 400-at vagy 401-et ad | nincs retry, mert ugyanaz lenne az eredmény | `201`, `classified: false` |
| Az LLM a sémán kívüli választ ad | a saját validátorunk elutasítja, egy retry, utána fallback | `201`, `classified: false` |
| Nincs `ANTHROPIC_API_KEY` | logolunk és fallback | `201`, `classified: false` |
| A webhook hibát ad vagy nem válaszol | csak logolunk | `201` |
| Nincs `WEBHOOK_URL` | logolunk, az értesítés kimarad | `201` |
| Az adatbázis nem elérhető | logolunk | `503` |
| Hiányzik a Supabase konfiguráció | logolunk, de nem írjuk ki, melyik változó hiányzik | `500` |

Minden kifelé menő hívásnak van időtúllépése: az Anthropic és a webhook
hívásoknál `AbortController`, az adatbázis-műveleteknél a Supabase kliens
`abortSignal` metódusa. A log sorok elején egy kérésenként generált
azonosító áll, így egy hívás sorai összefűzhetők.

## Tesztelés

Unit tesztek, hálózat és Docker nélkül:

```bash
deno task test
# ok | 18 passed | 0 failed
```

A validáció és az LLM-válasz ellenőrzése van lefedve. Utóbbinál a hibás esetek
is: nem létező kategória, tartományon kívüli prioritás, hiányzó összefoglaló,
tool hívás helyett sima szöveges válasz, és hibaobjektum válaszként.

A deployolt végpontra:

```bash
export FUNCTION_URL='https://nqhkdwqgymjwlswyzmzt.supabase.co/functions/v1/lead-intake'
export SUPABASE_URL='https://nqhkdwqgymjwlswyzmzt.supabase.co'
export SUPABASE_ANON_KEY='<anon kulcs>'
./scripts/smoke-test.sh
```

Nyolc esetet futtat: érvényes kérés, hibás kérés, duplikált email, sürgős lead
(ez küldi a webhookot), rossz metódus, érvénytelen JSON, és két RLS-ellenőrzés
(anon kulccsal sem olvasni, sem írni nem lehet a táblába).

A két hibaágat kézzel teszteltem a deployolt végponton úgy, hogy ideiglenesen
elrontottam egy-egy titkot. Rossz `ANTHROPIC_API_KEY`-jel a lead
`classified = false`-szal mentődött, rossz `WEBHOOK_URL`-lel pedig a kérés
továbbra is `201`-et adott.

## Jegyzet

A Claude-dal lépésekre bontva dolgoztam: minden lépés egy önálló commit lett,
hogy utólag is látszódjon a munka menete. A Claude írta az SQL migrációt, az
Edge Function moduljait, a unit teszteket és a smoke-test szkriptet; a Supabase
projekt létrehozása, a titkok beállítása, a deploy és az éles tesztek nálam
maradtak. A modellnevet nem tippeltem, hanem lekértem az Anthropic
`/v1/models` végpontjáról, és a besorolási promptot egy éles próbahívással
kipróbáltam, mielőtt bekerült volna a kódba.

Minden lépés után lefuttattam a `deno check`, `deno lint` és `deno test`
hármast. A típusellenőrzés talált egy valódi hibát: az `.abortSignal()` hívás
a `.single()` után állt, ahol már nem létezik, így az inserten nem érvényesült
volna az időtúllépés. A végén egy másikat is észrevettem: az alapértelmezett
modellnév olyan modellre mutatott, ami nincs a fiókomon. Az RLS-t sem hittem
el a dokumentációnak — SQL-ből ellenőriztem, hogy be van kapcsolva, hogy nulla
policy van, hogy a `CHECK` a helyén van és hogy az `anon` szerepkörnek nincs
joga a táblán, utána pedig anon kulccsal is megpróbáltam olvasni (`401`).

Időhiány miatt kimaradt a rate limiting és a spamvédelem, pedig egy publikus
űrlap-végpontnak kellene. Nincs CI sem, ami pusholáskor lefuttatná a teszteket.
Az email egyediséget kisbetűsítéssel oldottam meg az alkalmazásban, nem
`lower(email)` unique indexszel az adatbázisban.

Éles rendszerben az LLM-besorolást kivenném a kérés útjából: a lead azonnal
mentődne `classified = false`-szal, egy háttérfeladat pedig sorból dolgozná fel
és frissítené a rekordot. Így a válasz gyors, és az osztályozás függetlenül
újrapróbálható. Eltárolnám a nyers LLM-választ és a promptverziót, hogy egy
besorolás utólag is ellenőrizhető legyen. Riasztást tennék arra, ha megugrik a
`classified = false` aránya, mert az csendben romlik el. A CORS pedig `*`
helyett a tényleges űrlap domainjére szűkülne.

Ténylegesen ráfordított idő: körülbelül 2-2,5 óra.
