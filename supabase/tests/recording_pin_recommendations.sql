do $test$
declare
  op uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  tid uuid := gen_random_uuid();
  rid uuid := gen_random_uuid();
  uid uuid := gen_random_uuid();
  token text := 'ab' || replace(gen_random_uuid()::text,'-','') || repeat('a',14);
  pin jsonb := '{"source":"pin","lat":33.5946138544,"lng":130.4063520063}';
  place jsonb := '{"source":"place","placeId":"synthetic"}';
  action jsonb;
  found_tag jsonb;
begin
  if has_table_privilege('anon','public.recording_pin_recommendations','select')
    or has_function_privilege('authenticated','public.tag_memory_point_action(uuid,jsonb)','execute')
    or has_function_privilege('anon','public.save_recording_pin_recommendation(uuid,text,text,double precision,double precision)','execute')
  then raise exception 'recommendation data not private'; end if;
  insert into auth.users(id) values(op);
  insert into public.operator_profiles(user_id,role) values(op,'operator');
  insert into public.tags(id,label,batch,public_token,inventory_label,status)
    values(tid,'TEST-PIN-'||tid,'fixture',token,'TEST-PIN-'||tid,'bound');
  insert into public.upload_sessions(id,tag_id,object_path,claim_token_hash,mime_type,size_bytes,expires_at,claimed_at)
    values(uid,tid,'map-test/'||uid,repeat('c',64),'audio/wav',10,now()+interval '1 hour',now());
  insert into public.recordings(id,tag_id,upload_session_id,object_path,nickname,mime_type,size_bytes,duration_seconds,location)
    values(rid,tid,uid,'map-test/'||uid,'','audio/wav',10,1,null);
  update public.recordings set location=pin where id=rid;
  if not public.save_recording_pin_recommendation(rid,'assigned','B4',570,1110) then
    raise exception 'pin recommendation not saved';
  end if;
  if (select assignment_state from public.recording_piece_assignments where recording_id=rid) is distinct from 'assigned' then
    raise exception 'late-arriving location was not assigned';
  end if;
  action := jsonb_build_object('action','locateTag','token',token);
  found_tag := public.tag_memory_point_action(op,action);
  if found_tag->'memoryLocation' is distinct from pin or found_tag#>>'{recommendation,pieceCode}' is distinct from 'B4'
    or found_tag#>'{tag,token}' is not null then raise exception 'lookup contract mismatch'; end if;
  begin
    perform public.tag_memory_point_action(outsider,action);
    raise exception 'unprivileged lookup allowed';
  exception when raise_exception then if sqlerrm <> 'OPERATOR_REQUIRED' then raise; end if; end;
  delete from public.recording_pin_recommendations where recording_id=rid;
  update public.recordings set location=place where id=rid;
  if public.save_recording_pin_recommendation(rid,'assigned','B4',570,1110) then raise exception 'Place accepted'; end if;
  action := jsonb_build_object('action','confirmTagMemoryPoint','tagId',tid,'recordingId',rid,'location',pin,
    'state','assigned','pieceCode','B4','x',570,'y',1110);
  found_tag := public.tag_memory_point_action(op,action);
  if found_tag#>'{recommendation,confirmedLocation}' is distinct from pin
    or (select location from public.recordings where id=rid) is distinct from place then
    raise exception 'confirmation overwrote original or not returned';
  end if;
  begin
    perform public.tag_memory_point_action(op,action);
    raise exception 'repeated confirmation accepted';
  exception when raise_exception then if sqlerrm <> 'VERSION_CONFLICT' then raise; end if; end;
  delete from public.recordings where id=rid;
  if exists(select 1 from public.recording_pin_recommendations where recording_id=rid) then raise exception 'stale recommendation'; end if;
end
$test$;
