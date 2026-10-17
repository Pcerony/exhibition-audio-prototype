begin;
insert into auth.users(id) values
 ('10000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000002');
insert into public.operator_profiles(user_id,role) values
 ('10000000-0000-4000-8000-000000000001','admin');

do $$
declare
 op uuid:='10000000-0000-4000-8000-000000000001';
 other uuid:='10000000-0000-4000-8000-000000000002';
 tid uuid;rid uuid;uid uuid;result jsonb;initial_state text;assignment_version integer;audit jsonb;
begin
 for idx in 1..4 loop
  tid:=('20000000-0000-4000-8000-'||lpad(idx::text,12,'0'))::uuid;
  uid:=('30000000-0000-4000-8000-'||lpad(idx::text,12,'0'))::uuid;
  rid:=('40000000-0000-4000-8000-'||lpad(idx::text,12,'0'))::uuid;
  insert into public.tags(id,label,batch,public_token,inventory_label,status)
   values(tid,'MAP-'||idx,'fixture',repeat('b',48)||idx::text,'M'||idx,'bound');
  insert into public.upload_sessions(id,tag_id,object_path,claim_token_hash,mime_type,size_bytes,expires_at,claimed_at)
   values(uid,tid,'map-test/'||idx,repeat('c',64),'audio/wav',10,now()+interval '1 hour',now());
  insert into public.recordings(id,tag_id,upload_session_id,object_path,nickname,mime_type,size_bytes,duration_seconds,location)
   values(rid,tid,uid,'map-test/'||idx,'guest','audio/wav',10,1,case when idx=3 then null else jsonb_build_object('source','pin','lat',33.59,'lng',130.4) end);
 end loop;

 select assignment_state into initial_state from public.recording_piece_assignments where recording_id='40000000-0000-4000-8000-000000000001';
 if initial_state<>'pending' then raise exception 'location claim must initialize pending, got %',initial_state;end if;
 select assignment_state into initial_state from public.recording_piece_assignments where recording_id='40000000-0000-4000-8000-000000000003';
 if initial_state<>'not_applicable' then raise exception 'missing location must initialize not_applicable';end if;
 if has_table_privilege('anon','public.recording_piece_assignments','select') then raise exception 'anonymous can read private assignment table';end if;

 if not public.save_automatic_piece_assignment('40000000-0000-4000-8000-000000000001','assigned','A1','fukuoka-road-73-v13') then raise exception 'first automatic assignment was rejected';end if;
 select version into assignment_version from public.recording_piece_assignments where recording_id='40000000-0000-4000-8000-000000000001';
 if not public.save_automatic_piece_assignment('40000000-0000-4000-8000-000000000001','assigned','A1','fukuoka-road-73-v13') then raise exception 'repeated same automatic result must be idempotent';end if;
 if (select version from public.recording_piece_assignments where recording_id='40000000-0000-4000-8000-000000000001')<>assignment_version then raise exception 'idempotent retry changed assignment version';end if;
 begin
  perform public.save_automatic_piece_assignment('40000000-0000-4000-8000-000000000001','assigned','Z9','fukuoka-road-73-v13');
  raise exception 'invalid piece code accepted';
 exception when raise_exception then if sqlerrm<>'MAP_ASSIGNMENT_INVALID' then raise;end if;end;
 begin
  perform public.save_automatic_piece_assignment('40000000-0000-4000-8000-000000000001','assigned','A1','unknown-map');
  raise exception 'invalid map version accepted';
 exception when raise_exception then if sqlerrm<>'MAP_ASSIGNMENT_INVALID' then raise;end if;end;
 begin
  perform public.save_automatic_piece_assignment('40000000-0000-4000-8000-000000000001','outside_map','A1','fukuoka-road-73-v13');
  raise exception 'outside-map with fabricated code accepted';
 exception when raise_exception then if sqlerrm<>'MAP_ASSIGNMENT_INVALID' then raise;end if;end;
 if not public.save_automatic_piece_assignment('40000000-0000-4000-8000-000000000002','needs_review','E3','fukuoka-road-73-v13') then raise exception 'review candidate was rejected';end if;
 select version into assignment_version from public.recording_piece_assignments where recording_id='40000000-0000-4000-8000-000000000002';
 if not public.save_automatic_piece_assignment('40000000-0000-4000-8000-000000000002','needs_review','E3','fukuoka-road-73-v13') then raise exception 'repeated same automatic result must be idempotent';end if;
 if (select version from public.recording_piece_assignments where recording_id='40000000-0000-4000-8000-000000000002')<>assignment_version then raise exception 'idempotent retry changed assignment version';end if;
 if not public.save_automatic_piece_assignment('40000000-0000-4000-8000-000000000004','outside_map',null,'fukuoka-road-73-v13') then raise exception 'outside-map state was rejected';end if;

 result:=public.set_manual_piece_assignment(op,'40000000-0000-4000-8000-000000000001',2,'assigned','B2','fukuoka-road-73-v13');
 if (result->>'version')::integer<>3 then raise exception 'manual assignment must increment version';end if;
 if public.save_automatic_piece_assignment('40000000-0000-4000-8000-000000000001','assigned','A1','fukuoka-road-73-v13') then raise exception 'late automatic update replaced manual result';end if;
 if (select piece_code from public.recording_piece_assignments where recording_id='40000000-0000-4000-8000-000000000001')<>'B2'
   or (select assignment_source from public.recording_piece_assignments where recording_id='40000000-0000-4000-8000-000000000001')<>'manual' then raise exception 'manual assignment not preserved';end if;
 begin
  perform public.set_manual_piece_assignment(op,'40000000-0000-4000-8000-000000000001',2,'assigned','C2','fukuoka-road-73-v13');
  raise exception 'stale version accepted';
 exception when raise_exception then if sqlerrm<>'VERSION_CONFLICT' then raise;end if;end;
 begin
  perform public.set_manual_piece_assignment(other,'40000000-0000-4000-8000-000000000001',3,'assigned','C2','fukuoka-road-73-v13');
  raise exception 'operator without admin role accepted';
 exception when raise_exception then if sqlerrm<>'OPERATOR_REQUIRED' then raise;end if;end;
 begin
  perform public.set_manual_piece_assignment(op,'40000000-0000-4000-8000-000000000001',3,'outside_map','A1','fukuoka-road-73-v13');
  raise exception 'manual outside-map code accepted';
 exception when raise_exception then if sqlerrm<>'MAP_ASSIGNMENT_INVALID' then raise;end if;end;
 result:=public.set_manual_piece_assignment(op,'40000000-0000-4000-8000-000000000001',3,'outside_map',null,'fukuoka-road-73-v13');
 if (result->>'version')::integer<>4 then raise exception 'second manual assignment version incorrect';end if;
 select details into audit from public.audit_log where operator_id=op and action='map_piece_override' order by id desc limit 1;
 if audit->>'fromPieceCode'<>'B2' or audit->>'toState'<>'outside_map' or audit->>'toPieceCode' is not null then raise exception 'manual audit details incomplete';end if;

 result:=public.admin_list(op,jsonb_build_object('pieceCode','E3','limit',1,'offset',0));
 if (result->>'total')::integer<>1 or result->'tags'->0->'recording'->>'id'<>'40000000-0000-4000-8000-000000000002' then raise exception 'piece filtering/count was not applied before pagination';end if;
 begin
  perform public.admin_list(op,jsonb_build_object('pieceCode','Z9'));
  raise exception 'invalid piece filter accepted';
 exception when raise_exception then if sqlerrm<>'REQUEST_INVALID' then raise;end if;end;

 delete from public.recordings where id='40000000-0000-4000-8000-000000000003';
 if exists(select 1 from public.recording_piece_assignments where recording_id='40000000-0000-4000-8000-000000000003') then raise exception 'record deletion did not cascade assignment';end if;
end $$;
rollback;
