-- TU vanwise: ฐานข้อมูลกลางสำหรับคิวรถตู้แบบเรียลไทม์
-- วิธีใช้: เปิด Supabase → SQL Editor → วางไฟล์นี้ทั้งไฟล์ → Run
-- อย่าลืมเปลี่ยน PIN ทีมงานในบรรทัดท้ายไฟล์ก่อนกด Run

-- 1) ตารางบันทึกเหตุการณ์ ทุกเครื่องอ่านตารางนี้แล้วคำนวณคิวเอง
create table if not exists public.events (
  id     bigint generated always as identity primary key,
  ts     timestamptz not null default now(),
  kind   text not null check (kind in ('checkin', 'cancel', 'depart', 'arrive', 'reset')),
  count  int  not null default 1 check (count between 1 and 13),
  device text check (device is null or length(device) between 8 and 64),
  ref    bigint
);
create index if not exists events_ts_idx on public.events (ts);
create index if not exists events_device_idx on public.events (device, ts);

-- ทุกคนอ่านได้ (เฉพาะ 2 วันล่าสุด) แต่เขียนตรงไม่ได้ ต้องผ่านฟังก์ชันด้านล่างเท่านั้น
alter table public.events enable row level security;
grant select on public.events to anon, authenticated;
revoke insert, update, delete, truncate on public.events from anon, authenticated;
drop policy if exists "read recent events" on public.events;
create policy "read recent events" on public.events
  for select to anon, authenticated
  using (ts > now() - interval '2 days');

-- 2) PIN ทีมงาน เก็บใน schema ที่หน้าเว็บมองไม่เห็น
create schema if not exists private;
create table if not exists private.settings (
  id  int primary key default 1 check (id = 1),
  pin text not null
);
revoke all on schema private from anon, authenticated;

-- 3) ฟังก์ชันที่หน้าเว็บเรียกได้

-- เวลาของเซิร์ฟเวอร์ ใช้ปรับนาฬิกาทุกเครื่องให้ตรงกัน
create or replace function public.server_now() returns timestamptz
language sql stable as $$ select now() $$;

-- ผู้โดยสารเช็กอิน: 1 เครื่องเช็กอินซ้ำไม่ได้ภายใน 30 นาที และจำกัดรวมไม่เกิน 40 ครั้ง/นาที
create or replace function public.checkin(p_device text) returns void
language plpgsql security definer set search_path = public as $$
declare last_kind text;
begin
  if p_device is null or length(p_device) not between 8 and 64 then
    raise exception 'bad_device';
  end if;
  select kind into last_kind from events
    where device = p_device and kind in ('checkin', 'cancel') and ts > now() - interval '30 minutes'
    order by ts desc limit 1;
  if last_kind = 'checkin' then raise exception 'already_checked_in'; end if;
  if (select count(*) from events where kind = 'checkin' and ts > now() - interval '1 minute') >= 40 then
    raise exception 'rate_limited';
  end if;
  insert into events (kind, device) values ('checkin', p_device);
end $$;

-- ผู้โดยสารยกเลิกการเช็กอินของตัวเอง
create or replace function public.cancel_checkin(p_device text) returns void
language plpgsql security definer set search_path = public as $$
declare last_kind text;
begin
  select kind into last_kind from events
    where device = p_device and kind in ('checkin', 'cancel') and ts > now() - interval '30 minutes'
    order by ts desc limit 1;
  if last_kind is distinct from 'checkin' then raise exception 'not_checked_in'; end if;
  insert into events (kind, device) values ('cancel', p_device);
end $$;

-- ตรวจ PIN ทีมงาน (หน่วงเวลาเล็กน้อยกันการสุ่มเดา)
create or replace function public.verify_pin(p_pin text) returns boolean
language plpgsql security definer set search_path = public, private as $$
begin
  perform pg_sleep(0.4);
  return exists (select 1 from private.settings where pin = p_pin);
end $$;

-- ปุ่มของทีมงาน: นับคน +1 / −1 (cancel) / รถออก / รถถึง / ล้างคิว
create or replace function public.staff_event(p_pin text, p_kind text, p_count int default 1, p_ref bigint default null)
returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if not exists (select 1 from private.settings where pin = p_pin) then
    perform pg_sleep(0.4);
    raise exception 'bad_pin';
  end if;
  if p_kind not in ('checkin', 'cancel', 'depart', 'arrive', 'reset') then raise exception 'bad_kind'; end if;
  insert into events (kind, count, ref) values (p_kind, greatest(1, least(13, coalesce(p_count, 1))), p_ref);
end $$;

revoke all on function public.checkin(text), public.cancel_checkin(text), public.verify_pin(text),
  public.staff_event(text, text, int, bigint), public.server_now() from public;
grant execute on function public.checkin(text), public.cancel_checkin(text), public.verify_pin(text),
  public.staff_event(text, text, int, bigint), public.server_now() to anon, authenticated;

-- 4) เปิด realtime ให้ตาราง events (ทุกเครื่องได้รับเหตุการณ์ใหม่ทันที)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'events') then
    alter publication supabase_realtime add table public.events;
  end if;
end $$;

-- 5) ตั้ง PIN ทีมงาน ← เปลี่ยน 'เปลี่ยนเป็นPINของกลุ่ม' เป็นตัวเลขอย่างน้อย 6 หลัก
insert into private.settings (id, pin) values (1, 'เปลี่ยนเป็นPINของกลุ่ม')
  on conflict (id) do update set pin = excluded.pin;
