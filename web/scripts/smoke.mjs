#!/usr/bin/env node
/**
 * Browser smoke test against the running Edge CDP endpoint.
 *
 *   cd web && pnpm dev          # terminal 1
 *   cd web && pnpm smoke        # terminal 2
 *
 * It drives the real app through the DevTools protocol: history routing,
 * reading-order cards, the level slider, type/tier filters, the Ctrl+K command
 * palette, a chart page reached from a card, the chart → post → chart round
 * trip, OA archives and documents, backup media, story nodes, CAPSO/gacha/shop
 * bundles, the OS chapter → folder index, grouped full-text search with
 * keyboard navigation, and the
 * five-language switch including its missing-language fallback.
 * Screenshots are written to web/.shots/.
 *
 * CDP_ENDPOINT defaults to http://127.0.0.1:9333 (the edge-cdp service).
 * Pass a different app URL as the first argument.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createI18n,
  formatUnit,
  translate,
} from "../src/data/messages.ts";

const appBase = (process.argv[2] ?? "http://127.0.0.1:5190").replace(/\/+$/, "");
const cdpBase = (process.env.CDP_ENDPOINT ?? "http://127.0.0.1:9333").replace(
  /\/+$/,
  "",
);
const shotsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".shots",
);

const checks = [];
const screenshots = [];
const zhHans = createI18n("zh-Hans");

function check(condition, message) {
  if (!condition) {
    throw new Error(`ASSERT FAILED: ${message}`);
  }
  checks.push(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class Cdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 0;
    this.pending = new Map();
    this.exceptions = [];
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP connect timeout")), 15000);
      this.ws.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      this.ws.addEventListener(
        "error",
        (event) => {
          clearTimeout(timer);
          reject(new Error(`CDP socket error: ${event.message ?? "unknown"}`));
        },
        { once: true },
      );
    });
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.method === "Runtime.exceptionThrown") {
        const details = message.params?.exceptionDetails;
        this.exceptions.push(
          details?.exception?.description ?? details?.text ?? "unknown exception",
        );
      }
      if (typeof message.id !== "number") {
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? "CDP error"));
      } else {
        pending.resolve(message.result ?? {});
      }
    });
  }

  call(method, params = {}, timeoutMs = 45000) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, timeoutMs);
    });
  }

  async evaluate(expression) {
    const result = await this.call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      const details = result.exceptionDetails;
      throw new Error(
        `page exception: ${details.exception?.description ?? details.text}`,
      );
    }
    return result.result?.value;
  }

  async waitFor(expression, label, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      try {
        last = await this.evaluate(expression);
        if (last) {
          return last;
        }
      } catch (error) {
        last = error instanceof Error ? error.message : String(error);
      }
      await sleep(150);
    }
    throw new Error(`TIMEOUT waiting for ${label}; last=${JSON.stringify(last)}`);
  }

  async navigate(url) {
    await this.call("Page.navigate", { url });
    await this.waitFor(
      `document.readyState === 'complete'`,
      `document complete for ${url}`,
    );
  }

  async screenshot(name) {
    let result = null;
    for (let attempt = 0; attempt < 2 && !result; attempt += 1) {
      try {
        result = await this.call(
          "Page.captureScreenshot",
          { format: "png" },
          15000,
        );
      } catch (error) {
        if (attempt === 1) {
          // A hung compositor must not hide the assertion result; the check
          // log is the executable contract and screenshots are evidence.
          console.warn(
            `[smoke] screenshot ${name} skipped: ${error instanceof Error ? error.message : String(error)}`,
          );
          return null;
        }
        await sleep(300);
      }
    }
    if (!result) {
      return null;
    }
    fs.mkdirSync(shotsDir, { recursive: true });
    const file = path.join(shotsDir, name);
    fs.writeFileSync(file, Buffer.from(result.data, "base64"));
    screenshots.push(file);
    return file;
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function openTarget(url) {
  const endpoint = `${cdpBase}/json/new?${encodeURIComponent(url)}`;
  let response;
  try {
    response = await fetch(endpoint, { method: "PUT" });
  } catch {
    response = await fetch(endpoint);
  }
  if (!response.ok) {
    throw new Error(`cannot open CDP tab: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function closeTarget(id) {
  try {
    await fetch(`${cdpBase}/json/close/${id}`);
  } catch {
    // closing is best-effort
  }
}

const SET_SLIDER = (value) => `(() => {
  const input = document.querySelector('[data-testid="level-slider"]');
  if (!input) throw new Error('level slider missing');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, ${JSON.stringify(String(value))});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return input.value;
})()`;

const SET_LANGUAGE = (code) => `(() => {
  const button = document.querySelector('[data-testid="lang-${code}"]');
  if (!button) throw new Error('language button missing: ${code}');
  button.click();
  return button.textContent;
})()`;

const SET_CUTSCENE_QUERY = (text) => `(() => {
  const input = document.querySelector('[data-testid="cutscene-search"]');
  if (!input) throw new Error('cutscene search missing');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, ${JSON.stringify(text)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return input.value;
})()`;

/**
 * Deterministic missing-export path: every real clip is exported today, so the
 * notes are exercised by deleting keys from the manifest response before the app
 * boots. Each install site lists only the maps it drops; the source is injected
 * through Page.addScriptToEvaluateOnNewDocument and removed after the assertion.
 */
function manifestStub({ movies = [], videos = [], subtitles = [] }) {
  const deletions = [
    ...movies.map((key) => `    if (data.movies) delete data.movies.${key};`),
    ...videos.map((key) => `    if (data.videos) delete data.videos.${key};`),
    ...subtitles.map(
      (key) => `    if (data.subtitles) delete data.subtitles.${key};`,
    ),
  ].join('\n');
  return `(() => {
  const realFetch = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const response = await realFetch(input, init);
    if (!url.includes('/media/manifest.json')) {
      return response;
    }
    const data = await response.clone().json();
${deletions}
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
})()`;
}

const TIMELINE_SNAPSHOT = `(() => {
  const cards = [...document.querySelectorAll('[data-testid="timeline-card"]')];
  const orders = cards.map((card) => Number(card.dataset.order));
  const levels = cards.map((card) => Number(card.dataset.level));
  return {
    path: location.pathname,
    count: cards.length,
    firstOrder: orders[0],
    secondOrder: orders[1],
    sorted: orders.every((value, index) => index === 0 || value >= orders[index - 1]),
    maxLevelSeen: levels.length ? Math.max(...levels) : -1,
    minLevelSeen: levels.length ? Math.min(...levels) : -1,
    types: [...new Set(cards.map((card) => card.dataset.type))].sort(),
    tiers: [...new Set(cards.map((card) => card.dataset.tier))].sort(),
    accounts: [...new Set(cards.map((card) => card.dataset.account))].sort(),
    lanes: [...new Set(cards.map((card) => Number(card.dataset.lane)))].sort(
      (left, right) => left - right,
    ),
    paidCards: cards.filter((card) => card.dataset.tier === 'paid').length,
    costChips: cards.filter((card) => card.querySelector('.cost-chip')).length,
    laneChips: cards.filter((card) => card.querySelector('.lane-chip')).length,
    branchCards: cards.filter((card) => card.dataset.branch).length,
    branchChips: cards.filter((card) => card.querySelector('.branch-chip')).length,
    externalCards: cards.filter((card) => card.dataset.external).length,
    firstCost: cards[0]?.querySelector('.cost-chip')?.textContent ?? null,
    firstLane: cards[0]?.querySelector('.lane-chip')?.textContent ?? null,
    firstTooltip: cards[0]?.getAttribute('title') ?? '',
    spoilerCards: cards.filter((card) => card.dataset.spoiler === 'true').length,
    spoilerChips: cards.filter((card) => card.querySelector('.spoiler-chip')).length,
    osCards: cards.filter((card) => card.dataset.type === 'os_log').length,
    osWithSnippet: cards.filter(
      (card) =>
        card.dataset.type === 'os_log' &&
        (card.querySelector('.card-snippet')?.textContent ?? '').trim() !== '',
    ).length,
    firstHref: cards[0]?.getAttribute('href') ?? null,
    firstTitle: cards[0]?.querySelector('.card-title')?.textContent ?? null,
    firstSnippet: cards[0]?.querySelector('.card-snippet')?.textContent ?? null,
    firstAuthor: cards[0]?.querySelector('.card-author')?.textContent ?? null,
    firstCharacter: cards[0]?.querySelector('.card-character')?.textContent ?? null,
    firstLevel: cards[0]?.querySelector('.level-badge')?.textContent ?? null,
    firstTier: cards[0]?.querySelector('.tier-chip')?.textContent ?? null,
  };
})()`;

