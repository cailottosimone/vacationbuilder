import * as repo from './repository.js';
import { Store } from './db.js';
import { escapeHtml, formatDate, timeToMinutes, minutesToTime, parseCoordinateInput, formatCoordinate, haversineKm, resizeImageFile } from './utils.js';
import { PROFILO_PER_MEZZO, haRoutingDisponibile, calcolaDistanzaStrada } from './routing.js';

/* ---------------------------------------------------------------------- */
/* Stato applicativo                                                       */
/* ---------------------------------------------------------------------- */

const NAV_ITEMS = [
  { key: 'destinazioni', label: 'Destinazioni', icon: '<i class="fa-solid fa-plane"></i>' },
  { key: 'vacanze', label: 'Vacanze', icon: '<i class="fa-solid fa-hiking"></i>' },
  { key: 'esplora', label: 'Esplora', icon: '<i class="fa-solid fa-binoculars"></i>' },
  { key: 'impostazioni', label: 'Impostazioni', icon: '<i class="fa-solid fa-gear"></i>' },
  { key: 'backup', label: 'Backup', icon: '<i class="fa-solid fa-database"></i>' },
];

const state = {
  view: 'destinazioni',
  selectedDestinazioneId: null,
  selectedVacanzaId: null,
  selectedGiornataId: null,
  activeTipoFilter: new Set(),
  destinazioniListView: 'griglia', // 'griglia' | 'righe' — solo per la sessione
  impostazioniTab: 'categorie', // 'categorie' | 'tipi' | 'categorieSpesa' | 'routing' | 'navigazione'
  vacanzaTab: 'programma', // 'programma' | 'budget' | 'lista'
  listaGiornoSelezionato: null, // null = lista generale della vacanza
  vacanzeListView: 'griglia',
  filters: {
    destinazioni: { nome: '', stato: '', regione: '', provincia: '', categorieIds: [] },
    vacanze: { nome: '', destinazioneId: '', durataMin: '', durataMax: '' },
  },
  esplora: {
    origineModo: 'destinazione', // 'coordinate' | 'destinazione' | 'posizione'
    origineCoordinateRaw: '',
    origineDestinazioneId: '',
    originePosizione: null, // {lat,lng} rilevata via geolocalizzazione
    raggioKm: 50, // raggio di ricerca iniziale, in linea d'aria: definisce il pool di candidate
    filtri: { nome: '', stato: '', regione: '', provincia: '', categorieIds: [] },
    filtriValori: { lineaAriaMax: '', autoKmMax: '', autoMinMax: '', piediKmMax: '', piediMinMax: '' },
  },
};

let destCache = [];
let vacCache = [];
let categorieDestCache = [];
let navNascosti = [];

const railNav = document.getElementById('rail-nav');
const mobileTabbar = document.getElementById('mobile-tabbar');
const canvas = document.getElementById('canvas');
const inspector = document.getElementById('inspector');
const inspectorInner = document.getElementById('inspector-inner');
const inspectorScrim = document.getElementById('inspector-scrim');
const modalRoot = document.getElementById('modal-root');

init();

async function init() {
  navNascosti = (await repo.getConfig()).navNascosti || [];
  renderRailNav();
  bindStaticEvents();
  await renderCanvas();
}

/* ---------------------------------------------------------------------- */
/* Navigazione (rail su desktop, tabbar in basso su mobile) — solo menu     */
/* ---------------------------------------------------------------------- */

function visibleNavItems() {
  return NAV_ITEMS.filter((item) => item.key === 'impostazioni' || !navNascosti.includes(item.key));
}

async function goToView(key) {
  state.view = key;
  state.selectedDestinazioneId = null;
  state.selectedVacanzaId = null;
  state.selectedGiornataId = null;
  state.activeTipoFilter = new Set();
  renderRailNav();
  await renderCanvas();
}

function renderRailNav() {
  const itemsHtml = visibleNavItems()
    .map(
      (item) => `<button class="rail-nav-btn ${item.key === state.view ? 'is-active' : ''}" data-nav="${item.key}">
      <span class="rail-nav-icon">${item.icon}</span>${escapeHtml(item.label)}
    </button>`
    )
    .join('');
  railNav.innerHTML = itemsHtml;
  railNav.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => goToView(btn.dataset.nav));
  });

  if (mobileTabbar) {
    mobileTabbar.innerHTML = visibleNavItems()
      .map(
        (item) => `<button class="mobile-tab-btn ${item.key === state.view ? 'is-active' : ''}" data-nav="${item.key}">
        <span class="mobile-tab-icon">${item.icon}</span><span class="mobile-tab-label">${escapeHtml(item.label)}</span>
      </button>`
      )
      .join('');
    mobileTabbar.querySelectorAll('[data-nav]').forEach((btn) => {
      btn.addEventListener('click', () => goToView(btn.dataset.nav));
    });
  }
}

function bindStaticEvents() {
  inspectorScrim.addEventListener('click', closeInspector);
  inspectorInner.addEventListener('click', (e) => {
    if (e.target.closest('[data-role="close-inspector"]')) closeInspector();
  });

  canvas.addEventListener('click', handleCanvasClick);
  bindDragReorder();
}

/* ---------------------------------------------------------------------- */
/* Drag & drop: riordino di giorni e voci di giornata                      */
/* ---------------------------------------------------------------------- */

let dragEl = null;
let dragContext = null; // 'giorni' | 'voci'

function bindDragReorder() {
  canvas.addEventListener('dragstart', (e) => {
    const giornoItem = e.target.closest('.giorno-tab');
    const voceItem = e.target.closest('.timeline-item');
    const item = giornoItem || voceItem;
    if (!item) return;
    dragEl = item;
    dragContext = giornoItem ? 'giorni' : 'voci';
    item.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.dataset.id);
  });

  canvas.addEventListener('dragover', (e) => {
    if (!dragEl) return;
    e.preventDefault();
    const selector = dragContext === 'giorni' ? '.giorno-tab' : '.timeline-item';
    const target = e.target.closest(selector);
    if (!target || target === dragEl) return;
    const rect = target.getBoundingClientRect();
    const before = dragContext === 'giorni' ? e.clientX - rect.left < rect.width / 2 : e.clientY - rect.top < rect.height / 2;
    if (before) target.parentNode.insertBefore(dragEl, target);
    else target.parentNode.insertBefore(dragEl, target.nextSibling);
  });

  canvas.addEventListener('drop', async (e) => {
    if (!dragEl) return;
    e.preventDefault();
    const selector = dragContext === 'giorni' ? '.giorno-tab' : '.timeline-item';
    const container = dragEl.parentNode;
    const orderedIds = [...container.querySelectorAll(selector)].map((el) => el.dataset.id);
    const ctx = dragContext;
    dragEl.classList.remove('is-dragging');
    dragEl = null;
    dragContext = null;
    if (ctx === 'giorni') await repo.reorderGiornate(state.selectedVacanzaId, orderedIds);
    else await repo.reorderVoci(state.selectedGiornataId, orderedIds);
    await renderCanvas();
  });

  canvas.addEventListener('dragend', () => {
    if (dragEl) dragEl.classList.remove('is-dragging');
    dragEl = null;
    dragContext = null;
  });
}

/* ---------------------------------------------------------------------- */
/* CANVAS                                                                   */
/* ---------------------------------------------------------------------- */

function emptyState(mark, title, sub) {
  return `<div class="page-empty">
    <div class="page-empty-mark">${mark}</div>
    <div class="page-empty-title">${escapeHtml(title)}</div>
    <div class="page-empty-sub">${escapeHtml(sub)}</div>
  </div>`;
}

function emptyListNote(text) {
  return `<div class="empty-list-note">${escapeHtml(text)}</div>`;
}

/** Markup di checkbox travestite da chip colorate, per filtri/selettori a categoria multipla. */
function chipCheckboxesHtml(categorie, selectedIds, idPrefix) {
  if (!categorie.length) return `<div class="hint">Nessuna categoria creata: puoi aggiungerle da Impostazioni.</div>`;
  return `<div class="chip-checkbox-row">${categorie
    .map((c) => {
      const checked = selectedIds.includes(c.id) ? 'checked' : '';
      return `<label class="chip-checkbox">
        <input type="checkbox" id="${idPrefix}-${c.id}" value="${c.id}" ${checked}>
        <span>${escapeHtml(c.nome)}</span>
      </label>`;
    })
    .join('')}</div>`;
}

async function renderCanvas() {
  try {
    if (state.view === 'destinazioni') {
      if (state.selectedDestinazioneId) await renderCanvasRepository();
      else await renderDestinazioniList();
    } else if (state.view === 'vacanze') {
      if (state.selectedVacanzaId) await renderCanvasVacanze();
      else await renderVacanzeList();
    } else if (state.view === 'esplora') await renderCanvasEsplora();
    else if (state.view === 'impostazioni') await renderCanvasImpostazioni();
    else await renderCanvasBackup();
  } catch (err) {
    console.error('Vacation Builder — errore di rendering:', err);
    canvas.innerHTML = `<div class="page-empty">
      <div class="page-empty-mark"><i class="fa-solid fa-triangle-exclamation"></i></div>
      <div class="page-empty-title">Qualcosa si è inceppato</div>
      <div class="page-empty-sub">${escapeHtml(err && err.message ? err.message : 'Errore sconosciuto.')}<br><br>Prova a ricaricare la pagina. Se hai altre schede con l'app aperta, chiudile prima di ricaricare. Se il problema persiste, apri la Console del browser (Cmd+Opzione+J su Chrome/Safari) e copiami quello che vedi in rosso.</div>
    </div>`;
  }
}

/* --- Destinazioni: elenco a tutto schermo (griglia o righe) --- */

