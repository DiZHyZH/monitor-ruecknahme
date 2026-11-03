-- Korrektur 3: Aufträge mit Rollen, Standorten, Einladungen und Material
-- Einmal im Supabase SQL Editor ausführen (neue, leere Query → alles einfügen → Run).
-- Darf mehrfach ausgeführt werden. Bestehende Daten bleiben erhalten.

-- ===== Rollen =====
alter table public.profiles add column if not exists role text not null default 'tech';
do $$ begin
  alter table public.profiles add constraint profiles_role_chk check (role in ('admin','dispatcher','tech'));
exception when duplicate_object then null; end $$;

create or replace function public.mr_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'tech');
$$;
create or replace function public.mr_is_disp() returns boolean
language sql stable security definer set search_path = public as $$
  select public.mr_role() in ('admin','dispatcher');
$$;

-- ===== Materialkatalog =====
create table if not exists public.material_catalog (
  name       text primary key,
  sort       int  not null default 100,
  mitnehmen  boolean not null default true,
  verbrauch  boolean not null default true,
  active     boolean not null default true
);
insert into public.material_catalog(name, sort, mitnehmen, verbrauch) values
  ('Klett', 10, true, true),
  ('Schraubenzieher', 20, true, false),
  ('HDMI 1 m', 30, true, true), ('HDMI 2 m', 31, true, true), ('HDMI 3 m', 32, true, true),
  ('DisplayPort 1 m', 40, true, true), ('DisplayPort 2 m', 41, true, true), ('DisplayPort 3 m', 42, true, true),
  ('LAN 0.5 m', 50, true, true), ('LAN 1 m', 51, true, true), ('LAN 2 m', 52, true, true), ('LAN 3 m', 53, true, true), ('LAN 5 m', 54, true, true)
on conflict (name) do nothing;

-- ===== Aufträge =====
create table if not exists public.jobs (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  art         text not null check (art in ('rollout','tour')),
  kunde       text not null,
  datum       date not null,
  zeit_von    text not null,
  zeit_bis    text not null,
  wo          text,
  lead        uuid references public.profiles(id),
  material    jsonb not null default '[]'::jsonb,
  notes       text,
  status      text not null default 'geplant' check (status in ('geplant','aktiv','abgeschlossen')),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  closed_at   timestamptz
);
create table if not exists public.sites (
  id        uuid primary key,
  job_id    uuid not null references public.jobs(id) on delete cascade,
  pos       int not null default 1,
  gebaeude  text,
  strasse   text not null,
  plz       text not null,
  ort       text not null,
  kontakt   text not null,
  telefon   text not null,
  zutritt   text,
  soll      jsonb not null default '{}'::jsonb
);
create index if not exists sites_job on public.sites(job_id);
create table if not exists public.job_members (
  job_id   uuid not null references public.jobs(id) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (job_id, user_id)
);
create table if not exists public.invites (
  token      text primary key,
  job_id     uuid not null references public.jobs(id) on delete cascade,
  created_by uuid,
  expires_at timestamptz not null
);

-- Scans gehören ab jetzt zu Auftrag + Standort
alter table public.scans alter column rollout drop not null;
alter table public.scans add column if not exists job_id  uuid references public.jobs(id) on delete cascade;
alter table public.scans add column if not exists site_id uuid;
create unique index if not exists scans_job_asset on public.scans (job_id, asset_norm) where not deleted and job_id is not null;
create index if not exists scans_job_updated on public.scans (job_id, updated_at);

