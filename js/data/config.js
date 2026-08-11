// js/data/config.js — unico punto di configurazione del cloud. Stessa architettura di Preventivi
// Stampa 3D (stesso progetto Supabase, riusato: vedi commento sotto), adattata qui con due sole
// aggiunte specifiche di questa app: IMAGE_FIELDS e STORAGE_BUCKET, per le foto di destinazioni/
// tappe/vacanze (vedi js/data/cloud.js).
//
// SUPABASE_URL e SUPABASE_ANON_KEY sono pensate da Supabase per essere pubbliche nel client (non
// sono un segreto): la sicurezza reale è nelle policy RLS del database e dello storage, non nel
// nascondere questi due valori. Sono le stesse identiche di Preventivi Stampa 3D: stesso progetto
// Supabase condiviso dall'intera suite personale, con uno schema dedicato per app (vedi
// SUPABASE_SCHEMA sotto e supabase/schema.sql) per non far collidere le tabelle restando dentro
// ai limiti del piano gratuito.

export const SUPABASE_URL = 'https://xnkkacszdmrigudkwcio.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhua2thY3N6ZG1yaWd1ZGt3Y2lvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0NTYxMjQsImV4cCI6MjEwMjAzMjEyNH0.RSHH4-ltIWiMoNOfhcXi-Wfk8aoz2gg_oGZzAuyEQzA';

// Schema Postgres dedicato a questa app dentro al progetto Supabase condiviso (vedi
// supabase/schema.sql): stesso account/progetto di Preventivi Stampa 3D, schema diverso.
export const SUPABASE_SCHEMA = 'vacationbuilder';

// Store applicativi da sincronizzare: uno-a-uno con le tabelle dello schema cloud (stesso nome,
// stessi campi in camelCase — vedi supabase/schema.sql). Import statico da db.js: se in futuro si
// aggiunge uno store applicativo, questa lista si aggiorna da sola.
export { ALL_STORES as SYNCABLE_STORES } from '../db.js';

// Chiave/i di conflitto per l'upsert su Supabase, per store. Di norma è "id" (gli id sono UUID
// generati dal client, quindi già globalmente unici, salvo per i valori di seed di tipiTappa/
// categorieSpesa che usano uno slug testuale come id — comunque univoco). Nessuno store di questa
// app è un singleton per utente (a differenza di "impostazioni" in Preventivi3D), quindi qui non
// serve nessuna eccezione: la mappa resta vuota mostra solo il punto di estensione futuro.
export const CONFLICT_KEYS = {};

export function conflictKeyFor(storeName) {
  return CONFLICT_KEYS[storeName] || 'id';
}

// ----------------------------------------------------------------------------
// Immagini: destinazioni/tappe/vacanze possono avere una galleria (campo "immagini", array di
// data URL base64 salvate dirette nel record IndexedDB — vedi js/utils.js resizeImageFile). Per
// non far esplodere la tabella Postgres (e la sua quota, condivisa con le altre app della suite)
// con blob di testo enormi, queste foto NON viaggiano dentro la riga della tabella: vengono
// caricate su Supabase Storage (bucket dedicato, quota separata) e nella riga resta solo un
// riferimento leggero al file. Vedi js/data/cloud.js per la logica di upload/download.
//
// Elenco per store dei campi che contengono immagini, come array di data URL: se in futuro si
// aggiunge una galleria a un altro store, basta aggiungere una riga qui, nessun altro file da
// toccare.
export const IMAGE_FIELDS = {
  destinazioni: ['immagini'],
  tappe: ['immagini'],
  vacanze: ['immagini'],
};

export function imageFieldsFor(storeName) {
  return IMAGE_FIELDS[storeName] || [];
}

// Bucket Supabase Storage dedicato alle immagini di questa app (vedi supabase/README.md per la
// creazione). Percorso di ogni file dentro al bucket: "{userId}/{hashContenuto}.jpg" — organizzato
// per utente (le policy RLS dello storage verificano che il primo segmento del percorso combaci
// con auth.uid()) e indicizzato per contenuto (lo stesso file, byte per byte, produce sempre lo
// stesso percorso: un'immagine identica non viene mai caricata due volte, anche se usata in più
// record o dispositivi diversi).
export const STORAGE_BUCKET = 'vacationbuilder-immagini';
