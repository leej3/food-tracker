create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create extension if not exists moddatetime;

do $$ begin
  create type public.food_access_level as enum ('admin', 'logger', 'viewer');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.food_entry_state as enum ('analysis_pending', 'review_needed', 'finalized', 'archived');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.nutrient_source as enum ('guessed', 'edited', 'verified', 'manual');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.ai_session_state as enum ('candidate', 'follow_up', 'ready_for_review', 'finalized', 'abandoned');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.meal_time as enum ('breakfast', 'lunch', 'dinner', 'snack', 'other');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.family_members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  canonical_slug text generated always as (lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) ) stored,
  is_active boolean not null default true,
  default_timezone text not null default 'America/New_York',
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default timezone('UTC', now()),
  updated_at timestamptz not null default timezone('UTC', now()),
  constraint family_members_name_not_empty check (length(trim(name)) > 0),
  constraint family_members_slug_not_empty check (length(trim(coalesce(canonical_slug, ''))) > 0)
);

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.food_access_level not null default 'logger',
  granted_by uuid not null default auth.uid(),
  created_at timestamptz not null default timezone('UTC', now()),
  updated_at timestamptz not null default timezone('UTC', now())
);

create table if not exists public.member_access (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.family_members(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  access_level public.food_access_level not null default 'logger',
  granted_by uuid not null default auth.uid(),
  created_at timestamptz not null default timezone('UTC', now()),
  updated_at timestamptz not null default timezone('UTC', now()),
  constraint member_access_unique_pair unique (member_id, user_id)
);

create table if not exists public.nutrient_definitions (
  code text primary key,
  name text not null,
  unit text not null,
  category text not null default 'macro',
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('UTC', now()),
  constraint nutrient_code_min_len check (length(trim(code)) > 2)
);

create table if not exists public.food_entries (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.family_members(id) on delete cascade,
  logged_by_user_id uuid not null default auth.uid(),
  photo_storage_path text,
  consumed_at timestamptz not null default timezone('UTC', date_trunc('minute', now())),
  item_name text not null,
  meal_type public.meal_time not null default 'other',
  serving_qty numeric not null default 1,
  serving_unit text not null default 'oz',
  workflow_state public.food_entry_state not null default 'analysis_pending',
  source_confidence numeric(5,4),
  source_label text,
  manual_notes text,
  created_at timestamptz not null default timezone('UTC', now()),
  updated_at timestamptz not null default timezone('UTC', now()),
  constraint food_entries_name_not_empty check (length(trim(item_name)) > 0),
  constraint food_entries_serving_qty_nonnegative check (serving_qty >= 0),
  constraint food_entries_source_confidence check (source_confidence is null or (source_confidence >= 0 and source_confidence <= 1)),
  constraint food_entries_minute_precision check (
    date_part('second', consumed_at AT TIME ZONE 'UTC') = 0
    and date_part('millisecond', consumed_at AT TIME ZONE 'UTC') = 0
    and date_part('microsecond', consumed_at AT TIME ZONE 'UTC') = 0
  )
);

create table if not exists public.food_entry_nutrients (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.food_entries(id) on delete cascade,
  nutrient_code text not null references public.nutrient_definitions(code),
  amount numeric not null check (amount >= 0),
  unit text not null,
  source public.nutrient_source not null default 'manual',
  source_confidence numeric(5,4) not null default 1,
  source_model text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default timezone('UTC', now()),
  updated_at timestamptz not null default timezone('UTC', now()),
  constraint food_entry_nutrients_source_confidence check (source_confidence between 0 and 1),
  constraint food_entry_nutrients_unit_not_empty check (length(trim(unit)) > 0),
  unique (entry_id, nutrient_code)
);

create table if not exists public.food_ai_sessions (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null unique references public.food_entries(id) on delete cascade,
  starter_user_id uuid not null default auth.uid(),
  current_round smallint not null default 1 check (current_round >= 1),
  state public.ai_session_state not null default 'candidate',
  model text not null default 'gpt-5.4-nano',
  overall_confidence numeric(5,4),
  clarifying_questions jsonb,
  created_at timestamptz not null default timezone('UTC', now()),
  updated_at timestamptz not null default timezone('UTC', now()),
  constraint food_ai_sessions_confidence check (overall_confidence is null or (overall_confidence >= 0 and overall_confidence <= 1))
);

create table if not exists public.food_ai_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.food_ai_sessions(id) on delete cascade,
  actor text not null check (actor in ('user', 'assistant')),
  payload jsonb not null,
  created_at timestamptz not null default timezone('UTC', now())
);

