-- Remember identity, not a response snapshot: eligibility is rechecked on replay.
create table public.write_preparations (
 request_key uuid primary key,
 operator_id uuid not null references auth.users(id),
 device_id text not null check(length(btrim(device_id)) between 1 and 120),
 job_id uuid not null references public.provisioning_jobs(id),
 tag_version integer not null,
 job_version integer not null,
 created_at timestamptz not null default now()
);
alter table public.write_preparations enable row level security;
revoke all on public.write_preparations from public,anon,authenticated;
grant all on public.write_preparations to service_role;

alter function public.admin_action(uuid,jsonb) rename to admin_action_transcription;
create function public.admin_action(p_operator uuid,p_body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare req public.write_preparations%rowtype;t public.tags%rowtype;j public.provisioning_jobs%rowtype;
 v_key uuid;v_device text:=p_body->>'deviceId';v_label text;v_replay boolean:=false;
begin
 if p_body->>'action' is distinct from 'prepareWrite' then return public.admin_action_transcription(p_operator,p_body);end if;
 if not exists(select 1 from public.operator_profiles where user_id=p_operator and role in ('operator','admin')) then raise exception 'OPERATOR_REQUIRED';end if;
 if jsonb_typeof(p_body->'deviceId') is distinct from 'string' or length(btrim(coalesce(v_device,''))) not between 1 and 120
  or length(v_device)>120 or jsonb_typeof(p_body->'requestKey') is distinct from 'string'
  or (p_body->>'requestKey') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'REQUEST_INVALID';end if;
 if p_body->'protocolVersion' is distinct from '3'::jsonb then raise exception 'CLIENT_UPGRADE_REQUIRED';end if;
 v_key:=(p_body->>'requestKey')::uuid;
 -- Match legacy writer serialization, then serialize keys across devices/accounts.
 perform pg_advisory_xact_lock(hashtextextended('lease:'||p_operator::text||':'||v_device,0));
 perform pg_advisory_xact_lock(hashtextextended('prepare:'||v_key::text,0));
 select * into req from public.write_preparations where request_key=v_key;
 if found then
  if req.operator_id<>p_operator or req.device_id<>v_device then raise exception 'REQUEST_KEY_CONFLICT';end if;
  v_replay:=true;
  select x.* into t from public.tags x join public.provisioning_jobs z on z.tag_id=x.id where z.id=req.job_id for update of x;
  if not found then raise exception 'JOB_INELIGIBLE';end if;
 else
  select x.* into t from public.tags x join public.provisioning_jobs z on z.tag_id=x.id
   where x.deleted_at is null and x.status='unbound' and z.status='pending'
    and z.lease_auto and z.lease_operator=p_operator and z.lease_device=v_device
    and z.lease_expires_at>now() and z.lease_tag_version=x.version
    and not exists(select 1 from public.recordings r where r.tag_id=x.id)
   order by x.id for update of x limit 1;
  if not found then
   -- Unreleased expired leases may have been physically written; do not recycle.
   select x.* into t from public.tags x join public.provisioning_jobs z on z.tag_id=x.id
    where x.deleted_at is null and x.status='unbound' and z.status='pending' and z.lease_token is null
     and (z.lease_expires_at is null or z.lease_expires_at<=now())
     and not exists(select 1 from public.recordings r where r.tag_id=x.id)
    order by length(x.inventory_label),x.inventory_label,x.id for update of x skip locked limit 1;
  end if;
  if not found then
   v_label:=public.next_inventory_label();
   insert into public.tags(label,batch,inventory_label) values(v_label,'',v_label) returning * into t;
   insert into public.label_history(label,tag_id) values(lower(v_label),t.id);
   insert into public.provisioning_jobs(tag_id,visitor_url) values(t.id,'https://voice.heisei.space/#/t/'||t.public_token);
   insert into public.audit_log(operator_id,action,tag_id) values(p_operator,'create',t.id);
  end if;
 end if;
 select * into j from public.provisioning_jobs where tag_id=t.id for update;
 if t.deleted_at is not null or t.status<>'unbound' or j.status<>'pending'
  or exists(select 1 from public.recordings where tag_id=t.id) then raise exception 'JOB_INELIGIBLE';end if;
 if v_replay and (req.tag_version<>t.version or req.job_version<>j.version) then raise exception 'JOB_CONFLICT';end if;
 if v_replay and exists(select 1 from public.provisioning_jobs z join public.tags x on x.id=z.tag_id
  where z.id<>j.id and z.lease_operator=p_operator and z.lease_device=v_device and z.lease_auto
   and z.lease_expires_at>now() and z.lease_tag_version=x.version and z.status='pending'
   and x.deleted_at is null and x.status='unbound' and not exists(select 1 from public.recordings r where r.tag_id=x.id)) then raise exception 'LEASE_CONFLICT';end if;
 if j.lease_expires_at>now() and (j.lease_operator is distinct from p_operator or j.lease_device is distinct from v_device or j.lease_tag_version is distinct from t.version) then raise exception 'LEASE_CONFLICT';end if;
 if j.lease_token is null or j.lease_expires_at is null or j.lease_expires_at<=now() then
  update public.provisioning_jobs set lease_token=gen_random_uuid(),lease_operator=p_operator,lease_device=v_device,
   lease_expires_at=now()+interval '10 minutes',lease_tag_version=t.version,lease_auto=true,last_report=null
   where id=j.id returning * into j;
 end if;
 if not v_replay then
  insert into public.write_preparations(request_key,operator_id,device_id,job_id,tag_version,job_version) values(v_key,p_operator,v_device,j.id,t.version,j.version);
 end if;
 return jsonb_build_object('job',public.job_dto(j),'leaseToken',j.lease_token,'expiresAt',j.lease_expires_at);
end $$;
revoke all on function public.admin_action(uuid,jsonb),public.admin_action_transcription(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.admin_action_transcription(uuid,jsonb) from service_role;
grant execute on function public.admin_action(uuid,jsonb) to service_role;
