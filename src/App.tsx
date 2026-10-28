import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import { UserProfileProvider } from "@/contexts/UserProfileContext";
import { AdminAuthProvider } from "@/contexts/AdminAuthContext";
import RequireAdminAuth from "@/components/admin/RequireAdminAuth";
import { RequirePlatformAdmin, RequireVenueEditor } from "@/components/admin/AccessGuards";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import AdminLayout from "./pages/admin/AdminLayout";
import AdminTools from "./pages/admin/AdminTools";
import AdminInsightsPage from "./pages/admin/AdminInsights";
import { Overview as AdminOverview, Approvals as AdminApprovals, Institutions as AdminInstitutions, Venues as AdminVenues, People as AdminPeople, Activity as AdminActivity } from "./pages/admin/AdminPages";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import FloorEditor from "./pages/FloorEditor";
import DocsIntro from "./pages/docs/DocsIntro";
import DocsAdmin from "./pages/docs/DocsAdmin";
import DocsApi from "./pages/docs/DocsApi";
import DocsInstitutions from "./pages/docs/DocsInstitutions";
import DocsVisitors from "./pages/docs/DocsVisitors";
import Embed from "./pages/Embed";
import VenueMap from "./pages/VenueMap";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import Home from "./pages/dashboard/Home";
import ViewMapPage from "./pages/dashboard/ViewMapPage";
import Areas from "./pages/dashboard/Areas";
import Floors from "./pages/dashboard/Floors";
import AccessibilityPage from "./pages/dashboard/AccessibilityPage";
import Media from "./pages/dashboard/Media";
import EntryPoints from "./pages/dashboard/EntryPoints";
import VenueSettings from "./pages/dashboard/VenueSettings";
import Reports from "./pages/dashboard/Reports";
import Insights from "./pages/dashboard/Insights";
import Team from "./pages/dashboard/Team";
import PublishSettings from "./pages/dashboard/PublishSettings";
import { PlacesPage, AttractionsPage, ContentPage, QrPage } from "./pages/dashboard/ManagerPages";

// The landing page's 3D scene and models load only when it's opened.
const Landing = lazy(() => import("./pages/Landing"));

const queryClient = new QueryClient();

/** Old per-venue dashboard links now open that venue in the institution dashboard. */
const VenueRedirect = () => <Navigate to={`/dashboard?venue=${useParams().buildingId}`} replace />;
/** The old venue home (/visit?v=…): the venue's map, or the home page. */
const VisitRedirect = () => {
  const v = new URLSearchParams(window.location.search).get('v');
  return <Navigate to={v ? `/venue/${v}` : '/'} replace />;
};
/** The old venue guide: Discover and Explore now live on the venue's map. */
const GuideRedirect = () => <Navigate to={`/venue/${useParams().buildingId}${window.location.search}`} replace />;

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <UserProfileProvider>
          <AdminAuthProvider>
            <Routes>
              {/* The landing page: the Indoor experience (3D park, journey, museum tour) */}
              <Route path="/" element={<Suspense fallback={<div className="fixed inset-0 bg-paper" />}><Landing /></Suspense>} />
              {/* A venue's visitor home page, from its published data (?v=venue) */}
              {/* The venue home page is now the home page (/) and each venue's map. */}
              <Route path="/visit" element={<VisitRedirect />} />
              {/* The city map: GPS to the venue, then indoor navigation (the original visitor app). */}
              <Route path="/explore" element={<Index />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/admin/login" element={<Login />} />
              <Route path="/dashboard" element={<RequireAdminAuth><WorkspaceProvider><DashboardLayout /></WorkspaceProvider></RequireAdminAuth>}>
                <Route index element={<Home />} />
                <Route path="map" element={<ViewMapPage />} />
                <Route path="areas" element={<Areas />} />
                <Route path="places" element={<PlacesPage />} />
                <Route path="floors" element={<Floors />} />
                <Route path="attractions" element={<AttractionsPage />} />
                <Route path="events" element={<ContentPage page="events" />} />
                <Route path="tours" element={<ContentPage page="tours" />} />
                <Route path="accessibility" element={<AccessibilityPage />} />
                <Route path="stories" element={<ContentPage page="stories" />} />
                <Route path="guides" element={<ContentPage page="guides" />} />
                <Route path="media" element={<Media />} />
                <Route path="announcements" element={<ContentPage page="announcements" />} />
                <Route path="entry-points" element={<EntryPoints />} />
                <Route path="qr" element={<QrPage />} />
                <Route path="settings" element={<VenueSettings />} />
                <Route path="reports" element={<Reports />} />
                <Route path="insights" element={<Insights />} />
                <Route path="team" element={<Team />} />
                <Route path="publish" element={<PublishSettings />} />
              </Route>
              {/* The Yet New control center: every institution, venue and person, and the approvals. */}
              <Route path="/admin" element={<RequireAdminAuth><RequirePlatformAdmin><AdminLayout /></RequirePlatformAdmin></RequireAdminAuth>}>
                <Route index element={<AdminOverview />} />
                <Route path="approvals" element={<AdminApprovals />} />
                <Route path="institutions" element={<AdminInstitutions />} />
                <Route path="venues" element={<AdminVenues />} />
                <Route path="users" element={<AdminPeople />} />
                <Route path="activity" element={<AdminActivity />} />
                <Route path="insights" element={<AdminInsightsPage />} />
                <Route path="tools/:tool" element={<AdminTools />} />
              </Route>
              <Route path="/admin/buildings" element={<Navigate to="/admin/tools/buildings" replace />} />
              <Route path="/admin/venues/:buildingId" element={<VenueRedirect />} />
              <Route path="/admin/pois" element={<Navigate to="/admin/tools/pois" replace />} />
              <Route path="/admin/venue-paths" element={<Navigate to="/admin/tools/paths" replace />} />
              <Route path="/AdminLayersDashboard" element={<Navigate to="/admin/tools/layers" replace />} />
              <Route path="/admin/floors/:buildingId/:floorId/editor" element={<RequireAdminAuth><RequireVenueEditor><FloorEditor /></RequireVenueEditor></RequireAdminAuth>} />
              <Route path="/merchant" element={<Navigate to="/admin" replace />} />
              <Route path="/doc" element={<DocsIntro />} />
              <Route path="/doc/admin" element={<DocsAdmin />} />
              <Route path="/doc/api" element={<DocsApi />} />
              <Route path="/doc/institutions" element={<DocsInstitutions />} />
              <Route path="/doc/visitors" element={<DocsVisitors />} />
              <Route path="/docs/*" element={<Navigate to="/doc" replace />} />
              <Route path="/embed" element={<Embed />} />
              {/* The venue map: the /explore map and navigation, scoped to one published venue. */}
              <Route path="/venue/:buildingId" element={<VenueMap />} />
              {/* The venue guide: events, stories, collections and the 3D model. */}
              <Route path="/venue/:buildingId/guide" element={<GuideRedirect />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AdminAuthProvider>
        </UserProfileProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
