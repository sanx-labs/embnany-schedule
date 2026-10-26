"use client";

import { useMemo, useState } from "react";
import { EventCard } from "@schedule/components/EventCard";
import { MonthNavigator } from "@schedule/components/MonthNavigator";
import { ScheduleHeader } from "@schedule/components/ScheduleHeader";
import type { CelebrityProfile, ScheduleEvent } from "@schedule/types/schedule";
import { groupEventsByDate, parseEventDate } from "@schedule/utils/eventDate";

type ScheduleViewProps = {
  profile: CelebrityProfile;
  events: ScheduleEvent[];
  loading?: boolean;
};

function monthKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}`;
}

function formatMonthLabel(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function isSameMonth(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function sortEventsForMonth(
  monthEvents: ScheduleEvent[],
  viewedMonth: Date,
) {
  const today = new Date();
  const viewingCurrentMonth = isSameMonth(viewedMonth, today);

  const sorted = [...monthEvents].sort(
    (a, b) => parseEventDate(a.date).getTime() - parseEventDate(b.date).getTime(),
  );

  if (!viewingCurrentMonth) {
    return sorted;
  }

  const todayStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();

  const upcoming: ScheduleEvent[] = [];
  const past: ScheduleEvent[] = [];

  for (const event of sorted) {
    if (parseEventDate(event.date).getTime() < todayStart) {
      past.push(event);
    } else {
      upcoming.push(event);
    }
  }

  return [...upcoming, ...past];
}

export function ScheduleView({ profile, events, loading = false }: ScheduleViewProps) {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });

  const monthsWithEvents = useMemo(() => {
    const keys = new Set<string>();
    for (const event of events) {
      const date = new Date(`${event.date}T12:00:00`);
      keys.add(monthKey(date));
    }
    return keys;
  }, [events]);

  const dayGroups = useMemo(() => {
    const key = monthKey(currentMonth);
    const monthEvents = events.filter(
      (event) => monthKey(parseEventDate(event.date)) === key,
    );
    return groupEventsByDate(sortEventsForMonth(monthEvents, currentMonth));
  }, [events, currentMonth]);

  function scrollToMonthStart() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function shiftMonth(delta: number) {
    setCurrentMonth(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1),
    );
    scrollToMonthStart();
  }

  function selectMonth(date: Date) {
    setCurrentMonth(date);
    scrollToMonthStart();
  }

  const monthNavProps = {
    label: formatMonthLabel(currentMonth),
    selected: currentMonth,
    monthsWithEvents,
    onMonthSelect: selectMonth,
    onPrevious: () => shiftMonth(-1),
    onNext: () => shiftMonth(1),
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-10">
      <ScheduleHeader profile={profile} />

      <div className="mt-6 flex w-full flex-col items-center gap-8 sm:mt-7 lg:mt-8">
        <div className="sticky top-3 z-30 flex w-full max-w-[630px] shrink-0 justify-center py-2 sm:top-4">
          <MonthNavigator {...monthNavProps} />
        </div>

        <section
          className="w-full max-w-[630px] space-y-3"
          aria-label="Event schedule"
        >
          {loading ? (
            <p className="glass-empty rounded-3xl py-12 text-center text-white/70">
              Loading schedule from Notion…
            </p>
          ) : dayGroups.length > 0 ? (
            dayGroups.map((group) => (
              <EventCard
                key={group.date}
                date={group.date}
                events={group.events}
              />
            ))
          ) : (
            <p className="glass-empty rounded-3xl py-12 text-center text-white/70">
              No events scheduled for this month.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
