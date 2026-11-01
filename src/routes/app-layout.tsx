import { Outlet } from "react-router";
import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";
import StatusStrip from "@/components/layout/StatusStrip";
import SearchFab from "@/components/layout/Search/SearchFab";
import Footer from "@/components/layout/Footer";
import SkipLink from "@/components/shared/SkipLink";
import { LiveDataProvider } from "@/hooks/useLiveData";
import { XrplProvider } from "@/hooks/useXrplWs";
import SWRProvider from "@/components/shared/SWRProvider";

export default function AppLayout() {
  return (
    <LiveDataProvider>
      <XrplProvider>
        <SkipLink />
        {/* The sidebar docks beside the page column on desktop; on mobile
             the fixed header takes the column's top. */}
        <div className="md:flex">
          <Sidebar />
          <div className="min-w-0 flex-1 pt-[var(--topbar-h-mobile)] md:pt-0">
            <SWRProvider>
              {/* A screen tall at least, so a page can fill the first screen
                   (`flex-1`) and a short one keeps the footer at its bottom.
                   `*:w-full` keeps a page root with `mx-auto` from shrinking
                   to its content, as a flex item would. */}
              <div className="flex min-h-dvh flex-col *:w-full">
                <StatusStrip />
                <TopBar />
                <Outlet />
                <Footer />
              </div>
            </SWRProvider>
          </div>
        </div>
        <SearchFab />
      </XrplProvider>
    </LiveDataProvider>
  );
}
