// Rebuilds server/data/places.json from GeoNames (CC BY 4.0, https://www.geonames.org/): states/provinces
// (admin1) and cities with 15,000+ people. Run: npm run places
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = "https://download.geonames.org/export/dump";
const text = async (file) => {
  const res = await fetch(`${BASE}/${file}`);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return res;
};

// States/provinces: "US.CA<TAB>California<TAB>California<TAB>5332921"
const admin1 = (await (await text("admin1CodesASCII.txt")).text()).trim().split("\n").map((l) => l.split("\t"));
const regionName = new Map(admin1.map(([code, name]) => [code, name]));
const regions = admin1.map(([code, name, ascii]) => [name, ascii, code.split(".")[0]]);

// Cities (zip): geonameid, name, asciiname, alternatenames, lat, lon, fclass, fcode, cc, cc2, admin1, …, population
const dir = mkdtempSync(join(tmpdir(), "geonames-"));
try {
  writeFileSync(join(dir, "cities.zip"), Buffer.from(await (await text("cities15000.zip")).arrayBuffer()));
  const rows = execFileSync("unzip", ["-p", join(dir, "cities.zip"), "cities15000.txt"], { maxBuffer: 64 * 1024 * 1024 })
    .toString("utf8").trim().split("\n").map((l) => l.split("\t"));
  const cities = rows
    // Skip city districts and historical places, incl. numbered arrondissements like "Paris 15 Vaugirard", "Lyon 03".
    .filter((r) => r[6] === "P" && r[7] !== "PPLX" && r[7] !== "PPLH" && !/^\p{L}+ \d{1,2}(?:\s|$)/u.test(r[1]))
    .map((r) => [r[1], r[2] === r[1] ? "" : r[2], r[8], regionName.get(`${r[8]}.${r[10]}`) ?? "", +r[14], Math.round(+r[4] * 1e3) / 1e3, Math.round(+r[5] * 1e3) / 1e3])
    .sort((a, b) => b[4] - a[4]);
  writeFileSync(
    new URL("../../server/data/places.json", import.meta.url),
    JSON.stringify({
      source: "GeoNames (CC BY 4.0), https://www.geonames.org/ — admin1 regions and cities with 15,000+ people",
      regionFields: ["name", "asciiName", "countryCode"],
      cityFields: ["name", "asciiName", "countryCode", "region", "population", "lat", "lon"],
      regions,
      cities,
    }),
  );
  console.log(regions.length, "regions,", cities.length, "cities written");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
