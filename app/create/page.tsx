"use client";

import DashboardShell from "@/app/components/dashboard/DashboardShell";
import SectionCard from "@/app/components/dashboard/SectionCard";
import CreatePost from "@/app/components/CreatePost";

// Create Post — the main flow: pick account → media/persona → caption → viral
// check → schedule/publish.
export default function CreatePage() {
  return (
    <DashboardShell>
      <SectionCard
        title="Create a post"
        subtitle="Pick an account, add media or a persona, generate a caption, then schedule or publish."
      >
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-200">
          <span>Want to check how it&apos;ll perform first?</span>
          <a href="/viral-checker" className="font-semibold underline hover:text-cyan-100">Run a viral check →</a>
        </div>
        <CreatePost />
      </SectionCard>
    </DashboardShell>
  );
}
