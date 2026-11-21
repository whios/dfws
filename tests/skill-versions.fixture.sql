create role authenticated; create role anon;
create schema auth; create schema storage;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
create table public.partners(id uuid primary key,brand text,owner_name text,department text);
create table public.profiles(id uuid primary key,role text,partner_id uuid,account_status text default 'active');
create table public.skill_resources(id uuid primary key,partner_id uuid,uploaded_by uuid,status text,title text,description text,visibility_scope text,file_name text,file_path text,mime_type text,size_bytes bigint,updated_at timestamptz,download_count integer default 7);
create table public.operation_audit_logs(actor_id uuid,action text,target_type text,target_id uuid,target_name text,brand text,details jsonb);
create table public.notifications(recipient_id uuid,skill_resource_id uuid,kind text,title text,body text);
create table storage.objects(name text,bucket_id text);
create function public.dfws_can_manage_skill_resource(r public.skill_resources) returns boolean language sql stable as $$select exists(select 1 from profiles p where p.id=auth.uid() and (p.role in ('manager','ai_officer') or (p.role='brand_admin' and (select brand from partners where id=p.partner_id)=(select brand from partners where id=r.partner_id))))$$;
create function public.skill_resource_field(source text,field_name text) returns text language sql immutable as $$select nullif(btrim(split_part(split_part(coalesce(source,''),field_name||'：',2),E'\n\n',1)),'')$$;
insert into partners values('00000000-0000-0000-0000-000000000001','迈点','作者','部门'),('00000000-0000-0000-0000-000000000002','先之','另一品牌','部门');
insert into profiles values('10000000-0000-0000-0000-000000000001','partner','00000000-0000-0000-0000-000000000001','active'),('10000000-0000-0000-0000-000000000002','partner','00000000-0000-0000-0000-000000000002','active'),('10000000-0000-0000-0000-000000000003','brand_admin','00000000-0000-0000-0000-000000000001','active'),('10000000-0000-0000-0000-000000000004','brand_admin','00000000-0000-0000-0000-000000000002','active'),('10000000-0000-0000-0000-000000000005','leader',null,'active');
insert into skill_resources(id,partner_id,uploaded_by,status,title,description,visibility_scope,file_name,file_path,size_bytes)
values('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','published','旧版',E'成果类型：Skill\n\n适用场景：旧场景','all_partners','old.zip','10000000-0000-0000-0000-000000000001/old.zip',100);
create table assets(skill_resource_id uuid primary key,title text);
insert into assets values('20000000-0000-0000-0000-000000000001','旧版');
create function test_sync() returns trigger language plpgsql as $$ begin update assets set title=new.title where skill_resource_id=new.id;return new;end $$;
create trigger test_sync after update of title,description on skill_resources for each row execute function test_sync();
