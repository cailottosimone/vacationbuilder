import * as repo from '../repository/index.js';
import { escapeHtml, timeToMinutes, minutesToTime } from '../utils.js';

export const MEZZI_TRASPORTO = [
  { value: 'auto', label: 'Auto', icon: 'fa-car' },
  { value: 'bici', label: 'Bici', icon: 'fa-bicycle' },
  { value: 'piedi', label: 'A piedi', icon: 'fa-person-walking' },
  { value: 'aereo', label: 'Aereo', icon: 'fa-plane' },
  { value: 'treno', label: 'Treno', icon: 'fa-train' },
  { value: 'bus', label: 'Bus', icon: 'fa-bus' },
  { value: 'taxi', label: 'Taxi', icon: 'fa-taxi' },
  { value: 'altro', label: 'Altro', icon: 'fa-route' },
];
export function mezzoLabel(value) {
  return (MEZZI_TRASPORTO.find((m) => m.value === value) || { label: value || '—' }).label;
}
export function mezzoIcon(value) {
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
export function computeOrariVoci(vociOrdinate) {
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

export function defaultAlloggioTappaId(vacanza, giornata) {
  if (giornata && giornata.alloggioId) return giornata.alloggioId;
  const pool = vacanza.alloggiIds || [];
  return pool.length === 1 ? pool[0] : null;
}
export function endingLocationId(voce, vacanza, giornata) {
  if (!voce) return null;
  if (voce.tipoVoce === 'tappa') return voce.tappaId;
  if (voce.tipoVoce === 'partenza') return voce.daRifTappaId || defaultAlloggioTappaId(vacanza, giornata);
  if (voce.tipoVoce === 'rientro') return voce.aRifTappaId || defaultAlloggioTappaId(vacanza, giornata);
  if (voce.tipoVoce === 'spostamento') return voce.aRifTappaId || null;
  return null;
}
export function startingLocationId(voce, vacanza, giornata) {
  if (!voce) return null;
  if (voce.tipoVoce === 'tappa') return voce.tappaId;
  if (voce.tipoVoce === 'partenza') return voce.daRifTappaId || defaultAlloggioTappaId(vacanza, giornata);
  if (voce.tipoVoce === 'rientro') return voce.aRifTappaId || defaultAlloggioTappaId(vacanza, giornata);
  if (voce.tipoVoce === 'spostamento') return voce.daRifTappaId || null;
  return null;
}


export function timelineCardHtml({ id, extraClass = '', timeColContent, mainContent, azioniHtml, noteHtml }) {
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

export async function renderVoceHtml(voce, index, vociList, vacanza, giornata, tipiById, tappaNome) {
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
export function timeColHtml({ inizio, fine, durataLabel = null }) {
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


export async function getRifOptions() {
  const destinazioni = await repo.listDestinazioni();
  const gruppi = [];
  for (const dest of destinazioni) {
    const tappe = await repo.listTappeByDestinazione(dest.id);
    if (tappe.length) gruppi.push({ destinazione: dest, tappe });
  }
  return gruppi;
}

/** Markup <optgroup> per i selettori "da dove"/"a dove", a partire da getRifOptions(). */
export function rifOptionsHtml(gruppi, selectedId) {
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

