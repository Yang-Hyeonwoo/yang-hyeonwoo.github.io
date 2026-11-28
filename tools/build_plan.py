"""Builds data/plan.json (the training plan the site renders and checks against).

Usage:  python build_plan.py <site-data-dir>
Edit the tables below, then re-run. Dates are the Monday of each week.
"""
import datetime as dt
import json
import sys

out_dir = sys.argv[1].rstrip("/\\")
D = dt.date
ORD = ["첫째", "둘째", "셋째", "넷째", "다섯째"]


def week_label(monday):
    thu = monday + dt.timedelta(days=3)          # a week belongs to the month of its Thursday
    return "%d월 %s 주" % (thu.month, ORD[(thu.day - 1) // 7])


HYROX = {0: ("Functional", "RPE 8–9"), 1: ("Double", "RPE 8 · 한두 개 여유"),
         3: ("Interval / Strength", "RPE 8–9"), 4: ("Single", "전력")}
HOLIDAYS = {D(2026, 12, 11): "Hyrox Training 없음", D(2026, 12, 25): "성탄절", D(2027, 1, 1): "신정"}   # days HY5 is closed or has no class
MAINTENANCE = (D(2026, 12, 24), D(2027, 1, 1))   # year-end week: no deficit

# monday: (gym round-trip run weekdays, bonus gym round-trip run weekdays, Wednesday run, Wednesday detail, recovery week?)
# Wednesday runs are written the way the user plans them: pace + distance, run straight through ("4:35 5km 지속주").
# Breaks only where the pace is faster than can be held for the whole distance (1 km / 300 m reps); those carry the
# user's interval notation and the distance of the fast part. Every detail ends with the day's total distance.
STRIDES = "200m 빠르게 4번"
STRIDE_HOW = "200m는 44–46초 · 전력 아님 · 사이는 걸어서 회복"
WEEKS = {
    D(2026, 11, 23): ([3], [], "조깅 8km + " + STRIDES, "심박 150 이하 · " + STRIDE_HOW + " · 총 10km", False),
    D(2026, 11, 30): ([0, 3], [], "5km 기록 측정", "트랙 12.5바퀴 · 앞뒤 조깅 2km씩 · 총 9km · 이 기록으로 모든 페이스를 다시 맞춰요", False),
    D(2026, 12, 7): ([0, 3], [], "4:35 5km 지속주", "앞뒤 조깅 2km씩 · 총 9km · 페이스는 5km 기록으로 확정", False),
    D(2026, 12, 14): ([0, 3], [1], "4:35 6km 지속주 + " + STRIDES, "앞 조깅 2km · 뒤 조깅 1km · 총 11km", False),
    D(2026, 12, 21): ([0], [], "조깅 5km + " + STRIDES, "회복 주 · 가볍게 · 총 7km", True),
    D(2026, 12, 28): ([0, 3], [1], "4:40 7km 지속주", "앞뒤 조깅 1km씩 · 총 9km · 끝까지 같은 페이스", False),
    D(2027, 1, 4): ([0, 3], [1], '300/100(72–75"/40") × 10 · 4:00–4:10/6:40', "빠르게 총 3km · 회복은 100m 조깅 · 앞뒤 조깅 2km씩 · 총 8km", False),
    D(2027, 1, 11): ([0, 3], [1], "4:30 6km 지속주", "앞뒤 조깅 1.5km씩 · 총 9km", False),
    D(2027, 1, 18): ([0, 3], [1], "1000/400(4'10\"/2'30\") × 5 · 4:10/6:15", "빠르게 총 5km · 회복은 400m 조깅 · 앞뒤 조깅 1.5km씩 · 총 10km", False),
    D(2027, 1, 25): ([0, 3], [], "5km 기록 측정 (재측정)", "회복 주 · 앞뒤 조깅 2km씩 · 총 9km · 10km 목표 시기를 여기서 판단", True),
}
# Weekend easy run (Saturday, or Sunday instead), added 2026-11-27 to make up for the shorter gym run; none in recovery weeks.
WEEKEND_KM = {D(2026, 11, 30): 6, D(2026, 12, 7): 8, D(2026, 12, 14): 8, D(2026, 12, 28): 10, D(2027, 1, 4): 10, D(2027, 1, 11): 12, D(2027, 1, 18): 12}
WED_KM = {D(2026, 11, 23): 10, D(2026, 11, 30): 9, D(2026, 12, 7): 9, D(2026, 12, 14): 11, D(2026, 12, 21): 7,
          D(2026, 12, 28): 9, D(2027, 1, 4): 8, D(2027, 1, 11): 9, D(2027, 1, 18): 10, D(2027, 1, 25): 9}

# Running paces, oldest first. Add a row whenever they are re-set (5 km test, a race, a clear change in feel).
PACES = [
    {"date": "2026-11-25", "basis": "시작 추정값 · 11월 러닝 기록 기준",
     "easy": "5:50–6:15", "tempo": "4:40", "threshold": "4:35", "rep1k": "4:10", "rep300": "72–75초"},
]

# What each week is for, in one line (shown beside the week's name).
CONCEPT = {
    D(2026, 11, 23): "고강도 Hyrox Training 적응 · 러닝 마일리지 다시 쌓기 시작 · 체육관 왕복 러닝 첫 시도",
    D(2026, 11, 30): "5km 기록 측정으로 기준 페이스 잡기 · 왕복 러닝 주 2회 자리 잡기 · 주말 조깅 6km 시작",
    D(2026, 12, 7): "역치 지속주 시작 (4:35 5km) · 프로 무게에 익숙해지기 · 주말 조깅 8km로 늘리기",
    D(2026, 12, 14): "지속주 6km로 늘리기 · 화요일 왕복 러닝 보너스 시작 · 주 35km 넘기기",
    D(2026, 12, 21): "회복 주 · 러닝 거리 절반으로 줄이기 · 연말 컨디션 지키기",
    D(2026, 12, 28): "템포 지속주 7km로 오래 버티는 힘 기르기 · 주말 조깅 10km로 늘리기 · 연휴에도 수요일 훈련 지키기",
    D(2027, 1, 4): "300m 인터벌로 스피드 자극 · 주 35km 안팎 거리 유지 · 주말 조깅 10km",
    D(2027, 1, 11): "4:30 지속주 6km · 하프 페이스 감각 익히기 · 주말 조깅 12km로 늘리기",
    D(2027, 1, 18): "1km 인터벌로 10K 페이스 감각 만들기 · 주 38km 넘기기 · 주말 조깅 12km 유지",
    D(2027, 1, 25): "회복 주 · 5km 재측정으로 두 달 점검 · 10K 대회 시기 정하기",
}

COMMUTE_OUT, COMMUTE_BACK = 4, 4.3               # home -> gym and gym -> home by the running routes (measured 2026-11-26)
COMMUTE_KM = COMMUTE_OUT + COMMUTE_BACK
km = lambda x: "%g" % round(x, 1)
FIRST_DAY = D(2026, 11, 23)                      # the first Hyrox Training: week 1 starts here
NO_CORE = {D(2026, 11, 23), D(2026, 11, 24)}     # days the hanging leg raises were not part of the session

days, weeks = {}, []
for monday, (commute, bonus, wed_run, wed_detail, recovery) in sorted(WEEKS.items()):
    label = week_label(monday)
    wknd = WEEKEND_KM.get(monday, 0)
    run_km = round(WED_KM[monday] + COMMUTE_KM * len(commute) + wknd, 1)
    weeks.append({"label": label, "start": monday.isoformat(), "concept": CONCEPT[monday], "recovery": recovery, "run_km": run_km,
                  "run_note": "왕복 러닝 %d회 %skm + 수요일 %dkm" % (len(commute), km(COMMUTE_KM * len(commute)), WED_KM[monday]) + (" + 주말 %dkm" % wknd if wknd else ""),
                  "bonus_km": round(COMMUTE_KM * len(bonus), 1)})
    for wd in range(7):
        d = monday + dt.timedelta(days=wd)
        items, kcal, carb = [], 2000, 200
        if d in HOLIDAYS:
            items.append({"k": "rest", "t": "휴무 · " + HOLIDAYS[d], "d": "대체 훈련 없음"})
        elif wd in HYROX:
            name, how = HYROX[wd]
            key = wd == 4
            items.append({"k": "hyrox", "t": "Hyrox Training · " + name, "d": "17:50 · " + how, "key": key})
            if d == FIRST_DAY:
                items[-1]["first"] = True
            kcal, carb = 2300, 270
            if wd in commute:
                items.append({"k": "commute", "t": "체육관 왕복 러닝 %skm" % km(COMMUTE_KM), "d": "갈 때 %skm · 올 때 %skm · 심박 150 이하" % (km(COMMUTE_OUT), km(COMMUTE_BACK)) + (" · 끝에 " + STRIDES if wd == 0 else "")})
                kcal, carb = 2500, 320
            elif wd in bonus:
                items.append({"k": "commute", "t": "체육관 왕복 러닝 %skm" % km(COMMUTE_KM), "d": "보너스 · 컨디션 좋은 날만, 아니면 자전거", "opt": True})
        elif wd == 2:
            items.append({"k": "run", "t": wed_run, "d": "17:50 트랙 · " + wed_detail, "key": True})
            items.append({"k": "weights", "t": "상체 웨이트 45분", "d": "22:30 헬스장 · 23:30까지"})
            kcal, carb = 2500, 320
        elif wd == 5 and wknd:
            items.append({"k": "run", "t": "주말 조깅 %dkm" % wknd, "d": "심박 150 이하 · 평지 · 일요일에 뛰어도 돼요 · 못 뛰면 보충 없음", "wk": True})
            kcal, carb = 2300, 270
        elif wd == 6 and wknd:
            items.append({"k": "free", "t": "휴식", "d": "토요일에 못 뛰었으면 오늘 주말 조깅", "opt": True})
        else:
            items.append({"k": "free", "t": "자유", "d": "뛰고 싶은 날만 조깅 · 한 달에 두 번쯤 롱런 10–12km", "opt": True})
        if MAINTENANCE[0] <= d <= MAINTENANCE[1]:
            kcal += 200
            carb += 50
        days[d.isoformat()] = {"week": label, "items": items, "kcal": kcal, "carb": carb, "prot": 155, "fat": 65}

plan = {
    "updated": "2026-11-27",
    "race": {"name": "HYROX Incheon", "division": "Pro Single", "date": "2027-05-14",      # Pro Single is on Friday (the user, 2026-11-28)
             "date_note": "5/14 Fri · Pro Single 출전"},
    "goals": [
        {"label": "Hyrox Pro Single", "value": "1:15:00", "sub": "2027년 5월 HYROX Incheon"},
        {"label": "10km", "value": "37:59", "sub": "3월 말~4월 초 대회"},
        {"label": "Body", "value": "67–68kg", "sub": "체지방 10–12% · 2월 말까지"},
    ],
    "roadmap": [
        {"m": "12월", "from": "2026-11-23", "theme": "적응 + 페이스 찾기", "focus": "체육관 왕복 러닝으로 거리 쌓기 · 5km 기록 측정 · 프로 무게 시작"},
        {"m": "1월", "from": "2027-01-04", "theme": "거리 + 스피드", "focus": "주 35–40km · 인터벌과 템포 번갈아 · 5km 재측정"},
        {"m": "2월", "from": "2027-02-01", "theme": "10K 대비 + 프로 무게", "focus": "1km 반복과 역치주 · 전 종목 프로 무게 · 감량 마무리"},
        {"m": "3월", "from": "2027-03-01", "theme": "10K 대회", "focus": "목표 페이스 훈련 · 하프 시뮬레이션 · 식사량 올리기"},
        {"m": "4월", "from": "2027-04-05", "theme": "레이스 리허설", "focus": "1km + 스테이션 반복 · 4/17 즈음 풀 리허설"},
        {"m": "5월", "from": "2027-05-03", "theme": "조절 후 출전", "focus": "양 줄이고 강도는 짧게 · 5/14 Fri Pro Single"},
    ],
    "races": [      # newest first; "event" groups races for the personal-best mark
        {"date": "2025.11.08", "name": "HYROX Seoul", "event": "Hyrox · Open Single", "result": "1:15:00"},
        {"date": "2025.05.17", "name": "HYROX Incheon", "event": "Hyrox · Open Single", "result": "1:22:46"},
        {"date": "2025.04.27", "name": "서울하프마라톤", "event": "Half Marathon", "result": "1:33:52"},
        {"date": "2024.11.17", "name": "손기정 마라톤", "event": "10km", "result": "38:15"},
        {"date": "2023.11.19", "name": "손기정 마라톤", "event": "10km", "result": "39:14"},
        {"date": "2023.11.05", "name": "JTBC 마라톤", "event": "Full Marathon", "result": "3:28:06"},
        {"date": "2023.10.08", "name": "서울레이스", "event": "Half Marathon", "result": "1:36:16"},
    ],
    "paces": PACES,
    "targets": {"bed": "1:30", "wake": "9:00", "sleep": "7:30"},
    "weeks": weeks,
    "days": days,
}
with open(out_dir + "/plan.json", "w", encoding="utf-8", newline="\n") as f:
    json.dump(plan, f, ensure_ascii=False, indent=1)
print("plan.json:", len(weeks), "weeks,", len(days), "days")
for w in weeks:
    print(" ", w["label"], w["start"], w["run_km"], "km", "(+%g)" % w["bonus_km"], "회복" if w["recovery"] else "")
