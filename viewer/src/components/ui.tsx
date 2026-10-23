import type { ReactNode } from "react";

export function Chip({
  children,
  tone,
  title,
}: {
  children: ReactNode;
  tone?: "accent" | "warn";
  title?: string;
}) {
  return (
    <span className={`chip${tone ? ` chip--${tone}` : ""}`} title={title}>
      {children}
    </span>
  );
}

export function NavChip({
  children,
  onClick,
  tone,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  tone?: "accent" | "warn";
  title?: string;
}) {
  return (
    <button type="button" className={`chip chip-btn${tone ? ` chip--${tone}` : ""}`} onClick={onClick} title={title}>
      {children}
    </button>
  );
}

export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <div className="facts">
      {items.map(([k, v]) => (
        <span key={k}>
          {k} <b>{v}</b>
        </span>
      ))}
    </div>
  );
}

export function StateBlock({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state" role="status">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-busy="true" aria-label="加载中">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  );
}
