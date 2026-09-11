-- ============================================================================
-- leads table
--
-- Contact-form submissions, classified by an LLM.
-- Only the service_role key (the Edge Function) can reach this table.
-- The anon and authenticated roles can neither read nor write it.
-- ============================================================================

create table if not exists public.leads (
    id         uuid        primary key default gen_random_uuid(),
    name       text        not null,
    email      text        not null unique,
    company    text,
    message    text        not null,
    category   text        not null,
    priority   integer     not null,
    summary    text,
    classified boolean     not null default true,
    created_at timestamptz not null default now(),

    -- The allowed priorities are enforced here too, not only in the code.
    constraint leads_priority_check check (priority in (1, 2, 3))
);

comment on table  public.leads            is 'Contact-form leads, classified by an LLM.';
comment on column public.leads.category   is 'arajanlat | hibabejelentes | altalanos | ismeretlen';
comment on column public.leads.priority   is '1 = urgent, 2 = normal, 3 = low';
comment on column public.leads.classified is 'false when LLM classification failed and fallback values were stored';

-- Leads are typically listed newest-first.
create index if not exists leads_created_at_idx on public.leads (created_at desc);

-- ----------------------------------------------------------------------------
-- Access control
-- ----------------------------------------------------------------------------

-- 1) RLS on, with no policies on purpose. With RLS on and no policy every
--    non-privileged role sees zero rows and cannot write. The service_role
--    key has BYPASSRLS, so the Edge Function still works.
alter table public.leads enable row level security;

-- 2) Supabase grants table-level rights to anon / authenticated by default,
--    so revoke those as well. With them gone a request made with the anon key
--    fails with a permission error instead of returning an empty list.
revoke all on table public.leads from anon, authenticated;
