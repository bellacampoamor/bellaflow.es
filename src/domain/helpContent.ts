// Inhoud van de hulp per scherm, in het Nederlands (opdracht Rick 17 november 2026: eerst Nederlands).
// Dezelfde tekst als de PDF-handleiding (bellaflow-handleiding-nl.pdf), per onderwerp opgeknipt.
// De schermafdrukken staan in Cloudinary (map bellaflow-handleiding) en tonen verzonnen voorbeeldgegevens uit de demo.
import type { HelpTopic } from './help'

export type HelpBlock =
  | { t: 'why'; text: string }
  | { t: 'p'; text: string }
  | { t: 'h'; text: string }
  | { t: 'img'; src: string; cap: string; narrow?: boolean }
  | { t: 'steps'; items: HelpStep[] }
  | { t: 'note' | 'tip'; items: string[] }
  | { t: 'see'; topic: HelpTopic; text: string }

/** Een stap. mark = het koperen rondje met dit nummer staat op de schermafdruk. */
export interface HelpStep { n?: number; mark?: boolean; b?: string; t: string; sub?: { b?: string; t: string }[] }
export interface HelpPage { title: string; chapter: string; blocks: HelpBlock[] }

const CLD = 'https://res.cloudinary.com/uhdvgzei/image/upload'
/** Schermafdruk uit Cloudinary, bijgesneden tot het werkvlak (x, y, breedte, hoogte in pixels van de afdruk). */
const shot = (id: string, [x, y, w, h]: [number, number, number, number] = [220, 0, 1090, 730]) =>
  `${CLD}/c_crop,x_${x},y_${y},w_${w},h_${h}/f_auto,q_auto/v1/bellaflow-handleiding/${id}.jpg`
export const HELP_PDF_URL = `${CLD}/bellaflow-handleiding/bellaflow-handleiding-nl.pdf`

const mk = (n: number, b: string, t: string, sub?: HelpStep['sub']): HelpStep => ({ n, mark: true, b, t, sub })

