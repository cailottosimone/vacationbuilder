// db.js — accesso a basso livello a IndexedDB.
// Ogni store futuro (categorie, indicatori, immagini, geo, costi...) si aggiunge
// qui dentro con un version bump e basta: nessuno store esistente viene toccato.

const DB_NAME = 'vacation-builder-db';
const DB_VERSION = 8;

// Seed dei tipi di tappa di default: solo la prima volta che lo store viene creato.
// L'utente potrà rinominarli, ricolorarli, aggiungerne altri o eliminarli da Impostazioni.
const DEFAULT_TIPI_TAPPA = [
  { id: 'luogo', nome: 'Luogo' },
  { id: 'ristoro', nome: 'Ristoro' },
  { id: 'monumento', nome: 'Monumento' },
  { id: 'natura', nome: 'Natura' },
  { id: 'attivita', nome: 'Attività' },
  { id: 'alloggio', nome: 'Alloggio' },
  { id: 'trasporto', nome: 'Trasporto' },
];

// Idem per le categorie di spesa: seed di partenza, tutto modificabile da Impostazioni.
const DEFAULT_CATEGORIE_SPESA = [
  { id: 'alloggio', nome: 'Alloggio' },
  { id: 'trasporto', nome: 'Trasporto' },
  { id: 'cibo', nome: 'Cibo' },
  { id: 'attivita', nome: 'Attività' },
  { id: 'altro', nome: 'Altro' },
];

/** @type {IDBDatabase|null} */
let dbInstance = null;

