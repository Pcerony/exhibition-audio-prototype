-- Stable visitor identity is unchanged. Legacy labels remain reserved forever.
create table public.categories(id uuid primary key default gen_random_uuid(), name text not null, code text not null unique,
 next_number bigint not null default 1 check(next_number>0), created_at timestamptz not null default now());
create unique index category_name_idx on public.categories(lower(btrim(name)));
create sequence public.category_code_sequence;
create table public.label_history(label text primary key,tag_id uuid not null references public.tags(id),created_at timestamptz not null default now());
create table public.management_requests(request_key uuid primary key,operator_id uuid not null references auth.users(id),body jsonb not null,response jsonb);
alter table public.tags add column category_id uuid references public.categories(id), add column version bigint not null default 1,
 add column deleted_at timestamptz;
alter table public.audit_log add column details jsonb;
alter table public.provisioning_jobs add column lease_token uuid,add column lease_operator uuid references auth.users(id),
 add column lease_device text,add column lease_expires_at timestamptz,add column lease_tag_version bigint,
 add column lease_auto boolean not null default false,add column last_report jsonb;

create function public.category_code(p_number bigint) returns text language plpgsql immutable set search_path='' as $$
declare n bigint:=p_number; s text:=''; begin while n>0 loop n:=n-1;s:=chr(65+(n%26)::integer)||s;n:=n/26;end loop;return s;end $$;
do $$ declare n text; c uuid; begin
 for n in select min(coalesce(nullif(btrim(batch),''),'未分類')) from public.tags group by lower(coalesce(nullif(btrim(batch),''),'未分類')) order by 1 loop
 insert into public.categories(name,code) values(n,public.category_code(nextval('public.category_code_sequence'))) returning id into c;
 update public.tags set category_id=c where lower(coalesce(nullif(btrim(batch),''),'未分類'))=lower(n);
 end loop;
end $$;
alter table public.tags alter column category_id set not null;
insert into public.label_history(label,tag_id) select lower(btrim(label)),id from public.tags;
create function public.next_card_label(p_category uuid) returns text language plpgsql security definer set search_path='' as $$
declare c public.categories%rowtype; candidate text; begin
 select * into c from public.categories where id=p_category for update;
 if not found then raise exception 'CATEGORY_NOT_FOUND';end if;
 loop candidate:=c.code||lpad(c.next_number::text,greatest(3,length(c.next_number::text)),'0');c.next_number:=c.next_number+1;
 exit when not exists(select 1 from public.label_history where label=lower(candidate));end loop;
 update public.categories set next_number=c.next_number where id=c.id;return candidate;
end $$;
create function public.touch_card_version() returns trigger language plpgsql security definer set search_path='' as $$
begin new.version:=old.version+1;new.updated_at:=now();return new;end $$;
create trigger tags_version before update on public.tags for each row execute function public.touch_card_version();
create function public.recording_card_version() returns trigger language plpgsql security definer set search_path='' as $$
begin update public.tags set updated_at=now() where id=coalesce(new.tag_id,old.tag_id);return coalesce(new,old);end $$;
create trigger recording_version after insert or update or delete on public.recordings for each row execute function public.recording_card_version();

create or replace function public.job_dto(p_job public.provisioning_jobs) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p_job.id,'tagId',t.id,'label',t.label,'batch',c.name,'categoryId',c.id,
 'visitorUrl',p_job.visitor_url,'version',p_job.version,'tagVersion',t.version,'status',p_job.status,'errorCode',p_job.error_code,
 'recordingStatus',case when exists(select 1 from public.recordings r where r.tag_id=t.id) then 'bound' else 'unbound' end,
 'leaseExpiresAt',p_job.lease_expires_at,'leased',coalesce(p_job.lease_expires_at>now(),false),'writtenAt',case when p_job.status='verified' then p_job.updated_at end) from public.tags t join public.categories c on c.id=t.category_id where t.id=p_job.tag_id
$$;
create or replace function public.tag_dto(p_tag public.tags) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p_tag.id,'token',p_tag.public_token,'label',p_tag.label,'batch',c.name,'categoryId',c.id,'version',p_tag.version,
 'status',p_tag.status,'createdAt',p_tag.created_at,'recording',(select jsonb_build_object('id',r.id,'nickname',r.nickname,'duration',r.duration_seconds,'mimeType',r.mime_type,'createdAt',r.created_at) from public.recordings r where r.tag_id=p_tag.id),
 'provisioning',(select public.job_dto(j) from public.provisioning_jobs j where j.tag_id=p_tag.id)) from public.categories c where c.id=p_tag.category_id
