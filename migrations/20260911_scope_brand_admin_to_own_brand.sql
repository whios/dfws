-- Brand administrators can manage only resources that belong to the brand of
-- their bound partner profile. Managers and AI officers remain global staff.
-- Apply this migration before deploying the matching frontend release.

create or replace function public.dfws_is_global_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('manager', 'ai_officer')
  );
$$;

create or replace function public.dfws_current_staff_brand()
returns text
language sql 
stable
security definer
set search_path = public
as $$
  select partner.brand
  from public.profiles profile
  join public.partners partner on partner.id = profile.partner_id
  where profile.id = auth.uid()
    and profile.role = 'brand_admin'
  limit 1;
$$;

create or replace function public.dfws_can_manage_brand(target_brand text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.dfws_is_global_staff()
    or public.dfws_current_staff_brand() = target_brand;
$$;

create or replace function public.dfws_can_manage_skill_resource(resource public.skill_resources)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.partners partner
    where partner.id = resource.partner_id
      and public.dfws_can_manage_brand(partner.brand)
  );
$$;

-- Keep this function name because earlier migrations and RPCs use it. It now
-- means "has a valid staff scope", while per-resource operations must call the
-- resource-aware function above.
create or replace function public.dfws_can_manage_skill_resources()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.dfws_is_global_staff() or public.dfws_current_staff_brand() is not null;
$$;

create or replace function public.dfws_can_read_skill_resource(resource public.skill_resources)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.dfws_can_manage_skill_resource(resource)
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

drop policy if exists "DFWS managers update skill resources" on public.skill_resources;
create policy "DFWS scoped staff update skill resources"
  on public.skill_resources for update
  using (public.dfws_can_manage_skill_resource(skill_resources))
  with check (public.dfws_can_manage_skill_resource(skill_resources));

drop policy if exists "DFWS managers delete skill resources" on public.skill_resources;
create policy "DFWS scoped staff delete skill resources"
  on public.skill_resources for delete
  using (public.dfws_can_manage_skill_resource(skill_resources));

-- Evaluation campaigns follow the same scope as the reviewed resource.
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
  select * into resource from public.skill_resources where id = $1;
  if not found or resource.status <> 'published' or not public.dfws_can_manage_skill_resource(resource) then
    raise exception '当前账号没有发起该成果效果评价的权限。';
  end if;
  if closes_at <= now() then raise exception '评价截止时间必须晚于当前时间。'; end if;

  select id into campaign_id from public.skill_evaluation_campaigns
  where campaign.resource_id = resource.id and campaign.closes_at >= now()
  order by created_at desc limit 1;

  if found then
    insert into public.skill_evaluation_targets(campaign_id, profile_id)
    select campaign_id, candidate.profile_id
    from (
      select distinct download.downloaded_by as profile_id from public.skill_downloads download where download.resource_id = resource.id
      union
      select distinct access.opened_by as profile_id from public.skill_resource_accesses access where access.resource_id = resource.id
    ) candidate
    join public.profiles profile on profile.id = candidate.profile_id and profile.role = 'partner'
    where candidate.profile_id <> resource.uploaded_by
    on conflict (campaign_id, profile_id) do nothing;

    select count(*) into reminder_count from public.skill_evaluation_targets target
    where target.campaign_id = campaign_id and not exists (
      select 1 from public.skill_evaluation_responses response
      where response.campaign_id = campaign_id and response.respondent_id = target.profile_id
    );
    if reminder_count = 0 then raise exception '本轮评价的伙伴均已完成，无需再次提醒。'; end if;
    update public.skill_evaluation_campaigns set reminder_version = reminder_version + 1 where id = campaign_id;
    update public.skill_evaluation_targets target set notified_at = now()
    where target.campaign_id = campaign_id and not exists (
      select 1 from public.skill_evaluation_responses response
      where response.campaign_id = campaign_id and response.respondent_id = target.profile_id
    );
    insert into public.notifications(recipient_id, skill_resource_id, kind, title, body)
    select target.profile_id, resource.id, 'skill_evaluation', '请补充评价近期使用成果',
      format('成果《%s》仍在等待你的效果评价，请在 %s 前勾选本次使用是否提效、提质或暂无明显效果。', resource.title, to_char($2 at time zone 'Asia/Shanghai', 'YYYY-MM-DD'))
    from public.skill_evaluation_targets target
    where target.campaign_id = campaign_id and not exists (
      select 1 from public.skill_evaluation_responses response
      where response.campaign_id = campaign_id and response.respondent_id = target.profile_id
    );
    return jsonb_build_object('action', 'reminded', 'targetCount', reminder_count);
  end if;

  insert into public.skill_evaluation_campaigns(resource_id, created_by, closes_at)
  values (resource.id, auth.uid(), $2) returning id into campaign_id;
  insert into public.skill_evaluation_targets(campaign_id, profile_id)
  select campaign_id, candidate.profile_id
  from (
    select distinct download.downloaded_by as profile_id from public.skill_downloads download where download.resource_id = resource.id
    union
    select distinct access.opened_by as profile_id from public.skill_resource_accesses access where access.resource_id = resource.id
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
  from public.skill_evaluation_targets target where target.campaign_id = campaign_id;
  return jsonb_build_object('action', 'created', 'targetCount', target_count);
end;
$$;

create or replace function public.skill_evaluation_campaign_summaries()
returns table (
  id uuid, resource_id uuid, resource_title text, closes_at timestamptz,
  reminder_version integer, target_count integer, response_count integer,
  efficiency_count integer, quality_count integer, no_effect_count integer,
  my_efficiency_improved boolean, my_quality_improved boolean, my_no_obvious_effect boolean
)
language sql stable security definer set search_path = public
as $$
  select campaign.id, campaign.resource_id, resource.title, campaign.closes_at, campaign.reminder_version,
    count(distinct target.profile_id)::integer, count(distinct response.respondent_id)::integer,
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
  where public.dfws_can_manage_skill_resource(resource)
     or resource.uploaded_by = auth.uid()
     or exists (select 1 from public.skill_evaluation_targets own_target where own_target.campaign_id = campaign.id and own_target.profile_id = auth.uid())
  group by campaign.id, campaign.resource_id, resource.title, campaign.closes_at, campaign.reminder_version
  order by campaign.created_at desc;
$$;
