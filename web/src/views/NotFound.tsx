import { Link } from "react-router-dom";
import { useI18n } from "../data/i18n";

export function NotFound({ path }: { path: string }) {
  const i18n = useI18n();
  return (
    <>
      <main className="content">
        <div className="empty-state" data-testid="not-found">
          <h1>{i18n.t("notFound.title")}</h1>
          <p>
            {i18n.t("notFound.text", { path })}
          </p>
          <Link to="/timeline" className="backlink" data-testid="back-to-timeline">
            ← {i18n.t("nav.timeline")}
          </Link>
        </div>
      </main>
      <aside
        className="context"
        aria-label={i18n.t("notFound.contextAria")}
      />
    </>
  );
}