$$;
alter function public.admin_action(uuid,jsonb) rename to admin_action_legacy;
create function public.admin_action(p_operator uuid,p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a text:=p_body->>'action';result jsonb;req public.management_requests%rowtype;c public.categories%rowtype;t public.tags%rowtype;
 j public.provisioning_jobs%rowtype;row jsonb;ids uuid[];v_id uuid;v_kind text;v_op text:=p_body->>'operation'; v_label text;
 v_count integer;off integer;lim integer;total bigint;v_sort text:=coalesce(p_body->>'sort','recorded_desc');
begin
 if not exists(select 1 from public.operator_profiles where user_id=p_operator and role in ('operator','admin')) then raise exception 'OPERATOR_REQUIRED';end if;
 if a in ('createCategory','createCards','bulkApply') then
 if p_body->>'requestKey' is null then raise exception 'REQUEST_INVALID';end if;
 insert into public.management_requests values((p_body->>'requestKey')::uuid,p_operator,p_body,null) on conflict do nothing;
 select * into req from public.management_requests where request_key=(p_body->>'requestKey')::uuid for update;
 if req.operator_id<>p_operator or req.body<>p_body then raise exception 'REQUEST_KEY_CONFLICT';end if;
 if req.response is not null then return req.response;end if;
 end if;
 if a='categories' then
 select jsonb_build_object('categories',coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'code',code,'nextNumber',next_number) order by length(code),code),'[]')) into result from public.categories;
 elsif a in ('createCategory','renameCategory') then
 if jsonb_typeof(p_body->'name') is distinct from 'string' or length(btrim(p_body->>'name')) not between 1 and 120 then raise exception 'REQUEST_INVALID';end if;
 -- Renames and moves share a lock before either category or tag row locks.
 if a='renameCategory' then perform pg_advisory_xact_lock(701015);end if;
 begin
 if a='createCategory' then insert into public.categories(name,code) values(btrim(p_body->>'name'),public.category_code(nextval('public.category_code_sequence'))) returning * into c;
 else update public.categories set name=btrim(p_body->>'name') where id=(p_body->>'categoryId')::uuid returning * into c;
 if not found then raise exception 'CATEGORY_NOT_FOUND';end if;
 update public.tags set batch=c.name where category_id=c.id and deleted_at is null;end if;
 exception when unique_violation then raise exception 'CATEGORY_NAME_EXISTS';end;
 result:=case when a='renameCategory' then '{"ok":true}'::jsonb else jsonb_build_object('category',jsonb_build_object('id',c.id,'name',c.name,'code',c.code,'nextNumber',c.next_number)) end;
 insert into public.audit_log(operator_id,action,details) values(p_operator,a,jsonb_build_object('categoryId',c.id,'name',c.name));
 elsif a='createCards' then
 if jsonb_typeof(p_body->'count') is distinct from 'number' or (p_body->>'count') !~ '^[0-9]+$' then raise exception 'REQUEST_INVALID';end if;
 v_count:=(p_body->>'count')::integer;if v_count is null or v_count not between 1 and 500 then raise exception 'REQUEST_INVALID';end if;
 select * into c from public.categories where id=(p_body->>'categoryId')::uuid for update;if not found then raise exception 'CATEGORY_NOT_FOUND';end if;
 ids:='{}';for i in 1..v_count loop
 v_label:=public.next_card_label(c.id);insert into public.tags(label,batch,category_id) values(v_label,c.name,c.id) returning * into t;
 insert into public.label_history(label,tag_id) values(lower(v_label),t.id);
 insert into public.provisioning_jobs(tag_id,visitor_url) values(t.id,'https://voice.heisei.space/#/t/'||t.public_token);
 insert into public.audit_log(operator_id,action,tag_id) values(p_operator,'create',t.id);ids:=array_append(ids,t.id);end loop;
 select jsonb_build_object('tags',jsonb_agg(public.tag_dto(x) order by u.n)) into result from unnest(ids) with ordinality u(id,n) join public.tags x on x.id=u.id;
 elsif a='list' then
 off:=coalesce((p_body->>'offset')::integer,0);lim:=coalesce((p_body->>'limit')::integer,50);
 if off<0 or lim not between 1 and 100 or length(coalesce(p_body->>'search',''))>120 or v_sort not in ('recorded_desc','recorded_asc','number') or (p_body->>'status' is not null and p_body->>'status' not in ('','unbound','bound','disabled')) then raise exception 'REQUEST_INVALID';end if;
 with selected as(select x.*,cat.code category_code,r.created_at recorded_at from public.tags x join public.categories cat on cat.id=x.category_id left join public.recordings r on r.tag_id=x.id where x.deleted_at is null
 and (nullif(p_body->>'categoryId','') is null or x.category_id=(p_body->>'categoryId')::uuid)
 and (nullif(p_body->>'status','') is null or x.status::text=p_body->>'status')
 and (strpos(lower(x.label||' '||cat.name||' '||coalesce(r.nickname,'')),lower(coalesce(p_body->>'search','')))>0 or exists(select 1 from public.label_history h where h.tag_id=x.id and strpos(h.label,lower(coalesce(p_body->>'search','')))>0)))
 select jsonb_build_object('total',(select count(*) from selected),'tags',coalesce((select jsonb_agg(public.tag_dto(x) order by n) from (select id,row_number() over(order by case when v_sort='recorded_desc' then recorded_at end desc nulls last,case when v_sort='recorded_asc' then recorded_at end asc nulls last,case when v_sort='number' then length(category_code) end,case when v_sort='number' then category_code end,case when v_sort='number' then substring(label from '[0-9]+$')::numeric end nulls last,case when v_sort='number' then label end,id) n from selected order by n offset off limit lim) q join public.tags x using(id)),'[]')) into result;
 elsif a in ('bulkPreview','bulkApply') then
 if v_op not in ('move','delete','reset') or v_op is null then raise exception 'REQUEST_INVALID';end if;
 if a='bulkPreview' then
 if jsonb_typeof(p_body->'tagIds') is distinct from 'array' or jsonb_array_length(p_body->'tagIds') not between 1 and 500 then raise exception 'REQUEST_INVALID';end if;
 select array_agg(distinct value::uuid) into ids from jsonb_array_elements_text(p_body->'tagIds');
 else
 if jsonb_typeof(p_body->'cards') is distinct from 'array' or jsonb_array_length(p_body->'cards') not between 1 and 500 or p_body->>'kind' is null or p_body->>'kind' not in ('empty','recorded') then raise exception 'REQUEST_INVALID';end if;
 select array_agg(distinct (value->>'id')::uuid) into ids from jsonb_array_elements(p_body->'cards');
 if cardinality(ids)<>jsonb_array_length(p_body->'cards') then raise exception 'REQUEST_INVALID';end if;
 end if;
 -- Serialize management groups; tag-first lock order is shared with visitor claims.
 perform pg_advisory_xact_lock(701015);
 perform 1 from public.tags where id=any(ids) order by id for update;
 if (select count(*) from public.tags where id=any(ids) and deleted_at is null)<>cardinality(ids) then raise exception 'TAG_NOT_FOUND';end if;
 if v_op='move' then select * into c from public.categories where id=(p_body->>'targetCategoryId')::uuid for update;if not found then raise exception 'CATEGORY_NOT_FOUND';end if;end if;
 if a='bulkPreview' then
 select jsonb_build_object('groups',coalesce(jsonb_agg(g),'[]')) into result from (select jsonb_build_object('kind',kind,'cards',jsonb_agg(jsonb_build_object('id',id,'version',version,'label',label) order by id),'recordingCount',sum(case when kind='recorded' then 1 else 0 end)) g from (select x.id,x.version,x.label,case when exists(select 1 from public.recordings r where r.tag_id=x.id) then 'recorded' else 'empty' end kind from public.tags x where id=any(ids)) q group by kind) z;
 else
 for row in select value from jsonb_array_elements(p_body->'cards') loop
 select * into t from public.tags where id=(row->>'id')::uuid;
 if (row->>'version')::bigint is distinct from t.version then raise exception 'VERSION_CONFLICT';end if;
 v_kind:=case when exists(select 1 from public.recordings where tag_id=t.id) then 'recorded' else 'empty' end;
 if v_kind is distinct from p_body->>'kind' then raise exception 'GROUP_CONFLICT';end if;end loop;
 for t in select * from public.tags where id=any(ids) order by id loop
 if v_op='move' then
 if t.category_id<>c.id then v_label:=public.next_card_label(c.id);insert into public.label_history(label,tag_id) values(lower(v_label),t.id);
 update public.tags set label=v_label,batch=c.name,category_id=c.id where id=t.id;
 insert into public.audit_log(operator_id,action,tag_id,details) values(p_operator,'move',t.id,jsonb_build_object('fromLabel',t.label,'toLabel',v_label,'fromCategoryId',t.category_id,'toCategoryId',c.id));end if;
 else
 perform public.admin_action_legacy(p_operator,jsonb_build_object('action','reset','tagId',t.id));
 if v_op='delete' then update public.tags set deleted_at=now(),status='disabled' where id=t.id;end if;
 insert into public.audit_log(operator_id,action,tag_id) values(p_operator,v_op,t.id);
 end if;
 update public.provisioning_jobs set lease_token=null,lease_expires_at=null where tag_id=t.id;
 end loop;result:='{"ok":true}';end if;
 elsif a='createBatch' then raise exception 'CLIENT_UPGRADE_REQUIRED';
 elsif a='jobs' then
 off:=coalesce((p_body->>'offset')::integer,0);lim:=coalesce((p_body->>'limit')::integer,500);
 if off<0 or lim not between 1 and 500 or (nullif(p_body->>'status','') is not null and p_body->>'status' not in ('pending','verified','failed')) then raise exception 'REQUEST_INVALID';end if;
 with selected as(select x.* from public.provisioning_jobs x join public.tags tag on tag.id=x.tag_id join public.categories cat on cat.id=tag.category_id where tag.deleted_at is null and (nullif(p_body->>'categoryId','') is null or tag.category_id=(p_body->>'categoryId')::uuid) and (p_body->>'batch' is null or cat.name=p_body->>'batch') and (nullif(p_body->>'status','') is null or x.status=p_body->>'status'))
 select jsonb_build_object('total',(select count(*) from selected),'jobs',coalesce((select jsonb_agg(public.job_dto(q) order by q.id) from(select * from selected order by id offset off limit lim) q),'[]')) into result;
 elsif a in ('leaseJob','nextJob','releaseJob','provision') then
 if a<>'releaseJob' and (p_body->>'protocolVersion')::integer is distinct from 2 then raise exception 'CLIENT_UPGRADE_REQUIRED';end if;
 if a in ('leaseJob','nextJob') and (length(coalesce(p_body->>'deviceId','')) not between 1 and 120) then raise exception 'REQUEST_INVALID';end if;
 if a in ('leaseJob','nextJob') then perform pg_advisory_xact_lock(hashtextextended('lease:'||p_operator::text||':'||(p_body->>'deviceId'),0));end if;
 if a='nextJob' then
 -- Recover an ambiguous network response instead of silently leasing another card.
 select x.* into t from public.tags x join public.provisioning_jobs z on z.tag_id=x.id where x.category_id=(p_body->>'categoryId')::uuid and x.deleted_at is null and x.status='unbound' and z.status='pending' and z.lease_auto and z.lease_operator=p_operator and z.lease_device=p_body->>'deviceId' and z.lease_expires_at>now() and z.lease_tag_version=x.version and not exists(select 1 from public.recordings r where r.tag_id=x.id) order by x.id for update of x skip locked limit 1;
 if found then select * into j from public.provisioning_jobs where tag_id=t.id for update;
 return jsonb_build_object('job',public.job_dto(j),'leaseToken',j.lease_token,'expiresAt',j.lease_expires_at);end if;
 select x.* into t from public.tags x join public.provisioning_jobs z on z.tag_id=x.id where x.category_id=(p_body->>'categoryId')::uuid and x.deleted_at is null and x.status='unbound' and z.status='pending' and not exists(select 1 from public.recordings r where r.tag_id=x.id) and (z.lease_expires_at is null or z.lease_expires_at<=now()) order by substring(x.label from '[0-9]+$')::numeric nulls last,x.label,x.id for update of x skip locked limit 1;
 if not found then return '{"job":null}';end if;
 else select x.* into t from public.tags x join public.provisioning_jobs z on z.tag_id=x.id where z.id=(p_body->>'jobId')::uuid for update of x;
 if not found then raise exception 'JOB_NOT_FOUND';end if;end if;
 select * into j from public.provisioning_jobs where tag_id=t.id for update;
 if t.deleted_at is not null or t.status='disabled' then raise exception 'JOB_INELIGIBLE';end if;
 if a in ('leaseJob','nextJob') then
 if a='leaseJob' and j.lease_expires_at>now() and j.lease_operator=p_operator and j.lease_device=p_body->>'deviceId' and j.lease_tag_version=t.version then
 return jsonb_build_object('job',public.job_dto(j),'leaseToken',j.lease_token,'expiresAt',j.lease_expires_at);end if;
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
 end if;result:='{"ok":true}';end if;
 elsif a='audit' then
 select jsonb_build_object('entries',coalesce(jsonb_agg(jsonb_build_object('id',q.id,'action',q.action,'operatorId',q.operator_id,'tagId',q.tag_id,'createdAt',q.created_at,'details',q.details) order by q.created_at desc,q.id desc),'[]')) into result from (select * from public.audit_log order by created_at desc,id desc limit 100) q;
 else
 if a in ('reset','setEnabled') then
 select * into t from public.tags where id=(p_body->>'tagId')::uuid for update;
 if not found or t.deleted_at is not null then raise exception 'TAG_NOT_FOUND';end if;end if;
 if a='playback' and not exists(select 1 from public.recordings r join public.tags x on x.id=r.tag_id where r.id=(p_body->>'recordingId')::uuid and x.deleted_at is null) then raise exception 'RECORDING_NOT_FOUND';end if;
 result:=public.admin_action_legacy(p_operator,p_body);
 end if;
 if a in ('createCategory','createCards','bulkApply') then update public.management_requests set response=result where request_key=req.request_key;end if;
 return result;
