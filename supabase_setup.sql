-- Top Daily Tips: Supabase setup (profiles, offers, access control, public preview)
-- Run in Supabase SQL Editor as ONE script.

-- 1) Profiles table (created if missing, upgraded if it already exists)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'free',
  trial_ends_at timestamptz,
  subscription_ends_at timestamptz,
  offer_chosen text,
  intro_price_used boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_self_check check (id = auth.uid())
);

-- If you already had an older profiles table, make sure the new columns exist
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists role text;
alter table public.profiles alter column role set default 'free';
alter table public.profiles add column if not exists trial_ends_at timestamptz;
alter table public.profiles add column if not exists subscription_ends_at timestamptz;
alter table public.profiles add column if not exists offer_chosen text;
alter table public.profiles add column if not exists intro_price_used boolean;
alter table public.profiles alter column intro_price_used set default false;
alter table public.profiles add column if not exists created_at timestamptz;
alter table public.profiles add column if not exists updated_at timestamptz;

-- updated_at helper + trigger
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- 2) RLS for profiles (users can read/update their own row)
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
to authenticated
using (id = auth.uid());

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- 3) Offers / claims tables
create table if not exists public.trial_claims (
  user_id uuid primary key references auth.users(id) on delete cascade,
  claimed_at timestamptz not null default now()
);

create table if not exists public.promo_claims (
  user_id uuid primary key references auth.users(id) on delete cascade,
  claimed_at timestamptz not null default now()
);

-- Optional: track who took the £5 intro month (first 50 users)
create table if not exists public.intro_claims (
  user_id uuid primary key references auth.users(id) on delete cascade,
  claimed_at timestamptz not null default now()
);

alter table public.trial_claims enable row level security;
alter table public.promo_claims enable row level security;
alter table public.intro_claims enable row level security;

-- Users can only see/insert their own claim rows
do $$
begin
  -- trial_claims
  execute 'drop policy if exists "trial_claims_select_own" on public.trial_claims';
  execute 'create policy "trial_claims_select_own" on public.trial_claims for select to authenticated using (user_id = auth.uid())';
  execute 'drop policy if exists "trial_claims_insert_own" on public.trial_claims';
  execute 'create policy "trial_claims_insert_own" on public.trial_claims for insert to authenticated with check (user_id = auth.uid())';

  -- promo_claims
  execute 'drop policy if exists "promo_claims_select_own" on public.promo_claims';
  execute 'create policy "promo_claims_select_own" on public.promo_claims for select to authenticated using (user_id = auth.uid())';
  execute 'drop policy if exists "promo_claims_insert_own" on public.promo_claims';
  execute 'create policy "promo_claims_insert_own" on public.promo_claims for insert to authenticated with check (user_id = auth.uid())';

  -- intro_claims
  execute 'drop policy if exists "intro_claims_select_own" on public.intro_claims';
  execute 'create policy "intro_claims_select_own" on public.intro_claims for select to authenticated using (user_id = auth.uid())';
  execute 'drop policy if exists "intro_claims_insert_own" on public.intro_claims';
  execute 'create policy "intro_claims_insert_own" on public.intro_claims for insert to authenticated with check (user_id = auth.uid())';
end $$;

-- 4) Access helpers
create or replace function public.has_active_access(p_user uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user
      and (
        (p.trial_ends_at is not null and p.trial_ends_at > now())
        or
        (p.subscription_ends_at is not null and p.subscription_ends_at > now())
      )
  );
$$;

-- 5) RPC: claim 5-day free trial (available to everyone once)
create or replace function public.claim_trial()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    return json_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  -- Ensure profile exists
  insert into public.profiles (id, email)
  values (uid, (select email from auth.users where id = uid))
  on conflict (id) do update set email = excluded.email;

  -- Only allow once
  insert into public.trial_claims (user_id) values (uid)
  on conflict (user_id) do nothing;

  if not found then
    return json_build_object('ok', false, 'error', 'already_claimed');
  end if;

  update public.profiles
    set trial_ends_at = now() + interval '5 days'
  where id = uid;

  return json_build_object('ok', true, 'trial_ends_at', (select trial_ends_at from public.profiles where id = uid));
end;
$$;

-- 6) RPC: claim £5 first-month promo (first 50 people)
-- (This just reserves the promo slot. Your payment flow still needs to actually take payment and set subscription_ends_at.)
create or replace function public.claim_intro_offer()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  taken int;
begin
  if uid is null then
    return json_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select count(*) into taken from public.intro_claims;

  if taken >= 50 then
    return json_build_object('ok', false, 'error', 'sold_out');
  end if;

  insert into public.intro_claims (user_id) values (uid)
  on conflict (user_id) do nothing;

  if not found then
    return json_build_object('ok', false, 'error', 'already_claimed');
  end if;

  update public.profiles
    set offer_chosen = 'intro_5_first_month',
        intro_price_used = true
  where id = uid;

  return json_build_object('ok', true, 'remaining', greatest(0, 50 - (taken + 1)));
end;
$$;

-- 7) Protect value_bets_feed (it was showing as UNRESTRICTED in your screenshot)
-- Subscribers (trial or paid) can read the full table. Everyone else must use the public RPC.
alter table public.value_bets_feed enable row level security;

drop policy if exists "value_bets_feed_select_with_access" on public.value_bets_feed;
create policy "value_bets_feed_select_with_access"
on public.value_bets_feed for select
to authenticated
using (public.has_active_access(auth.uid()));

-- Optional: block anon reads entirely (recommended)
revoke all on table public.value_bets_feed from anon;

-- 8) Public RPC to fetch the first 10 bets for a given day (no login)
create or replace function public.get_public_value_bets(p_date date, p_limit int default 10)
returns setof public.value_bets_feed
language sql
security definer
set search_path = public
as $$
  select *
  from public.value_bets_feed
  where (bet_date::date = p_date)
  order by created_at asc
  limit least(p_limit, 10);
$$;

-- Done.
