import { Link } from "react-router-dom";

export function NotFound({ path }: { path: string }) {
  return (
    <>
      <main className="content">
        <div className="empty-state" data-testid="not-found">
          <h1>Entity not found</h1>
          <p>
            No canonical entity resolves to <code>{path}</code>.
          </p>
          <Link to="/timeline" className="backlink" data-testid="back-to-timeline">
            ← Timeline
          </Link>
        </div>
      </main>
      <aside className="context" aria-label="Empty context" />
    </>
  );
}
