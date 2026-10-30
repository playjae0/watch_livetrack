# TEST_PLAN.md — Marathon Live Tracker

## Approach
Use mock coordinates in tests (never personal real-location logs). Test API/web automatically; only a real Apple Watch Series 10 Cellular can establish background/battery behavior. Log device model, watchOS version, battery health, cellular coverage, start/end battery, Workout running yes/no and location/upload timestamps. Do not represent targets as guarantees.

## A. Automated checks (must implement)
| ID | Test | Pass condition |
| --- | --- | --- |
| A01 | Provision device | operator authorization required, credential stored hashed |
| A02 | Start session | authenticated device succeeds; unauthenticated rejected |
| A03 | Ingest validation | invalid latitude, longitude, accuracy and stale timestamps rejected |
| A04 | Idempotency | duplicate point_id/seq does not duplicate route |
| A05 | Auth isolation | another device/view token cannot access or change session |
| A06 | Viewer lifecycle | before start inactive; during active shows route; after stop no active live location |
| A07 | Waiting-point | viewer tap overwrites old point; clear works; next Watch upload response contains new/cleared value |
| A08 | Boost logic | immediate attempt, target 5s while active, automatically returns to 10s after 60s; repeated press resets 60s |
| A09 | Network resilience | offline points persisted; reconnect retries; ack removes only accepted points |
| A10 | Expiry and privacy | expired/revoked token denied, no public SQL read, no secret logs, no-store responses |
| A11 | Web stale status | >=90s from latest valid measurement shows stale even if batch was recently received |
| A12 | Route ordering | timestamps/seq ordered; paginated route; no fabricated positions |
| A13 | Straight-line distance | known coordinates produce expected haversine distance and 'straight-line' label |
| A14 | Stopped upload | rejects further points; stop idempotent |
| A15 | Resource hygiene | no unnecessary frequent polling/upload in inactive state, boost auto expires |

## B. Physical Watch test sequence
1. Build and deploy standalone app via Xcode; grant correct location permissions; pair/setup once.
2. Start sharing without launching Apple Workout. Confirm first GPS upload and web display.
3. Leave iPhone behind/out of range; confirm LTE-only uploads with Watch Wi-Fi not silently replacing cellular.
4. Sleep Watch display for 30+ min. Verify latest observation freshness and continuity.
5. Repeat with Apple's Workout running simultaneously for 30+ min.
6. Activate boost: log tap haptic, first fresh location attempt, 60s switch back; measure actual inter-arrival times; confirm no fixed 5s guarantee.
7. From family web tap waiting point; confirm Watch shows updated straight-line distance only after next successful exchange. Clear point and confirm removal.
8. Disable LTE briefly, keep moving, restore; verify buffered replay with original recorded timestamps and no duplicate route.
9. Stop sharing: no further uploads; viewer shows ended state and no continuing live position.
10. Extend runs to 1h then 2h then race-duration 4–5h only after earlier checks pass. Record battery at start/end and drain/hour; target >=20% battery remaining after 4h, not an assumed measured fact.

## C. Metrics/report
- GPS sample count, accepted count, deduplicated/rejected count, maximum offline queue depth
- Intervals between recorded_at, intervals between received_at, p50/p95 upload lag and max gap
- Percentage of active minutes with a fresh (<90s) observation on viewer, under stated cellular conditions
- Watch battery start/end, drain %/hour, LTE signal/environment, screen state, Workout concurrent or not
- Defects, reproducible steps, actual observed versus target behavior; screenshots only if consented and redact location/token.

## D. Release gate
Do not describe app as race-ready until LTE-alone, sleeping-screen, Workout coexistence and extended battery tests pass. If execution is suspended, report actual watchOS limitation and revise approach only with owner approval. Keep scope minimal.
