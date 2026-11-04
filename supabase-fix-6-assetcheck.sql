-- Name in Supabase: 07 Asset-ID prüfen
-- Korrektur 6: Ungültige Asset-IDs ablehnen (z. B. eine ganze eingefügte Liste mit Kommas).
-- Erlaubt: 4–24 Zeichen, nur Buchstaben, Ziffern, Punkt, Bindestrich, Unterstrich.
-- Einmal im SQL Editor ausführen (neue, leere Query → alles einfügen → Run). Darf mehrfach laufen.

create or replace function public.scan_add(p_job uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare ex public.scans; n text := upper(regexp_replace(coalesce(p->>'asset',''), '\s', '', 'g')); v_site uuid := nullif(p->>'site_id','')::uuid;
  v_dir text := coalesce(nullif(p->>'dir',''), 'ab'); pl jsonb;
begin
  perform public.mr_need_job(p_job, true);
  if n = '' then raise exception 'no_asset'; end if;
  if n !~ '^[A-Z0-9._-]{4,24}$' then raise exception 'bad_asset'; end if;
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
  if n !~ '^[A-Z0-9._-]{4,24}$' then raise exception 'bad_asset'; end if;
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
