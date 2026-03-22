create table if not exists public.user_directory (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  created_at timestamptz not null default timezone('UTC', now())
);

alter table public.user_directory enable row level security;

create or replace function public.sync_user_directory()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.user_directory (user_id, email)
  values (new.id, lower(new.email))
  on conflict (user_id) do update set email = lower(new.email), created_at = timezone('UTC', now());

  return new;
end;
$$;

drop trigger if exists user_directory_sync on auth.users;
create trigger user_directory_sync
  after insert or update of email on auth.users
  for each row
  when (new.email is not null)
  execute function public.sync_user_directory();

insert into public.user_directory (user_id, email)
select id, lower(email) from auth.users
where email is not null
on conflict (user_id) do update
  set email = excluded.email;

create policy user_directory_select
  on public.user_directory
  for select
  using (public.is_food_admin(auth.uid()));

create or replace function public.search_user_directory(p_search text)
returns table (user_id uuid, email text)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_food_admin(auth.uid()) then
    return;
  end if;

  return query
    select ud.user_id, ud.email
    from public.user_directory ud
    where ud.email like ('%' || lower(p_search) || '%')
    order by ud.email
    limit 20;
end;
$$;
