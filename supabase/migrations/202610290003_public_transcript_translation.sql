create table public.recording_translations (
  recording_id uuid not null references public.recordings(id) on delete cascade,
  source_version integer not null check (source_version > 0),
  target_language text not null check (target_language in ('ja','en','zh-CN','zh-TW','ko','es','fr','de','pt','ru','ar','th','vi','id')),
  translated_text text not null check (char_length(translated_text) between 1 and 10000 and length(trim(translated_text)) > 0),
  created_at timestamptz not null default now(),
  primary key (recording_id, source_version, target_language)
);

alter table public.recording_translations enable row level security;
revoke all on public.recording_translations from public, anon, authenticated;
grant all on public.recording_translations to service_role;

create table public.recording_translation_leases (
  recording_id uuid not null references public.recordings(id) on delete cascade,
  source_version integer not null check (source_version > 0),
  target_language text not null check (target_language in ('ja','en','zh-CN','zh-TW','ko','es','fr','de','pt','ru','ar','th','vi','id')),
  lease_token uuid not null,
  lease_expires_at timestamptz not null,
  primary key (recording_id, source_version, target_language)
);

alter table public.recording_translation_leases enable row level security;
revoke all on public.recording_translation_leases from public, anon, authenticated;
grant all on public.recording_translation_leases to service_role;

create function public.acquire_recording_translation_lease(
  p_recording_id uuid,
  p_source_version integer,
  p_target_language text,
  p_lease_token uuid
) returns boolean
language plpgsql security definer set search_path='' as $$
declare acquired boolean;
begin
  insert into public.recording_translation_leases(recording_id, source_version, target_language, lease_token, lease_expires_at)
  values (p_recording_id, p_source_version, p_target_language, p_lease_token, now() + interval '60 seconds')
  on conflict (recording_id, source_version, target_language) do update
    set lease_token = excluded.lease_token, lease_expires_at = excluded.lease_expires_at
    where public.recording_translation_leases.lease_expires_at <= now()
  returning true into acquired;
  return coalesce(acquired, false);
end;
$$;

create function public.complete_recording_translation(
  p_recording_id uuid,
  p_source_version integer,
  p_target_language text,
  p_lease_token uuid,
  p_translated_text text
) returns boolean
language plpgsql security definer set search_path='' as $$
declare current_tag_id uuid;
begin
  if char_length(p_translated_text) not between 1 and 10000 or length(trim(p_translated_text)) = 0 then
    return false;
  end if;

  select tag_id into current_tag_id from public.recordings where id = p_recording_id;
  if not found then return false; end if;
  perform 1 from public.tags where id = current_tag_id and status = 'bound' and deleted_at is null for update;
  if not found then return false; end if;
  perform 1 from public.recordings
  where id = p_recording_id and tag_id = current_tag_id and transcription_consent = true for update;
  if not found then return false; end if;
  perform 1 from public.recording_transcriptions
  where recording_id = p_recording_id and version = p_source_version and status = 'ready' and published = true for update;
  if not found then return false; end if;
  perform 1 from public.recording_translation_leases
  where recording_id = p_recording_id and source_version = p_source_version
    and target_language = p_target_language and lease_token = p_lease_token and lease_expires_at > now()
  for update;
  if not found then return false; end if;

  insert into public.recording_translations(recording_id, source_version, target_language, translated_text)
  values (p_recording_id, p_source_version, p_target_language, trim(p_translated_text))
  on conflict (recording_id, source_version, target_language)
    do update set translated_text = excluded.translated_text, created_at = now();

  delete from public.recording_translation_leases
  where recording_id = p_recording_id and source_version = p_source_version
    and target_language = p_target_language and lease_token = p_lease_token;
  return found;
end;
$$;

create function public.release_recording_translation_lease(
  p_recording_id uuid,
  p_source_version integer,
  p_target_language text,
  p_lease_token uuid
) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  delete from public.recording_translation_leases
  where recording_id = p_recording_id and source_version = p_source_version
    and target_language = p_target_language and lease_token = p_lease_token;
  return found;
end;
$$;

revoke all on function public.acquire_recording_translation_lease(uuid, integer, text, uuid) from public, anon, authenticated;
revoke all on function public.complete_recording_translation(uuid, integer, text, uuid, text) from public, anon, authenticated;
revoke all on function public.release_recording_translation_lease(uuid, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.acquire_recording_translation_lease(uuid, integer, text, uuid) to service_role;
grant execute on function public.complete_recording_translation(uuid, integer, text, uuid, text) to service_role;
grant execute on function public.release_recording_translation_lease(uuid, integer, text, uuid) to service_role;

create function public.invalidate_recording_translations() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.text is distinct from new.text
     or old.published is distinct from new.published
     or old.version is distinct from new.version then
    delete from public.recording_translations where recording_id = old.recording_id;
  end if;
  return new;
end;
$$;

revoke all on function public.invalidate_recording_translations() from public, anon, authenticated;
create trigger recording_transcriptions_invalidate_translations
  after update of text, published, version on public.recording_transcriptions
  for each row execute function public.invalidate_recording_translations();
