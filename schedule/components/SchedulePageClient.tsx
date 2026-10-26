"use client";

import { useEffect, useState } from "react";
import { BackToPortalButton } from "@schedule/components/BackToPortalButton";
import { ScheduleView } from "@schedule/components/ScheduleView";
import { TimezoneSelector } from "@schedule/components/TimezoneSelector";
import { VideoBackground } from "@/components/VideoBackground";
import { events as mockEvents, profile } from "@schedule/data/mockSchedule";
import type { ScheduleEvent } from "@schedule/types/schedule";

const noStoreFetch: RequestInit = {
  cache: "no-store",
  headers: { "Cache-Control": "no-cache" },
};

export function SchedulePageClient() {
  const [events, setEvents] = useState<ScheduleEvent[]>(mockEvents);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usingMockData, setUsingMockData] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadSchedule() {
      try {
        const response = await fetch("/api/schedule", noStoreFetch);

        if (cancelled) return;

        if (response.status === 503) {
          setEvents(mockEvents);
          setUsingMockData(true);
          setError(null);
          return;
        }

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as {
            error?: string;
            detail?: string;
            code?: string;
          } | null;
          const detail = payload?.detail?.trim();
          const code = payload?.code?.trim();
          throw new Error(
            [detail, code ? `(${code})` : ""]
              .filter(Boolean)
              .join(" ") || `Schedule API returned ${response.status}`,
          );
        }

        const data = (await response.json()) as { events?: ScheduleEvent[] };
        setEvents(data.events ?? []);
        setUsingMockData(false);
        setError(data.events?.length ? null : "Notion returned no events.");
      } catch (fetchError) {
        console.error("[Schedule] Client fetch failed:", fetchError);
        if (!cancelled) {
          setEvents(mockEvents);
          setUsingMockData(true);
          const reason =
            fetchError instanceof Error ? fetchError.message : null;
          setError(
            reason
              ? `Unable to load live schedule: ${reason}`
              : "Unable to load live schedule. Showing sample data until Notion sync recovers.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadSchedule();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <VideoBackground />
      <BackToPortalButton />
      <TimezoneSelector />
      <main className="relative flex min-h-dvh flex-col">
        <div className="flex-1">
          {loading && (
            <p className="mx-auto mb-4 max-w-lg px-4 text-center text-sm text-white/70">
              Loading schedule from Notion…
            </p>
          )}
          {!loading && error && (
            <p className="mx-auto mb-4 max-w-lg px-4 text-center text-sm text-white/80">
              {error}
            </p>
          )}
          {!loading && usingMockData && !error && (
            <p className="mx-auto mb-4 max-w-lg px-4 text-center text-sm text-white/70">
              Notion is not configured on the server. Showing sample data.
            </p>
          )}
          <ScheduleView profile={profile} events={events} />
        </div>
      </main>
    </>
  );
}
