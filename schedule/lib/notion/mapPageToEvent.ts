import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import type { ScheduleEvent } from "@schedule/types/schedule";
import {
  getDisplayText,
  getGuests,
  getPlainText,
  getRichTextWithLink,
  getUrl,
} from "@schedule/lib/notion/extractors";
import { parseEventDateTimeFromNotion } from "@schedule/utils/eventTimezone";
import { getNotionPropertyNames } from "@schedule/lib/notion/propertyConfig";

type PageProperties = PageObjectResponse["properties"];
type PropertyValue = PageProperties[string];

function firstPropertyOfType(
  properties: PageProperties,
  type: PropertyValue["type"],
): PropertyValue | undefined {
  return Object.values(properties).find((property) => property?.type === type);
}

export function mapNotionPageToEvent(page: PageObjectResponse): ScheduleEvent | null {
  const { properties } = page;
  const props = getNotionPropertyNames();

  const titleProp =
    properties[props.title] ?? firstPropertyOfType(properties, "title");
  const title = getPlainText(titleProp);
  const locationField = getRichTextWithLink(properties[props.location]);
  const location = locationField.text || "TBA";
  const locationUrl = locationField.url;

  const dateProp =
    properties[props.date]?.type === "date"
      ? properties[props.date]
      : firstPropertyOfType(properties, "date");
  const notionStart =
    dateProp?.type === "date" ? dateProp.date?.start : undefined;
  const { date, time, startsAt, eventTimeZone } = parseEventDateTimeFromNotion(
    notionStart,
    title,
  );

  if (!title || !date) {
    return null;
  }
  const hashtagField = getRichTextWithLink(properties[props.hashtag]);
  const officialUrl = getUrl(properties[props.officialUrl]) ?? "";

  return {
    id: page.id,
    date,
    title,
    location,
    locationUrl,
    time,
    startsAt,
    eventTimeZone,
    guests: getGuests(properties[props.guests]),
    trendingKeyword: getDisplayText(properties[props.trendingKeyword]),
    hashtag: hashtagField.text,
    hashtagUrl: hashtagField.url,
    officialUrl,
  };
}
