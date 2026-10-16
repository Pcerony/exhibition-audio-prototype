-- Keep legacy categories and their foreign keys intact, including colliding A-D codes.
create table public.memory_topics(id uuid primary key,code text not null unique check(code in ('A','B','C','D')),name text not null);
insert into public.memory_topics values
 ('00000000-0000-4000-8000-000000000001','A','美食'),
 ('00000000-0000-4000-8000-000000000002','B','旅行'),
 ('00000000-0000-4000-8000-000000000003','C','相遇'),
 ('00000000-0000-4000-8000-000000000004','D','其他回忆');
create sequence public.inventory_number_sequence;
create table public.daily_topic_counters(batch_date date not null,category_code text not null references public.memory_topics(code),next_number bigint not null check(next_number>0),primary key(batch_date,category_code));
alter table public.tags alter column category_id drop not null;
alter table public.tags add column inventory_label text,add column topic_id uuid references public.memory_topics(id),add column batch_date date,add column serial_number text;
insert into public.label_history(label,tag_id) select lower(btrim(label)),id from public.tags on conflict do nothing;

create function public.next_inventory_label() returns text language plpgsql security definer set search_path='' as $$
declare n bigint;v text;begin loop
 n:=nextval('public.inventory_number_sequence');v:='U'||lpad(n::text,greatest(6,length(n::text)),'0');
 exit when not exists(select 1 from public.label_history where label=lower(v)) and not exists(select 1 from public.tags where inventory_label=v);
 end loop;return v;end $$;
do $$ declare t public.tags%rowtype;v text;begin
 for t in select * from public.tags order by created_at,id loop
  v:=public.next_inventory_label();update public.tags set inventory_label=v where id=t.id;
  insert into public.label_history(label,tag_id) values(lower(v),t.id);
 end loop;
end $$;
-- Empty legacy cards enter the same unclassified inventory pool. Their former
-- visible labels remain reserved and searchable in label_history.
update public.tags t set label=t.inventory_label,batch='',category_id=null
 where not exists(select 1 from public.recordings r where r.tag_id=t.id);
alter table public.tags alter column inventory_label set not null;
create unique index tags_inventory_label_idx on public.tags(inventory_label);
create unique index tags_serial_number_idx on public.tags(serial_number) where serial_number is not null;

create function public.allocate_memory_label(p_code text,p_date date) returns text language plpgsql security definer set search_path='' as $$
declare n bigint;v text;begin
 if p_code is null then raise exception 'CATEGORY_REQUIRED';end if;
 if not exists(select 1 from public.memory_topics where code=p_code) then raise exception 'CATEGORY_INVALID';end if;
 if p_date is null then raise exception 'REQUEST_INVALID';end if;
 loop
  insert into public.daily_topic_counters values(p_date,p_code,2)
   on conflict(batch_date,category_code) do update set next_number=public.daily_topic_counters.next_number+1
   returning next_number-1 into n;
  v:=to_char(p_date,'YYMMDD')||'-'||p_code||lpad(n::text,greatest(3,length(n::text)),'0');
  exit when not exists(select 1 from public.label_history where label=lower(v));
 end loop;return v;
end $$;

