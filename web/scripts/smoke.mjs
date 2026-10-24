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
 * bundles, grouped full-text search with keyboard navigation, and the
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

  call(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 45000);
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
    const result = await this.call("Page.captureScreenshot", { format: "png" });
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
    return {
      osEntries: orders.length,
      versions,
      osSorted: orders.every(
        (value, index) => index === 0 || compare(orders[index - 1], value) <= 0,
      ),
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
  const paffPage = await cdp.evaluate(CHARACTER_SNAPSHOT);
  check(paffPage.characterId === "character/paff001", "PAFF character page loads");
  check(paffPage.osEntries === 81, `PAFF lists all 81 OS logs (got ${paffPage.osEntries})`);
  check(paffPage.versions.length > 1 && paffPage.osSorted, "PAFF OS logs are sorted by version");
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
  check(!paffAlt.imTab, "PΛFF has no IM tab");
  check(
    paffAlt.paffNote === translate("zh-Hans", "character.paffNote"),
    "PΛFF carries the epilogue-response note",
  );
  await cdp.screenshot("character-paff-note.png");

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

  // ------------------------------------------------------------- OA archive
  await cdp.navigate(`${appBase}/oa`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="oa-index"]'))`,
    "OA index loads",
  );
  const oaIndex = await cdp.evaluate(`(() => ({
    characters: document.querySelectorAll('[data-testid="oa-character-card"]').length,
    firstHref: document.querySelector('[data-testid="oa-character-card"]')?.getAttribute('href'),
    stats: document.querySelector('[data-testid="oa-stats"]')?.textContent ?? '',
  }))()`);
  check(oaIndex.characters === 12, `OA index lists 12 characters (got ${oaIndex.characters})`);
  check(oaIndex.firstHref === "/oa/alice001", "OA index links a character archive");
  check(
    oaIndex.stats.includes(formatUnit(zhHans, "documents", 101)),
    "OA index counts 101 documents",
  );
  await cdp.evaluate(`document.querySelector('[data-testid="oa-character-card"]').click()`);
  await cdp.waitFor(
    `location.pathname === '/oa/alice001' && Boolean(document.querySelector('[data-testid="oa-workspace"]'))`,
    "OA character archive opens",
  );
  const oaTabCount = await cdp.evaluate(
    `document.querySelectorAll('[data-testid="oa-object-tab"]').length`,
  );
  check(oaTabCount >= 2, `OA archive exposes object tabs (got ${oaTabCount})`);
  const firstObjectText = await cdp.evaluate(
    `document.querySelector('[data-testid="oa-object-panel"] .prose')?.textContent ?? ''`,
  );
  await cdp.evaluate(
    `document.querySelectorAll('[data-testid="oa-object-tab"]')[1].click()`,
  );
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="oa-object-tab"]')[1].classList.contains('active')`,
    "second OA object tab becomes active",
  );
  const secondObjectText = await cdp.evaluate(
    `document.querySelector('[data-testid="oa-object-panel"] .prose')?.textContent ?? ''`,
  );
  check(
    secondObjectText !== firstObjectText,
    "OA object tabs switch the object text",
  );
  await cdp.evaluate(`document.querySelector('[data-testid="oa-document-link"]').click()`);
  await cdp.waitFor(
    `location.pathname.startsWith('/oa_document/') &&
     Boolean(document.querySelector('[data-testid="entity-view"][data-entity-type="oa_document"]')) &&
     Boolean(document.querySelector('[data-testid="entity-body"]'))`,
    "OA document detail loads",
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
  check(oaDocument.backCollection === "/oa", "OA document links back to the OA index");
  await cdp.screenshot("oa-document.png");
  await cdp.evaluate(`document.querySelector('[data-testid="back-button"]').click()`);
  await cdp.waitFor(
    `location.pathname === '/oa/alice001' && Boolean(document.querySelector('[data-testid="oa-workspace"]'))`,
    "back from OA document",
  );
  check(true, "back button returns from an OA document to its archive");

  // ------------------------------------------------------- Backup Database
  await cdp.navigate(`${appBase}/backup`);
  await cdp.waitFor(
    `Boolean(document.querySelector('[data-testid="backup-index"]'))`,
    "Backup index loads",
  );
  const backupIndex = await cdp.evaluate(`(() => ({
    folders: document.querySelectorAll('[data-testid="backup-folder-card"]').length,
    stats: document.querySelector('[data-testid="backup-stats"]')?.textContent ?? '',
    firstHref: document.querySelector('[data-testid="backup-folder-card"]')?.getAttribute('href'),
  }))()`);
  check(backupIndex.folders === 25, `Backup index lists 25 folders (got ${backupIndex.folders})`);
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
  const backupFolder = await cdp.evaluate(`(() => ({
    items: document.querySelectorAll('[data-testid="backup-item-card"]').length,
    firstHref: document.querySelector('[data-testid="backup-item-card"]')?.getAttribute('href'),
    kinds: [...new Set([...document.querySelectorAll('[data-testid="backup-item-card"]')].map(card => card.dataset.kind))].sort(),
  }))()`);
  check(backupFolder.items === 3, `Backup folder shows its 3 entries (got ${backupFolder.items})`);
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
    stats: document.querySelector('[data-testid="extras-stats"]')?.textContent ?? '',
  }))()`);
  check(extrasIndex.cards === 2, "extras hub links both appendix families");
  check(
    extrasIndex.assistantsHref === "/extras/assistants",
    "extras hub links the assistant dialogues",
  );
  check(
    extrasIndex.titlesHref === "/extras/titles",
    "extras hub links the title screens",
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