async function renderDestinazioniList() {
  const raw = await repo.listDestinazioni();
  destCache = await Promise.all(raw.map(async (d) => ({ ...d, tappeCount: (await repo.listTappeByDestinazione(d.id)).length })));
  const facets = await repo.getFacetsDestinazioni();
  categorieDestCache = await repo.listCategorieDestinazione();
  const f = state.filters.destinazioni;

  canvas.innerHTML = `
    <div class="page page-wide">
      <div class="page-header">
        <div>
          <div class="page-eyebrow">Archivio</div>
          <div class="page-title">Destinazioni</div>
          <div class="page-note">Un luogo generico che poi riempi di tappe: tutto quello che hai registrato, in un colpo d'occhio.</div>
        </div>
        <div class="page-header-actions">
          <button class="btn btn-primary" data-action="new-destinazione"><i class="fa-solid fa-plus"></i> Nuova destinazione</button>
        </div>
      </div>

      <div class="list-toolbar">
        <div class="list-toolbar-fields" style="--filter-cols:3;">
          <input type="text" class="list-toolbar-search" id="filtro-dest-nome" placeholder="Cerca per nome…" value="${escapeHtml(f.nome)}">
          <select id="filtro-dest-stato"><option value="">Stato (tutti)</option>${facets.stati.map((s) => `<option value="${escapeHtml(s)}" ${f.stato === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}</select>
          <select id="filtro-dest-regione"><option value="">Regione (tutte)</option>${facets.regioni.map((s) => `<option value="${escapeHtml(s)}" ${f.regione === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}</select>
          <select id="filtro-dest-provincia"><option value="">Provincia (tutte)</option>${facets.province.map((s) => `<option value="${escapeHtml(s)}" ${f.provincia === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}</select>
        </div>
        <div class="list-toolbar-actions">
          <div class="view-toggle">
            <button class="view-toggle-btn ${state.destinazioniListView === 'griglia' ? 'is-active' : ''}" data-action="set-dest-view" data-mode="griglia">Griglia</button>
            <button class="view-toggle-btn ${state.destinazioniListView === 'righe' ? 'is-active' : ''}" data-action="set-dest-view" data-mode="righe">Righe</button>
          </div>
        </div>
      </div>
      <div id="filtro-dest-categorie" class="filters-bar-categories">${chipCheckboxesHtml(categorieDestCache, f.categorieIds, 'fdcat')}</div>

      <div id="dest-list-results"></div>
    </div>`;

  document.getElementById('filtro-dest-nome').addEventListener('input', (e) => { f.nome = e.target.value; renderDestinazioniListResults(); });
  document.getElementById('filtro-dest-stato').addEventListener('change', (e) => { f.stato = e.target.value; renderDestinazioniListResults(); });
  document.getElementById('filtro-dest-regione').addEventListener('change', (e) => { f.regione = e.target.value; renderDestinazioniListResults(); });
  document.getElementById('filtro-dest-provincia').addEventListener('change', (e) => { f.provincia = e.target.value; renderDestinazioniListResults(); });
  document.getElementById('filtro-dest-categorie').addEventListener('change', (e) => {
    if (e.target.type !== 'checkbox') return;
    f.categorieIds = [...document.querySelectorAll('#filtro-dest-categorie input:checked')].map((i) => i.value);
    renderDestinazioniListResults();
  });

  renderDestinazioniListResults();
}

function renderDestinazioniListResults() {
  const container = document.getElementById('dest-list-results');
  if (!container) return;
  const f = state.filters.destinazioni;
  const filtered = destCache.filter((d) => {
    if (f.nome && !d.nome.toLowerCase().includes(f.nome.toLowerCase())) return false;
    if (f.stato && d.stato !== f.stato) return false;
    if (f.regione && d.regione !== f.regione) return false;
    if (f.provincia && d.provincia !== f.provincia) return false;
    if (f.categorieIds.length && !(d.categorieIds || []).some((id) => f.categorieIds.includes(id))) return false;
    return true;
  });

  if (!destCache.length) {
    container.innerHTML = emptyListNote('Ancora nessuna destinazione. Comincia dal bottone qui sopra: un luogo generico come "Vicenza Centro", poi ci aggiungerai le tappe.');
    return;
  }
  if (!filtered.length) {
    container.innerHTML = emptyListNote('Nessuna destinazione corrisponde ai filtri.');
    return;
  }

  const countHtml = `<div class="results-count">${filtered.length} destinazion${filtered.length === 1 ? 'e' : 'i'}</div>`;
  container.innerHTML = countHtml + (state.destinazioniListView === 'griglia'
    ? `<div class="item-grid">${filtered.map(destCardHtml).join('')}</div>`
    : `<div class="item-list">${filtered.map(destRowHtml).join('')}</div>`);
}

function destCategorieBadgesHtml(d) {
  const cats = categorieDestCache.filter((c) => (d.categorieIds || []).includes(c.id));
  if (!cats.length) return '';
  return `<div class="item-card-badges">${cats.map((c) => `<span class="categoria-badge">${escapeHtml(c.nome)}</span>`).join('')}</div>`;
}

function destCardHtml(d) {
  const cover = d.immagini && d.immagini[0];
  return `<button class="item-card" data-action="select-destinazione" data-id="${d.id}">
    ${cover ? `<img class="item-card-cover" src="${cover}" alt="">` : `<div class="item-card-cover-placeholder"></div>`}
    <div class="item-card-body">
      <div class="item-card-title">${escapeHtml(d.nome)}</div>
      <div class="item-card-meta">${d.tappeCount} tapp${d.tappeCount === 1 ? 'a' : 'e'}${d.regione ? ` · ${escapeHtml(d.regione)}` : ''}</div>
      ${destCategorieBadgesHtml(d)}
    </div>
  </button>`;
}

function destRowHtml(d) {
  const cover = d.immagini && d.immagini[0];
  return `<button class="item-row" data-action="select-destinazione" data-id="${d.id}">
    ${cover ? `<img class="item-row-thumb" src="${cover}" alt="">` : `<div class="item-row-thumb-placeholder"></div>`}
    <span class="item-row-title">${escapeHtml(d.nome)}</span>
    <span class="item-row-meta">${d.tappeCount} tapp${d.tappeCount === 1 ? 'a' : 'e'}${d.regione ? ` · ${escapeHtml(d.regione)}` : ''}</span>
    <span class="item-row-badges">${categorieDestCache.filter((c) => (d.categorieIds || []).includes(c.id)).map((c) => `<span class="categoria-badge">${escapeHtml(c.nome)}</span>`).join('')}</span>
    <span class="item-row-chevron"><i class="fa-solid fa-chevron-right"></i></span>
  </button>`;
}

/* --- Vacanze: elenco a tutto schermo (griglia o righe) --- */

async function renderVacanzeList() {
  const all = await repo.listVacanze();
  vacCache = await Promise.all(
    all.map(async (v) => {
      const giornate = await repo.listGiornateByVacanza(v.id);
      const destinazioneIds = await repo.listDestinazioneIdsUsateByVacanza(v.id);
      return { ...v, durataGiorni: giornate.length, destinazioneIds };
    })
  );
  const destinazioni = await repo.listDestinazioni();
  const f = state.filters.vacanze;

  canvas.innerHTML = `
    <div class="page page-wide">
      <div class="page-header">
        <div>
          <div class="page-eyebrow">Archivio</div>
          <div class="page-title">Vacanze</div>
          <div class="page-note">Le vacanze che hai progettato o stai progettando, un luogo fisso o itineranti.</div>
        </div>
        <div class="page-header-actions">
          <button class="btn btn-primary" data-action="new-vacanza"><i class="fa-solid fa-plus"></i> Nuova vacanza</button>
        </div>
      </div>

      <div class="list-toolbar">
        <div class="list-toolbar-fields" style="--filter-cols:2;">
          <input type="text" class="list-toolbar-search" id="filtro-vac-nome" placeholder="Cerca per nome…" value="${escapeHtml(f.nome)}">
          <select id="filtro-vac-dest">
            <option value="">Tutte le destinazioni</option>
            ${destinazioni.map((d) => `<option value="${d.id}" ${f.destinazioneId === d.id ? 'selected' : ''}>${escapeHtml(d.nome)}</option>`).join('')}
          </select>
          <div class="list-toolbar-group">
            <input type="number" id="filtro-vac-min" placeholder="Min gg" min="0" value="${f.durataMin}">
            <input type="number" id="filtro-vac-max" placeholder="Max gg" min="0" value="${f.durataMax}">
          </div>
        </div>
        <div class="list-toolbar-actions">
          <div class="view-toggle">
            <button class="view-toggle-btn ${state.vacanzeListView === 'griglia' ? 'is-active' : ''}" data-action="set-vac-view" data-mode="griglia">Griglia</button>
            <button class="view-toggle-btn ${state.vacanzeListView === 'righe' ? 'is-active' : ''}" data-action="set-vac-view" data-mode="righe">Righe</button>
          </div>
        </div>
      </div>

      <div id="vac-list-results"></div>
    </div>`;

  document.getElementById('filtro-vac-nome').addEventListener('input', (e) => { f.nome = e.target.value; renderVacanzeListResults(); });
  document.getElementById('filtro-vac-dest').addEventListener('change', (e) => { f.destinazioneId = e.target.value; renderVacanzeListResults(); });
  document.getElementById('filtro-vac-min').addEventListener('input', (e) => { f.durataMin = e.target.value; renderVacanzeListResults(); });
  document.getElementById('filtro-vac-max').addEventListener('input', (e) => { f.durataMax = e.target.value; renderVacanzeListResults(); });

  renderVacanzeListResults();
}

function renderVacanzeListResults() {
  const container = document.getElementById('vac-list-results');
  if (!container) return;
  const f = state.filters.vacanze;
  const filtered = vacCache.filter((v) => {
    if (f.nome && !v.nome.toLowerCase().includes(f.nome.toLowerCase())) return false;
    if (f.destinazioneId && !v.destinazioneIds.includes(f.destinazioneId)) return false;
    if (f.durataMin !== '' && v.durataGiorni < Number(f.durataMin)) return false;
    if (f.durataMax !== '' && v.durataGiorni > Number(f.durataMax)) return false;
    return true;
  });

  if (!vacCache.length) {
    container.innerHTML = emptyListNote('Nessuna vacanza ancora nel registro. Crea la prima dal bottone qui sopra.');
    return;
  }
  if (!filtered.length) {
    container.innerHTML = emptyListNote('Nessuna vacanza corrisponde ai filtri.');
    return;
  }

  const countHtml = `<div class="results-count">${filtered.length} vacanz${filtered.length === 1 ? 'a' : 'e'}</div>`;
  container.innerHTML = countHtml + (state.vacanzeListView === 'griglia'
    ? `<div class="item-grid">${filtered.map(vacCardHtml).join('')}</div>`
    : `<div class="item-list">${filtered.map(vacRowHtml).join('')}</div>`);
}

function vacCardHtml(v) {
  return `<button class="item-card" data-action="select-vacanza" data-id="${v.id}">
    <div class="item-card-cover-placeholder"></div>
    <div class="item-card-body">
      <div class="item-card-title">${escapeHtml(v.nome)}</div>
      <div class="item-card-meta">${v.durataGiorni} g${v.durataGiorni === 1 ? 'iorno' : 'iorni'}</div>
      <div class="item-card-badges"><span class="badge-tipo-vacanza ${v.tipo}">${v.tipo === 'fissa' ? 'Un luogo' : 'Itinerante'}</span></div>
    </div>
  </button>`;
}

function vacRowHtml(v) {
  return `<button class="item-row" data-action="select-vacanza" data-id="${v.id}">
    <div class="item-row-thumb-placeholder"></div>
    <span class="item-row-title">${escapeHtml(v.nome)}</span>
    <span class="item-row-meta">${v.durataGiorni} g${v.durataGiorni === 1 ? 'iorno' : 'iorni'}</span>
    <span class="item-row-badges"><span class="badge-tipo-vacanza ${v.tipo}">${v.tipo === 'fissa' ? 'Un luogo' : 'Itinerante'}</span></span>
    <span class="item-row-chevron"><i class="fa-solid fa-chevron-right"></i></span>
  </button>`;
}

/* --- Destinazioni / Tappe --- */

async function renderCanvasRepository() {
  if (!state.selectedDestinazioneId) {
    await renderDestinazioniList();
    return;
  }
  const dest = await repo.getDestinazione(state.selectedDestinazioneId);
  if (!dest) {
    state.selectedDestinazioneId = null;
    return renderCanvasRepository();
  }
  const tappe = await repo.listTappeByDestinazione(dest.id);
  const tipiList = await repo.listTipiTappa();

  // Il conteggio e il filtro a chip considerano TUTTI i tipi di ciascuna tappa (un rifugio
  // Ristoro+Alloggio conta in entrambi i chip). Il raggruppamento visivo invece usa solo il
  // tipo PRINCIPALE (il primo dell'elenco), altrimenti la stessa tappa apparirebbe duplicata.
  const chipCounts = tipiList
    .map((t) => ({ ...t, count: tappe.filter((tp) => (tp.tipi || []).includes(t.id)).length }))
    .filter((t) => t.count > 0);

  const chipsHtml = chipCounts.length
    ? `<div class="tipo-chip-row">${chipCounts
        .map((t) => {
          const active = state.activeTipoFilter.has(t.id) ? 'is-active' : '';
          return `<button type="button" class="tipo-chip ${active}" data-toggle-tipo="${t.id}">
            ${escapeHtml(t.nome)}<span class="tipo-chip-count">${t.count}</span>
          </button>`;
        })
        .join('')}</div>`
    : '';

  const tappeVisibili = state.activeTipoFilter.size
    ? tappe.filter((tp) => (tp.tipi || []).some((id) => state.activeTipoFilter.has(id)))
    : tappe;
  const displayGroups = tipiList
    .map((t) => ({ ...t, items: tappeVisibili.filter((tp) => (tp.tipi || [])[0] === t.id) }))
    .filter((g) => g.items.length > 0);

  const gruppiHtml = tappe.length
    ? displayGroups
        .map(
          (g) => `
    <div class="tipo-group">
      <div class="tipo-group-label">${escapeHtml(g.nome)} · ${g.items.length}</div>
      <div class="tappe-grid">${g.items.map((t) => tappaCardHtml(t, tipiList)).join('')}</div>
    </div>`
        )
        .join('')
    : `<div class="timeline-empty">Nessuna tappa ancora per questa destinazione. Aggiungi la prima: un luogo, un ristoro, un monumento...</div>`;

  const geoLine = [dest.provincia, dest.regione, dest.stato].filter(Boolean).join(' · ');
  const categorieAll = await repo.listCategorieDestinazione();
  const categorieDest = categorieAll.filter((c) => (dest.categorieIds || []).includes(c.id));
  const cover = dest.immagini && dest.immagini[0];

  canvas.innerHTML = `
    <div class="page">
      <button class="back-btn" data-action="back-to-destinazioni"><i class="fa-solid fa-arrow-left"></i> Destinazioni</button>
      <div class="page-header">
        <div class="page-header-main">
          ${cover ? `<img class="dest-cover" src="${cover}" alt="">` : ''}
          <div>
            <div class="page-eyebrow">Destinazione</div>
            <div class="page-title">${escapeHtml(dest.nome)}</div>
            ${geoLine ? `<div class="page-note">${escapeHtml(geoLine)}</div>` : ''}
            ${dest.coordinate ? `<div class="page-note"><i class="fa-solid fa-location-dot"></i> ${formatCoordinate(dest.coordinate)}</div>` : ''}
            ${categorieDest.length ? `<div class="categoria-badge-row">${categorieDest.map((c) => `<span class="categoria-badge">${escapeHtml(c.nome)}</span>`).join('')}</div>` : ''}
            ${dest.note ? `<div class="page-note">${escapeHtml(dest.note)}</div>` : ''}
          </div>
        </div>
        <div class="page-header-actions">
          <button class="btn btn-ghost" data-action="edit-destinazione">Modifica</button>
          <button class="btn btn-danger" data-action="delete-destinazione">Elimina</button>
          <button class="btn btn-primary" data-action="new-tappa"><i class="fa-solid fa-plus"></i> Nuova tappa</button>
        </div>
      </div>
      ${chipsHtml}
      ${gruppiHtml}
    </div>`;

  canvas.querySelectorAll('[data-toggle-tipo]').forEach((chip) => {
    chip.addEventListener('click', async () => {
      const id = chip.dataset.toggleTipo;
      if (state.activeTipoFilter.has(id)) state.activeTipoFilter.delete(id);
      else state.activeTipoFilter.add(id);
      await renderCanvasRepository();
    });
  });
}

function tappaCardHtml(t, tipiList) {
  const cover = t.immagini && t.immagini[0];
  const tipiIds = t.tipi || [];
  const secondari = tipiIds.slice(1).map((id) => tipiList.find((x) => x.id === id)).filter(Boolean);
  return `<div class="tappa-card" data-action="edit-tappa" data-id="${t.id}">
    <button class="card-delete" data-action="delete-tappa" data-id="${t.id}" title="Elimina tappa"><i class="fa-solid fa-trash-can"></i></button>
    ${cover ? `<img class="cover-thumb" src="${cover}" alt="" style="margin-bottom:8px;">` : ''}
    <div class="tappa-card-title">${escapeHtml(t.nome)}</div>
    ${secondari.length ? `<div class="tappa-card-meta">anche: ${secondari.map((s) => escapeHtml(s.nome)).join(', ')}</div>` : ''}
    ${t.durataConsigliataMin ? `<div class="tappa-card-meta">${t.durataConsigliataMin} min</div>` : ''}
    ${t.coordinate ? `<div class="tappa-card-meta"><i class="fa-solid fa-location-dot"></i> ${formatCoordinate(t.coordinate)}</div>` : ''}
    ${t.note ? `<div class="tappa-card-note">${escapeHtml(t.note)}</div>` : ''}
  </div>`;
}

/* --- Vacanze / Planner --- */

const MEZZI_TRASPORTO = [
  { value: 'auto', label: 'Auto', icon: 'fa-car' },
  { value: 'bici', label: 'Bici', icon: 'fa-bicycle' },
  { value: 'piedi', label: 'A piedi', icon: 'fa-person-walking' },
  { value: 'aereo', label: 'Aereo', icon: 'fa-plane' },
  { value: 'treno', label: 'Treno', icon: 'fa-train' },
  { value: 'bus', label: 'Bus', icon: 'fa-bus' },
  { value: 'taxi', label: 'Taxi', icon: 'fa-taxi' },
  { value: 'altro', label: 'Altro', icon: 'fa-route' },
];
function mezzoLabel(value) {
  return (MEZZI_TRASPORTO.find((m) => m.value === value) || { label: value || '—' }).label;
}
function mezzoIcon(value) {
  return (MEZZI_TRASPORTO.find((m) => m.value === value) || { icon: 'fa-route' }).icon;
}

/**
 * Calcola gli orari effettivi di ogni voce di una giornata, sommando le durate (permanenza per
 * le tappe, durata per gli spostamenti, zero per il Rientro) a partire dall'ultima Partenza
 * incontrata — l'unica voce con un orario davvero fisso e obbligatorio. Una voce con oraFissata
 * fa lei stessa da ancora, ignorando il cursore corrente: è così che anche il Rientro può avere
 * un orario forzato quando serve, pur restando calcolato di default. Sposta la Partenza (o una
 * qualunque tappa prima del Rientro) e tutto il resto si ricalcola da solo: niente è salvato, è
 * sempre dedotto al volo ad ogni render. Ritorna lo stesso array con _inizio/_fine aggiunti
 * (minuti da mezzanotte, o null se non ancora calcolabile).
 */
function computeOrariVoci(vociOrdinate) {
  let cursore = null;
  return vociOrdinate.map((voce) => {
    if (voce.tipoVoce === 'partenza') {
      const t = timeToMinutes(voce.ora);
      cursore = t;
      return { ...voce, _inizio: t, _fine: t };
    }
    // rientro, tappa, spostamento: tutte calcolate, con oraFissata come ancora opzionale
    const fissata = voce.oraFissata ? timeToMinutes(voce.oraFissata) : null;
    const inizio = fissata != null ? fissata : cursore;
    if (inizio == null) {
      cursore = null;
      return { ...voce, _inizio: null, _fine: null };
    }
    let durata = 0; // rientro: punto d'arrivo, nessuna permanenza propria da tracciare qui
    if (voce.tipoVoce === 'tappa') durata = voce.permanenzaMin ?? null;
    else if (voce.tipoVoce === 'spostamento') durata = voce.durataMin ?? voce.durataRealeMin ?? null;
    const fine = durata != null ? inizio + durata : null;
    cursore = fine;
    return { ...voce, _inizio: inizio, _fine: fine };
  });
}

function defaultAlloggioTappaId(vacanza, giornata) {
  if (vacanza.tipo === 'fissa') return vacanza.alloggioId || null;
  return giornata ? giornata.alloggioId || null : null;
}
function endingLocationId(voce, vacanza, giornata) {
  if (!voce) return null;
  if (voce.tipoVoce === 'tappa') return voce.tappaId;
  if (voce.tipoVoce === 'partenza') return voce.daRifTappaId || defaultAlloggioTappaId(vacanza, giornata);
  if (voce.tipoVoce === 'rientro') return voce.aRifTappaId || defaultAlloggioTappaId(vacanza, giornata);
  if (voce.tipoVoce === 'spostamento') return voce.aRifTappaId || null;
  return null;
}
function startingLocationId(voce, vacanza, giornata) {
  if (!voce) return null;
  if (voce.tipoVoce === 'tappa') return voce.tappaId;
  if (voce.tipoVoce === 'partenza') return voce.daRifTappaId || defaultAlloggioTappaId(vacanza, giornata);
  if (voce.tipoVoce === 'rientro') return voce.aRifTappaId || defaultAlloggioTappaId(vacanza, giornata);
  if (voce.tipoVoce === 'spostamento') return voce.daRifTappaId || null;
  return null;
}

async function renderCanvasVacanze() {
  if (!state.selectedVacanzaId) {
    await renderVacanzeList();
    return;
  }
  const vacanza = await repo.getVacanza(state.selectedVacanzaId);
  if (!vacanza) {
    state.selectedVacanzaId = null;
    return renderCanvasVacanze();
  }
  const giornate = await repo.listGiornateByVacanza(vacanza.id);
  if (!state.selectedGiornataId && giornate.length) state.selectedGiornataId = giornate[0].id;
  if (state.selectedGiornataId && !giornate.some((g) => g.id === state.selectedGiornataId)) {
    state.selectedGiornataId = giornate.length ? giornate[0].id : null;
  }

  const tipiList = await repo.listTipiTappa();
  const tipiById = Object.fromEntries(tipiList.map((t) => [t.id, t]));

  const nameCacheLocal = {};
  async function tappaNome(id) {
    if (!id) return null;
    if (!(id in nameCacheLocal)) {
      const t = await repo.getTappa(id);
      nameCacheLocal[id] = t ? t.nome : null;
    }
    return nameCacheLocal[id];
  }
  const destCacheLocal = {};
  async function destName(id) {
    if (!id) return '—';
    if (!destCacheLocal[id]) {
      const d = await repo.getDestinazione(id);
      destCacheLocal[id] = d ? d.nome : '—';
    }
    return destCacheLocal[id];
  }

  /* --- Alloggio: header per vacanza fissa, pool per vacanza itinerante --- */
  let alloggioHeaderHtml = '';
  if (vacanza.tipo === 'fissa') {
    const nome = await tappaNome(vacanza.alloggioId);
    alloggioHeaderHtml = vacanza.alloggioId
      ? `<div class="page-note">Alloggio: <strong>${escapeHtml(nome || 'tappa eliminata')}</strong> · <button class="btn-inline-link" data-action="set-alloggio-vacanza">cambia</button></div>`
      : `<button class="btn btn-sm btn-ghost" data-action="set-alloggio-vacanza" style="margin-top:8px;"><i class="fa-solid fa-plus"></i> Imposta alloggio</button>`;
  }

  let alloggiPoolHtml = '';
  if (vacanza.tipo === 'itinerante') {
    const poolIds = vacanza.alloggiIds || [];
    const poolNames = await Promise.all(poolIds.map(async (id) => ({ id, nome: (await tappaNome(id)) || 'tappa eliminata' })));
    alloggiPoolHtml = `<div class="alloggi-pool">
      <span class="alloggi-pool-label">Alloggi di questa vacanza</span>
      ${poolNames.map((a) => `<span class="alloggio-chip">${escapeHtml(a.nome)}<button data-action="remove-alloggio-pool" data-id="${a.id}" title="Rimuovi dal pool"><i class="fa-solid fa-xmark"></i></button></span>`).join('')}
      <button class="btn btn-sm btn-ghost" data-action="add-alloggio-pool"><i class="fa-solid fa-plus"></i> Aggiungi alloggio</button>
    </div>`;
  }

  const vTab = state.vacanzaTab || 'programma';
  const subTabsHtml = `<div class="settings-tabs vacanza-subtabs">
    <button class="settings-tab ${vTab === 'programma' ? 'is-active' : ''}" data-action="set-vacanza-tab" data-tab="programma">Programma</button>
    <button class="settings-tab ${vTab === 'budget' ? 'is-active' : ''}" data-action="set-vacanza-tab" data-tab="budget">Budget</button>
    <button class="settings-tab ${vTab === 'lista' ? 'is-active' : ''}" data-action="set-vacanza-tab" data-tab="lista">Lista</button>
  </div>`;

  let tabContentHtml = '';

  if (vTab === 'programma') {
    /* --- Tab dei giorni, trascinabili --- */
    const giorniTabs = await Promise.all(
      giornate.map(async (g, i) => {
        const nome = await destName(g.destinazioneId);
        const active = g.id === state.selectedGiornataId ? 'is-active' : '';
        const alloggioNome = vacanza.tipo === 'itinerante' && g.alloggioId ? await tappaNome(g.alloggioId) : null;
        return `<div class="giorno-tab ${active}" draggable="true" data-id="${g.id}" data-action="select-giorno">
          <button class="card-delete" data-action="delete-giorno" data-id="${g.id}" title="Elimina giorno"><i class="fa-solid fa-trash-can"></i></button>
          <div class="giorno-tab-label">Giorno ${i + 1}${alloggioNome ? `<span class="giorno-tab-alloggio"> – ${escapeHtml(alloggioNome)}</span>` : ''}</div>
          ${g.data ? `<div class="giorno-tab-date">${formatDate(g.data)}</div>` : ''}
          <div class="stamp"><span class="stamp-dot"></span>${escapeHtml(nome)}</div>
        </div>`;
      })
    );

    let timelineHtml = `<div class="timeline-empty">Nessuna giornata ancora. Aggiungine una per iniziare a pianificare.</div>`;
    let toolbarHtml = '';
    const giornoCorrente = giornate.find((g) => g.id === state.selectedGiornataId);

    if (giornoCorrente) {
      const vociGrezze = await repo.listVociByGiornata(giornoCorrente.id);
      const voci = computeOrariVoci(vociGrezze);
      const nomeDestGiorno = await destName(giornoCorrente.destinazioneId);

      const cambioDestBtn =
        vacanza.tipo === 'itinerante'
          ? `<button class="btn btn-sm btn-ghost" data-action="change-giorno-destinazione" data-id="${giornoCorrente.id}">Cambia destinazione</button>`
          : '';
      let alloggioGiornoBtn = '';
      if (vacanza.tipo === 'itinerante' && (vacanza.alloggiIds || []).length) {
        const nome = giornoCorrente.alloggioId ? await tappaNome(giornoCorrente.alloggioId) : null;
        alloggioGiornoBtn = `<button class="btn btn-sm btn-ghost" data-action="set-alloggio-giorno" data-id="${giornoCorrente.id}">${nome ? `Alloggio: ${escapeHtml(nome)}` : 'Imposta alloggio del giorno'}</button>`;
      }
      toolbarHtml = cambioDestBtn || alloggioGiornoBtn ? `<div class="giorno-toolbar">${cambioDestBtn}${alloggioGiornoBtn}</div>` : '';

      const gapHtml = (gapIndex) => `<div class="timeline-gap" data-gap-index="${gapIndex}">
        <button class="gap-plus" data-action="toggle-gap" data-gap-index="${gapIndex}" title="Inserisci qui"><i class="fa-solid fa-plus"></i></button>
        <div class="gap-menu">
          <button data-action="insert-voce" data-voce-tipo="tappa" data-gap-index="${gapIndex}">Tappa</button>
          <button data-action="insert-voce" data-voce-tipo="partenza" data-gap-index="${gapIndex}">Partenza</button>
          <button data-action="insert-voce" data-voce-tipo="rientro" data-gap-index="${gapIndex}">Rientro</button>
          <button data-action="insert-voce" data-voce-tipo="spostamento" data-gap-index="${gapIndex}">Spostamento</button>
        </div>
      </div>`;

      if (!voci.length) {
        timelineHtml = `<div class="timeline timeline-vuota">
          <div class="timeline-gap is-empty-state" data-gap-index="0">
            <button class="gap-plus" data-action="toggle-gap" data-gap-index="0" title="Aggiungi la prima voce"><i class="fa-solid fa-plus"></i></button>
            <span class="timeline-gap-label">Aggiungi la prima voce del giorno · tappe disponibili solo da <strong>${escapeHtml(nomeDestGiorno)}</strong></span>
            <div class="gap-menu">
              <button data-action="insert-voce" data-voce-tipo="tappa" data-gap-index="0">Tappa</button>
              <button data-action="insert-voce" data-voce-tipo="partenza" data-gap-index="0">Partenza</button>
              <button data-action="insert-voce" data-voce-tipo="rientro" data-gap-index="0">Rientro</button>
              <button data-action="insert-voce" data-voce-tipo="spostamento" data-gap-index="0">Spostamento</button>
            </div>
          </div>
        </div>`;
      } else {
        const parts = [gapHtml(0)];
        for (let i = 0; i < voci.length; i++) {
          parts.push(await renderVoceHtml(voci[i], i, voci, vacanza, giornoCorrente, tipiById, tappaNome));
          parts.push(gapHtml(i + 1));
        }
        timelineHtml = `<div class="timeline">${parts.join('')}</div>`;
      }
    }

    tabContentHtml = `
      <div class="giorni-row">
        ${giorniTabs.join('')}
        <button class="giorno-add-tab" data-action="add-giorno" title="Aggiungi giorno"><i class="fa-solid fa-plus"></i></button>
      </div>
      ${toolbarHtml}
      ${timelineHtml}`;
  } else if (vTab === 'budget') {
    tabContentHtml = await renderBudgetTabHtml(vacanza);
  } else {
    tabContentHtml = await renderListaTabHtml(vacanza, giornate);
  }

  canvas.innerHTML = `
    <div class="page">
      <button class="back-btn" data-action="back-to-vacanze"><i class="fa-solid fa-arrow-left"></i> Vacanze</button>
      <div class="page-header">
        <div>
          <div class="page-eyebrow">Vacanza</div>
          <div class="page-title">${escapeHtml(vacanza.nome)}</div>
          <span class="badge-tipo-vacanza ${vacanza.tipo}">${vacanza.tipo === 'fissa' ? 'Un luogo' : 'Itinerante'}</span>
          ${vacanza.dataInizio ? `<div class="page-note">${formatDate(vacanza.dataInizio)} → ${vacanza.dataFine ? formatDate(vacanza.dataFine) : '?'}</div>` : ''}
          ${alloggioHeaderHtml}
        </div>
        <div class="page-header-actions">
          <button class="btn btn-ghost" data-action="stampa-vacanza"><i class="fa-solid fa-print"></i> Stampa / PDF</button>
          <button class="btn btn-ghost" data-action="edit-vacanza">Modifica</button>
          <button class="btn btn-danger" data-action="delete-vacanza">Elimina</button>
        </div>
      </div>

      ${vTab === 'programma' ? alloggiPoolHtml : ''}

      ${subTabsHtml}
      ${tabContentHtml}
    </div>`;
}

/** Etichetta leggibile per la voce di giornata a cui una spesa può essere collegata. */
async function labelVoceSpesa(voceId) {
  if (!voceId) return null;
  const voce = await repo.getVoce(voceId);
  if (!voce) return 'voce eliminata';
  if (voce.tipoVoce === 'tappa') {
    const t = voce.tappaId ? await repo.getTappa(voce.tappaId) : null;
    return t ? t.nome : 'tappa eliminata';
  }
  if (voce.tipoVoce === 'spostamento') return `Spostamento (${mezzoLabel(voce.mezzo)})`;
  if (voce.tipoVoce === 'partenza') return 'Partenza';
  return 'Rientro';
}

/** Opzioni <optgroup> per collegare una spesa a una voce di un giorno qualsiasi della vacanza. */
async function opzioniVociSpesa(giornate) {
  const gruppi = [];
  for (let i = 0; i < giornate.length; i++) {
    const voci = await repo.listVociByGiornata(giornate[i].id);
    if (!voci.length) continue;
    const opzioni = await Promise.all(voci.map(async (v) => ({ id: v.id, label: await labelVoceSpesa(v.id) })));
    gruppi.push({ titolo: `Giorno ${i + 1}`, opzioni });
  }
  return gruppi;
}

function calcoloLabelBudget(record, vacanza) {
  if (record.modalita === 'aPersona' || record.modalita === 'daDividere') {
    const persone = repo.risolviNumeroPersone(record, vacanza);
    const segue = record.numeroPersone == null;
    if (record.modalita === 'aPersona') {
      return `${(Number(record.importoAPersona) || 0).toFixed(2)}€ × ${persone}${segue ? ' <span class="budget-segue">(segue vacanza)</span>' : ''}`;
    }
    const quota = repo.calcolaQuotaAPersona(record, vacanza);
    return `${(Number(record.importoDaDividere) || 0).toFixed(2)}€ ÷ ${persone}${segue ? ' <span class="budget-segue">(segue vacanza)</span>' : ''} ≈ ${quota}€ cad.`;
  }
  return 'totale';
}

async function renderBudgetTabHtml(vacanza) {
  const spese = await repo.listSpeseByVacanza(vacanza.id);
  const categorie = await repo.listCategorieSpesa();
  const categorieById = Object.fromEntries(categorie.map((c) => [c.id, c]));
  const riepilogo = await repo.getRiepilogoBudget(vacanza.id);

  const righeSpese = await Promise.all(
    spese.map(async (s) => {
      const importo = repo.calcolaImportoRecord(s, vacanza);
      const isCondivisa = repo.isRecordCondiviso(s, vacanza);
      const cat = s.categoriaId ? categorieById[s.categoriaId] : null;
      const voceLabel = await labelVoceSpesa(s.voceId);
      return `<tr>
        <td>${escapeHtml(s.descrizione || '—')}${voceLabel ? `<div class="settings-td-sub">${escapeHtml(voceLabel)}</div>` : ''}</td>
        <td>${cat ? escapeHtml(cat.nome) : '—'}</td>
        <td class="settings-td-num">${calcoloLabelBudget(s, vacanza)}</td>
        <td class="settings-td-num"><strong>${importo.toFixed(2)}€</strong></td>
        <td>${isCondivisa ? '<span class="budget-badge">Condivisa</span>' : '<span class="budget-badge is-extra">Extra</span>'}</td>
        <td class="settings-td-actions">
          <button class="btn btn-icon btn-ghost" data-action="edit-spesa" data-id="${s.id}" title="Modifica"><i class="fa-solid fa-pen"></i></button>
          <button class="btn btn-icon btn-ghost" data-action="delete-spesa" data-id="${s.id}" title="Elimina"><i class="fa-solid fa-trash-can"></i></button>
        </td>
      </tr>`;
    })
  );

  const listaConCosto = (await repo.listListaVociByVacanza(vacanza.id)).filter((v) => v.modalita && v.contaNelTotale !== false);
  const righeLista = listaConCosto.map((v) => {
    const importo = repo.calcolaImportoRecord(v, vacanza);
    const isCondivisa = repo.isRecordCondiviso(v, vacanza);
    return `<tr>
      <td>${escapeHtml(v.testo)}<div class="settings-td-sub">dalla Lista</div></td>
      <td>—</td>
      <td class="settings-td-num">${calcoloLabelBudget(v, vacanza)}</td>
      <td class="settings-td-num"><strong>${importo.toFixed(2)}€</strong></td>
      <td>${isCondivisa ? '<span class="budget-badge">Condivisa</span>' : '<span class="budget-badge is-extra">Extra</span>'}</td>
      <td></td>
    </tr>`;
  });

  return `
    <p class="settings-tab-hint">Le spese "a persona"/"da dividere" con lo stesso numero di persone della vacanza (${riepilogo.numeroPersone}) sono <strong>condivise</strong> e danno un vero costo a testa. Tutto il resto — spese totali, o con un numero di persone diverso — è <strong>extra</strong>, elencato voce per voce. Anche le voci Lista con un costo (spunta "conta nel totale" attiva) compaiono qui.</p>
    <div class="settings-tab-toolbar"><button class="btn btn-sm btn-primary" data-action="new-spesa"><i class="fa-solid fa-plus"></i> Nuova spesa</button></div>
    ${
      righeSpese.length || righeLista.length
        ? `<div class="settings-table-wrap"><table class="settings-table budget-table">
            <thead><tr><th>Descrizione</th><th>Categoria</th><th>Calcolo</th><th>Importo</th><th>Tipo</th><th></th></tr></thead>
            <tbody>${righeSpese.join('')}${righeLista.join('')}</tbody>
          </table></div>`
        : `<div class="empty-list-note">Nessuna spesa ancora.</div>`
    }
    <div class="budget-riepilogo">
      <div class="budget-riepilogo-riga"><span>Totale condiviso (÷ ${riepilogo.numeroPersone} person${riepilogo.numeroPersone === 1 ? 'a' : 'e'})</span><strong>${riepilogo.totaleCondiviso.toFixed(2)}€</strong></div>
      <div class="budget-riepilogo-riga budget-riepilogo-sub"><span>→ a persona</span><strong>${riepilogo.totaleAPersona != null ? riepilogo.totaleAPersona : '—'}€</strong></div>
      <div class="budget-riepilogo-riga"><span>Extra (${riepilogo.extra.length} voc${riepilogo.extra.length === 1 ? 'e' : 'i'})</span><strong>${riepilogo.totaleExtra.toFixed(2)}€</strong></div>
      <div class="budget-riepilogo-riga budget-riepilogo-totale"><span>Totale generale vacanza</span><strong>${riepilogo.totaleGenerale.toFixed(2)}€</strong></div>
    </div>`;
}

async function renderListaTabHtml(vacanza, giornate) {
  const selezionato = state.listaGiornoSelezionato;

  const selectorHtml = `<div class="lista-day-picker">
    <button class="lista-day-btn ${selezionato === null ? 'is-active' : ''}" data-action="set-lista-giorno" data-giorno-id="">Generale (valigia)</button>
    ${giornate.map((g, i) => `<button class="lista-day-btn ${selezionato === g.id ? 'is-active' : ''}" data-action="set-lista-giorno" data-giorno-id="${g.id}">Giorno ${i + 1}</button>`).join('')}
  </div>`;

  const voci = selezionato ? await repo.listListaVociGiorno(selezionato) : await repo.listListaVociGenerale(vacanza.id);

  const righeHtml = voci
    .map((v) => {
      const importo = v.modalita ? repo.calcolaImportoRecord(v, vacanza) : null;
      return `<div class="lista-voce ${v.fatto ? 'is-fatto' : ''}">
        <label class="lista-voce-check">
          <input type="checkbox" data-action="toggle-lista-voce" data-id="${v.id}" ${v.fatto ? 'checked' : ''}>
          <span>${escapeHtml(v.testo)}</span>
        </label>
        ${
          importo != null
            ? `<span class="lista-voce-costo ${v.contaNelTotale ? '' : 'is-escluso'}">${importo.toFixed(2)}€${v.modalita !== 'secco' ? ` <span class="budget-segue">(${calcoloLabelBudget(v, vacanza).replace(/<[^>]+>/g, '')})</span>` : ''}${!v.contaNelTotale ? ' · escluso dal totale' : ''}</span>`
            : ''
        }
        <div class="lista-voce-actions">
          <button class="btn btn-icon btn-ghost" data-action="edit-lista-voce" data-id="${v.id}" title="Modifica"><i class="fa-solid fa-pen"></i></button>
          <button class="btn btn-icon btn-ghost" data-action="delete-lista-voce" data-id="${v.id}" title="Elimina"><i class="fa-solid fa-trash-can"></i></button>
        </div>
      </div>`;
    })
    .join('');

  return `
    <p class="settings-tab-hint">Una lista generale per la vacanza (la valigia) più una per ciascun giorno. Una voce con un costo entra di default nel Budget, tra gli Extra: puoi escluderla se non deve contare.</p>
    ${selectorHtml}
    <div class="settings-tab-toolbar"><button class="btn btn-sm btn-primary" data-action="new-lista-voce"><i class="fa-solid fa-plus"></i> Aggiungi voce</button></div>
    ${voci.length ? `<div class="lista-voci">${righeHtml}</div>` : `<div class="empty-list-note">Nessuna voce ancora.</div>`}`;
}

/** Involucro comune a tutte le card della timeline: colonna oraria a piena altezza (il "taglio"
 * blu) più una colonna principale che contiene la riga di contenuto e le note sotto. */
function timelineCardHtml({ id, extraClass = '', timeColContent, mainContent, azioniHtml, noteHtml }) {
  return `<div class="timeline-item ${extraClass}" draggable="true" data-id="${id}">
    <div class="timeline-time-col">${timeColContent}</div>
    <div class="timeline-main-col">
      <div class="timeline-item-top">
        <div class="timeline-item-main">${mainContent}</div>
        ${azioniHtml}
      </div>
      ${noteHtml}
    </div>
  </div>`;
}

async function renderVoceHtml(voce, index, vociList, vacanza, giornata, tipiById, tappaNome) {
  const azioni = `<div class="timeline-actions">
    <button class="btn btn-icon btn-ghost" data-action="edit-voce" data-id="${voce.id}" title="Modifica"><i class="fa-solid fa-pen"></i></button>
    <button class="btn btn-icon btn-ghost" data-action="delete-voce" data-id="${voce.id}" title="Rimuovi"><i class="fa-solid fa-trash-can"></i></button>
  </div>`;
  const noteHtml = voce.note ? `<div class="timeline-note">${escapeHtml(voce.note)}</div>` : '';

  if (voce.tipoVoce === 'partenza' || voce.tipoVoce === 'rientro') {
    // Partenza e Rientro trattate come una tappa "di passaggio": stessa immagine/nome/tipo
    // del riferimento collegato. Solo la Partenza mantiene un orario fisso obbligatorio.
    const isPartenza = voce.tipoVoce === 'partenza';
    const rifId = isPartenza ? voce.daRifTappaId : voce.aRifTappaId;
    const effettivo = rifId || defaultAlloggioTappaId(vacanza, giornata);
    const tappaRif = effettivo ? await repo.getTappa(effettivo) : null;
    const tipoRif = tappaRif ? tipiById[(tappaRif.tipi || [])[0]] : null;
    const cover = tappaRif && tappaRif.immagini && tappaRif.immagini[0];
    const etichetta = isPartenza ? 'Partenza' : 'Rientro';
    const mainContent = `
      ${cover ? `<img class="cover-thumb" src="${cover}" alt="">` : ''}
      <div class="timeline-body">
        <div class="timeline-title">${tappaRif ? escapeHtml(tappaRif.nome) : etichetta}</div>
        <div class="timeline-tipo">${etichetta}${tipoRif ? ` · ${escapeHtml(tipoRif.nome)}` : ''}${!tappaRif ? ' · nessun riferimento impostato' : ''}</div>
      </div>`;
    return timelineCardHtml({
      id: voce.id,
      extraClass: `timeline-item-evento tipo-${voce.tipoVoce}`,
      timeColContent: isPartenza ? timeColHtml({ inizio: timeToMinutes(voce.ora), fine: null }) : timeColHtml({ inizio: voce._inizio, fine: null }),
      mainContent,
      azioniHtml: azioni,
      noteHtml,
    });
  }

  if (voce.tipoVoce === 'spostamento') {
    const daId = voce.daRifTappaId || endingLocationId(vociList[index - 1], vacanza, giornata);
    const aId = voce.aRifTappaId || startingLocationId(vociList[index + 1], vacanza, giornata);
    const daNome = daId ? await tappaNome(daId) : null;
    const aNome = aId ? await tappaNome(aId) : null;
    const durataEffettiva = voce.durataMin ?? voce.durataRealeMin ?? null;
    const percorsoLabel = daNome || aNome ? `${escapeHtml(daNome || '?')} → ${escapeHtml(aNome || '?')}` : 'percorso non specificato';
    const distanzaLabel = voce.distanzaRealeKm != null ? ` · ${voce.distanzaRealeKm.toFixed(1)} km reali` : '';
    const mainContent = `<div class="timeline-body">
        <div class="timeline-title"><i class="fa-solid ${mezzoIcon(voce.mezzo)}"></i> Spostamento · ${escapeHtml(mezzoLabel(voce.mezzo))}</div>
        <div class="timeline-tipo">${percorsoLabel}${distanzaLabel}</div>
      </div>`;
    return timelineCardHtml({
      id: voce.id,
      extraClass: 'timeline-item-evento tipo-spostamento',
      timeColContent: timeColHtml({ inizio: voce._inizio, fine: voce._fine, durataLabel: durataEffettiva != null ? `${durataEffettiva} min` : null }),
      mainContent,
      azioniHtml: azioni,
      noteHtml,
    });
  }

  // tipoVoce === 'tappa' (default, compatibile anche con i vecchi record)
  const tappa = await repo.getTappa(voce.tappaId);
  const tipo = tappa ? tipiById[(tappa.tipi || [])[0]] : null;
  const cover = tappa && tappa.immagini && tappa.immagini[0];
  const isPassaggio = voce.permanenzaMin === 0;
  const durataLabel = isPassaggio ? 'passaggio' : voce.permanenzaMin != null ? `${voce.permanenzaMin} min` : null;
  const mainContent = `
    ${cover ? `<img class="cover-thumb" src="${cover}" alt="">` : ''}
    <div class="timeline-body">
      <div class="timeline-title">${escapeHtml(tappa ? tappa.nome : 'Tappa eliminata')}</div>
      <div class="timeline-tipo">${escapeHtml(tipo ? tipo.nome : '')}</div>
    </div>`;
  const azioniTappa = `<div class="timeline-actions">
    ${tappa ? `<button class="btn btn-icon btn-ghost" data-action="open-tappa-scheda" data-id="${tappa.id}" title="Apri scheda tappa (mappa, foto, info)"><i class="fa-solid fa-circle-info"></i></button>` : ''}
    <button class="btn btn-icon btn-ghost" data-action="edit-voce" data-id="${voce.id}" title="Modifica permanenza/note"><i class="fa-solid fa-pen"></i></button>
    <button class="btn btn-icon btn-ghost" data-action="delete-voce" data-id="${voce.id}" title="Rimuovi"><i class="fa-solid fa-trash-can"></i></button>
  </div>`;
  return timelineCardHtml({
    id: voce.id,
    timeColContent: timeColHtml({ inizio: voce._inizio, fine: voce._fine, durataLabel }),
    mainContent,
    azioniHtml: azioniTappa,
    noteHtml,
  });
}

/** Markup della colonna oraria, uniforme per tutti i tipi di voce: un solo orario se fine è
 * assente o coincide con inizio (Partenza, Rientro, tappa "di passaggio"), altrimenti un
 * intervallo impilato su due righe — così la colonna resta sempre della stessa larghezza. */
function timeColHtml({ inizio, fine, durataLabel = null }) {
  let oraHtml;
  if (inizio == null && fine == null) {
    oraHtml = `<span class="timeline-time">?</span>`;
  } else if (fine == null || fine === inizio) {
    oraHtml = `<span class="timeline-time">${inizio != null ? minutesToTime(inizio) : '?'}</span>`;
  } else {
    oraHtml = `<span class="timeline-time">${inizio != null ? minutesToTime(inizio) : '?'}</span><span class="timeline-time-sep">–</span><span class="timeline-time">${fine != null ? minutesToTime(fine) : '?'}</span>`;
  }
  return `${oraHtml}${durataLabel ? `<div class="timeline-duration">${escapeHtml(durataLabel)}</div>` : ''}`;
}


/* --- Esplora: destinazioni entro una distanza da un punto --- */

let esploraDestCache = [];

async function renderCanvasEsplora() {
  const destinazioni = await repo.listDestinazioni();
  esploraDestCache = destinazioni;
  const facets = await repo.getFacetsDestinazioni();
  const categorie = await repo.listCategorieDestinazione();
  const es = state.esplora;

  canvas.innerHTML = `
    <div class="page page-wide">
      <div class="page-header">
        <div>
          <div class="page-eyebrow">Esplora</div>
          <div class="page-title">Cosa c'è nei dintorni?</div>
          <div class="page-note">Scegli un punto di partenza e un raggio di ricerca: calcolo in automatico linea d'aria, auto e a piedi per tutte le destinazioni entro quel raggio, e puoi filtrare su ognuno di questi valori.</div>
        </div>
      </div>

      <div class="esplora-form">
        <div class="field">
          <label class="field-label">Punto di partenza</label>
          <div class="type-toggle" id="esplora-origine-toggle">
            <button type="button" class="type-toggle-btn ${es.origineModo === 'coordinate' ? 'is-selected' : ''}" data-modo="coordinate">
              <div class="type-toggle-title">Coordinate</div>
              <div class="type-toggle-sub">Incolla lat, lng</div>
            </button>
            <button type="button" class="type-toggle-btn ${es.origineModo === 'destinazione' ? 'is-selected' : ''}" data-modo="destinazione">
              <div class="type-toggle-title">Destinazione</div>
              <div class="type-toggle-sub">Parti da un luogo in archivio</div>
            </button>
            <button type="button" class="type-toggle-btn ${es.origineModo === 'posizione' ? 'is-selected' : ''}" data-modo="posizione">
              <div class="type-toggle-title">Posizione attuale</div>
              <div class="type-toggle-sub">Geolocalizzazione del browser</div>
            </button>
          </div>
        </div>

        <div class="field" id="esplora-origine-input">${renderEsploraOrigineInput(destinazioni)}</div>

        <div class="field">
          <label class="field-label">Raggio di ricerca iniziale, in linea d'aria (km)</label>
          <input type="number" id="esplora-raggio" min="1" value="${es.raggioKm}">
        </div>
        <div class="hint">Il raggio definisce quali destinazioni considerare. "Treno" non è incluso: non esiste un servizio di routing ferroviario gratuito senza una chiave a pagamento.</div>

        <div class="field">
          <label class="field-label">Altri filtri</label>
          <div class="filters-bar" style="--filter-cols:3;">
            <input type="text" id="esplora-f-nome" placeholder="Cerca per nome…" value="${escapeHtml(es.filtri.nome)}">
            <select id="esplora-f-stato"><option value="">Stato (tutti)</option>${facets.stati.map((s) => `<option value="${escapeHtml(s)}" ${es.filtri.stato === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}</select>
            <select id="esplora-f-regione"><option value="">Regione (tutte)</option>${facets.regioni.map((s) => `<option value="${escapeHtml(s)}" ${es.filtri.regione === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}</select>
            <select id="esplora-f-provincia"><option value="">Provincia (tutte)</option>${facets.province.map((s) => `<option value="${escapeHtml(s)}" ${es.filtri.provincia === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}</select>
          </div>
          <div id="esplora-f-categorie" class="filters-bar-categories">${chipCheckboxesHtml(categorie, es.filtri.categorieIds, 'ecat')}</div>
        </div>

        <div class="field">
          <label class="field-label">Filtri sui valori calcolati (massimo)</label>
          <div class="filters-bar" style="--filter-cols:4;">
            <input type="number" id="esplora-fv-aria" placeholder="Km linea d'aria" min="0" value="${es.filtriValori.lineaAriaMax}">
            <input type="number" id="esplora-fv-autokm" placeholder="Km in auto" min="0" value="${es.filtriValori.autoKmMax}">
            <input type="number" id="esplora-fv-automin" placeholder="Min in auto" min="0" value="${es.filtriValori.autoMinMax}">
            <input type="number" id="esplora-fv-piedikm" placeholder="Km a piedi" min="0" value="${es.filtriValori.piediKmMax}">
          </div>
        </div>
      </div>

      <div id="esplora-results"></div>
    </div>`;

  document.getElementById('esplora-origine-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-modo]');
    if (!btn) return;
    es.origineModo = btn.dataset.modo;
    esploraRoutingCache = {};
    esploraGeneration++;
    renderCanvasEsplora();
  });
  bindEsploraOrigineInput(destinazioni);

  document.getElementById('esplora-raggio').addEventListener('input', (e) => { es.raggioKm = e.target.value; esploraGeneration++; updateEsploraResults(); });
  document.getElementById('esplora-f-nome').addEventListener('input', (e) => { es.filtri.nome = e.target.value; updateEsploraResults(); });
  document.getElementById('esplora-f-stato').addEventListener('change', (e) => { es.filtri.stato = e.target.value; updateEsploraResults(); });
  document.getElementById('esplora-f-regione').addEventListener('change', (e) => { es.filtri.regione = e.target.value; updateEsploraResults(); });
  document.getElementById('esplora-f-provincia').addEventListener('change', (e) => { es.filtri.provincia = e.target.value; updateEsploraResults(); });
  document.getElementById('esplora-f-categorie').addEventListener('change', (e) => {
    if (e.target.type !== 'checkbox') return;
    es.filtri.categorieIds = [...document.querySelectorAll('#esplora-f-categorie input:checked')].map((i) => i.value);
    updateEsploraResults();
  });
  document.getElementById('esplora-fv-aria').addEventListener('input', (e) => { es.filtriValori.lineaAriaMax = e.target.value; updateEsploraResults(); });
  document.getElementById('esplora-fv-autokm').addEventListener('input', (e) => { es.filtriValori.autoKmMax = e.target.value; updateEsploraResults(); });
  document.getElementById('esplora-fv-automin').addEventListener('input', (e) => { es.filtriValori.autoMinMax = e.target.value; updateEsploraResults(); });
  document.getElementById('esplora-fv-piedikm').addEventListener('input', (e) => { es.filtriValori.piediKmMax = e.target.value; updateEsploraResults(); });

  await updateEsploraResults();
}

function renderEsploraOrigineInput(destinazioni) {
  const es = state.esplora;
  if (es.origineModo === 'coordinate') {
    return `<label class="field-label">Coordinate di partenza</label>
      <input type="text" id="esplora-coord" placeholder="45.577315815180725, 11.351812970491833" value="${escapeHtml(es.origineCoordinateRaw)}">
      <div class="coord-hint" id="esplora-coord-hint"></div>`;
  }
  if (es.origineModo === 'destinazione') {
    const conCoord = destinazioni.filter((d) => d.coordinate);
    return `<label class="field-label">Destinazione di partenza</label>
      <select id="esplora-dest-origine">
        <option value="">Scegli una destinazione…</option>
        ${conCoord.map((d) => `<option value="${d.id}" ${es.origineDestinazioneId === d.id ? 'selected' : ''}>${escapeHtml(d.nome)}</option>`).join('')}
      </select>
      ${conCoord.length < destinazioni.length ? `<div class="hint">Solo le destinazioni con coordinate salvate compaiono qui.</div>` : ''}`;
  }
  return `<label class="field-label">Posizione attuale</label>
    <button type="button" class="btn btn-sm btn-ghost" id="esplora-rileva-posizione">Rileva posizione</button>
    <div class="coord-hint" id="esplora-posizione-hint">${es.originePosizione ? `Posizione rilevata: ${formatCoordinate(es.originePosizione)}` : 'Nessuna posizione rilevata ancora.'}</div>`;
}

function bindEsploraOrigineInput() {
  const es = state.esplora;
  if (es.origineModo === 'coordinate') {
    const input = document.getElementById('esplora-coord');
    const hint = document.getElementById('esplora-coord-hint');
    let ultimoValido = null;
    const update = () => {
      es.origineCoordinateRaw = input.value;
      const parsed = parseCoordinateInput(input.value);
      if (!input.value.trim()) {
        hint.textContent = '';
        hint.className = 'coord-hint';
      } else if (parsed) {
        hint.textContent = `Riconosciute: ${formatCoordinate(parsed)}`;
        hint.className = 'coord-hint is-valid';
        const cambiata = !ultimoValido || ultimoValido.lat !== parsed.lat || ultimoValido.lng !== parsed.lng;
        if (cambiata) {
          ultimoValido = parsed;
          esploraRoutingCache = {};
          esploraGeneration++;
        }
      } else {
        hint.textContent = 'Formato non riconosciuto: usa "lat, lng"';
        hint.className = 'coord-hint is-invalid';
      }
      updateEsploraResults();
    };
    input.addEventListener('input', update);
  } else if (es.origineModo === 'destinazione') {
    document.getElementById('esplora-dest-origine').addEventListener('change', (e) => {
      es.origineDestinazioneId = e.target.value;
      esploraRoutingCache = {};
      esploraGeneration++;
      updateEsploraResults();
    });
  } else {
    document.getElementById('esplora-rileva-posizione').addEventListener('click', () => {
      const hint = document.getElementById('esplora-posizione-hint');
      if (!navigator.geolocation) {
        hint.textContent = 'Geolocalizzazione non disponibile in questo browser.';
        return;
      }
      hint.textContent = 'Rilevamento in corso…';
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          es.originePosizione = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          hint.textContent = `Posizione rilevata: ${formatCoordinate(es.originePosizione)}`;
          esploraRoutingCache = {};
          esploraGeneration++;
          updateEsploraResults();
        },
        (err) => {
          hint.textContent = `Posizione non disponibile (${err && err.message ? err.message : 'permesso negato'}).`;
        },
        { enableHighAccuracy: false, timeout: 10000 }
      );
    });
  }
}

function resolveEsploraOrigine() {
  const es = state.esplora;
  if (es.origineModo === 'coordinate') return parseCoordinateInput(es.origineCoordinateRaw);
  if (es.origineModo === 'destinazione') {
    const d = esploraDestCache.find((x) => x.id === es.origineDestinazioneId);
    return d ? d.coordinate : null;
  }
  return es.originePosizione;
}

/**
 * Cache di sessione delle distanze reali già calcolate: {"destId:profilo": {distanzaKm, durataMin}}.
 * NON è indicizzata per origine: va sempre svuotata quando l'origine cambia, altrimenti mostrerebbe
 * distanze calcolate rispetto al punto di partenza sbagliato. Lo fanno già tutti i punti che
 * modificano origineCoordinateRaw / origineDestinazioneId / originePosizione qui sopra.
 */
let esploraRoutingCache = {};
/** Incrementato ad ogni cambio che invalida un calcolo in corso, per scartare risposte ormai superate. */
let esploraGeneration = 0;

function formatRouteValue(r) {
  if (!r || r.errore) return null;
  return { km: r.distanzaKm.toFixed(1), min: String(r.durataMin) };
}

function esploraRowHtml(d) {
  const auto = esploraRoutingCache[`${d.id}:driving-car`];
  const piedi = esploraRoutingCache[`${d.id}:foot-walking`];
  const autoFmt = auto ? formatRouteValue(auto) : null;
  const piediFmt = piedi ? formatRouteValue(piedi) : null;
  const autoAttesa = auto ? (auto.errore ? '—' : autoFmt.km) : '…';
  const autoMinAttesa = auto ? (auto.errore ? '—' : autoFmt.min) : '…';
  const piediAttesa = piedi ? (piedi.errore ? '—' : piediFmt.km) : '…';
  const piediMinAttesa = piedi ? (piedi.errore ? '—' : piediFmt.min) : '…';

  return `<tr class="esplora-table-row" data-action="vai-a-destinazione" data-id="${d.id}">
    <td class="esplora-td-nome">${escapeHtml(d.nome)}</td>
    <td class="esplora-td-meta">${escapeHtml([d.provincia, d.regione].filter(Boolean).join(' · '))}</td>
    <td class="esplora-td-num">${d.distanzaLineaAria.toFixed(1)}</td>
    <td class="esplora-td-num">${autoAttesa}</td>
    <td class="esplora-td-num">${autoMinAttesa}</td>
    <td class="esplora-td-num">${piediAttesa}</td>
    <td class="esplora-td-num">${piediMinAttesa}</td>
  </tr>`;
}

async function updateEsploraResults() {
  const container = document.getElementById('esplora-results');
  if (!container) return;
  const es = state.esplora;
  const origine = resolveEsploraOrigine();
  const raggioKm = Number(es.raggioKm);

  if (!origine) {
    container.innerHTML = `<div class="timeline-empty">Imposta un punto di partenza valido per vedere i risultati.</div>`;
    return;
  }
  if (!raggioKm || raggioKm <= 0) {
    container.innerHTML = `<div class="timeline-empty">Imposta un raggio di ricerca maggiore di zero.</div>`;
    return;
  }

  // La linea d'aria è sempre <= alla distanza reale su strada: usarla come pool iniziale
  // è quindi sicuro (non esclude mai un candidato valido) e non costa nessuna chiamata esterna.
  let candidati = esploraDestCache
    .map((d) => ({ ...d, distanzaLineaAria: d.coordinate ? haversineKm(origine, d.coordinate) : null }))
    .filter((d) => d.distanzaLineaAria != null && d.distanzaLineaAria <= raggioKm);

  const f = es.filtri;
  candidati = candidati.filter((d) => {
    if (f.nome && !d.nome.toLowerCase().includes(f.nome.toLowerCase())) return false;
    if (f.stato && d.stato !== f.stato) return false;
    if (f.regione && d.regione !== f.regione) return false;
    if (f.provincia && d.provincia !== f.provincia) return false;
    if (f.categorieIds.length && !(d.categorieIds || []).some((id) => f.categorieIds.includes(id))) return false;
    return true;
  });

  if (!candidati.length) {
    container.innerHTML = `<div class="timeline-empty">Nessuna destinazione entro ${raggioKm} km da qui (o nessuna con coordinate salvate e che rispetti i filtri).</div>`;
    return;
  }

  candidati.sort((a, b) => a.distanzaLineaAria - b.distanzaLineaAria);

  const CAP = 40;
  const daCalcolare = candidati.filter((d) => !esploraRoutingCache[`${d.id}:driving-car`] || !esploraRoutingCache[`${d.id}:foot-walking`]);
  const inCalcolo = daCalcolare.length > 0;
  const oltreIlTetto = candidati.length > CAP;

  // Filtri sui valori calcolati: applicati solo su ciò che è già in cache. Finché un valore non è
  // ancora arrivato la riga resta visibile; una volta calcolato, se non passa il filtro, sparirà
  // al prossimo giro (quando ensureRoutingForCandidates richiama updateEsploraResults()).
  const fv = es.filtriValori;
  const filtratiPerValore = candidati.filter((d) => {
    if (fv.lineaAriaMax !== '' && d.distanzaLineaAria > Number(fv.lineaAriaMax)) return false;
    const auto = esploraRoutingCache[`${d.id}:driving-car`];
    const piedi = esploraRoutingCache[`${d.id}:foot-walking`];
    if (fv.autoKmMax !== '' && auto && !auto.errore && auto.distanzaKm > Number(fv.autoKmMax)) return false;
    if (fv.autoMinMax !== '' && auto && !auto.errore && auto.durataMin > Number(fv.autoMinMax)) return false;
    if (fv.piediKmMax !== '' && piedi && !piedi.errore && piedi.distanzaKm > Number(fv.piediKmMax)) return false;
    return true;
  });

  const perMappa = filtratiPerValore.slice(0, 30); // limite prudenziale, non tecnico: Leaflet regge bene molti più marker

  container.innerHTML = `
    ${
      inCalcolo
        ? `<div class="esplora-batch-banner">
            <span>Calcolo distanze reali per ${daCalcolare.length} destinazion${daCalcolare.length === 1 ? 'e' : 'i'} in corso…${oltreIlTetto ? ` Sono più di ${CAP}: mostro solo le prime ${CAP} più vicine, restringi raggio o filtri per calcolare le altre.` : ''}</span>
          </div>`
        : ''
    }
    <div class="esplora-results-header">
      <span>${filtratiPerValore.length} destinazion${filtratiPerValore.length === 1 ? 'e' : 'i'} entro ${raggioKm} km</span>
      <button class="btn btn-sm btn-ghost" id="esplora-mostra-mappa">Mostra mappa combinata</button>
    </div>
    <div id="esplora-mappa-container"></div>
    <div class="esplora-table-wrap">
      <table class="esplora-table">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Zona</th>
            <th>Km aria</th>
            <th>Km auto</th>
            <th>Min auto</th>
            <th>Km a piedi</th>
            <th>Min a piedi</th>
          </tr>
        </thead>
        <tbody>${filtratiPerValore.map(esploraRowHtml).join('')}</tbody>
      </table>
    </div>`;

  document.getElementById('esplora-mostra-mappa').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const mapContainer = document.getElementById('esplora-mappa-container');
    btn.disabled = true;
    btn.textContent = 'Carico la mappa…';
    try {
      await loadLeaflet();
      mapContainer.innerHTML = `<div id="esplora-leaflet-map" class="esplora-leaflet-map"></div>
        ${filtratiPerValore.length > perMappa.length ? `<div class="map-hint">Mostrate le ${perMappa.length} destinazioni più vicine su ${filtratiPerValore.length} totali.</div>` : ''}`;
      const map = L.map('esplora-leaflet-map');
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 18,
      }).addTo(map);

      L.marker([origine.lat, origine.lng], { title: 'Punto di partenza' })
        .addTo(map)
        .bindPopup('<strong>Punto di partenza</strong>');
      const bounds = [[origine.lat, origine.lng]];

      perMappa
        .filter((d) => d.coordinate)
        .forEach((d) => {
          L.marker([d.coordinate.lat, d.coordinate.lng])
            .addTo(map)
            .bindPopup(`<strong>${escapeHtml(d.nome)}</strong><br>${d.distanzaLineaAria.toFixed(1)} km`);
          bounds.push([d.coordinate.lat, d.coordinate.lng]);
        });

      map.fitBounds(bounds, { padding: [30, 30] });
      btn.textContent = 'Mostra mappa combinata';
      btn.disabled = false;
    } catch (err) {
      mapContainer.innerHTML = `<div class="map-hint">Mappa non disponibile: serve una connessione internet per caricarla la prima volta.</div>`;
      btn.textContent = 'Mostra mappa combinata';
      btn.disabled = false;
    }
  });

  if (inCalcolo) {
    ensureRoutingForCandidates(candidati.slice(0, CAP), origine, esploraGeneration);
  }
}

