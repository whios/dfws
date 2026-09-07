-- 资产台账不再维护独立流程状态：已关联成果的状态始终以成果审核状态为准。
create or replace function public.sync_published_skill_resource_to_asset()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  linked_partner public.partners%rowtype;
  publication_status text;
begin
  publication_status := case new.status
    when 'published' then '已发布'
    when 'rejected' then '退回修改'
    when 'archived' then '已下架'
    else '待审核'
  end;

  if new.status = 'published' then
    select * into linked_partner from public.partners where id = new.partner_id;
    if not found then
      raise exception '成果未关联伙伴记录，无法入资产台账';
    end if;

    insert into public.assets (
      skill_resource_id, partner_id, name, asset_type, brand, department,
      owner_name, platform, task, calls, verification_level, verification_status,
      evidence_path, review_note, checks
    ) values (
      new.id, linked_partner.id, new.title,
      coalesce(public.skill_resource_field(new.description, '成果类型'), 'Skill'),
      linked_partner.brand, linked_partner.department, linked_partner.owner_name,
      null, coalesce(public.skill_resource_field(new.description, '适用场景'), new.description, ''),
      0, 'V1', publication_status,
      public.skill_resource_field(new.description, '核验证据'),
      public.skill_resource_field(new.description, '使用限制与数据权限'), '[]'::jsonb
    )
    on conflict (skill_resource_id) where skill_resource_id is not null do update set
      name = excluded.name,
      asset_type = excluded.asset_type,
      brand = excluded.brand,
      department = excluded.department,
      owner_name = excluded.owner_name,
      task = excluded.task,
      evidence_path = excluded.evidence_path,
      review_note = excluded.review_note,
      verification_status = excluded.verification_status;
  elsif tg_op = 'UPDATE' and new.status in ('rejected', 'archived') then
    update public.assets set verification_status = publication_status where skill_resource_id = new.id;
  end if;
  return new;
end;
$$;

-- 统一已有已关联资产的状态，并将历史 V0 调整为当前可见的 V1 基础等级。
update public.assets asset
set verification_status = case resource.status
      when 'published' then '已发布'
      when 'rejected' then '退回修改'
      when 'archived' then '已下架'
      else '待审核'
    end,
    verification_level = case when asset.verification_level = 'V0' then 'V1' else asset.verification_level end
from public.skill_resources resource
where asset.skill_resource_id = resource.id;
