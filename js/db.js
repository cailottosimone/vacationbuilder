// db.js — accesso a basso livello a IndexedDB.
// Ogni store futuro (categorie, indicatori, immagini, geo, costi...) si aggiunge
// qui dentro con un version bump e basta: nessuno store esistente viene toccato.

const DB_NAME = 'vacation-builder-db';
const DB_VERSION = 6;

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

export const Store = {
  async getAll(storeName) {
    const t = await tx([storeName]);
    return reqToPromise(t.objectStore(storeName).getAll());
  },

  async get(storeName, id) {
    const t = await tx([storeName]);
    return reqToPromise(t.objectStore(storeName).get(id));
  },

  async put(storeName, value) {
    const t = await tx([storeName], 'readwrite');
    await reqToPromise(t.objectStore(storeName).put(value));
    return value;
  },

  async delete(storeName, id) {
    const t = await tx([storeName], 'readwrite');
    await reqToPromise(t.objectStore(storeName).delete(id));
  },

  async getAllByIndex(storeName, indexName, value) {
    const t = await tx([storeName]);
    return reqToPromise(t.objectStore(storeName).index(indexName).getAll(value));
  },

  /** Esporta l'intero database come oggetto semplice, per il backup JSON. */
  async exportAll() {
    const storeNames = ['destinazioni', 'tappe', 'vacanze', 'giornate', 'tappePianificate', 'tipiTappa', 'categorieDestinazione', 'categorieSpesa', 'spese', 'listaVoci'];
    const out = { schemaVersion: DB_VERSION, exportedAt: new Date().toISOString() };
    for (const name of storeNames) {
      out[name] = await Store.getAll(name);
    }
    return out;
  },

  /** Importa un export JSON, sovrascrivendo i record con lo stesso id. */
  async importAll(data) {
    const storeNames = ['destinazioni', 'tappe', 'vacanze', 'giornate', 'tappePianificate', 'tipiTappa', 'categorieDestinazione', 'categorieSpesa', 'spese', 'listaVoci'];
    const db = await openDB();
    const t = db.transaction(storeNames, 'readwrite');
    for (const name of storeNames) {
      const records = Array.isArray(data[name]) ? data[name] : [];
      const store = t.objectStore(name);
      for (const record of records) store.put(record);
    }
    await new Promise((resolve, reject) => {
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  },

  async wipeAll() {
    const storeNames = ['destinazioni', 'tappe', 'vacanze', 'giornate', 'tappePianificate', 'tipiTappa', 'categorieDestinazione', 'categorieSpesa', 'spese', 'listaVoci'];
    const db = await openDB();
    const t = db.transaction(storeNames, 'readwrite');
    for (const name of storeNames) t.objectStore(name).clear();
    await new Promise((resolve, reject) => {
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  },
};
