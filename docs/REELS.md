# Reels Autopilot

Autonomous Instagram Reels pipeline: idea → keyframes → video clips → assembly
(subtitles + audio) → caption → publish → measure → learn. The only human
actions are connecting an account and flipping the per-account toggle in the
dashboard ("Reels Autopilot" section).

> **⚠️ No review gate (deliberate).** Unlike the image workflow's Approval
> Queue, reels have NO human review step: once a run is queued — by the daily
> planner (autopilot toggle ON) or the "Queue a reel now" button — it proceeds
> all the way to **publishing on Instagram autonomously**, unless
> `REELS_PAUSED=true`. The per-account autopilot toggle defaults OFF, so a
> freshly connected account never generates or publishes anything until you
> enable it. If a review gate is added later, the seam is a `pending_review`
> status between `captioned` and the publish stage.

## How it runs

Three Vercel crons (see `vercel.json`; all require the Pro plan for sub-daily
schedules and the 800s tick duration):

| Cron | Schedule | What it does |
|---|---|---|
| `/api/reels/plan` | daily 08:00 UTC | Queues up to `reels_daily_cap` runs per autopilot-enabled account |
| `/api/reels/tick` | every 5 min | Advances each active `reel_runs` row by one stage |
| `/api/reels/measure` | daily 06:30 UTC | Syncs insights for all published posts, re-distills `learnings` per account |

Stage machine (one transition per tick, all stages idempotent):
`queued → briefed → keyframes_ready → clips_generating → clips_ready →
assembled → captioned → publishing → published` (3 failed attempts at any
stage → `failed` with the stage recorded).

A run produces 3–5 "beats". Each beat: one gpt-image-1 portrait keyframe →
one ~5s image-to-video clip (fal.ai). ffmpeg normalizes clips to 1080x1920/30fps,
concatenates them, burns per-beat subtitles (bundled DejaVu font), and mixes the
soundtrack/voiceover. Publishing uses the official Graph API REELS container
flow with cross-tick status polling.

## Environment variables

Required:

- `FAL_KEY` — fal.ai API key (video clips + generated music)
- `OPENAI_API_KEY` — already used for images; also used for TTS voiceover
- `ANTHROPIC_API_KEY`, Supabase vars, `META_APP_ID`/`META_APP_SECRET` — as before
- `CRON_SECRET` — required in production so only Vercel cron can drive the pipeline

Optional:

- `REELS_PAUSED` — **global kill switch.** Set `true` to halt all automated
  publishing immediately: `/api/reels/plan` queues nothing, `/api/reels/tick`
  advances nothing, the publish stages refuse to create or publish Instagram
  containers (checked again inside the stage as defense-in-depth), and
  `/api/ig-posts/process-scheduled` skips scheduled image posts too. Paused
  endpoints return `{ paused: true, message: "Publishing paused by REELS_PAUSED" }`.
  In-flight runs freeze at their current stage and resume when unset. Note: a
  reel paused mid-`publishing` holds an already-created container; if the pause
  outlasts the container's validity window Instagram expires it and the run
  surfaces as `failed` (nothing is ever posted while paused).
- `FAL_VIDEO_MODEL` (default `fal-ai/kling-video/v2.1/standard/image-to-video`)
- `FAL_MUSIC_MODEL` (default `fal-ai/stable-audio`)
- `REELS_MUSIC_MODE` — `auto` (library first, generated fallback — default), `library`, `generated`, `none`
- `REELS_VOICEOVER_ENABLED` — set `false` to disable TTS voiceovers
- `REELS_TTS_MODEL` / `REELS_TTS_VOICE` (defaults `gpt-4o-mini-tts` / `alloy`)
- `REELS_DEFAULT_POST_HOUR_UTC` (default 17) — used when the account has no `posting_hour_utc`
- `REELS_PUBLISH_IMMEDIATELY` — `true` publishes as soon as a reel is ready (useful for testing)

## Presenter (avatar host) mode

Per-account toggle: `connected_accounts.reels_presenter_enabled`. When on, the
reel format changes from "footage + narration" to **an on-camera AI host**:

- **One persistent avatar per account** — designed by AI from the account's
  persona/niche on first run, stored at `reels_avatar_path`, and reused as the
  reference image (`gpt-image-1` images/edits) for every avatar shot, which is
  what keeps the face consistent across reels. Delete the storage file + null
  the column to force a new look.
- **Brief format** — one real, documented natural event per reel
  (`event_location` names the real place/year); beats are typed `avatar`
  (host on camera, opens and closes the reel) or `broll` (the event itself,
  visually matched to the real location); the host's `wardrobe` matches the
  location/climate.
- **Lip sync** — each avatar clip + its beat's voiceover line goes through the
  fal.ai lip-sync model (`FAL_LIPSYNC_MODEL`, default `fal-ai/sync-lipsync`) so
  mouth movement matches the words; the same mp3 is then placed at the beat's
  exact offset in the final mix.
- **Voice** — `connected_accounts.reels_voice_instructions` carries delivery
  instructions (e.g. "warm, friendly Australian accent") passed to
  `gpt-4o-mini-tts` per line.
- New pipeline stage: `clips_ready → lipsyncing → clips_ready → assembled`.

Honest limits: lip-sync quality varies per model/clip; "location accuracy" is
prompt-enforced (the strategist must use real documented events and the image
prompts name the real place) but generative models can still get details wrong
— the learning engine will surface what audiences reject. Cost per reel rises
by roughly $0.05–0.15 per avatar beat (TTS + lip-sync inference).

## Audio rights — read this

**The pipeline never uses Instagram's licensed/"trending" audio.** The Content
Publishing API cannot attach those tracks, and scraping them is a copyright/ToS
violation, so this is both a technical and legal hard limit. API-published reels
always appear with "Original audio". Soundtracks come from:

1. **Your royalty-free library** — upload files to the `instagram-media` bucket
   and register them in the `audio_tracks` table (`storage_path`, `mood` of
   energetic/chill/inspiring/dramatic/playful, `license`, `source`). Keep
   license proof in `source`.
2. **Generated music** (default fallback) — original instrumentals from
   fal.ai stable-audio, no licensing exposure.
3. **Voiceover** — OpenAI TTS from the brief's script.

## Insights permission

Reach/saves/shares/views require the `instagram_manage_insights` +
`pages_read_engagement` scopes, which were missing from the original OAuth
grant (analytics showed only likes/comments). The login route now requests
them — **reconnect each account once** ("force re-auth") to upgrade the token.
Until then the learning engine scores on likes/comments only; everything
degrades gracefully.

## Other limits baked in

- Daily cap of 1–5 reels/account (UI-enforced; Instagram's API limit is ~25 posts/24h).
- Keyframes count against the existing per-account image cap (`MEDIA_IMAGE_DAILY_CAP`).
- Reel videos: 3–6s per beat, ≤ ~30s total, MP4 H.264/AAC, well inside Reels specs.
- Reels are published only by this pipeline; `publishIgPost` refuses
  `media_type='reel'` rows so the image flow can't corrupt them.
