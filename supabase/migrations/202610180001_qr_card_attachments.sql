create table public.qr_card_attachments (
 id uuid primary key default gen_random_uuid(),
 tag_id uuid not null unique references public.tags(id) on delete cascade,
 recording_id uuid not null,
 tag_version integer not null,
 version integer not null default 1,
 status text not null default 'pending' check(status in ('pending','failed','verified')),
 chip_hash text unique check(chip_hash ~ '^[a-f0-9]{64}$'),
 lease_token uuid, lease_operator uuid references auth.users(id), lease_device text, lease_expires_at timestamptz,
 error_code text, last_report jsonb, written_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.qr_card_attachments enable row level security;
revoke all on public.qr_card_attachments from public,anon,authenticated;
grant select,insert,update,delete on public.qr_card_attachments to service_role;

-- A write result can arrive after expiry/recovery. Keep the original authenticated receipt.
create table public.qr_attachment_leases (
 lease_token uuid primary key,
 attachment_id uuid not null references public.qr_card_attachments(id) on delete cascade,
 operator_id uuid not null references auth.users(id),
 began boolean not null default false,
 created_at timestamptz not null default now()
);
alter table public.qr_attachment_leases enable row level security;
revoke all on public.qr_attachment_leases from public,anon,authenticated;
grant select,insert,update,delete on public.qr_attachment_leases to service_role;

create function public.qr_attachment_dto(p public.qr_card_attachments) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p.id,'tagId',t.id,'label',coalesce(t.serial_number,t.label),
  'inventoryLabel',t.inventory_label,'categoryId',t.topic_id,'categoryCode',c.code,'batchDate',t.batch_date,
  'batch',coalesce(t.batch_date::text,t.batch),'serialNumber',t.serial_number,
  'visitorUrl','https://voice.heisei.space/#/t/'||t.public_token,'version',p.version,'tagVersion',p.tag_version,
  'status',p.status,'errorCode',p.error_code,'recordingStatus',case when t.status='bound' then 'bound' else 'unbound' end,
  'writtenAt',p.written_at,'jobKind','qr')
 from public.tags t left join public.memory_topics c on c.id=t.topic_id where t.id=p.tag_id
$$;
revoke all on function public.qr_attachment_dto(public.qr_card_attachments) from public,anon,authenticated;

