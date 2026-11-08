# Ricarica A4 (charge-locator)

Web app installabile su smartphone (PWA) che mostra le colonnine di ricarica nelle **aree di servizio dell'autostrada A4 Torino–Trieste**: presenza, numero di punti, potenza, tipo di connettore, operatore e stato dichiarato. Rileva la tua posizione, ordina le aree per distanza e apre la navigazione in **Google Maps**, **Waze** o **Apple Mappe**.

## Cosa fa

- Elenco e mappa delle aree di servizio A4 con colonnine, separate per carreggiata ("→ Trieste" / "← Torino").
- Ordinamento per distanza in linea d'aria dalla tua posizione (geolocalizzazione del browser, aggiornata in continuo).
- Se sei in movimento, propone la direzione di marcia in base alla rotta GPS.
- Filtri: direzione, potenza minima, connettore (CCS, CHAdeMO, Tipo 2, Tesla/NACS), solo colonnine dichiarate in servizio.
- Per ogni stazione: operatore, connettori × quantità × kW, stato con data dell'ultimo aggiornamento, costo se dichiarato, link alla scheda OCM e al sito dell'operatore.
- Navigazione con link costruiti secondo la documentazione ufficiale:
  - Google Maps URLs: <https://developers.google.com/maps/documentation/urls/get-started>
  - Waze Deep Links: <https://developers.google.com/waze/deeplinks>
  - Apple Maps unified URLs: <https://developer.apple.com/documentation/mapkit/unified-map-urls>
- Funziona offline con l'ultima copia scaricata dei dati (service worker).

## Limiti dei dati (da leggere)

| Aspetto | Situazione | Fonte |
|---|---|---|
| **Stato in tempo reale** (libera/occupata) | **Non disponibile** da fonti pubbliche aperte. Lo stato mostrato è quello *dichiarato* in OCM ("In servizio", "Fuori servizio", ecc.). Solo gli stati OCM 10 e 20 sono automatici e vengono segnati come tali. Prima di deviare, controlla nell'app dell'operatore. | Forum OCM (comunitario): <https://community.openchargemap.org/t/get-charging-spot-in-use-for-a-charging-station/194> |
| Colonnine | Open Charge Map, database comunitario **non ufficiale**. Può essere incompleto o non aggiornato: se una colonnina manca in OCM, manca anche qui. | <https://openchargemap.org/site/about/terms> |
| Elenco aree di servizio | La versione attuale è ricavata dai testi OCM (aree che citano esplicitamente A4 o "Serenissima"). Contiene solo le aree che in OCM hanno almeno una colonnina, e la carreggiata è a volte dedotta dal nome (indicato nell'app). Per un elenco completo da OpenStreetMap vedi "Aggiornare l'elenco aree". | `data/a4-areas.json` |
| Fonte ufficiale nazionale | La [Piattaforma Unica Nazionale (MASE/GSE)](https://www.piattaformaunicanazionale.it/) non pubblica un'API documentata né una licenza di riuso, quindi non è integrata. Nell'app c'è il link per la verifica manuale. | Verifica del 7/11/2026 |
| Distanze | In linea d'aria, non su strada. | — |

Accesso allo stato in tempo reale, possibili strade future: accordo con il GSE per i dati PUN, oppure feed OCPI degli operatori (Free To X, Electra, Ionity, Ewiva, Be Charge…). Di norma gli operatori li concedono solo a partner commerciali.

## Architettura

```
public/              PWA statica (HTML/CSS/JS moduli, nessun build step)
  js/lib/            logica pura condivisa con il server (geo, aree, filtri, deep link)
  vendor/leaflet/    Leaflet 1.9.4 (BSD-2), copiato da npm per funzionare offline
  sw.js              service worker
api/stations.js      funzione serverless Vercel: interroga OCM, associa le colonnine alle aree, cache 30 min
server/stations.js   logica della funzione (testabile)
data/a4-areas.json   elenco aree di servizio A4 (generato)
scripts/             generazione elenco aree e server di sviluppo locale
tests/               test (node:test) su dati OCM reali in tests/fixtures
```

Una colonnina è attribuita a un'area se si trova entro 350 m dal suo centro. Le due carreggiate distano spesso meno di 200 m, quindi se il testo OCM nomina l'area (es. "Valtrompia Nord") quel nome prevale sulla pura vicinanza.

La chiave OCM resta sul server: il browser chiama solo `/api/stations`.

## Avvio in locale

Requisiti: Node.js ≥ 20 e una chiave API gratuita di Open Charge Map (<https://openchargemap.org>, profilo → *My Apps*).

```bash
OCM_API_KEY=la-tua-chiave node scripts/dev-server.mjs 3000
# poi apri http://localhost:3000
npm test
```

La geolocalizzazione richiede HTTPS, oppure `localhost`.

## Pubblicazione su Vercel

1. Su Vercel: *Add New → Project* → importa `mfurlanetto/charge-locator`. Framework: *Other*. Nessun comando di build.
2. *Settings → Environment Variables*: `OCM_API_KEY` = la tua chiave (Production e Preview).
3. Deploy. L'app sarà su `https://<progetto>.vercel.app`.
4. Sul telefono: apri l'URL → *Condividi → Aggiungi a Home* (iOS) oppure *Installa app* (Android/Chrome).

## Aggiornare l'elenco aree

```bash
OCM_API_KEY=... node scripts/build-areas.mjs --source=auto   # prova OSM/Overpass, ripiega su OCM
node scripts/build-areas.mjs --source=osm                     # solo OpenStreetMap (ODbL)
```

Il workflow GitHub `refresh-areas` lo esegue ogni mese e apre una pull request. Richiede il secret `OCM_API_KEY` nel repository.
**Nota:** il percorso OpenStreetMap non è stato verificato durante lo sviluppo, perché Overpass non era raggiungibile dall'ambiente di lavoro. Controlla il risultato della prima esecuzione prima di unire la PR.

## Licenze e attribuzioni

- Dati colonnine: © Open Charge Map contributors e fornitori indicati per ogni stazione, **CC BY 4.0**. I termini OCM chiedono di mostrare all'utente il fornitore del dato e la sua licenza: l'app lo fa nel dettaglio di ogni stazione.
- Mappa: © OpenStreetMap contributors (ODbL). Le tile di `tile.openstreetmap.org` sono soggette alla [Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/): vanno bene per uso personale, ma per un uso pubblico intenso serve un fornitore di tile dedicato.
- Leaflet: BSD-2-Clause (`public/vendor/leaflet/LICENSE`).
- Codice: MIT.
