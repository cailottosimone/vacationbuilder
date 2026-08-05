import { escapeHtml, formatCoordinate, formatDate } from '../utils.js';
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

/* ---------------------------------------------------------------------- */
/* Sistema di card condiviso: badge (appartenenza) e stat (dato riassuntivo) */
/* ---------------------------------------------------------------------- */

/** Una pillola di appartenenza (categoria, tipo, destinazione coinvolta...). */
function badgeHtml(text, { muted = false } = {}) {
  return `<span class="badge${muted ? ' badge--muted' : ''}">${escapeHtml(text)}</span>`;
}

/** Riga di badge. `items` è un array di stringhe, o di {text, muted}. */
function badgesRowHtml(items) {
  if (!items.length) return '';
  return `<div class="card-badges">${items
    .map((it) => (typeof it === 'string' ? badgeHtml(it) : badgeHtml(it.text, { muted: it.muted })))
    .join('')}</div>`;
}

/** Un dato riassuntivo con icona, in forma di pillola piena (card "vetrina": item-card/item-row). */
function statHtml(icon, text) {
  return `<span class="card-stat">${icon ? `<i class="fa-solid ${icon}"></i> ` : ''}${escapeHtml(text)}</span>`;
}

/** Riga di stat "vetrina". */
function statsRowHtml(stats) {
  if (!stats.length) return '';
  return `<div class="card-stats">${stats.map((s) => statHtml(s.icon, s.text)).join('')}</div>`;
}

/** Dato riassuntivo "nudo" (monospazio, senza pillola) per le card più dense (tappa-card). */
function statPlainHtml(icon, text) {
  return `<span class="card-stat--plain">${icon ? `<i class="fa-solid ${icon}"></i> ` : ''}${escapeHtml(text)}</span>`;
}

/** Riga orizzontale di più stat "nude": durata e coordinate sono micro-dati imparentati,
 * stanno bene appaiati invece che impilati uno sotto l'altro. */
function statsPlainRowHtml(items) {
  const filtered = items.filter(Boolean);
  if (!filtered.length) return '';
  return `<div class="card-stats-plain">${filtered.map((it) => statPlainHtml(it.icon, it.text)).join('')}</div>`;
}

/** Badge delle categorie di una destinazione, riusato sia sulle card sia sull'header di dettaglio. */
export function destCategorieBadgesHtml(d) {
  const cats = categorieDestCache.filter((c) => (d.categorieIds || []).includes(c.id));
  if (!cats.length) return '';
  return badgesRowHtml(cats.map((c) => c.nome));
}

/* --- Destinazioni: elenco a tutto schermo (griglia o righe) --- */

function destStats(d) {
  const stats = [{ icon: 'fa-map-pin', text: `${d.tappeCount} tapp${d.tappeCount === 1 ? 'a' : 'e'}` }];
  if (d.regione) stats.push({ icon: 'fa-location-dot', text: d.regione });
  return stats;
}

export function destCardHtml(d) {
  const cover = d.immagini && d.immagini[0];
  return `<button class="item-card" data-action="select-destinazione" data-id="${d.id}">
    ${cover ? `<img class="item-card-cover" src="${cover}" alt="">` : `<div class="item-card-cover-placeholder"></div>`}
    <div class="item-card-body">
      <div class="item-card-title">${escapeHtml(d.nome)}</div>
      ${statsRowHtml(destStats(d))}
      ${destCategorieBadgesHtml(d)}
    </div>
  </button>`;
}

export function destRowHtml(d) {
  const cover = d.immagini && d.immagini[0];
  const cats = categorieDestCache.filter((c) => (d.categorieIds || []).includes(c.id));
  return `<button class="item-row" data-action="select-destinazione" data-id="${d.id}">
    ${cover ? `<img class="item-row-thumb" src="${cover}" alt="">` : `<div class="item-row-thumb-placeholder"></div>`}
    <span class="item-row-title">${escapeHtml(d.nome)}</span>
    ${statsRowHtml(destStats(d))}
    ${badgesRowHtml(cats.map((c) => c.nome))}
    <span class="item-row-chevron"><i class="fa-solid fa-chevron-right"></i></span>
  </button>`;
}

/* --- Vacanze: elenco a tutto schermo (griglia o righe) --- */

/** Etichetta compatta di un periodo. Se le date coincidono o manca la fine, mostra solo l'inizio. */
function periodoLabel(v) {
  if (!v.dataInizio) return null;
  if (!v.dataFine || v.dataFine === v.dataInizio) return formatDate(v.dataInizio);
  return `${formatDate(v.dataInizio)} – ${formatDate(v.dataFine)}`;
}

