"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import type { Persona } from "@/lib/supabase";

// Persona photos: generate a few photorealistic variations from the character
// bible, each scored by the realism quality gate, and auto-keep the most
// convincing one as the persona's reference (anchors a consistent look).

type Variation = { url: string; realism_score: number; looks_ai: boolean; artifacts: string[]; notes: string };

const scoreColor = (s: number) => s >= 85 ? "text-emerald-300" : s >= 70 ? "text-lime-300" : s >= 55 ? "text-amber-300" : "text-rose-300";

export default function PersonaPhotos({ persona, onSaved }: { persona: Persona; onSaved?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [variations, setVariations] = useState<Variation[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    setVariations([]);
    try {
      const res = await apiFetch("/api/personas/generate-image", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona_id: persona.id, variations: 3, save_best: true }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || "Generation failed.");
      setVariations(data.variations as Variation[]);
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          {persona.reference_image_url && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={persona.reference_image_url} alt="" className="h-14 w-14 rounded-lg object-cover" />
          )}
          <div>
            <p className="text-sm font-medium text-slate-800">Persona photos</p>
            <p className="text-xs text-slate-500">
              {persona.reference_image_url
                ? <>Reference set{persona.realism_score != null ? <> · realism <span className={scoreColor(persona.realism_score).replace("300", "600")}>{persona.realism_score}</span></> : null}</>
                : "No reference image yet — generate to set the look."}
            </p>
          </div>
        </div>
        <button type="button" onClick={generate} disabled={busy}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50">
          {busy ? "Generating + checking realism…" : "Generate 3 photos"}
        </button>
      </div>

      {error && <p className="mt-2 rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-xs text-rose-600">{error}</p>}

      {variations.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {variations.map((v, i) => (
            <div key={i} className={`overflow-hidden rounded-lg border ${i === 0 ? "border-emerald-400 ring-1 ring-emerald-300" : "border-slate-200"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={v.url} alt="" className="aspect-[2/3] w-full object-cover" />
              <div className="px-2 py-1.5">
                <p className="flex items-center justify-between text-[11px]">
                  <span className={`font-bold ${scoreColor(v.realism_score)} !text-slate-700`}>Realism <span className={scoreColor(v.realism_score).replace("300", "600")}>{v.realism_score}</span></span>
                  {i === 0 && <span className="rounded bg-emerald-100 px-1 text-[10px] font-semibold text-emerald-700">Kept</span>}
                </p>
                {v.artifacts.length > 0 && <p className="mt-0.5 truncate text-[10px] text-rose-500" title={v.artifacts.join(", ")}>⚠ {v.artifacts[0]}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-[10px] text-slate-400">The highest-realism variation is auto-kept as the reference. Regenerate if none look right. Personas are fictional — never a real person.</p>
    </div>
  );
}
