# Marathon Live Tracker — SPEC v1.0
Date: 2026-10-28. Status: approved MVP scope. This document is normative.

## 1. Goal and hard constraints
A standalone Apple Watch Series 10 Cellular app sends the runner's GPS positions directly over cellular to Supabase. Family members open a private link in Android/iPhone browsers to see **current location and traveled path**. The runner does not need an iPhone during tracking, and may independently run Apple's Workout app.

Strictly minimize features, CPU, GPS, LTE wakeups and battery consumption. No maps, heart rate, pace, distance traveled, incoming messages, notifications, alerts, battery-sharing, or ETA on the Watch. Do not create HKWorkoutSession or require Apple's Workout app. No chat, account system for family, push alerts, geofences, safety/SOS features, or extra product features.

## 2. Confirmed behavior
### Watch
- Idle view: one large "Start sharing" button.
- Active view: clear status, a **large "Boost 1 min" button**, a separate "Stop sharing" control, and a compact "last upload" indicator. Use large hit targets, high contrast, minimal redraws.
- Start initiates own Core Location tracking after permission and authenticated session setup. Start does **not** launch or depend on Workout.
- Normal mode: **target** upload approximately every 30 seconds.
- Boost: pressing button immediately requests a fresh position and attempts upload; for **60 seconds**, target uploads every **5 seconds**, then automatically revert to normal. A second press during boost resets the 60-second deadline; do not add a permanent 5-second toggle.
- Haptic feedback confirms button input, **not server receipt**. Distinguish queued/attempted/successful upload in state; do not misreport delivery.
- No Watch map. If family has tapped a point on the web map, show **straight-line distance** from the Watch's last valid GPS fix to that family-selected point (e.g. "850 m straight line"). Show "--" until destination/fix exists; if the destination is old or cleared, update accordingly. This is not a route ETA.
- The Watch only receives selected destination coordinates piggybacked on existing upload/start responses; **no continuous polling** for family coordinates. This means display may lag until a successful request.
- Tracking persists while screen sleeps **where watchOS permits**, with correct location authorization/background mode/session lifecycle. Actual 5s/30s wall-clock delivery and 4+ hour background execution are **not guaranteed**.
- On interrupted network, persist unsent points and retry with backoff; never fabricate new GPS fixes. On relaunch, distinguish saved session from actually running tracking and offer a safe resume path if required.

### Family web
- Mobile-first, no installation or login. Stable secret family link, e.g. /track/{viewToken}, which resolves to currently active session for the enrolled device. Before start show "Not sharing"; after stop show "Sharing ended" (no active location). Access automatically expires/revokes when configured.
- Leaflet map with current position marker and recorded path polyline, last observation timestamp, and clearly marked stale data if >90 seconds since the latest fix received.
- Tapping the map sets **one family-selected waiting point**, overwriting the previous point. Show that point on the map. A small "Clear point" action removes it. Do not ask for family device GPS permission; don't track family movement. The Watch gets waiting point in next upload response.
- Poll every 10–15s as a simple baseline; avoid a permanent realtime connection. Respect page visibility and handle network errors. No unrelated widgets.
- Distinguish GPS measurement time (recorded_at) from server arrival time (received_at). A delayed batch must not be shown as current.

## 3. Technology and platform
- watchOS 11+ SwiftUI standalone Watch app, Core Location, URLSession, minimal persistent file queue (atomic writes) or SwiftData if proven suitable. App must build in Xcode. Use Keychain for device credential.
- Carefully validate Core Location support on watchOS 11+, including required background location capability, Info.plist usage descriptions, authorization paths, CLBackgroundActivitySession availability/behavior and location delivery lifecycle. Implement only verified supported APIs. No background timer guarantee. Prefer event-driven upload triggers plus time gating while executing.
- Supabase PostgreSQL + Edge Functions (TypeScript/Deno) with privileged access restricted to server; Vercel-hosted Next.js TypeScript viewer with Leaflet and a tile provider configured through environment variables; respect tile usage policy.
- HTTPS only. Production URLs configured, never hardcoded secrets.

