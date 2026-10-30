# AGENTS.md — Instructions to Codex

You are implementing the approved **Marathon Live Tracker** MVP. Read SPEC.md and TEST_PLAN.md before changes. These are binding; preserve minimal scope and avoid feature creep.

## Workflow
1. Inspect repository. Create a working implementation plan, then implement in order: Supabase schema/auth/API -> secure viewer + mock data -> Watch native app -> integration -> deployment docs.
2. Prefer small, auditable modules, TypeScript strict mode, Swift concurrency best practices, reproducible migrations and tests.
3. Run all build/lint/typecheck/unit/integration tests possible. Report exact commands/results and what could not run (notably Xcode without macOS/watch hardware).
4. Do not silently claim completion if watchOS API semantics, entitlement, permissions, certificate signing, LTE behavior, and workout coexistence are unverified. Research platform-specific APIs against current Apple docs and use compile-time guards where needed.
5. Report blockers precisely, including external credentials/project IDs and user-side deployment actions. Never ask user to paste API secrets into chat or commit them.
6. Favor safe tests, mocks and fixtures before real location transmission. Do not expose actual user coordinates in tests or logs.

## Non-negotiable rules
- Standalone Watch app works without iPhone while tracking; no HKWorkoutSession; Apple's Workout app is optional and independent.
- Watch UX: start, stop, 1-minute boost, compact status and optionally straight-line distance to a manually tapped family waiting point. Large controls + button haptics. No Watch maps, metrics, chat, or other features.
- Normal upload target 10s; boost target 5s for 60s; return automatically. These are best-effort, NOT guaranteed timers.
- Minimize radio/GPS/CPU/UI/battery use. Buffered/idempotent uploads and eventual retry.
- Supabase and Vercel deployment only; viewer shows position + traveled route; stable token-protected family link. Family can tap exactly one waiting point or clear it; no family GPS permission.
- Treat view token as a secret. Device credential distinct. Server-only service-role key. RLS + server-side authorization + expiration/revocation. No public unrestricted enrollment.
- No additions without explicit approval. If a technical constraint requires a deviation, document it and choose the smallest compliant fallback.
- Do not change SPEC.md or TEST_PLAN.md to hide failed behavior; report gaps.

## Definition of done
All specified files created; install/deploy documented step-by-step; zero placeholder core handlers; tests pass (or precise environment-limited explanations); security checks included; physical Watch test marked **pending** until executed on a real Series 10 Cellular.