alter function public.admin_action(uuid,jsonb) rename to admin_action_before_qr_attachment;
create function public.admin_action(p_operator uuid,p_body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 a text:=p_body->>'action'; t public.tags%rowtype; j public.qr_card_attachments%rowtype;
 rid uuid; tid uuid; off integer; lim integer; q text; s text; d date; ordering text; result jsonb;
begin
 if a not in ('qrCards','qrJobs','prepareQrAttachment','beginQrAttachment','provisionQrAttachment','releaseQrAttachment') then
  return public.admin_action_before_qr_attachment(p_operator,p_body);
 end if;
 if not exists(select 1 from public.operator_profiles where user_id=p_operator and role in ('operator','admin')) then raise exception 'OPERATOR_REQUIRED';end if;
 if a in ('qrCards','qrJobs') then
  off:=coalesce((p_body->>'offset')::integer,0);lim:=coalesce((p_body->>'limit')::integer,case when a='qrCards' then 50 else 500 end);
  if off<0 or lim not between 1 and (case when a='qrCards' then 50 else 500 end) then raise exception 'REQUEST_INVALID';end if;
  if a='qrJobs' then
   with selected as(select x.* from public.qr_card_attachments x join public.tags y on y.id=x.tag_id where y.deleted_at is null)
   select jsonb_build_object('total',(select count(*) from selected),'jobs',coalesce((select jsonb_agg(public.qr_attachment_dto(z)) from(select * from selected order by id offset off limit lim) z),'[]')) into result;
  else
   q:=coalesce(p_body->>'search','');s:=coalesce(p_body->>'status','');ordering:=coalesce(p_body->>'sort','recorded_desc');d:=nullif(p_body->>'batchDate','')::date;
   if length(q)>200 or s not in ('','bound','unbound','disabled') or ordering not in ('recorded_desc','recorded_asc','number') then raise exception 'REQUEST_INVALID';end if;
   with selected as(select x.*,r.created_at as recorded_at from public.tags x left join public.recordings r on r.tag_id=x.id
    where x.entry_channel='qr' and x.deleted_at is null and (s='' or x.status::text=s)
    and (q='' or x.label ilike '%'||q||'%' or x.inventory_label ilike '%'||q||'%' or x.id::text=q)
    and (d is null or (r.created_at at time zone 'Asia/Tokyo')::date=d))
   select jsonb_build_object('total',(select count(*) from selected),'tags',coalesce((select jsonb_agg(z.dto) from(
    select public.tag_dto(tag)||jsonb_build_object('attachment',(select public.qr_attachment_dto(k) from public.qr_card_attachments k where k.tag_id=x.id)) as dto
    from selected x join public.tags tag on tag.id=x.id order by
     case when ordering='recorded_desc' then x.recorded_at end desc nulls last,
     case when ordering='recorded_asc' then x.recorded_at end asc nulls last,
     case when ordering='number' then coalesce(x.serial_number,x.inventory_label) end,x.created_at desc,x.id
    offset off limit lim) z),'[]')) into result;
  end if;
  return result;
 end if;
 if a<>'releaseQrAttachment' and p_body->>'protocolVersion' is distinct from '3' then raise exception 'CLIENT_UPGRADE_REQUIRED';end if;
 if a='prepareQrAttachment' then
  if length(trim(coalesce(p_body->>'deviceId',''))) not between 1 and 120 or (p_body->>'expectedVersion')::integer is null then raise exception 'REQUEST_INVALID';end if;
  tid:=(p_body->>'tagId')::uuid;
 else
  select tag_id into tid from public.qr_card_attachments where id=(p_body->>'jobId')::uuid;
  if not found then raise exception 'JOB_NOT_FOUND';end if;
 end if;
 select * into t from public.tags where id=tid for update;
 if not found then raise exception 'TAG_NOT_FOUND';end if;
 select id into rid from public.recordings where tag_id=t.id;
 select * into j from public.qr_card_attachments where tag_id=t.id for update;
 if a='releaseQrAttachment' then
  if j.lease_token is null or j.lease_token::text is distinct from p_body->>'leaseToken' or j.lease_operator<>p_operator then raise exception 'LEASE_CONFLICT';end if;
  update public.qr_card_attachments set lease_expires_at=now() where id=j.id;
  return '{"ok":true}';
 end if;
 if t.entry_channel<>'qr' or t.deleted_at is not null or t.status<>'bound' or rid is null then raise exception 'JOB_INELIGIBLE';end if;
 if j.id is not null and (j.recording_id<>rid or j.tag_version<>t.version) then raise exception 'JOB_CONFLICT';end if;
 if a='prepareQrAttachment' then
  if (p_body->>'expectedVersion')::integer<>t.version then raise exception 'JOB_CONFLICT';end if;
  if j.status='verified' then raise exception 'JOB_INELIGIBLE';end if;
  if j.id is null then
   insert into public.qr_card_attachments(tag_id,recording_id,tag_version) values(t.id,rid,t.version) returning * into j;
  end if;
  if j.lease_expires_at>now() then
   if j.lease_operator<>p_operator or j.lease_device<>p_body->>'deviceId' then raise exception 'LEASE_CONFLICT';end if;
  else
   update public.qr_card_attachments set lease_token=gen_random_uuid(),lease_operator=p_operator,lease_device=p_body->>'deviceId',lease_expires_at=now()+interval '10 minutes',last_report=null where id=j.id returning * into j;
   insert into public.qr_attachment_leases(lease_token,attachment_id,operator_id) values(j.lease_token,j.id,p_operator);
  end if;
  return jsonb_build_object('job',public.qr_attachment_dto(j),'leaseToken',j.lease_token,'expiresAt',j.lease_expires_at);
 end if;
 if a='provisionQrAttachment' then
  if not exists(select 1 from public.qr_attachment_leases l where l.attachment_id=j.id and l.lease_token::text=p_body->>'leaseToken' and l.operator_id=p_operator) then raise exception 'LEASE_CONFLICT';end if;
  if (p_body->>'version')::integer is distinct from j.version or p_body->>'visitorUrl' is distinct from 'https://voice.heisei.space/#/t/'||t.public_token then raise exception 'JOB_CONFLICT';end if;
  if coalesce(p_body->>'status','') not in ('verified','failed') or length(coalesce(p_body->>'errorCode',''))>80 then raise exception 'REQUEST_INVALID';end if;
  if p_body->>'status'='verified' and not exists(select 1 from public.qr_attachment_leases l where l.lease_token::text=p_body->>'leaseToken' and l.began) then raise exception 'JOB_INELIGIBLE';end if;
  if j.last_report=p_body then return '{"ok":true}';end if;
  if j.status='verified' then
   if p_body->>'status'='verified' then return '{"ok":true}';end if;
   raise exception 'JOB_CONFLICT';
  end if;
  -- A stale failure cannot overwrite another device's newer attempt.
  if p_body->>'status'='failed' and j.lease_token::text is distinct from p_body->>'leaseToken' then return '{"ok":true}';end if;
  update public.qr_card_attachments set status=p_body->>'status',error_code=case when p_body->>'status'='failed' then coalesce(p_body->>'errorCode','WRITE_FAILED') end,
   written_at=case when p_body->>'status'='verified' then now() end,updated_at=now(),last_report=p_body where id=j.id;
  insert into public.audit_log(operator_id,action,tag_id) values(p_operator,'qr_attach_'||(p_body->>'status'),t.id);
  return '{"ok":true}';
 end if;
 if j.lease_token is null or j.lease_token::text is distinct from p_body->>'leaseToken' or j.lease_operator<>p_operator then raise exception 'LEASE_CONFLICT';end if;
 if j.status='verified' then raise exception 'JOB_CONFLICT';end if;
 if j.lease_expires_at<=now() then raise exception 'LEASE_EXPIRED';end if;
 if a='beginQrAttachment' then
  if coalesce(p_body->>'chipHash','') !~ '^[a-f0-9]{64}$' then raise exception 'REQUEST_INVALID';end if;
  if j.chip_hash is not null and j.chip_hash<>p_body->>'chipHash' then raise exception 'CHIP_CONFLICT';end if;
  begin
   update public.qr_card_attachments set chip_hash=p_body->>'chipHash',updated_at=now() where id=j.id;
   update public.qr_attachment_leases set began=true where lease_token=j.lease_token;
  exception when unique_violation then raise exception 'CHIP_CONFLICT';end;
 end if;
 return '{"ok":true}';
end;
$$;
revoke all on function public.admin_action_before_qr_attachment(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.admin_action(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.admin_action(uuid,jsonb) to service_role;
