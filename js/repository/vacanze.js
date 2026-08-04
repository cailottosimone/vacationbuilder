import { Store } from '../db.js';
import { uuid, nowISO, timeToMinutes } from '../utils.js';

/* ---------------------------------------------------------------------- */
/* Vacanze                                                                 */
/* ---------------------------------------------------------------------- */

export async function listVacanze() {
  const list = await Store.getAll('vacanze');
  return list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export async function getVacanza(id) {
  return Store.get('vacanze', id);
}

export async function createVacanza({ nome, dataInizio = '', dataFine = '', numeroPersone = 1, immagini = [] }) {
  const record = {
    id: uuid(),
    nome: nome.trim(),
    alloggiIds: [], // pool di alloggi tra cui scegliere giorno per giorno
    dataInizio,
    dataFine,
    numeroPersone: Number(numeroPersone) || 1,
    immagini: [...immagini],
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
  const saved = await Store.put('vacanze', record);
  await addGiornata(saved.id); // si parte sempre con almeno un giorno, vuoto: le destinazioni si capiscono da quel che ci pianifichi dentro
  return saved;
}

export async function updateVacanza(id, { nome, dataInizio, dataFine, numeroPersone, immagini }) {
  const record = await Store.get('vacanze', id);
  if (!record) throw new Error('Vacanza non trovata');
  record.nome = nome.trim();
  record.dataInizio = dataInizio ?? record.dataInizio;
  record.dataFine = dataFine ?? record.dataFine;
  if (numeroPersone !== undefined) record.numeroPersone = Number(numeroPersone) || 1;
  if (immagini !== undefined) record.immagini = immagini;
  record.updatedAt = nowISO();
  return Store.put('vacanze', record);
}

/** Pool di alloggi tra cui scegliere giorno per giorno. */
export async function addAlloggioToVacanza(vacanzaId, tappaId) {
  const record = await Store.get('vacanze', vacanzaId);
  if (!record) throw new Error('Vacanza non trovata');
  const set = new Set(record.alloggiIds || []);
  set.add(tappaId);
  record.alloggiIds = [...set];
  record.updatedAt = nowISO();
  return Store.put('vacanze', record);
}

export async function removeAlloggioFromVacanza(vacanzaId, tappaId) {
  const record = await Store.get('vacanze', vacanzaId);
  if (!record) throw new Error('Vacanza non trovata');
  record.alloggiIds = (record.alloggiIds || []).filter((id) => id !== tappaId);
  record.updatedAt = nowISO();
  // se qualche giornata aveva questo alloggio selezionato, lo azzeriamo
  const giornate = await listGiornateByVacanza(vacanzaId);
  for (const g of giornate) {
    if (g.alloggioId === tappaId) {
      g.alloggioId = null;
      g.updatedAt = nowISO();
      await Store.put('giornate', g);
    }
  }
  return Store.put('vacanze', record);
}

/** Tappe che hanno "alloggio" tra i loro tipi, anche se non è il tipo principale (es. un rifugio Ristoro + Alloggio). */
export async function listTappeAlloggio() {
  return Store.getAllByIndex('tappe', 'tipi', 'alloggio');
}

export async function deleteVacanza(id) {
  const giornate = await Store.getAllByIndex('giornate', 'vacanzaId', id);
  for (const g of giornate) {
    const pian = await Store.getAllByIndex('tappePianificate', 'giornataId', g.id);
    for (const p of pian) await Store.delete('tappePianificate', p.id);
    await Store.delete('giornate', g.id);
  }
  const spese = await Store.getAllByIndex('spese', 'vacanzaId', id);
  for (const s of spese) await Store.delete('spese', s.id);
  const voci = await Store.getAllByIndex('listaVoci', 'vacanzaId', id);
  for (const v of voci) await Store.delete('listaVoci', v.id);
  await Store.delete('vacanze', id);
}

/* ---------------------------------------------------------------------- */
/* Giornate                                                                */
/* ---------------------------------------------------------------------- */

export async function getGiornata(id) {
  return Store.get('giornate', id);
}

export async function listGiornateByVacanza(vacanzaId) {
  const list = await Store.getAllByIndex('giornate', 'vacanzaId', vacanzaId);
  return list.sort((a, b) => a.ordine - b.ordine);
}

/** Le destinazioni "toccate" da un giorno non sono più una scelta a monte: si deducono dalle
 * tappe pianificate al suo interno (più l'eventuale alloggio). Un giorno può benissimo toccare
 * più destinazioni insieme (es. una sosta a metà strada). Ritorna gli oggetti Destinazione. */
export async function getDestinazioniGiorno(giornataId) {
  const voci = await Store.getAllByIndex('tappePianificate', 'giornataId', giornataId);
  const giornata = await Store.get('giornate', giornataId);
  const tappaIds = new Set();
  for (const v of voci) {
    if (v.tipoVoce === 'tappa' && v.tappaId) tappaIds.add(v.tappaId);
  }
  if (giornata && giornata.alloggioId) tappaIds.add(giornata.alloggioId);
  const destIds = new Set();
  for (const tappaId of tappaIds) {
    const tappa = await Store.get('tappe', tappaId);
    if (tappa && tappa.destinazioneId) destIds.add(tappa.destinazioneId);
  }
  const destinazioni = [];
  for (const id of destIds) {
    const d = await Store.get('destinazioni', id);
    if (d) destinazioni.push(d);
  }
  return destinazioni;
}

/** Id delle destinazioni distinte toccate in tutta la vacanza (per i filtri). */
export async function listDestinazioneIdsUsateByVacanza(vacanzaId) {
  const giornate = await listGiornateByVacanza(vacanzaId);
  const ids = new Set();
  for (const g of giornate) {
    const dest = await getDestinazioniGiorno(g.id);
    dest.forEach((d) => ids.add(d.id));
  }
  return [...ids];
}

/** Quanti giorni si possono ancora aggiungere: se la vacanza ha entrambe le date, non oltre la
 * durata del periodo; altrimenti nessun limite (l'utente non ha ancora deciso le date). */
export async function canAddGiorno(vacanzaId) {
  const vacanza = await Store.get('vacanze', vacanzaId);
  const giorniAttuali = (await listGiornateByVacanza(vacanzaId)).length;
  if (!vacanza || !vacanza.dataInizio || !vacanza.dataFine) {
    return { ok: true, maxGiorni: null, giorniAttuali };
  }
  const inizio = new Date(vacanza.dataInizio);
  const fine = new Date(vacanza.dataFine);
  const maxGiorni = Math.round((fine - inizio) / 86400000) + 1;
  return { ok: giorniAttuali < maxGiorni, maxGiorni, giorniAttuali };
}

/** Data di un giorno dalla sua posizione, se la vacanza ha una data di inizio: altrimenti null. */
export function dataGiorno(vacanza, indice) {
  if (!vacanza || !vacanza.dataInizio) return null;
  const d = new Date(vacanza.dataInizio);
  d.setDate(d.getDate() + indice);
  return d.toISOString().slice(0, 10);
}

export async function addGiornata(vacanzaId) {
  const check = await canAddGiorno(vacanzaId);
  if (!check.ok) {
    throw new Error(`La vacanza copre ${check.maxGiorni} giorni: non puoi pianificarne di più senza allungare le date.`);
  }
  const esistenti = await listGiornateByVacanza(vacanzaId);
  const record = {
    id: uuid(),
    vacanzaId,
    ordine: esistenti.length,
    alloggioId: null, // scelto tra il pool alloggiIds della vacanza
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
  const saved = await Store.put('giornate', record);
  const vacanza = await Store.get('vacanze', vacanzaId);
  vacanza.updatedAt = nowISO();
  await Store.put('vacanze', vacanza);
  return saved;
}

/** Alloggio del giorno: deve appartenere al pool alloggiIds della vacanza. */
export async function setGiornataAlloggio(giornataId, tappaId) {
  const giornata = await Store.get('giornate', giornataId);
  if (!giornata) throw new Error('Giornata non trovata');
  giornata.alloggioId = tappaId || null;
  giornata.updatedAt = nowISO();
  return Store.put('giornate', giornata);
}

export async function deleteGiornata(giornataId) {
  const pian = await Store.getAllByIndex('tappePianificate', 'giornataId', giornataId);
  for (const p of pian) {
    const speseVoce = await Store.getAllByIndex('spese', 'voceId', p.id);
    for (const s of speseVoce) await Store.delete('spese', s.id);
    await Store.delete('tappePianificate', p.id);
  }
  const listaGiorno = await Store.getAllByIndex('listaVoci', 'giornataId', giornataId);
  for (const v of listaGiorno) await Store.delete('listaVoci', v.id);
  const giornata = await Store.get('giornate', giornataId);
  await Store.delete('giornate', giornataId);
  // riordina le giornate rimanenti
  const restanti = await listGiornateByVacanza(giornata.vacanzaId);
  for (let i = 0; i < restanti.length; i++) {
    restanti[i].ordine = i;
    await Store.put('giornate', restanti[i]);
  }
}

export async function reorderGiornate(vacanzaId, orderedIds) {
  const giornate = await listGiornateByVacanza(vacanzaId);
  const byId = new Map(giornate.map((g) => [g.id, g]));
  for (let i = 0; i < orderedIds.length; i++) {
    const g = byId.get(orderedIds[i]);
    if (!g) continue;
    g.ordine = i;
    await Store.put('giornate', g);
  }
}

/* ---------------------------------------------------------------------- */
/* Voci di giornata: tappa / partenza / rientro / spostamento              */
/* Restano fisicamente nello store "tappePianificate" per continuità dei   */
/* dati; il campo tipoVoce distingue il tipo di voce.                      */
/* ---------------------------------------------------------------------- */

export async function getVoce(id) {
  return Store.get('tappePianificate', id);
}

/** Assegna un `ordine` a eventuali voci "vecchie" (create prima dell'introduzione del
 * riordino manuale), basandosi sull'orario che avevano, così il drag & drop può partire
 * da uno stato coerente anche su archivi già esistenti. */
async function ensureOrdine(giornataId) {
  const all = await Store.getAllByIndex('tappePianificate', 'giornataId', giornataId);
  const senzaOrdine = all.filter((v) => v.ordine == null);
  if (!senzaOrdine.length) return;
  const conOrario = all
    .map((v) => ({ v, t: timeToMinutes(v.oraInizio || v.ora) ?? 999999 }))
    .sort((a, b) => a.t - b.t);
  for (let i = 0; i < conOrario.length; i++) {
    if (conOrario[i].v.ordine == null) {
      conOrario[i].v.ordine = i;
      await Store.put('tappePianificate', conOrario[i].v);
    }
  }
}

/** Converte le vecchie voci con orario fisso (oraInizio/oraFine) nel nuovo modello a durata
 * (permanenza per le tappe, durata per gli spostamenti): l'orario diventa la loro durata,
 * così da giornate già pianificate non si perde nulla passando alla nuova versione. Il Rientro,
 * che prima aveva un orario fisso obbligatorio, passa a orario calcolato: quello che avevi
 * scritto diventa un oraFissata (un override esplicito), preservando la tua scelta originale. */
async function ensureDurate(giornataId) {
  const all = await Store.getAllByIndex('tappePianificate', 'giornataId', giornataId);
  for (const v of all) {
    if (v.tipoVoce === 'tappa' && v.permanenzaMin == null) {
      const start = timeToMinutes(v.oraInizio);
      const end = timeToMinutes(v.oraFine);
      v.permanenzaMin = start != null && end != null && end > start ? end - start : 60;
      if (v.oraFissata === undefined) v.oraFissata = null;
      await Store.put('tappePianificate', v);
    } else if (v.tipoVoce === 'spostamento' && v.durataMin === undefined) {
      const start = timeToMinutes(v.oraInizio);
      const end = timeToMinutes(v.oraFine);
      v.durataMin = start != null && end != null && end > start ? end - start : null;
      if (v.oraFissata === undefined) v.oraFissata = null;
      await Store.put('tappePianificate', v);
    } else if (v.tipoVoce === 'rientro' && v.oraFissata === undefined) {
      v.oraFissata = v.ora || null;
      await Store.put('tappePianificate', v);
    }
  }
}

export async function listVociByGiornata(giornataId) {
  await ensureOrdine(giornataId);
  await ensureDurate(giornataId);
  const list = await Store.getAllByIndex('tappePianificate', 'giornataId', giornataId);
  return list.sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0));
}

/**
 * Calcola l'ordine da assegnare a una nuova voce: in fondo (append) se atIndex non è
 * specificato, oppure esattamente alla posizione atIndex, "spostando giù" di uno slot
 * tutte le voci successive per fare spazio. atIndex è l'indice del "varco" tra due card
 * (0 = prima di tutte, length = dopo l'ultima).
 */
async function reserveOrdine(giornataId, atIndex = null) {
  const esistenti = await listVociByGiornata(giornataId); // già ordinate, ordine garantito
  if (atIndex == null) return esistenti.length;
  const clamped = Math.max(0, Math.min(atIndex, esistenti.length));
  for (let i = 0; i < esistenti.length; i++) {
    const targetOrdine = i >= clamped ? i + 1 : i;
    if (esistenti[i].ordine !== targetOrdine) {
      esistenti[i].ordine = targetOrdine;
      await Store.put('tappePianificate', esistenti[i]);
    }
  }
  return clamped;
}

/** Tappa: niente più orario fisso, solo permanenza (minuti). L'inizio si calcola da solo
 * sommando le durate dall'ultima Partenza/Rientro, salvo che tu non imposti un orario fisso
 * per questa voce specifica (oraFissata). */
export async function addVoceTappa({ giornataId, tappaId, permanenzaMin, oraFissata = null, note = '', atIndex = null }) {
  const record = {
    id: uuid(),
    giornataId,
    tipoVoce: 'tappa',
    ordine: await reserveOrdine(giornataId, atIndex),
    tappaId,
    permanenzaMin,
    oraFissata,
    note: note.trim(),
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
  return Store.put('tappePianificate', record);
}

export async function addVocePartenza({ giornataId, ora, daRifTappaId = null, note = '', atIndex = null }) {
  const record = {
    id: uuid(),
    giornataId,
    tipoVoce: 'partenza',
    ordine: await reserveOrdine(giornataId, atIndex),
    ora,
    daRifTappaId,
    note: note.trim(),
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
  return Store.put('tappePianificate', record);
}

/** Rientro: trattato come una Tappa "di passaggio" (permanenza implicita 0) — il suo orario si
 * calcola da solo sommando le durate di quel che viene prima, salvo che tu non imposti
 * un'ancora esplicita con oraFissata. */
export async function addVoceRientro({ giornataId, aRifTappaId = null, oraFissata = null, note = '', atIndex = null }) {
  const record = {
    id: uuid(),
    giornataId,
    tipoVoce: 'rientro',
    ordine: await reserveOrdine(giornataId, atIndex),
    aRifTappaId,
    oraFissata,
    note: note.trim(),
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
  return Store.put('tappePianificate', record);
}

/**
 * Spostamento: nasce senza durata esplicita. Se calcoli la distanza reale, la durata di quel
 * calcolo (durataRealeMin) fa da default; puoi comunque fissarne una a mano (durataMin), che ha
 * sempre la priorità. oraFissata, come per la Tappa, fa da ancora opzionale per questa voce.
 */
export async function addVoceSpostamento({ giornataId, mezzo, daRifTappaId = null, aRifTappaId = null, note = '', atIndex = null, distanzaRealeKm = null, durataRealeMin = null, durataMin = null, oraFissata = null }) {
  const record = {
    id: uuid(),
    giornataId,
    tipoVoce: 'spostamento',
    ordine: await reserveOrdine(giornataId, atIndex),
    mezzo,
    daRifTappaId,
    aRifTappaId,
    distanzaRealeKm,
    durataRealeMin,
    durataMin,
    oraFissata,
    note: note.trim(),
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
  return Store.put('tappePianificate', record);
}

/** Aggiornamento generico: applica solo i campi passati, qualunque sia il tipoVoce. */
export async function updateVoce(id, patch) {
  const record = await Store.get('tappePianificate', id);
  if (!record) throw new Error('Voce non trovata');
  Object.assign(record, patch);
  if (typeof record.note === 'string') record.note = record.note.trim();
  record.updatedAt = nowISO();
  return Store.put('tappePianificate', record);
}

export async function deleteVoce(id) {
  const speseCollegate = await Store.getAllByIndex('spese', 'voceId', id);
  for (const s of speseCollegate) await Store.delete('spese', s.id);
  await Store.delete('tappePianificate', id);
}

/** Quante spese sono collegate a questa voce (per l'avviso di conferma eliminazione). */
export async function checkVoceSpesaUsage(voceId) {
  const spese = await Store.getAllByIndex('spese', 'voceId', voceId);
  return { count: spese.length, spese };
}

export async function reorderVoci(giornataId, orderedIds) {
  const list = await Store.getAllByIndex('tappePianificate', 'giornataId', giornataId);
  const byId = new Map(list.map((v) => [v.id, v]));
  for (let i = 0; i < orderedIds.length; i++) {
    const v = byId.get(orderedIds[i]);
    if (!v) continue;
    v.ordine = i;
    await Store.put('tappePianificate', v);
  }
}
