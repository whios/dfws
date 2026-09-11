-- 审核和发布的关键操作需要可追溯到实际操作者；日志只向人员权限管理员开放。
create table if not exists public.operation_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id uuid,
  target_name text not null,
  brand text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists operation_audit_logs_created_at_idx
  on public.operation_audit_logs (created_at desc);

alter table public.operation_audit_logs enable row level security;

drop policy if exists "Personnel admins can read operation audit logs" on public.operation_audit_logs;
create policy "Personnel admins can read operation audit logs"
  on public.operation_audit_logs for select
  using (public.dfws_is_global_staff());

create or replace function public.log_skill_resource_review_operation()
returns trigger
language plpgsql
security definer
set search_path = public
as $audit$
declare
  target_brand text;
  action_name text;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  action_name := case new.status
    when 'published' then '审核通过并入账'
    when 'rejected' then '退回修改'
    when 'archived' then '下架成果'
    else '调整审核状态'
  end;

  select brand into target_brand from public.partners where id = new.partner_id;
  insert into public.operation_audit_logs (actor_id, action, target_type, target_id, target_name, brand, details)
  values (
    auth.uid(), action_name, 'skill_resource', new.id, new.title, target_brand,
    jsonb_build_object('fromStatus', old.status, 'toStatus', new.status)
  );
  return new;
end;
$audit$;

drop trigger if exists log_skill_resource_review_operation on public.skill_resources;
create trigger log_skill_resource_review_operation
after update of status on public.skill_resources
for each row execute function public.log_skill_resource_review_operation();

create or replace function public.list_operation_audit_logs(max_rows integer default 100)
returns table (
  id uuid,
  action text,
  target_type text,
  target_id uuid,
  target_name text,
  brand text,
  actor_name text,
  actor_role text,
  details jsonb,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $logs$
  select
    log.id,
    log.action,
    log.target_type,
    log.target_id,
    log.target_name,
    log.brand,
    coalesce(actor.display_name, actor.email, '系统') as actor_name,
    actor.role as actor_role,
    log.details,
    log.created_at
  from public.operation_audit_logs log
  left join public.profiles actor on actor.id = log.actor_id
  where public.dfws_is_global_staff()
  order by log.created_at desc
  limit greatest(1, least(coalesce(max_rows, 100), 200));
$logs$;
