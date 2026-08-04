import * as repo from './repository/index.js';
import { escapeHtml } from './utils.js';
import { closeInspector, showModal } from './components/dialog.js';
import { showToast } from './components/toast.js';
import { initSpotlight } from './components/spotlight.js';
import { apriSelezioneStampa } from './services/print.js';
import {
  renderDestinazioniList, renderCanvasRepository, renderVacanzeList, renderCanvasEsplora,
  renderCanvasImpostazioni, renderCanvasBackup, renderCanvasHome,
  openDestinazioneForm, handleDeleteDestinazione, openTappaForm, handleDeleteTappa,
  openTipoTappaForm, handleDeleteTipoTappa, openCategoriaDestinazioneForm, handleDeleteCategoriaDestinazione,
  openCategoriaSpesaForm, handleDeleteCategoriaSpesa,
} from './views/archivio.js';
import {
  renderCanvasVacanze, openVacanzaForm, handleDeleteVacanza, openSpesaForm, openListaVoceForm,
  handleAddGiorno, handleDeleteGiorno, openVoceTappaForm, openVocePartenzaRientroForm,
  openVoceSpostamentoForm, openAddAlloggioPoolForm, openSetAlloggioGiornoForm,
} from './views/vacanza.js';


/* ---------------------------------------------------------------------- */
/* Stato applicativo                                                       */
/* ---------------------------------------------------------------------- */

export const NAV_ITEMS = [
  { key: 'home', label: 'Home', icon: '<i class="fa-solid fa-house"></i>' },
  { key: 'destinazioni', label: 'Destinazioni', icon: '<i class="fa-solid fa-plane"></i>' },
  { key: 'vacanze', label: 'Vacanze', icon: '<i class="fa-solid fa-hiking"></i>' },
  { key: 'esplora', label: 'Esplora', icon: '<i class="fa-solid fa-binoculars"></i>' },
  { key: 'impostazioni', label: 'Impostazioni', icon: '<i class="fa-solid fa-gear"></i>' },
  { key: 'backup', label: 'Backup', icon: '<i class="fa-solid fa-database"></i>' },
];

export const state = {
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

let navNascosti = [];

const railNav = document.getElementById('rail-nav');
const mobileTabbar = document.getElementById('mobile-tabbar');
export const canvas = document.getElementById('canvas');

init();


async function init() {
  navNascosti = (await repo.getConfig()).navNascosti || [];
  renderRailNav();
  bindStaticEvents();
  initSpotlight();
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


export function renderRailNav() {
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
  document.getElementById('inspector-scrim').addEventListener('click', closeInspector);
  document.getElementById('inspector-inner').addEventListener('click', (e) => {
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


export async function renderCanvas() {
  try {
    if (state.view === 'home') {
      await renderCanvasHome();
    } else if (state.view === 'destinazioni') {
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
    showToast('Spesa eliminata');
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
    showToast('Voce eliminata');
  } else if (action === 'toggle-lista-voce') {
    e.stopPropagation();
    await repo.toggleListaVoceFatto(id);
    await renderCanvas();
  } else if (action === 'select-giorno') {
    state.selectedGiornataId = id;
    await renderCanvas();
  } else if (action === 'add-giorno') {
    await handleAddGiorno(state.selectedVacanzaId);
  } else if (action === 'delete-giorno') {
    e.stopPropagation();
    await handleDeleteGiorno(id);
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
    showToast('Voce eliminata');
  } else if (action === 'add-alloggio-pool') {
    await openAddAlloggioPoolForm(await repo.getVacanza(state.selectedVacanzaId));
  } else if (action === 'remove-alloggio-pool') {
    await repo.removeAlloggioFromVacanza(state.selectedVacanzaId, id);
    await renderCanvas();
    showToast('Alloggio rimosso dal pool');
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


export function getNavNascosti() {
  return navNascosti;
}

export function updateNavNascostiCache(arr) {
  navNascosti = arr;
}
