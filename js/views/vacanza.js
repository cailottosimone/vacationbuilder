import * as repo from '../repository/index.js';
import { escapeHtml, formatDate, timeToMinutes } from '../utils.js';
import { PROFILO_PER_MEZZO, calcolaDistanzaStrada } from '../routing.js';
import { openInspector, closeInspector, showModal, showChoiceModal, mountPhotoGallery } from '../components/dialog.js';
import { mountPrezzoWidget } from '../components/prezzo-widget.js';
import { mountQuantitaWidget, formatQuantita } from '../components/quantita-widget.js';
import { luogoSelectHtml, bindLuogoQuickAdd } from '../components/luogo-stoccaggio-select.js';
import {
  MEZZI_TRASPORTO, mezzoLabel, computeOrariVoci, defaultAlloggioTappaId,
  endingLocationId, startingLocationId, renderVoceHtml, getRifOptions, rifOptionsHtml,
} from '../components/timeline.js';
import { loadLeaflet, openTappaForm, renderVacanzeList } from './archivio.js';
import { state, renderCanvas } from '../app.js';
import { showToast } from '../components/toast.js';

export async function renderCanvasVacanze() {
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

  /* --- Alloggio: sempre un pool tra cui scegliere giorno per giorno --- */
  const poolIds = vacanza.alloggiIds || [];
  const poolNames = await Promise.all(poolIds.map(async (id) => ({ id, nome: (await tappaNome(id)) || 'tappa eliminata' })));
  const alloggiPoolHtml = `<details class="alloggi-pool">
    <summary>Alloggi<span class="alloggi-pool-count">${poolNames.length}</span></summary>
    ${
      poolNames.length
        ? `<div class="settings-table-wrap"><table class="settings-table">
            <thead><tr><th>Nome</th><th></th></tr></thead>
            <tbody>${poolNames
              .map(
                (a) => `<tr>
                  <td>${escapeHtml(a.nome)}</td>
                  <td class="settings-td-actions"><button class="btn btn-icon btn-ghost" data-action="remove-alloggio-pool" data-id="${a.id}" title="Rimuovi dal pool"><i class="fa-solid fa-xmark"></i></button></td>
                </tr>`
              )
              .join('')}</tbody>
          </table></div>`
        : `<div class="empty-list-note">Nessun alloggio ancora.</div>`
    }
    <button class="btn btn-sm btn-ghost" data-action="add-alloggio-pool" style="margin-top:10px;"><i class="fa-solid fa-plus"></i> Aggiungi alloggio</button>
  </details>`;

  const vTab = state.vacanzaTab || 'programma';
  const subTabsHtml = `<div class="settings-tabs vacanza-subtabs">
    <button class="settings-tab ${vTab === 'programma' ? 'is-active' : ''}" data-action="set-vacanza-tab" data-tab="programma">Programma</button>
    <button class="settings-tab ${vTab === 'budget' ? 'is-active' : ''}" data-action="set-vacanza-tab" data-tab="budget">Budget</button>
    <button class="settings-tab ${vTab === 'lista' ? 'is-active' : ''}" data-action="set-vacanza-tab" data-tab="lista">Lista</button>
  </div>`;

  let tabContentHtml = '';
  let vociPerMappa = null;
  let giornoPerMappa = null;

  if (vTab === 'programma') {
    /* --- Tab dei giorni, trascinabili --- */
    const giorniTabs = await Promise.all(
      giornate.map(async (g, i) => {
        const destGiorno = await repo.getDestinazioniGiorno(g.id);
        const voci = await repo.listVociByGiornata(g.id);
        const active = g.id === state.selectedGiornataId ? 'is-active' : '';
        const alloggioNome = g.alloggioId ? await tappaNome(g.alloggioId) : null;
        const data = repo.dataGiorno(vacanza, i);
        // Data e conteggio voci nella stessa riga: due dati riassuntivi dello stesso peso visivo.
        const suffixParts = [];
        if (data) suffixParts.push(formatDate(data));
        if (voci.length) suffixParts.push(`${voci.length} voc${voci.length === 1 ? 'e' : 'i'}`);
        const suffixHtml = suffixParts.length ? `<span class="giorno-tab-date"> · ${suffixParts.join(' · ')}</span>` : '';
        return `<div class="giorno-tab ${active}" draggable="true" data-id="${g.id}" data-action="select-giorno">
          <button class="card-delete" data-action="delete-giorno" data-id="${g.id}" title="Elimina giorno"><i class="fa-solid fa-trash-can"></i></button>
          <div class="giorno-tab-label">Giorno ${i + 1}${suffixHtml}</div>
          ${alloggioNome ? `<div class="giorno-tab-alloggio">${escapeHtml(alloggioNome)}</div>` : ''}
          <div class="card-badges">
            ${
              destGiorno.length
                ? destGiorno.map((d) => `<span class="badge">${escapeHtml(d.nome)}</span>`).join('')
                : `<span class="badge badge--muted">Nessuna tappa ancora</span>`
            }
          </div>
        </div>`;
      })
    );

    let timelineHtml = `<div class="timeline-empty">Nessuna giornata ancora. Aggiungine una per iniziare a pianificare.</div>`;
    let toolbarHtml = '';
    const giornoCorrente = giornate.find((g) => g.id === state.selectedGiornataId);

    if (giornoCorrente) {
      const vociGrezze = await repo.listVociByGiornata(giornoCorrente.id);
      const voci = computeOrariVoci(vociGrezze);
      vociPerMappa = voci;
      giornoPerMappa = giornoCorrente;

      let alloggioGiornoBtn = '';
      if (poolIds.length) {
        const nome = giornoCorrente.alloggioId ? await tappaNome(giornoCorrente.alloggioId) : null;
        alloggioGiornoBtn = `<button class="btn btn-sm btn-ghost" data-action="set-alloggio-giorno" data-id="${giornoCorrente.id}">${nome ? `Alloggio: ${escapeHtml(nome)}` : 'Imposta alloggio del giorno'}</button>`;
      }
      const mappaGiornoBtn = voci.length ? `<button class="btn btn-sm btn-ghost" id="btn-giorno-mappa">Mostra mappa del giorno</button>` : '';
      toolbarHtml =
        alloggioGiornoBtn || mappaGiornoBtn
          ? `<div class="giorno-toolbar">${alloggioGiornoBtn}${mappaGiornoBtn}</div>${mappaGiornoBtn ? '<div id="giorno-mappa-container"></div>' : ''}`
          : '';

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
            <span class="timeline-gap-label">Aggiungi la prima voce del giorno · scegli tappe da qualsiasi destinazione dell'archivio</span>
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

    const capGiorni = await repo.canAddGiorno(vacanza.id);
    tabContentHtml = `
      <div class="giorni-row">
        ${giorniTabs.join('')}
        ${
          capGiorni.ok
            ? `<button class="giorno-add-tab" data-action="add-giorno" title="Aggiungi giorno"><i class="fa-solid fa-plus"></i></button>`
            : `<div class="giorno-add-limite" title="La vacanza copre ${capGiorni.maxGiorni} giorni: allunga le date per pianificarne altri">${capGiorni.maxGiorni}/${capGiorni.maxGiorni}</div>`
        }
      </div>
      ${toolbarHtml}
      ${timelineHtml}`;
  } else if (vTab === 'budget') {
    tabContentHtml = await renderBudgetTabHtml(vacanza, giornate);
  } else {
    tabContentHtml = await renderListaTabHtml(vacanza, giornate);
  }

  const destIdsVacanza = await repo.listDestinazioneIdsUsateByVacanza(vacanza.id);
  const contestoVacanzaHtml = `<div class="page-context">
    <span class="page-context-chip"><i class="fa-solid fa-calendar-day"></i> ${giornate.length} giorn${giornate.length === 1 ? 'o' : 'i'}</span>
    ${destIdsVacanza.length ? `<span class="page-context-chip"><i class="fa-solid fa-map-location-dot"></i> ${destIdsVacanza.length} destinazion${destIdsVacanza.length === 1 ? 'e' : 'i'}</span>` : ''}
    <span class="page-context-chip"><i class="fa-solid fa-user-group"></i> ${vacanza.numeroPersone || 1} person${(vacanza.numeroPersone || 1) === 1 ? 'a' : 'e'}</span>
  </div>`;

  const cover = vacanza.immagini && vacanza.immagini[0];
  canvas.innerHTML = `
    <div class="page">
      <button class="back-btn" data-action="back-to-vacanze"><i class="fa-solid fa-arrow-left"></i> Vacanze</button>
      <div class="page-header">
        <div class="page-header-main">
          ${cover ? `<img class="cover-thumb" src="${cover}" alt="">` : ''}
          <div>
            <div class="page-eyebrow">Vacanza</div>
            <div class="page-title">${escapeHtml(vacanza.nome)}</div>
            ${vacanza.dataInizio ? `<div class="page-note">${formatDate(vacanza.dataInizio)} → ${vacanza.dataFine ? formatDate(vacanza.dataFine) : '?'}</div>` : ''}
            ${contestoVacanzaHtml}
          </div>
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

  const btnGiornoMappa = document.getElementById('btn-giorno-mappa');
  if (btnGiornoMappa) {
    btnGiornoMappa.addEventListener('click', () => toggleGiornoMappa(btnGiornoMappa, document.getElementById('giorno-mappa-container'), vociPerMappa, vacanza, giornoPerMappa));
  }
}

/** Mostra/nasconde (stesso interruttore "appare e scompare" già usato per le mappe di
 * tappa/destinazione) una mappa con tutte le tappe del giorno che hanno coordinate — incluse
 * Partenza e Rientro, risolte verso il loro riferimento (o l'alloggio di default). Collega i
 * punti con una linea, nell'ordine della giornata, per capire il percorso a colpo d'occhio. */

export async function toggleGiornoMappa(btnEl, containerEl, voci, vacanza, giornata) {
  if (containerEl.dataset.mapOpen === 'true') {
    containerEl.innerHTML = '';
    containerEl.dataset.mapOpen = 'false';
    btnEl.textContent = 'Mostra mappa del giorno';
    return;
  }

  const punti = [];
  for (const v of voci) {
    if (v.tipoVoce === 'tappa' && v.tappaId) {
      const t = await repo.getTappa(v.tappaId);
      if (t && t.coordinate) punti.push({ nome: t.nome, coordinate: t.coordinate });
    } else if (v.tipoVoce === 'partenza' || v.tipoVoce === 'rientro') {
      const rifId = (v.tipoVoce === 'partenza' ? v.daRifTappaId : v.aRifTappaId) || defaultAlloggioTappaId(vacanza, giornata);
      if (rifId) {
        const t = await repo.getTappa(rifId);
        if (t && t.coordinate) punti.push({ nome: `${v.tipoVoce === 'partenza' ? 'Partenza' : 'Rientro'} — ${t.nome}`, coordinate: t.coordinate });
      }
    }
  }

  if (!punti.length) {
    containerEl.innerHTML = `<div class="map-hint">Nessuna voce di questo giorno ha una tappa con coordinate salvate.</div>`;
    containerEl.dataset.mapOpen = 'true';
    btnEl.textContent = 'Nascondi mappa';
    return;
  }

  btnEl.disabled = true;
  btnEl.textContent = 'Carico la mappa…';
  try {
    await loadLeaflet();
    containerEl.innerHTML = `<div id="giorno-leaflet-map" class="esplora-leaflet-map"></div>`;
    const map = L.map('giorno-leaflet-map');
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(map);

    const bounds = [];
    punti.forEach((p, i) => {
      L.marker([p.coordinate.lat, p.coordinate.lng])
        .addTo(map)
        .bindPopup(`<strong>${i + 1}. ${escapeHtml(p.nome)}</strong>`);
      bounds.push([p.coordinate.lat, p.coordinate.lng]);
    });
    if (punti.length > 1) {
      L.polyline(bounds, { color: '#0077C2', weight: 3, opacity: 0.6 }).addTo(map);
    }
    map.fitBounds(bounds, { padding: [30, 30] });

    containerEl.dataset.mapOpen = 'true';
    btnEl.textContent = 'Nascondi mappa';
    btnEl.disabled = false;
  } catch (err) {
    containerEl.innerHTML = `<div class="map-hint">Mappa non disponibile: serve una connessione internet per caricarla la prima volta.</div>`;
    btnEl.textContent = 'Mostra mappa del giorno';
    btnEl.disabled = false;
  }
}

/** Etichetta leggibile per la voce di giornata a cui una spesa può essere collegata. */

export async function labelVoceSpesa(voceId) {
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
export async function opzioniVociSpesa(giornate) {
  const gruppi = [];
  for (let i = 0; i < giornate.length; i++) {
    const voci = await repo.listVociByGiornata(giornate[i].id);
    if (!voci.length) continue;
    const opzioni = await Promise.all(voci.map(async (v) => ({ id: v.id, label: await labelVoceSpesa(v.id) })));
    gruppi.push({ titolo: `Giorno ${i + 1}`, opzioni });
  }
  return gruppi;
}

/** Spiega da dove viene una quantità calcolata, per il tooltip sul badge "×N" in Lista
 * (es. "2 × 5 giorni" oppure "1 × 4 persone"). Per 'secca' non serve, la quantità è già il numero. */
function quantitaSorgenteLabel(record, vacanza, numeroGiorni) {
  const valore = formatQuantita(Number(record.quantitaValore) || 0);
  if (record.quantitaModalita === 'perGiorno') return `${valore} × ${numeroGiorni} giorni`;
  if (record.quantitaModalita === 'perPersona') {
    const persone = repo.risolviNumeroPersoneQuantita(record, vacanza);
    return `${valore} × ${persone} person${persone === 1 ? 'a' : 'e'}`;
  }
  if (record.quantitaModalita === 'perPersonaGiorno') {
    const persone = repo.risolviNumeroPersoneQuantita(record, vacanza);
    return `${valore} × ${persone} person${persone === 1 ? 'a' : 'e'} × ${numeroGiorni} giorni`;
  }
  return '';
}

export function calcoloLabelBudget(record, vacanza, numeroGiorni) {
  let base;
  if (record.modalita === 'aPersona' || record.modalita === 'daDividere') {
    const persone = repo.risolviNumeroPersone(record, vacanza);
    const segue = record.numeroPersone == null;
    if (record.modalita === 'aPersona') {
      base = `${(Number(record.importoAPersona) || 0).toFixed(2)}€ × ${persone}${segue ? ' <span class="budget-segue">(segue vacanza)</span>' : ''}`;
    } else {
      const quota = repo.calcolaQuotaAPersona(record, vacanza);
      base = `${(Number(record.importoDaDividere) || 0).toFixed(2)}€ ÷ ${persone}${segue ? ' <span class="budget-segue">(segue vacanza)</span>' : ''} ≈ ${quota}€ cad.`;
    }
  } else {
    base = 'totale';
  }
  // "Costo per unità": l'importo sopra è per UNA unità, moltiplicato per la quantità della voce.
  if (record.costoPerUnita && record.quantitaModalita) {
    const q = repo.calcolaQuantitaTotale(record, vacanza, numeroGiorni);
    base += ` <span class="budget-segue">× ${formatQuantita(q)}${record.quantitaUnita ? ` ${escapeHtml(record.quantitaUnita)}` : ''} (quantità)</span>`;
  }
  return base;
}


export async function renderBudgetTabHtml(vacanza, giornate = []) {
  const numeroGiorni = giornate.length;
  const spese = await repo.listSpeseByVacanza(vacanza.id);
  const categorie = await repo.listCategorieSpesa();
  const categorieById = Object.fromEntries(categorie.map((c) => [c.id, c]));
  const riepilogo = await repo.getRiepilogoBudget(vacanza.id);

  const righeSpese = await Promise.all(
    spese.map(async (s) => {
      const importo = repo.calcolaImportoRecord(s, vacanza, numeroGiorni);
      const isCondivisa = repo.isRecordCondiviso(s, vacanza);
      const cat = s.categoriaId ? categorieById[s.categoriaId] : null;
      const voceLabel = await labelVoceSpesa(s.voceId);
      return `<tr>
        <td>${escapeHtml(s.descrizione || '—')}${voceLabel ? `<div class="settings-td-sub">${escapeHtml(voceLabel)}</div>` : ''}</td>
        <td>${cat ? escapeHtml(cat.nome) : '—'}</td>
        <td class="settings-td-num">${calcoloLabelBudget(s, vacanza, numeroGiorni)}</td>
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
    const importo = repo.calcolaImportoRecord(v, vacanza, numeroGiorni);
    const isCondivisa = repo.isRecordCondiviso(v, vacanza);
    return `<tr>
      <td>${escapeHtml(v.testo)}<div class="settings-td-sub">dalla Lista</div></td>
      <td>—</td>
      <td class="settings-td-num">${calcoloLabelBudget(v, vacanza, numeroGiorni)}</td>
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

export async function renderListaTabHtml(vacanza, giornate) {
  const selezionato = state.listaGiornoSelezionato;

  const selectorHtml = `<div class="lista-day-picker">
    <button class="lista-day-btn lista-day-btn-generale ${selezionato === null ? 'is-active' : ''}" data-action="set-lista-giorno" data-giorno-id=""><i class="fa-solid fa-suitcase-rolling"></i> Lista Vacanza</button>
    ${giornate.length ? '<span class="lista-day-picker-sep"></span>' : ''}
    ${giornate
      .map((g, i) => {
        const data = repo.dataGiorno(vacanza, i);
        return `<button class="lista-day-btn ${selezionato === g.id ? 'is-active' : ''}" data-action="set-lista-giorno" data-giorno-id="${g.id}">Giorno ${i + 1}${data ? ` · ${formatDate(data)}` : ''}</button>`;
      })
      .join('')}
  </div>`;

  const voci = selezionato ? await repo.listListaVociGiorno(selezionato) : await repo.listListaVociGenerale(vacanza.id);
  const numeroGiorni = giornate.length;
  const luoghi = await repo.listLuoghiStoccaggio();
  const luoghiById = Object.fromEntries(luoghi.map((l) => [l.id, l]));
  const numListePredefinite = (await repo.listListePredefinite()).length;

  const righeHtml = voci
    .map((v) => {
      // Se il costo è "per unità" la cifra qui sotto è già il totale (unitario × quantità):
      // calcolaImportoRecord se ne occupa da sé, non c'è nulla da moltiplicare due volte.
      const importo = v.modalita ? repo.calcolaImportoRecord(v, vacanza, numeroGiorni) : null;
      const quantitaTotale = v.quantitaModalita ? repo.calcolaQuantitaTotale(v, vacanza, numeroGiorni) : null;
      const luogo = v.luogoStoccaggioId ? luoghiById[v.luogoStoccaggioId] : null;
      return `<div class="lista-voce ${v.fatto ? 'is-fatto' : ''}">
        <label class="lista-voce-check">
          <input type="checkbox" data-action="toggle-lista-voce" data-id="${v.id}" ${v.fatto ? 'checked' : ''}>
          <span>${escapeHtml(v.testo)}</span>
        </label>
        ${
          quantitaTotale != null
            ? `<span class="lista-voce-quantita" title="${v.quantitaModalita !== 'secca' ? escapeHtml(quantitaSorgenteLabel(v, vacanza, numeroGiorni)) : ''}">×${formatQuantita(quantitaTotale)}${v.quantitaUnita ? ` ${escapeHtml(v.quantitaUnita)}` : ''}</span>`
            : ''
        }
        ${luogo ? `<span class="badge badge--muted">${escapeHtml(luogo.nome)}</span>` : ''}
        ${
          importo != null
            ? `<span class="lista-voce-costo ${v.contaNelTotale ? '' : 'is-escluso'}">${importo.toFixed(2)}€${v.modalita !== 'secco' || (v.costoPerUnita && v.quantitaModalita) ? ` <span class="budget-segue">(${calcoloLabelBudget(v, vacanza, numeroGiorni).replace(/<[^>]+>/g, '')})</span>` : ''}${!v.contaNelTotale ? ' · escluso dal totale' : ''}</span>`
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
    <p class="settings-tab-hint">Una lista generale per la vacanza (la valigia) più una per ciascun giorno. Ogni voce può avere una quantità (secca, per giorno, per persona...), un luogo di stoccaggio e/o un costo, indipendentemente l'uno dall'altro. Una voce con un costo entra di default nel Budget, tra gli Extra: puoi escluderla se non deve contare.</p>
    ${selectorHtml}
    ${await renderRiepilogoLuoghiHtml(vacanza, numeroGiorni)}
    <div class="settings-tab-toolbar">
      <button class="btn btn-sm btn-primary" data-action="new-lista-voce"><i class="fa-solid fa-plus"></i> Aggiungi voce</button>
      <button class="btn btn-sm btn-ghost" data-action="import-lista-predefinita" ${numListePredefinite === 0 ? 'disabled title="Crea prima una lista predefinita nella sezione dedicata"' : ''}><i class="fa-solid fa-file-import"></i> Importa da lista predefinita</button>
    </div>
    ${voci.length ? `<div class="lista-voci">${righeHtml}</div>` : `<div class="empty-list-note">Nessuna voce ancora.</div>`}`;
}

/** Somma i "pezzi" (quantità totale, o 1 se la voce non ha quantità) di TUTTE le voci Lista della
 * vacanza — generale + ogni giorno insieme, non solo quello che si sta guardando in questo
 * momento — raggruppati per luogo di stoccaggio. Risponde alla domanda "cosa devo mettere dove":
 * quante cose vanno in valigia, quante nello zaino, quante non hanno ancora un posto deciso. */
async function renderRiepilogoLuoghiHtml(vacanza, numeroGiorni) {
  const tutteVoci = await repo.listListaVociByVacanza(vacanza.id);
  if (!tutteVoci.length) return '';
  const luoghi = await repo.listLuoghiStoccaggio();
  const luoghiById = Object.fromEntries(luoghi.map((l) => [l.id, l]));

  const conteggi = {};
  for (const v of tutteVoci) {
    const pezzi = v.quantitaModalita ? repo.calcolaQuantitaTotale(v, vacanza, numeroGiorni) || 0 : 1;
    const key = v.luogoStoccaggioId || '_nessuno';
    conteggi[key] = (conteggi[key] || 0) + pezzi;
  }

  const righe = Object.entries(conteggi)
    .filter(([key]) => key !== '_nessuno')
    .map(([key, count]) => ({ nome: luoghiById[key] ? luoghiById[key].nome : 'Luogo eliminato', count }))
    .sort((a, b) => b.count - a.count);
  const senzaLuogo = conteggi._nessuno || 0;

  if (!righe.length && !senzaLuogo) return '';

  return `<details class="riepilogo-luoghi">
    <summary>Riepilogo per luogo di stoccaggio</summary>
    <div class="riepilogo-luoghi-body">
      ${righe.map((r) => `<div class="riepilogo-luoghi-riga"><span>${escapeHtml(r.nome)}</span><strong>${formatQuantita(r.count)}</strong></div>`).join('')}
      ${senzaLuogo ? `<div class="riepilogo-luoghi-riga is-mancante"><span>Da assegnare</span><strong>${formatQuantita(senzaLuogo)}</strong></div>` : ''}
    </div>
  </details>`;
}

/** Involucro comune a tutte le card della timeline: colonna oraria a piena altezza (il "taglio"
 * blu) più una colonna principale che contiene la riga di contenuto e le note sotto. */

export async function handleDeleteVacanza(id) {
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
  showToast('Vacanza eliminata');
}

/** Costruisce la vista stampabile (recap + programma giorno per giorno) e apre la finestra di
 * stampa del browser: da lì si sceglie "Salva come PDF" (o si stampa davvero). Nessuna libreria
 * PDF: sfrutta il motore di stampa del browser stesso, più affidabile e già installato ovunque. */
/** Piccola scelta prima di stampare: a volte serve solo il programma, altre volte solo il
 * Budget o solo la Lista, altre volte tutto — invece di deciderlo per te, te lo chiedo ogni volta. */

export async function handleDeleteGiorno(id) {
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
  showToast('Giorno eliminato');
}


export function openVacanzaForm(vacanza = null) {
  const isEdit = !!vacanza;
  const currentImages = isEdit ? [...(vacanza.immagini || [])] : [];

  openInspector(
    isEdit ? 'Modifica vacanza' : 'Nuova vacanza',
    `<form id="form-vacanza">
      <div class="field">
        <label class="field-label">Nome vacanza</label>
        <input type="text" name="nome" required placeholder="Es. Estate a Pantelleria" value="${isEdit ? escapeHtml(vacanza.nome) : ''}" autofocus>
      </div>
      <div class="field-row">
        <div class="field"><label class="field-label">Data inizio (opzionale)</label><input type="date" name="dataInizio" value="${isEdit ? vacanza.dataInizio || '' : ''}"></div>
        <div class="field"><label class="field-label">Data fine (opzionale)</label><input type="date" name="dataFine" value="${isEdit ? vacanza.dataFine || '' : ''}"></div>
      </div>
      <div class="field">
        <label class="field-label">Numero di persone</label>
        <input type="number" name="numeroPersone" min="1" step="1" value="${isEdit ? vacanza.numeroPersone || 1 : 1}">
        <div class="hint">Usato nel Budget per capire quali spese sono davvero condivise da tutto il gruppo, e per limitare quanti giorni puoi pianificare se imposti entrambe le date.</div>
      </div>
      <div class="field">
        <label class="field-label">Foto</label>
        <div id="gallery-vacanza"></div>
      </div>
      <div class="inspector-footer">
        <button type="submit" class="btn btn-primary">${isEdit ? 'Salva modifiche' : 'Crea vacanza'}</button>
        <button type="button" class="btn btn-ghost" data-role="close-inspector">Annulla</button>
      </div>
    </form>`
  );

  mountPhotoGallery('gallery-vacanza', currentImages);

  document.getElementById('form-vacanza').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const nome = (fd.get('nome') || '').trim();
    if (!nome) return;
    const payload = {
      nome,
      dataInizio: fd.get('dataInizio') || '',
      dataFine: fd.get('dataFine') || '',
      numeroPersone: fd.get('numeroPersone') || 1,
      immagini: currentImages,
    };
    if (isEdit) {
      await repo.updateVacanza(vacanza.id, payload);
    } else {
      const created = await repo.createVacanza(payload);
      state.selectedVacanzaId = created.id;
      state.selectedGiornataId = null;
    }
    closeInspector();
    await renderCanvas();
    showToast('Vacanza salvata');
  });
}

/* ---------------------------------------------------------------------- */
/* Budget: form Spesa                                                      */
/* ---------------------------------------------------------------------- */

/**
 * Widget HTML condiviso per l'importo di una Spesa o di una voce Lista: stessa struttura,
 * stesso meccanismo "segui il numero di persone della vacanza" per entrambe.
 *
 * Il numero di persone non è un checkbox: di default è testo informativo ("segue la vacanza"),
 * con un link "Personalizza" per chi vuole davvero cambiarlo — un checkbox sempre visibile e blu
 * invitava le persone a premerlo senza motivo, quando nel 99% dei casi va lasciato stare.
 */

export async function openSpesaForm(vacanza, spesa = null) {
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

  openInspector(
    isEdit ? 'Modifica spesa' : 'Nuova spesa',
    `<form id="form-spesa">
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
          <label class="field-label">Voce collegata (opzionale)</label>
          <select name="voceId">
            <option value="">Nessuna, è una spesa generale</option>
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
        <div id="spesa-prezzo-widget"></div>
      </div>
      <div class="inspector-footer">
        <button type="submit" class="btn btn-primary">${isEdit ? 'Salva modifiche' : 'Aggiungi spesa'}</button>
        <button type="button" class="btn btn-ghost" data-role="close-inspector">Annulla</button>
      </div>
    </form>`
  );

  mountPrezzoWidget('spesa-prezzo-widget', prezzoState, vacanzaNumeroPersone);

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
    showToast('Spesa salvata');
  });
}

/* ---------------------------------------------------------------------- */
/* Lista: form voce                                                        */
/* ---------------------------------------------------------------------- */


export async function openListaVoceForm(vacanzaId, giornataId, voce = null) {
  const isEdit = !!voce;
  const vacanza = await repo.getVacanza(vacanzaId);
  const vacanzaNumeroPersone = vacanza.numeroPersone || 1;
  const numeroGiorni = (await repo.listGiornateByVacanza(vacanzaId)).length;
  const luoghi = await repo.listLuoghiStoccaggio();
  // Una voce del singolo giorno è già "scoped" a quel giorno: "per giorno"/"per persona al
  // giorno" non avrebbero un significato chiaro lì (moltiplicherebbero per i giorni di TUTTA
  // la vacanza su una voce che vive in un giorno solo). Nella lista generale invece hanno senso.
  const modiQuantitaDisponibili = giornataId ? ['secca', 'perPersona'] : ['secca', 'perGiorno', 'perPersona', 'perPersonaGiorno'];

  let haCosto = isEdit ? !!voce.modalita : false;
  let haQuantita = isEdit ? !!voce.quantitaModalita : false;
  const costoState = { perUnita: isEdit ? !!voce.costoPerUnita : false };

  const prezzoState = {
    modalita: isEdit && voce.modalita ? voce.modalita : 'secco',
    importoTotale: isEdit ? voce.importoTotale : null,
    importoAPersona: isEdit ? voce.importoAPersona : null,
    importoDaDividere: isEdit ? voce.importoDaDividere : null,
    numeroPersone: isEdit ? voce.numeroPersone : null,
    numeroPersoneEsplicito: isEdit && voce.numeroPersone != null ? voce.numeroPersone : vacanzaNumeroPersone,
  };

  const quantitaState = {
    modalita: isEdit && voce.quantitaModalita ? voce.quantitaModalita : (modiQuantitaDisponibili[0] || 'secca'),
    valore: isEdit ? voce.quantitaValore : null,
    unita: isEdit ? voce.quantitaUnita : null,
    numeroPersone: isEdit ? voce.quantitaNumeroPersone : null,
    numeroPersoneEsplicito: isEdit && voce.quantitaNumeroPersone != null ? voce.quantitaNumeroPersone : vacanzaNumeroPersone,
  };

  openInspector(
    isEdit ? 'Modifica voce' : giornataId ? 'Nuova voce per questo giorno' : 'Nuova voce nella lista generale',
    `<form id="form-lista-voce">
      <div class="field">
        <label class="field-label">Cosa</label>
        <input type="text" name="testo" required placeholder="Es. Scarpe da trekking" value="${isEdit ? escapeHtml(voce.testo) : ''}" autofocus>
      </div>
      <div class="field">
        <label class="chip-checkbox">
          <input type="checkbox" id="lista-ha-quantita" ${haQuantita ? 'checked' : ''}>
          <span>Ha una quantità</span>
        </label>
      </div>
      <div id="lista-quantita-container"></div>
      <div class="field">
        <label class="field-label">Luogo di stoccaggio (opzionale)</label>
        ${luogoSelectHtml(luoghi, isEdit ? voce.luogoStoccaggioId : null, { selectId: 'lista-luogo-select', addBtnId: 'lista-luogo-add' })}
      </div>
      <div class="field">
        <label class="chip-checkbox">
          <input type="checkbox" id="lista-ha-costo" ${haCosto ? 'checked' : ''}>
          <span>Ha un costo</span>
        </label>
      </div>
      <div id="lista-costo-container"></div>
      <div class="inspector-footer">
        <button type="submit" class="btn btn-primary">${isEdit ? 'Salva modifiche' : 'Aggiungi'}</button>
        <button type="button" class="btn btn-ghost" data-role="close-inspector">Annulla</button>
      </div>
    </form>`
  );

  bindLuogoQuickAdd('lista-luogo-select', 'lista-luogo-add');

  function renderQuantitaContainer() {
    const container = document.getElementById('lista-quantita-container');
    if (!haQuantita) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = `<div id="lista-quantita-widget"></div>`;
    mountQuantitaWidget('lista-quantita-widget', quantitaState, {
      vacanzaNumeroPersone,
      numeroGiorni,
      modiDisponibili: modiQuantitaDisponibili,
    });
  }

  function renderCostoContainer() {
    const container = document.getElementById('lista-costo-container');
    if (!haCosto) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = `
      <div class="field">
        <label class="field-label" id="lista-costo-importo-label">${haQuantita && costoState.perUnita ? 'Importo (per unità)' : 'Importo'}</label>
        <div id="lista-prezzo-widget"></div>
      </div>
      ${
        haQuantita
          ? `<div class="field">
              <label class="chip-checkbox">
                <input type="checkbox" id="lista-costo-per-unita" ${costoState.perUnita ? 'checked' : ''}>
                <span>È il prezzo di una singola unità (verrà moltiplicato per la quantità)</span>
              </label>
            </div>`
          : ''
      }
      <div class="field">
        <label class="chip-checkbox">
          <input type="checkbox" name="contaNelTotale" id="lista-conta-totale" ${!isEdit || voce.contaNelTotale !== false ? 'checked' : ''}>
          <span>Conta nel totale della vacanza (Budget → Extra)</span>
        </label>
      </div>`;
    mountPrezzoWidget('lista-prezzo-widget', prezzoState, vacanzaNumeroPersone);
    const perUnitaCheckbox = document.getElementById('lista-costo-per-unita');
    if (perUnitaCheckbox) {
      perUnitaCheckbox.addEventListener('change', (e) => {
        costoState.perUnita = e.target.checked;
        const label = document.getElementById('lista-costo-importo-label');
        if (label) label.textContent = costoState.perUnita ? 'Importo (per unità)' : 'Importo';
      });
    }
  }

  renderQuantitaContainer();
  renderCostoContainer();

  document.getElementById('lista-ha-quantita').addEventListener('change', (e) => {
    haQuantita = e.target.checked;
    if (!haQuantita) costoState.perUnita = false;
    renderQuantitaContainer();
    renderCostoContainer(); // il checkbox "prezzo per unità" appare/scompare insieme alla quantità
  });

  document.getElementById('lista-ha-costo').addEventListener('change', (e) => {
    haCosto = e.target.checked;
    renderCostoContainer();
  });

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
      costoPerUnita: haCosto && haQuantita ? costoState.perUnita : false,
      quantitaModalita: haQuantita ? quantitaState.modalita : null,
      quantitaValore: fd.get('quantitaValore'),
      quantitaNumeroPersone: quantitaState.numeroPersone,
      quantitaUnita: fd.get('quantitaUnita'),
      luogoStoccaggioId: fd.get('luogoStoccaggioId') || null,
    };
    if (isEdit) await repo.updateListaVoce(voce.id, payload);
    else await repo.createListaVoce({ vacanzaId, giornataId, ...payload });
    closeInspector();
    await renderCanvas();
    showToast('Voce salvata');
  });
}

/* ---------------------------------------------------------------------- */
/* Import da lista predefinita                                             */
/* ---------------------------------------------------------------------- */

/** giornataId: null = lista generale della vacanza, altrimenti la lista di quel giorno. */
export async function openImportListaPredefinitaForm(vacanzaId, giornataId) {
  const liste = await repo.listListePredefinite();
  if (!liste.length) {
    showToast('Non hai ancora liste predefinite. Creale nella sezione "Liste predefinite".');
    return;
  }
  const conConteggio = await Promise.all(
    liste.map(async (l) => ({ ...l, count: (await repo.listVociPredefiniteByLista(l.id)).length }))
  );

  openInspector(
    'Importa da lista predefinita',
    `<form id="form-importa-predefinita">
      <p class="settings-tab-hint">Seleziona una o più liste: le loro voci verranno copiate qui, come punto di partenza modificabile.</p>
      <div class="import-lista-elenco">
        ${conConteggio
          .map(
            (l) => `<div class="import-lista-row">
              <label class="import-lista-check">
                <input type="checkbox" name="listaId" value="${l.id}">
                <span>${escapeHtml(l.nome)}</span>
              </label>
              <span class="hint" style="margin:0;">${l.count} voc${l.count === 1 ? 'e' : 'i'}</span>
            </div>`
          )
          .join('')}
      </div>
      <div class="inspector-footer">
        <button type="submit" class="btn btn-primary">Importa</button>
        <button type="button" class="btn btn-ghost" data-role="close-inspector">Annulla</button>
      </div>
    </form>`
  );

  document.getElementById('form-importa-predefinita').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const selezionate = fd.getAll('listaId');
    if (!selezionate.length) {
      showToast('Seleziona almeno una lista');
      return;
    }

    // La scelta sostituisci/integra riguarda l'intera operazione (anche con più liste
    // selezionate insieme), non una domanda ripetuta per ciascuna: e si salta del tutto se lo
    // scope di destinazione è già vuoto, non c'è nulla da sostituire o integrare.
    const esistenti = giornataId ? await repo.listListaVociGiorno(giornataId) : await repo.listListaVociGenerale(vacanzaId);
    let modalitaImport = 'integra';
    if (esistenti.length) {
      const scelta = await showChoiceModal({
        title: 'La lista contiene già delle voci',
        bodyHtml: `${giornataId ? 'La lista di questo giorno' : 'La lista generale'} ha già <strong>${esistenti.length}</strong> voc${esistenti.length === 1 ? 'e' : 'i'}. Vuoi sostituirle con quelle importate, o aggiungere le nuove a quelle già presenti?`,
        choices: [
          { label: 'Sostituisci esistenti', value: 'sostituisci', danger: true },
          { label: 'Integra (aggiungi)', value: 'integra' },
        ],
      });
      if (!scelta) return; // annullato: non si importa nulla, per non rischiare un'azione distruttiva non voluta
      modalitaImport = scelta;
    }

    await repo.importListePredefiniteInVacanza(selezionate, vacanzaId, giornataId, modalitaImport);
    closeInspector();
    await renderCanvas();
    showToast('Lista importata');
  });
}

/* ---------------------------------------------------------------------- */
/* Form: aggiunta / cambio giorno                                          */
/* ---------------------------------------------------------------------- */


export async function handleAddGiorno(vacanzaId) {
  try {
    const g = await repo.addGiornata(vacanzaId);
    state.selectedGiornataId = g.id;
    await renderCanvas();
  } catch (err) {
    await showModal({ title: 'Non posso aggiungere altri giorni', bodyHtml: escapeHtml(err.message), confirmLabel: 'Ho capito' });
  }
}

/* ---------------------------------------------------------------------- */
/* Form: voce Tappa                                                        */
/* ---------------------------------------------------------------------- */


export async function openVoceTappaForm(giornata, voce = null, atIndex = null, preselectTappaId = null) {
  const isEdit = !!voce;
  const destinazioni = await repo.listDestinazioni();
  if (!destinazioni.length) {
    await showModal({ title: 'Nessuna destinazione disponibile', bodyHtml: 'Crea prima una destinazione nell\'archivio.', confirmLabel: 'Ho capito' });
    return;
  }
  const tutteTappe = await repo.listTappe();
  const tipiList = await repo.listTipiTappa();
  const tipiById = Object.fromEntries(tipiList.map((t) => [t.id, t]));
  const tappeById = Object.fromEntries(tutteTappe.map((t) => [t.id, t]));
  const destById = Object.fromEntries(destinazioni.map((d) => [d.id, d]));
  const tappaSelezionata = preselectTappaId || (isEdit ? voce.tappaId : null);
  const filtroIniziale = tappeById[tappaSelezionata] ? tappeById[tappaSelezionata].destinazioneId || '' : '';

  function opzioniTappe(filtroDestId) {
    const filtrate = filtroDestId ? tutteTappe.filter((t) => t.destinazioneId === filtroDestId) : tutteTappe;
    if (!filtrate.length) return `<option value="">Nessuna tappa qui ancora — creane una con "+ Nuova tappa"</option>`;
    return filtrate
      .map((t) => {
        const tipo = tipiById[(t.tipi || [])[0]];
        const destNome = destById[t.destinazioneId] ? destById[t.destinazioneId].nome : '';
        return `<option value="${t.id}" ${tappaSelezionata === t.id ? 'selected' : ''}>${escapeHtml(tipo ? tipo.nome : '')} — ${escapeHtml(t.nome)}${!filtroDestId ? ` · ${escapeHtml(destNome)}` : ''}</option>`;
      })
      .join('');
  }

  const primaTappaFiltrata = tappeById[tappaSelezionata] || (filtroIniziale ? tutteTappe.filter((t) => t.destinazioneId === filtroIniziale) : tutteTappe)[0];
  const permanenzaIniziale = isEdit ? voce.permanenzaMin ?? '' : primaTappaFiltrata?.durataConsigliataMin ?? '';

  openInspector(
    isEdit ? 'Modifica tappa pianificata' : 'Pianifica una tappa',
    `<form id="form-voce-tappa">
      <div class="field">
        <label class="field-label">Filtra per destinazione (opzionale)</label>
        <select id="voce-tappa-filtro">
          <option value="">Tutte le destinazioni</option>
          ${destinazioni.map((d) => `<option value="${d.id}" ${filtroIniziale === d.id ? 'selected' : ''}>${escapeHtml(d.nome)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label class="field-label">Tappa</label>
        <select name="tappaId" id="voce-tappa-select" required>
          ${opzioniTappe(filtroIniziale)}
        </select>
        <button type="button" class="btn btn-sm btn-ghost" id="btn-nuova-tappa-rapida" style="margin-top:8px;"><i class="fa-solid fa-plus"></i> Nuova tappa</button>
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

  document.getElementById('voce-tappa-filtro').addEventListener('change', (e) => {
    document.getElementById('voce-tappa-select').innerHTML = opzioniTappe(e.target.value);
  });

  document.getElementById('btn-nuova-tappa-rapida').addEventListener('click', async () => {
    const filtroCorrente = document.getElementById('voce-tappa-filtro').value || null;
    await openTappaForm(null, {
      presetDestinazioneId: filtroCorrente,
      onSaved: async (nuovaTappa) => {
        closeInspector();
        await openVoceTappaForm(giornata, voce, atIndex, nuovaTappa.id);
      },
    });
  });

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
    showToast(isEdit ? 'Tappa aggiornata' : 'Tappa aggiunta al giorno');
  });
}

/** Opzioni di riferimento ("da dove"/"a dove"): tappe di TUTTE le destinazioni dell'archivio,
 * raggruppate per destinazione — una partenza può benissimo essere "Casa", in una destinazione
 * diversa da quella del giorno. Ritorna [{destinazione, tappe}], solo destinazioni con tappe. */

export async function openVocePartenzaRientroForm(giornata, vacanza, tipoVoce, voce = null, atIndex = null, preselectTappaId = null) {
  const isEdit = !!voce;
  const isPartenza = tipoVoce === 'partenza';
  const opzioni = await getRifOptions();
  const defaultId = defaultAlloggioTappaId(vacanza, giornata);
  const rifField = isPartenza ? 'daRifTappaId' : 'aRifTappaId';
  const currentRif = preselectTappaId || (isEdit ? voce[rifField] : null);

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
        <select name="rif" id="evento-rif-select">
          <option value="">Automatico${defaultId ? ' (alloggio predefinito)' : ' (nessun riferimento impostato)'}</option>
          ${rifOptionsHtml(opzioni, currentRif)}
        </select>
        <button type="button" class="btn btn-sm btn-ghost" id="btn-nuova-tappa-evento" style="margin-top:8px;"><i class="fa-solid fa-plus"></i> Nuova tappa</button>
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

  document.getElementById('btn-nuova-tappa-evento').addEventListener('click', async () => {
    await openTappaForm(null, {
      onSaved: async (nuovaTappa) => {
        closeInspector();
        await openVocePartenzaRientroForm(giornata, vacanza, tipoVoce, voce, atIndex, nuovaTappa.id);
      },
    });
  });

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
    showToast(isPartenza ? 'Partenza salvata' : 'Rientro salvato');
  });
}

/* ---------------------------------------------------------------------- */
/* Form: voce Spostamento                                                  */
/* ---------------------------------------------------------------------- */


export async function openVoceSpostamentoForm(giornata, vacanza, voce = null, atIndex = null) {
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
    showToast('Spostamento salvato');
  });
}

/* ---------------------------------------------------------------------- */
/* Form: gestione alloggi                                                  */
/* ---------------------------------------------------------------------- */


export async function openAddAlloggioPoolForm(vacanza) {
  const alloggi = await repo.listTappeAlloggio();
  const destinazioni = await repo.listDestinazioni();
  const destById = Object.fromEntries(destinazioni.map((d) => [d.id, d]));
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
  const destUsate = destinazioni.filter((d) => disponibili.some((a) => a.destinazioneId === d.id));
  openInspector(
    'Aggiungi alloggio alla vacanza',
    `${
      destUsate.length > 1
        ? `<div class="field">
            <label class="field-label">Filtra per destinazione (opzionale)</label>
            <select id="filtro-dest-alloggio-pool">
              <option value="">Tutte le destinazioni</option>
              ${destUsate.map((d) => `<option value="${d.id}">${escapeHtml(d.nome)}</option>`).join('')}
            </select>
          </div>`
        : ''
    }
    <div class="dest-picker" id="picker-alloggio-pool">
      ${disponibili.map((a) => `<button type="button" class="dest-picker-btn" data-alloggio="${a.id}" data-dest="${a.destinazioneId || ''}">${escapeHtml(a.nome)}${destUsate.length > 1 ? ` <span class="dest-picker-sub">${escapeHtml(destById[a.destinazioneId] ? destById[a.destinazioneId].nome : '')}</span>` : ''}</button>`).join('')}
    </div>
    <div class="inspector-footer"><button type="button" class="btn btn-ghost" data-role="close-inspector">Annulla</button></div>`
  );
  const filtro = document.getElementById('filtro-dest-alloggio-pool');
  if (filtro) {
    filtro.addEventListener('change', () => {
      document.querySelectorAll('#picker-alloggio-pool [data-alloggio]').forEach((btn) => {
        btn.style.display = !filtro.value || btn.dataset.dest === filtro.value ? '' : 'none';
      });
    });
  }
  document.getElementById('picker-alloggio-pool').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-alloggio]');
    if (!btn) return;
    await repo.addAlloggioToVacanza(vacanza.id, btn.dataset.alloggio);
    closeInspector();
    await renderCanvas();
    showToast('Alloggio aggiunto alla vacanza');
  });
}


export async function openSetAlloggioGiornoForm(giornataId, vacanza) {
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
    showToast('Alloggio del giorno impostato');
  });
}

/* ---------------------------------------------------------------------- */
/* Form: Tipo di tappa (Impostazioni)                                      */
/* ---------------------------------------------------------------------- */

/** Form generico "solo nome", usato sia per i Tipi di tappa sia per le Categorie destinazione. */
