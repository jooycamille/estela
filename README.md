<img src="public/brand/heyjoy-logo-tagline.svg" alt="Hey Joy — Go with Joy" height="96">

# Hey Joy

*Go with Joy* — your friendly trip assistant.

## Brand

The logo is a speech bubble (Joy saying "hey") with a winking face whose smile becomes a flight path and takes off as a paper plane, a nod to forwarding your bookings to Joy. Files are in `public/brand/`:

| File | Use |
|---|---|
| `heyjoy-logo.svg` / `-dark.svg` | Horizontal logo for light / dark backgrounds |
| `heyjoy-logo-tagline.svg` / `-dark.svg` | Logo with "Go with Joy" |
| `heyjoy-mark.svg`, `heyjoy-mark-512.png` | Icon only (also the favicon) |
| `heyjoy-app-icon.svg`, `heyjoy-app-icon-1024.png`, `apple-touch-icon.png` | App/home-screen icon |

Colours are a sunset gradient from `#FF8A3D` to `#FF3D7F`, with ink `#1E2140`. In the app, buttons use a deeper `#D63A2F` → `#D42A68` gradient so white text passes WCAG AA contrast. All theme colours are CSS variables at the top of `src/styles.css`, for both light and dark mode. The wordmark is Nunito Black (SIL Open Font License), converted to outlines so it looks the same everywhere. To regenerate the files after changing `scripts/brand/mark.mjs`, run `npm run brand`.

A trip planner that keeps your itinerary in one place:

- **Itinerary**: trips with flights, accommodation and activities, grouped by day.
- **Add bookings from email or by hand**: paste a confirmation email or upload a `.eml`. Claude pulls out flights, stays and activities, and you review them before saving. A forwarding webhook can add them automatically.
- **Live flight tracking**: flights are checked by flight number and date. Delays, new times, cancellations, and gate or terminal changes show up as alerts.
- **Suggestions**: tips for business, leisure or "bleisure" trips, based on who's travelling and your travel style. They also flag gaps such as nights without a booked stay, tight connections, late arrivals, and meetings booked too soon after landing.

## Run it

```bash
npm install
cp .env.example .env   # optional: add keys
npm run dev
```

Open http://localhost:5173. The API runs on :3001, and data is saved to `data/db.json`.

The app works without any keys:

