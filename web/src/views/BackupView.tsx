import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BackButton } from "../components/BackButton";
import { EntityLink } from "../components/EntityLink";
import { Avatar, MediaKindBadge } from "../components/ui";
import { findGalleryGroup, galleryGroups } from "../data/collections";
import { useLanguage } from "../data/language";
import { conditionLink, entityHref } from "../data/selectors";
import type { Database, GalleryItemEntity } from "../types";

export function BackupIndexView({ db }: { db: Database }) {
  const groups = galleryGroups(db);
  const totalItems = groups.reduce((sum, group) => sum + group.items.length, 0);
  const kindCounts = new Map<string, number>();
  for (const group of groups) {
    for (const [kind, count] of Object.entries(group.counts)) {
      kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + count);
    }
  }
  return (
    <>
      <main className="content">
        <header className="page-head">
          <p className="eyebrow">Backup Database</p>
          <h1>Backup Database</h1>
          <p className="lede">
            The media retrospective: videos, images and boss stages grouped by
            folder, with the unlock conditions that expose them. These entries stay
            out of the iM/OS timeline.
          </p>
          <div className="page-stats" data-testid="backup-stats">
            <strong>{groups.length}</strong> folders · {totalItems} entries ·{" "}
            {kindCounts.get("video") ?? 0} videos ·{" "}
            {kindCounts.get("image") ?? 0} images ·{" "}
            {kindCounts.get("boss_stage") ?? 0} boss stages
          </div>
        </header>

        <div className="card-grid" data-testid="backup-index">
          {groups.map((group) => (
            <Link
              key={group.folder.id}
              to={`/backup/${encodeURIComponent(group.folder.game_id)}`}
              className="collection-card"
              data-testid="backup-folder-card"
              data-folder-id={group.folder.id}
            >
              <Avatar name={group.folder.name} />
              <span className="collection-title">{group.folder.name}</span>
              <span className="collection-meta">
                {group.items.length} entries · {group.counts["video"] ?? 0} video ·{" "}
                {group.counts["image"] ?? 0} image ·{" "}
                {group.counts["boss_stage"] ?? 0} boss
              </span>
              <span className="collection-id">
                <code>{group.folder.game_id}</code>
              </span>
            </Link>
          ))}
        </div>
      </main>

      <aside className="context" aria-label="Backup Database details">
        <section className="panel">
          <h2>Media retrospective</h2>
          <p>
            A folder is a character or a shared collection. Each entry is a video,
            an image or a boss stage with an explicit unlock condition.
          </p>
          <p className="hint">
            Branching OS nodes are story nodes, not Backup Database entries.
          </p>
        </section>
        <section className="panel">
          <h2>By kind</h2>
          <dl className="facts">
            <div className="fact">
              <dt>Videos</dt>
              <dd>{kindCounts.get("video") ?? 0}</dd>
            </div>
            <div className="fact">
              <dt>Images</dt>
              <dd>{kindCounts.get("image") ?? 0}</dd>
            </div>
            <div className="fact">
              <dt>Boss stages</dt>
              <dd>{kindCounts.get("boss_stage") ?? 0}</dd>
            </div>
          </dl>
        </section>
      </aside>
    </>
  );
}

type KindFilter = "all" | "video" | "image" | "boss_stage";

const KIND_OPTIONS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "video", label: "Video" },
  { value: "image", label: "Image" },
  { value: "boss_stage", label: "Boss stage" },
];

function ConditionLine({ db, item }: { db: Database; item: GalleryItemEntity }) {
  if (item.conditions.length === 0) {
    return <span className="muted">Always visible</span>;
  }
  return (
    <span className="condition-line">
      {item.conditions.map((condition, index) => {
        const target = conditionLink(db, condition);
        return (
          <span key={`${condition.kind}:${condition.value}`}>
            {index > 0 ? " · " : null}
            {target.href ? (
              <Link to={target.href} className="inline-link">
                {target.label}
              </Link>
            ) : (
              target.label
            )}
          </span>
        );
      })}
    </span>
  );
}

