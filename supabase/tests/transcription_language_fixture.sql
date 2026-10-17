insert into auth.users values('10000000-0000-4000-8000-000000000021'),('10000000-0000-4000-8000-000000000022');
insert into public.operator_profiles(user_id,role) values('10000000-0000-4000-8000-000000000021','staff');
insert into public.tags(id,label,inventory_label,public_token) values('20000000-0000-4000-8000-000000000021','LANGUAGE-TEST','LANGUAGE-TEST',repeat('e',48));
select public.initialize_upload(repeat('e',48),'30000000-0000-4000-8000-000000000021',encode(extensions.digest('test','sha256'),'hex'),'audio/wav',10);
select public.claim_recording_transcription('30000000-0000-4000-8000-000000000021','test','',1,10,'audio/wav',null,'A',true);
update public.recording_transcriptions set status='ready',text='Synthetic original memory',published=true,version=7,attempts=3;
