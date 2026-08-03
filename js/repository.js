import { Store } from './db.js';
import { uuid, nowISO, timeToMinutes, parseCoordinateInput, haversineKm } from './utils.js';

/* ---------------------------------------------------------------------- */
/* Destinazioni                                                            */
/* ---------------------------------------------------------------------- */

export async function listDestinazioni() {
  const list = await Store.getAll('destinazioni');
  return list.sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
}

export async function getDestinazione(id) {
  return Store.get('destinazioni', id);
}

export async function createDestinazione({ nome, note = '', stato = '', regione = '', provincia = '', coordinateRaw = '', categorieIds = [], immagini = [] }) {
  const record = {
    id: uuid(),
    nome: nome.trim(),
    note: note.trim(),
    stato: stato.trim(),
    regione: regione.trim(),
    provincia: provincia.trim(),
    coordinate: parseCoordinateInput(coordinateRaw),
    categorieIds: [...categorieIds],
    immagini: [...immagini],
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
  return Store.put('destinazioni', record);
}

export async function updateDestinazione(id, { nome, note, stato, regione, provincia, coordinateRaw, categorieIds, immagini }) {
  const record = await Store.get('destinazioni', id);
  if (!record) throw new Error('Destinazione non trovata');
  record.nome = nome.trim();
  record.note = (note ?? '').trim();
  record.stato = (stato ?? '').trim();
  record.regione = (regione ?? '').trim();
  record.provincia = (provincia ?? '').trim();
  record.coordinate = parseCoordinateInput(coordinateRaw ?? '');
  record.categorieIds = categorieIds ? [...categorieIds] : record.categorieIds || [];
  record.immagini = immagini ? [...immagini] : record.immagini || [];
  record.updatedAt = nowISO();
  return Store.put('destinazioni', record);
}

/** Valori distinti già in uso, per popolare i filtri a tendina con dati reali. */
export async function getFacetsDestinazioni() {
  const all = await Store.getAll('destinazioni');
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'));
  return {
    stati: uniq(all.map((d) => d.stato)),
    regioni: uniq(all.map((d) => d.regione)),
    province: uniq(all.map((d) => d.provincia)),
  };
}

/* ---------------------------------------------------------------------- */
/* Categorie destinazione (gestite da Impostazioni, non esclusive)         */
/* ---------------------------------------------------------------------- */

export async function listCategorieDestinazione() {
  const list = await Store.getAll('categorieDestinazione');
  return list.sort((a, b) => a.ordine - b.ordine);
}

export async function getCategoriaDestinazione(id) {
  return Store.get('categorieDestinazione', id);
}

export async function createCategoriaDestinazione({ nome }) {
  const esistenti = await listCategorieDestinazione();
  const record = { id: uuid(), nome: nome.trim(), ordine: esistenti.length, createdAt: nowISO(), updatedAt: nowISO() };
  return Store.put('categorieDestinazione', record);
}

export async function updateCategoriaDestinazione(id, { nome }) {
  const record = await Store.get('categorieDestinazione', id);
  if (!record) throw new Error('Categoria non trovata');
  record.nome = nome.trim();
  record.updatedAt = nowISO();
  return Store.put('categorieDestinazione', record);
}

export async function checkCategoriaDestinazioneUsage(id) {
  const all = await Store.getAll('destinazioni');
  const usate = all.filter((d) => (d.categorieIds || []).includes(id));
  return { count: usate.length, destinazioni: usate };
}

export async function deleteCategoriaDestinazione(id) {
  const usage = await checkCategoriaDestinazioneUsage(id);
  if (usage.count > 0) {
    throw new Error(`Categoria ancora usata da ${usage.count} destinazioni: riassegnale prima di eliminarla.`);
  }
  await Store.delete('categorieDestinazione', id);
}

/**
 * Destinazioni entro un raggio da un punto, ordinate per distanza crescente.
 * Ogni risultato porta con sé `distanzaKm`. Ignora le destinazioni senza coordinate.
 */
export async function listDestinazioniEntroDistanza(origine, maxKm) {
  const all = await Store.getAll('destinazioni');
  return all
    .map((d) => ({ ...d, distanzaKm: d.coordinate ? haversineKm(origine, d.coordinate) : null }))
    .filter((d) => d.distanzaKm != null && d.distanzaKm <= maxKm)
    .sort((a, b) => a.distanzaKm - b.distanzaKm);
}

/* ---------------------------------------------------------------------- */
/* Configurazione app (record singolo, non incluso nel backup)             */
/* ---------------------------------------------------------------------- */

const CONFIG_ID = 'app';
const NAV_NASCOSTI_DEFAULT = ['esplora']; // di default, solo Esplora parte nascosta

export async function getConfig() {
  const record = await Store.get('configurazione', CONFIG_ID);
  if (!record) return { id: CONFIG_ID, orsApiKey: '', navNascosti: [...NAV_NASCOSTI_DEFAULT] };
  if (record.navNascosti === undefined) record.navNascosti = [...NAV_NASCOSTI_DEFAULT];
  return record;
}

export async function setOrsApiKey(key) {
  const record = await getConfig();
  record.orsApiKey = (key || '').trim();
  return Store.put('configurazione', record);
}

/** Voci di navigazione nascoste dalla rail: "impostazioni" non può mai finirci, altrimenti
 * non ci sarebbe più modo di tornare a mostrare le altre. */
export async function setNavNascosti(chiavi) {
  const record = await getConfig();
  record.navNascosti = chiavi.filter((k) => k !== 'impostazioni');
  return Store.put('configurazione', record);
}

/**
 * Analizza tutto ciò che dipende da una destinazione, per mostrare
 * un avviso chiaro prima della cancellazione a cascata.
 */
export async function checkDestinazioneUsage(id) {
  const tappe = await Store.getAllByIndex('tappe', 'destinazioneId', id);
  const tappaIds = new Set(tappe.map((t) => t.id));

  const giornate = await Store.getAllByIndex('giornate', 'destinazioneId', id);

  const tuttePianificate = await Store.getAll('tappePianificate');
  const pianificateCoinvolte = tuttePianificate.filter((p) => tappaIds.has(p.tappaId) || giornate.some((g) => g.id === p.giornataId));

  const vacanzeIds = new Set(giornate.map((g) => g.vacanzaId));
  const tutteVacanze = await Store.getAll('vacanze');
  const vacanzeFisseCollegate = tutteVacanze.filter((v) => v.tipo === 'fissa' && v.destinazionePrincipaleId === id);
  vacanzeFisseCollegate.forEach((v) => vacanzeIds.add(v.id));
  const vacanzeCoinvolte = tutteVacanze.filter((v) => vacanzeIds.has(v.id));

  return {
    tappeCount: tappe.length,
    giornateCount: giornate.length,
    pianificateCount: pianificateCoinvolte.length,
    vacanzeCoinvolte,
  };
}

export async function deleteDestinazioneCascade(id) {
  const tappe = await Store.getAllByIndex('tappe', 'destinazioneId', id);
  const tappaIds = new Set(tappe.map((t) => t.id));

  const giornate = await Store.getAllByIndex('giornate', 'destinazioneId', id);
  const giornataIds = new Set(giornate.map((g) => g.id));

  const tuttePianificate = await Store.getAll('tappePianificate');
  for (const p of tuttePianificate) {
    if (tappaIds.has(p.tappaId) || giornataIds.has(p.giornataId)) {
      await Store.delete('tappePianificate', p.id);
    }
  }

  for (const g of giornate) await Store.delete('giornate', g.id);

  const tutteVacanze = await Store.getAll('vacanze');
  const vacanzeFisseCollegate = tutteVacanze.filter((v) => v.tipo === 'fissa' && v.destinazionePrincipaleId === id);
  for (const v of vacanzeFisseCollegate) {
    const altreGiornate = await Store.getAllByIndex('giornate', 'vacanzaId', v.id);
    for (const g of altreGiornate) {
      const pian = await Store.getAllByIndex('tappePianificate', 'giornataId', g.id);
      for (const p of pian) await Store.delete('tappePianificate', p.id);
      await Store.delete('giornate', g.id);
    }
    await Store.delete('vacanze', v.id);
  }

  for (const t of tappe) await Store.delete('tappe', t.id);
  await Store.delete('destinazioni', id);
}

/* ---------------------------------------------------------------------- */
/* Tappe                                                                   */
/* ---------------------------------------------------------------------- */

export async function listTappeByDestinazione(destinazioneId) {
  const list = await Store.getAllByIndex('tappe', 'destinazioneId', destinazioneId);
  return list.sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
}

export async function getTappa(id) {
  return Store.get('tappe', id);
}

export async function createTappa({ destinazioneId, nome, tipi, note = '', durataConsigliataMin = null, coordinateRaw = '', immagini = [] }) {
  const record = {
    id: uuid(),
    destinazioneId,
    nome: nome.trim(),
    tipi: [...tipi], // il primo è il tipo principale: decide il raggruppamento nella pagina destinazione
    note: note.trim(),
    durataConsigliataMin: durataConsigliataMin || null,
    coordinate: parseCoordinateInput(coordinateRaw),
    immagini: [...immagini],
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
  return Store.put('tappe', record);
}

export async function updateTappa(id, { nome, tipi, note, durataConsigliataMin, coordinateRaw, immagini }) {
  const record = await Store.get('tappe', id);
  if (!record) throw new Error('Tappa non trovata');
  record.nome = nome.trim();
  record.tipi = [...tipi];
  record.note = (note ?? '').trim();
  record.durataConsigliataMin = durataConsigliataMin || null;
  record.coordinate = parseCoordinateInput(coordinateRaw ?? '');
  record.immagini = immagini ? [...immagini] : record.immagini || [];
  record.updatedAt = nowISO();
  return Store.put('tappe', record);
}

export async function checkTappaUsage(id) {
  const pianificate = await Store.getAllByIndex('tappePianificate', 'tappaId', id);
  const giornateIds = new Set(pianificate.map((p) => p.giornataId));
  const tutteGiornate = await Store.getAll('giornate');
  const giornateCoinvolte = tutteGiornate.filter((g) => giornateIds.has(g.id));
  const vacanzeIds = new Set(giornateCoinvolte.map((g) => g.vacanzaId));
  const tutteVacanze = await Store.getAll('vacanze');
  const vacanzeCoinvolte = tutteVacanze.filter((v) => vacanzeIds.has(v.id));
  return { pianificateCount: pianificate.length, vacanzeCoinvolte };
}

export async function deleteTappaCascade(id) {
  const pianificate = await Store.getAllByIndex('tappePianificate', 'tappaId', id);
  for (const p of pianificate) await Store.delete('tappePianificate', p.id);
  await Store.delete('tappe', id);
}

/* ---------------------------------------------------------------------- */
/* Tipi di tappa (gestiti da Impostazioni)                                 */
/* ---------------------------------------------------------------------- */

export async function listTipiTappa() {
  const list = await Store.getAll('tipiTappa');
  return list.sort((a, b) => a.ordine - b.ordine);
}

export async function getTipoTappa(id) {
  return Store.get('tipiTappa', id);
}

export async function createTipoTappa({ nome }) {
  const esistenti = await listTipiTappa();
  const record = {
    id: uuid(),
    nome: nome.trim(),
    ordine: esistenti.length,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
  return Store.put('tipiTappa', record);
}

export async function updateTipoTappa(id, { nome }) {
  const record = await Store.get('tipiTappa', id);
  if (!record) throw new Error('Tipo non trovato');
  record.nome = nome.trim();
  record.updatedAt = nowISO();
  return Store.put('tipiTappa', record);
}

/** Quante tappe usano ancora questo tipo (tra tutti i loro tipi): se >0, blocco l'eliminazione in UI. */
export async function checkTipoTappaUsage(id) {
  const tappe = await Store.getAllByIndex('tappe', 'tipi', id);
  return { count: tappe.length, tappe };
}

export async function deleteTipoTappa(id) {
  const usage = await checkTipoTappaUsage(id);
  if (usage.count > 0) {
    throw new Error(`Tipo ancora usato da ${usage.count} tappe: riassegnale prima di eliminarlo.`);
  }
  await Store.delete('tipiTappa', id);
}

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

export async function createVacanza({ nome, tipo, destinazionePrincipaleId = null, dataInizio = '', dataFine = '', numeroPersone = 1 }) {
  const record = {
    id: uuid(),
    nome: nome.trim(),
    tipo, // 'fissa' | 'itinerante'
    destinazionePrincipaleId: tipo === 'fissa' ? destinazionePrincipaleId : null,
    alloggioId: null, // vacanze "fisse": un solo alloggio per tutta la vacanza
    alloggiIds: tipo === 'itinerante' ? [] : null, // vacanze itineranti: pool di alloggi tra cui scegliere giorno per giorno
    dataInizio,
    dataFine,
    numeroPersone: Number(numeroPersone) || 1,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
  const saved = await Store.put('vacanze', record);
  if (tipo === 'fissa' && destinazionePrincipaleId) {
    await addGiornata(saved.id, destinazionePrincipaleId);
  }
  return saved;
}

export async function updateVacanza(id, { nome, dataInizio, dataFine, numeroPersone }) {
  const record = await Store.get('vacanze', id);
  if (!record) throw new Error('Vacanza non trovata');
  record.nome = nome.trim();
  record.dataInizio = dataInizio ?? record.dataInizio;
  record.dataFine = dataFine ?? record.dataFine;
  if (numeroPersone !== undefined) record.numeroPersone = Number(numeroPersone) || 1;
  record.updatedAt = nowISO();
  return Store.put('vacanze', record);
}

/** Alloggio unico per una vacanza "fissa" (un luogo). */
export async function setVacanzaAlloggio(vacanzaId, tappaId) {
  const record = await Store.get('vacanze', vacanzaId);
  if (!record) throw new Error('Vacanza non trovata');
  record.alloggioId = tappaId || null;
  record.updatedAt = nowISO();
  return Store.put('vacanze', record);
}

/** Pool di alloggi tra cui scegliere giorno per giorno in una vacanza itinerante. */
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

/** Tutte le tappe di tipo "alloggio" nell'archivio, indipendentemente dalla destinazione. */
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

/** Id delle destinazioni distinte che compaiono nelle giornate di una vacanza (per i filtri). */
export async function listDestinazioneIdsUsateByVacanza(vacanzaId) {
  const giornate = await listGiornateByVacanza(vacanzaId);
  return [...new Set(giornate.map((g) => g.destinazioneId).filter(Boolean))];
}

export async function addGiornata(vacanzaId, destinazioneId) {
  const esistenti = await listGiornateByVacanza(vacanzaId);
  const record = {
    id: uuid(),
    vacanzaId,
    ordine: esistenti.length,
    data: '',
    destinazioneId,
    alloggioId: null, // solo per vacanze itineranti: scelto tra il pool alloggiIds della vacanza
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
  const saved = await Store.put('giornate', record);
  const vacanza = await Store.get('vacanze', vacanzaId);
  vacanza.updatedAt = nowISO();
  await Store.put('vacanze', vacanza);
  return saved;
}

/** Alloggio del giorno (solo vacanze itineranti): deve appartenere al pool alloggiIds della vacanza. */
export async function setGiornataAlloggio(giornataId, tappaId) {
  const giornata = await Store.get('giornate', giornataId);
  if (!giornata) throw new Error('Giornata non trovata');
  giornata.alloggioId = tappaId || null;
  giornata.updatedAt = nowISO();
  return Store.put('giornate', giornata);
}

/** Cambia la destinazione di UNA giornata: consentito solo se la vacanza è itinerante. */
export async function updateGiornataDestinazione(giornataId, destinazioneId) {
  const giornata = await Store.get('giornate', giornataId);
  if (!giornata) throw new Error('Giornata non trovata');
  const vacanza = await Store.get('vacanze', giornata.vacanzaId);
  if (vacanza.tipo === 'fissa') {
    throw new Error('In una vacanza "un luogo" la destinazione è fissa per tutte le giornate');
  }
  giornata.destinazioneId = destinazioneId;
  giornata.updatedAt = nowISO();

  // Le tappe pianificate della vecchia destinazione non hanno più senso: le rimuoviamo,
  // ma l'avviso all'utente viene mostrato in UI prima di chiamare questa funzione.
  const pian = await Store.getAllByIndex('tappePianificate', 'giornataId', giornataId);
  for (const p of pian) await Store.delete('tappePianificate', p.id);

  return Store.put('giornate', giornata);
}

export async function updateGiornataData(giornataId, data) {
  const giornata = await Store.get('giornate', giornataId);
  giornata.data = data;
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
