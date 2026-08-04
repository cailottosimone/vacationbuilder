import { Store } from '../db.js';
import { uuid, nowISO, parseCoordinateInput, haversineKm } from '../utils.js';

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

  const tuttePianificate = await Store.getAll('tappePianificate');
  const pianificateCoinvolte = tuttePianificate.filter((p) => tappaIds.has(p.tappaId) || tappaIds.has(p.daRifTappaId) || tappaIds.has(p.aRifTappaId));

  const giornataIds = new Set(pianificateCoinvolte.map((p) => p.giornataId));
  const tutteGiornate = await Store.getAll('giornate');
  tutteGiornate.forEach((g) => {
    if (g.alloggioId && tappaIds.has(g.alloggioId)) giornataIds.add(g.id);
  });
  const giornateCoinvolte = tutteGiornate.filter((g) => giornataIds.has(g.id));

  const vacanzeIds = new Set(giornateCoinvolte.map((g) => g.vacanzaId));
  const tutteVacanze = await Store.getAll('vacanze');
  tutteVacanze.forEach((v) => {
    if ((v.alloggiIds || []).some((aid) => tappaIds.has(aid))) vacanzeIds.add(v.id);
  });
  const vacanzeCoinvolte = tutteVacanze.filter((v) => vacanzeIds.has(v.id));

  return {
    tappeCount: tappe.length,
    giornateCount: giornateCoinvolte.length,
    pianificateCount: pianificateCoinvolte.length,
    vacanzeCoinvolte,
  };
}

/** Elimina la destinazione e le sue tappe. Le vacanze/giorni che le avevano pianificate NON
 * vengono toccati: le voci che referenziavano quelle tappe restano (mostrate come "tappa
 * eliminata" in UI, come già succede eliminando una singola tappa) — un giorno può toccare più
 * destinazioni insieme, quindi cancellarne una non deve far sparire tutto il resto del giorno. */
export async function deleteDestinazioneCascade(id) {
  const tappe = await Store.getAllByIndex('tappe', 'destinazioneId', id);
  const tappaIds = new Set(tappe.map((t) => t.id));

  // Pulisce i riferimenti negli alloggi (pool vacanza + scelta del giorno), altrimenti
  // resterebbero id "fantasma" che puntano a una tappa non più esistente.
  const tutteVacanze = await Store.getAll('vacanze');
  for (const v of tutteVacanze) {
    if ((v.alloggiIds || []).some((aid) => tappaIds.has(aid))) {
      v.alloggiIds = v.alloggiIds.filter((aid) => !tappaIds.has(aid));
      v.updatedAt = nowISO();
      await Store.put('vacanze', v);
    }
  }
  const tutteGiornate = await Store.getAll('giornate');
  for (const g of tutteGiornate) {
    if (g.alloggioId && tappaIds.has(g.alloggioId)) {
      g.alloggioId = null;
      g.updatedAt = nowISO();
      await Store.put('giornate', g);
    }
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

/** Tutte le tappe dell'archivio, indipendentemente dalla destinazione (per i selettori che
 * lasciano scegliere tra tutte le destinazioni, con un filtro lato interfaccia). */
export async function listTappe() {
  const list = await Store.getAll('tappe');
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
