"use client";

import DashboardShell from "@/app/components/dashboard/DashboardShell";
import SectionCard from "@/app/components/dashboard/SectionCard";
import AIPersonas from "@/app/components/AIPersonas";

// Personas — your fictional AI on-camera identities.
export default function PersonasPage() {
  return (
    <DashboardShell>
      <SectionCard title="Personas" subtitle="Your fictional AI presenters — create one, keep its look consistent, and use it on posts.">
        <AIPersonas />
      </SectionCard>
    </DashboardShell>
  );
}
