import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";
import SearchFab from "@/components/layout/Search/SearchFab";
import Footer from "@/components/layout/Footer";
import RenewalBanner from "@/components/subscription/RenewalBanner";
import SkipLink from "@/components/shared/SkipLink";
import { LiveDataProvider } from "@/hooks/useLiveData";
import { XrplProvider } from "@/hooks/useXrplWs";
import SWRProvider from "@/components/shared/SWRProvider";

// Server-side init: starts ingestion pipeline if ENABLE_INGESTION=true
import PageViewTracker from "@/components/shared/PageViewTracker";
import "@/lib/init-server";

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <LiveDataProvider>
      <SkipLink />
      <Sidebar />
      {/* Main content offset: topbar on mobile (60px + 12px), sidebar
           on desktop (60px). On desktop we also bump top padding to
           `pt-3` so the sticky TopBar pins at the same 12px-from-top
           baseline as the floating sidebar. */}
      <div className="pt-18 md:pl-18 md:pt-3">
        <SWRProvider>
          <TopBar />
          <RenewalBanner />
          <XrplProvider>
            {children}
          </XrplProvider>
        </SWRProvider>
      </div>
      <SearchFab />
      <Footer />
      <PageViewTracker />
    </LiveDataProvider>
  );
}
