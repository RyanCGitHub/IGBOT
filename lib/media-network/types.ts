// Media Network types — mirrors the Phase 1 schema (docs/MEDIA_NETWORK_PLAN.md).
// Browser-safe: no server imports.

export type BrandType = "news_media" | "streamer_clips";
export type BrandStatus = "active" | "paused" | "archived";
export type ContentFormat = "reels" | "carousel" | "image" | "mixed";
export type RiskLevel = "low" | "medium" | "high";

export type MediaBrand = {
  id: number;
  connected_account_id: number | null;
  brand_name: string;
  instagram_handle: string | null;
  brand_type: BrandType;
  niche: string | null;
  sub_niche: string | null;
  city_or_region: string | null;
  target_audience: string | null;
  brand_voice: string | null;
  caption_style: string | null;
  hook_style: string | null;
  content_format_preference: ContentFormat;
  posting_frequency_goal: number;
  min_minutes_between_posts: number;
  risk_level: RiskLevel;
  status: BrandStatus;
  created_at: string;
  updated_at: string;
};

export type SourceType =
  | "instagram" | "twitch" | "kick" | "youtube" | "tiktok" | "x"
  | "website" | "rss" | "manual" | "user_submission" | "other";

// Source permission semantics (compliance.ts enforces these):
//   owned/permissioned        → publishable
//   user_submitted            → publishable after review
//   public_reference_only     → summarize/comment only, never repost media
//   unknown                   → direct publishing blocked
//   blocked                   → all use blocked
export type PermissionStatus =
  | "owned" | "permissioned" | "public_reference_only"
  | "user_submitted" | "unknown" | "blocked";

export type ContentSource = {
  id: number;
  media_brand_id: number;
  source_type: SourceType;
  source_name: string;
  source_url: string | null;
  creator_or_publisher_name: string | null;
  platform_handle: string | null;
  permission_status: PermissionStatus;
  permission_evidence: string | null;
  allowed_usage_notes: string | null;
  takedown_contact: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ClaimType = "confirmed" | "developing" | "rumor" | "opinion" | "user_submitted";
export type VerificationStatus = "unverified" | "single_source" | "multi_source" | "official_source" | "rejected";
export type SensitivityLevel = "low" | "medium" | "high";
export type ReviewStatus = "collected" | "needs_review" | "approved" | "rejected" | "used";

export type NewsItem = {
  id: number;
  media_brand_id: number;
  source_id: number | null;
  headline: string;
  short_summary: string | null;
  full_context: string | null;
  source_url: string | null;
  source_name: string | null;
  city_or_region: string | null;
  category: string | null;
  people_or_brands_involved: string | null;
  claim_type: ClaimType;
  verification_status: VerificationStatus;
  sensitivity_level: SensitivityLevel;
  suggested_angle: string | null;
  suggested_hook: string | null;
  source_credit_text: string | null;
  status: ReviewStatus;
  created_at: string;
  updated_at: string;
};

export type StreamerPlatform = "twitch" | "kick" | "youtube" | "other";
export type ClipMomentType =
  | "funny" | "argument" | "reaction" | "fail" | "drama"
  | "challenge" | "highlight" | "wholesome" | "newsworthy";
export type ClipRightsStatus =
  | "owned" | "permissioned" | "commentary_only" | "fan_page_use" | "needs_review" | "blocked";
export type ClipStatus = "imported" | "needs_review" | "approved" | "rejected" | "used";

export type ClipAsset = {
  id: number;
  media_brand_id: number;
  source_id: number | null;
  clip_title: string;
  original_clip_url: string | null;   // reference for credit/takedown — never auto-downloaded
  uploaded_file_url: string | null;   // our storage (assisted upload / sanctioned API)
  streamer_name: string | null;
  streamer_platform: StreamerPlatform | null;
  game_or_category: string | null;
  clip_moment_type: ClipMomentType | null;
  duration_seconds: number | null;
  transcript: string | null;
  clip_summary: string | null;
  suggested_hook: string | null;
  source_credit_text: string | null;
  rights_status: ClipRightsStatus;
  impersonation_risk: RiskLevel;
  status: ClipStatus;
  created_at: string;
  updated_at: string;
};

export type PackageType =
  | "breaking_news_reel" | "news_carousel" | "image_headline_post"
  | "clip_reel" | "streamer_news_post" | "commentary_post";
export type UrgencyLevel = "low" | "medium" | "high" | "breaking";
export type PackageStatus =
  | "idea" | "draft" | "ready" | "scheduled" | "published"
  | "failed" | "archived" | "rejected";

export type ContentPackage = {
  id: number;
  media_brand_id: number;
  connected_account_id: number | null;
  source_news_item_id: number | null;
  source_clip_asset_id: number | null;
  package_family: BrandType;
  package_type: PackageType;
  title: string;
  hook: string | null;
  caption: string | null;
  hashtags: string | null;
  on_screen_text: string | null;
  carousel_slide_text: string[] | null;
  source_credit_text: string;
  source_urls: string[];
  compliance_notes: string | null;
  rights_status: string;
  verification_status: string | null;
  processed_media_path: string | null;
  suggested_publish_time: string | null;
  urgency_level: UrgencyLevel;
  status: PackageStatus;
  linked_ig_post_id: number | null;
  created_at: string;
  updated_at: string;
};

export type PerformanceTag = {
  id: number;
  content_package_id: number;
  media_brand_id: number;
  topic: string | null;
  creator_name: string | null;
  streamer_name: string | null;
  city_or_region: string | null;
  format: string | null;
  hook_style: string | null;
  caption_style: string | null;
  moment_type: string | null;
  posted_at: string | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  engagement_rate: number | null;
  created_at: string;
  updated_at: string;
};

export const NEWS_SUB_NICHES = [
  "hip_hop_news", "local_news", "celebrity_news", "influencer_news",
  "street_media", "entertainment_news", "viral_news", "community_news", "breaking_news",
] as const;

export const CLIP_SUB_NICHES = [
  "single_streamer_fan_page", "multi_streamer_clips", "kick_streamers",
  "twitch_streamers", "gaming_clips", "streamer_news", "streamer_drama",
  "funny_stream_moments", "music_streamer_crossovers",
] as const;
