create function public.valid_map_piece_code(p_code text) returns boolean
language sql immutable set search_path='' as $$
 select p_code=any(array[
  'A1','A2','A3','A4','A5','A6','A7','A8','A9',
  'B1','B2','B3','B4','B5','B6','B7','B8','B9',
  'C1','C2','C3','C4','C5','C6','C7','C8','C9','C10',
  'D1','D2','D3','D4','D5','D6','D7','D8','D9',
  'E1','E2','E3','E4','E5','E6','E7','E8','E9',
  'F1','F2','F3','F4','F5','F6','F7','F8','F9',
  'G1','G2','G3','G4','G5','G6','G7','G8','G9',
  'H1','H2','H3','H4','H5','H6','H7','H8','H9'
 ])
$$;
revoke all on function public.valid_map_piece_code(text) from public,anon,authenticated;

create table public.recording_piece_assignments (
 recording_id uuid primary key references public.recordings(id) on delete cascade,
 assignment_state text not null check(assignment_state in ('not_applicable','pending','assigned','needs_review','outside_map')),
 piece_code text check(piece_code is null or public.valid_map_piece_code(piece_code)),
 assignment_source text check(assignment_source is null or assignment_source in ('automatic','manual')),
 map_version text,
 version integer not null default 1 check(version>=1),
 updated_at timestamptz not null default now(),
 check(
  (assignment_state in ('not_applicable','pending') and piece_code is null and assignment_source is null and map_version is null)
  or (assignment_state='assigned' and piece_code is not null and assignment_source is not null and map_version='fukuoka-road-73-v13')
  or (assignment_state='needs_review' and assignment_source is not null and map_version='fukuoka-road-73-v13')
  or (assignment_state='outside_map' and piece_code is null and assignment_source is not null and map_version='fukuoka-road-73-v13')
 ),
 check(assignment_state<>'not_applicable' or assignment_source is null)
);
create index recording_piece_assignments_piece_idx on public.recording_piece_assignments(piece_code,recording_id) where piece_code is not null;
alter table public.recording_piece_assignments enable row level security;
revoke all on public.recording_piece_assignments from public,anon,authenticated;
grant select,insert,update,delete on public.recording_piece_assignments to service_role;

create function public.initialize_recording_piece_assignment() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.recording_piece_assignments(recording_id,assignment_state)
 values(new.id,case when new.location is null then 'not_applicable' else 'pending' end)
 on conflict(recording_id) do nothing;
 return new;
end $$;
revoke all on function public.initialize_recording_piece_assignment() from public,anon,authenticated;
create trigger recordings_initialize_piece_assignment
 after insert on public.recordings for each row execute function public.initialize_recording_piece_assignment();

insert into public.recording_piece_assignments(recording_id,assignment_state)
select id,case when location is null then 'not_applicable' else 'pending' end
from public.recordings
on conflict(recording_id) do nothing;

create function public.save_automatic_piece_assignment(
 p_recording_id uuid,p_state text,p_piece_code text,p_map_version text
) returns boolean language plpgsql security definer set search_path='' as $$
declare current_assignment public.recording_piece_assignments%rowtype;
begin
 if p_state not in ('assigned','needs_review','outside_map')
  or p_map_version is distinct from 'fukuoka-road-73-v13'
  or (p_piece_code is not null and not public.valid_map_piece_code(p_piece_code))
  or (p_state='assigned' and p_piece_code is null)
  or (p_state='outside_map' and p_piece_code is not null) then
  raise exception 'MAP_ASSIGNMENT_INVALID';
 end if;
 select * into current_assignment from public.recording_piece_assignments where recording_id=p_recording_id for update;
 if not found or current_assignment.assignment_state='not_applicable' or current_assignment.assignment_source='manual' then return false;end if;
 if current_assignment.assignment_state=p_state and current_assignment.piece_code is not distinct from p_piece_code
  and current_assignment.assignment_source='automatic' and current_assignment.map_version=p_map_version then return true;end if;
 update public.recording_piece_assignments set assignment_state=p_state,piece_code=p_piece_code,
  assignment_source='automatic',map_version=p_map_version,version=version+1,updated_at=now()
 where recording_id=p_recording_id;
 return true;
