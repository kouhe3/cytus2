#!/usr/bin/env node
/**
 * Browser smoke test against the running Edge CDP endpoint.
 *
 *   cd web && pnpm dev          # terminal 1
 *   cd web && pnpm smoke        # terminal 2
 *
 * It drives the real app through the DevTools protocol: history routing,
 * reading-order cards, the level slider, type/tier filters, the Ctrl+K command
 * palette, a chart page reached from a card, an unlock-source jump, and the
 * return to the timeline. Screenshots are written to web/.shots/.
 *
 * CDP_ENDPOINT defaults to http://127.0.0.1:9333 (the edge-cdp service).
 * Pass a different app URL as the first argument.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const appBase = (process.argv[2] ?? "http://localhost:5190").replace(/\/+$/, "");
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
    paidCards: cards.filter((card) => card.dataset.tier === 'paid').length,
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
  await cdp.waitFor(
    `document.querySelectorAll('[data-testid="timeline-card"]').length > 0`,
    "timeline cards",
  );

  // ---------------------------------------------------------------- home feed
  const home = await cdp.evaluate(TIMELINE_SNAPSHOT);
  check(home.path === "/timeline", "history route /timeline loads directly");
  check(home.count === 1448, `home renders all 1448 timeline entries (got ${home.count})`);
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
  check(home.firstTier === "Free", "first card shows its tier");
  check(
    home.secondOrder > 1,
    "OA documents in reading order are absent from the timeline feed",
  );
  check(
    home.spoilerCards > 0 && home.spoilerChips === home.spoilerCards,
    "cards with a spoiler alert render a spoiler chip",
  );
  check(home.osCards === 1125, `feed includes all 1125 OS logs (got ${home.osCards})`);
  check(home.osWithSnippet > 1000, "OS cards render block-derived snippets");
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
    chartState.needUnlock === "Yes" || chartState.needUnlock === "No",
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

  await cdp.navigate(`${appBase}/`);
  await cdp.waitFor(
    `location.pathname === '/timeline' && document.querySelectorAll('[data-testid="timeline-card"]').length > 0`,
    "root redirects to /timeline",
  );
  check(true, "/ redirects to /timeline");
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
