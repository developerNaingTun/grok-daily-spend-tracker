begin;
create table public.households (
 id uuid primary key default gen_random_uuid(),
 name text not null check (char_length(name) between 1 and 80),
 currency text not null default 'MMK' check (currency = 'MMK'),
 invite_code text not null unique default replace(gen_random_uuid()::text, '-', ''),
 created_at timestamptz not null default now()
);
create table public.household_members (
 user_id uuid primary key references auth.users(id) on delete cascade,
 household_id uuid not null references public.households(id) on delete cascade,
 display_name text not null,
 joined_at timestamptz not null default now()
);
create index on public.household_members(household_id);
create table public.entries (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.households(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade,
 amount numeric(14,2) not null check (amount > 0 and amount <= 999999999999),
 kind text not null check (kind in ('income','expense')),
 category text not null check (category in ('Salary','Other income','Food','Transport','Housing','Tax','Utilities','Health','Shopping','Other')),
 date date not null check (date between '1900-01-01' and '9998-12-31'),
 note text not null default '' check (char_length(note) <= 300),
 created_at timestamptz not null default now()
);
create index on public.entries(household_id,date desc);
create function public.my_household() returns uuid language sql stable security definer set search_path = '' as $$
 select household_id from public.household_members where user_id = auth.uid();
$$;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.entries enable row level security;
create policy household_read on public.households for select to authenticated using (id = public.my_household());
create policy member_read on public.household_members for select to authenticated using (household_id = public.my_household());
create policy entry_read on public.entries for select to authenticated using (household_id = public.my_household());
create policy entry_add on public.entries for insert to authenticated with check (household_id = public.my_household() and owner_id = auth.uid());
create policy entry_edit on public.entries for update to authenticated using (household_id = public.my_household() and owner_id = auth.uid()) with check (household_id = public.my_household() and owner_id = auth.uid());
create policy entry_delete on public.entries for delete to authenticated using (household_id = public.my_household() and owner_id = auth.uid());
create function public.create_household(p_name text) returns uuid language plpgsql security definer set search_path = '' as $$
declare hid uuid; label text;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 -- Serialize create/join for this user; household_members has a unique user_id as a second guard.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 if public.my_household() is not null then raise exception 'Already in a household'; end if;
 select coalesce(nullif(raw_user_meta_data->>'display_name',''), split_part(email,'@',1),'Partner') into label from auth.users where id=auth.uid();
 insert into public.households(name) values(trim(p_name)) returning id into hid;
 insert into public.household_members(user_id,household_id,display_name) values(auth.uid(),hid,left(label,80));
 return hid;
end; $$;
create function public.join_household(p_code text) returns uuid language plpgsql security definer set search_path = '' as $$
declare hid uuid; label text;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 if public.my_household() is not null then raise exception 'Already in a household'; end if;
 select id into hid from public.households where invite_code = lower(trim(p_code)) for update;
 if hid is null then raise exception 'Invalid invitation'; end if;
 if (select count(*) from public.household_members where household_id=hid) >= 2 then raise exception 'Household is full'; end if;
 select coalesce(nullif(raw_user_meta_data->>'display_name',''),split_part(email,'@',1),'Partner') into label from auth.users where id=auth.uid();
 insert into public.household_members(user_id,household_id,display_name) values(auth.uid(),hid,left(label,80));
 return hid;
end; $$;
create function public.get_household() returns jsonb language sql stable security invoker set search_path = '' as $$
 select jsonb_build_object('id',h.id,'name',h.name,'currency',h.currency,'invite_code',h.invite_code,'members',
  (select jsonb_agg(jsonb_build_object('user_id',m.user_id,'display_name',m.display_name) order by m.joined_at) from public.household_members m where m.household_id=h.id))
 from public.households h where h.id=public.my_household();
$$;
create function public.list_entries(p_start date,p_end date) returns setof public.entries language sql stable security invoker set search_path = '' as $$
 select * from public.entries where household_id=public.my_household() and date >= p_start and date < p_end order by date desc,created_at desc;
$$;
create function public.save_entry(p_id uuid,p_amount numeric,p_kind text,p_category text,p_date date,p_note text) returns uuid language plpgsql security invoker set search_path = '' as $$
declare result uuid;
begin
 if p_id is null then
  insert into public.entries(household_id,owner_id,amount,kind,category,date,note) values(public.my_household(),auth.uid(),p_amount,p_kind,p_category,p_date,p_note) returning id into result;
 else
  update public.entries set amount=p_amount,kind=p_kind,category=p_category,date=p_date,note=p_note where id=p_id and owner_id=auth.uid() returning id into result;
 end if;
 if result is null then raise exception 'Entry not found or not owned'; end if;
 return result;
end; $$;
create function public.delete_entry(p_id uuid) returns uuid language plpgsql security invoker set search_path = '' as $$
declare result uuid;
begin
 delete from public.entries where id=p_id and owner_id=auth.uid() returning id into result;
 if result is null then raise exception 'Entry not found or not owned'; end if;
 return result;
end; $$;
-- Supabase can have broad default privileges; revoke them explicitly.
revoke all on public.households, public.household_members, public.entries from anon, authenticated;
grant select on public.households, public.household_members to authenticated;
grant select,insert,update,delete on public.entries to authenticated;
revoke all on function public.my_household(),public.create_household(text),public.join_household(text),public.get_household(),public.list_entries(date,date),public.save_entry(uuid,numeric,text,text,date,text),public.delete_entry(uuid) from public, anon;
grant execute on function public.my_household(),public.create_household(text),public.join_household(text),public.get_household(),public.list_entries(date,date),public.save_entry(uuid,numeric,text,text,date,text),public.delete_entry(uuid) to authenticated;
commit;
