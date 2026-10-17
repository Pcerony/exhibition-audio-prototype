-- A metadata-only backfill: existing text, status and publication remain untouched.
alter table public.recording_transcriptions add column language_hint text not null default 'ja'
 check(language_hint in ('ja','zh','en','ko','es','fr','de','it','pt','ru','vi','th','id','ar','hi','auto'));

-- Keep the legacy nine-argument signature (including its consent default).
-- The explicit ten-argument overload has NO defaults, avoiding RPC ambiguity.
create function public.claim_recording_transcription(p_upload_id uuid,p_claim_token text,p_nickname text,p_duration_seconds integer,p_actual_size_bytes bigint,p_actual_mime_type text,p_location jsonb,p_category_code text,p_transcription_consent boolean,p_language_hint text)
returns table(claim_status text,recording_id uuid,recording_created_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare r record;begin
 if p_language_hint is null or p_language_hint not in ('ja','zh','en','ko','es','fr','de','it','pt','ru','vi','th','id','ar','hi','auto') then raise exception 'REQUEST_INVALID';end if;
 select * into r from public.claim_recording_transcription(p_upload_id,p_claim_token,p_nickname,p_duration_seconds,p_actual_size_bytes,p_actual_mime_type,p_location,p_category_code,p_transcription_consent);
 if r.claim_status='claimed' and p_transcription_consent is true then
  update public.recording_transcriptions set language_hint=p_language_hint where recording_transcriptions.recording_id=r.recording_id;
 end if;
 return query select r.claim_status::text,r.recording_id::uuid,r.recording_created_at::timestamptz;
end $$;
revoke all on function public.claim_recording_transcription(uuid,text,text,integer,bigint,text,jsonb,text,boolean,text) from public,anon,authenticated;
grant execute on function public.claim_recording_transcription(uuid,text,text,integer,bigint,text,jsonb,text,boolean,text) to service_role;

alter function public.claim_transcription() rename to claim_transcription_before_language;
create function public.claim_transcription() returns jsonb language plpgsql security definer set search_path='' as $$
declare task jsonb;hint text;begin
 task:=public.claim_transcription_before_language();
 if task is null then return null;end if;
 select language_hint into hint from public.recording_transcriptions where recording_id=(task->>'recordingId')::uuid;
 return task||jsonb_build_object('languageHint',hint);
end $$;
revoke all on function public.claim_transcription_before_language() from public,anon,authenticated,service_role;
revoke all on function public.claim_transcription() from public,anon,authenticated;
grant execute on function public.claim_transcription() to service_role;

alter function public.staff_action(uuid,jsonb) rename to staff_action_before_language;
create function public.staff_action(p_operator uuid,p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 a text:=p_body->>'action';member_name text;tid uuid;rid uuid;
 q public.recording_transcriptions%rowtype;r public.recordings%rowtype;
 result jsonb;card jsonb;cards jsonb:='[]';review jsonb;hint text;
begin
 if not exists(select 1 from public.operator_profiles where user_id=p_operator and role in ('staff','operator','admin')) then raise exception 'STAFF_REQUIRED';end if;
 if a='list' then
  result:=public.staff_action_before_language(p_operator,p_body);
  for card in select value from jsonb_array_elements(result->'cards') loop
   rid:=(card->'recording'->>'id')::uuid;
   if rid is not null then
    if card->'recording'->'transcription'<>'null'::jsonb then
     select language_hint into hint from public.recording_transcriptions where recording_id=rid;
     card:=jsonb_set(card,'{recording,transcription,languageHint}',coalesce(to_jsonb(hint),'"ja"'::jsonb));
    end if;
    select jsonb_build_object('memberName',coalesce(l.details->>'memberName','管理者'),'createdAt',l.created_at,'action',l.action) into review
     from public.audit_log l where l.tag_id=(card->>'id')::uuid and l.created_at>=(card->'recording'->>'createdAt')::timestamptz
      and l.action in ('staff_approve','staff_save_draft','saveTranscription','staff_retry_transcription') order by l.created_at desc,l.id desc limit 1;
    card:=jsonb_set(card,'{recording,latestReview}',coalesce(review,'null'::jsonb));
   end if;
   cards:=cards||jsonb_build_array(card);
  end loop;
  return jsonb_set(result,'{cards}',cards);
 end if;
 if a is distinct from 'retryTranscription' and a is distinct from 'save' then return public.staff_action_before_language(p_operator,p_body);end if;
 select name into member_name from public.staff_members where id=p_body->>'memberId' and active;
 if member_name is null then raise exception 'MEMBER_REQUIRED';end if;
 select tag_id into tid from public.recordings where id=(p_body->>'recordingId')::uuid;
 -- Same tag-first order as reset, worker claim and worker completion.
 perform 1 from public.tags where id=tid and deleted_at is null and status='bound' for update;
 if not found then raise exception 'RECORDING_NOT_FOUND';end if;
 select * into r from public.recordings where id=(p_body->>'recordingId')::uuid and tag_id=tid;
 if not found then raise exception 'RECORDING_NOT_FOUND';end if;
 if not r.transcription_consent then raise exception 'TRANSCRIPTION_CONSENT_REQUIRED';end if;
 select * into q from public.recording_transcriptions where recording_id=r.id for update;
 if not found then raise exception 'TRANSCRIPTION_NOT_FOUND';end if;
 if jsonb_typeof(p_body->'version') is distinct from 'number' or (p_body->>'version')::numeric<>q.version then raise exception 'VERSION_CONFLICT';end if;
 if a='save' then
  -- Retained reference text must not accidentally become a published new result.
  if q.manual_retry_at is not null and q.status in ('pending','processing') then raise exception 'TRANSCRIPTION_IN_PROGRESS';end if;
  return public.staff_action_before_language(p_operator,p_body);
 end if;
 if jsonb_typeof(p_body->'languageHint') is distinct from 'string' or p_body->>'languageHint' not in ('ja','zh','en','ko','es','fr','de','it','pt','ru','vi','th','id','ar','hi','auto') then raise exception 'REQUEST_INVALID';end if;
 if q.status in ('pending','processing') then raise exception 'TRANSCRIPTION_IN_PROGRESS';end if;
 if q.manual_retry_at>clock_timestamp()-interval '1 minute' then raise exception 'TRANSCRIPTION_RATE_LIMITED';end if;
 update public.recording_transcriptions set status='pending',published=false,language_hint=p_body->>'languageHint',
  version=version+1,attempts=0,lease_token=null,lease_expires_at=null,next_attempt_at=now(),error_code=null,
  manual_retry_at=clock_timestamp(),updated_at=clock_timestamp() where recording_id=r.id;
 insert into public.audit_log(operator_id,action,tag_id,created_at,details) values(p_operator,'staff_retry_transcription',tid,clock_timestamp(),
  jsonb_build_object('recordingId',r.id,'memberId',p_body->>'memberId','memberName',member_name,'languageHint',p_body->>'languageHint','previousPublished',q.published));
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.staff_action_before_language(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.staff_action(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.staff_action(uuid,jsonb) to service_role;

-- Full-admin editors must not publish the retained reference or cancel a staff retry.
alter function public.admin_action(uuid,jsonb) rename to admin_action_before_language;
create function public.admin_action(p_operator uuid,p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare tid uuid;rid uuid;q public.recording_transcriptions%rowtype;begin
 if p_body->>'action'='saveTranscription' then
  if not exists(select 1 from public.operator_profiles where user_id=p_operator and role in ('admin','operator')) then raise exception 'OPERATOR_REQUIRED';end if;
  rid:=(p_body->>'recordingId')::uuid;
  select tag_id into tid from public.recordings where id=rid;
  perform 1 from public.tags where id=tid and deleted_at is null and status='bound' for update;
  if not found or not exists(select 1 from public.recordings where id=rid and tag_id=tid) then raise exception 'RECORDING_NOT_FOUND';end if;
  select * into q from public.recording_transcriptions where recording_id=rid for update;
  if q.manual_retry_at is not null and q.status in ('pending','processing') then raise exception 'TRANSCRIPTION_IN_PROGRESS';end if;
 end if;
 return public.admin_action_before_language(p_operator,p_body);
end $$;
revoke all on function public.admin_action_before_language(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.admin_action(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.admin_action(uuid,jsonb) to service_role;