export function BackupFolderView({
  db,
  gameId,
}: {
  db: Database;
  gameId: string;
}) {
  const { lang } = useLanguage();
  const group = findGalleryGroup(db, gameId);
  const [kind, setKind] = useState<KindFilter>("all");
  const items = useMemo(() => {
    if (!group) {
      return [];
    }
    return kind === "all"
      ? group.items
      : group.items.filter((item) => item.kind === kind);
  }, [group, kind]);

  if (!group) {
    return (
      <main className="content">
        <div className="empty-state">
          <h1>Backup folder not found</h1>
          <p>
            No folder has the game id <code>{gameId}</code>.
          </p>
          <Link to="/backup" className="inline-link">
            ← All folders
          </Link>
        </div>
      </main>
    );
  }

  return (
    <>
      <main className="content">
        <div className="back-row">
          <Link to="/backup" className="backlink" data-testid="back-to-backup">
            ← Backup Database
          </Link>
          <BackButton />
        </div>

        <article className="detail" data-testid="backup-folder" data-folder-id={group.folder.id}>
          <header className="detail-head">
            <p className="eyebrow">
              Backup folder · <code>{group.folder.game_id}</code>
            </p>
            <h1>{group.folder.name}</h1>
            <p className="byline">
              {group.items.length} entries · {group.counts["video"] ?? 0} videos ·{" "}
              {group.counts["image"] ?? 0} images ·{" "}
              {group.counts["boss_stage"] ?? 0} boss stages
            </p>
          </header>

          <div className="segmented" data-testid="backup-kind-filter">
            {KIND_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={kind === option.value ? "segment active" : "segment"}
                aria-pressed={kind === option.value}
                data-testid={`backup-kind-${option.value}`}
                onClick={() => setKind(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="media-grid" data-testid="backup-items">
            {items.map((item) => (
              <Link
                key={item.id}
                to={entityHref(item.id)}
                className="media-card"
                data-testid="backup-item-card"
                data-kind={item.kind}
                data-item-id={item.id}
              >
                <span className="media-icon" aria-hidden="true">
                  {item.kind === "video" ? "▶" : item.kind === "image" ? "▧" : "★"}
                </span>
                <span className="media-title">{item.name}</span>
                <span className="media-meta">
                  <MediaKindBadge kind={item.kind} />
                  {item.size ? (
                    <span>
                      {item.size[0]} × {item.size[1]}
                    </span>
                  ) : (
                    <span>format {item.format}</span>
                  )}
                </span>
                <span className="media-conditions">
                  <ConditionLine db={db} item={item} />
                </span>
              </Link>
            ))}
            {items.length === 0 ? (
              <div className="empty-state">No entries of this kind in the folder.</div>
            ) : null}
          </div>

          {group.bossStages.length > 0 ? (
            <section className="detail-section" data-testid="backup-boss-stages">
              <h2>Boss stages</h2>
              <ul className="link-list">
                {group.bossStages.map((stage) => (
                  <li key={stage.id}>
                    <EntityLink db={db} entity={stage} lang={lang} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </article>
      </main>

      <aside className="context" aria-label="Backup folder details">
        <section className="panel">
          <h2>Folder</h2>
          <dl className="facts">
            <div className="fact">
              <dt>Name</dt>
              <dd>{group.folder.name}</dd>
            </div>
            <div className="fact">
              <dt>Game ID</dt>
              <dd>
                <code>{group.folder.game_id}</code>
              </dd>
            </div>
            <div className="fact">
              <dt>Avatar</dt>
              <dd>
                <code>{group.folder.avatar_id ?? "—"}</code>
              </dd>
            </div>
            <div className="fact">
              <dt>Shown</dt>
              <dd>{items.length}</dd>
            </div>
          </dl>
        </section>
        <section className="panel">
          <h2>Legend</h2>
          <p>
            <MediaKindBadge kind="video" /> video clips
          </p>
          <p>
            <MediaKindBadge kind="image" /> still images
          </p>
          <p>
            <MediaKindBadge kind="boss_stage" /> boss stage entries
          </p>
          <p className="hint">
            Conditions link to the OS log, iM post, story node or branch that
            exposes the entry.
          </p>
        </section>
        <section className="panel">
          <h2>Entity</h2>
          <ul className="link-list">
            <li>
              <EntityLink db={db} entity={group.folder} lang={lang} />
            </li>
          </ul>
        </section>
      </aside>
    </>
  );
}