/** Calcola in background (senza bloccare l'interfaccia) le distanze reali mancanti, con una
 * concorrenza limitata per restare entro i limiti di richieste al minuto del servizio gratuito. */
async function ensureRoutingForCandidates(candidati, origine, generation) {
  const config = await repo.getConfig();
  if (!config.orsApiKey) return; // nessuna chiave impostata: i valori restano vuoti in tabella

  const daFare = [];
  for (const d of candidati) {
    if (!d.coordinate) continue;
    if (!esploraRoutingCache[`${d.id}:driving-car`]) daFare.push({ d, profilo: 'driving-car' });
    if (!esploraRoutingCache[`${d.id}:foot-walking`]) daFare.push({ d, profilo: 'foot-walking' });
  }

  const CONCORRENZA = 3;
  let indice = 0;

  async function worker() {
    while (indice < daFare.length) {
      if (generation !== esploraGeneration) return; // superato da un cambio successivo, interrompo
      const item = daFare[indice++];
      try {
        const risultato = await calcolaDistanzaStrada(config.orsApiKey, origine, item.d.coordinate, item.profilo);
        if (generation !== esploraGeneration) return;
        esploraRoutingCache[`${item.d.id}:${item.profilo}`] = risultato;
      } catch {
        if (generation !== esploraGeneration) return;
        esploraRoutingCache[`${item.d.id}:${item.profilo}`] = { errore: true };
      }
    }
  }

  await Promise.all(Array.from({ length: CONCORRENZA }, worker));
  if (generation === esploraGeneration) updateEsploraResults();
}


