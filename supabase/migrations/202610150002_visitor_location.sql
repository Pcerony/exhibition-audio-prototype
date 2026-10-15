create function public.valid_memory_location(value jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
begin
 if value is null then return true; end if;
 if jsonb_typeof(value)<>'object' then return false; end if;
 if value->>'source'='pin' then
  return coalesce(jsonb_typeof(value->'lat')='number' and jsonb_typeof(value->'lng')='number'
   and (value->>'lat')::numeric between -90 and 90
   and (value->>'lng')::numeric between -180 and 180
   and value - array['source','lat','lng'] = '{}'::jsonb,false);
 elsif value->>'source'='place' then
  return coalesce(jsonb_typeof(value->'placeId')='string'
   and length(btrim(value->>'placeId')) between 1 and 300
   and value - array['source','placeId'] = '{}'::jsonb,false);
 end if;
 return false;
exception when others then return false;
end $$;

alter table public.recordings add column location jsonb;
alter table public.recordings add constraint recordings_location_valid check(public.valid_memory_location(location));

create function public.claim_recording_with_location(
 p_upload_id uuid,p_claim_token text,p_nickname text,p_duration_seconds integer,
 p_actual_size_bytes bigint,p_actual_mime_type text,p_location jsonb
) returns table(claim_status text,recording_id uuid,recording_created_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare result record;
begin
 if not public.valid_memory_location(p_location) then raise exception 'INVALID_LOCATION'; end if;
 select * into result from public.claim_recording(p_upload_id,p_claim_token,p_nickname,p_duration_seconds,p_actual_size_bytes,p_actual_mime_type);
 if result.claim_status='claimed' then
  update public.recordings set location=p_location where id=result.recording_id;
 end if;
 return query select result.claim_status::text,result.recording_id::uuid,result.recording_created_at::timestamptz;
end $$;
revoke all on function public.claim_recording_with_location(uuid,text,text,integer,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.claim_recording_with_location(uuid,text,text,integer,bigint,text,jsonb) to service_role;
