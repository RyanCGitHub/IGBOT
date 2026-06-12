# The Viral Algorithm Report
### Evidence-based ruleset for AI-character Reels targeting 1M+ views
**Compiled 2026-06-12 · Status: AWAITING OWNER APPROVAL — nothing below is implemented, and all video/photo generation remains frozen until approval.**

---

## 1. Method (how to duplicate this report)

Three independent research passes, each run as a web-connected agent with explicit
anti-fabrication rules (no invented accounts, no uncited statistics, every claim
tagged with confidence):

1. **Creator census** — catalog 100+ successful AI creators/characters/videos on
   Instagram with per-account attributes. Sources: Apify/Favikon/tryaimodels/
   virtualhumans.org rankings, press (Time, NPR, Washington Post, PetaPixel),
   case-study teardowns. Result: 108 entries (~70 with concrete numbers).
2. **Viral mechanics** — verify, against current primary sources, every claimed
   driver of Reel virality: Instagram's official ranking statements, Meta ads
   safe-zone docs, peer-reviewed AI-labeling studies (CHI/CSCW 2025), analytics
   benchmarks (Socialinsider, Buffer 9.6M-post study, HubSpot), and case-study
   interviews with viral AI creators.
3. **Tool landscape** — current (June 2026) vendor docs, API references, pricing
   pages, and independent comparisons for every credible avatar/video provider.

Confidence taxonomy used throughout: **[E] EVIDENCED** (official platform source,
peer-reviewed study, or primary vendor doc) vs **[PL] PRACTITIONER LORE**
(consistent practice among successful creators, no controlled data). Claims that
could not be verified are listed in §7 and must not be cited.

To re-run: re-issue the three agent briefs (stored in session transcript and
summarized above) with web access; diff the findings against this document.

---

## 2. What the data says about the niche (census findings)

**The whitespace:** across 108 documented AI accounts, *no account combines a
persistent photoreal human host with real extreme-nature events.* The closest
analogues are thriving:

| Analogue | Numbers | What transfers to us |
|---|---|---|
| @chloe.vs.history — fictional AI woman "time-travels" into real events | **615K followers from 21 posts**; 4.3M-view Titanic video | Character + real events + selfie-vlog grammar + LOW VOLUME / HIGH QUALITY |
| timetravellerpov (history POV, no host) | 19.5M and 21.8M view videos | POV framing alone carries virality; a host adds retention on top |
| @tessa.bible (AI host retells scripture as gossip) | 46.9M views in weeks | Voice/register innovation is the hook; host is the wrapper |
| The AI Bible (Pray.com) | 1.2M IG; 33M-view video | Cinematic AI visuals + high-quality human-grade voice = credibility |
| @grannyspills | 1M followers in 22 days | A fully synthetic talking human can build a following FAST: catchphrase + fixed look + one strong trait |
| Bigfoot/Yeti/Stormtrooper vlogs (Veo 3 wave) | 0→250–330K followers in days; 5–15M view clips | Arm's-length selfie-vlog POV is the proven AI-character composition |

**Niche economics:** character vlogs and host-led POV edutainment over-index on
BOTH 1M+ views and follower conversion. Pure spectacle (fake wildlife, ASMR)
gets bigger view spikes but converts followers poorly and — for deceptive
realism — is the explicit target of platform enforcement. Fashion-style virtual
influencers have big follower stocks but near-zero Reel virality (0.01–0.79%
engagement rates).

**Strategic conclusion:** Finn Walker's concept (openly fictional photoreal host
+ real documented nature events) sits in validated whitespace, at the
intersection of the two best-performing niches (character vlog × POV
edutainment). The pivot required is *format*, not concept.

---

## 3. THE ALGORITHM — production ruleset

Apply to every reel and account decision. Tags: [E]/[PL] per §1.

### A. Format & length
- **V1 [E]** Two length classes only: **8–15s engineered loop** (replay-driven) or
  **60–90s narrative** (watch-time-driven). The 20–45s middle is a dead zone —
  too long to replay, too short to accumulate watch time. (Replays officially
  count as views since Aug 2024.)
- **V2 [E]** Export 1080×1920+, never watermarked, never muted, never
  majority-text on screen, never a repost — all are on Instagram's official
  demotion list.
- **V3 [E]** Engineer narrative reels so the ending cuts seamlessly back to the
  opening frame (loop bonus on top of completion).

### B. Hook (seconds 0–3)
- **V4 [E]** The full premise must be visible in frame one — character + stakes.
  No logos, fades, or establishing shots. Meta's research: ~47% of a video's
  value and the 65%→10s retention gate live in the first 3 seconds.
