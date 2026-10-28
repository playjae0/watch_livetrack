# Marathon Live Tracker MVP

Apple Watch Series 10 Cellular가 위치를 Supabase에 전송하고 가족은 비공개 웹 링크에서 현재 관측 위치와 경로를 확인합니다. 승인된 범위는 [SPEC.md](SPEC.md), 테스트 기준은 [TEST_PLAN.md](TEST_PLAN.md)입니다. Watch의 30초/5초 전송과 백그라운드 실행은 목표이며 보장되지 않습니다. 실제 기기 검증 결과는 아직 없습니다.

## 구성 및 사전 준비

- `supabase/`: PostgreSQL 마이그레이션과 인증된 Edge Functions.
- `web/`: Next.js 뷰어 및 같은 출처 서버 프록시.
- `watch/`: watchOS 11 이상 독립 앱과 Xcode 프로젝트.
- `tests/`: 가상 좌표만 사용하는 PostgreSQL, 브라우저 및 Swift 테스트.

필요한 것: Supabase 프로젝트와 관리자 권한, Supabase CLI, Vercel 프로젝트, HTTPS 타일 제공자, Node.js 22 이상, Xcode와 Apple 개발자 서명 팀, watchOS 11 이상의 Series 10 Cellular. 서비스 키, 기기 비밀, 가족 링크를 채팅이나 Git에 넣지 마세요. 실제 서비스와 Apple 기기에는 아직 배포하지 않았습니다.

## 1. Supabase 배포

저장소 루트에서 의존성을 설치하고 Supabase CLI로 로그인한 뒤 프로젝트를 연결합니다.

```sh
npm ci
npm --prefix web ci
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase functions deploy start-session
supabase functions deploy ingest-location
supabase functions deploy stop-session
supabase functions deploy get-track
supabase functions deploy set-waiting-point
```

`supabase/config.toml`의 `verify_jwt = false`는 Supabase 사용자 JWT 대신 함수에서 기기/가족 bearer 비밀을 검증하기 위한 설정입니다. 익명 테이블 접근이나 공개 등록을 허용하지 않습니다. 함수는 Supabase가 제공하는 `SUPABASE_URL`과 레거시 `SUPABASE_SERVICE_ROLE_KEY`를 서버에서만 사용합니다. 프로젝트의 Edge Functions 기본 환경에 이 값이 있는지 확인하세요. 해당 레거시 service-role 키가 비활성화된 프로젝트에서는 재활성화 또는 서버 전용 키 방식 변경이 필요합니다.

모든 테이블은 RLS가 켜져 있고 `anon`, `authenticated`, `PUBLIC`에 테이블/RPC 권한을 주지 않습니다. 기기/뷰어 비밀의 SHA-256 해시만 DB에 저장합니다. 활성 세션은 기본 12시간, 가족 링크는 발급 후 30일이며, 만료/취소된 접근은 거부됩니다. 요청은 인증된 기기 또는 뷰어별 분당 120회, 배치 최대 100개, 본문 최대 64 KiB입니다. 잘못된 인증 요청에 대한 별도 IP 기반 차단은 제공하지 않으므로 운영 환경의 플랫폼 단위 제한을 확인하세요.

### 정리 일정 — 반드시 설정

Supabase Dashboard에서 Cron의 `pg_cron`을 활성화하고 SQL Editor에서 **한 번** 실행합니다.

```sql
select cron.schedule('marathon-tracker-cleanup', '17 * * * *',
  $$select public.cleanup_tracker();$$);
```

매시간 만료 세션을 정리하고 측정 시각 기준 7일이 넘은 좌표, 7일이 넘은 대기 지점과 오래된 요청 카운터를 삭제합니다. 따라서 저장된 좌표 삭제는 보통 7일에 최대 한 시간의 스케줄 지연이 더해집니다. 스케줄 실패나 프로젝트 중단도 삭제를 지연시키므로 Cron 실행 이력과 실패를 운영자가 확인해야 합니다. 무료 프로젝트는 비활성 상태에서 일시 중지될 수 있습니다. Cron을 사용할 수 없거나 프로젝트가 중지되면 운영자가 신뢰하는 **상시 실행 호스트의 시스템 cron**에서 아래 대안을 매시간 실행하고 실패를 감시하세요. Vercel 무료 플랜의 Cron 빈도 제한에 시간 단위 정리를 의존하지 마세요.

```cron
17 * * * * cd /absolute/path/watch_livetrack && /usr/local/bin/node --env-file=/absolute/path/.env.operator scripts/operator.mjs cleanup
```

호스트에 실제로 설치된 Node 경로를 사용하고 `.env.operator`의 파일 권한을 소유자만 읽을 수 있게 제한하세요. Supabase가 중지되어 있으면 외부 작업도 성공할 수 없으므로 프로젝트 복구 후 재실행해야 합니다.

## 2. Vercel 웹 배포

Vercel 프로젝트를 이 GitHub 저장소에 연결하고 Root Directory를 `web`으로 지정합니다. 다음 환경 변수를 Vercel에 설정합니다.

