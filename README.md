# lead-intake-api

Lead-feldolgozó API **Supabase Edge Function**-ként. Egy kapcsolatfelvételi
űrlapról érkező megkeresést fogad, LLM-mel besorolja, elmenti a Supabase
adatbázisba, és sürgős esetben értesítést küld egy webhookra.

## Mit csinál

1. `POST` JSON kérést fogad: `name`, `email`, `company` (opcionális), `message`
2. Validálja a bemenetet — hiba esetén `400`, a hibás mezők nevével
3. Ellenőrzi, hogy az email szerepel-e már — ha igen, `409`
4. Meghívja az Anthropic API-t, ami visszaadja a `category`-t, a `priority`-t és
   egy magyar `summary`-t
5. Ha az LLM nem érhető el vagy használhatatlan választ ad, a lead akkor is
   mentődik: `category = ismeretlen`, `priority = 2`, `classified = false`
6. Elmenti a rekordot, és ha `priority = 1`, értesítést küld egy webhookra
7. Visszaad `201`-et a mentett rekorddal

## Állapot

Fejlesztés alatt. A kész README (setup, deploy, curl példák, webhook formátum,
záró jegyzet) a munka végén kerül ide.

## Adatbázis

A séma a [`supabase/migrations/`](supabase/migrations/) mappában található.
A `leads` tábla RLS-sel védett, policy nélkül, és az `anon` / `authenticated`
szerepkörök tábla-szintű jogai vissza vannak vonva — így a tábla kizárólag a
`service_role` kulccsal (azaz az Edge Functionből) érhető el.

## Környezeti változók

Lásd [`.env.example`](.env.example). Valódi kulcs nem kerül a repóba.

| Változó | Kötelező | Leírás |
|---|---|---|
| `SUPABASE_URL` | igen | A projekt URL-je. Supabase-en automatikusan be van állítva. |
| `SUPABASE_SERVICE_ROLE_KEY` | igen | Service role kulcs, megkerüli az RLS-t. Supabase-en automatikusan be van állítva. |
| `ANTHROPIC_API_KEY` | igen | Az LLM besoroláshoz. |
| `ANTHROPIC_MODEL` | nem | Modell azonosító; alapértelmezett érték a kódban. |
| `WEBHOOK_URL` | nem | Sürgős lead értesítés. Ha nincs beállítva, az értesítés kimarad — a lead ettől még mentődik. |
| `LLM_TIMEOUT_MS` | nem | Alapértelmezett: `10000` |
| `WEBHOOK_TIMEOUT_MS` | nem | Alapértelmezett: `5000` |
| `DB_TIMEOUT_MS` | nem | Alapértelmezett: `5000` |
