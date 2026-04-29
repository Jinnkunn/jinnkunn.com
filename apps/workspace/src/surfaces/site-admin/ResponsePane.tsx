import { useSiteAdminEphemeral } from "./state";

export function ResponsePane() {
  const { debugResponse } = useSiteAdminEphemeral();
  return (
    <section className="surface-card">
      <header>
        <h2 className="m-0 text-[15px] font-semibold text-text-primary tracking-[-0.01em]">
          Last Response
        </h2>
        <p className="m-0 mt-0.5 text-[12.5px] text-text-muted">
          Debug payload from the most recent admin API call.
        </p>
      </header>
      <pre className="debug-pane">
        {debugResponse.title ? `${debugResponse.title}\n\n` : ""}
        {debugResponse.body}
      </pre>
    </section>
  );
}