create function public.claim_recording_classified(p_upload_id uuid,p_claim_token text,p_nickname text,p_duration_seconds integer,p_actual_size_bytes bigint,p_actual_mime_type text,p_location jsonb,p_category_code text)
returns table(claim_status text,recording_id uuid,recording_created_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare r record;v_date date;v_label text;v_tag uuid;begin
 if p_category_code is null or p_category_code='' then raise exception 'CATEGORY_REQUIRED';end if;
 if not exists(select 1 from public.memory_topics where code=p_category_code) then raise exception 'CATEGORY_INVALID';end if;
 -- Existing claim locks tag first; the lock remains held until classification commits.
 select * into r from public.claim_recording_with_location(p_upload_id,p_claim_token,p_nickname,p_duration_seconds,p_actual_size_bytes,p_actual_mime_type,p_location);
 if r.claim_status='claimed' then
  r.recording_created_at:=clock_timestamp();
  update public.recordings set created_at=r.recording_created_at where id=r.recording_id;
  v_date:=(r.recording_created_at at time zone 'Asia/Tokyo')::date;
  v_label:=public.allocate_memory_label(p_category_code,v_date);
  select tag_id into v_tag from public.recordings where id=r.recording_id;
  insert into public.label_history(label,tag_id) values(lower(v_label),v_tag);
  update public.tags set label=v_label,serial_number=v_label,batch=v_date::text,batch_date=v_date,category_id=null,
   topic_id=(select id from public.memory_topics where code=p_category_code) where id=v_tag;
 end if;
 return query select r.claim_status::text,r.recording_id::uuid,r.recording_created_at::timestamptz;
end $$;

create or replace function public.job_dto(p_job public.provisioning_jobs) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p_job.id,'tagId',t.id,'label',coalesce(t.serial_number,t.label),'batch',coalesce(t.batch_date::text,t.batch),
 'categoryId',t.topic_id,'categoryCode',c.code,'batchDate',t.batch_date,'serialNumber',t.serial_number,'inventoryLabel',t.inventory_label,
 'visitorUrl',p_job.visitor_url,'version',p_job.version,'tagVersion',t.version,'status',p_job.status,'errorCode',p_job.error_code,
 'recordingStatus',case when exists(select 1 from public.recordings r where r.tag_id=t.id) then 'bound' else 'unbound' end,
 'leaseExpiresAt',p_job.lease_expires_at,'leased',coalesce(p_job.lease_expires_at>now(),false),'writtenAt',case when p_job.status='verified' then p_job.updated_at end)
 from public.tags t left join public.memory_topics c on c.id=t.topic_id where t.id=p_job.tag_id
$$;
create or replace function public.tag_dto(p_tag public.tags) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p_tag.id,'token',p_tag.public_token,'label',coalesce(p_tag.serial_number,p_tag.label),'batch',coalesce(p_tag.batch_date::text,p_tag.batch),
 'categoryId',p_tag.topic_id,'categoryCode',c.code,'batchDate',p_tag.batch_date,'serialNumber',p_tag.serial_number,'inventoryLabel',p_tag.inventory_label,'version',p_tag.version,
 'status',p_tag.status,'createdAt',p_tag.created_at,'recording',(select jsonb_build_object('id',r.id,'nickname',r.nickname,'duration',r.duration_seconds,'mimeType',r.mime_type,'createdAt',r.created_at,'location',r.location) from public.recordings r where r.tag_id=p_tag.id),
 'provisioning',(select public.job_dto(j) from public.provisioning_jobs j where j.tag_id=p_tag.id))
 from (select 1) seed left join public.memory_topics c on c.id=p_tag.topic_id
$$;

