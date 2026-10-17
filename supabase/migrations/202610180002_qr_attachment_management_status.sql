create or replace function public.tag_dto(p_tag public.tags) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'id',p_tag.id,'token',p_tag.public_token,'label',coalesce(p_tag.serial_number,p_tag.label),
  'batch',coalesce(p_tag.batch_date::text,p_tag.batch),'categoryId',p_tag.topic_id,
  'categoryCode',c.code,'batchDate',p_tag.batch_date,'serialNumber',p_tag.serial_number,
  'inventoryLabel',p_tag.inventory_label,'entryChannel',p_tag.entry_channel,'version',p_tag.version,
  'status',p_tag.status,'createdAt',p_tag.created_at,
  'recording',(select jsonb_build_object('id',r.id,'nickname',r.nickname,'duration',r.duration_seconds,
   'mimeType',r.mime_type,'createdAt',r.created_at,'location',r.location) from public.recordings r where r.tag_id=p_tag.id),
  'provisioning',(select public.job_dto(j) from public.provisioning_jobs j where j.tag_id=p_tag.id),
  'attachment',(select public.qr_attachment_dto(q) from public.qr_card_attachments q where q.tag_id=p_tag.id)
 ) from (select 1) seed left join public.memory_topics c on c.id=p_tag.topic_id
$$;
