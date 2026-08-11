// Widget quantità per le voci Lista: stessa filosofia di prezzo-widget.js (stato esterno,
// il widget si rimonta da solo dentro il suo container senza mai toccare il resto del form).
//
// Modalità disponibili:
//  - secca:           un numero fisso
//  - perGiorno:        valore × numero di giorni della vacanza
//  - perPersona:        valore × numero di persone (segue la vacanza, o personalizzato per la voce)
//  - perPersonaGiorno:  valore × persone × giorni
//
// ctx.modiDisponibili filtra quali pulsanti mostrare: le voci di un singolo giorno non hanno
// senso "per giorno" (sono già scoped a un giorno), quindi lì si passa solo ['secca', 'perPersona'].

import { escapeHtml } from '../utils.js';

const MODI_LABEL = {
  secca: { titolo: 'Secca', sub: 'Un numero fisso' },
  perGiorno: { titolo: 'Per giorno', sub: '× giorni vacanza' },
  perPersona: { titolo: 'Per persona', sub: '× persone' },
  perPersonaGiorno: { titolo: 'Per persona/giorno', sub: '× persone × giorni' },
};

/** Formatta un numero per la UI: intero senza decimali, altrimenti al massimo 1 decimale. */
export function formatQuantita(n) {
  if (n == null || Number.isNaN(n)) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
}

function calcolaAnteprima(state, ctx) {
  const valore = Number(state.valore) || 0;
  const persone = state.numeroPersone != null ? Number(state.numeroPersone) : ctx.vacanzaNumeroPersone;
  const giorni = ctx.numeroGiorni || 0;
  switch (state.modalita) {
    case 'perGiorno':
      return valore * giorni;
    case 'perPersona':
      return valore * persone;
    case 'perPersonaGiorno':
      return valore * persone * giorni;
    default:
      return valore;
  }
}

/** Riga di anteprima ("2 × 4 persone = 8 pz"): isolata in una funzione perché va rigenerata
 * sia nel render completo sia nell'aggiornamento leggero (che non tocca il resto del DOM,
 * per non far perdere il focus mentre si digita valore o unità). */
function anteprimaHtml(state, ctx) {
  const usaPersone = state.modalita === 'perPersona' || state.modalita === 'perPersonaGiorno';
  const usaGiorni = state.modalita === 'perGiorno' || state.modalita === 'perPersonaGiorno';
  const numeroEffettivo = state.numeroPersone != null ? state.numeroPersone : ctx.vacanzaNumeroPersone;
  const anteprima = calcolaAnteprima(state, ctx);
  const unitaLabel = state.unita ? ` ${escapeHtml(state.unita)}` : '';
  if (state.modalita === 'secca') {
    return `Quantità: <strong>${formatQuantita(anteprima)}${unitaLabel}</strong>`;
  }
  return `${formatQuantita(Number(state.valore) || 0)}${usaPersone ? ` × ${numeroEffettivo} person${numeroEffettivo === 1 ? 'a' : 'e'}` : ''}${usaGiorni ? ` × ${ctx.numeroGiorni} giorn${ctx.numeroGiorni === 1 ? 'o' : 'i'}` : ''} = <strong>${formatQuantita(anteprima)}${unitaLabel}</strong>`;
}

