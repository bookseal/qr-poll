# 배포 (ssh prod + Cloudflare Tunnel)

대상: Ubuntu 20.04 (aarch64, Oracle Cloud), Node 18. 앱은 단일 Node 프로세스(포트 3000).
공개 도메인: **https://qr-poll.physical-spark.com**

> 이 서버는 포트 80/443을 k8s ingress가 점유해서 nginx 리버스 프록시 대신
> **Cloudflare Tunnel**로 붙였다. 인바운드 포트/방화벽/Oracle 보안목록을 전부 우회하고
> `localhost:3000`으로 바로 연결된다. (nginx 방식은 `nginx.conf` 참고 — 포트가 비어있는 서버용.)

## 1. 코드 배치 + 앱 서비스
```bash
ssh prod
git clone https://github.com/bookseal/qr-poll-with-your-audience.git ~/qr-chat
cd ~/qr-chat
npm ci --omit=dev
node seed/seed.js                      # (선택) 예시 데이터

sudo cp deploy/qr-chat.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now qr-chat
curl -s localhost:3000/api/9587463 | head    # 응답 확인
```

## 2. Cloudflare Tunnel
```bash
# 설치 (arm64)
curl -fsSL -o /tmp/cf.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
sudo dpkg -i /tmp/cf.deb

# 인증 → 브라우저에서 physical-spark.com zone authorize (cert.pem 생성)
cloudflared tunnel login

# 터널 생성 + DNS 자동 등록(CNAME)
cloudflared tunnel create qr-chat
cloudflared tunnel route dns qr-chat qr-poll.physical-spark.com
```

`/etc/cloudflared/config.yml` (deploy/cloudflared-config.example.yml 참고):
```yaml
tunnel: <TUNNEL_ID>
credentials-file: /etc/cloudflared/<TUNNEL_ID>.json
ingress:
  - hostname: qr-poll.physical-spark.com
    service: http://localhost:3000
  - service: http_status:404
```

서비스로 상시 실행:
```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

## 3. 확인
```bash
curl -s https://qr-poll.physical-spark.com/api/9587463 | head
```
- 발표자: https://qr-poll.physical-spark.com/present/9587463
- 폰으로 QR 스캔 → `/r/9587463` → 익명 전송 → 발표자 화면 실시간 반영

## 운영 업데이트

PR과 `main`에서 GitHub 호스팅 러너의 **QR Poll tests**가 실행된다.
배포할 커밋은 `main`의 **push** CI가 성공한 전체 SHA를 사용한다.
행사가 진행 중이면 참여자의 SSE 연결을 끊는 재시작은 행사 이후에 한다.

```bash
ssh prod
cd /home/ubuntu/qr-chat
git fetch origin main
sha="$(git rev-parse FETCH_HEAD)"
git show "$sha:deploy/deploy.sh" | bash -s -- "$sha" --check
git show "$sha:deploy/deploy.sh" | bash -s -- "$sha"
```

`--check`는 운영 체크아웃을 바꾸거나 서비스를 재시작하지 않고 SHA와 CI 결과를 확인한다.
실제 배포에는 서버에서 `sudo systemctl restart qr-chat` 권한이 필요하다.
스크립트는 새 의존성을 먼저 설치하고 검증된 SHA를 체크아웃한다. `events/`의 운영 전용
파일이나 `data/`를 덮어쓰지 않으며, 로컬 수정과 충돌하면 중단한다.
재시작 후 로컬 참여 페이지, 데모 이벤트 API 및 SSE 연결 확인에 실패하면 이전 코드와
의존성을 복구한다. 배포된 체크아웃의 detached HEAD는 정상이다.

배포 후 공개 도메인에서 참여 페이지와 발표자 화면을 확인한다.

## 참고: 왜 Vercel이 아니라 self-host인가
실시간 채팅은 지속 연결(SSE/WebSocket)이 핵심인데 Vercel은 서버리스라 지속 연결이 약하고,
실시간엔 Ably/Pusher/Supabase 같은 외부 서비스 + 외부 DB가 추가로 필요하다. 서버·도메인을
이미 가진 지금은 단일 Node 프로세스 + Cloudflare Tunnel이 부품이 가장 적고 단순하다.

## FutureReady Campus 병행 운영 (2026-10-14)

기존 QR Poll/QR Chat 도메인을 유지하면서 `qr-poll.futurereadycampus.com`을
같은 `localhost:3000`에 연결한다. `PUBLIC_ORIGIN=https://qr-poll.futurereadycampus.com`
을 서비스 환경에 설정하면 QR, 공유·내보내기, 메일 링크를 새 주소로 생성한다.
이 값은 비밀이 아니지만 실제 서비스 설정 파일은 저장소에 커밋하지 않는다.

Cloudflare Access의 `qr-poll-team` 앱은 위 세 호스트 각각의 `admin*`, `presenter*`,
`new*`, `demo*`를 팀 Allow 정책으로 보호한다. 참가 경로 `/r`, `/api`, `/stream`,
`/msg`, `/react`, `/vote`, `/qr`와 참가 기록 이전 경로 `/identity`는 공개다.
`/presenter`는 로그인 후 운영자 양식을 제공한다. 공개 홈에서 이 페이지로 직접
이동해야 Access 로그인을 거칠 수 있다(공개 홈의 fetch 요청으로 로그인하지 않는다).
기존 이벤트 adminKey 검사는 유지한다. `/demo`도 관리자 키로 연결하므로 보호한다.

### 기존 참가자 기록

새 행사 화면의 “기존 주소에서 참여한 기록 가져오기”에서 이전 주소를 선택한다.
같은 브라우저의 기존 origin을 팝업으로 열어 행사별 작성자·투표 토큰과 표시 상태만
가져온다. 정확한 origin, 팝업 창, 무작위 nonce를 모두 검증하는 postMessage를 사용한다.
토큰은 URL·서버·로그에 보내지 않는다. 새 origin에는 행사별 토큰으로 저장해 다른
행사의 참가 기록을 덮어쓰지 않는다. 기존 호스트의 저장값도 삭제하지 않는다.

이미 새 주소에서 다른 식별값으로 참여한 행사는 병합하지 않고 안내한다. 기존에
참여했던 기기·브라우저의 저장값이 없으면 복구할 수 없다. QR Poll과 QR Chat에
각각 다른 참가 기록이 있으면 실제 참여한 주소를 골라야 한다.

### 검증과 복구

- `npm test`: 기존 자체 검사와 participant-identity 회귀 검사.
- 격리한 행사와 새 브라우저에서 구 호스트 글 작성·투표 → 팝업 가져오기 →
  새 호스트에서 본인 글 수정·투표 변경(추가 표가 아닌 기존 표 이동) → 구 호스트 동작 확인.
- 비로그인 상태에서 세 호스트의 운영자 경로가 Access로 이동하고, 공개 참여·API·SSE가
  통과하는지 확인한다. 대소문자·URL 인코딩 경로도 확인한다.
- 배포 전 events/data 및 Tunnel 설정을 서버의 접근 제한된 백업 위치에 보존한다.
  코드 복구 시 해당 커밋의 소스만 복원하며 events/data를 reset 또는 삭제하지 않는다.
- 새 라우트 제거 시 기존 DNS와 데이터는 그대로 둔다. 새 Access 앱은 DNS/라우트를
  정리한 뒤 삭제한다. 기존 Studio Access 앱은 삭제하지 않는다.
