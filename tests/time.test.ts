import assert from "node:assert/strict";
import { test } from "node:test";
import { airportTimeZone, wallTimeToUtc } from "../server/time.ts";

test("airport wall-clock times become real moments, daylight saving included", () => {
  assert.equal(airportTimeZone("PTY"), "America/Panama");
  assert.equal(wallTimeToUtc("2026-12-21T13:23", "America/Panama"), "2026-12-21T18:23:00.000Z"); // UTC-5, no DST
  assert.equal(wallTimeToUtc("2027-01-10T18:25", "America/Chicago"), "2027-01-11T00:25:00.000Z"); // CST, UTC-6
  assert.equal(wallTimeToUtc("2027-07-01T09:00", "America/Chicago"), "2027-07-01T14:00:00.000Z"); // CDT, UTC-5
  assert.equal(wallTimeToUtc("2026-12-09T11:00", "Australia/Melbourne"), "2026-12-09T00:00:00.000Z"); // AEDT, UTC+11
});

test("typical weather only uses years that have already happened", async () => {
  process.env.DB_PATH ??= "/tmp/heyjoy-unused/db.json";
  const { typicalYears } = await import("../server/weather.ts");
  assert.deepEqual(typicalYears("2027-01-12", "2026-11-04"), [-1, -2, -3]); // Jan 2026 has happened
  assert.deepEqual(typicalYears("2028-01-10", "2026-11-04"), [-2, -3, -4]); // Jan 2027 hasn't
});
