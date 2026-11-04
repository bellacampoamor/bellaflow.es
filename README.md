# Bella Flow

Van inkoop tot factuur voor Bella Outdoor and Furnishing: inkoop, inkomende deelleveringen,
goederenontvangst op meerdere magazijnen, verkooporders, deelleveringen aan klanten en facturatie.

## Starten

```bash
npm install
npm run dev        # http://localhost:5173, met voorbeeldgegevens in de browser
npm test           # keten van inkoop tot factuur, plus het schema op echte Postgres
```

## Koppelen aan Supabase

1. Maak een Supabase-project en voer `supabase/migrations/` uit (`supabase db push`, of plak de SQL in de SQL Editor).
2. Optioneel voor een testomgeving: voer `supabase/seed.sql` uit. Dat zijn verzonnen gegevens.
3. Maak teamleden aan onder Authentication > Users. Zonder login is er geen toegang (Row Level Security).
4. Kopieer `.env.example` naar `.env` en zet:
   ```
   VITE_DATA_SOURCE=supabase
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   ```

Meer is niet nodig: schermen en bedrijfslogica blijven ongewijzigd.

## Opbouw

```
src/data/types.ts           Types, veldnamen gelijk aan de databasekolommen
src/data/driver.ts          Contract voor opslag: list, insert, update, remove, nextNumber
src/data/localDriver.ts     Opslag in de browser
src/data/supabaseDriver.ts  Opslag in Supabase
src/domain/calc.ts          Afgeleide gegevens: voorraad, orderstatus, bedragen
src/domain/services.ts      Alle handelingen, met hun controles
src/domain/demo.ts          Voorbeeldgegevens, opgebouwd via services
src/screens/                Eén bestand per processtap
supabase/migrations/        Databaseschema, rechten, nummering, factuurbewaking
```

Schermen praten alleen met `services` en `calc`, nooit rechtstreeks met de opslag.

## Afspraken in het model

- **Voorraad** is altijd de som van `stock_movements`. Er bestaat geen los voorraadgetal dat kan afwijken.
- **Vrij** per locatie is aanwezig min gereserveerd. Elke open orderregel reserveert op zijn magazijn.
- **Afhandeling per regel**: elke regel van een verkooporder wordt direct meegenomen, later uit voorraad geleverd, of op bestelling ingekocht. Meegenomen regels worden meteen afgeboekt en als deellevering gefactureerd.
- **Verkopers** staan onder Beheer; elke verkooporder moet er een hebben.
- **Twee flows**: Inkoop (inkooporders, gepland transport, ontvangst) en Verkoop (verkooporders, levering, facturatie) hebben elk een eigen menu-optie en procesbalk.
- **Doorzetten**: onder Inkoop staan alle regels op bestelling, gegroepeerd per verkooporder. Aangevinkte regels worden per leverancier één inkooporder.
- **Verkoop stuurt inkoop**: wat bij een bestelling niet vrij op voorraad is, wordt bij opslaan een regel op bestelling. De order toont wat nog ingekocht moet worden en maakt daar een inkooporder van. Wat er al is, kan als deellevering de deur uit.
- **Op bestelling**: de orderregel heeft geen magazijn tot de goederen binnen zijn. De ontvangst koppelt dat automatisch.
- **Prijzen** van verkoop zijn inclusief IVA, inkoopprijzen exclusief.
- **Deelleveringen** worden bij afmelden direct gefactureerd. Hele leveringen volgen de instelling onder Facturatie.
- **Afleverbon**: een bezorging moet eerst klaargezet en akkoord bevonden worden. Daarna volgt de bon, en bij afmelden de naam van wie tekende.
- **Route**: per dag voor het eigen team, heen en terug vanaf het magazijn dat onder Beheer als vertrekpunt staat. Tot 9 stops de gegarandeerd kortste rit.
- **Transport**: een inkooporder is altijd volledig ingekocht. In stap 2 wordt elke regel aan een transport gekoppeld (technisch: één rij in `inbound_shipments` per regel). De verwachte ontvangstdatum volgt uit het transport en staat op de verkooporder. Elke inkooporder heeft een label: Showroom, Magazijn of Verkoop. De bestemming kan per regel wijzigen tot hij binnen is.
- **Ontvangst** gebeurt per transport en kan regels van meerdere inkooporders bevatten. De signaallijst toont per regel de inkooporder naast de gekoppelde verkooporder, klant en plaats.
- **Verhuizen**: alleen vrije voorraad kan naar een andere locatie, gereserveerde klantartikelen niet.
- **Taal**: het scherm is Nederlands of Engels (`src/i18n.en.ts`). Afleverbon, factuur en klantberichten volgen de taal van de klant. Eerder opgeslagen geschiedenisregels blijven in hun oorspronkelijke taal.
- **Facturen** zijn onwijzigbaar en kunnen niet worden teruggedateerd. De database dwingt dat ook zelf af.
- **Voorvoegsels** van documentnummers staan onder Beheer. De teller blijft doorlopen.
- **Nummers** komen in Supabase uit `next_number()`, zodat twee gebruikers nooit hetzelfde nummer krijgen.

## Bekende grenzen

- Een handeling bestaat uit meerdere losse schrijfacties. Controles lopen vooraf, maar er is nog geen databasetransactie.
  Bij meerdere gelijktijdige gebruikers is de volgende stap: `receiveGoods`, `markDelivered` en `createInvoice` als Postgres-functies.
- De app laadt alle tabellen in één keer. Dat past bij een winkel, maar vraagt om filters zodra er jaren aan data staan.
- Adressen en rijtijden lopen nu via openbare diensten (Nominatim, OSRM) die niet voor productie bedoeld zijn. Vervang `src/data/geo.ts` door bijvoorbeeld Google Maps Platform voor live gebruik.
- Creditfacturen, retouren en aanbetalingsfacturen ontbreken nog.

## Mail van de getekende afleverbon

De browserversie met voorbeeldgegevens verstuurt nooit mail. Voor echte mail op Supabase:

1. `supabase functions deploy send-email`
2. `supabase secrets set RESEND_API_KEY=...`
3. Verifieer het domein van het winkeladres (Beheer) in Resend.
