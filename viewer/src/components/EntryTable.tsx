import type { IndexData, Lang } from "../types";
import { formatDate } from "../data";

export function EntryTable({
  ids,
  index,
  lang,
  onOpen,
}: {
  ids: string[];
  index: IndexData;
  lang: Lang;
  onOpen: (id: string) => void;
}) {
  const byId = new Map(index.os.map((e) => [e.id, e]));
  const rows = ids.map((id) => byId.get(id)).filter((e) => e !== undefined);

  return (
    <table className="grid">
      <thead>
        <tr>
          <th style={{ width: 60 }}>Index</th>
          <th style={{ width: 132 }}>日期</th>
          <th>条目</th>
          <th style={{ width: 96 }}>档案</th>
          <th style={{ width: 110 }}>曲包</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((e) => (
          <tr key={e.id}>
            <td className="mono">{e.index}</td>
            <td className="mono">{formatDate(e.date)}</td>
            <td>
              <button type="button" className="chip chip-btn" onClick={() => onOpen(e.id)}>
                {e.id}
              </button>{" "}
              {e.names[lang]}
              {e.movies.length > 0 ? <span className="chip chip--warn" style={{ marginLeft: 6 }}>▶</span> : null}
            </td>
            <td className="mono">{e.folder}</td>
            <td className="mono">{e.packs.map(([p]) => p).join(" ") || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
