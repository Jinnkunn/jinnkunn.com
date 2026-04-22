import { Suspense } from "react";
import DesignSystemThemeRuntime from "@/components/design-system/theme-runtime";

// Global providers for the public site.
// Keep this intentionally minimal: NextAuth's SessionProvider is mounted only
// under `/site-admin/*` to avoid extra network calls and misconfiguration
// errors on every page.

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <DesignSystemThemeRuntime />
      </Suspense>
      {children}
    </>
  );
}
