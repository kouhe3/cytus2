import { useNavigate } from "react-router-dom";

export function BackButton({ testId = "back-button" }: { testId?: string }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="text-button"
      data-testid={testId}
      onClick={() => navigate(-1)}
    >
      ← Back
    </button>
  );
}