end $$;
alter table public.categories enable row level security;alter table public.label_history enable row level security;alter table public.management_requests enable row level security;
revoke all on public.categories,public.label_history,public.management_requests from public,anon,authenticated;
grant all on public.categories,public.label_history,public.management_requests to service_role;
revoke all on function public.category_code(bigint),public.next_card_label(uuid),public.touch_card_version(),public.recording_card_version(),public.admin_action(uuid,jsonb),public.admin_action_legacy(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.admin_action(uuid,jsonb) to service_role;
-- Legacy entry point is no longer callable over PostgREST, even with client credentials.
revoke all on function public.admin_action_legacy(uuid,jsonb) from service_role;

-- Defense in depth: visitor RPCs check deletion while holding the same tag lock
-- as management, rather than relying on the presentation status alone.
alter function public.initialize_upload(text,uuid,text,text,bigint) rename to initialize_upload_legacy;
create function public.initialize_upload(p_token text,p_id uuid,p_hash text,p_mime text,p_size bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.tags%rowtype;begin
 select * into t from public.tags where public_token=p_token for update;
 if not found then raise exception 'TAG_NOT_FOUND';end if;
 if t.deleted_at is not null then raise exception 'TAG_UNAVAILABLE';end if;
 return public.initialize_upload_legacy(p_token,p_id,p_hash,p_mime,p_size);
end $$;
alter function public.claim_recording(uuid,text,text,integer,bigint,text) rename to claim_recording_legacy;
create function public.claim_recording(p_upload_id uuid,p_claim_token text,p_nickname text,p_duration_seconds integer,p_actual_size_bytes bigint,p_actual_mime_type text)
returns table(claim_status text,recording_id uuid,recording_created_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare t public.tags%rowtype;v_tag_id uuid;begin
 select tag_id into v_tag_id from public.upload_sessions where id=p_upload_id;
 if not found then raise exception 'UPLOAD_SESSION_INVALID';end if;
 select * into t from public.tags where id=v_tag_id for update;
 if not found or t.deleted_at is not null then raise exception 'TAG_UNAVAILABLE';end if;
 return query select * from public.claim_recording_legacy(p_upload_id,p_claim_token,p_nickname,p_duration_seconds,p_actual_size_bytes,p_actual_mime_type);
end $$;
revoke all on function public.initialize_upload_legacy(text,uuid,text,text,bigint),public.claim_recording_legacy(uuid,text,text,integer,bigint,text) from public,anon,authenticated,service_role;
revoke all on function public.initialize_upload(text,uuid,text,text,bigint),public.claim_recording(uuid,text,text,integer,bigint,text) from public,anon,authenticated;
grant execute on function public.initialize_upload(text,uuid,text,text,bigint),public.claim_recording(uuid,text,text,integer,bigint,text) to service_role;
