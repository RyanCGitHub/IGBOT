// The active scoring model version. Bump this whenever the rubric/prompt
// changes so accuracy can be compared across versions. Old scoring data is
// never deleted — each content_review keeps the version it was scored under.
//   v1.0-rubric           — initial rubric-weighted AI scoring
//   v1.1-adjusted-hooks   — (future) hook-weight tuning
//   v2.0-data-assisted    — (future) weights tuned against real performance
export const SCORING_MODEL_VERSION = "v1.0-rubric";
