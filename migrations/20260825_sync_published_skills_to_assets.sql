-- 发布成果即入资产台账：每个成果资源最多对应一条资产，避免两套台账分离。
alter table public.assets
  add column if not exists skill_resource_id uuid references public.skill_resources(id) on delete set null;

create unique index if not exists assets_skill_resource_id_key
  on public.assets (skill_resource_id)
  where skill_resource_id is not null;

create or replace function public.skill_resource_field(source text, field_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(
    btrim(split_part(split_part(coalesce(source, ''), field_name || '：', 2), E'\n\n', 1)),
    ''
  );
$$;

create or replace function public.sync_published_skill_resource_to_asset()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  linked_partner public.partners%rowtype;
begin
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
      new.id,
      linked_partner.id,
      new.title,
      coalesce(public.skill_resource_field(new.description, '成果类型'), 'Skill'),
      linked_partner.brand,
      linked_partner.department,
      linked_partner.owner_name,
      null,
      coalesce(public.skill_resource_field(new.description, '适用场景'), new.description, ''),
      0,
      'V0',
      '待核验',
      public.skill_resource_field(new.description, '核验证据'),
      public.skill_resource_field(new.description, '使用限制与数据权限'),
      '[]'::jsonb
    )
    on conflict (skill_resource_id) where skill_resource_id is not null do update set
      name = excluded.name,
      asset_type = excluded.asset_type,
      brand = excluded.brand,
      department = excluded.department,
      owner_name = excluded.owner_name,
      task = excluded.task,
      evidence_path = excluded.evidence_path,
      review_note = excluded.review_note;
  elsif tg_op = 'UPDATE' and new.status in ('rejected', 'archived') then
    update public.assets
    set verification_status = case when new.status = 'archived' then '已下架' else '待整改' end
    where skill_resource_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_published_skill_resource_to_asset on public.skill_resources;
create trigger sync_published_skill_resource_to_asset
after insert or update of status, title, description, partner_id on public.skill_resources
for each row execute function public.sync_published_skill_resource_to_asset();

-- 一次性回填历史已发布成果；新成果将由上方触发器自动同步。
insert into public.assets (
  skill_resource_id, partner_id, name, asset_type, brand, department,
  owner_name, platform, task, calls, verification_level, verification_status,
  evidence_path, review_note, checks
)
select
  resource.id,
  partner.id,
  resource.title,
  coalesce(public.skill_resource_field(resource.description, '成果类型'), 'Skill'),
  partner.brand,
  partner.department,
  partner.owner_name,
  null,
  coalesce(public.skill_resource_field(resource.description, '适用场景'), resource.description, ''),
  0,
  'V0',
  '待核验',
  public.skill_resource_field(resource.description, '核验证据'),
  public.skill_resource_field(resource.description, '使用限制与数据权限'),
  '[]'::jsonb
from public.skill_resources resource
join public.partners partner on partner.id = resource.partner_id
where resource.status = 'published'
on conflict (skill_resource_id) where skill_resource_id is not null do nothing;