- `SUPABASE_URL`: `https://PROJECT.supabase.co`.
- `VIEWER_COOKIE_KEY`: 독립적으로 생성한 충분한 길이의 무작위 비밀(최소 32자). 모든 배포 인스턴스에서 동일하게 유지합니다. 변경하면 기존 브라우저 쿠키가 무효화됩니다.
- `VIEWER_ORIGIN`: 실제 웹 출처(예: `https://example.vercel.app`, 끝에 `/` 없음).
- `NEXT_PUBLIC_TILE_URL`: `{z}/{x}/{y}`를 포함하는 HTTPS 타일 템플릿.
- `NEXT_PUBLIC_TILE_ATTRIBUTION`: 선택한 제공자가 요구하는 출처 표시.

지도 타일은 빌드 시 환경 변수가 포함되므로 변경 후 재배포합니다. 토큰을 타일 서버에 유출하지 않도록 `Referrer-Policy: no-referrer`가 적용됩니다. **이 정책에서 사용을 허용하는** 제공자와 요금제/키/출처 표기를 직접 선택하세요. 기본 `tile.openstreetmap.org` 서비스는 현재 웹 요청의 Referer를 요구하므로 이 설정과 호환되지 않습니다. 타일 제공자는 타일 좌표와 접속 IP를 볼 수 있습니다. 분석 도구를 설치하지 마세요.

가족 링크 형식은 `https://YOUR-HOST/track#VIEW_TOKEN`입니다. fragment는 HTTP 요청이나 타일 요청에 전송되지 않습니다. 페이지가 토큰을 같은 출처 서버로 보내 검증하고 암호화된 `HttpOnly`, `Secure`, `SameSite=Strict` 쿠키를 발급받은 뒤 주소에서 fragment를 제거합니다. 뷰어 API 응답은 `no-store`, `no-referrer`이며 POST는 Origin을 확인합니다. 링크는 bearer 비밀이므로 신뢰할 수 있는 가족에게만 전달하세요. 쿠키의 암호화가 유출된 링크를 무효화하지는 않습니다. 유출 시 아래 `rotate-view`를 실행하세요.

## 3. 소유자가 기기 등록

Supabase 프로젝트 URL, **레거시 service-role 키**, Vercel 웹 출처를 로컬의 Git에서 제외된 `.env.operator` 파일에 설정합니다. 예시는 [.env.example](.env.example)을 참고하고 파일 권한을 `chmod 600 .env.operator`로 제한하세요. 이 키는 운영자 호스트에만 두고 Vercel 공개 변수나 Watch 앱에 넣지 않습니다.

```sh
node --env-file=.env.operator scripts/operator.mjs enroll
```

출력되는 `device_id`, `device_secret`, `viewer_link`는 생성 시 한 번만 표시됩니다. 신뢰할 수 있는 안전한 방법으로 별도 보관하고 셸 기록, CI 로그, 스크린샷에 남기지 마세요. 기기 비밀과 가족 링크는 서로 다릅니다. 둘 다 다시 조회할 수 없습니다. 분실한 경우 새 기기를 등록하거나 가족 링크를 회전합니다.

```sh
node --env-file=.env.operator scripts/operator.mjs rotate-view DEVICE_UUID
node --env-file=.env.operator scripts/operator.mjs revoke DEVICE_UUID
```

뷰어 링크 회전은 이전 링크와 이전 쿠키를 즉시 무효화하고 새 링크의 유효기간을 30일로 설정합니다. 기기 취소는 해당 기기 및 가족 링크 접근을 모두 거부합니다. 취소는 되돌리지 않으므로 새 기기를 등록하세요. 데이터베이스 관리자가 `devices.view_expires_at`을 직접 조정해 더 이른 만료를 설정할 수 있습니다.

## 4. Watch 앱 설치와 사용

1. `watch/Config.example.xcconfig`를 `watch/Config.xcconfig`로 복사하고 실제 `SUPABASE_FUNCTIONS_URL`, 개발자 팀, 고유 Bundle ID를 설정합니다. `Config.xcconfig`는 Git에서 제외됩니다. URL은 `https:$(SLASH)$(SLASH)PROJECT.supabase.co/functions/v1` 형태를 유지합니다.
2. `watch/MarathonTracker.xcodeproj`를 Xcode에서 열고 서명 팀 및 실제 Watch 대상을 선택합니다. 필요 시 Xcode의 Signing & Capabilities에서 Background Modes → Location updates가 활성화되었는지 확인합니다. Info.plist의 `UIBackgroundModes`에 `location`이 선언되어 있습니다.
3. Watch에 설치하고 처음 표시되는 설정 화면에 **기기 비밀**을 입력합니다. 기기 비밀은 Keychain의 기기 전용 항목에 저장되며 앱 번들에 포함하지 않습니다.
4. `Start sharing`을 누르고 위치 사용을 허용합니다. 권한 대화상자가 닫힌 뒤 다시 `Start sharing`을 누릅니다. 기존 저장 세션은 자동으로 실행 중이라고 표시하지 않으며 `Resume sharing`을 눌러야 합니다.
5. 가족이 저장한 링크를 열고 지도를 탭하면 대기 지점이 하나 설정됩니다. Watch는 다음 성공적인 시작/업로드 응답에서 지점 변경 또는 삭제를 받습니다. 거리는 GPS와 지점 사이 **직선 거리**이며 오래된 지점 또는 GPS는 `old`로 표시합니다.
6. `Boost 1 min`은 새 GPS 관측을 요청하고 대기 중 좌표를 즉시 전송 시도하며 60초 동안 5초 주기를 목표로 합니다. 다시 누르면 60초가 연장됩니다. 햅틱은 버튼 입력만 확인합니다. `Last upload`은 서버 응답을 받은 시각이며 관측 시각과 다릅니다. `Stop sharing`은 로컬 위치 수집을 중지하고 서버 중지를 시도합니다. 오프라인이면 `Retry stop` 상태가 저장됩니다.

