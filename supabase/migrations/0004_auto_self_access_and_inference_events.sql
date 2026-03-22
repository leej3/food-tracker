create or replace function public.sanitize_member_name(p_email text)
returns text
language sql
immutable
as $$
  select initcap(
    trim(
      regexp_replace(
        split_part(lower(coalesce(p_email, 'self')), '@', 1),
        '[^a-z0-9]+',
        ' ',
        'g'
      )
    )
  );
$$;

create table if not exists public.food_ai_inference_events (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.food_entries(id) on delete cascade,
  session_id uuid references public.food_ai_sessions(id) on delete set null,
  actor_user_id uuid not null,
  inference_provider text not null,
  model text not null,
  path text not null,
  candidate_count integer not null default 0 check (candidate_count >= 0),
  overall_confidence numeric(5,4),
  notes jsonb,
  created_at timestamptz not null default timezone('UTC', now()),
  constraint food_ai_inference_events_provider check (length(trim(inference_provider)) > 0),
  constraint food_ai_inference_events_path check (path in ('shadow', 'shadow_fallback_to_openai', 'openai')),
  constraint food_ai_inference_events_confidence check (
    overall_confidence is null or (overall_confidence >= 0 and overall_confidence <= 1)
  )
);

create index if not exists food_ai_inference_events_entry_idx on public.food_ai_inference_events (entry_id, created_at desc);
create index if not exists food_ai_inference_events_session_idx on public.food_ai_inference_events (session_id, created_at desc);

alter table public.food_ai_inference_events enable row level security;

create policy food_ai_inference_events_admin
  on public.food_ai_inference_events
  for all
  using (public.is_food_admin(auth.uid()))
  with check (public.is_food_admin(auth.uid()));

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user_role();

create or replace function public.handle_new_user_role()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_name text;
  v_member_id uuid;
begin
  insert into public.user_roles (user_id, role, granted_by)
    values (new.id, 'logger', new.id)
    on conflict (user_id) do nothing;

  v_name := public.sanitize_member_name(new.email);
  if v_name is null or length(v_name) = 0 then
    v_name := 'Self';
  end if;

  insert into public.family_members (name, created_by)
    values (v_name, new.id)
    returning id into v_member_id;

  insert into public.member_access (member_id, user_id, access_level, granted_by)
    values (v_member_id, new.id, 'logger', new.id)
    on conflict (member_id, user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user_role();

do $$
declare
  v_user record;
  v_member_id uuid;
  v_name text;
begin
  for v_user in
    select id, email
    from auth.users
  loop
    if not exists (
      select 1
      from public.member_access ma
      join public.family_members fm on fm.id = ma.member_id
      where ma.user_id = v_user.id
        and fm.created_by = v_user.id
    ) then
      v_name := public.sanitize_member_name(v_user.email);
      if v_name is null or length(v_name) = 0 then
        v_name := 'Self';
      end if;

      insert into public.family_members (name, created_by)
        values (v_name, v_user.id)
        returning id into v_member_id;

      insert into public.member_access (member_id, user_id, access_level, granted_by)
        values (v_member_id, v_user.id, 'logger', v_user.id);
    end if;
  end loop;
end;
$$ language plpgsql;
