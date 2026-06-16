"use client";

import DashboardShell from "@/app/components/dashboard/DashboardShell";
import SectionCard from "@/app/components/dashboard/SectionCard";
import InstagramConnection from "@/app/components/InstagramConnection";
import PerformanceReview from "@/app/components/PerformanceReview";
import LearningEngine from "@/app/components/LearningEngine";
import Campaigns from "@/app/components/Campaigns";
import ContentPlanner from "@/app/components/ContentPlanner";
import TestPublish from "@/app/components/TestPublish";

// Settings — account connections + links to the bigger tools, with all the
// experimental/developer tools tucked under Advanced.
function ToolLink({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <a href={href} className="flex items-center justify-between rounded-xl border border-slate-700/60 bg-slate-900/70 px-4 py-3 transition hover:bg-slate-800">
      <div>
        <p className="text-sm font-medium text-slate-100">{title}</p>
        <p className="text-xs text-slate-400">{desc}</p>
      </div>
      <span className="text-slate-400">→</span>
    </a>
  );
}

export default function SettingsPage() {
  return (
    <DashboardShell>
      <SectionCard title="Connected accounts" subtitle="Connect or reconnect your Instagram accounts.">
        <InstagramConnection />
      </SectionCard>

      <SectionCard title="More tools" subtitle="Bigger workflows that live on their own pages.">
        <div className="grid gap-2 sm:grid-cols-3">
          <ToolLink href="/media-network" title="Media Network" desc="News & clip pages" />
          <ToolLink href="/viral-checker" title="Viral Checker" desc="Score & accuracy" />
          <ToolLink href="/analytics" title="Analytics" desc="Synced performance" />
        </div>
      </SectionCard>

      <SectionCard
        title="Advanced"
        subtitle="Experimental and developer tools. You usually don't need these."
        collapsible
        defaultOpen={false}
      >
        <div className="space-y-6">
          <PerformanceReview />
          <LearningEngine />
          <Campaigns />
          <ContentPlanner />
          <TestPublish />
        </div>
      </SectionCard>
    </DashboardShell>
  );
}
