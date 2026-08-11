import * as repo from '../repository/index.js';
import { escapeHtml, formatDate, minutesToTime } from '../utils.js';
import { computeOrariVoci, mezzoLabel, defaultAlloggioTappaId } from '../components/timeline.js';
import { openInspector, closeInspector, showModal } from '../components/dialog.js';
import { formatQuantita } from '../components/quantita-widget.js';

export function apriSelezioneStampa(vacanzaId) {
  openInspector(
    'Cosa vuoi stampare?',
    `<form id="form-stampa-selezione">
      <div class="field">
        <label class="chip-checkbox"><input type="checkbox" name="programma" checked><span>Programma giorno per giorno</span></label>
      </div>
      <div class="field">
        <label class="chip-checkbox"><input type="checkbox" name="budget"><span>Budget</span></label>
      </div>
      <div class="field">
        <label class="chip-checkbox"><input type="checkbox" name="lista"><span>Lista (valigia + giorni)</span></label>
      </div>
      <div class="inspector-footer">
        <button type="submit" class="btn btn-primary">Genera anteprima di stampa</button>
        <button type="button" class="btn btn-ghost" data-role="close-inspector">Annulla</button>
      </div>
    </form>`
  );

  document.getElementById('form-stampa-selezione').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const sezioni = {
      programma: fd.get('programma') === 'on',
      budget: fd.get('budget') === 'on',
      lista: fd.get('lista') === 'on',
    };
    if (!sezioni.programma && !sezioni.budget && !sezioni.lista) {
      await showModal({ title: 'Scegli almeno una sezione', confirmLabel: 'Ho capito' });
      return;
    }
    closeInspector();
    await stampaVacanza(vacanzaId, sezioni);
  });
}

export async function stampaVacanza(vacanzaId, sezioni = { programma: true, budget: false, lista: false }) {
  const vacanza = await repo.getVacanza(vacanzaId);
  const giornate = await repo.listGiornateByVacanza(vacanzaId);

  let corpoHtml = '';

  if (sezioni.programma) {
    const tipiList = await repo.listTipiTappa();
    const tipiById = Object.fromEntries(tipiList.map((t) => [t.id, t]));

    async function nomeTappa(id) {
      if (!id) return null;
      const t = await repo.getTappa(id);
      return t ? t.nome : null;
    }

    const destIds = await repo.listDestinazioneIdsUsateByVacanza(vacanzaId);
    const nomiDest = (await Promise.all(destIds.map(async (id) => (await repo.getDestinazione(id))?.nome))).filter(Boolean);
    const nomiAlloggi = (await Promise.all((vacanza.alloggiIds || []).map(nomeTappa))).filter(Boolean);
    const recapHtml = `
      <div><strong>Itinerario:</strong> ${escapeHtml(nomiDest.join(' → ') || '—')}</div>
      ${nomiAlloggi.length ? `<div><strong>Alloggi:</strong> ${escapeHtml(nomiAlloggi.join(', '))}</div>` : ''}
      <div><strong>Durata:</strong> ${giornate.length} giorn${giornate.length === 1 ? 'o' : 'i'}</div>`;

    const giorniHtml = [];
    for (let i = 0; i < giornate.length; i++) {
      const g = giornate[i];
      const voci = computeOrariVoci(await repo.listVociByGiornata(g.id));
      const destGiorno = await repo.getDestinazioniGiorno(g.id);
      const data = repo.dataGiorno(vacanza, i);
      const vociHtml = await Promise.all(voci.map((v) => printVoceHtml(v, tipiById, nomeTappa, vacanza, g)));
      giorniHtml.push(`
        <div class="print-giorno">
          <div class="print-giorno-titolo">Giorno ${i + 1}${data ? ` — ${formatDate(data)}` : ''}${destGiorno.length ? ` · ${escapeHtml(destGiorno.map((d) => d.nome).join(' · '))}` : ''}</div>
          ${vociHtml.length ? vociHtml.join('') : '<div class="print-voce-meta">Nessuna voce pianificata.</div>'}
        </div>`);
    }

    corpoHtml += `<div class="print-recap">${recapHtml}</div>${giorniHtml.join('')}`;
  }

  if (sezioni.budget) {
    corpoHtml += await printBudgetHtml(vacanza, giornate);
  }

  if (sezioni.lista) {
    corpoHtml += await printListaHtml(vacanza, giornate);
  }

  document.getElementById('print-area').innerHTML = `
    <div class="print-page">
      <div class="print-title">${escapeHtml(vacanza.nome)}</div>
      ${vacanza.dataInizio ? `<div class="print-voce-meta">${formatDate(vacanza.dataInizio)} → ${vacanza.dataFine ? formatDate(vacanza.dataFine) : '?'}</div>` : ''}
      ${corpoHtml}
      <div class="print-footer">Generato da Vacation Builder — ${new Date().toLocaleDateString('it-IT')}</div>
    </div>`;

  window.print();
}