/** Carica Leaflet (JS+CSS) da CDN una sola volta per sessione, solo quando serve davvero. */
let leafletLoadingPromise = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (leafletLoadingPromise) return leafletLoadingPromise;
  leafletLoadingPromise = new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => resolve();
    script.onerror = () => {
      leafletLoadingPromise = null;
      reject(new Error('Leaflet non caricato'));
    };
    document.head.appendChild(script);
  });
  return leafletLoadingPromise;
}

/* --- Impostazioni: tipi di tappa --- */

async function renderCanvasImpostazioni() {
  const config = await repo.getConfig();
  const tab = state.impostazioniTab;

  const tabsHtml = `<div class="settings-tabs">
    <button class="settings-tab ${tab === 'categorie' ? 'is-active' : ''}" data-action="set-impostazioni-tab" data-tab="categorie">Categorie destinazioni</button>
    <button class="settings-tab ${tab === 'tipi' ? 'is-active' : ''}" data-action="set-impostazioni-tab" data-tab="tipi">Tipi di tappa</button>
    <button class="settings-tab ${tab === 'categorieSpesa' ? 'is-active' : ''}" data-action="set-impostazioni-tab" data-tab="categorieSpesa">Categorie spesa</button>
    <button class="settings-tab ${tab === 'routing' ? 'is-active' : ''}" data-action="set-impostazioni-tab" data-tab="routing">Routing</button>
    <button class="settings-tab ${tab === 'navigazione' ? 'is-active' : ''}" data-action="set-impostazioni-tab" data-tab="navigazione">Navigazione</button>
  </div>`;

  let contenuto = '';

  if (tab === 'categorie') {
    const categorie = await repo.listCategorieDestinazione();
    const righe = await Promise.all(
      categorie.map(async (c) => {
        const usage = await repo.checkCategoriaDestinazioneUsage(c.id);
        return `<tr>
          <td>${escapeHtml(c.nome)}</td>
          <td class="settings-td-num">${usage.count} destinazion${usage.count === 1 ? 'e' : 'i'}</td>
          <td class="settings-td-actions">
            <button class="btn btn-icon btn-ghost" data-action="edit-categoria-dest" data-id="${c.id}" title="Modifica"><i class="fa-solid fa-pen"></i></button>
            <button class="btn btn-icon btn-ghost" data-action="delete-categoria-dest" data-id="${c.id}" title="Elimina"><i class="fa-solid fa-trash-can"></i></button>
          </td>
        </tr>`;
      })
    );
    contenuto = `
      <p class="settings-tab-hint">Non esclusive: una destinazione può averne più di una (es. "montagna" e "famiglia" insieme).</p>
      <div class="settings-tab-toolbar"><button class="btn btn-sm btn-primary" data-action="new-categoria-dest"><i class="fa-solid fa-plus"></i> Nuova categoria</button></div>
      ${
        righe.length
          ? `<div class="settings-table-wrap"><table class="settings-table">
              <thead><tr><th>Nome</th><th>Utilizzo</th><th></th></tr></thead>
              <tbody>${righe.join('')}</tbody>
            </table></div>`
          : `<div class="empty-list-note">Nessuna categoria ancora.</div>`
      }`;
  } else if (tab === 'tipi') {
    const tipi = await repo.listTipiTappa();
    const righe = await Promise.all(
      tipi.map(async (t) => {
        const usage = await repo.checkTipoTappaUsage(t.id);
        return `<tr>
          <td>${escapeHtml(t.nome)}</td>
          <td class="settings-td-num">${usage.count} tapp${usage.count === 1 ? 'a' : 'e'}</td>
          <td class="settings-td-actions">
            <button class="btn btn-icon btn-ghost" data-action="edit-tipo" data-id="${t.id}" title="Modifica"><i class="fa-solid fa-pen"></i></button>
            <button class="btn btn-icon btn-ghost" data-action="delete-tipo" data-id="${t.id}" title="Elimina"><i class="fa-solid fa-trash-can"></i></button>
          </td>
        </tr>`;
      })
    );
    contenuto = `
      <p class="settings-tab-hint">Una tappa può avere più tipi (es. un rifugio è Ristoro e Alloggio insieme). Elimina un tipo solo dopo aver riassegnato le tappe che lo usano.</p>
      <div class="settings-tab-toolbar"><button class="btn btn-sm btn-primary" data-action="new-tipo-tappa"><i class="fa-solid fa-plus"></i> Nuovo tipo</button></div>
      ${
        righe.length
          ? `<div class="settings-table-wrap"><table class="settings-table">
              <thead><tr><th>Nome</th><th>Utilizzo</th><th></th></tr></thead>
              <tbody>${righe.join('')}</tbody>
            </table></div>`
          : `<div class="empty-list-note">Nessun tipo ancora.</div>`
      }`;
  } else if (tab === 'categorieSpesa') {
    const categorie = await repo.listCategorieSpesa();
    const righe = await Promise.all(
      categorie.map(async (c) => {
        const usage = await repo.checkCategoriaSpesaUsage(c.id);
        return `<tr>
          <td>${escapeHtml(c.nome)}</td>
          <td class="settings-td-num">${usage.count} spes${usage.count === 1 ? 'a' : 'e'}</td>
          <td class="settings-td-actions">
            <button class="btn btn-icon btn-ghost" data-action="edit-categoria-spesa" data-id="${c.id}" title="Modifica"><i class="fa-solid fa-pen"></i></button>
            <button class="btn btn-icon btn-ghost" data-action="delete-categoria-spesa" data-id="${c.id}" title="Elimina"><i class="fa-solid fa-trash-can"></i></button>
          </td>
        </tr>`;
      })
    );
    contenuto = `
      <p class="settings-tab-hint">Per classificare le spese nel Budget di ogni vacanza (Alloggio, Trasporto, Cibo...).</p>
      <div class="settings-tab-toolbar"><button class="btn btn-sm btn-primary" data-action="new-categoria-spesa"><i class="fa-solid fa-plus"></i> Nuova categoria</button></div>
      ${
        righe.length
          ? `<div class="settings-table-wrap"><table class="settings-table">
              <thead><tr><th>Nome</th><th>Utilizzo</th><th></th></tr></thead>
              <tbody>${righe.join('')}</tbody>
            </table></div>`
          : `<div class="empty-list-note">Nessuna categoria ancora.</div>`
      }`;
  } else if (tab === 'routing') {
    contenuto = `
      <p class="settings-tab-hint">
        Per calcolare distanza e durata reali su strada (non in linea d'aria) serve una chiave gratuita di
        <a href="https://openrouteservice.org/dev/#/signup" target="_blank" rel="noopener">openrouteservice.org</a>
        (iscrizione via email, nessuna carta di credito). La chiave resta solo su questo Mac, in IndexedDB:
        non viene mai inclusa nei backup esportati, per non finire per sbaglio in un file condiviso.
      </p>
      <form id="form-ors-key" class="ors-key-form">
        <input type="text" id="ors-key-input" placeholder="Incolla qui la tua chiave Openrouteservice" value="${escapeHtml(config.orsApiKey)}">
        <button type="submit" class="btn btn-sm btn-primary">Salva</button>
      </form>
      <div id="ors-key-status" class="hint" style="margin-top:8px;"></div>`;
  } else {
    const navNascostiCorrenti = config.navNascosti || [];
    const righeNav = NAV_ITEMS.map((item) => {
      const bloccata = item.key === 'impostazioni';
      const nascosta = navNascostiCorrenti.includes(item.key);
      return `<tr>
        <td>${item.icon} ${escapeHtml(item.label)}</td>
        <td class="settings-td-actions" style="justify-content:flex-start;">
          ${
            bloccata
              ? `<span class="hint" style="margin:0;">sempre visibile</span>`
              : `<label class="chip-checkbox">
                  <input type="checkbox" data-nav-toggle="${item.key}" ${nascosta ? '' : 'checked'}>
                  <span>${nascosta ? 'Nascosta' : 'Visibile'}</span>
                </label>`
          }
        </td>
      </tr>`;
    }).join('');
    contenuto = `
      <p class="settings-tab-hint">Scegli quali voci mostrare nel menu. Impostazioni resta sempre visibile, altrimenti non avresti più modo di tornare a cambiare queste stesse scelte.</p>
      <div class="settings-table-wrap"><table class="settings-table">
        <thead><tr><th>Sezione</th><th>Visibilità</th></tr></thead>
        <tbody>${righeNav}</tbody>
      </table></div>`;
  }

  canvas.innerHTML = `
    <div class="page">
      <div class="page-header">
        <div>
          <div class="page-eyebrow">Impostazioni</div>
          <div class="page-title">Categorie riutilizzabili</div>
          <div class="page-note">Le etichette che usi in tutto l'archivio: si aggiornano ovunque appena le modifichi qui.</div>
        </div>
      </div>
      ${tabsHtml}
      <div class="settings-tab-panel">${contenuto}</div>
    </div>`;

  const orsForm = document.getElementById('form-ors-key');
  if (orsForm) {
    orsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const key = document.getElementById('ors-key-input').value;
      await repo.setOrsApiKey(key);
      const status = document.getElementById('ors-key-status');
      status.innerHTML = key.trim() ? '<i class="fa-solid fa-check"></i> Chiave salvata.' : 'Chiave rimossa.';
    });
  }

  canvas.querySelectorAll('[data-nav-toggle]').forEach((checkbox) => {
    checkbox.addEventListener('change', async () => {
      const chiave = checkbox.dataset.navToggle;
      const attuali = new Set(navNascosti);
      if (checkbox.checked) attuali.delete(chiave);
      else attuali.add(chiave);
      navNascosti = [...attuali];
      await repo.setNavNascosti(navNascosti);
      renderRailNav();
      await renderCanvas();
    });
  });
}