앱은 `CLLocationManager`의 지속 위치 업데이트, `allowsBackgroundLocationUpdates` 및 watchOS 10+ `CLBackgroundActivitySession`을 사용합니다. 수집은 포그라운드의 명시적인 시작/재개 이후에만 시작합니다. `requestLocation()`은 지속 업데이트 중 새 요청을 보장하지 않으므로 부스트 시 거리 필터를 제거하고 후속의 새로운 관측을 기다립니다. 정확한 즉시 응답, 절전 중 주기, LTE 지속 시간은 시스템과 환경에 달려 있습니다. Workout 세션을 생성하지 않습니다. Apple 문서: [백그라운드 위치 업데이트](https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background), [백그라운드 활동 세션](https://developer.apple.com/documentation/corelocation/clbackgroundactivitysession-3mzv3), [Watch 백그라운드 세션](https://developer.apple.com/documentation/watchkit/enabling-background-sessions).

### 오프라인과 데이터 정책

각 좌표에는 클라이언트 UUID와 세션별 순번이 있으며 원자적으로 파일에 저장됩니다. 확인된 ID만 큐에서 제거하고, 중복 전송은 서버에서 동일 내용인지 검사합니다. 네트워크 오류에는 지수 백오프와 지터를 사용하며, 위치 이벤트·네트워크 복구·포그라운드 복귀 및 대기 작업의 단발 재시도가 실행 기회가 될 수 있습니다. 시스템이 앱을 중단하면 재시도는 지연됩니다. 손상된 큐나 저장 실패 시 전송을 중단하고 오류를 표시합니다.

예외적으로 큐가 2,000개를 넘으면 가장 오래된 미전송 좌표부터 버리고, 7일보다 오래된 좌표도 버립니다. 서버에서 중지를 확인한 뒤에는 남은 미전송 좌표를 버립니다. 새로 시작된 서버 세션은 이전 세션의 미전송 좌표를 받을 수 없으므로 재개 과정에서 기존 세션이 이미 만료됐다면 해당 큐를 버립니다. 대량 오프라인 기록의 완전한 보존은 보장하지 않습니다. 화면은 측정 시각이 90초 이상 지난 좌표를 오래된 상태로 표시하며 지연 도착 배치는 현재 위치를 과거로 되돌리지 않습니다. 경로에서 두 관측점 사이의 거리가 `15 m/s × 경과 시간 + 양쪽 정확도`보다 크면 선을 끊습니다. 새 좌표를 보간하거나 생성하지 않습니다.

## 테스트

```sh
npm ci && npm --prefix web ci
npm run typecheck
npm test                     # DB가 없으면 DB 테스트 2개는 건너뜀
npm run db:test              # 로컬 임시 PostgreSQL로 DB 테스트 실행. PG_BIN 지정 가능
npm run web:build
npx playwright install chromium
npm run test:e2e             # 임시 PostgreSQL/HTTPS mock + Next + Chromium
npm run test:watch           # macOS에서 Swift 핵심 테스트 및 watchOS SDK 타입 검사
npx --yes deno check supabase/functions/*/index.ts
```

`db:test`와 `test:e2e` 기본 PostgreSQL 경로는 macOS Homebrew의 `/opt/homebrew/opt/postgresql@16/bin`입니다. 다른 설치는 `PG_BIN`으로 `initdb`, `pg_ctl`이 들어 있는 디렉터리를 지정합니다. 전체 Xcode 빌드와 서명은 Xcode 라이선스 동의 후 다음 명령으로 확인하세요.

```sh
xcodebuild -project watch/MarathonTracker.xcodeproj -scheme MarathonTracker -destination 'generic/platform=watchOS' CODE_SIGNING_ALLOWED=NO build
```

테스트 결과와 환경 제한은 [docs/VALIDATION.md](docs/VALIDATION.md), 실제 Series 10 Cellular에서 실행할 절차와 기록표는 [docs/HARDWARE_TESTS.md](docs/HARDWARE_TESTS.md)에 있습니다. 실제 기기 시험을 통과하기 전에는 대회 사용 준비가 완료된 것으로 간주하지 않습니다.
