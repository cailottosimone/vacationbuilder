import { Store } from '../db.js';
import { uuid, nowISO } from '../utils.js';
import { listGiornateByVacanza } from './vacanze.js';

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
/* Luoghi di stoccaggio (Impostazioni): etichette riutilizzabili tipo      */
/* "Valigia grande rossa", "Zaino blu", "Auto"... assegnabili a una voce   */
/* Lista per poi raggruppare il report di fine preparativi per luogo.      */
/* ---------------------------------------------------------------------- */

export async function listLuoghiStoccaggio() {
  const list = await Store.getAll('luoghiStoccaggio');
  return list.sort((a, b) => a.ordine - b.ordine);
}

export async function getLuogoStoccaggio(id) {
  return Store.get('luoghiStoccaggio', id);
}

export async function createLuogoStoccaggio({ nome }) {
  const esistenti = await listLuoghiStoccaggio();
  const record = { id: uuid(), nome: nome.trim(), ordine: esistenti.length, createdAt: nowISO(), updatedAt: nowISO() };
  return Store.put('luoghiStoccaggio', record);
}

export async function updateLuogoStoccaggio(id, { nome }) {
  const record = await Store.get('luoghiStoccaggio', id);
  if (!record) throw new Error('Luogo di stoccaggio non trovato');
  record.nome = nome.trim();
  record.updatedAt = nowISO();
  return Store.put('luoghiStoccaggio', record);
}

/** Conta sia le voci Lista sia le voci predefinite che usano questo luogo: entrambe vanno
 * riassegnate prima di poterlo eliminare, altrimenti resterebbero con un id "fantasma". */
export async function checkLuogoStoccaggioUsage(id) {
  const [voci, vociPredef] = await Promise.all([
    Store.getAll('listaVoci'),
    Store.getAll('vociPredefinite'),
  ]);
  const usateVoci = voci.filter((v) => v.luogoStoccaggioId === id);
  const usateVociPredef = vociPredef.filter((v) => v.luogoStoccaggioId === id);
  return { count: usateVoci.length + usateVociPredef.length, voci: usateVoci, vociPredefinite: usateVociPredef };
}

