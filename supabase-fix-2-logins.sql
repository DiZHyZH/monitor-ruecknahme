-- Korrektur 2: Benutzerkonten (E-Mail + PIN)
-- Ab jetzt dürfen nur angemeldete Nutzer die Rollout-Funktionen aufrufen.
-- «Erfasst durch» kommt serverseitig aus dem Profil und kann nicht gefälscht werden.
-- Einmal im SQL Editor ausführen. Bestehende Daten bleiben erhalten.

alter table public.scans    add column if not exists user_id uuid;
alter table public.rollouts add column if not exists created_by_uid uuid;

-- Name des angemeldeten Nutzers (aus dem Profil, sonst E-Mail)
create or replace function public.mr_me() returns text
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(nullif(auth.jwt() -> 'user_metadata' ->> 'name', ''), auth.jwt() ->> 'email');
$$;

create or replace function public.mr_auth() returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'not_logged_in'; end if;
end $$;

create or replace function public.mr_join(p_code text, p_pin text, p_by text default null) returns text
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform mr_auth();
  if length(coalesce(p_code,'')) < 4 or length(coalesce(p_pin,'')) < 4 then raise exception 'too_short'; end if;
  if not exists (select 1 from rollouts where code = p_code) then
    insert into rollouts(code, pin_hash, created_by, created_by_uid) values (p_code, crypt(p_pin, gen_salt('bf')), mr_me(), auth.uid());
    return 'created';
  end if;
  perform mr_check(p_code, p_pin);
  return 'joined';
end $$;

create or replace function public.mr_add(p_code text, p_pin text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare ex scans; n text := upper(regexp_replace(p->>'asset', '\s', '', 'g'));
begin
  perform mr_auth();
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
  insert into scans(id, rollout, asset, neu, etage, raum, buero, place, cond, note, "by", user_id, ts)
  values (p->>'id', p_code, p->>'asset', p->>'neu', p->>'etage', p->>'raum', p->>'buero', p->>'place',
          coalesce(p->>'cond','ok'), p->>'note', mr_me(), auth.uid(), (p->>'ts')::bigint)
  on conflict (id) do nothing;
  return jsonb_build_object('status','added','id',p->>'id');
end $$;

create or replace function public.mr_list(p_code text, p_pin text, p_since timestamptz default 'epoch')
returns setof public.scans
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform mr_auth();
  perform mr_check(p_code, p_pin);
  return query select * from scans where rollout = p_code and updated_at > p_since order by updated_at;
end $$;

create or replace function public.mr_delete(p_code text, p_pin text, p_id text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform mr_auth();
  perform mr_check(p_code, p_pin);
  update scans set deleted = true, updated_at = now() where rollout = p_code and id = p_id;
end $$;

-- Nur noch angemeldete Nutzer
revoke all on function public.mr_me()                                from public, anon, authenticated;
revoke all on function public.mr_auth()                              from public, anon, authenticated;
revoke all on function public.mr_join(text,text,text)                from public, anon;
revoke all on function public.mr_add(text,text,jsonb)                from public, anon;
revoke all on function public.mr_list(text,text,timestamptz)         from public, anon;
revoke all on function public.mr_delete(text,text,text)              from public, anon;
grant execute on function public.mr_join(text,text,text)             to authenticated;
grant execute on function public.mr_add(text,text,jsonb)             to authenticated;
grant execute on function public.mr_list(text,text,timestamptz)      to authenticated;
grant execute on function public.mr_delete(text,text,text)           to authenticated;