create table if not exists public.material_used (
  id         text primary key,
  job_id     uuid not null references public.jobs(id) on delete cascade,
  site_id    uuid not null,
  item       text not null,
  qty        int  not null default 0,
  etage text, raum text, place text, note text,
  "by"       text,
  user_id    uuid,
  ts         bigint,
  deleted    boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists mat_job_updated on public.material_used (job_id, updated_at);

alter table public.material_catalog enable row level security;
alter table public.jobs          enable row level security;
alter table public.sites         enable row level security;
alter table public.job_members   enable row level security;
alter table public.invites       enable row level security;
alter table public.material_used enable row level security;
revoke all on public.material_catalog, public.jobs, public.sites, public.job_members, public.invites, public.material_used from anon, authenticated;

-- ===== Hilfsfunktionen =====
create or replace function public.mr_can_job(p_job uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.mr_is_disp()
      or exists (select 1 from public.jobs j where j.id = p_job and j.lead = auth.uid())
      or exists (select 1 from public.job_members m where m.job_id = p_job and m.user_id = auth.uid());
$$;
create or replace function public.mr_is_lead(p_job uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.mr_is_disp() or exists (select 1 from public.jobs j where j.id = p_job and j.lead = auth.uid());
$$;
create or replace function public.mr_need_job(p_job uuid, p_write boolean) returns void
language plpgsql security definer set search_path = public as $$
declare st text;
begin
  perform public.mr_auth();
  if not public.mr_can_job(p_job) then raise exception 'no_access'; end if;
  if p_write then
    select status into st from public.jobs where id = p_job;
    if st = 'abgeschlossen' and not public.mr_is_disp() then raise exception 'job_closed'; end if;
  end if;
end $$;

create or replace function public.mr_job_json(j public.jobs) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(j) - 'created_by'
    || jsonb_build_object(
      'lead_name', (select name from public.profiles where id = j.lead),
      'is_lead', (j.lead = auth.uid()),
      'sites', coalesce((select jsonb_agg(to_jsonb(s) - 'job_id' order by s.pos) from public.sites s where s.job_id = j.id), '[]'::jsonb),
      'members', coalesce((select jsonb_agg(p.name order by p.name) from public.job_members m join public.profiles p on p.id = m.user_id where m.job_id = j.id), '[]'::jsonb),
      'scan_count', (select count(*) from public.scans s where s.job_id = j.id and not s.deleted)
    );
$$;

-- ===== Benutzer & Rollen =====
create or replace function public.app_me() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.mr_auth();
  return (select jsonb_build_object('id', id, 'name', name, 'email', email, 'role', role) from public.profiles where id = auth.uid());
end $$;

create or replace function public.app_users() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.mr_auth();
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name,
            'email', case when public.mr_is_disp() then email end, 'role', role) order by name)
          from public.profiles), '[]'::jsonb);
end $$;

create or replace function public.app_set_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.mr_auth();
  if public.mr_role() <> 'admin' then raise exception 'admin_only'; end if;
  if p_role not in ('admin','dispatcher','tech') then raise exception 'bad_role'; end if;
  if p_user = auth.uid() and p_role <> 'admin' then raise exception 'cannot_demote_self'; end if;
  update public.profiles set role = p_role where id = p_user;
end $$;

-- ===== Aufträge anlegen / ändern (nur Dispatcher) =====
create or replace function public.job_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid := nullif(p->>'id','')::uuid;
  v_art text := p->>'art';
  v_kunde text := trim(coalesce(p->>'kunde',''));
  v_datum date := nullif(p->>'datum','')::date;
  v_von text := trim(coalesce(p->>'zeit_von',''));
  v_bis text := trim(coalesce(p->>'zeit_bis',''));
  v_lead uuid := nullif(p->>'lead','')::uuid;
  v_sites jsonb := coalesce(p->'sites','[]'::jsonb);
  s jsonb; i int := 0; v_code text; base text; n int := 1; keep uuid[] := '{}';
  first_label text;
