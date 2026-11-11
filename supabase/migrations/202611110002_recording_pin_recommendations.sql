create table public.recording_pin_recommendations (
  recording_id uuid primary key references public.recordings(id) on delete cascade,
  state text not null check (state in ('assigned','needs_review','outside_map')),
  piece_code text check (piece_code is null or public.valid_map_piece_code(piece_code)),
  x double precision check (x between 0 and 1500),
  y double precision check (y between 0 and 1320),
  confirmed_location jsonb,
  check ((x is null) = (y is null)),
  check ((piece_code is null) = (x is null)),
  check (state <> 'assigned' or piece_code is not null),
  check (state <> 'outside_map' or piece_code is null)
);
alter table public.recording_pin_recommendations enable row level security;
revoke all on public.recording_pin_recommendations from public,anon,authenticated,service_role;

-- Legacy Place results were not based on an independently selected point.
update public.recording_piece_assignments a set assignment_state='pending',
  piece_code=null,assignment_source=null,map_version=null,version=version+1,updated_at=now()
from public.recordings r where r.id=a.recording_id and (
  (r.location->>'source'='place' and a.assignment_source='automatic')
  or (r.location is not null and a.assignment_state='not_applicable'));

create function public.initialize_late_recording_location() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.recording_piece_assignments set assignment_state='pending',version=version+1,updated_at=now()
  where recording_id=new.id and assignment_state='not_applicable';
  return new;
end $$;
revoke all on function public.initialize_late_recording_location() from public,anon,authenticated;
create trigger recordings_initialize_late_location after update of location on public.recordings
for each row when (old.location is null and new.location is not null)
execute function public.initialize_late_recording_location();

create function public.save_recording_pin_recommendation(
  p_recording_id uuid,p_state text,p_piece_code text,p_x double precision,p_y double precision
) returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.recordings where id=p_recording_id and location->>'source'='pin' for key share;
  if not found then return false; end if;
  insert into public.recording_pin_recommendations(recording_id,state,piece_code,x,y)
  values(p_recording_id,p_state,p_piece_code,p_x,p_y) on conflict(recording_id) do nothing;
  perform public.save_automatic_piece_assignment(p_recording_id,p_state,p_piece_code,'fukuoka-road-73-v13');
  return true;
end $$;

create function public.tag_memory_point_action(p_operator uuid,p_body jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_result jsonb;
  r public.recordings%rowtype;
  p public.recording_pin_recommendations%rowtype;
begin
  if not exists(select 1 from public.operator_profiles where user_id=p_operator and role in ('operator','admin')) then
    raise exception 'OPERATOR_REQUIRED';
  end if;
  if p_body->>'action'='locateTag' then
    v_result := public.tag_placement_action(p_operator,p_body);
    select * into r from public.recordings where id=(v_result#>>'{tag,recording,id}')::uuid;
    select * into p from public.recording_pin_recommendations where recording_id=r.id;
  elsif p_body->>'action'='confirmTagMemoryPoint' then
    perform 1 from public.tags where id=(p_body->>'tagId')::uuid and deleted_at is null for update;
    if not found then raise exception 'TAG_NOT_FOUND'; end if;
    select * into r from public.recordings where tag_id=(p_body->>'tagId')::uuid;
    if r.id is distinct from (p_body->>'recordingId')::uuid or r.location->>'source' is distinct from 'place' then
      raise exception 'VERSION_CONFLICT';
    end if;
    insert into public.recording_pin_recommendations(recording_id,state,piece_code,x,y,confirmed_location)
    values(r.id,p_body->>'state',p_body->>'pieceCode',(p_body->>'x')::double precision,
      (p_body->>'y')::double precision,p_body->'location')
    on conflict(recording_id) do nothing returning * into p;
    if not found then raise exception 'VERSION_CONFLICT'; end if;
    perform public.save_automatic_piece_assignment(r.id,p.state,p.piece_code,'fukuoka-road-73-v13');
    insert into public.audit_log(operator_id,action,tag_id)
    values(p_operator,'tag_memory_point_confirmed',r.tag_id);
  else
    raise exception 'REQUEST_INVALID';
  end if;
  return coalesce(v_result,'{}'::jsonb) || jsonb_build_object(
    'memoryLocation',r.location,'recommendation',case when p.recording_id is not null then
      jsonb_build_object('mapVersion','fukuoka-road-73-v13','state',p.state,'pieceCode',p.piece_code,
        'x',p.x,'y',p.y,'confirmedLocation',p.confirmed_location)
    end);
end $$;

revoke all on function public.save_recording_pin_recommendation(uuid,text,text,double precision,double precision),
  public.tag_memory_point_action(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_recording_pin_recommendation(uuid,text,text,double precision,double precision),
  public.tag_memory_point_action(uuid,jsonb) to service_role;
