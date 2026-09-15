-- Keep automatic asset ledger entries aligned with the valid partner brands.
-- Existing historical rows are preserved; new and updated entries use this list.
alter table public.assets
  drop constraint if exists assets_brand_check;

alter table public.assets
  add constraint assets_brand_check
  check (brand in ('测试', '迈点', '最佳东方', '乔邦', '先之', '技术中心', '职能')) not valid;