/* --- Backup --- */

async function renderCanvasBackup() {
  canvas.innerHTML = `
    <div class="page">
      <div class="page-header">
        <div>
          <div class="page-eyebrow">Backup</div>
          <div class="page-title">Il tuo archivio, al sicuro</div>
          <div class="page-note">Tutto resta sul tuo Mac: nessun server, nessun account. Esporta di tanto in tanto un file JSON come copia di sicurezza.</div>
        </div>
      </div>
      <div class="backup-panel">
        <div class="backup-card">
          <div class="backup-card-title">Esporta backup</div>
          <div class="backup-card-sub">Scarica un file .json con destinazioni, tappe, vacanze, giornate, pianificazioni e tipi di tappa.</div>
          <button class="btn btn-primary" id="btn-export">Esporta ora</button>
        </div>
        <div class="backup-card">
          <div class="backup-card-title">Importa backup</div>
          <div class="backup-card-sub">Ripristina da un file esportato in precedenza. I record con lo stesso id verranno sovrascritti, gli altri aggiunti: nulla viene cancellato a priori.</div>
          <input type="file" accept="application/json" id="input-import" style="display:none">
          <button class="btn btn-ghost" id="btn-import">Scegli file…</button>
        </div>
      </div>
    </div>`;

  document.getElementById('btn-export').addEventListener('click', async () => {
    const data = await Store.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `vacation-builder-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  const fileInput = document.getElementById('input-import');
  document.getElementById('btn-import').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const text = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      await showModal({ title: 'File non valido', bodyHtml: 'Il file scelto non è un JSON leggibile.', confirmLabel: 'Ho capito' });
      return;
    }
    const ok = await showModal({
      title: 'Importare questo backup?',
      bodyHtml: 'I record con lo stesso id di quelli già presenti verranno sovrascritti con i valori del file.',
      confirmLabel: 'Importa',
      danger: true,
    });
    if (!ok) return;
    await Store.importAll(parsed);
    await showModal({ title: 'Importazione completata', bodyHtml: "L'archivio è stato aggiornato.", confirmLabel: 'Ok' });
    await renderCanvas();
  });
}

/* ---------------------------------------------------------------------- */
/* Azioni del canvas                                                       */
/* ---------------------------------------------------------------------- */

async function handleCanvasClick(e) {
  if (!e.target.closest('.timeline-gap')) {
    canvas.querySelectorAll('.timeline-gap.is-open').forEach((el) => el.classList.remove('is-open'));
  }

  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  const id = el.dataset.id;

  if (action === 'new-destinazione') {
    openDestinazioneForm();
  } else if (action === 'select-destinazione') {
    state.selectedDestinazioneId = id;
    state.activeTipoFilter = new Set();
    await renderCanvas();
  } else if (action === 'back-to-destinazioni') {
    state.selectedDestinazioneId = null;
    await renderCanvas();
  } else if (action === 'set-dest-view') {
    state.destinazioniListView = el.dataset.mode;
    await renderCanvas();
  } else if (action === 'new-vacanza') {
    openVacanzaForm();
  } else if (action === 'select-vacanza') {
    state.selectedVacanzaId = id;
    state.selectedGiornataId = null;
    await renderCanvas();
  } else if (action === 'back-to-vacanze') {
    state.selectedVacanzaId = null;
    state.selectedGiornataId = null;
    await renderCanvas();
  } else if (action === 'set-vac-view') {
    state.vacanzeListView = el.dataset.mode;
    await renderCanvas();
  } else if (action === 'edit-destinazione') {
    openDestinazioneForm(await repo.getDestinazione(state.selectedDestinazioneId));
  } else if (action === 'delete-destinazione') {
    await handleDeleteDestinazione(state.selectedDestinazioneId);
  } else if (action === 'new-tappa') {
    openTappaForm(null);
  } else if (action === 'edit-tappa') {
    openTappaForm(await repo.getTappa(id));
  } else if (action === 'delete-tappa') {
    e.stopPropagation();
    await handleDeleteTappa(id);
  } else if (action === 'edit-vacanza') {
    openVacanzaForm(await repo.getVacanza(state.selectedVacanzaId));
  } else if (action === 'delete-vacanza') {
    await handleDeleteVacanza(state.selectedVacanzaId);
  } else if (action === 'stampa-vacanza') {
    apriSelezioneStampa(state.selectedVacanzaId);
  } else if (action === 'set-vacanza-tab') {
    state.vacanzaTab = el.dataset.tab;
    await renderCanvas();
  } else if (action === 'new-spesa') {
    await openSpesaForm(await repo.getVacanza(state.selectedVacanzaId));
  } else if (action === 'edit-spesa') {
    const vacanza = await repo.getVacanza(state.selectedVacanzaId);
    await openSpesaForm(vacanza, await repo.getSpesa(id));
  } else if (action === 'delete-spesa') {
    e.stopPropagation();
    const ok = await showModal({ title: 'Eliminare questa spesa?', confirmLabel: 'Elimina', danger: true });
    if (!ok) return;
    await repo.deleteSpesa(id);
    await renderCanvas();
  } else if (action === 'set-lista-giorno') {
    state.listaGiornoSelezionato = el.dataset.giornoId || null;
    await renderCanvas();
  } else if (action === 'new-lista-voce') {
    await openListaVoceForm(state.selectedVacanzaId, state.listaGiornoSelezionato);
  } else if (action === 'edit-lista-voce') {
    await openListaVoceForm(state.selectedVacanzaId, state.listaGiornoSelezionato, await repo.getListaVoce(id));
  } else if (action === 'delete-lista-voce') {
    e.stopPropagation();
    const ok = await showModal({ title: 'Eliminare questa voce?', confirmLabel: 'Elimina', danger: true });
    if (!ok) return;
    await repo.deleteListaVoce(id);
    await renderCanvas();
  } else if (action === 'toggle-lista-voce') {
    e.stopPropagation();
    await repo.toggleListaVoceFatto(id);
    await renderCanvas();
  } else if (action === 'select-giorno') {
    state.selectedGiornataId = id;
    await renderCanvas();
  } else if (action === 'add-giorno') {
    await openAddGiornoForm(await repo.getVacanza(state.selectedVacanzaId));
  } else if (action === 'delete-giorno') {
    e.stopPropagation();
    await handleDeleteGiorno(id);
  } else if (action === 'change-giorno-destinazione') {
    await openChangeGiornoDestinazioneForm(id);
  } else if (action === 'toggle-gap') {
    const gapEl = el.closest('.timeline-gap');
    const wasOpen = gapEl.classList.contains('is-open');
    canvas.querySelectorAll('.timeline-gap.is-open').forEach((g) => g.classList.remove('is-open'));
    if (!wasOpen) gapEl.classList.add('is-open');
  } else if (action === 'insert-voce') {
    canvas.querySelectorAll('.timeline-gap.is-open').forEach((g) => g.classList.remove('is-open'));
    const atIndex = Number(el.dataset.gapIndex);
    const tipoVoce = el.dataset.voceTipo;
    const giornata = await repo.getGiornata(state.selectedGiornataId);
    const vacanza = await repo.getVacanza(state.selectedVacanzaId);
    if (tipoVoce === 'tappa') await openVoceTappaForm(giornata, null, atIndex);
    else if (tipoVoce === 'partenza') await openVocePartenzaRientroForm(giornata, vacanza, 'partenza', null, atIndex);
    else if (tipoVoce === 'rientro') await openVocePartenzaRientroForm(giornata, vacanza, 'rientro', null, atIndex);
    else if (tipoVoce === 'spostamento') await openVoceSpostamentoForm(giornata, vacanza, null, atIndex);
  } else if (action === 'open-tappa-scheda') {
    await openTappaForm(await repo.getTappa(id));
  } else if (action === 'edit-voce') {
    const voce = await repo.getVoce(id);
    const giornata = await repo.getGiornata(voce.giornataId);
    const vacanza = await repo.getVacanza(giornata.vacanzaId);
    if (voce.tipoVoce === 'partenza' || voce.tipoVoce === 'rientro') await openVocePartenzaRientroForm(giornata, vacanza, voce.tipoVoce, voce);
    else if (voce.tipoVoce === 'spostamento') await openVoceSpostamentoForm(giornata, vacanza, voce);
    else await openVoceTappaForm(giornata, voce);
  } else if (action === 'delete-voce') {
    e.stopPropagation();
    const usage = await repo.checkVoceSpesaUsage(id);
    if (usage.count > 0) {
      const ok = await showModal({
        title: 'Questa voce ha una spesa collegata',
        bodyHtml: `Eliminandola sparirà anche la spesa "${escapeHtml(usage.spese[0].descrizione)}" dal Budget.`,
        confirmLabel: 'Elimina comunque',
        danger: true,
      });
      if (!ok) return;
    }
    await repo.deleteVoce(id);
    await renderCanvas();
  } else if (action === 'set-alloggio-vacanza') {
    await openSetAlloggioVacanzaForm(await repo.getVacanza(state.selectedVacanzaId));
  } else if (action === 'add-alloggio-pool') {
    await openAddAlloggioPoolForm(await repo.getVacanza(state.selectedVacanzaId));
  } else if (action === 'remove-alloggio-pool') {
    await repo.removeAlloggioFromVacanza(state.selectedVacanzaId, id);
    await renderCanvas();
  } else if (action === 'set-alloggio-giorno') {
    await openSetAlloggioGiornoForm(id, await repo.getVacanza(state.selectedVacanzaId));
  } else if (action === 'vai-a-destinazione') {
    state.view = 'destinazioni';
    state.selectedDestinazioneId = id;
    state.activeTipoFilter = new Set();
    renderRailNav();
    await renderCanvas();
  } else if (action === 'set-impostazioni-tab') {
    state.impostazioniTab = el.dataset.tab;
    await renderCanvas();
  } else if (action === 'new-tipo-tappa') {
    openTipoTappaForm();
  } else if (action === 'edit-tipo') {
    openTipoTappaForm(await repo.getTipoTappa(id));
  } else if (action === 'delete-tipo') {
    e.stopPropagation();
    await handleDeleteTipoTappa(id);
  } else if (action === 'new-categoria-dest') {
    openCategoriaDestinazioneForm();
  } else if (action === 'edit-categoria-dest') {
    openCategoriaDestinazioneForm(await repo.getCategoriaDestinazione(id));
  } else if (action === 'delete-categoria-dest') {
    e.stopPropagation();
    await handleDeleteCategoriaDestinazione(id);
  } else if (action === 'new-categoria-spesa') {
    openCategoriaSpesaForm();
  } else if (action === 'edit-categoria-spesa') {
    openCategoriaSpesaForm(await repo.getCategoriaSpesa(id));
  } else if (action === 'delete-categoria-spesa') {
    e.stopPropagation();
    await handleDeleteCategoriaSpesa(id);
  }
}

/* ---------------------------------------------------------------------- */
/* Cancellazioni con avviso di utilizzo                                    */
/* ---------------------------------------------------------------------- */

async function handleDeleteDestinazione(id) {
  const dest = await repo.getDestinazione(id);
  const usage = await repo.checkDestinazioneUsage(id);
  let bodyHtml = `Questa destinazione verrà rimossa definitivamente dall'archivio.`;
  if (usage.tappeCount > 0 || usage.giornateCount > 0 || usage.vacanzeCoinvolte.length > 0) {
    bodyHtml += `<div class="modal-usage-list">
      Contiene <strong>${usage.tappeCount}</strong> tapp${usage.tappeCount === 1 ? 'a' : 'e'}${
      usage.giornateCount ? `, usata in <strong>${usage.giornateCount}</strong> giornat${usage.giornateCount === 1 ? 'a' : 'e'} pianificat${usage.giornateCount === 1 ? 'a' : 'e'}` : ''
    }.
      ${
        usage.vacanzeCoinvolte.length
          ? `Vacanze coinvolte:<ul>${usage.vacanzeCoinvolte
              .map((v) => `<li>${escapeHtml(v.nome)} — ${v.tipo === 'fissa' ? 'verrà eliminata interamente, essendo basata su questa destinazione' : 'ne verranno rimosse le giornate ambientate qui'}</li>`)
              .join('')}</ul>`
          : ''
      }
    </div>`;
  }
  const ok = await showModal({ title: `Eliminare "${dest.nome}"?`, bodyHtml, confirmLabel: 'Elimina definitivamente', danger: true });
  if (!ok) return;
  await repo.deleteDestinazioneCascade(id);
  if (state.selectedDestinazioneId === id) state.selectedDestinazioneId = null;
  await renderCanvas();
}

async function handleDeleteTappa(id) {
  const tappa = await repo.getTappa(id);
  const usage = await repo.checkTappaUsage(id);
  let bodyHtml = `Questa tappa verrà rimossa definitivamente.`;
  if (usage.pianificateCount > 0) {
    bodyHtml += `<div class="modal-usage-list">
      Questa tappa è usata in <strong>${usage.pianificateCount}</strong> pianificazion${usage.pianificateCount === 1 ? 'e' : 'i'}
      ${usage.vacanzeCoinvolte.length ? `, nelle vacanze:<ul>${usage.vacanzeCoinvolte.map((v) => `<li>${escapeHtml(v.nome)}</li>`).join('')}</ul>` : '.'}
      Verranno rimosse anche quelle.
    </div>`;
  }
  const ok = await showModal({ title: `Eliminare "${tappa.nome}"?`, bodyHtml, confirmLabel: 'Elimina definitivamente', danger: true });
  if (!ok) return;
  await repo.deleteTappaCascade(id);
  await renderCanvas();
}

async function handleDeleteVacanza(id) {
  const v = await repo.getVacanza(id);
  const giornate = await repo.listGiornateByVacanza(id);
  const ok = await showModal({
    title: `Eliminare "${v.nome}"?`,
    bodyHtml: `Verranno eliminate anche le ${giornate.length} giornat${giornate.length === 1 ? 'a' : 'e'} e tutte le tappe pianificate al suo interno.`,
    confirmLabel: 'Elimina definitivamente',
    danger: true,
  });
  if (!ok) return;
  await repo.deleteVacanza(id);
  state.selectedVacanzaId = null;
  state.selectedGiornataId = null;
  await renderCanvas();
}

/** Costruisce la vista stampabile (recap + programma giorno per giorno) e apre la finestra di
 * stampa del browser: da lì si sceglie "Salva come PDF" (o si stampa davvero). Nessuna libreria
 * PDF: sfrutta il motore di stampa del browser stesso, più affidabile e già installato ovunque. */
/** Piccola scelta prima di stampare: a volte serve solo il programma, altre volte solo il
 * Budget o solo la Lista, altre volte tutto — invece di deciderlo per te, te lo chiedo ogni volta. */
function apriSelezioneStampa(vacanzaId) {
  openInspector(
    'Cosa vuoi stampare?',
    `<form id="form-stampa-selezione">
      <div class="field">
        <label class="chip-checkbox"><input type="checkbox" name="programma" checked><span>Programma giorno per giorno</span></label>
      </div>
      <div class="field">
        <label class="chip-checkbox"><input type="checkbox" name="budget"><span>Budget</span></label>
      </div>
      <div class="field">
        <label class="chip-checkbox"><input type="checkbox" name="lista"><span>Lista (valigia + giorni)</span></label>
      </div>
      <div class="inspector-footer">
        <button type="submit" class="btn btn-primary">Genera anteprima di stampa</button>
        <button type="button" class="btn btn-ghost" data-role="close-inspector">Annulla</button>
      </div>
    </form>`
  );

  document.getElementById('form-stampa-selezione').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const sezioni = {
      programma: fd.get('programma') === 'on',
      budget: fd.get('budget') === 'on',
      lista: fd.get('lista') === 'on',
    };
    if (!sezioni.programma && !sezioni.budget && !sezioni.lista) {
      await showModal({ title: 'Scegli almeno una sezione', confirmLabel: 'Ho capito' });
      return;
    }
    closeInspector();
    await stampaVacanza(vacanzaId, sezioni);
  });
}

async function stampaVacanza(vacanzaId, sezioni = { programma: true, budget: false, lista: false }) {
  const vacanza = await repo.getVacanza(vacanzaId);
  const giornate = await repo.listGiornateByVacanza(vacanzaId);

  let corpoHtml = '';

  if (sezioni.programma) {
    const tipiList = await repo.listTipiTappa();
    const tipiById = Object.fromEntries(tipiList.map((t) => [t.id, t]));

    async function nomeDestinazione(id) {
      if (!id) return null;
      const d = await repo.getDestinazione(id);
      return d ? d.nome : null;
    }
    async function nomeTappa(id) {
      if (!id) return null;
      const t = await repo.getTappa(id);
      return t ? t.nome : null;
    }

    let recapHtml;
    if (vacanza.tipo === 'fissa') {
      const nome = await nomeDestinazione(vacanza.destinazionePrincipaleId);
      const alloggio = await nomeTappa(vacanza.alloggioId);
      recapHtml = `
        <div><strong>Destinazione:</strong> ${escapeHtml(nome || '—')}</div>
        ${alloggio ? `<div><strong>Alloggio:</strong> ${escapeHtml(alloggio)}</div>` : ''}
        <div><strong>Durata:</strong> ${giornate.length} giorn${giornate.length === 1 ? 'o' : 'i'}</div>`;
    } else {
      const destIds = [...new Set(giornate.map((g) => g.destinazioneId).filter(Boolean))];
      const nomiDest = (await Promise.all(destIds.map(nomeDestinazione))).filter(Boolean);
      const nomiAlloggi = (await Promise.all((vacanza.alloggiIds || []).map(nomeTappa))).filter(Boolean);
      recapHtml = `
        <div><strong>Itinerario:</strong> ${escapeHtml(nomiDest.join(' → ') || '—')}</div>
        ${nomiAlloggi.length ? `<div><strong>Alloggi:</strong> ${escapeHtml(nomiAlloggi.join(', '))}</div>` : ''}
        <div><strong>Durata:</strong> ${giornate.length} giorn${giornate.length === 1 ? 'o' : 'i'}</div>`;
    }

    const giorniHtml = [];
    for (let i = 0; i < giornate.length; i++) {
      const g = giornate[i];
      const voci = computeOrariVoci(await repo.listVociByGiornata(g.id));
      const nomeDest = await nomeDestinazione(g.destinazioneId);
      const vociHtml = await Promise.all(voci.map((v) => printVoceHtml(v, tipiById, nomeTappa)));
      giorniHtml.push(`
        <div class="print-giorno">
          <div class="print-giorno-titolo">Giorno ${i + 1}${g.data ? ` — ${formatDate(g.data)}` : ''}${nomeDest ? ` · ${escapeHtml(nomeDest)}` : ''}</div>
          ${vociHtml.length ? vociHtml.join('') : '<div class="print-voce-meta">Nessuna voce pianificata.</div>'}
        </div>`);
    }

    corpoHtml += `<div class="print-recap">${recapHtml}</div>${giorniHtml.join('')}`;
  }

  if (sezioni.budget) {
    corpoHtml += await printBudgetHtml(vacanza);
  }

  if (sezioni.lista) {
    corpoHtml += await printListaHtml(vacanza, giornate);
  }

  document.getElementById('print-area').innerHTML = `
    <div class="print-page">
      <div class="print-title">${escapeHtml(vacanza.nome)}</div>
      <span class="print-badge">${vacanza.tipo === 'fissa' ? 'Un luogo' : 'Itinerante'}</span>
      ${vacanza.dataInizio ? `<div class="print-voce-meta">${formatDate(vacanza.dataInizio)} → ${vacanza.dataFine ? formatDate(vacanza.dataFine) : '?'}</div>` : ''}
      ${corpoHtml}
      <div class="print-footer">Generato da Vacation Builder — ${new Date().toLocaleDateString('it-IT')}</div>
    </div>`;

  window.print();
}

async function printBudgetHtml(vacanza) {
  const spese = await repo.listSpeseByVacanza(vacanza.id);
  const categorie = await repo.listCategorieSpesa();
  const categorieById = Object.fromEntries(categorie.map((c) => [c.id, c]));
  const riepilogo = await repo.getRiepilogoBudget(vacanza.id);
  const listaConCosto = (await repo.listListaVociByVacanza(vacanza.id)).filter((v) => v.modalita && v.contaNelTotale !== false);

  const righeSpese = spese.map((s) => {
    const importo = repo.calcolaImportoRecord(s, vacanza);
    const cat = s.categoriaId ? categorieById[s.categoriaId] : null;
    const isCondivisa = repo.isRecordCondiviso(s, vacanza);
    return `<div class="print-voce">
      <div class="print-voce-corpo">
        <div class="print-voce-titolo">${escapeHtml(s.descrizione)}${cat ? ` · ${escapeHtml(cat.nome)}` : ''}</div>
        <div class="print-voce-meta">${isCondivisa ? 'Condivisa' : 'Extra'}</div>
      </div>
      <div class="print-voce-ora">${importo.toFixed(2)}€</div>
    </div>`;
  });

  const righeLista = listaConCosto.map((v) => {
    const importo = repo.calcolaImportoRecord(v, vacanza);
    const isCondivisa = repo.isRecordCondiviso(v, vacanza);
    return `<div class="print-voce">
      <div class="print-voce-corpo">
        <div class="print-voce-titolo">${escapeHtml(v.testo)}</div>
        <div class="print-voce-meta">da Lista · ${isCondivisa ? 'Condivisa' : 'Extra'}</div>
      </div>
      <div class="print-voce-ora">${importo.toFixed(2)}€</div>
    </div>`;
  });

  const righe = [...righeSpese, ...righeLista];

  return `
    <div class="print-giorno">
      <div class="print-giorno-titolo">Budget</div>
      ${righe.length ? righe.join('') : '<div class="print-voce-meta">Nessuna spesa registrata.</div>'}
      <div class="print-recap">
        <div><strong>Totale condiviso</strong> (÷ ${riepilogo.numeroPersone}): ${riepilogo.totaleCondiviso.toFixed(2)}€ — ${riepilogo.totaleAPersona ?? '—'}€ a persona</div>
        <div><strong>Extra:</strong> ${riepilogo.totaleExtra.toFixed(2)}€</div>
        <div><strong>Totale generale:</strong> ${riepilogo.totaleGenerale.toFixed(2)}€</div>
      </div>
    </div>`;
}

