create function public.issue_qr_entry_internal(p_operator uuid,p_body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  req public.management_requests%rowtype;
  t public.tags%rowtype;
  v_key uuid;
  v_label text;
  result jsonb;
begin
  if jsonb_typeof(p_body) is distinct from 'object'
     or p_body->>'action' is distinct from 'createQrEntry'
     or jsonb_typeof(p_body->'requestKey') is distinct from 'string'
     or (p_body->>'requestKey') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'REQUEST_INVALID';
  end if;

  v_key:=(p_body->>'requestKey')::uuid;
  perform pg_advisory_xact_lock(hashtextextended('qr-entry:'||v_key::text,0));
  insert into public.management_requests(request_key,operator_id,body,response)
    values(v_key,p_operator,p_body,null) on conflict do nothing;
  select * into req from public.management_requests where request_key=v_key for update;
  if req.operator_id<>p_operator or req.body<>p_body then
    raise exception 'REQUEST_KEY_CONFLICT';
  end if;
  if p_body<>jsonb_build_object('action','createQrEntry','requestKey',p_body->'requestKey') then
    raise exception 'REQUEST_INVALID';
  end if;
  if req.response is not null then return req.response; end if;

  v_label:=public.next_inventory_label();
  insert into public.tags(label,batch,inventory_label,entry_channel)
    values(v_label,'',v_label,'qr') returning * into t;
  insert into public.label_history(label,tag_id) values(lower(v_label),t.id);
  insert into public.audit_log(operator_id,action,tag_id) values(p_operator,'qr_issue',t.id);
  result:=jsonb_build_object(
    'id',t.id,
    'label',v_label,
    'entryChannel','qr',
    'visitorUrl','https://voice.heisei.space/#/t/'||t.public_token
  );
  update public.management_requests set response=result where request_key=v_key;
  return result;
end;
$$;

alter function public.admin_action(uuid,jsonb) rename to admin_action_before_staff_qr;
create function public.admin_action(p_operator uuid,p_body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if p_body->>'action'='createQrEntry' then
    if not exists(select 1 from public.operator_profiles where user_id=p_operator and role in ('operator','admin')) then
      raise exception 'OPERATOR_REQUIRED';
    end if;
    return public.issue_qr_entry_internal(p_operator,p_body);
  end if;
  return public.admin_action_before_staff_qr(p_operator,p_body);
end;
$$;

alter function public.staff_action(uuid,jsonb) rename to staff_action_before_qr;
create function public.staff_action(p_operator uuid,p_body jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if p_body->>'action'='createQrEntry' then
    if not exists(select 1 from public.operator_profiles where user_id=p_operator and role in ('staff','operator','admin')) then
      raise exception 'STAFF_REQUIRED';
    end if;
    return public.issue_qr_entry_internal(p_operator,p_body);
  end if;
  return public.staff_action_before_qr(p_operator,p_body);
end;
$$;

revoke all on function public.issue_qr_entry_internal(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.admin_action_before_staff_qr(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.admin_action(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.admin_action(uuid,jsonb) to service_role;
revoke all on function public.staff_action_before_qr(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.staff_action(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.staff_action(uuid,jsonb) to service_role;
