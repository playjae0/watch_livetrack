# Implementation plan
1. Supabase: private RLS schema, transactional authenticated RPC, bounded validation/idempotency/cursors, Edge entrypoints, operator enrollment and cleanup.
2. Next.js: fragment-to-HttpOnly cookie exchange, no-store proxy, Leaflet mobile viewer, visibility-aware polling, measurement-based staleness, waiting point.
3. watchOS: standalone SwiftUI project, verified Core Location background API, Keychain provisioning, atomic durable queue, event-driven scheduling/boost/backoff, resume/stop lifecycle.
4. Integration: real local PostgreSQL API tests, web tests/build, Swift core tests and available SDK compilation; deployment and pending hardware test report.

Scope: SPEC v1.0 only. Remote: playjae0/watch_livetrack, branch feat/marathon-mvp.
