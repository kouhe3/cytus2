import { Link } from "react-router-dom";
import { capsoGroups, gachaGroups, shopBundles } from "../data/collections";
import { isExpansionPack } from "../data/database";
import { useI18n } from "../data/i18n";
import { formatUnit } from "../data/messages";
import { entityHref } from "../data/selectors";
import type { Database } from "../types";

export function ShopIndexView({ db }: { db: Database }) {
  const i18n = useI18n();
  const packs = capsoGroups(db);
  const gacha = gachaGroups(db);
  const bundles = shopBundles(db);
  const expansionPacks = (db.entitiesByType.get("expansion_pack") ?? [])
    .filter(isExpansionPack)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const packItems = packs.reduce((sum, group) => sum + group.items.length, 0);
  const rewards = gacha.reduce((sum, group) => sum + group.rewards.length, 0);

  return (
    <>
      <main className="content">
        <header className="page-head">
          <p className="eyebrow">{i18n.t("shop.eyebrow")}</p>
          <h1>{i18n.t("shop.title")}</h1>
          <p className="lede">{i18n.t("shop.lede")}</p>
          <div className="page-stats" data-testid="shop-stats">
            {i18n.t("shop.stats", {
              packs: formatUnit(i18n, "packs", packs.length),
              items: formatUnit(i18n, "items", packItems),
              machines: formatUnit(i18n, "machines", gacha.length),
              rewards: formatUnit(i18n, "rewards", rewards),
              bundles: formatUnit(i18n, "bundles", bundles.length),
            })}
          </div>
        </header>

        {expansionPacks.length > 0 ? (
          <section
            className="detail-section"
            data-testid="shop-expansion-packs"
          >
            <h2>{i18n.t("shop.expansionPacks")}</h2>
            <div className="card-grid">
              {expansionPacks.map((pack) => (
                <Link
                  key={pack.id}
                  to={entityHref(pack.id)}
                  className="collection-card"
                  data-testid="expansion-pack-card"
                  data-pack-id={pack.id}
                >
                  <span className="collection-title">
                    {pack.name.replace(/\s+/g, " ").trim()}
                  </span>
                  <span className="collection-meta">
                    {i18n.t("shop.expansionMeta", {
                      price: pack.price || "—",
                      songs: formatUnit(i18n, "songs", pack.song_ids.length),
                    })}
                  </span>
                  <span className="collection-id">
                    <code>{pack.game_id}</code>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <section className="detail-section" data-testid="shop-capso-packs">
          <h2>{i18n.t("shop.capsoPacks")}</h2>
          <div className="card-grid">
            {packs.map((group) => (
              <Link
                key={group.pack.id}
                to={entityHref(group.pack.id)}
                className="collection-card"
                data-testid="capso-pack-card"
                data-pack-id={group.pack.id}
              >
                <span className="collection-title">
                  {group.pack.name.replace(/\s+/g, " ").trim()}
                </span>
                <span className="collection-meta">
                  {i18n.t("shop.packMeta", {
                    price: group.pack.default_price_string || "—",
                    capso: i18n.formatNumber(group.pack.capso_price),
                    items: formatUnit(i18n, "items", group.items.length),
                  })}
                </span>
                <span className="collection-id">
                  <code>{group.pack.game_id}</code>
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="detail-section" data-testid="shop-gacha">
          <h2>{i18n.t("shop.gacha")}</h2>
          <div className="card-grid">
            {gacha.map((group) => (
              <Link
                key={group.machine.id}
                to={entityHref(group.machine.id)}
                className="collection-card"
                data-testid="gacha-card"
                data-machine-id={group.machine.id}
              >
                <span className="collection-title">{group.machine.name}</span>
                <span className="collection-meta">
                  {i18n.t("shop.gachaMeta", {
                    price: group.machine.default_price || "—",
                    rewards: formatUnit(i18n, "rewards", group.rewards.length),
                    weight: i18n.formatNumber(group.totalWeight),
                  })}
                </span>
                <span className="collection-id">
                  <code>{group.machine.game_id}</code>
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="detail-section" data-testid="shop-bundles">
          <h2>{i18n.t("shop.bundles")}</h2>
          <div className="card-grid">
            {bundles.map((bundle) => (
              <Link
                key={bundle.id}
                to={entityHref(bundle.id)}
                className="collection-card"
                data-testid="bundle-card"
                data-bundle-id={bundle.id}
                data-black-market={bundle.black_market ? "true" : "false"}
              >
                <span className="collection-title">{bundle.game_id}</span>
                <span className="collection-meta">
                  {i18n.t("shop.bundleMeta", {
                    items: formatUnit(i18n, "items", bundle.items.length),
                    level: bundle.trigger_free_character_level + 1,
                  })}
                </span>
                {bundle.black_market ? (
                  <span className="black-market" data-testid="black-market-badge">
                    {i18n.t("value.blackMarket")}
                  </span>
                ) : null}
                <span className="collection-id">
                  <code>{bundle.milestone_key || bundle.game_id}</code>
                </span>
              </Link>
            ))}
          </div>
        </section>
      </main>

      <aside className="context" aria-label={i18n.t("shop.detailsAria")}>
        <section className="panel">
          <h2>{i18n.t("shop.models")}</h2>
          <p>{i18n.t("shop.capsoModel")}</p>
          <p>{i18n.t("shop.gachaModel")}</p>
          <p>{i18n.t("shop.bundleModel")}</p>
        </section>
        <section className="panel">
          <h2>{i18n.t("shop.rewardKinds")}</h2>
          <ul className="plain-list">
            <li>{i18n.t("shop.rewardCharts")}</li>
            <li>{i18n.t("shop.rewardSongs")}</li>
            <li>{i18n.t("shop.rewardIllustrations")}</li>
            <li>{i18n.t("shop.rewardTapFx")}</li>
          </ul>
        </section>
      </aside>
    </>
  );
}
