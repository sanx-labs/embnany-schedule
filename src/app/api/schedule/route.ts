export const runtime = "edge";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import {
  getScheduleEventsFromNotion,
  isNotionConfigured,
  NotionSyncError,
} from "@schedule/lib/notion/getScheduleEvents";

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

const liveHeaders = {
  "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600",
};

export async function GET() {
  if (!isNotionConfigured()) {
    return NextResponse.json(
      { error: "Notion is not configured" },
      { status: 503, headers: noStoreHeaders },
    );
  }

  try {
    const events = await getScheduleEventsFromNotion();
    return NextResponse.json({ events }, { headers: liveHeaders });
  } catch (error) {
    console.error("[API /schedule] Notion fetch failed:", error);
    const detail =
      error instanceof Error ? error.message : "Unknown Notion sync error";
    const code = error instanceof NotionSyncError ? error.code : undefined;
    return NextResponse.json(
      {
        error: "Failed to load schedule from Notion",
        detail,
        code,
      },
      { status: 500, headers: noStoreHeaders },
    );
  }
}
