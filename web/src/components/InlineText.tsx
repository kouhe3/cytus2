import type { CSSProperties, ReactNode } from "react";

/**
 * The game feeds text to Unity UI `Text` with rich text enabled, so only the
 * tags that renderer knows (`b`, `i`, `size`, `color`, `material`) are markup.
 * Everything else — `<Terra>`, `<Access Code Retrieved: …>` — is literal text
 * and must survive untouched. `<font_16>` is a game-side marker that sets the
 * whole text object to 16px; `RichText` strips it, the surrounding line keeps
 * its normal size.
 */
const TAG =
  /<\s*(\/?)\s*(b|i|u|s|color|size|material|br|font_16)\b\s*(?:=\s*([^>]*?))?\s*\/?>/gi;

/** Unity's named colours used by the text assets. */
const NAMED_COLORS: Record<string, string> = {
  red: "#ff0000",
  orange: "#ffa500",
  purple: "#800080",
  green: "#008000",
  blue: "#0000ff",
  black: "#000000",
  white: "#ffffff",
};

/**
 * `<size=N>` is an absolute pixel size in the game's reference layout, where
 * the iM topic/reply body, OS conversation body and sound-text objects are all
 * `Text.m_FontSize = 28` (read from the UI prefabs in `uidata_all`, e.g.
 * `TopicBodyObject/Body`, `OSConversationObject/Body`). Convert to the
 * viewer's 15px body by the same ratio.
 */
const BASE_SIZE = 28;
const MIN_SIZE_EM = 0.5;
const MAX_SIZE_EM = 2.4;

interface InlineStyle {
  color?: string;
  sizeEm?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
}

function colorValue(raw: string | undefined): string | null {
  if (!raw) {
    return null;
  }
  const value = raw.trim();
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) {
    return value;
  }
  return NAMED_COLORS[value.toLowerCase()] ?? null;
}

function sizeValue(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }
  const size = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(size)
    ? Math.min(MAX_SIZE_EM, Math.max(MIN_SIZE_EM, size / BASE_SIZE))
    : null;
}

function toCss(style: InlineStyle): CSSProperties | undefined {
  const css: CSSProperties = {};
  let used = false;
  if (style.color) {
    css.color = style.color;
    used = true;
  }
  if (style.sizeEm) {
    css.fontSize = `${Number(style.sizeEm.toFixed(3))}em`;
    used = true;
  }
  if (style.bold) {
    css.fontWeight = 700;
    used = true;
  }
  if (style.italic) {
    css.fontStyle = "italic";
    used = true;
  }
  if (style.underline || style.strike) {
    css.textDecoration = [style.underline ? "underline" : "", style.strike ? "line-through" : ""]
      .filter(Boolean)
      .join(" ");
    used = true;
  }
  return used ? css : undefined;
}

/** Apply the tag stack onto a fresh span. */
function resolve(stack: readonly InlineStyle[]): InlineStyle {
  const merged: {
    color?: string;
    sizeEm?: number;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strike?: boolean;
  } = {};
  for (const style of stack) {
    if (style.color) merged.color = style.color;
    if (style.sizeEm) merged.sizeEm = style.sizeEm;
    if (style.bold) merged.bold = true;
    if (style.italic) merged.italic = true;
    if (style.underline) merged.underline = true;
    if (style.strike) merged.strike = true;
  }
  return merged;
}

interface Token {
  readonly name: string;
  readonly closing: boolean;
  readonly value?: string;
}

/**
 * Parse one plain string of game rich text into React nodes.
 *
 * Unknown tags are left as text; malformed tags (`<size16>`, `<font_16>` is
 * handled, `<I>` matches `i` case-insensitively) behave like the game's
 * renderer: they are consumed only when the tag name is one it understands.
 */
export function RichText({ text }: { readonly text: string }) {
  const nodes: ReactNode[] = [];
  const stack: InlineStyle[] = [];
  let cursor = 0;
  let key = 0;

  const push = (value: string) => {
    if (!value) {
      return;
    }
    const style = toCss(resolve(stack));
    nodes.push(
      <span key={key++} style={style}>
        {value}
      </span>,
    );
  };

  const close = (name: string) => {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      const style = stack[index] as InlineStyle & { open?: string };
      if (style.open === name) {
        stack.splice(index, 1);
        return;
      }
    }
  };

  const open = (token: Token) => {
    const style: InlineStyle & { open?: string } = { open: token.name };
    if (token.name === "b") style.bold = true;
    else if (token.name === "i") style.italic = true;
    else if (token.name === "u") style.underline = true;
    else if (token.name === "s") style.strike = true;
    else if (token.name === "color") {
      const color = colorValue(token.value);
      if (color) style.color = color;
    } else if (token.name === "size") {
      const size = sizeValue(token.value);
      if (size) style.sizeEm = size;
    } else if (token.name === "font_16") {
      // A game marker that shrinks the text object to 16px; never closed.
      style.sizeEm = Math.min(MAX_SIZE_EM, Math.max(MIN_SIZE_EM, 16 / BASE_SIZE));
    }
    stack.push(style);
  };

  for (const match of text.matchAll(TAG)) {
    const index = match.index ?? 0;
    push(text.slice(cursor, index));
    cursor = index + match[0].length;
    const token: Token = {
      closing: match[1] === "/",
      name: (match[2] ?? "").toLowerCase(),
      value: match[3],
    };
    if (token.name === "br") {
      push("\n");
      continue;
    }
    if (token.name === "material") {
      // Unity supports material tags; the viewer has no equivalent surface.
      continue;
    }
    if (token.closing) {
      close(token.name);
    } else {
      open(token);
    }
  }
  push(text.slice(cursor));

  return <>{nodes}</>;
}
