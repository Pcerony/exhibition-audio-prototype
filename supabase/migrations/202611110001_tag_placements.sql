create table public.tag_placements (
  tag_id uuid primary key references public.tags(id) on delete cascade,
  map_version text not null check (map_version = 'fukuoka-road-73-v13'),
  piece_code text not null check (piece_code ~ '^(?:[ABDEFGH][1-9]|C(?:[1-9]|10))$'),
  x double precision not null check (x between 0 and 1500),
  y double precision not null check (y between 0 and 1320),
  version integer not null check (version > 0),
  updated_at timestamptz not null default now()
);
alter table public.tag_placements enable row level security;
revoke all on public.tag_placements from public, anon, authenticated, service_role;

create function public.tag_placement_action(p_operator uuid, p_body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  t public.tags%rowtype;
  p public.tag_placements%rowtype;
  a text := p_body->>'action';
  v_expected integer;
  v_tag jsonb;
begin
  if not exists(select 1 from public.operator_profiles where user_id=p_operator and role in ('operator','admin')) then
    raise exception 'OPERATOR_REQUIRED';
  end if;
  if a = 'locateTag' then
    select * into t from public.tags where public_token=p_body->>'token' and deleted_at is null;
    if not found then raise exception 'TAG_NOT_FOUND'; end if;
    select * into p from public.tag_placements where tag_id=t.id;
    v_tag := public.tag_dto(t) - 'token';
    if v_tag->'recording' is not null and jsonb_typeof(v_tag->'recording') = 'object' then
      v_tag := jsonb_set(v_tag,'{recording}',(v_tag->'recording') - 'location');
    end if;
  elsif a = 'saveTagPlacement' then
    select * into t from public.tags where id=(p_body->>'tagId')::uuid and deleted_at is null for update;
    if not found then raise exception 'TAG_NOT_FOUND'; end if;
    select * into p from public.tag_placements where tag_id=t.id;
    v_expected := (p_body->>'expectedVersion')::integer;
    if v_expected is distinct from coalesce(p.version,0) then raise exception 'VERSION_CONFLICT'; end if;
    insert into public.tag_placements(tag_id,map_version,piece_code,x,y,version)
      values(t.id,p_body->>'mapVersion',p_body->>'pieceCode',(p_body->>'x')::double precision,(p_body->>'y')::double precision,v_expected+1)
      on conflict (tag_id) do update set map_version=excluded.map_version,piece_code=excluded.piece_code,
        x=excluded.x,y=excluded.y,version=excluded.version,updated_at=now()
      returning * into p;
    insert into public.audit_log(operator_id,action,tag_id) values(p_operator,'tag_placement_saved',t.id);
  else
    raise exception 'REQUEST_INVALID';
  end if;
  return jsonb_build_object('placement',case when p.tag_id is not null then
    jsonb_build_object('mapVersion',p.map_version,'pieceCode',p.piece_code,'x',p.x,'y',p.y,'version',p.version)
  end) || case when a='locateTag' then jsonb_build_object('tag',v_tag) else '{}'::jsonb end;
end
$$;
revoke all on function public.tag_placement_action(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.tag_placement_action(uuid,jsonb) to service_role;
