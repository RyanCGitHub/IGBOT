"use client";

import DashboardShell from "@/app/components/dashboard/DashboardShell";
import SectionCard from "@/app/components/dashboard/SectionCard";
import PostLibrary from "@/app/components/PostLibrary";
import PublishHistory from "@/app/components/PublishHistory";
import ContentLibrary from "@/app/components/ContentLibrary";

// Published — everything you've posted, with history + the image library.
export default function PublishedPage() {
  return (
    <DashboardShell>
      <SectionCard title="Published posts" subtitle="Everything that's gone live, with status and links.">
        <PostLibrary />
      </SectionCard>

      <SectionCard title="Publish history" subtitle="A log of every publish attempt." collapsible defaultOpen={false}>
        <PublishHistory />
      </SectionCard>

      <SectionCard title="Image library" subtitle="Generated images you can reuse." collapsible defaultOpen={false}>
        <ContentLibrary />
      </SectionCard>
    </DashboardShell>
  );
}
