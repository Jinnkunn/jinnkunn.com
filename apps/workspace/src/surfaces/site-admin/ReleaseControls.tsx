import type { ReleaseTarget } from "./release-flow-model";
import type { ReleaseExecutionMode } from "./release-runner-cards";

export function ReleaseTargetControl({
  disabled,
  onChange,
  value,
}: {
  disabled: boolean;
  onChange: (target: ReleaseTarget) => void;
  value: ReleaseTarget;
}) {
  return (
    <div className="release-center__target" aria-label="Release target">
      <button
        aria-pressed={value === "staging"}
        disabled={disabled}
        type="button"
        onClick={() => onChange("staging")}
      >
        Draft preview
      </button>
      <button
        aria-pressed={value === "production"}
        disabled={disabled}
        type="button"
        onClick={() => onChange("production")}
      >
        Live site
      </button>
    </div>
  );
}

export function ReleaseRunnerControl({
  canRunLocal,
  disabled,
  onChange,
  value,
}: {
  canRunLocal: boolean;
  disabled: boolean;
  onChange: (mode: ReleaseExecutionMode) => void;
  value: ReleaseExecutionMode;
}) {
  if (!canRunLocal) {
    return (
      <div className="release-center__target" aria-label="Release runner">
        <button aria-pressed="true" disabled type="button">
          Mac mini runner
        </button>
      </div>
    );
  }
  return (
    <div className="release-center__target" aria-label="Release runner">
      <button
        aria-pressed={value === "local"}
        disabled={disabled}
        type="button"
        onClick={() => onChange("local")}
      >
        This Mac
      </button>
      <button
        aria-pressed={value === "remote"}
        disabled={disabled}
        type="button"
        onClick={() => onChange("remote")}
      >
        Mac mini runner
      </button>
    </div>
  );
}
