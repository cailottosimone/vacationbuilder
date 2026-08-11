// js/components/sync-indicator.js — pulsante nella rail con lo stato della sincronizzazione
// cloud. Puramente presentazionale: legge solo js/data/sync.js, non conosce i dati applicativi.

import { escapeHtml } from '../utils.js';
import { state as syncState, onSyncStateChange } from '../data/sync.js';
import { state, renderRailNav, renderCanvas } from '../app.js';

const CONFIG = {
  offline: { icon: 'fa-wifi', label: 'Offline', cls: 'is-offline' },
  disconnesso: { icon: 'fa-cloud', label: 'Cloud', cls: 'is-muto' },
  da_collegare: { icon: 'fa-triangle-exclamation', label: 'Da collegare', cls: 'is-attenzione' },
  syncing: { icon: 'fa-arrows-rotate fa-spin', label: 'Sync…', cls: 'is-attivo' },
  idle: { icon: 'fa-cloud-arrow-up', label: 'Sincronizzato', cls: 'is-ok' },
  error: { icon: 'fa-triangle-exclamation', label: 'Errore', cls: 'is-errore' },
};

function render(el) {
  const c = CONFIG[syncState.status] || CONFIG.disconnesso;
  const badge = syncState.pendingCount > 0 && syncState.status !== 'syncing' ? `<span class="sync-badge-count">${syncState.pendingCount}</span>` : '';
  el.className = `sync-indicator ${c.cls}`;
  el.title = `Sincronizzazione — ${c.label} — apri Account`;
  el.innerHTML = `<i class="fa-solid ${c.icon}"></i><span class="sync-indicator-label">${escapeHtml(c.label)}</span>${badge}`;
}

/** Monta il pulsante nell'elemento passato (vedi index.html) e resta aggiornato da solo finché la
 * pagina resta aperta: non richiede di essere richiamato dopo ogni renderCanvas. */
export function mountSyncIndicator(el) {
  if (!el) return;
  render(el);
  onSyncStateChange(() => render(el));
  el.addEventListener('click', async () => {
    // Scorciatoia: porta direttamente alla tab "Account e sincronizzazione" di Impostazioni.
    state.view = 'impostazioni';
    state.impostazioniTab = 'account';
    renderRailNav();
    await renderCanvas();
  });
}
