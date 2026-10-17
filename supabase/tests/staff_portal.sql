do $$
declare
 actor uuid:='10000000-0000-4000-8000-000000000011'; outsider uuid:='10000000-0000-4000-8000-000000000012';
 tid uuid:='20000000-0000-4000-8000-000000000011'; rid uuid; data jsonb; task jsonb;
begin
 insert into auth.users values(actor),(outsider);
 insert into public.operator_profiles(user_id,role) values(actor,'staff');
 data:=public.staff_action(actor,'{"action":"session"}');
 if jsonb_array_length(data->'members')<>8 then raise exception 'roster incorrect';end if;
 if exists(select 1 from public.staff_members where id in ('zoe','zhang-yanfang')) then raise exception 'excluded member';end if;
 begin
  perform public.staff_action(outsider,'{"action":"list"}');raise exception 'outsider accepted';
 exception when others then if sqlerrm<>'STAFF_REQUIRED' then raise;end if;end;
 for data in select jsonb_build_object('action',a) from unnest(array['reset','createCards','setPieceAssignment','provision','maintenance','bulkApply']) a loop
  begin perform public.staff_action(actor,data);raise exception 'privileged staff action';
  exception when others then if sqlerrm<>'REQUEST_INVALID' then raise;end if;end;
 end loop;
 insert into public.tags(id,label,inventory_label,public_token) values(tid,'STAFF-TEST','STAFF-TEST',repeat('e',48));
 insert into public.tags(id,label,inventory_label,public_token) values('20000000-0000-4000-8000-000000000012','EMPTY-TEST','EMPTY-TEST',repeat('f',48));
 perform public.initialize_upload(repeat('e',48),'30000000-0000-4000-8000-000000000011',encode(extensions.digest('test','sha256'),'hex'),'audio/wav',10);
 select recording_id into rid from public.claim_recording_transcription('30000000-0000-4000-8000-000000000011','test','',1,10,'audio/wav','{"source":"pin","lat":33.59,"lng":130.40}','A',true);
 update public.tags set topic_id='00000000-0000-4000-8000-000000000003' where id=tid;
 task:=public.claim_transcription();
 data:=public.staff_action(actor,'{"action":"list","limit":1}');
 if (data->>'total')::integer<>2 or data->'cards'->0->>'id'<>tid::text then raise exception 'newest recording not first';end if;
 if data::text like '%eeeeeeee%' or data::text like '%objectPath%' or data::text like '%provisioning%' then raise exception 'private identifiers leaked';end if;
 if data->'cards'->0->>'categoryCode'<>'C' then raise exception 'category code missing from staff card';end if;
 data:=public.staff_action(actor,'{"action":"list","categoryCode":"C"}');
 if (data->>'total')::integer<>1 then raise exception 'category filter failed';end if;
 data:=public.staff_action(actor,'{"action":"list","categoryCode":"A"}');
 if (data->>'total')::integer<>0 then raise exception 'category filter returned wrong cards';end if;
 begin
  perform public.staff_action(actor,jsonb_build_object('action','save','recordingId',rid,'memberId','forged','version',1,'text','draft','published',false));raise exception 'forged member accepted';
 exception when others then if sqlerrm<>'MEMBER_REQUIRED' then raise;end if;end;
 perform public.staff_action(actor,jsonb_build_object('action','save','recordingId',rid,'memberId','wang-heisei','version',1,'text','Synthetic private draft','published',false));
 if public.finish_transcription(rid,(task->>'leaseToken')::uuid,1,'late AI',null,0) then raise exception 'late worker overwrote review';end if;
 data:=public.staff_action(actor,'{"action":"list","search":"private draft","reviewState":"unreviewed"}');
 if (data->>'total')::integer<>1 or data->'cards'->0->'recording'->'transcription'->>'text'<>'Synthetic private draft' then raise exception 'inline draft/search failed';end if;
 begin
  perform public.staff_action(actor,jsonb_build_object('action','save','recordingId',rid,'memberId','wang-heisei','version',1,'text','stale','published',true));raise exception 'stale accepted';
 exception when others then if sqlerrm<>'VERSION_CONFLICT' then raise;end if;end;
 if (select count(*) from public.audit_log where action like 'staff_%')<>1 then raise exception 'conflict wrote audit';end if;
 perform public.staff_action(actor,jsonb_build_object('action','save','recordingId',rid,'memberId','wang-heisei','version',2,'text','Synthetic corrected text','published',true));
 if not exists(select 1 from public.recording_transcriptions where recording_id=rid and published and version=3) then raise exception 'approval failed';end if;
 data:=public.staff_action(actor,'{"action":"list","reviewState":"approved"}');
 if (data->>'total')::integer<>1 or data->'cards'->0->'recording'->'latestReview'->>'memberName' is null then raise exception 'review attribution missing';end if;
 data:=public.staff_action(actor,jsonb_build_object('action','history','tagId',tid));
 if jsonb_array_length(data->'entries')<>2 or data::text like '%Synthetic%' then raise exception 'audit failed or contains text';end if;
 data:=public.staff_action(actor,'{"action":"list","offset":1,"limit":1}');
 if data->'cards'->0->>'label'<>'EMPTY-TEST' then raise exception 'pagination failed';end if;
 update public.tags set status='disabled' where id=tid;
 begin
  perform public.staff_action(actor,jsonb_build_object('action','save','recordingId',rid,'memberId','wang-heisei','version',3,'text','disabled','published',true));raise exception 'disabled accepted';
 exception when others then if sqlerrm<>'RECORDING_NOT_FOUND' then raise;end if;end;
 begin
  perform public.staff_action(actor,jsonb_build_object('action','playback','recordingId',rid,'memberId','wang-heisei'));raise exception 'disabled playback';
 exception when others then if sqlerrm<>'RECORDING_NOT_FOUND' then raise;end if;end;
 -- Reverse race: an editor opened before the AI result cannot overwrite the new body.
 insert into public.tags(id,label,inventory_label,public_token) values('20000000-0000-4000-8000-000000000013','NEW-TEST','NEW-TEST',repeat('d',48));
 perform public.initialize_upload(repeat('d',48),'30000000-0000-4000-8000-000000000013',encode(extensions.digest('test','sha256'),'hex'),'audio/wav',10);
 select recording_id into rid from public.claim_recording_transcription('30000000-0000-4000-8000-000000000013','test','',1,10,'audio/wav',null,'A',true);
 task:=public.claim_transcription();
 if not public.finish_transcription(rid,(task->>'leaseToken')::uuid,1,'Completed AI memory',null,0) then raise exception 'AI completion failed';end if;
 begin
  perform public.staff_action(actor,jsonb_build_object('action','save','recordingId',rid,'memberId','wang-heisei','version',1,'text','','published',false));raise exception 'stale processing editor erased AI';
 exception when others then if sqlerrm<>'VERSION_CONFLICT' then raise;end if;end;
 data:=public.staff_action(actor,'{"action":"list","limit":1}');
 if (data->>'total')::integer<>3 or data->'cards'->0->'recording'->>'id'<>rid::text then raise exception 'latest participant order incorrect';end if;
 if has_function_privilege('authenticated','public.staff_action(uuid,jsonb)','EXECUTE') or has_function_privilege('anon','public.staff_action(uuid,jsonb)','EXECUTE')
 or has_table_privilege('authenticated','public.staff_members','SELECT') then raise exception 'public staff access';end if;
end $$;
