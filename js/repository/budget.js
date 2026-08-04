import { Store } from '../db.js';
import { uuid, nowISO } from '../utils.js';

/* ---------------------------------------------------------------------- */
/* Categorie spesa (gestite da Impostazioni, non esclusive)                */
/* ---------------------------------------------------------------------- */

export async function listCategorieSpesa() {
  const list = await Store.getAll('categorieSpesa');
  return list.sort((a, b) => a.ordine - b.ordine);
}

export async function getCategoriaSpesa(id) {
  return Store.get('categorieSpesa', id);
}

export async function createCategoriaSpesa({ nome }) {
  const esistenti = await listCategorieSpesa();
  const record = { id: uuid(), nome: nome.trim(), ordine: esistenti.length, createdAt: nowISO(), updatedAt: nowISO() };
  return Store.put('categorieSpesa', record);
}

export async function updateCategoriaSpesa(id, { nome }) {
  const record = await Store.get('categorieSpesa', id);
  if (!record) throw new Error('Categoria non trovata');
  record.nome = nome.trim();
  record.updatedAt = nowISO();
  return Store.put('categorieSpesa', record);
}

export async function checkCategoriaSpesaUsage(id) {
  const all = await Store.getAll('spese');
  const usate = all.filter((s) => s.categoriaId === id);
  return { count: usate.length, spese: usate };
}

export async function deleteCategoriaSpesa(id) {
  const usage = await checkCategoriaSpesaUsage(id);
  if (usage.count > 0) {
    throw new Error(`Categoria ancora usata da ${usage.count} spese: riassegnale prima di eliminarla.`);
  }
  await Store.delete('categorieSpesa', id);
}

/* ---------------------------------------------------------------------- */
/* Spese e riepilogo Budget                                                */
/*                                                                          */
/* Una spesa può essere "secca" (un totale, es. l'hotel 1000€) oppure       */
/* "a persona" (importoAPersona x numeroPersone, es. terme 45€ x 1). Nel    */
/* riepilogo, le spese "a persona" il cui numeroPersone coincide con quello */
/* della vacanza finiscono tra le CONDIVISE (danno un vero costo a testa);  */
/* tutto il resto — spese secche, e spese "a persona" con un numero diverso */
/* da quello del gruppo — finisce in EXTRA, elencato voce per voce invece   */
/* che schiacciato in una media che non avrebbe senso.                     */
/* ---------------------------------------------------------------------- */

export async function listSpeseByVacanza(vacanzaId) {
  const list = await Store.getAllByIndex('spese', 'vacanzaId', vacanzaId);
  return list.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
}

export async function getSpesa(id) {
  return Store.get('spese', id);
}

/** Spesa collegata a una specifica voce di giornata (tappa/spostamento/partenza/rientro), se c'è. */
export async function getSpesaByVoce(voceId) {
  const list = await Store.getAllByIndex('spese', 'voceId', voceId);
  return list[0] || null;
}

/**
 * Logica di calcolo condivisa tra Spesa e voci Lista con costo — le due entità usano esattamente
 * la stessa struttura per l'importo, quindi la stessa funzione, per non rischiare che si
 * comportino diversamente per una svista.
 *
 * numeroPersone: null significa "segue il numero di persone della vacanza" (si aggiorna da solo
 * se lo cambi in futuro); un numero esplicito resta fisso per sempre, anche se poi cambi la
 * vacanza — è quello che hai scelto tu per QUELLA spesa specifica.
 *
 * "da dividere": inserisci il totale, viene diviso per il numero di persone. L'arrotondamento
 * della quota a testa è sempre PER ECCESSO (mai per difetto): meglio chiedere qualche centesimo
 * in più a testa che ritrovarsi a fine vacanza con meno di quanto speso davvero.
 */
export function risolviNumeroPersone(record, vacanza) {
  if (record.numeroPersone != null) return Number(record.numeroPersone);
  return (vacanza && vacanza.numeroPersone) || 1;
}

export function calcolaImportoRecord(record, vacanza) {
  if (record.modalita === 'aPersona') {
    return (Number(record.importoAPersona) || 0) * risolviNumeroPersone(record, vacanza);
  }
  if (record.modalita === 'daDividere') {
    return Number(record.importoDaDividere) || 0; // il totale reale è quello, l'arrotondamento è solo per la quota a testa
  }
  return Number(record.importoTotale) || 0; // 'secco'
}

