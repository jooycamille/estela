// Translates the app's text (src/locales/catalog.json) into each language with Claude, writing src/locales/<code>.json.
// Only texts without a translation yet are sent, so it can be run again after new text is added, or after it stops.
//
//   npm run i18n:translate                 what's left and what it would cost (nothing is sent)
//   npm run i18n:translate -- --go         translate everything that's left
//   npm run i18n:translate -- --go fr de   only these languages
//
// Needs ANTHROPIC_API_KEY (in .env, or an `ant auth login` profile). Run `npm run i18n:extract` first so the catalog is
// current.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { LANGUAGES } from "../../src/i18n.ts";
import { check, chunks, estimate, missing, sorted, type Text } from "./translateCore.ts";

const ROOT = new URL("../..", import.meta.url).pathname;
try {
  process.loadEnvFile(process.env.ENV_FILE ?? join(ROOT, ".env"));
} catch {
  /* no .env: the key can come from the environment or an `ant auth login` profile */
}
const LOCALES = join(ROOT, "src", "locales");
const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";
const PRICE = { input: 4, output: 20 }; // US$ per million tokens, Claude Opus 5.5
const CHUNK = 100;
const PARALLEL = 4; // languages at a time

const args = process.argv.slice(2);
const go = args.includes("--go");
const only = args.filter((a) => !a.startsWith("--"));
const targets = LANGUAGES.filter((l) => l.code !== "en" && (only.length === 0 || only.includes(l.code)));
if (only.length && targets.length !== only.length) {
  console.error(`Unknown language: ${only.filter((c) => !targets.some((l) => l.code === c)).join(", ")}. Choose from ${LANGUAGES.map((l) => l.code).join(" ")}.`);
  process.exit(1);
}

const catalog: Record<string, string> = JSON.parse(readFileSync(join(LOCALES, "catalog.json"), "utf8"));
const fileOf = (code: string) => join(LOCALES, `${code}.json`);
const load = (code: string): Record<string, string> => (existsSync(fileOf(code)) ? JSON.parse(readFileSync(fileOf(code), "utf8")) : {});
const save = (code: string, dict: Record<string, string>) => writeFileSync(fileOf(code), `${JSON.stringify(sorted(dict), null, 1)}\n`);

const system = (name: string, code: string) => `You translate the interface of Estela, a travel planning app, from English into ${name} (${code}).

Write what a native speaker would expect to see in a well-made app: natural, concise, friendly, and consistent across texts (the same English word gets the same translation). Use the informal "you" where the language has one and apps commonly use it.

Rules the app depends on:
- Keep every {placeholder} exactly as written (same name, in braces, not translated); move it wherever the sentence needs it.
- "Estela" is the app's name: never translate it.
- Some texts are parts of a sentence that the app joins to other text or to a value (they start or end with a space or punctuation, like " · ticked off" or ", then "). Translate them as parts that read naturally when joined; don't make them full sentences.
- Pairs like "{n} item" / "{n} items" are the singular and plural of a count. Give each its correct form; in languages without plurals they may be the same.
- Keep symbols, emoji, arrows and units (km, °C, A$) as they are.
- "where" names the screens that show the text, for context only.

Return one translation for every id you're given.`;

const Answer = z.object({ items: z.array(z.object({ id: z.number().int(), text: z.string() })) });

let client: Anthropic | undefined;

async function translateChunk(name: string, code: string, texts: Text[]) {
  client ??= new Anthropic();
  const res = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: system(name, code),
    messages: [{ role: "user", content: JSON.stringify(texts.map(({ id, en, where }) => ({ id, en, where }))) }],
    output_config: { effort: "low", format: betaZodOutputFormat(Answer) },
  });
  const usage = { input: res.usage.input_tokens, output: res.usage.output_tokens };
  if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens" || !res.parsed_output) return { got: new Map<number, string>(), usage };
  return { got: new Map(res.parsed_output.items.map((i) => [i.id, i.text])), usage };
}

async function translateLanguage(name: string, code: string, spent: { input: number; output: number }) {
  const dict = load(code);
  const todo = missing(catalog, dict);
  const problems: string[] = [];
  for (const [i, part] of chunks(todo, CHUNK).entries()) {
    let left = part;
    for (let attempt = 0; attempt < 2 && left.length; attempt++) {
      let result;
      try {
        result = await translateChunk(name, code, left);
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError) throw e;
        console.warn(`  ${code}: part ${i + 1} failed (${e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : String(e)})`);
        continue;
      }
      spent.input += result.usage.input;
      spent.output += result.usage.output;
      const retry: Text[] = [];
      for (const t of left) {
        const got = result.got.get(t.id);
        const ok = got === undefined ? ({ ok: false, why: "missing" } as const) : check(t.en, got);
        if (ok.ok) dict[t.en] = ok.text;
        else if (attempt === 0) retry.push(t);
        else problems.push(`${JSON.stringify(t.en)}: ${ok.why}`);
      }
      left = retry;
    }
    save(code, dict); // after each part, so stopping keeps what's done
  }
  const done = todo.length - problems.length;
  console.log(`  ${name} (${code}): ${done} of ${todo.length} translated${problems.length ? `; left in English:\n    ${problems.join("\n    ")}` : ""}`);
}

// What's left, and what it would cost.
const promptTokens = Math.ceil(system("Language", "xx").length / 4) + 400; // the rules, plus the answer format
let total = { input: 0, output: 0 };
console.log(`${Object.keys(catalog).length} texts in the catalog. Left to translate:`);
for (const l of targets) {
  const todo = missing(catalog, load(l.code));
  const e = estimate(todo, l.code, promptTokens, CHUNK);
  total = { input: total.input + e.input, output: total.output + e.output };
  console.log(`  ${l.name.padEnd(18)} ${String(todo.length).padStart(5)} texts`);
}
const cost = (t: { input: number; output: number }) => (t.input * PRICE.input + t.output * PRICE.output) / 1e6;
const est = cost(total);
console.log(`\nEstimated cost with ${MODEL}: about US$${(est * 0.7).toFixed(0)}–${(est * 1.4).toFixed(0)} (≈${Math.round(total.input / 1000)}k tokens in, ≈${Math.round(total.output / 1000)}k out).`);

if (!go) {
  console.log("\nNothing was sent. To translate, run: npm run i18n:translate -- --go");
  process.exit(0);
}

const spent = { input: 0, output: 0 };
const queue = [...targets];
console.log("\nTranslating…");
try {
  await Promise.all(
    Array.from({ length: PARALLEL }, async () => {
      for (let l = queue.shift(); l; l = queue.shift()) await translateLanguage(l.name, l.code, spent);
    }),
  );
} catch (e) {
  if (e instanceof Anthropic.AuthenticationError) {
    console.error("\nClaude didn't accept the API key. Add ANTHROPIC_API_KEY to .env (or run `ant auth login`), then run this again.");
    process.exitCode = 1;
  } else throw e;
}
console.log(`\nDone. Spent ≈US$${cost(spent).toFixed(2)} (${spent.input} tokens in, ${spent.output} out).`);
