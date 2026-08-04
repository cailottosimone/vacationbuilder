export function prezzoWidgetHtml(prezzoState, vacanzaNumeroPersone) {
  const { modalita, importoTotale, importoAPersona, importoDaDividere, numeroPersone } = prezzoState;
  const personalizzato = numeroPersone != null;
  const numeroEffettivo = personalizzato ? numeroPersone : vacanzaNumeroPersone;
  const warning = personalizzato && numeroPersone > vacanzaNumeroPersone;
  return `
    <div class="type-toggle" data-role="modalita-toggle">
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
            ${
              personalizzato
                ? `<label class="field-label">Numero di persone per questa voce</label>
                  <input type="number" name="numeroPersone" data-role="numero-persone-input" min="1" step="1" value="${numeroEffettivo}">
                  <button type="button" class="btn-inline-link" data-role="usa-vacanza">Usa il numero della vacanza (${vacanzaNumeroPersone}) invece</button>
                  ${warning ? `<div class="hint" style="color:var(--red-dark);"><i class="fa-solid fa-triangle-exclamation"></i> Sono più delle ${vacanzaNumeroPersone} persone della vacanza.</div>` : ''}`
                : `<div class="field-label">Persone</div>
                  <div class="prezzo-persone-info">Segue la vacanza: <strong>${vacanzaNumeroPersone}</strong> · <button type="button" class="btn-inline-link" data-role="personalizza">Personalizza</button></div>`
            }
          </div>
          <div class="hint">Se il numero coincide con quello della vacanza, questa voce entra tra le <strong>condivise</strong> nel riepilogo Budget e si aggiorna da sola se in futuro cambi il numero di persone della vacanza. Se lo personalizzi, resta fisso a quello che scrivi, ed entra tra gli <strong>Extra</strong>.</div>`
    }`;
}

/** Monta il widget in modo autonomo: da qui in avanti si aggiorna da solo dentro containerId,
 * senza mai toccare il resto del form che lo ospita (niente più perdita di Descrizione/Categoria
 * /voce collegata al cambio modalità: prima si rigenerava tutto il form, ora solo questo blocco). */
export function mountPrezzoWidget(containerId, prezzoState, vacanzaNumeroPersone) {
  const container = document.getElementById(containerId);

  function render() {
    container.innerHTML = prezzoWidgetHtml(prezzoState, vacanzaNumeroPersone);

    container.querySelector('[data-role="modalita-toggle"]').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-modalita]');
      if (!btn) return;
      prezzoState.modalita = btn.dataset.modalita;
      render();
    });
    const usaVacanzaBtn = container.querySelector('[data-role="usa-vacanza"]');
    if (usaVacanzaBtn) {
      usaVacanzaBtn.addEventListener('click', () => {
        prezzoState.numeroPersone = null;
        render();
      });
    }
    const personalizzaBtn = container.querySelector('[data-role="personalizza"]');
    if (personalizzaBtn) {
      personalizzaBtn.addEventListener('click', () => {
        prezzoState.numeroPersone = prezzoState.numeroPersoneEsplicito || vacanzaNumeroPersone;
        render();
      });
    }
    const numeroInput = container.querySelector('[data-role="numero-persone-input"]');
    if (numeroInput) {
      numeroInput.addEventListener('input', () => {
        prezzoState.numeroPersoneEsplicito = Number(numeroInput.value) || 1;
        prezzoState.numeroPersone = prezzoState.numeroPersoneEsplicito;
        render();
      });
    }
  }

  render();
}

