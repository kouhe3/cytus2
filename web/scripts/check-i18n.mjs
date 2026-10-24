#!/usr/bin/env node
/**
 * Static checks for the SPA UI dictionary.
 *
 *   cd web && pnpm check:i18n
 *
 * Node strips the TypeScript types from `src/data/messages.ts`; the module is
 * React-free for exactly this reason. The checks are:
 *
 * - every language has exactly the zh-Hans key set, with no empty values;
 * - every translation keeps the same `{placeholder}` set as zh-Hans;
 * - missing keys fall back to zh-Hans and never return the raw key;
 * - the unit table is complete in every language;
 * - no CJK text remains outside `src/data/messages.ts`;
 * - Intl numbers/dates follow the active locale.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MESSAGES,
  UNIT_FORMS,
  ZH_HANS,
  createI18n,
  hasMessage,
  translate,
} from "../src/data/messages.ts";

const checks = [];
const failures = [];

function check(condition, message) {
  checks.push(message);
  if (!condition) {
    failures.push(message);
  }
}

function placeholders(template) {
  return [...template.matchAll(/\{(\w+)\}/g)]
    .map((match) => match[1])
    .sort();
}

function sameList(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

const baseKeys = Object.keys(ZH_HANS).sort();

for (const [lang, dictionary] of Object.entries(MESSAGES)) {
  const keys = Object.keys(dictionary).sort();
  check(
    sameList(keys, baseKeys),
    `${lang}: key set matches zh-Hans (${keys.length} keys)`,
  );
  const missing = baseKeys.filter((key) => !(key in dictionary));
  const extra = keys.filter((key) => !(key in ZH_HANS));
  check(
    missing.length === 0 && extra.length === 0,
    `${lang}: no missing/extra keys (missing ${missing.slice(0, 5).join(", ") || "none"}; extra ${extra.slice(0, 5).join(", ") || "none"})`,
  );

  let empty = 0;
  let badPlaceholders = 0;
  for (const key of baseKeys) {
    const value = dictionary[key];
    if (typeof value !== "string" || value.trim() === "") {
      empty += 1;
      continue;
    }
    const expected = placeholders(ZH_HANS[key]);
    if (!sameList(placeholders(value), expected)) {
      badPlaceholders += 1;
      if (badPlaceholders <= 3) {
        check(
          false,
          `${lang}: ${key} placeholders differ (expected ${expected.join(",") || "none"}, got ${placeholders(value).join(",") || "none"})`,
        );
      }
    }
  }
  check(empty === 0, `${lang}: no empty messages (${empty} empty)`);
  check(
    badPlaceholders === 0,
    `${lang}: all placeholders match zh-Hans (${badPlaceholders} mismatched)`,
  );
}

const unitLangs = Object.keys(UNIT_FORMS);
check(unitLangs.length === 5, `unit table covers all five languages (${unitLangs.join(", ")})`);
const baseUnits = Object.keys(UNIT_FORMS["zh-Hans"]).sort();
for (const lang of unitLangs) {
  const units = Object.keys(UNIT_FORMS[lang]).sort();
  check(sameList(units, baseUnits), `${lang}: unit key set matches zh-Hans`);
  for (const unit of baseUnits) {
    const forms = UNIT_FORMS[lang][unit];
    check(
      typeof forms.one === "string" && forms.one.trim() !== "",
      `${lang}: unit ${unit} has a one form`,
    );
    check(
      typeof forms.other === "string" && forms.other.trim() !== "",
      `${lang}: unit ${unit} has an other form`,
    );
    check(
      forms.one.includes("{count}") && forms.other.includes("{count}"),
      `${lang}: unit ${unit} keeps {count}`,
    );
  }
}

// Missing-key fallback: remove a key from `en` and make sure the value comes
// from zh-Hans rather than from the raw key.
const saved = MESSAGES.en["nav.timeline"];
delete MESSAGES.en["nav.timeline"];
const fallback = translate("en", "nav.timeline");
check(
  fallback === ZH_HANS["nav.timeline"],
  "missing en key falls back to the zh-Hans value",
);
MESSAGES.en["nav.timeline"] = saved;
check(
  translate("en", "nav.timeline") === saved,
  "restoring the en key restores the en value",
);

const unknownKey = "this.key.does.not.exist";
const unknown = translate("en", unknownKey);
check(unknown === "", "unknown key resolves to an empty string");
check(unknown !== unknownKey, "unknown key is never rendered as a raw key");
check(!hasMessage("en", unknownKey), "unknown key is not reported as present");

const en = createI18n("en");
const ja = createI18n("ja");
const ko = createI18n("ko");
const zhHans = createI18n("zh-Hans");
const zhHant = createI18n("zh-Hant");
check(en.formatNumber(1234567) === "1,234,567", "en formats numbers with Intl");
check(ja.formatNumber(1234567) === "1,234,567", "ja formats numbers with Intl");
check(ko.formatNumber(1234567) === "1,234,567", "ko formats numbers with Intl");
check(zhHans.formatNumber(1234567) === "1,234,567", "zh-Hans formats numbers with Intl");
check(
  en.formatDate("2026-10-24") !== zhHans.formatDate("2026-10-24"),
  "dates follow the active locale",
);
check(
  en.formatDate("687_06_30 18:01:20").includes("687") &&
    zhHans.formatDate("687_06_30 18:01:20").includes("687"),
  "canonical game timestamps are formatted through Intl",
);
check(
  en.formatDate("687_06_30 18:01:20") !== zhHans.formatDate("687_06_30 18:01:20"),
  "game timestamps follow the active locale",
);
check(
  en.formatDate("????_06_30 ??:??:??") === "????_06_30 ??:??:??",
  "unknown game timestamp components stay literal",
);
check(
  zhHant.formatDate("2026-10-24") !== zhHans.formatDate("2026-10-24") ||
    zhHant.formatDate("2026-10-24").includes("2026"),
  "zh-Hant formats dates",
);

// No Chinese UI copy outside the dictionary.
const srcDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
);
const dictionary = path.join(srcDir, "data", "messages.ts");
const cjk = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const offenders = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!/\.(ts|tsx|css)$/.test(entry.name)) {
      continue;
    }
    if (full === dictionary) {
      continue;
    }
    const text = fs.readFileSync(full, "utf8");
    if (cjk.test(text)) {
      offenders.push(path.relative(srcDir, full));
    }
  }
}

walk(srcDir);
check(
  offenders.length === 0,
  `no CJK UI copy outside the dictionary${offenders.length ? ` (${offenders.join(", ")})` : ""}`,
);

if (failures.length > 0) {
  console.error(
    JSON.stringify({ ok: false, checks, failures }, null, 2),
  );
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      languages: Object.keys(MESSAGES),
      keys: baseKeys.length,
      units: baseUnits.length,
      checks,
    },
    null,
    2,
  ),
);