begin
  perform public.mr_auth();
  if not public.mr_is_disp() then raise exception 'dispatcher_only'; end if;
  if v_art not in ('rollout','tour') then raise exception 'missing:art'; end if;
  if v_kunde = '' then raise exception 'missing:kunde'; end if;
  if v_datum is null then raise exception 'missing:datum'; end if;
  if v_id is null and v_datum < current_date then raise exception 'past:datum'; end if;
  if v_von = '' or v_bis = '' then raise exception 'missing:zeit'; end if;
  if v_lead is null or not exists (select 1 from public.profiles where id = v_lead) then raise exception 'missing:lead'; end if;
  if jsonb_typeof(v_sites) <> 'array' or jsonb_array_length(v_sites) = 0 then raise exception 'missing:sites'; end if;
  if v_art = 'rollout' and jsonb_array_length(v_sites) > 1 then raise exception 'rollout_one_site'; end if;
  for s in select * from jsonb_array_elements(v_sites) loop
    i := i + 1;
    if trim(coalesce(s->>'strasse','')) = '' or trim(coalesce(s->>'plz','')) = '' or trim(coalesce(s->>'ort','')) = '' then raise exception 'missing:adresse:%', i; end if;
    if trim(coalesce(s->>'kontakt','')) = '' or trim(coalesce(s->>'telefon','')) = '' then raise exception 'missing:kontakt:%', i; end if;
    if not exists (select 1 from jsonb_each_text(coalesce(s->'soll','{}'::jsonb)) e where e.value ~ '^\d+$' and e.value::int > 0) then raise exception 'missing:soll:%', i; end if;
  end loop;

  first_label := coalesce(nullif(trim(v_sites->0->>'gebaeude'),''), trim(v_sites->0->>'ort'));
  base := upper(regexp_replace(first_label || '_' || v_kunde, '[^A-Za-z0-9ÄÖÜäöü]+', '_', 'g')) || '_' || to_char(v_datum, 'YYYY_MM_DD');
  base := regexp_replace(base, '_+', '_', 'g');

  if v_id is null then
    v_code := base;
    while exists (select 1 from public.jobs where code = v_code) loop n := n + 1; v_code := base || '_' || n; end loop;
    insert into public.jobs(code, art, kunde, datum, zeit_von, zeit_bis, wo, lead, material, notes, created_by)
    values (v_code, v_art, v_kunde, v_datum, v_von, v_bis, nullif(trim(p->>'wo'),''), v_lead, coalesce(p->'material','[]'::jsonb), nullif(trim(p->>'notes'),''), auth.uid())
    returning id into v_id;
  else
    update public.jobs set art = v_art, kunde = v_kunde, datum = v_datum, zeit_von = v_von, zeit_bis = v_bis,
      wo = nullif(trim(p->>'wo'),''), lead = v_lead, material = coalesce(p->'material','[]'::jsonb),
      notes = nullif(trim(p->>'notes'),''), updated_at = now()
    where id = v_id;
    if not found then raise exception 'not_found'; end if;
  end if;

  i := 0;
  for s in select * from jsonb_array_elements(v_sites) loop
    i := i + 1;
    keep := keep || coalesce(nullif(s->>'id','')::uuid, gen_random_uuid());
    insert into public.sites(id, job_id, pos, gebaeude, strasse, plz, ort, kontakt, telefon, zutritt, soll)
    values (keep[i], v_id, i, nullif(trim(s->>'gebaeude'),''), trim(s->>'strasse'), trim(s->>'plz'), trim(s->>'ort'),
            trim(s->>'kontakt'), trim(s->>'telefon'), nullif(trim(s->>'zutritt'),''), coalesce(s->'soll','{}'::jsonb))
    on conflict (id) do update set pos = excluded.pos, gebaeude = excluded.gebaeude, strasse = excluded.strasse, plz = excluded.plz,
      ort = excluded.ort, kontakt = excluded.kontakt, telefon = excluded.telefon, zutritt = excluded.zutritt, soll = excluded.soll
    where public.sites.job_id = v_id;
  end loop;
  -- entfernte Standorte löschen, aber nur wenn dort nichts erfasst wurde
  if exists (select 1 from public.sites st where st.job_id = v_id and not (st.id = any(keep))
             and (exists (select 1 from public.scans x where x.site_id = st.id and not x.deleted)
               or exists (select 1 from public.material_used x where x.site_id = st.id and not x.deleted and x.qty > 0))) then
    raise exception 'site_has_data';
  end if;
  delete from public.sites st where st.job_id = v_id and not (st.id = any(keep));

  return (select public.mr_job_json(j) from public.jobs j where j.id = v_id);
