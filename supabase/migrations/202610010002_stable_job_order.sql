-- Provisioning updates must not move jobs between offset pages.
-- Offset pagination is not a snapshot: refresh after concurrent creation/deletion
-- or membership changes in a status-filtered result set.
create or replace function public.admin_action(p_operator uuid, p_body jsonb) returns jsonb
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
    select coalesce(jsonb_agg(public.job_dto(q) order by q.id),'[]') into v_result
      from (select j.* from public.provisioning_jobs j join public.tags t on t.id=j.tag_id
        where (p_body->>'batch' is null or t.batch=p_body->>'batch') and (v_status is null or j.status=v_status)
        order by j.id offset v_offset limit v_limit) q;
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

revoke all on function public.admin_action(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.admin_action(uuid,jsonb) to service_role;
