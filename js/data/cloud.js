// js/data/cloud.js — unico file che sa dell'esistenza di Supabase (database E storage). Il resto
// dell'app (viste, repository) non lo importa mai direttamente: passa sempre da data/sync.js. Se
// in futuro si cambiasse provider cloud, o si aggiungesse un campo immagine a un nuovo store
// (vedi js/data/config.js IMAGE_FIELDS), è questo l'unico file da riscrivere.
//
// Le foto (destinazioni/tappe/vacanze, campo "immagini") non viaggiano mai come base64 dentro la
// riga della tabella: vengono caricate su Supabase Storage una sola volta per contenuto (percorso
// = hash SHA-256 del data URL, così la stessa foto — anche riusata su record diversi, o arrivata
// da un altro dispositivo — non viene mai ricaricata due volte) e nella riga resta solo il
// percorso. Vedi resolveImagesForUpload/resolveImagesForDownload più sotto.

import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SCHEMA, STORAGE_BUCKET, conflictKeyFor, imageFieldsFor } from './config.js';
import { Store } from '../db.js';

let clientPromise = null;

/** Crea il client Supabase al primo utilizzo (import dinamico da CDN: nessuna dipendenza da
 * npm/build step, coerente con il resto dell'app). Se il caricamento fallisce (es. app aperta
 * offline la primissima volta, prima che lo script sia mai stato in cache del browser) ritorna
 * null: chi chiama deve trattarlo come "cloud non disponibile ora", mai come errore fatale. */
export function getClient() {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    try {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
      return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { db: { schema: SUPABASE_SCHEMA } });
    } catch (err) {
      console.warn('Client Supabase non disponibile (probabilmente offline):', err);
      clientPromise = null; // permette di riprovare al prossimo giro, non blocca per sempre
      return null;
    }
  })();
  return clientPromise;
}

function tableNameFor(storeName) {
  return storeName; // stesso nome dello store IndexedDB, stessa forma dei campi (camelCase)
}

/* ---------------------------------------------------------------------- */
/* Immagini: upload/download su Supabase Storage, con dedup per contenuto  */
/* ---------------------------------------------------------------------- */

const EXT_PER_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

function extForDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,/.exec(dataUrl || '');
  return (match && EXT_PER_MIME[match[1]]) || 'jpg';
}

async function hashDataUrl(dataUrl) {
  const bytes = new TextEncoder().encode(dataUrl);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('File non leggibile'));
    reader.readAsDataURL(blob);
  });
}

/** Carica un singolo data URL su Storage se non già presente (stesso hash = stesso contenuto: se
 * era già stato caricato, in questa sessione o in una precedente, salta l'upload). Ritorna il
 * percorso Storage, o null se il caricamento fallisce (l'immagine resta con il suo data URL
 * originale: vedi resolveImagesForUpload, che in quel caso non la sostituisce). */
async function ensureImageUploaded(client, userId, dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return dataUrl; // già un percorso risolto o valore anomalo: passa oltre così com'è

  const hash = await hashDataUrl(dataUrl);
  const cached = await Store.imageUploadGet(hash);
  if (cached) return cached.storagePath;

  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const path = `${userId}/${hash}.${extForDataUrl(dataUrl)}`;
    const { error } = await client.storage.from(STORAGE_BUCKET).upload(path, blob, {
      contentType: blob.type || 'image/jpeg',
      upsert: true, // idempotente: stesso hash = stesso contenuto, un secondo device può ricaricarla senza errore "già esistente"
    });
    if (error) throw error;
    await Store.imageUploadPut(hash, path);
    return path;
  } catch (err) {
    console.warn('Sync: upload immagine fallito, resta in coda al prossimo giro:', err.message || err);
    return null; // segnala al chiamante di non sostituire questa immagine nel payload
  }
}

/** Sostituisce, in una copia del record, ogni campo-immagine (array di data URL) con l'elenco dei
 * percorsi Storage corrispondenti. Se un'immagine non riesce a caricarsi, l'INTERO record resta
 * "da riprovare": non va sincronizzato solo a metà (vedi pushRecord). */
async function resolveImagesForUpload(client, userId, storeName, record) {
  const campi = imageFieldsFor(storeName);
  if (!campi.length) return record;

  const payload = { ...record };
  for (const campo of campi) {
    const valori = Array.isArray(record[campo]) ? record[campo] : [];
    if (!valori.length) continue;
    const risolti = await Promise.all(valori.map((v) => ensureImageUploaded(client, userId, v)));
    if (risolti.some((v) => v === null)) return null; // almeno un'immagine non è ancora caricabile: rimanda tutto il record
    payload[campo] = risolti;
  }
  return payload;
}