end $$;

create or replace function public.job_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.mr_auth();
  return coalesce((select jsonb_agg(public.mr_job_json(j) order by (j.status = 'abgeschlossen'), j.datum, j.zeit_von)
    from public.jobs j where public.mr_can_job(j.id)
      and (j.status <> 'abgeschlossen' or j.closed_at > now() - interval '60 days' or public.mr_is_disp())), '[]'::jsonb);
end $$;

create or replace function public.job_set_status(p_job uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cur text;
begin
  perform public.mr_auth();
  if p_status not in ('geplant','aktiv','abgeschlossen') then raise exception 'bad_status'; end if;
  select status into cur from public.jobs where id = p_job;
  if cur is null then raise exception 'not_found'; end if;
  if p_status = 'aktiv' and cur = 'geplant' then
    if not public.mr_can_job(p_job) then raise exception 'no_access'; end if;
  elsif p_status = 'abgeschlossen' then
    if not public.mr_is_lead(p_job) then raise exception 'lead_only'; end if;
  elsif not public.mr_is_disp() then raise exception 'dispatcher_only';
  end if;
  update public.jobs set status = p_status, updated_at = now(),
    closed_at = case when p_status = 'abgeschlossen' then now() else null end where id = p_job;
  return (select public.mr_job_json(j) from public.jobs j where j.id = p_job);
end $$;

create or replace function public.job_delete(p_job uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.mr_auth();
  if not public.mr_is_disp() then raise exception 'dispatcher_only'; end if;
  if exists (select 1 from public.scans where job_id = p_job and not deleted) and public.mr_role() <> 'admin' then raise exception 'job_has_data'; end if;
  delete from public.jobs where id = p_job;
end $$;

-- ===== Einladen per QR =====
create or replace function public.invite_create(p_job uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare t text := encode(gen_random_bytes(12), 'hex'); exp timestamptz := now() + interval '24 hours';
begin
  perform public.mr_auth();
  if not public.mr_is_lead(p_job) then raise exception 'lead_only'; end if;
  delete from public.invites where expires_at < now();
  insert into public.invites(token, job_id, created_by, expires_at) values (t, p_job, auth.uid(), exp);
  return jsonb_build_object('token', t, 'expires_at', exp);
end $$;

create or replace function public.invite_accept(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_job uuid;
begin
  perform public.mr_auth();
  select job_id into v_job from public.invites where token = p_token and expires_at > now();
  if v_job is null then raise exception 'invite_invalid'; end if;
  if (select status from public.jobs where id = v_job) = 'abgeschlossen' then raise exception 'job_closed'; end if;
  insert into public.job_members(job_id, user_id) values (v_job, auth.uid()) on conflict do nothing;
  return (select public.mr_job_json(j) from public.jobs j where j.id = v_job);
end $$;

-- ===== Geräte erfassen =====
create or replace function public.scan_add(p_job uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare ex public.scans; n text := upper(regexp_replace(coalesce(p->>'asset',''), '\s', '', 'g')); v_site uuid := nullif(p->>'site_id','')::uuid;
begin
  perform public.mr_need_job(p_job, true);
  if n = '' then raise exception 'no_asset'; end if;
  if v_site is null or not exists (select 1 from public.sites where id = v_site and job_id = p_job) then raise exception 'bad_site'; end if;
  select * into ex from public.scans where job_id = p_job and asset_norm = n and not deleted;
  if found then
    update public.scans set
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
  if exists (select 1 from public.scans where id = p->>'id') then
    return jsonb_build_object('status','added','id',p->>'id');
  end if;
  insert into public.scans(id, job_id, site_id, asset, neu, etage, raum, buero, place, cond, note, "by", user_id, ts)
  values (p->>'id', p_job, v_site, p->>'asset', p->>'neu', p->>'etage', p->>'raum', p->>'buero', p->>'place',
          coalesce(p->>'cond','ok'), p->>'note', public.mr_me(), auth.uid(), (p->>'ts')::bigint);
  update public.jobs set status = 'aktiv', updated_at = now() where id = p_job and status = 'geplant';
  return jsonb_build_object('status','added','id',p->>'id');
end $$;

create or replace function public.scan_list(p_job uuid, p_since timestamptz default 'epoch') returns setof public.scans
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.mr_need_job(p_job, false);
  return query select * from public.scans where job_id = p_job and updated_at > p_since order by updated_at;
end $$;

create or replace function public.scan_delete(p_job uuid, p_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.mr_need_job(p_job, true);
  update public.scans set deleted = true, updated_at = now()
  where job_id = p_job and id = p_id and (user_id = auth.uid() or public.mr_is_lead(p_job));
  if not found then raise exception 'not_allowed'; end if;
end $$;

-- ===== Material =====
create or replace function public.mat_set(p_job uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_site uuid := nullif(p->>'site_id','')::uuid; v_qty int := coalesce((p->>'qty')::int, 0);
begin
  perform public.mr_need_job(p_job, true);
  if v_site is null or not exists (select 1 from public.sites where id = v_site and job_id = p_job) then raise exception 'bad_site'; end if;
  if trim(coalesce(p->>'item','')) = '' then raise exception 'no_item'; end if;
  insert into public.material_used(id, job_id, site_id, item, qty, etage, raum, place, note, "by", user_id, ts, deleted, updated_at)
  values (p->>'id', p_job, v_site, trim(p->>'item'), greatest(v_qty,0), p->>'etage', p->>'raum', p->>'place', p->>'note',
          public.mr_me(), auth.uid(), (p->>'ts')::bigint, v_qty <= 0, now())
  on conflict (id) do update set qty = greatest(excluded.qty,0), etage = excluded.etage, raum = excluded.raum, place = excluded.place,
    note = excluded.note, deleted = excluded.qty <= 0, updated_at = now()
  where public.material_used.job_id = p_job;
end $$;

create or replace function public.mat_list(p_job uuid, p_since timestamptz default 'epoch') returns setof public.material_used
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.mr_need_job(p_job, false);
  return query select * from public.material_used where job_id = p_job and updated_at > p_since order by updated_at;
end $$;

create or replace function public.catalog_get() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.mr_auth();
  return coalesce((select jsonb_agg(to_jsonb(c) order by c.sort, c.name) from public.material_catalog c where c.active), '[]'::jsonb);
end $$;

create or replace function public.catalog_set(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare e jsonb; i int := 0;
begin
  perform public.mr_auth();
  if not public.mr_is_disp() then raise exception 'dispatcher_only'; end if;
  update public.material_catalog set active = false;
  for e in select * from jsonb_array_elements(p) loop
    i := i + 1;
    if trim(coalesce(e->>'name','')) <> '' then
      insert into public.material_catalog(name, sort, mitnehmen, verbrauch, active)
      values (trim(e->>'name'), i * 10, coalesce((e->>'mitnehmen')::boolean, true), coalesce((e->>'verbrauch')::boolean, true), true)
      on conflict (name) do update set sort = excluded.sort, mitnehmen = excluded.mitnehmen, verbrauch = excluded.verbrauch, active = true;
    end if;
  end loop;
end $$;

-- ===== Rechte =====
do $$ declare f text; begin
  foreach f in array array['mr_role()','mr_is_disp()','mr_can_job(uuid)','mr_is_lead(uuid)','mr_need_job(uuid,boolean)','mr_job_json(public.jobs)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['app_me()','app_users()','app_set_role(uuid,text)','job_save(jsonb)','job_list()','job_set_status(uuid,text)','job_delete(uuid)',
                           'invite_create(uuid)','invite_accept(text)','scan_add(uuid,jsonb)','scan_list(uuid,timestamptz)','scan_delete(uuid,text)',
                           'mat_set(uuid,jsonb)','mat_list(uuid,timestamptz)','catalog_get()','catalog_set(jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
