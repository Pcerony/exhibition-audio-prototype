alter table public.upload_sessions add column invalidated_at timestamptz;
create unique index tags_normalized_label_idx on public.tags(lower(btrim(label)));

create table public.provisioning_jobs (
  id uuid primary key default gen_random_uuid(),
  tag_id uuid not null unique references public.tags(id) on delete cascade,
  visitor_url text not null,
  version integer not null default 1 check (version > 0),
  status text not null default 'pending' check (status in ('pending','verified','failed')),
  error_code text,
  updated_at timestamptz not null default now()
);
create table public.batch_requests (
  request_key uuid primary key,
  operator_id uuid not null references auth.users(id),
  rows jsonb not null,
  response jsonb,
  tag_ids uuid[] not null default '{}'
);
create table public.storage_cleanup_queue (
  object_path text primary key,
  not_before timestamptz not null,
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.provisioning_jobs enable row level security;
alter table public.batch_requests enable row level security;
alter table public.storage_cleanup_queue enable row level security;
revoke all on public.provisioning_jobs, public.batch_requests, public.storage_cleanup_queue from public, anon, authenticated;
grant all on public.provisioning_jobs, public.batch_requests, public.storage_cleanup_queue to service_role;

insert into public.provisioning_jobs(tag_id,visitor_url)
  select id,'https://voice.heisei.space/#/t/'||public_token from public.tags;

create function public.job_dto(p_job public.provisioning_jobs) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',p_job.id,'tagId',p_job.tag_id,'label',t.label,'batch',t.batch,
    'visitorUrl',p_job.visitor_url,'version',p_job.version,'status',p_job.status,'errorCode',p_job.error_code)
  from public.tags t where t.id=p_job.tag_id
$$;

create function public.tag_dto(p_tag public.tags) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',p_tag.id,'token',p_tag.public_token,'label',p_tag.label,
    'batch',p_tag.batch,'status',p_tag.status,'createdAt',p_tag.created_at,
    'recording',(select jsonb_build_object('id',r.id,'nickname',r.nickname,'duration',r.duration_seconds,
      'mimeType',r.mime_type,'createdAt',r.created_at) from public.recordings r where r.tag_id=p_tag.id),
    'provisioning',(select public.job_dto(j) from public.provisioning_jobs j where j.tag_id=p_tag.id))
$$;

