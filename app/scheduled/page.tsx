"use client";

import DashboardShell from "@/app/components/dashboard/DashboardShell";
import SectionCard from "@/app/components/dashboard/SectionCard";
import ContentQueue from "@/app/components/ContentQueue";
import ApprovalQueue from "@/app/components/ApprovalQueue";
import SchedulingAssistant from "@/app/components/SchedulingAssistant";

// Scheduled — posts waiting to go out, what needs approval, and best times.
export default function ScheduledPage() {
  return (
    <DashboardShell>
      <SectionCard title="Scheduled posts" subtitle="Posts queued to publish automatically at their time.">
        <ContentQueue />
      </SectionCard>

      <SectionCard title="Needs your approval" subtitle="Posts waiting on you before they can go out." collapsible defaultOpen={false}>
        <ApprovalQueue />
      </SectionCard>

      <SectionCard title="Best times to post" subtitle="Suggested posting times based on your account." collapsible defaultOpen={false}>
        <SchedulingAssistant />
      </SectionCard>
    </DashboardShell>
  );
}
