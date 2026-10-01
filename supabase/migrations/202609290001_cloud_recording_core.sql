create extension if not exists pgcrypto with schema extensions;

create type public.tag_status as enum ('unbound', 'bound', 'disabled');

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  batch text not null default '',
  public_token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  status public.tag_status not null default 'unbound',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.upload_sessions (
  id uuid primary key default gen_random_uuid(),
  tag_id uuid not null references public.tags(id) on delete cascade,
  object_path text not null unique,
  claim_token_hash text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.recordings (
  id uuid primary key default gen_random_uuid(),
  tag_id uuid not null unique references public.tags(id) on delete cascade,
  upload_session_id uuid not null unique references public.upload_sessions(id),
  object_path text not null unique,
  nickname text not null default '' check (char_length(nickname) <= 24),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  duration_seconds integer not null check (duration_seconds between 1 and 60),
  created_at timestamptz not null default now()
);

create index upload_sessions_tag_created_at_idx on public.upload_sessions(tag_id, created_at desc);

create table public.operator_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('operator', 'admin')),
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  operator_id uuid not null references auth.users(id),
  action text not null,
  tag_id uuid references public.tags(id) on delete set null,
  request_id text,
  created_at timestamptz not null default now()
);

alter table public.tags enable row level security;
alter table public.upload_sessions enable row level security;
alter table public.recordings enable row level security;
alter table public.operator_profiles enable row level security;
alter table public.audit_log enable row level security;

revoke all on public.tags, public.upload_sessions, public.recordings, public.operator_profiles, public.audit_log from anon, authenticated;
grant select on public.tags, public.upload_sessions, public.recordings, public.operator_profiles, public.audit_log to service_role;
grant insert, update, delete on public.tags, public.upload_sessions, public.recordings, public.operator_profiles, public.audit_log to service_role;
grant usage, select on all sequences in schema public to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recordings', 'recordings', false, 10485760, array['audio/mp4', 'audio/webm', 'audio/ogg', 'audio/wav', 'audio/aac'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.claim_recording(
  p_upload_id uuid,
  p_claim_token text,
  p_nickname text,
  p_duration_seconds integer,
  p_actual_size_bytes bigint,
  p_actual_mime_type text
) returns table (claim_status text, recording_id uuid, recording_created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_upload public.upload_sessions%rowtype;
  v_tag public.tags%rowtype;
  v_recording_id uuid;
  v_created_at timestamptz;
begin
  select * into v_upload from public.upload_sessions where id = p_upload_id for update;
  if not found or v_upload.expires_at <= now() or v_upload.claimed_at is not null then
    raise exception using errcode = '22023', message = 'UPLOAD_SESSION_INVALID';
  end if;
  if p_claim_token is null or v_upload.claim_token_hash <> encode(extensions.digest(convert_to(p_claim_token, 'UTF8'), 'sha256'), 'hex') then
    raise exception using errcode = '42501', message = 'UPLOAD_TOKEN_INVALID';
  end if;
  select * into v_tag from public.tags where id = v_upload.tag_id for update;
  if not found or v_tag.status = 'disabled' then
    raise exception using errcode = '22023', message = 'TAG_UNAVAILABLE';
  end if;
  if v_tag.status = 'bound' then
    return query select 'already-bound', r.id, r.created_at from public.recordings r where r.tag_id = v_tag.id;
    return;
  end if;
  if p_actual_size_bytes <= 0 or p_actual_size_bytes > 10485760 or p_actual_size_bytes <> v_upload.size_bytes
     or p_actual_mime_type <> v_upload.mime_type or p_nickname is null
     or char_length(p_nickname) > 24 or p_duration_seconds not between 1 and 60 then
    raise exception using errcode = '22023', message = 'RECORDING_INVALID';
  end if;
  insert into public.recordings(tag_id, upload_session_id, object_path, nickname, mime_type, size_bytes, duration_seconds)
  values (v_tag.id, v_upload.id, v_upload.object_path, btrim(p_nickname), v_upload.mime_type, p_actual_size_bytes, p_duration_seconds)
  returning id, created_at into v_recording_id, v_created_at;
  update public.tags set status = 'bound', updated_at = now() where id = v_tag.id;
  update public.upload_sessions set claimed_at = now() where id = v_upload.id;
  return query select 'claimed', v_recording_id, v_created_at;
end;
$$;

revoke all on function public.claim_recording(uuid, text, text, integer, bigint, text) from public, anon, authenticated;
grant execute on function public.claim_recording(uuid, text, text, integer, bigint, text) to service_role;
