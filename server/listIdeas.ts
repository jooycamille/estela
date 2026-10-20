import type { ListTheme } from "../shared/lists.ts";

// Built-in ideas for lists, used when Claude isn't connected (and alongside it). Dishes, drinks and well-known sights
// only: long-established, widely documented places, so they're unlikely to have closed. Restaurants change too often
// to hard-code, so food lists get "where to eat it" map searches instead (and named restaurants when Claude is on).

export interface Idea {
  title: string;
  kind: "place" | "thing";
  detail: string;
  themes: ListTheme[];
  city?: string; // only for this city; otherwise anywhere in the country
  tag?: string;
  months?: number[]; // only suggested when the trip includes these months (1–12)
}

const F: ListTheme[] = ["food"];
const D: ListTheme[] = ["drinks", "food"];
const S: ListTheme[] = ["sights", "general"];
const N: ListTheme[] = ["nature", "sights", "general"];
const M: ListTheme[] = ["shopping", "sights", "food"];
const NL: ListTheme[] = ["nightlife"];

export const IDEAS: Record<string, Idea[]> = {
  MX: [
    { title: "Tacos al pastor", kind: "thing", themes: F, detail: "Spit-roasted, achiote-marinated pork shaved onto small tortillas with pineapple, onion and coriander. Taquerías get busiest late at night." },
    { title: "Chilaquiles", kind: "thing", themes: F, detail: "Fried tortilla pieces simmered in red or green salsa, topped with cream, cheese and often an egg. The classic breakfast." },
    { title: "Mole", kind: "thing", themes: F, detail: "Rich sauce of chillies, spices, seeds and sometimes chocolate, usually over chicken. Mole poblano is the best-known." },
    { title: "Pozole", kind: "thing", themes: F, detail: "Hominy soup with pork or chicken, topped at the table with lettuce, radish, oregano, chilli and lime." },
    { title: "Tamales", kind: "thing", themes: F, detail: "Steamed corn dough with fillings, wrapped in husks or leaves. Sold from street carts in the morning, and a Christmas staple.", tag: "Christmas favourite" },
    { title: "Esquites & elotes", kind: "thing", themes: F, detail: "Corn from street carts: in a cup (esquites) or on the cob (elote), with mayo, cheese, chilli and lime." },
    { title: "Tlayuda", kind: "thing", themes: F, detail: "Oaxacan giant crisp tortilla with beans, quesillo and meat. Look for Oaxacan spots in Mexico City." },
    { title: "Churros with hot chocolate", kind: "thing", themes: F, detail: "Fresh fried churros dunked in thick Mexican hot chocolate. Churrería El Moro has made them since 1935." },
    { title: "Tacos de canasta", kind: "thing", themes: F, detail: "\"Basket tacos\" steamed in a cloth-lined basket and sold from bicycles in the morning. Cheap and very local." },
    { title: "Ceviche & aguachile", kind: "thing", themes: F, detail: "Raw seafood cured in lime; aguachile adds chilli water. Best at a marisquería at lunchtime." },
    { title: "Pan dulce", kind: "thing", themes: F, detail: "Mexican sweet breads such as conchas, from a panadería. Pick with tongs and a tray, then pay at the counter." },
    { title: "Rosca de Reyes", kind: "thing", themes: F, detail: "Ring-shaped sweet bread for Three Kings' Day on 6 January; whoever finds the little figurine hosts tamales on 2 February.", tag: "6 January", months: [1] },
    { title: "Ponche navideño", kind: "thing", themes: D, detail: "Hot Christmas punch with guava, tejocote, sugar cane and cinnamon, served at posadas (16–24 Dec).", tag: "Christmas", months: [12] },
    { title: "Mezcal", kind: "thing", themes: D, detail: "Agave spirit, often smoky. Sip it slowly, traditionally with orange slices and sal de gusano. Try a mezcalería tasting." },
    { title: "Café de olla", kind: "thing", themes: D, detail: "Coffee brewed in a clay pot with piloncillo sugar and cinnamon." },
    { title: "Horchata & aguas frescas", kind: "thing", themes: D, detail: "Rice-and-cinnamon horchata, jamaica (hibiscus) and tamarind drinks from taquerías and market stalls." },
    { title: "Pulque", kind: "thing", themes: D, detail: "Fermented agave sap, a pre-Hispanic drink. Try it at a traditional pulquería, plain or curado (fruit-flavoured)." },
    { title: "Mercado de San Juan", kind: "place", themes: M, city: "Mexico City", detail: "The chefs' market, with exotic produce, cheeses and seafood. Good for a tasting lunch." },
    { title: "Mercado de Coyoacán", kind: "place", themes: M, city: "Mexico City", detail: "Market famous for its tostadas stalls. Pair it with the Frida Kahlo Museum nearby." },
    { title: "Mercado de la Merced", kind: "place", themes: M, city: "Mexico City", detail: "Mexico City's biggest traditional market. Sprawling and busy, so go with a guide or keep valuables close." },
    { title: "Zócalo & Metropolitan Cathedral", kind: "place", themes: S, city: "Mexico City", detail: "The vast main square and Latin America's largest cathedral, at the heart of the Centro Histórico." },
    { title: "Templo Mayor", kind: "place", themes: S, city: "Mexico City", detail: "Ruins of the main Aztec temple of Tenochtitlan, right beside the Zócalo, with an excellent museum. Closed on Mondays." },
    { title: "Palacio de Bellas Artes", kind: "place", themes: S, city: "Mexico City", detail: "Art nouveau palace with murals by Rivera and Siqueiros; the Ballet Folklórico performs here." },
    { title: "Museo Nacional de Antropología", kind: "place", themes: S, city: "Mexico City", detail: "One of the world's great museums: the Aztec Sun Stone and Maya halls. Allow half a day. Closed on Mondays." },
    { title: "Chapultepec Castle", kind: "place", themes: S, city: "Mexico City", detail: "Hilltop castle in Bosque de Chapultepec with city views; combine it with the Anthropology Museum. Closed on Mondays." },
    { title: "Frida Kahlo Museum (Casa Azul)", kind: "place", themes: S, city: "Mexico City", tag: "Book ahead", detail: "Frida's blue house in Coyoacán. Tickets sell out, so book online days ahead." },
    { title: "Coyoacán", kind: "place", themes: S, city: "Mexico City", detail: "Colonial neighbourhood with leafy plazas, cafés and the market. Lovely for an afternoon wander." },
    { title: "Xochimilco trajineras", kind: "place", themes: S, city: "Mexico City", detail: "Colourful boats on the ancient canals, with mariachis and food boats. More fun in a group, and busiest on weekends." },
    { title: "Teotihuacan pyramids", kind: "place", themes: S, city: "Mexico City", tag: "Day trip", detail: "Pyramids of the Sun and Moon, about an hour away. Go early for cooler weather, and consider a sunrise balloon." },
    { title: "Roma & Condesa walk", kind: "place", themes: [...S, "food"], city: "Mexico City", detail: "Tree-lined streets, art deco buildings, Parque México, cafés and restaurants." },
    { title: "Palacio Postal", kind: "place", themes: S, city: "Mexico City", detail: "A still-working post office with a gilded interior, next to Bellas Artes. Free to visit." },
    { title: "Lucha libre at Arena México", kind: "place", themes: [...S, "nightlife"], city: "Mexico City", detail: "Masked wrestling, loud and theatrical. Usually on Tuesday, Friday and Sunday nights." },
    { title: "Torre Latinoamericana viewpoint", kind: "place", themes: S, city: "Mexico City", detail: "Observation deck over the Centro Histórico and Bellas Artes. Go at sunset." },
    { title: "Mercado de Artesanías La Ciudadela", kind: "place", themes: ["shopping"], city: "Mexico City", detail: "Crafts from all over Mexico in one place: textiles, ceramics, alebrijes." },
    { title: "Posadas", kind: "thing", themes: [...S, "nightlife"], detail: "Christmas parties held each night from 16 to 24 December, with piñatas, ponche and carols.", tag: "Christmas", months: [12] },
  ],
  PA: [
    { title: "Ceviche de corvina", kind: "thing", themes: F, detail: "Panama's ceviche: sea bass cured in lime with onion and ají chombo. The Mercado de Mariscos is the classic spot." },
    { title: "Sancocho panameño", kind: "thing", themes: F, detail: "The national dish: chicken soup with ñame (yam) and culantro, served with rice." },
    { title: "Patacones", kind: "thing", themes: F, detail: "Twice-fried green plantain discs, served with almost everything." },
    { title: "Carimañolas", kind: "thing", themes: F, detail: "Cassava fritters stuffed with seasoned meat, a classic breakfast." },
    { title: "Hojaldras", kind: "thing", themes: F, detail: "Fried dough, usually eaten at breakfast with eggs or cheese." },
    { title: "Ropa vieja", kind: "thing", themes: F, detail: "Shredded beef stewed with tomatoes and peppers." },
    { title: "Tamal de olla & tamales", kind: "thing", themes: F, detail: "Panamanian Christmas tamales wrapped in banana leaves.", tag: "Christmas", months: [12] },
    { title: "Raspao", kind: "thing", themes: F, detail: "Shaved ice with syrup and condensed milk, from street carts." },
    { title: "Geisha coffee", kind: "thing", themes: D, detail: "Panama's prized coffee variety from Boquete. Try a pour-over at a specialty café in Casco Viejo." },
    { title: "Seco Herrerano", kind: "thing", themes: D, detail: "The national cane spirit, usually with milk (seco con leche) or in a cocktail." },
    { title: "Mercado de Mariscos", kind: "place", themes: [...F, "shopping"], city: "Panama City", detail: "Fish market by the Cinta Costera. The upstairs restaurants and ceviche stalls outside are the draw." },
    { title: "Casco Viejo", kind: "place", themes: S, city: "Panama City", detail: "The UNESCO-listed old quarter, with plazas, churches, rooftop bars and restored colonial streets." },
    { title: "Panama Canal: Miraflores Locks", kind: "place", themes: S, city: "Panama City", detail: "Watch ships rise and fall in the locks. Ship transits are usually mornings and mid-afternoon; check the schedule." },
    { title: "Biomuseo", kind: "place", themes: S, city: "Panama City", detail: "Frank Gehry's colourful museum on the Amador Causeway, about Panama's biodiversity." },
    { title: "Amador Causeway", kind: "place", themes: N, city: "Panama City", detail: "A causeway out to islands, with skyline views. Hire a bike and ride it in the late afternoon." },
    { title: "Cinta Costera", kind: "place", themes: N, city: "Panama City", detail: "Waterfront park linking the city to Casco Viejo, great for walking at sunset." },
    { title: "Panamá Viejo", kind: "place", themes: S, city: "Panama City", detail: "Ruins of the original 1519 city, with a climbable cathedral tower." },
    { title: "Ancon Hill", kind: "place", themes: N, city: "Panama City", detail: "A short, steep hike to the city's best viewpoint. You may spot sloths, toucans and agoutis. Go early." },
    { title: "Metropolitan Natural Park", kind: "place", themes: N, city: "Panama City", detail: "Rainforest inside the city, with trails and wildlife." },
    { title: "San Blas Islands (Guna Yala)", kind: "place", themes: N, tag: "Day trip / overnight", detail: "Idyllic islands run by the Guna people. Go on an organised trip (early 4x4 + boat), and bring cash and your passport." },
  ],
  CO: [
    { title: "Bandeja paisa", kind: "thing", themes: F, detail: "Antioquia's huge platter: beans, rice, chicharrón, ground beef, chorizo, egg, plantain, arepa and avocado. Come hungry." },
    { title: "Arepas", kind: "thing", themes: F, detail: "Corn cakes eaten at every meal. Try arepa de chócolo (sweet corn with cheese) and arepa con quesito." },
    { title: "Ajiaco", kind: "thing", themes: F, detail: "Bogotá's chicken and potato soup with guascas, served with cream, capers and avocado." },
    { title: "Empanadas", kind: "thing", themes: F, detail: "Crispy corn empanadas with ají (spicy sauce). Everywhere, all day." },
    { title: "Buñuelos & natilla", kind: "thing", themes: F, detail: "Cheese fritters and a set custard: the Colombian Christmas pairing, eaten at novenas (16–24 Dec).", tag: "Christmas", months: [12, 1] },
    { title: "Lechona", kind: "thing", themes: F, detail: "Whole roast pig stuffed with rice and peas, a party and holiday favourite." },
    { title: "Tamales (tolimense/antioqueño)", kind: "thing", themes: F, detail: "Big tamales in banana leaves, the traditional Christmas and Sunday breakfast.", tag: "Christmas" },
    { title: "Mondongo", kind: "thing", themes: F, detail: "Tripe soup, a Medellín institution, served with rice, banana and avocado." },
    { title: "Obleas", kind: "thing", themes: F, detail: "Thin wafers filled with arequipe (dulce de leche), jam and cheese, from street carts." },
    { title: "Exotic fruits", kind: "thing", themes: F, detail: "Lulo, maracuyá, granadilla, guanábana, pitahaya… Try a market fruit tasting, or jugos (made with water or milk)." },
    { title: "Tinto & specialty coffee", kind: "thing", themes: D, detail: "Tinto is the small black coffee sold everywhere. For the good stuff, find a specialty café or do a coffee-farm tour." },
    { title: "Aguardiente", kind: "thing", themes: D, detail: "Anise spirit, the party drink in Antioquia, served in shots. Expect it at family celebrations." },
    { title: "Refajo", kind: "thing", themes: D, detail: "Beer mixed with Colombiana soda, a family-gathering and holiday drink." },
    { title: "Avena & champús", kind: "thing", themes: D, detail: "Cold oat drink, and a fruity corn drink from the south-west. Bakery and market staples." },
    { title: "Comuna 13 graffiti tour", kind: "place", themes: S, city: "Medellín", detail: "Street art, outdoor escalators and the story of the neighbourhood's transformation. Go with a local guide." },
    { title: "Plaza Botero & Museo de Antioquia", kind: "place", themes: S, city: "Medellín", detail: "23 Botero sculptures in the square, with more of his work inside. Busy downtown, so keep valuables close." },
    { title: "Metrocable to Parque Arví", kind: "place", themes: N, city: "Medellín", detail: "Cable cars over the hillside barrios up to a forest park, with trails and a market. The line to Arví is closed on Mondays." },
    { title: "Pueblito Paisa (Cerro Nutibara)", kind: "place", themes: S, city: "Medellín", detail: "A replica Antioquian village on a hill, with city views." },
    { title: "Jardín Botánico & Parque Explora", kind: "place", themes: [...N, "sights"], city: "Medellín", detail: "Free botanical garden next to an interactive science museum and aquarium. Great with kids." },
    { title: "Alumbrados navideños", kind: "place", themes: [...S, "nightlife"], city: "Medellín", tag: "Christmas", months: [12, 1], detail: "Medellín's famous Christmas lights along the river (Parque Norte and around), all December to early January. Go after dark." },
    { title: "Guatapé & El Peñol", kind: "place", themes: N, city: "Medellín", tag: "Day trip", detail: "Climb about 740 steps up El Peñol rock for lake views, then wander colourful Guatapé town. About 2 hours away." },
    { title: "Mercado del Río", kind: "place", themes: F, city: "Medellín", detail: "A food hall with dozens of stalls. Easy for a group with different tastes." },
    { title: "Provenza & Parque Lleras", kind: "place", themes: ["nightlife", "food"], city: "Medellín", detail: "El Poblado's restaurant and bar streets. Lively at night." },
    { title: "Laureles & La 70", kind: "place", themes: ["nightlife", "food"], city: "Medellín", detail: "A more local neighbourhood for food and bars." },
    { title: "Novena de aguinaldos", kind: "thing", themes: S, tag: "Christmas", months: [12], detail: "Nine nights of family prayers, carols and buñuelos from 16 to 24 December. Join one with the family." },
    { title: "Monserrate", kind: "place", themes: S, city: "Bogotá", detail: "Mountain-top sanctuary above Bogotá, reached by cable car or funicular." },
    { title: "Museo del Oro", kind: "place", themes: S, city: "Bogotá", detail: "World-class pre-Columbian gold collection." },
    { title: "Walled city of Cartagena", kind: "place", themes: S, city: "Cartagena", detail: "Colourful colonial streets, plazas and city walls. Go in the evening when it's cooler." },
  ],
  SG: [
    { title: "Hainanese chicken rice", kind: "thing", themes: F, detail: "Poached chicken, fragrant rice and chilli sauce. Order it at a hawker centre." },
    { title: "Chilli crab", kind: "thing", themes: F, detail: "Mud crab in a sweet-spicy tomato chilli sauce, mopped up with fried mantou buns." },
    { title: "Laksa", kind: "thing", themes: F, detail: "Spicy coconut curry noodle soup." },
    { title: "Kaya toast & kopi", kind: "thing", themes: [...F, "drinks"], detail: "Coconut-jam toast with soft eggs and local coffee: the classic breakfast." },
    { title: "Maxwell or Lau Pa Sat hawker centre", kind: "place", themes: F, detail: "Hawker centres are the heart of Singapore food. Lau Pa Sat is best for satay in the evening." },
    { title: "Gardens by the Bay", kind: "place", themes: N, detail: "The Supertrees, with a free light show in the evening, plus the Cloud Forest dome." },
    { title: "Marina Bay", kind: "place", themes: S, detail: "Waterfront skyline walk; the Spectra light show runs in the evening." },
  ],
};

/** Map-search links for "where to eat it" / "where is it". */
export const mapsSearch = (query: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
