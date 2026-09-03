-- Do not run during the filing/review period. Apply together with the matching frontend deployment.
-- Adds cross-brand visibility controls for published partner resources and their private files.

alter table public.skill_resources
  add column if not exists visibility_scope text not null default 'all_partners'
  check (visibility_scope in ('all_partners', 'brand_only'));

create or replace function public.dfws_can_manage_skill_resources()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('manager', 'brand_admin', 'ai_officer')
  );
$$;

create or replace function public.dfws_can_read_skill_resource(resource public.skill_resources)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.dfws_can_manage_skill_resources()
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'leader')
    or resource.uploaded_by = auth.uid()
    or (
      resource.status = 'published'
      and (
        resource.visibility_scope = 'all_partners'
        or exists (
          select 1
          from public.profiles viewer
          join public.partners viewer_partner on viewer_partner.id = viewer.partner_id
          join public.partners resource_partner on resource_partner.id = resource.partner_id
          where viewer.id = auth.uid()
            and viewer_partner.brand = resource_partner.brand
        )
      )
    );
$$;

create or replace function public.dfws_can_read_skill_file(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.skill_resources resource
    where (resource.file_path = object_name
      or resource.description like '%' || '成果展示附件路径：' || object_name || '%')
      and public.dfws_can_read_skill_resource(resource)
  );
$$;

-- Replace existing resource policies so a permissive legacy policy cannot bypass brand visibility.
do $$
declare item record;
begin
  for item in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'skill_resources'
  loop
    execute format('drop policy if exists %I on public.skill_resources', item.policyname);
  end loop;
end;
$$;

alter table public.skill_resources enable row level security;

create policy "DFWS read scoped skill resources"
  on public.skill_resources for select
  using (public.dfws_can_read_skill_resource(skill_resources));

create policy "DFWS submit own skill resources"
  on public.skill_resources for insert
  with check (
    public.dfws_can_manage_skill_resources()
    or (
      uploaded_by = auth.uid()
      and partner_id = (select partner_id from public.profiles where id = auth.uid())
    )
  );

create policy "DFWS managers update skill resources"
  on public.skill_resources for update
  using (public.dfws_can_manage_skill_resources())
  with check (public.dfws_can_manage_skill_resources());

create policy "DFWS managers delete skill resources"
  on public.skill_resources for delete
  using (public.dfws_can_manage_skill_resources());

-- Remove only storage policies whose condition explicitly targets the skill-files bucket,
-- then recreate scoped policies for this bucket. Other buckets remain untouched.
do $$
declare item record;
begin
  for item in
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and coalesce(qual, '') like '%skill-files%'
  loop
    execute format('drop policy if exists %I on storage.objects', item.policyname);
  end loop;
end;
$$;

create policy "DFWS read scoped skill files"
  on storage.objects for select to authenticated
  using (bucket_id = 'skill-files' and public.dfws_can_read_skill_file(name));

create policy "DFWS upload own skill files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'skill-files'
    and (
      public.dfws_can_manage_skill_resources()
      or (storage.foldername(name))[1] = auth.uid()::text
    )
  );
