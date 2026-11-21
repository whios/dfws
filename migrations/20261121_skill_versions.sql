-- Apply before releasing the version-submission UI. No existing resources are duplicated.
begin;
alter table public.skill_resources add column if not exists version_number integer not null default 1;
create table if not exists public.skill_versions (
 id uuid primary key default gen_random_uuid(),
 resource_id uuid not null references public.skill_resources(id) on delete cascade,
 version_number integer not null,
 change_note text not null check (length(btrim(change_note)) between 1 and 2000),
 payload jsonb not null,
 previous_payload jsonb not null,
 status text not null default 'pending' check (status in ('pending','published','rejected')),
 submitted_by uuid not null references public.profiles(id),
 submitted_at timestamptz not null default now(),
 reviewed_by uuid references public.profiles(id),
 reviewed_at timestamptz,
 review_note text
);
create unique index if not exists skill_versions_one_pending on public.skill_versions(resource_id) where status='pending';
alter table public.skill_versions enable row level security;
drop policy if exists "Owners and scoped staff read versions" on public.skill_versions;
create policy "Owners and scoped staff read versions" on public.skill_versions for select to authenticated
 using (exists (select 1 from public.skill_resources r where r.id=resource_id and (r.uploaded_by=auth.uid() or public.dfws_can_manage_skill_resource(r))));
grant select on public.skill_versions to authenticated;
revoke insert,update,delete on public.skill_versions from authenticated,anon;

create or replace function public.submit_skill_version(target_resource uuid, expected_version integer, changes jsonb, update_note text)
returns public.skill_versions language plpgsql security definer set search_path=public as $$
declare r public.skill_resources; result public.skill_versions; snapshot jsonb; field text; path text;
begin
 select * into r from public.skill_resources where id=target_resource for update;
 if auth.uid() is null or r.id is null or r.uploaded_by<>auth.uid() or r.status<>'published' or not exists
 (select 1 from public.profiles p where p.id=auth.uid() and p.role='partner' and p.account_status<>'disabled' and p.partner_id=r.partner_id)
 then raise exception '只能为本人已发布成果提交新版本'; end if;
 if r.version_number<>expected_version then raise exception '当前版本已更新，请刷新后重新提交'; end if;
 if exists(select 1 from public.skill_versions where resource_id=r.id and status='pending') then raise exception '已有新版本待审核，请勿重复提交'; end if;
 if length(btrim(coalesce(update_note,''))) not between 1 and 2000 then raise exception '请填写本次更新说明（不超过2000字）'; end if;
 if not coalesce((changes->>'tested')::boolean,false) then raise exception '更新后请先实际试用，再提交审核'; end if;
 if nullif(btrim(changes->>'title'),'') is null or nullif(btrim(changes->>'description'),'') is null or nullif(changes->>'file_path','') is null or coalesce(changes->>'visibility_scope','') not in ('all_partners','brand_only') or coalesce((changes->>'size_bytes')::bigint,-1) not between 0 and 209715200 or nullif(changes->>'file_name','') is null then raise exception '新版本资料不完整'; end if;
 -- Preserve references to the original files; new uploads must be owned by the submitter.
 path:=changes->>'file_path';
 if path is distinct from r.file_path and split_part(path,'/',1)<>auth.uid()::text then raise exception '成果文件不属于当前伙伴'; end if;
 path:=public.skill_resource_field(changes->>'description','成果展示附件路径');
 if path is not null and path is distinct from public.skill_resource_field(r.description,'成果展示附件路径') and split_part(path,'/',1)<>auth.uid()::text then raise exception '展示附件不属于当前伙伴'; end if;
 snapshot:=jsonb_build_object('title',r.title,'description',r.description,'visibility_scope',r.visibility_scope,'file_name',r.file_name,'file_path',r.file_path,'mime_type',r.mime_type,'size_bytes',r.size_bytes);
 insert into public.skill_versions(resource_id,version_number,change_note,payload,previous_payload,submitted_by)
 values(r.id,r.version_number+1,btrim(update_note),changes,snapshot,auth.uid()) returning * into result;
 return result;
