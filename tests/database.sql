\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values ('00000000-0000-0000-0000-000000000001','husband@example.test'),('00000000-0000-0000-0000-000000000002','wife@example.test'),('00000000-0000-0000-0000-000000000003','outsider@example.test');
create function public.test_assert(ok boolean,message text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'TEST FAILED: %',message; end if; end $$;
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select public.create_household('Our home') as home \gset
select invite_code as code from public.households \gset
select public.save_entry(null,100000,'income','Salary','2026-11-01','Pay') as husband_entry \gset
select public.test_assert((public.get_household()->>'currency')='MMK','MMK currency');
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select public.join_household(:'code');
select public.test_assert((select count(*) from public.entries)=1,'partner reads shared entries');
select public.save_entry(null,20000,'expense','Utilities','2026-11-02','Power') as wife_entry \gset
select public.test_assert((select count(*) from public.list_entries('2026-11-01','2026-12-01'))=2,'month includes both partners');
select public.test_assert((select count(*) from public.list_entries('2026-12-01','2027-01-01'))=0,'month boundaries');
update public.entries set amount=1 where id=:'husband_entry';
select public.test_assert((select amount from public.entries where id=:'husband_entry')=100000,'partner cannot edit owner entry');
delete from public.entries where id=:'husband_entry';
select public.test_assert((select count(*) from public.entries)=2,'partner cannot delete owner entry');
select public.save_entry(:'wife_entry',25000,'expense','Tax','2026-11-02','Tax');
select public.test_assert((select amount from public.entries where id=:'wife_entry')=25000,'owner may update');
select public.delete_entry(:'wife_entry');
select public.test_assert((select count(*) from public.entries)=1,'owner may delete');
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select public.test_assert(public.get_household() is null,'outsider has no household');
select public.test_assert((select count(*) from public.entries)=0,'outsider cannot read entries');
select set_config('test.invite_code',:'code',true);
do $$ begin
 begin
  perform public.join_household(current_setting('test.invite_code'));
  raise exception 'TEST FAILED: third member joined';
 exception when others then if SQLERRM <> 'Household is full' then raise; end if; end;
end $$;
select public.create_household('Other home');
select public.test_assert((select count(*) from public.entries)=0,'second household cannot read first');
do $$ begin
 begin
  insert into public.entries(household_id,owner_id,amount,kind,category,date) values(public.my_household(),'00000000-0000-0000-0000-000000000001',5,'expense','Food','2026-11-01');
  raise exception 'TEST FAILED: forged owner accepted';
 exception when insufficient_privilege then null; end;
end $$;
set local role anon;
do $$ begin
 begin
  perform public.get_household();
  raise exception 'TEST FAILED: anonymous RPC accepted';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
\echo 'PASS: household creation/join, shared reads, month boundaries, owner writes, isolation, capacity, forged owner, anonymous denial'