let target;
let cdp;
try {
  target = await openTarget(`${appBase}/timeline`);
  cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.call("Page.enable");
  await cdp.call("Runtime.enable");
  await cdp.call("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await cdp.navigate(`${appBase}/timeline`);
  await cdp.evaluate(`localStorage.setItem('cytus2.language', 'zh-Hans')`);
  await cdp.navigate(`${appBase}/timeline`);
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="timeline-card"]').length > 0`,
    "timeline cards",
  );

  // ---------------------------------------------------------------- home feed
  const home = await cdp.evaluate(TIMELINE_SNAPSHOT);
  check(home.path === "/timeline", "history route /timeline loads directly");
  check(home.count === 824, `home renders the 824 in-scope timeline entries (got ${home.count})`);
  check(home.firstOrder === 1, "first card is reading order #1");
  check(home.sorted, "cards are ordered by reading_order.order ascending");
  check(
    JSON.stringify(home.types) === JSON.stringify(["im_post", "os_log"]),
    "feed contains only im_post and os_log entities",
  );
  check(home.firstHref === "/im/P0101", "first card links to /im/P0101");
  check(Boolean(home.firstTitle), "first card has a title");
  check(Boolean(home.firstSnippet), "first card has a snippet");
  check(Boolean(home.firstAuthor), "first card shows an author");
  check(Boolean(home.firstCharacter), "first card shows a character");
  check(home.firstLevel === "Lv 1", "first card shows its level gate");
  check(home.firstTier === translate("zh-Hans", "tier.free"), "first card shows its tier");
  check(home.costChips === home.count, "every card shows its unlock cost");
  check(home.laneChips === home.count, "every card shows its account lane");
  check(
    home.firstCost === translate("zh-Hans", "card.cost", { cost: "0" }),
    "the first card has cost 0",
  );
  check(Boolean(home.firstLane), "the first card names its lane");
  check(
    home.firstTooltip.includes(translate("zh-Hans", "timeline.legendCostBadge")),
    "the card tooltip exposes the unlock cost",
  );
  check(
    home.branchCards > 0 && home.branchChips === home.branchCards,
    "ending-branch cards render a branch chip",
  );
  const branchTooltip = await cdp.evaluate(`(() => {
    const card = [...document.querySelectorAll('[data-testid="timeline-card"]')]
      .find((item) => item.dataset.branch);
    return card?.getAttribute('title') ?? '';
  })()`);
  check(
    branchTooltip.includes(translate("zh-Hans", "timeline.legendBranchBadge")),
    "the branch card tooltip names its branch",
  );
  check(
    home.secondOrder > 1,
    "OA documents in reading order are absent from the timeline feed",
  );
  check(
    home.spoilerCards > 0 && home.spoilerChips === home.spoilerCards,
    "cards with a spoiler alert render a spoiler chip",
  );
  check(home.osCards === 501, `feed includes only the 501 main-seven OS logs (got ${home.osCards})`);
  check(home.osWithSnippet > 400, "OS cards render block-derived snippets");
  await cdp.screenshot("timeline.png");

  // -------------------------------------------------------------- level slider
  await cdp.evaluate(SET_SLIDER(0));
  const levelZero = await cdp.waitFor(
    `(() => {
      const cards = [...document.querySelectorAll('[data-testid="timeline-card"]')];
      if (!cards.length) return null;
      const levels = cards.map((card) => Number(card.dataset.level));
      return levels.every((level) => level === 0) ? cards.length : null;
    })()`,
    "all visible cards at level gate 0",
  );
  check(levelZero > 0 && levelZero < home.count, "level slider filters by level_gate");
  check(
    (await cdp.evaluate(`Number(document.querySelector('[data-testid="level-slider"]').value)`)) === 0,
    "slider value is committed to 0",
  );
  const maxLevel = Number(
    await cdp.evaluate(`document.querySelector('[data-testid="level-slider"]').max`),
  );
  check(maxLevel === 98, `slider max is the highest level gate (got ${maxLevel})`);
  await cdp.screenshot("timeline-level-filtered.png");

  await cdp.evaluate(SET_SLIDER(maxLevel));
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="timeline-card"]').length === ${home.count}`,
    "timeline restores at max level",
  );

  // -------------------------------------------------------------- tier filter
  await cdp.evaluate(`document.querySelector('[data-testid="tier-paid"]').click()`);
  const withoutPaid = await cdp.waitFor(
    `(() => {
      const cards = [...document.querySelectorAll('[data-testid="timeline-card"]')];
      const paid = cards.filter((card) => card.dataset.tier === 'paid').length;
      return paid === 0 ? cards.length : null;
    })()`,
    "paid tier cards hidden",
  );
  check(withoutPaid > 0 && withoutPaid < home.count, "tier filter removes paid entries");
  await cdp.evaluate(`document.querySelector('[data-testid="tier-paid"]').click()`);
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="timeline-card"]').length === ${home.count}`,
    "paid tier cards restored",
  );

  // ------------------------------------------------------------ account filter
  const SET_ACCOUNT = (value) => `(() => {
    const select = document.querySelector('[data-testid="account-filter"]');
    const setter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      'value',
    ).set;
    setter.call(select, ${JSON.stringify(value)});
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`;
  const accountOptions = Number(
    await cdp.evaluate(
      `document.querySelector('[data-testid="account-filter"]').options.length`,
    ),
  );
  // all + the seven im_filter_data accounts + other/NPC
  check(accountOptions === 9, `account filter lists 7 accounts plus other (got ${accountOptions})`);
  await cdp.evaluate(SET_ACCOUNT("paff_01"));
  const paffCards = await cdp.waitFor(
    `(() => {
      const cards = [...document.querySelectorAll('[data-testid="timeline-card"]')];
      if (!cards.length) return null;
      return cards.every((card) => card.dataset.account === 'paff_01')
        ? cards.length
        : null;
    })()`,
    "PAFF account cards",
  );
  check(
    paffCards === 110,
    `account filter shows PAFF's 29 posts and 81 OS logs (got ${paffCards})`,
  );
  check(
    await cdp.evaluate(`location.search === '?account=paff_01'`),
    "account filter is reflected in the URL",
  );
  await cdp.screenshot("timeline-account-filtered.png");
  await cdp.evaluate(SET_ACCOUNT("other"));
  const otherCards = await cdp.waitFor(
    `(() => {
      const cards = [...document.querySelectorAll('[data-testid="timeline-card"]')];
      if (!cards.length) return null;
      return cards.every((card) => card.dataset.account === 'other')
        ? cards.length
        : null;
    })()`,
    "other account cards",
  );
  check(otherCards === 401, `other/NPC account keeps the remaining 401 rows (got ${otherCards})`);
  await cdp.evaluate(SET_ACCOUNT("all"));
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="timeline-card"]').length === ${home.count}`,
    "account filter restores every account",
  );

  // -------------------------------------------------------------- type filter
  await cdp.evaluate(`document.querySelector('[data-testid="type-im_post"]').click()`);
  const imOnly = await cdp.waitFor(
    `(() => {
      const cards = [...document.querySelectorAll('[data-testid="timeline-card"]')];
      if (!cards.length) return null;
      return cards.every((card) => card.dataset.type === 'im_post') ? cards.length : null;
    })()`,
    "iM-only feed",
  );
  check(imOnly === 323, `type filter shows the 323 iM posts (got ${imOnly})`);
  await cdp.screenshot("timeline-type-filtered.png");
  await cdp.evaluate(`document.querySelector('[data-testid="type-all"]').click()`);
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="timeline-card"]').length === ${home.count}`,
    "timeline restored after type filter",
  );

  // ------------------------------------------------------- character pages
  const CHARACTER_SNAPSHOT = `(() => {
    const versions = [...document.querySelectorAll('[data-testid="character-os-version"]')]
      .map((group) => group.dataset.version);
    const orders = [...document.querySelectorAll('[data-testid="character-os-entry"]')]
      .map((entry) => entry.dataset.versionOrder);
    const numeric = (value) => value.split('.').map((part) => Number(part));
    const compare = (left, right) => {
      const a = numeric(left);
      const b = numeric(right);
      for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
        const difference = (a[index] ?? -1) - (b[index] ?? -1);
        if (difference !== 0) return difference;
      }
      return 0;
    };
    const imTab = document.querySelector('[data-testid="character-tab-im"]');
    const levelLabels = [...document.querySelectorAll(
      '[data-testid="character-os-entry"] [data-testid="os-unlock-level"]',
    )].map((label) => label.textContent);
    const illustrations = document.querySelectorAll(
      '[data-testid="character-illustration"] img',
    ).length;
    const brokenIllustrations = document.querySelectorAll(
      '[data-testid="character-broken-illustration"] img',
    ).length;
    return {
      osEntries: orders.length,
      versions,
      osSorted: orders.every(
        (value, index) => index === 0 || compare(orders[index - 1], value) <= 0,
      ),
      levels: levelLabels.length,
      firstLevel: levelLabels[0] ?? null,
      illustrations,
      brokenIllustrations,
      imTab: Boolean(imTab),
      imHref: imTab?.getAttribute('href') ?? null,
      paffNote:
        document.querySelector('[data-testid="character-paff-note"]')?.textContent?.trim() ??
        null,
      characterId:
        document.querySelector('[data-testid="character-view"]')?.dataset.characterId ??
        null,
    };
  })()`;

  await cdp.navigate(`${appBase}/character/paff001`);
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="character-os-entry"]').length > 0`,
    "PAFF character page",
  );
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="character-illustration"] img').length === 4`,
    "PAFF illustrations load",
  );
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="character-broken-illustration"] img').length === 1`,
    "PAFF broken illustration loads",
  );
  const paffPage = await cdp.evaluate(CHARACTER_SNAPSHOT);
  check(paffPage.characterId === "character/paff001", "PAFF character page loads");
  check(paffPage.osEntries === 81, `PAFF lists all 81 OS logs (got ${paffPage.osEntries})`);
  check(paffPage.versions.length > 1 && paffPage.osSorted, "PAFF OS logs are sorted by version");
  check(paffPage.levels === 81, `PAFF marks all 81 owner unlock levels (got ${paffPage.levels})`);
  check(paffPage.firstLevel === "Lv 36", `PAFF's first OS file marks Lv 36 (got ${paffPage.firstLevel})`);
  check(paffPage.illustrations === 4, `PAFF shows all 4 illustrations (got ${paffPage.illustrations})`);
  check(
    paffPage.brokenIllustrations === 1,
    `PAFF shows its bad-ending illustration (got ${paffPage.brokenIllustrations})`,
  );
  check(paffPage.imTab, "PAFF character page has an IM tab");
  check(
    paffPage.imHref === "/timeline?account=paff001",
    `PAFF IM tab links to the filtered global feed (got ${paffPage.imHref})`,
  );
  await cdp.screenshot("character-paff.png");

  await cdp.evaluate(`document.querySelector('[data-testid="character-tab-im"]').click()`);
  await cdp.waitFor(
    `location.pathname === '/timeline' &&
     location.search === '?account=paff001' &&
     document.querySelector('[data-testid="account-filter"]')?.value === 'paff_01' &&
     document.querySelectorAll('[data-testid="timeline-card"]').length === 110`,
    "PAFF IM tab opens the account-filtered timeline",
  );
  check(true, "character IM tab opens the global feed filtered by that account");

  for (const [gameId, expected, hasImTab] of [
    ["neko001", 55, true],
    ["robo001", 55, true],
    ["ivy001", 109, false],
    ["xenon001", 48, false],
    ["cherry002", 61, false],
    ["conner001", 71, false],
    ["joe001", 42, false],
  ]) {
    await cdp.navigate(`${appBase}/character/${gameId}`);
    await cdp.waitFor(
      `document.querySelectorAll('[data-testid="character-os-entry"]').length > 0`,
      `${gameId} character page`,
    );
    const page = await cdp.evaluate(CHARACTER_SNAPSHOT);
    check(
      page.osEntries === expected,
      `${gameId} lists ${expected} OS logs (got ${page.osEntries})`,
    );
    check(page.osSorted, `${gameId} OS logs are sorted by version`);
    check(
      page.imTab === hasImTab,
      `${gameId} IM tab presence is ${hasImTab} (got ${page.imTab})`,
    );
  }

  await cdp.navigate(`${appBase}/character/paff003`);
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="character-os-entry"]').length > 0`,
    "PΛFF character page",
  );
  const paffAlt = await cdp.evaluate(CHARACTER_SNAPSHOT);
  check(paffAlt.osEntries === 18, `PΛFF lists its 18 OS logs (got ${paffAlt.osEntries})`);
  check(paffAlt.levels === 18, `PΛFF marks all 18 owner unlock levels (got ${paffAlt.levels})`);
  check(!paffAlt.imTab, "PΛFF has no IM tab");
  check(
    paffAlt.paffNote === translate("zh-Hans", "character.paffNote"),
    "PΛFF carries the epilogue-response note",
  );
  await cdp.screenshot("character-paff-note.png");

  await cdp.navigate(`${appBase}/character/neko001`);
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="character-illustration"] img').length === 9`,
    "NEKO illustrations load",
  );
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="character-broken-illustration"] img').length === 1`,
    "NEKO broken illustration loads",
  );
  check(true, "NEKO character page lists all 9 illustrations");

  await cdp.navigate(`${appBase}/timeline?account=xenon_01`);
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="timeline-card"]').length === 19`,
    "Xenon account feed",
  );
  const xenonFeed = await cdp.evaluate(`(() => {
    const cards = [...document.querySelectorAll('[data-testid="timeline-card"]')];
    return {
      count: cards.length,
      types: [...new Set(cards.map((card) => card.dataset.type))],
    };
  })()`);
  check(
    xenonFeed.types.length === 1 && xenonFeed.types[0] === "im_post",
    "paid Xenon OS logs stay out of the timeline",
  );
  await cdp.navigate(`${appBase}/timeline`);
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="timeline-card"]').length === ${home.count}`,
    "timeline restored after character checks",
  );
  check(
    !(await cdp.evaluate(
      `Boolean(document.querySelector('[data-testid="timeline-card"][href^="/os/paos"]'))`,
    )),
    "PΛFF OS logs stay out of the timeline",
  );

  // ------------------------------------------------------- title-only iM posts
  const titleOnlyNote = translate("zh-Hans", "entity.titleOnlyPost");
  const removedNote = translate("zh-Hans", "entity.removedAfterReadPost");
  for (const gameId of ["N2201", "P1201", "Q6701", "R0801"]) {
    await cdp.navigate(`${appBase}/im/${gameId}`);
    await cdp.waitFor(
      `Boolean(document.querySelector('[data-testid="entity-view"][data-entity-type="im_post"]'))`,
      `${gameId} loads`,
    );
    check(
      (await cdp.evaluate(
        `document.querySelector('[data-testid="im-title-only-note"]')?.textContent ?? ''`,
      )) === titleOnlyNote,
      `${gameId} is marked as title-only`,
    );
    check(
      (await cdp.evaluate(
        `document.querySelector('[data-testid="im-removed-after-read-note"]')?.textContent ?? ''`,
      )) === removedNote,
      `${gameId} is marked as removed after reading`,
    );
  }
  for (const gameId of ["N2101", "X1601"]) {
    await cdp.navigate(`${appBase}/im/${gameId}`);
    await cdp.waitFor(
      `Boolean(document.querySelector('[data-testid="entity-view"][data-entity-type="im_post"]'))`,
      `${gameId} loads`,
    );
    check(
      !(await cdp.evaluate(
        `Boolean(document.querySelector('[data-testid="im-title-only-note"]'))`,
      )),
      `${gameId} is not marked title-only`,
    );
    check(
      !(await cdp.evaluate(
        `Boolean(document.querySelector('[data-testid="im-removed-after-read-note"]'))`,
      )),
      `${gameId} is not marked as removed after reading`,
    );
  }
  await cdp.navigate(`${appBase}/timeline`);
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="timeline-card"]').length === ${home.count}`,
    "timeline restored after title-only post checks",
  );

  // ------------------------------------ IM post reply feed (Q5)
  await cdp.navigate(`${appBase}/im/C0101`);
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="im-reply"]').length === 11 &&
     document.querySelectorAll('[data-testid="im-reply-body"]').length === 11`,
    "IM post renders every inbound reply under its body",
  );
  const replyFeed = await cdp.evaluate(`(() => ({
    replies: document.querySelectorAll('[data-testid="im-reply"]').length,
    bodies: document.querySelectorAll('[data-testid="im-reply-body"]').length,
    inRelations: document.querySelectorAll('[data-testid="relations"] [data-testid="im-reply"]').length,
    relations: document.querySelectorAll('[data-testid="relations-incoming"] [data-testid="relation-link"]').length,
    batched: performance.getEntriesByType('resource')
      .filter((entry) => entry.name.includes('/db/text?') && (entry.name.match(/ref=/g) ?? []).length > 1).length,
    firstFloor: document.querySelector('[data-testid="im-reply"]')?.dataset.floor ?? '',
  }))()`);
  check(
    replyFeed.replies === 11,
    `all 11 inbound replies render under the post body (got ${replyFeed.replies})`,
  );
  check(
    replyFeed.bodies === 11,
    `all 11 reply bodies render (got ${replyFeed.bodies})`,
  );
  check(
    replyFeed.inRelations === 0,
    "reply bodies stay out of the relations list",
  );
  check(
    replyFeed.relations === 11,
    `relations list keeps its navigable reply links (got ${replyFeed.relations})`,
  );
  const replyTitleStyle = await cdp.evaluate(`(() => {
    const title = document.querySelector(
      '[data-testid="relations-incoming"] .entity-link--reply .entity-link-title',
    );
    if (!title) return null;
    const style = getComputedStyle(title);
    const line = parseFloat(style.lineHeight) || 20;
    return {
      whiteSpace: style.whiteSpace,
      textOverflow: style.textOverflow,
      height: title.getBoundingClientRect().height,
      line,
    };
  })()`);
  check(
    replyTitleStyle?.whiteSpace === "nowrap" &&
      replyTitleStyle?.textOverflow === "ellipsis",
    "relation reply previews clip to one line with an ellipsis",
  );
  check(
    Boolean(
      replyTitleStyle &&
        replyTitleStyle.height <= replyTitleStyle.line * 1.6,
    ),
    `relation reply previews stay on one line (got ${replyTitleStyle?.height}px)`,
  );
  await cdp.evaluate(
    `document.querySelector('[data-testid="relations"]')?.scrollIntoView({ block: 'start' })`,
  );
  await cdp.screenshot("im-reply-relations.png");
  check(
    replyFeed.batched === 1,
    `reply bodies load through one batched text request (got ${replyFeed.batched})`,
  );
  check(
    replyFeed.firstFloor === "1",
    `reply feed starts at floor 1 (got ${replyFeed.firstFloor})`,
  );
  const replyLayout = await cdp.evaluate(`(() => {
    const card = document.querySelector('[data-testid="im-reply"]');
    const grid = card?.querySelector('.im-reply-grid');
    const author = card?.querySelector('.im-reply-author');
    const avatar = card?.querySelector('.im-reply-avatar');
    const content = card?.querySelector('.im-reply-content');
    const body = card?.querySelector('[data-testid="im-reply-body"]');
    if (!card || !grid || !author || !avatar || !content || !body) return null;
    const areas = getComputedStyle(grid).gridTemplateAreas;
    const avatarRect = avatar.getBoundingClientRect();
    const authorRect = author.getBoundingClientRect();
    return {
      areas,
      columns: getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length,
      cardBorder: getComputedStyle(card).borderTopWidth,
      authorBorder: getComputedStyle(author).borderTopWidth,
      contentBorder: getComputedStyle(content).borderTopWidth,
      proseBorder: getComputedStyle(body).borderTopWidth,
      prosePadding: getComputedStyle(body).paddingTop,
      avatarAbove: avatarRect.top <= authorRect.top,
      contentBelow: body.getBoundingClientRect().top >= authorRect.bottom - 1,
    };
  })()`);
  check(
    replyLayout?.areas.includes("avatar author floor") &&
      replyLayout?.areas.includes("avatar content content"),
    "reply grid keeps the avatar beside the name/floor and full-width content",
  );
  check(
    replyLayout?.columns === 3,
    `reply grid declares three columns (got ${replyLayout?.columns})`,
  );
  check(
    (replyLayout?.cardBorder ?? "0px") !== "0px",
    "each reply is framed",
  );
  check(
    replyLayout?.authorBorder === "0px" &&
      replyLayout?.contentBorder === "0px" &&
      replyLayout?.proseBorder === "0px" &&
      replyLayout?.prosePadding === "0px",
    "the reply frame has no internal cell borders",
  );
  check(
    replyLayout?.avatarAbove === true && replyLayout?.contentBelow === true,
    "the avatar spans two rows above the full-width reply content",
  );

  const richReply = await cdp.evaluate(`(() => {
    const reply = [...document.querySelectorAll('[data-testid="im-reply"]')]
      .find((node) => node.dataset.ref === 'im_reply/C0101#1');
    const body = reply?.querySelector('[data-testid="im-reply-body"]');
    const bold = [...(body?.querySelectorAll('span') ?? [])]
      .some((node) => node.getAttribute('style')?.includes('font-weight'));
    return {
      text: body?.textContent ?? '',
      raw: body?.innerHTML ?? '',
      bold,
      floor: reply?.dataset.floor ?? '',
      href: reply?.querySelector('[data-testid="im-reply-permalink"]')?.getAttribute('href') ?? '',
    };
  })()`);
  check(
    richReply.text.includes("@Colin Neumann Jr."),
    "reply feed shows the full body text",
  );
  check(
    !richReply.raw.includes("<color"),
    "reply feed renders game colour markup",
  );
  check(richReply.bold, "reply feed keeps bold rich text");
  check(
    richReply.floor === "1" && richReply.href.includes("im_reply/C0101"),
    "reply floor permalinks to the reply entity",
  );
  await cdp.evaluate(
    `document.querySelector('[data-testid="im-replies"]')?.scrollIntoView({ block: 'start' })`,
  );
  await cdp.screenshot("im-replies.png");

  await cdp.evaluate(SET_LANGUAGE("en"));
  await cdp.waitFor(
    `document.querySelector('[data-ref="im_reply/C0101#1"] [data-testid="im-reply-body"]')?.textContent?.includes('I have requested an account transfer')`,
    "reply feed follows the sidebar language",
  );
  check(true, "reply feed follows the sidebar language");
  await cdp.evaluate(SET_LANGUAGE("zh-Hans"));
  await cdp.waitFor(
    `document.querySelector('[data-ref="im_reply/C0101#1"] [data-testid="im-reply-body"]')?.textContent?.includes('@Colin Neumann Jr.')`,
    "reply feed returns to zh-Hans",
  );

  await cdp.navigate(`${appBase}/im/N2201`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="entity-view"]'))`,
    "title-only post loads",
  );
  check(
    (await cdp.evaluate(
      `document.querySelectorAll('[data-testid="im-replies"]').length`,
    )) === 0,
    "post without replies renders no reply feed",
  );

  await cdp.navigate(`${appBase}/os/aios017`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="entity-view"]'))`,
    "OS log loads",
  );
  check(
    (await cdp.evaluate(
      `document.querySelectorAll('[data-testid="im-replies"]').length`,
    )) === 0,
    "non-IM entities render no reply feed",
  );

  await cdp.navigate(`${appBase}/timeline`);
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="timeline-card"]').length === ${home.count}`,
    "timeline restored after reply body checks",
  );

  // ----------------------------------------------------------- command palette
  await cdp.evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }))`,
  );
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="command-palette"]'))`,
    "Ctrl+K opens the command palette",
  );
  await cdp.evaluate(`(() => {
    const input = document.querySelector('[data-testid="palette-input"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'paff');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return input.value;
  })()`);
  const paletteResults = await cdp.waitFor(
    `document.querySelectorAll('[data-testid="palette-item"]').length`,
    "palette results",
  );
  check(paletteResults > 0, "command palette filters entities as you type");
  await cdp.screenshot("command-palette.png");
  await cdp.evaluate(
    `document.querySelector('[data-testid="palette-input"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`,
  );
  await cdp.waitFor(
    `!document.querySelector('[data-testid="command-palette"]')`,
    "Escape closes the palette",
  );

  // ------------------------------------------------- card -> entity -> chart
  await cdp.evaluate(`document.querySelector('[data-testid="timeline-card"]').click()`);
  await cdp.waitFor(
    `location.pathname === '/im/P0101' && Boolean(document.querySelector('[data-testid="entity-view"]'))`,
    "first card opens the entity detail",
  );
  check(
    (await cdp.evaluate(`document.querySelector('[data-testid="entity-view"]').dataset.entityId`)) ===
      "im/P0101",
    "entity detail is im/P0101",
  );
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="entity-body"]'))`,
    "entity body text loads",
  );
  await cdp.screenshot("entity-im-post.png");

  await cdp.evaluate(`document.querySelector('[data-testid="chart-link"]').click()`);
  await cdp.waitFor(
    `location.pathname.startsWith('/song/') && Boolean(document.querySelector('[data-testid="chart-view"]'))`,
    "chart page opens from the detail link",
  );
  const chartState = await cdp.evaluate(`(() => {
    const source = document.querySelector('[data-testid="unlock-source"]');
    return {
      path: location.pathname,
      level: document.querySelector('[data-testid="chart-level"]')?.textContent?.trim() ?? '',
      difficulty: document.querySelector('[data-testid="chart-difficulty"]')?.textContent?.trim() ?? '',
      needUnlock: document.querySelector('[data-testid="chart-need-unlock"]')?.textContent?.trim() ?? '',
      sources: document.querySelectorAll('[data-testid="unlock-source"]').length,
      backlinks: document.querySelectorAll('[data-testid="chart-backlink"]').length,
      sourceHref: source?.getAttribute('href') ?? null,
      backHref: document.querySelector('[data-testid="back-to-timeline"]')?.getAttribute('href') ?? null,
    };
  })()`);
  check(/^\/song\/.+@/.test(chartState.path), "chart URL is /song/<songId>@<Difficulty>");
  check(chartState.level !== "", "chart page shows a level");
  check(chartState.difficulty !== "", "chart page shows a difficulty");
  check(
    chartState.needUnlock === translate("zh-Hans", "common.yes") ||
      chartState.needUnlock === translate("zh-Hans", "common.no"),
    "chart page shows NeedUnlock",
  );
  check(chartState.sources > 0, "chart page lists unlock sources from edges");
  check(chartState.backlinks === 0, "chart page does not repeat unlock sources as backlinks");
  check(chartState.sourceHref === "/im/P0101", "unlock source links to /im/P0101");
  check(chartState.backHref === "/timeline", "chart page offers a timeline link");
  await cdp.screenshot("chart-view.png");

  // ------------------------------------------------ source jump and return
  await cdp.evaluate(`document.querySelector('[data-testid="unlock-source"]').click()`);
  await cdp.waitFor(
    `location.pathname === '/im/P0101' && Boolean(document.querySelector('[data-testid="entity-view"]'))`,
    "unlock source opens its entity",
  );
  check(true, "unlock source entity is clickable and opens");
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="relations-outgoing"]')) &&
     Boolean(document.querySelector('[data-testid="relations-incoming"]'))`,
    "entity detail shows outgoing and incoming edge sections",
  );
  check(true, "entity detail shows outgoing and incoming edge sections");
  const roundTripHref = await cdp.evaluate(
    `document.querySelector('[data-testid="chart-link"]').getAttribute('href')`,
  );
  await cdp.evaluate(`document.querySelector('[data-testid="chart-link"]').click()`);
  await cdp.waitFor(
    `location.pathname === ${JSON.stringify(roundTripHref)} && Boolean(document.querySelector('[data-testid="chart-view"]'))`,
    "chart reopened from the post",
  );
  check(true, "chart → post → chart round trip returns to the same chart");
  await cdp.evaluate(`document.querySelector('[data-testid="back-button"]').click()`);
  await cdp.waitFor(
    `location.pathname === '/im/P0101' && Boolean(document.querySelector('[data-testid="entity-view"]'))`,
    "back button returns to the post",
  );
  check(true, "back button returns from the chart to the post");
  await cdp.evaluate(`document.querySelector('[data-testid="back-to-timeline"]').click()`);
  await cdp.waitFor(
    `location.pathname === '/timeline' && document.querySelectorAll('[data-testid="timeline-card"]').length > 0`,
    "return to timeline from the entity",
  );
  check(true, "entity detail returns to the timeline");

  // ------------------------------------------- deep link chart + root redirect
  await cdp.navigate(`${appBase}${chartState.path}`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="chart-view"]'))`,
    "chart deep link loads",
  );
  check(
    (await cdp.evaluate(`location.pathname`)) === chartState.path,
    "chart deep link keeps its history route",
  );
  await cdp.evaluate(`document.querySelector('[data-testid="back-to-timeline"]').click()`);
  await cdp.waitFor(
    `location.pathname === '/timeline' && document.querySelectorAll('[data-testid="timeline-card"]').length > 0`,
    "chart page returns to the timeline",
  );
  check(true, "chart page returns to the timeline");

  // ------------------------------------------- chart audio variant duration
  for (const [difficulty, duration] of [
    ["Easy", "1:20"],
    ["Hard", "1:07"],
    ["Chaos", "2:18"],
  ]) {
    await cdp.navigate(`${appBase}/song/vanessa001_022@${difficulty}`);
    await cdp.waitFor(
      `Boolean(document.querySelector('[data-testid="chart-view"]'))`,
      `THE BEGINNING ${difficulty} chart loads`,
    );
    const audio = await cdp.evaluate(
      `document.querySelector('[data-testid="chart-audio"]')?.textContent?.trim() ?? ''`,
    );
    check(
      audio.includes("vanessa001_022_") && audio.includes(duration),
      `chart ${difficulty} shows its own audio variant (${duration}, got ${audio})`,
    );
  }
  await cdp.navigate(`${appBase}/timeline`);
  await cdp.waitFor(
    `location.pathname === '/timeline' && document.querySelectorAll('[data-testid="timeline-card"]').length > 0`,
    "timeline returns after the chart audio checks",
  );

  // ---------------------------------------------------------- OS log detail
  const osHref = await cdp.evaluate(
    `document.querySelector('[data-testid="timeline-card"][data-type="os_log"]').getAttribute('href')`,
  );
  await cdp.evaluate(
    `document.querySelector('[data-testid="timeline-card"][data-type="os_log"]').click()`,
  );
  await cdp.waitFor(
    `location.pathname === ${JSON.stringify(osHref)} && Boolean(document.querySelector('[data-testid="entity-view"]'))`,
    "OS card opens its entity detail",
  );
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="entity-body"]'))`,
    "OS log body blocks load",
  );
  check(true, "OS log card opens a rendered detail");
  await cdp.evaluate(`document.querySelector('[data-testid="back-to-timeline"]').click()`);
  await cdp.waitFor(
    `location.pathname === '/timeline' && document.querySelectorAll('[data-testid="timeline-card"]').length > 0`,
    "OS detail returns to the timeline",
  );

  // ------------------------------------------- OS gallery-image logs
  await cdp.navigate(`${appBase}/os/ivos003`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="entity-body"] img'))`,
    "gallery OS log renders its image",
  );
  const galleryOs = await cdp.evaluate(`(() => {
    const body = document.querySelector('[data-testid="entity-body"]');
    return {
      images: [...body.querySelectorAll('img')]
        .map((img) => new URL(img.getAttribute('src'), location.href).pathname),
      text: body.textContent ?? '',
    };
  })()`);
  check(
    galleryOs.images.length === 1 &&
      galleryOs.images[0].endsWith("/media/os-attachments/ivos0301.png"),
    `gallery OS log renders its manifest image (got ${galleryOs.images.join(", ")})`,
  );
  check(
    !galleryOs.text.includes('"Id"'),
    "gallery JSON does not leak into the OS body as narration",
  );
  await cdp.screenshot("os-gallery-image.png");

  await cdp.navigate(`${appBase}/os/ivos026`);
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="entity-body"] img').length === 3`,
    "gallery OS log renders every referenced image",
  );
  check(true, "gallery OS log renders every referenced image");

  // -------------------------------------------- OS phone transcripts (`msgs`)
  await cdp.navigate(`${appBase}/os/nos021`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="os-msgs"]'))`,
    "phone-transcript OS log renders its chat",
  );
  await cdp.evaluate(
    `document.querySelector('[data-testid="os-msgs"]')?.scrollIntoView({ block: 'start' })`,
  );
  await cdp.waitFor(
    `[...document.querySelectorAll('[data-testid="os-msgs"] .msgs-sticker')].some((img) => img.complete && img.naturalWidth === 139)`,
    "sticker sprite loads",
  );
  await cdp.waitFor(
    `[...document.querySelectorAll('[data-testid="os-msgs"] .msgs-avatar')].some((img) => img.complete && img.naturalWidth === 80)`,
    "chat avatar sprite loads",
  );
  const msgsLog = await cdp.evaluate(`(() => {
    const chat = document.querySelector('[data-testid="os-msgs"]');
    return {
      bubbles: chat.querySelectorAll('.msgs-row').length,
      outgoing: chat.querySelectorAll('.msgs-row.outgoing').length,
      incoming: chat.querySelectorAll('.msgs-row.incoming').length,
      system: chat.querySelectorAll('.msgs-system').length,
      avatars: [...chat.querySelectorAll('.msgs-avatar')].map((el) => el.getAttribute('src')),
      stickers: [...chat.querySelectorAll('.msgs-sticker')].map((el) => el.getAttribute('src')),
      attachmentFallbacks: chat.querySelectorAll('.msgs-attachment').length,
      firstText: chat.querySelector('.msgs-text')?.textContent ?? '',
      body: document.querySelector('[data-testid="entity-body"]')?.textContent ?? '',
    };
  })()`);
  check(
    msgsLog.bubbles === 29,
    `phone transcript keeps all 29 bubbles (got ${msgsLog.bubbles})`,
  );
  check(
    msgsLog.outgoing === 20 && msgsLog.incoming === 9,
    `phone transcript keeps both sides (got ${msgsLog.outgoing}/${msgsLog.incoming})`,
  );
  check(
    msgsLog.avatars.length === 29 &&
      msgsLog.avatars[0].endsWith("/media/os-avatars/linda_os_01.png") &&
      msgsLog.avatars[1].endsWith("/media/os-avatars/neko_os_01.png"),
    `every bubble carries its sender avatar (got ${msgsLog.avatars.length})`,
  );
  check(
    msgsLog.stickers.join(",") ===
      "/media/os-stickers/07_CatXD.png,/media/os-stickers/07_CatXD.png,/media/os-stickers/08_CatQQ.png,/media/os-stickers/08_CatQQ.png",
    `sticker messages render their sprite (got ${msgsLog.stickers.join(",")})`,
  );
  check(
    msgsLog.attachmentFallbacks === 0,
    `sticker sprites never fall back to raw ids (got ${msgsLog.attachmentFallbacks})`,
  );
  check(msgsLog.firstText === "在吗", `transcript starts with the first message (got ${msgsLog.firstText})`);
  check(
    !msgsLog.body.includes("MessageType") && !/\bmsgs\b/.test(msgsLog.body),
    "the raw msgs payload never leaks into the body",
  );
  await cdp.screenshot("os-msgs-transcript.png");

  await cdp.navigate(`${appBase}/os/cpos035`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="os-msgs"]'))`,
    "second phone transcript renders",
  );
  const systemLine = await cdp.evaluate(`(() => {
    const chat = document.querySelector('[data-testid="os-msgs"]');
    return {
      system: chat.querySelectorAll('.msgs-system').length,
      systemText: chat.querySelector('.msgs-system')?.textContent ?? '',
    };
  })()`);
  check(
    systemLine.system === 1 && systemLine.systemText.length > 0,
    `system lines render as their own row (got ${systemLine.system})`,
  );

  await cdp.navigate(`${appBase}/timeline`);
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="timeline-card"]').length === ${home.count}`,
    "timeline restored after gallery OS checks",
  );

  // ------------------------------------------- OS cutscene player (#28)
  await cdp.navigate(`${appBase}/os/aios017`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="os-cutscene"] video[data-testid="video-player"]'))`,
    "OS cutscene player loads",
  );
  const cutscene = await cdp.evaluate(`(() => {
    const section = document.querySelector('[data-testid="os-cutscene"]');
    const video = section.querySelector('video[data-testid="video-player"]');
    const track = section.querySelector('[data-testid="video-track"]');
    return {
      sectionClip: section.dataset.clip,
      heading: section.querySelector('h2')?.textContent ?? '',
      clip: video.dataset.clip,
      src: new URL(video.getAttribute('src'), location.href).pathname,
      controls: video.controls,
      autoplay: video.autoplay,
      paused: video.paused,
      trackLang: track?.srclang ?? null,
      trackSrc: track ? new URL(track.getAttribute('src'), location.href).pathname : null,
      tracks: section.querySelectorAll('[data-testid="video-track"]').length,
    };
  })()`);
  check(
    cutscene.sectionClip === "aios1701",
    `OS cutscene section carries the clip id (got ${cutscene.sectionClip})`,
  );
  check(Boolean(cutscene.heading), "OS cutscene section has a heading");
  check(
    cutscene.clip === "aios1701",
    `cutscene player exposes its clip id (got ${cutscene.clip})`,
  );
  check(
    cutscene.src.endsWith("/media/videos/aios1701.mp4"),
    `cutscene resolves through the media manifest (got ${cutscene.src})`,
  );
  check(cutscene.controls === true, "cutscene player shows native controls");
  check(cutscene.autoplay === false, "cutscene player never autoplays");
  check(cutscene.paused === true, "cutscene player starts paused");
  check(
    cutscene.tracks === 1,
    `cutscene renders exactly one subtitle track (got ${cutscene.tracks})`,
  );
  check(
    cutscene.trackLang === "zh-Hans",
    `cutscene track follows the sidebar language (got ${cutscene.trackLang})`,
  );
  check(
    cutscene.trackSrc.endsWith("/media/subs/aios1701.zh-Hans.vtt"),
    `cutscene track points at the zh-Hans VTT (got ${cutscene.trackSrc})`,
  );
  const zhCueCount = await cdp.waitFor(
    `(() => {
      const track = document.querySelector('[data-testid="os-cutscene"] [data-testid="video-track"]');
      return track && track.readyState === 2 && track.track?.cues ? track.track.cues.length : 0;
    })()`,
    "zh-Hans subtitle cues load",
  );
  check(zhCueCount === 17, `zh-Hans cutscene subtitles expose 17 cues (got ${zhCueCount})`);
  const zhCue = await cdp.evaluate(
    `document.querySelector('[data-testid="os-cutscene"] [data-testid="video-track"]').track.cues[0].text`,
  );
  check(Boolean(zhCue), "zh-Hans subtitle cue 1 has text");
  await cdp.evaluate(`window.__cutsceneMarker = 'kept'`);
  await cdp.evaluate(SET_LANGUAGE("ja"));
  const jaCue = await cdp.waitFor(
    `(() => {
      const track = document.querySelector('[data-testid="os-cutscene"] [data-testid="video-track"]');
      if (!track || track.srclang !== 'ja' || track.readyState !== 2) return false;
      const cue = track.track?.cues?.[0]?.text ?? '';
      return cue && cue !== ${JSON.stringify(zhCue)} ? cue : false;
    })()`,
    "ja subtitle track loads",
  );
  check(jaCue !== zhCue, "switching to ja swaps the subtitle track text");
  check(
    (await cdp.evaluate(`window.__cutsceneMarker`)) === "kept",
    "language switch reuses the loaded page (no reload)",
  );
  await cdp.evaluate(SET_LANGUAGE("zh-Hans"));
  await cdp.waitFor(
    `document.querySelector('[data-testid="os-cutscene"] [data-testid="video-track"]')?.srclang === 'zh-Hans'`,
    "zh-Hans track returns",
  );

  await cdp.navigate(`${appBase}/os/xos025`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="os-cutscene"] video[data-testid="video-player"]'))`,
    "xos025 cutscene player loads",
  );
  const noSubtitles = await cdp.evaluate(`(() => {
    const section = document.querySelector('[data-testid="os-cutscene"]');
    const note = section.querySelector('[data-testid="video-subtitle-missing"]');
    return {
      clip: section.dataset.clip,
      src: new URL(section.querySelector('video').getAttribute('src'), location.href).pathname,
      tracks: section.querySelectorAll('[data-testid="video-track"]').length,
      note: Boolean(note),
      noteLang: note?.dataset.lang ?? null,
      noteText: note?.textContent ?? '',
    };
  })()`);
  check(
    noSubtitles.clip === "xos2502",
    `OS log without a subtitle group still shows its cutscene (got ${noSubtitles.clip})`,
  );
  check(
    noSubtitles.src.endsWith("/media/videos/xos2502.mp4"),
    `xos025 cutscene resolves through the manifest (got ${noSubtitles.src})`,
  );
  check(noSubtitles.tracks === 0, "clip without a subtitle group renders no track");
  check(
    noSubtitles.note === true,
    "clip without a subtitle group explains the missing subtitles",
  );
  check(
    noSubtitles.noteLang === "zh-Hans",
    `missing-subtitle note names the active language (got ${noSubtitles.noteLang})`,
  );
  check(noSubtitles.noteText.trim().length > 0, "missing-subtitle note has copy");

  await cdp.navigate(`${appBase}/os/alos025`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="entity-view"]'))`,
    "alos025 entity view loads",
  );
  check(
    (await cdp.evaluate(
      `document.querySelectorAll('[data-testid="os-cutscene"]').length`,
    )) === 0,
    "OS log without a cutscene renders no cutscene section",
  );

  // #28 negative path: drop the OS log's cutscene clip from every media map.
  const stub = await cdp.call("Page.addScriptToEvaluateOnNewDocument", {
    source: manifestStub({
      movies: ["aios1701"],
      videos: ["aios1701"],
      subtitles: ["aios1701"],
    }),
  });
  await cdp.navigate(`${appBase}/os/aios017`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="video-missing"]'))`,
    "missing-clip note renders",
  );
  const missingClip = await cdp.evaluate(`(() => {
    const note = document.querySelector('[data-testid="video-missing"]');
    return {
      clip: note.dataset.clip,
      text: note.textContent ?? '',
      players: document.querySelectorAll('[data-testid="os-cutscene"] video[data-testid="video-player"]').length,
    };
  })()`);
  check(
    missingClip.clip === "aios1701",
    `missing-clip note names the clip (got ${missingClip.clip})`,
  );
  check(missingClip.players === 0, "missing clip renders no <video> element");
  check(missingClip.text.trim().length > 0, "missing-clip note has copy");
  await cdp.call("Page.removeScriptToEvaluateOnNewDocument", {
    identifier: stub.identifier,
  });
  await cdp.navigate(`${appBase}/os/aios017`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="os-cutscene"] video[data-testid="video-player"]'))`,
    "cutscene player returns without the stub",
  );
  check(true, "removing the manifest stub restores the cutscene player");

  await cdp.call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  const narrow = await cdp.waitFor(
    `(() => {
      const frame = document.querySelector('[data-testid="os-cutscene"] .video-frame');
      const content = document.querySelector('.content');
      if (!frame || !content) return false;
      const box = frame.getBoundingClientRect();
      if (box.width < 100) return false;
      const video = frame.querySelector('video');
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        videoWidth: Math.round(video.getBoundingClientRect().width),
        contentWidth: Math.round(content.clientWidth),
        ratio: Number((box.height / box.width).toFixed(3)),
      };
    })()`,
    "narrow viewport cutscene frame",
  );
  check(
    narrow.scrollWidth <= narrow.clientWidth + 1,
    `cutscene does not overflow the narrow viewport (scroll ${narrow.scrollWidth} vs client ${narrow.clientWidth})`,
  );
  check(
    narrow.videoWidth <= narrow.contentWidth,
    `cutscene video fits the content column (${narrow.videoWidth} <= ${narrow.contentWidth})`,
  );
  check(
    Math.abs(narrow.ratio - 9 / 16) <= 0.02,
    `cutscene frame keeps the 16:9 ratio (got ${narrow.ratio})`,
  );
  await cdp.call("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="os-cutscene"] .video-frame'))`,
    "cutscene frame survives the viewport restore",
  );
  await cdp.screenshot("os-cutscene.png");

  // -------------------------------------------- OS index: chapter → folder
  await cdp.navigate(`${appBase}/os`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="os-index"]'))`,
    "OS index loads",
  );
  await cdp.evaluate(
    `document.querySelector('[data-testid="os-mode-chapter"]').click()`,
  );
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="os-chapter-group"]').length > 0`,
    "OS chapter grouping renders",
  );
  const chapterIndex = await cdp.evaluate(`(() => {
    const groups = [...document.querySelectorAll('[data-testid="os-chapter-group"]')];
    const first = groups[0];
    return {
      chapters: groups.length,
      ids: groups.map((group) => group.dataset.chapterId),
      names: groups.map(
        (group) => group.querySelector('summary .os-summary-name > span')?.textContent ?? '',
      ),
      firstName: first?.querySelector('summary')?.textContent ?? '',
      firstFolder: first?.querySelector('[data-testid="os-folder-group"] h3 span')?.textContent ?? '',
      firstOpen: first?.hasAttribute('open') ?? false,
      firstLevel: first?.querySelector('[data-testid="os-unlock-level"]')?.textContent ?? '',
      levels: document.querySelectorAll('[data-testid="os-chapter-group"] [data-testid="os-unlock-level"]').length,
      folders: document.querySelectorAll('[data-testid="os-folder-group"]').length,
      entries: document.querySelectorAll('[data-testid="os-chapter-group"] .link-list li').length,
    };
  })()`);
  check(
    chapterIndex.chapters === 17,
    `chapter view lists 17 chapters with logs (got ${chapterIndex.chapters})`,
  );
  check(
    !chapterIndex.ids.includes("chapter/16"),
    "the test01 staging chapter stays out of the chapter view",
  );
  check(
    chapterIndex.firstName.includes("Architects"),
    "chapter view starts with the Architects chapter",
  );
  check(
    chapterIndex.names.slice(0, 4).join("|") === "Architects|Decommission|Amiya|cyTus",
    `chapter order follows the game, not the table id (got ${chapterIndex.names.slice(0, 4).join(" → ")})`,
  );
  check(
    !chapterIndex.firstOpen,
    "chapters start collapsed: sort order carries no reading order",
  );
  check(
    chapterIndex.firstFolder === "Ivy & Vanessa",
    `chapter 0 groups its files under Ivy & Vanessa (got ${chapterIndex.firstFolder})`,
  );
  check(
    chapterIndex.entries === 1032,
    `chapter view covers all 1032 non-staging OS logs (got ${chapterIndex.entries})`,
  );
  check(
    chapterIndex.folders === 54,
    `chapter view renders 54 folder groups (got ${chapterIndex.folders})`,
  );
  check(
    chapterIndex.firstLevel === "Lv 2",
    `first chapter file marks its owner unlock level (got ${chapterIndex.firstLevel})`,
  );
  check(
    chapterIndex.levels === 1031,
    `chapter view marks every file with an owner level (got ${chapterIndex.levels})`,
  );
  await cdp.screenshot("os-chapters.png");

  await cdp.evaluate(
    `document.querySelector('[data-testid="os-mode-character"]').click()`,
  );
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="os-character-group"]').length > 0`,
    "character grouping switches back in",
  );
  check(
    (await cdp.evaluate(
      `document.querySelectorAll('[data-testid="os-character-group"]').length`,
    )) === 26,
    "26 characters list their OS logs",
  );

  await cdp.evaluate(
    `document.querySelector('[data-testid="os-mode-version"]').click()`,
  );
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="os-version-root"]').length > 0`,
    "version grouping renders",
  );
  await cdp.navigate(`${appBase}/timeline`);
  await cdp.navigate(`${appBase}/os`);
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="os-version-root"]').length > 0`,
    "OS grouping survives leaving and returning",
  );
  check(
    (await cdp.evaluate(`sessionStorage.getItem('os-index-mode')`)) === "version",
    "OS grouping persists in sessionStorage",
  );

  // No group opens by default (sort order carries no reading order), and a
  // reload keeps both the collapsed state and the scroll position.
  await cdp.evaluate(
    `document.querySelector('[data-testid="os-mode-character"]').click()`,
  );
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="os-character-group"]').length > 0`,
    "character grouping renders for the collapse check",
  );
  check(
    (await cdp.evaluate(
      `[...document.querySelectorAll('[data-testid="os-character-group"]')].every(
        (group) => group.open === false,
      )`,
    )) === true,
    "character groups start collapsed",
  );
  await cdp.evaluate(
    `document.querySelectorAll('[data-testid="os-character-group"]')[4].querySelector('summary').click()`,
  );
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="os-character-group"]')[4].open === true`,
    "a character group opens",
  );
  await cdp.evaluate(
    `document.querySelectorAll('[data-testid="os-character-group"]')[4].querySelector('summary').click()`,
  );
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="os-character-group"]')[4].open === false`,
    "the character group closes again",
  );
  check(
    (await cdp.evaluate(
      `[...document.querySelectorAll('[data-testid="os-character-group"]')].every(
        (group) => group.open === false,
      )`,
    )) === true,
    "closing the last open group leaves every group collapsed",
  );

  await cdp.evaluate(`window.scrollTo(0, 600)`);
  await cdp.waitFor(`window.scrollY >= 500`, "the OS index scrolls");
  await cdp.call("Page.reload", {});
  await cdp.waitFor(`document.readyState === 'complete'`, "OS index reloads");
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="os-index"]')) &&
     document.querySelectorAll('[data-testid="os-character-group"]').length > 0`,
    "OS index renders after the reload",
  );
  await sleep(600);
  const reloadedOs = await cdp.evaluate(`(() => ({
    openCount: [...document.querySelectorAll('[data-testid="os-character-group"]')]
      .filter((group) => group.open).length,
    scrollY: Math.round(window.scrollY),
  }))()`);
  check(
    reloadedOs.openCount === 0,
    "a reload keeps every OS group collapsed",
  );
  check(
    reloadedOs.scrollY >= 400,
    `a reload restores the OS index scroll position (got ${reloadedOs.scrollY})`,
  );
  await cdp.screenshot("os-collapse-reload.png");

  await cdp.evaluate(
    `document.querySelector('[data-testid="os-mode-chapter"]').click()`,
  );

  // ------------------------------------ CAPSO unlock source (generic detail)
  await cdp.navigate(`${appBase}/song/neko001_058@Chaos`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="chart-view"]')) &&
     Boolean(document.querySelector('[data-testid="unlock-source"]'))`,
    "CAPSO-unlocked chart loads",
  );
  const capsoSource = await cdp.evaluate(
    `document.querySelector('[data-testid="unlock-source"]').getAttribute('href')`,
  );
  check(
    capsoSource?.startsWith("/capso_shop_item/") === true,
    "chart with a CAPSO source links to the CAPSO item",
  );
  await cdp.evaluate(`document.querySelector('[data-testid="unlock-source"]').click()`);
  await cdp.waitFor(
    `location.pathname.startsWith('/capso_shop_item/') && Boolean(document.querySelector('[data-testid="entity-view"]'))`,
    "generic CAPSO entity detail opens",
  );
  check(
    (await cdp.evaluate(
      `Boolean(document.querySelector('[data-testid="capso-item-detail"]'))`,
    )) === true,
    "CAPSO item detail renders the typed CAPSO section",
  );
  await cdp.evaluate(`document.querySelector('[data-testid="back-to-collection"]').click()`);
  await cdp.waitFor(
    `location.pathname === '/shop' && Boolean(document.querySelector('[data-testid="shop-stats"]'))`,
    "CAPSO detail returns to the shop",
  );
  check(true, "CAPSO detail returns to the shop");

  await cdp.navigate(`${appBase}/`);
  await cdp.waitFor(
    `location.pathname === '/timeline' && document.querySelectorAll('[data-testid="timeline-card"]').length > 0`,
    "root redirects to /timeline",
  );
  check(true, "/ redirects to /timeline");

  // --------------------------------------------------------- character list
  await cdp.navigate(`${appBase}/characters`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="characters-index"]'))`,
    "Character index loads",
  );
  const characterIndex = await cdp.evaluate(`(() => ({
    cards: document.querySelectorAll('[data-testid="character-card"]').length,
    stats: document.querySelector('[data-testid="characters-stats"]')?.textContent ?? '',
    firstHref: document.querySelector('[data-testid="character-card"]')?.getAttribute('href'),
    navActive: document.querySelector('[data-testid="nav-characters"]')?.getAttribute('aria-current'),
  }))()`);
  check(
    characterIndex.cards === 27,
    `Character index lists 27 characters (got ${characterIndex.cards})`,
  );
  check(
    characterIndex.firstHref === "/character/alice001",
    "Character index links a character page",
  );
  check(
    characterIndex.stats.includes(formatUnit(zhHans, "characters", 27)),
    "Character index counts 27 characters",
  );
  check(
    characterIndex.navActive === "page",
    "Sidebar marks the character list as the current view",
  );
  await cdp.evaluate(`document.querySelector('[data-testid="character-card"]').click()`);
  await cdp.waitFor(
    `location.pathname === '/character/alice001' && Boolean(document.querySelector('[data-testid="character-view"]'))`,
    "Character index opens a character page",
  );
  check(
    (await cdp.evaluate(`document.title`)) === "character/alice001 · Cytus II",
    "Character page keeps its entity title",
  );

  // ------------------------------------------------------------- OA archive
  await cdp.navigate(`${appBase}/oa`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="oa-index"]'))`,
    "OA index loads",
  );
  await cdp.waitFor(
    `(() => {
      const logos = [...document.querySelectorAll('[data-testid="oa-character-card"] img.collection-logo')];
      return logos.length === 12 && logos.every((img) => img.complete && img.naturalWidth > 0);
    })()`,
    "OA index renders every character LOGO",
  );
  const oaIndex = await cdp.evaluate(`(() => ({
    characters: document.querySelectorAll('[data-testid="oa-character-card"]').length,
    firstHref: document.querySelector('[data-testid="oa-character-card"]')?.getAttribute('href'),
    logos: document.querySelectorAll('[data-testid="oa-character-card"] img.collection-logo').length,
    firstLogoSrc:
      document.querySelector('[data-testid="oa-character-card"] img.collection-logo')?.getAttribute('src') ?? '',
    stats: document.querySelector('[data-testid="oa-stats"]')?.textContent ?? '',
  }))()`);
  check(oaIndex.characters === 12, `OA index lists 12 characters (got ${oaIndex.characters})`);
  check(oaIndex.firstHref === "/oa/alice001", "OA index links a character archive");
  check(
    oaIndex.logos === 12,
    `OA index shows a character LOGO on every card (got ${oaIndex.logos})`,
  );
  check(
    oaIndex.firstLogoSrc.endsWith("/media/gallery-icons/alice001.png"),
    `OA card LOGO resolves to the character logo file (got ${oaIndex.firstLogoSrc})`,
  );
  check(
    oaIndex.stats.includes(formatUnit(zhHans, "documents", 101)),
    "OA index counts 101 documents",
  );
  await cdp.evaluate(`document.querySelector('[data-testid="oa-character-card"]').click()`);
  await cdp.waitFor(
    `location.pathname === '/oa/alice001' && Boolean(document.querySelector('[data-testid="oa-workspace"]'))`,
    "OA character archive opens",
  );
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="oa-scene-video"]').length === 2 &&
     document.querySelectorAll('[data-testid="oa-object-link"]').length === 2 &&
     !document.querySelector('[data-testid="oa-object-art"]')`,
    "OA archive loads scenes and the object index",
  );
  const oaMedia = await cdp.evaluate(`(() => ({
    scenes: document.querySelectorAll('[data-testid="oa-scene-video"]').length,
    sceneSrc: document.querySelector('[data-testid="oa-scene-video"] video')?.getAttribute('src') ?? '',
    sceneClips: [...document.querySelectorAll('[data-testid="oa-scene-video"] video')].map(
      (video) => video.dataset.clip ?? '',
    ),
    audioNotes: document.querySelectorAll(
      '[data-testid="oa-scene-video"] [data-testid="video-no-audio"]',
    ).length,
    logos: document.querySelectorAll('[data-testid="oa-scene-logos"] img').length,
    objects: document.querySelectorAll('[data-testid="oa-object-link"]').length,
    objectArt: document.querySelectorAll('[data-testid="oa-object-art"]').length,
  }))()`);
  check(oaMedia.scenes === 2, `Alice OA shows both scene videos (got ${oaMedia.scenes})`);
  check(
    oaMedia.sceneSrc.endsWith("/media/videos/alice001_oa_system.mp4"),
    `OA scene video resolves to its manifest file (got ${oaMedia.sceneSrc})`,
  );
  check(oaMedia.logos === 1, `Alice OA shows its scene LOGO (got ${oaMedia.logos})`);
  check(oaMedia.objects === 2, `Alice OA links both objects (got ${oaMedia.objects})`);
  check(
    oaMedia.objectArt === 0,
    `object art stays on the object page (got ${oaMedia.objectArt} art sections in the archive)`,
  );
  check(
    oaMedia.sceneClips.length === 2 &&
      oaMedia.sceneClips.every((clip) => clip.endsWith("_oa_system")),
    `OA scenes are the silent _oa_system clips (got ${oaMedia.sceneClips.join(", ")})`,
  );
  check(
    oaMedia.audioNotes === 0,
    `OA scene players keep the no-audio note out of the archive surfaces (got ${oaMedia.audioNotes})`,
  );
  const oaAliceDescriptions = await cdp.evaluate(`(() => ({
    groups: document.querySelectorAll('[data-testid="oa-description-group"]').length,
    variants: document.querySelectorAll('[data-testid="oa-description-variant"]').length,
    appears: document.querySelectorAll('[data-testid="oa-description-appears"]').length,
    hidden: document.querySelectorAll('[data-testid="oa-description-hidden"]').length,
    stage: document.querySelector('[data-testid="oa-description-group"] [data-testid="oa-description-link"]')?.textContent?.trim() ?? '',
    appearText: document.querySelector('[data-testid="oa-description-appears"]')?.textContent?.trim() ?? '',
  }))()`);
  check(oaAliceDescriptions.groups === 5, `Alice OA groups its 5 hotspots (got ${oaAliceDescriptions.groups})`);
  check(oaAliceDescriptions.variants === 5, `Alice OA renders 5 description versions (got ${oaAliceDescriptions.variants})`);
  check(oaAliceDescriptions.appears === 5, `Alice OA states when every description appears (got ${oaAliceDescriptions.appears})`);
  check(
    oaAliceDescriptions.hidden === 0,
    `Alice descriptions never disappear (got ${oaAliceDescriptions.hidden} hide lines)`,
  );
  check(
    oaAliceDescriptions.stage.includes("初始"),
    `Alice description labels its stage (got ${oaAliceDescriptions.stage})`,
  );
  check(
    oaAliceDescriptions.appearText.includes("Lv 4"),
    `Alice description states its level gate (got ${oaAliceDescriptions.appearText})`,
  );
  await cdp.screenshot("oa-archive.png");
  await cdp.evaluate(`document.querySelector('[data-testid="oa-object-link"]').click()`);
  await cdp.waitFor(
    `location.pathname === '/oa_object/alice001_obj001' &&
     Boolean(document.querySelector('[data-testid="entity-view"][data-entity-type="oa_object"]')) &&
     document.querySelectorAll('[data-testid="oa-object-art"] img').length === 4 &&
     (document.querySelector('[data-testid="entity-body"]')?.textContent ?? '').trim().length >= 10`,
    "OA object page owns its art and text",
  );
  const oaObject = await cdp.evaluate(`(() => ({
    path: location.pathname,
    art: document.querySelectorAll('[data-testid="oa-object-art"] img').length,
    bodyLength: (document.querySelector('[data-testid="entity-body"]')?.textContent ?? '').trim().length,
    documents: document.querySelectorAll('[data-testid="oa-document-link"]').length,
    backCollection: document.querySelector('[data-testid="back-to-collection"]')?.getAttribute('href') ?? '',
    archiveLink: document.querySelector('[data-testid="oa-object-archive-link"]')?.getAttribute('href') ?? '',
  }))()`);
  check(oaObject.path === "/oa_object/alice001_obj001", "OA object link opens /oa_object/<id>");
  check(oaObject.art === 4, `Alice object page shows 4 art panels (got ${oaObject.art})`);
  check(
    oaObject.bodyLength >= 10,
    `OA object page renders its own text (got ${oaObject.bodyLength} chars)`,
  );
  check(
    oaObject.documents >= 1,
    `OA object page lists attached documents (got ${oaObject.documents})`,
  );
  check(
    oaObject.backCollection === "/oa/alice001",
    `OA object backlink targets its archive (got ${oaObject.backCollection})`,
  );
  check(
    oaObject.archiveLink === "/oa/alice001",
    `OA object summary links its archive (got ${oaObject.archiveLink})`,
  );
  await cdp.screenshot("oa-object.png");
  await cdp.evaluate(`document.querySelector('[data-testid="oa-document-link"]').click()`);
  await cdp.waitFor(
    `location.pathname.startsWith('/oa_document/') &&
     Boolean(document.querySelector('[data-testid="entity-view"][data-entity-type="oa_document"]')) &&
     (document.querySelector('[data-testid="entity-body"]')?.textContent ?? '').trim().length > 20`,
    "OA document detail loads its body",
  );
  const oaDocument = await cdp.evaluate(`(() => ({
    path: location.pathname,
    title: document.querySelector('.detail-head h1')?.textContent ?? '',
    bodyLang: document.querySelector('[data-testid="entity-body"]')?.dataset.lang ?? '',
    bodyLength: (document.querySelector('[data-testid="entity-body"]')?.textContent ?? '').trim().length,
    outgoing: Boolean(document.querySelector('[data-testid="relations-outgoing"]')),
    incoming: Boolean(document.querySelector('[data-testid="relations-incoming"]')),
    backCollection: document.querySelector('[data-testid="back-to-collection"]')?.getAttribute('href') ?? '',
  }))()`);
  check(/^\/oa_document\//.test(oaDocument.path), "OA document URL is /oa_document/<id>");
  check(oaDocument.title.length > 0, "OA document shows a title");
  check(oaDocument.bodyLength > 20, "OA document renders its text body");
  check(oaDocument.bodyLang === "zh-Hans", "OA document body uses the selected language");
  check(
    oaDocument.outgoing && oaDocument.incoming,
    "OA document shows inbound and outbound relation sections",
  );
  check(
    oaDocument.backCollection === "/oa/alice001",
    "OA document links back to its character archive",
  );
  await cdp.screenshot("oa-document.png");
  await cdp.evaluate(`document.querySelector('[data-testid="back-button"]').click()`);
  await cdp.waitFor(
    `location.pathname === '/oa_object/alice001_obj001' &&
     Boolean(document.querySelector('[data-testid="entity-view"][data-entity-type="oa_object"]'))`,
    "back from OA document",
  );
  check(true, "back button returns from an OA document to its object page");
  await cdp.evaluate(`document.querySelector('[data-testid="back-to-collection"]').click()`);
  await cdp.waitFor(
    `location.pathname === '/oa/alice001' && Boolean(document.querySelector('[data-testid="oa-workspace"]'))`,
    "object backlink returns to the character archive",
  );
  check(true, "OA object page links back to its character archive");
  await cdp.navigate(`${appBase}/oa/paff001`);
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="oa-description-group"]').length === 4 &&
     document.querySelectorAll('[data-testid="oa-description-variant"]').length === 12`,
    "PAFF OA groups its description variants",
  );
  const oaVariants = await cdp.evaluate(`(() => {
    const group = document.querySelector('[data-testid="oa-description-group"]');
    const variants = [...group.querySelectorAll('[data-testid="oa-description-variant"]')];
    return {
      stages: variants.map((el) => el.dataset.stage ?? ''),
      labels: variants.map(
        (el) => el.querySelector('[data-testid="oa-description-link"]')?.textContent?.trim() ?? '',
      ),
      appears: variants.map(
        (el) => el.querySelector('[data-testid="oa-description-appears"]')?.textContent?.trim() ?? '',
      ),
      hidden: variants.map((el) => Boolean(el.querySelector('[data-testid="oa-description-hidden"]'))),
    };
  })()`);
  check(
    oaVariants.stages.join(",") === "level,os,ending",
    `PAFF description variants are ordered by stage (got ${oaVariants.stages.join(",")})`,
  );
  check(
    oaVariants.hidden.join(",") === "true,true,false",
    `only the ending variant survives the ending swap (got ${oaVariants.hidden.join(",")})`,
  );
  check(
    oaVariants.appears[0].includes("Lv 79"),
    `PAFF base variant states its level gate (got ${oaVariants.appears[0]})`,
  );
  check(
    oaVariants.labels[1].includes("pos078"),
    `PAFF middle variant explains its OS read gate (got ${oaVariants.labels[1]})`,
  );
  check(
    oaVariants.labels[2].includes("4.0"),
    `PAFF ending variant explains its story gate (got ${oaVariants.labels[2]})`,
  );
  await cdp.screenshot("oa-description-variants.png");
  await cdp.evaluate(
    `document.querySelectorAll('[data-testid="oa-description-group"]')[0].querySelectorAll('[data-testid="oa-description-variant"]')[2].querySelector('[data-testid="oa-description-link"]').click()`,
  );
  await cdp.waitFor(
    `location.pathname === '/oa_description/paff001_desc001_alt002' &&
     Boolean(document.querySelector('[data-testid="entity-view"][data-entity-type="oa_description"]')) &&
     Boolean(document.querySelector('[data-testid="oa-description-stage"]'))`,
    "OA description detail loads its stage",
  );
  const oaDescription = await cdp.evaluate(`(() => ({
    path: location.pathname,
    stage: document.querySelector('[data-testid="oa-description-stage"]')?.textContent?.trim() ?? '',
    appears: document.querySelector('[data-testid="oa-description-appears"]')?.textContent?.trim() ?? '',
    hidden: Boolean(document.querySelector('[data-testid="oa-description-hidden"]')),
    group: document.querySelector('[data-testid="oa-description-detail"] .facts')?.textContent?.includes('paff001_desc001') ?? false,
  }))()`);
  check(
    oaDescription.path === "/oa_description/paff001_desc001_alt002",
    `OA description variant keeps its own URL (got ${oaDescription.path})`,
  );
  check(
    oaDescription.stage.includes("4.0"),
    `OA description page names its stage (got ${oaDescription.stage})`,
  );
  check(
    oaDescription.appears.includes("4.0"),
    `OA description page explains its appearance (got ${oaDescription.appears})`,
  );
  check(
    oaDescription.hidden === false,
    "the ending variant is never hidden by the ending swap",
  );
  check(oaDescription.group, "OA description page keeps its hotspot group id");
  await cdp.evaluate(`document.querySelector('[data-testid="back-button"]').click()`);
  await cdp.waitFor(
    `location.pathname === '/oa/paff001' &&
     Boolean(document.querySelector('[data-testid="oa-workspace"]'))`,
    "back from OA description",
  );
  check(true, "back button returns from an OA description to its archive");

  // ------------------------------------------------------- Backup Database
  await cdp.navigate(`${appBase}/backup`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="backup-index"]'))`,
    "Backup index loads",
  );
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="backup-folder-card"] img.collection-logo').length === 25`,
    "Backup folder logos load",
  );
  const backupIndex = await cdp.evaluate(`(() => ({
    folders: document.querySelectorAll('[data-testid="backup-folder-card"]').length,
    logos: document.querySelectorAll('[data-testid="backup-folder-card"] img.collection-logo').length,
    mainLogo: document.querySelector('[data-testid="backup-folder-card"][data-folder-id="gallery_folder/misc"] img.collection-logo')?.getAttribute('src') ?? '',
    stats: document.querySelector('[data-testid="backup-stats"]')?.textContent ?? '',
    firstHref: document.querySelector('[data-testid="backup-folder-card"]')?.getAttribute('href'),
  }))()`);
  check(backupIndex.folders === 25, `Backup index lists 25 folders (got ${backupIndex.folders})`);
  check(backupIndex.logos === 25, `Backup index shows 25 folder logos (got ${backupIndex.logos})`);
  check(
    backupIndex.mainLogo.endsWith("/media/gallery-icons/gallery.png"),
    `Main_Folder uses its own logo (got ${backupIndex.mainLogo})`,
  );
  check(
    backupIndex.stats.includes(formatUnit(zhHans, "entries", 84)),
    "Backup index counts 84 media entries",
  );
  check(backupIndex.firstHref === "/backup/alice001", "Backup index links a folder");
  await cdp.evaluate(`document.querySelector('[data-testid="backup-folder-card"]').click()`);
  await cdp.waitFor(
    `location.pathname === '/backup/alice001' && Boolean(document.querySelector('[data-testid="backup-folder"]'))`,
    "Backup folder opens",
  );
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="backup-folder"] img.backup-folder-logo'))`,
    "Backup folder header logo loads",
  );
  const backupFolder = await cdp.evaluate(`(() => ({
    items: document.querySelectorAll('[data-testid="backup-item-card"]').length,
    logo: document.querySelector('[data-testid="backup-folder"] img.backup-folder-logo')?.getAttribute('src') ?? '',
    firstHref: document.querySelector('[data-testid="backup-item-card"]')?.getAttribute('href'),
    kinds: [...new Set([...document.querySelectorAll('[data-testid="backup-item-card"]')].map(card => card.dataset.kind))].sort(),
  }))()`);
  check(backupFolder.items === 3, `Backup folder shows its 3 entries (got ${backupFolder.items})`);
  check(
    backupFolder.logo.endsWith("/media/gallery-icons/alice001.png"),
    `Backup folder header uses the folder logo (got ${backupFolder.logo})`,
  );
  check(
    backupFolder.firstHref?.startsWith("/gallery_item/") === true,
    "Backup folder links gallery items",
  );
  check(
    JSON.stringify(backupFolder.kinds) === JSON.stringify(["boss_stage", "video"]),
    "Backup folder covers video and boss-stage entries",
  );
  await cdp.evaluate(`document.querySelector('[data-testid="backup-item-card"]').click()`);
  await cdp.waitFor(
    `location.pathname.startsWith('/gallery_item/') &&
     Boolean(document.querySelector('[data-testid="gallery-item-detail"]'))`,
    "Gallery item detail loads",
  );
  const galleryItem = await cdp.evaluate(`(() => ({
    path: location.pathname,
    kind: document.querySelector('[data-testid="gallery-item-detail"] .media-kind')?.textContent ?? '',
    conditionHref: document.querySelector('[data-testid="condition-link"]')?.getAttribute('href') ?? '',
    folderHref: [...document.querySelectorAll('[data-testid="gallery-item-detail"] a')].map(a => a.getAttribute('href')).find(href => href?.startsWith('/gallery_folder/')) ?? '',
    backCollection: document.querySelector('[data-testid="back-to-collection"]')?.getAttribute('href') ?? '',
  }))()`);
  check(
    galleryItem.kind === translate("zh-Hans", "mediaKind.boss_stage"),
    "Gallery item shows its media kind",
  );
  check(galleryItem.conditionHref === "/os/alos023", "Gallery item links its unlock condition");
  check(
    galleryItem.folderHref === "/gallery_folder/alice001",
    "Gallery item links its folder",
  );
  check(galleryItem.backCollection === "/backup", "Gallery item links back to Backup Database");
  await cdp.screenshot("gallery-item.png");
  await cdp.evaluate(`document.querySelector('[data-testid="back-button"]').click()`);
  await cdp.waitFor(
    `location.pathname === '/backup/alice001' && Boolean(document.querySelector('[data-testid="backup-folder"]'))`,
    "back from gallery item",
  );
  check(true, "back button returns from a gallery item to its folder");

  await cdp.navigate(`${appBase}/gallery_item/neko001/neko001_004`);
  await cdp.waitFor(
    `Boolean(document.querySelector('img.gallery-image'))`,
    "portrait gallery item loads",
  );
  await cdp.waitFor(
    `(() => {
      const img = document.querySelector('img.gallery-image');
      return Boolean(img && img.complete && img.naturalWidth > 0);
    })()`,
    "portrait gallery image decodes",
  );
  const galleryImage = await cdp.evaluate(`(() => {
    const img = document.querySelector('img.gallery-image');
    return {
      src: img.getAttribute('src'),
      stretched: img.classList.contains('media-stretched'),
      natural: img.naturalWidth / img.naturalHeight,
      rendered: img.clientWidth / img.clientHeight,
    };
  })()`);
  check(
    galleryImage.src.endsWith("/media/covers/neko001_004.png"),
    `gallery image resolves to its cover asset (got ${galleryImage.src})`,
  );
  check(!galleryImage.stretched, "gallery image is not forced into the inline frame");
  check(
    Math.abs(galleryImage.rendered - galleryImage.natural) < 0.01,
    `gallery image keeps its natural aspect (natural ${galleryImage.natural.toFixed(3)}, rendered ${galleryImage.rendered.toFixed(3)})`,
  );

  // ----------------------------------- Backup Database video item (#29)
  await cdp.navigate(`${appBase}/gallery_item/ai001/aios1701`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="gallery-video"] video[data-testid="video-player"]'))`,
    "gallery video player loads",
  );
  const galleryVideo = await cdp.evaluate(`(() => {
    const section = document.querySelector('[data-testid="gallery-video"]');
    const video = section.querySelector('video[data-testid="video-player"]');
    const track = section.querySelector('[data-testid="video-track"]');
    const facts = [...document.querySelectorAll('[data-testid="gallery-item-detail"] .fact')];
    return {
      clip: video.dataset.clip,
      src: new URL(video.getAttribute('src'), location.href).pathname,
      controls: video.controls,
      autoplay: video.autoplay,
      paused: video.paused,
      trackLang: track?.srclang ?? null,
      trackSrc: track ? new URL(track.getAttribute('src'), location.href).pathname : null,
      caption: section.querySelector('figcaption')?.textContent ?? '',
      kind: document.querySelector('[data-testid="gallery-item-detail"] .media-kind')?.textContent ?? '',
      conditionHref: document.querySelector('[data-testid="condition-link"]')?.getAttribute('href') ?? '',
      labels: facts.map(fact => fact.querySelector('dt')?.textContent ?? ''),
      values: facts.map(fact => fact.querySelector('dd')?.textContent?.trim() ?? ''),
    };
  })()`);
  check(
    galleryVideo.clip === "aios1701",
    `gallery video exposes its clip id (got ${galleryVideo.clip})`,
  );
  check(
    galleryVideo.src.endsWith("/media/videos/aios1701.mp4"),
    `gallery video resolves through the media manifest (got ${galleryVideo.src})`,
  );
  check(
    galleryVideo.trackLang === "zh-Hans",
    `gallery video track follows the sidebar language (got ${galleryVideo.trackLang})`,
  );
  check(
    galleryVideo.trackSrc?.endsWith("/media/subs/aios1701.zh-Hans.vtt") === true,
    `gallery video track points at the zh-Hans VTT (got ${galleryVideo.trackSrc})`,
  );
  const galleryCues = await cdp.waitFor(
    `(() => {
      const track = document.querySelector('[data-testid="gallery-video"] [data-testid="video-track"]');
      return track && track.readyState === 2 && track.track?.cues ? track.track.cues.length : 0;
    })()`,
    "gallery subtitle cues load",
  );
  check(
    galleryCues === 17,
    `gallery video subtitles expose 17 cues (got ${galleryCues})`,
  );
  check(galleryVideo.controls === true, "gallery video shows native controls");
  check(galleryVideo.autoplay === false, "gallery video never autoplays");
  check(galleryVideo.paused === true, "gallery video starts paused");
  check(
    galleryVideo.caption === "Video_???_06_30",
    `gallery video is captioned with the entry name (got ${galleryVideo.caption})`,
  );
  check(
    galleryVideo.kind === translate("zh-Hans", "mediaKind.video"),
    `gallery video keeps its kind fact (got ${galleryVideo.kind})`,
  );
  check(
    galleryVideo.conditionHref === "/os/aios017",
    `gallery video keeps its unlock-condition link (got ${galleryVideo.conditionHref})`,
  );
  check(
    galleryVideo.labels.includes(translate("zh-Hans", "fact.location")) &&
      galleryVideo.values.includes("aios1701"),
    `gallery video keeps its location fact (got ${galleryVideo.labels.join(",")})`,
  );
  check(
    galleryVideo.labels.length === 7,
    `gallery video keeps every metadata fact (got ${galleryVideo.labels.length})`,
  );

  // #29 negative path: every gallery video is exported today, so delete one.
  const galleryStub = await cdp.call("Page.addScriptToEvaluateOnNewDocument", {
    source: manifestStub({
      movies: ["aios1701"],
      videos: ["aios1701"],
      subtitles: ["aios1701"],
    }),
  });
  await cdp.navigate(`${appBase}/gallery_item/ai001/aios1701`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="video-missing"]'))`,
    "gallery missing-video note renders",
  );
  const galleryMissing = await cdp.evaluate(`(() => {
    const note = document.querySelector('[data-testid="gallery-video"] [data-testid="video-missing"]');
    return {
      clip: note?.dataset.clip ?? null,
      text: note?.textContent ?? '',
      players: document.querySelectorAll('[data-testid="gallery-video"] video').length,
      conditionHref: document.querySelector('[data-testid="condition-link"]')?.getAttribute('href') ?? '',
    };
  })()`);
  check(
    galleryMissing.clip === "aios1701",
    `gallery missing-video note names the clip (got ${galleryMissing.clip})`,
  );
  check(
    galleryMissing.players === 0,
    `gallery video without an export renders no <video> element (got ${galleryMissing.players})`,
  );
  check(
    galleryMissing.text.trim().length > 0,
    "gallery missing-video note has copy",
  );
  check(
    galleryMissing.conditionHref === "/os/aios017",
    `gallery missing-video note keeps the unlock condition visible (got ${galleryMissing.conditionHref})`,
  );
  await cdp.call("Page.removeScriptToEvaluateOnNewDocument", {
    identifier: galleryStub.identifier,
  });
  await cdp.navigate(`${appBase}/gallery_item/ai001/aios1701`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="gallery-video"] video[data-testid="video-player"]'))`,
    "gallery video player returns without the stub",
  );
  check(true, "removing the gallery manifest stub restores the player");
  await cdp.screenshot("gallery-video.png");

  // -------------------------------- OS log -> Backup videos index (#31)
  await cdp.navigate(`${appBase}/os/aios017`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="os-related-videos"]'))`,
    "OS related-videos section loads",
  );
  const osRelated = await cdp.evaluate(`(() => {
    const section = document.querySelector('[data-testid="os-related-videos"]');
    const rows = [...section.querySelectorAll('[data-testid="os-related-video"]')];
    return {
      heading: section.querySelector('h2')?.textContent?.trim() ?? '',
      count: rows.length,
      ids: rows.map(row => row.dataset.entityId),
      hrefs: rows.map(row => row.getAttribute('href')),
    };
  })()`);
  check(osRelated.heading.length > 0, "OS related-videos section has a heading");
  check(
    osRelated.count === 1,
    `OS log lists exactly one related Backup video (got ${osRelated.count})`,
  );
  check(
    osRelated.ids[0] === "gallery_item/ai001/aios1701",
    `related row points at the gallery item (got ${osRelated.ids[0]})`,
  );
  check(
    osRelated.hrefs[0] === "/gallery_item/ai001/aios1701",
    `related row links to the Backup Database item (got ${osRelated.hrefs[0]})`,
  );
  await cdp.evaluate(
    `document.querySelector('[data-testid="os-related-video"]').click()`,
  );
  await cdp.waitFor(
    `location.pathname === '/gallery_item/ai001/aios1701' && Boolean(document.querySelector('[data-testid="gallery-video"] video[data-testid="video-player"]'))`,
    "related row opens the Backup Database video",
  );
  const relatedSrc = await cdp.evaluate(
    `new URL(document.querySelector('[data-testid="gallery-video"] video[data-testid="video-player"]').getAttribute('src'), location.href).pathname`,
  );
  check(
    relatedSrc.endsWith("/media/videos/aios1701.mp4"),
    `shared player plays the related clip (got ${relatedSrc})`,
  );
  await cdp.navigate(`${appBase}/os/alos025`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="entity-view"]'))`,
    "alos025 entity view loads for the related-video check",
  );
  check(
    (await cdp.evaluate(
      `document.querySelectorAll('[data-testid="os-related-videos"]').length`,
    )) === 0,
    "OS log without a related video renders no related-videos section",
  );
  await cdp.navigate(`${appBase}/os/chos031`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="os-related-videos"]'))`,
    "chos031 related-videos section loads",
  );
  const chosRelated = await cdp.evaluate(`(() => ({
    ids: [...document.querySelectorAll('[data-testid="os-related-video"]')].map(row => row.dataset.entityId),
    cutscene: Boolean(document.querySelector('[data-testid="os-cutscene"]')),
  }))()`);
  check(
    chosRelated.ids.length === 1 &&
      chosRelated.ids[0] === "gallery_item/cherry001/chos3101",
    `second anchor resolves its own video (got ${chosRelated.ids.join(", ")})`,
  );
  check(
    chosRelated.cutscene === true,
    "OS log with both sections keeps its cutscene",
  );
  await cdp.evaluate(
    `document.querySelector('[data-testid="os-related-videos"]').scrollIntoView({ block: 'center' })`,
  );
  await sleep(250);
  await cdp.screenshot("os-related-videos.png");
  // ------------------------------ end #31 OS log -> Backup videos index

  // ------------------------------------------------------------- story nodes
  await cdp.navigate(`${appBase}/story`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="story-feed"]'))`,
    "story index loads",
  );
  const storyIndex = await cdp.evaluate(`(() => ({
    cards: document.querySelectorAll('[data-testid="story-node-card"]').length,
    kinds: [...new Set([...document.querySelectorAll('[data-testid="story-node-card"]')].map(card => card.dataset.kind))].sort(),
  }))()`);
  check(
    storyIndex.cards === 90,
    `default story sequence hides the test01 staging node (got ${storyIndex.cards})`,
  );
  check(
    JSON.stringify(storyIndex.kinds) === JSON.stringify(["branch", "event"]),
    "story index contains events and Branching OS nodes",
  );
  await cdp.evaluate(`document.querySelector('[data-testid="story-sort-version"]').click()`);
  const versionNote = translate("zh-Hans", "story.sortMeta", {
    meta: "4",
    total: "91",
    sort: translate("zh-Hans", "story.sort.version"),
  });
  await cdp.waitFor(
    `(document.querySelector('[data-testid="story-sort-note"]')?.textContent ?? '').includes(${JSON.stringify(versionNote)})`,
    "version sort notes annotated nodes",
  );
  check(true, "version sort explains its reading-order fallback");
  await cdp.evaluate(`document.querySelector('[data-testid="story-kind-branch"]').click()`);
  await cdp.waitFor(
    `(() => {
      const cards = [...document.querySelectorAll('[data-testid="story-node-card"]')];
      return cards.length === 48 && cards.every(card => card.dataset.kind === 'branch');
    })()`,
    "Branching OS filter",
  );
  check(true, "kind filter shows the 48 Branching OS nodes");
  await cdp.evaluate(
    `document.querySelector('[data-testid="story-node-card"][data-kind="branch"]').click()`,
  );
  await cdp.waitFor(
    `location.pathname.startsWith('/story_node/') &&
     Boolean(document.querySelector('[data-testid="story-branch-detail"]')) &&
     Boolean(document.querySelector('[data-testid="entity-body"]'))`,
    "Branching OS node detail loads",
  );
  const storyNode = await cdp.evaluate(`(() => ({
    path: location.pathname,
    kind: document.querySelector('.story-kind')?.textContent ?? '',
    bodyLength: (document.querySelector('[data-testid="entity-body"]')?.textContent ?? '').trim().length,
    nextLinks: document.querySelectorAll('[data-testid="story-next"] [data-entity-id]').length,
  }))()`);
  check(/^\/story_node\//.test(storyNode.path), "story node URL is /story_node/<id>");
  check(storyNode.kind === "Branching OS", "story node is labelled Branching OS");
  check(storyNode.bodyLength > 20, "Branching OS node renders its text body");
  check(storyNode.nextLinks > 0, "Branching OS node links its next node");
  await cdp.screenshot("story-node.png");
  await cdp.evaluate(`document.querySelector('[data-testid="back-to-collection"]').click()`);
  await cdp.waitFor(
    `location.pathname === '/story' && Boolean(document.querySelector('[data-testid="story-feed"]'))`,
    "back from story node",
  );
  check(true, "story node returns to the story index");

  // ------------------------------------ story node movies (#30)
  // ticket/30-story-movies: players for movie_files, chips stay as fallback.
  await cdp.navigate(`${appBase}/story_node/story_ending03_main`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="story-movies"] video[data-testid="video-player"]'))`,
    "story node movie player loads",
  );
  const storyMovie = await cdp.evaluate(`(() => {
    const section = document.querySelector('[data-testid="story-movies"]');
    const rows = [...section.querySelectorAll('[data-testid="story-movie"]')];
    const first = rows[0];
    const video = first?.querySelector('video[data-testid="video-player"]');
    const track = first?.querySelector('[data-testid="video-track"]');
    return {
      heading: section.querySelector('h2')?.textContent ?? '',
      rows: rows.length,
      clip: first?.dataset.clip ?? null,
      videoClip: video?.dataset.clip ?? null,
      src: video ? new URL(video.getAttribute('src'), location.href).pathname : '',
      controls: video?.controls ?? null,
      autoplay: video?.autoplay ?? null,
      paused: video?.paused ?? null,
      trackLang: track?.srclang ?? null,
      trackSrc: track ? new URL(track.getAttribute('src'), location.href).pathname : null,
      chips: [...document.querySelectorAll('[data-testid="story-event-detail"] .code-chip')]
        .map((chip) => chip.textContent),
    };
  })()`);
  check(
    storyMovie.rows === 1,
    `story_ending03_main renders one movie row (got ${storyMovie.rows})`,
  );
  check(
    storyMovie.heading.trim().length > 0,
    "story movies section has a heading",
  );
  check(
    storyMovie.clip === "IvyDieCutscene",
    `story movie row strips the .mp4 suffix for the clip id (got ${storyMovie.clip})`,
  );
  check(
    storyMovie.videoClip === "IvyDieCutscene",
    `story movie player exposes its clip id (got ${storyMovie.videoClip})`,
  );
  check(
    storyMovie.src.endsWith("/media/videos/IvyDieCutscene.mp4"),
    `story movie resolves through the media manifest (got ${storyMovie.src})`,
  );
  check(storyMovie.controls === true, "story movie player shows native controls");
  check(storyMovie.autoplay === false, "story movie player never autoplays");
  check(storyMovie.paused === true, "story movie player starts paused");
  check(
    storyMovie.trackLang === "zh-Hans",
    `story movie track follows the sidebar language (got ${storyMovie.trackLang})`,
  );
  check(
    storyMovie.trackSrc.endsWith("/media/subs/IvyDieCutscene.zh-Hans.vtt"),
    `story movie track points at the zh-Hans VTT (got ${storyMovie.trackSrc})`,
  );
  check(
    storyMovie.chips.includes("IvyDieCutscene.mp4"),
    "textual movie chips remain as the export fallback",
  );

  await cdp.navigate(`${appBase}/story_node/story04`);
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="story-movies"] [data-testid="story-movie"]').length === 2 &&
     document.querySelectorAll('[data-testid="story-movies"] video[data-testid="video-player"]').length === 2`,
    "story04 renders both movie players",
  );
  const storyMulti = await cdp.evaluate(`(() => {
    const rows = [...document.querySelectorAll('[data-testid="story-movie"]')];
    return {
      clips: rows.map((row) => row.dataset.clip),
      srcs: rows.map((row) => {
        const video = row.querySelector('video[data-testid="video-player"]');
        return video ? new URL(video.getAttribute('src'), location.href).pathname : null;
      }),
      tracks: rows.map((row) => row.querySelectorAll('[data-testid="video-track"]').length),
      trackLangs: rows.map((row) => row.querySelector('[data-testid="video-track"]')?.srclang ?? null),
      chips: [...document.querySelectorAll('[data-testid="story-event-detail"] .code-chip')]
        .map((chip) => chip.textContent),
    };
  })()`);
  check(
    JSON.stringify(storyMulti.clips) === JSON.stringify(["story04_1", "story04_2"]),
    `story04 lists both clips in movie_files order (got ${storyMulti.clips.join(",")})`,
  );
  check(
    storyMulti.srcs.every((src) => src?.endsWith(".mp4") === true) === true,
    "both story04 clips resolve through the media manifest",
  );
  check(
    storyMulti.tracks[0] === 0,
    "story04_1 renders no track (no stem-pairing fallback to story04_2 subtitles)",
  );
  check(
    storyMulti.tracks[1] === 1 && storyMulti.trackLangs[1] === "zh-Hans",
    `story04_2 renders exactly its own zh-Hans track (got ${storyMulti.tracks[1]}:${storyMulti.trackLangs[1]})`,
  );
  check(
    storyMulti.chips.includes("story04_1.mp4") &&
      storyMulti.chips.includes("story04_2.mp4"),
    "story04 keeps both textual movie chips",
  );

  await cdp.navigate(`${appBase}/story_node/story01`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="story-event-detail"]'))`,
    "story01 event detail loads",
  );
  check(
    (await cdp.evaluate(
      `document.querySelectorAll('[data-testid="story-movies"]').length`,
    )) === 0,
    "story node without movies renders no story-movies section",
  );

  // #30 negative path: drop the second story04 clip but keep its subtitle group,
  // so the missing-media note (not a subtitle note) must win.
  const storyStub = await cdp.call("Page.addScriptToEvaluateOnNewDocument", {
    source: manifestStub({
      movies: ["story04_2"],
      videos: ["story04_2"],
    }),
  });
  await cdp.navigate(`${appBase}/story_node/story04`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="story-movies"] [data-testid="video-missing"][data-clip="story04_2"]'))`,
    "missing story movie note renders",
  );
  const missingStoryMovie = await cdp.evaluate(`(() => {
    const rows = [...document.querySelectorAll('[data-testid="story-movie"]')];
    const row = rows.find((entry) => entry.dataset.clip === 'story04_2');
    const note = row?.querySelector('[data-testid="video-missing"]');
    return {
      rows: rows.length,
      noteClip: note?.dataset.clip ?? null,
      noteReason: note?.dataset.reason ?? null,
      noteText: note?.textContent ?? '',
      rowVideos: row?.querySelectorAll('video[data-testid="video-player"]').length ?? -1,
      otherVideos: rows
        .filter((entry) => entry.dataset.clip !== 'story04_2')
        .reduce((total, entry) => total + entry.querySelectorAll('video').length, 0),
      chips: [...document.querySelectorAll('[data-testid="story-event-detail"] .code-chip')]
        .map((chip) => chip.textContent),
    };
  })()`);
  check(missingStoryMovie.rows === 2, "missing export keeps both story movie rows");
  check(
    missingStoryMovie.noteClip === "story04_2" &&
      missingStoryMovie.noteReason === "missing",
    `missing story clip renders the export note (got ${missingStoryMovie.noteReason})`,
  );
  check(
    missingStoryMovie.noteText.trim().length > 0,
    "missing story clip note has copy",
  );
  check(
    missingStoryMovie.rowVideos === 0,
    "missing story clip renders no <video> element",
  );
  check(
    missingStoryMovie.otherVideos === 1,
    "the exported story04_1 clip still plays next to the missing one",
  );
  check(
    missingStoryMovie.chips.includes("story04_2.mp4"),
    "textual chips still name the clip that has no export",
  );
  await cdp.call("Page.removeScriptToEvaluateOnNewDocument", {
    identifier: storyStub.identifier,
  });
  await cdp.navigate(`${appBase}/story_node/story04`);
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="story-movies"] video[data-testid="video-player"]').length === 2`,
    "story04 players return without the stub",
  );
  check(true, "removing the manifest stub restores both story movie players");

  await cdp.navigate(`${appBase}/story_node/story_ending03_main`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="story-movies"] video[data-testid="video-player"]'))`,
    "story movie player ready for screenshot",
  );
  await cdp.screenshot("story-movies.png");
  // ---------------------------------- end story node movies (#30)

  // ------------------------------------------------------------------- shop
  await cdp.navigate(`${appBase}/shop`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="shop-stats"]'))`,
    "shop index loads",
  );
  const shopIndex = await cdp.evaluate(`(() => ({
    packs: document.querySelectorAll('[data-testid="capso-pack-card"]').length,
    gacha: document.querySelectorAll('[data-testid="gacha-card"]').length,
    bundles: document.querySelectorAll('[data-testid="bundle-card"]').length,
    blackMarket: document.querySelectorAll('[data-testid="black-market-badge"]').length,
    blackCard: document.querySelector('[data-testid="bundle-card"][data-black-market="true"] .collection-title')?.textContent ?? '',
    firstPackHref: document.querySelector('[data-testid="capso-pack-card"]')?.getAttribute('href'),
  }))()`);
  check(shopIndex.packs === 13, `shop lists 13 CAPSO packs (got ${shopIndex.packs})`);
  check(shopIndex.gacha === 1, "shop lists the gacha machine");
  check(shopIndex.bundles === 2, "shop lists two IAP bundles");
  check(shopIndex.blackMarket === 1, "shop marks exactly one bundle as Black Market");
  check(shopIndex.blackCard === "VOL2", "Black Market badge belongs to VOL2");
  check(
    shopIndex.firstPackHref?.startsWith("/capso_shop_pack/") === true,
    "shop links a CAPSO pack",
  );
  await cdp.evaluate(`document.querySelector('[data-testid="capso-pack-card"]').click()`);
  await cdp.waitFor(
    `location.pathname.startsWith('/capso_shop_pack/') &&
     Boolean(document.querySelector('[data-testid="capso-pack-detail"]'))`,
    "CAPSO pack detail loads",
  );
  const capsoPack = await cdp.evaluate(`(() => ({
    title: document.querySelector('.detail-head h1')?.textContent ?? '',
    items: document.querySelectorAll('[data-testid="capso-item-link"]').length,
    facts: [...document.querySelectorAll('[data-testid="capso-pack-detail"] .fact')].map(fact => fact.textContent),
  }))()`);
  check(capsoPack.title.trim().length > 0, "CAPSO pack shows its name");
  check(capsoPack.items === 4, `CAPSO pack lists its 4 items (got ${capsoPack.items})`);
  check(
    capsoPack.facts.some((fact) =>
      fact.includes(translate("zh-Hans", "fact.capsoPrice")),
    ),
    "CAPSO pack shows its CAPSO price",
  );
  await cdp.screenshot("capso-pack.png");
  await cdp.navigate(`${appBase}/shop_bundle/VOL2`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="shop-bundle-detail"]'))`,
    "Black Market bundle loads",
  );
  const bundle = await cdp.evaluate(`(() => ({
    badge: document.querySelector('[data-testid="black-market-badge"]')?.textContent ?? '',
    items: document.querySelectorAll('[data-testid="shop-bundle-items"] [data-entity-id]').length,
    tiers: document.querySelectorAll('[data-testid="shop-bundle-tiers"] tbody tr').length,
  }))()`);
  check(
    bundle.badge === translate("zh-Hans", "value.blackMarket"),
    "VOL2 detail shows the Black Market badge",
  );
  check(bundle.items > 0, "bundle detail links its character items");
  check(bundle.tiers === 20, `bundle detail lists its 20 IAP tiers (got ${bundle.tiers})`);

  // ---------------------------------------------------------------- extras
  await cdp.navigate(`${appBase}/extras`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="extras-index"]'))`,
    "extras hub loads",
  );
  const extrasIndex = await cdp.evaluate(`(() => ({
    cards: document.querySelectorAll('[data-testid="extras-index"] .collection-card').length,
    assistantsHref: document.querySelector('[data-testid="extras-assistants-card"]')?.getAttribute('href'),
    titlesHref: document.querySelector('[data-testid="extras-titles-card"]')?.getAttribute('href'),
    songSelectHref: document.querySelector('[data-testid="extras-songselect-card"]')?.getAttribute('href'),
    cutscenesHref: document.querySelector('[data-testid="extras-cutscenes-card"]')?.getAttribute('href'),
    stats: document.querySelector('[data-testid="extras-stats"]')?.textContent ?? '',
  }))()`);
  check(extrasIndex.cards === 4, `extras hub links all four appendix families (got ${extrasIndex.cards})`);
  check(
    extrasIndex.assistantsHref === "/extras/assistants",
    "extras hub links the assistant dialogues",
  );
  check(
    extrasIndex.titlesHref === "/extras/titles",
    "extras hub links the title screens",
  );
  check(
    extrasIndex.songSelectHref === "/extras/songselect",
    "extras hub links the song-select media",
  );
  check(
    extrasIndex.cutscenesHref === "/extras/cutscenes",
    "extras hub links the cutscene subtitle library",
  );
  check(
    extrasIndex.stats.includes(formatUnit(zhHans, "groups", 19)) &&
      extrasIndex.stats.includes(formatUnit(zhHans, "titles", 10)),
    "extras hub reports the canonical assistant and title counts",
  );
  await cdp.screenshot("extras-hub.png");

  await cdp.evaluate(
    `document.querySelector('[data-testid="extras-assistants-card"]').click()`,
  );
  await cdp.waitFor(
    `location.pathname === '/extras/assistants' && Boolean(document.querySelector('[data-testid="assistants-view"]'))`,
    "assistant dialogues route loads",
  );
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="assistant-page"]').length === 30`,
    "assistant pages render",
  );
  const assistants = await cdp.evaluate(`(() => ({
    groups: document.querySelectorAll('[data-testid="assistant-group"]').length,
    pages: document.querySelectorAll('[data-testid="assistant-page"]').length,
    targets: document.querySelectorAll('[data-testid="assistant-target"]').length,
    bodies: document.querySelectorAll('[data-testid="assistant-group"] [data-testid="entity-body"]').length,
    firstGroup: document.querySelector('[data-testid="assistant-group"]')?.dataset.groupId ?? '',
  }))()`);
  check(assistants.groups === 19, `assistants view lists 19 groups (got ${assistants.groups})`);
  check(assistants.pages === 30, `assistants view renders 30 pages (got ${assistants.pages})`);
  check(assistants.targets > 0, "assistant groups link a resolvable target");
  check(assistants.bodies === 19, "every assistant group loads its text record");
  check(
    assistants.firstGroup === "assistant_dialogue/assistant_tutorial",
    "assistant groups are ordered by progress",
  );
  await cdp.screenshot("extras-assistants.png");
  await cdp.evaluate(SET_LANGUAGE("ja"));
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="assistant-group"] [data-testid="entity-body"][data-lang="ja"]').length === 19`,
    "assistant bodies switch to ja",
  );
  check(true, "assistant dialogues follow the language switch");
  await cdp.evaluate(SET_LANGUAGE("zh-Hans"));
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="assistant-group"] [data-testid="entity-body"][data-lang="zh-Hans"]').length === 19`,
    "assistant bodies switch back to zh-Hans",
  );
  await cdp.evaluate(`document.querySelector('[data-testid="nav-extras"]').click()`);
  await cdp.waitFor(
    `location.pathname === '/extras' && Boolean(document.querySelector('[data-testid="extras-index"]'))`,
    "extras nav returns to the hub",
  );

  await cdp.evaluate(
    `document.querySelector('[data-testid="extras-titles-card"]').click()`,
  );
  await cdp.waitFor(
    `location.pathname === '/extras/titles' && Boolean(document.querySelector('[data-testid="titles-view"]'))`,
    "title screens route loads",
  );
  await cdp.waitFor(
    `(() => {
      const videos = [...document.querySelectorAll('[data-testid="title-video"]')];
      const missing = document.querySelectorAll('[data-testid="title-video-missing"]').length;
      if (videos.length + missing !== 13) return false;
      if (missing === 13) return true;
      return videos.length === 13 && videos.every((video) => video.readyState >= 1 || Boolean(video.error));
    })()`,
    "title clips settle (metadata or missing-export note)",
  );
  const titles = await cdp.evaluate(`(() => ({
    rows: document.querySelectorAll('[data-testid="title-row"]').length,
    videos: document.querySelectorAll('[data-testid="title-video"]').length,
    missing: document.querySelectorAll('[data-testid="title-video-missing"]').length,
    conditions: document.querySelectorAll('[data-testid="title-condition"]').length,
    firstConditionHref: document.querySelector('[data-testid="title-condition"]')?.getAttribute('href') ?? '',
    firstClip: document.querySelector('[data-testid="title-video"]')?.dataset.clip ?? document.querySelector('[data-testid="title-video-missing"]')?.dataset.clip ?? '',
  }))()`);
  check(titles.rows === 10, `titles view lists 10 titles (got ${titles.rows})`);
  check(
    titles.videos + titles.missing === 13,
    `titles view accounts for all 13 clips (videos ${titles.videos}, missing ${titles.missing})`,
  );
  check(titles.conditions === 9, `titles view links 9 story unlocks (got ${titles.conditions})`);
  check(
    titles.firstConditionHref.startsWith("/story_node/"),
    "title unlock conditions link their story node",
  );
  check(titles.firstClip === "title01", "first title plays its title01 clip");
  await cdp.waitFor(
    `[...document.querySelectorAll('[data-testid="title-name"] [data-testid="entity-body"]')].length === 10`,
    "title names load from the text store",
  );
  const titleNames = await cdp.evaluate(
    `[...document.querySelectorAll('[data-testid="title-name"]')].map((el) => el.textContent.trim()).filter(Boolean).length`,
  );
  check(
    titleNames === 10,
    `titles render names through text_ref (got ${titleNames})`,
  );
  await cdp.screenshot("extras-titles.png");

  // ------------------------------------------- song-select media (manifest)
  await cdp.navigate(`${appBase}/extras/songselect`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="songselect-view"]')) &&
     document.querySelectorAll('[data-testid="songselect-trueend-card"]').length === 14 &&
     document.querySelectorAll('[data-testid="songselect-normal-card"]').length === 36`,
    "song-select media view loads",
    60000,
  );
  const songSelect = await cdp.evaluate(`(() => ({
    stats: document.querySelector('[data-testid="songselect-stats"]')?.textContent?.trim() ?? '',
    packs: document.querySelectorAll('[data-testid="songselect-pack"]').length,
    normal: document.querySelectorAll('[data-testid="songselect-normal-card"]').length,
    trueEnd: document.querySelectorAll('[data-testid="songselect-trueend-card"]').length,
    firstPack: document.querySelector('[data-testid="songselect-trueend-card"]')?.dataset.pack ?? '',
    firstSrc: document.querySelector('[data-testid="songselect-trueend-player"] video')?.getAttribute('src') ?? '',
    normalSrc: document.querySelector('[data-testid="songselect-normal-player"] video')?.getAttribute('src') ?? '',
    shared: document.querySelector('[data-testid="songselect-shared"]')?.textContent?.trim() ?? '',
    unused: document.querySelector('[data-testid="songselect-unused"]')?.textContent?.trim() ?? '',
    duplicate: document.querySelector('[data-testid="songselect-duplicate"]')?.textContent?.trim() ?? '',
    videos: document.querySelectorAll('[data-testid="songselect-view"] video').length,
    paused: [...document.querySelectorAll('[data-testid="songselect-view"] video')].every((video) => video.paused),
  }))()`);
  check(songSelect.trueEnd === 14, `song-select view lists 14 true-end entries (got ${songSelect.trueEnd})`);
  check(songSelect.normal === 36, `song-select view lists 36 normal backgrounds (got ${songSelect.normal})`);
  check(songSelect.packs === 27, `song-select view groups 27 packs (got ${songSelect.packs})`);
  check(songSelect.firstPack === "paff001", `true-end order starts with PAFF (got ${songSelect.firstPack})`);
  check(
    songSelect.firstSrc.endsWith("/media/videos/paff001.mp4"),
    `true-end clip resolves to its export (got ${songSelect.firstSrc})`,
  );
  check(
    songSelect.normalSrc.includes("/media/videos/songselect/"),
    `normal clip resolves to videos/songselect (got ${songSelect.normalSrc})`,
  );
  check(
    songSelect.shared.includes("miku001_song_select"),
    `Vanessa entry states its shared Miku scene (got ${songSelect.shared})`,
  );
  check(
    songSelect.unused.includes("bobo001") && songSelect.unused.includes("robo001"),
    `unused duplicate note names bobo and robo (got ${songSelect.unused})`,
  );
  check(
    songSelect.duplicate.includes("xenon001_song_select"),
    `normal duplicate note names its twin (got ${songSelect.duplicate})`,
  );
  check(songSelect.videos === 50, `song-select view renders 50 players (got ${songSelect.videos})`);
  check(songSelect.paused, "song-select players never autoplay");
  await cdp.waitFor(
    `[...document.querySelectorAll('[data-testid="songselect-trueend-player"] video')]
       .slice(0, 4)
       .every((video) => video.readyState >= 1 || Boolean(video.error))`,
    "song-select scenes ready for screenshot",
    30000,
  );
  await cdp.screenshot("extras-songselect.png");

  // --------------------------------------- cutscene + subtitle library (#32)
  await cdp.navigate(`${appBase}/extras/cutscenes`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="cutscenes-view"]')) &&
      document.querySelectorAll('[data-testid="cutscene-row"]').length === 55`,
    "cutscene library lists 55 subtitle groups",
    60000,
  );
  const library = await cdp.evaluate(`(() => {
    const rows = [...document.querySelectorAll('[data-testid="cutscene-row"]')];
    const row = (group) => rows.find((item) => item.dataset.group === group);
    const finalBoss = row('FinalBossStage_1');
    const rest = [...document.querySelectorAll('[data-testid="cutscene-rest"]')];
    const groups = rows.map((item) => item.dataset.group);
    return {
      rows: rows.length,
      unique: new Set(groups).size,
      sorted: groups.every((value, index) => index === 0 || groups[index - 1] <= value),
      finalClip: finalBoss?.dataset.clip ?? '',
      finalLangs: (finalBoss?.dataset.languages ?? '').split(',').filter(Boolean).length,
      aiosClip: row('aios1701')?.dataset.clip ?? '',
      aiosLangs: (row('aios1701')?.dataset.languages ?? '').split(',').filter(Boolean).length,
      rest: rest.length,
      restClips: new Set(rest.map((item) => item.dataset.clip)).size,
      restNotes: document.querySelectorAll('[data-testid="cutscene-rest-no-subtitle"]').length,
      stats: document.querySelector('[data-testid="cutscene-stats"]')?.textContent ?? '',
    };
  })()`);
  check(library.rows === 55, `cutscene library lists 55 subtitle groups (got ${library.rows})`);
  check(library.unique === 55, "every subtitle group appears exactly once");
  check(library.sorted, "subtitle groups are sorted by key");
  check(
    library.finalClip === "FinalBossStage",
    `FinalBossStage_1 pairs the shared clip (got ${library.finalClip})`,
  );
  check(
    library.finalLangs === 5,
    `FinalBossStage_1 lists its five languages (got ${library.finalLangs})`,
  );
  check(library.aiosClip === "aios1701", "exact keys pair without the base fallback");
  check(library.aiosLangs === 5, "aios1701 lists its five languages");
  check(library.rest === 62, `rest section lists 62 exported videos (got ${library.rest})`);
  check(library.restClips === 62, "every rest row names its clip");
  check(
    library.restNotes === 62,
    `every rest row explains its missing subtitles (got ${library.restNotes})`,
  );
  check(library.stats.trim().length > 0, "cutscene library reports its counts");

  await cdp.waitFor(
    `(() => {
      const row = document.querySelector('[data-testid="cutscene-row"][data-group="aios1701"]');
      const track = row?.querySelector('[data-testid="video-track"]');
      return track?.srclang === 'zh-Hans' &&
        track.src.endsWith('/media/subs/aios1701.zh-Hans.vtt');
    })()`,
    "aios1701 row attaches the zh-Hans subtitle track",
    60000,
  );
  const subtitledRow = await cdp.evaluate(`(() => {
    const row = document.querySelector('[data-testid="cutscene-row"][data-group="aios1701"]');
    const video = row.querySelector('video[data-testid="video-player"]');
    const track = row.querySelector('[data-testid="video-track"]');
    return {
      clip: video?.dataset.clip ?? '',
      src: video?.getAttribute('src') ?? '',
      autoplay: video?.autoplay,
      paused: video?.paused,
      tracks: row.querySelectorAll('[data-testid="video-track"]').length,
      trackLang: track?.srclang ?? '',
    };
  })()`);
  check(
    subtitledRow.clip === "aios1701",
    `aios1701 row plays its clip (got ${subtitledRow.clip})`,
  );
  check(
    subtitledRow.src.endsWith("/media/videos/aios1701.mp4"),
    `aios1701 row resolves through the media manifest (got ${subtitledRow.src})`,
  );
  check(subtitledRow.tracks === 1, "a subtitled row attaches exactly one track");
  check(
    subtitledRow.autoplay === false && subtitledRow.paused === true,
    "library players never autoplay",
  );
  await cdp.waitFor(
    `document.querySelector('[data-testid="cutscene-row"][data-group="aios1701"] [data-testid="video-track"]')?.track?.cues?.length === 17`,
    "aios1701 zh-Hans track exposes its 17 cues",
    60000,
  );
  await cdp.evaluate(SET_LANGUAGE("ja"));
  await cdp.waitFor(
    `(() => {
      const track = document.querySelector('[data-testid="cutscene-row"][data-group="aios1701"] [data-testid="video-track"]');
      return track?.srclang === 'ja' && track.src.endsWith('/media/subs/aios1701.ja.vtt');
    })()`,
    "library row follows the ja language switch",
  );
  check(true, "cutscene subtitles follow the sidebar language");
  await cdp.evaluate(SET_LANGUAGE("zh-Hans"));
  await cdp.waitFor(
    `document.querySelector('[data-testid="cutscene-row"][data-group="aios1701"] [data-testid="video-track"]')?.srclang === 'zh-Hans'`,
    "library row returns to zh-Hans",
  );

  await cdp.evaluate(SET_LANGUAGE("en"));
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="video-subtitle-missing"][data-lang="en"]').length >= 2`,
    "missing-en notes render for the two groups without an en VTT",
  );
  for (const group of ["naos3001", "opening"]) {
    const missingEn = await cdp.evaluate(`(() => {
      const row = document.querySelector('[data-testid="cutscene-row"][data-group="${group}"]');
      const note = row?.querySelector('[data-testid="video-subtitle-missing"]');
      return {
        lang: note?.dataset.lang ?? '',
        tracks: row?.querySelectorAll('[data-testid="video-track"]').length ?? -1,
        text: note?.textContent ?? '',
      };
    })()`);
    check(missingEn.lang === "en", `group ${group} notes the missing en track`);
    check(missingEn.tracks === 0, `group ${group} attaches no en track`);
    check(missingEn.text.trim().length > 0, `group ${group} missing-track note has copy`);
  }
  await cdp.evaluate(SET_LANGUAGE("zh-Hans"));

  const searchValue = await cdp.evaluate(SET_CUTSCENE_QUERY("Waahhhh"));
  check(searchValue === "Waahhhh", "cutscene search accepts typed text");
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="cutscene-hit"]').length === 1`,
    "subtitle search finds the single Waahhhh cue",
    120000,
  );
  const hit = await cdp.evaluate(`(() => {
    const node = document.querySelector('[data-testid="cutscene-hit"]');
    return {
      group: node?.dataset.group ?? '',
      lang: node?.dataset.lang ?? '',
      time: node?.dataset.time ?? '',
      text: node?.textContent ?? '',
      summary: document.querySelector('[data-testid="cutscene-search-summary"]')?.textContent ?? '',
    };
  })()`);
  check(hit.group === "aios1701", `search hit names its group (got ${hit.group})`);
  check(hit.lang === "en", `search hit names the VTT language (got ${hit.lang})`);
  check(hit.time === "3.7", `search hit names the cue time (got ${hit.time})`);
  check(hit.text.includes("Waahhhh"), "search hit shows the matched line");
  check(hit.summary.trim().length > 0, "search reports a summary");
  await cdp.evaluate(`document.querySelector('[data-testid="cutscene-hit"]').click()`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="cutscene-hit-player"] video[data-testid="video-player"]'))`,
    "clicking a hit opens its player",
  );
  await cdp.waitFor(
    `(() => {
      const video = document.querySelector('[data-testid="cutscene-hit-player"] video[data-testid="video-player"]');
      return video.readyState >= 1 && Math.abs(video.currentTime - 3.7) < 0.5;
    })()`,
    "hit player seeks to the matched cue",
    60000,
  );
  const hitPlayer = await cdp.evaluate(`(() => {
    const figure = document.querySelector('[data-testid="cutscene-hit-player"]');
    const video = figure.querySelector('video[data-testid="video-player"]');
    const track = figure.querySelector('[data-testid="video-track"]');
    return {
      clip: video?.dataset.clip ?? '',
      paused: video?.paused,
      time: video?.currentTime ?? -1,
      trackLang: track?.srclang ?? '',
      trackSrc: track?.src ?? '',
    };
  })()`);
  check(hitPlayer.clip === "aios1701", `hit player plays the paired clip (got ${hitPlayer.clip})`);
  check(hitPlayer.paused === true, "hit player stays paused at the cue");
  check(
    hitPlayer.trackLang === "zh-Hans" &&
      hitPlayer.trackSrc.endsWith("/media/subs/aios1701.zh-Hans.vtt"),
    `hit player attaches the sidebar language track (got ${hitPlayer.trackLang})`,
  );

  // #32 multi-cue search: a line repeated inside one group lists every cue, and
  // each row keeps its own seek time.
  const repeatedValue = await cdp.evaluate(SET_CUTSCENE_QUERY("choice is obvious"));
  check(repeatedValue === "choice is obvious", "cutscene search accepts a repeated line");
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="cutscene-hit"]').length === 2`,
    "subtitle search lists both cues of a repeated line",
    60000,
  );
  const repeated = await cdp.evaluate(
    `[...document.querySelectorAll('[data-testid="cutscene-hit"]')].map((node) => ({
      group: node.dataset.group ?? '',
      lang: node.dataset.lang ?? '',
      time: node.dataset.time ?? '',
      meta: node.querySelector('.cutscene-hit-meta')?.textContent ?? '',
    }))`,
  );
  check(
    repeated.length === 2 &&
      repeated.every((row) => row.group === "taos010_bossstage" && row.lang === "en"),
    `repeated line keeps its group and language (got ${JSON.stringify(repeated)})`,
  );
  check(
    repeated.map((row) => row.time).join(",") === "7.7,16.9",
    `repeated line exposes every cue time (got ${repeated.map((row) => row.time).join(",")})`,
  );
  check(
    repeated[0].meta.includes("0:07.7") && repeated[1].meta.includes("0:16.9"),
    `each cue row formats its own time (got ${repeated.map((row) => row.meta).join(" | ")})`,
  );

  // #32: opening a hit in a silent clip offers the library's muxed picker, with
  // no variant preselected, and the no-audio note until one is chosen.
  await cdp.evaluate(
    `document.querySelectorAll('[data-testid="cutscene-hit"]')[0].click()`,
  );
  await cdp.waitFor(
    `document.querySelector('[data-testid="cutscene-selection"]')?.dataset.time === '7.7' &&
     Boolean(document.querySelector('[data-testid="cutscene-selection"] video[data-testid="video-player"]'))`,
    "opening a repeated cue selects that cue",
    60000,
  );
  const cueAudio = await cdp.evaluate(`(() => {
    const selection = document.querySelector('[data-testid="cutscene-selection"]');
    const video = selection.querySelector('video[data-testid="video-player"]');
    const picker = selection.querySelector('[data-testid="cutscene-audio"]');
    return {
      group: selection.dataset.group ?? '',
      src: video?.getAttribute('src') ?? '',
      note: Boolean(selection.querySelector('[data-testid="video-no-audio"]')),
      picker: Boolean(picker),
      value: picker?.value ?? 'missing',
      options: [...(picker?.querySelectorAll('option') ?? [])].map((option) => option.value),
    };
  })()`);
  check(
    cueAudio.group === "taos010_bossstage" &&
      cueAudio.src.endsWith("/media/videos/taos010_bossstage.mp4"),
    `a silent clip's cue player starts on the silent original (got ${cueAudio.src})`,
  );
  check(
    cueAudio.note,
    "the search-selected silent clip carries the no-audio note",
  );
  check(
    cueAudio.picker &&
      cueAudio.value === "" &&
      cueAudio.options.includes("taos010_bossstage|taos010_bossstage"),
    `the cue player offers a muxed picker without preselecting one (got ${cueAudio.value})`,
  );
  await cdp.evaluate(`(() => {
    const select = document.querySelector('[data-testid="cutscene-selection"] [data-testid="cutscene-audio"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, 'taos010_bossstage|taos010_bossstage');
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return select.value;
  })()`);
  await cdp.waitFor(
    `(() => {
      const selection = document.querySelector('[data-testid="cutscene-selection"]');
      const video = selection?.querySelector('video[data-testid="video-player"]');
      return video?.getAttribute('src').endsWith('/media/videos/taos010_bossstage__taos010_bossstage.mp4') &&
        !selection.querySelector('[data-testid="video-no-audio"]');
    })()`,
    "the cue player swaps to the muxed variant and drops the no-audio note",
    60000,
  );
  check(true, "the search-selected player reuses the library's muxed picker");

  await cdp.evaluate(
    `document.querySelectorAll('[data-testid="cutscene-hit"]')[1].click()`,
  );
  await cdp.waitFor(
    `(() => {
      const selection = document.querySelector('[data-testid="cutscene-selection"]');
      if (selection?.dataset.time !== '16.9') return false;
      const video = selection.querySelector('video[data-testid="video-player"]');
      return video?.getAttribute('src').endsWith('/media/videos/taos010_bossstage.mp4');
    })()`,
    "the second cue resets the picker and reloads the silent original",
    60000,
  );
  await cdp.waitFor(
    `(() => {
      const video = document.querySelector('[data-testid="cutscene-selection"] video[data-testid="video-player"]');
      return video.readyState >= 1 && Math.abs(video.currentTime - 16.9) < 0.5;
    })()`,
    "the second cue player seeks to 16.9s",
    60000,
  );
  check(true, "every cue row opens its own seek time");

  // #32: a group matching in several languages lists every language and cue.
  const shelterValue = await cdp.evaluate(SET_CUTSCENE_QUERY("Shelter"));
  check(shelterValue === "Shelter", "cutscene search accepts a multi-language phrase");
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="cutscene-hit"]').length === 10`,
    "subtitle search lists every language's cues for one group",
    60000,
  );
  const shelter = await cdp.evaluate(
    `[...document.querySelectorAll('[data-testid="cutscene-hit"]')].map((node) => ({
      group: node.dataset.group ?? '',
      lang: node.dataset.lang ?? '',
      time: node.dataset.time ?? '',
    }))`,
  );
  check(
    shelter.every((row) => row.group === "ilos6601"),
    `a multi-language match keeps its group (got ${[...new Set(shelter.map((row) => row.group))].join(",")})`,
  );
  check(
    [...new Set(shelter.map((row) => row.lang))].join(",") ===
      "zh-Hans,en,ja,zh-Hant,ko",
    `every language of the group is listed (got ${[...new Set(shelter.map((row) => row.lang))].join(",")})`,
  );
  check(
    shelter.map((row) => row.time).join(",") ===
      "0.8,4.5,0.8,4.5,0.8,4.5,0.8,4.5,0.8,4.5",
    `every cue of every language is listed (got ${shelter.map((row) => row.time).join(",")})`,
  );

  // #32: cue formatting rounds the total tenths, so 97.95s prints as 1:38.0.
  const shannonValue = await cdp.evaluate(SET_CUTSCENE_QUERY("Sister Shannon"));
  check(shannonValue === "Sister Shannon", "cutscene search accepts the rounding phrase");
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="cutscene-hit"]').length === 2`,
    "subtitle search finds the two Sister Shannon cues",
    60000,
  );
  const shannon = await cdp.evaluate(
    `[...document.querySelectorAll('[data-testid="cutscene-hit"]')].map((node) => ({
      time: node.dataset.time ?? '',
      meta: node.querySelector('.cutscene-hit-meta')?.textContent ?? '',
    }))`,
  );
  check(
    shannon.map((row) => row.time).join(",") === "97.95,97.95",
    `a 97.95s cue keeps its exact start (got ${shannon.map((row) => row.time).join(",")})`,
  );
  check(
    shannon.every((row) => row.meta.includes("1:38.0")),
    `a cue at 97.95s rounds up to 1:38.0 (got ${shannon.map((row) => row.meta).join(" | ")})`,
  );
  check(
    shannon.every((row) => !row.meta.includes("1:37.10")),
    "cue formatting never prints a tenths overflow",
  );

  // #32: a common phrase stays bounded per group/language and in total, and the
  // hidden matches stay visible as a count.
  const nekoValue = await cdp.evaluate(SET_CUTSCENE_QUERY("neko"));
  check(nekoValue === "neko", "cutscene search accepts a common word");
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="cutscene-hit"]').length === 40 &&
     Boolean(document.querySelector('[data-testid="cutscene-hits-more"]'))`,
    "a common phrase renders the bounded list with its N-more note",
    120000,
  );
  const bounded = await cdp.evaluate(`(() => {
    const rows = [...document.querySelectorAll('[data-testid="cutscene-hit"]')];
    const counts = new Map();
    for (const row of rows) {
      const key = (row.dataset.group ?? '') + '|' + (row.dataset.lang ?? '');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const more = document.querySelector('[data-testid="cutscene-hits-more"]');
    return {
      rows: rows.length,
      maxPerTrack: Math.max(...counts.values()),
      count: Number(more?.dataset.count ?? -1),
      text: more?.textContent ?? '',
      summary: document.querySelector('[data-testid="cutscene-search-summary"]')?.textContent ?? '',
    };
  })()`);
  check(bounded.rows === 40, `a common phrase renders the bounded list (got ${bounded.rows})`);
  check(
    bounded.maxPerTrack <= 3,
    `no group/language lists more than three cues (got ${bounded.maxPerTrack})`,
  );
  check(
    bounded.count === 359,
    `the N-more note counts every hidden match (got ${bounded.count})`,
  );
  check(bounded.text.includes("359"), "the hidden-match note shows its count");
  check(
    bounded.summary.includes("399"),
    "the search summary counts every match, not just the rendered rows",
  );
  await cdp.screenshot("extras-cutscenes.png");

  const mediaNotes = await cdp.evaluate(`(() => {
    const rest = document.querySelector('[data-testid="cutscene-rest"][data-clip="xos2502"]');
    const taos = document.querySelector('[data-testid="cutscene-row"][data-group="taos010_bossstage"]');
    const voa = document.querySelector('[data-testid="cutscene-row"][data-group="voa008_bossstage"]');
    return {
      restPlayer: Boolean(rest?.querySelector('video[data-testid="video-player"]')),
      restTracks: rest?.querySelectorAll('[data-testid="video-track"]').length ?? -1,
      restNote: rest?.querySelector('[data-testid="cutscene-rest-no-subtitle"]')?.textContent ?? '',
      taosSilent: Boolean(taos?.querySelector('[data-testid="video-no-audio"]')),
      taosOptions: [...(taos?.querySelectorAll('[data-testid="cutscene-audio"] option') ?? [])].map(
        (option) => option.value,
      ),
      voaSilent: Boolean(voa?.querySelector('[data-testid="video-no-audio"]')),
      voaPicker: Boolean(voa?.querySelector('[data-testid="cutscene-audio"]')),
    };
  })()`);
  check(mediaNotes.restPlayer, "a rest clip without subtitles still plays");
  check(mediaNotes.restTracks === 0, "a rest clip attaches no subtitle track");
  check(
    mediaNotes.restNote.trim().length > 0,
    "a rest clip carries the no-subtitles note",
  );
  check(mediaNotes.taosSilent, "silent subtitled clip carries the no-audio note");
  check(
    mediaNotes.taosOptions.includes("taos010_bossstage|taos010_bossstage"),
    `silent clip offers its muxed variant (got ${mediaNotes.taosOptions.join(", ")})`,
  );
  check(
    mediaNotes.taosOptions.includes(""),
    "silent clip keeps its silent variant selectable",
  );
  check(mediaNotes.voaSilent, "silent clip without a muxed variant still carries the note");
  check(!mediaNotes.voaPicker, "silent clip without a muxed variant offers no picker");
  await cdp.evaluate(`(() => {
    const select = document.querySelector('[data-testid="cutscene-row"][data-group="taos010_bossstage"] [data-testid="cutscene-audio"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, 'taos010_bossstage|taos010_bossstage');
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return select.value;
  })()`);
  await cdp.waitFor(
    `(() => {
      const row = document.querySelector('[data-testid="cutscene-row"][data-group="taos010_bossstage"]');
      const video = row.querySelector('video[data-testid="video-player"]');
      const src = video?.getAttribute('src') ?? '';
      return src.endsWith('/media/videos/taos010_bossstage__taos010_bossstage.mp4') &&
        !row.querySelector('[data-testid="video-no-audio"]');
    })()`,
    "muxed variant replaces the silent clip and drops the no-audio note",
    60000,
  );
  check(true, "the muxed player is offered and carries audio");

  // #32 negative path: drop story04_2 from both clip maps but keep its subtitle
  // group, so the row has languages and no exported clip.
  const subtitleStub = await cdp.call("Page.addScriptToEvaluateOnNewDocument", {
    source: manifestStub({
      movies: ["story04_2"],
      videos: ["story04_2"],
    }),
  });
  await cdp.navigate(`${appBase}/extras/cutscenes`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="cutscene-row"][data-group="story04_2"] [data-testid="cutscene-no-video"]'))`,
    "missing cutscene export renders the no-video note",
    60000,
  );
  const noVideo = await cdp.evaluate(`(() => {
    const row = document.querySelector('[data-testid="cutscene-row"][data-group="story04_2"]');
    return {
      clip: row?.dataset.clip ?? 'missing',
      rows: document.querySelectorAll('[data-testid="cutscene-row"]').length,
      videos: row?.querySelectorAll('video').length ?? -1,
      text: row?.querySelector('[data-testid="cutscene-no-video"]')?.textContent ?? '',
    };
  })()`);
  check(noVideo.clip === "", "a group without an exported clip reports no clip");
  check(noVideo.rows === 55, "a missing export does not drop the subtitle group");
  check(noVideo.videos === 0, "a missing export renders no <video> element");
  check(noVideo.text.trim().length > 0, "the no-video note has copy");
  await cdp.call("Page.removeScriptToEvaluateOnNewDocument", {
    identifier: subtitleStub.identifier,
  });
  await cdp.navigate(`${appBase}/extras/cutscenes`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="cutscene-row"][data-group="story04_2"] video[data-testid="video-player"]'))`,
    "cutscene row returns without the stub",
    60000,
  );
  check(true, "removing the manifest stub restores the cutscene row");

  // ----------------------------------------------------------------- search
  await cdp.navigate(`${appBase}/search?q=paff`);
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="search-result"]').length > 0`,
    "search results for paff",
  );
  const paffGroups = await cdp.evaluate(
    `[...document.querySelectorAll('[data-testid="search-group"]')].map(group => group.dataset.groupType)`,
  );
  check(
    paffGroups.includes("im_post") && paffGroups.includes("os_log"),
    "search covers iM posts and OS logs",
  );
  await cdp.navigate(`${appBase}/subtitle_line/CE0202`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="subtitle-detail"] [data-testid="entity-body"]')?.textContent.trim())`,
    "subtitle detail renders its text-store body",
  );
  check(true, "subtitle detail renders text through text_ref");
  await cdp.navigate(`${appBase}/search?q=OA`);
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="search-result"]').length > 0`,
    "search results for OA",
  );
  const oaGroups = await cdp.evaluate(
    `[...document.querySelectorAll('[data-testid="search-group"]')].map(group => group.dataset.groupType)`,
  );
  check(
    oaGroups.includes("oa_document") && oaGroups.includes("subtitle_line"),
    "search covers OA documents and subtitle lines",
  );
  await cdp.navigate(`${appBase}/search?q=Diary`);
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="search-result"]').length > 0`,
    "search results for Diary",
  );
  const searchState = await cdp.evaluate(`(() => ({
    groups: [...document.querySelectorAll('[data-testid="search-group"]')].map(group => ({type: group.dataset.groupType, hits: group.querySelectorAll('[data-testid="search-result"]').length})),
    marks: document.querySelectorAll('mark').length,
    summary: document.querySelector('[data-testid="search-summary"]')?.textContent ?? '',
  }))()`);
  check(
    searchState.groups.some((group) => group.type === "oa_document" && group.hits > 0),
    "Diary search finds OA documents",
  );
  check(searchState.marks > 0, "search results highlight the query");
  const matchUnit = formatUnit(zhHans, "matches", 1).replace(/\d+/g, "").trim();
  check(
    searchState.summary.includes(matchUnit) &&
      searchState.summary.includes("zh-Hans"),
    "search summary reports the match count",
  );
  await cdp.evaluate(
    `document.querySelector('[data-testid="search-input"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))`,
  );
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="search-result"][aria-selected="true"]').length === 1`,
    "keyboard selects one search result",
  );
  const selectedHit = await cdp.evaluate(
    `document.querySelector('[data-testid="search-result"][aria-selected="true"]').getAttribute('href')`,
  );
  await cdp.evaluate(
    `document.querySelector('[data-testid="search-input"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`,
  );
  await cdp.waitFor(
    `location.pathname === ${JSON.stringify(selectedHit)} && Boolean(document.querySelector('[data-testid="entity-body"]'))`,
    "Enter opens the selected search hit",
  );
  check(true, "keyboard Enter opens the selected search hit");
  await cdp.screenshot("search.png");

  // ------------------------------------------------------- relation graph
  await cdp.navigate(`${appBase}/boss_stage/vos054_bossstage`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="entity-view"]'))`,
    "relation-rich entity loads",
  );
  const relations = await cdp.evaluate(`(() => ({
    outgoing: document.querySelectorAll('[data-testid="relations-outgoing"] [data-testid="relation-link"]').length,
    incoming: document.querySelectorAll('[data-testid="relations-incoming"] [data-testid="relation-link"]').length,
  }))()`);
  check(relations.outgoing > 0, "entity shows outbound edges");
  check(relations.incoming > 0, "entity shows inbound edges");
  const relationHref = await cdp.evaluate(
    `document.querySelector('[data-testid="relations-incoming"] [data-testid="relation-link"]').getAttribute('href')`,
  );
  await cdp.evaluate(
    `document.querySelector('[data-testid="relations-incoming"] [data-testid="relation-link"]').click()`,
  );
  await cdp.waitFor(
    `location.pathname === ${JSON.stringify(relationHref)}`,
    "relation link navigates",
  );
  check(true, "relation links navigate to the referenced entity");
  await cdp.evaluate(`document.querySelector('[data-testid="back-button"]').click()`);
  await cdp.waitFor(
    `location.pathname === '/boss_stage/vos054_bossstage'`,
    "back from relation target",
  );
  check(true, "back button returns from a relation target");

  // --------------------------------------------------------------- language
  await cdp.navigate(`${appBase}/os/aios001`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="entity-body"][data-lang="zh-Hans"]'))`,
    "OS body loads in zh-Hans",
  );
  const zhBody = await cdp.evaluate(
    `document.querySelector('[data-testid="entity-body"]')?.textContent ?? ''`,
  );
  await cdp.evaluate(SET_LANGUAGE("ja"));
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="entity-body"][data-lang="ja"]'))`,
    "language switch to ja",
  );
  const jaState = await cdp.evaluate(`(() => ({
    body: document.querySelector('[data-testid="entity-body"]')?.textContent ?? '',
    active: document.querySelector('[data-testid="language-switcher"] .lang-option.active')?.textContent ?? '',
    stored: localStorage.getItem('cytus2.language'),
  }))()`);
  check(jaState.active === "JA", "language switcher marks ja active");
  check(jaState.stored === "ja", "language switch persists to localStorage");
  check(jaState.body !== zhBody && jaState.body.length > 0, "language switch reloads the text body");
  await cdp.screenshot("language-ja.png");
  await cdp.navigate(`${appBase}/im/N0901`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="language-fallback"]'))`,
    "missing-language fallback notice",
  );
  const missingLanguage = await cdp.evaluate(`(() => ({
    notice: document.querySelector('[data-testid="language-fallback"]')?.textContent ?? '',
    body: Boolean(document.querySelector('[data-testid="entity-body"]')),
  }))()`);
  check(
    missingLanguage.notice.includes(
      translate("ja", "common.fallbackNone", { lang: "ja" }),
    ),
    "missing language shows an explicit fallback notice",
  );
  check(!missingLanguage.body, "missing-language entity renders no body");
  await cdp.evaluate(SET_LANGUAGE("zh-Hans"));
  const zhFallback = translate("zh-Hans", "common.fallbackNone", {
    lang: "zh-Hans",
  });
  await cdp.waitFor(
    `(document.querySelector('[data-testid="language-fallback"]')?.textContent ?? '').includes(${JSON.stringify(zhFallback)})`,
    "fallback notice follows the switched language",
  );
  check(true, "fallback notice is recomputed for the selected language");
  await cdp.navigate(`${appBase}/timeline`);
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="timeline-card"]').length > 0`,
    "timeline reloads after language reset",
  );
  const resetSnippet = await cdp.evaluate(
    `document.querySelector('[data-testid="timeline-card"] .card-snippet')?.textContent ?? ''`,
  );
  check(resetSnippet.length > 0, "timeline snippets render after resetting to zh-Hans");
  await cdp.evaluate(`localStorage.setItem('cytus2.language', 'zh-Hans')`);

  // ------------------------------------------------ five-language UI switch
  const LANGUAGES = ["en", "ja", "zh-Hant", "ko", "zh-Hans"];
  const bodyByLanguage = new Map();
  const bodyLanguages = new Set();
  for (const code of LANGUAGES) {
    await cdp.navigate(`${appBase}/timeline`);
    await cdp.waitFor(
      `document.querySelectorAll('[data-testid="timeline-card"]').length > 0`,
      `timeline for ${code}`,
    );
    await cdp.evaluate(SET_LANGUAGE(code));
    await cdp.waitFor(
      `document.documentElement.lang === ${JSON.stringify(code)} &&
       (document.querySelector('.page-head h1')?.textContent ?? '').trim() === ${JSON.stringify(translate(code, "timeline.title"))}`,
      `UI language ${code}`,
    );
    const uiState = await cdp.evaluate(`(() => ({
      nav: document.querySelector('[data-testid="nav-backup"]')?.textContent?.trim() ?? '',
      title: document.querySelector('.page-head h1')?.textContent?.trim() ?? '',
      filter: document.querySelector('[data-testid="type-all"]')?.textContent?.trim() ?? '',
      levelGate: document.querySelector('.context .panel h2')?.textContent?.trim() ?? '',
      account: document.querySelector('[data-testid="account-heading"]')?.textContent?.trim() ?? '',
      stored: localStorage.getItem('cytus2.language'),
      htmlLang: document.documentElement.lang,
      snippet: document.querySelector('[data-testid="timeline-card"] .card-snippet')?.textContent ?? '',
    }))()`);
    check(
      uiState.nav === translate(code, "nav.backup"),
      `${code}: sidebar navigation follows the UI language`,
    );
    check(
      uiState.title === translate(code, "timeline.title"),
      `${code}: timeline heading follows the UI language`,
    );
    check(
      uiState.filter === translate(code, "common.all"),
      `${code}: timeline filter follows the UI language`,
    );
    check(
      uiState.levelGate === translate(code, "timeline.levelGate"),
      `${code}: timeline level gate heading follows the UI language`,
    );
    check(
      uiState.account === translate(code, "timeline.account"),
      `${code}: timeline account heading follows the UI language`,
    );
    check(
      uiState.stored === code && uiState.htmlLang === code,
      `${code}: UI language persists in localStorage and <html lang>`,
    );
    await cdp.screenshot(`language-ui-${code}.png`);
    check(uiState.snippet.length > 0, `${code}: timeline snippets still render`);

    await cdp.navigate(`${appBase}/search`);
    await cdp.waitFor(
      `Boolean(document.querySelector('[data-testid="search-view"]'))`,
      `search view for ${code}`,
    );
    const placeholder = await cdp.evaluate(
      `document.querySelector('[data-testid="search-input"]')?.getAttribute('placeholder') ?? ''`,
    );
    check(
      placeholder === translate(code, "search.placeholder"),
      `${code}: search placeholder follows the UI language`,
    );

    await cdp.navigate(`${appBase}/os/aios001`);
    await cdp.waitFor(
      `Boolean(document.querySelector('[data-testid="entity-body"], [data-testid="language-fallback"]'))`,
      `content for ${code}`,
    );
    const contentState = await cdp.evaluate(`(() => ({
      lang: document.querySelector('[data-testid="entity-body"]')?.dataset.lang ?? null,
      fallback: document.querySelector('[data-testid="language-fallback"]')?.textContent ?? '',
      body: document.querySelector('[data-testid="entity-body"]')?.textContent ?? '',
    }))()`);
    check(
      contentState.lang === code || contentState.fallback.includes(code),
      `${code}: canonical text follows the same language state`,
    );
    if (contentState.lang) {
      bodyLanguages.add(contentState.lang);
    }
    if (contentState.body) {
      bodyByLanguage.set(code, contentState.body);
    }

    await cdp.navigate(`${appBase}/character/paff003`);
    await cdp.waitFor(
      `Boolean(document.querySelector('[data-testid="character-paff-note"]'))`,
      `PΛFF note for ${code}`,
    );
    const characterState = await cdp.evaluate(`(() => ({
      note: document.querySelector('[data-testid="character-paff-note"]')?.textContent?.trim() ?? '',
      osTab: document.querySelector('[data-testid="character-tab-os"]')?.textContent?.trim() ?? '',
    }))()`);
    check(
      characterState.note === translate(code, "character.paffNote"),
      `${code}: PΛFF note follows the UI language`,
    );
    check(
      characterState.osTab === translate(code, "character.osTab"),
      `${code}: character OS tab follows the UI language`,
    );
  }
  check(
    bodyLanguages.size >= 3,
    `canonical text switches across languages (saw ${[...bodyLanguages].join(", ") || "none"})`,
  );
  check(
    new Set([...bodyByLanguage.values()]).size >= 3,
    `canonical bodies differ per language (${bodyByLanguage.size} bodies sampled)`,
  );
  await cdp.navigate(`${appBase}/timeline`);
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="timeline-card"]').length > 0`,
    "timeline reloads after the five-language check",
  );
  await cdp.evaluate(`localStorage.setItem('cytus2.language', 'zh-Hans')`);

  check(
    cdp.exceptions.length === 0,
    `no uncaught page exceptions (${cdp.exceptions.join(" | ") || "none"})`,
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        appBase,
        cards: home.count,
        chart: chartState,
        checks,
        screenshots,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        appBase,
        error: error instanceof Error ? error.message : String(error),
        checks,
        screenshots,
      },
      null,
      2,
    ),
  );
  if (cdp) {
    try {
      await cdp.screenshot("failure.png");
    } catch {
      // ignore screenshot failure
    }
  }
  process.exitCode = 1;
} finally {
  if (cdp) {
    cdp.close();
  }
  if (target?.id) {
    await closeTarget(target.id);
  }
}
