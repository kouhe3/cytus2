import { useEffect, useRef, useState } from "react";
import type { Row } from "../rows";
import { Avatar } from "./Avatar";

export function ListPane({
  rows,
  activeKey,
  onSelect,
  emptyText,
}: {
  rows: Row[];
  activeKey: string;
  onSelect: (row: Row) => void;
  emptyText: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="list" role="region" aria-label="条目列表">
        <p className="state">{emptyText}</p>
      </div>
    );
  }
  // 直接打开某条详情（#/os/<id> 等）时，把当前条目滚进可视区
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    el?.scrollIntoView({ block: "center" });
  }, [activeKey, rows.length]);

  // 分组可折叠：所有列表（时间线 / iM / 剧情事件 / 分支）共用同一套行为
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = row.group ?? "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  return (
    <div className="list" role="list" aria-label="条目列表" ref={listRef}>
      {[...groups.entries()].map(([group, items]) => (
        <div key={group}>
          {group ? (
            <button
              type="button"
              className="group-title group-title--btn"
              aria-expanded={!collapsed.has(group)}
              onClick={() => toggle(group)}
            >
              <span className={`caret${collapsed.has(group) ? "" : " caret--open"}`} aria-hidden="true">
                ›
              </span>
              <span>{group}</span>
              <span className="group-count">{items.length}</span>
            </button>
          ) : null}
          {(collapsed.has(group) ? [] : items).map((row) => (
            <button
              type="button"
              role="listitem"
              key={row.key}
              className="row"
              aria-selected={row.id === activeKey}
              onClick={() => onSelect(row)}
            >
              {row.avatar ? <Avatar id={row.avatar} size={26} /> : null}
              <span className="row-body">
                <span className="row-top">
                  <span className="row-title">{row.title}</span>
                  {row.badge ? <span className="row-id">{row.badge}</span> : null}
                </span>
                {row.sub ? <span className="row-sub">{row.sub}</span> : null}
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
