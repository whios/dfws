-- Restore names accidentally serialized as "[object Object]" by the former
-- personnel-edit request contract. The latest audit log retains the prior name.
with recoverable_profiles as (
  select distinct on (log.target_id)
    log.target_id as profile_id,
    btrim(log.details->>'previousName') as previous_name
  from public.operation_audit_logs log
  join public.profiles profile on profile.id = log.target_id
  where log.target_type = 'profile'
    and profile.display_name = '[object Object]'
    and coalesce(btrim(log.details->>'previousName'), '') <> ''
  order by log.target_id, log.created_at desc
), restored_profiles as (
  update public.profiles profile
  set display_name = recovered.previous_name
  from recoverable_profiles recovered
  where profile.id = recovered.profile_id
  returning profile.id, profile.partner_id, recovered.previous_name
), restored_partners as (
  update public.partners partner
  set owner_name = restored.previous_name
  from restored_profiles restored
  where partner.id = restored.partner_id
    and partner.owner_name = '[object Object]'
  returning partner.id, restored.previous_name
)
update public.assets asset
set owner_name = restored.previous_name
from restored_partners restored
where asset.partner_id = restored.id
  and asset.owner_name = '[object Object]';

update public.organization_people person
set display_name = partner.owner_name,
    updated_at = now()
from public.partners partner
where person.partner_id = partner.id
  and person.display_name = '[object Object]';
