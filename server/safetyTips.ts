import type { SafetyTips } from "../shared/types.ts";

// Scams, staying safe and local rules, by country, with extras for some cities. Written from the UK government's travel
// advice and linked to it, because advice changes: review against the source and update CHECKED when you do.
// Only add what the source says. A country that isn't here gets a link to the advice, rather than a guess.

const CHECKED = "2026-11-07";
const SOURCE_NAME = "UK government travel advice";
const source = (country: string) => `https://www.gov.uk/foreign-travel-advice/${country}/safety-and-security`;

type CountryTips = Pick<SafetyTips, "scams" | "safety" | "rules"> & { slug: string; regions?: string; cities?: Record<string, string[]> };

const TIPS: Record<string, CountryTips> = {
  MX: {
    slug: "mexico",
    scams: [
      "Fake police may try to fine or arrest drivers, especially in rental cars, and real officers have also extorted tourists over minor offences. Ask for the fine in writing, note the name, badge and patrol car number, and don't hand over money or your passport.",
      "Callers may claim a relative has been kidnapped or detained. Hang up and check on the person directly.",
      "If your phone is stolen or hacked, your family may be asked for money. Agree before you go how you'd contact them and send money.",
      "Fake immigration officers can work at international airports. Refuse their help and go straight to the immigration office.",
      "Spiritual “cleansing” ceremonies (ayahuasca, yagé, bufo) are unregulated, and visitors have been assaulted and robbed at them.",
    ],
    safety: [
      "Taxis: take one from an authorised “sitio” rank or have your hotel order it. At airports, use only authorised pre-paid taxis.",
      "ATMs: use them in daylight inside shops or malls, and avoid large withdrawals. People have been forced to withdraw cash in express kidnappings.",
      "Don't leave food or drink unattended. Tainted alcohol has caused deaths and can't be detected by taste or smell, so get urgent help if you feel ill after drinking.",
      "Watch for pickpockets on public transport. Women travelling alone on public transport have been harassed, robbed and assaulted.",
    ],
    rules: [
      "Vapes are illegal to bring in, buy or sell. They can be confiscated, and you can be fined or detained.",
      "Smoking or vaping in a public place can bring a fine of up to 3,000 pesos.",
      "Carry your passport and entry stamp. Copies and photos aren't accepted.",
      "Drug penalties are severe, with sentences of up to 25 years.",
      "Foreigners who take part in political activity can be detained and deported.",
    ],
    cities: {
      "mexico city": [
        "Unlicensed taxi drivers have robbed and assaulted passengers here.",
        "Protests are common and can turn violent, including gentrification protests in central and tourist areas since July 2025. Stay away from them.",
        "Driving: cars without local plates can't enter Monday to Friday 5am to 11am, or Saturday 5am to 10pm. Fines are heavy and the car can be taken.",
        "LOCATEL has English-speaking staff: 5658 1111.",
      ],
    },
  },
  PA: {
    slug: "panama",
    scams: ["Gangs have approached people to get into where they're staying, then burgled it. If you're unsure about someone, call the police."],
    safety: [
      "Taxis: use only ride-hailing apps or transport arranged by your hotel. Taxis can be poorly maintained, and accidents are common.",
      "ATMs: people have been attacked after withdrawing cash, so use one inside a bank or shopping centre where you can.",
      "Watch for pickpockets on busy streets, buses and at bus stations. Carry little cash and use a hotel safe.",
      "Avoid poorly lit places and walking alone. Sexual assaults have been reported in tourist areas.",
      "Protests can block roads, including access to airports, so allow extra time and avoid those areas.",
    ],
    rules: [
      "Smoking and e-cigarettes are banned in public places. The fine for smoking is US$25 to US$100.",
      "Carry ID such as your passport. Police will usually accept a printed copy.",
      "Possessing even a small amount of drugs can mean prison, with detention of up to 2 years while the courts are slow.",
      "Police have detained same-sex couples for public indecency, and affection in public can attract unwanted attention.",
      "Night-time curfews are sometimes imposed, though usually not in tourist areas.",
    ],
    cities: {
      "panama city": [
        "Mugging hotspots include Albrook Mall, Via España, Avenida Central, Calidonia, Casco Viejo and the Panama Viejo ruins.",
        "Higher-crime areas include San Miguelito, El Chorrillo, Río Abajo, 24 de Diciembre, Santa Ana and Juan Díaz.",
        "Report any crime before you leave the country, or the police may not investigate.",
      ],
    },
  },
  CO: {
    slug: "colombia",
    regions: "The UK advises against all but essential travel to parts of Colombia.",
    scams: [
      "Drugging: criminals use scopolamine and other drugs in food, drinks, cigarettes, aerosols or paper flyers, then rob or assault victims. It has happened in bars, restaurants, taxis and on the street. Don't leave food or drink unattended or take anything from strangers, and get medical help quickly if it happens.",
      "Dating apps: teams use them to find foreigners travelling alone. Don't go to a stranger's accommodation or invite one to yours.",
      "Fake police may ask to inspect your money for counterfeits. Ask to be taken to the nearest police station (a CAI).",
      "Express kidnapping: criminals, often posing as taxi drivers, target people near ATMs, often at night, and force them to withdraw cash. Resisting has led to deaths.",
      "“Spiritual cleansing” with ayahuasca or yagé is marketed to tourists. People have been assaulted and robbed at ceremonies, and some have died.",
    ],
    safety: [
      "Taxis: don't hail them on the street. Book by phone or app, including Uber or Cabify, or through your hotel or restaurant.",
      "ATMs: use them during business hours inside a bank, supermarket or shopping centre.",
      "Don't show laptops, cameras or phones on buses, and carry little cash. There have been armed robberies on buses.",
      "Change money only at banks or authorised exchanges, never on the street.",
    ],
    rules: [
      "Always carry a colour printout of your passport photo page, and keep the passport itself safe.",
      "Drinking alcohol in public spaces is illegal.",
      "Drug penalties are severe and prisons are harsh. Pack your own bags, keep them with you, and never carry anything for anyone else.",
      "Photographing military or strategic government sites is illegal.",
      "Child sexual abuse laws (children aged 13 and under) are strictly enforced, especially with tourists, with long prison sentences.",
    ],
    cities: {
      medellin: ["Pickpocketing, mugging and armed robbery are a problem in major cities including Medellín. Don't wear expensive jewellery or watches, and take care after dark or when alone."],
    },
  },
  SG: {
    slug: "singapore",
    scams: [
      "Online and phone scams are common, including callers pretending to be officials or bank staff.",
      "Some scams involve false claims of molestation followed by extortion, so avoid anything that could be misread that way.",
    ],
    safety: ["Violent crime and theft are rare, but keep your passport and valuables safe, and don't leave bags unattended."],
    rules: [
      "Vapes are banned, even for personal use. They're confiscated when found, and you could be fined.",
      "Smoking is banned in public parks, on beaches and along certain waterways, and Orchard Road is a No Smoking Zone. Smoke only in designated areas.",
      "Drinking in public places is illegal between 10:30pm and 7am outside licensed venues. In Geylang and Little India, it's banned all weekend, on public holidays and on their eves.",
      "Littering can bring an on-the-spot fine. Vandalism, including graffiti, can mean fines, prison and caning.",
      "Drug penalties are severe, even for possession, and include the death penalty. This also applies when transiting through the airport.",
      "Displaying other countries' flags in public needs an exemption, and foreigners can't attend outdoor demonstrations unless they're permanent residents.",
    ],
  },
  PH: {
    slug: "philippines",
    regions: "The UK advises against all travel to parts of the Philippines, including western and central Mindanao and the Sulu archipelago.",
    scams: [
      "Single male tourists have been befriended by women, sometimes with children, then threatened with false reports of rape or abuse to extort money. Be careful with strangers offering friendship.",
      "Some taxi drivers and their accomplices have robbed and harmed passengers.",
    ],
    safety: [
      "Taxis: use only reputable companies, including to and from the airport, or arrange a hotel transfer.",
      "Don't show cash or jewellery on public transport. Armed hold-ups can happen on jeepneys and buses, particularly in Manila and other large cities.",
      "Terrorist groups may target anywhere, including Manila's malls, entertainment venues, public transport and places of worship.",
      "Methanol in alcohol can't be detected by taste or smell. Get urgent help if you or a friend show signs of poisoning.",
      "Avoid overcrowded boats. Typhoons mostly come from June to November.",
    ],
    rules: [
      "You must be able to show ID to police. If your passport is in the hotel safe, carry a printed copy of the photo page.",
      "Having even a small amount of any illegal drug means a mandatory prison sentence.",
      "Public displays of affection can be treated as a “grave scandal”, with a fine or up to 6 months in prison.",
      "Foreigners who join protests or rallies may be detained and deported.",
      "Anyone aged 17 or under is legally a child, and child abuse carries very long sentences.",
    ],
  },
};

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

/** What to know in this place, or just where to read about it for a country Joy has no tips for. */
export function safetyTips(countryCode?: string, city?: string): SafetyTips {
  const tips = countryCode ? TIPS[countryCode] : undefined;
  if (!tips) return { scams: [], safety: [], rules: [], sourceName: SOURCE_NAME, sourceUrl: "https://www.gov.uk/foreign-travel-advice" };
  const { slug, cities, ...rest } = tips;
  return { ...rest, here: (city && cities?.[fold(city)]) || undefined, sourceName: SOURCE_NAME, sourceUrl: source(slug), checked: CHECKED };
}
