# macOS SMS Bridge Admin

Lokální backend a admin UI pro odesílání servisních SMS a malých marketingových dávek přes Mac, aplikaci Zprávy a iPhone se SIM. Výchozí režim je `dry-run`, takže nic skutečně neodešle, dokud se výslovně nenastaví `SMS_BRIDGE_SENDER=messages`.

## Požadavky

- macOS s aplikací Zprávy.
- iPhone se SIM a zapnutým přeposíláním SMS na Mac.
- Stejný Apple účet na Macu a iPhonu.
- Node.js 20+.

## Spuštění

```bash
npm test
npm run server
```

Server běží na `http://127.0.0.1:8787`.

Admin UI je na `http://127.0.0.1:8787/admin`.

Výchozí přihlášení pro lokální vývoj:

- e-mail: `admin@example.local`
- heslo: `ChangeMe123!`

V produkci nastav:

```bash
SMS_BRIDGE_ADMIN_EMAIL='admin@firma.cz' \
SMS_BRIDGE_ADMIN_PASSWORD='dlouhe-silne-heslo' \
npm run server
```

## API Login

```bash
curl -s http://127.0.0.1:8787/api/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@example.local","password":"ChangeMe123!"}'
```

Vrácený `token` posílej v hlavičce:

```bash
TOKEN='<token-z-loginu>'
```

## Vložení zprávy

```bash
curl -s http://127.0.0.1:8787/api/messages \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"to":"+420777123456","text":"Test zprava","kind":"service"}'
```

Marketingová zpráva:

```bash
curl -s http://127.0.0.1:8787/api/messages \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"to":"+420777123456","text":"Akce dnes. STOP = odhlaseni","kind":"campaign"}'
```

Odeslání jednoho ticku:

```bash
npm run dispatch
```

Nebo přes API:

```bash
curl -s -X POST http://127.0.0.1:8787/api/dispatch \
  -H "authorization: Bearer $TOKEN"
```

## Backend funkce

- Multi-user model s rolemi `admin`, `operator`, `viewer`.
- Session login a bearer API tokeny.
- Kontakty s marketingovým souhlasem.
- Skupiny kontaktů.
- Šablony s proměnnými `{{name}}`, `{{phone}}`, `{{fields.city}}`.
- Kampaně, které frontují jen kontakty se souhlasem.
- Servisní a marketingová fronta s oddělenými limity.
- Blacklist a audit log.
- Statické admin UI bez build kroku.

## Skutečné odesílání přes Zprávy

Nejdřív ručně ověř, že z aplikace Zprávy na Macu odešleš SMS na stejné číslo. Pak spusť:

```bash
SMS_BRIDGE_SENDER=messages npm run dispatch
```

macOS si může vyžádat oprávnění pro Terminal/Node k ovládání aplikace Zprávy. Povolit v System Settings -> Privacy & Security -> Automation.

## Bezpečnostní poznámky

Marketing přes neomezenou SIM je provozně i smluvně rizikový. MVP proto odděluje `service` a `campaign`, nastavuje pomalejší limity pro kampaně a podporuje blacklist. Pro větší kampaně použij oficiální SMS službu.
