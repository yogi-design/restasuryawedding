-- Run this SQL in Supabase Dashboard > SQL Editor.
-- Public users can submit RSVP and wishes; public reads are allowed only for wishes.
-- Do not place a Supabase service-role key in the browser.

create extension if not exists pgcrypto;

create table if not exists public.wedding_rsvps (
  id uuid primary key default gen_random_uuid(),
  guest_name text not null check (char_length(guest_name) between 1 and 100),
  attendance text not null check (attendance in ('Hadir', 'Tidak hadir', 'Belum pasti')),
  guest_count integer not null default 0 check (guest_count between 0 and 4),
  message text check (message is null or char_length(message) <= 500),
  created_at timestamptz not null default now()
);

create table if not exists public.wedding_wishes (
  id uuid primary key default gen_random_uuid(),
  guest_name text not null check (char_length(guest_name) between 1 and 100),
  message text not null check (char_length(message) between 1 and 700),
  created_at timestamptz not null default now()
);

create table if not exists public.wedding_gift_accounts (
  id integer primary key check (id = 1),
  bank_name text,
  account_number text not null,
  account_name text not null,
  updated_at timestamptz not null default now()
);

insert into public.wedding_gift_accounts (id, bank_name, account_number, account_name)
values (1, 'BCA', '1482351390', 'Resta Syahwa Hafidza')
on conflict (id) do nothing;

update public.wedding_gift_accounts
set bank_name = 'BCA'
where id = 1 and (bank_name is null or trim(bank_name) = '');

alter table public.wedding_rsvps enable row level security;
alter table public.wedding_wishes enable row level security;
alter table public.wedding_gift_accounts enable row level security;

-- RSVP: allow anonymous inserts only; do not expose RSVP list to the public.
drop policy if exists "Anyone can submit RSVP" on public.wedding_rsvps;
create policy "Anyone can submit RSVP" on public.wedding_rsvps
  for insert to anon, authenticated with check (
    char_length(trim(guest_name)) between 1 and 100
    and attendance in ('Hadir', 'Tidak hadir', 'Belum pasti')
    and guest_count between 0 and 4
    and (message is null or char_length(message) <= 500)
  );

-- Wishes: public can read and submit messages. Content is rendered as text in React.
drop policy if exists "Anyone can read wishes" on public.wedding_wishes;
create policy "Anyone can read wishes" on public.wedding_wishes
  for select to anon, authenticated using (true);
drop policy if exists "Anyone can submit wishes" on public.wedding_wishes;
create policy "Anyone can submit wishes" on public.wedding_wishes
  for insert to anon, authenticated with check (
    char_length(trim(guest_name)) between 1 and 100
    and char_length(trim(message)) between 1 and 700
  );

drop policy if exists "Anyone can read wedding gift account" on public.wedding_gift_accounts;
create policy "Anyone can read wedding gift account" on public.wedding_gift_accounts
  for select to anon, authenticated using (true);

grant insert on public.wedding_rsvps to anon, authenticated;
grant select, insert on public.wedding_wishes to anon, authenticated;
grant select on public.wedding_gift_accounts to anon, authenticated;

-- Submit both records in one database transaction when Supabase is the active backend.
create or replace function public.submit_wedding_rsvp_and_wish(
  p_guest_name text,
  p_attendance text,
  p_guest_count integer,
  p_message text
)
returns table (id uuid, guest_name text, message text)
language plpgsql
as $$
declare
  clean_name text := trim(p_guest_name);
  clean_message text := trim(p_message);
  wish_id uuid := gen_random_uuid();
begin
  if clean_name is null or char_length(clean_name) not between 1 and 100 then
    raise exception 'Nama wajib diisi dan maksimal 100 karakter.' using errcode = '22023';
  end if;
  if p_attendance is null or p_attendance not in ('Hadir', 'Tidak hadir', 'Belum pasti') then
    raise exception 'Pilihan kehadiran tidak valid.' using errcode = '22023';
  end if;
  if p_guest_count is null
     or (p_attendance = 'Hadir' and p_guest_count not between 1 and 4)
     or (p_attendance <> 'Hadir' and p_guest_count <> 0) then
    raise exception 'Jumlah tamu tidak valid.' using errcode = '22023';
  end if;
  if clean_message is null or char_length(clean_message) not between 1 and 500 then
    raise exception 'Ucapan wajib diisi dan maksimal 500 karakter.' using errcode = '22023';
  end if;

  insert into public.wedding_rsvps (guest_name, attendance, guest_count, message)
  values (clean_name, p_attendance, p_guest_count, clean_message);

  insert into public.wedding_wishes (id, guest_name, message)
  values (wish_id, clean_name, clean_message);

  return query select wish_id, clean_name, clean_message;
end;
$$;

grant execute on function public.submit_wedding_rsvp_and_wish(text, text, integer, text) to anon, authenticated;
