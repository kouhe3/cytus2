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
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = row.group ?? "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  return (
    <div className="list" role="list" aria-label="条目列表">
      {[...groups.entries()].map(([group, items]) => (
        <div key={group}>
          {group ? <div className="group-title">{group}</div> : null}
          {items.map((row) => (
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
