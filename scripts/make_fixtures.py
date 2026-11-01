"""สร้างค่าทดสอบจาก Python เพื่อยืนยันว่า src/lib/model.ts คำนวณตรงกัน"""
import sys, json
sys.path.insert(0, 'scripts')
import build_model as bm
rows, _ = bm.load_rows(sys.argv[1])
m = bm.fit(rows)
cases = []
for t in ('wd', 'we'):
    for start in (7*60+10, 9*60, 12*60+5, 13*60+40, 16*60+20, 17*60+50, 19*60+45):
        for elapsed, n in ((0, 1), (3, 4), (8, 10), (12, 12), (25, 2), (2, 13)):
            lo, mid, hi, sample = bm.predict(m, t, bm.slot(start), elapsed, n)
            cases.append(dict(type=t, start=start, elapsed=elapsed, n=n, lo=lo, mid=mid, hi=hi, sample=sample))
json.dump(cases, open(sys.argv[2], 'w'), indent=0)
print(len(cases), 'cases')