export async function printBudgetHtml(vacanza, giornate = []) {
  const numeroGiorni = giornate.length;
  const spese = await repo.listSpeseByVacanza(vacanza.id);
  const categorie = await repo.listCategorieSpesa();
  const categorieById = Object.fromEntries(categorie.map((c) => [c.id, c]));
  const riepilogo = await repo.getRiepilogoBudget(vacanza.id);
  const listaConCosto = (await repo.listListaVociByVacanza(vacanza.id)).filter((v) => v.modalita && v.contaNelTotale !== false);

  const righeSpese = spese.map((s) => {
    const importo = repo.calcolaImportoRecord(s, vacanza, numeroGiorni);
    const cat = s.categoriaId ? categorieById[s.categoriaId] : null;
    const isCondivisa = repo.isRecordCondiviso(s, vacanza);
    return `<div class="print-voce">
      <div class="print-voce-corpo">
        <div class="print-voce-titolo">${escapeHtml(s.descrizione)}${cat ? ` · ${escapeHtml(cat.nome)}` : ''}</div>
        <div class="print-voce-meta">${isCondivisa ? 'Condivisa' : 'Extra'}</div>
      </div>
      <div class="print-voce-ora">${importo.toFixed(2)}€</div>
    </div>`;
  });

  const righeLista = listaConCosto.map((v) => {
    const importo = repo.calcolaImportoRecord(v, vacanza, numeroGiorni);
    const isCondivisa = repo.isRecordCondiviso(v, vacanza);
    const quantitaTotale = v.quantitaModalita ? repo.calcolaQuantitaTotale(v, vacanza, numeroGiorni) : null;
    return `<div class="print-voce">
      <div class="print-voce-corpo">
        <div class="print-voce-titolo">${escapeHtml(v.testo)}${quantitaTotale != null ? ` · ×${formatQuantita(quantitaTotale)}${v.quantitaUnita ? ` ${escapeHtml(v.quantitaUnita)}` : ''}` : ''}</div>
        <div class="print-voce-meta">da Lista · ${isCondivisa ? 'Condivisa' : 'Extra'}</div>
      </div>
      <div class="print-voce-ora">${importo.toFixed(2)}€</div>
    </div>`;
  });

  const righe = [...righeSpese, ...righeLista];

  return `
    <div class="print-giorno">
      <div class="print-giorno-titolo">Budget</div>
      ${righe.length ? righe.join('') : '<div class="print-voce-meta">Nessuna spesa registrata.</div>'}
      <div class="print-recap">
        <div><strong>Totale condiviso</strong> (÷ ${riepilogo.numeroPersone}): ${riepilogo.totaleCondiviso.toFixed(2)}€ — ${riepilogo.totaleAPersona ?? '—'}€ a persona</div>
        <div><strong>Extra:</strong> ${riepilogo.totaleExtra.toFixed(2)}€</div>
        <div><strong>Totale generale:</strong> ${riepilogo.totaleGenerale.toFixed(2)}€</div>
      </div>
    </div>`;
}

export async function printListaHtml(vacanza, giornate) {
  const generale = await repo.listListaVociGenerale(vacanza.id);
  const sezioniLista = [{ titolo: 'Lista generale (valigia)', voci: generale }];
  for (let i = 0; i < giornate.length; i++) {
    const voci = await repo.listListaVociGiorno(giornate[i].id);
    if (voci.length) sezioniLista.push({ titolo: `Lista Giorno ${i + 1}`, voci });
  }

  const haCostiChContano = sezioniLista.some((sez) => sez.voci.some((v) => v.modalita && v.contaNelTotale !== false));
  const notaCosti = haCostiChContano
    ? `<div class="print-recap"><em>I prezzi indicati qui sono già inclusi nel totale del Budget: non sommarli di nuovo.</em></div>`
    : '';

  const numeroGiorni = giornate.length;
  const sezioniHtml = sezioniLista
    .map((sez) => {
      const righeVoci = sez.voci.map((v) => {
        const importo = v.modalita ? repo.calcolaImportoRecord(v, vacanza, numeroGiorni) : null;
        const quantitaTotale = v.quantitaModalita ? repo.calcolaQuantitaTotale(v, vacanza, numeroGiorni) : null;
        return `<div class="print-voce">
          <div class="print-voce-corpo">
            <div class="print-voce-titolo">${v.fatto ? '☑' : '☐'} ${escapeHtml(v.testo)}${quantitaTotale != null ? ` · ×${formatQuantita(quantitaTotale)}${v.quantitaUnita ? ` ${escapeHtml(v.quantitaUnita)}` : ''}` : ''}</div>
          </div>
          ${importo != null ? `<div class="print-voce-ora">${importo.toFixed(2)}€</div>` : ''}
        </div>`;
      });
      return `
        <div class="print-giorno">
          <div class="print-giorno-titolo">${escapeHtml(sez.titolo)}</div>
          ${righeVoci.length ? righeVoci.join('') : '<div class="print-voce-meta">Nessuna voce.</div>'}
        </div>`;
    })
    .join('');

  return notaCosti + sezioniHtml + (await printRiepilogoLuoghiHtml(vacanza, sezioniLista, numeroGiorni));
}

