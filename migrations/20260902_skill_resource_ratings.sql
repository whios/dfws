-- Do not run during the filing/review period. Apply after
-- 20260831_skill_resource_visibility_scope.sql and with the matching frontend.
-- Ratings are private at the individual level; partners receive aggregates only.

create table if not exists public.skill_resource_accesses (
  resource_id uuid not null references public.skill_resources(id) on delete cascade,
  opened_by uuid not null references public.profiles(id) on delete cascade,
  opened_at timestamptz not null default now(),
  primary key (resource_id, opened_by)
);

create table if not exists public.skill_resource_ratings (
  resource_id uuid not null references public.skill_resources(id) on delete cascade,
  rater_id uuid not null references public.profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (resource_id, rater_id)
);

create index if not exists skill_resource_ratings_resource_id_idx
  on public.skill_resource_ratings(resource_id);

alter table public.skill_resource_accesses enable row level security;
alter table public.skill_resource_ratings enable row level security;

-- Opening the documented steps counts as an access event. This does not record
-- the URL itself or expose the accessing person's identity to the author.
create or replace function public.record_skill_resource_access(resource_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  resource public.skill_resources;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'partner') then
    raise exception '仅伙伴账号可以记录成果使用。';
  end if;

  select * into resource from public.skill_resources where id = $1;
  if not found or resource.status <> 'published' or not public.dfws_can_read_skill_resource(resource) then
    raise exception '当前没有访问该成果的权限。';
  end if;

  insert into public.skill_resource_accesses(resource_id, opened_by, opened_at)
  values (resource.id, auth.uid(), now())
  on conflict (resource_id, opened_by) do update set opened_at = excluded.opened_at;
end;
$$;

-- One partner can score a resource once and may overwrite that score after
-- further use. The author cannot score their own work.
create or replace function public.upsert_skill_rating(resource_id uuid, rating smallint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  resource public.skill_resources;
begin
  if $2 not between 1 and 5 then
    raise exception '评分必须为 1 到 5 星。';
  end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'partner') then
    raise exception '仅伙伴账号可以提交使用评分。';
  end if;

  select * into resource from public.skill_resources where id = $1;
  if not found or resource.status <> 'published' or not public.dfws_can_read_skill_resource(resource) then
    raise exception '当前没有评价该成果的权限。';
  end if;
  if resource.uploaded_by = auth.uid() then
    raise exception '不能评价自己提交的成果。';
  end if;
  if not exists (select 1 from public.skill_downloads where skill_downloads.resource_id = resource.id and downloaded_by = auth.uid())
     and not exists (select 1 from public.skill_resource_accesses where skill_resource_accesses.resource_id = resource.id and opened_by = auth.uid()) then
    raise exception '请先打开操作步骤或下载文件后再评分。';
  end if;

  insert into public.skill_resource_ratings(resource_id, rater_id, rating, created_at, updated_at)
  values (resource.id, auth.uid(), $2, now(), now())
  on conflict (resource_id, rater_id) do update
  set rating = excluded.rating, updated_at = excluded.updated_at;
end;
$$;

-- The partner portal receives only per-resource aggregate scores and its own
-- score. Individual raters remain visible only to a future staff-only report.
create or replace function public.skill_rating_summaries()
returns table (
  resource_id uuid,
  average_rating numeric,
  rating_count integer,
  my_rating smallint,
  can_rate boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select
    resource.id,
    case when count(rating.resource_id) = 0 then null else round(avg(rating.rating)::numeric, 1) end,
    count(rating.resource_id)::integer,
    max(rating.rating) filter (where rating.rater_id = auth.uid()),
    exists (select 1 from public.profiles where id = auth.uid() and role = 'partner')
      and resource.uploaded_by is distinct from auth.uid()
      and (
        exists (select 1 from public.skill_downloads where skill_downloads.resource_id = resource.id and downloaded_by = auth.uid())
        or exists (select 1 from public.skill_resource_accesses where skill_resource_accesses.resource_id = resource.id and opened_by = auth.uid())
      )
  from public.skill_resources resource
  left join public.skill_resource_ratings rating on rating.resource_id = resource.id
  where resource.status = 'published'
    and public.dfws_can_read_skill_resource(resource)
  group by resource.id, resource.uploaded_by;
$$;

grant execute on function public.record_skill_resource_access(uuid) to authenticated;
grant execute on function public.upsert_skill_rating(uuid, smallint) to authenticated;
grant execute on function public.skill_rating_summaries() to authenticated;