async function printListaHtml(vacanza, giornate) {
  const generale = await repo.listListaVociGenerale(vacanza.id);
  const sezioniLista = [{ titolo: 'Lista generale (valigia)', voci: generale }];
  for (let i = 0; i < giornate.length; i++) {
    const voci = await repo.listListaVociGiorno(giornate[i].id);
    if (voci.length) sezioniLista.push({ titolo: `Lista Giorno ${i + 1}`, voci });
  }

  const haCostiChContano = sezioniLista.some((sez) => sez.voci.some((v) => v.modalita && v.contaNelTotale !== false));
  const notaCosti = haCostiChContano
    ? `<div class="print-recap"><em>I prezzi indicati qui sono già inclusi nel totale del Budget: non sommarli di nuovo.</em></div>`
    : '';

  const sezioniHtml = sezioniLista
    .map((sez) => {
      const righeVoci = sez.voci.map((v) => {
        const importo = v.modalita ? repo.calcolaImportoRecord(v, vacanza) : null;
        return `<div class="print-voce">
          <div class="print-voce-corpo">
            <div class="print-voce-titolo">${v.fatto ? '☑' : '☐'} ${escapeHtml(v.testo)}</div>
          </div>
          ${importo != null ? `<div class="print-voce-ora">${importo.toFixed(2)}€</div>` : ''}
        </div>`;
      });
      return `
        <div class="print-giorno">
          <div class="print-giorno-titolo">${escapeHtml(sez.titolo)}</div>
          ${righeVoci.length ? righeVoci.join('') : '<div class="print-voce-meta">Nessuna voce.</div>'}
        </div>`;
    })
    .join('');

  return notaCosti + sezioniHtml;
}

async function printVoceHtml(voce, tipiById, nomeTappa) {
  const ora = formatOrarioStampa(voce._inizio, voce._fine);

  if (voce.tipoVoce === 'partenza' || voce.tipoVoce === 'rientro') {
    const isPartenza = voce.tipoVoce === 'partenza';
    const nome = await nomeTappa(isPartenza ? voce.daRifTappaId : voce.aRifTappaId);
    return `<div class="print-voce">
      <div class="print-voce-ora">${ora}</div>
      <div class="print-voce-corpo">
        <div class="print-voce-titolo">${isPartenza ? 'Partenza' : 'Rientro'}${nome ? ` — ${escapeHtml(nome)}` : ''}</div>
        ${voce.note ? `<div class="print-voce-note">${escapeHtml(voce.note)}</div>` : ''}
      </div>
    </div>`;
  }

  if (voce.tipoVoce === 'spostamento') {
    const daNome = await nomeTappa(voce.daRifTappaId);
    const aNome = await nomeTappa(voce.aRifTappaId);
    const percorso = daNome || aNome ? `${daNome || '?'} → ${aNome || '?'}` : '';
    const distanza = voce.distanzaRealeKm != null ? ` · ${voce.distanzaRealeKm.toFixed(1)} km` : '';
    return `<div class="print-voce">
      <div class="print-voce-ora">${ora}</div>
      <div class="print-voce-corpo">
        <div class="print-voce-titolo">Spostamento (${escapeHtml(mezzoLabel(voce.mezzo))})</div>
        ${percorso ? `<div class="print-voce-meta">${escapeHtml(percorso)}${distanza}</div>` : ''}
        ${voce.note ? `<div class="print-voce-note">${escapeHtml(voce.note)}</div>` : ''}
      </div>
    </div>`;
  }

  // tipoVoce === 'tappa'
  const tappa = voce.tappaId ? await repo.getTappa(voce.tappaId) : null;
  const tipo = tappa ? tipiById[(tappa.tipi || [])[0]] : null;
  return `<div class="print-voce">
    <div class="print-voce-ora">${ora}</div>
    <div class="print-voce-corpo">
      <div class="print-voce-titolo">${escapeHtml(tappa ? tappa.nome : 'Tappa eliminata')}</div>
      ${tipo ? `<div class="print-voce-meta">${escapeHtml(tipo.nome)}</div>` : ''}
      ${voce.note ? `<div class="print-voce-note">${escapeHtml(voce.note)}</div>` : ''}
    </div>
  </div>`;
}

function formatOrarioStampa(inizio, fine) {
  if (inizio == null) return '?';
  if (fine == null || fine === inizio) return minutesToTime(inizio);
  return `${minutesToTime(inizio)}–${minutesToTime(fine)}`;
}

async function handleDeleteGiorno(id) {
  const voci = await repo.listVociByGiornata(id);
  const ok = await showModal({
    title: 'Eliminare questo giorno?',
    bodyHtml: voci.length ? `Verranno rimosse anche le ${voci.length} voci pianificate al suo interno (tappe, partenze, rientri, spostamenti).` : 'Il giorno non ha ancora voci pianificate.',
    confirmLabel: 'Elimina giorno',
    danger: true,
  });
  if (!ok) return;
  await repo.deleteGiornata(id);
  if (state.selectedGiornataId === id) state.selectedGiornataId = null;
  await renderCanvas();
}

async function handleDeleteTipoTappa(id) {
  const tipo = await repo.getTipoTappa(id);
  const usage = await repo.checkTipoTappaUsage(id);
  if (usage.count > 0) {
    await showModal({
      title: 'Tipo ancora in uso',
      bodyHtml: `"${escapeHtml(tipo.nome)}" è usato da <strong>${usage.count}</strong> tapp${usage.count === 1 ? 'a' : 'e'}. Riassegnale a un altro tipo prima di eliminarlo, oppure rinomina questo tipo invece di cancellarlo.`,
      confirmLabel: 'Ho capito',
    });
    return;
  }
  const ok = await showModal({ title: `Eliminare il tipo "${tipo.nome}"?`, bodyHtml: 'Nessuna tappa lo sta usando: può essere rimosso senza conseguenze.', confirmLabel: 'Elimina', danger: true });
  if (!ok) return;
  await repo.deleteTipoTappa(id);
  await renderCanvas();
}

async function handleDeleteCategoriaDestinazione(id) {
  const categoria = await repo.getCategoriaDestinazione(id);
  const usage = await repo.checkCategoriaDestinazioneUsage(id);
  if (usage.count > 0) {
    await showModal({
      title: 'Categoria ancora in uso',
      bodyHtml: `"${escapeHtml(categoria.nome)}" è assegnata a <strong>${usage.count}</strong> destinazion${usage.count === 1 ? 'e' : 'i'}. Rimuovila da lì prima di eliminarla, oppure rinomina questa categoria invece di cancellarla.`,
      confirmLabel: 'Ho capito',
    });
    return;
  }
  const ok = await showModal({ title: `Eliminare la categoria "${categoria.nome}"?`, bodyHtml: 'Nessuna destinazione la sta usando: può essere rimossa senza conseguenze.', confirmLabel: 'Elimina', danger: true });
  if (!ok) return;
  await repo.deleteCategoriaDestinazione(id);
  await renderCanvas();
}

async function handleDeleteCategoriaSpesa(id) {
  const categoria = await repo.getCategoriaSpesa(id);
  const usage = await repo.checkCategoriaSpesaUsage(id);
  if (usage.count > 0) {
    await showModal({
      title: 'Categoria ancora in uso',
      bodyHtml: `"${escapeHtml(categoria.nome)}" è assegnata a <strong>${usage.count}</strong> spes${usage.count === 1 ? 'a' : 'e'}. Riassegnale prima di eliminarla, oppure rinomina questa categoria invece di cancellarla.`,
      confirmLabel: 'Ho capito',
    });
    return;
  }
  const ok = await showModal({ title: `Eliminare la categoria "${categoria.nome}"?`, bodyHtml: 'Nessuna spesa la sta usando: può essere rimossa senza conseguenze.', confirmLabel: 'Elimina', danger: true });
  if (!ok) return;
  await repo.deleteCategoriaSpesa(id);
  await renderCanvas();
}

/* ---------------------------------------------------------------------- */
/* Inspector — apertura/chiusura                                           */
/* ---------------------------------------------------------------------- */

function openInspector(title, bodyHtml) {
  inspectorInner.innerHTML = `
    <div class="inspector-header">
      <div class="inspector-title">${escapeHtml(title)}</div>
      <button class="inspector-close" data-role="close-inspector"><i class="fa-solid fa-xmark"></i></button>
    </div>
    ${bodyHtml}`;
  inspector.classList.add('is-open');
  inspector.setAttribute('aria-hidden', 'false');
  inspectorScrim.classList.add('is-open');
}

function closeInspector() {
  inspector.classList.remove('is-open');
  inspector.setAttribute('aria-hidden', 'true');
  inspectorScrim.classList.remove('is-open');
}

/** Collega un input coordinate a un div-hint che mostra l'esito del parsing in tempo reale. */
function bindCoordinateHint(inputEl, hintEl) {
  const update = () => {
    const raw = inputEl.value;
    if (!raw.trim()) {
      hintEl.textContent = 'Incolla "lat, lng" da Google Maps (facoltativo)';
      hintEl.className = 'coord-hint';
      return;
    }
    const parsed = parseCoordinateInput(raw);
    if (parsed) {
      hintEl.innerHTML = `<i class="fa-solid fa-check"></i> Riconosciute: ${formatCoordinate(parsed)}`;
      hintEl.className = 'coord-hint is-valid';
    } else {
      hintEl.innerHTML = '<i class="fa-solid fa-xmark"></i> Formato non riconosciuto: usa "lat, lng"';
      hintEl.className = 'coord-hint is-invalid';
    }
  };
  inputEl.addEventListener('input', update);
  update();
}

/**
 * Mostra il punto su Google Maps SOLO quando l'utente clicca il bottone: nessun caricamento
 * automatico all'apertura della scheda, per non consumare inutilmente chiamate. Usa l'iframe
 * pubblico "google.com/maps?...&output=embed", che non richiede una API key né una fatturazione
 * Google Cloud (a differenza della Maps Embed API "ufficiale").
 */
function bindMapButton(btnEl, coordInputEl, containerEl) {
  const mapDivId = `${containerEl.id}-leaflet`;
  const defaultLabel = btnEl.textContent;
  btnEl.addEventListener('click', async () => {
    if (containerEl.dataset.mapOpen === 'true') {
      containerEl.innerHTML = '';
      containerEl.dataset.mapOpen = 'false';
      btnEl.textContent = defaultLabel;
      return;
    }
    const parsed = parseCoordinateInput(coordInputEl.value);
    if (!parsed) {
      containerEl.innerHTML = `<div class="map-hint">Inserisci prima delle coordinate valide qui sopra.</div>`;
      return;
    }
    btnEl.disabled = true;
    btnEl.textContent = 'Carico la mappa…';
    try {
      await loadLeaflet();
      containerEl.innerHTML = `<div id="${mapDivId}" class="point-leaflet-map"></div>`;
      const map = L.map(mapDivId).setView([parsed.lat, parsed.lng], 15);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 18,
      }).addTo(map);
      L.marker([parsed.lat, parsed.lng]).addTo(map);
      containerEl.dataset.mapOpen = 'true';
      btnEl.textContent = 'Nascondi mappa';
    } catch {
      containerEl.innerHTML = `<div class="map-hint">Mappa non disponibile: serve una connessione internet per caricarla la prima volta.</div>`;
      btnEl.textContent = defaultLabel;
    } finally {
      btnEl.disabled = false;
    }
  });
}

/**
 * Galleria foto di un form: `images` è l'array (già presente nel record, o vuoto per una
 * nuova entità) mutato direttamente qui — il form lo legge così com'è al momento del submit,
 * senza bisogno di campi hidden da tenere sincronizzati. La prima foto è la copertina.
 */
function mountPhotoGallery(containerId, images) {
  const container = document.getElementById(containerId);

  function render() {
    container.innerHTML = `
      <div class="photo-gallery">
        ${images
          .map(
            (src, i) => `<div class="photo-thumb ${i === 0 ? 'is-cover' : ''}">
              <img src="${src}" alt="">
              <button type="button" class="photo-remove" data-photo-index="${i}" title="Rimuovi foto"><i class="fa-solid fa-xmark"></i></button>
              ${i === 0 ? '<span class="photo-cover-badge">copertina</span>' : ''}
            </div>`
          )
          .join('')}
        <label class="photo-add-btn">
          + Foto
          <input type="file" accept="image/*" multiple style="display:none">
        </label>
      </div>`;

    container.querySelectorAll('.photo-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        images.splice(Number(btn.dataset.photoIndex), 1);
        render();
      });
    });

    const fileInput = container.querySelector('input[type=file]');
    fileInput.addEventListener('change', async () => {
      const files = [...fileInput.files];
      for (const file of files) {
        try {
          const dataUrl = await resizeImageFile(file);
          images.push(dataUrl);
        } catch {
          // file non leggibile come immagine: lo ignoriamo silenziosamente
        }
      }
      render();
    });
  }

  render();
}

/* ---------------------------------------------------------------------- */
/* Form: Destinazione                                                      */
/* ---------------------------------------------------------------------- */

async function openDestinazioneForm(dest = null) {
  const isEdit = !!dest;
  const categorie = await repo.listCategorieDestinazione();
  const currentImages = isEdit ? [...(dest.immagini || [])] : [];

  openInspector(
    isEdit ? 'Modifica destinazione' : 'Nuova destinazione',
    `<form id="form-destinazione">
      <div class="field">
        <label class="field-label">Nome</label>
        <input type="text" name="nome" required value="${isEdit ? escapeHtml(dest.nome) : ''}" placeholder="Es. Vicenza Centro" autofocus>
      </div>
      <div class="field-row">
        <div class="field"><label class="field-label">Stato</label><input type="text" name="stato" value="${isEdit ? escapeHtml(dest.stato || '') : ''}" placeholder="Es. Italia"></div>
        <div class="field"><label class="field-label">Regione</label><input type="text" name="regione" value="${isEdit ? escapeHtml(dest.regione || '') : ''}" placeholder="Es. Veneto"></div>
      </div>
      <div class="field"><label class="field-label">Provincia</label><input type="text" name="provincia" value="${isEdit ? escapeHtml(dest.provincia || '') : ''}" placeholder="Es. Vicenza"></div>
      <div class="field">
        <label class="field-label">Categorie</label>
        <div id="form-dest-categorie">${chipCheckboxesHtml(categorie, isEdit ? dest.categorieIds || [] : [], 'fdc')}</div>
      </div>
      <div class="field">
        <label class="field-label">Coordinate</label>
        <input type="text" name="coordinateRaw" id="coord-input-dest" value="${isEdit && dest.coordinate ? formatCoordinate(dest.coordinate) : ''}" placeholder="45.577315815180725, 11.351812970491833">
      </div>
      <div class="coord-hint" id="coord-hint-dest"></div>
      <div class="field">
        <button type="button" class="btn btn-sm btn-ghost" id="btn-show-map-dest">Mostra su mappa</button>
        <div id="map-container-dest"></div>
      </div>
      <div class="field">
        <label class="field-label">Foto</label>
        <div id="gallery-dest"></div>
      </div>
      <div class="field">
        <label class="field-label">Note</label>
        <textarea name="note" placeholder="Zona, atmosfera, appunti liberi...">${isEdit ? escapeHtml(dest.note) : ''}</textarea>
      </div>
      <div class="inspector-footer">
        <button type="submit" class="btn btn-primary">${isEdit ? 'Salva modifiche' : 'Crea destinazione'}</button>
        <button type="button" class="btn btn-ghost" data-role="close-inspector">Annulla</button>
      </div>
    </form>`
  );

  bindCoordinateHint(document.getElementById('coord-input-dest'), document.getElementById('coord-hint-dest'));
  bindMapButton(document.getElementById('btn-show-map-dest'), document.getElementById('coord-input-dest'), document.getElementById('map-container-dest'));
  mountPhotoGallery('gallery-dest', currentImages);

  document.getElementById('form-destinazione').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const nome = (fd.get('nome') || '').trim();
    if (!nome) return;
    const categorieIds = [...document.querySelectorAll('#form-dest-categorie input:checked')].map((i) => i.value);
    const payload = {
      nome,
      note: fd.get('note') || '',
      stato: fd.get('stato') || '',
      regione: fd.get('regione') || '',
      provincia: fd.get('provincia') || '',
      coordinateRaw: fd.get('coordinateRaw') || '',
      categorieIds,
      immagini: currentImages,
    };
    if (isEdit) await repo.updateDestinazione(dest.id, payload);
    else {
      const created = await repo.createDestinazione(payload);
      state.selectedDestinazioneId = created.id;
    }
    closeInspector();
    await renderCanvas();
  });
}

/* ---------------------------------------------------------------------- */
/* Form: Tappa                                                             */
/* ---------------------------------------------------------------------- */

async function openTappaForm(tappa = null) {
  const isEdit = !!tappa;
  const destinazioneId = isEdit ? tappa.destinazioneId : state.selectedDestinazioneId;
  const tipiList = await repo.listTipiTappa();
  if (!tipiList.length) {
    await showModal({ title: 'Nessun tipo disponibile', bodyHtml: 'Crea prima almeno un tipo di tappa da Impostazioni.', confirmLabel: 'Ho capito' });
    return;
  }
  let selectedTipi = isEdit ? [...(tappa.tipi || [])] : tipiList.length ? [tipiList[0].id] : [];
  const currentImages = isEdit ? [...(tappa.immagini || [])] : [];

  function tipoPickerHtml() {
    return tipiList
      .map((t) => {
        const idx = selectedTipi.indexOf(t.id);
        const isSelected = idx !== -1;
        const isPrimary = idx === 0;
        return `<button type="button" class="tipo-picker-btn ${isSelected ? 'is-selected' : ''}" data-tipo="${t.id}">${escapeHtml(t.nome)}${isPrimary ? ' · principale' : ''}</button>`;
      })
      .join('');
  }

  openInspector(
    isEdit ? 'Modifica tappa' : 'Nuova tappa',
    `<form id="form-tappa">
      <div class="field">
        <label class="field-label">Nome</label>
        <input type="text" name="nome" required value="${isEdit ? escapeHtml(tappa.nome) : ''}" placeholder="Es. Basilica Palladiana" autofocus>
      </div>
      <div class="field">
        <label class="field-label">Tipo (puoi sceglierne più di uno, es. un rifugio è Ristoro e Alloggio)</label>
        <div class="tipo-picker" id="tipo-picker">${tipoPickerHtml()}</div>
        <div class="hint">Il primo che selezioni è il tipo principale: decide dove compare la tappa nella pagina della destinazione. Gli altri restano come etichette secondarie sulla card. Clicca di nuovo un tipo per toglierlo.</div>
      </div>
      <div class="field">
        <label class="field-label">Durata consigliata in minuti (opzionale)</label>
        <input type="number" name="durata" min="0" step="1" value="${isEdit && tappa.durataConsigliataMin ? tappa.durataConsigliataMin : ''}" placeholder="Es. 90">
      </div>
      <div class="field">
        <label class="field-label">Coordinate</label>
        <input type="text" name="coordinateRaw" id="coord-input-tappa" value="${isEdit && tappa.coordinate ? formatCoordinate(tappa.coordinate) : ''}" placeholder="45.577315815180725, 11.351812970491833">
      </div>
      <div class="coord-hint" id="coord-hint-tappa"></div>
      <div class="field">
        <button type="button" class="btn btn-sm btn-ghost" id="btn-show-map">Mostra su mappa</button>
        <div id="map-container-tappa"></div>
      </div>
      <div class="field">
        <label class="field-label">Foto</label>
        <div id="gallery-tappa"></div>
      </div>
      <div class="field">
        <label class="field-label">Note</label>
        <textarea name="note" placeholder="Orari, consigli, dettagli pratici...">${isEdit ? escapeHtml(tappa.note) : ''}</textarea>
      </div>
      <div class="inspector-footer">
        <button type="submit" class="btn btn-primary">${isEdit ? 'Salva modifiche' : 'Crea tappa'}</button>
        <button type="button" class="btn btn-ghost" data-role="close-inspector">Annulla</button>
      </div>
    </form>`
  );

  bindCoordinateHint(document.getElementById('coord-input-tappa'), document.getElementById('coord-hint-tappa'));
  bindMapButton(document.getElementById('btn-show-map'), document.getElementById('coord-input-tappa'), document.getElementById('map-container-tappa'));
  mountPhotoGallery('gallery-tappa', currentImages);

  const picker = document.getElementById('tipo-picker');
  picker.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tipo]');
    if (!btn) return;
    const id = btn.dataset.tipo;
    const idx = selectedTipi.indexOf(id);
    if (idx === -1) selectedTipi.push(id);
    else selectedTipi.splice(idx, 1);
    picker.innerHTML = tipoPickerHtml();
  });

  document.getElementById('form-tappa').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const nome = (fd.get('nome') || '').trim();
    if (!nome) return;
    if (!selectedTipi.length) {
      await showModal({ title: 'Manca il tipo', bodyHtml: 'Scegli almeno un tipo per questa tappa.', confirmLabel: 'Ho capito' });
      return;
    }
    const payload = {
      nome,
      tipi: selectedTipi,
      note: fd.get('note') || '',
      durataConsigliataMin: fd.get('durata') ? Number(fd.get('durata')) : null,
      coordinateRaw: fd.get('coordinateRaw') || '',
      immagini: currentImages,
    };
    if (isEdit) await repo.updateTappa(tappa.id, payload);
    else await repo.createTappa({ destinazioneId, ...payload });
    closeInspector();
    await renderCanvas();
  });
}

/* ---------------------------------------------------------------------- */
/* Form: Vacanza                                                           */
/* ---------------------------------------------------------------------- */

