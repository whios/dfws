-- A partner may revise only their own returned result. The revision keeps the
-- same resource record and re-enters the review queue as pending.
drop policy if exists "DFWS scoped staff update skill resources" on public.skill_resources;

create policy "DFWS scoped staff and owners update skill resources"
  on public.skill_resources for update
  using (
    public.dfws_can_manage_skill_resource(skill_resources)
    or (uploaded_by = auth.uid() and status = 'rejected')
  )
  with check (
    public.dfws_can_manage_skill_resource(skill_resources)
    or (
      uploaded_by = auth.uid()
      and partner_id = (select partner_id from public.profiles where id = auth.uid())
      and status = 'pending'
    )
  );
