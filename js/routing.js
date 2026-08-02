// routing.js — chiamate al servizio esterno di routing (Openrouteservice).
// Separato da repository.js apposta: repository.js parla solo con IndexedDB,
// qui invece parliamo con un servizio online, su richiesta esplicita dell'utente.

/** Profilo di routing ORS per ciascun mezzo di trasporto. null = nessun routing sensato. */
export const PROFILO_PER_MEZZO = {
  auto: 'driving-car',
  taxi: 'driving-car',
  bus: 'driving-car',
  bici: 'cycling-regular',
  piedi: 'foot-walking',
  aereo: null,
  treno: null,
  altro: null,
};

export function haRoutingDisponibile(mezzo) {
  return Boolean(PROFILO_PER_MEZZO[mezzo]);
}

/**
 * Calcola distanza (km) e durata (min) reali tra due punti, secondo il profilo dato.
 * Lancia un errore con un messaggio leggibile in caso di problemi (chiave mancante,
 * rete assente, punti non raggiungibili...).
 */
export async function calcolaDistanzaStrada(apiKey, origine, destinazione, profilo) {
  if (!apiKey) throw new Error('Manca la chiave Openrouteservice: impostala in Impostazioni → Routing.');
  if (!origine || !destinazione) throw new Error('Servono le coordinate di partenza e arrivo.');

  const url = `https://api.openrouteservice.org/v2/directions/${profilo}?api_key=${encodeURIComponent(apiKey)}&start=${origine.lng},${origine.lat}&end=${destinazione.lng},${destinazione.lat}`;

  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new Error('Servizio di routing non raggiungibile: controlla la connessione.');
  }

  if (!res.ok) {
    let msg = `Errore ${res.status} dal servizio di routing.`;
    try {
      const body = await res.json();
      if (body?.error?.message) msg = body.error.message;
    } catch {
      /* risposta non JSON, teniamo il messaggio generico */
    }
    if (res.status === 401 || res.status === 403) msg = 'Chiave Openrouteservice non valida o scaduta.';
    if (res.status === 429) msg = 'Limite giornaliero di richieste Openrouteservice raggiunto.';
    throw new Error(msg);
  }

  const data = await res.json();
  const summary = data?.features?.[0]?.properties?.summary;
  if (!summary) throw new Error('Risposta inattesa dal servizio di routing.');

  return { distanzaKm: summary.distance / 1000, durataMin: Math.round(summary.duration / 60) };
}