create table if not exists public.food_ai_candidates (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.food_ai_sessions(id) on delete cascade,
  position int not null check (position >= 1),
  item_name text not null,
  serving_qty numeric not null check (serving_qty > 0),
  serving_unit text not null,
  confidence numeric(5,4) not null default 0.5 check (confidence >= 0 and confidence <= 1),
  rationale text,
  payload jsonb not null,
  is_selected boolean not null default false,
  created_at timestamptz not null default timezone('UTC', now()),
  constraint food_ai_candidates_item_name_not_empty check (length(trim(item_name)) > 0),
  constraint food_ai_candidates_unit_not_empty check (length(trim(serving_unit)) > 0),
  unique (session_id, position)
);

create index if not exists family_members_name_trgm_idx on public.family_members using gin (canonical_slug gin_trgm_ops);
create index if not exists member_access_member_idx on public.member_access(member_id);
create index if not exists member_access_user_idx on public.member_access(user_id);
create index if not exists food_entries_member_time_idx on public.food_entries(member_id, consumed_at desc);
create index if not exists food_entries_name_trgm_idx on public.food_entries using gin (item_name gin_trgm_ops);
create index if not exists food_entry_nutrients_entry_idx on public.food_entry_nutrients(entry_id);
create index if not exists food_ai_candidates_session_idx on public.food_ai_candidates(session_id, is_selected);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = timezone('UTC', now());
  return new;
end;
$$;

create or replace function public.touch_updated_at_insert()
returns trigger language plpgsql as $$
begin
  new.created_at = timezone('UTC', now());
  new.updated_at = timezone('UTC', now());
  return new;
end;
$$;

create trigger family_members_touch_updated_at
  before update on public.family_members
  for each row
  execute function public.touch_updated_at();

create trigger user_roles_touch_updated_at
  before update on public.user_roles
  for each row
  execute function public.touch_updated_at();

create trigger member_access_touch_updated_at
  before update on public.member_access
  for each row
  execute function public.touch_updated_at();

create trigger food_entries_touch_updated_at
  before update on public.food_entries
  for each row
  execute function public.touch_updated_at();

create trigger food_entry_nutrients_touch_updated_at
  before update on public.food_entry_nutrients
  for each row
  execute function public.touch_updated_at();

create trigger food_ai_sessions_touch_updated_at
  before update on public.food_ai_sessions
  for each row
  execute function public.touch_updated_at();

create or replace function public.handle_new_user_role()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.user_roles (user_id, role, granted_by)
  values (new.id, 'logger', new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user_role();

create or replace function public.is_food_admin(p_user_id uuid default auth.uid())
returns boolean
language sql stable
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = p_user_id
      and role = 'admin'
  );
$$;

create or replace function public.can_access_member(
  p_user_id uuid,
  p_member_id uuid
)
returns boolean
language sql stable
as $$
  select coalesce(
    public.is_food_admin(p_user_id)
    or exists (
      select 1
      from public.member_access ma
      where ma.member_id = p_member_id
        and ma.user_id = p_user_id
        and ma.access_level in ('admin', 'logger')
    ),
    false
  );
$$;

create or replace function public.can_manage_member(
  p_user_id uuid,
  p_member_id uuid
)
returns boolean
language sql stable
as $$
  select coalesce(
    public.is_food_admin(p_user_id)
    or exists (
      select 1
      from public.member_access ma
      where ma.member_id = p_member_id
        and ma.user_id = p_user_id
        and ma.access_level = 'admin'
    ),
    false
  );
$$;

create or replace function public.can_modify_entry(
  p_user_id uuid,
  p_entry_id uuid
)
returns boolean
language sql stable
as $$
  select exists (
    select 1
    from public.food_entries e
    where e.id = p_entry_id
      and public.can_access_member(p_user_id, e.member_id)
      and (
        e.logged_by_user_id = p_user_id
        or public.can_manage_member(p_user_id, e.member_id)
      )
  );
$$;

create or replace function public.ensure_member_accesses()
returns trigger
language plpgsql
as $$
begin
  if new.access_level not in ('admin', 'logger', 'viewer') then
    raise exception 'invalid access level';
  end if;
  return new;
end;
$$;

create trigger member_access_validate
  before insert or update on public.member_access
  for each row
  execute function public.ensure_member_accesses();