export async function deleteLuogoStoccaggio(id) {
  const usage = await checkLuogoStoccaggioUsage(id);
  if (usage.count > 0) {
    throw new Error(`Luogo ancora usato da ${usage.count} voc${usage.count === 1 ? 'e' : 'i'}: riassegnale prima di eliminarlo.`);
  }
  await Store.delete('luoghiStoccaggio', id);
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

/**
 * Come risolviNumeroPersone, ma per la quantità: un record Lista può avere un numero di persone
 * diverso per il costo e per la quantità (es. "creme solari: 1 a testa" personalizzato a 2 persone
 * mentre il costo resta condiviso su tutta la vacanza) — due campi separati, stessa logica.
 */
export function risolviNumeroPersoneQuantita(record, vacanza) {
  if (record.quantitaNumeroPersone != null) return Number(record.quantitaNumeroPersone);
  return (vacanza && vacanza.numeroPersone) || 1;
}

/**
 * Quantità totale di una voce Lista, in base alla modalità:
 * - secca: il valore così com'è
 * - perGiorno: valore × numero di giorni della vacanza (richiede numeroGiorni)
 * - perPersona: valore × numero di persone (proprio della voce, o della vacanza)
 * - perPersonaGiorno: valore × persone × giorni
 * Ritorna null se la voce non ha quantità (quantitaModalita non impostata).
 */
export function calcolaQuantitaTotale(record, vacanza, numeroGiorni) {
  if (!record.quantitaModalita) return null;
  const valore = Number(record.quantitaValore) || 0;
  const giorni = Number(numeroGiorni) || 0;
  switch (record.quantitaModalita) {
    case 'perGiorno':
      return valore * giorni;
    case 'perPersona':
      return valore * risolviNumeroPersoneQuantita(record, vacanza);
    case 'perPersonaGiorno':
      return valore * risolviNumeroPersoneQuantita(record, vacanza) * giorni;
    default: // 'secca'
      return valore;
  }
}

/**
 * numeroGiorni è opzionale e serve solo alle voci Lista con costo "per unità" in modalità
 * perGiorno/perPersonaGiorno: una Spesa non ha mai quantitaModalita, quindi per lei questo
 * parametro è semplicemente ignorato — nessun impatto sul calcolo esistente.
 */
export function calcolaImportoRecord(record, vacanza, numeroGiorni) {
  let importo;
  if (record.modalita === 'aPersona') {
    importo = (Number(record.importoAPersona) || 0) * risolviNumeroPersone(record, vacanza);
  } else if (record.modalita === 'daDividere') {
    importo = Number(record.importoDaDividere) || 0; // il totale reale è quello, l'arrotondamento è solo per la quota a testa
  } else {
    importo = Number(record.importoTotale) || 0; // 'secco'
  }
  // "Costo per unità": l'importo sopra è il prezzo di UNA unità, va moltiplicato per la
  // quantità totale della voce. Attivo solo se la voce ha sia un costo sia una quantità.
  if (record.costoPerUnita && record.quantitaModalita) {
    importo *= calcolaQuantitaTotale(record, vacanza, numeroGiorni) || 0;
  }
  return importo;
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
  const numeroGiorni = (await listGiornateByVacanza(vacanzaId)).length;
  const spese = await listSpeseByVacanza(vacanzaId);
  const listaVoci = (await listListaVociByVacanza(vacanzaId)).filter((v) => v.modalita && v.contaNelTotale !== false);

  let totaleCondiviso = 0;
  const extra = [];

  for (const s of spese) {
    const importo = calcolaImportoRecord(s, vacanza, numeroGiorni);
    if (isRecordCondiviso(s, vacanza)) {
      totaleCondiviso += importo;
    } else {
      extra.push({ origine: 'spesa', spesa: s, importo });
    }
  }
  for (const v of listaVoci) {
    const importo = calcolaImportoRecord(v, vacanza, numeroGiorni);
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
 * Spesa: nessuna voce perde il proprio costo, diventa solo una spesa "secca" equivalente.
 * Nella stessa passata dà anche i valori di default ai campi quantità, per le voci create prima
 * che esistessero: nessuna migrazione di schema, sono semplicemente campi assenti finché non
 * vengono letti la prima volta. */
function ensureListaVoceModalita(record) {
  let touched = false;

  if (record.modalita === undefined) {
    touched = true;
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
  }

  if (record.quantitaModalita === undefined) {
    touched = true;
    record.quantitaModalita = null;
    record.quantitaValore = null;
    record.quantitaNumeroPersone = null;
    record.quantitaUnita = null;
    record.costoPerUnita = false;
  }

  if (record.luogoStoccaggioId === undefined) {
    touched = true;
    record.luogoStoccaggioId = null;
  }

  if (touched) Store.put('listaVoci', record);
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
 * daDividere), con lo stesso meccanismo di numeroPersone che può seguire la vacanza o restare fisso.
 *
 * La quantità (quantitaModalita null/secca/perGiorno/perPersona/perPersonaGiorno) è indipendente
 * dal costo: una voce può avere l'una, l'altro, entrambi o nessuno dei due. Quando ha entrambi,
 * costoPerUnita decide se l'importo inserito è già il totale (default, comportamento di sempre)
 * oppure un prezzo per singola unità da moltiplicare per la quantità — scelta lasciata a chi
 * compila la voce, non dedotta automaticamente. */
export async function createListaVoce({
  vacanzaId, giornataId = null, testo, modalita = null,
  importoTotale = null, importoAPersona = null, importoDaDividere = null, numeroPersone = null,
  contaNelTotale = true, costoPerUnita = false,
  quantitaModalita = null, quantitaValore = null, quantitaNumeroPersone = null, quantitaUnita = null,
  luogoStoccaggioId = null,
}) {
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
    costoPerUnita: modalita && quantitaModalita ? !!costoPerUnita : false,
    quantitaModalita,
    quantitaValore: quantitaModalita ? Number(quantitaValore) || 0 : null,
    quantitaNumeroPersone: quantitaModalita && (quantitaModalita === 'perPersona' || quantitaModalita === 'perPersonaGiorno') && quantitaNumeroPersone != null && quantitaNumeroPersone !== '' ? Number(quantitaNumeroPersone) : null,
    quantitaUnita: quantitaModalita && quantitaUnita ? String(quantitaUnita).trim() || null : null,
    luogoStoccaggioId: luogoStoccaggioId || null,
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
  if (
    'quantitaModalita' in patch || 'quantitaValore' in patch ||
    'quantitaNumeroPersone' in patch || 'quantitaUnita' in patch
  ) {
    record.quantitaValore = record.quantitaModalita ? Number(record.quantitaValore) || 0 : null;
    record.quantitaNumeroPersone = record.quantitaModalita && (record.quantitaModalita === 'perPersona' || record.quantitaModalita === 'perPersonaGiorno') && record.quantitaNumeroPersone != null && record.quantitaNumeroPersone !== '' ? Number(record.quantitaNumeroPersone) : null;
    record.quantitaUnita = record.quantitaModalita && record.quantitaUnita ? String(record.quantitaUnita).trim() || null : null;
    if (!record.quantitaModalita) record.costoPerUnita = false;
  }
  if ('costoPerUnita' in patch) record.costoPerUnita = !!record.costoPerUnita && !!record.modalita && !!record.quantitaModalita;
  if ('luogoStoccaggioId' in patch) record.luogoStoccaggioId = record.luogoStoccaggioId || null;
  if (!record.modalita) {
    record.contaNelTotale = false;
    record.costoPerUnita = false;
  }
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