end $$;

create function public.set_manual_piece_assignment(
 p_operator uuid,p_recording_id uuid,p_expected_version integer,p_state text,p_piece_code text,p_map_version text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare tag_id uuid;current_assignment public.recording_piece_assignments%rowtype;next_version integer;
begin
 if not exists(select 1 from public.operator_profiles where user_id=p_operator and role in ('operator','admin')) then raise exception 'OPERATOR_REQUIRED';end if;
 if p_state not in ('assigned','needs_review','outside_map') or p_map_version is distinct from 'fukuoka-road-73-v13'
  or (p_piece_code is not null and not public.valid_map_piece_code(p_piece_code))
  or (p_state='assigned' and p_piece_code is null)
  or (p_state in ('needs_review','outside_map') and p_piece_code is not null) then raise exception 'MAP_ASSIGNMENT_INVALID';end if;
 select r.tag_id into tag_id from public.recordings r where r.id=p_recording_id;
 if not found then raise exception 'RECORDING_NOT_FOUND';end if;
 perform 1 from public.tags t where t.id=tag_id and t.deleted_at is null for update;
 if not found then raise exception 'RECORDING_NOT_FOUND';end if;
 select * into current_assignment from public.recording_piece_assignments where recording_id=p_recording_id for update;
 if not found then raise exception 'RECORDING_NOT_FOUND';end if;
 if p_expected_version is distinct from current_assignment.version then raise exception 'VERSION_CONFLICT';end if;
 next_version:=current_assignment.version+1;
 update public.recording_piece_assignments set assignment_state=p_state,piece_code=p_piece_code,
  assignment_source='manual',map_version=p_map_version,version=next_version,updated_at=now()
 where recording_id=p_recording_id;
 insert into public.audit_log(operator_id,action,tag_id,details)
 values(p_operator,'map_piece_override',tag_id,jsonb_build_object(
  'recordingId',p_recording_id,'fromState',current_assignment.assignment_state,
  'fromPieceCode',current_assignment.piece_code,'fromSource',current_assignment.assignment_source,
  'toState',p_state,'toPieceCode',p_piece_code,'mapVersion',p_map_version,'version',next_version
 ));
 return jsonb_build_object('version',next_version,'state',p_state,'pieceCode',p_piece_code,'source','manual','mapVersion',p_map_version);
end $$;

revoke all on function public.save_automatic_piece_assignment(uuid,text,text,text),public.set_manual_piece_assignment(uuid,uuid,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.save_automatic_piece_assignment(uuid,text,text,text),public.set_manual_piece_assignment(uuid,uuid,integer,text,text,text) to service_role;

create or replace function public.admin_list(p_operator uuid,p_body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_search text:=coalesce(p_body->>'search','');
 v_status text:=nullif(p_body->>'status','');
 v_batch_date text:=nullif(p_body->>'batchDate','');
 v_category_id uuid;
 v_uncategorized boolean:=false;
 v_sort text:=coalesce(p_body->>'sort','recorded_desc');
 v_offset integer:=coalesce((p_body->>'offset')::integer,0);
 v_limit integer:=coalesce((p_body->>'limit')::integer,50);
 v_transcription_state text:=nullif(p_body->>'transcriptionState','');
 v_piece_code text:=nullif(p_body->>'pieceCode','');
 result jsonb;
begin
 if not exists(select 1 from public.operator_profiles where user_id=p_operator and role in ('operator','admin')) then raise exception 'OPERATOR_REQUIRED';end if;
 if v_offset<0 or v_limit not between 1 and 100 or length(v_search)>120
  or v_sort not in ('recorded_desc','recorded_asc','number')
  or (v_status is not null and v_status not in ('unbound','bound','disabled'))
  or (p_body ? 'uncategorized' and jsonb_typeof(p_body->'uncategorized')<>'boolean')
  or (v_transcription_state is not null and v_transcription_state not in ('not_consented','pending','processing','draft','published','failed'))
  or (v_piece_code is not null and not public.valid_map_piece_code(v_piece_code)) then
  raise exception 'REQUEST_INVALID';
 end if;
 if nullif(p_body->>'categoryId','') is not null then
  v_category_id:=(p_body->>'categoryId')::uuid;
  if not exists(select 1 from public.memory_topics where id=v_category_id) then raise exception 'CATEGORY_NOT_FOUND';end if;
 end if;
 if v_batch_date is not null and (v_batch_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or v_batch_date::date::text<>v_batch_date) then
  raise exception 'REQUEST_INVALID';
 end if;
 if p_body ? 'uncategorized' then v_uncategorized:=(p_body->>'uncategorized')::boolean;end if;

 with selected as (
  select x.id,x.batch_date,x.topic_id,x.serial_number,x.inventory_label,r.created_at recorded_at
  from public.tags x
  left join public.recordings r on r.tag_id=x.id
  left join public.memory_topics topic on topic.id=x.topic_id
  left join public.recording_transcriptions transcription on transcription.recording_id=r.id
  left join public.recording_piece_assignments assignment on assignment.recording_id=r.id
  where x.deleted_at is null
   and (v_piece_code is null or assignment.piece_code=v_piece_code)
   and (v_category_id is null or x.topic_id=v_category_id)
   and (not v_uncategorized or x.topic_id is null)
   and (v_batch_date is null or x.batch_date=v_batch_date::date)
   and (v_status is null or x.status::text=v_status)
   and (strpos(lower(x.label||' '||x.inventory_label||' '||x.batch||' '||coalesce(topic.name,'')||' '||coalesce(r.nickname,'')),lower(v_search))>0
    or exists(select 1 from public.label_history h where h.tag_id=x.id and strpos(h.label,lower(v_search))>0))
   and (v_transcription_state is null or case v_transcription_state
    when 'not_consented' then r.id is not null and not r.transcription_consent
    when 'pending' then r.id is not null and r.transcription_consent and coalesce(transcription.status,'pending')='pending'
    when 'processing' then r.id is not null and r.transcription_consent and transcription.status='processing'
    when 'draft' then r.id is not null and r.transcription_consent and transcription.status='ready' and not transcription.published
    when 'published' then r.id is not null and r.transcription_consent and transcription.status='ready' and transcription.published
    when 'failed' then r.id is not null and r.transcription_consent and transcription.status='failed'
    else false end)
 ), paged as (
  select id,row_number() over(order by
   case when v_sort='recorded_desc' then recorded_at end desc nulls last,
   case when v_sort='recorded_asc' then recorded_at end asc nulls last,
   case when v_sort='number' then batch_date end,
   case when v_sort='number' then topic_id end,
   case when v_sort='number' then substring(coalesce(serial_number,inventory_label) from '[0-9]+$')::numeric end,
   id) n
  from selected
  order by case when v_sort='recorded_desc' then recorded_at end desc nulls last,
   case when v_sort='recorded_asc' then recorded_at end asc nulls last,
   case when v_sort='number' then batch_date end,
   case when v_sort='number' then topic_id end,
   case when v_sort='number' then substring(coalesce(serial_number,inventory_label) from '[0-9]+$')::numeric end,
   id
  offset v_offset limit v_limit
 )
 select jsonb_build_object(
  'total',(select count(*) from selected),
  'tags',coalesce((select jsonb_agg(public.tag_dto(tag) order by paged.n) from paged join public.tags tag using(id)),'[]'::jsonb)
 ) into result;
 return result;
end $$;

revoke all on function public.admin_list(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.admin_list(uuid,jsonb) to service_role;