| Feature | Without a key | With a key |
|---|---|---|
| Email parsing | Basic regex parser (flights, hotel check-in/out) | `ANTHROPIC_API_KEY`: Claude reads any booking email |
| Suggestions | Rule-based tips | Claude: personalised ideas (✨ button) |
| Flight lookup & status | Demo flights, with a "Simulate a change" button for testing | Header → **Flight data**: paste an [AeroDataBox](https://rapidapi.com/aedbx-aedbx/api/aerodatabox) key (recommended) or an [Aviationstack](https://aviationstack.com) key |

## Adding a flight

Enter the flight number and departure date. The app looks up the scheduled flight: airline, route, local departure and arrival times, terminals and aircraft. It then asks **"Is this your flight?"** For multi-leg flight numbers (such as QF1 SYD → SIN → LHR), you choose a leg or the whole journey.
- **Yes, that's my flight** fills in the details, and you can add a seat, booking ref and notes.
- **Not quite, let me edit** opens every field with the schedule values filled in. Any field you change is highlighted and shows the schedule value with an **undo** link.
- If the flight isn't found, you enter the details yourself.

Lookups go through `GET /api/flights/lookup?flightNumber=QF1&date=2026-11-03` and are cached for 30 minutes. Without `AERODATABOX_API_KEY`, only a few sample flights are recognised (QF1, SQ232, SQ221, BA15, QF401, JQ501, VA811, EK413, UA870).

## Flight data services

| | AeroDataBox (recommended) | AirLabs | Aviationstack |
|---|---|---|---|
| Free plan | 400 units/month = ~200 lookups | Free plan exists; set your allowance in settings | 100 requests/month |
| Look up a flight number on a future date | Yes, dated flights up to 365 days ahead (1 lookup) | Yes, from the regular weekly schedule (1 request), so one-off changes don't show; times may need a paid plan | Only via the departure airport's schedule: 2 requests, the flight must have flown recently, may need a paid plan, 1 schedule request/minute |
| Live status | Yes | Nearest flight: estimates, delays, gates | Today's flights |
| Secure connection on free plan | Yes | Yes | May require plain HTTP (opt-in in settings) |

Flightradar24's API has no schedules (only positions and actual takeoff/landing times). SerpApi's Google Flights engine searches fares by route, not by flight number. Neither is used.

The app counts usage per month, shows it in **Flight data** settings, and pauses automatic checks at 90% of the allowance. Keys are stored in `data/settings.json` (owner-only permissions) and are never sent back to the browser.

## How flight updates work

`server/flightStatus.ts` runs a poller every `FLIGHT_POLL_MINUTES` (default 15). It checks flights that depart in the next 3 days or departed in the last 12 hours, each at its own cadence: twice a day when 1–3 days out, every 3 hours on the day, and every 30 minutes in the last 6 hours and while in the air. Each check is compared with the last known state, and differences are saved as `changes`. Those show in the UI until you click **Got it**. Times are stored as the airport's local time (`YYYY-MM-DDTHH:mm`), just as they appear on boarding passes.

To use another data source (FlightAware AeroAPI, Aviationstack, Cirium), implement the `FlightProvider` interface.

## Prepare: weather, checklist and packing

Each trip has a **Prepare** view next to the itinerary, built from its bookings:

- **Where you'll be:** cities you stay in, worked out from your flights. Connections under 24 hours are listed separately, and the flight home is ignored. See `server/tripPlaces.ts`.
- **Weather per stop** from [Open-Meteo](https://open-meteo.com/) (free, no key, credit shown in the app), for the city itself rather than its airport. Within about 15 days it's the forecast; further out, it's typical weather for those dates, averaged over the last 3 years. Cached in `data/weather-cache.json`. See `server/weather.ts`.
- **Before you go:** travel insurance (naming risky booked activities such as snorkelling or hiking), passport validity, entry requirements (linking to official sources, since rules depend on your passport), a US ESTA when you transit the US, Smartraveller for Australians, an eSIM, money and currencies, offline maps, document copies, online check-in per journey, and your activities' own to-dos.
- **Border forms:** one item per border you cross by air, in travel order. Each says what that country needs and whether you do it online before flying, on the plane, or on arrival:
  - Colombia's Check-MIG, both arriving and leaving, due 1 hour before the flight
  - US immigration and customs at the first US airport, even when only connecting
  - Mexico's customs declaration on the plane, and Panama's customs declaration
  - Australia's Incoming Passenger Card on the way home
  - Singapore's SG Arrival Card, Thailand's TDAC, the Philippines' eTravel, Japan's Visit Japan Web, New Zealand's Traveller Declaration and Canada's declaration
  - for any other country, a reminder to check, with the IATA link

  Connections inside other countries' airports cross no border, so they don't get an item. Each item links to the official site. See `server/arrivalForms.ts`.
- **Packing list:** essentials, plug adapters for your home country, long-flight comforts, clothes for the weather at each stop, everything your activities say to bring or wear, and items for your trip type.

You can tick items off and add your own; this is saved per trip. Set your home country once (it's guessed from your first flight) for plug, currency and entry tips. See `server/prep.ts`.

## Booking links on suggestions

Bookable suggestions link to searches on **GetYourGuide, Viator and Klook** (tours, tickets, classes, day trips, transfers) and **Booking.com** and **Agoda** (accommodation). Searches use the city you'll be in that day, worked out from your flights. Booking.com gets your check-in and check-out dates. Agoda's search only accepts its internal city IDs, so its link opens Agoda's search page for you to type the city. The links are plain search pages with no affiliate tracking. They're built in `server/bookingLinks.ts`.

## Trip parts

A trip can be split into **parts** with their own dates and companions, for example "Mexico & Panama", solo, followed by "Colombia with family", with your partner's family, kids on some days, staying with them. Each part shows as a header in the itinerary, and Joy tailors to it:

- **Suggestions:** solo tips only for solo parts. Family parts get kid-friendly outings (or adult plans), a gift for your hosts, and Christmas and New Year notes with local traditions (Colombia, Mexico, Panama, the Philippines) and closures.
- **Prepare:** a host gift, treats for the kids, an outfit for holiday dinners, and "share your itinerary" for solo parts.

Missing-accommodation warnings still cover nights with hosts, on purpose, so no night is missed.

## Destinations

A trip's destinations are chosen from a search, with one or more of each:
- **countries**, using the browser and server's built-in country list
- **states and regions**, about 3,900 worldwide
- **cities** with 15,000+ people, about 32,000

State and city data comes from [GeoNames](https://www.geonames.org/) (CC BY 4.0). The trip's display name is built from the chosen places. Older trips with typed destinations are matched to places when you edit them. Without flights, the chosen countries and cities still feed the Prepare view (entry requirements, weather).

## Finding a property or its address

In the accommodation form, the **Property** and **Address** fields each have a **🔍 Find** button (or press Enter):

- **Property → address:** search "Hotel Santa Lucía" and pick it. Both the name and the address are filled in.
- **Address → property:** search "Durango 87" or "Cra 43A #7-50" and pick the address. Joy then lists hotels, hostels and guest houses on that street or next door. Tap one to fill in the name. If nothing is listed, the place is probably a private home or apartment, so just type its name.

Searches are centred on where you'll be on the check-in date: the city you last flew into, or a destination city. They understand Latin American street abbreviations (Cra, Cl, Av…) and Colombian `#7-50` numbers. If the map doesn't know a house number, the number you typed is kept.

The data comes from OpenStreetMap's [Nominatim](https://nominatim.org/) (© OpenStreetMap contributors, ODbL; the credit is shown in the app). Nominatim's usage policy applies: requests are spaced at least 1 second apart, cached for a day, and only sent when you press Find, never as you type. Coverage follows OSM: most hotels are on it, but some guest houses and private homes aren't, and you can always type the details yourself. See `server/lodging.ts`.

## Destination guides

Joy makes a guide for every city you stay in, worked out from your flights (or your chosen destinations if there are no flights yet). The guides sit in the **Show** switch, e.g. 🇲🇽 Mexico City, 🇵🇦 Panama City and 🇨🇴 Medellín. Each one has:

- **🍽️ Restaurants:** long-running local favourites for the city (fine dining goes first for luxury trips and drops down for budget ones), plus food markets and food halls. There's also a "Restaurants near your stay" map search.
- **🌮 Food to try:** local dishes and drinks, with seasonal ones (Christmas, Reyes) first when your dates fit.
- **🎯 Things to do for your style:** activities matched to the trip's travel styles.
- **📍 Must-visit places:** sights, neighbourhoods and day trips, with those matching your styles first.
- **🆘 Essentials near where you're staying** (at the top of the guide): the country's emergency number, then for each stay in that city the nearest pharmacies, hospitals, clinics, police stations and ATMs/banks. Each shows the distance, "24/7" and a phone number when the map has them, and a directions link. Stays are found by name, then by a Plus Code (e.g. "8Q7X+2C, Sample Town", decoded locally), then by address. The search widens from about 1.5 km to 15 km for countryside stays. Data comes from OpenStreetMap via Nominatim and is cached for a week in `data/essentials-cache.json`.

**+ Add** on any idea saves it to **Your picks**, where you can tick it off, plan it for a day, or turn it into an itinerary activity. Saved places join **Plan by area** like list entries. Guides follow your trip: new destinations get a guide, and empty guides for places you've dropped are removed. See `server/lists.ts` (guides), `server/essentials.ts` and `src/components/GuideView.tsx`.

## Your own lists

You can still make your own lists, like **🌮 Mexico Eats**, with **+ New list** at the end of the Show switch. Each list has a name, an icon and what it's about: a country or city on your trip, or anywhere. Joy guesses all three from the name. Lists sit in the **Show** switch next to Flights, Accommodation and Activities.

- **Entries** are either *places* (restaurants, markets, museums) or *things* (dishes, drinks, experiences). The headings follow the list's theme, e.g. "Places to eat" and "Food to try". Tick entries off when you've been or tried them, add notes, or use **+ Itinerary** to turn one into an activity.
- **Finding places:** a place you add is looked up on the map (OpenStreetMap), so Joy knows its neighbourhood. Use **Find** to pick the exact spot.
- **Joy's ideas:** every list gets suggestions for its theme and place, with seasonal ones (Christmas posadas, buñuelos and natilla, Medellín's alumbrados) first when your dates fit. Food ideas link to a map search for where to try them, and each list has "Find more" searches. Without Claude, the ideas come from a built-in guide of dishes, drinks and long-established sights (`server/listIdeas.ts`). With Claude connected, Joy also names specific restaurants and spots. **Not for me** hides an idea.
- **Things to do for your travel style:** below the list ideas, every list also suggests activities matched to the trip's travel styles (set in Edit trip) for its place. For example, paragliding and tejo in Medellín, a temazcal or a Teotihuacan balloon ride in Mexico City, and birdwatching on Pipeline Road near Panama City. Styles that suit the list come first (food activities in an "Eats" list), and the styles take turns so each one is represented. Each idea links to tour searches on GetYourGuide and Viator. Added ones go under a **Things to do** heading. Where Joy has nothing specific for a style, it suggests a general idea (a cooking class, a spa afternoon…) in that city.
- **Plan by area:** places from all your lists are grouped when they're within about 2.5 km of each other. Each group suggests good days: days you're in that city with little else on, avoiding travel days and spreading groups across different days. Pick a day and the places appear in the itinerary under that day in walking order, starting from your stay when it has a map position, with a **Route in Maps** link.

See `server/lists.ts`.

## Trip view and totals

Tabs above the itinerary filter it to **Flights**, **Accommodation** or **Activities**, each with a count.

**Booked so far** adds up every booking's price and converts the total into a currency you pick from the list next to it. Your choice is saved. The conversion uses daily rates from [ExchangeRate-API](https://www.exchangerate-api.com)'s free open endpoint (no key, about 160 currencies, credit shown as its terms require), cached in `data/fx-rates.json` for 12 hours. If the service is unreachable, the last saved rates are used. The total is an estimate: card and bank exchange rates will differ.

## Forwarding emails to a trip

In **Import from email**, click **Create forwarding address**. The trip gets its own address. Forward any booking confirmation to it, and the bookings are added to that trip within about 20 seconds. If the same booking is forwarded again, or an airline sends a schedule change, the existing item is updated instead of duplicated. A changed flight time also shows as an alert. Each received email is listed with what was imported. Emails can be **re-imported**, which updates the existing bookings in place. Imported stays include the property name, address, confirmation number, total price with currency, and any stated check-in/out times (saved in Notes).

- **Default (no setup):** a temporary inbox on [mail.tm](https://mail.tm), a free public disposable-email service, which the server checks every `INBOX_POLL_SECONDS`. It's good for development and personal use. Don't rely on it for sensitive mail, and keep the visible mail.tm credit that their terms require.
- **Your own domain (production):** set `INBOUND_EMAIL_DOMAIN` and `INBOUND_EMAIL_SECRET`, then route that domain's inbound mail (Postmark, Mailgun, SendGrid inbound parse, or a Cloudflare Email Worker) to `POST /api/inbound-email?token=<secret>`. Addresses look like `trip-<id>@yourdomain`. Mail sent to an address that isn't a trip address is matched to a trip by its dates.

**Gmail auto-forwarding:** Gmail sends a confirmation code to the new address before it will forward automatically. That email appears in the trip's email list with the code visible.

## Activities, tickets and links

Tour and activity confirmations (GetYourGuide, Viator, Klook, operators) become activities with:
- **When:** start and end time from the stated duration. In rescheduled emails the new time slot is used; crossed-out old times are ignored. If the email gives no date, it's estimated from the free-cancellation deadline (usually 24 hours before) and flagged until you confirm it.
- **Price, confirmation ID, PIN**, and **booking/ticket links**, unwrapped from email click-tracking.
- **An activity guide:** before you go, itinerary, what to bring, what to wear, do's, don'ts and not allowed, good to know, meeting point or pickup, end point, cancellation policy, and provider contact. You can edit it in the item form.

Ticket and itinerary attachments (PDFs, ticket images) from forwarded or uploaded emails are stored under `data/attachments/` and shown on each booking. You can attach your own files with **+ Attach file**. Only PDFs and images open in the browser; other files download.

## Tests

```bash
npm test
```

Runs the email-parser tests against sample confirmations in Agoda, Booking.com, Airbnb and generic-hotel formats (`tests/fixtures/`).

## Project layout

```
shared/types.ts        data model shared by client and server
server/index.ts        Express API
server/places.ts       destination search: countries, states/regions and cities (data: server/data/places.json, from GeoNames, CC BY 4.0; rebuild with `npm run places`)
server/airports.ts     airport search for the From/To pickers (data: server/data/airports.json, from OurAirports, public domain)
server/fx.ts           exchange rates for trip totals
server/tripPlaces.ts   stops and connections worked out from flights
server/weather.ts      weather per stop (Open-Meteo)
server/lodging.ts      property ↔ address lookup for stays (OpenStreetMap Nominatim)
server/lists.ts        destination guides and your own lists: suggestions, map lookup, grouping nearby places into days
server/essentials.ts   pharmacies, hospitals/clinics, police and ATMs near each stay (OpenStreetMap)
server/pluscode.ts     decodes Google Plus Codes in addresses
server/arrivalForms.ts immigration and customs forms for each border crossed
server/listIdeas.ts    built-in list ideas (dishes, drinks, well-known sights) by country
server/prep.ts         before-you-go checklist and packing list
server/emailParser.ts  Claude extraction + heuristic fallback
server/inbox.ts        per-trip forwarding addresses (mail.tm polling / custom-domain webhook)
server/items.ts        item validation + email upsert (dedupe)
server/flightStatus.ts flight providers, change detection, poller
server/suggestions.ts  rule-based + Claude suggestions
server/ai.ts           Claude client (structured outputs, refusal fallback)
src/                   React UI
```