create function public.admin_action(p_operator uuid, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role text; v_action text := p_body->>'action'; v_tag public.tags%rowtype;
  v_job public.provisioning_jobs%rowtype; v_request public.batch_requests%rowtype;
  v_row jsonb; v_ids uuid[] := '{}'; v_result jsonb; v_total bigint;
  v_offset integer; v_limit integer; v_status text; v_search text;
begin
  select role into v_role from public.operator_profiles where user_id=p_operator;
  if v_role is null then raise exception using errcode='42501', message='OPERATOR_REQUIRED'; end if;
  if v_action='session' then return jsonb_build_object('userId',p_operator,'role',v_role); end if;
  if v_action='createBatch' then
    if jsonb_typeof(p_body->'rows') is distinct from 'array' then
      raise exception 'REQUEST_INVALID'; end if;
    if jsonb_array_length(p_body->'rows') not between 1 and 500 then raise exception 'REQUEST_INVALID'; end if;
    for v_row in select value from jsonb_array_elements(p_body->'rows') loop
      if jsonb_typeof(v_row->'label') is distinct from 'string' or length(btrim(v_row->>'label')) not between 1 and 120
         or jsonb_typeof(v_row->'batch') is distinct from 'string' or length(v_row->>'batch') > 120 then
        raise exception 'REQUEST_INVALID'; end if;
    end loop;
    insert into public.batch_requests(request_key,operator_id,rows)
      values ((p_body->>'requestKey')::uuid,p_operator,p_body->'rows') on conflict do nothing;
    select * into v_request from public.batch_requests where request_key=(p_body->>'requestKey')::uuid for update;
    if v_request.operator_id<>p_operator or v_request.rows<>p_body->'rows' then raise exception 'REQUEST_KEY_CONFLICT'; end if;
    if v_request.response is not null then return v_request.response; end if;
    if cardinality(v_request.tag_ids)=0 then
      for v_row in select value from jsonb_array_elements(p_body->'rows') loop
        begin
          insert into public.tags(label,batch) values(btrim(v_row->>'label'),v_row->>'batch') returning * into v_tag;
        exception when unique_violation then raise exception 'TAG_LABEL_EXISTS'; end;
        insert into public.provisioning_jobs(tag_id,visitor_url) values(v_tag.id,'https://voice.heisei.space/#/t/'||v_tag.public_token);
        insert into public.audit_log(operator_id,action,tag_id) values(p_operator,'create',v_tag.id);
        v_ids := array_append(v_ids,v_tag.id);
      end loop;
      update public.batch_requests set tag_ids=v_ids where request_key=v_request.request_key;
    else v_ids:=v_request.tag_ids; end if;
    select coalesce(jsonb_agg(public.tag_dto(t) order by a.ordinality),'[]') into v_result
      from unnest(v_ids) with ordinality a(id,ordinality) join public.tags t on t.id=a.id;
    v_result:=jsonb_build_object('tags',v_result);
    update public.batch_requests set response=v_result where request_key=v_request.request_key;
    return v_result;
  elsif v_action='list' then
    v_offset:=coalesce((p_body->>'offset')::integer,0); v_limit:=coalesce((p_body->>'limit')::integer,50);
    v_status:=nullif(p_body->>'status',''); v_search:=coalesce(p_body->>'search','');
    if v_offset<0 or v_limit not between 1 and 100 or length(v_search)>120
      or (v_status is not null and v_status not in ('unbound','bound','disabled')) then raise exception 'REQUEST_INVALID'; end if;
    select count(*) into v_total from public.tags t where (v_status is null or t.status::text=v_status)
      and (strpos(lower(t.label),lower(v_search))>0 or strpos(lower(t.batch),lower(v_search))>0
        or exists(select 1 from public.recordings r where r.tag_id=t.id and strpos(lower(r.nickname),lower(v_search))>0));
    select coalesce(jsonb_agg(public.tag_dto(q) order by q.created_at desc,q.id),'[]') into v_result
      from (select t.* from public.tags t where (v_status is null or t.status::text=v_status)
      and (strpos(lower(t.label),lower(v_search))>0 or strpos(lower(t.batch),lower(v_search))>0
        or exists(select 1 from public.recordings r where r.tag_id=t.id and strpos(lower(r.nickname),lower(v_search))>0))
      order by t.created_at desc,t.id offset v_offset limit v_limit) q;
    return jsonb_build_object('tags',v_result,'total',v_total);
  elsif v_action in ('reset','setEnabled') then
    select * into v_tag from public.tags where id=(p_body->>'tagId')::uuid for update;
    if not found then raise exception 'TAG_NOT_FOUND'; end if;
    if v_action='reset' then
      update public.upload_sessions set invalidated_at=now() where tag_id=v_tag.id;
      insert into public.storage_cleanup_queue(object_path,not_before)
        select object_path,greatest(expires_at,now()) from public.upload_sessions where tag_id=v_tag.id
        on conflict(object_path) do update set not_before=greatest(public.storage_cleanup_queue.not_before,excluded.not_before);
      delete from public.recordings where tag_id=v_tag.id;
      update public.tags set status=case when status='disabled' then 'disabled'::public.tag_status else 'unbound'::public.tag_status end,
        updated_at=now() where id=v_tag.id;
    else
      if jsonb_typeof(p_body->'enabled') is distinct from 'boolean' then raise exception 'REQUEST_INVALID'; end if;
      update public.tags set status=case when not (p_body->>'enabled')::boolean then 'disabled'::public.tag_status
        when exists(select 1 from public.recordings where tag_id=v_tag.id) then 'bound'::public.tag_status
        else 'unbound'::public.tag_status end,updated_at=now() where id=v_tag.id;
    end if;
    insert into public.audit_log(operator_id,action,tag_id) values(p_operator,v_action,v_tag.id);
    return '{"ok":true}';
  elsif v_action='jobs' then
    v_offset:=coalesce((p_body->>'offset')::integer,0); v_limit:=coalesce((p_body->>'limit')::integer,500);
    if v_offset<0 or v_limit not between 1 and 500 then raise exception 'REQUEST_INVALID'; end if;
    v_status:=nullif(p_body->>'status','');
    if v_status is not null and v_status not in ('pending','verified','failed') then raise exception 'REQUEST_INVALID'; end if;
    select count(*) into v_total from public.provisioning_jobs j join public.tags t on t.id=j.tag_id
      where (p_body->>'batch' is null or t.batch=p_body->>'batch') and (v_status is null or j.status=v_status);
    select coalesce(jsonb_agg(public.job_dto(q) order by q.updated_at,q.id),'[]') into v_result
      from (select j.* from public.provisioning_jobs j join public.tags t on t.id=j.tag_id
        where (p_body->>'batch' is null or t.batch=p_body->>'batch') and (v_status is null or j.status=v_status)
        order by j.updated_at,j.id offset v_offset limit v_limit) q;
    return jsonb_build_object('jobs',v_result,'total',v_total);
  elsif v_action='provision' then
    select * into v_job from public.provisioning_jobs where id=(p_body->>'jobId')::uuid for update;
    if not found then raise exception 'JOB_NOT_FOUND'; end if;
    if (p_body->>'version')::integer is distinct from v_job.version or p_body->>'visitorUrl' is distinct from v_job.visitor_url
      then raise exception 'JOB_CONFLICT'; end if;
    if p_body->>'status' is null or p_body->>'status' not in ('verified','failed')
      or length(coalesce(p_body->>'errorCode',''))>80 then raise exception 'REQUEST_INVALID'; end if;
    if v_job.status='verified' then
      if p_body->>'status'='verified' then return '{"ok":true}'; end if;
      raise exception 'JOB_CONFLICT';
    end if;
    update public.provisioning_jobs set status=p_body->>'status',error_code=case when p_body->>'status'='failed'
      then coalesce(p_body->>'errorCode','WRITE_FAILED') else null end,updated_at=now() where id=v_job.id;
    insert into public.audit_log(operator_id,action,tag_id) values(p_operator,'provision',v_job.tag_id);
    return '{"ok":true}';
  elsif v_action='audit' then
    select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'action',q.action,'operatorId',q.operator_id,'tagId',q.tag_id,'createdAt',q.created_at)
      order by q.created_at desc,q.id desc),'[]') into v_result from
      (select * from public.audit_log order by created_at desc,id desc limit 100) q;
    return jsonb_build_object('entries',v_result);
  elsif v_action='playback' then
    select jsonb_build_object('objectPath',r.object_path) into v_result from public.recordings r where r.id=(p_body->>'recordingId')::uuid;
    if v_result is null then raise exception 'RECORDING_NOT_FOUND'; end if;
    return v_result;
  end if;
  raise exception 'REQUEST_INVALID';
