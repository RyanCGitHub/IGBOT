"use client";

import DashboardShell from "@/app/components/dashboard/DashboardShell";
import SectionCard from "@/app/components/dashboard/SectionCard";
import AnalyticsCommand from "@/app/components/dashboard/AnalyticsCommand";
import AnalyticsOverview from "@/app/components/dashboard/AnalyticsOverview";
import ReelsAutopilot from "@/app/components/ReelsAutopilot";

import InstagramConnection from "@/app/components/InstagramConnection";
import AIPersonas from "@/app/components/AIPersonas";
import ApprovalQueue from "@/app/components/ApprovalQueue";
import Campaigns from "@/app/components/Campaigns";
import ContentPlanner from "@/app/components/ContentPlanner";
import SchedulingAssistant from "@/app/components/SchedulingAssistant";
import PerformanceReview from "@/app/components/PerformanceReview";
import LearningEngine from "@/app/components/LearningEngine";
import CreatePost from "@/app/components/CreatePost";
import PostLibrary from "@/app/components/PostLibrary";
import Analytics from "@/app/components/Analytics";
import ContentLibrary from "@/app/components/ContentLibrary";
import TestPublish from "@/app/components/TestPublish";
import PublishHistory from "@/app/components/PublishHistory";

// Owner-directed layout (2026-06-12): the visible dashboard is ONLY analytics
// + current production. Every operational tool stays functional but lives
// inside the collapsed "Operations & Tools" section below.
export default function Home() {
  return (
    <DashboardShell>
      {/* 1. The view that matters: account + per-reel analytics */}
      <AnalyticsCommand />

      {/* 2. What's in production right now */}
      <SectionCard
        title="Production Pipeline"
        subtitle="Reels currently being produced — and the autopilot switch"
        collapsible
        defaultOpen
      >
        <ReelsAutopilot />
      </SectionCard>

      {/* 3. Everything else — functional, accessible, out of sight */}
      <SectionCard
        title="Operations & Tools"
        subtitle="Connection, personas, campaigns, manual posting, learning engine, legacy tools"
        collapsible
        defaultOpen={false}
      >
        <div className="space-y-6">
          <InstagramConnection />
          <AnalyticsOverview />
          <AIPersonas />
          <ApprovalQueue />
          <Campaigns />
          <ContentPlanner />
          <SchedulingAssistant />
          <PerformanceReview />
          <LearningEngine />
          <CreatePost />
          <PostLibrary />
          <Analytics />
          <TestPublish />
          <PublishHistory />
          <ContentLibrary />
        </div>
      </SectionCard>
    </DashboardShell>
  );
}
