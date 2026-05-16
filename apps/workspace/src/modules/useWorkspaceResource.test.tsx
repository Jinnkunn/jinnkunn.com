// @vitest-environment happy-dom

import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceResource } from "./useWorkspaceResource";

describe("useWorkspaceResource", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    root?.unmount();
    root = null;
    container?.remove();
    container = null;
  });

  function mount(ui: ReactNode) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(ui);
    });
  }

  it("loads data and exposes the resolved value", async () => {
    const snapshots: Array<{ data: string; loading: boolean; state: string }> = [];

    function Probe() {
      const resource = useWorkspaceResource({
        initialData: "initial",
        load: async () => "loaded",
      });
      useEffect(() => {
        snapshots.push({
          data: resource.data,
          loading: resource.loading,
          state: resource.health.state,
        });
      }, [resource.data, resource.health.state, resource.loading]);
      return null;
    }

    mount(<Probe />);
    await vi.waitFor(() =>
      expect(snapshots).toContainEqual({
        data: "loaded",
        loading: false,
        state: "ready",
      }),
    );
  });

  it("keeps stale data visible when a later refresh fails", async () => {
    const snapshots: Array<{
      data: string;
      error: string;
      loading: boolean;
    }> = [];
    const loaders = [
      vi.fn(async () => "fresh"),
      vi.fn(async () => {
        throw new Error("offline");
      }),
    ];

    function Probe({ index }: { index: number }) {
      const resource = useWorkspaceResource({
        initialData: "initial",
        load: loaders[index],
      });
      useEffect(() => {
        snapshots.push({
          data: resource.data,
          error: resource.error ? String(resource.error) : "",
          loading: resource.loading,
        });
      }, [resource.data, resource.error, resource.loading]);
      return null;
    }

    mount(<Probe index={0} />);
    await vi.waitFor(() =>
      expect(snapshots).toContainEqual({
        data: "fresh",
        error: "",
        loading: false,
      }),
    );

    act(() => {
      root?.render(<Probe index={1} />);
    });

    await vi.waitFor(() =>
      expect(snapshots).toContainEqual({
        data: "fresh",
        error: "Error: offline",
        loading: false,
      }),
    );
  });
});
