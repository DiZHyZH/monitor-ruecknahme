-- Name in Supabase: 08 Einfache Liste
-- Korrektur 7: «Einfache Liste» ohne Planung. Jeder angemeldete Mitarbeiter kann sie starten.
-- Name: KÜRZEL_Ort_JJJJ.MM.TT. Gleicher Name am gleichen Tag = gleiche Liste (Team arbeitet gemeinsam).
-- Keine Mengen-Grenze, alle Gerätetypen erlaubt; Etage und Raum bleiben Pflicht.
-- Einmal im SQL Editor ausführen (neue, leere Query → alles einfügen → Run). Darf mehrfach laufen.

alter table public.jobs add column if not exists simple boolean not null default false;

-- Plan-Prüfung: bei einfachen Listen nur die Richtung prüfen
create or replace function public.mr_check_plan(p_job uuid, p_site uuid, p_pos text, p_dir text, p_asset text, p_ignore text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pl jsonb; t text := public.mr_devtype(p_asset); planned int; have int; v_simple boolean;
begin
  select q into pl from public.sites s, jsonb_array_elements(s.plaetze) q where s.id = p_site and s.job_id = p_job and q->>'id' = p_pos;
  if pl is null then raise exception 'bad_pos'; end if;
  if (pl->>'art' = 'auf' and p_dir <> 'auf') or (pl->>'art' = 'ab' and p_dir <> 'ab') then raise exception 'wrong_art'; end if;
  select simple into v_simple from public.jobs where id = p_job;
  if coalesce(v_simple, false) then return pl; end if;
  if t is null then raise exception 'unknown_type'; end if;
  planned := coalesce((pl->'soll'->p_dir->>t)::int, 0);
  if planned = 0 then raise exception 'not_planned:%', t; end if;
  select count(*) into have from public.scans x where x.job_id = p_job and x.pos_id = p_pos and x.dir = p_dir and not x.deleted
    and public.mr_devtype(x.asset) = t and x.id is distinct from p_ignore;
  if have >= planned then raise exception 'over_plan:%:%', t, planned; end if;
  return pl;
end $$;

-- Einfache Liste starten oder (gleicher Name, gleicher Tag) beitreten
create or replace function public.job_quick(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_k text := upper(regexp_replace(trim(coalesce(p->>'kuerzel','')), '[^A-Za-z0-9ÄÖÜäöü-]+', '', 'g'));
  v_o text := regexp_replace(trim(coalesce(p->>'ort','')), '\s+', '_', 'g');
  v_art text := coalesce(p->>'art', 'auf');
  v_code text; v_id uuid; v_st text; v_simple boolean;
begin
  perform public.mr_auth();
  if length(v_k) < 2 then raise exception 'missing:kuerzel'; end if;
  if length(v_o) < 2 then raise exception 'missing:ort'; end if;
  if v_art not in ('auf','ab','tausch') then raise exception 'missing:art'; end if;
  v_code := v_k || '_' || v_o || '_' || to_char((now() at time zone 'Europe/Zurich')::date, 'YYYY.MM.DD');
  select id, status, simple into v_id, v_st, v_simple from public.jobs where code = v_code;
  if v_id is not null then
    if not v_simple then raise exception 'code_taken'; end if;
    if v_st = 'abgeschlossen' then raise exception 'job_closed'; end if;
    insert into public.job_members(job_id, user_id) select v_id, auth.uid() where not exists (select 1 from public.jobs where id = v_id and lead = auth.uid())
      on conflict do nothing;
    return (select public.mr_job_json(j) from public.jobs j where j.id = v_id);
  end if;
  insert into public.jobs(code, art, kunde, datum, zeit_von, zeit_bis, lead, simple, created_by, status)
  values (v_code, 'rollout', v_k, (now() at time zone 'Europe/Zurich')::date, '00:00', '23:59', auth.uid(), true, auth.uid(), 'aktiv')
  returning id into v_id;
  insert into public.sites(id, job_id, pos, gebaeude, strasse, plz, ort, kontakt, telefon, soll, plaetze)
  values (gen_random_uuid(), v_id, 1, v_k, '', '', replace(v_o, '_', ' '), '', '', '{}'::jsonb,
          jsonb_build_array(jsonb_build_object('id', 'q1', 'frei', true, 'art', v_art, 'tausch', '1:1', 'soll', jsonb_build_object('ab', '{}'::jsonb, 'auf', '{}'::jsonb))));
  return (select public.mr_job_json(j) from public.jobs j where j.id = v_id);
end $$;

revoke all on function public.mr_check_plan(uuid,uuid,text,text,text,text) from public, anon, authenticated;
revoke all on function public.job_quick(jsonb) from public, anon;
grant execute on function public.job_quick(jsonb) to authenticated;
