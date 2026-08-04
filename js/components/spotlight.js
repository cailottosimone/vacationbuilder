import * as repo from '../repository/index.js';
import { escapeHtml, formatDate } from '../utils.js';
import { state, renderCanvas, renderRailNav } from '../app.js';

/**
 * Ricerca globale in overlay (stile Spotlight), non una sezione a sé nel menu — si apre con il
 * pulsante flottante o con Cmd/Ctrl+K, cerca solo per nome tra Destinazioni, Vacanze e Tappe
 * (per le tappe mostra anche la destinazione di appartenenza), e porta dritto al risultato.
 */
let overlayEl = null;
let currentResults = [];
let selectedIndex = 0;

export function initSpotlight() {
  const fab = document.createElement('button');
  fab.className = 'spotlight-fab';
  fab.title = 'Cerca (⌘K / Ctrl+K)';
  fab.setAttribute('aria-label', 'Cerca');
  fab.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i>';
  fab.addEventListener('click', () => (overlayEl ? closeSpotlight() : openSpotlight()));
  document.body.appendChild(fab);

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      overlayEl ? closeSpotlight() : openSpotlight();
    } else if (e.key === 'Escape' && overlayEl) {
      closeSpotlight();
    }
  });
}

function openSpotlight() {
  if (overlayEl) return;
  const root = document.getElementById('spotlight-root');
  if (!root) return;

  overlayEl = document.createElement('div');
  overlayEl.className = 'spotlight-overlay';
  overlayEl.innerHTML = `
    <div class="spotlight-box">
      <div class="spotlight-input-row">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="text" id="spotlight-input" placeholder="Cerca destinazioni, vacanze, tappe..." autocomplete="off">
        <kbd class="spotlight-esc">Esc</kbd>
      </div>
      <div class="spotlight-results" id="spotlight-results">
        <div class="spotlight-empty">Scrivi per cercare tra destinazioni, vacanze e tappe.</div>
      </div>
    </div>`;
  root.appendChild(overlayEl);

  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) closeSpotlight();
  });

  const input = document.getElementById('spotlight-input');
  input.focus();
  input.addEventListener('input', () => runSearch(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveSelection(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveSelection(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      selectCurrent();
    }
  });
}

function closeSpotlight() {
  if (!overlayEl) return;
  overlayEl.remove();
  overlayEl = null;
  currentResults = [];
  selectedIndex = 0;
}

async function runSearch(query) {
  const q = query.trim().toLowerCase();
  if (!q) {
    currentResults = [];
    renderResults();
    return;
  }

  const [destinazioni, vacanze, tappe] = await Promise.all([repo.listDestinazioni(), repo.listVacanze(), repo.listTappe()]);
  const destById = Object.fromEntries(destinazioni.map((d) => [d.id, d]));

  const risultatiDest = destinazioni
    .filter((d) => d.nome.toLowerCase().includes(q))
    .map((d) => ({ tipo: 'Destinazione', id: d.id, titolo: d.nome, sottotitolo: [d.provincia, d.regione].filter(Boolean).join(' · ') }));

  const risultatiVac = vacanze
    .filter((v) => v.nome.toLowerCase().includes(q))
    .map((v) => ({ tipo: 'Vacanza', id: v.id, titolo: v.nome, sottotitolo: v.dataInizio ? formatDate(v.dataInizio) : '' }));

  const risultatiTappe = tappe
    .filter((t) => t.nome.toLowerCase().includes(q))
    .map((t) => ({
      tipo: 'Tappa',
      id: t.id,
      titolo: t.nome,
      sottotitolo: destById[t.destinazioneId] ? destById[t.destinazioneId].nome : '',
      destinazioneId: t.destinazioneId,
    }));

  // destinazioni prima (sono il punto di partenza dell'archivio), poi vacanze, poi tappe
  currentResults = [...risultatiDest, ...risultatiVac, ...risultatiTappe].slice(0, 40);
  selectedIndex = 0;
  renderResults();
}

function renderResults() {
  const container = document.getElementById('spotlight-results');
  if (!container) return;

  if (!currentResults.length) {
    container.innerHTML = `<div class="spotlight-empty">Nessun risultato.</div>`;
    return;
  }

  container.innerHTML = currentResults
    .map(
      (r, i) => `<button type="button" class="spotlight-result ${i === selectedIndex ? 'is-selected' : ''}" data-index="${i}">
        <span class="spotlight-result-titolo">${escapeHtml(r.titolo)}</span>
        <span class="spotlight-result-tipo spotlight-tipo-${r.tipo.toLowerCase()}">${r.tipo}</span>
        ${r.sottotitolo ? `<span class="spotlight-result-sub">${escapeHtml(r.sottotitolo)}</span>` : ''}
      </button>`
    )
    .join('');

  container.querySelectorAll('.spotlight-result').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedIndex = Number(btn.dataset.index);
      selectCurrent();
    });
  });
}

function moveSelection(delta) {
  if (!currentResults.length) return;
  selectedIndex = (selectedIndex + delta + currentResults.length) % currentResults.length;
  renderResults();
  document.querySelector('.spotlight-result.is-selected')?.scrollIntoView({ block: 'nearest' });
}

async function selectCurrent() {
  const r = currentResults[selectedIndex];
  if (!r) return;
  closeSpotlight();

  if (r.tipo === 'Destinazione') {
    state.view = 'destinazioni';
    state.selectedDestinazioneId = r.id;
    state.activeTipoFilter = new Set();
  } else if (r.tipo === 'Vacanza') {
    state.view = 'vacanze';
    state.selectedVacanzaId = r.id;
    state.selectedGiornataId = null;
  } else if (r.tipo === 'Tappa') {
    // le tappe non hanno una pagina propria: si vedono dentro la loro destinazione
    state.view = 'destinazioni';
    state.selectedDestinazioneId = r.destinazioneId;
    state.activeTipoFilter = new Set();
  }
  renderRailNav();
  await renderCanvas();
}
