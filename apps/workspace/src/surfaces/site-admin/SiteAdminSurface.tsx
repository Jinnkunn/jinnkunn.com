import { useState } from "react";
import {
  ConfigIcon,
  PagesIcon,
  PostsIcon,
  RoutesIcon,
  StatusIcon,
} from "../icons";
import { ConfigPanel } from "./ConfigPanel";
import { ConnectionCard } from "./ConnectionCard";
import { MessageBar } from "./MessageBar";
import { PagesPanel } from "./PagesPanel";
import { PostsPanel } from "./PostsPanel";
import { ResponsePane } from "./ResponsePane";
import { RoutesPanel } from "./RoutesPanel";
import { SiteAdminProvider } from "./state";
import { StatusPanel } from "./StatusPanel";

type Tab = "status" | "config" | "routes" | "posts" | "pages";

interface TabDef {
  id: Tab;
  label: string;
  Icon: () => React.JSX.Element;
}

const TABS: readonly TabDef[] = [
  { id: "status", label: "Status", Icon: StatusIcon },
  { id: "posts", label: "Posts", Icon: PostsIcon },
  { id: "pages", label: "Pages", Icon: PagesIcon },
  { id: "config", label: "Config", Icon: ConfigIcon },
  { id: "routes", label: "Routes", Icon: RoutesIcon },
];

function SiteAdminContent() {
  const [activeTab, setActiveTab] = useState<Tab>("status");

  return (
    <>
      <ConnectionCard />
      <MessageBar />
      <nav
        className="flex gap-1 p-1 rounded-[10px] border border-border-subtle bg-bg-surface self-start"
        role="tablist"
        aria-label="Site admin sub-surfaces"
      >
        {TABS.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={active}
              aria-current={active ? "page" : undefined}
              className="sidebar-nav-item"
              style={{ padding: "5px 10px", borderRadius: 7, fontSize: 12.5 }}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              <span className="sidebar-nav-item-icon">
                <tab.Icon />
              </span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {activeTab === "status" && <StatusPanel />}
      {activeTab === "posts" && <PostsPanel />}
      {activeTab === "pages" && <PagesPanel />}
      {activeTab === "config" && <ConfigPanel />}
      {activeTab === "routes" && <RoutesPanel />}

      <ResponsePane />
    </>
  );
}

export function SiteAdminSurface() {
  return (
    <SiteAdminProvider>
      <SiteAdminContent />
    </SiteAdminProvider>
  );
}
