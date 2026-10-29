create table public.recording_audio_state (
 recording_id uuid primary key references public.recordings(id) on delete cascade,
 revision integer not null default 0,
 active_version_id uuid,
 measured_duration double precision,
 mean_db double precision,
 measured_at timestamptz
);
create table public.recording_audio_versions (
 id uuid primary key,
 recording_id uuid not null references public.recordings(id) on delete cascade,
 object_path text not null unique,
 duration double precision not null check(duration>0 and duration<=300),
 start_seconds double precision not null check(start_seconds>=0),
 end_seconds double precision not null check(end_seconds>start_seconds),
 size_bytes bigint not null check(size_bytes>44 and size_bytes<=9600044),
 operator_id uuid not null references auth.users(id),
 request_key uuid not null unique,
 created_at timestamptz not null default now()
);
alter table public.recording_audio_state enable row level security;
alter table public.recording_audio_versions enable row level security;
revoke all on public.recording_audio_state,public.recording_audio_versions from public,anon,authenticated;
grant all on public.recording_audio_state,public.recording_audio_versions to service_role;

create function public.audio_primary_change(p_operator uuid,p_recording uuid,p_revision integer,p_version uuid default null,p_restore boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare tid uuid;s public.recording_audio_state%rowtype;v public.recording_audio_versions%rowtype;
begin
 if not exists(select 1 from public.operator_profiles where user_id=p_operator and role='admin') then raise exception 'ADMIN_REQUIRED';end if;
 if p_revision is null or p_revision<0 then raise exception 'AUDIO_INVALID';end if;
 select tag_id into tid from public.recordings where id=p_recording;
 perform 1 from public.tags where id=tid and deleted_at is null for update;
 if not found or not exists(select 1 from public.recordings where id=p_recording and tag_id=tid) then raise exception 'RECORDING_NOT_FOUND';end if;
 insert into public.recording_audio_state(recording_id) values(p_recording) on conflict do nothing;
 select * into s from public.recording_audio_state where recording_id=p_recording for update;
 if s.revision<>p_revision then raise exception 'AUDIO_VERSION_CONFLICT';end if;
 if not p_restore then
  select * into v from public.recording_audio_versions where id=p_version and recording_id=p_recording;
  if not found then raise exception 'AUDIO_INVALID';end if;
 end if;
 update public.recording_audio_state set revision=revision+1,active_version_id=case when p_restore then null else p_version end where recording_id=p_recording;
 update public.recording_transcriptions set published=false,version=version+1,lease_token=null,lease_expires_at=null,
  status=case when status in ('pending','processing') then 'failed' else status end,
  error_code=case when status in ('pending','processing') then 'AUDIO_CHANGED' else error_code end,updated_at=now() where recording_id=p_recording;
 insert into public.audit_log(operator_id,action,tag_id) values(p_operator,case when p_restore then 'audio.restore' else 'audio.primary' end,tid);
 return jsonb_build_object('revision',s.revision+1,'activeVersionId',case when p_restore then null else p_version end);
end $$;

create function public.audio_commit_version(p_operator uuid,p_recording uuid,p_revision integer,p_version uuid,p_request uuid,p_path text,p_duration double precision,p_start double precision,p_end double precision,p_size bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.recording_audio_versions%rowtype;tid uuid;result jsonb;
begin
 if not exists(select 1 from public.operator_profiles where user_id=p_operator and role='admin') then raise exception 'ADMIN_REQUIRED';end if;
 select tag_id into tid from public.recordings where id=p_recording;
 perform 1 from public.tags where id=tid and deleted_at is null for update;
 if not found or not exists(select 1 from public.recordings where id=p_recording and tag_id=tid) then raise exception 'RECORDING_NOT_FOUND';end if;
 select * into v from public.recording_audio_versions where request_key=p_request;
 if found then
  if v.operator_id<>p_operator or v.recording_id<>p_recording or v.start_seconds<>p_start or v.end_seconds<>p_end or v.size_bytes<>p_size then raise exception 'REQUEST_KEY_CONFLICT';end if;
  return jsonb_build_object('versionId',v.id,'replayed',true);
 end if;
 if p_path is null or p_path<>('edits/'||p_recording::text||'/'||p_version::text||'.wav') or p_end-p_start>300.1 or abs(p_duration-(p_end-p_start))>0.35 then raise exception 'AUDIO_INVALID';end if;
 insert into public.recording_audio_versions(id,recording_id,object_path,duration,start_seconds,end_seconds,size_bytes,operator_id,request_key)
 values(p_version,p_recording,p_path,p_duration,p_start,p_end,p_size,p_operator,p_request);
 result:=public.audio_primary_change(p_operator,p_recording,p_revision,p_version,false);
 delete from public.storage_cleanup_queue where object_path=p_path;
 return result||jsonb_build_object('versionId',p_version);
end $$;

create function public.audio_version_cleanup() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.storage_cleanup_queue(object_path,not_before) values(old.object_path,now()+interval '3 minutes') on conflict(object_path) do update set not_before=greatest(public.storage_cleanup_queue.not_before,excluded.not_before);
 return old;
end $$;
create trigger audio_version_delete after delete on public.recording_audio_versions for each row execute function public.audio_version_cleanup();

revoke all on function public.audio_primary_change(uuid,uuid,integer,uuid,boolean),public.audio_commit_version(uuid,uuid,integer,uuid,uuid,text,double precision,double precision,double precision,bigint),public.audio_version_cleanup() from public,anon,authenticated;
grant execute on function public.audio_primary_change(uuid,uuid,integer,uuid,boolean),public.audio_commit_version(uuid,uuid,integer,uuid,uuid,text,double precision,double precision,double precision,bigint) to service_role;

alter function public.cleanup_candidates() rename to cleanup_candidates_before_audio;
revoke all on function public.cleanup_candidates_before_audio() from public,anon,authenticated,service_role;
create function public.cleanup_candidates() returns table(object_path text)
language sql security definer set search_path='' as $$
 select c.object_path from public.cleanup_candidates_before_audio() c
 where not exists(select 1 from public.recording_audio_versions v where v.object_path=c.object_path)
$$;
revoke all on function public.cleanup_candidates() from public,anon,authenticated;
grant execute on function public.cleanup_candidates() to service_role;

alter function public.claim_transcription() rename to claim_transcription_before_audio;
revoke all on function public.claim_transcription_before_audio() from public,anon,authenticated,service_role;
create function public.claim_transcription() returns jsonb language plpgsql security definer set search_path='' as $$
declare task jsonb;v public.recording_audio_versions%rowtype;
begin
 task:=public.claim_transcription_before_audio();
 if task is null then return null;end if;
 select a.* into v from public.recording_audio_versions a join public.recording_audio_state s on s.active_version_id=a.id and s.recording_id=a.recording_id where s.recording_id=(task->>'recordingId')::uuid;
 if found then task:=task||jsonb_build_object('objectPath',v.object_path,'mimeType','audio/wav','sizeBytes',v.size_bytes);end if;
 return task;
end $$;
revoke all on function public.claim_transcription() from public,anon,authenticated;
grant execute on function public.claim_transcription() to service_role;
