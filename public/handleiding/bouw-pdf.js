// Bella Flow gebruikershandleiding (PDF), bron. Opdracht Rick 17 november 2026.
// Gebruik in de browser op bellaflow.es/demo/: laad dit script en roep `await bellaFlowHandleiding.bouw()` aan;
// dat geeft een PDF-blob. De schermafdrukken komen uit Cloudinary (map bellaflow-handleiding, verzonnen
// demogegevens) en uit help/ in deze site. Inhoud gelijk aan de hulp per scherm (src/domain/helpContent.ts).
(function () {
  const CLD = 'https://res.cloudinary.com/uhdvgzei/image/upload'
  const F = [220, 0, 1090, 730]
  const shot = (id, c = F) => `${CLD}/c_crop,x_${c[0]},y_${c[1]},w_${c[2]},h_${c[3]}/v1/bellaflow-handleiding/${id}.jpg`
  const m = (n, b, t, sub) => ({ n, mark: true, b, t, sub })

  const C = [
    { t: 'h1', num: 'i', title: 'Inhoud', sub: 'De hoofdstukken volgen het hoofdmenu van links naar rechts.' },
    { t: 'table', w: [.12, .48, .40], head: ['Nr.', 'Hoofdstuk', 'Wat leer je'], rows: [
      ['1', 'Zo werkt deze handleiding', 'Hoe je de nummers en schermafdrukken leest'],
      ['2', 'Inloggen en het hoofdmenu', 'Inloggen, waar alles staat, hulp met F1'],
      ['3', 'Overzicht', 'Wat er vandaag te doen is'],
      ['4', 'Kassa', 'Verkopen in de winkel, retour aan de kassa'],
      ['5', 'Verkoop', 'Verkooporder, door naar inkoop, levering, factuur, creditfactuur'],
      ['6', 'Inkoop', 'Inkooporder, afdrukken en versturen, transport, ontvangst'],
      ['7', 'Voorraad', 'Wat ligt waar, verhuizen'],
      ['8', 'Zoeken', 'Alles terugvinden'],
      ['9', 'Taal, nachtstand, hulp en support', 'De knoppen rechts in het menu'],
      ['10', 'Beheer', 'Rapportage, dagafsluiting, catalogi, instellingen'],
      ['A', 'Addendum: de techniek', 'Hoe Bella Flow is gebouwd']] },

    { t: 'h1', num: 1, title: 'Zo werkt deze handleiding', sub: 'Voor wie Bella Flow voor het eerst gebruikt.' },
    { t: 'p', text: 'Bella Flow is het systeem van Bella Outdoor & Furnishing van inkoop tot factuur. Je hoeft niets te weten van computers. We lopen het hoofdmenu af van links naar rechts, precies zoals je het op je scherm ziet. Waar het werk doorloopt naar een ander deel van Bella Flow, lopen we gewoon mee: een verkooporder leidt tot inkoop, inkoop tot ontvangst, en ontvangst weer tot de levering aan de klant.' },
    { t: 'h3', text: 'Elk scherm wordt op dezelfde manier uitgelegd' },
    { t: 'steps', items: [{ b: 'Waarvoor?', t: 'In één zin waar het scherm voor is.' }, { b: 'Schermafdruk', t: 'met genummerde koperen rondjes op de plekken waar je iets doet.' }, { b: 'Stap voor stap', t: 'wat je invult of aanklikt, met dezelfde nummers als op de schermafdruk.' }, { b: 'Let op', t: 'dingen die vaak misgaan.' }] },
    { t: 'p', text: 'Zo ziet een nummer op een schermafdruk eruit, en zo komt het terug in de tekst:' },
    { t: 'steps', items: [m(1, 'Koperen rondje met een kader:', 'hier vul je iets in of klik je.')] },
    { t: 'tip', items: ['Dezelfde uitleg staat ook in Bella Flow zelf: druk op F1 en rechts verschijnt de hulp bij het scherm waar je bent.'] },
    { t: 'h3', text: 'Vaste woorden' },
    { t: 'table', w: [.28, .72], head: ['Woord', 'Betekenis'], rows: [
      ['Verkooporder', 'Wat een klant bij ons koopt (nummer VO-...).'],
      ['Inkooporder', 'Wat wij bij een leverancier bestellen (nummer IO-...). Een proforma-inkooporder heet PIO-...'],
      ['Kassabon', 'De bon van een verkoop aan de kassa, waarbij de klant alles meteen meeneemt en betaalt.'],
      ['Proforma (PF)', 'Staat klaar om te factureren na een levering. Nog geen factuur.'],
      ['Artikelnummer', 'Ons eigen nummer, bijvoorbeeld HAC-TAF-0000002106. Het staat ook als streepjescode op het prijsetiket.'],
      ['Locaties', 'Showroom Campoamor, Magazijn Campoamor en Magazijn Almoradí.']] },
    { t: 'tip', items: ['Een regel in een lijst selecteer je door op de regel te klikken. Er zijn geen vinkjes.', 'In een getalveld mag je een komma of een punt typen; allebei is goed. Je mag het veld ook helemaal leegmaken.'] },

    { t: 'h1', num: 2, title: 'Inloggen en het hoofdmenu', sub: 'Bella Flow werkt in de browser: Chrome of Edge, op bellaflow.es.' },
    { t: 'h2', text: 'Inloggen' },
    { t: 'img', key: 'login', src: 'help/inloggen.jpg', width: 92, cap: 'Het inlogscherm. Het e-mailadres is op deze afbeelding onleesbaar gemaakt.' },
    { t: 'steps', items: [
      m(1, 'E-mailadres:', 'typ het adres waarmee je als medewerker bent vastgelegd onder Instellingen > Medewerkers.'),
      m(2, 'Wachtwoord:', 'typ je eigen wachtwoord.'),
      m(3, 'Oogje:', 'laat zien wat je hebt getypt, om tikfouten te zien.'),
      m(4, 'Inloggen:', 'klik op de knop of druk op Enter.'),
      m(5, 'Wachtwoord vergeten?', 'Klik erop: je krijgt een mail met een link om een nieuw wachtwoord in te stellen.')] },
    { t: 'note', text: 'Zie je "nog geen medewerker met toegang", dan ben je nog niet als actieve medewerker vastgelegd. Vraag de beheerder.' },
    { t: 'h2', text: 'Het hoofdmenu' },
    { t: 'img', key: 'menu', src: shot('01-menu', [220, 0, 1090, 80]), cap: 'Het hoofdmenu, van links naar rechts.' },
    { t: 'steps', items: [
      m(1, 'Overzicht:', 'je startpagina met wat er vandaag te doen is.'),
      m(2, 'Kassa:', 'snel verkopen in de winkel.'),
      m(3, 'Verkoop:', 'verkooporders, levering aan de klant en facturatie.'),
      m(4, 'Inkoop:', 'inkooporders, gepland transport en ontvangst.'),
      m(5, 'Voorraad:', 'wat ligt waar, en verhuizen.'),
      m(6, 'Zoeken:', 'alles terugvinden. Ook met Ctrl+K of de toets /.'),
      m(7, 'Vlaggetjes:', 'schermtaal Nederlands, Engels of Spaans.'),
      m(8, 'Nachtstand:', 'donker of licht scherm.'),
      m(9, 'Headset:', 'contact en support.'),
      m(10, 'Beheer:', 'Rapportage, Kassa (beheer), Catalogi en Instellingen.')] },
    { t: 'p', text: 'Sinds deze afdruk staan in het menu ook de knop Hulp (F1, naast de headset) en, op bellaflow.es, Uitloggen.' },
    { t: 'tip', text: 'Het menu blijft bovenin staan als je naar beneden scrolt. Linksboven op elk detailscherm staat een terugknop met de naam van het scherm waar je vandaan kwam, bijvoorbeeld "< Verkooporders".' },

    { t: 'h1', num: 3, title: 'Overzicht', sub: 'Je startpagina.' },
    { t: 'why', text: 'In één oogopslag zien wat er vandaag moet gebeuren.' },
    { t: 'img', key: 'ovz', src: shot('03-overzicht'), cap: 'Overzicht met de vijf onderdelen.' },
    { t: 'steps', items: [
      m(1, 'Tegels "nu te doen":', 'elke tegel telt iets dat aandacht vraagt. Rood betekent te laat. Klik op een tegel en je staat meteen in de juiste lijst.'),
      m(2, 'Geld:', 'gefactureerd deze maand, afgeleverd maar nog niet gefactureerd, open op facturen, en vooruitbetaald.'),
      m(3, 'Verkoop:', 'de bezorgplanning van de komende 7 dagen.'),
      m(4, 'Inkoop:', 'binnenkomende transporten en wat nog ingekocht moet worden.'),
      m(5, 'Snelknoppen:', 'Inkooporder en Nieuwe verkooporder.')] },

    { t: 'h1', num: 4, title: 'Kassa', sub: 'Een klant in de winkel neemt iets direct mee en betaalt meteen.' },
    { t: 'why', text: 'Een verkoop in de winkel afrekenen. Je maakt een kassabon (eenvoudige factuur). Er komt geen verkooporder bij kijken.' },
    { t: 'p', text: 'De eerste keer vraagt de kassa: "Wie staat er achter de kassa?" Klik op je naam. De browser onthoudt dat.' },
    { t: 'img', key: 'kassa', src: shot('04-kassa-v2', [268, 64, 980, 666]), cap: 'De kassa met één artikel op de bon. Voor dit artikel van Bella is Bon voor op Bella gezet.' },
    { t: 'h2', text: 'Een verkoop afrekenen' },
    { t: 'steps', items: [
      m(1, 'Medewerker:', 'staat hier je eigen naam? Zo niet, kies jezelf.'),
      m(2, 'Bon voor:', 'staat standaard op HomeDecoBali, ook na elke verkoop. Verkoop je een artikel van Bella, klik dan eerst op Bella Outdoor & Furniture.'),
      m(3, 'Scan het etiket', 'met de handscanner. Het artikel komt als regel op de bon. Geen scanner? Gebruik het zoekveld eronder: artikelnummer, nummer van de leverancier, EAN of een deel van de naam. Iets zonder eigen nummer? Klik op Diversen en typ zelf omschrijving, prijs en IVA.'),
      m(4, 'De regel:', 'pas zo nodig het aantal (met - en +), de prijs incl. IVA of de korting % aan.'),
      m(5, 'Pin of Contant:', 'kies hoe de klant betaalt. Bij contant typ je het ontvangen bedrag en zie je het wisselgeld.'),
      m(6, 'Klant en mailen:', 'leeg laten mag tot € 1.000. Wil de klant de bon per mail, vul het adres in bij Factuur mailen naar.'),
      m(7, 'Afrekenen:', 'klik op de grote knop. De kassabon wordt gemaakt, het artikel gaat uit de voorraad van de showroom en de betaling is geboekt.'),
      m(8, 'RETOUR:', 'retour of correctie op een eerdere kassabon, zie hieronder.')] },
    { t: 'note', items: ['Hoor je een foutpiep, dan hoort het artikel bij het andere bedrijf. Een HomeDecoBali-artikel kan alleen op een bon van HomeDecoBali, en andersom.', 'Boven € 1.000 zijn naam, adres, woonplaats en NIE of paspoortnummer van de klant verplicht. De kassa laat zien wat ontbreekt.', 'Een gele melding "0 vrij in de winkel" is geen probleem: het verschil wordt bij afrekenen bijgeboekt.', 'Een kassaverkoop staat niet bij Verkooporders of Levering. Je vindt de bon onder Facturatie, Zoeken en Beheer > Kassa.'] },
    { t: 'h2', text: 'Retour of correctie (knop RETOUR)' },
    { t: 'p', text: 'Een kassabon kan niet worden gewijzigd. Een retour wordt een creditfactuur op de oorspronkelijke bon, van hetzelfde bedrijf.' },
    { t: 'img', key: 'kret', src: shot('04-kassa-retour-v2', [530, 20, 462, 480]), width: 110, cap: 'Venster Retour of correctie, na een klik op RETOUR (8 op de vorige afbeelding).' },
    { t: 'steps', items: [
      { t: 'Klik rechtsboven op de rode knop RETOUR.' },
      m(1, 'Factuurnummer:', 'scan of typ het nummer van de kassabon en klik op Zoeken.'),
      m(2, 'Of kies een recente kassabon', 'uit de lijst door erop te klikken.'),
      { t: 'Klik op de regels die terugkomen, vul het aantal in en kies waar het artikel terug in voorraad gaat (meestal Showroom Campoamor).' },
      { t: 'Vul de reden in, kies Contant of Pin voor het terugbetalen en bevestig. De creditbon telt mee in de dagafsluiting.' }] },
    { t: 'tip', text: 'Aan het eind van de dag sluit je de kassa af onder Beheer > Kassa > Dagafsluiting. Zie hoofdstuk 10.' },

    { t: 'h1', num: 5, title: 'Verkoop', sub: 'Van verkooporder tot factuur. De verkooporder stuurt alles wat daarna komt.' },
    { t: 'why', text: 'Alles wat een klant koopt en niet direct aan de kassa meeneemt, loopt via een verkooporder.' },
    { t: 'p', text: 'Elke verkooporder gaat van links naar rechts door zes fasen:' },
    { t: 'flow', items: ['1 Proforma', '2 Verkooporder', '3 Voorraad of inkoop', '4 Planning levering', '5 Afleveren', '6 Factureren'] },
    { t: 'h2', text: '5.1  De lijst Verkooporders' },
    { t: 'img', key: 'vo', src: shot('05-verkooporders'), cap: 'Verkoop: elke verkooporder als spoor door de zes fasen.' },
    { t: 'steps', items: [
      m(1, 'Tabbladen:', 'Opvolgen (wat aandacht vraagt, te laat bovenaan), Loopt, Afgerond en Alles.'),
      m(2, 'Fasekoppen 1 tot 6:', 'klik op een kop om alleen de verkooporders in die fase te zien.'),
      m(3, 'Spoor:', 'hoe ver de verkooporder is. Groen is klaar, koper vraagt actie, rood is te laat, blauw loopt.'),
      m(4, 'Volgende stap:', 'wat er nu moet gebeuren. Klik erop en je staat op de goede plek.'),
      m(5, 'PDF:', 'drukt de verkooporder direct af, met prijzen.'),
      m(6, 'Zoeken', 'op nummer of klant.'),
      m(7, 'Nieuwe verkooporder.', ''),
      m(8, 'Levering en Facturatie:', 'snel naar stap 5 en 6, met het aantal dat wacht.')] },
    { t: 'h2', text: '5.2  Een nieuwe verkooporder maken' },
    { t: 'img', key: 'nvo', src: shot('05-nieuwe-verkooporder'), cap: 'Nieuwe verkooporder met één product op bestelling.' },
    { t: 'steps', items: [
      m(1, 'Klant:', 'typ een deel van de naam, het telefoonnummer of het e-mailadres en klik op de klant. Nieuw? Klik op + Nieuwe klant. Kies daarnaast bij Verkocht via: Winkel, Online, Telefoon of e-mail, of Beurs.'),
      m(2, 'Verkoper (verplicht):', 'kies jezelf. De verkoopdatum staat al op vandaag.'),
      m(3, 'Zoeken in:', 'in welke catalogi je zoekt. Alles, of per leverancier aan en uit. Bella Flow onthoudt je keuze.'),
      m(4, '+ Product toevoegen:', 'maakt een nieuwe regel.'),
      m(5, 'Product:', 'typ een deel van de naam, ons artikelnummer, het nummer van de leverancier of de EAN, en klik op het juiste artikel. Bij Uitvoering typ je zo nodig stof, kleur of afwerking.'),
      m(11, 'Aantal.', ''),
      m(6, 'Prijs incl. IVA en Korting %:', 'de prijs staat al klaar; pas hem alleen aan als het nodig is.'),
      m(7, 'Afhandeling:', 'kies per regel wat er gebeurt.', [{ b: 'Klant neemt direct mee:', t: 'de klant neemt het nu mee.' }, { b: 'Uit voorraad, later leveren:', t: 'het ligt op voorraad en wordt later geleverd. Kies dan ook Uit magazijn.' }, { b: 'Op bestelling:', t: 'het moet nog ingekocht worden (zie 5.3).' }]),
      m(8, 'Elementen:', 'hoort er iets bij het artikel, zoals een hoes of een kussen? Klik hier en voeg het toe als extra regel.'),
      m(9, 'Vooruitbetaling:', 'betaalt de klant een aanbetaling? Klik op 30%, 50% of Alles, of typ een bedrag, en kies de betaalwijze.'),
      m(10, 'Verkooporder aanmaken:', 'klik pas als alles klopt.')] },
    { t: 'p', text: 'Onder de producten staat het blok Levering: kies de Afleverwijze (Klant haalt later op, Bezorgen door eigen team of Verzenden met vervoerder), de gewenste en beloofde leverdatum en het afleveradres.' },
    { t: 'note', items: ['Voorbeeld: de klant wil 10 stoelen en er liggen er 6 vrij. Dan worden het 6 uit voorraad en 4 op bestelling. Die 4 gaan vanzelf naar de inkoop.', 'Staan alle regels op "Klant neemt direct mee", dan heet de knop Afrekenen, factureren en meegeven. De factuur wordt dan meteen gemaakt en gemaild. Een snelle verkoop zonder klantgegevens doe je liever aan de Kassa.'] },
    { t: 'h2', text: '5.3  Van verkooporder naar inkoop' },
    { t: 'p', text: 'Staat een regel op bestelling, dan maakt Bella Flow vanzelf een proforma-inkooporder (PIO) voor die verkooporder, per leverancier. Die zet je om naar een echte inkooporder:' },
    { t: 'steps', items: [{ t: 'Open de verkooporder. De volgende stap is Inkooporder maken. Klik erop.' }, { t: 'Je komt op de proforma-inkooporder, met het venster Omzetten naar inkooporder al open.' }, { t: 'Controleer en klik op Inkooporder aanmaken. Hoe dat precies gaat, staat in 6.2.' }] },
    { t: 'tip', text: 'Vanaf hier loopt het werk door in hoofdstuk 6, Inkoop: de goederen worden in Nederland klaargezet, met een transport naar Spanje gereden en hier ingeboekt. Daarna kom je terug bij 5.4 om de levering te plannen.' },
    { t: 'h2', text: '5.4  Levering aan klant (stap 5)' },
    { t: 'why', text: 'De levering plannen, klaarzetten, afleveren en afmelden. Welke verkooporders je nu kunt leveren, zie je onder Beheer > Rapportage > Leverbaar.' },
    { t: 'p', text: 'Een levering plan je vanaf de verkooporder met de knop Levering plannen. Wil je maar een deel leveren, verlaag dan de aantallen; wat overblijft plan je later. Daarna staat de levering in deze planning:' },
    { t: 'img', key: 'lev', src: shot('05-levering'), cap: 'Levering aan klant: de planning per dag, één levering geselecteerd.' },
    { t: 'steps', items: [
      m(1, 'Planning en Afgerond:', 'wat nog moet en wat al geleverd is.'),
      m(2, 'Alles selecteren:', 'selecteert alle leveringen van die dag.'),
      m(3, 'Bezorgroute:', 'per dag één route, heen en terug vanaf Magazijn Campoamor. Klik op Beste route berekenen voor de beste volgorde, of open hem in Google Maps.'),
      m(4, 'Volgorde:', 'met de pijltjes, of sleep de stop omhoog of omlaag.'),
      m(5, 'Knoppen per levering:', 'Verschuiven (andere dag), Afleverbon, Onderweg en Afmelden als geleverd.'),
      m(6, 'Geselecteerd:', 'klik op een levering om hem te selecteren. Hij kleurt koper met een vinkje.'),
      m(7, 'Klaarzetten:', 'klik onderaan op Klaarzetten. Controleer in het venster per levering de artikelen en vul één keer in wie akkoord heeft bevonden.')] },
    { t: 'h3', text: 'Afleveren met een papieren bon' },
    { t: 'steps', items: [{ t: 'Druk de afleverbon af met de knop Afleverbon. Er staan geen prijzen op.' }, { t: 'De klant tekent de bon bij ontvangst.' }, { t: 'Klik op kantoor op Afmelden als geleverd.' }] },
    { t: 'h3', text: 'Afleveren met de digitale bon (chauffeursapp)' },
    { t: 'steps', items: [{ t: 'De chauffeur opent app.bellaflow.es op zijn telefoon en ziet de klaargezette route van vandaag.' }, { t: 'Bij de klant opent hij de bezorging; de klant ziet de digitale afleverbon.' }, { t: 'De klant tekent in het tekenvlak.' }, { t: 'De chauffeur klikt op Bevestigen. De levering is afgemeld en de klant krijgt de getekende bon per mail.' }] },
    { t: 'note', text: 'Een getekende bon is afgesloten en kan niet opnieuw getekend worden. Een levering die niet is klaargezet, ziet de chauffeur niet.' },
    { t: 'h2', text: '5.5  Facturatie (stap 6)' },
    { t: 'why', text: 'Van de proforma een factuur maken. Afmelden maakt nog geen factuur: elke afgemelde levering krijgt eerst een proforma (PF).' },
    { t: 'img', key: 'fac', src: shot('05-facturatie', [228, 64, 1080, 410]), cap: 'Facturatie: een proforma geselecteerd, klaar om te factureren.' },
    { t: 'steps', items: [
      m(1, 'Proforma:', "klik op de proforma's die je wilt factureren."),
      m(5, 'Alles selecteren', '(of Niets selecteren) voor de hele lijst.'),
      m(2, 'Factureren:', 'klik en bevestig de factuurdatum. Per proforma ontstaat één factuur. Vooruitbetalingen worden vanzelf verrekend.'),
      m(3, 'Openstaand en Alle facturen:', 'wat nog betaald moet worden, en alles.'),
      m(4, 'PDF:', 'opent de factuur. Daar vind je Afdrukken of PDF, Mailen, Betaling registreren en Crediteren of retour.')] },
    { t: 'note', text: 'Een factuur is definitief. Je kunt hem niet wijzigen en niet terugdateren. Een fout, retour of korting achteraf los je op met een creditfactuur.' },
    { t: 'h2', text: '5.6  Crediteren of retour' },
    { t: 'img', key: 'cred', src: shot('05-credit'), cap: 'Creditfactuur op F-2026-0002: twee parasols komen retour.' },
    { t: 'steps', items: [
      { t: 'Open de factuur en klik op Crediteren of retour.' },
      m(1, 'Regel:', 'klik op de regels die je crediteert.'),
      m(2, 'Crediteren:', 'het aantal. Nooit meer dan gefactureerd.'),
      m(3, 'Retour in voorraad:', 'komt het artikel terug, kies de locatie. Anders kies je Geen retour.'),
      m(4, 'Bedrag zonder artikel:', 'voor een korting achteraf of schade.'),
      m(5, 'Reden:', 'verplicht. Hij komt op de creditfactuur.'),
      m(6, 'Snelknoppen voor de reden:', 'Retour, Fout in de factuur, Korting achteraf of Schade.'),
      m(7, 'Bedragen:', 'eerst verrekend met wat op de factuur nog openstaat. Wat overblijft betaal je terug, nu of later.')] },

    { t: 'h1', num: 6, title: 'Inkoop', sub: 'Van bestelling bij de leverancier tot de goederen hier in een van onze locaties liggen.' },
    { t: 'why', text: 'Inkopen voor een klant (vanuit een verkooporder) of voor de showroom of het magazijn.' },
    { t: 'flow', items: ['1 Proforma', '2 Inkooporder', '3 Ontvangen in NL', '4 Transport', '5 Ontvangst in Spanje', '6 Aflevering'] },
    { t: 'p', text: 'Bij een leverancier in Spanje vallen Ontvangen in NL en Transport weg (zie 6.6).' },
    { t: 'h2', text: '6.1  De lijst Inkooporders' },
    { t: 'img', key: 'io', src: shot('06-inkooporders'), cap: "Inkoop: proforma's en inkooporders in één lijst." },
    { t: 'steps', items: [
      m(1, 'Tabbladen:', 'Opvolgen, Loopt, Afgerond en Alles.'),
      m(2, 'Fasekoppen 1 tot 6:', 'klik om te filteren op een fase.'),
      m(3, 'Inkooporder:', 'nummer, label (Showroom, Magazijn of Verkoop), leverancier en datum.'),
      m(4, 'Volgende stap:', 'klik erop en je staat op de goede plek.'),
      m(5, 'Een proforma (PIO):', 'moet nog omgezet worden naar een inkooporder.'),
      m(6, 'Gepland transport, Ontvangst, Afdrukken en versturen:', 'de andere stappen van de inkoop.'),
      m(7, 'Nieuwe inkooporder:', 'voor de showroom of het magazijn.')] },
    { t: 'h2', text: '6.2  Een proforma omzetten naar een inkooporder' },
    { t: 'p', text: 'Klik bij de proforma op Omzetten naar inkooporder. Elke proforma hoort bij één verkooporder en wordt een eigen inkooporder, nooit samengevoegd.' },
    { t: 'img', key: 'pro', src: shot('06-proforma', [416, 20, 704, 296]), width: 130, cap: 'Venster Omzetten naar inkooporder.' },
    { t: 'steps', items: [
      m(1, 'Controleer', 'de proforma, de leverancier, de verkooporder en de waarde.'),
      m(2, 'Besteldatum:', 'staat op vandaag.'),
      m(3, 'Referentie leverancier:', 'het ordernummer bij de leverancier, als je dat hebt.'),
      m(4, 'Inkooporder aanmaken.', 'De inkooporder is altijd volledig ingekocht.')] },
    { t: 'h3', text: 'Inkoop voor showroom of magazijn' },
    { t: 'steps', items: [{ t: 'Klik op Nieuwe inkooporder en kies de leverancier.' }, { t: 'Kies het label Showroom of Magazijn. Het label bepaalt later het voorstel van de locatie bij het inboeken.' }, { t: 'Voeg de artikelen toe, vul de aantallen in en sla op.' }] },
    { t: 'h3', text: 'Afdrukken en versturen' },
    { t: 'why', text: 'Inkooporders van één dag afdrukken of per leverancier naar de leverancier sturen. Klik in de lijst Inkooporders op Afdrukken en versturen.' },
    { t: 'img', key: 'afv', src: shot('06-afdrukken-versturen', [228, 64, 1080, 380]), cap: 'Afdrukken en versturen, besteldatum 3 november.' },
    { t: 'steps', items: [
      m(1, 'Dag:', 'kies de besteldatum, of blader met de pijltjes. Vandaag springt terug naar vandaag.'),
      m(2, 'Leverancier:', 'de inkooporders staan per leverancier, met het e-mailadres en de naam van het bestand dat wordt verstuurd. Staat er "geen e-mailadres", vul dat dan eerst in bij Instellingen > Leveranciers.'),
      m(3, 'Inkooporder:', 'klik op de regel om hem te selecteren. Hij kleurt koper met een vinkje.'),
      m(4, 'Verstuurd:', 'Nog niet verstuurd, of wanneer hij is verstuurd.'),
      m(5, 'Afdrukken als PDF:', 'één PDF, elke inkooporder op een eigen pagina.'),
      m(6, 'JSON downloaden:', 'het bestand voor de leverancier op je eigen computer.'),
      m(7, 'Versturen:', 'mailt per leverancier één bestand. Dat wordt op de inkooporder vastgelegd onder Verstuurd.'),
      m(8, 'Alles of Niets selecteren', 'voor de hele dag.')] },
    { t: 'note', text: "Proforma's en geannuleerde inkooporders worden niet verstuurd." },
    { t: 'h2', text: '6.3  Gepland transport' },
    { t: 'why', text: 'Registreren wat in Nederland klaarstaat en het op een vrachtwagen naar Spanje zetten. Hier maak je geen inkooporders.' },
    { t: 'img', key: 'tr', src: shot('06-gepland-transport'), cap: 'Gepland transport: een regel geselecteerd om Ontvangen in NL te melden.' },
    { t: 'steps', items: [
      m(1, 'Inplannen en Afgerond.', ''),
      m(2, 'Besteld, nog bij de leverancier:', 'staat een regel klaar in Nederland, klik erop om hem te selecteren.'),
      m(3, 'Ontvangen in NL:', 'kies de datum en klik op de knop. Pas daarna kan de regel op een transport.'),
      m(4, 'Klaar in NL, nog niet op transport:', 'selecteer de regels en zet ze op een transport. Bella Flow telt het volume en laat zien of het transport vol genoeg is.'),
      m(5, 'Het transport:', 'met vertrek, aankomst, vervoerder en hoeveel m³ nog vrij is. Hier klik je ook op Ontvangen als de vrachtwagen er is.'),
      m(6, 'Nieuw transport.', '')] },
    { t: 'tip', text: 'Zodra een regel op een transport staat, ziet de verkoper op de verkooporder per artikel wanneer het verwacht wordt.' },
    { t: 'h2', text: '6.4  Ontvangst' },
    { t: 'why', text: 'De vrachtwagen is er: je boekt in wat er werkelijk is aangekomen.' },
    { t: 'img', key: 'ont', src: shot('06-ontvangst'), cap: 'Ontvangst van een transport, met de signaallijst.' },
    { t: 'steps', items: [
      m(1, 'Transport:', 'kies het transport dat binnenkomt.'),
      m(2, 'Goederenontvangst:', 'per regel wat er verwacht wordt. Een regel met "Voor VO-..." is al verkocht.'),
      m(3, 'Locatie:', 'kies per regel waar het komt te staan. Het voorstel: Showroom Campoamor bij label Showroom, anders Magazijn Campoamor.'),
      m(4, 'Ontvangen/Geteld:', 'tel wat er staat en vul het in. Wat ontbreekt blijft openstaan.'),
      m(5, 'Signaallijst:', 'voor welke klant elke regel bestemd is.'),
      m(6, 'Goederen inboeken.', 'De ontvangstdatum is vandaag.')] },
    { t: 'tip', text: 'Na het inboeken opent vanzelf Leverbaar: welke verkooporders je nu kunt leveren. Ga dan verder bij 5.4, Levering aan klant.' },
    { t: 'h2', text: '6.5  Verhuizen na ontvangst' },
    { t: 'p', text: 'Staat iets op de verkeerde plek? Verhuis vrije voorraad later via Voorraad (hoofdstuk 7).' },
    { t: 'h2', text: '6.6  Een leverancier in Spanje' },
    { t: 'bullets', items: ['De leverancier levert met eigen vervoer bij ons af. Er is geen Ontvangen in NL en geen transport.', 'Je boekt in onder Ontvangst, in het blok Rechtstreeks van leveranciers in Spanje: kies de inkooporder en boek in zoals in 6.4.', 'De verwachte datum is de besteldatum plus de levertijd van de leverancier.'] },

    { t: 'h1', num: 7, title: 'Voorraad', sub: 'Wat ligt waar, en wat daarvan vrij is.' },
    { t: 'why', text: 'Zien wat er per locatie ligt, en vrije voorraad verplaatsen.' },
    { t: 'img', key: 'vr', src: shot('07-voorraad'), cap: 'Voorraadstand per locatie.' },
    { t: 'steps', items: [
      m(1, 'Voorraadstand en Mutaties:', 'onder Mutaties staat elke beweging (ontvangst, levering, verhuizing, correctie, retour) met het nummer van het document.'),
      m(2, 'Zoeken', 'op product of artikelnummer.'),
      m(3, 'Kolommen:', 'Showroom Campoamor, Magazijn Campoamor, Magazijn Almoradí en Totaal vrij.'),
      m(4, 'Vrij en gereserveerd:', 'vrij kun je verkopen; gereserveerd is al van een klant.'),
      m(5, 'Verhuizen:', 'kies van welke locatie naar welke, en hoeveel. De voorraad is direct verplaatst.'),
      m(6, 'Correctie en Verhuizen:', 'de algemene knoppen. Een correctie gebruik je alleen na tellen.'),
      m(7, 'Onder minimum:', 'er ligt minder dan het afgesproken minimum.')] },
    { t: 'note', text: 'Alleen vrije voorraad kan verhuizen. De voorraad is altijd de optelsom van de mutaties; niemand kan een aantal zomaar overschrijven.' },

    { t: 'h1', num: 8, title: 'Zoeken', sub: 'Alles terugvinden zonder te weten waar het staat.' },
    { t: 'img', key: 'zk', src: shot('08-zoeken', [412, 20, 698, 316]), width: 130, cap: 'Zoeken op "bakker".' },
    { t: 'steps', items: [
      { t: 'Klik op Zoeken in het menu, of druk Ctrl+K (Mac: Cmd+K) of de toets /.' },
      m(1, 'Zoekveld:', 'typ minstens twee tekens: een nummer, een naam, een plaats of een artikel.'),
      m(2, 'Resultaten per soort:', 'klanten, verkooporders, facturen, inkooporders, afleverbonnen, transporten en artikelen.'),
      m(3, 'Kies', 'met de pijltjes en Enter, of klik.')] },
    { t: 'tip', text: 'Accenten en streepjes maken niet uit. Een kassaverkoop vind je als factuur.' },

    { t: 'h1', num: 9, inline: true, title: 'Taal, nachtstand, hulp en support', sub: 'De knoppen rechts in het menu.' },
    { t: 'bullets', items: [
      { b: 'Vlaggetjes:', t: 'de schermtaal: Nederlands, Engels of Spaans. Documenten en mails aan de klant volgen hun eigen taal.' },
      { b: 'Nachtstand:', t: 'een donker scherm, rustiger voor de ogen in een donkere ruimte. Klik nog een keer voor de dagstand.' },
      { b: 'Hulp (F1):', t: 'rechts schuift de uitleg van het scherm waar je bent in, met dezelfde schermafdrukken als in deze handleiding. Het werkvlak wordt dan smaller. Druk nog een keer op F1 of klik op het kruisje om te sluiten.' },
      { b: 'Headset:', t: 'wie Bella Flow maakt en hoe je contact opneemt: support@bellaflow.es.' }] },

    { t: 'h1', num: 10, title: 'Beheer', sub: 'Het uitklapmenu rechts: Rapportage, Kassa, Catalogi en Instellingen.' },
    { t: 'h2', text: '10.1  Rapportage' },
    { t: 'img', key: 'rap', src: shot('10-rapportage', [228, 64, 1080, 430]), cap: 'Rapportage, tabblad Leverbaar.' },
    { t: 'steps', items: [
      m(1, 'Tabbladen:', 'Factuuroverzicht (afdrukbaar, per periode), Leverbaar en Archief (alle afgeleverde leveringen met bon en factuur).'),
      m(2, 'Leverbaar:', 'wat nu geleverd kan worden, wat volledig leverbaar is, of alle open verkooporders.'),
      m(3, 'Binnen, nog te plannen', 'naast wat nog niet binnen is.'),
      m(4, 'Status:', 'Volledig leverbaar of Deels leverbaar.'),
      m(5, 'Levering plannen:', 'gaat direct door naar 5.4.')] },
    { t: 'h2', text: '10.2  Kassa: dagafsluiting' },
    { t: 'why', text: 'Aan het eind van de dag de kas opmaken, per bedrijf: geteld contant tegenover het systeem.' },
    { t: 'img', key: 'dag', src: shot('10-dagafsluiting'), cap: 'Dagafsluiting voor Bella.' },
    { t: 'steps', items: [
      m(1, 'Bedrijf:', 'Bella of HDB. Elk bedrijf sluit apart af.'),
      m(2, 'Dag:', 'staat op vandaag.'),
      m(3, 'Volgens het systeem:', 'aantal bonnen, omzet, contant en pin.'),
      m(4, 'Telling contant:', 'tel de kas en vul per biljet en munt het aantal in.'),
      m(5, 'Verschil contant:', 'groen "klopt", of het verschil.'),
      m(6, 'Pin volgens de pinautomaat:', 'het totaal van de pinautomaat.'),
      m(7, 'Afgestort:', 'wat naar de bank of kluis gaat. De rest blijft als wisselgeld voor morgen.'),
      m(8, 'Toelichting:', 'verplicht bij een verschil.'),
      m(9, 'Opgemaakt door:', 'kies jezelf en klik daaronder op Dag afsluiten. Daarna kan niets meer wijzigen. Druk de dagstaat af en laat hem tekenen.')] },
    { t: 'p', text: 'Het andere tabblad, Factuuroverzicht kassa, toont per bedrijf alle kassabonnen en creditbonnen van een periode, met totalen per betaalwijze.' },
    { t: 'h2', text: '10.3  Catalogi' },
    { t: 'img', key: 'cat', src: shot('10-catalogi'), cap: 'Catalogus van een leverancier.' },
    { t: 'steps', items: [
      m(1, 'Leverancier:', 'kies de catalogus.'),
      m(2, 'Serie, categorie en zoekveld', 'om gericht te zoeken.'),
      m(3, 'Artikelnummer:', 'eerst ons eigen nummer, daaronder dat van de leverancier en de EAN. Ons nummer wijzigt nooit.'),
      m(4, 'Beschikbaar in magazijn en prijs', 'volgens de leverancier.'),
      m(5, 'Elementen:', 'wat je bij dit artikel kunt bestellen. Klik op een artikel voor de artikelkaart.'),
      m(6, 'Catalogus inlezen (CSV):', 'alleen voor de beheerder. De catalogi worden ook elke nacht automatisch bijgewerkt.')] },
    { t: 'h3', text: 'De artikelkaart' },
    { t: 'p', text: 'Klik in de lijst op een artikel. De artikelkaart opent:' },
    { t: 'img', key: 'akk', src: shot('10-artikelkaart', [406, 30, 692, 670]), width: 122, cap: 'Artikelkaart van een tafelblad.' },
    { t: 'steps', items: [
      m(1, 'Foto', 'van de leverancier.'),
      m(2, 'Nummers:', 'ons artikelnummer, het artikelnummer van de leverancier en de EAN.'),
      m(3, 'Leverancier, serie, categorie, beschikbaarheid en prijs.', 'Klik op de serie voor alle artikelen van die serie.'),
      m(4, 'Status:', '"Nog niet verkocht" betekent dat het artikel een product wordt zodra het op een verkooporder komt.'),
      m(5, 'Product specificaties:', 'maten, kleur en andere gegevens van de leverancier.'),
      m(6, 'Elementen:', 'wat erbij besteld kan worden, met nummer, beschikbaarheid en prijs.')] },
    { t: 'p', text: 'Onderaan staan Bekijk in de showroom (de pagina bij de leverancier) en Sluiten.' },
    { t: 'h2', text: '10.4  Instellingen' },
    { t: 'img', key: 'ins', src: shot('10-instellingen', [228, 64, 1080, 300]), cap: 'Instellingen, tabblad Magazijnen.' },
    { t: 'steps', items: [
      m(1, 'Magazijnen:', 'de drie locaties (7). Nieuwe locatie: Magazijn toevoegen (8).'),
      m(2, 'Leveranciers:', 'naam, adres, land (Spanje slaat Ontvangen in NL en Transport over), e-mail voor inkooporders, levertijd en de afkorting van drie letters waarmee ons artikelnummer begint. Wijzig de afkorting HDB nooit.'),
      m(3, 'Toeslagen:', 'per leverancier een percentage op de prijs voor transport naar Spanje.'),
      m(4, 'Klanten:', 'de klantenlijst met zoekveld. De vaste klant Kassaverkoop is voor verkopen zonder klantgegevens.'),
      m(5, 'Medewerkers:', 'naam, e-mail, telefoon, actief en rol (Verkoper, Administratie of Beheerder). Inloggen kan alleen met het e-mailadres dat hier staat.'),
      m(6, 'Bedrijf en factuur:', 'zie hieronder.')] },
    { t: 'h3', text: 'Bedrijf en factuur' },
    { t: 'p', text: 'Dit tabblad is lang. Het bestaat uit panelen onder elkaar. Klik onderaan altijd op Opslaan.' },
    { t: 'img', key: 'bf1', src: shot('10-bedrijf-1'), cap: 'Bovenaan: Bedrijfsgegevens en Factuur.' },
    { t: 'steps', items: [
      m(1, 'Bedrijfsgegevens:', 'juridische naam, CIF, adres, postcode, plaats, provincie, telefoon en e-mail.'),
      m(2, 'Handelsnaam:', 'de naam op documenten en in mails aan klanten. Leeg betekent: de juridische naam.'),
      m(3, 'Factuur:', 'IBAN, betaaltermijn in dagen en een vaste tekst onderaan de factuur.'),
      m(4, 'Opslaan:', 'staat altijd rechtsonder in beeld.')] },
    { t: 'img', key: 'bf2', src: shot('10-bedrijf-2'), cap: 'Afleverbon, Taal van documenten, Mailen aan de klant en Kassa: afdrukken.' },
    { t: 'steps', items: [
      m(5, 'Soort afleverbon:', 'Papier, geprint, of Digitaal (tekenen in de chauffeursapp). Bij een vervoerder blijft de bon op papier.'),
      m(6, 'Taal van documenten:', 'per document de afdruktaal: inkooporder, lijsten, verkooporder, afleverbon, factuur en eenvoudige factuur (kassa). Standaard de taal van de klant; de kassabon Spaans.'),
      m(7, 'Mailen aan de klant:', 'zet per document aan wat Bella Flow vanzelf mailt: Verkooporder, Eenvoudige factuur, Factuur en Afleverbon getekend. Met de hand mailen kan altijd.'),
      m(8, 'Winkel e-mail:', 'afzender en antwoordadres; krijgt een kopie (bcc) van elk gemaild document.'),
      m(9, 'Kassa: afdrukken:', 'zie hieronder.')] },
    { t: 'img', key: 'bf3', src: shot('10-bedrijf-3'), cap: 'Kassa: afdrukken en de gegevens van beide bedrijven aan de kassa.' },
    { t: 'steps', items: [
      m(10, 'Eenvoudige factuur afdrukken:', 'Eenvoudige factuur op A4, of Kassabon, thermische printer 80 mm. Dit geldt ook voor retouren aan de kassa.'),
      m(11, 'Kassa: Bella:', 'logo linksboven en beeldmerk onderaan de kassabon van Bella. Andere afbeelding kiezen of verwijderen; wordt bewaard met Opslaan.'),
      m(12, 'Kassa: HDB:', 'de juridische gegevens van Handmade Bali Treasures SL, onderaan de kassabon van HDB.'),
      m(13, 'Logo HDB', '(en daaronder het beeldmerk).')] },
    { t: 'img', key: 'bf4', src: shot('10-bedrijf-4'), cap: 'Shopify van HomeDecoBali, Documentnummers en Testperiode.' },
    { t: 'steps', items: [
      m(14, 'Shopify van HomeDecoBali:', 'elke kassaverkoop van HDB gaat als bestelling naar Shopify. Hier zet je dat aan of uit, kies je of de conceptorder meteen een betaalde bestelling wordt, en vul je de naam van de winkel in Shopify in.'),
      m(15, 'Documentnummers:', 'het voorvoegsel van elke reeks. Een nummer is voorvoegsel, jaar en teller. Een nieuw voorvoegsel geldt alleen voor nieuwe documenten; de teller loopt door.'),
      m(16, 'Testperiode:', 'zolang Bella Flow niet live is.')] },
    { t: 'img', key: 'bf5', src: shot('10-bedrijf-5'), cap: 'Testperiode en Jaarafsluiting.' },
    { t: 'steps', items: [
      m(17, 'Testgegevens wissen:', 'haalt alle verkooporders, kassabonnen, facturen, leveringen, inkooporders, transporten, ontvangsten, dagafsluitingen en voorraad weg; elke reeks begint weer bij 0001. Instellingen, magazijnen, leveranciers, medewerkers en catalogi blijven.'),
      m(18, 'Live zetten:', 'op de dag dat Bella Flow echt in gebruik gaat. Daarna kan wissen nooit meer.'),
      m(19, 'Open boekjaar:', 'het jaar in elk nieuw nummer. Met Boekjaar ... afsluiten zet je het één jaar verder, vanaf 1 januari van het volgende jaar.'),
      m(20, 'Laatst gebruikte nummers:', 'per reeks het laatste nummer en het aantal.')] },
    { t: 'note', text: 'Bij Testperiode en Jaarafsluiting typ je een woord in en bevestig je twee keer. Dat is expres: deze stappen zijn niet ongedaan te maken. Overleg fiscale vragen altijd met de gestor. Klik na elke wijziging op Opslaan.' },

    { t: 'h1', num: 'A', title: 'Addendum: de techniek', sub: 'Voor wie wil weten wat er onder de motorkap zit. Voor het dagelijks werk heb je dit niet nodig.' },
    { t: 'table', w: [.2, .33, .47], head: ['Laag', 'Wat', 'Waarvoor'], rows: [
      ['Scherm', 'React, TypeScript, Vite', 'De schermen in de browser, in drie talen.'],
      ['Bedrijfsregels', 'Map src/domain', 'Alle regels (fasen, voorraad, facturen) op één plek, los van de schermen.'],
      ['Opslag', 'Contract src/data/driver.ts', 'Eén toegangspunt: dezelfde schermen draaien op de demo en op de echte database.'],
      ['Database', 'Supabase (Postgres)', 'Alle gegevens, met inloggen en toegang alleen voor actieve medewerkers.'],
      ['Mail', 'Supabase edge function met Resend', 'Facturen, afleverbonnen en inkooporders als pdf of bestand.'],
      ['Catalogi', 'n8n, elke nacht', 'De artikellijsten van de leveranciers bijwerken.'],
      ['Hosting', 'GitHub Pages, bellaflow.es', 'De website; de demo staat op bellaflow.es/demo.'],
      ['Kwaliteit', 'GitHub Actions', 'Bij elke wijziging eerst alle tests; één fout houdt de publicatie tegen.']] },
    { t: 'p', text: 'Databasewijzigingen gaan via genummerde migraties. Facturen zijn in de database onwijzigbaar; de voorraad is altijd de som van mutaties.' },
    { t: 'h3', text: 'Hulp per scherm' },
    { t: 'p', text: 'Deze handleiding staat ook in Bella Flow zelf. F1 opent rechts de uitleg van het scherm waar je bent: Bella Flow herkent het scherm aan het adres in de browser (src/domain/help.ts, inhoud in src/domain/helpContent.ts). De bron van deze PDF staat in public/handleiding/bouw-pdf.js.' },
  ]

  async function loadJsPdf() {
    if (window.jspdf) return
    await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'; s.onload = res; s.onerror = () => rej(new Error('jsPDF laden mislukt')); document.head.appendChild(s) })
  }
  const loadImg = (url) => new Promise((res, rej) => {
    const i = new Image(); i.crossOrigin = 'anonymous'
    i.onload = () => { const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(i, 0, 0); res({ data: c.toDataURL(url.endsWith('.png') ? 'image/png' : 'image/jpeg', 0.9), w: i.naturalWidth, h: i.naturalHeight }) }
    i.onerror = () => rej(new Error('Afbeelding laden mislukt: ' + url)); i.src = url
  })

  async function bouw() {
    await loadJsPdf()
    const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' })
    const W = 210, H = 297, M = 18, CW = W - 2 * M, BOTTOM = H - 20
    const col = { slate: [64, 68, 78], taupe: [90, 74, 76], bcopper: [145, 84, 66], terra: [172, 95, 65], wcopper: [206, 141, 97], sand: [242, 232, 223], ink: [11, 24, 42] }
    const logo = await loadImg('assets/brand/bellaflow-logo-medium.png')
    const mark = await loadImg('assets/brand/bellaflow-beeldmerk-small.png')
    const imgs = {}
    for (const b of C) if (b.t === 'img') imgs[b.key] = await loadImg(b.src)
    let y = M, chapter = ''
    const tc = (c) => doc.setTextColor(...c), fc = (c) => doc.setFillColor(...c), dc = (c) => doc.setDrawColor(...c)
    const pageTop = () => { fc(col.terra); doc.rect(0, 0, W, 3, 'F'); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); tc(col.taupe); doc.text(chapter, M, 10); doc.text('Bella Flow  ·  Gebruikershandleiding', W - M, 10, { align: 'right' }); y = 18 }
    const newPage = () => { doc.addPage(); pageTop() }
    const ensure = (h) => { if (y + h > BOTTOM) newPage() }
    const circle = (x, cy, n, r = 3.2) => { fc(col.terra); dc([255, 255, 255]); doc.setLineWidth(0.5); doc.circle(x, cy, r, 'FD'); doc.setFont('helvetica', 'bold'); doc.setFontSize(n > 9 ? 7.5 : 8.5); tc([255, 255, 255]); doc.text(String(n), x, cy + 1.1, { align: 'center' }) }
    const para = (txt, size = 10.5) => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(size); tc(col.slate)
      const lh = size * 0.3528 * 1.42
      for (const l of doc.splitTextToSize(txt, CW)) { ensure(lh); doc.text(l, M, y + size * 0.3528); y += lh }
      y += 2.2
    }
    const richLine = (bold, txt, x, maxW, size = 10.5) => {
      doc.setFontSize(size); const lh = size * 0.3528 * 1.42
      doc.setFont('helvetica', 'bold'); const bw = bold ? doc.getTextWidth(bold + ' ') : 0
      doc.setFont('helvetica', 'normal')
      const first = doc.splitTextToSize(txt, maxW - bw)[0] || ''; const rest = txt.slice(first.length).trim()
      const restLines = rest ? doc.splitTextToSize(rest, maxW) : []
      ensure(Math.min((1 + restLines.length) * lh, 30))
      if (bold) { doc.setFont('helvetica', 'bold'); tc(col.ink); doc.text(bold, x, y + size * 0.3528) }
      doc.setFont('helvetica', 'normal'); tc(col.slate); doc.text(first, x + bw, y + size * 0.3528); y += lh
      for (const l of restLines) { ensure(lh); doc.text(l, x, y + size * 0.3528); y += lh }
    }
    // voorkant
    fc(col.sand); doc.rect(0, 0, W, H, 'F'); fc(col.terra); doc.rect(0, 0, W, 6, 'F')
    const lw = 120, lh = lw * logo.h / logo.w
    doc.setFillColor(255, 255, 255); doc.roundedRect((W - lw) / 2 - 8, 62, lw + 16, lh + 16, 4, 4, 'F'); doc.addImage(logo.data, 'PNG', (W - lw) / 2, 70, lw, lh)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(26); tc(col.slate); doc.text('Gebruikershandleiding', W / 2, 120, { align: 'center' })
    doc.setFont('helvetica', 'normal'); doc.setFontSize(12.5); tc(col.taupe); doc.text('Van Kassa tot Factuur: stap voor stap door Bella Flow', W / 2, 130, { align: 'center' })
    fc(col.wcopper); doc.rect(W / 2 - 20, 138, 40, 1.2, 'F')
    doc.setFontSize(10.5); tc(col.slate); doc.text(['Voor iedereen die met Bella Flow werkt bij', 'Bella Outdoor & Furnishing, Campoamor'], W / 2, 152, { align: 'center' })
    const flow = ['Verkooporder', 'Inkoop', 'Transport', 'Ontvangst', 'Levering', 'Factuur'], bw = 26, gap = 3, sx = (W - (flow.length * bw + (flow.length - 1) * gap)) / 2
    flow.forEach((f, i) => { const x = sx + i * (bw + gap); fc(i % 2 ? col.wcopper : col.terra); doc.roundedRect(x, 182, bw, 11, 2, 2, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.6); tc([255, 255, 255]); doc.text(f, x + bw / 2, 188.8, { align: 'center' }) })
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); tc(col.taupe)
    const vandaag = new Date().toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })
    doc.text(`Versie 1.1  ·  ${vandaag}  ·  Nederlands`, W / 2, 262, { align: 'center' })
    doc.text('Schermafdrukken uit de demo met verzonnen voorbeeldgegevens (bellaflow.es/demo)', W / 2, 268, { align: 'center' })
    // inhoud
    for (const b of C) {
      if (b.t === 'h1') {
        chapter = b.num ? `${b.num}. ${b.title}` : b.title
        if (b.inline && y < BOTTOM - 80) y += 6; else { doc.addPage(); pageTop() }
        fc(col.sand); doc.roundedRect(M, y, CW, 26, 3, 3, 'F'); fc(col.terra); doc.roundedRect(M, y, 26, 26, 3, 3, 'F')
        doc.setFont('helvetica', 'bold'); doc.setFontSize(String(b.num).length > 1 ? 18 : 22); tc([255, 255, 255]); doc.text(String(b.num), M + 13, y + 16.5, { align: 'center' })
        doc.setFontSize(18); tc(col.slate); doc.text(b.title, M + 33, y + 12)
        if (b.sub) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); tc(col.taupe); doc.text(doc.splitTextToSize(b.sub, CW - 38), M + 33, y + 19) }
        y += 34; continue
      }
      if (b.t === 'h2') { ensure(18); y += 2; doc.setFont('helvetica', 'bold'); doc.setFontSize(13.5); tc(col.bcopper); doc.text(b.text, M, y + 5); y += 7.5; dc(col.wcopper); doc.setLineWidth(0.4); doc.line(M, y, M + CW, y); y += 4; continue }
      if (b.t === 'h3') { ensure(14); y += 1; doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); tc(col.slate); doc.text(b.text, M, y + 4.5); y += 8; continue }
      if (b.t === 'p') { para(b.text); continue }
      if (b.t === 'why') { ensure(12); const sy = y; y += 2.5; richLine('Waarvoor?', b.text, M + 5, CW - 8); y += 2.5; fc(col.terra); doc.rect(M, sy, 1.4, y - sy, 'F'); y += 3; continue }
      if (b.t === 'note' || b.t === 'tip') {
        doc.setFontSize(10); const items = b.items || [b.text]; const lines = items.map((t) => doc.splitTextToSize(t, CW - 14)); const lhm = 10 * 0.3528 * 1.42
        const hh = 8 + lhm * lines.reduce((a, l) => a + l.length, 0) + (items.length > 1 ? items.length * 1.2 : 0) + 4; ensure(Math.min(hh, 120))
        const sy = y; fc(b.t === 'note' ? [248, 236, 226] : [238, 240, 243]); doc.roundedRect(M, y, CW, hh, 2, 2, 'F'); fc(b.t === 'note' ? col.terra : col.slate); doc.rect(M, y, 1.4, hh, 'F')
        doc.setFont('helvetica', 'bold'); tc(b.t === 'note' ? col.bcopper : col.slate); doc.text(b.t === 'note' ? 'Let op:' : 'Tip:', M + 5, y + 6); y += 9
        doc.setFont('helvetica', 'normal'); tc(col.slate)
        lines.forEach((ls) => { ls.forEach((l, i) => { if (items.length > 1 && i === 0) { fc(col.terra); doc.circle(M + 6.5, y + 2.2, 0.8, 'F') } doc.text(l, M + (items.length > 1 ? 9 : 5), y + 3.5); y += lhm }); y += items.length > 1 ? 1.2 : 0 })
        y = sy + hh + 4; continue
      }
      if (b.t === 'steps') {
        for (const [i, s] of b.items.entries()) {
          doc.setFontSize(10.5); ensure(9); const n = s.n !== undefined ? s.n : i + 1
          if (s.mark) circle(M + 3.4, y + 2.6, n); else { fc(col.sand); doc.circle(M + 3.4, y + 2.6, 3.2, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); tc(col.bcopper); doc.text(String(n), M + 3.4, y + 3.7, { align: 'center' }) }
          richLine(s.b || '', s.t, M + 10, CW - 10); y += 1.6
          if (s.sub) for (const ss of s.sub) { ensure(6); fc(col.wcopper); doc.circle(M + 12, y + 2, 0.8, 'F'); richLine(ss.b || '', ss.t, M + 15, CW - 15, 10); y += 0.6 }
        }
        y += 2; continue
      }
      if (b.t === 'bullets') { for (const s of b.items) { ensure(7); fc(col.terra); doc.circle(M + 2, y + 2.3, 0.9, 'F'); richLine(s.b || '', s.t || s, M + 6, CW - 6); y += 1 } y += 2; continue }
      if (b.t === 'flow') {
        ensure(16); const n = b.items.length, g = 2, w = (CW - (n - 1) * g) / n
        b.items.forEach((f, i) => { const x = M + i * (w + g); fc(col.sand); doc.roundedRect(x, y, w, 11, 1.6, 1.6, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(w < 26 ? 7 : 8); tc(col.bcopper); const ls = doc.splitTextToSize(f, w - 2); doc.text(ls, x + w / 2, y + (ls.length > 1 ? 4.6 : 6.9), { align: 'center' }) })
        y += 16; continue
      }
      if (b.t === 'table') {
        doc.setFontSize(9.5); const cw = b.w.map((v) => v * CW)
        const rowH = (r) => Math.max(...r.map((c, i) => doc.splitTextToSize(c, cw[i] - 4).length)) * 4.6 + 3.2
        const drawRow = (r, head) => { const h = rowH(r); ensure(h); let x = M; if (head) { fc(col.slate); doc.rect(M, y, CW, h, 'F') } else { dc([226, 214, 204]); doc.setLineWidth(0.2); doc.line(M, y + h, M + CW, y + h) }
          r.forEach((c, i) => { doc.setFont('helvetica', head || i === 0 ? 'bold' : 'normal'); tc(head ? [255, 255, 255] : (i === 0 ? col.ink : col.slate)); doc.text(doc.splitTextToSize(c, cw[i] - 4), x + 2, y + 4.6); x += cw[i] }); y += h }
        drawRow(b.head, true); b.rows.forEach((r) => drawRow(r, false)); y += 5; continue
      }
      if (b.t === 'img') {
        const im = imgs[b.key]; let w = b.width || CW, h = w * im.h / im.w; const maxH = BOTTOM - 18; if (h > maxH) { h = maxH; w = h * im.w / im.h }
        if (y + h + 8 > BOTTOM) newPage(); const x = M + (CW - w) / 2
        fc([230, 220, 210]); doc.roundedRect(x - 0.8, y - 0.8, w + 1.6, h + 1.6, 1.5, 1.5, 'F'); doc.addImage(im.data, 'JPEG', x, y, w, h); y += h + 2.5
        if (b.cap) { doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); tc(col.taupe); doc.text(b.cap, M + CW / 2, y + 2.5, { align: 'center' }); y += 6 }
        y += 3; continue
      }
    }
    // voettekst op elke pagina
    const N = doc.getNumberOfPages()
    for (let p = 1; p <= N; p++) {
      doc.setPage(p); const fy = H - 10
      dc(p === 1 ? col.wcopper : [226, 214, 204]); doc.setLineWidth(0.3); doc.line(M, fy - 5, W - M, fy - 5)
      const mw = 7, mh = mw * mark.h / mark.w; doc.addImage(mark.data, 'PNG', M, fy - 3.6, mw, mh)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); tc(col.taupe); doc.text('© bellaflow.es  ·  Bella Flow gebruikershandleiding', M + mw + 2, fy)
      doc.setFont('helvetica', 'bold'); tc(col.bcopper); doc.text(`Pagina ${p} van ${N}`, W - M, fy, { align: 'right' })
    }
    return { blob: doc.output('blob'), pages: N }
  }

  window.bellaFlowHandleiding = { inhoud: C, bouw }
})()
