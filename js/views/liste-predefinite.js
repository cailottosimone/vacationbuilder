import * as repo from '../repository/index.js';
import { escapeHtml } from '../utils.js';
import { openInspector, closeInspector, showModal, openNomeForm } from '../components/dialog.js';
import { emptyState, emptyListNote } from '../components/card.js';
import { mountQuantitaWidget, formatQuantita } from '../components/quantita-widget.js';
import { luogoSelectHtml, bindLuogoQuickAdd } from '../components/luogo-stoccaggio-select.js';
import { state, canvas, renderCanvas } from '../app.js';
import { showToast } from '../components/toast.js';

/* ---------------------------------------------------------------------- */
/* Elenco (master)                                                         */
/* ---------------------------------------------------------------------- */

export async function renderListePredefiniteList() {
  const liste = await repo.listListePredefinite();
  const conConteggio = await Promise.all(
    liste.map(async (l) => ({ ...l, count: (await repo.listVociPredefiniteByLista(l.id)).length }))
  );

  const corpoHtml = conConteggio.length
    ? `<div class="item-list">${conConteggio
        .map(
          (l) => `<button class="item-row" data-action="select-lista-predefinita" data-id="${l.id}">
            <div class="item-row-thumb-placeholder"><i class="fa-solid fa-clipboard-list"></i></div>
            <span class="item-row-title">${escapeHtml(l.nome)}</span>
            <span class="card-stat"><i class="fa-solid fa-list-check"></i> ${l.count} voc${l.count === 1 ? 'e' : 'i'}</span>
            <span class="item-row-chevron"><i class="fa-solid fa-chevron-right"></i></span>
          </button>`
        )
        .join('')}</div>`
    : emptyState('📋', 'Nessuna lista predefinita ancora', 'Crea un modello riutilizzabile (es. "Lista Default Vacanza Montagna") da copiare rapidamente nella Lista di ogni vacanza.');

  canvas.innerHTML = `
    <div class="page">
      <div class="page-header">
        <div>
          <div class="page-eyebrow">Repository</div>
          <div class="page-title">Liste predefinite</div>
          <div class="page-note">Modelli riutilizzabili di voci — senza costo, con quantità al massimo — da copiare rapidamente nella Lista di una vacanza.</div>
        </div>
        <div class="page-header-actions">
          <button class="btn btn-primary" data-action="new-lista-predefinita"><i class="fa-solid fa-plus"></i> Nuova lista</button>
        </div>
      </div>
      ${corpoHtml}
    </div>`;
}

/* ---------------------------------------------------------------------- */
/* Dettaglio (voci di una lista predefinita)                               */
/* ---------------------------------------------------------------------- */

export async function renderCanvasListePredefinite() {
  if (!state.selectedListaPredefinitaId) {
    await renderListePredefiniteList();
    return;
  }
  const lista = await repo.getListaPredefinita(state.selectedListaPredefinitaId);
  if (!lista) {
    state.selectedListaPredefinitaId = null;
    return renderCanvasListePredefinite();
  }
  const voci = await repo.listVociPredefiniteByLista(lista.id);
  const luoghi = await repo.listLuoghiStoccaggio();
  const luoghiById = Object.fromEntries(luoghi.map((l) => [l.id, l]));

  const righeVoci = voci
    .map((v) => {
      const luogo = v.luogoStoccaggioId ? luoghiById[v.luogoStoccaggioId] : null;
      return `<div class="lista-voce">
        <span class="lista-voce-check"><span>${escapeHtml(v.testo)}</span></span>
        ${v.quantitaModalita ? `<span class="lista-voce-quantita">${templateQuantitaLabel(v)}</span>` : ''}
        ${luogo ? `<span class="badge badge--muted">${escapeHtml(luogo.nome)}</span>` : ''}
        <div class="lista-voce-actions">
          <button class="btn btn-icon btn-ghost" data-action="edit-voce-predefinita" data-id="${v.id}" title="Modifica"><i class="fa-solid fa-pen"></i></button>
          <button class="btn btn-icon btn-ghost" data-action="delete-voce-predefinita" data-id="${v.id}" title="Elimina"><i class="fa-solid fa-trash-can"></i></button>
        </div>
      </div>`;
    })
    .join('');

  canvas.innerHTML = `
    <div class="page">
      <button class="back-btn" data-action="back-to-liste-predefinite"><i class="fa-solid fa-arrow-left"></i> Liste predefinite</button>
      <div class="page-header">
        <div>
          <div class="page-eyebrow">Lista predefinita</div>
          <div class="page-title">${escapeHtml(lista.nome)}</div>
          <div class="page-context"><span class="page-context-chip"><i class="fa-solid fa-list-check"></i> ${voci.length} voc${voci.length === 1 ? 'e' : 'i'}</span></div>
        </div>
        <div class="page-header-actions">
          <button class="btn btn-ghost" data-action="edit-lista-predefinita">Rinomina</button>
          <button class="btn btn-danger" data-action="delete-lista-predefinita">Elimina</button>
          <button class="btn btn-primary" data-action="new-voce-predefinita"><i class="fa-solid fa-plus"></i> Nuova voce</button>
        </div>
      </div>
      ${voci.length ? `<div class="lista-voci">${righeVoci}</div>` : emptyListNote('Nessuna voce ancora. Aggiungi la prima.')}
    </div>`;
}

