import type { Block, ExtraContent, ImContent, IndexData, Lang, OsContent, ReplyNode } from "./types";
import type { Row } from "./rows";

function blocksToText(blocks: Block[] | undefined): string {
  if (!blocks) return "";
  return blocks
    .map((b) => {
      switch (b.kind) {
        case "dialogue":
          return `${b.speaker} ${b.text}`;
        case "narration":
          return b.text;
        case "mail":
          return `${b.title} ${b.from} ${b.to} ${b.body}`;
        case "booklet":
          return `${b.title} ${b.subtitle} ${b.paragraphs.join(" ")}`;
        default:
          return "id" in b ? b.id : "";
      }
    })
    .join("\n");
}

function* walkReplies(nodes: ReplyNode[]): Generator<ReplyNode> {
  for (const node of nodes) {
    yield node;
    yield* walkReplies(node.replies);
  }
}

function snippet(text: string, at: number, len: number): string {
  const start = Math.max(0, at - 36);
  const end = Math.min(text.length, start + len + 72);
  return (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ") + (end < text.length ? "…" : "");
}

export function searchRows(
  index: IndexData,
  lang: Lang,
  im: ImContent | null,
  os: OsContent | null,
  extra: ExtraContent | null,
  query: string,
): Row[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];
  const rows: Row[] = [];

  for (const t of index.im) {
    const body = im?.im[t.id];
    const title = t.titles[lang] || t.id;
    const text = body?.text ?? "";
    const haystack = `${t.id} ${title} ${t.author} ${text}`.toLowerCase();
    let sub: string | undefined;
    if (haystack.includes(q)) {
      const at = text.toLowerCase().indexOf(q);
      sub = at >= 0 ? snippet(text, at, q.length) : `${t.author} · 命中标题/ID`;
    } else {
      for (const reply of walkReplies(body?.replies ?? [])) {
        const inAuthor = reply.author.toLowerCase().includes(q);
        const at = reply.text.toLowerCase().indexOf(q);
        if (!inAuthor && at < 0) continue;
        sub = `回复 ${reply.author}：${at >= 0 ? snippet(reply.text, at, q.length) : reply.id}`;
        break;
      }
    }
    if (sub === undefined) continue;
    rows.push({
      key: `im:${t.id}`,
      view: "im",
      id: t.id,
      title: title || t.id,
      sub,
      badge: t.id,
      avatar: t.avatar,
      group: "iM",
    });
    if (rows.length > 400) return rows;
  }

  for (const e of index.os) {
    const name = e.names[lang] || e.id;
    const text = blocksToText(os?.os[e.id]?.blocks);
    const haystack = `${e.id} ${name} ${e.chapter} ${e.folder} ${text}`.toLowerCase();
    if (!haystack.includes(q)) continue;
    const at = text.toLowerCase().indexOf(q);
    rows.push({
      key: `os:${e.id}`,
      view: "timeline",
      id: e.id,
      title: name || e.id,
      sub: at >= 0 ? snippet(text, at, q.length) : `${e.chapter} · ${e.folder} · 命中 ID/名称`,
      badge: e.id,
      group: "OS",
    });
    if (rows.length > 800) return rows;
  }

  // 分支剧情（branchingosdata）：名字 + 正文
  for (const node of index.branching) {
    const name = node.names?.[lang] ?? "";
    const text = blocksToText(extra?.backup[node.id]?.blocks);
    const haystack = `${node.id} ${name} ${text}`.toLowerCase();
    if (!haystack.includes(q)) continue;
    const at = text.toLowerCase().indexOf(q);
    rows.push({
      key: `branch:${node.id}`,
      view: "branching",
      id: node.id,
      title: name || node.id,
      sub: at >= 0 ? snippet(text, at, q.length) : `分支 ${node.branch || "收束"} · 命中节点名/ID`,
      badge: node.id,
      group: "分支剧情",
    });
  }

  // 备份数据库（gallerydata）
  for (const it of index.gallery.items) {
    const haystack = `${it.name} ${it.location} ${it.folder} ${it.conditions.join(" ")}`.toLowerCase();
    if (!haystack.includes(q)) continue;
    const folder = index.gallery.folders.find((f) => f.id === it.folder);
    rows.push({
      key: `gallery:${it.folder}:${it.location}:${it.name}`,
      view: "backup",
      id: it.folder,
      title: it.name || it.location,
      sub: `${folder?.name ?? it.folder} · ${it.location} · ${it.conditions.join("、") || "无条件"}`,
      badge: it.folder,
      group: "备份数据库",
    });
  }

  // OA / 语音 / 助手（content.*.extra.json）
  if (extra) {
    for (const [id, item] of Object.entries(extra.oa)) {
      const text = `${item.name ?? ""} ${item.details ?? ""} ${item.text ?? ""} ${blocksToText(item.blocks)}`;
      if (!text.toLowerCase().includes(q)) continue;
      const at = text.toLowerCase().indexOf(q);
      rows.push({
        key: `oa:${id}`,
        view: "oa",
        id: item.character ?? "",
        title: item.name || id,
        sub: snippet(text, at, q.length),
        badge: id,
        group: "OA",
      });
    }
    for (const a of extra.audio) {
      if (!`${a.id} ${a.character} ${a.text}`.toLowerCase().includes(q)) continue;
      rows.push({
        key: `audio:${a.id}`,
        view: "extras",
        id: "audio",
        title: `${a.id} · ${a.character}`,
        sub: a.text.slice(0, 80),
        group: "语音字幕",
      });
    }
    for (const a of extra.assistants) {
      const text = a.pages.join("\n");
      if (!`${a.id} ${text}`.toLowerCase().includes(q)) continue;
      rows.push({
        key: `assistant:${a.id}`,
        view: "extras",
        id: "assistants",
        title: a.id,
        sub: text.slice(0, 80),
        group: "iM 助手",
      });
    }
  }

  return rows;
}
