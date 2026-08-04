import { escapeHtml, formatCoordinate } from '../utils.js';
import { categorieDestCache } from '../views/archivio.js';

export function emptyState(mark, title, sub) {
  return `<div class="page-empty">
    <div class="page-empty-mark">${mark}</div>
    <div class="page-empty-title">${escapeHtml(title)}</div>
    <div class="page-empty-sub">${escapeHtml(sub)}</div>
  </div>`;
}

export function emptyListNote(text) {
  return `<div class="empty-list-note">${escapeHtml(text)}</div>`;
}

/** Markup di checkbox travestite da chip colorate, per filtri/selettori a categoria multipla. */
export function chipCheckboxesHtml(categorie, selectedIds, idPrefix) {
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


export function destCategorieBadgesHtml(d) {
  const cats = categorieDestCache.filter((c) => (d.categorieIds || []).includes(c.id));
  if (!cats.length) return '';
  return `<div class="item-card-badges">${cats.map((c) => `<span class="categoria-badge">${escapeHtml(c.nome)}</span>`).join('')}</div>`;
}

export function destCardHtml(d) {
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

export function destRowHtml(d) {
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


export function vacCardHtml(v) {
  const cover = v.immagini && v.immagini[0];
  return `<button class="item-card" data-action="select-vacanza" data-id="${v.id}">
    ${cover ? `<img class="item-card-cover" src="${cover}" alt="">` : `<div class="item-card-cover-placeholder"></div>`}
    <div class="item-card-body">
      <div class="item-card-title">${escapeHtml(v.nome)}</div>
      <div class="item-card-meta">${v.durataGiorni} g${v.durataGiorni === 1 ? 'iorno' : 'iorni'}</div>
    </div>
  </button>`;
}

export function vacRowHtml(v) {
  const cover = v.immagini && v.immagini[0];
  return `<button class="item-row" data-action="select-vacanza" data-id="${v.id}">
    ${cover ? `<img class="item-row-thumb" src="${cover}" alt="">` : `<div class="item-row-thumb-placeholder"></div>`}
    <span class="item-row-title">${escapeHtml(v.nome)}</span>
    <span class="item-row-meta">${v.durataGiorni} g${v.durataGiorni === 1 ? 'iorno' : 'iorni'}</span>
    <span class="item-row-chevron"><i class="fa-solid fa-chevron-right"></i></span>
  </button>`;
}

/* --- Destinazioni / Tappe --- */


export function tappaCardHtml(t, tipiList) {
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

