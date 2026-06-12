"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api-fetch";

// Ambient abstract waves behind the dashboard. They FLOW while any reel is in
// production and FREEZE when the pipeline is idle — a living status light.
// Pure CSS transforms (pause via animation-play-state), pointer-events-none,
// very low opacity so the analytics stay readable.

const ACTIVE_STATUSES = new Set([
  "queued", "briefed", "keyframes_ready", "clips_generating",
  "lipsyncing", "clips_ready", "assembled", "captioned", "publishing",
]);

export default function BackgroundWaves() {
  const [producing, setProducing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await apiFetch("/api/reels/runs?limit=10");
        const data = await res.json();
        if (!cancelled && res.ok && data.success !== false) {
          setProducing((data.runs as { status: string }[]).some(r => ACTIVE_STATUSES.has(r.status)));
        }
      } catch { /* keep last known state */ }
    }
    check();
    const timer = setInterval(check, 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  const play = producing ? "running" : "paused";

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <svg
        className="absolute -left-1/4 top-0 h-[140%] w-[150%] opacity-[0.16]"
        viewBox="0 0 1600 1000"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <linearGradient id="wgA" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#22d3ee" />
            <stop offset="1" stopColor="#0ea5e9" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="wgB" x1="1" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#e879f9" />
            <stop offset="1" stopColor="#a21caf" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="wgC" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#34d399" />
            <stop offset="1" stopColor="#0d9488" stopOpacity="0" />
          </linearGradient>
        </defs>

        <g style={{ animation: "waveDrift 26s ease-in-out infinite", animationPlayState: play }}>
          <path
            d="M-100 280 C 200 180, 420 420, 760 300 S 1300 160, 1700 320"
            stroke="url(#wgA)" strokeWidth="90" strokeLinecap="round"
          />
        </g>
        <g style={{ animation: "waveDrift 34s ease-in-out infinite reverse", animationPlayState: play }}>
          <path
            d="M-100 560 C 260 480, 520 700, 880 560 S 1380 420, 1700 600"
            stroke="url(#wgB)" strokeWidth="120" strokeLinecap="round"
          />
        </g>
        <g style={{ animation: "waveSway 30s ease-in-out infinite", animationPlayState: play }}>
          <path
            d="M-100 820 C 300 740, 560 940, 920 820 S 1420 700, 1700 860"
            stroke="url(#wgC)" strokeWidth="70" strokeLinecap="round"
          />
        </g>
        <g style={{ animation: "waveSway 40s ease-in-out infinite reverse", animationPlayState: play }}>
          <path
            d="M-100 80 C 340 30, 640 200, 1000 90 S 1460 -20, 1700 120"
            stroke="url(#wgB)" strokeWidth="50" strokeLinecap="round" opacity="0.7"
          />
        </g>
      </svg>
    </div>
  );
}
