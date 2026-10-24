-- =====================================================================
-- 0002: staff, customer profiles, addresses, delivery, carts
-- =====================================================================

create table staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role staff_role not null,
  full_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  phone text check (phone ~ '^\+[1-9][0-9]{7,14}$'),  -- E.164, e.g. +233...
  phone_verified_at timestamptz,
  sms_marketing_consent boolean not null default false,
  email_marketing_consent boolean not null default false,
  consent_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Create a profile automatically for every new auth user.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_phone text;
begin
  v_phone := case
    when new.phone ~ '^[0-9]{8,15}$' then '+' || new.phone
    when new.phone ~ '^\+[1-9][0-9]{7,14}$' then new.phone
    else null end;
  insert into profiles (id, full_name, email, phone)
  values (new.id,
          nullif(new.raw_user_meta_data ->> 'full_name', ''),
          new.email,
          v_phone)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

create table addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  label text,                                         -- Home, Work
  recipient_name text not null,
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  region text not null,
  town text not null,
  street_landmark text not null,                      -- landmark-based directions
  digital_address text,                               -- GhanaPost, optional
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index one_default_address on addresses (user_id) where is_default;

create table delivery_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  regions text[] not null,                            -- regions this zone covers
  fee_pesewas int not null check (fee_pesewas >= 0),
  free_over_pesewas int check (free_over_pesewas >= 0),
  eta_min_days int not null default 1,
  eta_max_days int not null default 3,
  is_active boolean not null default true
);

create table pickup_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  phone text,
  hours text,
  is_active boolean not null default true
);

create table carts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  guest_token text unique,                            -- random value in an httpOnly cookie
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_id is not null or guest_token is not null)
);
create index carts_user_idx on carts (user_id);

create table cart_items (
  cart_id uuid not null references carts(id) on delete cascade,
  variant_id uuid not null references product_variants(id),
  quantity int not null check (quantity between 1 and 20),
  added_at timestamptz not null default now(),
  primary key (cart_id, variant_id)
);

do $$
declare t text;
begin
  foreach t in array array['profiles', 'addresses', 'carts']
  loop
    execute format(
      'create trigger trg_%1$s_updated before update on %1$I
         for each row execute function set_updated_at()', t);
  end loop;
end $$;
