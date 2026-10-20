-- Account operation controls for departed or temporarily inactive personnel.
-- Authentication is also banned/unbanned by the protected staff endpoint.
alter table public.profiles
  add column if not exists account_status text not null default 'active',
  add column if not exists account_status_updated_at timestamptz,
  add column if not exists account_status_updated_by uuid references public.profiles(id) on delete set null;

alter table public.profiles
  drop constraint if exists profiles_account_status_check;

alter table public.profiles
  add constraint profiles_account_status_check check (account_status in ('active', 'disabled'));

update public.profiles
set account_status = 'active'
where account_status is null;
