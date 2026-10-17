create function public.admin_list(p_operator uuid,p_body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_search text:=coalesce(p_body->>'search','');
 v_status text:=nullif(p_body->>'status','');
 v_batch_date text:=nullif(p_body->>'batchDate','');
 v_category_id uuid;
 v_uncategorized boolean:=false;
 v_sort text:=coalesce(p_body->>'sort','recorded_desc');
 v_offset integer:=coalesce((p_body->>'offset')::integer,0);
 v_limit integer:=coalesce((p_body->>'limit')::integer,50);
 v_transcription_state text:=nullif(p_body->>'transcriptionState','');
 result jsonb;
begin
 if not exists(select 1 from public.operator_profiles where user_id=p_operator and role in ('operator','admin')) then raise exception 'OPERATOR_REQUIRED';end if;
 if v_offset<0 or v_limit not between 1 and 100 or length(v_search)>120
  or v_sort not in ('recorded_desc','recorded_asc','number')
  or (v_status is not null and v_status not in ('unbound','bound','disabled'))
  or (p_body ? 'uncategorized' and jsonb_typeof(p_body->'uncategorized')<>'boolean')
  or (v_transcription_state is not null and v_transcription_state not in ('not_consented','pending','processing','draft','published','failed')) then
  raise exception 'REQUEST_INVALID';
 end if;
 if nullif(p_body->>'categoryId','') is not null then
  v_category_id:=(p_body->>'categoryId')::uuid;
  if not exists(select 1 from public.memory_topics where id=v_category_id) then raise exception 'CATEGORY_NOT_FOUND';end if;
 end if;
 if v_batch_date is not null and (v_batch_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or v_batch_date::date::text<>v_batch_date) then
  raise exception 'REQUEST_INVALID';
 end if;
 if p_body ? 'uncategorized' then v_uncategorized:=(p_body->>'uncategorized')::boolean;end if;

 with selected as (
  select x.id,x.batch_date,x.topic_id,x.serial_number,x.inventory_label,r.created_at recorded_at
  from public.tags x
  left join public.recordings r on r.tag_id=x.id
  left join public.memory_topics topic on topic.id=x.topic_id
  left join public.recording_transcriptions transcription on transcription.recording_id=r.id
  where x.deleted_at is null
   and (v_category_id is null or x.topic_id=v_category_id)
   and (not v_uncategorized or x.topic_id is null)
   and (v_batch_date is null or x.batch_date=v_batch_date::date)
   and (v_status is null or x.status::text=v_status)
   and (strpos(lower(x.label||' '||x.inventory_label||' '||x.batch||' '||coalesce(topic.name,'')||' '||coalesce(r.nickname,'')),lower(v_search))>0
    or exists(select 1 from public.label_history h where h.tag_id=x.id and strpos(h.label,lower(v_search))>0))
   and (v_transcription_state is null or case v_transcription_state
    when 'not_consented' then r.id is not null and not r.transcription_consent
    when 'pending' then r.id is not null and r.transcription_consent and coalesce(transcription.status,'pending')='pending'
    when 'processing' then r.id is not null and r.transcription_consent and transcription.status='processing'
    when 'draft' then r.id is not null and r.transcription_consent and transcription.status='ready' and not transcription.published
    when 'published' then r.id is not null and r.transcription_consent and transcription.status='ready' and transcription.published
    when 'failed' then r.id is not null and r.transcription_consent and transcription.status='failed'
    else false end)
 ), paged as (
  select id,row_number() over(order by
   case when v_sort='recorded_desc' then recorded_at end desc nulls last,
   case when v_sort='recorded_asc' then recorded_at end asc nulls last,
   case when v_sort='number' then batch_date end,
   case when v_sort='number' then topic_id end,
   case when v_sort='number' then substring(coalesce(serial_number,inventory_label) from '[0-9]+$')::numeric end,
   id) n
  from selected
  order by case when v_sort='recorded_desc' then recorded_at end desc nulls last,
   case when v_sort='recorded_asc' then recorded_at end asc nulls last,
   case when v_sort='number' then batch_date end,
   case when v_sort='number' then topic_id end,
   case when v_sort='number' then substring(coalesce(serial_number,inventory_label) from '[0-9]+$')::numeric end,
   id
  offset v_offset limit v_limit
 )
 select jsonb_build_object(
  'total',(select count(*) from selected),
  'tags',coalesce((select jsonb_agg(public.tag_dto(tag) order by paged.n) from paged join public.tags tag using(id)),'[]'::jsonb)
 ) into result;
 return result;
end $$;

revoke all on function public.admin_list(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.admin_list(uuid,jsonb) to service_role;
