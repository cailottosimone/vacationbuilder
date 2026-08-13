// js/data/sync.js — orchestratore della sincronizzazione. È l'unico file che i repository e le
// viste dovrebbero mai avere bisogno di conoscere oltre a data/auth.js: non tocca mai
// direttamente Supabase (passa da cloud.js) né mai IndexedDB con query dirette (passa da Store,
// esportato da db.js). Generico e riusabile identico in altre app della suite (compresa la
// gestione delle immagini: quella logica vive tutta dentro cloud.js, qui non se ne parla mai) —
// nessuna modifica necessaria rispetto a quello di Preventivi Stampa 3D.

import { Store, ALL_STORES } from '../db.js';
import { pushRecord, pullChanges } from './cloud.js';
import { getCurrentUser, onAuthChange, initAuth } from './auth.js';

const PUSH_INTERVAL_MS = 5000; // drena l'outbox quando online
const PULL_INTERVAL_MS = 60000; // controlla novità dal cloud

const listeners = new Set();
export const state = {
  status: 'offline', // 'offline' | 'disconnesso' (nessun account collegato) | 'idle' | 'syncing' | 'error'
  pendingCount: 0,
  lastError: null,
  lastSyncedAt: null,
};

function setState(patch) {
  Object.assign(state, patch);
  for (const fn of listeners) fn(state);
}

export function onSyncStateChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function refreshPendingCount() {
  setState({ pendingCount: await Store.outboxCount() });
}

/* ---------------------------------------------------------------------- */
/* Push: svuota l'outbox verso il cloud                                    */
/* ---------------------------------------------------------------------- */

async function pushPending() {
  const user = getCurrentUser();
  if (!user) return;
  const pending = await Store.outboxList();
  if (!pending.length) return;

  for (const entry of pending) {
    if (!ALL_STORES.includes(entry.store)) {
      // Voce di outbox per uno store non sincronizzabile (es. rimasta in coda da prima di una
      // correzione: vedi db.js enqueueOutbox). Non esiste una tabella cloud per cui provare a
      // inviarla: la si toglie e basta, non è un errore da ritentare all'infinito.
      await Store.outboxRemove(entry.id);
      continue;
    }
    const record = await Store.get(entry.store, entry.recordId, true); // includeDeleted: anche le eliminazioni vanno inviate
    if (!record) {
      // Il record non esiste più nemmeno in forma di tombstone (caso limite): la voce di
      // outbox non ha più senso, va tolta comunque per non restare bloccata per sempre.
      await Store.outboxRemove(entry.id);
      continue;
    }
    const ok = await pushRecord(entry.store, record);
    if (ok) await Store.outboxRemove(entry.id);
    // se fallisce, la voce resta in coda e si ritenta al giro successivo
  }
  await refreshPendingCount();
}

/* ---------------------------------------------------------------------- */
/* Pull: applica le novità dal cloud, con risoluzione dei conflitti (LWW)  */
/* ---------------------------------------------------------------------- */

/** Un record remoto vince su quello locale solo se: (a) non esiste ancora in locale, oppure
 * (b) è più recente di quello locale E quel record non ha una modifica locale ancora in coda
 * verso il cloud (altrimenti si rischierebbe di sovrascrivere una modifica fatta offline con
 * una versione più vecchia arrivata da un altro dispositivo: la modifica in coda vince sempre
 * fino a quando non è lei stessa ad essere stata inviata). */
async function applyRemote(storeName, remote, pendingKeys) {
  const key = `${storeName}::${remote.id}`;
  if (pendingKeys.has(key)) return; // modifica locale non ancora inviata: vince lei, per ora

  const locale = await Store.get(storeName, remote.id, true);
  if (!locale || new Date(remote.updatedAt) > new Date(locale.updatedAt)) {
    await Store.putFromCloud(storeName, remote);
  }
}