## 4. Minimal data model
devices: id UUID PK; device_secret_hash; view_token_hash; created_at; revoked_at.
tracking_sessions: id UUID PK; device_id FK; status (active/stopped/expired); started_at; ended_at; expires_at; mode_expires_at nullable.
location_points: id UUID PK (client-generated idempotency key); session_id FK; seq integer; latitude; longitude; horizontal_accuracy_m; recorded_at; received_at server timestamp; unique(session_id,seq).
waiting_points: device_id PK FK; latitude; longitude; updated_at; nullable/cleared semantics.

Indexes: (session_id,recorded_at,seq); active session by device. RLS enabled on all tables, **no public table reads/writes**. Functions do auth before using service role. Enforce bounded retention of points (default 7 days) and expire links/sessions under an explicit documented cleanup schedule. Note free-tier scheduling limitations and document a deployable alternative if necessary.

## 5. Authentication / enrollment
- One-time, owner-controlled device enrollment: provision a secret using an operator-run CLI or protected one-time enrollment code, not a public unrestricted register endpoint. Store hashed device credential and hashed viewer token; show the raw viewer link only at creation time for family to save.
- Upload/start/stop authenticate device secret; view/get track/set/clear waiting point authenticate viewer token scoped to this device; token has high entropy and can be revoked/rotated via operator instructions.
- **Viewer URL is a bearer secret**: no third-party analytics; avoid printing tokens in logs; use Referrer-Policy: no-referrer and Cache-Control: no-store; do not leak token to third-party tile service via referer (prefer URL fragment for secret or a same-origin server-side session/cookie exchange where feasible). Document exact chosen approach. Security must work in deployment, not just mock.
- Validation: [-90,90] lat, [-180,180] lon, timestamps within reasonable bounds, 0<=accuracy<=100m for accepted GPS fixes, max batch 100, payload size/rate limits. Idempotent ingestion. Explicit 401/403/404/409/429 handling.

## 6. API contract (actual names may match these)
POST /start-session (device auth): creates/reuses active session; response includes session_id, waiting_point nullable, server_time.
POST /ingest-location (device auth): session_id, [id,seq,lat,lon,accuracy,recorded_at]; returns accepted_count, server_time, waiting_point nullable, waiting_point_updated_at.
POST /stop-session (device auth): ends session idempotently.
GET /get-track (viewer auth): status, latest valid point, ordered bounded route, last_received_at; paginated/incremental cursor for route to avoid unbounded payload.
POST /set-waiting-point (viewer auth): latitude,longitude; overwrite prior point; optional clear action.
One-time enrollment is operator-controlled and documented separately.

Do not trust unverified session IDs, client times, or viewer tokens. Ingest only into authenticated device's active session. Point server timestamps are assigned server-side. Reject uploads after stop/expiry; avoid N+1 calls and unnecessary full-route queries.

## 7. Network, battery, correctness
- Location acquisition and network upload are **separate**. Do not power-cycle GPS for each transmission; do not keep a high-frequency timer alive in the background. Rate limit server submissions on location callbacks when possible.
- Normal target 30s, boost target 5s for 60s only when watchOS allows. No duplicate 'fresh' sample when no new GPS observation. Batch queue and network retries (exponential backoff + jitter).
- Minimize full UI updates and haptics; use lightweight JSON. No constant Watch screen-on, no Watch maps.
- Local queue survives crash/relaunch; cap size and define truncation policy. Track failed/inflight/acked states. Only delete points after server ack. Timestamp and accuracy filtering; do not draw GPS jumps from implausible/invalid samples without documenting policy.
- Distance calculation uses haversine/Core Location distance on two coordinates, labeled **straight-line**. Display can be stale.
- Mobile viewer must show stale status clearly and not interpolate invented live coordinates.

## 8. Project layout
watch/ (Xcode project + Swift app files)
web/ (Next.js)
supabase/migrations/; supabase/functions/
tests/ (API + web)
SPEC.md; AGENTS.md; TEST_PLAN.md; README.md; .env.example
Never commit real credentials.

## 9. Acceptance
- Mock End-to-End: secure enrollment, session start, ingest with idempotency, viewer path/map, waiting point -> next Watch upload response, boost mode state transition, stop/invalidate flow.
- Build/typecheck/tests for each available environment.
- Actual Watch: iPhone left behind, LTE only, watch screen asleep, Workout app both on and off, long-run/battery results tracked separately. No claim of guaranteed 5s/30s or background uptime without hardware evidence.
- User-facing functionality is limited to this specification; do not add speculative features.