function openVacanzaForm(vacanza = null) {
  if (vacanza) {
    openInspector(
      'Modifica vacanza',
      `<form id="form-vacanza-edit">
        <div class="field"><label class="field-label">Nome</label><input type="text" name="nome" required value="${escapeHtml(vacanza.nome)}"></div>
        <div class="field-row">
          <div class="field"><label class="field-label">Data inizio</label><input type="date" name="dataInizio" value="${vacanza.dataInizio || ''}"></div>
          <div class="field"><label class="field-label">Data fine</label><input type="date" name="dataFine" value="${vacanza.dataFine || ''}"></div>
        </div>
        <div class="field">
          <label class="field-label">Numero di persone</label>
          <input type="number" name="numeroPersone" min="1" step="1" value="${vacanza.numeroPersone || 1}">
          <div class="hint">Usato nel Budget per capire quali spese sono davvero condivise da tutto il gruppo.</div>
        </div>
        <div class="hint">Tipo e destinazione principale non sono modificabili dopo la creazione, per non lasciare giornate orfane: se serve cambiarli, crea una nuova vacanza.</div>
        <div class="inspector-footer">
          <button type="submit" class="btn btn-primary">Salva modifiche</button>
          <button type="button" class="btn btn-ghost" data-role="close-inspector">Annulla</button>
        </div>
      </form>`
    );
    document.getElementById('form-vacanza-edit').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await repo.updateVacanza(vacanza.id, { nome: fd.get('nome'), dataInizio: fd.get('dataInizio'), dataFine: fd.get('dataFine'), numeroPersone: fd.get('numeroPersone') });
      closeInspector();
      await renderCanvas();
    });
    return;
  }

  let tipo = 'fissa';
  openInspector('Nuova vacanza', `<div id="vacanza-form-slot">Caricamento…</div>`);

  repo.listDestinazioni().then((destinazioni) => {
    renderStep();

    function renderStep() {
      const slot = document.getElementById('vacanza-form-slot');
      if (!slot) return;
      slot.innerHTML = `
        <form id="form-vacanza">
          <div class="field">
            <label class="field-label">Nome vacanza</label>
            <input type="text" name="nome" required placeholder="Es. Estate a Pantelleria" autofocus>
          </div>
          <div class="field">
            <label class="field-label">Tipologia</label>
            <div class="type-toggle" id="tipo-vacanza-toggle">
              <button type="button" class="type-toggle-btn ${tipo === 'fissa' ? 'is-selected' : ''}" data-tipo="fissa">
                <div class="type-toggle-title">Un luogo</div>
                <div class="type-toggle-sub">Una destinazione base, più giornate</div>
              </button>
              <button type="button" class="type-toggle-btn ${tipo === 'itinerante' ? 'is-selected' : ''}" data-tipo="itinerante">
                <div class="type-toggle-title">Itinerante</div>
                <div class="type-toggle-sub">Destinazione libera giorno per giorno</div>
              </button>
            </div>
          </div>
          ${
            tipo === 'fissa'
              ? `<div class="field">
                  <label class="field-label">Destinazione principale</label>
                  ${
                    destinazioni.length
                      ? `<div class="dest-picker" id="dest-picker">${destinazioni.map((d) => `<button type="button" class="dest-picker-btn" data-dest="${d.id}">${escapeHtml(d.nome)}</button>`).join('')}</div><input type="hidden" name="destinazionePrincipaleId">`
                      : `<div class="hint">Non hai ancora destinazioni nell'archivio. Crea prima una destinazione dalla sezione "Destinazioni".</div>`
                  }
                </div>`
              : `<div class="hint">Sceglierai la destinazione di ogni singola giornata direttamente nel planner, una volta creata la vacanza.</div>`
          }
          <div class="field-row">
            <div class="field"><label class="field-label">Data inizio (opzionale)</label><input type="date" name="dataInizio"></div>
            <div class="field"><label class="field-label">Data fine (opzionale)</label><input type="date" name="dataFine"></div>
          </div>
          <div class="field">
            <label class="field-label">Numero di persone</label>
            <input type="number" name="numeroPersone" min="1" step="1" value="1">
          </div>
          <div class="inspector-footer">
            <button type="submit" class="btn btn-primary">Crea vacanza</button>
            <button type="button" class="btn btn-ghost" data-role="close-inspector">Annulla</button>
          </div>
        </form>`;

      document.getElementById('tipo-vacanza-toggle').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-tipo]');
        if (!btn) return;
        tipo = btn.dataset.tipo;
        renderStep();
      });

      const destPicker = document.getElementById('dest-picker');
      if (destPicker) {
        destPicker.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-dest]');
          if (!btn) return;
          destPicker.querySelectorAll('.dest-picker-btn').forEach((b) => b.classList.toggle('is-selected', b === btn));
          document.querySelector('#form-vacanza input[name=destinazionePrincipaleId]').value = btn.dataset.dest;
        });
      }

      document.getElementById('form-vacanza').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const nome = (fd.get('nome') || '').trim();
        if (!nome) return;
        if (tipo === 'fissa' && !fd.get('destinazionePrincipaleId')) {
          await showModal({ title: 'Manca la destinazione', bodyHtml: 'Scegli la destinazione principale della vacanza.', confirmLabel: 'Ho capito' });
          return;
        }
        const created = await repo.createVacanza({
          nome,
          tipo,
          destinazionePrincipaleId: tipo === 'fissa' ? fd.get('destinazionePrincipaleId') : null,
          dataInizio: fd.get('dataInizio') || '',
          dataFine: fd.get('dataFine') || '',
          numeroPersone: fd.get('numeroPersone') || 1,
        });
        state.selectedVacanzaId = created.id;
        state.selectedGiornataId = null;
        closeInspector();
        await renderCanvas();
      });
    }
  });
}

/* ---------------------------------------------------------------------- */
/* Budget: form Spesa                                                      */
/* ---------------------------------------------------------------------- */

/**
 * Widget HTML condiviso per l'importo di una Spesa o di una voce Lista: stessa struttura,
 * stesso meccanismo "segui il numero di persone della vacanza" per entrambe. idPrefix distingue
 * gli id quando il widget compare più volte nella stessa pagina (non succede oggi, ma non costa
 * nulla essere prudenti).
 */
function prezzoWidgetHtml(idPrefix, { modalita, importoTotale, importoAPersona, importoDaDividere, numeroPersone }, vacanzaNumeroPersone) {
  const segueVacanza = numeroPersone == null;
  const numeroEffettivo = segueVacanza ? vacanzaNumeroPersone : numeroPersone;
  const warning = !segueVacanza && numeroPersone > vacanzaNumeroPersone;
  return `
    <div class="type-toggle" id="${idPrefix}-modalita-toggle">
      <button type="button" class="type-toggle-btn ${modalita === 'secco' ? 'is-selected' : ''}" data-modalita="secco">
        <div class="type-toggle-title">Totale secco</div>
        <div class="type-toggle-sub">Es. 1000€ in tutto</div>
      </button>
      <button type="button" class="type-toggle-btn ${modalita === 'aPersona' ? 'is-selected' : ''}" data-modalita="aPersona">
        <div class="type-toggle-title">A persona</div>
        <div class="type-toggle-sub">Importo unitario × persone</div>
      </button>
      <button type="button" class="type-toggle-btn ${modalita === 'daDividere' ? 'is-selected' : ''}" data-modalita="daDividere">
        <div class="type-toggle-title">Da dividere</div>
        <div class="type-toggle-sub">Totale ÷ persone (arrotondato per eccesso)</div>
      </button>
    </div>
    ${
      modalita === 'secco'
        ? `<div class="field"><label class="field-label">Importo totale (€)</label><input type="number" name="importoTotale" min="0" step="0.01" required value="${importoTotale ?? ''}"></div>`
        : `<div class="field">
            <label class="field-label">${modalita === 'aPersona' ? 'Importo a persona (€)' : 'Totale da dividere (€)'}</label>
            <input type="number" name="${modalita === 'aPersona' ? 'importoAPersona' : 'importoDaDividere'}" min="0" step="0.01" required value="${(modalita === 'aPersona' ? importoAPersona : importoDaDividere) ?? ''}">
          </div>
          <div class="field">
            <label class="chip-checkbox">
              <input type="checkbox" id="${idPrefix}-segue-vacanza" ${segueVacanza ? 'checked' : ''}>
              <span>Segui il numero di persone della vacanza (${vacanzaNumeroPersone})</span>
            </label>
          </div>
          <div class="field" id="${idPrefix}-numero-persone-field" style="${segueVacanza ? 'display:none;' : ''}">
            <label class="field-label">Numero di persone per questa voce</label>
            <input type="number" name="numeroPersone" id="${idPrefix}-numero-persone-input" min="1" step="1" value="${numeroEffettivo}">
            ${warning ? `<div class="hint" style="color:var(--red-dark);"><i class="fa-solid fa-triangle-exclamation"></i> Sono più delle ${vacanzaNumeroPersone} persone della vacanza.</div>` : ''}
          </div>
          <div class="hint">Se il numero coincide con quello della vacanza, questa voce entra tra le <strong>condivise</strong> nel riepilogo Budget e si aggiorna da sola se in futuro cambi il numero di persone della vacanza. Se lo cambi qui, resta fisso a quello che scrivi, ed entra tra gli <strong>Extra</strong>.</div>`
    }`;
}

/** Aggancia gli eventi del widget importo: cambio modalità e checkbox "segui la vacanza"
 * richiedono entrambi un ri-render dello slot che li contiene (renderStep). */
function bindPrezzoWidgetEvents(idPrefix, prezzoState, renderStep) {
  document.getElementById(`${idPrefix}-modalita-toggle`).addEventListener('click', (e) => {
    const btn = e.target.closest('[data-modalita]');
    if (!btn) return;
    prezzoState.modalita = btn.dataset.modalita;
    renderStep();
  });
  const segueCheckbox = document.getElementById(`${idPrefix}-segue-vacanza`);
  if (segueCheckbox) {
    segueCheckbox.addEventListener('change', () => {
      prezzoState.numeroPersone = segueCheckbox.checked ? null : prezzoState.numeroPersoneEsplicito || 1;
      renderStep();
    });
  }
  const numeroInput = document.getElementById(`${idPrefix}-numero-persone-input`);
  if (numeroInput) {
    numeroInput.addEventListener('input', () => {
      prezzoState.numeroPersoneEsplicito = Number(numeroInput.value) || 1;
      prezzoState.numeroPersone = prezzoState.numeroPersoneEsplicito;
      renderStep();
    });
  }
}

async function openSpesaForm(vacanza, spesa = null) {
  const isEdit = !!spesa;
  const categorie = await repo.listCategorieSpesa();
  const giornate = await repo.listGiornateByVacanza(vacanza.id);
  const gruppiVoci = await opzioniVociSpesa(giornate);
  const vacanzaNumeroPersone = vacanza.numeroPersone || 1;

  const prezzoState = {
    modalita: isEdit ? spesa.modalita : 'secco',
    importoTotale: isEdit ? spesa.importoTotale : null,
    importoAPersona: isEdit ? spesa.importoAPersona : null,
    importoDaDividere: isEdit ? spesa.importoDaDividere : null,
    numeroPersone: isEdit ? spesa.numeroPersone : null, // null = segue la vacanza, di default per le nuove
    numeroPersoneEsplicito: isEdit && spesa.numeroPersone != null ? spesa.numeroPersone : vacanzaNumeroPersone,
  };

  openInspector(isEdit ? 'Modifica spesa' : 'Nuova spesa', `<div id="spesa-form-slot">Caricamento…</div>`);

  function renderStep() {
    const slot = document.getElementById('spesa-form-slot');
    if (!slot) return;
    slot.innerHTML = `
      <form id="form-spesa">
        <div class="field">
          <label class="field-label">Descrizione</label>
          <input type="text" name="descrizione" required placeholder="Es. Hotel, ingresso terme..." value="${isEdit ? escapeHtml(spesa.descrizione) : ''}" autofocus>
        </div>
        <div class="field-row">
          <div class="field">
            <label class="field-label">Categoria (opzionale)</label>
            <select name="categoriaId">
              <option value="">Nessuna</option>
              ${categorie.map((c) => `<option value="${c.id}" ${isEdit && spesa.categoriaId === c.id ? 'selected' : ''}>${escapeHtml(c.nome)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label class="field-label">Collegata a una voce (opzionale)</label>
            <select name="voceId">
              <option value="">Nessuna, è una spesa generale della vacanza</option>
              ${gruppiVoci
                .map(
                  (g) => `<optgroup label="${escapeHtml(g.titolo)}">
                    ${g.opzioni.map((o) => `<option value="${o.id}" ${isEdit && spesa.voceId === o.id ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
                  </optgroup>`
                )
                .join('')}
            </select>
          </div>
        </div>
        <div class="field">
          <label class="field-label">Importo</label>
          ${prezzoWidgetHtml('spesa', prezzoState, vacanzaNumeroPersone)}
        </div>
        <div class="inspector-footer">
          <button type="submit" class="btn btn-primary">${isEdit ? 'Salva modifiche' : 'Aggiungi spesa'}</button>
          <button type="button" class="btn btn-ghost" data-role="close-inspector">Annulla</button>
        </div>
      </form>`;

    bindPrezzoWidgetEvents('spesa', prezzoState, renderStep);

    document.getElementById('form-spesa').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const descrizione = (fd.get('descrizione') || '').trim();
      if (!descrizione) return;
      const payload = {
        descrizione,
        categoriaId: fd.get('categoriaId') || null,
        voceId: fd.get('voceId') || null,
        modalita: prezzoState.modalita,
        importoTotale: fd.get('importoTotale'),
        importoAPersona: fd.get('importoAPersona'),
        importoDaDividere: fd.get('importoDaDividere'),
        numeroPersone: prezzoState.numeroPersone,
      };
      if (isEdit) await repo.updateSpesa(spesa.id, payload);
      else await repo.createSpesa({ vacanzaId: vacanza.id, ...payload });
      closeInspector();
      await renderCanvas();
    });
  }

  renderStep();
}

/* ---------------------------------------------------------------------- */
/* Lista: form voce                                                        */
/* ---------------------------------------------------------------------- */

async function openListaVoceForm(vacanzaId, giornataId, voce = null) {
  const isEdit = !!voce;
  const vacanza = await repo.getVacanza(vacanzaId);
  const vacanzaNumeroPersone = vacanza.numeroPersone || 1;

  let haCosto = isEdit ? !!voce.modalita : false;
  const prezzoState = {
    modalita: isEdit && voce.modalita ? voce.modalita : 'secco',
    importoTotale: isEdit ? voce.importoTotale : null,
    importoAPersona: isEdit ? voce.importoAPersona : null,
    importoDaDividere: isEdit ? voce.importoDaDividere : null,
    numeroPersone: isEdit ? voce.numeroPersone : null,
    numeroPersoneEsplicito: isEdit && voce.numeroPersone != null ? voce.numeroPersone : vacanzaNumeroPersone,
  };

  openInspector(isEdit ? 'Modifica voce' : giornataId ? 'Nuova voce per questo giorno' : 'Nuova voce nella lista generale', `<div id="lista-voce-form-slot">Caricamento…</div>`);

  function renderStep() {
    const slot = document.getElementById('lista-voce-form-slot');
    if (!slot) return;
    slot.innerHTML = `
      <form id="form-lista-voce">
        <div class="field">
          <label class="field-label">Cosa</label>
          <input type="text" name="testo" required placeholder="Es. Scarpe da trekking" value="${isEdit ? escapeHtml(voce.testo) : ''}" autofocus>
        </div>
        <div class="field">
          <label class="chip-checkbox">
            <input type="checkbox" id="lista-ha-costo">
            <span>Ha un costo</span>
          </label>
        </div>
        ${
          haCosto
            ? `<div class="field">
                <label class="field-label">Importo</label>
                ${prezzoWidgetHtml('lista', prezzoState, vacanzaNumeroPersone)}
              </div>
              <div class="field">
                <label class="chip-checkbox">
                  <input type="checkbox" name="contaNelTotale" id="lista-conta-totale" ${!isEdit || voce.contaNelTotale !== false ? 'checked' : ''}>
                  <span>Conta nel totale della vacanza (Budget → Extra)</span>
                </label>
              </div>`
            : ''
        }
        <div class="inspector-footer">
          <button type="submit" class="btn btn-primary">${isEdit ? 'Salva modifiche' : 'Aggiungi'}</button>
          <button type="button" class="btn btn-ghost" data-role="close-inspector">Annulla</button>
        </div>
      </form>`;

    document.getElementById('lista-ha-costo').checked = haCosto;
    document.getElementById('lista-ha-costo').addEventListener('change', (e) => {
      haCosto = e.target.checked;
      renderStep();
    });

    if (haCosto) {
      bindPrezzoWidgetEvents('lista', prezzoState, renderStep);
    }

    document.getElementById('form-lista-voce').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const testo = (fd.get('testo') || '').trim();
      if (!testo) return;
      const contaNelTotale = fd.get('contaNelTotale') === 'on';
      const payload = {
        testo,
        modalita: haCosto ? prezzoState.modalita : null,
        importoTotale: fd.get('importoTotale'),
        importoAPersona: fd.get('importoAPersona'),
        importoDaDividere: fd.get('importoDaDividere'),
        numeroPersone: prezzoState.numeroPersone,
        contaNelTotale: haCosto ? contaNelTotale : false,
      };
      if (isEdit) await repo.updateListaVoce(voce.id, payload);
      else await repo.createListaVoce({ vacanzaId, giornataId, ...payload });
      closeInspector();
      await renderCanvas();
    });
  }

  renderStep();
}

/* ---------------------------------------------------------------------- */
/* Form: aggiunta / cambio giorno                                          */
/* ---------------------------------------------------------------------- */

async function openAddGiornoForm(vacanza) {
  if (vacanza.tipo === 'fissa') {
    const g = await repo.addGiornata(vacanza.id, vacanza.destinazionePrincipaleId);
    state.selectedGiornataId = g.id;
    await renderCanvas();
    return;
  }
  const destinazioni = await repo.listDestinazioni();
  if (!destinazioni.length) {
    await showModal({ title: 'Nessuna destinazione disponibile', bodyHtml: "Crea prima almeno una destinazione nell'archivio.", confirmLabel: 'Ho capito' });
    return;
  }
  openInspector(
    'Nuovo giorno',
    `<div class="hint">Scegli la destinazione di questa giornata. Potrai pianificare solo le tappe che appartengono a questa destinazione.</div>
    <div class="dest-picker" id="dest-picker-giorno">
      ${destinazioni.map((d) => `<button type="button" class="dest-picker-btn" data-dest="${d.id}">${escapeHtml(d.nome)}</button>`).join('')}
    </div>
    <div class="inspector-footer"><button type="button" class="btn btn-ghost" data-role="close-inspector">Annulla</button></div>`
  );
  document.getElementById('dest-picker-giorno').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-dest]');
    if (!btn) return;
    const g = await repo.addGiornata(vacanza.id, btn.dataset.dest);
    state.selectedGiornataId = g.id;
    closeInspector();
    await renderCanvas();
  });
}

async function openChangeGiornoDestinazioneForm(giornataId) {
  const giornata = await repo.getGiornata(giornataId);
  const destinazioni = await repo.listDestinazioni();
  const pianificate = await repo.listVociByGiornata(giornataId);

  openInspector(
    'Cambia destinazione del giorno',
    `<div class="hint">Le tappe pianificate appartengono sempre alla destinazione della giornata: cambiandola, le ${pianificate.length} tapp${pianificate.length === 1 ? 'a' : 'e'} già pianificat${pianificate.length === 1 ? 'a' : 'e'} per questo giorno verrann${pianificate.length === 1 ? 'à' : 'o'} rimoss${pianificate.length === 1 ? 'a' : 'e'}.</div>
    <div class="dest-picker" id="dest-picker-cambio">
      ${destinazioni.map((d) => `<button type="button" class="dest-picker-btn ${d.id === giornata.destinazioneId ? 'is-selected' : ''}" data-dest="${d.id}">${escapeHtml(d.nome)}</button>`).join('')}
    </div>
    <div class="inspector-footer"><button type="button" class="btn btn-ghost" data-role="close-inspector">Annulla</button></div>`
  );

  document.getElementById('dest-picker-cambio').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-dest]');
    if (!btn) return;
    const newDest = btn.dataset.dest;
    closeInspector();
    if (newDest === giornata.destinazioneId) return;
    if (pianificate.length) {
      const ok = await showModal({
        title: 'Confermi il cambio?',
        bodyHtml: `Le ${pianificate.length} tappe pianificate per questo giorno verranno rimosse.`,
        confirmLabel: 'Cambia e rimuovi',
        danger: true,
      });
      if (!ok) return;
    }
    await repo.updateGiornataDestinazione(giornataId, newDest);
    await renderCanvas();
  });
}

/* ---------------------------------------------------------------------- */
/* Form: voce Tappa                                                        */
/* ---------------------------------------------------------------------- */

