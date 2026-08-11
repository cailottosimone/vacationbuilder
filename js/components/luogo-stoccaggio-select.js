// Select "Luogo di stoccaggio" + pulsante di creazione rapida. A differenza di prezzo-widget.js
// e quantita-widget.js (puro stato + HTML, nessun accesso al repository), questo componente
// PARLA col repository di proposito: il suo unico compito — creare al volo un nuovo luogo senza
// far perdere il form aperto sotto (l'inspector è un'istanza unica, vedi showPromptModal in
// dialog.js) — è indissociabile dal salvataggio. Non è quindi un widget di stato "puro" come gli
// altri due: è una scelta consapevole, non una svista di coerenza architetturale.

import { escapeHtml } from '../utils.js';
import { showPromptModal } from './dialog.js';
import { createLuogoStoccaggio } from '../repository/budget.js';

export function luogoSelectHtml(luoghi, selectedId, { selectId, addBtnId }) {
  return `<div class="select-with-add">
    <select name="luogoStoccaggioId" id="${selectId}">
      <option value="">— nessuno —</option>
      ${luoghi.map((l) => `<option value="${l.id}" ${selectedId === l.id ? 'selected' : ''}>${escapeHtml(l.nome)}</option>`).join('')}
    </select>
    <button type="button" class="btn btn-icon btn-ghost" id="${addBtnId}" title="Nuovo luogo di stoccaggio"><i class="fa-solid fa-plus"></i></button>
  </div>`;
}

/** Aggiunge subito la nuova opzione al <select> esistente (non ricarica/ridisegna il form intorno):
 * è l'unico modo per non perdere gli altri campi già compilati dall'utente in quel momento. */
export function bindLuogoQuickAdd(selectId, addBtnId) {
  const btn = document.getElementById(addBtnId);
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const nome = await showPromptModal({ title: 'Nuovo luogo di stoccaggio', placeholder: 'Es. Zaino blu', confirmLabel: 'Crea' });
    if (!nome) return;
    const record = await createLuogoStoccaggio({ nome });
    const select = document.getElementById(selectId);
    if (!select) return;
    const opt = document.createElement('option');
    opt.value = record.id;
    opt.textContent = record.nome;
    select.appendChild(opt);
    select.value = record.id;
  });
}
