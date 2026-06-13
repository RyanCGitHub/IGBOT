// Viral Potential Checker — scoring rubric (V1, no ML). Claude judges seven
// dimensions 0–100; this module combines them with a STRICT, lane-aware weight
// profile into the final viral_score. Keeping the combine deterministic (here,
// not in the model) is what lets us tune weights later against real
// post-performance without retraining anything.

export type ContentType = "reel" | "photo";
export type ContentLane = "news_media" | "streamer_clips" | "avatar_reels" | "general";

export const SUBSCORES = [
  "hook_score",
  "retention_score",
  "shareability_score",
  "topic_strength_score",
  "visual_clarity_score",
  "caption_score",
  "audio_hashtag_fit_score",
] as const;
export type SubScoreKey = (typeof SUBSCORES)[number];
export type SubScores = Record<SubScoreKey, number>;
type Weights = Record<SubScoreKey, number>;

export const CONTENT_TYPES: ContentType[] = ["reel", "photo"];
export const LANES: { id: ContentLane; label: string }[] = [
  { id: "news_media", label: "News / Media" },
  { id: "streamer_clips", label: "Streamer Clips" },
  { id: "avatar_reels", label: "Avatar Reels (Finn)" },
  { id: "general", label: "General" },
];

// ── Weight profiles ──────────────────────────────────────────────────────────
// Each profile sums to 1.0. Reels live or die on hook + retention; photos on
// visual clarity + shareability; news on topic strength + caption; clips on the
// hook/payoff of the moment.
const REEL_BASE: Weights = {
  hook_score: 0.22, retention_score: 0.22, shareability_score: 0.18,
  topic_strength_score: 0.12, visual_clarity_score: 0.10, caption_score: 0.08,
  audio_hashtag_fit_score: 0.08,
};
const PHOTO_BASE: Weights = {
  hook_score: 0.12, retention_score: 0.04, shareability_score: 0.20,
  topic_strength_score: 0.18, visual_clarity_score: 0.24, caption_score: 0.16,
  audio_hashtag_fit_score: 0.06,
};

const PROFILES: Partial<Record<`${ContentLane}_${ContentType}`, Weights>> = {
  // News reels: topicality and a sharp caption matter as much as the hook.
  news_media_reel: {
    hook_score: 0.20, retention_score: 0.14, shareability_score: 0.18,
    topic_strength_score: 0.22, visual_clarity_score: 0.08, caption_score: 0.12,
    audio_hashtag_fit_score: 0.06,
  },
  // News photo (headline graphic): the story and the legible headline lead.
  news_media_photo: {
    hook_score: 0.14, retention_score: 0.03, shareability_score: 0.18,
    topic_strength_score: 0.26, visual_clarity_score: 0.17, caption_score: 0.16,
    audio_hashtag_fit_score: 0.06,
  },
  // Streamer clips: the moment's hook and whether it holds you to the payoff.
  streamer_clips_reel: {
    hook_score: 0.26, retention_score: 0.24, shareability_score: 0.18,
    topic_strength_score: 0.08, visual_clarity_score: 0.10, caption_score: 0.04,
    audio_hashtag_fit_score: 0.10,
  },
  // Avatar reels: presenter hook + retention + clean visuals.
  avatar_reels_reel: {
    hook_score: 0.22, retention_score: 0.24, shareability_score: 0.16,
    topic_strength_score: 0.12, visual_clarity_score: 0.14, caption_score: 0.06,
    audio_hashtag_fit_score: 0.06,
  },
};

export function weightsFor(lane: ContentLane, type: ContentType): Weights {
  return PROFILES[`${lane}_${type}`] ?? (type === "reel" ? REEL_BASE : PHOTO_BASE);
}

export function combineScore(sub: SubScores, weights: Weights): number {
  let total = 0;
  let wsum = 0;
  for (const k of SUBSCORES) {
    const v = Math.max(0, Math.min(100, Number(sub[k]) || 0));
    total += v * weights[k];
    wsum += weights[k];
  }
  return Math.round(wsum > 0 ? total / wsum : 0);
}

export function verdictFor(score: number): string {
  if (score >= 80) return "🔥 High viral potential";
  if (score >= 65) return "Strong potential";
  if (score >= 50) return "Moderate — fixable";
  if (score >= 35) return "Weak — needs work";
  return "Unlikely to perform";
}

// Lane/type-specific lens handed to the model so it judges each dimension the
// way that lane actually wins.
export function laneGuidance(lane: ContentLane, type: ContentType): string {
  const lines: string[] = [];
  if (type === "reel") {
    lines.push("This is a REEL. Weight the first 1–2 seconds heavily: a reel lives or dies on whether the opening frame/line stops the scroll, and on whether it holds attention to a payoff.");
  } else {
    lines.push("This is a PHOTO/CAROUSEL post. There is no playback hook — judge the hook as the instant readability of the image + first caption line. Visual clarity and shareability dominate.");
  }
  switch (lane) {
    case "news_media":
      lines.push("Lane: NEWS/MEDIA. Reward topical, timely, talkable stories and a punchy, credible caption. The headline must be instantly legible. Penalize stale or niche-only topics. Sensational-but-empty framing should not score high on topic strength.");
      break;
    case "streamer_clips":
      lines.push("Lane: STREAMER CLIPS. Reward a fast, clear 'moment' with an obvious payoff (funny/shocking/skillful). Penalize slow setups, missing context, or clips where the payoff isn't visible. Caption matters little; the moment carries it.");
      break;
    case "avatar_reels":
      lines.push("Lane: AVATAR PRESENTER REEL. Reward a strong spoken/overlaid hook, continuous watchable visuals, and a clear single idea. Penalize generic openers and low visual interest.");
      break;
    default:
      lines.push("Lane: GENERAL. Judge against broad Instagram best-practice for this format.");
  }
  return lines.join(" ");
}
