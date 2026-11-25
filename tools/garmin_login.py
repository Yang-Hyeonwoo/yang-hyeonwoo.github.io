"""Connect the site to Garmin, once, from this PC.

    py -3.12 tools/garmin_login.py

Asks for the Garmin e-mail and password here in the terminal (and the code Garmin mails or texts, if it
asks for one), logs in, and hands the resulting login tokens straight to GitHub as the repository secret
GARMIN_TOKENS, where the hourly sync (.github/workflows/garmin.yml) reads them. The password is not kept
anywhere, and the tokens are neither shown nor written to a file. Needs the GitHub CLI (gh), signed in.

Run it again whenever the site says the Garmin connection has been lost.
"""
import getpass
import subprocess
import sys
from datetime import date

REPO = 'Yang-Hyeonwoo/yang-hyeonwoo.github.io'


def secret(name, value):
    r = subprocess.run(['gh', 'secret', 'set', name, '--repo', REPO], input=value, text=True, capture_output=True)
    if r.returncode:
        print(f'GitHub에 저장하지 못했어요: {r.stderr.strip()}')
        sys.exit(1)


def main():
    try:
        from garminconnect import Garmin
    except ImportError:
        print('먼저 설치가 필요해요:  py -3.12 -m pip install garminconnect==0.3.20')
        return 1
    print('Garmin Connect 계정으로 로그인해요. 비밀번호는 저장하지 않아요.')
    email = input('Garmin 이메일: ').strip()
    password = getpass.getpass('Garmin 비밀번호 (입력해도 화면에 보이지 않아요): ')
    g = Garmin(email, password, prompt_mfa=lambda: input('Garmin이 보낸 인증 코드: ').strip())
    try:
        g.login()
    except Exception as e:                      # wrong password, too many tries, Garmin blocking the request...
        print(f'로그인하지 못했어요: {type(e).__name__}: {e}')
        return 1
    del password

    # Does Garmin hand out a new refresh token each time the old one is used? Then the sync has to save it back.
    rotates = None
    try:
        before = g.client.di_refresh_token
        g.client._refresh_di_token()
        rotates = g.client.di_refresh_token != before
    except Exception as e:
        print(f'(토큰 갱신 방식은 확인하지 못했어요: {type(e).__name__})')

    secret('GARMIN_TOKENS', g.client.dumps())
    print('연결했어요. 로그인 토큰을 GitHub 저장소의 비밀 값 GARMIN_TOKENS로 넣었어요.')
    try:
        runs = g.get_activities_by_date(date.today().isoformat())
        print(f'확인: 오늘 Garmin에 올라온 활동 {len(runs)}건이 보여요.')
    except Exception as e:
        print(f'(오늘 활동은 읽어보지 못했어요: {type(e).__name__})')

    if rotates:
        print('\n이 계정은 토큰을 쓸 때마다 새 토큰으로 바뀌어요 (갱신 방식: 교체).')
        print('동기화가 새 토큰을 스스로 저장하려면, 이 저장소의 Secrets 쓰기 권한만 가진 GitHub 토큰이 하나 더 필요해요.')
        w = getpass.getpass('그 토큰을 붙여넣어 주세요 (아직 없으면 그냥 Enter): ').strip()
        if w:
            secret('SECRET_WRITER', w)
            print('저장했어요. 이제 손댈 것이 없어요.')
        else:
            print('건너뛰었어요. 연결이 끊기면 이 도구를 다시 실행하면 돼요.')
    elif rotates is False:
        print('갱신 방식: 유지 (토큰이 바뀌지 않아서 추가 설정이 필요 없어요).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
