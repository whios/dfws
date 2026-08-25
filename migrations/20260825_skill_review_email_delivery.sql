-- 站内通知同时作为审核邮件的可靠发送队列：每条审核状态通知最多成功发送一次。
alter table public.notifications
  add column if not exists email_send_started_at timestamptz,
  add column if not exists email_sent_at timestamptz;

create index if not exists notifications_unsent_email_idx
  on public.notifications (created_at desc)
  where email_sent_at is null;
