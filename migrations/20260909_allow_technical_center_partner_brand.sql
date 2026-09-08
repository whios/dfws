-- 产品技术中心下的伙伴档案使用“技术中心”品牌。
-- NOT VALID 保留已有历史记录，仅对新增或修改的记录启用新的品牌校验。
alter table public.partners
  drop constraint if exists partners_brand_check;

alter table public.partners
  add constraint partners_brand_check
  check (brand in ('测试', '迈点', '最佳东方', '乔邦', '先之', '技术中心', '职能')) not valid;
