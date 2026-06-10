import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type SavedCaption = {
  id: number;
  prompt: string;
  caption: string;
  created_at: string;
};

// access_token is intentionally omitted — never expose to the browser
export type ConnectedAccount = {
  id: number;
  platform: string;
  account_name: string;
  ig_user_id: string;
  token_expires_at: string | null;
  created_at: string;
};

export type PostStatus = 'draft' | 'approved' | 'scheduled' | 'posted';

// Single source of truth — import this in every route that validates status.
export const VALID_STATUSES: PostStatus[] = ['draft', 'approved', 'scheduled', 'posted'];

export type Post = {
  id: number;
  title: string;
  caption: string;
  hashtags: string;
  status: PostStatus;
  created_at: string;
};

export type PublishJobStatus = 'pending' | 'container_created' | 'polling' | 'published' | 'failed';

export type PublishJob = {
  id: number;
  account_id: number | null;
  caption: string;
  image_url: string;
  container_id: string | null;
  media_id: string | null;
  permalink: string | null;
  status: PublishJobStatus;
  error_message: string | null;
  created_at: string;
  published_at: string | null;
};

// ─── ig_posts ─────────────────────────────────────────────────────────────────

export type CaptionStyle = 'professional' | 'casual' | 'motivational' | 'cta' | 'viral';

export type CaptionOption = {
  style: CaptionStyle;
  label: string;
  caption: string;
  hashtags: string;
};

export type IgPostStatus =
  | 'draft'
  | 'ready'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'scheduled'
  | 'deleted_on_instagram'
  | 'republishing'
  | 'republished';

export const IG_POST_VALID_STATUSES: IgPostStatus[] = [
  'draft', 'ready', 'publishing', 'published', 'failed',
  'scheduled', 'deleted_on_instagram', 'republishing', 'republished',
];

export type IgPost = {
  id: number;
  title: string;
  caption: string;
  image_url: string | null;
  image_storage_path: string | null;
  image_analysis: Record<string, unknown> | null;
  caption_options: CaptionOption[] | null;
  normalization_meta: Record<string, unknown> | null;
  account_id: number | null;
  publish_job_id: number | null;
  status: IgPostStatus;
  error_message: string | null;
  media_id: string | null;
  permalink: string | null;
  published_at: string | null;
  // deletion-detection fields
  original_media_id: string | null;
  republished_from_media_id: string | null;
  deleted_detected_at: string | null;
  last_instagram_sync_at: string | null;
  sync_error_message: string | null;
  created_at: string;
  updated_at: string;
};
