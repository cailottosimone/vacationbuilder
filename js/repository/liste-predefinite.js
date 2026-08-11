import { Store } from '../db.js';
import { uuid, nowISO } from '../utils.js';
import { getVacanza, listGiornateByVacanza } from './vacanze.js';
import { createListaVoce, deleteListaVoce, listListaVociGenerale, listListaVociGiorno, risolviNumeroPersoneQuantita } from './budget.js';

/* ---------------------------------------------------------------------- */
/* Liste predefinite: modelli riutilizzabili di voci, SENZA costo, da      */
/* copiare nella Lista di una vacanza (valigia o un giorno) come punto di  */
/* partenza precompilato. Una volta importate diventano voci Lista normali */
/* e indipendenti: modificare o cancellare il modello non tocca più nulla, */
/* e viceversa (stesso principio già visto per Categorie/Tipi: qui però    */
/* non è un'etichetta che si "aggiorna ovunque", è un punto di partenza    */
/* che si stacca appena copiato).                                         */
/* ---------------------------------------------------------------------- */

export async function listListePredefinite() {
  const list = await Store.getAll('listePredefinite');
  return list.sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
}

export async function getListaPredefinita(id) {
  return Store.get('listePredefinite', id);
}

export async function createListaPredefinita({ nome }) {
  const record = { id: uuid(), nome: (nome || '').trim(), createdAt: nowISO(), updatedAt: nowISO() };
  return Store.put('listePredefinite', record);
}

export async function updateListaPredefinita(id, { nome }) {
  const record = await Store.get('listePredefinite', id);
  if (!record) throw new Error('Lista predefinita non trovata');
  record.nome = (nome || '').trim();
  record.updatedAt = nowISO();
  return Store.put('listePredefinite', record);
}

export async function deleteListaPredefinita(id) {
  const voci = await listVociPredefiniteByLista(id);
  for (const v of voci) await Store.delete('vociPredefinite', v.id);
  await Store.delete('listePredefinite', id);
}

export async function listVociPredefiniteByLista(listaPredefinitaId) {
  const list = await Store.getAllByIndex('vociPredefinite', 'listaPredefinitaId', listaPredefinitaId);
  return list.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
}

export async function getVocePredefinita(id) {
  return Store.get('vociPredefinite', id);
}

/** Stessa struttura di quantità delle voci Lista (secca/perGiorno/perPersona/perPersonaGiorno),
 * ma senza alcun campo di costo: una lista predefinita è un modello riutilizzabile, non ha senso
 * legarla a un prezzo che cambia da viaggio a viaggio e da negozio a negozio. Il costo si imposta
 * dopo l'import, voce per voce, dentro la vacanza specifica dov'è già disponibile il widget prezzo. */
export async function createVocePredefinita({
  listaPredefinitaId, testo,
  quantitaModalita = null, quantitaValore = null, quantitaNumeroPersone = null, quantitaUnita = null,
  luogoStoccaggioId = null,
}) {
  const record = {
    id: uuid(),
    listaPredefinitaId,
    testo: (testo || '').trim(),
    quantitaModalita,
    quantitaValore: quantitaModalita ? Number(quantitaValore) || 0 : null,
    quantitaNumeroPersone: quantitaModalita && (quantitaModalita === 'perPersona' || quantitaModalita === 'perPersonaGiorno') && quantitaNumeroPersone != null && quantitaNumeroPersone !== '' ? Number(quantitaNumeroPersone) : null,
    quantitaUnita: quantitaModalita && quantitaUnita ? String(quantitaUnita).trim() || null : null,
    luogoStoccaggioId: luogoStoccaggioId || null,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
  return Store.put('vociPredefinite', record);
}

export async function updateVocePredefinita(id, patch) {
  const record = await Store.get('vociPredefinite', id);
  if (!record) throw new Error('Voce predefinita non trovata');
  Object.assign(record, patch);
  if (typeof record.testo === 'string') record.testo = record.testo.trim();
  if ('quantitaModalita' in patch || 'quantitaValore' in patch || 'quantitaNumeroPersone' in patch || 'quantitaUnita' in patch) {
    record.quantitaValore = record.quantitaModalita ? Number(record.quantitaValore) || 0 : null;
    record.quantitaNumeroPersone = record.quantitaModalita && (record.quantitaModalita === 'perPersona' || record.quantitaModalita === 'perPersonaGiorno') && record.quantitaNumeroPersone != null && record.quantitaNumeroPersone !== '' ? Number(record.quantitaNumeroPersone) : null;
    record.quantitaUnita = record.quantitaModalita && record.quantitaUnita ? String(record.quantitaUnita).trim() || null : null;
  }
  if ('luogoStoccaggioId' in patch) record.luogoStoccaggioId = record.luogoStoccaggioId || null;
  record.updatedAt = nowISO();
  return Store.put('vociPredefinite', record);
}

export async function deleteVocePredefinita(id) {
  await Store.delete('vociPredefinite', id);
}

/* ---------------------------------------------------------------------- */
/* Import in una vacanza                                                   */
/* ---------------------------------------------------------------------- */

/**
 * Copia tutte le voci di una o più liste predefinite dentro la Lista di una vacanza (lista
 * generale se giornataId è null, altrimenti la lista di quel giorno). `modalitaImport`:
 *  - 'sostituisci': le voci già presenti in quello scope vengono cancellate prima di aggiungere le nuove
 *  - 'integra':     le voci esistenti restano, le nuove si aggiungono in coda
 * (la scelta tra le due, se serve, la fa l'interfaccia PRIMA di chiamare questa funzione — qui
 * arriva già decisa, per tenere la funzione di repository senza side-effect di UI come conferme).
 *
 * Le modalità perGiorno/perPersonaGiorno non hanno senso in una lista di un SINGOLO giorno
 * (mancherebbe il concetto di "giorni della vacanza" a cui riferirsi): quando lo scope è un
 * giorno, vengono risolte subito in una quantità secca, usando persone/giorni della vacanza al
 * momento dell'import — da lì in poi restano un numero fisso, modificabile come ogni altro.
 */
export async function importListePredefiniteInVacanza(listaPredefinitaIds, vacanzaId, giornataId, modalitaImport) {
  const vacanza = await getVacanza(vacanzaId);
  const numeroGiorni = (await listGiornateByVacanza(vacanzaId)).length;

  if (modalitaImport === 'sostituisci') {
    const esistenti = giornataId ? await listListaVociGiorno(giornataId) : await listListaVociGenerale(vacanzaId);
    for (const v of esistenti) await deleteListaVoce(v.id);
  }

  for (const listaPredefinitaId of listaPredefinitaIds) {
    const voci = await listVociPredefiniteByLista(listaPredefinitaId);
    for (const v of voci) {
      let quantitaModalita = v.quantitaModalita;
      let quantitaValore = v.quantitaValore;
      let quantitaNumeroPersone = v.quantitaNumeroPersone;
      if (giornataId && (quantitaModalita === 'perGiorno' || quantitaModalita === 'perPersonaGiorno')) {
        const persone = quantitaModalita === 'perPersonaGiorno' ? risolviNumeroPersoneQuantita(v, vacanza) : 1;
        quantitaValore = (Number(v.quantitaValore) || 0) * persone * numeroGiorni;
        quantitaModalita = 'secca';
        quantitaNumeroPersone = null;
      }
      await createListaVoce({
        vacanzaId,
        giornataId,
        testo: v.testo,
        quantitaModalita,
        quantitaValore,
        quantitaNumeroPersone,
        quantitaUnita: v.quantitaUnita,
        luogoStoccaggioId: v.luogoStoccaggioId,
      });
    }
  }
}
