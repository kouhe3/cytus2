import { useEffect, useState } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router-dom";
import { CommandPalette } from "./components/CommandPalette";
import { Sidebar } from "./components/Sidebar";
import { isChart } from "./data/database";
import { decodeEntityPath } from "./data/selectors";
import { useDatabase } from "./data/useDatabase";
import type { Database } from "./types";
import { BackupFolderView, BackupIndexView } from "./views/BackupView";
import { ChartView } from "./views/ChartView";
import { EntityView } from "./views/EntityView";
import { NotFound } from "./views/NotFound";
import { OaCharacterView, OaIndexView } from "./views/OaView";
import { SearchView } from "./views/SearchView";
import { ShopIndexView } from "./views/ShopView";
import { StoryIndexView } from "./views/StoryView";
import { TimelineView } from "./views/TimelineView";

const PAGE_TITLES: Record<string, string> = {
  "/timeline": "Timeline",
  "/search": "Search",
  "/oa": "OA",
  "/backup": "Backup Database",
  "/story": "Story",
  "/shop": "Shop",
};

function ScrollToTop() {
  const location = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  return null;
}

function decodeParam(value: string | undefined): string {
  if (!value) {
    return "";
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function OaCharacterRoute({ db }: { db: Database }) {
  const params = useParams();
  return <OaCharacterView db={db} gameId={decodeParam(params["gameId"])} />;
}

function BackupFolderRoute({ db }: { db: Database }) {
  const params = useParams();
  return <BackupFolderView db={db} gameId={decodeParam(params["gameId"])} />;
}

function EntityRoute({ db }: { db: Database }) {
  const location = useLocation();
  const path = decodeEntityPath(location.pathname);
  const entity = db.entityById.get(path);
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
    const fixed = PAGE_TITLES[location.pathname];
    if (fixed) {
      document.title = `${fixed} · Cytus II`;
      return;
    }
    if (location.pathname.startsWith("/oa/")) {
      document.title = "OA archive · Cytus II";
      return;
    }
    if (location.pathname.startsWith("/backup/")) {
      document.title = "Backup folder · Cytus II";
      return;
    }
    if (state.status === "ready") {
      const path = decodeEntityPath(location.pathname);
      const entity = state.db.entityById.get(path);
      if (entity) {
        document.title = `${path} · Cytus II`;
      } else {
        document.title = "Cytus II Story DB";
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
          <Route path="/search" element={<SearchView />} />
          <Route path="/oa" element={<OaIndexView db={db} />} />
          <Route path="/oa/:gameId" element={<OaCharacterRoute db={db} />} />
          <Route path="/backup" element={<BackupIndexView db={db} />} />
          <Route
            path="/backup/:gameId"
            element={<BackupFolderRoute db={db} />}
          />
          <Route path="/story" element={<StoryIndexView db={db} />} />
          <Route path="/shop" element={<ShopIndexView db={db} />} />
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
