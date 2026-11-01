import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ceil5, clockOf, deriveQueue, estimateNext, type QueueEvent } from "../src/lib/queue.ts";
import type { Model } from "../src/lib/model.ts";

const model = JSON.parse(readFileSync(new URL("../src/data/model.json", import.meta.url), "utf8")) as Model;

// 2026-11-02 (จันทร์) เวลาไทย → ms
const at = (hhmm: string, sec = 0) => {
  const [h, m] = hhmm.split(":").map(Number);
  return Date.UTC(2026, 10, 2, h - 7, m, sec);
};
let seq = 0;
const ev = (ts: number, kind: QueueEvent["kind"], device: string | null = null, count = 1, ref: number | null = null): QueueEvent => ({
  id: ++seq,
  ts,
  kind,
  count,
  device,
  ref,
});
const checkins = (start: number, n: number, gapSec = 20) =>
  Array.from({ length: n }, (_, i) => ev(start + i * gapSec * 1000, "checkin", `dev-${start}-${i}`));

test("ปัดเวลาขึ้นเป็นนาทีที่ลงท้าย 0/5", () => {
  assert.equal(clockOf(ceil5(at("11:43"))), "11:45");
  assert.equal(clockOf(ceil5(at("11:45"))), "11:45");
  assert.equal(clockOf(ceil5(at("11:45", 1))), "11:50");
  assert.equal(clockOf(ceil5(at("11:59", 30))), "12:00");
});

test("รถเต็มตอน 11:43 ออก 11:45 พร้อม 13 คน", () => {
  const evs = checkins(at("11:38"), 13, 23); // คนที่ 13 มาถึง 11:42:36
  const before = deriveQueue(evs, at("11:44"));
  assert.equal(before.van?.members.length, 13);
  assert.equal(before.trips.length, 0);
  const after = deriveQueue(evs, at("11:45", 1));
  assert.equal(after.van, null);
  assert.equal(after.trips.length, 1);
  assert.equal(clockOf(after.trips[0].depMs), "11:45");
  assert.equal(after.trips[0].n, 13);
  assert.equal(after.trips[0].by, "full");
});

test("รถไม่เต็ม ออกเมื่อครบ 20 นาที (ปัดเป็น 0/5)", () => {
  const evs = checkins(at("07:12"), 4, 60);
  const q = deriveQueue(evs, at("08:00"));
  assert.equal(q.trips.length, 1);
  assert.equal(clockOf(q.trips[0].depMs), "07:35"); // 07:32 → 07:35
  assert.equal(q.trips[0].by, "timeout");
});

test("คนที่ 14 ขึ้นคันถัดไป และคันถัดไปเริ่มนับเวลาตอนคันแรกออก", () => {
  const evs = checkins(at("12:00"), 15, 10);
  const q1 = deriveQueue(evs, at("12:04"));
  assert.equal(q1.van?.members.length, 13);
  assert.equal(q1.overflow.length, 2);
  const q2 = deriveQueue(evs, at("12:06"));
  assert.equal(q2.trips.length, 1);
  assert.equal(q2.van?.members.length, 2);
  assert.equal(clockOf(q2.van!.startMs), "12:05");
});

test("เช็กอินซ้ำเครื่องเดิมไม่นับ ยกเลิกแล้วที่นั่งว่าง", () => {
  const t = at("16:00");
  const evs = [ev(t, "checkin", "dev-a"), ev(t + 1000, "checkin", "dev-a"), ev(t + 2000, "checkin", "dev-b"), ev(t + 3000, "cancel", "dev-a")];
  const q = deriveQueue(evs, t + 5000);
  assert.deepEqual(q.van?.members, ["dev-b"]);
});

test("ยกเลิกจากรถเต็ม คนที่รอคันถัดไปได้ขึ้นแทน และรถยังไม่ออก", () => {
  const evs = checkins(at("12:00"), 14, 10);
  const first = evs[0].device!;
  evs.push(ev(at("12:03"), "cancel", first));
  const q = deriveQueue(evs, at("12:04"));
  assert.equal(q.van?.members.length, 13);
  assert.equal(q.overflow.length, 0);
  assert.ok(!q.van!.members.includes(first));
});

test("เจ้าหน้าที่กดรถออก และบันทึกรถถึงปลายทาง", () => {
  const evs = checkins(at("17:00"), 6, 30);
  const depAt = at("17:08");
  evs.push(ev(depAt, "depart"));
  evs.push(ev(at("17:31"), "arrive", null, 1, depAt));
  const q = deriveQueue(evs, at("17:40"));
  assert.equal(q.trips.length, 1);
  assert.equal(q.trips[0].by, "staff");
  assert.equal(q.trips[0].n, 6);
  assert.equal((q.trips[0].arrivedMs! - q.trips[0].depMs) / 60000, 23);
});

test("ล้างคิวแล้วเริ่มใหม่", () => {
  const evs = checkins(at("15:00"), 5, 10);
  evs.push(ev(at("15:02"), "reset"));
  assert.equal(deriveQueue(evs, at("15:03")).van, null);
});

test("ทุกเครื่องได้ผลเดียวกันแม้ได้รับเหตุการณ์ไม่เรียงลำดับ", () => {
  const evs = checkins(at("13:00"), 20, 15);
  const shuffled = [...evs].reverse();
  assert.deepEqual(deriveQueue(evs, at("13:30")), deriveQueue(shuffled, at("13:30")));
});

test("คาดการณ์: เวลาออกลงท้าย 0/5 ไม่เกินกติกา 20 นาที และรถเต็มแล้วเวลาแน่นอน", () => {
  for (const hhmm of ["07:10", "09:40", "12:20", "16:05", "19:15"]) {
    const evs = checkins(at(hhmm), 3, 30);
    const now = at(hhmm) + 3 * 60_000;
    const e = estimateNext(model, deriveQueue(evs, now), now);
    for (const d of [e.depLo, e.depMid, e.depHi]) {
      assert.equal(d % 300_000, 0, `${hhmm} ต้องลงท้าย 0/5`);
      assert.ok(d <= e.capMs && d >= now, `${hhmm} อยู่ในกรอบเวลา`);
    }
    assert.ok(e.depLo <= e.depMid && e.depMid <= e.depHi);
  }
  const full = checkins(at("11:38"), 13, 23);
  const e = estimateNext(model, deriveQueue(full, at("11:44")), at("11:44"));
  assert.equal(e.status, "full");
  assert.equal(clockOf(e.depMid), "11:45");
});

test("คาดการณ์นอกเวลาที่มีข้อมูล ไม่ล่ม", () => {
  const now = at("05:00");
  const e = estimateNext(model, deriveQueue([], now), now);
  assert.equal(e.status, "empty");
  assert.equal(e.hasStats, false);
});

test("เจ้าหน้าที่กด −1 ลบเฉพาะคนที่เจ้าหน้าที่นับ ไม่ลบคนที่เช็กอินผ่านแอป", () => {
  const t = at("14:00");
  const evs = [ev(t, "checkin", "app-1"), ev(t + 1000, "checkin", null, 2), ev(t + 2000, "cancel"), ev(t + 3000, "cancel"), ev(t + 4000, "cancel")];
  const q = deriveQueue(evs, t + 5000);
  assert.deepEqual(q.van?.members, ["app-1"]);
});
