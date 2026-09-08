-- 组织通讯录独立于伙伴档案和登录账号：一个人可在多个部门任职，
-- 邀请只会使用已维护的通讯录，不再依赖浏览器临时上传文件。
create table if not exists public.organization_units (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  parent_id uuid references public.organization_units(id) on delete cascade,
  brand text,
  directory_path text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists organization_units_directory_path_key
  on public.organization_units (directory_path)
  where directory_path is not null;

create table if not exists public.organization_people (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (btrim(display_name) <> ''),
  email text not null,
  partner_id uuid references public.partners(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists organization_people_email_key
  on public.organization_people (lower(email));

create unique index if not exists organization_people_partner_key
  on public.organization_people (partner_id)
  where partner_id is not null;

create table if not exists public.organization_memberships (
  person_id uuid not null references public.organization_people(id) on delete cascade,
  unit_id uuid not null references public.organization_units(id) on delete cascade,
  primary key (person_id, unit_id)
);

create index if not exists organization_memberships_unit_idx
  on public.organization_memberships (unit_id, person_id);

alter table public.organization_units enable row level security;
alter table public.organization_people enable row level security;
alter table public.organization_memberships enable row level security;

-- 组织通讯录由受保护的服务端人员管理接口维护，不对普通登录用户开放直读。
