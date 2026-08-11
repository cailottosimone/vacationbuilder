# Setup Supabase — Vacation Builder

Da fare una volta sola, nel pannello dello **stesso progetto Supabase già usato da Preventivi
Stampa 3D** (`xnkkacszdmrigudkwcio`): un solo account, schemi diversi per app, per restare dentro
ai limiti del piano gratuito. Se invece preferisci un progetto Supabase separato solo per Vacation
Builder, crealo prima e poi sostituisci `SUPABASE_URL`/`SUPABASE_ANON_KEY` in
`js/data/config.js` con quelli del nuovo progetto — il resto della procedura è identico.

## 1. Esegui lo schema

Dashboard → **SQL Editor** → New query → incolla tutto il contenuto di `schema.sql` → **Run**.

Crea:
- lo schema `vacationbuilder` con le 13 tabelle (una per store IndexedDB), la sicurezza per riga
  (RLS: ogni utente vede solo i propri dati) e un trigger che tiene `updatedAt` autorevole lato
  server (evita problemi di orologi non allineati tra i tuoi dispositivi);
- il bucket Storage `vacationbuilder-immagini` (privato) per le foto di destinazioni/tappe/
  vacanze, con la sua policy "solo i propri file".

## 2. Esponi lo schema via API — passaggio che si dimentica facilmente

Dashboard → **Project Settings** → **Data API** → sezione **Exposed schemas** → aggiungi
`vacationbuilder` alla lista (di default Supabase espone via API solo lo schema `public`; se hai
già collegato Preventivi Stampa 3D sullo stesso progetto, `preventivi3d` sarà già presente:
aggiungi `vacationbuilder` accanto, senza toccare quella riga).

Senza questo passaggio, ogni chiamata dal client fallisce con un errore tipo `schema
"vacationbuilder" not found` — è la causa più probabile se qualcosa non funziona al primo
collegamento.

## 3. (Facoltativo, solo se scegli di usare la registrazione via app)

Dashboard → **Authentication** → **Providers** → verifica che "Email" sia attivo (lo è di
default). Se vuoi disattivare la conferma via email al primo `Crea account` (comodo per un uso
solo personale, un account che crei una volta e usi sempre): **Authentication** → **Sign In /
Providers** → Email → disattiva "Confirm email". Se hai già fatto questo passaggio per Preventivi
Stampa 3D sullo stesso progetto, vale anche qui: è un'impostazione del progetto, non dello schema.

## 4. Verifica

Dopo il primo collegamento dall'app (tab **Impostazioni → Account e sincronizzazione**):
- Dashboard → **Table Editor** → schema `vacationbuilder` → dovresti vedere righe comparire nelle
  tabelle via via che salvi/modifichi destinazioni, tappe, vacanze...
- Dashboard → **Storage** → bucket `vacationbuilder-immagini` → dovresti vedere comparire un file
  per ogni foto caricata la prima volta (organizzati in una cartella per utente).

## Note

- Il piano gratuito mette in pausa il progetto dopo 7 giorni senza query: la prima
  sincronizzazione dopo una pausa richiede qualche secondo in più per il "risveglio", nessun dato
  viene perso.
- Nessuna chiave privata è presente nel codice: `js/data/config.js` contiene solo l'URL del
  progetto e la chiave `anon`, entrambe pubbliche per design — la sicurezza è nelle policy RLS
  create da `schema.sql` (sia sulle tabelle, sia sullo storage).
- **Quota**: il piano gratuito Supabase dà 500 MB di database e 1 GB di file Storage, condivisi
  fra tutti gli schemi/bucket dello stesso progetto (quindi anche con Preventivi Stampa 3D, se
  usi lo stesso account). Le foto di Vacation Builder pesano solo sulla quota Storage, non su
  quella database: ogni foto viene caricata una sola volta (per contenuto: la stessa immagine
  riusata altrove non occupa spazio una seconda volta) e non viene mai rimandata al cloud solo
  perché hai modificato il testo di un record — vedi `js/data/cloud.js`.
- Le foto restano comunque disponibili anche senza account collegato: il backup manuale (tab
  Impostazioni → Backup, export/import JSON) le include sempre, essendo un backup completo
  dell'archivio locale.
