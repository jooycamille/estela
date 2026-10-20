import type { ItineraryItem, Link, Suggestion, Trip } from "../shared/types.ts";
import { cityOn } from "./suggestions.ts";

// Search links on booking sites for a suggestion. Plain search pages (no affiliate tracking); each was checked to
// accept a search term in the URL — except Agoda, whose search needs internal city IDs, so it opens Agoda's search.

const q = encodeURIComponent;
const adults = (trip: Trip) => (trip.party === "solo" || trip.party === "colleagues" ? 1 : 2);

export function activityLinks(text: string): Link[] {
  return [
    { label: "GetYourGuide", url: `https://www.getyourguide.com/s/?q=${q(text)}` },
    { label: "Viator", url: `https://www.viator.com/searchResults/all?text=${q(text)}` },
    { label: "Klook", url: `https://www.klook.com/search/result/?query=${q(text)}` },
  ];
}

function stayLinks(city: string, checkIn: string | undefined, checkOut: string | undefined, trip: Trip): Link[] {
  const dates = checkIn && checkOut ? `&checkin=${checkIn}&checkout=${checkOut}` : "";
  return [
    { label: "Booking.com", url: `https://www.booking.com/searchresults.html?ss=${q(city)}${dates}&group_adults=${adults(trip)}&no_rooms=1&group_children=0` },
    { label: "Agoda", url: "https://www.agoda.com/" },
  ];
}

/** Adds booking links (and the city they search in) to suggestions that have something to book. */
export function addBookingLinks(suggestions: Suggestion[], trip: Trip, items: ItineraryItem[]): Suggestion[] {
  return suggestions.map((s) => {
    if (!s.search) return s;
    const when = s.search.checkIn ?? s.day ?? trip.startDate;
    const place = cityOn(when, trip, items);
    const links =
      s.search.kind === "stay"
        ? stayLinks(place, s.search.checkIn, s.search.checkOut, trip)
        : activityLinks(`${place} ${s.search.query ?? (s.search.kind === "transfer" ? "airport transfer" : "")}`.trim());
    return { ...s, links, place };
  });
}
