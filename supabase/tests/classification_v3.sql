do $$
declare op uuid:='10000000-0000-4000-8000-000000000001';res jsonb;again jsonb;t jsonb;u uuid;v uuid;old_label text;d date;err text;
begin
 if not exists(select 1 from public.tags where label='KEEP-001' and public_token=repeat('a',48) and status='bound') then raise exception 'legacy identity lost';end if;
 if (select count(*) from public.recordings where nickname='legacy')<>1 then raise exception 'legacy recording lost';end if;
 if not exists(select 1 from public.tags where public_token=repeat('b',48) and label=inventory_label and batch='' and category_id is null) then raise exception 'legacy empty card not converted';end if;
 if (public.admin_action(op,'{"action":"list","search":"EMPTY-OLD"}')->>'total')::integer<>1 then raise exception 'legacy empty label not searchable';end if;
 if (select public.tag_dto(x)->>'categoryId' from public.tags x where label='KEEP-001') is not null then raise exception 'legacy silently classified';end if;
 res:=public.admin_action(op,'{"action":"categories"}');
 if jsonb_array_length(res->'categories')<>4 or res->'categories'->0->>'code'<>'A' then raise exception 'fixed categories missing';end if;
 begin perform public.admin_action(op,'{"action":"createCategory","name":"no"}');raise exception 'accepted category';exception when others then if sqlerrm<>'CATEGORIES_FIXED' then raise;end if;end;
 begin perform public.admin_action(op,'{"action":"createCards","count":1,"protocolVersion":2}');raise exception 'old creation accepted';exception when others then if sqlerrm<>'CLIENT_UPGRADE_REQUIRED' then raise;end if;end;
 res:=public.admin_action(op,'{"action":"createCards","count":2,"protocolVersion":3,"requestKey":"40000000-0000-4000-8000-000000000001"}');
 again:=public.admin_action(op,'{"action":"createCards","count":2,"protocolVersion":3,"requestKey":"40000000-0000-4000-8000-000000000001"}');
 if res<>again then raise exception 'creation replay differs';end if;
 t:=res->'tags'->0;
 if t->>'categoryId' is not null or t->>'categoryCode' is not null or t->>'serialNumber' is not null or t->>'batchDate' is not null or t->>'inventoryLabel' !~ '^U[0-9]{6,}$' then raise exception 'empty preclassified';end if;
 if (public.admin_action(op,'{"action":"list","uncategorized":true}')->>'total')::integer<>4 then raise exception 'uncategorized list lost legacy rows';end if;
 begin perform public.admin_action(op,jsonb_build_object('action','bulkPreview','operation','move','tagIds',jsonb_build_array(t->>'id'),'targetCategoryId','00000000-0000-4000-8000-000000000002'));raise exception 'empty move accepted';exception when others then if sqlerrm<>'CATEGORY_UNASSIGNED' then raise;end if;end;
 u:=gen_random_uuid();v:=gen_random_uuid();
 perform public.initialize_upload(t->>'token',u,encode(extensions.digest('test','sha256'),'hex'),'audio/wav',10);
 perform public.initialize_upload(t->>'token',v,encode(extensions.digest('test','sha256'),'hex'),'audio/wav',10);
 begin perform public.claim_recording_classified(u,'test','',1,10,'audio/wav',null,null);raise exception 'missing category accepted';exception when others then if sqlerrm<>'CATEGORY_REQUIRED' then raise;end if;end;
 perform public.claim_recording_classified(u,'test','',1,10,'audio/wav','{"source":"pin","lat":33,"lng":130}','A');
 d:=(now() at time zone 'Asia/Tokyo')::date;
 select public.tag_dto(x) into t from public.tags x where x.id=(t->>'id')::uuid;
 old_label:=t->>'label';
 if old_label<>to_char(d,'YYMMDD')||'-A001' or t->>'batchDate'<>d::text or t->>'categoryId'<>'00000000-0000-4000-8000-000000000001' then raise exception 'claim classification incorrect: %',t;end if;
 perform public.claim_recording_classified(v,'test','',1,10,'audio/wav',null,'B');
 if exists(select 1 from public.daily_topic_counters where category_code='B') then raise exception 'loser allocated number';end if;
 if not exists(select 1 from public.storage_cleanup_queue q join public.upload_sessions s on s.object_path=q.object_path where s.id=v and s.invalidated_at is not null) then raise exception 'loser not safely queued';end if;
 res:=public.admin_action(op,jsonb_build_object('action','bulkPreview','operation','move','tagIds',jsonb_build_array(t->>'id'),'targetCategoryId','00000000-0000-4000-8000-000000000002'));
 perform public.admin_action(op,jsonb_build_object('action','bulkApply','operation','move','kind','recorded','cards',res->'groups'->0->'cards','targetCategoryId','00000000-0000-4000-8000-000000000002','requestKey',gen_random_uuid()));
 if not exists(select 1 from public.tags where id=(t->>'id')::uuid and label=to_char(d,'YYMMDD')||'-B001' and batch_date=d) then raise exception 'move failed';end if;
 perform public.admin_action(op,jsonb_build_object('action','reset','tagId',t->>'id'));
 if not exists(select 1 from public.tags where id=(t->>'id')::uuid and topic_id is null and batch_date is null and serial_number is null and label=inventory_label) then raise exception 'reset metadata remains';end if;
 if (public.admin_action(op,jsonb_build_object('action','list','search',old_label))->>'total')::integer<>1 then raise exception 'old label not searchable';end if;
 if public.allocate_memory_label('A','2091-01-17')<>'910117-A001' or public.allocate_memory_label('A','2091-01-18')<>'910118-A001' then raise exception 'date counters coupled';end if;
 update public.daily_topic_counters set next_number=1000 where category_code='A' and batch_date='2091-01-18';
 if public.allocate_memory_label('A','2091-01-18')<>'910118-A1000' then raise exception 'four digit truncated';end if;
 -- The former legacy recording is corrected using its original Tokyo day,
 -- not the operator's current date or the old arbitrary batch name.
 update public.recordings set created_at='2026-10-16T15:01:00Z' where nickname='legacy';
 select public.tag_dto(x) into t from public.tags x where label='KEEP-001';
 res:=public.admin_action(op,jsonb_build_object('action','bulkPreview','operation','move','tagIds',jsonb_build_array(t->>'id'),'targetCategoryId','00000000-0000-4000-8000-000000000003'));
 perform public.admin_action(op,jsonb_build_object('action','bulkApply','operation','move','kind','recorded','cards',res->'groups'->0->'cards','targetCategoryId','00000000-0000-4000-8000-000000000003','requestKey',gen_random_uuid()));
 if not exists(select 1 from public.tags where id=(t->>'id')::uuid and batch_date='2026-10-17' and label='261017-C001' and public_token=repeat('a',48)) then raise exception 'legacy correction lost original Tokyo date or identity';end if;
 if (public.admin_action(op,'{"action":"list","batchDate":"2026-10-17","categoryId":"00000000-0000-4000-8000-000000000003"}')->>'total')::integer<>1 then raise exception 'date category filter failed';end if;
 if (public.admin_action(op,'{"action":"list","search":"KEEP-001"}')->>'total')::integer<>1 then raise exception 'legacy label history lost';end if;
 -- A version conflict must not consume another number or partially move.
 begin
  perform public.admin_action(op,jsonb_build_object('action','bulkApply','operation','move','kind','recorded','cards',jsonb_build_array(jsonb_build_object('id',t->>'id','version',0)),'targetCategoryId','00000000-0000-4000-8000-000000000004','requestKey',gen_random_uuid()));
  raise exception 'stale version accepted';
 exception when others then if sqlerrm<>'VERSION_CONFLICT' then raise;end if;end;
 if exists(select 1 from public.daily_topic_counters where category_code='D') then raise exception 'stale operation allocated number';end if;
 begin perform public.admin_action('10000000-0000-4000-8000-000000000099','{"action":"list"}');raise exception 'non-operator accepted';exception when others then if sqlerrm<>'OPERATOR_REQUIRED' then raise;end if;end;
 begin perform public.admin_action(op,'{"action":"jobs","protocolVersion":2}');raise exception 'old writer accepted';exception when others then if sqlerrm<>'CLIENT_UPGRADE_REQUIRED' then raise;end if;end;
 res:=public.admin_action(op,'{"action":"nextJob","protocolVersion":3,"deviceId":"fixture"}');
 if res->'job' is null or res->'job'->>'inventoryLabel' is null then raise exception 'unified pool empty';end if;
 again:=public.admin_action(op,'{"action":"nextJob","protocolVersion":3,"deviceId":"fixture"}');
 if again<>res then raise exception 'lease retry changed';end if;
 if has_function_privilege('anon','public.claim_recording_classified(uuid,text,text,integer,bigint,text,jsonb,text)','execute') or has_table_privilege('authenticated','public.memory_topics','select') then raise exception 'privilege leak';end if;
 if has_function_privilege('service_role','public.admin_action_v2(uuid,jsonb)','execute') or has_function_privilege('service_role','public.claim_recording_with_location(uuid,text,text,integer,bigint,text,jsonb)','execute') then raise exception 'legacy bypass remains';end if;
end $$;