/** Scarica un singolo percorso Storage e lo converte in data URL, pronto da salvare in locale
 * esattamente come le foto create su questo stesso dispositivo. Ritorna null se il download
 * fallisce (rete assente a metà pull, file non ancora propagato...): l'immagine viene allora
 * omessa da questo giro, riproverà al prossimo pull. */
async function downloadImageAsDataUrl(client, storagePath) {
  if (typeof storagePath !== 'string' || storagePath.startsWith('data:')) return storagePath; // già un data URL (caso limite): passa oltre
  try {
    const { data, error } = await client.storage.from(STORAGE_BUCKET).download(storagePath);
    if (error) throw error;
    const dataUrl = await blobToDataUrl(data);
    // Anche l'immagine appena scaricata entra nella cache locale hash→percorso: se poi la si
    // modifica su QUESTO dispositivo e la si ricarica identica altrove, non viene ricaricata di
    // nuovo (è già nota come "già su Storage a questo percorso").
    const hash = await hashDataUrl(dataUrl);
    await Store.imageUploadPut(hash, storagePath);
    return dataUrl;
  } catch (err) {
    console.warn(`Sync: download immagine fallito per ${storagePath}, riproverà al prossimo pull:`, err.message || err);
    return null;
  }
}

/** Sostituisce, in una copia del record remoto, ogni campo-immagine (array di percorsi Storage)
 * con i data URL scaricati, pronti per l'uso locale. Le immagini non scaricabili in questo giro
 * vengono semplicemente omesse dall'array (non bloccano il resto del record, a differenza
 * dell'upload: un record arrivato dal cloud va comunque reso visibile anche con una foto in meno
 * per ora). */
async function resolveImagesForDownload(client, storeName, remote) {
  const campi = imageFieldsFor(storeName);
  if (!campi.length) return remote;

  const record = { ...remote };
  for (const campo of campi) {
    const valori = Array.isArray(remote[campo]) ? remote[campo] : [];
    if (!valori.length) continue;
    const scaricate = await Promise.all(valori.map((v) => downloadImageAsDataUrl(client, v)));
    record[campo] = scaricate.filter(Boolean);
  }
  return record;
}

/* ---------------------------------------------------------------------- */
/* Push / pull dei record                                                  */
/* ---------------------------------------------------------------------- */

/** Invia (upsert) un singolo record verso la tabella cloud corrispondente allo store. Le eventuali
 * immagini vengono prima caricate su Storage (solo quelle non ancora presenti). Ritorna true se
 * andato a buon fine, false se va ritentato più tardi (errore di rete/temporaneo, oppure
 * un'immagine non ancora caricabile). */
export async function pushRecord(storeName, record) {
  const client = await getClient();
  if (!client) return false;

  const campiImmagine = imageFieldsFor(storeName);
  let payload = record;
  if (campiImmagine.length) {
    const {
      data: { session },
    } = await client.auth.getSession();
    if (!session) return false;
    payload = await resolveImagesForUpload(client, session.user.id, storeName, record);
    if (!payload) return false; // almeno un'immagine non ancora caricabile: si riprova al prossimo giro
  }

  const { error } = await client
    .from(tableNameFor(storeName))
    .upsert(payload, { onConflict: conflictKeyFor(storeName) });
  if (error) {
    console.warn(`Sync: push fallito per ${storeName}/${record.id}:`, error.message);
    return false;
  }
  return true;
}

/** Recupera dal cloud tutti i record di uno store modificati dopo `sinceISO` (null = da sempre,
 * per il primo popolamento di un dispositivo nuovo), con le eventuali immagini già riportate a
 * data URL locali. RLS garantisce che tornino solo i record dell'utente autenticato: nessun
 * filtro per utente da scrivere qui. */
export async function pullChanges(storeName, sinceISO) {
  const client = await getClient();
  if (!client) return null; // null = "non disponibile ora", distinto da [] = "nessuna novità"
  let query = client.from(tableNameFor(storeName)).select('*').order('updatedAt', { ascending: true });
  if (sinceISO) query = query.gt('updatedAt', sinceISO);
  const { data, error } = await query;
  if (error) {
    console.warn(`Sync: pull fallito per ${storeName}:`, error.message);
    return null;
  }

  const campiImmagine = imageFieldsFor(storeName);
  if (!campiImmagine.length || !data.length) return data;
  return Promise.all(data.map((remote) => resolveImagesForDownload(client, storeName, remote)));
}