async function pullNovita() {
  const user = getCurrentUser();
  if (!user) return;

  const meta = await Store.getSyncMeta();
  const pendingKeys = new Set((await Store.outboxList()).map((e) => e.id));
  let piuRecente = meta.lastPulledAt;

  for (const storeName of ALL_STORES) {
    const novita = await pullChanges(storeName, meta.lastPulledAt);
    if (!novita) continue; // cloud non raggiungibile ora: si riprova al prossimo giro
    for (const remote of novita) {
      await applyRemote(storeName, remote, pendingKeys);
      if (!piuRecente || remote.updatedAt > piuRecente) piuRecente = remote.updatedAt;
    }
  }
  await Store.setSyncMeta({ lastPulledAt: piuRecente });
}

/* ---------------------------------------------------------------------- */
/* Ciclo di sincronizzazione e collegamento iniziale di un dispositivo     */
/* ---------------------------------------------------------------------- */

let running = false;
async function doSyncCycle() {
  if (running || !navigator.onLine) return;
  const user = getCurrentUser();
  if (!user) {
    setState({ status: 'disconnesso' });
    return;
  }
  // Loggato ma questo dispositivo non ha ancora deciso come collegarsi (push o pull iniziale,
  // vedi linkPushingLocalData/linkPullingFromCloud): non sincronizzare automaticamente nel
  // frattempo, altrimenti un pull userebbe un cursore lastPulledAt ereditato da un account
  // diverso eventualmente usato in precedenza su questo stesso dispositivo.
  if (await needsLinkDecision()) {
    setState({ status: 'da_collegare' });
    return;
  }
  running = true;
  setState({ status: 'syncing', lastError: null });
  try {
    await pushPending();
    await pullNovita();
    setState({ status: 'idle', lastSyncedAt: new Date().toISOString() });
  } catch (err) {
    console.warn('Sync: ciclo fallito:', err);
    setState({ status: 'error', lastError: err.message || String(err) });
  } finally {
    running = false;
    await refreshPendingCount();
  }
}

/** true se questo dispositivo non è mai stato collegato a un account cloud (o lo è stato per
 * un utente diverso da quello ora loggato): la vista Account deve chiedere esplicitamente
 * all'utente come comportarsi, invece di indovinare (vedi linkPushingLocalData/linkPullingFromCloud). */
export async function needsLinkDecision() {
  const user = getCurrentUser();
  if (!user) return false;
  const meta = await Store.getSyncMeta();
  return meta.linkedUserId !== user.id;
}

/** Primo dispositivo: manda tutto ciò che è già in locale verso il cloud. */
export async function linkPushingLocalData() {
  const user = getCurrentUser();
  if (!user) throw new Error('Devi essere autenticato.');
  await Store.outboxEnqueueAll();
  await Store.setSyncMeta({ linkedUserId: user.id, lastPulledAt: null });
  await doSyncCycle();
}

/** Dispositivo successivo: scarica tutto ciò che è già sul cloud (da un altro dispositivo). */
export async function linkPullingFromCloud() {
  const user = getCurrentUser();
  if (!user) throw new Error('Devi essere autenticato.');
  await Store.setSyncMeta({ linkedUserId: user.id, lastPulledAt: null });
  await doSyncCycle();
}

let pushTimer = null;
let pullTimer = null;

function startLoops() {
  stopLoops();
  pushTimer = setInterval(() => doSyncCycle(), PUSH_INTERVAL_MS);
  pullTimer = setInterval(pullNovita, PULL_INTERVAL_MS);
}

function stopLoops() {
  if (pushTimer) clearInterval(pushTimer);
  if (pullTimer) clearInterval(pullTimer);
  pushTimer = null;
  pullTimer = null;
}

/** Va chiamata una volta all'avvio dell'app. Non richiede login: se l'utente non si collega mai
 * al cloud, l'app si comporta esattamente come prima (solo IndexedDB), a parte l'outbox che
 * cresce inutilizzata (dimensione trascurabile, e comunque svuotata da wipeAll). */
export async function initSync() {
  setState({ status: navigator.onLine ? 'disconnesso' : 'offline' });
  await refreshPendingCount();

  window.addEventListener('online', () => doSyncCycle());
  window.addEventListener('offline', () => setState({ status: 'offline' }));

  await initAuth();
  onAuthChange(() => doSyncCycle());

  startLoops();
  doSyncCycle();
}
