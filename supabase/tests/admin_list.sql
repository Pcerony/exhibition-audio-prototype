begin;
insert into auth.users values ('10000000-0000-4000-8000-000000000001');
insert into public.operator_profiles(user_id,role) values ('10000000-0000-4000-8000-000000000001','admin');
do $$
declare
 op uuid:='10000000-0000-4000-8000-000000000001';
 tag_id uuid;upload_id uuid;recording_id uuid;summary jsonb;page_one jsonb;page_two jsonb;
 state text;idx integer;
begin
 for idx in 1..8 loop
  tag_id:=('20000000-0000-4000-8000-'||lpad(idx::text,12,'0'))::uuid;
  upload_id:=('30000000-0000-4000-8000-'||lpad(idx::text,12,'0'))::uuid;
  recording_id:=('40000000-0000-4000-8000-'||lpad(idx::text,12,'0'))::uuid;
  insert into public.tags(id,label,batch,public_token,inventory_label,status)
   values(tag_id,'TEST-'||lpad(idx::text,3,'0'),'fixture',repeat('a',47)||idx::text,'U'||lpad(idx::text,6,'0'),case when idx=8 then 'unbound'::public.tag_status else 'bound'::public.tag_status end);
  if idx<=7 then
   insert into public.upload_sessions(id,tag_id,object_path,claim_token_hash,mime_type,size_bytes,expires_at,claimed_at)
    values(upload_id,tag_id,'synthetic/'||idx,encode(extensions.digest('fixture','sha256'),'hex'),'audio/wav',10,now()+interval '1 hour',now());
   insert into public.recordings(id,tag_id,upload_session_id,object_path,nickname,mime_type,size_bytes,duration_seconds,created_at,transcription_consent)
    values(recording_id,tag_id,upload_id,'synthetic/'||idx,'guest-'||idx,'audio/wav',10,1,now()+make_interval(secs=>idx),idx<>1);
  end if;
 end loop;
 insert into public.recording_transcriptions(recording_id,status,published,text) values
  ('40000000-0000-4000-8000-000000000002','pending',false,'private-sentinel'),
  ('40000000-0000-4000-8000-000000000003','processing',false,'private-sentinel'),
  ('40000000-0000-4000-8000-000000000004','ready',false,'private-sentinel'),
  ('40000000-0000-4000-8000-000000000005','ready',true,'private-sentinel'),
  ('40000000-0000-4000-8000-000000000006','failed',false,'private-sentinel'),
  ('40000000-0000-4000-8000-000000000007','pending',false,'private-sentinel');

 summary:=public.admin_list(op,'{}'::jsonb);
 if (summary->>'total')::integer<>8 then raise exception 'unfiltered list must retain empty cards and recordings';end if;
 if summary::text like '%private-sentinel%' then raise exception 'transcript text escaped list function';end if;
 foreach state in array array['not_consented','processing','draft','published','failed'] loop
  summary:=public.admin_list(op,jsonb_build_object('transcriptionState',state));
  if (summary->>'total')::integer<>1 then raise exception 'wrong count for %: %',state,summary->>'total';end if;
 end loop;
 summary:=public.admin_list(op,jsonb_build_object('transcriptionState','pending','limit',1,'offset',0));
 page_one:=summary->'tags'->0;
 if (summary->>'total')::integer<>2 or page_one is null then raise exception 'pending page one/count incorrect';end if;
 page_two:=public.admin_list(op,jsonb_build_object('transcriptionState','pending','limit',1,'offset',1))->'tags'->0;
 if page_two is null or page_one->>'id'=page_two->>'id' then raise exception 'pending pagination is not stable';end if;
 summary:=public.admin_list(op,jsonb_build_object('transcriptionState','not_consented'));
 if summary->'tags'->0->>'id'<>'20000000-0000-4000-8000-000000000001' then raise exception 'unconsented filter returned the wrong row';end if;
 begin
  perform public.admin_list(op,jsonb_build_object('transcriptionState','ready'));
  raise exception 'invalid filter accepted';
 exception when raise_exception then if sqlerrm<>'REQUEST_INVALID' then raise;end if;end;
 begin
  perform public.admin_list('90000000-0000-4000-8000-000000000001','{}'::jsonb);
  raise exception 'nonoperator accepted';
 exception when raise_exception then if sqlerrm<>'OPERATOR_REQUIRED' then raise;end if;end;
end $$;
rollback;
