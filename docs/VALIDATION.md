# 검증 기록 — 2026-10-28 (Asia/Seoul)

실제 좌표를 사용하지 않고 로컬에서 확인했습니다.

- `npm run db:test`: 임시 PostgreSQL에서 API 수명주기, 인증 격리, 입력 검증, 멱등성, 부분 배치 롤백, 대기 지점, 도착 커서, 페이지 제한, 중지, 만료, 권한 거부, 속도 제한 통과.
- `npm test`: 웹 순서·오래된 위치·거리 및 HTTP/운영자 입력 검증 통과. DB가 없는 이 명령에서는 DB 전용 2개를 건너뛰며 위 `db:test`에서 별도 실행.
- `npm run typecheck`, `npm run web:build`: TypeScript 및 Next.js 프로덕션 빌드 통과.
- `npm run test:e2e`: 임시 PostgreSQL과 HTTPS mock Edge, 실제 Next 서버 및 Chromium으로 링크 교환, 쿠키 보안 속성, CSRF 거부, 지도 탭·지우기, 서버 응답의 대기 지점, 오래된 관측, 숨긴 페이지 폴링 중지, 중지 후 화면을 확인.
- `npm run test:watch`: Swift 핵심의 부스트 기한/재입력/백오프, 저장·재로드, 부분 ack, 큐 제한, GPS 필터, 직선 거리 통과. 실제 watchOS SDK에서 Swift 6 엄격 동시성 타입 검사 및 plist/pbxproj 구문 검사 통과.
- `npx --yes deno check supabase/functions/*/index.ts`: 각 Edge Function 타입 검사 통과.

이 Mac에서 Xcode 라이선스가 아직 수락되지 않아 `xcodebuild ... CODE_SIGNING_ALLOWED=NO build`는 라이선스 메시지와 종료 코드 69로 중단되었습니다. Swift SDK 타입 검사는 전체 앱 빌드·서명·설치 검증을 대신하지 않습니다. 실제 Supabase/Vercel 배포, 실제 Series 10 Cellular의 LTE·위치 권한·절전·Workout 공존·장시간 배터리는 미실행입니다. [실기기 시험표](HARDWARE_TESTS.md)를 참고하세요.