end;
$$;

-- Queue selection permanently invalidates expired sessions before any Storage deletion.
-- Keep queue rows until deletion succeeds; a failed worker is safely retried.
create function public.cleanup_candidates() returns table(object_path text)
language plpgsql security definer set search_path = '' as $$
declare v_tag_id uuid;
begin
  for v_tag_id in select t.id from public.tags t where exists(
    select 1 from public.upload_sessions u where u.tag_id=t.id and u.expires_at<=now() and u.claimed_at is null
      and not exists(select 1 from public.storage_cleanup_queue q where q.object_path=u.object_path))
    order by t.id limit 100 for update of t skip locked loop
    with expired as (
      update public.upload_sessions u set invalidated_at=coalesce(invalidated_at,now())
      where u.tag_id=v_tag_id and u.expires_at<=now() and u.claimed_at is null
        and not exists(select 1 from public.recordings r where r.upload_session_id=u.id)
      returning u.object_path,u.expires_at
    ) insert into public.storage_cleanup_queue(object_path,not_before)
      select e.object_path,e.expires_at from expired e on conflict do nothing;
  end loop;
  return query select q.object_path from public.storage_cleanup_queue q
    where q.not_before<=now() and not exists(select 1 from public.recordings r where r.object_path=q.object_path)
    and not exists(select 1 from public.upload_sessions u where u.object_path=q.object_path
      and (u.expires_at>now() or u.invalidated_at is null))
    order by q.created_at limit 100;
