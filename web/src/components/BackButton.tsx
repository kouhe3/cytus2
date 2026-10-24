import { useNavigate } from "react-router-dom";
import { useI18n } from "../data/i18n";

export function BackButton({ testId = "back-button" }: { testId?: string }) {
  const navigate = useNavigate();
  const i18n = useI18n();
  return (
    <button
      type="button"
      className="text-button"
      data-testid={testId}
      onClick={() => navigate(-1)}
    >
      ← {i18n.t("common.back")}
    </button>
  );
}
