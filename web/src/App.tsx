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
import { useI18n } from "./data/i18n";
import type { MessageKey } from "./data/messages";
import { decodeEntityPath } from "./data/selectors";
import { useDatabase } from "./data/useDatabase";
import type { Database } from "./types";
import { BackupFolderView, BackupIndexView } from "./views/BackupView";
import { ChartView } from "./views/ChartView";
import { EntityView } from "./views/EntityView";
import {
  AssistantsView,
  ExtrasIndexView,
  TitlesView,
} from "./views/ExtrasView";
import { NotFound } from "./views/NotFound";
import { OaCharacterView, OaIndexView } from "./views/OaView";
import { SearchView } from "./views/SearchView";
import { ShopIndexView } from "./views/ShopView";
import { StoryIndexView } from "./views/StoryView";
import { TimelineView } from "./views/TimelineView";

const PAGE_TITLES: Record<string, MessageKey> = {
  "/timeline": "nav.timeline",
  "/search": "nav.search",
  "/oa": "nav.oa",
  "/backup": "nav.backup",
  "/story": "nav.story",
  "/shop": "nav.shop",
  "/extras": "nav.extras",
  "/extras/assistants": "extras.assistantsTitle",
  "/extras/titles": "extras.titlesTitle",
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
  const i18n = useI18n();
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
    const fixedKey = PAGE_TITLES[location.pathname];
    if (fixedKey) {
      document.title = `${i18n.t(fixedKey)} · Cytus II`;
      return;
    }
    if (location.pathname.startsWith("/oa/")) {
      document.title = i18n.t("app.oaArchiveTitle");
      return;
    }
    if (location.pathname.startsWith("/backup/")) {
      document.title = i18n.t("app.backupFolderTitle");
      return;
    }
    if (state.status === "ready") {
      const path = decodeEntityPath(location.pathname);
      const entity = state.db.entityById.get(path);
      if (entity) {
        document.title = `${path} · Cytus II`;
      } else {
        document.title = i18n.t("app.defaultTitle");
      }
    }
  }, [location.pathname, state, i18n]);

  if (state.status === "loading") {
    return <BootScreen message={i18n.t("app.loading")} />;
  }
  if (state.status === "error") {
    return (
      <div className="boot error">
        <h1>{i18n.t("app.errorTitle")}</h1>
        <p>{state.error.message}</p>
        <p className="hint">{i18n.t("app.errorHint")}</p>
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
          <Route path="/extras" element={<ExtrasIndexView db={db} />} />
          <Route path="/extras/assistants" element={<AssistantsView db={db} />} />
          <Route path="/extras/titles" element={<TitlesView db={db} />} />
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
