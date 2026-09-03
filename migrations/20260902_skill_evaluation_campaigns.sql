-- Do not run during the filing/review period. Apply after the visibility and
-- rating migrations, together with the matching frontend deployment.

create table if not exists public.skill_evaluation_campaigns (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.skill_resources(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  closes_at timestamptz not null,
  reminder_version integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.skill_evaluation_targets (
  campaign_id uuid not null references public.skill_evaluation_campaigns(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  notified_at timestamptz not null default now(),
  primary key (campaign_id, profile_id)
);

create table if not exists public.skill_evaluation_responses (
  campaign_id uuid not null references public.skill_evaluation_campaigns(id) on delete cascade,
  respondent_id uuid not null references public.profiles(id) on delete cascade,
  efficiency_improved boolean not null default false,
  quality_improved boolean not null default false,
  no_obvious_effect boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (campaign_id, respondent_id),
  check (efficiency_improved or quality_improved or no_obvious_effect),
  check (not (no_obvious_effect and (efficiency_improved or quality_improved)))
);

create index if not exists skill_evaluation_targets_profile_id_idx on public.skill_evaluation_targets(profile_id);
create index if not exists skill_evaluation_responses_campaign_id_idx on public.skill_evaluation_responses(campaign_id);

alter table public.skill_evaluation_campaigns enable row level security;
alter table public.skill_evaluation_targets enable row level security;
alter table public.skill_evaluation_responses enable row level security;

-- Existing notification values are extended without changing historical rows.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('skill_published', 'skill_rejected', 'skill_evaluation'));

create or replace function public.create_skill_evaluation_campaign(resource_id uuid, closes_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  campaign_id uuid;
  resource public.skill_resources;
  target_count integer;
  reminder_count integer;
begin
  if not public.dfws_can_manage_skill_resources() then
    raise exception '当前账号没有发起效果评价的权限。';
  end if;
  if closes_at <= now() then
    raise exception '评价截止时间必须晚于当前时间。';
  end if;

  select * into resource from public.skill_resources where id = $1;
  if not found or resource.status <> 'published' then
    raise exception '只能对已发布成果发起效果评价。';
  end if;
  select id into campaign_id
  from public.skill_evaluation_campaigns
  where resource_id = resource.id and closes_at >= now()
  order by created_at desc
  limit 1;

  if found then
    insert into public.skill_evaluation_targets(campaign_id, profile_id)
    select campaign_id, candidate.profile_id
    from (
      select distinct downloaded_by as profile_id
      from public.skill_downloads
      where resource_id = resource.id
      union
      select distinct opened_by as profile_id
      from public.skill_resource_accesses
      where resource_id = resource.id
    ) candidate
    join public.profiles profile on profile.id = candidate.profile_id and profile.role = 'partner'
    where candidate.profile_id <> resource.uploaded_by
    on conflict (campaign_id, profile_id) do nothing;

    select count(*) into reminder_count
    from public.skill_evaluation_targets target
    where target.campaign_id = campaign_id
      and not exists (
        select 1 from public.skill_evaluation_responses response
        where response.campaign_id = campaign_id and response.respondent_id = target.profile_id
      );
    if reminder_count = 0 then
      raise exception '本轮评价的伙伴均已完成，无需再次提醒。';
    end if;

    update public.skill_evaluation_campaigns
    set reminder_version = reminder_version + 1
    where id = campaign_id;
    update public.skill_evaluation_targets target
    set notified_at = now()
    where target.campaign_id = campaign_id
      and not exists (
        select 1 from public.skill_evaluation_responses response
        where response.campaign_id = campaign_id and response.respondent_id = target.profile_id
      );
    insert into public.notifications(recipient_id, skill_resource_id, kind, title, body)
    select target.profile_id, resource.id, 'skill_evaluation', '请补充评价近期使用成果',
      format('成果《%s》仍在等待你的效果评价，请在 %s 前勾选本次使用是否提效、提质或暂无明显效果。', resource.title, to_char($2 at time zone 'Asia/Shanghai', 'YYYY-MM-DD'))
    from public.skill_evaluation_targets target
    where target.campaign_id = campaign_id
      and not exists (
        select 1 from public.skill_evaluation_responses response
        where response.campaign_id = campaign_id and response.respondent_id = target.profile_id
      );
    return jsonb_build_object('action', 'reminded', 'targetCount', reminder_count);
  end if;

  insert into public.skill_evaluation_campaigns(resource_id, created_by, closes_at)
  values (resource.id, auth.uid(), $2)
  returning id into campaign_id;

  insert into public.skill_evaluation_targets(campaign_id, profile_id)
  select campaign_id, candidate.profile_id
  from (
    select distinct downloaded_by as profile_id
    from public.skill_downloads
    where resource_id = resource.id
    union
    select distinct opened_by as profile_id
    from public.skill_resource_accesses
    where resource_id = resource.id
  ) candidate
  join public.profiles profile on profile.id = candidate.profile_id and profile.role = 'partner'
  where candidate.profile_id <> resource.uploaded_by;

  get diagnostics target_count = row_count;
  if target_count = 0 then
    delete from public.skill_evaluation_campaigns where id = campaign_id;
    raise exception '该成果暂无实际使用伙伴，暂时不能发起评价。';
  end if;

  insert into public.notifications(recipient_id, skill_resource_id, kind, title, body)
  select target.profile_id, resource.id, 'skill_evaluation', '请评价近期使用成果',
    format('成果《%s》已进入阶段性效果评价，请在 %s 前勾选本次使用是否提效、提质或暂无明显效果。', resource.title, to_char($2 at time zone 'Asia/Shanghai', 'YYYY-MM-DD'))
  from public.skill_evaluation_targets target
  where target.campaign_id = campaign_id;

  return jsonb_build_object('action', 'created', 'targetCount', target_count);
end;
$$;

create or replace function public.upsert_skill_evaluation_response(
  campaign_id uuid,
  efficiency_improved boolean,
  quality_improved boolean,
  no_obvious_effect boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'partner') then
    raise exception '仅伙伴账号可以提交效果评价。';
  end if;
  if not ($2 or $3 or $4) or ($4 and ($2 or $3)) then
    raise exception '请正确选择本次使用效果。';
  end if;
  if not exists (
    select 1 from public.skill_evaluation_targets target
    join public.skill_evaluation_campaigns campaign on campaign.id = target.campaign_id
    where target.campaign_id = $1 and target.profile_id = auth.uid() and campaign.closes_at >= now()
  ) then
    raise exception '该评价任务不存在、已截止或不属于当前账号。';
  end if;

  insert into public.skill_evaluation_responses(campaign_id, respondent_id, efficiency_improved, quality_improved, no_obvious_effect, created_at, updated_at)
  values ($1, auth.uid(), $2, $3, $4, now(), now())
  on conflict (campaign_id, respondent_id) do update set
    efficiency_improved = excluded.efficiency_improved,
    quality_improved = excluded.quality_improved,
    no_obvious_effect = excluded.no_obvious_effect,
    updated_at = excluded.updated_at;
end;
$$;

-- Partners receive only their own task and response. Staff receive aggregates,
-- not per-person response details, so the result remains about product value.
create or replace function public.skill_evaluation_campaign_summaries()
returns table (
  id uuid,
  resource_id uuid,
  resource_title text,
  closes_at timestamptz,
  reminder_version integer,
  target_count integer,
  response_count integer,
  efficiency_count integer,
  quality_count integer,
  no_effect_count integer,
  my_efficiency_improved boolean,
  my_quality_improved boolean,
  my_no_obvious_effect boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select
    campaign.id,
    campaign.resource_id,
    resource.title,
    campaign.closes_at,
    campaign.reminder_version,
    count(distinct target.profile_id)::integer,
    count(distinct response.respondent_id)::integer,
    count(distinct response.respondent_id) filter (where response.efficiency_improved)::integer,
    count(distinct response.respondent_id) filter (where response.quality_improved)::integer,
    count(distinct response.respondent_id) filter (where response.no_obvious_effect)::integer,
    bool_or(response.respondent_id = auth.uid() and response.efficiency_improved),
    bool_or(response.respondent_id = auth.uid() and response.quality_improved),
    bool_or(response.respondent_id = auth.uid() and response.no_obvious_effect)
  from public.skill_evaluation_campaigns campaign
  join public.skill_resources resource on resource.id = campaign.resource_id
  left join public.skill_evaluation_targets target on target.campaign_id = campaign.id
  left join public.skill_evaluation_responses response on response.campaign_id = campaign.id
  where public.dfws_can_manage_skill_resources()
     or resource.uploaded_by = auth.uid()
     or exists (select 1 from public.skill_evaluation_targets own_target where own_target.campaign_id = campaign.id and own_target.profile_id = auth.uid())
  group by campaign.id, campaign.resource_id, resource.title, campaign.closes_at, campaign.reminder_version
  order by campaign.created_at desc;
$$;

grant execute on function public.create_skill_evaluation_campaign(uuid, timestamptz) to authenticated;
grant execute on function public.upsert_skill_evaluation_response(uuid, boolean, boolean, boolean) to authenticated;
grant execute on function public.skill_evaluation_campaign_summaries() to authenticated;
