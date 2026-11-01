-- ReviewLah — base de données (à coller dans Supabase > SQL Editor > Run)
-- Idempotent : peut être relancé sans casser les données.

create extension if not exists pgcrypto;

-- Plaques : une ligne par plaque physique (le code est celui écrit dans la puce NFC et le QR).
create table if not exists public.plates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  business_name text not null,
  owner_email text,
  owner_id uuid references auth.users (id) on delete set null,
  destination_url text not null,
  plan text not null default 'basic' check (plan in ('basic', 'pro')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Scans : un événement par tap NFC ou scan QR. On ne garde ni IP ni identifiant du visiteur.
create table if not exists public.scans (
  id bigint generated always as identity primary key,
  plate_id uuid not null references public.plates (id) on delete cascade,
  source text not null check (source in ('nfc', 'qr', 'other')),
  created_at timestamptz not null default now()
);
create index if not exists scans_plate_created_idx on public.scans (plate_id, created_at desc);

-- Administrateurs (toi). Ajoute-toi après ta première connexion, voir la fin du fichier.
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

alter table public.plates enable row level security;
alter table public.scans enable row level security;
alter table public.admins enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- Plaques : chaque commerçant voit les siennes, l'admin voit et gère tout.
drop policy if exists plates_select on public.plates;
create policy plates_select on public.plates for select
  using (owner_id = auth.uid() or public.is_admin());
drop policy if exists plates_admin_insert on public.plates;
create policy plates_admin_insert on public.plates for insert with check (public.is_admin());
drop policy if exists plates_admin_update on public.plates;
create policy plates_admin_update on public.plates for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists plates_admin_delete on public.plates;
create policy plates_admin_delete on public.plates for delete using (public.is_admin());

-- Scans : lisibles par le propriétaire de la plaque et par l'admin. Jamais en écriture directe.
drop policy if exists scans_select on public.scans;
create policy scans_select on public.scans for select
  using (
    public.is_admin()
    or exists (select 1 from public.plates p where p.id = scans.plate_id and p.owner_id = auth.uid())
  );

-- Appelée par go.reviewlah.my/CODE : enregistre le scan et renvoie le lien Google (ou null).
create or replace function public.record_scan(p_code text, p_source text default 'other')
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_plate public.plates;
  v_source text := case when p_source in ('nfc', 'qr') then p_source else 'other' end;
begin
  select * into v_plate from public.plates where code = upper(trim(p_code)) and active;
  if not found then
    return null;
  end if;
  insert into public.scans (plate_id, source) values (v_plate.id, v_source);
  return v_plate.destination_url;
end;
$$;
revoke all on function public.record_scan(text, text) from public;
grant execute on function public.record_scan(text, text) to anon, authenticated;

-- À la connexion d'un commerçant : rattache les plaques créées avec son email.
create or replace function public.claim_plates() returns void
language sql security definer set search_path = public as $$
  update public.plates
     set owner_id = auth.uid()
   where owner_id is null
     and owner_email is not null
     and lower(owner_email) = lower(auth.jwt() ->> 'email')
     and auth.uid() is not null;
$$;
revoke all on function public.claim_plates() from public;
grant execute on function public.claim_plates() to authenticated;

-- ============================================================
-- ÉTAPE 2 (après ta première connexion sur /login) :
-- remplace l'adresse par celle que tu as utilisée pour te connecter, puis lance seulement cette ligne.
--
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'ton-email@exemple.com'
--   on conflict do nothing;
-- ============================================================
