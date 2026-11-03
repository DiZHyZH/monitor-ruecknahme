-- Korrektur 1: Funktion mr_add ersetzen (einmal ausführen)
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