function vacStats(v) {
  const stats = [{ icon: 'fa-calendar-days', text: `${v.durataGiorni} g${v.durataGiorni === 1 ? 'iorno' : 'iorni'}` }];
  const periodo = periodoLabel(v);
  if (periodo) stats.push({ icon: 'fa-calendar', text: periodo });
  if (v.numeroPersone > 1) stats.push({ icon: 'fa-user', text: `${v.numeroPersone} persone` });
  return stats;
}

/** Badge delle destinazioni toccate dalla vacanza: al massimo 3 esplicite, il resto in un
 * "+N" — sono un'anteprima dell'itinerario, non un'appartenenza categorica come le categorie
 * destinazione, quindi usano la variante muted invece del badge pieno. */
function vacDestBadges(v) {
  const nomi = v.destinazioniNomi || [];
  if (!nomi.length) return '';
  const visibili = nomi.slice(0, 3).map((n) => ({ text: n, muted: true }));
  if (nomi.length > 3) visibili.push({ text: `+${nomi.length - 3}`, muted: true });
  return badgesRowHtml(visibili);
}

export function vacCardHtml(v) {
  const cover = v.immagini && v.immagini[0];
  return `<button class="item-card" data-action="select-vacanza" data-id="${v.id}">
    ${cover ? `<img class="item-card-cover" src="${cover}" alt="">` : `<div class="item-card-cover-placeholder"></div>`}
    <div class="item-card-body">
      <div class="item-card-title">${escapeHtml(v.nome)}</div>
      ${statsRowHtml(vacStats(v))}
      ${vacDestBadges(v)}
    </div>
  </button>`;
}

export function vacRowHtml(v) {
  const cover = v.immagini && v.immagini[0];
  return `<button class="item-row" data-action="select-vacanza" data-id="${v.id}">
    ${cover ? `<img class="item-row-thumb" src="${cover}" alt="">` : `<div class="item-row-thumb-placeholder"></div>`}
    <span class="item-row-title">${escapeHtml(v.nome)}</span>
    ${statsRowHtml(vacStats(v))}
    ${vacDestBadges(v)}
    <span class="item-row-chevron"><i class="fa-solid fa-chevron-right"></i></span>
  </button>`;
}

/* --- Destinazioni / Tappe --- */

export function tappaCardHtml(t, tipiList) {
  const cover = t.immagini && t.immagini[0];
  const tipiIds = t.tipi || [];
  const principale = tipiList.find((x) => x.id === tipiIds[0]);
  const secondari = tipiIds.slice(1).map((id) => tipiList.find((x) => x.id === id)).filter(Boolean);
  const tipiBadges = [
    ...(principale ? [{ text: principale.nome }] : []),
    ...secondari.map((s) => ({ text: s.nome, muted: true })),
  ];
  return `<div class="tappa-card" data-action="edit-tappa" data-id="${t.id}">
    <button class="card-delete" data-action="delete-tappa" data-id="${t.id}" title="Elimina tappa"><i class="fa-solid fa-trash-can"></i></button>
    ${cover ? `<img class="cover-thumb" src="${cover}" alt="">` : ''}
    <div class="tappa-card-title">${escapeHtml(t.nome)}</div>
    ${badgesRowHtml(tipiBadges)}
    ${statsPlainRowHtml([
      t.durataConsigliataMin ? { icon: null, text: `${t.durataConsigliataMin} min` } : null,
      t.coordinate ? { icon: 'fa-location-dot', text: formatCoordinate(t.coordinate) } : null,
    ])}
    ${t.note ? `<div class="tappa-card-note">${escapeHtml(t.note)}</div>` : ''}
  </div>`;
}

/* --- Home: elemento recente (destinazione o tappa), stesso layout di item-row --- */

export function recentItemRowHtml(item) {
  const cover = item.cover;
  const tipoLabel = item.tipo === 'tappa' ? 'Tappa' : 'Destinazione';
  return `<button class="item-row" data-action="select-destinazione" data-id="${item.destinazioneId}">
    ${cover ? `<img class="item-row-thumb" src="${cover}" alt="">` : `<div class="item-row-thumb-placeholder"></div>`}
    <span class="item-row-title">${escapeHtml(item.nome)}</span>
    ${item.contesto ? statsRowHtml([{ icon: 'fa-location-dot', text: item.contesto }]) : ''}
    ${badgesRowHtml([{ text: tipoLabel, muted: true }])}
    <span class="item-row-chevron"><i class="fa-solid fa-chevron-right"></i></span>
  </button>`;
}

/* --- Vacanze / Planner --- */
