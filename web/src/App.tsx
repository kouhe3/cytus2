import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { CommandPalette } from "./components/CommandPalette";
import { Sidebar } from "./components/Sidebar";
import { isChart } from "./data/database";
import { decodeEntityPath } from "./data/selectors";
import { useDatabase } from "./data/useDatabase";
import type { Database } from "./types";
import { ChartView } from "./views/ChartView";
import { EntityView } from "./views/EntityView";
import { NotFound } from "./views/NotFound";
import { TimelineView } from "./views/TimelineView";

function ScrollToTop() {
  const location = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  return null;
}

function EntityRoute({ db }: { db: Database }) {
  const location = useLocation();
  const path = decodeEntityPath(location.pathname);
  const entity = db.entityById.get(path);
  useEffect(() => {
    document.title = entity ? `${path} · Cytus II` : "Cytus II Story DB";
  }, [entity, path]);
  if (!entity) {
    return <NotFound path={path} />;
  }
  if (isChart(entity)) {
    return <ChartView db={db} chart={entity} />;
  }
  return <EntityView db={db} entity={entity} />;
}

function BootScreen({ message }: { message: string }) {
  return (
    <div className="boot">
      <span className="boot-mark" aria-hidden="true" />
      <p className="boot-label">{message}</p>
    </div>
  );
}

export default function App() {
  const state = useDatabase();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (location.pathname === "/timeline" || location.pathname === "/") {
      document.title = "Timeline · Cytus II";
    } else if (state.status === "ready") {
      const path = decodeEntityPath(location.pathname);
      const entity = state.db.entityById.get(path);
      if (entity) {
        document.title = `${path} · Cytus II`;
      }
    }
  }, [location.pathname, state]);

  if (state.status === "loading") {
    return <BootScreen message="Loading canonical DB projection…" />;
  }
  if (state.status === "error") {
    return (
      <div className="boot error">
        <h1>Canonical projection unavailable</h1>
        <p>{state.error.message}</p>
        <p className="hint">
          Build the DB from the repository root, then run the SPA again:
        </p>
        <pre>{`python -m cytus2db build --out build/
cd web && pnpm dev`}</pre>
      </div>
    );
  }

  const db = state.db;
  return (
    <>
      <ScrollToTop />
      <div className="shell">
        <Sidebar db={db} onOpenSearch={() => setPaletteOpen(true)} />
        <Routes>
          <Route path="/" element={<Navigate to="/timeline" replace />} />
          <Route path="/timeline" element={<TimelineView db={db} />} />
          <Route path="*" element={<EntityRoute db={db} />} />
        </Routes>
      </div>
      <CommandPalette
        db={db}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
      />
    </>
  );
}