async function openVoceTappaForm(giornata, voce = null, atIndex = null) {
  const isEdit = !!voce;
  const tappe = await repo.listTappeByDestinazione(giornata.destinazioneId);
  const tipiList = await repo.listTipiTappa();
  const tipiById = Object.fromEntries(tipiList.map((t) => [t.id, t]));
  if (!tappe.length) {
    await showModal({
      title: 'Nessuna tappa disponibile',
      bodyHtml: `La destinazione di questo giorno non ha ancora tappe. Aggiungile dalla sezione "Destinazioni" prima di pianificare.`,
      confirmLabel: 'Ho capito',
    });
    return;
  }
  const tappeById = Object.fromEntries(tappe.map((t) => [t.id, t]));
  const permanenzaIniziale = isEdit ? voce.permanenzaMin ?? '' : tappeById[tappe[0].id]?.durataConsigliataMin ?? '';

  openInspector(
    isEdit ? 'Modifica tappa pianificata' : 'Pianifica una tappa',
    `<form id="form-voce-tappa">
      <div class="field">
        <label class="field-label">Tappa</label>
        <select name="tappaId" id="voce-tappa-select" required>
          ${tappe.map((t) => `<option value="${t.id}" ${isEdit && voce.tappaId === t.id ? 'selected' : ''}>${escapeHtml(tipiById[(t.tipi || [])[0]] ? tipiById[(t.tipi || [])[0]].nome : '')} — ${escapeHtml(t.nome)}</option>`).join('')}
        </select>
      </div>
      <div class="field-row">
        <div class="field">
          <label class="field-label">Permanenza (minuti)</label>
          <input type="number" name="permanenzaMin" id="voce-permanenza" min="0" step="1" required value="${permanenzaIniziale}">
        </div>
        <div class="field">
          <label class="field-label">Orario fisso (opzionale)</label>
          <input type="time" name="oraFissata" value="${isEdit && voce.oraFissata ? voce.oraFissata : ''}">
        </div>
      </div>
      <div class="hint">Normalmente l'inizio si calcola da solo sommando le durate dall'ultima Partenza/Rientro. Imposta un orario fisso solo se questa tappa deve iniziare esattamente a un'ora precisa, a prescindere da cosa viene prima. Permanenza 0 = semplice punto di passaggio: arrivi e riparti da lì, mostrato con un solo orario invece di un intervallo.</div>
      <div class="field">
        <label class="field-label">Note</label>
        <textarea name="note" placeholder="Dettagli, prenotazioni, promemoria...">${isEdit ? escapeHtml(voce.note) : ''}</textarea>
      </div>
      <div class="inspector-footer">
        <button type="submit" class="btn btn-primary">${isEdit ? 'Salva modifiche' : 'Aggiungi al giorno'}</button>
        <button type="button" class="btn btn-ghost" data-role="close-inspector">Annulla</button>
      </div>
    </form>`
  );

  if (!isEdit) {
    // Cambiando tappa, propone la sua durata consigliata come permanenza di partenza
    // (solo se l'utente non ha già scritto qualcosa di suo).
    document.getElementById('voce-tappa-select').addEventListener('change', (e) => {
      const permInput = document.getElementById('voce-permanenza');
      const t = tappeById[e.target.value];
      if (t && t.durataConsigliataMin && !permInput.dataset.touched) {
        permInput.value = t.durataConsigliataMin;
      }
    });
    document.getElementById('voce-permanenza').addEventListener('input', (e) => {
      e.target.dataset.touched = '1';
    });
  }

  document.getElementById('form-voce-tappa').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const tappaId = fd.get('tappaId');
    const permanenzaRaw = fd.get('permanenzaMin');
    const permanenzaMin = permanenzaRaw === '' ? NaN : Number(permanenzaRaw);
    const oraFissata = fd.get('oraFissata') || null;
    const note = fd.get('note') || '';
    if (Number.isNaN(permanenzaMin) || permanenzaMin < 0) {
      await showModal({ title: 'Permanenza non valida', bodyHtml: 'Inserisci quanti minuti pensi di restarci (0 se è solo un punto di passaggio).', confirmLabel: 'Ho capito' });
      return;
    }
    if (isEdit) await repo.updateVoce(voce.id, { tappaId, permanenzaMin, oraFissata, note });
    else await repo.addVoceTappa({ giornataId: giornata.id, tappaId, permanenzaMin, oraFissata, note, atIndex });
    closeInspector();
    await renderCanvas();
  });
}

/** Opzioni di riferimento ("da dove"/"a dove"): tappe di TUTTE le destinazioni dell'archivio,
 * raggruppate per destinazione — una partenza può benissimo essere "Casa", in una destinazione
 * diversa da quella del giorno. Ritorna [{destinazione, tappe}], solo destinazioni con tappe. */
async function getRifOptions() {
  const destinazioni = await repo.listDestinazioni();
  const gruppi = [];
  for (const dest of destinazioni) {
    const tappe = await repo.listTappeByDestinazione(dest.id);
    if (tappe.length) gruppi.push({ destinazione: dest, tappe });
  }
  return gruppi;
}

/** Markup <optgroup> per i selettori "da dove"/"a dove", a partire da getRifOptions(). */
function rifOptionsHtml(gruppi, selectedId) {
  return gruppi
    .map(
      (g) => `<optgroup label="${escapeHtml(g.destinazione.nome)}">
        ${g.tappe.map((t) => `<option value="${t.id}" ${selectedId === t.id ? 'selected' : ''}>${escapeHtml(t.nome)}</option>`).join('')}
      </optgroup>`
    )
    .join('');
}

/* ---------------------------------------------------------------------- */
/* Form: voce Partenza / Rientro                                           */
/* ---------------------------------------------------------------------- */

async function openVocePartenzaRientroForm(giornata, vacanza, tipoVoce, voce = null, atIndex = null) {
  const isEdit = !!voce;
  const isPartenza = tipoVoce === 'partenza';
  const opzioni = await getRifOptions();
  const defaultId = defaultAlloggioTappaId(vacanza, giornata);
  const rifField = isPartenza ? 'daRifTappaId' : 'aRifTappaId';
  const currentRif = isEdit ? voce[rifField] : null;

  openInspector(
    `${isEdit ? 'Modifica' : 'Nuova'} ${isPartenza ? 'partenza' : 'rientro'}`,
    `<form id="form-evento">
      ${
        isPartenza
          ? `<div class="field">
              <label class="field-label">Orario</label>
              <input type="time" name="ora" required value="${isEdit ? voce.ora : ''}">
            </div>`
          : `<div class="field">
              <label class="field-label">Orario fisso (opzionale)</label>
              <input type="time" name="oraFissata" value="${isEdit && voce.oraFissata ? voce.oraFissata : ''}">
            </div>
            <div class="hint">Come una tappa: normalmente l'orario si calcola da solo sommando le durate di quel che viene prima. Impostane uno qui solo se il rientro deve avvenire a un'ora precisa, a prescindere da cosa lo precede.</div>`
      }
      <div class="field">
        <label class="field-label">${isPartenza ? 'Da dove' : 'A dove'}</label>
        <select name="rif">
          <option value="">Automatico${defaultId ? ' (alloggio predefinito)' : ' (nessun riferimento impostato)'}</option>
          ${rifOptionsHtml(opzioni, currentRif)}
        </select>
      </div>
      <div class="field">
        <label class="field-label">Note</label>
        <textarea name="note" placeholder="Dettagli, numero di volo, promemoria...">${isEdit ? escapeHtml(voce.note) : ''}</textarea>
      </div>
      <div class="inspector-footer">
        <button type="submit" class="btn btn-primary">${isEdit ? 'Salva modifiche' : 'Aggiungi al giorno'}</button>
        <button type="button" class="btn btn-ghost" data-role="close-inspector">Annulla</button>
      </div>
    </form>`
  );

  document.getElementById('form-evento').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const rif = fd.get('rif') || null;
    const note = fd.get('note') || '';

    if (isPartenza) {
      const ora = fd.get('ora');
      if (timeToMinutes(ora) == null) {
        await showModal({ title: 'Orario non valido', bodyHtml: 'Inserisci un orario valido.', confirmLabel: 'Ho capito' });
        return;
      }
      if (isEdit) await repo.updateVoce(voce.id, { ora, daRifTappaId: rif, note });
      else await repo.addVocePartenza({ giornataId: giornata.id, ora, daRifTappaId: rif, note, atIndex });
    } else {
      const oraFissata = fd.get('oraFissata') || null;
      if (isEdit) await repo.updateVoce(voce.id, { oraFissata, aRifTappaId: rif, note });
      else await repo.addVoceRientro({ giornataId: giornata.id, oraFissata, aRifTappaId: rif, note, atIndex });
    }
    closeInspector();
    await renderCanvas();
  });
}

/* ---------------------------------------------------------------------- */
/* Form: voce Spostamento                                                  */
/* ---------------------------------------------------------------------- */

async function openVoceSpostamentoForm(giornata, vacanza, voce = null, atIndex = null) {
  const isEdit = !!voce;
  const opzioni = await getRifOptions();

  const vociGiorno = await repo.listVociByGiornata(giornata.id);
  let prevVoce = null;
  let nextVoce = null;
  if (isEdit) {
    const idx = vociGiorno.findIndex((v) => v.id === voce.id);
    prevVoce = idx > 0 ? vociGiorno[idx - 1] : null;
    nextVoce = idx >= 0 && idx < vociGiorno.length - 1 ? vociGiorno[idx + 1] : null;
  } else {
    prevVoce = atIndex > 0 ? vociGiorno[atIndex - 1] : null;
    nextVoce = atIndex < vociGiorno.length ? vociGiorno[atIndex] : null;
  }

  let routingResult = isEdit && voce.distanzaRealeKm != null ? { distanzaRealeKm: voce.distanzaRealeKm, durataRealeMin: voce.durataRealeMin } : null;

  openInspector(
    isEdit ? 'Modifica spostamento' : 'Nuovo spostamento',
    `<form id="form-spostamento">
      <div class="field-row">
        <div class="field">
          <label class="field-label">Durata manuale (minuti, opzionale)</label>
          <input type="number" name="durataMin" min="1" step="1" value="${isEdit && voce.durataMin != null ? voce.durataMin : ''}">
        </div>
        <div class="field">
          <label class="field-label">Orario fisso (opzionale)</label>
          <input type="time" name="oraFissata" value="${isEdit && voce.oraFissata ? voce.oraFissata : ''}">
        </div>
      </div>
      <div class="hint">Se calcoli la distanza reale qui sotto, la sua durata fa da default automaticamente: la durata manuale serve solo per sovrascriverla o se non hai una chiave di routing. L'orario fisso serve solo se questo spostamento deve iniziare a un'ora precisa, a prescindere da cosa viene prima.</div>
      <div class="field">
        <label class="field-label">Mezzo</label>
        <select name="mezzo" required>
          ${MEZZI_TRASPORTO.map((m) => `<option value="${m.value}" ${isEdit && voce.mezzo === m.value ? 'selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}
        </select>
      </div>
      <div class="field-row">
        <div class="field">
          <label class="field-label">Da (opzionale)</label>
          <select name="da"><option value="">Automatico (voce precedente)</option>${rifOptionsHtml(opzioni, isEdit ? voce.daRifTappaId : null)}</select>
        </div>
        <div class="field">
          <label class="field-label">A (opzionale)</label>
          <select name="a"><option value="">Automatico (voce successiva)</option>${rifOptionsHtml(opzioni, isEdit ? voce.aRifTappaId : null)}</select>
        </div>
      </div>
      <div class="field">
        <button type="button" class="btn btn-sm btn-ghost" id="btn-calcola-routing">Calcola distanza e durata reali</button>
        <div id="routing-result" class="hint" style="margin-top:8px;">${routingResult ? `Ultima stima: ${routingResult.distanzaRealeKm.toFixed(1)} km · ${routingResult.durataRealeMin} min` : ''}</div>
      </div>
      <div class="field">
        <label class="field-label">Note</label>
        <textarea name="note" placeholder="Dettagli, numero di volo/treno, promemoria...">${isEdit ? escapeHtml(voce.note) : ''}</textarea>
      </div>
      <div class="inspector-footer">
        <button type="submit" class="btn btn-primary">${isEdit ? 'Salva modifiche' : 'Aggiungi qui'}</button>
        <button type="button" class="btn btn-ghost" data-role="close-inspector">Annulla</button>
      </div>
    </form>`
  );

  document.getElementById('btn-calcola-routing').addEventListener('click', async () => {
    const btn = document.getElementById('btn-calcola-routing');
    const resultEl = document.getElementById('routing-result');
    const mezzoVal = document.querySelector('#form-spostamento select[name=mezzo]').value;
    const profilo = PROFILO_PER_MEZZO[mezzoVal];
    if (!profilo) {
      resultEl.textContent = `Il routing non è disponibile per "${mezzoLabel(mezzoVal)}": resta la sola distanza in linea d'aria.`;
      return;
    }
    const daSel = document.querySelector('#form-spostamento select[name=da]').value || null;
    const aSel = document.querySelector('#form-spostamento select[name=a]').value || null;
    const daId = daSel || endingLocationId(prevVoce, vacanza, giornata);
    const aId = aSel || startingLocationId(nextVoce, vacanza, giornata);
    if (!daId || !aId) {
      resultEl.textContent = 'Servono sia il punto di partenza sia quello di arrivo: impostali qui sopra, oppure assicurati che ci siano voci vicine da cui dedurli.';
      return;
    }
    const [daTappa, aTappa] = await Promise.all([repo.getTappa(daId), repo.getTappa(aId)]);
    if (!daTappa?.coordinate || !aTappa?.coordinate) {
      resultEl.textContent = 'Sia il punto di partenza sia quello di arrivo devono avere delle coordinate salvate.';
      return;
    }
    const config = await repo.getConfig();
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Calcolo…';
    resultEl.textContent = '';
    try {
      const risultato = await calcolaDistanzaStrada(config.orsApiKey, daTappa.coordinate, aTappa.coordinate, profilo);
      routingResult = { distanzaRealeKm: risultato.distanzaKm, durataRealeMin: risultato.durataMin };
      resultEl.textContent = `${risultato.distanzaKm.toFixed(1)} km · ${risultato.durataMin} min (${daTappa.nome} → ${aTappa.nome})`;
    } catch (err) {
      resultEl.textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });

  document.getElementById('form-spostamento').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const mezzo = fd.get('mezzo');
    const daRifTappaId = fd.get('da') || null;
    const aRifTappaId = fd.get('a') || null;
    const note = fd.get('note') || '';
    const distanzaRealeKm = routingResult ? routingResult.distanzaRealeKm : null;
    const durataRealeMin = routingResult ? routingResult.durataRealeMin : null;
    const durataManuale = fd.get('durataMin');
    const durataMin = durataManuale ? Number(durataManuale) : null;
    const oraFissata = fd.get('oraFissata') || null;

    if (isEdit) {
      await repo.updateVoce(voce.id, { mezzo, daRifTappaId, aRifTappaId, note, distanzaRealeKm, durataRealeMin, durataMin, oraFissata });
    } else {
      await repo.addVoceSpostamento({ giornataId: giornata.id, mezzo, daRifTappaId, aRifTappaId, note, atIndex, distanzaRealeKm, durataRealeMin, durataMin, oraFissata });
    }
    closeInspector();
    await renderCanvas();
  });
}

/* ---------------------------------------------------------------------- */
/* Form: gestione alloggi                                                  */
/* ---------------------------------------------------------------------- */

async function openSetAlloggioVacanzaForm(vacanza) {
  const alloggi = await repo.listTappeAlloggio();
  if (!alloggi.length) {
    await showModal({ title: 'Nessun alloggio disponibile', bodyHtml: 'Crea prima una tappa di tipo Alloggio in una destinazione dell\'archivio.', confirmLabel: 'Ho capito' });
    return;
  }
  openInspector(
    'Alloggio della vacanza',
    `<div class="dest-picker" id="picker-alloggio-vacanza">
      ${vacanza.alloggioId ? `<button type="button" class="dest-picker-btn" data-alloggio="">Nessun alloggio</button>` : ''}
      ${alloggi.map((a) => `<button type="button" class="dest-picker-btn ${vacanza.alloggioId === a.id ? 'is-selected' : ''}" data-alloggio="${a.id}">${escapeHtml(a.nome)}</button>`).join('')}
    </div>
    <div class="inspector-footer"><button type="button" class="btn btn-ghost" data-role="close-inspector">Annulla</button></div>`
  );
  document.getElementById('picker-alloggio-vacanza').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-alloggio]');
    if (!btn) return;
    await repo.setVacanzaAlloggio(vacanza.id, btn.dataset.alloggio || null);
    closeInspector();
    await renderCanvas();
  });
}

async function openAddAlloggioPoolForm(vacanza) {
  const alloggi = await repo.listTappeAlloggio();
  const pool = new Set(vacanza.alloggiIds || []);
  const disponibili = alloggi.filter((a) => !pool.has(a.id));
  if (!disponibili.length) {
    await showModal({
      title: 'Nessun alloggio da aggiungere',
      bodyHtml: alloggi.length ? 'Tutti gli alloggi dell\'archivio sono già nel pool di questa vacanza.' : 'Crea prima una tappa di tipo Alloggio in una destinazione dell\'archivio.',
      confirmLabel: 'Ho capito',
    });
    return;
  }
  openInspector(
    'Aggiungi alloggio alla vacanza',
    `<div class="dest-picker" id="picker-alloggio-pool">
      ${disponibili.map((a) => `<button type="button" class="dest-picker-btn" data-alloggio="${a.id}">${escapeHtml(a.nome)}</button>`).join('')}
    </div>
    <div class="inspector-footer"><button type="button" class="btn btn-ghost" data-role="close-inspector">Annulla</button></div>`
  );
  document.getElementById('picker-alloggio-pool').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-alloggio]');
    if (!btn) return;
    await repo.addAlloggioToVacanza(vacanza.id, btn.dataset.alloggio);
    closeInspector();
    await renderCanvas();
  });
}

async function openSetAlloggioGiornoForm(giornataId, vacanza) {
  const giornata = await repo.getGiornata(giornataId);
  const pool = vacanza.alloggiIds || [];
  const alloggi = await Promise.all(pool.map((id) => repo.getTappa(id)));
  openInspector(
    'Alloggio del giorno',
    `<div class="dest-picker" id="picker-alloggio-giorno">
      <button type="button" class="dest-picker-btn ${!giornata.alloggioId ? 'is-selected' : ''}" data-alloggio="">Nessuno</button>
      ${alloggi.filter(Boolean).map((a) => `<button type="button" class="dest-picker-btn ${giornata.alloggioId === a.id ? 'is-selected' : ''}" data-alloggio="${a.id}">${escapeHtml(a.nome)}</button>`).join('')}
    </div>
    <div class="inspector-footer"><button type="button" class="btn btn-ghost" data-role="close-inspector">Annulla</button></div>`
  );
  document.getElementById('picker-alloggio-giorno').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-alloggio]');
    if (!btn) return;
    await repo.setGiornataAlloggio(giornataId, btn.dataset.alloggio || null);
    closeInspector();
    await renderCanvas();
  });
}

/* ---------------------------------------------------------------------- */
/* Form: Tipo di tappa (Impostazioni)                                      */
/* ---------------------------------------------------------------------- */

/** Form generico "solo nome", usato sia per i Tipi di tappa sia per le Categorie destinazione. */
function openNomeForm({ title, nome = '', submitLabel, onSubmit }) {
  openInspector(
    title,
    `<form id="form-nome">
      <div class="field">
        <label class="field-label">Nome</label>
        <input type="text" name="nome" required value="${escapeHtml(nome)}" placeholder="Es. Montagna" autofocus>
      </div>
      <div class="inspector-footer">
        <button type="submit" class="btn btn-primary">${escapeHtml(submitLabel)}</button>
        <button type="button" class="btn btn-ghost" data-role="close-inspector">Annulla</button>
      </div>
    </form>`
  );

  document.getElementById('form-nome').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const nomeVal = (fd.get('nome') || '').trim();
    if (!nomeVal) return;
    await onSubmit({ nome: nomeVal });
    closeInspector();
    await renderCanvas();
  });
}

function openTipoTappaForm(tipo = null) {
  const isEdit = !!tipo;
  openNomeForm({
    title: isEdit ? 'Modifica tipo di tappa' : 'Nuovo tipo di tappa',
    nome: isEdit ? tipo.nome : '',
    submitLabel: isEdit ? 'Salva modifiche' : 'Crea tipo',
    onSubmit: async (payload) => {
      if (isEdit) await repo.updateTipoTappa(tipo.id, payload);
      else await repo.createTipoTappa(payload);
    },
  });
}

function openCategoriaDestinazioneForm(categoria = null) {
  const isEdit = !!categoria;
  openNomeForm({
    title: isEdit ? 'Modifica categoria' : 'Nuova categoria destinazione',
    nome: isEdit ? categoria.nome : '',
    submitLabel: isEdit ? 'Salva modifiche' : 'Crea categoria',
    onSubmit: async (payload) => {
      if (isEdit) await repo.updateCategoriaDestinazione(categoria.id, payload);
      else await repo.createCategoriaDestinazione(payload);
    },
  });
}

function openCategoriaSpesaForm(categoria = null) {
  const isEdit = !!categoria;
  openNomeForm({
    title: isEdit ? 'Modifica categoria spesa' : 'Nuova categoria spesa',
    nome: isEdit ? categoria.nome : '',
    submitLabel: isEdit ? 'Salva modifiche' : 'Crea categoria',
    onSubmit: async (payload) => {
      if (isEdit) await repo.updateCategoriaSpesa(categoria.id, payload);
      else await repo.createCategoriaSpesa(payload);
    },
  });
}

/* ---------------------------------------------------------------------- */
/* Modale di conferma generica                                             */
/* ---------------------------------------------------------------------- */

function showModal({ title, bodyHtml, confirmLabel = 'Conferma', cancelLabel = 'Annulla', danger = false }) {
  return new Promise((resolve) => {
    modalRoot.innerHTML = `
      <div class="modal-overlay" data-role="overlay">
        <div class="modal-card">
          <div class="modal-title">${escapeHtml(title)}</div>
          <div class="modal-body">${bodyHtml}</div>
          <div class="modal-actions">
            <button class="btn btn-ghost" data-role="cancel">${escapeHtml(cancelLabel)}</button>
            <button class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'}" data-role="confirm">${escapeHtml(confirmLabel)}</button>
          </div>
        </div>
      </div>`;
    const overlay = modalRoot.querySelector('[data-role="overlay"]');
    const close = (result) => {
      modalRoot.innerHTML = '';
      resolve(result);
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    });
    modalRoot.querySelector('[data-role="cancel"]').addEventListener('click', () => close(false));
    modalRoot.querySelector('[data-role="confirm"]').addEventListener('click', () => close(true));
  });
}
