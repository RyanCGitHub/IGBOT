// Reference Discovery Engine — shared types.
//
// A "discovered asset" is the normalized result of a provider search, before it
// is filtered, scored, and persisted into the reference_assets table. Providers
// differ wildly in their response shapes; everything funnels through this one
// type so the pack assembler never cares which provider a result came from.

export type AssetType = "image" | "video";

export type DiscoveredAsset = {
  source_provider: string;        // pexels | pexels_video | google_cse | serpapi
  source_url: string;             // the page the asset lives on (attribution target)
  full_url: string | null;        // direct downloadable asset (for direct-use compositing)
  thumbnail_url: string | null;
  asset_type: AssetType;
  width: number | null;
  height: number | null;
  duration_s: number | null;      // video only
  license_type: string | null;    // "Pexels License" | "unknown" | …
  license_url: string | null;
  creator_name: string | null;
  source_domain: string | null;
  // License posture, decided by the provider (web results are never direct-use):
  direct_use_allowed: boolean;
  reference_only: boolean;
  needs_review: boolean;
};

// A row from reference_assets after persistence (id + bookkeeping added).
export type ReferenceAsset = DiscoveredAsset & {
  id: number;
  reel_id: number | null;
  account_id: number | null;
  persona_id: number | null;
  search_query: string | null;
  tags: string[];
  location_type: string | null;
  lighting_style: string | null;
  camera_style: string | null;
  mood: string | null;
  relevance_score: number | null;
  created_at: string;
  last_used_at: string | null;
};

// The assembled, analyzed pack for one Reel.
export type ReferencePack = {
  id: number;
  reel_id: number;
  persona_id: number | null;
  account_id: number | null;
  topic: string | null;
  generated_search_queries: string[];
  selected_asset_ids: number[];
  color_palette: string[];        // hex strings
  lighting_summary: string | null;
  camera_summary: string | null;
  environment_summary: string | null;
  texture_notes: string | null;
  realism_notes: string | null;
  hero_asset_id: number | null;
  locked: boolean;
  status: "ready" | "empty" | "error";
  superseded: boolean;
  created_at: string;
  updated_at: string;
};

// The structured analysis Claude returns after looking at the reference thumbnails.
export type PackAnalysis = {
  color_palette: string[];
  lighting_summary: string;
  camera_summary: string;
  environment_summary: string;
  texture_notes: string;
  realism_notes: string;
};

// What the query generator produces from a Reel brief.
export type ReferenceQueries = {
  topic: string;
  location_type: string | null;
  mood: string | null;
  camera_style: string | null;
  queries: string[];              // 5-10 specific provider search strings
};
