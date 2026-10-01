-- Execute after migrations in an isolated database. All fixtures are rolled back.
begin;
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000001');
insert into public.operator_profiles(user_id,role) values ('00000000-0000-4000-8000-000000000001','operator');
do $$
declare
  v_operator uuid:='00000000-0000-4000-8000-000000000001';
  v_request jsonb:='{"action":"createBatch","requestKey":"00000000-0000-4000-8000-000000000010","rows":[{"label":"Test A","batch":"Fictional"},{"label":"Test B","batch":"Fictional"}]}';
  v_result jsonb; v_replay jsonb; v_tag uuid; v_token text; v_job jsonb;
  v_upload uuid:=gen_random_uuid(); v_candidate uuid:=gen_random_uuid(); v_claim record;
  v_path text; v_count integer;
  v_jobs_before jsonb; v_jobs_after jsonb; v_first_job jsonb;
begin
  if has_function_privilege('anon','public.admin_action(uuid,jsonb)','execute')
    or has_function_privilege('authenticated','public.admin_action(uuid,jsonb)','execute')
    or has_function_privilege('anon','public.cleanup_candidates()','execute')
    or has_function_privilege('authenticated','public.claim_recording(uuid,text,text,integer,bigint,text)','execute')
    then raise exception 'RPC permissions exposed'; end if;
  if has_table_privilege('authenticated','public.tags','select')
    or has_table_privilege('anon','public.storage_cleanup_queue','select') then raise exception 'tables exposed'; end if;
  begin
    perform public.admin_action(gen_random_uuid(),'{"action":"session"}');
    raise exception 'unauthorized operator accepted';
  exception when insufficient_privilege then null; end;
  v_result:=public.admin_action(v_operator,v_request);
  v_replay:=public.admin_action(v_operator,v_request);
  if v_result<>v_replay or jsonb_array_length(v_result->'tags')<>2 then raise exception 'batch replay failed'; end if;
  begin
    perform public.admin_action(v_operator,'{"action":"createBatch","requestKey":"00000000-0000-4000-8000-000000000011","rows":[{"label":"New Atomic","batch":"Fictional"},{"label":" test a ","batch":"Fictional"}]}');
    raise exception 'duplicate normalized label accepted';
  exception when raise_exception then if sqlerrm<>'TAG_LABEL_EXISTS' then raise; end if; end;
  if exists(select 1 from public.tags where label='New Atomic') then raise exception 'partial batch persisted'; end if;
  v_tag:=(v_result#>>'{tags,0,id}')::uuid; v_token:=v_result#>>'{tags,0,token}'; v_job:=v_result#>'{tags,0,provisioning}';
  if length(v_token)<>48 or v_job->>'visitorUrl'<>'https://voice.heisei.space/#/t/'||v_token then raise exception 'URL identity invalid'; end if;
  begin
    perform public.admin_action(v_operator,jsonb_set(v_request,'{rows,0,label}','"Changed"'));
    raise exception 'idempotency mismatch accepted';
  exception when raise_exception then if sqlerrm<>'REQUEST_KEY_CONFLICT' then raise; end if; end;
  v_replay:=public.admin_action(v_operator,'{"action":"jobs","batch":"Fictional","offset":1,"limit":1}');
  if jsonb_array_length(v_replay->'jobs')<>1 or (v_replay->>'total')::int<>2 then raise exception 'job pagination failed'; end if;
  -- A verified report between page reads must not move an unfiltered job.
  update public.provisioning_jobs set updated_at=now()-interval '1 minute'
    where tag_id in(select id from public.tags where batch='Fictional');
  v_jobs_before:=public.admin_action(v_operator,'{"action":"jobs","batch":"Fictional","offset":0,"limit":500}');
  v_first_job:=v_jobs_before#>'{jobs,0}';
  perform public.admin_action(v_operator,jsonb_build_object('action','provision','jobId',v_first_job->>'id',
    'version',v_first_job->'version','visitorUrl',v_first_job->>'visitorUrl','status','verified'));
  v_jobs_after:=public.admin_action(v_operator,'{"action":"jobs","batch":"Fictional","offset":0,"limit":500}');
  if jsonb_path_query_array(v_jobs_before,'$.jobs[*].id')<>jsonb_path_query_array(v_jobs_after,'$.jobs[*].id')
    then raise exception 'provisioning mutation moved job pagination order'; end if;
  v_jobs_after:=public.admin_action(v_operator,'{"action":"jobs","batch":"Fictional","offset":1,"limit":1}');
  if v_jobs_after#>>'{jobs,0,id}' is distinct from v_jobs_before#>>'{jobs,1,id}'
    then raise exception 'provisioning between pages duplicated or skipped job'; end if;
  begin
    perform public.admin_action(v_operator,jsonb_build_object('action','provision','jobId',v_job->>'id','version',1,'visitorUrl','https://wrong.invalid','status','verified'));
    raise exception 'wrong URI accepted';
  exception when raise_exception then if sqlerrm<>'JOB_CONFLICT' then raise; end if; end;
  v_replay:=jsonb_build_object('action','provision','jobId',v_job->>'id','version',1,'visitorUrl',v_job->>'visitorUrl','status','verified');
  perform public.admin_action(v_operator,v_replay); perform public.admin_action(v_operator,v_replay);
  if public.admin_action(v_operator,v_request)<>v_result then raise exception 'batch response changed on replay'; end if;
  perform public.initialize_upload(v_token,v_upload,encode(extensions.digest('claim','sha256'),'hex'),'audio/webm',100);
  perform public.initialize_upload(v_token,v_candidate,encode(extensions.digest('candidate','sha256'),'hex'),'audio/webm',100);
  select * into v_claim from public.claim_recording(v_upload,'claim','',1,100,'audio/webm');
  if v_claim.claim_status<>'claimed' then raise exception 'claim failed'; end if;
  select * into v_claim from public.claim_recording(v_candidate,'candidate','',1,100,'audio/webm');
  if v_claim.claim_status<>'already-bound' then raise exception 'duplicate overwrote recording'; end if;
  -- A stale failed-finalize invalidation must never queue the winner.
  perform public.invalidate_upload(v_upload,'claim');
  if exists(select 1 from public.storage_cleanup_queue q join public.upload_sessions u on q.object_path=u.object_path where u.id=v_upload)
    then raise exception 'winner queued'; end if;
  perform public.admin_action(v_operator,jsonb_build_object('action','setEnabled','tagId',v_tag,'enabled',false));
  perform public.admin_action(v_operator,jsonb_build_object('action','setEnabled','tagId',v_tag,'enabled',true));
  if (select status from public.tags where id=v_tag)<>'bound' then raise exception 'enable lost binding'; end if;
  perform public.admin_action(v_operator,jsonb_build_object('action','reset','tagId',v_tag));
  perform public.admin_action(v_operator,jsonb_build_object('action','reset','tagId',v_tag));
  if exists(select 1 from public.recordings where tag_id=v_tag) then raise exception 'reset left recording'; end if;
  if exists(select 1 from public.upload_sessions where tag_id=v_tag and invalidated_at is null) then raise exception 'reset left active session'; end if;
  select count(*) into v_count from public.cleanup_candidates();
  if v_count<>0 then raise exception 'cleanup before signed upload expiration'; end if;
  -- Advance only fictional session/queue deadlines, not the transaction clock.
  update public.upload_sessions set expires_at=now()-interval '1 minute' where tag_id=v_tag;
  update public.storage_cleanup_queue set not_before=now()-interval '1 minute' where object_path in(select object_path from public.upload_sessions where tag_id=v_tag);
  select count(*) into v_count from public.cleanup_candidates();
  if v_count<>2 then raise exception 'expired reset objects not queued'; end if;
  begin
    perform public.claim_recording(v_candidate,'candidate','',1,100,'audio/webm');
    raise exception 'old session rebound';
  exception when raise_exception then if sqlerrm<>'UPLOAD_SESSION_INVALID' then raise; end if; end;
end;
$$;
rollback;
