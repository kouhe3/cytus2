import { useEffect, useRef, useState } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigationType,
  useParams,
} from "react-router-dom";
import { CommandPalette } from "./components/CommandPalette";
import { Sidebar } from "./components/Sidebar";
import { isCharacter, isChart } from "./data/database";
import { useI18n } from "./data/i18n";
import type { MessageKey } from "./data/messages";
import { decodeEntityPath } from "./data/selectors";
import { useDatabase } from "./data/useDatabase";
import type { Database } from "./types";
import { BackupFolderView, BackupIndexView } from "./views/BackupView";
import { CharacterView } from "./views/CharacterView";
import { ChartView } from "./views/ChartView";
import { CutsceneLibraryView } from "./views/CutsceneLibraryView";
import { EntityView } from "./views/EntityView";
import {
  AssistantsView,
  ExtrasIndexView,
  TitlesView,
} from "./views/ExtrasView";
import { NotFound } from "./views/NotFound";
import { OaCharacterView, OaIndexView } from "./views/OaView";
import { OsIndexView } from "./views/OsIndexView";
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
  "/extras/cutscenes": "extras.cutscenesTitle",
};

function ScrollToTop() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const lastScroll = useRef(0);

  useEffect(() => {
    const storageKey = `scroll:${location.key}`;
    lastScroll.current = 0;
    const stored =
      navigationType === "POP" ? sessionStorage.getItem(storageKey) : null;
    if (stored !== null) {
      requestAnimationFrame(() => {
        window.scrollTo(0, Number(stored));
        lastScroll.current = Number(stored);
      });
    } else {
      window.scrollTo(0, 0);
    }
    const onScroll = () => {
      lastScroll.current = window.scrollY;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      sessionStorage.setItem(storageKey, String(lastScroll.current));
      window.removeEventListener("scroll", onScroll);
    };
  }, [location.key, navigationType]);
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
  const fragment = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  let entity = db.entityById.get(path);
  if (!entity && fragment) {
    // Backward-compatible links put the reply floor in the fragment:
    // /im_reply/P0101#1 -> im_reply/P0101#1.
    try {
      entity = db.entityById.get(`${path}#${decodeURIComponent(fragment)}`);
    } catch {
      entity = undefined;
    }
  }
  if (!entity) {
    return <NotFound path={path} />;
  }
  if (isChart(entity)) {
    return <ChartView db={db} chart={entity} />;
  }
  if (isCharacter(entity)) {
    return <CharacterView db={db} character={entity} />;
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
          <Route path="/os" element={<OsIndexView db={db} />} />
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
          <Route path="/extras/cutscenes" element={<CutsceneLibraryView />} />
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
