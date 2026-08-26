-- 删除成果时同步删除自动生成的资产台账，避免成果已删除但资产残留。
alter table public.assets
  drop constraint if exists assets_skill_resource_id_fkey;

alter table public.assets
  add constraint assets_skill_resource_id_fkey
  foreign key (skill_resource_id)
  references public.skill_resources(id)
  on delete cascade;
