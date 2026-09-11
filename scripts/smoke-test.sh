#!/usr/bin/env bash
#
# End-to-end smoke test against a deployed lead-intake endpoint.
#
#   FUNCTION_URL=https://<ref>.supabase.co/functions/v1/lead-intake \
#     ./scripts/smoke-test.sh
#
# Optional: SUPABASE_URL + SUPABASE_ANON_KEY also run the RLS check that
# proves the leads table is unreachable with the anon key.

set -uo pipefail

: "${FUNCTION_URL:?Set FUNCTION_URL to the deployed endpoint}"

# Unique per run so the suite is repeatable without cleaning the table.
STAMP="$(date +%s)"
NORMAL_EMAIL="anna.kovacs+${STAMP}@example.com"
URGENT_EMAIL="tesztelo+${STAMP}@example.com"

pass=0
fail=0

call() {
  local title="$1" expected="$2" body="$3"
  local out status
  out="$(curl -s -w $'\n%{http_code}' -X POST "$FUNCTION_URL" \
    -H 'Content-Type: application/json' -d "$body")"
  status="${out##*$'\n'}"
  body="${out%$'\n'*}"

  printf '\n=== %s ===\n' "$title"
  printf 'várt: %s   kapott: %s\n' "$expected" "$status"
  printf '%s\n' "$body" | (python3 -m json.tool 2>/dev/null || cat)

  if [ "$status" = "$expected" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf '!!! ELTÉRÉS\n'
  fi
}

call "1. Érvényes kérés (201 várt)" 201 "$(cat <<JSON
{
  "name": "Kovács Anna",
  "email": "${NORMAL_EMAIL}",
  "company": "Acme Kft.",
  "message": "Szeretnék árajánlatot kérni egy céges weboldal fejlesztésére. Nem sürgős, a jövő hónapban indulna a projekt."
}
JSON
)"

call "2. Hibás kérés (400 várt)" 400 '{"name":"","email":"nem-email","company":42}'

call "3. Duplikált email (409 várt)" 409 "$(cat <<JSON
{
  "name": "Kovács Anna",
  "email": "${NORMAL_EMAIL}",
  "message": "Ugyanaz az email cím másodszor."
}
JSON
)"

call "4. Sürgős lead — webhookot indít (201 várt)" 201 "$(cat <<JSON
{
  "name": "Nagy Péter",
  "email": "${URGENT_EMAIL}",
  "company": "Példa Zrt.",
  "message": "Leállt az éles rendszerünk, egyetlen megrendelés sem megy át. Ma délutánig meg kellene oldani, nagyon sürgős!"
}
JSON
)"

printf '\n=== 5. Rossz metódus (405 várt) ===\n'
gstatus="$(curl -s -o /dev/null -w '%{http_code}' "$FUNCTION_URL")"
printf 'várt: 405   kapott: %s\n' "$gstatus"
if [ "$gstatus" = "405" ]; then pass=$((pass + 1)); else fail=$((fail + 1)); printf '!!! ELTÉRÉS\n'; fi

printf '\n=== 6. Érvénytelen JSON (400 várt) ===\n'
jstatus="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$FUNCTION_URL" \
  -H 'Content-Type: application/json' -d '{ez nem json}')"
printf 'várt: 400   kapott: %s\n' "$jstatus"
if [ "$jstatus" = "400" ]; then pass=$((pass + 1)); else fail=$((fail + 1)); printf '!!! ELTÉRÉS\n'; fi

if [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_ANON_KEY:-}" ]; then
  printf '\n=== 7. RLS: a leads tábla anon kulccsal nem olvasható ===\n'
  rls="$(curl -s -o /dev/null -w '%{http_code}' \
    "${SUPABASE_URL}/rest/v1/leads?select=*" \
    -H "apikey: ${SUPABASE_ANON_KEY}" -H "Authorization: Bearer ${SUPABASE_ANON_KEY}")"
  printf 'várt: 401/403/404   kapott: %s\n' "$rls"
  case "$rls" in
    401 | 403 | 404) pass=$((pass + 1)) ;;
    *) fail=$((fail + 1)); printf '!!! ELTÉRÉS - a tábla elérhető anon kulccsal\n' ;;
  esac
fi

printf '\n----------------------------------------\n'
printf 'Sikeres: %s   Sikertelen: %s\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
