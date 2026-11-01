import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { predict, planByArrival, planByTarget, dayTypeOf, type Model, type DayType } from "../src/lib/model.ts";

const model = JSON.parse(readFileSync(new URL("../src/data/model.json", import.meta.url), "utf8")) as Model;
const cases = JSON.parse(readFileSync(new URL("./fixtures.json", import.meta.url), "utf8")) as {
  type: DayType; start: number; elapsed: number; n: number; lo: number; mid: number; hi: number; sample: number;
}[];

test("ผลทำนายตรงกับ Python ทุกกรณี", () => {
  for (const c of cases) {
    const p = predict(model, c.type, c.start, c.elapsed, c.n)!;
    const msg = JSON.stringify(c);
    assert.ok(Math.abs(p.lo - c.lo) < 1e-6, msg + " lo " + p.lo);
    assert.ok(Math.abs(p.mid - c.mid) < 1e-6, msg + " mid " + p.mid);
    assert.ok(Math.abs(p.hi - c.hi) < 1e-6, msg + " hi " + p.hi);
    assert.equal(p.sample, c.sample, msg);
  }
});

test("ช่วงทำนายเรียงลำดับถูกต้องและไม่ติดลบ", () => {
  for (const t of ["wd", "we"] as const)
    for (let m = 7 * 60; m < 20 * 60; m += 7)
      for (const [e, n] of [[0, 1], [5, 6], [15, 12]]) {
        const p = predict(model, t, m, e, n)!;
        assert.ok(p.lo >= 0 && p.lo <= p.mid + 1e-9 && p.mid <= p.hi + 1e-9, `${t} ${m} ${e} ${n}`);
      }
});

test("คนบนรถมากขึ้น เวลารอไม่เพิ่มขึ้น", () => {
  for (let n = 1; n < 13; n++) {
    const a = predict(model, "wd", 16 * 60, 2, n)!;
    const b = predict(model, "wd", 16 * 60, 2, n + 1)!;
    assert.ok(b.mid <= a.mid + 1e-9, `n=${n}`);
  }
});

test("นอกเวลาให้บริการไม่ทำนาย", () => {
  assert.equal(predict(model, "wd", 3 * 60), null);
  assert.equal(planByArrival(model, "wd", 22 * 60, { min: 20, max: 25 }).ok, false);
});

test("วางแผนย้อนจากเวลาถึงปลายทาง", () => {
  const r = planByTarget(model, "wd", 17 * 60, { min: 20, max: 25 });
  assert.ok(r.ok);
  assert.ok(r.safeArrive! <= r.typicalArrive!);
  assert.ok(r.safeArrive! + r.safeWait! <= r.latestDeparture);
});

test("แยกวันธรรมดา/สุดสัปดาห์", () => {
  assert.equal(dayTypeOf("2026-11-01"), "we"); // อาทิตย์
  assert.equal(dayTypeOf("2026-11-02"), "wd"); // จันทร์
});