- **V5 [PL]** Use one hook archetype per reel: (a) impossible-situation collision
  ("host standing at the lake that exploded"), (b) second-person POV ("POV: you
  live beside Lake Nyos in 1986"), (c) shock-stat/claim. Questions underperform
  claims for cold reach.
- **V6 [PL]** Spoken hook line completes by second 2; text overlay ≤8 words and
  NOT identical to the spoken line (overlay = curiosity gap, voice = story).

### C. Visual construction
- **V7 [PL]** Default composition: **arm's-length selfie-vlog POV** — host
  chest-up, direct eye contact, IN MOTION through the real location. This is the
  documented composition of every 1M+ AI-character account. Static
  tripod-presenter framing reads as "produced" and underperforms.
- **V8 [PL]** A visual change every 2–3 seconds (cut/camera move/text emphasis);
  no shot longer than 5s; never hold an AI avatar shot past 6s (lip-sync drift
  becomes visible). Script in ~8s beats to match generator clip lengths.
- **V9 [PL]** B-roll covers ~40–50% of narrated runtime, interleaved (host →
  event footage → host).

### D. Subtitles & audio
- **V10 [E]** Burn in captions for 100% of speech (+12% view time per Meta's own
  study; large sound-off minority).
- **V11 [E]** Captions live INSIDE Meta's 2026 unified 9:16 safe zone: on
  1080×1920 keep all text out of the **top 270px, bottom ~670px, and 65px side
  margins** → caption block at ~50–65% frame height.
- **V12 [PL]** Karaoke-style word-by-word highlight, 2–4 words on screen, bold
  with stroke. (Claimed retention magnitudes are vendor marketing; the style
  itself is universal practice.)
- **V13 [PL]** Narration ~150 WPM (140–160 band), conversational documentary
  energy, ONE consistent persona voice forever. A 60s reel ≈ 150 words.
- **V14 [E]** Always ship an audio track — muted reels are officially demoted.

### E. Packaging & metadata
- **V15 [E]** First frame ≠ cover. Covers don't affect ranking (Mosseri) but
  drive profile→follow conversion: design a separate 3:4-cropped cover with a
  3–5 word title on one consistent series template.
- **V16 [E]** **3–5 hashtags maximum.** Hashtags are not a reach lever; put the
  exact search phrase a target viewer would type in the caption's first line and
  in on-screen text.
- **V17 [E-medium]** Caption: ~100–150 words. Line 1 = keyword-bearing re-hook
  (it's all that shows before "…more"). Body adds one fact NOT in the video.
  Final line = save/share-oriented CTA ("Save this for your next trivia night") —
  never a like-beg.

### F. Engagement loops
- **V18 [E]** Never use mechanical engagement bait ("comment YES", "like if…") —
  formally demoted by a Meta classifier. End instead with a genuine opinion
  question answerable in one word, or a keyword→DM automation gating a real asset.
- **V19 [PL]** Seed exactly one debatable detail per reel (a comparison, a
  ranking, a "would you survive?") to fuel comment threads organically.
- **V20 [PL]** Serialize winners: end with a Part-2 open loop; deliver Part 2 via
  reply-to-comment reel.

### G. Distribution operations
- **V21 [E]** Optimize the metric stack in order: **completion/replays →
  sends-per-reach → likes-per-reach** (Mosseri's stated big three; sends drive
  non-follower reach). Every concept must pass the test: *"who would DM this to
  whom?"*
- **V22 [E]** Run every new format/hook variant as a **Trial Reel** (non-follower
  test, auto-share on performance within 72h). Instagram's own data: 80% of
  frequent trial users see increased non-follower reach.
- **V23 [E-medium]** Cadence: 5–7 reels/week once unfrozen, anchored midweek
  midday (Wed ~12PM, Thu ~9AM are the cross-platform consensus slots); but
  timing is second-order to retention. Census counter-example: Chloe hit 615K
  with 21 total posts — quality dominates cadence.

### H. AI-specific strategy
- **V24 [E]** Keep AI disclosure ON (bio + caption + label). Peer-reviewed
  studies (CHI/CSCW 2025): the AI label does NOT significantly reduce engagement;
  Meta does NOT downrank disclosed AI content. The penalized failure mode is
  UNdisclosed realistic synthetic media (fact-check "Altered" downranking).
- **V25 [E]** Openly fictional persona, never simulated realism. Deceptive-realism
  nature content (fake wildlife) is the named target of enforcement, debunk
  coverage, and audience backlash. Anchor every reel on one TRUE, verifiable
  event; the AI visuals illustrate it.
- **V26 [PL]** The moat is the character: one identity, one voice, one world,
  iterated via analytics — the documented pattern of every 1M+ AI-character
  account. Never change Finn's face (already enforced in the pipeline).
- **V27 [E-strategy]** Headwind awareness: Mosseri's Dec 2025 memo signals a 2026
  tilt toward "raw, real human content"; platform-wide Reels views fell ~59% YoY
  while small accounts gained reach. The window favors new accounts with
  high-quality original formats — and punishes generic AI slop.

### I. Production-quality directives (owner additions, 2026-06-12)
- **V28 [owner]** Voice-first mix: narration always sits clearly above the
  music bed — music ducked to 0.15 default under speech (`REELS_MUSIC_GAIN`),
  short bed fade-in, voice never attenuated.
- **V29 [owner]** Seamless flow: straight cuts between beats — fade-to-black
  only at reel start and end. No per-beat dissolves or dips.
- **V30 [owner]** Continuity, detail, realism: one time-of-day/weather/palette
  across all beats; image prompts specify foreground/midground/background +
  light source + one atmospheric detail; photoreal smartphone aesthetic (no
  "AI cinematic" grading); at least one b-roll beat visually delivers the
  hook's exact promise. B-roll engine: Kling v2.5-turbo pro.

---

## 4. Provider stack decision (quality upgrade)

**Creatify.ai: rejected** for this use case, on evidence:
1. Cannot ingest our reference portrait — custom avatars are text-described
   (new face) or real-human-footage only → guaranteed identity break for Finn.
2. Independent 2026 reviews criticize exactly what we're upgrading away from
   (robotic gestures, lip-sync drift, recognizable synthetic look).
3. Subscription-gated API, expiring credits, ~$7.50–10/video vs alternatives at
   $2–4/min pay-as-you-go.

**Recommended stack** (all consume our stored portrait → Finn's identity survives):

| Role | Provider | Why | Cost |
|---|---|---|---|
| Host segments (primary) | **HeyGen Photo Avatar / Avatar IV API** | Train identity group from Finn's existing portrait; generate talking video from OUR Australian TTS audio (voice unchanged); collapses keyframe→i2v→lipsync into one call; webhooks; fictional personas explicitly in policy | ~$3–4/min |
| Host segments (fallback, lowest friction) | **Kling AI Avatar v2 Pro** (fal.ai — current vendor) | Animates Finn's exact portrait + our audio in one call; zero new accounts | ~$6.90/min |
| Host segments (premium A/B) | **OmniHuman 1.5** (fal.ai) | Best gesture/micro-expression realism in controlled comparisons | ~$9.60/min |
| B-roll | **Veo 3.1 Fast** (fal.ai) | Strongest real-location accuracy; native ambient audio | ~$9/min |
| B-roll (budget) | **Kling 2.x** (current) | Known quantity | ~$3.40/min |
| Interim cheap win | **sync.so lipsync-2-pro / sync-3** | One-line model-id change on current stack | $5–8/min |

Eliminated: **Sora 2** (discontinued; API sunsets 2026-09-24), **Runway Act-Two**
(needs human driving footage). Voice stays on our TTS everywhere (portable);
Veo's native voices are never used for Finn (voice would drift per clip).

---

## 5. Implementation mapping (PROPOSED — requires owner approval)

| Rule(s) | Pipeline change |
|---|---|
| V1, V8, V9 | Strategist: brief schema gains `length_class` (loop \| narrative); narrative = 8–11 beats ≈ 60–90s; loop = 2 beats ≈ 8–15s; beat durations stay ≤6s |
| V4–V7 | Strategist prompt: selfie-vlog POV composition, hook archetypes, overlay ≠ spoken line, premise-in-frame-one |
| V11, V12 | assemble.ts: caption block moves from 74% → ~58% frame height; karaoke-style per-word highlight (render per-word PNG sequence) |
| V13 | Strategist: voiceover lines budgeted at 2.5 words/sec of beat time |
| V15 | New cover stage: generate 3:4-safe cover with series template + title text |
| V16, V17 | Caption stage: 3–5 hashtags (down from 8–15); 100–150 word caption; keyword first line; save/share CTA; one extra fact |
| V18–V20 | Caption stage CTA rules + strategist "debatable detail" field |
| V21 | Learning engine: add sends/shares weighting to engagement score (already stored) |
| V22 | Publisher: investigate Trial Reels via API (likely manual-only — flag if so) |
| V23 | posting_hour default → Wed/Thu midday ET windows |
| V24–V26 | Already enforced (disclosure on, fictional persona, locked face) — no change |
| §4 stack | New `lib/media-generation/heygen.ts` host-segment provider behind env flag; Veo 3.1 b-roll model id; keep Kling fallback |

**Cost note:** a 75s reel ≈ 30s host (HeyGen ~$2) + 45s b-roll (Veo Fast ~$6.75)
+ TTS/music pennies ≈ **$9–12/reel** vs ~$3–5 today. The premium buys exactly
what the freeze was about: realism.

---

## 6. Measurement loop (how the algorithm self-corrects)

Every published reel already stores insights (views/reach/saves/shares once the
account is reconnected with insights scopes) + post_attributes. Add per-reel
rule-compliance metadata (length class, hook archetype, caption style) so the
existing learning engine can test rules V1–V23 against OUR audience — the [PL]
rules especially are explicitly the ones to A/B, since no public dataset settles
them.

## 7. Do-not-cite list (checked and unverifiable)
- "Sends weighted 3–5× likes" — third-party inference, no official source.
- "Sephora +41% watch time / Nike +48% retention" hook stats — content-farm only;
  likely fabricated.
- Karaoke-caption "+30–40% retention" — vendor marketing.
- "80% of Reels watched with sound on" vs "~50% sound-off" — contradictory, no
  primary source for either; assume a large sound-off minority.
- Exact BigfootBoyz follower/revenue figures — single promotional source.
