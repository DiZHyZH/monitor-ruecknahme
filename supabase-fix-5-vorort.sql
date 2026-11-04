-- Name in Supabase: 06 Ort vor Ort erfassen
-- Korrektur 5: Plätze mit «Ort wird vor Ort erfasst» (Etage/Raum trägt der Techniker ein, Pflicht).
-- Die geplante Menge und die Gerätetypen gelten weiterhin: Ungeplantes geht nicht.
-- Einmal im SQL Editor ausführen (neue, leere Query → alles einfügen → Run). Darf mehrfach laufen.

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
  first_label text; pz jsonb; pk int; v_pl jsonb; v_soll jsonb;
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
    if coalesce(jsonb_typeof(s->'plaetze'),'') <> 'array' or jsonb_array_length(s->'plaetze') = 0 then raise exception 'missing:plaetze:%', i; end if;
    pk := 0;
    for pz in select * from jsonb_array_elements(s->'plaetze') loop
      pk := pk + 1;
      if coalesce((pz->>'frei')::boolean, false) is false and (trim(coalesce(pz->>'etage','')) = '' or trim(coalesce(pz->>'raum','')) = '') then raise exception 'missing:platz_ort:%:%', i, pk; end if;
      if coalesce(pz->>'art','') not in ('tausch','auf','ab') then raise exception 'missing:platz_art:%:%', i, pk; end if;
      if pz->>'art' in ('tausch','ab') and public.mr_sum(pz->'soll'->'ab') = 0 then raise exception 'missing:platz_ab:%:%', i, pk; end if;
      if pz->>'art' in ('tausch','auf') and public.mr_sum(pz->'soll'->'auf') = 0 then raise exception 'missing:platz_auf:%:%', i, pk; end if;
    end loop;
  end loop;

  first_label := coalesce(nullif(trim(v_sites->0->>'gebaeude'),''), trim(v_sites->0->>'ort'));
  base := upper(regexp_replace(first_label || '_' || v_kunde, '[^A-Za-z0-9ÄÖÜäöü]+', '_', 'g')) || '_' || to_char(v_datum, 'YYYY_MM_DD');
  base := regexp_replace(base, '_+', '_', 'g');

  if v_id is null then
    v_code := base;
    while exists (select 1 from public.jobs where code = v_code) loop n := n + 1; v_code := base || '_' || n; end loop;
    insert into public.jobs(code, art, kunde, datum, zeit_von, zeit_bis, wo, lead, material, tausch, notes, created_by)
    values (v_code, v_art, v_kunde, v_datum, v_von, v_bis, nullif(trim(p->>'wo'),''), v_lead, coalesce(p->'material','[]'::jsonb),
            case when p->>'tausch' ~ '^(\d:\d|frei)$' then p->>'tausch' else '1:1' end, nullif(trim(p->>'notes'),''), auth.uid())
    returning id into v_id;
  else
    update public.jobs set art = v_art, kunde = v_kunde, datum = v_datum, zeit_von = v_von, zeit_bis = v_bis,
      wo = nullif(trim(p->>'wo'),''), lead = v_lead, material = coalesce(p->'material','[]'::jsonb),
      tausch = case when p->>'tausch' ~ '^(\d:\d|frei)$' then p->>'tausch' else tausch end,
      notes = nullif(trim(p->>'notes'),''), updated_at = now()
    where id = v_id;
    if not found then raise exception 'not_found'; end if;
  end if;

  i := 0;
  for s in select * from jsonb_array_elements(v_sites) loop
    i := i + 1;
    keep := keep || coalesce(nullif(s->>'id','')::uuid, gen_random_uuid());
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', coalesce(nullif(e->>'id',''), gen_random_uuid()::text),
        'frei', coalesce((e->>'frei')::boolean, false),
        'etage', nullif(trim(coalesce(e->>'etage','')),''), 'raum', nullif(trim(coalesce(e->>'raum','')),''), 'buero', nullif(trim(coalesce(e->>'buero','')),''), 'place', nullif(trim(coalesce(e->>'place','')),''),
        'wo', nullif(trim(coalesce(e->>'wo','')),''), 'art', e->>'art',
        'tausch', case when e->>'tausch' ~ '^\d:\d$' then e->>'tausch' else '1:1' end,
        'soll', jsonb_build_object('ab', case when e->>'art' in ('tausch','ab') then public.mr_clean_counts(e->'soll'->'ab') else '{}'::jsonb end,
                                   'auf', case when e->>'art' in ('tausch','auf') then public.mr_clean_counts(e->'soll'->'auf') else '{}'::jsonb end)
      ) order by o), '[]'::jsonb) into v_pl
    from jsonb_array_elements(s->'plaetze') with ordinality as t(e, o);
    v_soll := jsonb_build_object('ab', public.mr_sum_counts(v_pl, 'ab'), 'auf', public.mr_sum_counts(v_pl, 'auf'));
    -- Plätze mit Einträgen dürfen nicht verschwinden
    if exists (select 1 from public.scans x where x.site_id = keep[i] and not x.deleted and x.pos_id is not null
               and not exists (select 1 from jsonb_array_elements(v_pl) q where q->>'id' = x.pos_id)) then raise exception 'pos_has_data'; end if;
    insert into public.sites(id, job_id, pos, gebaeude, strasse, plz, ort, kontakt, telefon, zutritt, soll, plaetze)
    values (keep[i], v_id, i, nullif(trim(s->>'gebaeude'),''), trim(s->>'strasse'), trim(s->>'plz'), trim(s->>'ort'),
            trim(s->>'kontakt'), trim(s->>'telefon'), nullif(trim(s->>'zutritt'),''), v_soll, v_pl)
    on conflict (id) do update set pos = excluded.pos, gebaeude = excluded.gebaeude, strasse = excluded.strasse, plz = excluded.plz,
      ort = excluded.ort, kontakt = excluded.kontakt, telefon = excluded.telefon, zutritt = excluded.zutritt, soll = excluded.soll, plaetze = excluded.plaetze
    where public.sites.job_id = v_id;
    -- Ortsangaben bestehender Einträge an geänderte Plätze anpassen
    update public.scans x set etage = q->>'etage', raum = q->>'raum', buero = q->>'buero', place = q->>'place', wo = q->>'wo'
      from jsonb_array_elements(v_pl) q where x.site_id = keep[i] and x.pos_id = q->>'id' and not x.deleted and coalesce((q->>'frei')::boolean, false) is false
        and (x.etage is distinct from q->>'etage' or x.raum is distinct from q->>'raum' or x.buero is distinct from q->>'buero' or x.place is distinct from q->>'place' or x.wo is distinct from q->>'wo');
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
  v_dir text := coalesce(nullif(p->>'dir',''), 'ab'); pl jsonb;