function openDB() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = req.result;

      if (!db.objectStoreNames.contains('destinazioni')) {
        const store = db.createObjectStore('destinazioni', { keyPath: 'id' });
        store.createIndex('nome', 'nome', { unique: false });
      }

      if (!db.objectStoreNames.contains('tappe')) {
        const store = db.createObjectStore('tappe', { keyPath: 'id' });
        store.createIndex('destinazioneId', 'destinazioneId', { unique: false });
        // multiEntry: una tappa può avere più tipi (es. Ristoro + Alloggio), e questo indice
        // la rende comunque trovabile cercando UNO qualsiasi dei suoi tipi.
        store.createIndex('tipi', 'tipi', { unique: false, multiEntry: true });
      }

      if (!db.objectStoreNames.contains('vacanze')) {
        const store = db.createObjectStore('vacanze', { keyPath: 'id' });
        store.createIndex('tipo', 'tipo', { unique: false });
      }

      if (!db.objectStoreNames.contains('giornate')) {
        const store = db.createObjectStore('giornate', { keyPath: 'id' });
        store.createIndex('vacanzaId', 'vacanzaId', { unique: false });
        store.createIndex('destinazioneId', 'destinazioneId', { unique: false });
      }

      if (!db.objectStoreNames.contains('tappePianificate')) {
        const store = db.createObjectStore('tappePianificate', { keyPath: 'id' });
        store.createIndex('giornataId', 'giornataId', { unique: false });
        store.createIndex('tappaId', 'tappaId', { unique: false });
      }

      if (!db.objectStoreNames.contains('tipiTappa')) {
        const store = db.createObjectStore('tipiTappa', { keyPath: 'id' });
        store.createIndex('nome', 'nome', { unique: false });
        const now = new Date().toISOString();
        DEFAULT_TIPI_TAPPA.forEach((t, i) => {
          store.put({ ...t, ordine: i, createdAt: now, updatedAt: now });
        });
      }

      if (!db.objectStoreNames.contains('categorieDestinazione')) {
        const store = db.createObjectStore('categorieDestinazione', { keyPath: 'id' });
        store.createIndex('nome', 'nome', { unique: false });
      }

      if (!db.objectStoreNames.contains('configurazione')) {
        db.createObjectStore('configurazione', { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains('categorieSpesa')) {
        const store = db.createObjectStore('categorieSpesa', { keyPath: 'id' });
        store.createIndex('nome', 'nome', { unique: false });
        const now = new Date().toISOString();
        DEFAULT_CATEGORIE_SPESA.forEach((c, i) => {
          store.put({ ...c, ordine: i, createdAt: now, updatedAt: now });
        });
      }

      if (!db.objectStoreNames.contains('spese')) {
        const store = db.createObjectStore('spese', { keyPath: 'id' });
        store.createIndex('vacanzaId', 'vacanzaId', { unique: false });
        store.createIndex('voceId', 'voceId', { unique: false });
        store.createIndex('categoriaId', 'categoriaId', { unique: false });
      }

      if (!db.objectStoreNames.contains('listaVoci')) {
        const store = db.createObjectStore('listaVoci', { keyPath: 'id' });
        store.createIndex('vacanzaId', 'vacanzaId', { unique: false });
        store.createIndex('giornataId', 'giornataId', { unique: false });
      }

      // v7: "Liste predefinite" — modelli riutilizzabili di voci (senza costo) copiabili nella
      // Lista di una vacanza, e "Luoghi di stoccaggio" — etichette riutilizzabili (valigia,
      // zaino...) assegnabili a una voce Lista per il report di fine preparativi.
      if (!db.objectStoreNames.contains('listePredefinite')) {
        db.createObjectStore('listePredefinite', { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains('vociPredefinite')) {
        const store = db.createObjectStore('vociPredefinite', { keyPath: 'id' });
        store.createIndex('listaPredefinitaId', 'listaPredefinitaId', { unique: false });
      }

      if (!db.objectStoreNames.contains('luoghiStoccaggio')) {
        const store = db.createObjectStore('luoghiStoccaggio', { keyPath: 'id' });
        store.createIndex('nome', 'nome', { unique: false });
      }

      // Store tecnici per la sincronizzazione cloud (vedi js/data/*.js): non fanno parte dei
      // dati applicativi, non compaiono in ALL_STORES e quindi restano fuori dall'export/
      // import JSON e dal backup manuale — sono uno stato interno del solo dispositivo.
      //
      // _outbox: coda delle modifiche non ancora inviate al cloud. Una riga per (store,
      // recordId): la chiave è "store::recordId" così scritture ripetute sullo stesso record
      // prima che parta la sincronizzazione si sovrascrivono da sole invece di accumularsi.
      if (!db.objectStoreNames.contains('_outbox')) {
        db.createObjectStore('_outbox', { keyPath: 'id' });
      }
      // _syncMeta: singleton con lo stato della sincronizzazione (ultimo pull riuscito, se il
      // dispositivo è collegato a un account cloud). Un solo record, id fisso 'default'.
      if (!db.objectStoreNames.contains('_syncMeta')) {
        db.createObjectStore('_syncMeta', { keyPath: 'id' }).put({ id: 'default', lastPulledAt: null, linkedUserId: null });
      }
      // _imageUploads: cache locale (hash contenuto immagine → percorso già caricato su
      // Supabase Storage). Serve solo a evitare di ricaricare una foto identica a ogni giro di
      // sincronizzazione: non è mai esportata, mai sincronizzata essa stessa, ricostruibile in
      // qualsiasi momento semplicemente ricaricando (con un po' di banda in più) — non è quindi
      // un dato "prezioso" da proteggere in modo particolare.
      if (!db.objectStoreNames.contains('_imageUploads')) {
        db.createObjectStore('_imageUploads', { keyPath: 'hash' });
      }

      // Migrazione v5: una Tappa può avere più tipi (es. un rifugio è Ristoro + Alloggio).
      // I database creati da zero a questa versione hanno già l'indice giusto qui sopra;
      // questo blocco serve solo a chi arriva da una versione precedente con lo store 'tappe'
      // già esistente e popolato con il vecchio campo singolo `tipo`.
      if (event.oldVersion > 0 && event.oldVersion < 5) {
        const tappeStore = req.transaction.objectStore('tappe');
        if (tappeStore.indexNames.contains('tipo')) {
          tappeStore.deleteIndex('tipo');
        }
        if (!tappeStore.indexNames.contains('tipi')) {
          tappeStore.createIndex('tipi', 'tipi', { unique: false, multiEntry: true });
        }
        const cursorReq = tappeStore.openCursor();
        cursorReq.onsuccess = (ev) => {
          const cursor = ev.target.result;
          if (!cursor) return;
          const record = cursor.value;
          if (!record.tipi) {
            record.tipi = record.tipo ? [record.tipo] : [];
            delete record.tipo;
            cursor.update(record);
          }
          cursor.continue();
        };
      }

      // Migrazione v8: introduzione della sincronizzazione cloud. Puramente additiva: gli store
      // _outbox/_syncMeta/_imageUploads sono già stati creati sopra (con onupgradeneeded girano
      // sempre, indipendentemente dalla versione di partenza). Nessun record esistente viene
      // letto o modificato qui: il campo "deletedAt" che da questa versione in poi distingue i
      // record eliminati (soft delete, per poter sincronizzare anche le cancellazioni) è
      // semplicemente assente sui record vecchi, e viene trattato come "non eliminato" — vedi
      // Store.getAll/get più sotto. Non serve quindi scorrere i cursori per aggiungerlo.
    };

    // Un'altra scheda/finestra ha già l'app aperta a una versione di schema precedente:
    // il browser blocca l'apertura finché quella non si chiude. Senza questo handler
    // la Promise restava in attesa per sempre, senza errore né messaggio.
    req.onblocked = () => {
      reject(new Error("Un'altra scheda con Vacation Builder aperta sta bloccando l'aggiornamento del database. Chiudi tutte le altre schede/finestre dell'app e ricarica questa pagina."));
    };

    req.onsuccess = () => {
      dbInstance = req.result;
      // Se un'ALTRA scheda apre l'app con uno schema più recente, questa connessione
      // deve chiudersi per lasciarla procedere: altrimenti si ripete lo stesso blocco al contrario.
      dbInstance.onversionchange = () => {
        dbInstance.close();
        dbInstance = null;
        alert("Il database è stato aggiornato in un'altra scheda. Ricarica questa pagina per continuare a usare Vacation Builder qui.");
      };
      resolve(dbInstance);
    };

    req.onerror = () => reject(req.error);
  });
}

