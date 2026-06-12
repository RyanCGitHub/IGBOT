// Media Network compliance engine (docs/MEDIA_NETWORK_PLAN.md §4).
// Pure functions — evaluated at three chokepoints: package generation,
// approval, and convert-to-draft. The convert-to-draft route MUST call
// canConvertToDraft server-side; UI banners are advisory, this is the law.

import type {
  PermissionStatus, ClipRightsStatus, VerificationStatus, SensitivityLevel,
} from "@/lib/media-network/types";

export type ComplianceVerdict = {
  allowed: boolean;
  blockers: string[];   // hard stops
  warnings: string[];   // surfaced to the reviewer, not blocking
};

const ok = (warnings: string[] = []): ComplianceVerdict => ({ allowed: true, blockers: [], warnings });

// ─── Source permission semantics ─────────────────────────────────────────────

export function sourcePublishability(status: PermissionStatus): ComplianceVerdict {
  switch (status) {
    case "owned":
    case "permissioned":
      return ok();
    case "user_submitted":
      return ok(["User-submitted source — manual review required before publishing."]);
    case "public_reference_only":
      return ok([
        "Public-reference source: summarize/comment in our own words only — do NOT repost the source's media directly. Credit is not a license.",
      ]);
    case "unknown":
      return { allowed: false, blockers: ["Source permission is UNKNOWN — direct publishing blocked until resolved."], warnings: [] };
    case "blocked":
      return { allowed: false, blockers: ["Source is BLOCKED — all use prohibited."], warnings: [] };
  }
}

// ─── Clip rights ─────────────────────────────────────────────────────────────

export function clipRightsVerdict(rights: ClipRightsStatus, impersonationRisk: SensitivityLevel): ComplianceVerdict {
  const v: ComplianceVerdict = { allowed: true, blockers: [], warnings: [] };
  switch (rights) {
    case "owned":
    case "permissioned":
      break;
    case "fan_page_use":
      v.warnings.push("Fan-page use without documented permission is MEDIUM risk minimum — takedown exposure exists. Add permission_evidence to the source to lower risk.");
      break;
    case "commentary_only":
      v.warnings.push("Commentary-only rights: the post must add substantial commentary/transformation, not just repost the clip.");
      break;
    case "needs_review":
      v.blockers.push("Clip rights are NEEDS_REVIEW — resolve rights status before this can become a draft.");
      break;
    case "blocked":
      v.blockers.push("Clip rights are BLOCKED — all use prohibited.");
      break;
  }
  if (impersonationRisk === "high") {
    v.blockers.push("Impersonation risk HIGH — rework framing (clear fan-page voice, no first-person-as-streamer) before publishing.");
  } else if (impersonationRisk === "medium") {
    v.warnings.push("Impersonation risk MEDIUM — ensure fan-page labeling and third-person framing.");
  }
  v.allowed = v.blockers.length === 0;
  return v;
}

// ─── News verification ───────────────────────────────────────────────────────

const HEDGE_WORDS = ["alleged", "allegedly", "developing", "unconfirmed", "reportedly", "rumor", "user-submitted", "claims", "according to"];

export function newsVerificationVerdict(
  verification: VerificationStatus,
  sensitivity: SensitivityLevel,
  captionText: string | null
): ComplianceVerdict {
  const v: ComplianceVerdict = { allowed: true, blockers: [], warnings: [] };

  if (verification === "rejected") {
    v.blockers.push("News item verification was REJECTED — cannot publish.");
  }
  if (verification === "unverified" || verification === "single_source") {
    const text = (captionText ?? "").toLowerCase();
    const hedged = HEDGE_WORDS.some(w => text.includes(w));
    if (!hedged) {
      v.blockers.push(
        `Verification is ${verification.toUpperCase()} but the caption contains no hedging language (alleged / developing / reportedly / according to…). Rumors must never read as facts.`
      );
    } else {
      v.warnings.push(`Verification is ${verification} — caption hedging detected, keep it on publish.`);
    }
  }
  if (sensitivity === "high") {
    v.warnings.push("HIGH sensitivity (crime/violence/injury/minors/legal/death) — manual owner approval is mandatory; wording must be careful and sourced.");
  }
  v.allowed = v.blockers.length === 0;
  return v;
}

// Auto-flag sensitivity at intake from text content.
const HIGH_SENSITIVITY_PATTERNS = /\b(murder|killed|killing|shooting|shot|stabbed|assault|arrested|charged|indicted|lawsuit|sued|overdose|suicide|died|death|dead|minor|underage|kidnap|abuse|weapon|gun)\b/i;

export function detectSensitivity(text: string): SensitivityLevel {
  if (HIGH_SENSITIVITY_PATTERNS.test(text)) return "high";
  return "low";
}

// ─── The convert-to-draft gate (the law) ─────────────────────────────────────

export function canConvertToDraft(pkg: {
  source_credit_text: string | null;
  source_urls: unknown[];
  rights_status: string;
  verification_status: string | null;
  package_family: string;
  caption: string | null;
}): ComplianceVerdict {
  const v: ComplianceVerdict = { allowed: true, blockers: [], warnings: [] };

  if (!pkg.source_credit_text?.trim()) v.blockers.push("Missing source credit text.");
  if (!Array.isArray(pkg.source_urls) || pkg.source_urls.length === 0) v.blockers.push("Missing source URL(s).");

  if (["unknown", "blocked", "needs_review"].includes(pkg.rights_status)) {
    v.blockers.push(`Rights status "${pkg.rights_status}" — cannot become a draft.`);
  }

  if (pkg.package_family === "news_media" && pkg.verification_status) {
    const nv = newsVerificationVerdict(
      pkg.verification_status as VerificationStatus,
      "low",
      pkg.caption
    );
    v.blockers.push(...nv.blockers);
    v.warnings.push(...nv.warnings);
  }

  v.allowed = v.blockers.length === 0;
  return v;
}
