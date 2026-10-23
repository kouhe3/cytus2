import { Link } from "react-router-dom";
import { capsoGroups, gachaGroups, shopBundles } from "../data/collections";
import { entityHref } from "../data/selectors";
import type { Database } from "../types";

export function ShopIndexView({ db }: { db: Database }) {
  const packs = capsoGroups(db);
  const gacha = gachaGroups(db);
  const bundles = shopBundles(db);
  const packItems = packs.reduce((sum, group) => sum + group.items.length, 0);
  const rewards = gacha.reduce((sum, group) => sum + group.rewards.length, 0);

  return (
    <>
      <main className="content">
        <header className="page-head">
          <p className="eyebrow">Commerce</p>
          <h1>Shop</h1>
          <p className="lede">
            CAPSO shop packs, the gacha machine and IAP bundles. Each product keeps
            its own entity shape; the Black Market is a flag on a bundle, not a
            separate store.
          </p>
          <div className="page-stats" data-testid="shop-stats">
            <strong>{packs.length}</strong> CAPSO packs · {packItems} items ·{" "}
            {gacha.length} gacha machine · {rewards} rewards · {bundles.length}{" "}
            bundles
          </div>
        </header>

        <section className="detail-section" data-testid="shop-capso-packs">
          <h2>CAPSO shop packs</h2>
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
                  {group.pack.default_price_string || "—"} ·{" "}
                  {group.pack.capso_price} CAPSO · {group.items.length} items
                </span>
                <span className="collection-id">
                  <code>{group.pack.game_id}</code>
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="detail-section" data-testid="shop-gacha">
          <h2>Gacha</h2>
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
                  {group.machine.default_price || "—"} · {group.rewards.length}{" "}
                  rewards · total weight {group.totalWeight}
                </span>
                <span className="collection-id">
                  <code>{group.machine.game_id}</code>
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="detail-section" data-testid="shop-bundles">
          <h2>Shop bundles</h2>
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
                  {bundle.items.length} items · unlock at Lv{" "}
                  {bundle.trigger_free_character_level + 1}
                </span>
                {bundle.black_market ? (
                  <span className="black-market" data-testid="black-market-badge">
                    Black Market
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

      <aside className="context" aria-label="Shop details">
        <section className="panel">
          <h2>Models</h2>
          <p>
            <strong>CAPSO pack</strong> holds chart or illustration items.
          </p>
          <p>
            <strong>Gacha machine</strong> lists weighted rewards; hidden rewards
            are marked secret.
          </p>
          <p>
            <strong>Shop bundle</strong> sells characters or expansion packs; the
            Black Market badge marks the sale state.
          </p>
        </section>
        <section className="panel">
          <h2>Reward kinds</h2>
          <ul className="plain-list">
            <li>Charts · unlock chart entities</li>
            <li>Songs · whole songs</li>
            <li>Illustrations · character costumes</li>
            <li>Tap FX · cosmetic effects</li>
          </ul>
        </section>
      </aside>
    </>
  );
}
