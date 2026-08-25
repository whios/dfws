-- 审核状态变更时给成果提交人生成站内通知；不依赖 SMTP 或第三方邮件服务。
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  skill_resource_id uuid references public.skill_resources(id) on delete set null,
  kind text not null check (kind in ('skill_published', 'skill_rejected')),
  title text not null,
  body text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_recipient_created_at_idx
  on public.notifications (recipient_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "Recipients can read own notifications" on public.notifications;
create policy "Recipients can read own notifications"
  on public.notifications for select
  using (recipient_id = auth.uid());

drop policy if exists "Recipients can mark own notifications read" on public.notifications;
create policy "Recipients can mark own notifications read"
  on public.notifications for update
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

create or replace function public.create_skill_status_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $notify$
begin
  if old.status is not distinct from new.status or new.status not in ('published', 'rejected') then
    return new;
  end if;

  insert into public.notifications (recipient_id, skill_resource_id, kind, title, body)
  values (
    new.uploaded_by,
    new.id,
    case when new.status = 'published' then 'skill_published' else 'skill_rejected' end,
    case when new.status = 'published' then '成果已发布并入账' else '成果需要修改' end,
    case when new.status = 'published'
      then format('你的成果《%s》已通过审核，已进入资产台账并在成果库发布，伙伴可下载使用。', new.title)
      else format('你的成果《%s》被退回修改。审核说明：%s', new.title, coalesce(nullif(new.review_note, ''), '请补充或修改后重新提交。'))
    end
  );
  return new;
end;
$notify$;

drop trigger if exists create_skill_status_notification on public.skill_resources;
create trigger create_skill_status_notification
after update of status on public.skill_resources
for each row execute function public.create_skill_status_notification();
