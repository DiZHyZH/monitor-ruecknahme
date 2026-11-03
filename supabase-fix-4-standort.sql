-- Korrektur 4: Standort-Maske (Pflichtfelder pro Auftrag) und Einträge bearbeiten
-- Einmal im SQL Editor ausführen (neue, leere Query → alles einfügen → Run). Darf mehrfach laufen.

alter table public.jobs add column if not exists loc_req jsonb not null default '{}'::jsonb;

-- Pflichtfelder prüfen: was der Dispatcher eingeschaltet hat, muss ausgefüllt sein
create or replace function public.mr_check_loc(p_job uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb := coalesce((select loc_req from public.jobs where id = p_job), '{}'::jsonb); k text;
begin
  foreach k in array array['etage','raum','buero','place'] loop
    if coalesce((r->>k)::boolean, false) and trim(coalesce(p->>k, '')) = '' then raise exception 'missing_loc:%', k; end if;
  end loop;
end $$;

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
  v_req jsonb := jsonb_build_object(
    'etage', coalesce((p->'loc_req'->>'etage')::boolean, false), 'raum', coalesce((p->'loc_req'->>'raum')::boolean, false),
    'buero', coalesce((p->'loc_req'->>'buero')::boolean, false), 'place', coalesce((p->'loc_req'->>'place')::boolean, false));
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
    -- Soll: {"ab":{Typ:n}, "auf":{Typ:n}}; mindestens eine Zahl > 0
    if not exists (
      select 1 from jsonb_each(coalesce(s->'soll','{}'::jsonb)) d, jsonb_each_text(case when jsonb_typeof(d.value) = 'object' then d.value else jsonb_build_object(d.key, d.value) end) e
      where e.value ~ '^\d+$' and e.value::int > 0) then raise exception 'missing:soll:%', i; end if;
  end loop;

  first_label := coalesce(nullif(trim(v_sites->0->>'gebaeude'),''), trim(v_sites->0->>'ort'));
  base := upper(regexp_replace(first_label || '_' || v_kunde, '[^A-Za-z0-9ÄÖÜäöü]+', '_', 'g')) || '_' || to_char(v_datum, 'YYYY_MM_DD');
  base := regexp_replace(base, '_+', '_', 'g');

  if v_id is null then
    v_code := base;
    while exists (select 1 from public.jobs where code = v_code) loop n := n + 1; v_code := base || '_' || n; end loop;
    insert into public.jobs(code, art, kunde, datum, zeit_von, zeit_bis, wo, lead, material, loc_req, tausch, notes, created_by)
    values (v_code, v_art, v_kunde, v_datum, v_von, v_bis, nullif(trim(p->>'wo'),''), v_lead, coalesce(p->'material','[]'::jsonb), v_req,
            case when p->>'tausch' ~ '^(\d:\d|frei)$' then p->>'tausch' else '1:1' end, nullif(trim(p->>'notes'),''), auth.uid())
    returning id into v_id;
  else
    update public.jobs set art = v_art, kunde = v_kunde, datum = v_datum, zeit_von = v_von, zeit_bis = v_bis,
      wo = nullif(trim(p->>'wo'),''), lead = v_lead, material = coalesce(p->'material','[]'::jsonb), loc_req = v_req,
      tausch = case when p->>'tausch' ~ '^(\d:\d|frei)$' then p->>'tausch' else tausch end,
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

create or replace function public.scan_add(p_job uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare ex public.scans; n text := upper(regexp_replace(coalesce(p->>'asset',''), '\s', '', 'g')); v_site uuid := nullif(p->>'site_id','')::uuid;
  v_dir text := coalesce(nullif(p->>'dir',''), 'ab');
begin
  perform public.mr_need_job(p_job, true);
  if n = '' then raise exception 'no_asset'; end if;
  if v_dir not in ('ab','auf') then raise exception 'bad_dir'; end if;
  perform public.mr_check_loc(p_job, p);
  if v_site is null or not exists (select 1 from public.sites where id = v_site and job_id = p_job) then raise exception 'bad_site'; end if;
  select * into ex from public.scans where job_id = p_job and asset_norm = n and dir = v_dir and not deleted;
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
  insert into public.scans(id, job_id, site_id, dir, art, grp, asset, neu, etage, raum, buero, place, cond, note, "by", user_id, ts)
  values (p->>'id', p_job, v_site, v_dir, case when p->>'art' = 'tausch' then 'tausch' else 'einzeln' end, nullif(p->>'grp',''), p->>'asset', p->>'neu', p->>'etage', p->>'raum', p->>'buero', p->>'place',
          coalesce(p->>'cond','ok'), p->>'note', public.mr_me(), auth.uid(), (p->>'ts')::bigint);
  update public.jobs set status = 'aktiv', updated_at = now() where id = p_job and status = 'geplant';
  return jsonb_build_object('status','added','id',p->>'id');
end $$;

-- Eintrag bearbeiten: Lead, Dispatcher oder wer ihn erfasst hat
create or replace function public.scan_update(p_job uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare ex public.scans; v_site uuid; n text; k text;
begin
  perform public.mr_need_job(p_job, true);
  select * into ex from public.scans where job_id = p_job and id = p->>'id' and not deleted;
  if not found then raise exception 'not_found'; end if;
  if not (ex.user_id = auth.uid() or public.mr_is_lead(p_job)) then raise exception 'not_allowed'; end if;
  v_site := coalesce(nullif(p->>'site_id','')::uuid, ex.site_id);
  if not exists (select 1 from public.sites where id = v_site and job_id = p_job) then raise exception 'bad_site'; end if;
  n := upper(regexp_replace(coalesce(nullif(p->>'asset',''), ex.asset), '\s', '', 'g'));
  if exists (select 1 from public.scans where job_id = p_job and asset_norm = n and dir = ex.dir and not deleted and id <> ex.id) then raise exception 'dup_asset'; end if;
  perform public.mr_check_loc(p_job, jsonb_build_object('etage', coalesce(p->>'etage', ex.etage), 'raum', coalesce(p->>'raum', ex.raum), 'buero', coalesce(p->>'buero', ex.buero), 'place', coalesce(p->>'place', ex.place)));
  update public.scans set
    asset = coalesce(nullif(trim(p->>'asset'),''), asset), site_id = v_site,
    etage = case when p ? 'etage' then nullif(trim(p->>'etage'),'') else etage end,
    raum  = case when p ? 'raum'  then nullif(trim(p->>'raum'),'')  else raum end,
    buero = case when p ? 'buero' then nullif(trim(p->>'buero'),'') else buero end,
    place = case when p ? 'place' then nullif(trim(p->>'place'),'') else place end,
    cond  = case when p ? 'cond'  then coalesce(nullif(p->>'cond',''),'ok') else cond end,
    note  = case when p ? 'note'  then nullif(trim(p->>'note'),'') else note end,
    updated_at = now()
  where id = ex.id;
  return jsonb_build_object('status','updated','id',ex.id);
end $$;

revoke all on function public.mr_check_loc(uuid,jsonb) from public, anon, authenticated;
revoke all on function public.scan_update(uuid,jsonb) from public, anon;
grant execute on function public.scan_update(uuid,jsonb) to authenticated;
