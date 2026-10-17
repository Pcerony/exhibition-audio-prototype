alter table public.operator_profiles drop constraint operator_profiles_role_check;
alter table public.operator_profiles add constraint operator_profiles_role_check check (role in ('operator','admin','staff'));

create table public.staff_members (
 id text primary key,
 name text not null,
 position integer not null unique,
 active boolean not null default true
);
alter table public.staff_members enable row level security;
revoke all on public.staff_members from public,anon,authenticated;
grant all on public.staff_members to service_role;

-- Public lab roster, explicitly selected by the project owner; no personal accounts.
insert into public.staff_members(id,name,position) values
 ('chen-feixue','陳霏雪',1),('wang-heisei','王 平成',2),
 ('mina','アフザール ミナヘル',3),('senda-tatsuki','千田 尚輝',4),
 ('hayashida-nodoka','林田 和郁',5),('liu-xinying','劉心影',6),
 ('arin-soukoule','Arin Soukoule',7),('pei-boyu','PEI BOYU',8);

create function public.staff_action(p_operator uuid,p_body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 a text:=p_body->>'action'; role_name text; member_name text;
 v_search text:=coalesce(p_body->>'search',''); v_state text:=coalesce(p_body->>'reviewState','all');
 v_category_code text:=nullif(p_body->>'categoryCode','');
 v_date text:=nullif(p_body->>'batchDate','');
 v_offset integer:=coalesce((p_body->>'offset')::integer,0); v_limit integer:=coalesce((p_body->>'limit')::integer,30);
 tid uuid; v_recording public.recordings%rowtype; q public.recording_transcriptions%rowtype;
 result jsonb; event_name text; was_published boolean; changed boolean;
begin
 select role into role_name from public.operator_profiles where user_id=p_operator;
 if role_name is null or role_name not in ('staff','operator','admin') then raise exception 'STAFF_REQUIRED';end if;
 if jsonb_typeof(p_body) is distinct from 'object' or a is null
  or a not in ('session','list','history','save','playback','activity') then raise exception 'REQUEST_INVALID';end if;
 if a='session' then
  return jsonb_build_object('userId',p_operator,'role',role_name,'members',
   (select jsonb_agg(jsonb_build_object('id',id,'name',name) order by position) from public.staff_members where active));
 end if;
 if a='list' then
  if length(v_search)>120 or v_offset<0 or v_limit not between 1 and 50
   or v_state not in ('all','unreviewed','approved','empty') then raise exception 'REQUEST_INVALID';end if;
  if v_category_code is not null and v_category_code not in ('A','B','C','D') then raise exception 'REQUEST_INVALID';end if;
  if v_date is not null and (v_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or v_date::date::text<>v_date) then raise exception 'REQUEST_INVALID';end if;
  with selected as (
   select t.id,t.label,t.serial_number,t.inventory_label,t.status,t.created_at,topic.code category_code,r.created_at recorded_at,
    case when r.id is null then null else jsonb_build_object(
     'id',r.id,'duration',r.duration_seconds,'createdAt',r.created_at,'transcriptionConsent',r.transcription_consent,
     'location',case r.location->>'source'
       when 'pin' then jsonb_build_object('source','pin','lat',r.location->'lat','lng',r.location->'lng')
       when 'place' then jsonb_build_object('source','place','placeId',r.location->'placeId') else null end,
     'transcription',case when tr.recording_id is null or not r.transcription_consent then null else jsonb_build_object(
       'status',tr.status,'text',tr.text,'published',tr.published,'version',tr.version,'updatedAt',tr.updated_at) end,
     'pieceAssignment',case when pa.recording_id is null then null else jsonb_build_object(
       'state',pa.assignment_state,'pieceCode',pa.piece_code,'source',pa.assignment_source,'mapVersion',pa.map_version,
       'version',pa.version,'updatedAt',pa.updated_at) end,
     'latestReview',(select jsonb_build_object('memberName',coalesce(l.details->>'memberName','管理者'),
       'createdAt',l.created_at,'action',l.action) from public.audit_log l where l.tag_id=t.id
       and l.created_at>=r.created_at and l.action in ('staff_approve','staff_save_draft','saveTranscription')
       order by l.created_at desc,l.id desc limit 1)
    ) end recording
   from public.tags t left join public.recordings r on r.tag_id=t.id
   left join public.memory_topics topic on topic.id=t.topic_id
   left join public.recording_transcriptions tr on tr.recording_id=r.id
   left join public.recording_piece_assignments pa on pa.recording_id=r.id
   where t.deleted_at is null
    and (p_body->>'tagId' is null or t.id=(p_body->>'tagId')::uuid)
    and (v_date is null or (r.created_at at time zone 'Asia/Tokyo')::date=v_date::date)
    and (v_category_code is null or topic.code=v_category_code)
    and (strpos(lower(coalesce(t.serial_number,t.label)||' '||t.inventory_label||' '||coalesce(tr.text,'')),lower(v_search))>0
      or exists(select 1 from public.label_history h where h.tag_id=t.id and strpos(lower(h.label),lower(v_search))>0))
    and (v_state='all' or (v_state='empty' and r.id is null)
      or (v_state='approved' and r.transcription_consent and tr.status='ready' and tr.published)
      or (v_state='unreviewed' and r.id is not null and r.transcription_consent
        and not coalesce(tr.status='ready' and tr.published,false)))
  ), paged as (
   select * from selected order by recorded_at desc nulls last,id offset v_offset limit v_limit
  ) select jsonb_build_object('total',(select count(*) from selected),'cards',coalesce((select jsonb_agg(
    jsonb_build_object('id',id,'label',coalesce(serial_number,label),'inventoryLabel',inventory_label,'categoryCode',category_code,
      'status',status,'createdAt',created_at,'recording',recording)
    order by recorded_at desc nulls last,id) from paged),'[]'::jsonb)) into result;
  return result;
 end if;
 if a='history' then
  tid:=(p_body->>'tagId')::uuid;
  if not exists(select 1 from public.tags where id=tid and deleted_at is null) then raise exception 'TAG_NOT_FOUND';end if;
  select jsonb_build_object('entries',coalesce(jsonb_agg(jsonb_build_object('id',l.id,'action',l.action,
   'memberName',coalesce(l.details->>'memberName','管理者'),'createdAt',l.created_at) order by l.created_at desc,l.id desc),'[]'))
   into result from (select * from public.audit_log where tag_id=tid order by created_at desc,id desc limit 100) l;
  return result;
 end if;
 select name into member_name from public.staff_members where id=p_body->>'memberId' and active;
 if member_name is null then raise exception 'MEMBER_REQUIRED';end if;
 select tag_id into tid from public.recordings where id=(p_body->>'recordingId')::uuid;
 -- All recording mutations follow the existing tag-first lock order.
 perform 1 from public.tags where id=tid and deleted_at is null and status='bound' for update;
 if not found then raise exception 'RECORDING_NOT_FOUND';end if;
 select * into v_recording from public.recordings where id=(p_body->>'recordingId')::uuid and tag_id=tid;
 if not found then raise exception 'RECORDING_NOT_FOUND';end if;
 if a='save' then
  if not v_recording.transcription_consent then raise exception 'TRANSCRIPTION_CONSENT_REQUIRED';end if;
  select * into q from public.recording_transcriptions where recording_id=v_recording.id for update;
  if not found then raise exception 'TRANSCRIPTION_NOT_FOUND';end if;
  if jsonb_typeof(p_body->'version') is distinct from 'number' or (p_body->>'version')::numeric<>q.version then raise exception 'VERSION_CONFLICT';end if;
  if jsonb_typeof(p_body->'text') is distinct from 'string' or char_length(p_body->>'text')>10000
   or jsonb_typeof(p_body->'published') is distinct from 'boolean'
   or ((p_body->>'published')::boolean and (p_body->>'text') !~ '[^[:space:]　 ]') then raise exception 'REQUEST_INVALID';end if;
  was_published:=q.published;changed:=q.text is distinct from p_body->>'text';
  update public.recording_transcriptions set status='ready',text=p_body->>'text',published=(p_body->>'published')::boolean,
   version=version+1,lease_token=null,lease_expires_at=null,error_code=null,updated_at=clock_timestamp() where recording_id=v_recording.id;
  event_name:=case when (p_body->>'published')::boolean then 'staff_approve' else 'staff_save_draft' end;
 elsif a='playback' then
  event_name:='staff_audio_opened';
 elsif a='activity' and p_body->>'event'='location_viewed' then
  event_name:='staff_location_viewed';
 else raise exception 'REQUEST_INVALID';end if;
 insert into public.audit_log(operator_id,action,tag_id,created_at,details) values(p_operator,event_name,tid,clock_timestamp(),
  jsonb_build_object('recordingId',v_recording.id,'memberId',p_body->>'memberId','memberName',member_name,
   'textChanged',changed,'previousPublished',was_published));
 if a='playback' then return jsonb_build_object('objectPath',v_recording.object_path);end if;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.staff_action(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.staff_action(uuid,jsonb) to service_role;

-- AI text changes must invalidate editors opened while the task was processing.
alter function public.finish_transcription(uuid,uuid,integer,text,text,integer) rename to finish_transcription_before_staff;
create function public.finish_transcription(p_recording_id uuid,p_lease_token uuid,p_version integer,p_text text,p_error_code text,p_retry_seconds integer default 0)
returns boolean language plpgsql security definer set search_path='' as $$
declare accepted boolean;begin
 accepted:=public.finish_transcription_before_staff(p_recording_id,p_lease_token,p_version,p_text,p_error_code,p_retry_seconds);
 if accepted and p_error_code is null then
  update public.recording_transcriptions set version=version+1 where recording_id=p_recording_id;
 end if;
 return accepted;
end $$;
revoke all on function public.finish_transcription_before_staff(uuid,uuid,integer,text,text,integer) from public,anon,authenticated,service_role;
revoke all on function public.finish_transcription(uuid,uuid,integer,text,text,integer) from public,anon,authenticated;
grant execute on function public.finish_transcription(uuid,uuid,integer,text,text,integer) to service_role;
