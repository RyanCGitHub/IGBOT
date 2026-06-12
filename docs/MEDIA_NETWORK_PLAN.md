# Media Network — Approved Build Plan
**Status: converged with owner 2026-06-12/13 — awaiting final "plan approved" to begin Phase 1.**
**Do not deviate from the ingestion boundary in §3 without explicit owner sign-off.**

## 1. What it is
A modular layer inside the existing IG-Bot dashboard for running multiple
Instagram accounts like a small media company. Two brand families:
- **news_media** (@akademiks / @abc7la style): breaking/local/hip-hop/celebrity
  news, short hard-hook captions, reels + headline graphics + carousels.
- **streamer_clips** (@n3onsclipped / @streamcreamtv style): streamer moments,
  subtitled clip reels, credit-first fan-page positioning.

Core principle: Media Network manufactures **drafts**; the existing ig_posts →
scheduler → publisher → insights machinery does everything after. No parallel
publisher, no parallel analytics.

## 2. Schema (six tables, per owner spec with amendments)
media_brands · content_sources · news_items · clip_assets · content_packages ·
performance_tags — exactly as the owner specced, with these amendments:
- content_sources += `permission_evidence` (link/DM/program-page proving the
  creator okayed use). Documented permission ⇒ risk_level can be low;
  undocumented fan-page use is medium MINIMUM and the UI says so.
- performance_tags = thin dimensional tags written at package time; metrics
  JOINED from existing post_insights via content_packages.linked_ig_post_id,
  refreshed by the existing measure cron. Not a second analytics system.
- File paths use `app/` (this repo has no `src/`).

## 3. Ingestion boundary (owner-agreed, non-negotiable)
**No scraping or direct video downloads from stream platforms or from
"aftermarket" reposts.** Aftermarket copying inherits the original rights
problem AND breaks the credit chain — it is the higher-risk path, not the
safer one. Legitimate intake paths only:
1. Permissioned creators (permission_evidence on file)
2. Official platform APIs (Twitch Clips API; Kick API when mature)
3. Assisted manual upload (owner/clipper exports the file)
4. User submissions (attested, review-required)
News: automated monitoring (RSS/sites) creates CANDIDATE news_items only —
summarize-and-transform in our own words; never repost other outlets' media
without permission status; credit is not a license.

## 4. Compliance engine (code, not vibes)
`lib/media-network/compliance.ts`, evaluated at generation, approval, and
convert-to-draft:
- rights_status unknown/blocked ⇒ convert-to-draft REFUSES (server-side)
- unverified news ⇒ generator forces alleged/developing language; red banner
- high sensitivity (crime/minors/death/legal) ⇒ auto-flag at intake, manual
  review mandatory, no auto-generation
- impersonation rules at brand creation (fan-page labeling); no first-person-
  as-creator voice in generators
- source URL + credit text NOT NULL on every package
- no watermark-removal tooling exists, period

## 5. Owner decisions (locked)
- Clip Studio (subtitles/hook overlay/credit overlay/9:16, reusing the Finn
  ffmpeg+subtitle+cover stack) — **in MVP**
- News intake — **automated candidate ingestion** (RSS/monitor cron), posting
  always review-gated
- Launch accounts — **2 new IG accounts** (1 news, 1 clips) via existing Meta
  OAuth; architecture supports N accounts
- Headline-graphic renderer (branded news image, Cover-renderer cousin) —
  **in MVP**
- Review — single operator (owner) approves every package/post at launch;
  per-source auto-post whitelist is a future flag, not MVP

## 6. Stream Watch (fast clipping, post-MVP Phase 8)
- **v1 (no new infra):** cron polls Twitch Clips API for tracked streamers,
  ranks new clips by view velocity, auto-ingests risers → Clip Studio →
  review queue. Moment-to-reviewable-package ≈ 10–15 min. Fully sanctioned.
- **v2 (small always-on worker, ~$5/mo):** real-time chat-velocity/emote-storm
  detection → official Create Clip API → same flow. ≈ 3–5 min. Respects
  channels that disable clipping. Kick evaluated then; YouTube live stays
  manual (no sanctioned clip API).

## 7. Phases
| Phase | Deliverable |
|---|---|
| 1 | Migrations (6 tables + indexes + RLS) + types |
| 2 | /media-network shell (dark command-center) + Brand Network + Source Manager |
| 3 | News Desk: auto-candidate ingestion cron + manual intake + verification/sensitivity + news package generator + headline-graphic renderer |
| 4 | Clip Desk: upload intake + metadata/rights + clip package generator |
| 4.5 | Clip Studio: subtitle/hook/credit/9:16 processing (reuse Finn stack) |
| 5 | Content Packages review hub → Convert to Draft (ig_posts) |
| 6 | Scheduler wiring + per-brand min-spacing rule (also serves Finn's 10/day ramp) + newsroom KPI cards |
| 7 | Performance Lab (packages ⟕ existing insights; best brand/streamer/hook/format/time) |
| 8 | Stream Watch v1 → v2 |

Process: checkpoint tag before Phase 1; one PR per phase; owner merges;
nothing publishes without owner approval. Existing IG-Bot features untouched.
