-- ============================================================================
-- Vacation Builder — schema cloud per la sincronizzazione multi-dispositivo
-- ============================================================================
-- Da eseguire UNA VOLTA nell'SQL Editor del progetto Supabase condiviso della suite
-- (lo stesso già usato da Preventivi Stampa 3D: xnkkacszdmrigudkwcio — stesso account,
-- schema diverso, per non far collidere le tabelle restando dentro ai limiti del piano
-- gratuito). Idempotente: si può rieseguire senza effetti collaterali distruttivi (usa
-- "if not exists" ovunque possibile).
--
-- Convenzione deliberata: nomi di colonna in camelCase tra virgolette doppie, identici ai
-- campi usati lato client (js/db.js, js/repository/*.js). Evita di dover scrivere un
-- livello di mappatura camelCase ↔ snake_case nel client: un record IndexedDB si
-- invia/riceve così com'è, senza trasformazioni — tranne i campi immagine (vedi sotto),
-- che nella riga contengono percorsi Supabase Storage invece dei data URL locali.
--
-- Dopo aver eseguito questo script, due passaggi manuali nel pannello (vedi anche
-- supabase/README.md):
--  1. Project Settings → Data API → "Exposed schemas" → aggiungi "vacationbuilder"
--     (per default Supabase espone via API solo lo schema "public").
--  2. Creare il bucket Storage per le immagini: la parte finale di questo script lo fa
--     già via SQL (insert in storage.buckets + policy), non serve toccare il pannello.
-- ============================================================================

create schema if not exists vacationbuilder;

-- Permette al ruolo delle richieste autenticate (quello usato dal client con la sessione
-- utente) di vedere lo schema; l'accesso riga per riga resta comunque filtrato dalle
-- policy RLS sotto, questo grant apre solo la "porta dello schema".
grant usage on schema vacationbuilder to authenticated;

-- ----------------------------------------------------------------------------
-- Funzione di appoggio: timestamp "updatedAt" sempre autorevole lato server, per non
-- dipendere dall'orologio (potenzialmente sfasato) di ciascun dispositivo nel confronto
-- "chi ha l'ultima modifica" usato dal client per i conflitti.
-- ----------------------------------------------------------------------------
create or replace function vacationbuilder.set_updated_at()
returns trigger language plpgsql as $$
begin
  new."updatedAt" := now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- Macro per non ripetere 13 volte lo stesso boilerplate (RLS + policy + trigger + indice).
-- Eseguita più sotto per ciascuna tabella.
-- ----------------------------------------------------------------------------
create or replace function vacationbuilder._abilita_rls(nome_tabella text)
returns void language plpgsql as $$
begin
  execute format('alter table vacationbuilder.%I enable row level security', nome_tabella);

  execute format('drop policy if exists "solo i propri dati" on vacationbuilder.%I', nome_tabella);
  execute format(
    'create policy "solo i propri dati" on vacationbuilder.%I for all using ("userId" = auth.uid()) with check ("userId" = auth.uid())',
    nome_tabella
  );

  execute format('drop trigger if exists trg_updated_at on vacationbuilder.%I', nome_tabella);
  execute format(
    'create trigger trg_updated_at before insert or update on vacationbuilder.%I for each row execute function vacationbuilder.set_updated_at()',
    nome_tabella
  );

  execute format('create index if not exists %I on vacationbuilder.%I ("userId", "updatedAt")', 'idx_' || nome_tabella || '_user_updated', nome_tabella);

  execute format('grant select, insert, update, delete on vacationbuilder.%I to authenticated', nome_tabella);
end;
$$;

-- ============================================================================
-- Tabelle: una per store IndexedDB (vedi js/db.js ALL_STORES). "id" è l'UUID già
-- generato dal client (js/utils.js uuid()) — nessun id lato server. Eccezioni: tipiTappa e
-- categorieSpesa hanno anche voci seminate con id testuale fisso (slug, es. 'luogo',
-- 'cibo'), quindi la chiave è "text" e non "uuid" per quelle due.
--
-- Nessun vincolo di foreign key tra tabelle applicative (solo verso auth.users): stessa
-- scelta di Preventivi Stampa 3D, per restare robusti rispetto all'ordine con cui le righe
-- arrivano durante un ciclo di sincronizzazione e al soft delete (vedi "deletedAt" sotto,
-- che tiene le righe cancellate come tombstone invece di rimuoverle davvero).
--
-- Campi immagine ("immagini" su destinazioni/tappe/vacanze): nella riga cloud contengono un
-- array di PERCORSI Supabase Storage (stringhe brevi), mai i data URL base64 usati in
-- locale — vedi js/data/cloud.js e supabase/README.md per il bucket dedicato.
-- ============================================================================

create table if not exists vacationbuilder.destinazioni (
  id uuid primary key,
  "userId" uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text,
  note text,
  stato text,
  regione text,
  provincia text,
  coordinate jsonb,
  "categorieIds" jsonb,
  immagini jsonb,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz
);

create table if not exists vacationbuilder.tappe (
  id uuid primary key,
  "userId" uuid not null default auth.uid() references auth.users(id) on delete cascade,
  "destinazioneId" uuid,
  nome text,
  tipi jsonb,
  note text,
  "durataConsigliataMin" numeric,
  coordinate jsonb,
  immagini jsonb,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz
);

create table if not exists vacationbuilder.vacanze (
  id uuid primary key,
  "userId" uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text,
  "alloggiIds" jsonb,
  "dataInizio" date,
  "dataFine" date,
  "numeroPersone" integer,
  immagini jsonb,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz
);

create table if not exists vacationbuilder.giornate (
  id uuid primary key,
  "userId" uuid not null default auth.uid() references auth.users(id) on delete cascade,
  "vacanzaId" uuid,
  ordine integer,
  "alloggioId" uuid,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz
);

-- Le quattro tipologie di voce (tappa / partenza / rientro / spostamento) condividono la
-- stessa tabella, come già in IndexedDB: "tipoVoce" distingue quale sottoinsieme di colonne
-- è valorizzato per quella riga.
create table if not exists vacationbuilder."tappePianificate" (
  id uuid primary key,
  "userId" uuid not null default auth.uid() references auth.users(id) on delete cascade,
  "giornataId" uuid,
  "tipoVoce" text,
  ordine integer,
  "tappaId" uuid,
  "permanenzaMin" numeric,
  "oraFissata" text,
  ora text,
  "daRifTappaId" uuid,
  "aRifTappaId" uuid,
  mezzo text,
  "distanzaRealeKm" numeric,
  "durataRealeMin" numeric,
  "durataMin" numeric,
  note text,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz
);

create table if not exists vacationbuilder."tipiTappa" (
  id text primary key,
  "userId" uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text,
  ordine integer,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz
);

create table if not exists vacationbuilder."categorieDestinazione" (
  id uuid primary key,
  "userId" uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text,
  ordine integer,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz
);

create table if not exists vacationbuilder."categorieSpesa" (
  id text primary key,
  "userId" uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text,
  ordine integer,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz
);

create table if not exists vacationbuilder.spese (
  id uuid primary key,
  "userId" uuid not null default auth.uid() references auth.users(id) on delete cascade,
  "vacanzaId" uuid,
  "voceId" uuid,
  "categoriaId" text, -- riferimento a categorieSpesa.id (text: può essere uno slug seminato)
  descrizione text,
  modalita text, -- 'secco' | 'aPersona' | 'daDividere'
  "importoTotale" numeric,
  "importoAPersona" numeric,
  "importoDaDividere" numeric,
  "numeroPersone" integer,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz
);

create table if not exists vacationbuilder."listaVoci" (
  id uuid primary key,
  "userId" uuid not null default auth.uid() references auth.users(id) on delete cascade,
  "vacanzaId" uuid,
  "giornataId" uuid,
  testo text,
  fatto boolean,
  modalita text,
  "importoTotale" numeric,
  "importoAPersona" numeric,
  "importoDaDividere" numeric,
  "numeroPersone" integer,
  "contaNelTotale" boolean,
  "costoPerUnita" boolean,
  "quantitaModalita" text,
  "quantitaValore" numeric,
  "quantitaNumeroPersone" integer,
  "quantitaUnita" text,
  "luogoStoccaggioId" uuid,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz
);

create table if not exists vacationbuilder."listePredefinite" (
  id uuid primary key,
  "userId" uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz
);

create table if not exists vacationbuilder."vociPredefinite" (
  id uuid primary key,
  "userId" uuid not null default auth.uid() references auth.users(id) on delete cascade,
  "listaPredefinitaId" uuid,
  testo text,
  "quantitaModalita" text,
  "quantitaValore" numeric,
  "quantitaNumeroPersone" integer,
  "quantitaUnita" text,
  "luogoStoccaggioId" uuid,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz
);

create table if not exists vacationbuilder."luoghiStoccaggio" (
  id uuid primary key,
  "userId" uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text,
  ordine integer,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  "deletedAt" timestamptz
);

-- ============================================================================
-- RLS + trigger + indici: applicati a tutte le tabelle in un colpo solo.
-- ============================================================================
select vacationbuilder._abilita_rls(t) from unnest(array[
  'destinazioni', 'tappe', 'vacanze', 'giornate', 'tappePianificate', 'tipiTappa',
  'categorieDestinazione', 'categorieSpesa', 'spese', 'listaVoci',
  'listePredefinite', 'vociPredefinite', 'luoghiStoccaggio'
]) as t;

-- ============================================================================
-- Storage: bucket per le foto di destinazioni/tappe/vacanze (vedi js/data/cloud.js).
-- Privato (non "public"): l'accesso passa sempre dalla sessione autenticata del client,
-- mai da un URL pubblico indovinabile. Percorso di ogni file: "{userId}/{hash}.{ext}" —
-- la policy sotto verifica che il primo segmento del percorso combaci con l'utente
-- autenticato, stesso principio "solo i propri dati" delle tabelle sopra.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('vacationbuilder-immagini', 'vacationbuilder-immagini', false)
on conflict (id) do nothing;

drop policy if exists "solo le proprie immagini vacationbuilder" on storage.objects;
create policy "solo le proprie immagini vacationbuilder" on storage.objects
for all
using (bucket_id = 'vacationbuilder-immagini' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'vacationbuilder-immagini' and (storage.foldername(name))[1] = auth.uid()::text);