end $$;

create or replace function public.review_skill_version(target_version uuid, decision text, note text)
returns void language plpgsql security definer set search_path=public as $$
declare v public.skill_versions; r public.skill_resources; rid uuid;
begin
 select resource_id into rid from public.skill_versions where id=target_version;
 select * into r from public.skill_resources where id=rid for update;
 select * into v from public.skill_versions where id=target_version for update;
 if v.id is null or not coalesce(public.dfws_can_manage_skill_resource(r),false) or not exists(select 1 from public.profiles where id=auth.uid() and account_status<>'disabled') then raise exception '当前账号没有审核此版本的权限'; end if;
 if v.status<>'pending' then raise exception '该版本已处理，请刷新'; end if;
 if decision not in ('published','rejected') then raise exception '请选择通过或退回'; end if;
 if decision='rejected' and nullif(btrim(note),'') is null then raise exception '退回时请填写修改意见'; end if;
 if decision='published' then
  if r.status<>'published' or r.version_number<>v.version_number-1 then raise exception '原成果状态或版本已变化，请重新核对'; end if;
  if v.previous_payload is distinct from jsonb_build_object('title',r.title,'description',r.description,'visibility_scope',r.visibility_scope,'file_name',r.file_name,'file_path',r.file_path,'mime_type',r.mime_type,'size_bytes',r.size_bytes) then raise exception '旧版内容已被修改，请退回新版本重新核对'; end if;
  update public.skill_resources set title=v.payload->>'title',description=v.payload->>'description',visibility_scope=v.payload->>'visibility_scope',file_name=v.payload->>'file_name',file_path=v.payload->>'file_path',mime_type=v.payload->>'mime_type',size_bytes=(v.payload->>'size_bytes')::bigint,version_number=v.version_number,updated_at=now() where id=r.id;
 end if;
 update public.skill_versions set status=decision,reviewed_by=auth.uid(),reviewed_at=now(),review_note=note where id=v.id;
 insert into public.operation_audit_logs(actor_id,action,target_type,target_id,target_name,brand,details)
 values(auth.uid(),case when decision='published' then '发布新版本' else '退回新版本' end,'skill_resource',r.id,r.title,
 (select brand from public.partners where id=r.partner_id),jsonb_build_object('version',v.version_number,'note',note));
 insert into public.notifications(recipient_id,skill_resource_id,kind,title,body)
 values(r.uploaded_by,r.id,case when decision='published' then 'skill_published' else 'skill_rejected' end,
 case when decision='published' then '新版本已发布' else '新版本需要修改' end,
 format('《%s》版本 v%s：%s',r.title,v.version_number,case when decision='published' then '审核通过，已切换至新版本。' else coalesce(note,'请修改后重新提交；旧版仍可用。') end));
end $$;
revoke all on function public.submit_skill_version(uuid,integer,jsonb,text) from public,anon;
revoke all on function public.review_skill_version(uuid,text,text) from public,anon;
grant execute on function public.submit_skill_version(uuid,integer,jsonb,text) to authenticated;
grant execute on function public.review_skill_version(uuid,text,text) to authenticated;

create or replace function public.dfws_can_read_version_file(path text)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.skill_versions v join public.skill_resources r on r.id=v.resource_id
 where (r.uploaded_by=auth.uid() or public.dfws_can_manage_skill_resource(r))
 and (v.payload->>'file_path'=path or public.skill_resource_field(v.payload->>'description','成果展示附件路径')=path
 or v.previous_payload->>'file_path'=path or public.skill_resource_field(v.previous_payload->>'description','成果展示附件路径')=path));
$$;
revoke all on function public.dfws_can_read_version_file(text) from public,anon;
grant execute on function public.dfws_can_read_version_file(text) to authenticated;
drop policy if exists "DFWS read version files" on storage.objects;
create policy "DFWS read version files" on storage.objects for select to authenticated
using(bucket_id='skill-files' and public.dfws_can_read_version_file(name));
commit;
