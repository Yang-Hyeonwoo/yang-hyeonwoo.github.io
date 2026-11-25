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
HOLIDAYS = {D(2026, 12, 25): "성탄절", D(2027, 1, 1): "신정"}
MAINTENANCE = (D(2026, 12, 24), D(2027, 1, 1))   # year-end week: no deficit

# monday: (gym round-trip run weekdays, bonus gym round-trip run weekdays, Wednesday run, Wednesday detail, recovery week?)
WEEKS = {
    D(2026, 11, 23): ([3], [], "조깅 8km + 100m 빠르게 4번", "심박 150 이하 · 페이스는 보지 않기", False),
    D(2026, 11, 30): ([0, 3], [], "5km 기록 측정", "트랙 12.5바퀴 · 이 기록으로 모든 페이스를 다시 맞춰요", False),
    D(2026, 12, 7): ([0, 3], [], "4:35/km × 5분 × 4세트", "세트 사이 1분 조깅 · 페이스는 5km 기록으로 확정", False),
    D(2026, 12, 14): ([0, 3], [1], "4:35/km × 5분 × 5세트 + 100m 빠르게 4번", "세트 사이 1분 조깅", False),
    D(2026, 12, 21): ([0], [], "조깅 30분 + 100m 빠르게 6번", "회복 주 · 가볍게", True),
    D(2026, 12, 28): ([0, 3], [1], "4:40–4:45/km × 20분 연속", "템포런 · 끝까지 같은 페이스", False),
    D(2027, 1, 4): ([0, 3], [1], "300m 72–75초 + 100m 조깅 × 10–12세트", "인터벌 · 300/100", False),
    D(2027, 1, 11): ([0, 3], [1], "4:30/km × 8분 × 3세트", "세트 사이 2분 조깅", False),
    D(2027, 1, 18): ([0, 3], [1], "4:10/km × 1km × 5세트", "세트 사이 400m 조깅", False),
    D(2027, 1, 25): ([0, 3], [], "5km 기록 측정 (재측정)", "회복 주 · 10km 목표 시기를 여기서 판단", True),
}
WED_KM = {D(2026, 11, 23): 8, D(2026, 11, 30): 9, D(2026, 12, 7): 9, D(2026, 12, 14): 10, D(2026, 12, 21): 6,
          D(2026, 12, 28): 9, D(2027, 1, 4): 9, D(2027, 1, 11): 9, D(2027, 1, 18): 10, D(2027, 1, 25): 9}

# Running paces, oldest first. Add a row whenever they are re-set (5 km test, a race, a clear change in feel).
PACES = [
    {"date": "2026-11-25", "basis": "시작 추정값 · 11월 러닝 기록 기준",
     "easy": "5:50–6:15", "tempo": "4:40–4:45", "threshold": "4:35", "rep1k": "4:10", "rep300": "72–75초"},
]

# What each week is for, in one line (shown beside the week's name).
CONCEPT = {
    D(2026, 11, 23): "고강도 Hyrox Training 적응 · 러닝 마일리지 다시 쌓기 시작",
    D(2026, 11, 30): "5km 기록 측정으로 기준 페이스 잡기 · 왕복 러닝 주 2회 자리 잡기",
    D(2026, 12, 7): "역치 러닝 시작 · 프로 무게에 익숙해지기",
    D(2026, 12, 14): "역치 러닝 한 세트 더 · 주간 러닝 30km 채우기",
    D(2026, 12, 21): "회복 주 · 양을 줄이고 연말 컨디션 지키기",
    D(2026, 12, 28): "템포런 20분으로 오래 버티는 힘 기르기",
    D(2027, 1, 4): "300m 인터벌로 스피드 자극 · 거리는 유지",
    D(2027, 1, 11): "역치 구간 늘리기 (8분 × 3세트)",
    D(2027, 1, 18): "1km 인터벌로 10K 페이스 감각 만들기",
    D(2027, 1, 25): "회복 주 · 5km 재측정으로 두 달 점검",
}

