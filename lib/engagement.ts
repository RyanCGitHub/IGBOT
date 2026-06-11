// Engagement scoring from stored post_insights. Weights are configurable constants.
// Null metrics count as 0. When reach is available the score is reach-normalized
// (an engagement rate); otherwise it falls back to the raw weighted sum.

export const ENGAGEMENT_WEIGHTS = {
  like: 1,
  comment: 2,
  save: 3,
  share: 3,
} as const;

export type EngagementInput = {
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  reach: number | null;
};

export type EngagementResult = {
  raw: number;             // weighted sum of interactions
  score: number;           // reach-normalized when reach > 0, else raw
  reachNormalized: boolean;
  components: { likes: number; comments: number; saves: number; shares: number; reach: number };
};

export function engagementScore(ins: EngagementInput): EngagementResult {
  const likes = ins.likes ?? 0;
  const comments = ins.comments ?? 0;
  const saves = ins.saves ?? 0;
  const shares = ins.shares ?? 0;
  const reach = ins.reach ?? 0;

  const raw =
    likes * ENGAGEMENT_WEIGHTS.like +
    comments * ENGAGEMENT_WEIGHTS.comment +
    saves * ENGAGEMENT_WEIGHTS.save +
    shares * ENGAGEMENT_WEIGHTS.share;

  const reachNormalized = reach > 0;
  const score = reachNormalized ? raw / reach : raw;

  return { raw, score, reachNormalized, components: { likes, comments, saves, shares, reach } };
}