export const HELP_NL: Record<HelpTopic, HelpPage> = {
  start: {
    chapter: '1–2', title: 'Zo werkt Bella Flow',
    blocks: [
      { t: 'p', text: 'Bella Flow is het systeem van Bella Outdoor & Furnishing van inkoop tot factuur. Het hoofdmenu loopt van links naar rechts. Deze hulp laat bij elk scherm zien wat je waar invult. Druk overal op F1 om de hulp bij het scherm te openen of te sluiten.' },
      { t: 'img', src: shot('01-menu', [220, 0, 1090, 80]), cap: 'Het hoofdmenu, van links naar rechts.' },
      { t: 'steps', items: [
        mk(1, 'Overzicht:', 'je startpagina met wat er vandaag te doen is.'),
        mk(2, 'Kassa:', 'snel verkopen in de winkel.'),
        mk(3, 'Verkoop:', 'verkooporders, levering aan de klant en facturatie.'),
        mk(4, 'Inkoop:', 'inkooporders, gepland transport en ontvangst.'),
        mk(5, 'Voorraad:', 'wat ligt waar, en verhuizen.'),
        mk(6, 'Zoeken:', 'alles terugvinden. Ook met Ctrl+K of de toets /.'),
        mk(7, 'Vlaggetjes:', 'schermtaal Nederlands, Engels of Spaans.'),
        mk(8, 'Nachtstand:', 'donker of licht scherm.'),
        mk(9, 'Headset:', 'contact en support.'),
        mk(10, 'Beheer:', 'Rapportage, Kassa (beheer), Catalogi en Instellingen.'),
      ] },
      { t: 'h', text: 'Vaste woorden' },
      { t: 'steps', items: [
        { b: 'Verkooporder:', t: 'wat een klant bij ons koopt (VO-...).' },
        { b: 'Inkooporder:', t: 'wat wij bij een leverancier bestellen (IO-...). Een proforma-inkooporder heet PIO-...' },
        { b: 'Kassabon:', t: 'de bon van een verkoop aan de kassa; de klant neemt alles meteen mee en betaalt.' },
        { b: 'Proforma (PF):', t: 'staat klaar om te factureren na een levering. Nog geen factuur.' },
        { b: 'Locaties:', t: 'Showroom Campoamor, Magazijn Campoamor en Magazijn Almoradí.' },
      ] },
      { t: 'tip', items: [
        'Een regel in een lijst selecteer je door op de regel te klikken. Er zijn geen vinkjes.',
        'In een getalveld mag je een komma of een punt typen. Je mag het veld ook helemaal leegmaken.',
        'Linksboven op elk detailscherm staat een terugknop met de naam van het scherm waar je vandaan kwam.',
      ] },
    ],
  },

  zoeken: {
    chapter: '8', title: 'Zoeken in alles',
    blocks: [
      { t: 'why', text: 'Alles terugvinden zonder te weten waar het staat.' },
      { t: 'img', src: shot('08-zoeken', [412, 20, 698, 316]), cap: 'Zoeken op "bakker".', narrow: true },
      { t: 'steps', items: [
        { t: 'Klik op Zoeken in het menu, of druk Ctrl+K (Mac: Cmd+K) of de toets /.' },
        mk(1, 'Zoekveld:', 'typ minstens twee tekens: een nummer, een naam, een plaats of een artikel.'),
        mk(2, 'Resultaten per soort:', 'klanten, verkooporders, facturen, inkooporders, afleverbonnen, transporten en artikelen.'),
        mk(3, 'Kies', 'met de pijltjes en Enter, of klik.'),
      ] },
      { t: 'tip', items: ['Accenten en streepjes maken niet uit. Een kassaverkoop vind je als factuur.'] },
    ],
  },

  overzicht: {
    chapter: '3', title: 'Overzicht',
    blocks: [
      { t: 'why', text: 'In één oogopslag zien wat er vandaag moet gebeuren.' },
      { t: 'img', src: shot('03-overzicht'), cap: 'Overzicht met de vijf onderdelen.' },
      { t: 'steps', items: [
        mk(1, 'Tegels:', 'elke tegel telt iets dat aandacht vraagt. Rood is te laat. Klik op een tegel en je staat in de juiste lijst.'),
        mk(2, 'Geld:', 'gefactureerd deze maand, afgeleverd maar nog niet gefactureerd, open op facturen, en vooruitbetaald.'),
        mk(3, 'Verkoop:', 'de bezorgplanning van de komende 7 dagen.'),
        mk(4, 'Inkoop:', 'binnenkomende transporten en wat nog ingekocht moet worden.'),
        mk(5, 'Snelknoppen:', 'Inkooporder en Nieuwe verkooporder.'),
      ] },
    ],
  },

  kassa: {
    chapter: '4', title: 'Kassa',
    blocks: [
      { t: 'why', text: 'Een verkoop in de winkel afrekenen: de klant neemt alles direct mee en betaalt meteen. Je maakt een kassabon (eenvoudige factuur), geen verkooporder.' },
      { t: 'p', text: 'De eerste keer vraagt de kassa: "Wie staat er achter de kassa?" Klik op je naam. De browser onthoudt dat.' },
      { t: 'img', src: shot('04-kassa', [268, 64, 980, 666]), cap: 'De kassa met één artikel op de bon. Op deze afdruk staat de kassa nog op Bella en heet de knop nog CREDIT.' },
      { t: 'steps', items: [
        mk(1, 'Medewerker:', 'staat hier je eigen naam? Zo niet, kies jezelf.'),
        mk(2, 'Bon voor:', 'staat standaard op HomeDecoBali, ook na elke verkoop. Verkoop je een artikel van Bella, klik dan eerst op Bella Outdoor & Furniture.'),
        mk(3, 'Scan het etiket', 'met de handscanner. Geen scanner? Gebruik het zoekveld eronder: artikelnummer, nummer van de leverancier, EAN of een deel van de naam. Iets zonder eigen nummer? Klik op Diversen en typ zelf omschrijving, prijs en IVA.'),
        mk(4, 'De regel:', 'pas zo nodig het aantal (met - en +), de prijs incl. IVA of de korting % aan.'),
        mk(5, 'Pin of Contant:', 'bij contant typ je het ontvangen bedrag en zie je het wisselgeld.'),
        mk(6, 'Klant en mailen:', 'leeg laten mag tot € 1.000. Wil de klant de bon per mail, vul het adres in bij Factuur mailen naar.'),
        mk(7, 'Afrekenen:', 'de kassabon wordt gemaakt, het artikel gaat uit de voorraad van de showroom en de betaling is geboekt.'),
        mk(8, 'RETOUR:', 'retour of correctie op een eerdere kassabon, zie hieronder.'),
      ] },
      { t: 'note', items: [
        'Hoor je een foutpiep, dan hoort het artikel bij het andere bedrijf. Een HomeDecoBali-artikel kan alleen op een bon van HomeDecoBali, en andersom.',
        'Boven € 1.000 zijn naam, adres, woonplaats en NIE of paspoortnummer van de klant verplicht.',
        'Een gele melding "0 vrij in de winkel" is geen probleem: het verschil wordt bij afrekenen bijgeboekt.',
      ] },
      { t: 'h', text: 'Retour of correctie' },
      { t: 'img', src: shot('04-kassa-retour', [530, 20, 462, 480]), cap: 'Venster Retour of correctie.', narrow: true },
      { t: 'steps', items: [
        { t: 'Klik rechtsboven op de rode knop RETOUR.' },
        mk(1, 'Factuurnummer:', 'scan of typ het nummer van de kassabon en klik op Zoeken.'),
        mk(2, 'Of kies een recente kassabon', 'uit de lijst.'),
        { t: 'Klik op de regels die terugkomen, vul het aantal in, kies waar het artikel terug in voorraad gaat, vul de reden in en kies Contant of Pin. De creditbon telt mee in de dagafsluiting.' },
      ] },
      { t: 'see', topic: 'kassabeheer', text: 'Aan het eind van de dag: Beheer > Kassa > Dagafsluiting.' },
    ],
  },

  verkooporders: {
    chapter: '5.1', title: 'Verkooporders',
    blocks: [
      { t: 'why', text: 'Alle verkooporders, elk als spoor door de zes fasen: Proforma, Verkooporder, Voorraad of inkoop, Planning levering, Afleveren, Factureren.' },
      { t: 'img', src: shot('05-verkooporders'), cap: 'Elke verkooporder als spoor door de zes fasen.' },
      { t: 'steps', items: [
        mk(1, 'Tabbladen:', 'Opvolgen (wat aandacht vraagt, te laat bovenaan), Loopt, Afgerond en Alles.'),
        mk(2, 'Fasekoppen 1 tot 6:', 'klik op een kop om alleen de verkooporders in die fase te zien.'),
        mk(3, 'Spoor:', 'groen is klaar, koper vraagt actie, rood is te laat, blauw loopt.'),
        mk(4, 'Volgende stap:', 'klik erop en je staat op de goede plek.'),
        mk(5, 'PDF:', 'drukt de verkooporder direct af, met prijzen.'),
        mk(6, 'Zoeken', 'op nummer of klant.'),
        mk(7, 'Nieuwe verkooporder.', ''),
        mk(8, 'Levering en Facturatie:', 'snel naar stap 5 en 6, met het aantal dat wacht.'),
      ] },
      { t: 'see', topic: 'verkooporder-maken', text: 'Een nieuwe verkooporder maken' },
    ],
  },

  'verkooporder-maken': {
    chapter: '5.2', title: 'Een verkooporder maken',
    blocks: [
      { t: 'img', src: shot('05-nieuwe-verkooporder'), cap: 'Nieuwe verkooporder met één product op bestelling.' },
      { t: 'steps', items: [
        mk(1, 'Klant:', 'typ een deel van de naam, het telefoonnummer of het e-mailadres en klik op de klant. Nieuw? Klik op + Nieuwe klant. Kies bij Verkocht via: Winkel, Online, Telefoon of e-mail, of Beurs.'),
        mk(2, 'Verkoper (verplicht):', 'kies jezelf. De verkoopdatum staat al op vandaag.'),
        mk(3, 'Zoeken in:', 'in welke catalogi je zoekt. Bella Flow onthoudt je keuze.'),
        mk(4, '+ Product toevoegen:', 'maakt een nieuwe regel.'),
        mk(5, 'Product:', 'typ een deel van de naam, ons artikelnummer, het nummer van de leverancier of de EAN en klik op het artikel. Bij Uitvoering typ je zo nodig stof, kleur of afwerking.'),
        mk(11, 'Aantal.', ''),
        mk(6, 'Prijs incl. IVA en Korting %:', 'de prijs staat al klaar; pas hem alleen aan als het nodig is.'),
        mk(7, 'Afhandeling:', 'kies per regel wat er gebeurt.', [
          { b: 'Klant neemt direct mee:', t: 'de klant neemt het nu mee.' },
          { b: 'Uit voorraad, later leveren:', t: 'het ligt op voorraad en wordt later geleverd. Kies ook Uit magazijn.' },
          { b: 'Op bestelling:', t: 'het moet nog ingekocht worden.' },
        ]),
        mk(8, 'Elementen:', 'hoort er iets bij het artikel, zoals een hoes of kussen? Voeg het hier toe als extra regel.'),
        mk(9, 'Vooruitbetaling:', 'klik op 30%, 50% of Alles, of typ een bedrag, en kies de betaalwijze.'),
        mk(10, 'Verkooporder aanmaken:', 'klik pas als alles klopt.'),
      ] },
      { t: 'p', text: 'Onder de producten staat het blok Levering: Afleverwijze (Klant haalt later op, Bezorgen door eigen team of Verzenden met vervoerder), gewenste en beloofde leverdatum en het afleveradres.' },
      { t: 'note', items: [
        'Voorbeeld: de klant wil 10 stoelen en er liggen er 6 vrij. Dan worden het 6 uit voorraad en 4 op bestelling. Die 4 gaan vanzelf naar de inkoop.',
        'Staan alle regels op "Klant neemt direct mee", dan heet de knop Afrekenen, factureren en meegeven: de factuur wordt meteen gemaakt en gemaild.',
      ] },
    ],
  },

  verkooporder: {
    chapter: '5.3', title: 'Een verkooporder volgen',
    blocks: [
      { t: 'why', text: 'Op de verkooporder zie je waar hij staat en doe je de volgende stap.' },
      { t: 'steps', items: [
        { b: 'Volgende stap:', t: 'bovenaan staat wat er nu moet gebeuren, als knop.' },
        { b: 'Inkooporder maken:', t: 'staat een regel op bestelling, dan maakt Bella Flow vanzelf een proforma-inkooporder (PIO) per leverancier. Klik op Inkooporder maken; het venster Omzetten naar inkooporder staat dan al open.' },
        { b: 'Verwachte ontvangst:', t: 'staat een artikel op een transport, dan zie je per artikel wanneer het verwacht wordt.' },
        { b: 'Levering plannen:', t: 'als de artikelen binnen zijn. Wil je maar een deel leveren, verlaag dan de aantallen; wat overblijft plan je later.' },
        { b: 'Mailen:', t: 'stuurt de klant de verkooporder als pdf, met prijzen.' },
      ] },
      { t: 'see', topic: 'omzetten', text: 'Proforma omzetten naar een inkooporder' },
      { t: 'see', topic: 'levering', text: 'Levering aan klant' },
    ],
  },

  levering: {
    chapter: '5.4', title: 'Levering aan klant',
    blocks: [
      { t: 'why', text: 'Leveringen plannen, klaarzetten, afleveren en afmelden. Welke verkooporders je nu kunt leveren, zie je onder Beheer > Rapportage > Leverbaar.' },
      { t: 'img', src: shot('05-levering'), cap: 'De planning per dag, één levering geselecteerd.' },
      { t: 'steps', items: [
        mk(1, 'Planning en Afgerond:', 'wat nog moet en wat al geleverd is.'),
        mk(2, 'Alles selecteren:', 'alle leveringen van die dag.'),
        mk(3, 'Bezorgroute:', 'per dag één route, heen en terug vanaf Magazijn Campoamor. Beste route berekenen zet de stops in de beste volgorde.'),
        mk(4, 'Volgorde:', 'met de pijltjes, of sleep de stop omhoog of omlaag.'),
        mk(5, 'Knoppen per levering:', 'Verschuiven, Afleverbon, Onderweg en Afmelden als geleverd.'),
        mk(6, 'Geselecteerd:', 'klik op een levering; hij kleurt koper met een vinkje.'),
        mk(7, 'Klaarzetten:', 'controleer per levering de artikelen en vul één keer in wie akkoord heeft bevonden.'),
      ] },
      { t: 'h', text: 'Afleveren' },
      { t: 'steps', items: [
        { b: 'Papier:', t: 'druk de afleverbon af (zonder prijzen), laat de klant tekenen en klik op kantoor op Afmelden als geleverd.' },
        { b: 'Digitaal:', t: 'de chauffeur opent app.bellaflow.es, laat de klant tekenen en klikt op Bevestigen. De levering is afgemeld en de klant krijgt de getekende bon per mail.' },
      ] },
      { t: 'note', items: ['Een getekende bon is afgesloten. Een levering die niet is klaargezet, ziet de chauffeur niet.', 'Afmelden maakt nog geen factuur: er ontstaat een proforma onder Facturatie.'] },
    ],
  },

  afleverbon: {
    chapter: '5.4', title: 'Afleverbon',
    blocks: [
      { t: 'why', text: 'De afleverbon van één levering: om af te drukken, of de getekende bon terug te zien.' },
      { t: 'steps', items: [
        { t: 'Klik op Afdrukken. Op de bon staan geen prijzen.' },
        { t: 'De klant tekent bij ontvangst. Daarna meld je de levering af onder Levering aan klant.' },
        { t: 'Een getekende digitale bon opent vanuit het Archief, met handtekening.' },
      ] },
      { t: 'see', topic: 'levering', text: 'Terug naar Levering aan klant' },
    ],
  },

  facturatie: {
    chapter: '5.5', title: 'Facturatie',
    blocks: [
      { t: 'why', text: 'Van de proforma een factuur maken. Elke afgemelde levering krijgt eerst een proforma (PF).' },
      { t: 'img', src: shot('05-facturatie', [228, 64, 1080, 410]), cap: 'Een proforma geselecteerd, klaar om te factureren.' },
      { t: 'steps', items: [
        mk(1, 'Proforma:', 'klik op de proforma\'s die je wilt factureren.'),
        mk(5, 'Alles selecteren', '(of Niets selecteren) voor de hele lijst.'),
        mk(2, 'Factureren:', 'bevestig de factuurdatum. Per proforma ontstaat één factuur. Vooruitbetalingen worden vanzelf verrekend.'),
        mk(3, 'Openstaand en Alle facturen:', 'wat nog betaald moet worden, en alles.'),
        mk(4, 'PDF:', 'opent de factuur: Afdrukken of PDF, Mailen, Betaling registreren en Crediteren of retour.'),
      ] },
      { t: 'note', items: ['Een factuur is definitief: niet te wijzigen en niet terug te dateren. Een fout, retour of korting achteraf los je op met een creditfactuur.'] },
      { t: 'see', topic: 'crediteren', text: 'Crediteren of retour' },
    ],
  },

  crediteren: {
    chapter: '5.6', title: 'Crediteren of retour',
    blocks: [
      { t: 'img', src: shot('05-credit'), cap: 'Creditfactuur: twee parasols komen retour.' },
      { t: 'steps', items: [
        mk(1, 'Regel:', 'klik op de regels die je crediteert.'),
        mk(2, 'Crediteren:', 'het aantal. Nooit meer dan gefactureerd.'),
        mk(3, 'Retour in voorraad:', 'komt het artikel terug, kies de locatie. Anders Geen retour.'),
        mk(4, 'Bedrag zonder artikel:', 'voor een korting achteraf of schade.'),
        mk(5, 'Reden:', 'verplicht; hij komt op de creditfactuur.'),
        mk(6, 'Snelknoppen:', 'Retour, Fout in de factuur, Korting achteraf of Schade.'),
        mk(7, 'Bedragen:', 'eerst verrekend met wat op de factuur nog openstaat. De rest betaal je terug, nu of later.'),
      ] },
    ],
  },

  inkooporders: {
    chapter: '6.1', title: 'Inkooporders',
    blocks: [
      { t: 'why', text: 'Proforma\'s en inkooporders in één lijst, elk als spoor: Proforma, Inkooporder, Ontvangen in NL, Transport, Ontvangst in Spanje, Aflevering. Bij een leverancier in Spanje vallen Ontvangen in NL en Transport weg.' },
      { t: 'img', src: shot('06-inkooporders'), cap: 'Proforma\'s en inkooporders.' },
      { t: 'steps', items: [
        mk(1, 'Tabbladen:', 'Opvolgen, Loopt, Afgerond en Alles.'),
        mk(2, 'Fasekoppen 1 tot 6:', 'klik om te filteren op een fase.'),
        mk(3, 'Inkooporder:', 'nummer, label (Showroom, Magazijn of Verkoop), leverancier en datum.'),
        mk(4, 'Volgende stap:', 'klik erop en je staat op de goede plek.'),
        mk(5, 'Een proforma (PIO):', 'moet nog omgezet worden naar een inkooporder.'),
        mk(6, 'Gepland transport, Ontvangst, Afdrukken en versturen:', 'de andere stappen van de inkoop.'),
        mk(7, 'Nieuwe inkooporder:', 'voor de showroom of het magazijn.'),
      ] },
      { t: 'see', topic: 'omzetten', text: 'Proforma omzetten' },
      { t: 'see', topic: 'gepland-transport', text: 'Gepland transport' },
    ],
  },

  'inkooporder-maken': {
    chapter: '6.2', title: 'Inkoop voor showroom of magazijn',
    blocks: [
      { t: 'steps', items: [
        { t: 'Kies de leverancier.' },
        { t: 'Kies het label Showroom of Magazijn. Het label bepaalt later het voorstel van de locatie bij het inboeken.' },
        { t: 'Voeg de artikelen toe, vul de aantallen in en sla op. De inkooporder is altijd volledig ingekocht.' },
      ] },
      { t: 'tip', items: ['Inkoop voor een klant maak je niet hier, maar vanuit de verkooporder (Inkooporder maken).'] },
    ],
  },

  omzetten: {
    chapter: '6.2', title: 'Proforma omzetten naar inkooporder',
    blocks: [
      { t: 'why', text: 'Elke proforma hoort bij één verkooporder en wordt een eigen inkooporder, nooit samengevoegd.' },
      { t: 'img', src: shot('06-proforma', [416, 20, 704, 296]), cap: 'Venster Omzetten naar inkooporder.', narrow: true },
      { t: 'steps', items: [
        mk(1, 'Controleer', 'de proforma, de leverancier, de verkooporder en de waarde.'),
        mk(2, 'Besteldatum:', 'staat op vandaag.'),
        mk(3, 'Referentie leverancier:', 'het ordernummer bij de leverancier, als je dat hebt.'),
        mk(4, 'Inkooporder aanmaken.', 'De inkooporder is altijd volledig ingekocht.'),
      ] },
      { t: 'see', topic: 'afdrukken-versturen', text: 'Daarna: afdrukken en versturen' },
    ],
  },

  'afdrukken-versturen': {
    chapter: '6.2', title: 'Afdrukken en versturen',
    blocks: [
      { t: 'why', text: 'Inkooporders van één dag afdrukken of per leverancier naar de leverancier sturen.' },
      { t: 'img', src: shot('06-afdrukken-versturen', [228, 64, 1080, 380]), cap: 'Besteldatum 3 november, één inkooporder geselecteerd.' },
      { t: 'steps', items: [
        mk(1, 'Dag:', 'kies de besteldatum, of blader met de pijltjes. Vandaag springt terug naar vandaag.'),
        mk(2, 'Leverancier:', 'met het e-mailadres en de naam van het bestand. Staat er "geen e-mailadres", vul dat eerst in bij Instellingen > Leveranciers.'),
        mk(3, 'Inkooporder:', 'klik op de regel om hem te selecteren.'),
        mk(4, 'Verstuurd:', 'Nog niet verstuurd, of wanneer hij is verstuurd.'),
        mk(5, 'Afdrukken als PDF:', 'elke inkooporder op een eigen pagina.'),
        mk(6, 'JSON downloaden:', 'het bestand voor de leverancier op je eigen computer.'),
        mk(7, 'Versturen:', 'mailt per leverancier één bestand en legt dat vast op de inkooporder.'),
        mk(8, 'Alles of Niets selecteren', 'voor de hele dag.'),
      ] },
      { t: 'note', items: ['Proforma\'s en geannuleerde inkooporders worden niet verstuurd.'] },
    ],
  },

  'gepland-transport': {
    chapter: '6.3', title: 'Gepland transport',
    blocks: [
      { t: 'why', text: 'Registreren wat in Nederland klaarstaat en het op een vrachtwagen naar Spanje zetten. Hier maak je geen inkooporders.' },
      { t: 'img', src: shot('06-gepland-transport'), cap: 'Een regel geselecteerd om Ontvangen in NL te melden.' },
      { t: 'steps', items: [
        mk(1, 'Inplannen en Afgerond.', ''),
        mk(2, 'Besteld, nog bij de leverancier:', 'staat een regel klaar in Nederland, klik erop.'),
        mk(3, 'Ontvangen in NL:', 'kies de datum en klik op de knop. Pas daarna kan de regel op een transport.'),
        mk(4, 'Klaar in NL, nog niet op transport:', 'selecteer de regels en zet ze op een transport. Bella Flow laat zien of het transport vol genoeg is.'),
        mk(5, 'Het transport:', 'vertrek, aankomst, vervoerder en vrije m³. Klik op Ontvangen als de vrachtwagen er is.'),
        mk(6, 'Nieuw transport.', ''),
      ] },
      { t: 'tip', items: ['Zodra een regel op een transport staat, ziet de verkoper op de verkooporder wanneer het artikel verwacht wordt.'] },
    ],
  },

  ontvangst: {
    chapter: '6.4', title: 'Ontvangst',
    blocks: [
      { t: 'why', text: 'De vrachtwagen is er: boek in wat er werkelijk is aangekomen.' },
      { t: 'img', src: shot('06-ontvangst'), cap: 'Ontvangst van een transport, met de signaallijst.' },
      { t: 'steps', items: [
        mk(1, 'Transport:', 'kies het transport dat binnenkomt.'),
        mk(2, 'Goederenontvangst:', 'per regel wat er verwacht wordt. "Voor VO-..." is al verkocht.'),
        mk(3, 'Locatie:', 'voorstel Showroom Campoamor bij label Showroom, anders Magazijn Campoamor. Ook Magazijn Almoradí kan.'),
        mk(4, 'Ontvangen/Geteld:', 'tel en vul in. Wat ontbreekt blijft openstaan.'),
        mk(5, 'Signaallijst:', 'voor welke klant elke regel bestemd is.'),
        mk(6, 'Goederen inboeken.', 'De ontvangstdatum is vandaag.'),
      ] },
      { t: 'p', text: 'Een leverancier in Spanje levert zelf bij ons af: boek in onder Ontvangst, blok Rechtstreeks van leveranciers in Spanje.' },
      { t: 'see', topic: 'levering', text: 'Daarna: de levering aan de klant plannen' },
    ],
  },

  voorraad: {
    chapter: '7', title: 'Voorraad',
    blocks: [
      { t: 'why', text: 'Zien wat er per locatie ligt, en vrije voorraad verplaatsen.' },
      { t: 'img', src: shot('07-voorraad'), cap: 'Voorraadstand per locatie.' },
      { t: 'steps', items: [
        mk(1, 'Voorraadstand en Mutaties:', 'onder Mutaties staat elke beweging met het nummer van het document.'),
        mk(2, 'Zoeken', 'op product of artikelnummer.'),
        mk(3, 'Kolommen:', 'Showroom Campoamor, Magazijn Campoamor, Magazijn Almoradí en Totaal vrij.'),
        mk(4, 'Vrij en gereserveerd:', 'vrij kun je verkopen; gereserveerd is al van een klant.'),
        mk(5, 'Verhuizen:', 'kies van en naar welke locatie, en hoeveel. Direct verplaatst.'),
        mk(6, 'Correctie en Verhuizen:', 'een correctie gebruik je alleen na tellen.'),
        mk(7, 'Onder minimum:', 'er ligt minder dan het afgesproken minimum.'),
      ] },
      { t: 'note', items: ['Alleen vrije voorraad kan verhuizen. De voorraad is altijd de optelsom van de mutaties.'] },
    ],
  },

  rapportage: {
    chapter: '10.1', title: 'Rapportage',
    blocks: [
      { t: 'img', src: shot('10-rapportage', [228, 64, 1080, 430]), cap: 'Rapportage, tabblad Leverbaar.' },
      { t: 'steps', items: [
        mk(1, 'Tabbladen:', 'Factuuroverzicht (afdrukbaar, per periode), Leverbaar en Archief (alle afgeleverde leveringen met bon en factuur).'),
        mk(2, 'Leverbaar:', 'wat nu geleverd kan worden, wat volledig leverbaar is, of alle open verkooporders.'),
        mk(3, 'Binnen, nog te plannen', 'naast wat nog niet binnen is.'),
        mk(4, 'Status:', 'Volledig leverbaar of Deels leverbaar.'),
        mk(5, 'Levering plannen:', 'gaat direct door naar de levering.'),
      ] },
      { t: 'p', text: 'Bovenaan kies je de periode: Deze maand, Laatste 3 maanden, Dit jaar of Van t/m.' },
    ],
  },

  kassabeheer: {
    chapter: '10.2', title: 'Kassa: factuuroverzicht en dagafsluiting',
    blocks: [
      { t: 'why', text: 'Aan het eind van de dag de kas opmaken, per bedrijf: geteld contant tegenover het systeem.' },
      { t: 'img', src: shot('10-dagafsluiting'), cap: 'Dagafsluiting voor Bella.' },
      { t: 'steps', items: [
        mk(1, 'Bedrijf:', 'Bella of HDB. Elk bedrijf sluit apart af.'),
        mk(2, 'Dag:', 'staat op vandaag.'),
        mk(3, 'Volgens het systeem:', 'aantal bonnen, omzet, contant en pin.'),
        mk(4, 'Telling contant:', 'tel de kas en vul per biljet en munt het aantal in.'),
        mk(5, 'Verschil contant:', 'groen "klopt", of het verschil.'),
        mk(6, 'Pin volgens de pinautomaat.', ''),
        mk(7, 'Afgestort:', 'wat naar de bank of kluis gaat. De rest blijft als wisselgeld voor morgen.'),
        mk(8, 'Toelichting:', 'verplicht bij een verschil.'),
        mk(9, 'Opgemaakt door:', 'kies jezelf en klik op Dag afsluiten. Daarna kan niets meer wijzigen. Druk de dagstaat af en laat hem tekenen.'),
      ] },
      { t: 'p', text: 'Het tabblad Factuuroverzicht kassa toont per bedrijf alle kassabonnen en creditbonnen, met totalen per betaalwijze.' },
    ],
  },

  catalogi: {
    chapter: '10.3', title: 'Catalogi en artikelkaart',
    blocks: [
      { t: 'img', src: shot('10-catalogi'), cap: 'Catalogus van een leverancier.' },
      { t: 'steps', items: [
        mk(1, 'Leverancier:', 'kies de catalogus.'),
        mk(2, 'Serie, categorie en zoekveld', 'om gericht te zoeken.'),
        mk(3, 'Artikelnummer:', 'eerst ons eigen nummer, daaronder dat van de leverancier en de EAN. Ons nummer wijzigt nooit.'),
        mk(4, 'Beschikbaar in magazijn en prijs', 'volgens de leverancier.'),
        mk(5, 'Elementen:', 'wat je bij dit artikel kunt bestellen.'),
        mk(6, 'Catalogus inlezen (CSV):', 'alleen voor de beheerder. De catalogi worden ook elke nacht bijgewerkt.'),
      ] },
      { t: 'h', text: 'De artikelkaart' },
      { t: 'img', src: shot('10-artikelkaart', [406, 30, 692, 670]), cap: 'Klik op een artikel: de artikelkaart opent.', narrow: true },
      { t: 'steps', items: [
        mk(1, 'Foto', 'van de leverancier.'),
        mk(2, 'Nummers:', 'ons artikelnummer, dat van de leverancier en de EAN.'),
        mk(3, 'Leverancier, serie, categorie, beschikbaarheid en prijs.', 'Klik op de serie voor alle artikelen ervan.'),
        mk(4, 'Status:', '"Nog niet verkocht" wordt een product zodra het op een verkooporder komt.'),
        mk(5, 'Product specificaties', 'van de leverancier.'),
        mk(6, 'Elementen:', 'wat erbij besteld kan worden. Onderaan: Bekijk in de showroom en Sluiten.'),
      ] },
    ],
  },

  instellingen: {
    chapter: '10.4', title: 'Instellingen',
    blocks: [
      { t: 'img', src: shot('10-instellingen', [228, 64, 1080, 300]), cap: 'Instellingen, tabblad Magazijnen.' },
      { t: 'steps', items: [
        mk(1, 'Magazijnen:', 'de drie locaties (7). Nieuwe locatie: Magazijn toevoegen (8).'),
        mk(2, 'Leveranciers:', 'naam, adres, land (Spanje slaat Ontvangen in NL en Transport over), e-mail voor inkooporders, levertijd en de afkorting van drie letters van ons artikelnummer. Wijzig de afkorting HDB nooit.'),
        mk(3, 'Toeslagen:', 'per leverancier een percentage op de prijs voor transport naar Spanje.'),
        mk(4, 'Klanten:', 'de klantenlijst met zoekveld. De vaste klant Kassaverkoop is voor verkopen zonder klantgegevens.'),
        mk(5, 'Medewerkers:', 'naam, e-mail, telefoon, actief en rol (Verkoper, Administratie of Beheerder). Inloggen kan alleen met het e-mailadres dat hier staat.'),
        mk(6, 'Bedrijf en factuur:', 'zie het onderwerp Bedrijf en factuur.'),
      ] },
      { t: 'see', topic: 'bedrijf-factuur', text: 'Bedrijf en factuur' },
    ],
  },

  'bedrijf-factuur': {
    chapter: '10.4', title: 'Bedrijf en factuur',
    blocks: [
      { t: 'p', text: 'Dit tabblad bestaat uit panelen onder elkaar. Klik na een wijziging altijd op Opslaan, rechtsonder.' },
      { t: 'img', src: shot('10-bedrijf-1'), cap: 'Bedrijfsgegevens en Factuur.' },
      { t: 'steps', items: [
        mk(1, 'Bedrijfsgegevens:', 'juridische naam, CIF, adres, postcode, plaats, provincie, telefoon en e-mail.'),
        mk(2, 'Handelsnaam:', 'de naam op documenten en in mails. Leeg is de juridische naam.'),
        mk(3, 'Factuur:', 'IBAN, betaaltermijn in dagen en een vaste tekst onderaan de factuur.'),
        mk(4, 'Opslaan.', ''),
      ] },
      { t: 'img', src: shot('10-bedrijf-2'), cap: 'Afleverbon, Taal van documenten, Mailen aan de klant.' },
      { t: 'steps', items: [
        mk(5, 'Soort afleverbon:', 'Papier, geprint, of Digitaal (tekenen in de chauffeursapp).'),
        mk(6, 'Taal van documenten:', 'per document de afdruktaal. Standaard de taal van de klant; de kassabon Spaans.'),
        mk(7, 'Mailen aan de klant:', 'welke documenten Bella Flow vanzelf mailt. Met de hand mailen kan altijd.'),
        mk(8, 'Winkel e-mail:', 'afzender en antwoordadres; krijgt een kopie van elk gemaild document.'),
        mk(9, 'Kassa: afdrukken.', ''),
      ] },
      { t: 'img', src: shot('10-bedrijf-3'), cap: 'Kassa: afdrukken en de gegevens van beide bedrijven.' },
      { t: 'steps', items: [
        mk(10, 'Eenvoudige factuur afdrukken:', 'op A4, of als kassabon op de bonprinter van 80 mm. Ook voor retouren aan de kassa.'),
        mk(11, 'Kassa: Bella:', 'logo en beeldmerk op de kassabon van Bella.'),
        mk(12, 'Kassa: HDB:', 'de juridische gegevens van Handmade Bali Treasures SL.'),
        mk(13, 'Logo HDB', 'en daaronder het beeldmerk.'),
      ] },
      { t: 'img', src: shot('10-bedrijf-4'), cap: 'Shopify van HomeDecoBali, Documentnummers en Testperiode.' },
      { t: 'steps', items: [
        mk(14, 'Shopify van HomeDecoBali:', 'elke kassaverkoop van HDB gaat als bestelling naar Shopify. Aan of uit, meteen betaald of niet, en de naam van de winkel.'),
        mk(15, 'Documentnummers:', 'het voorvoegsel van elke reeks. Een nieuw voorvoegsel geldt alleen voor nieuwe documenten; de teller loopt door.'),
        mk(16, 'Testperiode:', 'zolang Bella Flow niet live is.'),
      ] },
      { t: 'img', src: shot('10-bedrijf-5'), cap: 'Testperiode en Jaarafsluiting.' },
      { t: 'steps', items: [
        mk(17, 'Testgegevens wissen:', 'haalt alle verkoop, inkoop, facturen en voorraad weg; elke reeks begint weer bij 0001. Instellingen, leveranciers, medewerkers en catalogi blijven.'),
        mk(18, 'Live zetten:', 'op de dag dat Bella Flow echt in gebruik gaat. Daarna kan wissen nooit meer.'),
        mk(19, 'Open boekjaar:', 'het jaar in elk nieuw nummer. Afsluiten kan vanaf 1 januari van het volgende jaar.'),
        mk(20, 'Laatst gebruikte nummers', 'per reeks.'),
      ] },
      { t: 'note', items: ['Bij Testperiode en Jaarafsluiting typ je een woord in en bevestig je twee keer: niet ongedaan te maken. Overleg fiscale vragen met de gestor.'] },
    ],
  },
}