/** Nella lista predefinita non c'è ancora una vacanza a cui riferirsi: niente totale calcolato
 * (dipende da persone/giorni che non esistono finché non viene importata), solo la formula. */
function templateQuantitaLabel(v) {
  const valore = formatQuantita(Number(v.quantitaValore) || 0);
  const unita = v.quantitaUnita ? ` ${v.quantitaUnita}` : '';
  switch (v.quantitaModalita) {
    case 'perGiorno':
      return `${valore}${unita}/giorno`;
    case 'perPersona':
      return `${valore}${unita}/persona`;
    case 'perPersonaGiorno':
      return `${valore}${unita}/persona/giorno`;
    default: // 'secca'
      return `×${valore}${unita}`;
  }
}

/* ---------------------------------------------------------------------- */
/* Form: lista predefinita (nome)                                          */
/* ---------------------------------------------------------------------- */

export function openListaPredefinitaForm(lista = null) {
  const isEdit = !!lista;
  openNomeForm({
    title: isEdit ? 'Rinomina lista predefinita' : 'Nuova lista predefinita',
    nome: isEdit ? lista.nome : '',
    submitLabel: isEdit ? 'Salva modifiche' : 'Crea lista',
    onSubmit: async (payload) => {
      if (isEdit) {
        await repo.updateListaPredefinita(lista.id, payload);
      } else {
        const created = await repo.createListaPredefinita(payload);
        state.selectedListaPredefinitaId = created.id; // apre subito la lista appena creata
      }
    },
  });
}

export async function handleDeleteListaPredefinita(id) {
  const lista = await repo.getListaPredefinita(id);
  const voci = await repo.listVociPredefiniteByLista(id);
  const ok = await showModal({
    title: `Eliminare "${lista.nome}"?`,
    bodyHtml: voci.length
      ? `Contiene <strong>${voci.length}</strong> voc${voci.length === 1 ? 'e' : 'i'}, che verranno eliminate insieme al modello. Le vacanze in cui l'hai già importata non vengono toccate: quelle voci sono copie indipendenti.`
      : 'Il modello è vuoto: può essere rimosso senza conseguenze.',
    confirmLabel: 'Elimina',
    danger: true,
  });
  if (!ok) return;
  await repo.deleteListaPredefinita(id);
  if (state.selectedListaPredefinitaId === id) state.selectedListaPredefinitaId = null;
  await renderCanvas();
  showToast('Lista predefinita eliminata');
}

/* ---------------------------------------------------------------------- */
/* Form: voce predefinita (testo, quantità opzionale, luogo opzionale)     */
/* NIENTE costo: un modello riutilizzabile non ha senso legato a un prezzo */
/* che cambia da viaggio a viaggio — quello si imposta dopo l'import.      */
/* ---------------------------------------------------------------------- */

