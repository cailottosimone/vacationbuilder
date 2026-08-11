import { escapeHtml, formatCoordinate, parseCoordinateInput, resizeImageFile } from '../utils.js';
import { renderCanvas } from '../app.js';
import { loadLeaflet } from '../views/archivio.js';
import { showToast } from './toast.js';

const inspector = document.getElementById('inspector');
const inspectorInner = document.getElementById('inspector-inner');
const inspectorScrim = document.getElementById('inspector-scrim');
const modalRoot = document.getElementById('modal-root');

export function openInspector(title, bodyHtml) {
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

export function closeInspector() {
  inspector.classList.remove('is-open');
  inspector.setAttribute('aria-hidden', 'true');
  inspectorScrim.classList.remove('is-open');
}

/** Modale con un solo campo testo (per creazioni "rapide" da dentro un altro form, es. un
 * nuovo Luogo di stoccaggio senza abbandonare la voce che si sta compilando: usa il modale
 * generico invece dell'inspector, che è un'istanza unica e cancellerebbe il form aperto sotto).
 * Ritorna la stringa inserita (già trim), o null se annullato/vuoto. */
export function showPromptModal({ title, placeholder = '', confirmLabel = 'Crea' }) {
  return new Promise((resolve) => {
    modalRoot.innerHTML = `
      <div class="modal-overlay" data-role="overlay">
        <div class="modal-card">
          <div class="modal-title">${escapeHtml(title)}</div>
          <div class="modal-body">
            <input type="text" class="modal-prompt-input" id="modal-prompt-input" placeholder="${escapeHtml(placeholder)}" autofocus>
          </div>
          <div class="modal-actions">
            <button class="btn btn-ghost" data-role="cancel">Annulla</button>
            <button class="btn btn-primary" data-role="confirm">${escapeHtml(confirmLabel)}</button>
          </div>
        </div>
      </div>`;
    const overlay = modalRoot.querySelector('[data-role="overlay"]');
    const input = modalRoot.querySelector('#modal-prompt-input');
    const close = (result) => {
      modalRoot.innerHTML = '';
      resolve(result);
    };
    const confirm = () => {
      const val = (input.value || '').trim();
      close(val || null);
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); confirm(); }
    });
    modalRoot.querySelector('[data-role="cancel"]').addEventListener('click', () => close(null));
    modalRoot.querySelector('[data-role="confirm"]').addEventListener('click', confirm);
    input.focus();
  });
}

/** Modale di scelta a più opzioni (non solo conferma/annulla): usata per "sostituisci o integra"
 * durante l'import di una lista predefinita. Ritorna il `value` scelto, o null se annullato
 * (click fuori o Annulla) — nullo di proposito, per non far scattare per sbaglio un'azione
 * distruttiva ("sostituisci") solo perché l'utente ha chiuso il modale distrattamente. */
export function showChoiceModal({ title, bodyHtml = '', choices }) {
  return new Promise((resolve) => {
    modalRoot.innerHTML = `
      <div class="modal-overlay" data-role="overlay">
        <div class="modal-card">
          <div class="modal-title">${escapeHtml(title)}</div>
          ${bodyHtml ? `<div class="modal-body">${bodyHtml}</div>` : ''}
          <div class="modal-actions modal-actions--choices">
            ${choices
              .map(
                (c, i) => `<button class="btn ${c.danger ? 'btn-danger-solid' : i === 0 ? 'btn-primary' : 'btn-ghost'}" data-choice-index="${i}">${escapeHtml(c.label)}</button>`
              )
              .join('')}
            <button class="btn btn-ghost" data-role="cancel">Annulla</button>
          </div>
        </div>
      </div>`;
    const overlay = modalRoot.querySelector('[data-role="overlay"]');
    const close = (result) => {
      modalRoot.innerHTML = '';
      resolve(result);
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });
    modalRoot.querySelector('[data-role="cancel"]').addEventListener('click', () => close(null));
    modalRoot.querySelectorAll('[data-choice-index]').forEach((btn) => {
      btn.addEventListener('click', () => close(choices[Number(btn.dataset.choiceIndex)].value));
    });
  });
}

/** Collega un input coordinate a un div-hint che mostra l'esito del parsing in tempo reale. */
export function bindCoordinateHint(inputEl, hintEl) {
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
export function bindMapButton(btnEl, coordInputEl, containerEl) {
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
export function mountPhotoGallery(containerId, images) {
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


export function openNomeForm({ title, nome = '', submitLabel, onSubmit }) {
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
    showToast('Salvato');
  });
}


export function showModal({ title, bodyHtml, confirmLabel = 'Conferma', cancelLabel = 'Annulla', danger = false }) {
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
