begin;
insert into auth.users(id) values('10000000-0000-4000-8000-000000000001');
insert into public.operator_profiles(user_id,role) values('10000000-0000-4000-8000-000000000001','admin');
do $$
declare op uuid:='10000000-0000-4000-8000-000000000001'; a jsonb; b jsonb; cards jsonb; t jsonb; moved jsonb; lease jsonb; payload jsonb; oldurl text; again jsonb; preview jsonb; upload_id uuid:=gen_random_uuid(); token text:='test-only'; ver bigint;
begin
 begin
 perform public.admin_action(op,'{"action":"jobs"}'::jsonb);
 raise exception 'legacy client received writable jobs';
 exception when others then if sqlerrm<>'CLIENT_UPGRADE_REQUIRED' then raise;end if;end;
 a:=public.admin_action(op,jsonb_build_object('action','createCategory','name','Food','requestKey',gen_random_uuid()));
 b:=public.admin_action(op,jsonb_build_object('action','createCategory','name','Places','requestKey',gen_random_uuid()));
 payload:=jsonb_build_object('action','createCards','categoryId',a#>>'{category,id}','count',2,'requestKey',gen_random_uuid());
 cards:=public.admin_action(op,payload);
 if public.admin_action(op,payload)<>cards then raise exception 'not idempotent'; end if;
 t:=cards#>'{tags,0}'; oldurl:=t#>>'{provisioning,visitorUrl}';
 if t->>'label'<>(a#>>'{category,code}')||'001' then raise exception 'bad numbering'; end if;
 perform public.admin_action(op,jsonb_build_object('action','bulkApply','operation','move','kind','empty','cards',jsonb_build_array(jsonb_build_object('id',t->>'id','version',t->'version')),'targetCategoryId',b#>>'{category,id}','requestKey',gen_random_uuid()));
 select public.tag_dto(x) into moved from public.tags x where id=(t->>'id')::uuid;
 if moved#>>'{provisioning,visitorUrl}'<>oldurl or moved->>'label'<>(b#>>'{category,code}')||'001' then raise exception 'move changed identity'; end if;
 begin
 perform public.admin_action(op,jsonb_build_object('action','bulkApply','operation','delete','kind','empty','cards',jsonb_build_array(jsonb_build_object('id',t->>'id','version',t->'version')),'requestKey',gen_random_uuid()));
 raise exception 'stale delete accepted'; exception when others then if sqlerrm<>'VERSION_CONFLICT' then raise; end if; end;
 lease:=public.admin_action(op,jsonb_build_object('action','nextJob','categoryId',b#>>'{category,id}','deviceId','test-device','protocolVersion',2));
 if lease->'job'='null'::jsonb then raise exception 'missing lease'; end if;
 if public.admin_action(op,jsonb_build_object('action','nextJob','categoryId',b#>>'{category,id}','deviceId','test-device','protocolVersion',2))<>lease then raise exception 'ambiguous retry leased another card';end if;
 again:=public.admin_action(op,jsonb_build_object('action','nextJob','categoryId',b#>>'{category,id}','deviceId','second-device','protocolVersion',2));
 if again->'job'<>'null'::jsonb then raise exception 'double lease';end if;
 begin perform public.admin_action(op,jsonb_build_object('action','provision','jobId',lease#>>'{job,id}','status','verified','version',lease#>'{job,version}','visitorUrl',oldurl,'protocolVersion',2,'leaseToken',gen_random_uuid()));
 raise exception 'wrong lease accepted';exception when others then if sqlerrm<>'LEASE_CONFLICT' then raise;end if;end;
 begin
 perform public.admin_action(op,jsonb_build_object('action','provision','jobId',lease#>>'{job,id}','status','verified','version',lease#>'{job,version}','visitorUrl',oldurl));
 raise exception 'old writer accepted'; exception when others then if sqlerrm<>'CLIENT_UPGRADE_REQUIRED' then raise; end if; end;
 perform public.admin_action(op,jsonb_build_object('action','provision','jobId',lease#>>'{job,id}','status','verified','version',lease#>'{job,version}','visitorUrl',oldurl,'protocolVersion',2,'leaseToken',lease->>'leaseToken'));
 -- Network retries preserve the original successful report.
 perform public.admin_action(op,jsonb_build_object('action','provision','jobId',lease#>>'{job,id}','status','verified','version',lease#>'{job,version}','visitorUrl',oldurl,'protocolVersion',2,'leaseToken',lease->>'leaseToken'));
 -- Rename is reflected in public-facing legacy batch values and the job DTO.
 begin perform public.admin_action(op,jsonb_build_object('action','provision','jobId',lease#>>'{job,id}','status','failed','errorCode','WRITE_FAILED','version',lease#>'{job,version}','visitorUrl',oldurl,'protocolVersion',2,'leaseToken',lease->>'leaseToken'));
 raise exception 'same lease downgraded verified';exception when others then if sqlerrm<>'JOB_CONFLICT' then raise;end if;end;
 perform public.admin_action(op,jsonb_build_object('action','releaseJob','jobId',lease#>>'{job,id}','leaseToken',lease->>'leaseToken'));
 again:=public.admin_action(op,jsonb_build_object('action','leaseJob','jobId',lease#>>'{job,id}','deviceId','explicit-rewrite','protocolVersion',2));
 if again->>'leaseToken'=lease->>'leaseToken' then raise exception 'rewrite reused lease';end if;
 perform public.admin_action(op,jsonb_build_object('action','provision','jobId',again#>>'{job,id}','status','failed','errorCode','WRITE_FAILED','version',again#>'{job,version}','visitorUrl',oldurl,'protocolVersion',2,'leaseToken',again->>'leaseToken'));
 if (select status from public.provisioning_jobs where id=(again#>>'{job,id}')::uuid)<>'failed' then raise exception 'explicit rewrite failure hidden';end if;
 perform public.admin_action(op,jsonb_build_object('action','renameCategory','categoryId',b#>>'{category,id}','name','Landmarks'));
 if (select batch from public.tags where id=(t->>'id')::uuid)<>'Landmarks' then raise exception 'stale category name';end if;
 begin perform public.admin_action(op,jsonb_build_object('action','createCategory','name',' landmarks ','requestKey',gen_random_uuid()));
 raise exception 'duplicate accepted';exception when others then if sqlerrm<>'CATEGORY_NAME_EXISTS' then raise;end if;end;
 select public.tag_dto(x) into moved from public.tags x where id=(t->>'id')::uuid;
 perform public.admin_action(op,jsonb_build_object('action','bulkApply','operation','move','kind','empty','cards',jsonb_build_array(jsonb_build_object('id',moved->>'id','version',moved->'version')),'targetCategoryId',a#>>'{category,id}','requestKey',gen_random_uuid()));
 select public.tag_dto(x) into moved from public.tags x where id=(t->>'id')::uuid;
 if moved->>'label'<>(a#>>'{category,code}')||'003' then raise exception 'old number reused';end if;
 -- A recording arriving after preview must invalidate empty-card approval.
 preview:=public.admin_action(op,jsonb_build_object('action','bulkPreview','operation','delete','tagIds',jsonb_build_array(t->>'id')));
 perform public.initialize_upload(moved->>'token',upload_id,encode(extensions.digest(convert_to(token,'UTF8'),'sha256'),'hex'),'audio/wav',10);
 perform public.claim_recording(upload_id,token,'test',1,10,'audio/wav');
 begin perform public.admin_action(op,jsonb_build_object('action','bulkApply','operation','delete','kind','empty','cards',preview#>'{groups,0,cards}','requestKey',gen_random_uuid()));
 raise exception 'recording race accepted';exception when others then if sqlerrm<>'VERSION_CONFLICT' then raise;end if;end;
 select version into ver from public.tags where id=(t->>'id')::uuid;
 payload:=jsonb_build_object('action','bulkApply','operation','delete','kind','recorded','cards',jsonb_build_array(jsonb_build_object('id',t->>'id','version',ver)),'requestKey',gen_random_uuid());
 perform public.admin_action(op,payload); perform public.admin_action(op,payload);
 if exists(select 1 from public.recordings where tag_id=(t->>'id')::uuid) then raise exception 'recording not reset';end if;
 if not exists(select 1 from public.upload_sessions where id=upload_id and invalidated_at is not null) then raise exception 'upload not invalidated';end if;
 begin perform public.initialize_upload(moved->>'token',gen_random_uuid(),'hash','audio/wav',10);
 raise exception 'deleted upload accepted';exception when others then if sqlerrm<>'TAG_UNAVAILABLE' then raise;end if;end;
 begin perform public.admin_action(op,jsonb_build_object('action','setEnabled','tagId',t->>'id','enabled',true));
 raise exception 'deleted reenabled';exception when others then if sqlerrm<>'TAG_NOT_FOUND' then raise;end if;end;
 -- A fresh job expires and cannot be acknowledged after its deadline.
 again:=public.admin_action(op,jsonb_build_object('action','nextJob','categoryId',a#>>'{category,id}','deviceId','expiry-device','protocolVersion',2));
 update public.provisioning_jobs set lease_expires_at=now()-interval '1 second' where id=(again#>>'{job,id}')::uuid;
 begin perform public.admin_action(op,jsonb_build_object('action','provision','jobId',again#>>'{job,id}','status','verified','version',again#>'{job,version}','visitorUrl',again#>>'{job,visitorUrl}','protocolVersion',2,'leaseToken',again->>'leaseToken'));
 raise exception 'expired lease accepted';exception when others then if sqlerrm<>'LEASE_EXPIRED' then raise;end if;end;
 if has_table_privilege('anon','public.categories','select') or has_table_privilege('authenticated','public.management_requests','select') or has_function_privilege('authenticated','public.admin_action(uuid,jsonb)','execute') or has_function_privilege('service_role','public.admin_action_legacy(uuid,jsonb)','execute') then raise exception 'privilege leaked';end if;
 a:=public.admin_action(op,jsonb_build_object('action','createCategory','name','Number ordering','requestKey',gen_random_uuid()));
 update public.categories set next_number=999 where id=(a#>>'{category,id}')::uuid;
 cards:=public.admin_action(op,jsonb_build_object('action','createCards','categoryId',a#>>'{category,id}','count',2,'requestKey',gen_random_uuid()));
 again:=public.admin_action(op,jsonb_build_object('action','list','categoryId',a#>>'{category,id}','sort','number'));
 if again#>>'{tags,0,label}'<>(a#>>'{category,code}')||'999' or again#>>'{tags,1,label}'<>(a#>>'{category,code}')||'1000' then raise exception 'lexical numbering order';end if;
 lease:=public.admin_action(op,jsonb_build_object('action','nextJob','categoryId',a#>>'{category,id}','deviceId','natural-order','protocolVersion',2));
 if lease#>>'{job,label}'<>(a#>>'{category,code}')||'999' then raise exception 'lexical job order';end if;
 if jsonb_array_length(public.admin_action(op,jsonb_build_object('action','jobs','categoryId',a#>>'{category,id}','protocolVersion',2))->'jobs')<>2 then raise exception 'job filter failed';end if;
 if not exists(select 1 from jsonb_array_elements(public.admin_action(op,'{"action":"audit"}')->'entries') e where e->>'action'='move' and e#>>'{details,fromLabel}' is not null) then raise exception 'missing move audit';end if;
end $$;
rollback;
