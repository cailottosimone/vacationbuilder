# Vacation Builder — v42 (Backup dentro Impostazioni)

Registro personale di viaggio, offline (tranne mappe, geolocalizzazione, routing e Font Awesome,
online per natura). Installabile come PWA.

## Novità v42

- **Backup è ora una scheda di Impostazioni**, invece di una voce a sé nel menu — stessa
  esportazione/importazione di sempre, stesso comportamento, solo raggiungibile da Impostazioni →
  Backup. Libera uno slot nel menu laterale.
- Il titolo della pagina Impostazioni ora cambia in base alla scheda aperta (prima restava fisso
  su "Categorie riutilizzabili" anche su Routing o Navigazione — un'incongruenza preesistente
  diventata più evidente aggiungendo Backup, quindi l'ho sistemata insieme).
- Nessun impatto sui dati: chi aveva "Backup" nascosto dal menu in Impostazioni → Navigazione non
  nota differenze, quella preferenza salvata resta semplicemente inutilizzata.

## Novità v41 — rifiniture su Esplora

- **Bug della sovrapposizione risolto anche in modalità Coordinate**, non solo in "Posizione
  attuale" come nella v40: il segnalino "Riconosciute: ..." finiva dentro l'input perché stava
  annidato nello stesso `.field` dell'input invece che fuori, come accade correttamente nei form
  Destinazione/Tappa. Ora la struttura è la stessa ovunque.
- **Sidebar riorganizzata in tre sezioni pieghevoli** (Punto di partenza, Distanza e tempo,
  Filtri), per non far crescere la colonna in verticale: ognuna mostra un riepilogo di quello che
  contiene anche da chiusa (es. "Punto di partenza · Vicenza", "Distanza e tempo · entro 50 km",
  "Filtri · 2 attivi"), così sai cosa hai impostato senza doverle riaprire.
- **La linea d'aria ora ha lo stesso trattamento visivo degli altri filtri di distanza/tempo**
  (stessa riga, stesso stile di campo), dentro "Distanza e tempo" insieme ad auto e a piedi,
  invece di essere un campo isolato e più grande sopra a tutto il resto. Resta comunque lei a
  decidere quali destinazioni calcolare — è l'unica che evita di sprecare chiamate al servizio di
  routing per cose troppo lontane — ma non deve più sembrare un cittadino di serie A rispetto agli
  altri filtri.
- **Tolta la dicitura sul treno**: non aggiungeva nulla, l'assenza si nota da sé.
- **Il risultato torna a includere la destinazione di partenza** (quando parti da una
  destinazione dell'archivio): ora che le tappe a cascata esistono, ha senso rivederla in elenco
  con le sue tappe espandibili, invece di nasconderla.
- **Card di risultato**: la colonna dei risultati ora ha lo stesso contorno della colonna dei
  filtri (stesso stile di card), anche da vuota — prima "Nessuna destinazione trovata" era testo
  nudo senza cornice, sbilanciato rispetto alla sidebar accanto.

## Novità v40 — restyling Esplora

- **Layout a due colonne**: filtri in una colonna fissa a sinistra (sticky), risultati a destra
  a piena larghezza — prima tutto il form era incapsulato in un blocco largo 680px fisso, anche
  su schermi larghi.
- **Raggio di ricerca**: input stretto con "km" accanto, non più un campo a piena larghezza per
  un numero di poche cifre.
- **Filtri sui tempi di viaggio**: rifatti in coppie Km/Min per Auto e A piedi, stesso peso
  visivo per ognuno. Prima la riga usava lo stesso componente a griglia della barra di ricerca
  degli elenchi (pensato per "campo di testo largo + select strette"), che qui gonfiava "Km linea
  d'aria" a dismisura rispetto agli altri tre campi. Quel campo era anche un doppione — il Raggio
  già filtra sulla linea d'aria — quindi è stato rimosso, e al suo posto è comparso "Min a piedi",
  che esisteva già nei dati salvati ma non era mai stato collegato a un campo.
- **Posizione attuale**: risolta la sovrapposizione tra il bottone "Rileva posizione" e l'avviso
  sotto — un margine negativo pensato per l'input testuale delle coordinate veniva riusato anche
  qui, dove non c'entrava.
- **Niente più la destinazione di partenza tra i risultati**: cercare nei dintorni di una
  destinazione ora esclude quella stessa destinazione dall'elenco.
- **Tappe a cascata**: ogni destinazione con tappe salvate è espandibile (freccetta a sinistra) e
  mostra le sue tappe subito sotto, rientrate; sia la destinazione sia ogni tappa sono cliccabili
  e portano alla scheda della destinazione. Le tappe si caricano solo quando espandi una riga, non
  tutte in anticipo.
- **Mappa sotto la tabella** invece che sopra, così i risultati restano il primo contenuto che
  incontri.

## Novità v39 — ordine Home, respiro, naming Esplora

- **Home**: "Comincia da qui" ora viene prima di "Vacanza in evidenza" — le azioni rapide sono il
  motivo per cui apri la Home, la vacanza in evidenza è un'informazione, non un'azione: giusto
  che sia la prima cosa cliccabile che incontri.
- **Respiro dei titoli, non solo nelle card**: il blocco eyebrow/titolo/nota riusato in cima a
  *ogni* pagina dell'app (non solo Home) aveva margini troppo stretti — un'etichetta di 11px
  attaccata a un titolo di 30px si legge peggio. Aumentati leggermente i distacchi verticali. Lo
  stesso per i riquadri della Home (cruscotto, card "Comincia da qui", titoli di sezione): più
  aria tra numero ed etichetta, tra icona/titolo/descrizione, tra un blocco e il successivo.
- **"Ho una giornata libera" → "Esplora i dintorni"**: il titolo precedente citava l'esempio del
  brief originale ma non rendeva chiaro cosa fa davvero quella sezione. Il nuovo titolo rispecchia
  il nome della sezione (Esplora) a cui porta, con la spiegazione concreta nel testo sotto.

## Novità v38 — Home

La Home era finora uno stub vuoto. Ora è il punto di ingresso previsto dal progetto: i tre modi
di cominciare (Esplorazione, Stato d'animo, Progettazione vacanza), più un cruscotto e un modo
per rientrare veloce in quello che stavi facendo.

- **Cruscotto**: numero di destinazioni, tappe e vacanze in archivio, in tre riquadri.
- **Vacanza in evidenza**: mostra sempre la vacanza più rilevante in questo momento, con una
  logica a cascata — se una è in corso oggi, quella; altrimenti la prossima futura più vicina, se
  hai impostato le date; altrimenti quella su cui hai lavorato più di recente ("Riprendi da
  qui"), così la sezione ha sempre senso anche se non pianifichi mai con date precise.
- **Comincia da qui**: le tre card previste dal progetto — "Ho una giornata libera" porta a
  Esplora (già pronta); "Voglio organizzare una vacanza" apre subito il form di una nuova
  vacanza; "Voglio una giornata relax" è visibilmente segnata **In arrivo** e spiega perché non
  è ancora lì (serve prima costruire gli indicatori numerici — Relax, Natura, Cultura... — su
  tappe e destinazioni, che è un pezzo di modello dati a sé, rimandato di proposito su tua
  indicazione).
- **Aggiunte di recente**: le ultime destinazioni e tappe create, per rientrare veloce dove
  stavi lavorando senza dover cercare.

Riusa interamente il sistema di card della v36/v37 (la vacanza in evidenza è la stessa
`vacCardHtml` dell'elenco Vacanze, le righe recenti sono lo stesso `item-row` di
Destinazioni/Vacanze): nessun componente visivo nuovo da mantenere a parte i tre pezzi specifici
di questa pagina (riquadri del cruscotto, card di ingresso "Comincia da qui").

Un effetto collaterale utile sistemato per farlo funzionare: cliccare una destinazione o una
vacanza da fuori le rispettive sezioni (cioè dalla Home) ora cambia correttamente la vista attiva
nel menu — prima quell'azione dava per scontato di essere già dentro Destinazioni o Vacanze, cosa
sempre vera finché non è esistito un altro punto da cui selezionarle.

## Novità v37 — fix card Vacanze e respiro card Tappa

- **Card Vacanze**: i badge delle destinazioni toccate finivano troncati con una barra di
  scorrimento orizzontale, sia in griglia che a righe. Causa: un vincolo di larghezza
  (`max-width: 40%; overflow-x: auto`) pensato per il vecchio layout a riga singola non
  interrotta — ormai obsoleto da quando le righe elenco vanno a capo. Rimosso: ora badge e stat
  vanno semplicemente a capo, niente più scroll, su desktop e mobile.
- **Card Tappa**: badge, durata, coordinate e nota erano attaccati tra loro perché la card non
  era un contenitore con spaziatura automatica — dipendeva da margin messi a mano, e diversi
  elementi ne erano rimasti senza. Ora la card è un contenitore verticale con respiro costante
  tra ogni blocco; durata e coordinate, essendo due micro-dati imparentati, stanno appaiate sulla
  stessa riga invece di impilate.

## Novità v36 — sistema di card condiviso

Questa versione non tocca modello dati né IndexedDB: è un intervento solo di presentazione,
mirato alle card di tutta l'app (Destinazioni, Vacanze, Tappe, giorni del planner).

- **Un solo sistema di badge e "stat" riusato ovunque**, al posto di quattro varianti diverse
  che si erano accumulate nel tempo (`categoria-badge`, `stamp`/`stamp-vuoto`,
  `item-card-meta`/`item-row-meta`/`tappa-card-meta`, il residuo morto `badge-tipo-vacanza` di
  quando esisteva ancora la distinzione fissa/itinerante): ora ci sono solo `.badge` (appartenenza:
  categoria, tipo, destinazione) e `.card-stat` (dato riassuntivo con icona, stesso stile già
  usato nell'header di una Destinazione per "N tappe" — riusato invece di reinventarlo). Una
  variante "muted" per l'uno e per l'altro copre le informazioni secondarie (tipo non principale
  di una tappa, "nessuna tappa ancora" su un giorno).
- **Le card Vacanza, prima quasi vuote (solo nome e "N giorni"), ora mostrano**: il periodo, se
  hai impostato le date; il numero di persone, se più di una; le destinazioni toccate
  dall'itinerario (fino a 3, poi "+N") — utile soprattutto nell'elenco a griglia/righe per
  distinguere colpo d'occhio una vacanza dall'altra senza aprirla.
- **Le card Tappa mostrano il tipo principale come badge vero** (prima compariva solo nel titolo
  del gruppo sopra, invisibile se la card viene vista fuori contesto), e i tipi secondari sono
  badge "muted" invece di una riga di testo semplice "anche: X".
- **I giorni del planner mostrano anche quante voci hanno pianificate** accanto alla data (es.
  "Giorno 2 · mer 12 ago · 3 voci"), e le destinazioni toccate sono ora badge veri invece del
  vecchio "timbro" (`.stamp`) dedicato solo a quel punto dell'app.
- **Hover coerente su tutte le card cliccabili**: alle card della timeline (Partenza, Tappa,
  Spostamento, Rientro) mancava del tutto un feedback al passaggio del mouse, unica card
  dell'app a non averlo — ora ha un'ombra leggera, senza lo spostamento verticale delle altre
  card (qui non serve: il click avviene sempre da un bottone esplicito, non dalla card intera).
- **Gerarchia dimensionale delle card confermata, non appiattita**: i tre raggi di bordo
  (`--radius-l` per le card "vetrina" di un elenco, `--radius-m` per le card annidate/di lavoro,
  `--radius-s` per input e bottoni) restano tre livelli distinti apposta — è quella la gerarchia
  visiva richiesta, uniformarli tutti allo stesso valore l'avrebbe cancellata invece di
  rinforzarla.

Una scelta lasciata così com'era, di proposito: le card **Tappa** restano senza un riquadro
segnaposto quando manca la foto (a differenza di Destinazione/Vacanza, che ne hanno sempre uno).
Sono card più dense, tante per pagina, spesso senza foto (un incrocio, un belvedere): riservare
comunque lo spazio dell'immagine le avrebbe appesantite senza motivo. Se preferisci vederle
allineate anche su questo, è un cambio piccolo e mirato.

## Novità v35

- **"+ Nuova tappa" anche nei form Partenza e Rientro**: stesso meccanismo già introdotto per
  "Pianifica una tappa" — crei la tappa al volo senza uscire dal flusso, torni dritto al form con
  quel riferimento già scelto.

Non l'ho aggiunto anche al form Spostamento: lì ci sono due riferimenti (Da/A) invece di uno solo,
e non era comunque nella richiesta — se ti serve anche lì, dimmelo e vedo il modo più pulito per
gestire la scelta tra i due campi.

## Novità v34

- **Mappa del giorno**: nel Programma, un bottone "Mostra mappa del giorno" (appare solo se ci
  sono voci con coordinate) apre una mappa con tutte le tappe della giornata — incluse Partenza e
  Rientro, risolte verso il loro riferimento — collegate da una linea nell'ordine della giornata,
  per capire il percorso a colpo d'occhio. Stesso interruttore "appare/scompare" già usato per le
  mappe di tappa e destinazione.
- **Aggiunta rapida di una tappa mentre pianifichi**: nel form "Pianifica una tappa" un bottone
  "+ Nuova tappa" apre la creazione di una tappa al volo (senza uscire dalla vacanza), preselezionando
  la destinazione se avevi già filtrato, e tornando dritto al form di pianificazione con la tappa
  appena creata già scelta.
- **Lista**: "Generale (valigia)" rinominata "Lista Vacanza", via il riempimento nero da inattiva
  (sembrava un avviso) — ora ha più peso solo tramite icona e grassetto, diventa piena solo
  quando selezionata come tutte le altre.
- **Fix centraggio "Alloggi"**: il pannello richiudibile aveva un padding inferiore che restava
  anche da chiuso, spingendo il testo verso l'alto invece di centrarlo.

## Novità v33

- **Via il checkbox "Segui il numero di persone della vacanza"**: era blu e sembrava un bottone
  da premere, quando nel 99% dei casi va lasciato stare. Ora è testo informativo ("Segue la
  vacanza: 4") con un link "Personalizza" per chi vuole davvero cambiarlo — l'azione richiede un
  gesto esplicito invece di un controllo sempre visibile che invitava al click.
- **Fix vero (non un aggiramento) della perdita di Descrizione/Categoria/Voce collegata** al
  cambio di modalità spesa: prima l'intero form veniva rigenerato a ogni cambio, ora solo il
  riquadro dell'importo si aggiorna da solo, il resto del form resta intatto.
- **Etichetta "Voce collegata"** accorciata (era "Collegata a una voce"): andava a capo e
  sfalsava l'allineamento con "Categoria" di fianco.
- **Lista**: "Generale · valigia" ora ha un peso visivo maggiore (sempre in tono scuro, separata
  da un divisore) rispetto ai giorni, che restano uniformi tra loro. I giorni mostrano anche la
  data quando la conosciamo.
- **Alloggi della vacanza**: da sezione con sfondo blu sempre in vista, a pannello richiudibile
  (chiuso di default) con colori neutri e un elenco in tabella invece dei chip colorati.

## Novità v32 — revisione importante del modello

- **Via la distinzione "Un luogo" / "Itinerante"**: ora c'è solo Vacanza. Un giorno non ha più
  una destinazione fissata a monte: le destinazioni "toccate" da un giorno si deducono da quali
  tappe ci pianifichi dentro. Puoi benissimo avere una tappa a metà strada da una destinazione
  diversa da quella principale — esattamente il caso della sosta a 3 ore che citavi.
- **Le tappe si scelgono ora da qualsiasi destinazione dell'archivio**, con un filtro per
  destinazione sopra il selettore (di base "tutte", puoi restringere). Stesso filtro aggiunto
  anche nel selettore degli alloggi del pool.
- **Alloggi sempre a pool** (scelta per giorno), unificato per tutte le vacanze — prima era un
  meccanismo diverso per "un luogo" e "itinerante".
- **Giorni limitati alle date**: se imposti sia data di inizio sia data di fine della vacanza,
  non puoi pianificare più giorni di quanti ce ne stiano nel periodo — il bottone "+" diventa
  un indicatore "N/N" quando raggiungi il limite.
- **Data calcolata per ogni giorno**: se hai impostato la data di inizio, "Giorno N" mostra
  sempre anche la data (dedotta automaticamente, non più da inserire a mano).
- **Foto sulla Vacanza**: galleria + copertina, stesso meccanismo di Destinazioni e Tappe.

## Effetti collaterali di questa revisione, da sapere

- **Eliminare una Destinazione ora è meno distruttivo**: prima, cancellare la destinazione di
  una vacanza "un luogo" cancellava l'intera vacanza. Ora, dato che un giorno può toccare più
  destinazioni insieme, eliminando una destinazione si eliminano solo le sue tappe — le vacanze e
  i giorni restano intatti, le voci che referenziavano quelle tappe mostrano "tappa eliminata"
  (stesso comportamento già in uso per l'eliminazione di una singola tappa).
- **Vacanze esistenti**: quelle già create restano perfettamente funzionanti. Il vecchio campo
  "tipo" (fissa/itinerante) semplicemente non viene più letto; gli alloggi di una vecchia vacanza
  "un luogo" andranno reimpostati nel pool se vuoi che tornino a comparire (prima erano in un
  campo separato, ora tutto passa dal pool).
- **Niente più data manuale per un singolo giorno**: prima esisteva un campo dedicato (mai
  esposto in interfaccia, in realtà) — ora la data si calcola sempre dalla data di inizio della
  vacanza più la posizione del giorno, un'unica fonte di verità invece di due valori che
  potevano disallinearsi.

## Novità v31

- **La stampa del Budget non includeva affatto le voci Lista con un costo** — il fix della v30
  aveva sistemato solo la vista a schermo, non la generazione del PDF, che pescava ancora solo le
  Spese vere e proprie. Ora la stampa mostra anche le voci Lista, etichettate **"da Lista"**
  accanto a Condivisa/Extra, esattamente come già succede a schermo.

## Novità v30

- **Voci Lista con costo non comparivano sempre nella tabella Budget.** La tabella pescava solo
  dall'elenco "Extra" del riepilogo, che esclude di proposito le voci "condivise" (quelle il cui
  conteggio finisce già nel totale condiviso). Il numero contava comunque nel totale generale, ma
  la riga spariva dalla vista — sembrava che il costo fosse stato ignorato, non lo era. Ora la
  tabella elenca sempre tutte le voci Lista con un costo che conta, condivise o extra che siano,
  con l'etichetta giusta accanto.
- **Stampa della Lista**: se ci sono voci con un costo che conta nel totale, in cima compare ora
  una nota — "i prezzi indicati qui sono già inclusi nel totale del Budget" — per non rischiare di
  sommarli due volte leggendo i due fogli separatamente.

## Novità v29

- **"Totale a persona" nel riepilogo Budget arrotondato per eccesso**, come tutte le altre
  divisioni: ora è sempre un numero tondo, mai con i centesimi.
- **Stampa/PDF: scegli cosa includere ogni volta**. Il bottone "Stampa / PDF" ora apre prima un
  piccolo pannello con tre spunte — Programma, Budget, Lista — così decidi tu volta per volta se
  ti serve solo il piano, solo i conti, solo cosa portare, o tutto insieme.

## Novità v28

- **Bug reale in `updateListaVoce`**: a differenza di `updateSpesa`, non convertiva i valori del
  form (sempre stringhe) in numeri prima di salvarli. Modificando una voce Lista con un costo, il
  numero finiva salvato come testo ("50" invece di 50): al calcolo successivo, `.toFixed()` su una
  stringa va in errore — esattamente quello che hai visto. Corretto: ora converte come si deve.
- **Reso il calcolo resiliente anche in lettura**: se hai già una voce salvata con questo bug (dal
  tempo prima di questa versione), ora si autocorregge da sola al primo ricalcolo, senza che tu
  debba ricrearla da zero.

## Novità v27

- **La Lista ora usa esattamente la stessa logica della Spesa**: secco, a persona, o la nuova "da
  dividere" — stessa struttura, stesso comportamento, nessuna differenza tra le due. Le vecchie
  voci lista con un costo semplice sono migrate in automatico alla modalità "secco" equivalente,
  nessun dato perso.
- **Nuova modalità "Da dividere"**: inserisci il totale, viene diviso per il numero di persone.
  La quota a testa è sempre arrotondata **per eccesso** (mai per difetto): 100€ ÷ 3 persone dà
  34€ a testa, non 33€, così non ti ritrovi a fine vacanza con meno di quanto speso davvero. Il
  totale che conta nel Budget resta comunque quello reale che hai inserito, non quello arrotondato
  — l'arrotondamento è solo un riferimento per dividere i conti, non altera la spesa vera.
- **Numero di persone che segue la vacanza**: di default, ogni spesa/voce "a persona" o "da
  dividere" ha un interruttore "Segui il numero di persone della vacanza" acceso — se cambi il
  numero di persone della vacanza (nel form di modifica), tutte le spese/voci in modalità
  automatica si aggiornano da sole, senza doverle ritoccare una per una. Se lo spegni e scrivi un
  numero tuo, quello resta fisso per sempre su quella voce specifica, qualunque cosa succeda alla
  vacanza dopo. Un avviso compare solo se il numero che scrivi supera quello della vacanza (sotto
  è normale, es. una spesa singola).
- **Nota sulle spese già esistenti**: quelle create prima di questa versione avevano già un
  numero di persone esplicito salvato — restano così (override fisso), non passano
  retroattivamente alla modalità automatica. Puoi comunque modificarle e accendere l'interruttore
  se preferisci.

## Novità v26

La pagina di ogni vacanza ora ha tre sotto-sezioni: **Programma** (quello che c'era già),
**Budget** e **Lista**.

- **Budget**: aggiungi spese come "totale secco" (es. hotel 1000€) o "a persona" (es. terme 45€ ×
  1), collegabili opzionalmente a una tappa/spostamento specifico di un giorno, o lasciate
  generali. Le spese "a persona" con lo stesso numero di persone della vacanza sono **condivise**
  (danno un vero costo a testa); tutto il resto — spese secche, o "a persona" con un numero
  diverso — finisce negli **Extra**, elencato voce per voce invece che schiacciato in una media
  fuorviante. Categorie di spesa gestibili da Impostazioni, stesso pattern di
  Categorie destinazioni/Tipi di tappa.
- **Lista**: una lista generale per vacanza (la valigia) più una per ciascun giorno. Ogni voce ha
  una spunta fatto/da fare e un costo opzionale; se c'è un costo, entra di default negli Extra del
  Budget, con una spunta per escluderla.
- **Numero di persone** sulla vacanza (nel form di modifica), usato per capire quali spese sono
  davvero condivise.
- Eliminando una voce del giorno che ha una spesa collegata, un avviso lo segnala prima di
  procedere (prima l'eliminazione era sempre immediata, ora solo se non c'è nulla da perdere).

Non incluso in questo giro, per restare nello scopo concordato: nessun riepilogo costi nel PDF di
stampa (dimmi se lo vuoi, è un'aggiunta piccola) e nessuna gestione preventivo/scostamento
(solo tracciamento di quanto pensi di spendere).

## Novità v25

- **Fix overflow nell'elenco Destinazioni**: una categoria con nome lungo poteva spingere la
  freccetta fuori dalla card e far scorrere in orizzontale l'intero sito. Titolo ora con
  ellissi se troppo lungo, badge categoria contenuti in un'area con scroll proprio invece di
  allargare la riga. Aggiunta anche una rete di sicurezza generale (`overflow-x: hidden` sul
  canvas) contro casi simili in futuro.
- **Stampa / PDF**: nuovo bottone nella pagina Vacanza. Genera una vista pulita — recap
  all'inizio (destinazione/i, alloggio/i, durata) e poi il programma giorno per giorno con
  orari calcolati, nomi e note — e apre la finestra di stampa del browser, da cui si sceglie
  "Salva come PDF" (o si stampa davvero). Nessuna libreria PDF aggiunta: sfrutta il motore di
  stampa già integrato nel browser, più affidabile di qualunque libreria e senza dipendenze in
  più da scaricare.

## Novità v24 — fix da screenshot reali su iPhone

Tutte le correzioni restano dentro il media query mobile: il CSS desktop non cambia di una riga.

- **Safe-area (Dynamic Island/status bar)**: avevo attivato `viewport-fit=cover` senza il
  padding di sicurezza corrispondente, così il contenuto in cima alla pagina finiva sotto
  l'orologio/Dynamic Island. Aggiunto `padding-top: env(safe-area-inset-top)` al contenuto e al
  cassetto laterale.
- **Tab di Impostazioni**: su schermi stretti il testo di ogni tab si spezzava su più righe
  invece di scorrere. Ora la barra dei tab scorre in orizzontale, ogni tab resta su una riga sola.
- **Card della timeline troppo strette**: colonna oraria + immagine + fino a 3 bottoni azione non
  ci stavano su una riga sola in ~340px di larghezza, e il titolo finiva coperto dai bottoni.
  Colonna oraria ridotta, e i bottoni ora vanno a capo sotto al contenuto quando lo spazio non
  basta, invece di sovrapporglisi.

## Novità v23

- **Impostazioni → Navigazione**: nuovo tab per scegliere quali voci di menu mostrare. Impostazioni
  stessa non è mai nascondibile (altrimenti non avresti più modo di tornare a cambiare la scelta).
  Esplora parte nascosta di default, come chiesto, ma resta lì pronta se ti serve in futuro.
- **Step delle durate uniformato a 1** ovunque: permanenza tappa, durata spostamento, durata
  consigliata di una tappa.
- **Fix del menu invisibile su mobile**: la rail laterale, sotto una certa larghezza, spariva
  senza lasciare alternativa per navigare. Ora sotto quella soglia compare una **tabbar in basso**
  (icona + etichetta per ogni sezione visibile), pensata per il pollice su schermo stretto. Tutto
  il resto del CSS desktop è rimasto identico: le nuove regole vivono solo dentro il media query
  che già esisteva, nessuna riga toccata fuori da lì.
- **App installabile come PWA**: manifest, icone, service worker che mette in cache l'app shell
  (HTML/CSS/JS) per il funzionamento offline una volta installata sulla home screen.

## Un vincolo tecnico reale su iPhone, da conoscere prima di provarla

I service worker — il pezzo che rende un sito "installabile e offline" — **richiedono una
connessione sicura (HTTPS)** per registrarsi su Safari/iOS. Fanno eccezione solo gli indirizzi
`localhost`. Live Server serve i file in `http://` semplice, e dal tuo iPhone il Mac non è
"localhost" ma un indirizzo di rete (tipo `http://192.168.1.x:5500`) — Safari **rifiuta** di
registrare il service worker in quel contesto. Non è una scelta mia, è una restrizione di
sicurezza del browser che nessuna riga di codice può aggirare.

Ho comunque scritto tutto il necessario (manifest, icone, service worker, meta tag), perché ti
serve comunque per una delle due strade sotto:

1. **Via più semplice, gratuita, permanente**: pubblica la cartella su un host statico gratuito
   con HTTPS automatico — GitHub Pages, Netlify o Vercel (bastano pochi minuti, nessun server da
   gestire, resta comunque "senza backend": sono solo file statici). Apri l'URL su Safari,
   "Aggiungi a Home", e da quel momento funziona ovunque, anche senza rete, senza bisogno che il
   Mac sia acceso o vicino.
2. **Via più artigianale, resta in locale**: abilita HTTPS in Live Server (impostazione
   `liveServer.settings.https` in VS Code, genera un certificato) e la prima volta che apri l'URL
   dall'iPhone, accetta/installa il certificato da Impostazioni. Più scomoda (il certificato è
   auto-firmato, va fidato manualmente, e il Mac deve restare raggiungibile sulla stessa rete
   almeno la prima volta), ma non richiede di appoggiarti a nessun servizio esterno.

Se vuoi, nella prossima puoi dirmi quale delle due preferisci e ti preparo i passaggi esatti per
quella specifica.

## Novità v22

- **Partenza trattata come il Rientro**: immagine, nome e tipo della tappa collegata, se presenti.
  Resta l'unica voce a orario fisso obbligatorio (è l'inizio della giornata, non ha una voce
  precedente da cui dedursi).
- **Colonna oraria a piena altezza**: non più un riquadro dentro la card, ma la card stessa
  "tagliata" in due — striscia blu a sinistra su tutta l'altezza, contenuto a destra. Niente più
  overflow nascosto per farlo (avrebbe tagliato via anche il pallino della timeline): il bordo
  arrotondato sta direttamente sulla striscia blu.
- **Contenuto sempre centrato verticalmente**, sia a sinistra (orario) sia a destra (nome/tipo):
  quando un lato è più alto dell'altro (per via di un'immagine, o di un orario su due righe),
  l'altro si centra invece di restare appeso in alto.
- **Pallino della timeline centrato** sull'altezza della card, non più fissato vicino al bordo
  superiore.
- **Varchi "+" tra le card equidistanti**: stesso spazio esatto dal bordo della card precedente
  e da quello della successiva — prima la spaziatura era divisa tra il margine della card e il
  varco, ora la gestisce solo il varco, in modo simmetrico.

## Novità v21

- **Colonna oraria distinta**: sfondo blu, larghezza fissa (uguale sia per un orario singolo sia
  per una coppia — impilata su due righe invece di allargarsi), più spazio dal contenuto a
  destra. L'ho tenuta a sinistra invece che a destra: è la posizione con cui si legge un'agenda
  ("quando" prima di "cosa"), e a destra avrebbe dovuto convivere con i bottoni di azione,
  affollando quel lato. Se dopo averla vista preferisci comunque a destra, dimmelo pure.
- **Il Rientro è ora trattato come una tappa vera**: immagine di copertina e tipo del luogo di
  arrivo (se presenti), e soprattutto **orario calcolato in automatico** dalla voce precedente
  (tappa o spostamento), esattamente come chiedevi nell'esempio. Resta un "orario fisso"
  opzionale per i casi in cui serve forzarlo. L'unica voce che resta ad orario obbligatorio e
  fisso è la Partenza, perché è l'inizio della giornata: non ha una voce precedente da cui dedursi.
- **Migrazione automatica**: i Rientro già pianificati con un orario fisso lo mantengono come
  override esplicito (oraFissata), così non cambia nulla di quello che avevi già impostato finché
  non lo tocchi.

## Novità v20

- **Layout delle card della timeline rivisto**: l'orario ora sta in una colonna dedicata a
  sinistra (con la durata sotto), invece di essere schiacciato sopra al titolo — usa meglio la
  larghezza disponibile. Più spazio tra le righe (titolo, tipo, note). Per lo Spostamento,
  percorso e distanza reale sono concatenati su un'unica riga invece di due.
- **Permanenza minima 0, step 1** (prima minimo 1, step 5): con permanenza 0 la tappa diventa un
  **punto di passaggio** — mostra un solo orario invece di un intervallo ("arrivo e riparto da
  qui"), con l'etichetta "passaggio" al posto dei minuti nella colonna orario.

## Novità v19

- **Icona del mezzo nello Spostamento**: ora riflette davvero il mezzo scelto (auto, bici, a
  piedi, aereo, treno, bus, taxi), non più sempre la stessa.
- **Cambio di modello per Tappa e Spostamento**: via gli orari fissi "Dalle/Alle", dentro le
  **durate**. La Tappa ha una **permanenza** (minuti, con default preso dalla durata consigliata
  della tappa stessa se l'hai impostata). Lo Spostamento ha una **durata** (dal calcolo reale se
  l'hai fatto, altrimenti impostabile a mano). Gli orari mostrati in ogni card si calcolano da
  soli sommando le durate a partire dall'ultima Partenza/Rientro — le uniche voci che restano ad
  orario fisso, come chiesto. Sposta la Partenza e tutto il resto si ricalcola senza che tu debba
  ritoccare nulla, perché non è più salvato: è sempre dedotto al volo.
- **Orario fisso opzionale** su Tappa e Spostamento, per i casi "questo posto apre solo alle 16
  qualunque cosa succeda prima": quando lo imposti, quella voce diventa lei stessa un'ancora e il
  calcolo riparte da lì per le voci successive.
- **Migrazione automatica**: le vecchie voci con orario fisso passano da sole al nuovo formato
  (l'intervallo che avevano diventa la loro durata) al primo caricamento della giornata.
- **Rimosso** il controllo di sovrapposizione oraria su Tappa: con gli orari dedotti in sequenza,
  una sovrapposizione vera può capitare solo forzando un orario fisso prima della fine della voce
  precedente — non l'ho ancora segnalato con un avviso dedicato; se ti serve lo aggiungo.

## Novità v18

- **Font Awesome su tutto il sito**: aggiunto il tuo Kit (`75d8a5f1bd`) in `index.html`. Tutti i
  simboli unicode usati come icone (menu, modifica, elimina, indietro, info, chevron, avvisi,
  coordinate, "+") sono stati sostituiti con le icone Font Awesome corrispondenti, seguendo lo
  stile che avevi già impostato per la rail (`fa-solid fa-...`).
- **Via anche gli ultimi colori rimasti**: il badge "Un luogo/Itinerante" sulle vacanze usava
  ancora verde acqua e giallo — corretto in due tonalità di blu (chiaro/scuro). Ripulite anche
  altre tracce sparse (pool alloggi, selettore destinazione, indicatori di validità) che erano
  rimaste fuori dal giro precedente: ora è davvero blu-only, più il rosso per gli avvisi/eliminazioni.
- **Fix tabelle di Impostazioni**: lo spazio vuoto a destra era dovuto a un trucco CSS
  (`width:1%`) poco affidabile in `table-layout: auto`. Sostituito con `table-layout: fixed` e
  larghezze esplicite per colonna: ora la tabella riempie tutto lo spazio disponibile,
  colonna azioni sempre ancorata a destra.
- **Fix bottoni azione ovali**: mancava `flex-shrink: 0` sui bottoni rotondi dentro contenitori
  flex stretti (tabelle, header), che li schiacciava rendendoli ovali invece che tondi.

## Novità v17

- **Via completamente i colori** da categorie destinazione e tipi di tappa: niente più color
  picker nei form (solo nome), niente più pallini/badge colorati per-elemento in giro per l'app.
  L'unico colore rimasto ovunque serva è il **blu della rail**, usato in modo uniforme per badge,
  chip attivi e stati selezionati.
- **Impostazioni a tab** invece delle sezioni a fisarmonica: Categorie destinazioni, Tipi di
  tappa, Routing — un tab alla volta, niente più scroll tra sezioni aperte contemporaneamente.
- **Elenchi in tabella vera** (`<table>`, non più righe-card): colonne Nome, Utilizzo, Azioni.

## In sospeso

Le icone Font Awesome che avevi allegato non sono arrivate (il file caricato risultava vuoto,
0 byte) — probabile problema di caricamento. Appena lo ricarichi le integro su tutto il sito.

## Novità v16

- **Una tappa può avere più tipi**, come già le categorie delle destinazioni: un rifugio di
  montagna può essere Ristoro *e* Alloggio insieme. Nel form Tappa il selettore tipo è ora a
  scelta multipla; il primo che scegli è il **tipo principale** (decide in quale gruppo compare
  la tappa nella pagina della destinazione), gli altri restano come etichette secondarie sulla
  card ("anche: Alloggio"). Il filtro a chip e l'elenco degli alloggi disponibili per il pool
  delle vacanze itineranti considerano *tutti* i tipi di una tappa, non solo il principale.
- **Migrazione automatica**: le tappe esistenti (che avevano un tipo solo) passano da sole al
  nuovo formato al primo avvio di questa versione — nessun intervento manuale, nessuna perdita
  di dati. Tecnicamente: l'indice IndexedDB sul tipo diventa `multiEntry`, così una tappa resta
  trovabile cercando uno qualsiasi dei suoi tipi.

## Novità v15

- **Esplora è ora una tabella**: colonne Nome, Zona, Km aria, Km auto, Min auto, Km a piedi, Min a
  piedi. Filtri "massimo" su ognuna delle colonne calcolate, oltre ai filtri già esistenti su
  nome/Stato/Regione/Provincia/categoria.
- **Calcolo automatico, nessun bottone**: appena cambi punto di partenza, raggio o filtri, auto e
  a piedi si ricalcolano da soli in background per tutte le destinazioni nel raggio (tetto
  silenzioso di 40 destinazioni per restare dentro un uso ragionevole della quota gratuita; oltre,
  un avviso testuale chiede di restringere raggio o filtri — nessun bottone da premere).
- **Fix di correttezza**: la cache delle distanze reali si svuota automaticamente ogni volta che
  cambia il punto di partenza — prima poteva mostrare distanze calcolate rispetto all'origine
  precedente, sbagliate.
- **"Linea d'aria"** invece di "Linea d'aria (≈ aereo)".
- **Partenza, Rientro e Spostamento** ora possono riferirsi a una tappa di **qualsiasi**
  destinazione dell'archivio, non solo quella del giorno — utile per una partenza da "Casa" in una
  vacanza ambientata altrove. Il menu a tendina è raggruppato per destinazione.
- **Via i pallini colorati** del tipo di tappa ovunque (gruppi, filtri, card giorno, selettore
  tipo nel form): il tipo si esprime solo con il testo. Via anche il bordo colorato delle card
  Partenza/Rientro/Spostamento nel planner. Il colore resta solo come dato gestito in
  Impostazioni, per un'eventuale mappa a colori in futuro.

## Novità v14

- Aggiunto `margin-top: 5px` e raggio leggermente ridotto (10/12) sulle copertine delle card,
  come nella prova che avevi validato tu: lo spazio in più allontana l'immagine dall'angolo dove
  nasceva l'artefatto di rendering, invece di continuare a provare a eliminarlo alla radice.

## Novità v13

- **Fix vero del bordo asimmetrico** sulle copertine delle card: il tentativo precedente (ombra di
  contorno sul contenitore) non bastava perché il problema stava nel *clipping* dell'immagine
  stessa via `overflow:hidden` del genitore, che a volte rende l'angolo curvo in modo leggermente
  diverso dai lati dritti. Ora l'immagine (e il placeholder colorato) hanno il proprio
  `border-radius` sugli angoli superiori, identico a quello della card: non dipendono più dal
  clipping del contenitore per quell'angolo, che era la parte che dava problemi.

## Novità v12

- **Filtri riequilibrati**: la ricerca per nome e i filtri (Stato/Regione/Provincia, o Destinazione/durata
  per le Vacanze) ora vivono in un'unica griglia con proporzioni fisse e coerenti (2:1:1:1), invece
  di pesi casuali dettati dal contenuto. Stessa griglia in Destinazioni, Vacanze ed Esplora. Il
  toggle Griglia/Righe resta nel suo angolo, ma ora è chiaramente separato dai filtri.
- **Fix bordo asimmetrico** sulle copertine delle card: causato dalla combinazione bordo +
  overflow:hidden + angoli arrotondati (un bug di rendering noto). Sostituito il bordo con
  un'ombra di contorno, che non soffre dello stesso problema.
- **Copertine vuote senza icona**: resta solo lo sfondo colorato, come chiesto.
- **Esplora — tipo di distanza selezionabile**: Linea d'aria (≈ Aereo, sempre gratis e istantanea),
  Auto, A piedi. Cambiando tipo, il filtro "distanza massima" si applica a quella metrica. Ogni
  riga mostra comunque tutti i valori già calcolati (linea d'aria sempre, auto/a piedi se
  calcolati). Per Auto/A piedi, dato che serve una chiamata reale al servizio di routing, non parte
  nulla in automatico: un banner mostra quante destinazioni vanno calcolate e un bottone "Calcola
  tutte" lo fa in un colpo solo (con un tetto di 40 per volta, oltre chiede di restringere prima i
  filtri). **Treno non è incluso**: non esiste un servizio di routing ferroviario gratuito senza
  una chiave a pagamento — l'ho omesso invece di offrirti qualcosa che non calcola davvero quello
  che promette.

## Novità v11 — intervento pesante

- **Rail di navigazione ridotta a solo menu**: icona + etichetta, niente più elenchi dentro. Scala
  bene anche con centinaia di destinazioni/vacanze, cosa che la vecchia rail stretta non reggeva.
- **Nuovo modello elenco ↔ dettaglio a tutto schermo**: entrando in Destinazioni o Vacanze vedi
  prima un elenco a piena larghezza (filtri sempre visibili in alto, **toggle Griglia/Righe**
  tenuto a mente per la sessione), poi cliccando su una voce passi al dettaglio con un bottone
  "← indietro" per tornare. Il concetto di card tappe/giorni con drag & drop resta identico.
- **Nuova direzione visiva**: via la palette "atlante/pergamena", dentro uno stile chiaro e
  arioso — bianco caldo, blu oceano come accento primario, verde acqua e giallo come accenti
  secondari, angoli più arrotondati, ombre morbide, tipografia sans moderna ovunque.
- **Fix**: il bottone "Mostra su mappa" ora è un vero toggle (mostra/nascondi), non si apre più
  "a senso unico" — prima serviva uscire e rientrare nella destinazione per richiuderla.

## Novità v10 — fix importante

- **Risolto**: se un'altra scheda/finestra aveva l'app aperta a uno schema di database precedente,
  l'apertura del database restava bloccata in silenzio, per sempre — da qui i menu selezionabili
  ma senza nessun contenuto a destra. Ora c'è un messaggio chiaro invece dell'attesa infinita, e
  se un'altra scheda aggiorna lo schema, questa si chiude da sola e avvisa di ricaricare.
- **Rete di sicurezza**: qualsiasi errore imprevisto durante il caricamento di una sezione ora
  mostra un messaggio leggibile a schermo (con suggerimento pratico) invece di lasciare l'app
  silenziosamente bloccata. Se càpita ancora qualcosa di strano, il messaggio dirà cosa.
- **Utile da sapere**: da qui in avanti, quando scarichi una versione nuova, chiudi tutte le altre
  schede/finestre dell'app prima di aprirla — evita lo scenario del blocco alla radice.

## Novità v9

- **Mappe di Tappa e Destinazione unificate su Leaflet + OpenStreetMap**, come già la mappa
  combinata di Esplora: via prima l'iframe Google (era un trucco non ufficiale, nella stessa
  categoria di cose che possono smettere di funzionare senza preavviso — come è successo con
  `/maps/dir/`). Stesso comportamento di prima: "Mostra su mappa" carica solo su richiesta.
- **Distanza e durata reali (auto/a piedi/bici)** via [openrouteservice.org](https://openrouteservice.org),
  motore di routing open source su dati OpenStreetMap. Serve una chiave gratuita (iscrizione via
  email, nessuna carta di credito): si imposta in **Impostazioni → Routing**, resta solo su questo
  Mac in IndexedDB e non viene mai inclusa nei backup esportati.
  - **Nello Spostamento** del planner: bottone "Calcola distanza e durata reali", usa il mezzo
    già selezionato e i punti da/a (espliciti o dedotti dalla voce precedente/successiva). Il
    risultato si salva sulla voce e resta visibile nella card finché non lo ricalcoli.
  - **In Esplora**: due bottoncini 🚗/🚶 per riga risultato, calcolano su richiesta la distanza
    reale da lì al punto di partenza scelto (mai in automatico per l'intero elenco, per non
    consumare la quota gratuita giornaliera senza motivo).
  - Aereo, treno e "altro" non hanno un profilo di routing sensato: restano solo con la distanza
    in linea d'aria, come sempre.

## Novità v8

- **Fix mappa combinata di Esplora**: l'embed "indicazioni" di Google (`/maps/dir/...`) non è
  supportato ufficialmente in iframe e restava vuoto. Sostituito con una mappa **Leaflet +
  OpenStreetMap**, caricata da CDN solo al primo click su "Mostra mappa combinata" (mai in
  automatico) e riutilizzata per il resto della sessione. Nessuna chiave API, nessuna quota da
  monitorare — OpenStreetMap è gratuito per un uso personale come questo. Le destinazioni sono
  ora puntine indipendenti con popup (nome + distanza), non più un percorso collegato.
- La mappa a punto singolo di Tappa/Destinazione resta quella con l'embed Google (`/maps?q=...`),
  che funziona regolarmente e non è stata toccata.

## Novità v7

- **"+" tra le card più visibili**: bordo pieno color ottone invece del tratteggio semi-trasparente.
- **Scheda tappa dal planner**: sulle card "Tappa" della timeline di una vacanza, il bottone "ℹ"
  apre la scheda completa della tappa (mappa, foto, note) senza dover uscire dal planner.
- **Foto** su Destinazioni e Tappe: galleria con copertina (la prima caricata), ridimensionate e
  compresse lato client prima di finire in IndexedDB. Copertina visibile su card tappa, header
  destinazione e card tappa nel planner.
- **Categorie destinazioni** (es. "Montagna", "Mare", "Città"): non esclusive, una destinazione
  può averne più di una. Si gestiscono da Impostazioni, ora organizzata in due sezioni espandibili
  ("Categorie destinazioni" e "Tipi di tappa"), ciascuna con il proprio "+". Filtro per categoria
  sempre disponibile nell'elenco Destinazioni (e anche in Esplora).
- **Sezione Esplora**: scegli un punto di partenza — coordinate incollate, una destinazione già in
  archivio, o la posizione attuale via geolocalizzazione del browser — e una distanza massima in
  km. Elenco delle destinazioni entro quel raggio, ordinate per vicinanza, con gli stessi filtri
  di nome/Stato/Regione/Provincia/categoria della sezione Destinazioni. Mappa combinata su
  richiesta (embed "indicazioni" di Google Maps con più punti insieme, nessuna API key; limitata
  alle 9 destinazioni più vicine per restare dentro ai limiti pratici dell'embed senza chiave).

## Novità v6

- **Tolta la toolbar con i 4 bottoni** "+ Tappa / Partenza / Rientro / Spostamento" in cima al
  giorno. Al suo posto, un piccolo **"+" tra ogni coppia di card** della timeline (e uno grande
  quando il giorno è ancora vuoto): lo premi, scegli il tipo di voce da un menu compatto, e la
  voce nasce esattamente in quel punto — non più sempre in fondo.
- **Lo Spostamento, in creazione, non chiede più l'orario**: lo definisce automaticamente il punto
  in cui lo inserisci (fine della voce prima, inizio di quella dopo), e resta dinamico — si
  aggiorna da solo se sposti le voci intorno. Volendo, modificandolo in un secondo momento puoi
  fissare un orario esplicito a mano (e tornare all'automatico svuotando i campi).

## Novità v5

- L'alloggio del giorno (vacanze itineranti) non è più un timbro come la destinazione: appare
  come testo discreto e corsivo accanto a "Giorno X", per non competere visivamente con la
  destinazione.
- Lo Spostamento propone in automatico l'orario di partenza in base a dove finiva l'ultima voce
  del giorno (resta sempre modificabile a mano). L'orario di fine non ha un default naturale in
  creazione, perché a quel punto non esiste ancora una "voce successiva".
- **Mappa su richiesta** nella scheda della tappa: bottone "Mostra su mappa" che carica un iframe
  di Google Maps solo quando lo premi, usando l'URL pubblico `google.com/maps?...&output=embed`
  (nessuna API key, nessuna fatturazione Google Cloud, nessun limite di chiamate free da rispettare).
  Nota: questa è l'unica funzione dell'app che richiede una connessione internet.

## Novità v4

- **Voci di giornata oltre alla Tappa**: ogni giorno può avere anche **Partenza** e **Rientro**
  (orario singolo, "da/a" verso una tappa o l'alloggio di default) e **Spostamento** (intervallo
  orario, mezzo di trasporto, "da/a" facoltativi — se non specificati si calcolano automaticamente
  dalla voce precedente/successiva nell'ordine attuale della giornata, e restano dinamici: si
  aggiornano da soli se riordini le voci).
- **Alloggio**: nessuna entità nuova, è semplicemente una Tappa di tipo "Alloggio" (già esistente).
  Vacanze "un luogo" → un alloggio unico per tutta la vacanza. Vacanze itineranti → prima definisci
  il pool di alloggi che ti interessano, poi ogni giorno ne scegli uno dal pool.
- **Drag & drop**: sia i giorni di una vacanza sia le voci dentro una giornata si riordinano
  trascinandoli — funziona in entrambi i tipi di vacanza.

## Novità v3

- Rimossa la pallina colore dalle card delle tappe (resta nei titoli di categoria).
- Spaziatura corretta tra pallino colore e testo del tipo nelle card di attività giornaliere.

## Novità v2

- **Navigazione a 4 sezioni**: Destinazioni, Vacanze, Impostazioni, Backup — pronta a crescere.
- **Tipi di tappa personalizzabili** da Impostazioni (nome + colore libero): non più un elenco fisso.
  Eliminarne uno in uso è bloccato finché non riassegni le tappe che lo usano.
- **Coordinate incollabili** ("45.577..., 11.351...") su Destinazioni e Tappe, con parsing e
  validazione in tempo reale. Pronta la funzione di distanza (Haversine) per usi futuri (mappa,
  raggio massimo, ricerca "vicino a me").
- **Dati geografici** (Stato, Regione, Provincia) su Destinazione.
- **Filtri**: Destinazioni per nome/Stato/Regione/Provincia; Vacanze per nome, destinazione
  coinvolta, durata in giorni (min-max); Tappe di una destinazione per tipo, con filtro a chip colorati.
- **Backup**: esporta l'intero archivio in JSON, importa per ripristinare (schema v2, store `tipiTappa` incluso).

## Come avviarla

1. Apri la cartella `vacation-builder/` in VS Code.
2. Installa l'estensione **Live Server** (se non l'hai già).
3. Tasto destro su `index.html` → **Open with Live Server**.
4. Nessuna build, nessuna dipendenza esterna: tutto gira nel browser via IndexedDB.

I dati restano nel tuo Mac, dentro il database IndexedDB del browser legato a quella
origine (`127.0.0.1:PORT`). Se cambi porta di Live Server o browser, i dati non si
spostano da soli: è un limite noto di IndexedDB, non un bug dell'app.

## Architettura

```
index.html          shell a tre colonne (rail / canvas / inspector)
css/styles.css       token di design + componenti
js/db.js             accesso IndexedDB, schema, helper CRUD generici, export/import raw
js/utils.js          id, tempo, formattazione, escaping, elenco tipi di tappa
js/repository.js     regole di dominio: vincoli, usage-check, cancellazioni a cascata
js/app.js            controller UI: stato, rendering, eventi
```

Il repository (`repository.js`) è l'unico punto che parla con `db.js`: l'interfaccia
utente non tocca mai IndexedDB direttamente. Questo è il punto in cui aggiungerai
domani categorie, indicatori, geolocalizzazione, senza toccare `app.js` se non per
il rendering.

## Modello dati (v1)

```
Destinazione (id, nome, note)
Tappa (id, destinazioneId, nome, tipo, note, durataConsigliataMin)
Vacanza (id, nome, tipo: 'fissa'|'itinerante', destinazionePrincipaleId, dataInizio, dataFine)
Giornata (id, vacanzaId, ordine, data, destinazioneId)   ← sempre valorizzata, anche se fissa
TappaPianificata (id, giornataId, tappaId, oraInizio, oraFine, note)
```

Punto chiave: anche nelle vacanze "Un luogo" ogni `Giornata` porta esplicitamente
`destinazioneId`, invece di ereditarlo implicitamente dalla vacanza. È lo stesso
identico modello di una vacanza itinerante, con un vincolo applicativo in più
(tutte le giornate devono coincidere con la destinazione principale). Questo evita
due modelli dati paralleli e permette in futuro di convertire una vacanza da fissa a
itinerante senza migrazioni.

## Decisioni prese in questa sessione

- **Orari liberi**, sovrapposizioni permesse con avviso visivo (mai bloccanti):
  l'utente resta sempre al comando.
- **Cancellazione a cascata con avviso dettagliato**: eliminare una Destinazione o
  una Tappa già usata mostra prima quante pianificazioni/giornate/vacanze verranno
  coinvolte, poi procede solo dopo conferma esplicita.
- Le tappe proposte in una giornata sono **filtrate per costruzione**: solo quelle
  della destinazione di quella specifica giornata, mai in UI a scelta libera.

## Cosa manca apposta (roadmap, in ordine di priorità)

Non implementato ora per restare focalizzati, ma il modello dati non lo ostacola:

1. **Categorie e indicatori numerici** (Relax, Natura, Cultura, Costo, Affollamento...)
   → nuovo store `categorie` + campo `indicatori: {chiave: valore}` su Tappa/Destinazione.
2. **Esplorazione** ("giornata libera vicino casa") e **ricerca per stato d'animo**
   → filtri sopra indicatori/categorie, nessuna AI necessaria.
3. **Template di giornata** riutilizzabili (mattina/pranzo/pomeriggio/tramonto)
   → nuovo store `templateGiornate`, applicabile come punto di partenza su una Giornata.
4. **Geolocalizzazione**: coordinate su Destinazione, raggio massimo per vacanze "fisse",
   ricerca "vicino a me".
5. **Immagini**: principale + galleria, gestite localmente (IndexedDB supporta Blob).
6. **Costi e risorse**: store separati per alloggi/trasporti/attività/spese, collegati
   per FK a Vacanza/Giornata/TappaPianificata.
7. **Export/Import JSON e backup manuale**: la funzione `Store.exportAll()` /
   `Store.importAll()` in `db.js` è già pronta lato dati; manca solo l'UI (due bottoni
   e un file picker).

Quando vuoi affrontare uno di questi punti, dimmi quale: lo tratto come modifica
mirata, senza toccare le parti già funzionanti, e ti segnalo se serve un version
bump dello schema IndexedDB.
