// Reel pipeline types and the stage machine shared by the planner, the tick
// route, and the dashboard. A run advances one stage per tick so every stage
// stays idempotent, resumable, and inside serverless time limits.

export type ReelRunStatus =
  | "queued"            // created by the planner; strategist not yet run
  | "briefed"           // structured brief generated
  | "keyframes_ready"   // every beat has a stored keyframe image
  | "clips_generating"  // video jobs submitted to the provider, awaiting completion
  | "clips_ready"       // all clips downloaded into our storage bucket
  | "assembled"         // final MP4 (subtitles + audio) in storage
  | "captioned"         // caption + hashtags written, scheduled_for set
  | "publishing"        // REELS container created, polling until FINISHED
  | "published"
  | "failed";

// Statuses the tick cron picks up. Order is the pipeline order.
export const ACTIVE_STATUSES: ReelRunStatus[] = [
  "queued",
  "briefed",
  "keyframes_ready",
  "clips_generating",
  "clips_ready",
  "assembled",
  "captioned",
  "publishing",
];

export const AUDIO_MOODS = ["energetic", "chill", "inspiring", "dramatic", "playful"] as const;

export type ReelBeat = {
  subtitle: string;       // short on-screen line, burned into the video
  image_prompt: string;   // keyframe prompt for the image provider
  motion_prompt: string;  // camera/subject motion for image-to-video
  duration_s: number;     // 3–6 seconds
};

export type ReelBrief = {
  title: string;
  hook: string;
  content_pillar: string;
  beats: ReelBeat[];
  visual_style: string;
  audio_mood: string;             // one of AUDIO_MOODS
  voiceover_script: string | null; // null → no voiceover for this reel
  caption_angle: string;
  hashtags: string;
  cta: string;
};

export type Keyframe = {
  beat_index: number;
  storage_path: string;
  url: string;
};

export type Clip = {
  beat_index: number;
  request_id: string;            // provider queue request id
  submitted_at: string;          // ISO — stale jobs are resubmitted
  status: "submitted" | "done" | "failed";
  provider_url?: string;         // temporary provider URL
  storage_path?: string;         // after download into our bucket
  url?: string;                  // our public URL
  error?: string;
};

export type ReelRunAudio = {
  music_source: "library" | "generated" | "none";
  music_track_id?: number;
  voiceover: boolean;
};

export type ReelRun = {
  id: number;
  account_id: number;
  persona_id: number | null;
  status: ReelRunStatus;
  failed_stage: string | null;
  brief: ReelBrief | null;
  keyframes: Keyframe[];
  clips: Clip[];
  audio: ReelRunAudio | null;
  assembled_video_path: string | null;
  caption: string | null;
  hashtags: string | null;
  ig_post_id: number | null;
  container_id: string | null;
  media_id: string | null;
  permalink: string | null;
  scheduled_for: string | null;
  error_message: string | null;
  attempt_count: number;
  locked_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AudioTrack = {
  id: number;
  title: string;
  storage_path: string;
  mood: string | null;
  duration_seconds: number | null;
  license: string;
  source: string | null;
  active: boolean;
  created_at: string;
};
