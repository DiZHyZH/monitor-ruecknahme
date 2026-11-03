-- Monitor-Rücknahme: gemeinsame Rollout-Listen
-- Einmal im Supabase SQL Editor ausführen (New query → einfügen → Run).
-- Sicherheit: Die App hat KEINEN direkten Tabellenzugriff. Alles läuft über
-- die Funktionen unten, und die prüfen bei jedem Aufruf Rollout-Titel + PIN.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.rollouts (
  code        text primary key,
  pin_hash    text not null,
  created_by  text,
  created_at  timestamptz not null default now()
);

create table if not exists public.scans (
  id          text primary key,
  rollout     text not null references public.rollouts(code) on delete cascade,
  asset       text not null,
  asset_norm  text generated always as (upper(regexp_replace(asset, '\s', '', 'g'))) stored,
  neu text, etage text, raum text, buero text, place text, cond text, note text,
  by          text,
  ts          bigint,
  deleted     boolean not null default false,
  updated_at  timestamptz not null default now()
);
create unique index if not exists scans_rollout_asset on public.scans (rollout, asset_norm) where not deleted;
create index if not exists scans_rollout_updated on public.scans (rollout, updated_at);

alter table public.rollouts enable row level security;
alter table public.scans    enable row level security;
-- keine Policies = kein direkter Zugriff für die App
revoke all on public.rollouts, public.scans from anon, authenticated;

-- PIN prüfen
create or replace function public.mr_check(p_code text, p_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from rollouts where code = p_code and pin_hash = crypt(p_pin, pin_hash)) then
    raise exception 'wrong_pin';
  end if;
end $$;

-- Rollout beitreten oder neu anlegen
create or replace function public.mr_join(p_code text, p_pin text, p_by text) returns text
language plpgsql security definer set search_path = public, extensions as $$
begin
  if length(coalesce(p_code,'')) < 4 or length(coalesce(p_pin,'')) < 4 then raise exception 'too_short'; end if;
  if not exists (select 1 from rollouts where code = p_code) then
    insert into rollouts(code, pin_hash, created_by) values (p_code, crypt(p_pin, gen_salt('bf')), p_by);
    return 'created';
  end if;
  perform mr_check(p_code, p_pin);
  return 'joined';
end $$;

-- Scan hinzufügen; doppelte Asset-ID => nur fehlende Felder ergänzen
create or replace function public.mr_add(p_code text, p_pin text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare ex scans; n text := upper(regexp_replace(p->>'asset', '\s', '', 'g'));
begin
  perform mr_check(p_code, p_pin);
  if coalesce(n,'') = '' then raise exception 'no_asset'; end if;
  select * into ex from scans where rollout = p_code and asset_norm = n and not deleted;
  if found then
    update scans set
      neu   = coalesce(nullif(neu,''),   nullif(p->>'neu','')),
      etage = coalesce(nullif(etage,''), nullif(p->>'etage','')),
      raum  = coalesce(nullif(raum,''),  nullif(p->>'raum','')),
      buero = coalesce(nullif(buero,''), nullif(p->>'buero','')),
      place = coalesce(nullif(place,''), nullif(p->>'place','')),
      note  = coalesce(nullif(note,''),  nullif(p->>'note','')),
      cond  = case when coalesce(cond,'ok') = 'ok' and coalesce(p->>'cond','ok') <> 'ok' then p->>'cond' else cond end,
      updated_at = now()
    where id = ex.id;
    return jsonb_build_object('status','dup','id',ex.id,'by',ex."by");
  end if;
  insert into scans(id, rollout, asset, neu, etage, raum, buero, place, cond, note, "by", ts)
  values (p->>'id', p_code, p->>'asset', p->>'neu', p->>'etage', p->>'raum', p->>'buero', p->>'place',
          coalesce(p->>'cond','ok'), p->>'note', p->>'by', (p->>'ts')::bigint)
  on conflict (id) do nothing;
  return jsonb_build_object('status','added','id',p->>'id');
end $$;

-- Änderungen seit Zeitpunkt holen (inkl. gelöschte, für den Abgleich)
create or replace function public.mr_list(p_code text, p_pin text, p_since timestamptz default 'epoch')
returns setof public.scans
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform mr_check(p_code, p_pin);
  return query select * from scans where rollout = p_code and updated_at > p_since order by updated_at;
end $$;

-- Eintrag löschen
create or replace function public.mr_delete(p_code text, p_pin text, p_id text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform mr_check(p_code, p_pin);
  update scans set deleted = true, updated_at = now() where rollout = p_code and id = p_id;
end $$;

revoke all on function public.mr_check(text,text) from public, anon, authenticated;
grant execute on function public.mr_join(text,text,text)            to anon;
grant execute on function public.mr_add(text,text,jsonb)            to anon;
grant execute on function public.mr_list(text,text,timestamptz)     to anon;
grant execute on function public.mr_delete(text,text,text)          to anon;