days, weeks = {}, []
for monday, (commute, bonus, wed_run, wed_detail, recovery) in sorted(WEEKS.items()):
    label = week_label(monday)
    run_km = WED_KM[monday] + 10 * len(commute)
    weeks.append({"label": label, "start": monday.isoformat(), "concept": CONCEPT[monday], "recovery": recovery, "run_km": run_km,
                  "run_note": "왕복 러닝 %d회 %dkm + 수요일 %dkm" % (len(commute), 10 * len(commute), WED_KM[monday]),
                  "bonus_km": 10 * len(bonus)})
    for wd in range(7):
        d = monday + dt.timedelta(days=wd)
        items, kcal, carb = [], 2000, 200
        if d in HOLIDAYS:
            items.append({"k": "rest", "t": "휴무 · " + HOLIDAYS[d], "d": "대체 훈련 없음"})
        elif wd in HYROX:
            name, how = HYROX[wd]
            key = wd == 4
            items.append({"k": "hyrox", "t": "Hyrox Training · " + name, "d": "17:50 · " + how, "key": key})
            kcal, carb = 2300, 270
            if wd in commute:
                items.append({"k": "commute", "t": "체육관 왕복 러닝 10km", "d": "심박 150 이하" + (" · 끝에 100m 빠르게 4번" if wd == 0 else "")})
                kcal, carb = 2500, 320
            elif wd in bonus:
                items.append({"k": "commute", "t": "체육관 왕복 러닝 10km", "d": "보너스 · 컨디션 좋은 날만, 아니면 자전거", "opt": True})
            items.append({"k": "core", "t": "행잉 레그레이즈 3–4세트"})
        elif wd == 2:
            items.append({"k": "run", "t": wed_run, "d": "17:50 트랙 · " + wed_detail, "key": True})
            items.append({"k": "weights", "t": "상체 웨이트 45분", "d": "22:30 헬스장 · 23:30까지"})
            kcal, carb = 2500, 320
        else:
            items.append({"k": "free", "t": "자유", "d": "뛰고 싶은 날만 조깅 · 한 달에 두 번쯤 롱런 60–70분", "opt": True})
        if MAINTENANCE[0] <= d <= MAINTENANCE[1]:
            kcal += 200
            carb += 50
        days[d.isoformat()] = {"week": label, "items": items, "kcal": kcal, "carb": carb, "prot": 155, "fat": 65}

plan = {
    "updated": "2026-11-25",
    "race": {"name": "HYROX Incheon", "division": "Pro Single", "date": "2027-05-13",      # opening day of the event
             "date_note": "5/13 개막일 기준 · 대회 5/13–16 예정 · 출전일 미정"},
    "goals": [
        {"label": "Hyrox Pro Single", "value": "1:15:00", "sub": "2027년 5월 HYROX Incheon"},
        {"label": "10 km", "value": "37:59", "sub": "3월 말~4월 초 대회"},
        {"label": "Body", "value": "67–68 kg", "sub": "체지방 10–12% · 2월 말까지"},
    ],
    "roadmap": [
        {"m": "12월", "from": "2026-11-23", "theme": "적응 + 페이스 찾기", "focus": "체육관 왕복 러닝으로 거리 쌓기 · 5km 기록 측정 · 프로 무게 시작"},
        {"m": "1월", "from": "2027-01-04", "theme": "거리 + 스피드", "focus": "주 40km · 인터벌과 템포 번갈아 · 5km 재측정"},
        {"m": "2월", "from": "2027-02-01", "theme": "10K 대비 + 프로 무게", "focus": "1km 반복과 역치주 · 전 종목 프로 무게 · 감량 마무리"},
        {"m": "3월", "from": "2027-03-01", "theme": "10K 대회", "focus": "목표 페이스 훈련 · 하프 시뮬레이션 · 식사량 올리기"},
        {"m": "4월", "from": "2027-04-05", "theme": "레이스 리허설", "focus": "1km + 스테이션 반복 · 4/17 즈음 풀 리허설"},
        {"m": "5월", "from": "2027-05-03", "theme": "조절 후 출전", "focus": "양 줄이고 강도는 짧게 · 5/13–16 대회"},
    ],
    "races": [      # newest first; "event" groups races for the personal-best mark
        {"date": "2025.11.08", "name": "HYROX Seoul", "event": "Hyrox · Open Single", "result": "1:15:00"},
        {"date": "2025.05.17", "name": "HYROX Incheon", "event": "Hyrox · Open Single", "result": "1:22:46"},
        {"date": "2025.04.27", "name": "서울하프마라톤", "event": "Half Marathon", "result": "1:33:52"},
        {"date": "2024.11.17", "name": "손기정 마라톤", "event": "10 km", "result": "38:15"},
        {"date": "2023.11.19", "name": "손기정 마라톤", "event": "10 km", "result": "39:14"},
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
    print(" ", w["label"], w["start"], w["run_km"], "km", "(+%d)" % w["bonus_km"], "회복" if w["recovery"] else "")