export function quantitaWidgetHtml(state, ctx) {
  const modi = ctx.modiDisponibili || ['secca', 'perGiorno', 'perPersona', 'perPersonaGiorno'];
  const personalizzato = state.numeroPersone != null;
  const numeroEffettivo = personalizzato ? state.numeroPersone : ctx.vacanzaNumeroPersone;
  const usaPersone = state.modalita === 'perPersona' || state.modalita === 'perPersonaGiorno';

  return `
    <div class="type-toggle ${modi.length > 2 ? 'type-toggle--grid2' : ''}" data-role="quantita-modalita-toggle">
      ${modi
        .map(
          (m) => `<button type="button" class="type-toggle-btn ${state.modalita === m ? 'is-selected' : ''}" data-modalita="${m}">
            <div class="type-toggle-title">${MODI_LABEL[m].titolo}</div>
            <div class="type-toggle-sub">${MODI_LABEL[m].sub}</div>
          </button>`
        )
        .join('')}
    </div>
    <div class="field-row">
      <div class="field">
        <label class="field-label">${state.modalita === 'secca' ? 'Quantità' : 'Quantità unitaria'}</label>
        <input type="number" name="quantitaValore" min="0" step="0.5" required value="${state.valore ?? ''}" data-role="quantita-valore-input">
      </div>
      <div class="field">
        <label class="field-label">Unità (opzionale)</label>
        <input type="text" name="quantitaUnita" placeholder="pz, bottiglie, confezioni..." value="${escapeHtml(state.unita || '')}" data-role="quantita-unita-input">
      </div>
    </div>
    ${
      usaPersone
        ? `<div class="field">
            ${
              personalizzato
                ? `<label class="field-label">Numero di persone per questa voce</label>
                  <input type="number" name="quantitaNumeroPersone" data-role="quantita-numero-persone-input" min="1" step="1" value="${numeroEffettivo}">
                  <button type="button" class="btn-inline-link" data-role="quantita-usa-vacanza">Usa il numero della vacanza (${ctx.vacanzaNumeroPersone}) invece</button>`
                : `<div class="field-label">Persone</div>
                  <div class="prezzo-persone-info">Segue la vacanza: <strong>${ctx.vacanzaNumeroPersone}</strong> · <button type="button" class="btn-inline-link" data-role="quantita-personalizza">Personalizza</button></div>`
            }
          </div>`
        : ''
    }
    <div class="hint" data-role="quantita-anteprima">${anteprimaHtml(state, ctx)}</div>`;
}

/** Monta il widget in modo autonomo dentro containerId: si ri-renderizza da solo a ogni
 * interazione, senza toccare il resto del form (stessa idea di mountPrezzoWidget). */
export function mountQuantitaWidget(containerId, state, ctx) {
  const container = document.getElementById(containerId);

  function render() {
    container.innerHTML = quantitaWidgetHtml(state, ctx);

    container.querySelector('[data-role="quantita-modalita-toggle"]').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-modalita]');
      if (!btn) return;
      state.modalita = btn.dataset.modalita;
      render();
    });

    function refreshAnteprima() {
      const el = container.querySelector('[data-role="quantita-anteprima"]');
      if (el) el.innerHTML = anteprimaHtml(state, ctx);
    }

    // Valore e unità non cambiano la struttura del widget (pulsanti, campo persone): basta
    // aggiornare la riga di anteprima, senza un render completo che farebbe perdere il focus
    // a ogni carattere digitato — importante soprattutto per l'unità, testo libero.
    const valoreInput = container.querySelector('[data-role="quantita-valore-input"]');
    valoreInput.addEventListener('input', () => {
      state.valore = valoreInput.value;
      refreshAnteprima();
    });

    const unitaInput = container.querySelector('[data-role="quantita-unita-input"]');
    unitaInput.addEventListener('input', () => {
      state.unita = unitaInput.value;
      refreshAnteprima();
    });

    const usaVacanzaBtn = container.querySelector('[data-role="quantita-usa-vacanza"]');
    if (usaVacanzaBtn) {
      usaVacanzaBtn.addEventListener('click', () => {
        state.numeroPersone = null;
        render();
      });
    }
    const personalizzaBtn = container.querySelector('[data-role="quantita-personalizza"]');
    if (personalizzaBtn) {
      personalizzaBtn.addEventListener('click', () => {
        state.numeroPersone = state.numeroPersoneEsplicito || ctx.vacanzaNumeroPersone;
        render();
      });
    }
    // Anche qui: il numero di persone digitato aggiorna solo l'anteprima, non l'intero widget,
    // altrimenti perderebbe il focus alla seconda cifra (es. digitando "12").
    const numeroInput = container.querySelector('[data-role="quantita-numero-persone-input"]');
    if (numeroInput) {
      numeroInput.addEventListener('input', () => {
        state.numeroPersoneEsplicito = Number(numeroInput.value) || 1;
        state.numeroPersone = state.numeroPersoneEsplicito;
        refreshAnteprima();
      });
    }
  }

  render();
}
