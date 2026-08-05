import * as repo from '../repository/index.js';
import { Store } from '../db.js';
import { escapeHtml, formatCoordinate, formatDate, parseCoordinateInput, haversineKm } from '../utils.js';
import { calcolaDistanzaStrada } from '../routing.js';
import {
  openInspector, closeInspector, showModal, bindCoordinateHint, bindMapButton, mountPhotoGallery, openNomeForm,
} from '../components/dialog.js';
import { destCardHtml, destRowHtml, vacCardHtml, vacRowHtml, tappaCardHtml, recentItemRowHtml, chipCheckboxesHtml, emptyListNote } from '../components/card.js';
import { state, canvas, renderCanvas, renderRailNav, getNavNascosti, updateNavNascostiCache, NAV_ITEMS } from '../app.js';
import { showToast } from '../components/toast.js';

/** Cache di sessione delle liste: popolate ad ogni render, lette anche dalle card in
 * components/card.js (da cui vengono importate) per i badge categoria. */
export let destCache = [];
export let vacCache = [];
export let categorieDestCache = [];

export async function renderDestinazioniList() {
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


export function renderDestinazioniListResults() {
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


/** Arricchisce un record vacanza con i dati che le card (vacCardHtml/vacRowHtml) mostrano:
 * durata in giorni e nomi delle destinazioni toccate. Condivisa tra l'elenco Vacanze e la Home. */
export async function augmentVacanzaPerCard(v, nomeDestinazioneMap = null) {
  const giornate = await repo.listGiornateByVacanza(v.id);
  const destinazioneIds = await repo.listDestinazioneIdsUsateByVacanza(v.id);
  const destinazioniNomi = nomeDestinazioneMap
    ? destinazioneIds.map((id) => nomeDestinazioneMap[id]).filter(Boolean)
    : (await Promise.all(destinazioneIds.map((id) => repo.getDestinazione(id)))).filter(Boolean).map((d) => d.nome);
  return { ...v, durataGiorni: giornate.length, destinazioneIds, destinazioniNomi };
}

export async function renderVacanzeList() {
  const all = await repo.listVacanze();
  const destinazioni = await repo.listDestinazioni();
  const nomeDestinazione = Object.fromEntries(destinazioni.map((d) => [d.id, d.nome]));
  vacCache = await Promise.all(all.map((v) => augmentVacanzaPerCard(v, nomeDestinazione)));
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


export function renderVacanzeListResults() {
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


export async function renderCanvasRepository() {
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
            <div class="page-context"><span class="page-context-chip"><i class="fa-solid fa-map-pin"></i> ${tappe.length} tapp${tappe.length === 1 ? 'a' : 'e'}</span></div>
            ${geoLine ? `<div class="page-note">${escapeHtml(geoLine)}</div>` : ''}
            ${dest.coordinate ? `<div class="page-note"><i class="fa-solid fa-location-dot"></i> ${formatCoordinate(dest.coordinate)}</div>` : ''}
            ${categorieDest.length ? `<div class="card-badges" style="margin-top:8px;">${categorieDest.map((c) => `<span class="badge">${escapeHtml(c.nome)}</span>`).join('')}</div>` : ''}
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


let esploraDestCache = [];
let esploraTipiCache = [];
/** Tappe per destinazione, caricate solo quando una riga viene espansa (non tutte in anticipo). */
let esploraTappeCache = {};
/** Id delle destinazioni con la riga espansa nei risultati. */
let esploraExpanded = new Set();


export async function renderCanvasEsplora() {
  const raw = await repo.listDestinazioni();
  esploraDestCache = await Promise.all(raw.map(async (d) => ({ ...d, tappeCount: (await repo.listTappeByDestinazione(d.id)).length })));
  esploraTipiCache = await repo.listTipiTappa();
  esploraTappeCache = {};
  esploraExpanded = new Set();
  const facets = await repo.getFacetsDestinazioni();
  const categorie = await repo.listCategorieDestinazione();
  const es = state.esplora;

  canvas.innerHTML = `
    <div class="page page-wide">
      <div class="page-header">
        <div>
          <div class="page-eyebrow">Esplora</div>
          <div class="page-title">Cosa c'è nei dintorni?</div>
          <div class="page-note">Scegli un punto di partenza: calcolo in automatico linea d'aria, auto e a piedi per le destinazioni nel raggio scelto, e puoi filtrare su ognuno di questi valori.</div>
        </div>
      </div>

      <div class="esplora-layout">
        <div class="esplora-sidebar">
          <details class="details-card" id="esplora-sez-origine" open>
            <summary>Punto di partenza <span class="badge badge--muted">${escapeHtml(labelOrigineCorrente(es, esploraDestCache))}</span></summary>
            <div class="field">
              <div class="type-toggle type-toggle--stack" id="esplora-origine-toggle">
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
            <div id="esplora-origine-input">${renderEsploraOrigineInput(esploraDestCache)}</div>
          </details>

          <details class="details-card" id="esplora-sez-distanza" open>
            <summary>Distanza e tempo <span class="badge badge--muted">entro ${escapeHtml(String(es.raggioKm || 0))} km</span></summary>
            <div class="esplora-travel-filter-group">
              <div class="esplora-travel-filter-label">Linea d'aria (definisce cosa considerare)</div>
              <div class="esplora-travel-filter-row">
                <input type="number" id="esplora-raggio" placeholder="Km max" min="1" value="${es.raggioKm}">
              </div>
            </div>
            <div class="esplora-travel-filter-group">
              <div class="esplora-travel-filter-label">In auto</div>
              <div class="esplora-travel-filter-row">
                <input type="number" id="esplora-fv-autokm" placeholder="Km max" min="0" value="${es.filtriValori.autoKmMax}">
                <input type="number" id="esplora-fv-automin" placeholder="Min max" min="0" value="${es.filtriValori.autoMinMax}">
              </div>
            </div>
            <div class="esplora-travel-filter-group">
              <div class="esplora-travel-filter-label">A piedi</div>
              <div class="esplora-travel-filter-row">
                <input type="number" id="esplora-fv-piedikm" placeholder="Km max" min="0" value="${es.filtriValori.piediKmMax}">
                <input type="number" id="esplora-fv-piedimin" placeholder="Min max" min="0" value="${es.filtriValori.piediMinMax}">
              </div>
            </div>
          </details>

          <details class="details-card" id="esplora-sez-filtri">
            <summary>Filtri${contaFiltriAttivi(es.filtri) ? ` <span class="badge badge--muted">${contaFiltriAttivi(es.filtri)} attiv${contaFiltriAttivi(es.filtri) === 1 ? 'o' : 'i'}</span>` : ''}</summary>
            <div class="field">
              <label class="field-label">Cerca per nome</label>
              <input type="text" id="esplora-f-nome" placeholder="Cerca per nome…" value="${escapeHtml(es.filtri.nome)}">
            </div>
            <div class="esplora-sidebar-selects">
              <select id="esplora-f-stato"><option value="">Stato (tutti)</option>${facets.stati.map((s) => `<option value="${escapeHtml(s)}" ${es.filtri.stato === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}</select>
              <select id="esplora-f-regione"><option value="">Regione (tutte)</option>${facets.regioni.map((s) => `<option value="${escapeHtml(s)}" ${es.filtri.regione === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}</select>
              <select id="esplora-f-provincia"><option value="">Provincia (tutte)</option>${facets.province.map((s) => `<option value="${escapeHtml(s)}" ${es.filtri.provincia === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}</select>
            </div>
            <div id="esplora-f-categorie" class="filters-bar-categories" style="margin-top:12px;">${chipCheckboxesHtml(categorie, es.filtri.categorieIds, 'ecat')}</div>
          </details>
        </div>

        <div class="esplora-main">
          <div class="esplora-results-card"><div id="esplora-results"></div></div>
        </div>
      </div>
    </div>`;

  document.getElementById('esplora-origine-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-modo]');
    if (!btn) return;
    es.origineModo = btn.dataset.modo;
    esploraRoutingCache = {};
    esploraGeneration++;
    renderCanvasEsplora();
  });
  bindEsploraOrigineInput(esploraDestCache);

  const aggiornaBadgeDistanza = () => {
    const el = document.querySelector('#esplora-sez-distanza summary .badge');
    if (el) el.textContent = `entro ${es.raggioKm || 0} km`;
  };
  const aggiornaBadgeFiltri = () => {
    const summary = document.querySelector('#esplora-sez-filtri summary');
    const n = contaFiltriAttivi(es.filtri);
    let badge = summary.querySelector('.badge');
    if (!n) { if (badge) badge.remove(); return; }
    if (!badge) { badge = document.createElement('span'); badge.className = 'badge badge--muted'; summary.appendChild(badge); }
    badge.textContent = `${n} attiv${n === 1 ? 'o' : 'i'}`;
  };

  document.getElementById('esplora-raggio').addEventListener('input', (e) => { es.raggioKm = e.target.value; esploraGeneration++; aggiornaBadgeDistanza(); updateEsploraResults(); });
  document.getElementById('esplora-f-nome').addEventListener('input', (e) => { es.filtri.nome = e.target.value; aggiornaBadgeFiltri(); updateEsploraResults(); });
  document.getElementById('esplora-f-stato').addEventListener('change', (e) => { es.filtri.stato = e.target.value; aggiornaBadgeFiltri(); updateEsploraResults(); });
  document.getElementById('esplora-f-regione').addEventListener('change', (e) => { es.filtri.regione = e.target.value; aggiornaBadgeFiltri(); updateEsploraResults(); });
  document.getElementById('esplora-f-provincia').addEventListener('change', (e) => { es.filtri.provincia = e.target.value; aggiornaBadgeFiltri(); updateEsploraResults(); });
  document.getElementById('esplora-f-categorie').addEventListener('change', (e) => {
    if (e.target.type !== 'checkbox') return;
    es.filtri.categorieIds = [...document.querySelectorAll('#esplora-f-categorie input:checked')].map((i) => i.value);
    aggiornaBadgeFiltri();
    updateEsploraResults();
  });
  document.getElementById('esplora-fv-autokm').addEventListener('input', (e) => { es.filtriValori.autoKmMax = e.target.value; updateEsploraResults(); });
  document.getElementById('esplora-fv-automin').addEventListener('input', (e) => { es.filtriValori.autoMinMax = e.target.value; updateEsploraResults(); });
  document.getElementById('esplora-fv-piedikm').addEventListener('input', (e) => { es.filtriValori.piediKmMax = e.target.value; updateEsploraResults(); });
  document.getElementById('esplora-fv-piedimin').addEventListener('input', (e) => { es.filtriValori.piediMinMax = e.target.value; updateEsploraResults(); });

  await updateEsploraResults();
}

/** Etichetta compatta del punto di partenza corrente, per il badge della sezione richiusa. */
function labelOrigineCorrente(es, destinazioni) {
  if (es.origineModo === 'coordinate') {
    const parsed = parseCoordinateInput(es.origineCoordinateRaw);
    return parsed ? formatCoordinate(parsed) : 'coordinate non impostate';
  }
  if (es.origineModo === 'destinazione') {
    const d = destinazioni.find((x) => x.id === es.origineDestinazioneId);
    return d ? d.nome : 'nessuna scelta';
  }
  return es.originePosizione ? 'posizione rilevata' : 'posizione non rilevata';
}

/** Aggiorna il badge di riepilogo nella sezione "Punto di partenza" quando si richiude. */
export function updateEsploraOriginBadge() {
  const el = document.querySelector('#esplora-sez-origine summary .badge');
  if (el) el.textContent = labelOrigineCorrente(state.esplora, esploraDestCache);
}

/** Quanti filtri anagrafici sono attivi in questo momento, per il badge della sezione Filtri. */
function contaFiltriAttivi(f) {
  return [f.nome, f.stato, f.regione, f.provincia].filter(Boolean).length + (f.categorieIds.length ? 1 : 0);
}


export function renderEsploraOrigineInput(destinazioni) {
  const es = state.esplora;
  if (es.origineModo === 'coordinate') {
    // Il segnalino sta FUORI dal .field, come nel form Destinazione/Tappa: dentro, senza il
    // margine del .field a fargli da cuscinetto, il margine negativo lo spingerebbe dentro
    // all'input invece che appena sotto (il bug segnalato).
    return `<div class="field">
        <label class="field-label">Coordinate di partenza</label>
        <input type="text" id="esplora-coord" placeholder="45.577315815180725, 11.351812970491833" value="${escapeHtml(es.origineCoordinateRaw)}">
      </div>
      <div class="coord-hint" id="esplora-coord-hint"></div>`;
  }
  if (es.origineModo === 'destinazione') {
    const conCoord = destinazioni.filter((d) => d.coordinate);
    return `<div class="field">
        <label class="field-label">Destinazione di partenza</label>
        <select id="esplora-dest-origine">
          <option value="">Scegli una destinazione…</option>
          ${conCoord.map((d) => `<option value="${d.id}" ${es.origineDestinazioneId === d.id ? 'selected' : ''}>${escapeHtml(d.nome)}</option>`).join('')}
        </select>
      </div>
      ${conCoord.length < destinazioni.length ? `<div class="hint">Solo le destinazioni con coordinate salvate compaiono qui.</div>` : ''}`;
  }
  return `<div class="field">
      <label class="field-label">Posizione attuale</label>
      <button type="button" class="btn btn-sm btn-ghost" id="esplora-rileva-posizione">Rileva posizione</button>
    </div>
    <div class="coord-hint coord-hint--standalone" id="esplora-posizione-hint">${es.originePosizione ? `Posizione rilevata: ${formatCoordinate(es.originePosizione)}` : 'Nessuna posizione rilevata ancora.'}</div>`;
}


export function bindEsploraOrigineInput() {
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
      updateEsploraOriginBadge();
      updateEsploraResults();
    };
    input.addEventListener('input', update);
  } else if (es.origineModo === 'destinazione') {
    document.getElementById('esplora-dest-origine').addEventListener('change', (e) => {
      es.origineDestinazioneId = e.target.value;
      esploraRoutingCache = {};
      esploraGeneration++;
      updateEsploraOriginBadge();
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
          updateEsploraOriginBadge();
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


export function resolveEsploraOrigine() {
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


export function formatRouteValue(r) {
  if (!r || r.errore) return null;
  return { km: r.distanzaKm.toFixed(1), min: String(r.durataMin) };
}


/** Espande/richiude le tappe di una destinazione nei risultati, caricandole al volo la prima volta. */
export async function toggleEsploraTappe(destId) {
  if (esploraExpanded.has(destId)) {
    esploraExpanded.delete(destId);
  } else {
    esploraExpanded.add(destId);
    if (!esploraTappeCache[destId]) esploraTappeCache[destId] = await repo.listTappeByDestinazione(destId);
  }
  updateEsploraResults();
}


function esploraTappaItemHtml(t) {
  const tipo = esploraTipiCache.find((x) => x.id === (t.tipi || [])[0]);
  return `<button class="esplora-tappa-item" data-action="vai-a-destinazione" data-id="${t.destinazioneId}">
    <i class="fa-solid fa-map-pin esplora-tappa-icon"></i>
    <span class="esplora-tappa-nome">${escapeHtml(t.nome)}</span>
    ${tipo ? `<span class="badge badge--muted">${escapeHtml(tipo.nome)}</span>` : ''}
  </button>`;
}


export function esploraRowHtml(d) {
  const auto = esploraRoutingCache[`${d.id}:driving-car`];
  const piedi = esploraRoutingCache[`${d.id}:foot-walking`];
  const autoFmt = auto ? formatRouteValue(auto) : null;
  const piediFmt = piedi ? formatRouteValue(piedi) : null;
  const autoAttesa = auto ? (auto.errore ? '—' : autoFmt.km) : '…';
  const autoMinAttesa = auto ? (auto.errore ? '—' : autoFmt.min) : '…';
  const piediAttesa = piedi ? (piedi.errore ? '—' : piediFmt.km) : '…';
  const piediMinAttesa = piedi ? (piedi.errore ? '—' : piediFmt.min) : '…';

  const espansa = esploraExpanded.has(d.id);
  const chevronHtml = d.tappeCount
    ? `<button class="esplora-td-expand-btn ${espansa ? 'is-expanded' : ''}" data-action="toggle-esplora-tappe" data-id="${d.id}" title="${espansa ? 'Nascondi' : 'Mostra'} le tappe"><i class="fa-solid fa-chevron-right"></i></button>`
    : '';

  const rigaPrincipale = `<tr class="esplora-table-row">
    <td class="esplora-td-expand">${chevronHtml}</td>
    <td class="esplora-td-nome" data-action="vai-a-destinazione" data-id="${d.id}">
      ${escapeHtml(d.nome)}${d.tappeCount ? `<span class="esplora-td-tappecount">${d.tappeCount} tapp${d.tappeCount === 1 ? 'a' : 'e'}</span>` : ''}
    </td>
    <td class="esplora-td-meta" data-action="vai-a-destinazione" data-id="${d.id}">${escapeHtml([d.provincia, d.regione].filter(Boolean).join(' · '))}</td>
    <td class="esplora-td-num" data-action="vai-a-destinazione" data-id="${d.id}">${d.distanzaLineaAria.toFixed(1)}</td>
    <td class="esplora-td-num" data-action="vai-a-destinazione" data-id="${d.id}">${autoAttesa}</td>
    <td class="esplora-td-num" data-action="vai-a-destinazione" data-id="${d.id}">${autoMinAttesa}</td>
    <td class="esplora-td-num" data-action="vai-a-destinazione" data-id="${d.id}">${piediAttesa}</td>
    <td class="esplora-td-num" data-action="vai-a-destinazione" data-id="${d.id}">${piediMinAttesa}</td>
  </tr>`;

  if (!espansa) return rigaPrincipale;

  const tappe = esploraTappeCache[d.id] || [];
  const rigaTappe = `<tr class="esplora-tappe-row">
    <td colspan="8">
      <div class="esplora-tappe-list">
        ${tappe.length ? tappe.map(esploraTappaItemHtml).join('') : `<div class="esplora-tappe-vuoto">Nessuna tappa ancora per questa destinazione.</div>`}
      </div>
    </td>
  </tr>`;
  return rigaPrincipale + rigaTappe;
}


export async function updateEsploraResults() {
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
    const auto = esploraRoutingCache[`${d.id}:driving-car`];
    const piedi = esploraRoutingCache[`${d.id}:foot-walking`];
    if (fv.autoKmMax !== '' && auto && !auto.errore && auto.distanzaKm > Number(fv.autoKmMax)) return false;
    if (fv.autoMinMax !== '' && auto && !auto.errore && auto.durataMin > Number(fv.autoMinMax)) return false;
    if (fv.piediKmMax !== '' && piedi && !piedi.errore && piedi.distanzaKm > Number(fv.piediKmMax)) return false;
    if (fv.piediMinMax !== '' && piedi && !piedi.errore && piedi.durataMin > Number(fv.piediMinMax)) return false;
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
    <div class="esplora-table-wrap">
      <table class="esplora-table">
        <thead>
          <tr>
            <th></th>
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
    </div>
    <div id="esplora-mappa-container"></div>`;

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

export async function ensureRoutingForCandidates(candidati, origine, generation) {
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
export function loadLeaflet() {
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


export async function renderCanvasImpostazioni() {
  const config = await repo.getConfig();
  const tab = state.impostazioniTab;

  const tabsHtml = `<div class="settings-tabs">
    <button class="settings-tab ${tab === 'categorie' ? 'is-active' : ''}" data-action="set-impostazioni-tab" data-tab="categorie">Categorie destinazioni</button>
    <button class="settings-tab ${tab === 'tipi' ? 'is-active' : ''}" data-action="set-impostazioni-tab" data-tab="tipi">Tipi di tappa</button>
    <button class="settings-tab ${tab === 'categorieSpesa' ? 'is-active' : ''}" data-action="set-impostazioni-tab" data-tab="categorieSpesa">Categorie spesa</button>
    <button class="settings-tab ${tab === 'routing' ? 'is-active' : ''}" data-action="set-impostazioni-tab" data-tab="routing">Routing</button>
    <button class="settings-tab ${tab === 'navigazione' ? 'is-active' : ''}" data-action="set-impostazioni-tab" data-tab="navigazione">Navigazione</button>
    <button class="settings-tab ${tab === 'backup' ? 'is-active' : ''}" data-action="set-impostazioni-tab" data-tab="backup">Backup</button>
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
  } else if (tab === 'navigazione') {
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
  } else {
    contenuto = `
      <p class="settings-tab-hint">Tutto resta sul tuo Mac: nessun server, nessun account. Esporta di tanto in tanto un file JSON come copia di sicurezza.</p>
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
      </div>`;
  }

  const titoliTab = {
    categorie: ['Categorie riutilizzabili', "Le etichette che usi in tutto l'archivio: si aggiornano ovunque appena le modifichi qui."],
    tipi: ['Categorie riutilizzabili', "Le etichette che usi in tutto l'archivio: si aggiornano ovunque appena le modifichi qui."],
    categorieSpesa: ['Categorie riutilizzabili', "Le etichette che usi in tutto l'archivio: si aggiornano ovunque appena le modifichi qui."],
    routing: ['Routing', 'La chiave per calcolare distanze e durate reali su strada, non solo in linea d\'aria.'],
    navigazione: ['Navigazione', 'Quali sezioni mostrare nel menu.'],
    backup: ['Il tuo archivio, al sicuro', 'Tutto resta sul tuo Mac: nessun server, nessun account.'],
  };
  const [titoloTab, noteTab] = titoliTab[tab] || titoliTab.categorie;

  canvas.innerHTML = `
    <div class="page">
      <div class="page-header">
        <div>
          <div class="page-eyebrow">Impostazioni</div>
          <div class="page-title">${escapeHtml(titoloTab)}</div>
          <div class="page-note">${escapeHtml(noteTab)}</div>
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
      showToast(key.trim() ? 'Chiave Openrouteservice salvata' : 'Chiave Openrouteservice rimossa');
    });
  }

  const btnExport = document.getElementById('btn-export');
  if (btnExport) {
    btnExport.addEventListener('click', async () => {
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
      showToast('Backup esportato');
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
      await renderCanvas();
      showToast('Archivio aggiornato dal backup');
    });
  }

  canvas.querySelectorAll('[data-nav-toggle]').forEach((checkbox) => {
    checkbox.addEventListener('change', async () => {
      const chiave = checkbox.dataset.navToggle;
      const attuali = new Set(getNavNascosti());
      if (checkbox.checked) attuali.delete(chiave);
      else attuali.add(chiave);
      const nuovo = [...attuali];
      updateNavNascostiCache(nuovo);
      await repo.setNavNascosti(nuovo);
      renderRailNav();
      await renderCanvas();
    });
  });
}

/* --- Azioni del canvas --- */


export async function handleDeleteDestinazione(id) {
  const dest = await repo.getDestinazione(id);
  const usage = await repo.checkDestinazioneUsage(id);
  let bodyHtml = `Questa destinazione e le sue tappe verranno rimosse definitivamente dall'archivio.`;
  if (usage.tappeCount > 0 || usage.pianificateCount > 0 || usage.vacanzeCoinvolte.length > 0) {
    bodyHtml += `<div class="modal-usage-list">
      Contiene <strong>${usage.tappeCount}</strong> tapp${usage.tappeCount === 1 ? 'a' : 'e'}${
      usage.pianificateCount ? `, usata in <strong>${usage.pianificateCount}</strong> voce/i pianificat${usage.pianificateCount === 1 ? 'a' : 'e'}` : ''
    }.
      ${
        usage.vacanzeCoinvolte.length
          ? `Le vacanze coinvolte restano intatte, ma le voci collegate a queste tappe mostreranno "tappa eliminata":<ul>${usage.vacanzeCoinvolte
              .map((v) => `<li>${escapeHtml(v.nome)}</li>`)
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
  showToast('Destinazione eliminata');
}


export async function handleDeleteTappa(id) {
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
  showToast('Tappa eliminata');
}


export async function handleDeleteTipoTappa(id) {
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
  showToast('Tipo eliminato');
}


export async function handleDeleteCategoriaDestinazione(id) {
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
  showToast('Categoria eliminata');
}


export async function handleDeleteCategoriaSpesa(id) {
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
  showToast('Categoria eliminata');
}

/* ---------------------------------------------------------------------- */
/* Inspector — apertura/chiusura                                           */
/* ---------------------------------------------------------------------- */


export async function openDestinazioneForm(dest = null) {
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
    showToast('Destinazione salvata');
  });
}

/* ---------------------------------------------------------------------- */
/* Form: Tappa                                                             */
/* ---------------------------------------------------------------------- */


export async function openTappaForm(tappa = null, opts = {}) {
  const isEdit = !!tappa;
  const destinazioneFissa = isEdit ? tappa.destinazioneId : opts.presetDestinazioneId || state.selectedDestinazioneId || null;
  let destinazioniScelta = null;
  if (!isEdit && !destinazioneFissa) {
    destinazioniScelta = await repo.listDestinazioni();
    if (!destinazioniScelta.length) {
      await showModal({ title: 'Nessuna destinazione disponibile', bodyHtml: 'Crea prima una destinazione nell\'archivio.', confirmLabel: 'Ho capito' });
      return;
    }
  }
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
      ${
        destinazioniScelta
          ? `<div class="field">
              <label class="field-label">Destinazione</label>
              <select name="destinazioneId" required>
                ${destinazioniScelta.map((d) => `<option value="${d.id}">${escapeHtml(d.nome)}</option>`).join('')}
              </select>
            </div>`
          : ''
      }
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
    const destinazioneId = destinazioneFissa || fd.get('destinazioneId');
    const payload = {
      nome,
      tipi: selectedTipi,
      note: fd.get('note') || '',
      durataConsigliataMin: fd.get('durata') ? Number(fd.get('durata')) : null,
      coordinateRaw: fd.get('coordinateRaw') || '',
      immagini: currentImages,
    };
    let saved;
    if (isEdit) saved = await repo.updateTappa(tappa.id, payload);
    else saved = await repo.createTappa({ destinazioneId, ...payload });
    showToast('Tappa salvata');
    if (opts.onSaved) {
      await opts.onSaved(saved);
    } else {
      closeInspector();
      await renderCanvas();
    }
  });
}

/* ---------------------------------------------------------------------- */
/* Form: Vacanza                                                           */
/* ---------------------------------------------------------------------- */


export function openTipoTappaForm(tipo = null) {
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


export function openCategoriaDestinazioneForm(categoria = null) {
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


export function openCategoriaSpesaForm(categoria = null) {
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



/* ---------------------------------------------------------------------- */
/* Home                                                                    */
/* ---------------------------------------------------------------------- */

/** Sceglie quale vacanza mettere in evidenza in Home, e perché:
 * 1) una in corso adesso (oggi cade tra le sue date) ha sempre la precedenza;
 * 2) altrimenti la prossima futura più vicina, se qualcuna ha una data;
 * 3) altrimenti quella su cui hai lavorato più di recente (fallback "riprendi da qui"),
 *    dato che repo.listVacanze() le restituisce già ordinate per updatedAt decrescente. */
async function getVacanzaInEvidenza(vacanze) {
  if (!vacanze.length) return null;
  const oggi = new Date().toISOString().slice(0, 10);
  const inCorso = vacanze.find((v) => v.dataInizio && v.dataFine && v.dataInizio <= oggi && oggi <= v.dataFine);
  if (inCorso) return { vacanza: inCorso, stato: 'in-corso' };
  const future = vacanze.filter((v) => v.dataInizio && v.dataInizio > oggi).sort((a, b) => a.dataInizio.localeCompare(b.dataInizio));
  if (future.length) return { vacanza: future[0], stato: 'futura' };
  return { vacanza: vacanze[0], stato: 'recente' };
}

function labelVacanzaInEvidenza({ vacanza, stato }) {
  if (stato === 'in-corso') return 'In corso adesso';
  if (stato === 'futura') {
    const giorni = Math.ceil((new Date(vacanza.dataInizio) - new Date(new Date().toISOString().slice(0, 10))) / 86400000);
    if (giorni <= 0) return 'Parte oggi';
    return `Tra ${giorni} giorn${giorni === 1 ? 'o' : 'i'}`;
  }
  return 'Riprendi da qui';
}

/** Le ultime destinazioni e tappe aggiunte all'archivio, mescolate per data di creazione. */
async function getRecenti(limit = 6) {
  const [destinazioni, tappe] = await Promise.all([repo.listDestinazioni(), repo.listTappe()]);
  const destMap = Object.fromEntries(destinazioni.map((d) => [d.id, d]));
  const itemsDest = destinazioni.map((d) => ({
    tipo: 'destinazione',
    destinazioneId: d.id,
    nome: d.nome,
    createdAt: d.createdAt,
    cover: d.immagini && d.immagini[0],
    contesto: [d.provincia, d.regione].filter(Boolean).join(' · '),
  }));
  const itemsTappa = tappe.map((t) => ({
    tipo: 'tappa',
    destinazioneId: t.destinazioneId,
    nome: t.nome,
    createdAt: t.createdAt,
    cover: t.immagini && t.immagini[0],
    contesto: destMap[t.destinazioneId] ? destMap[t.destinazioneId].nome : '',
  }));
  return [...itemsDest, ...itemsTappa]
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, limit);
}

export async function renderCanvasHome() {
  const [destinazioni, tappe, vacanze, recenti] = await Promise.all([
    repo.listDestinazioni(),
    repo.listTappe(),
    repo.listVacanze(),
    getRecenti(),
  ]);
  const evidenza = await getVacanzaInEvidenza(vacanze);

  const statsHtml = `
    <div class="home-stats-grid">
      <div class="stat-tile"><div class="stat-tile-value">${destinazioni.length}</div><div class="page-eyebrow">Destinazion${destinazioni.length === 1 ? 'e' : 'i'}</div></div>
      <div class="stat-tile"><div class="stat-tile-value">${tappe.length}</div><div class="page-eyebrow">Tapp${tappe.length === 1 ? 'a' : 'e'}</div></div>
      <div class="stat-tile"><div class="stat-tile-value">${vacanze.length}</div><div class="page-eyebrow">Vacanz${vacanze.length === 1 ? 'a' : 'e'}</div></div>
    </div>`;

  let evidenzaHtml = '';
  if (evidenza) {
    const augmented = await augmentVacanzaPerCard(evidenza.vacanza);
    evidenzaHtml = `
      <div class="home-section">
        <div class="home-section-title">Vacanza in evidenza</div>
        <div class="home-section-sub">${escapeHtml(labelVacanzaInEvidenza(evidenza))}</div>
        <div class="home-featured">${vacCardHtml(augmented)}</div>
      </div>`;
  }

  const ctaHtml = `
    <div class="home-section">
      <div class="home-section-title">Comincia da qui</div>
      <div class="home-section-sub">I tre modi di partire: da dove sei, da come ti senti, o da dove vuoi andare.</div>
      <div class="home-cta-grid">
        <button class="cta-tile" data-action="goto-view" data-view="esplora">
          <div class="cta-tile-icon"><i class="fa-solid fa-binoculars"></i></div>
          <div class="cta-tile-title">Esplora i dintorni</div>
          <div class="cta-tile-note">Destinazioni entro un raggio da dove sei, con i tempi reali per arrivarci: utile quando hai del tempo libero e non sai ancora dove andare.</div>
        </button>
        <div class="cta-tile cta-tile--muted" data-action="home-mood-soon">
          <div class="cta-tile-icon"><i class="fa-solid fa-wand-magic-sparkles"></i></div>
          <div class="cta-tile-title">Voglio una giornata relax<span class="badge badge--muted" style="margin-left:8px;">In arrivo</span></div>
          <div class="cta-tile-note">Suggerimenti per stato d'animo, in base a indicatori come Relax, Natura o Cultura: arriva dopo.</div>
        </div>
        <button class="cta-tile" data-action="home-new-vacanza">
          <div class="cta-tile-icon"><i class="fa-solid fa-hiking"></i></div>
          <div class="cta-tile-title">Voglio organizzare una vacanza</div>
          <div class="cta-tile-note">Scegli una destinazione, definisci i giorni, riempili di tappe.</div>
        </button>
      </div>
    </div>`;

  const recentiHtml = recenti.length
    ? `<div class="home-section">
        <div class="home-section-title">Aggiunte di recente</div>
        <div class="item-list">${recenti.map(recentItemRowHtml).join('')}</div>
      </div>`
    : '';

  canvas.innerHTML = `
    <div class="page page-wide">
      <div class="page-header">
        <div>
          <div class="page-eyebrow">Home</div>
          <div class="page-title">Il tuo archivio di viaggio</div>
          <div class="page-note">Non cercare solo posti dove andare. Costruisci esperienze da vivere.</div>
        </div>
      </div>
      ${statsHtml}
      ${ctaHtml}
      ${evidenzaHtml}
      ${recentiHtml}
    </div>`;
}