/** Quota a persona da mostrare come riferimento (non incide sul totale): null per le spese secche. */
export function calcolaQuotaAPersona(record, vacanza) {
  const persone = risolviNumeroPersone(record, vacanza);
  if (record.modalita === 'aPersona') return Number(record.importoAPersona) || 0;
  if (record.modalita === 'daDividere') return persone > 0 ? Math.ceil((Number(record.importoDaDividere) || 0) / persone) : 0;
  return null;
}

/** Una spesa/voce è "condivisa" se non è secca e il suo numero di persone (risolto) coincide con quello della vacanza. */
export function isRecordCondiviso(record, vacanza) {
  if (record.modalita === 'secco' || !record.modalita) return false;
  return risolviNumeroPersone(record, vacanza) === ((vacanza && vacanza.numeroPersone) || 1);
}

export async function createSpesa({ vacanzaId, voceId = null, categoriaId = null, descrizione, modalita, importoTotale = null, importoAPersona = null, importoDaDividere = null, numeroPersone = null }) {
  const record = {
    id: uuid(),
    vacanzaId,
    voceId,
    categoriaId,
    descrizione: (descrizione || '').trim(),
    modalita, // 'secco' | 'aPersona' | 'daDividere'
    importoTotale: modalita === 'secco' ? Number(importoTotale) || 0 : null,
    importoAPersona: modalita === 'aPersona' ? Number(importoAPersona) || 0 : null,
    importoDaDividere: modalita === 'daDividere' ? Number(importoDaDividere) || 0 : null,
    numeroPersone: modalita === 'secco' ? null : numeroPersone != null && numeroPersone !== '' ? Number(numeroPersone) : null,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
  return Store.put('spese', record);
}

export async function updateSpesa(id, { voceId, categoriaId, descrizione, modalita, importoTotale, importoAPersona, importoDaDividere, numeroPersone }) {
  const record = await Store.get('spese', id);
  if (!record) throw new Error('Spesa non trovata');
  record.voceId = voceId !== undefined ? voceId : record.voceId;
  record.categoriaId = categoriaId !== undefined ? categoriaId : record.categoriaId;
  record.descrizione = (descrizione ?? record.descrizione).trim();
  record.modalita = modalita || record.modalita;
  record.importoTotale = record.modalita === 'secco' ? Number(importoTotale) || 0 : null;
  record.importoAPersona = record.modalita === 'aPersona' ? Number(importoAPersona) || 0 : null;
  record.importoDaDividere = record.modalita === 'daDividere' ? Number(importoDaDividere) || 0 : null;
  record.numeroPersone = record.modalita === 'secco' ? null : numeroPersone != null && numeroPersone !== '' ? Number(numeroPersone) : null;
  record.updatedAt = nowISO();
  return Store.put('spese', record);
}

export async function deleteSpesa(id) {
  await Store.delete('spese', id);
}

export async function getRiepilogoBudget(vacanzaId) {
  const vacanza = await Store.get('vacanze', vacanzaId);
  const numeroPersone = (vacanza && vacanza.numeroPersone) || 1;
  const spese = await listSpeseByVacanza(vacanzaId);
  const listaVoci = (await listListaVociByVacanza(vacanzaId)).filter((v) => v.modalita && v.contaNelTotale !== false);

  let totaleCondiviso = 0;
  const extra = [];

  for (const s of spese) {
    const importo = calcolaImportoRecord(s, vacanza);
    if (isRecordCondiviso(s, vacanza)) {
      totaleCondiviso += importo;
    } else {
      extra.push({ origine: 'spesa', spesa: s, importo });
    }
  }
  for (const v of listaVoci) {
    const importo = calcolaImportoRecord(v, vacanza);
    if (isRecordCondiviso(v, vacanza)) {
      totaleCondiviso += importo;
    } else {
      extra.push({ origine: 'lista', voce: v, importo });
    }
  }

  const totaleExtra = extra.reduce((acc, e) => acc + e.importo, 0);
  return {
    numeroPersone,
    totaleCondiviso,
    totaleAPersona: numeroPersone > 0 ? Math.ceil(totaleCondiviso / numeroPersone) : null,
    extra,
    totaleExtra,
    totaleGenerale: totaleCondiviso + totaleExtra,
  };
}

/* ---------------------------------------------------------------------- */
/* Lista (valigia / cose da fare): una generale per vacanza + una per      */
/* ciascun giorno (giornataId nullo = lista generale).                     */
/* ---------------------------------------------------------------------- */

/** Migra le vecchie voci lista (campo `costo` semplice) alla stessa struttura di importo della
 * Spesa: nessuna voce perde il proprio costo, diventa solo una spesa "secca" equivalente. */
function ensureListaVoceModalita(record) {
  if (record.modalita !== undefined) return record;
  if (record.costo != null) {
    record.modalita = 'secco';
    record.importoTotale = record.costo;
    record.importoAPersona = null;
    record.importoDaDividere = null;
    record.numeroPersone = null;
  } else {
    record.modalita = null;
    record.importoTotale = null;
    record.importoAPersona = null;
    record.importoDaDividere = null;
    record.numeroPersone = null;
  }
  Store.put('listaVoci', record);
  return record;
}

export async function listListaVociByVacanza(vacanzaId) {
  const list = await Store.getAllByIndex('listaVoci', 'vacanzaId', vacanzaId);
  return list.map(ensureListaVoceModalita).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
}

export async function listListaVociGenerale(vacanzaId) {
  return (await listListaVociByVacanza(vacanzaId)).filter((v) => !v.giornataId);
}

export async function listListaVociGiorno(giornataId) {
  const list = await Store.getAllByIndex('listaVoci', 'giornataId', giornataId);
  return list.map(ensureListaVoceModalita).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
}

export async function getListaVoce(id) {
  const record = await Store.get('listaVoci', id);
  return record ? ensureListaVoceModalita(record) : record;
}

/** Voce senza costo: modalita null. Con un costo, stessa struttura della Spesa (secco/aPersona/
 * daDividere), con lo stesso meccanismo di numeroPersone che può seguire la vacanza o restare fisso. */
export async function createListaVoce({ vacanzaId, giornataId = null, testo, modalita = null, importoTotale = null, importoAPersona = null, importoDaDividere = null, numeroPersone = null, contaNelTotale = true }) {
  const record = {
    id: uuid(),
    vacanzaId,
    giornataId,
    testo: (testo || '').trim(),
    fatto: false,
    modalita,
    importoTotale: modalita === 'secco' ? Number(importoTotale) || 0 : null,
    importoAPersona: modalita === 'aPersona' ? Number(importoAPersona) || 0 : null,
    importoDaDividere: modalita === 'daDividere' ? Number(importoDaDividere) || 0 : null,
    numeroPersone: modalita && modalita !== 'secco' && numeroPersone != null && numeroPersone !== '' ? Number(numeroPersone) : null,
    contaNelTotale: modalita ? contaNelTotale : false,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
  return Store.put('listaVoci', record);
}

export async function updateListaVoce(id, patch) {
  const record = await Store.get('listaVoci', id);
  if (!record) throw new Error('Voce lista non trovata');
  Object.assign(record, patch);
  if (typeof record.testo === 'string') record.testo = record.testo.trim();
  // Le patch parziali (es. solo { fatto: true } da toggleListaVoceFatto, o solo
  // { contaNelTotale: false }) non toccano mai `modalita`, quindi qui dentro sanitizziamo
  // gli importi solo se la patch ha effettivamente cambiato qualcosa in quell'area — altrimenti
  // rischieremmo di azzerare un valore già numerico buono con una chiamata innocua.
  if ('modalita' in patch || 'importoTotale' in patch || 'importoAPersona' in patch || 'importoDaDividere' in patch || 'numeroPersone' in patch) {
    record.importoTotale = record.modalita === 'secco' ? Number(record.importoTotale) || 0 : null;
    record.importoAPersona = record.modalita === 'aPersona' ? Number(record.importoAPersona) || 0 : null;
    record.importoDaDividere = record.modalita === 'daDividere' ? Number(record.importoDaDividere) || 0 : null;
    record.numeroPersone = record.modalita && record.modalita !== 'secco' && record.numeroPersone != null && record.numeroPersone !== '' ? Number(record.numeroPersone) : null;
  }
  if (!record.modalita) record.contaNelTotale = false;
  record.updatedAt = nowISO();
  return Store.put('listaVoci', record);
}

export async function toggleListaVoceFatto(id) {
  const record = await Store.get('listaVoci', id);
  if (!record) throw new Error('Voce lista non trovata');
  record.fatto = !record.fatto;
  record.updatedAt = nowISO();
  return Store.put('listaVoci', record);
}

export async function deleteListaVoce(id) {
  await Store.delete('listaVoci', id);
}
