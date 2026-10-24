import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BackButton } from "../components/BackButton";
import { EntityLink } from "../components/EntityLink";
import { Avatar, MediaKindBadge } from "../components/ui";
import { findGalleryGroup, galleryGroups } from "../data/collections";
import { useI18n } from "../data/i18n";
import { mediaKindLabel } from "../data/labels";
import { useLanguage } from "../data/language";
import { formatUnit } from "../data/messages";
import { conditionLink, entityHref } from "../data/selectors";
import type { Database, GalleryItemEntity } from "../types";

export function BackupIndexView({ db }: { db: Database }) {
  const i18n = useI18n();
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
          <p className="eyebrow">{i18n.t("backup.eyebrow")}</p>
          <h1>{i18n.t("backup.title")}</h1>
          <p className="lede">{i18n.t("backup.lede")}</p>
          <div className="page-stats" data-testid="backup-stats">
            {i18n.t("backup.stats", {
              folders: formatUnit(i18n, "folders", groups.length),
              entries: formatUnit(i18n, "entries", totalItems),
              videos: formatUnit(i18n, "videos", kindCounts.get("video") ?? 0),
              images: formatUnit(i18n, "images", kindCounts.get("image") ?? 0),
              bossStages: formatUnit(
                i18n,
                "bossStages",
                kindCounts.get("boss_stage") ?? 0,
              ),
            })}
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
                {i18n.t("backup.meta", {
                  entries: formatUnit(i18n, "entries", group.items.length),
                  videos: formatUnit(i18n, "videos", group.counts["video"] ?? 0),
                  images: formatUnit(i18n, "images", group.counts["image"] ?? 0),
                  bossStages: formatUnit(
                    i18n,
                    "bossStages",
                    group.counts["boss_stage"] ?? 0,
                  ),
                })}
              </span>
              <span className="collection-id">
                <code>{group.folder.game_id}</code>
              </span>
            </Link>
          ))}
        </div>
      </main>

      <aside className="context" aria-label={i18n.t("backup.detailsAria")}>
        <section className="panel">
          <h2>{i18n.t("backup.mediaRetrospective")}</h2>
          <p>{i18n.t("backup.introText")}</p>
          <p className="hint">{i18n.t("backup.branchHint")}</p>
        </section>
        <section className="panel">
          <h2>{i18n.t("backup.byKind")}</h2>
          <dl className="facts">
            <div className="fact">
              <dt>{i18n.t("fact.videos")}</dt>
              <dd>{i18n.formatNumber(kindCounts.get("video") ?? 0)}</dd>
            </div>
            <div className="fact">
              <dt>{i18n.t("fact.images")}</dt>
              <dd>{i18n.formatNumber(kindCounts.get("image") ?? 0)}</dd>
            </div>
            <div className="fact">
              <dt>{i18n.t("fact.bossStages")}</dt>
              <dd>{i18n.formatNumber(kindCounts.get("boss_stage") ?? 0)}</dd>
            </div>
          </dl>
        </section>
      </aside>
    </>
  );
}

type KindFilter = "all" | "video" | "image" | "boss_stage";

const KIND_OPTIONS: readonly KindFilter[] = [
  "all",
  "video",
  "image",
  "boss_stage",
];

function ConditionLine({ db, item }: { db: Database; item: GalleryItemEntity }) {
  const i18n = useI18n();
  if (item.conditions.length === 0) {
    return <span className="muted">{i18n.t("value.alwaysVisible")}</span>;
  }
  return (
    <span className="condition-line">
      {item.conditions.map((condition, index) => {
        const target = conditionLink(db, condition, i18n);
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
  const i18n = useI18n();
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
          <h1>{i18n.t("backup.folderNotFound")}</h1>
          <p>
            {i18n.t("backup.folderNotFoundText", { gameId })}
          </p>
          <Link to="/backup" className="inline-link">
            ← {i18n.t("backup.allFolders")}
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
            ← {i18n.t("nav.backup")}
          </Link>
          <BackButton />
        </div>

        <article className="detail" data-testid="backup-folder" data-folder-id={group.folder.id}>
          <header className="detail-head">
            <p className="eyebrow">
              {i18n.t("backup.folderEyebrow")} ·{" "}
              <code>{group.folder.game_id}</code>
            </p>
            <h1>{group.folder.name}</h1>
            <p className="byline">
              {i18n.t("backup.meta", {
                entries: formatUnit(i18n, "entries", group.items.length),
                videos: formatUnit(i18n, "videos", group.counts["video"] ?? 0),
                images: formatUnit(i18n, "images", group.counts["image"] ?? 0),
                bossStages: formatUnit(
                  i18n,
                  "bossStages",
                  group.counts["boss_stage"] ?? 0,
                ),
              })}
            </p>
          </header>

          <div className="segmented" data-testid="backup-kind-filter">
            {KIND_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className={kind === option ? "segment active" : "segment"}
                aria-pressed={kind === option}
                data-testid={`backup-kind-${option}`}
                onClick={() => setKind(option)}
              >
                {option === "all"
                  ? i18n.t("common.all")
                  : mediaKindLabel(i18n, option)}
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
                      {i18n.formatNumber(item.size[0])} ×{" "}
                      {i18n.formatNumber(item.size[1])}
                    </span>
                  ) : (
                    <span>{i18n.t("value.format", { format: item.format })}</span>
                  )}
                </span>
                <span className="media-conditions">
                  <ConditionLine db={db} item={item} />
                </span>
              </Link>
            ))}
            {items.length === 0 ? (
              <div className="empty-state">{i18n.t("value.noEntriesOfKind")}</div>
            ) : null}
          </div>

          {group.bossStages.length > 0 ? (
            <section className="detail-section" data-testid="backup-boss-stages">
              <h2>{i18n.t("section.bossStages")}</h2>
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

      <aside className="context" aria-label={i18n.t("backup.folderAria")}>
        <section className="panel">
          <h2>{i18n.t("backup.panelFolder")}</h2>
          <dl className="facts">
            <div className="fact">
              <dt>{i18n.t("fact.name")}</dt>
              <dd>{group.folder.name}</dd>
            </div>
            <div className="fact">
              <dt>{i18n.t("entity.fact.gameId")}</dt>
              <dd>
                <code>{group.folder.game_id}</code>
              </dd>
            </div>
            <div className="fact">
              <dt>{i18n.t("fact.avatar")}</dt>
              <dd>
                <code>{group.folder.avatar_id ?? "—"}</code>
              </dd>
            </div>
            <div className="fact">
              <dt>{i18n.t("fact.shown")}</dt>
              <dd>{i18n.formatNumber(items.length)}</dd>
            </div>
          </dl>
        </section>
        <section className="panel">
          <h2>{i18n.t("backup.panelLegend")}</h2>
          <p>
            <MediaKindBadge kind="video" /> {i18n.t("backup.legendVideo")}
          </p>
          <p>
            <MediaKindBadge kind="image" /> {i18n.t("backup.legendImage")}
          </p>
          <p>
            <MediaKindBadge kind="boss_stage" /> {i18n.t("backup.legendBoss")}
          </p>
          <p className="hint">{i18n.t("backup.legendHint")}</p>
        </section>
        <section className="panel">
          <h2>{i18n.t("backup.panelEntity")}</h2>
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
