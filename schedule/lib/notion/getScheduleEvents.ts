import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import { mapNotionPageToEvent } from "@schedule/lib/notion/mapPageToEvent";
import type { ScheduleEvent } from "@schedule/types/schedule";

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";

function sanitizeEnvValue(value: string): string {
  let trimmed = value.trim();
  while (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function readEnv(name: string) {
  const raw = process.env[name];
  if (!raw) return "";
  return sanitizeEnvValue(raw);
}

function isPlaceholderValue(value: string) {
  return (
    !value ||
    value.includes("your_notion") ||
    value.includes("your_32_char") ||
    value === "your_notion_integration_secret_here" ||
    value === "your_32_char_database_id_here"
  );
}

function isConfigured() {
  const apiKey = readEnv("NOTION_API_KEY");
  const databaseId = readEnv("NOTION_DATABASE_ID");
  return Boolean(
    apiKey &&
      databaseId &&
      !isPlaceholderValue(apiKey) &&
      !isPlaceholderValue(databaseId),
  );
}

function normalizeNotionId(id: string): string {
  const trimmed = sanitizeEnvValue(id);
  if (trimmed.includes("-")) return trimmed;
  const hex = trimmed.replace(/[^a-fA-F0-9]/g, "");
  if (hex.length !== 32) return trimmed;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class NotionSyncError extends Error {
  code?: string;
  status?: number;

  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.name = "NotionSyncError";
    this.code = code;
    this.status = status;
  }
}

type NotionErrorBody = {
  code?: string;
  message?: string;
  status?: number;
};

type NotionDatabaseResponse = {
  object?: string;
  id?: string;
  data_sources?: Array<{ id?: string; name?: string }>;
};

type NotionQueryResponse = {
  results?: unknown[];
  has_more?: boolean;
  next_cursor?: string | null;
};

async function notionRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${NOTION_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${readEnv("NOTION_API_KEY")}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const errorBody = (body ?? {}) as NotionErrorBody;
    throw new NotionSyncError(
      errorBody.message || `Notion API returned ${response.status}`,
      errorBody.code,
      errorBody.status ?? response.status,
    );
  }

  return body as T;
}

async function resolveDataSourceId(databaseId: string): Promise<string> {
  const configuredDataSourceId = readEnv("NOTION_DATA_SOURCE_ID");
  if (configuredDataSourceId) {
    return normalizeNotionId(configuredDataSourceId);
  }

  try {
    const database = await notionRequest<NotionDatabaseResponse>(
      `/databases/${databaseId}`,
    );
    const dataSourceId = database.data_sources?.[0]?.id;
    if (dataSourceId) {
      return dataSourceId;
    }
    throw new NotionSyncError(
      "No data source found on this Notion database. Share the database with the integration, or set NOTION_DATA_SOURCE_ID.",
      "data_source_missing",
      404,
    );
  } catch (error) {
    if (
      !(error instanceof NotionSyncError) ||
      (error.status !== 404 && error.code !== "object_not_found")
    ) {
      throw error;
    }

    try {
      await notionRequest(`/data_sources/${databaseId}`);
      return databaseId;
    } catch {
      throw error;
    }
  }
}

function isQueryablePage(value: unknown): value is PageObjectResponse {
  if (!value || typeof value !== "object") return false;
  const page = value as { object?: string; properties?: unknown };
  return page.object === "page" && Boolean(page.properties);
}

type CachedSchedule = {
  events: ScheduleEvent[];
  expiresAt: number;
};

let scheduleCache: CachedSchedule | null = null;
const SCHEDULE_CACHE_MS = 60_000;

/**
 * Fetches all rows from the configured Notion database (server-side only).
 * Uses Notion REST: database_id → data_source_id → data source query.
 */
export async function getScheduleEventsFromNotion(): Promise<ScheduleEvent[]> {
  if (!isConfigured()) {
    return [];
  }

  if (scheduleCache && scheduleCache.expiresAt > Date.now()) {
    return scheduleCache.events;
  }

  const databaseId = normalizeNotionId(readEnv("NOTION_DATABASE_ID"));
  const dataSourceId = await resolveDataSourceId(databaseId);
  const events: ScheduleEvent[] = [];
  let cursor: string | undefined;
  let usedPropertySort = true;

  try {
    do {
      const payload: Record<string, unknown> = {
        start_cursor: cursor,
        page_size: 100,
      };

      if (usedPropertySort) {
        payload.sorts = [
          {
            timestamp: "created_time",
            direction: "ascending",
          },
        ];
      }

      let response: NotionQueryResponse;
      try {
        response = await notionRequest<NotionQueryResponse>(
          `/data_sources/${dataSourceId}/query`,
          {
            method: "POST",
            body: JSON.stringify(payload),
          },
        );
      } catch (error) {
        if (
          usedPropertySort &&
          error instanceof NotionSyncError &&
          (error.code === "validation_error" || error.status === 400)
        ) {
          usedPropertySort = false;
          cursor = undefined;
          continue;
        }
        throw error;
      }

      for (const result of response.results ?? []) {
        if (!isQueryablePage(result)) continue;
        const event = mapNotionPageToEvent(result);
        if (event) events.push(event);
      }

      cursor = response.has_more
        ? (response.next_cursor ?? undefined)
        : undefined;
    } while (cursor);
  } catch (error) {
    console.error("[Notion] Failed to fetch schedule:", error);
    throw error;
  }

  events.sort((left, right) => {
    const leftKey = left.startsAt ?? left.date;
    const rightKey = right.startsAt ?? right.date;
    return leftKey.localeCompare(rightKey);
  });

  scheduleCache = {
    events,
    expiresAt: Date.now() + SCHEDULE_CACHE_MS,
  };

  return events;
}

export function isNotionConfigured() {
  return isConfigured();
}