/** Stessa somma "pezzi per luogo" della scheda Lista a schermo, ma su TUTTE le sezioni appena
 * stampate (generale + ogni giorno incluso in questa stampa). Solo se almeno una voce ha un
 * luogo assegnato — altrimenti sarebbe una tabella vuota che non aggiunge nulla alla stampa. */
async function printRiepilogoLuoghiHtml(vacanza, sezioniLista, numeroGiorni) {
  const tutteVoci = sezioniLista.flatMap((sez) => sez.voci);
  if (!tutteVoci.some((v) => v.luogoStoccaggioId)) return '';

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

  return `
    <div class="print-giorno">
      <div class="print-giorno-titolo">Riepilogo per luogo di stoccaggio</div>
      ${righe
        .map(
          (r) => `<div class="print-voce">
            <div class="print-voce-corpo"><div class="print-voce-titolo">${escapeHtml(r.nome)}</div></div>
            <div class="print-voce-ora">${formatQuantita(r.count)}</div>
          </div>`
        )
        .join('')}
      ${
        senzaLuogo
          ? `<div class="print-voce">
              <div class="print-voce-corpo"><div class="print-voce-titolo">Da assegnare</div></div>
              <div class="print-voce-ora">${formatQuantita(senzaLuogo)}</div>
            </div>`
          : ''
      }
    </div>`;
}

export async function printVoceHtml(voce, tipiById, nomeTappa, vacanza, giornata) {
  const ora = formatOrarioStampa(voce._inizio, voce._fine);

  if (voce.tipoVoce === 'partenza' || voce.tipoVoce === 'rientro') {
    const isPartenza = voce.tipoVoce === 'partenza';
    const rifId = (isPartenza ? voce.daRifTappaId : voce.aRifTappaId) || defaultAlloggioTappaId(vacanza, giornata);
    const nome = await nomeTappa(rifId);
    return `<div class="print-voce">
      <div class="print-voce-ora">${ora}</div>
      <div class="print-voce-corpo">
        <div class="print-voce-titolo">${isPartenza ? 'Partenza' : 'Rientro'}${nome ? ` — ${escapeHtml(nome)}` : ''}</div>
        ${voce.note ? `<div class="print-voce-note">${escapeHtml(voce.note)}</div>` : ''}
      </div>
    </div>`;
  }

  if (voce.tipoVoce === 'spostamento') {
    const daNome = await nomeTappa(voce.daRifTappaId);
    const aNome = await nomeTappa(voce.aRifTappaId);
    const percorso = daNome || aNome ? `${daNome || '?'} → ${aNome || '?'}` : '';
    const distanza = voce.distanzaRealeKm != null ? ` · ${voce.distanzaRealeKm.toFixed(1)} km` : '';
    return `<div class="print-voce">
      <div class="print-voce-ora">${ora}</div>
      <div class="print-voce-corpo">
        <div class="print-voce-titolo">Spostamento (${escapeHtml(mezzoLabel(voce.mezzo))})</div>
        ${percorso ? `<div class="print-voce-meta">${escapeHtml(percorso)}${distanza}</div>` : ''}
        ${voce.note ? `<div class="print-voce-note">${escapeHtml(voce.note)}</div>` : ''}
      </div>
    </div>`;
  }

  // tipoVoce === 'tappa'
  const tappa = voce.tappaId ? await repo.getTappa(voce.tappaId) : null;
  const tipo = tappa ? tipiById[(tappa.tipi || [])[0]] : null;
  return `<div class="print-voce">
    <div class="print-voce-ora">${ora}</div>
    <div class="print-voce-corpo">
      <div class="print-voce-titolo">${escapeHtml(tappa ? tappa.nome : 'Tappa eliminata')}</div>
      ${tipo ? `<div class="print-voce-meta">${escapeHtml(tipo.nome)}</div>` : ''}
      ${voce.note ? `<div class="print-voce-note">${escapeHtml(voce.note)}</div>` : ''}
    </div>
  </div>`;
}

export function formatOrarioStampa(inizio, fine) {
  if (inizio == null) return '?';
  if (fine == null || fine === inizio) return minutesToTime(inizio);
  return `${minutesToTime(inizio)}–${minutesToTime(fine)}`;
}