-- Retain V2 only for unchanged operations, never for allocating labels or leases.
alter function public.admin_action(uuid,jsonb) rename to admin_action_v2;
create function public.admin_action(p_operator uuid,p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a text:=p_body->>'action';result jsonb;req public.management_requests%rowtype;t public.tags%rowtype;c public.memory_topics%rowtype;
 j public.provisioning_jobs%rowtype;ids uuid[];row jsonb;v_op text:=p_body->>'operation';v_kind text;v_label text;v_date date;
 v_count integer;off integer;lim integer;v_sort text:=coalesce(p_body->>'sort','recorded_desc');
begin
 if not exists(select 1 from public.operator_profiles where user_id=p_operator and role in ('operator','admin')) then raise exception 'OPERATOR_REQUIRED';end if;
 if a in ('createCategory','renameCategory') then raise exception 'CATEGORIES_FIXED';end if;
 if a in ('createCards','jobs','leaseJob','nextJob','provision','createBatch') and (p_body->>'protocolVersion') is distinct from '3' then raise exception 'CLIENT_UPGRADE_REQUIRED';end if;
 if a='createBatch' then raise exception 'CLIENT_UPGRADE_REQUIRED';end if;
 if a in ('createCards','bulkApply') then
  if p_body->>'requestKey' is null then raise exception 'REQUEST_INVALID';end if;
  insert into public.management_requests values((p_body->>'requestKey')::uuid,p_operator,p_body,null) on conflict do nothing;
  select * into req from public.management_requests where request_key=(p_body->>'requestKey')::uuid for update;
  if req.operator_id<>p_operator or req.body<>p_body then raise exception 'REQUEST_KEY_CONFLICT';end if;
  if req.response is not null then return req.response;end if;
 end if;
 if a='categories' then
  select jsonb_build_object('categories',jsonb_agg(jsonb_build_object('id',id,'name',name,'code',code,'nextNumber',1) order by code)) into result from public.memory_topics;
 elsif a='createCards' then
  if p_body ? 'categoryId' or jsonb_typeof(p_body->'count') is distinct from 'number' or (p_body->>'count') !~ '^[0-9]+$' then raise exception 'REQUEST_INVALID';end if;
  v_count:=(p_body->>'count')::integer;if v_count not between 1 and 500 then raise exception 'REQUEST_INVALID';end if;
  ids:='{}';for i in 1..v_count loop
   v_label:=public.next_inventory_label();insert into public.tags(label,batch,inventory_label) values(v_label,'',v_label) returning * into t;
   insert into public.label_history(label,tag_id) values(lower(v_label),t.id);
   insert into public.provisioning_jobs(tag_id,visitor_url) values(t.id,'https://voice.heisei.space/#/t/'||t.public_token);
   insert into public.audit_log(operator_id,action,tag_id) values(p_operator,'create',t.id);ids:=array_append(ids,t.id);
  end loop;
  select jsonb_build_object('tags',jsonb_agg(public.tag_dto(x) order by u.n)) into result from unnest(ids) with ordinality u(id,n) join public.tags x on x.id=u.id;
 elsif a='list' then
  off:=coalesce((p_body->>'offset')::integer,0);lim:=coalesce((p_body->>'limit')::integer,50);
  if off<0 or lim not between 1 and 100 or length(coalesce(p_body->>'search',''))>120 or v_sort not in ('recorded_desc','recorded_asc','number')
   or (nullif(p_body->>'status','') is not null and p_body->>'status' not in ('unbound','bound','disabled'))
   or (p_body ? 'uncategorized' and jsonb_typeof(p_body->'uncategorized')<>'boolean') then raise exception 'REQUEST_INVALID';end if;
  if nullif(p_body->>'categoryId','') is not null and not exists(select 1 from public.memory_topics where id=(p_body->>'categoryId')::uuid) then raise exception 'CATEGORY_NOT_FOUND';end if;
  if nullif(p_body->>'batchDate','') is not null and ((p_body->>'batchDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (p_body->>'batchDate')::date::text<>p_body->>'batchDate') then raise exception 'REQUEST_INVALID';end if;
  with selected as(select x.*,r.created_at recorded_at from public.tags x left join public.recordings r on r.tag_id=x.id left join public.memory_topics topic on topic.id=x.topic_id
   where x.deleted_at is null
   and (nullif(p_body->>'categoryId','') is null or x.topic_id=(p_body->>'categoryId')::uuid)
   and (not coalesce((p_body->>'uncategorized')::boolean,false) or x.topic_id is null)
   and (nullif(p_body->>'batchDate','') is null or x.batch_date=(p_body->>'batchDate')::date)
   and (nullif(p_body->>'status','') is null or x.status::text=p_body->>'status')
   and (strpos(lower(x.label||' '||x.inventory_label||' '||x.batch||' '||coalesce(topic.name,'')||' '||coalesce(r.nickname,'')),lower(coalesce(p_body->>'search','')))>0
    or exists(select 1 from public.label_history h where h.tag_id=x.id and strpos(h.label,lower(coalesce(p_body->>'search','')))>0)))
  select jsonb_build_object('total',(select count(*) from selected),'tags',coalesce((select jsonb_agg(public.tag_dto(x) order by n) from
   (select id,row_number() over(order by case when v_sort='recorded_desc' then recorded_at end desc nulls last,case when v_sort='recorded_asc' then recorded_at end asc nulls last,
    case when v_sort='number' then batch_date end,case when v_sort='number' then topic_id end,case when v_sort='number' then substring(coalesce(serial_number,inventory_label) from '[0-9]+$')::numeric end,id) n
    from selected order by n offset off limit lim) q join public.tags x using(id)),'[]')) into result;
 elsif a in ('bulkPreview','bulkApply') then
  if v_op is null or v_op not in ('move','delete','reset') then raise exception 'REQUEST_INVALID';end if;
  if a='bulkPreview' then
   if jsonb_typeof(p_body->'tagIds') is distinct from 'array' or jsonb_array_length(p_body->'tagIds') not between 1 and 500 then raise exception 'REQUEST_INVALID';end if;
   select array_agg(distinct value::uuid) into ids from jsonb_array_elements_text(p_body->'tagIds');
  else
   if jsonb_typeof(p_body->'cards') is distinct from 'array' or jsonb_array_length(p_body->'cards') not between 1 and 500 or p_body->>'kind' is null or p_body->>'kind' not in ('empty','recorded') then raise exception 'REQUEST_INVALID';end if;
   select array_agg(distinct (value->>'id')::uuid) into ids from jsonb_array_elements(p_body->'cards');
   if cardinality(ids)<>jsonb_array_length(p_body->'cards') then raise exception 'REQUEST_INVALID';end if;
  end if;
  perform pg_advisory_xact_lock(701015);
  perform 1 from public.tags where id=any(ids) order by id for update;
  if (select count(*) from public.tags where id=any(ids) and deleted_at is null)<>cardinality(ids) then raise exception 'TAG_NOT_FOUND';end if;
  if v_op='move' then
   select * into c from public.memory_topics where id=(p_body->>'targetCategoryId')::uuid;if not found then raise exception 'CATEGORY_NOT_FOUND';end if;
   if exists(select 1 from public.tags x where x.id=any(ids) and not exists(select 1 from public.recordings r where r.tag_id=x.id)) then raise exception 'CATEGORY_UNASSIGNED';end if;
  end if;
  if a='bulkPreview' then
   select jsonb_build_object('groups',coalesce(jsonb_agg(g),'[]')) into result from
    (select jsonb_build_object('kind',kind,'cards',jsonb_agg(jsonb_build_object('id',id,'version',version,'label',label) order by id),'recordingCount',sum(case when kind='recorded' then 1 else 0 end)) g
     from(select x.id,x.version,x.label,case when exists(select 1 from public.recordings r where r.tag_id=x.id) then 'recorded' else 'empty' end kind from public.tags x where id=any(ids)) q group by kind) z;
  else
   for row in select value from jsonb_array_elements(p_body->'cards') loop
    select * into t from public.tags where id=(row->>'id')::uuid;
    if (row->>'version')::bigint is distinct from t.version then raise exception 'VERSION_CONFLICT';end if;
    v_kind:=case when exists(select 1 from public.recordings where tag_id=t.id) then 'recorded' else 'empty' end;
    if v_kind is distinct from p_body->>'kind' then raise exception 'GROUP_CONFLICT';end if;
   end loop;
   for t in select * from public.tags where id=any(ids) order by id loop
    if v_op='move' then
     if t.topic_id is distinct from c.id then
      select coalesce(t.batch_date,(r.created_at at time zone 'Asia/Tokyo')::date) into v_date from public.recordings r where r.tag_id=t.id;
      v_label:=public.allocate_memory_label(c.code,v_date);insert into public.label_history(label,tag_id) values(lower(v_label),t.id);
      update public.tags set label=v_label,serial_number=v_label,batch_date=v_date,batch=v_date::text,topic_id=c.id,category_id=null where id=t.id;
      insert into public.audit_log(operator_id,action,tag_id,details) values(p_operator,'move',t.id,jsonb_build_object('fromLabel',t.label,'toLabel',v_label,'fromCategoryId',t.topic_id,'toCategoryId',c.id));
     end if;
    else
     perform public.admin_action_legacy(p_operator,jsonb_build_object('action','reset','tagId',t.id));
     update public.tags set label=inventory_label,batch='',topic_id=null,category_id=null,batch_date=null,serial_number=null,
      deleted_at=case when v_op='delete' then now() else deleted_at end,status=case when v_op='delete' then 'disabled'::public.tag_status else status end where id=t.id;
     insert into public.audit_log(operator_id,action,tag_id) values(p_operator,v_op,t.id);
    end if;
    update public.provisioning_jobs set lease_token=null,lease_expires_at=null where tag_id=t.id;
   end loop;result:='{"ok":true}';
  end if;
 elsif a='jobs' then
  off:=coalesce((p_body->>'offset')::integer,0);lim:=coalesce((p_body->>'limit')::integer,500);
  if off<0 or lim not between 1 and 500 or (nullif(p_body->>'status','') is not null and p_body->>'status' not in ('pending','verified','failed')) then raise exception 'REQUEST_INVALID';end if;
  with selected as(select x.* from public.provisioning_jobs x join public.tags tag on tag.id=x.tag_id where tag.deleted_at is null and (nullif(p_body->>'status','') is null or x.status=p_body->>'status'))
  select jsonb_build_object('total',(select count(*) from selected),'jobs',coalesce((select jsonb_agg(public.job_dto(q) order by q.id) from(select * from selected order by id offset off limit lim) q),'[]')) into result;
 elsif a in ('leaseJob','nextJob','releaseJob','provision') then
  if a in ('leaseJob','nextJob') and length(coalesce(p_body->>'deviceId','')) not between 1 and 120 then raise exception 'REQUEST_INVALID';end if;
  if a in ('leaseJob','nextJob') then perform pg_advisory_xact_lock(hashtextextended('lease:'||p_operator::text||':'||(p_body->>'deviceId'),0));end if;
  if a='nextJob' then
   select x.* into t from public.tags x join public.provisioning_jobs z on z.tag_id=x.id where x.deleted_at is null and x.status='unbound' and z.status='pending' and z.lease_auto and z.lease_operator=p_operator and z.lease_device=p_body->>'deviceId' and z.lease_expires_at>now() and z.lease_tag_version=x.version and not exists(select 1 from public.recordings r where r.tag_id=x.id) order by x.id for update of x skip locked limit 1;
   if found then select * into j from public.provisioning_jobs where tag_id=t.id for update;return jsonb_build_object('job',public.job_dto(j),'leaseToken',j.lease_token,'expiresAt',j.lease_expires_at);end if;
   select x.* into t from public.tags x join public.provisioning_jobs z on z.tag_id=x.id where x.deleted_at is null and x.status='unbound' and z.status='pending' and not exists(select 1 from public.recordings r where r.tag_id=x.id) and (z.lease_expires_at is null or z.lease_expires_at<=now()) order by length(x.inventory_label),x.inventory_label,x.id for update of x skip locked limit 1;
   if not found then return '{"job":null}';end if;
  else
   select x.* into t from public.tags x join public.provisioning_jobs z on z.tag_id=x.id where z.id=(p_body->>'jobId')::uuid for update of x;
   if not found then raise exception 'JOB_NOT_FOUND';end if;
  end if;
  select * into j from public.provisioning_jobs where tag_id=t.id for update;
  if t.deleted_at is not null or t.status='disabled' then raise exception 'JOB_INELIGIBLE';end if;
  if a in ('leaseJob','nextJob') then
   if a='leaseJob' and j.lease_expires_at>now() and j.lease_operator=p_operator and j.lease_device=p_body->>'deviceId' and j.lease_tag_version=t.version then return jsonb_build_object('job',public.job_dto(j),'leaseToken',j.lease_token,'expiresAt',j.lease_expires_at);end if;
   if j.lease_expires_at>now() then raise exception 'LEASE_CONFLICT';end if;
   update public.provisioning_jobs set lease_token=gen_random_uuid(),lease_operator=p_operator,lease_device=p_body->>'deviceId',lease_expires_at=now()+interval '10 minutes',lease_tag_version=t.version,lease_auto=(a='nextJob'),last_report=null where id=j.id returning * into j;
   result:=jsonb_build_object('job',public.job_dto(j),'leaseToken',j.lease_token,'expiresAt',j.lease_expires_at);
  else
   if j.lease_token is null or j.lease_token::text is distinct from p_body->>'leaseToken' or j.lease_operator<>p_operator then raise exception 'LEASE_CONFLICT';end if;
   if a='provision' and j.last_report=p_body and j.lease_tag_version=t.version then return '{"ok":true}';end if;
   if a='provision' and j.status='verified' and j.last_report is not null then raise exception 'JOB_CONFLICT';end if;
   if j.lease_expires_at<=now() then raise exception 'LEASE_EXPIRED';end if;
   if a='releaseJob' then update public.provisioning_jobs set lease_token=null,lease_expires_at=null where id=j.id;
   else
    if j.lease_tag_version<>t.version or (p_body->>'version')::integer is distinct from j.version or p_body->>'visitorUrl' is distinct from j.visitor_url then raise exception 'JOB_CONFLICT';end if;
    if j.lease_auto and (t.status<>'unbound' or j.status<>'pending' or exists(select 1 from public.recordings where tag_id=t.id)) then raise exception 'JOB_INELIGIBLE';end if;
    if p_body->>'status' is null or p_body->>'status' not in ('verified','failed') or length(coalesce(p_body->>'errorCode',''))>80 then raise exception 'REQUEST_INVALID';end if;
    update public.provisioning_jobs set status=p_body->>'status',error_code=case when p_body->>'status'='failed' then coalesce(p_body->>'errorCode','WRITE_FAILED') end,updated_at=now(),last_report=p_body where id=j.id;
    insert into public.audit_log(operator_id,action,tag_id) values(p_operator,'provision',t.id);
   end if;result:='{"ok":true}';
  end if;
 else
  result:=public.admin_action_v2(p_operator,p_body);
  if a='reset' then
   update public.tags set label=inventory_label,batch='',topic_id=null,category_id=null,batch_date=null,serial_number=null where id=(p_body->>'tagId')::uuid;
   update public.provisioning_jobs set lease_token=null,lease_expires_at=null where tag_id=(p_body->>'tagId')::uuid;
  end if;
 end if;
 if a in ('createCards','bulkApply') then update public.management_requests set response=result where request_key=req.request_key;end if;
 return result;
end $$;

alter table public.memory_topics enable row level security;
alter table public.daily_topic_counters enable row level security;
revoke all on public.memory_topics,public.daily_topic_counters from public,anon,authenticated;
grant all on public.memory_topics,public.daily_topic_counters to service_role;
grant usage,select on sequence public.inventory_number_sequence to service_role;
revoke all on function public.next_inventory_label(),public.allocate_memory_label(text,date),public.claim_recording_classified(uuid,text,text,integer,bigint,text,jsonb,text),public.admin_action(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.admin_action_v2(uuid,jsonb),public.claim_recording(uuid,text,text,integer,bigint,text),public.claim_recording_with_location(uuid,text,text,integer,bigint,text,jsonb) from service_role;
grant execute on function public.claim_recording_classified(uuid,text,text,integer,bigint,text,jsonb,text),public.admin_action(uuid,jsonb) to service_role;
