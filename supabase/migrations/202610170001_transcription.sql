alter table public.recordings add column transcription_consent boolean not null default false;
create table public.recording_transcriptions (
 recording_id uuid primary key references public.recordings(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','processing','ready','failed')),
 text text check(char_length(text)<=10000),published boolean not null default false,
 version integer not null default 1,attempts integer not null default 0,
 lease_token uuid,lease_expires_at timestamptz,next_attempt_at timestamptz not null default now(),
 error_code text check(error_code in ('PROVIDER_RATE_LIMITED','PROVIDER_UNAVAILABLE','PROVIDER_REJECTED','AUDIO_UNAVAILABLE','AUDIO_TOO_LARGE','RESULT_INVALID','TRANSCRIPTION_TIMEOUT')),
 manual_retry_at timestamptz,updated_at timestamptz not null default now(),
 check(not published or (status='ready' and length(trim(text))>0))
);
alter table public.recording_transcriptions enable row level security;
revoke all on public.recording_transcriptions from public,anon,authenticated;
grant all on public.recording_transcriptions to service_role;

create function public.claim_recording_transcription(p_upload_id uuid,p_claim_token text,p_nickname text,p_duration_seconds integer,p_actual_size_bytes bigint,p_actual_mime_type text,p_location jsonb,p_category_code text,p_transcription_consent boolean default false)
returns table(claim_status text,recording_id uuid,recording_created_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare r record;begin
 select * into r from public.claim_recording_classified(p_upload_id,p_claim_token,p_nickname,p_duration_seconds,p_actual_size_bytes,p_actual_mime_type,p_location,p_category_code);
 if r.claim_status='claimed' and p_transcription_consent is true then
  update public.recordings set transcription_consent=true where id=r.recording_id;
  insert into public.recording_transcriptions(recording_id) values(r.recording_id);
 end if;
 return query select r.claim_status::text,r.recording_id::uuid,r.recording_created_at::timestamptz;
end $$;

create function public.claim_transcription() returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.recording_transcriptions%rowtype;r public.recordings%rowtype;t public.tags%rowtype;begin
 -- Reap exhausted leases before selecting work, even if new work never stops arriving.
 -- Keep the same tag-first lock order as reset/save and skip tags already being changed.
 for t in select tags.* from public.tags tags where exists(
  select 1 from public.recordings rr join public.recording_transcriptions qq on qq.recording_id=rr.id
  where rr.tag_id=tags.id and qq.status='processing' and qq.attempts>=3 and qq.lease_expires_at<=now())
  order by tags.id for update skip locked loop
  update public.recording_transcriptions set status='failed',error_code='TRANSCRIPTION_TIMEOUT',lease_token=null,lease_expires_at=null,updated_at=now()
   where recording_id in(select id from public.recordings where tag_id=t.id) and status='processing' and attempts>=3 and lease_expires_at<=now();
 end loop;
 -- Tag-first locking matches reset and claim. Skip locked tags to avoid concurrent workers waiting.
 for t in select tags.* from public.tags tags where tags.status='bound' and tags.deleted_at is null
  and exists(select 1 from public.recordings rr join public.recording_transcriptions qq on qq.recording_id=rr.id where rr.tag_id=tags.id and rr.transcription_consent
   and qq.attempts<3 and ((qq.status='pending' and qq.next_attempt_at<=now()) or (qq.status='processing' and qq.lease_expires_at<=now())))
  order by tags.id for update skip locked loop
  select * into r from public.recordings where tag_id=t.id and transcription_consent;
  select * into q from public.recording_transcriptions where recording_id=r.id for update;
  if q.attempts<3 and ((q.status='pending' and q.next_attempt_at<=now()) or (q.status='processing' and q.lease_expires_at<=now())) then
   update public.recording_transcriptions set status='processing',attempts=attempts+1,lease_token=gen_random_uuid(),lease_expires_at=now()+interval '2 minutes',updated_at=now() where recording_id=r.id returning * into q;
   return jsonb_build_object('recordingId',r.id,'objectPath',r.object_path,'mimeType',r.mime_type,'sizeBytes',r.size_bytes,'leaseToken',q.lease_token,'version',q.version);
  end if;
 end loop;
 return null;
end $$;

create function public.finish_transcription(p_recording_id uuid,p_lease_token uuid,p_version integer,p_text text,p_error_code text,p_retry_seconds integer default 0)
returns boolean language plpgsql security definer set search_path='' as $$
declare tid uuid;t public.tags%rowtype;q public.recording_transcriptions%rowtype;begin
 select tag_id into tid from public.recordings where id=p_recording_id;
 select * into t from public.tags where id=tid for update;
 if not found or t.deleted_at is not null or t.status<>'bound' then return false;end if;
 if not exists(select 1 from public.recordings where id=p_recording_id and tag_id=t.id and transcription_consent) then return false;end if;
 select * into q from public.recording_transcriptions where recording_id=p_recording_id for update;
 if not found or q.status<>'processing' or q.lease_token is distinct from p_lease_token or q.version<>p_version or q.lease_expires_at<=now() then return false;end if;
 if p_error_code is null then
  if p_text is null or char_length(p_text)>10000 then raise exception 'REQUEST_INVALID';end if;
  update public.recording_transcriptions set status='ready',text=p_text,published=false,error_code=null,lease_token=null,lease_expires_at=null,updated_at=now() where recording_id=p_recording_id;
 else
  update public.recording_transcriptions set status=case when attempts<3 and p_error_code in ('PROVIDER_RATE_LIMITED','PROVIDER_UNAVAILABLE','TRANSCRIPTION_TIMEOUT','AUDIO_UNAVAILABLE') then 'pending' else 'failed' end,
   error_code=p_error_code,lease_token=null,lease_expires_at=null,next_attempt_at=now()+make_interval(secs=>greatest(30*power(2,attempts)::integer,least(greatest(p_retry_seconds,0),86400))),updated_at=now() where recording_id=p_recording_id;
 end if;
 return true;
end $$;

alter function public.admin_action(uuid,jsonb) rename to admin_action_v3;
create function public.admin_action(p_operator uuid,p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a text:=p_body->>'action';r public.recordings%rowtype;q public.recording_transcriptions%rowtype;tid uuid;begin
 if a not in ('getTranscription','retryTranscription','saveTranscription') then return public.admin_action_v3(p_operator,p_body);end if;
 if not exists(select 1 from public.operator_profiles where user_id=p_operator and role in ('admin','operator')) then raise exception 'OPERATOR_REQUIRED';end if;
 select tag_id into tid from public.recordings where id=(p_body->>'recordingId')::uuid;
 perform 1 from public.tags where id=tid and deleted_at is null for update;
 if not found then raise exception 'RECORDING_NOT_FOUND';end if;
 select * into r from public.recordings where id=(p_body->>'recordingId')::uuid;
 if not found then raise exception 'RECORDING_NOT_FOUND';end if;
 select * into q from public.recording_transcriptions where recording_id=r.id for update;
 if a='getTranscription' then return jsonb_build_object('consented',r.transcription_consent,'transcription',case when q.recording_id is null then null else jsonb_build_object('recordingId',r.id,'status',q.status,'text',q.text,'published',q.published,'version',q.version,'errorCode',q.error_code,'updatedAt',q.updated_at) end);end if;
 if not r.transcription_consent then raise exception 'TRANSCRIPTION_CONSENT_REQUIRED';end if;
 if q.recording_id is null then raise exception 'TRANSCRIPTION_NOT_FOUND';end if;
 if jsonb_typeof(p_body->'version') is distinct from 'number' or (p_body->>'version')::numeric<>q.version then raise exception 'VERSION_CONFLICT';end if;
 if a='retryTranscription' then
  if q.manual_retry_at>now()-interval '1 minute' then raise exception 'TRANSCRIPTION_RATE_LIMITED';end if;
  update public.recording_transcriptions set status='pending',text=null,published=false,version=version+1,attempts=0,lease_token=null,lease_expires_at=null,next_attempt_at=now(),error_code=null,manual_retry_at=now(),updated_at=now() where recording_id=r.id;
 else
  if jsonb_typeof(p_body->'text') is distinct from 'string' or jsonb_typeof(p_body->'published') is distinct from 'boolean' or char_length(p_body->>'text')>10000 or ((p_body->>'published')::boolean and length(trim(p_body->>'text'))=0) then raise exception 'REQUEST_INVALID';end if;
  update public.recording_transcriptions set status='ready',text=p_body->>'text',published=(p_body->>'published')::boolean,version=version+1,lease_token=null,lease_expires_at=null,error_code=null,updated_at=now() where recording_id=r.id;
 end if;
 insert into public.audit_log(operator_id,action,tag_id) values(p_operator,a,tid);
 return '{"ok":true}'::jsonb;
end $$;
revoke all on function public.claim_recording_transcription(uuid,text,text,integer,bigint,text,jsonb,text,boolean),public.claim_transcription(),public.finish_transcription(uuid,uuid,integer,text,text,integer),public.admin_action(uuid,jsonb) from public,anon,authenticated;
-- Keep the no-consent V3 claim callable while the owner deploys the replacement handler.
revoke all on function public.admin_action_v3(uuid,jsonb) from service_role;
grant execute on function public.claim_recording_transcription(uuid,text,text,integer,bigint,text,jsonb,text,boolean),public.claim_transcription(),public.finish_transcription(uuid,uuid,integer,text,text,integer),public.admin_action(uuid,jsonb) to service_role;