function tx(storeNames, mode = 'readonly') {
  return openDB().then((db) => db.transaction(storeNames, mode));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Store applicativi: uno-a-uno con le tabelle dello schema cloud quando la sincronizzazione è
// collegata (vedi js/data/config.js e supabase/schema.sql — stesso nome, stessi campi in
// camelCase). Nome esportato come ALL_STORES (non più solo interno) perché js/data/config.js lo
// re-importa direttamente: se in futuro si aggiunge uno store applicativo, la lista dei syncable
// si aggiorna da sola.
export const ALL_STORES = [
  'destinazioni', 'tappe', 'vacanze', 'giornate', 'tappePianificate', 'tipiTappa',
  'categorieDestinazione', 'categorieSpesa', 'spese', 'listaVoci',
  'listePredefinite', 'vociPredefinite', 'luoghiStoccaggio',
];

// Store tecnici: mai esportati/importati via JSON, mai passati a syncableStores, mai sincronizzati
// essi stessi (sono lo stato interno della sincronizzazione, non dati applicativi).
const TECH_STORES = ['_outbox', '_syncMeta', '_imageUploads'];

/** Un record è "vivo" se non ha deletedAt valorizzato. I record scritti prima dell'introduzione
 * del soft delete (v8) non hanno affatto questo campo: undefined è equivalente a null, quindi
 * restano visibili senza bisogno di una migrazione dedicata. */
function isVivo(record) {
  return !record.deletedAt;
}

/** Accoda un record nella coda di sincronizzazione (outbox), una riga per (store, id): scritture
 * ripetute sullo stesso record prima che parta il push si sovrascrivono da sole. Fallisce in
 * silenzio se lo store _outbox non esiste ancora (non dovrebbe succedere: creato ad ogni apertura
 * del DB) — il sync è comunque un livello opzionale, non deve mai far fallire una scrittura locale. */
async function enqueueOutbox(storeName, id) {
  if (TECH_STORES.includes(storeName)) return; // gli store tecnici non si sincronizzano da soli
  try {
    const t = await tx(['_outbox'], 'readwrite');
    await reqToPromise(t.objectStore('_outbox').put({ id: `${storeName}::${id}`, store: storeName, recordId: id, queuedAt: new Date().toISOString() }));
  } catch (err) {
    console.warn('Impossibile accodare la modifica per la sincronizzazione:', err);
  }
}

export const Store = {
  /** @param includeDeleted se true, non filtra i record eliminati (soft delete): usato solo
   * internamente dal motore di sync e dagli export di servizio, mai dalle viste. */
  async getAll(storeName, includeDeleted = false) {
    const t = await tx([storeName]);
    const all = await reqToPromise(t.objectStore(storeName).getAll());
    return includeDeleted ? all : all.filter(isVivo);
  },

  async get(storeName, id, includeDeleted = false) {
    const t = await tx([storeName]);
    const record = await reqToPromise(t.objectStore(storeName).get(id));
    if (!record) return record;
    return includeDeleted || isVivo(record) ? record : undefined;
  },

  /** Scrittura "viva": qualunque put rappresenta lo stato corrente e valido del record, quindi
   * azzera sempre deletedAt (anche per un record che in precedenza era stato eliminato e viene
   * ricreato con lo stesso id). */
  async put(storeName, value) {
    const record = { ...value, deletedAt: null };
    const t = await tx([storeName], 'readwrite');
    await reqToPromise(t.objectStore(storeName).put(record));
    await enqueueOutbox(storeName, record.id);
    return record;
  },

  /** Scrittura "grezza" usata SOLO dal motore di sync quando applica un record già arrivato dal
   * cloud: a differenza di Store.put non tocca deletedAt (arriva già corretto dal server) e non
   * lo rimette in outbox (altrimenti un pull rimanderebbe subito un push dello stesso record, in
   * un ping-pong inutile — il dato è già sincronizzato per definizione, essendo appena arrivato
   * da lì). */
  async putFromCloud(storeName, record) {
    const t = await tx([storeName], 'readwrite');
    await reqToPromise(t.objectStore(storeName).put(record));
    return record;
  },

  /** Soft delete: il record resta nello store con deletedAt valorizzato, così l'eliminazione può
   * essere sincronizzata agli altri dispositivi invece di sparire solo localmente. */
  async delete(storeName, id) {
    const t = await tx([storeName], 'readwrite');
    const store = t.objectStore(storeName);
    const record = await reqToPromise(store.get(id));
    if (!record) return;
    const now = new Date().toISOString();
    await reqToPromise(store.put({ ...record, deletedAt: now, updatedAt: now }));
    await enqueueOutbox(storeName, id);
  },

  async getAllByIndex(storeName, indexName, value, includeDeleted = false) {
    const t = await tx([storeName]);
    const all = await reqToPromise(t.objectStore(storeName).index(indexName).getAll(value));
    return includeDeleted ? all : all.filter(isVivo);
  },

  /** Esporta l'intero database come oggetto semplice, per il backup JSON. Gli store tecnici di
   * sincronizzazione (_outbox/_syncMeta/_imageUploads) non ne fanno parte: sono stato del solo
   * dispositivo. */
  async exportAll() {
    const out = { schemaVersion: DB_VERSION, exportedAt: new Date().toISOString() };
    for (const name of ALL_STORES) {
      out[name] = await Store.getAll(name);
    }
    return out;
  },

  /** Importa un export JSON, sovrascrivendo i record con lo stesso id. Passa da Store.put così i
   * record importati entrano anche loro nella coda di sincronizzazione: se il cloud è collegato,
   * un ripristino da backup si propaga agli altri dispositivi invece di restare isolato su quello
   * su cui è stato importato. */
  async importAll(data) {
    for (const name of ALL_STORES) {
      const records = Array.isArray(data[name]) ? data[name] : [];
      for (const record of records) await Store.put(name, record);
    }
  },

  /* ---------------------------------------------------------------------- */
  /* Outbox: coda delle modifiche in sospeso verso il cloud (uso interno di  */
  /* js/data/sync.js — vedi anche enqueueOutbox sopra, chiamata da put/delete) */
  /* ---------------------------------------------------------------------- */

  async outboxList() {
    const t = await tx(['_outbox']);
    const all = await reqToPromise(t.objectStore('_outbox').getAll());
    return all.sort((a, b) => (a.queuedAt || '').localeCompare(b.queuedAt || ''));
  },

  async outboxCount() {
    const t = await tx(['_outbox']);
    return reqToPromise(t.objectStore('_outbox').count());
  },

  async outboxRemove(outboxId) {
    const t = await tx(['_outbox'], 'readwrite');
    await reqToPromise(t.objectStore('_outbox').delete(outboxId));
  },

  async outboxClear() {
    const t = await tx(['_outbox'], 'readwrite');
    await reqToPromise(t.objectStore('_outbox').clear());
  },

  /** Rimette in outbox TUTTI i record attualmente presenti in locale (eliminati inclusi): usato
   * una tantum al primo collegamento di un dispositivo con dati già presenti al cloud. */
  async outboxEnqueueAll() {
    for (const name of ALL_STORES) {
      const records = await Store.getAll(name, true);
      for (const r of records) await enqueueOutbox(name, r.id);
    }
  },

  /* ---------------------------------------------------------------------- */
  /* Stato della sincronizzazione (singleton locale, mai esportato)          */
  /* ---------------------------------------------------------------------- */

  async getSyncMeta() {
    const t = await tx(['_syncMeta']);
    const record = await reqToPromise(t.objectStore('_syncMeta').get('default'));
    return record || { id: 'default', lastPulledAt: null, linkedUserId: null };
  },

  async setSyncMeta(patch) {
    const current = await Store.getSyncMeta();
    const next = { ...current, ...patch, id: 'default' };
    const t = await tx(['_syncMeta'], 'readwrite');
    await reqToPromise(t.objectStore('_syncMeta').put(next));
    return next;
  },

  /* ---------------------------------------------------------------------- */
  /* Cache locale hash immagine → percorso Storage già caricato (uso interno */
  /* di js/data/cloud.js, mai esportata/sincronizzata)                       */
  /* ---------------------------------------------------------------------- */

  async imageUploadGet(hash) {
    const t = await tx(['_imageUploads']);
    return reqToPromise(t.objectStore('_imageUploads').get(hash));
  },

  async imageUploadPut(hash, storagePath) {
    const t = await tx(['_imageUploads'], 'readwrite');
    await reqToPromise(t.objectStore('_imageUploads').put({ hash, storagePath, cachedAt: new Date().toISOString() }));
  },

  async wipeAll() {
    const db = await openDB();
    const t = db.transaction([...ALL_STORES, ...TECH_STORES], 'readwrite');
    for (const name of [...ALL_STORES, ...TECH_STORES]) t.objectStore(name).clear();
    await new Promise((resolve, reject) => {
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  },
};
