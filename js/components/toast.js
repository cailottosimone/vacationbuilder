import { escapeHtml } from '../utils.js';

/**
 * Toast: conferma breve e non bloccante che un'azione è andata a buon fine (salvataggio,
 * eliminazione, duplicazione...). Non sostituisce la richiesta di conferma a schermo prima di
 * un'azione distruttiva (quella resta un modale bloccante, vedi components/dialog.js) — il
 * toast arriva SOLO dopo, a conferma avvenuta, e sparisce da solo.
 */
const DURATA_MS = 2800;
const DISSOLVENZA_MS = 250;

function container() {
  return document.getElementById('toast-container');
}

function iconaPer(tipo) {
  if (tipo === 'errore') return 'fa-triangle-exclamation';
  if (tipo === 'info') return 'fa-circle-info';
  return 'fa-check'; // 'successo' di default
}

export function showToast(messaggio, tipo = 'successo') {
  const root = container();
  if (!root) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${tipo}`;
  toast.innerHTML = `<i class="fa-solid ${iconaPer(tipo)}"></i><span>${escapeHtml(messaggio)}</span>`;
  root.appendChild(toast);

  // due frame per essere sicuri che il browser applichi lo stato "entrato" con la transizione,
  // non subito insieme alla creazione dell'elemento (altrimenti non si vedrebbe animare)
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('is-visibile')));

  const rimuovi = () => {
    toast.classList.remove('is-visibile');
    setTimeout(() => toast.remove(), DISSOLVENZA_MS);
  };
  const timer = setTimeout(rimuovi, DURATA_MS);
  toast.addEventListener('click', () => {
    clearTimeout(timer);
    rimuovi();
  });
}