create or replace function public.apply_food_entry_ai_candidate(
  p_entry_id uuid,
  p_candidate_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_entry public.food_entries%rowtype;
  v_candidate public.food_ai_candidates%rowtype;
  v_session public.food_ai_sessions%rowtype;
  v_item jsonb;
  v_nutrient_code text;
  v_nutrient_unit text;
  v_amount numeric;
  v_confidence numeric;
begin
  select * into v_entry from public.food_entries where id = p_entry_id for update;
  if not found then
    raise exception 'entry % not found', p_entry_id using errcode = 'P0002';
  end if;

  if not public.can_modify_entry(auth.uid(), v_entry.id) then
    raise exception 'not authorized to modify this food entry' using errcode = '42501';
  end if;

  select c.* into v_candidate
  from public.food_ai_candidates c
  where c.id = p_candidate_id
  and c.session_id in (
    select id
    from public.food_ai_sessions
    where entry_id = p_entry_id
  );

  if not found then
    raise exception 'candidate does not belong to this entry' using errcode = 'P0002';
  end if;

  select * into v_session
  from public.food_ai_sessions
  where id = v_candidate.session_id;

  update public.food_entries
  set item_name = v_candidate.item_name,
      serving_qty = v_candidate.serving_qty,
      serving_unit = v_candidate.serving_unit,
      workflow_state = 'review_needed',
      source_confidence = v_candidate.confidence,
      source_label = coalesce(v_session.model, 'gpt-5.4-nano'),
      updated_at = timezone('UTC', now())
  where id = v_entry.id;

  update public.food_ai_candidates
  set is_selected = false
  where session_id = v_session.id;

  update public.food_ai_candidates
  set is_selected = true
  where id = p_candidate_id;

  delete from public.food_entry_nutrients
  where entry_id = v_entry.id and source = 'guessed';

  for v_item in
    select value
    from jsonb_array_elements(coalesce(v_candidate.payload -> 'nutrients', '[]'::jsonb))
  loop
    v_nutrient_code := trim(lower(v_item ->> 'code'));
    v_amount := null;
    v_confidence := null;

    if v_nutrient_code = '' then
      continue;
    end if;

    begin
      if (v_item ->> 'amount') ~ '^-?\\d+(?:\\.\\d+)?$' then
        v_amount := (v_item ->> 'amount')::numeric;
      end if;
    exception
      when invalid_text_representation then
        v_amount := null;
    end;

    if v_amount is null or v_amount < 0 then
      continue;
    end if;

    if not exists (select 1 from public.nutrient_definitions nd where nd.code = v_nutrient_code) then
      continue;
    end if;

    v_nutrient_unit := trim(v_item ->> 'unit');
    if v_nutrient_unit = '' then
      select nd.unit into v_nutrient_unit from public.nutrient_definitions nd where nd.code = v_nutrient_code;
    end if;

    begin
      v_confidence := null;
      if (v_item ->> 'confidence') ~ '^0?\\.?\\d+(?:\\.\\d+)?$' then
        v_confidence := (v_item ->> 'confidence')::numeric;
      end if;
    exception
      when invalid_text_representation then
        v_confidence := null;
    end;

    insert into public.food_entry_nutrients (
      entry_id,
      nutrient_code,
      amount,
      unit,
      source,
      source_confidence,
      source_model,
      created_by,
      updated_at,
      created_at
    )
    values (
      v_entry.id,
      v_nutrient_code,
      v_amount,
      v_nutrient_unit,
      'guessed',
      coalesce(v_confidence, v_candidate.confidence, 0.5),
      coalesce(v_session.model, 'gpt-5.4-nano'),
      auth.uid(),
      timezone('UTC', now()),
      timezone('UTC', now())
    )
    on conflict (entry_id, nutrient_code)
    do update set
      amount = excluded.amount,
      unit = excluded.unit,
      source = excluded.source,
      source_confidence = excluded.source_confidence,
      source_model = excluded.source_model,
      updated_at = excluded.updated_at;
  end loop;

  update public.food_ai_sessions
  set state = 'ready_for_review', updated_at = timezone('UTC', now())
  where id = v_session.id;

  return v_entry.id;
end;
$$;

create or replace function public.finalize_food_entry(p_entry_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.can_modify_entry(auth.uid(), p_entry_id) then
    raise exception 'not authorized to finalize this food entry' using errcode = '42501';
  end if;

  update public.food_entries
  set workflow_state = 'finalized', updated_at = timezone('UTC', now())
  where id = p_entry_id;

  return p_entry_id;
end;
$$;

create or replace function public.get_nutrients_for_entry(p_entry_id uuid)
returns table (
  nutrient_code text,
  amount numeric,
  unit text,
  source public.nutrient_source,
  source_confidence numeric
)
language sql
stable
as $$
  select
    en.nutrient_code,
    en.amount,
    en.unit,
    en.source,
    en.source_confidence
  from public.food_entry_nutrients en
  where en.entry_id = p_entry_id;
$$;

alter table public.family_members enable row level security;
alter table public.user_roles enable row level security;
alter table public.member_access enable row level security;
alter table public.nutrient_definitions enable row level security;
alter table public.food_entries enable row level security;
alter table public.food_entry_nutrients enable row level security;
alter table public.food_ai_sessions enable row level security;
alter table public.food_ai_messages enable row level security;
alter table public.food_ai_candidates enable row level security;

-- Public users should not read definitions directly but app is authenticated only.
create policy nutrient_definitions_select
  on public.nutrient_definitions
  for select
  using (auth.role() = 'authenticated');

create policy family_members_select
  on public.family_members
  for select
  using (public.can_access_member(auth.uid(), id));

create policy family_members_insert
  on public.family_members
  for insert
  with check (public.is_food_admin(auth.uid()));

create policy family_members_update
  on public.family_members
  for update
  using (public.can_manage_member(auth.uid(), id))
  with check (public.can_manage_member(auth.uid(), id));

create policy family_members_delete
  on public.family_members
  for delete
  using (public.is_food_admin(auth.uid()));

create policy user_roles_select
  on public.user_roles
  for select
  using (user_id = auth.uid() or public.is_food_admin(auth.uid()));

create policy user_roles_update
  on public.user_roles
  for update
  using (public.is_food_admin(auth.uid()))
  with check (public.is_food_admin(auth.uid()));

create policy member_access_select
  on public.member_access
  for select
  using (
    user_id = auth.uid()
    or public.can_manage_member(auth.uid(), member_id)
    or public.is_food_admin(auth.uid())
  );

create policy member_access_insert
  on public.member_access
  for insert
  with check (public.is_food_admin(auth.uid()) or public.can_manage_member(auth.uid(), member_id));

create policy member_access_update
  on public.member_access
  for update
  using (public.is_food_admin(auth.uid()) or public.can_manage_member(auth.uid(), member_id))
  with check (public.is_food_admin(auth.uid()) or public.can_manage_member(auth.uid(), member_id));

create policy member_access_delete
  on public.member_access
  for delete
  using (public.is_food_admin(auth.uid()) or public.can_manage_member(auth.uid(), member_id));

create policy food_entries_select
  on public.food_entries
  for select
  using (public.can_access_member(auth.uid(), member_id));

create policy food_entries_insert
  on public.food_entries
  for insert
  with check (public.can_access_member(auth.uid(), member_id));

create policy food_entries_update
  on public.food_entries
  for update
  using (public.can_modify_entry(auth.uid(), id))
  with check (public.can_modify_entry(auth.uid(), id));

create policy food_entries_delete
  on public.food_entries
  for delete
  using (public.can_modify_entry(auth.uid(), id));

create policy food_entry_nutrients_select
  on public.food_entry_nutrients
  for select
  using (
    exists (
      select 1
      from public.food_entries e
      where e.id = food_entry_nutrients.entry_id
        and public.can_access_member(auth.uid(), e.member_id)
    )
  );

create policy food_entry_nutrients_insert
  on public.food_entry_nutrients
  for insert
  with check (
    exists (
      select 1
      from public.food_entries e
      where e.id = food_entry_nutrients.entry_id
        and public.can_modify_entry(auth.uid(), e.id)
    )
  );

create policy food_entry_nutrients_update
  on public.food_entry_nutrients
  for update
  using (
    exists (
      select 1
      from public.food_entries e
      where e.id = food_entry_nutrients.entry_id
        and public.can_modify_entry(auth.uid(), e.id)
    )
  )
  with check (
    exists (
      select 1
      from public.food_entries e
      where e.id = food_entry_nutrients.entry_id
        and public.can_modify_entry(auth.uid(), e.id)
    )
  );

create policy food_entry_nutrients_delete
  on public.food_entry_nutrients
  for delete
  using (
    exists (
      select 1
      from public.food_entries e
      where e.id = food_entry_nutrients.entry_id
        and public.can_modify_entry(auth.uid(), e.id)
    )
  );

create policy food_ai_sessions_select
  on public.food_ai_sessions
  for select
  using (
    exists (
      select 1
      from public.food_entries e
      where e.id = food_ai_sessions.entry_id
        and public.can_access_member(auth.uid(), e.member_id)
    )
  );

create policy food_ai_sessions_insert
  on public.food_ai_sessions
  for insert
  with check (
    exists (
      select 1
      from public.food_entries e
      where e.id = food_ai_sessions.entry_id
        and public.can_access_member(auth.uid(), e.member_id)
    )
  );

create policy food_ai_sessions_update
  on public.food_ai_sessions
  for update
  using (
    exists (
      select 1
      from public.food_entries e
      where e.id = food_ai_sessions.entry_id
        and public.can_modify_entry(auth.uid(), e.id)
    )
  )
  with check (
    exists (
      select 1
      from public.food_entries e
      where e.id = food_ai_sessions.entry_id
        and public.can_modify_entry(auth.uid(), e.id)
    )
  );

create policy food_ai_messages_select
  on public.food_ai_messages
  for select
  using (
    exists (
      select 1
      from public.food_ai_sessions s
      join public.food_entries e on e.id = s.entry_id
      where s.id = food_ai_messages.session_id
        and public.can_access_member(auth.uid(), e.member_id)
    )
  );

create policy food_ai_messages_insert
  on public.food_ai_messages
  for insert
  with check (
    exists (
      select 1
      from public.food_ai_sessions s
      join public.food_entries e on e.id = s.entry_id
      where s.id = food_ai_messages.session_id
        and public.can_access_member(auth.uid(), e.member_id)
    )
  );

create policy food_ai_candidates_select
  on public.food_ai_candidates
  for select
  using (
    exists (
      select 1
      from public.food_ai_sessions s
      join public.food_entries e on e.id = s.entry_id
      where s.id = food_ai_candidates.session_id
        and public.can_access_member(auth.uid(), e.member_id)
    )
  );

create policy food_ai_candidates_insert
  on public.food_ai_candidates
  for insert
  with check (
    exists (
      select 1
      from public.food_ai_sessions s
      join public.food_entries e on e.id = s.entry_id
      where s.id = food_ai_candidates.session_id
        and public.can_modify_entry(auth.uid(), e.id)
    )
  );

create policy food_ai_candidates_update
  on public.food_ai_candidates
  for update
  using (
    exists (
      select 1
      from public.food_ai_sessions s
      join public.food_entries e on e.id = s.entry_id
      where s.id = food_ai_candidates.session_id
        and public.can_modify_entry(auth.uid(), e.id)
    )
  )
  with check (
    exists (
      select 1
      from public.food_ai_sessions s
      join public.food_entries e on e.id = s.entry_id
      where s.id = food_ai_candidates.session_id
        and public.can_modify_entry(auth.uid(), e.id)
    )
  );

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'food-photos',
  'food-photos',
  false,
  52428800,
  array['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do nothing;

create policy food_photos_upload
  on storage.objects
  for insert
  with check (
    bucket_id = 'food-photos'
    and auth.role() = 'authenticated'
  );

create policy food_photos_select
  on storage.objects
  for select
  using (
    bucket_id = 'food-photos'
    and auth.role() = 'authenticated'
  );

create policy food_photos_update
  on storage.objects
  for update
  using (
    bucket_id = 'food-photos'
    and auth.role() = 'authenticated'
  )
  with check (bucket_id = 'food-photos' and auth.role() = 'authenticated');

create policy food_photos_delete
  on storage.objects
  for delete
  using (
    bucket_id = 'food-photos'
    and auth.role() = 'authenticated'
  );

insert into public.nutrient_definitions (code, name, unit, category, sort_order) values
('calories', 'Calories', 'kcal', 'macro', 10),
('protein_g', 'Protein', 'g', 'macro', 20),
('total_fat_g', 'Fat', 'g', 'macro', 30),
('saturated_fat_g', 'Saturated Fat', 'g', 'macro', 31),
('trans_fat_g', 'Trans Fat', 'g', 'macro', 32),
('carbs_g', 'Carbohydrates', 'g', 'macro', 40),
('fiber_g', 'Fiber', 'g', 'micro', 50),
('sugar_g', 'Total Sugars', 'g', 'micro', 60),
('added_sugar_g', 'Added Sugars', 'g', 'micro', 61),
('sodium_mg', 'Sodium', 'mg', 'micro', 70),
('potassium_mg', 'Potassium', 'mg', 'micro', 80),
('alcohol_g', 'Alcohol', 'g', 'macro', 90),
('vitamin_b12_ug', 'Vitamin B12', 'mcg', 'micro', 100),
('cholesterol_mg', 'Cholesterol', 'mg', 'micro', 110),
('calcium_mg', 'Calcium', 'mg', 'micro', 120)
on conflict (code) do nothing;