export async function openVocePredefinitaForm(listaPredefinitaId, voce = null) {
  const isEdit = !!voce;
  let haQuantita = isEdit ? !!voce.quantitaModalita : false;
  const quantitaState = {
    modalita: isEdit && voce.quantitaModalita ? voce.quantitaModalita : 'secca',
    valore: isEdit ? voce.quantitaValore : null,
    unita: isEdit ? voce.quantitaUnita : null,
    numeroPersone: isEdit ? voce.quantitaNumeroPersone : null,
    numeroPersoneEsplicito: isEdit && voce.quantitaNumeroPersone != null ? voce.quantitaNumeroPersone : 1,
  };
  const luoghi = await repo.listLuoghiStoccaggio();

  openInspector(
    isEdit ? 'Modifica voce' : 'Nuova voce nel modello',
    `<form id="form-voce-predefinita">
      <div class="field">
        <label class="field-label">Cosa</label>
        <input type="text" name="testo" required placeholder="Es. Scarponi da trekking" value="${isEdit ? escapeHtml(voce.testo) : ''}" autofocus>
      </div>
      <div class="field">
        <label class="chip-checkbox">
          <input type="checkbox" id="predef-ha-quantita" ${haQuantita ? 'checked' : ''}>
          <span>Ha una quantità</span>
        </label>
      </div>
      <div id="predef-quantita-container"></div>
      <div class="field">
        <label class="field-label">Luogo di stoccaggio (opzionale)</label>
        ${luogoSelectHtml(luoghi, isEdit ? voce.luogoStoccaggioId : null, { selectId: 'predef-luogo-select', addBtnId: 'predef-luogo-add' })}
      </div>
      <div class="inspector-footer">
        <button type="submit" class="btn btn-primary">${isEdit ? 'Salva modifiche' : 'Aggiungi'}</button>
        <button type="button" class="btn btn-ghost" data-role="close-inspector">Annulla</button>
      </div>
    </form>`
  );

  function renderQuantitaContainer() {
    const container = document.getElementById('predef-quantita-container');
    if (!haQuantita) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = `<div id="predef-quantita-widget"></div>
      <div class="hint">Persone e giorni verranno presi dalla vacanza al momento dell'importazione: qui imposti solo la formula.</div>`;
    // Nessuna vacanza reale in questo contesto: 1/1 sono solo valori segnaposto per l'anteprima,
    // il calcolo vero avviene all'import (vedi importListePredefiniteInVacanza).
    mountQuantitaWidget('predef-quantita-widget', quantitaState, {
      vacanzaNumeroPersone: 1,
      numeroGiorni: 1,
      modiDisponibili: ['secca', 'perGiorno', 'perPersona', 'perPersonaGiorno'],
    });
  }

  renderQuantitaContainer();
  bindLuogoQuickAdd('predef-luogo-select', 'predef-luogo-add');

  document.getElementById('predef-ha-quantita').addEventListener('change', (e) => {
    haQuantita = e.target.checked;
    renderQuantitaContainer();
  });

  document.getElementById('form-voce-predefinita').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const testo = (fd.get('testo') || '').trim();
    if (!testo) return;
    const payload = {
      testo,
      quantitaModalita: haQuantita ? quantitaState.modalita : null,
      quantitaValore: fd.get('quantitaValore'),
      quantitaNumeroPersone: quantitaState.numeroPersone,
      quantitaUnita: fd.get('quantitaUnita'),
      luogoStoccaggioId: fd.get('luogoStoccaggioId') || null,
    };
    if (isEdit) await repo.updateVocePredefinita(voce.id, payload);
    else await repo.createVocePredefinita({ listaPredefinitaId, ...payload });
    closeInspector();
    await renderCanvas();
    showToast('Voce salvata');
  });
}

export async function handleDeleteVocePredefinita(id) {
  const ok = await showModal({ title: 'Eliminare questa voce dal modello?', confirmLabel: 'Elimina', danger: true });
  if (!ok) return;
  await repo.deleteVocePredefinita(id);
  await renderCanvas();
  showToast('Voce eliminata');
}
