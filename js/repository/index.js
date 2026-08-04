/**
 * Punto d'ingresso unico del repository: riesporta tutto da `archivio.js`, `vacanze.js` e
 * `budget.js`. Il resto dell'app continua a fare `import * as repo from './repository/index.js'`
 * e a chiamare `repo.qualcosa()` esattamente come prima dello split — questo file esiste solo
 * per non dover toccare tutte le chiamate sparse nell'app quando il repository è stato diviso
 * per dominio.
 */
export * from './archivio.js';
export * from './vacanze.js';
export * from './budget.js';