end;
$$;
revoke all on function public.admin_action(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.job_dto(public.provisioning_jobs), public.tag_dto(public.tags), public.cleanup_candidates() from public,anon,authenticated;
grant execute on function public.job_dto(public.provisioning_jobs), public.tag_dto(public.tags), public.admin_action(uuid,jsonb), public.cleanup_candidates() to service_role;

create or replace function public.claim_recording(
  p_upload_id uuid,p_claim_token text,p_nickname text,p_duration_seconds integer,
  p_actual_size_bytes bigint,p_actual_mime_type text
) returns table(claim_status text,recording_id uuid,recording_created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_upload public.upload_sessions%rowtype; v_tag public.tags%rowtype; v_id uuid; v_created timestamptz;
begin
  select * into v_upload from public.upload_sessions where id=p_upload_id;
  if not found then raise exception 'UPLOAD_SESSION_INVALID'; end if;
  -- All state mutations lock tag before session, including reset and initialization.
  select * into v_tag from public.tags where id=v_upload.tag_id for update;
  if not found then raise exception 'TAG_UNAVAILABLE'; end if;
  select * into v_upload from public.upload_sessions where id=p_upload_id for update;
  if not found or v_upload.expires_at<=now() or v_upload.claimed_at is not null or v_upload.invalidated_at is not null
    then raise exception 'UPLOAD_SESSION_INVALID'; end if;
  if p_claim_token is null or v_upload.claim_token_hash<>encode(extensions.digest(convert_to(p_claim_token,'UTF8'),'sha256'),'hex')
    then raise exception using errcode='42501',message='UPLOAD_TOKEN_INVALID'; end if;
  if v_tag.status='disabled' then raise exception 'TAG_UNAVAILABLE'; end if;
  if v_tag.status='bound' then
    update public.upload_sessions set invalidated_at=now() where id=v_upload.id;
    insert into public.storage_cleanup_queue(object_path,not_before) values(v_upload.object_path,v_upload.expires_at) on conflict do nothing;
    return query select 'already-bound',r.id,r.created_at from public.recordings r where r.tag_id=v_tag.id;
    return;
  end if;
  if p_actual_size_bytes is null or p_actual_size_bytes<=0 or p_actual_size_bytes>10485760
    or p_actual_size_bytes<>v_upload.size_bytes or p_actual_mime_type is distinct from v_upload.mime_type
    or p_nickname is null or char_length(p_nickname)>24 or p_duration_seconds is null or p_duration_seconds not between 1 and 60
    then raise exception 'RECORDING_INVALID'; end if;
  insert into public.recordings(tag_id,upload_session_id,object_path,nickname,mime_type,size_bytes,duration_seconds)
    values(v_tag.id,v_upload.id,v_upload.object_path,btrim(p_nickname),v_upload.mime_type,p_actual_size_bytes,p_duration_seconds)
    returning id,created_at into v_id,v_created;
  update public.tags set status='bound',updated_at=now() where id=v_tag.id;
  update public.upload_sessions set claimed_at=now() where id=v_upload.id;
  return query select 'claimed',v_id,v_created;
end;
$$;

create function public.initialize_upload(p_token text,p_id uuid,p_hash text,p_mime text,p_size bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_tag public.tags%rowtype; v_expiry timestamptz:=now()+interval '121 minutes'; v_path text;
begin
  if p_mime not in ('audio/mp4','audio/webm','audio/ogg','audio/wav','audio/aac') or p_mime is null
    or p_size is null or p_size not between 1 and 10485760 or p_hash is null then raise exception 'RECORDING_INVALID'; end if;
  select * into v_tag from public.tags where public_token=p_token for update;
  if not found then raise exception 'TAG_NOT_FOUND'; end if;
  if v_tag.status='disabled' then raise exception 'TAG_UNAVAILABLE'; end if;
  if v_tag.status='bound' then raise exception 'ALREADY_BOUND'; end if;
  if (select count(*) from public.upload_sessions where tag_id=v_tag.id and created_at>=now()-interval '1 hour')>=8
    then raise exception 'RATE_LIMITED'; end if;
  v_path:=v_tag.id::text||'/'||p_id::text;
  insert into public.upload_sessions(id,tag_id,object_path,claim_token_hash,mime_type,size_bytes,expires_at)
    values(p_id,v_tag.id,v_path,p_hash,p_mime,p_size,v_expiry);
  return jsonb_build_object('objectPath',v_path,'expiresAt',v_expiry);
end;
$$;

create function public.invalidate_upload(p_upload_id uuid,p_claim_token text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_upload public.upload_sessions%rowtype;
begin
  select * into v_upload from public.upload_sessions where id=p_upload_id;
  if not found then return; end if;
  perform 1 from public.tags where id=v_upload.tag_id for update;
  select * into v_upload from public.upload_sessions where id=p_upload_id for update;
  if v_upload.claim_token_hash is distinct from encode(extensions.digest(convert_to(p_claim_token,'UTF8'),'sha256'),'hex')
    then raise exception using errcode='42501',message='UPLOAD_TOKEN_INVALID'; end if;
  if v_upload.claimed_at is not null or exists(select 1 from public.recordings where upload_session_id=v_upload.id) then return; end if;
  update public.upload_sessions set invalidated_at=now() where id=v_upload.id;
  insert into public.storage_cleanup_queue(object_path,not_before) values(v_upload.object_path,v_upload.expires_at) on conflict do nothing;
end;
$$;
revoke all on function public.initialize_upload(text,uuid,text,text,bigint), public.invalidate_upload(uuid,text) from public,anon,authenticated;
grant execute on function public.initialize_upload(text,uuid,text,text,bigint), public.invalidate_upload(uuid,text) to service_role;

-- Storage starts its two-hour token clock when signing, not at initialization.
-- Extend the deletion deadline after every signing attempt, including ambiguous failure.
create function public.upload_signing_completed(p_upload_id uuid) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_upload public.upload_sessions%rowtype; v_expiry timestamptz;
begin
  select * into v_upload from public.upload_sessions where id=p_upload_id;
  if not found then raise exception 'UPLOAD_SESSION_INVALID'; end if;
  perform 1 from public.tags where id=v_upload.tag_id for update;
  update public.upload_sessions set expires_at=greatest(expires_at,now()+interval '121 minutes')
    where id=p_upload_id returning expires_at into v_expiry;
  update public.storage_cleanup_queue set not_before=greatest(not_before,v_expiry) where object_path=v_upload.object_path;
  return v_expiry;
end;
$$;
revoke all on function public.upload_signing_completed(uuid) from public,anon,authenticated;
grant execute on function public.upload_signing_completed(uuid) to service_role;