begin
  perform public.mr_need_job(p_job, true);
  if n = '' then raise exception 'no_asset'; end if;
  if v_dir not in ('ab','auf') then raise exception 'bad_dir'; end if;
  if v_site is null or not exists (select 1 from public.sites where id = v_site and job_id = p_job) then raise exception 'bad_site'; end if;
  if exists (select 1 from public.scans where id = p->>'id') then return jsonb_build_object('status','added','id',p->>'id'); end if;
  select * into ex from public.scans where job_id = p_job and asset_norm = n and dir = v_dir and not deleted;
  if found then return jsonb_build_object('status','dup','id',ex.id,'by',ex."by"); end if;
  pl := public.mr_check_plan(p_job, v_site, p->>'pos_id', v_dir, n, null);
  -- «Ort vor Ort erfassen»: Etage und Raum kommen vom Techniker und sind Pflicht
  if coalesce((pl->>'frei')::boolean, false) then
    if trim(coalesce(p->>'etage','')) = '' then raise exception 'missing_loc:etage'; end if;
    if trim(coalesce(p->>'raum','')) = '' then raise exception 'missing_loc:raum'; end if;
    pl := pl || jsonb_build_object('etage', trim(p->>'etage'), 'raum', trim(p->>'raum'), 'buero', nullif(trim(coalesce(p->>'buero','')),''), 'place', nullif(trim(coalesce(p->>'place','')),''));
  end if;
  insert into public.scans(id, job_id, site_id, pos_id, dir, art, grp, asset, etage, raum, buero, place, wo, cond, note, "by", user_id, ts)
  values (p->>'id', p_job, v_site, p->>'pos_id', v_dir, case when p->>'art' = 'tausch' then 'tausch' else 'einzeln' end, nullif(p->>'grp',''), p->>'asset',
          pl->>'etage', pl->>'raum', pl->>'buero', pl->>'place', pl->>'wo', coalesce(nullif(p->>'cond',''),'ok'), nullif(p->>'note',''), public.mr_me(), auth.uid(), (p->>'ts')::bigint);
  update public.jobs set status = 'aktiv', updated_at = now() where id = p_job and status = 'geplant';
  return jsonb_build_object('status','added','id',p->>'id');
end $$;

create or replace function public.scan_update(p_job uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare ex public.scans; v_site uuid; v_pos text; n text; pl jsonb;
begin
  perform public.mr_need_job(p_job, true);
  select * into ex from public.scans where job_id = p_job and id = p->>'id' and not deleted;
  if not found then raise exception 'not_found'; end if;
  if not (ex.user_id = auth.uid() or public.mr_is_lead(p_job)) then raise exception 'not_allowed'; end if;
  v_site := coalesce(nullif(p->>'site_id','')::uuid, ex.site_id);
  v_pos := coalesce(nullif(p->>'pos_id',''), ex.pos_id);
  n := upper(regexp_replace(coalesce(nullif(p->>'asset',''), ex.asset), '\s', '', 'g'));
  if exists (select 1 from public.scans where job_id = p_job and asset_norm = n and dir = ex.dir and not deleted and id <> ex.id) then raise exception 'dup_asset'; end if;
  pl := public.mr_check_plan(p_job, v_site, v_pos, ex.dir, n, ex.id);
  if coalesce((pl->>'frei')::boolean, false) then
    pl := pl || jsonb_build_object('etage', nullif(trim(coalesce(case when p ? 'etage' then p->>'etage' else ex.etage end,'')),''), 'raum', nullif(trim(coalesce(case when p ? 'raum' then p->>'raum' else ex.raum end,'')),''),
      'buero', nullif(trim(coalesce(case when p ? 'buero' then p->>'buero' else ex.buero end,'')),''), 'place', nullif(trim(coalesce(case when p ? 'place' then p->>'place' else ex.place end,'')),''));
    if pl->>'etage' is null then raise exception 'missing_loc:etage'; end if;
    if pl->>'raum' is null then raise exception 'missing_loc:raum'; end if;
  end if;
  update public.scans set asset = coalesce(nullif(trim(p->>'asset'),''), asset), site_id = v_site, pos_id = v_pos,
    etage = pl->>'etage', raum = pl->>'raum', buero = pl->>'buero', place = pl->>'place', wo = pl->>'wo',
    cond = case when p ? 'cond' then coalesce(nullif(p->>'cond',''),'ok') else cond end,
    note = case when p ? 'note' then nullif(trim(p->>'note'),'') else note end, updated_at = now()
  where id = ex.id;
  return jsonb_build_object('status','updated','id',ex.id);
end $$;
