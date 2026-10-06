/**
 * DesktopSidebar — desktop-only (lg+) left panel, Google-Maps-desktop style.
 *
 * This is purely additive: it's rendered alongside the existing mobile UI
 * (BottomSheet, floating search bar, etc.) but only shown at the `lg`
 * breakpoint (1024px+) via `hidden lg:flex` on its root, while the mobile
 * components get `lg:hidden`. Nothing here changes mobile markup/behavior.
 *
 * It reuses the same content components the mobile BottomSheet uses
 * (ExplorePanel / SavedPanel / VisitedPanel / DirectionsPanel / MapSearchBar)
 * so behavior (saving, visiting, searching, directions) stays identical —
 * just laid out as a persistent sidebar instead of bottom sheets.
 */
import React, { useState } from 'react';
import { Compass, BookmarkPlus, CircleUserRound, Volume2, VolumeX, X, History, Satellite, QrCode, Pencil } from 'lucide-react';
import type { Building } from '@/data/types';
import type { NavNode } from '@/data/types';
import { POI } from '@/data/poi';
import { POIWithDistance } from '@/hooks/usePOIProximity';
import { NavigationState } from '@/hooks/useNavigationSimulation';
import type { OutdoorPlaceResult } from '@/hooks/useOutdoorPlaceSearch';
import type { GeoCoord } from '@/lib/geo/GeoTypes';
import { useProfile } from '@/contexts/UserProfileContext';
import { useSavedPlaces } from '@/hooks/useSavedPlaces';
import { useVisitedPlaces } from '@/hooks/useVisitedPlaces';
import { useToast } from '@/hooks/use-toast';
import MapSearchBar from './MapSearchBar';
import ExplorePanel from './ExplorePanel';
import SavedPanel from './SavedPanel';
import VisitedPanel from './VisitedPanel';
import DirectionsPanel from './DirectionsPanel';
import EmailGateDialog from './EmailGateDialog';
import ProfilePage from './ProfilePage';

export type DesktopTab = 'explore' | 'saved' | 'profile';

interface DesktopSidebarProps {
  parkName: string;

  // search
  buildings: Building[];
  buildingsLoading: boolean;
  onBuildingSelect: (id: string) => void;
  onOutdoorPlaceSelect: (place: OutdoorPlaceResult) => void;
  onCategorySelect: (categoryId: string) => void;
  onQRScan: () => void;
  outdoorPois: POI[];
  allPois?: POI[];
  onOutdoorPOISelect: (poi: POI) => void;
  parkCenter?: GeoCoord;

  // GPS
  gpsActive: boolean;
  onToggleGPS: () => void;

  // explore
  pois: POI[];
  nearbyPOIs: POIWithDistance[];
  onPOISelect: (poi: POI) => void;

  // tabs
  activeTab: DesktopTab;
  onTabChange: (tab: DesktopTab) => void;

  // live navigation
  isLive: boolean;
  isComplete: boolean;
  hasPath: boolean;
  path: NavNode[] | null;
  navStateCompat: NavigationState;
  /** Plan pixels per metre for the directions list (lib/navScale). */
  pxPerMeter?: number;
  stepCount: number;
  voiceEnabled?: boolean;
  onToggleVoice?: () => void;
  onReset: () => void;

  // From/To header — shown whenever a route is active (live nav or an
  // outdoor preview), independent of `isLive`. Mirrors FloatingTopCard's
  // From/To rows so desktop gets the same "tap From to change starting
  // point" affordance the map overlay already has.
  startName?: string;
  endName?: string;
  showRoute?: boolean;
  onEditStart?: () => void;
}

const TAB_META: { id: DesktopTab; label: string; Icon: typeof Compass }[] = [
  { id: 'explore', label: 'Explore', Icon: Compass },
  { id: 'saved', label: 'Saved', Icon: BookmarkPlus },
  { id: 'profile', label: 'Profile', Icon: CircleUserRound },
];

const DesktopSidebar: React.FC<DesktopSidebarProps> = ({
  parkName,
  buildings, buildingsLoading, onBuildingSelect, onOutdoorPlaceSelect,
  onCategorySelect, onQRScan, outdoorPois, allPois, onOutdoorPOISelect, parkCenter,
  gpsActive, onToggleGPS,
  pois, nearbyPOIs, onPOISelect,
  activeTab, onTabChange,
  isLive, isComplete, hasPath, path, navStateCompat, stepCount, pxPerMeter,
  voiceEnabled, onToggleVoice, onReset,
  startName, endName, showRoute, onEditStart,
}) => {
  const [placesSubTab, setPlacesSubTab] = useState<'saved' | 'visited'>('saved');
  const { profile, hasEmail, updateEmail, signOut, updateProfile, loading: profileLoading, error: profileError, stepsHistory } = useProfile();
  const { savedPlaces, savedPOIs, loading: savedLoading, isSaved, toggleSave, unsavePlace, error: savedError } = useSavedPlaces(profile?.id);
  const { visitedPlaces, visitedPOIs, loading: visitedLoading, removeVisit } = useVisitedPlaces(profile?.id);
  const { toast } = useToast();

  const [emailGateOpen, setEmailGateOpen] = useState(false);
  const [pendingSavePoiId, setPendingSavePoiId] = useState<string | null>(null);

  const handleTabClick = (tab: DesktopTab) => {
    if (tab === 'profile' && !hasEmail) {
      setPendingSavePoiId(null);
      setEmailGateOpen(true);
      return;
    }
    onTabChange(tab);
  };

  const handleToggleSave = async (poiId: string) => {
    if (isSaved(poiId)) {
      const ok = await toggleSave(poiId);
      if (!ok) {
        toast({ title: 'Could not remove place', description: savedError || 'Something went wrong.', variant: 'destructive' });
      } else {
        toast({ title: 'Removed from Saved', description: 'Place removed from your saved list.' });
      }
      return;
    }
    if (!hasEmail) {
      setPendingSavePoiId(poiId);
      setEmailGateOpen(true);
      return;
    }
    const ok = await toggleSave(poiId);
    if (!ok) {
      toast({ title: 'Could not save place', description: savedError || 'Something went wrong. Check your connection and try again.', variant: 'destructive' });
      return;
    }
    toast({ title: 'Saved!', description: 'View it anytime in the Saved tab.' });
  };

  const handleEmailGateSubmit = async (email: string): Promise<boolean> => {
    if (!updateEmail) return false;
    const ok = await updateEmail(email);
    if (!ok) return false;
    setEmailGateOpen(false);
    if (pendingSavePoiId) {
      const poiId = pendingSavePoiId;
      setPendingSavePoiId(null);
      const saved = await toggleSave(poiId);
      if (saved) toast({ title: 'Saved!', description: 'View it anytime in the Saved tab.' });
    } else {
      onTabChange('profile');
    }
    return true;
  };

  return (
    <div
      className="hidden lg:flex lg:flex-col w-[392px] flex-shrink-0 h-full z-30 relative overflow-hidden rounded-[28px] border border-white/80 bg-pcard"
      style={{ boxShadow: '0 18px 50px rgba(20,50,30,.12)' }}
    >
      {/* ── Header: brand + search ── */}
      <div className="flex-shrink-0 px-4 pt-4 pb-3 border-b border-border/15 space-y-3">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[9.5px] font-bold uppercase tracking-[.14em] text-moss"><span className="h-[7px] w-[7px] flex-none animate-[pinglime_1.6s_infinite] rounded-full bg-lime" />Venue map</div>
            <h1 className="mt-1 truncate font-news text-[26px] font-semibold leading-none tracking-[-.02em] text-ink">{parkName}</h1>
          </div>
          <button
            onClick={onToggleGPS}
            className="flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1.5 rounded-full tap-scale"
            style={{
              background: gpsActive ? 'hsl(var(--primary) / 0.12)' : 'hsl(var(--muted))',
              color: gpsActive ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
            }}
          >
            <Satellite className="w-3 h-3" />
            {gpsActive ? 'GPS ACTIVE' : 'GPS INACTIVE'}
          </button>
        </div>

        <MapSearchBar
          onQRScan={onQRScan}
          onCategorySelect={onCategorySelect}
          buildings={buildings}
          buildingsLoading={buildingsLoading}
          onBuildingSelect={onBuildingSelect}
          onOutdoorPlaceSelect={onOutdoorPlaceSelect}
          outdoorPois={outdoorPois}
          allPois={allPois ?? pois}
          onOutdoorPOISelect={onOutdoorPOISelect}
          parkName={parkName}
          parkCenter={parkCenter}
          indoorPois={(allPois ?? pois).filter(p => !p.isOutdoor && p.nodeId)}
          onIndoorPOISelect={onPOISelect}
          desktopPanel
        />
      </div>

      {/* ── From/To header — shown whenever a route is active, live or previewed.
          Mirrors the map's FloatingTopCard so desktop gets the same "tap
          From to change starting point" affordance. ── */}
      {showRoute && startName && endName && (
        <div className="flex-shrink-0 px-4 pt-3 pb-1">
          <div className="rounded-2xl border border-border/20 bg-muted/30 px-3.5 py-2.5 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide shrink-0 w-8">From</span>
              {onEditStart ? (
                <button
                  onClick={onEditStart}
                  className="flex items-center gap-1 min-w-0 group"
                  aria-label="Change starting point"
                >
                  <span className="text-sm font-semibold text-foreground truncate group-hover:text-primary">{startName}</span>
                  <Pencil className="w-3 h-3 text-muted-foreground/60 shrink-0 group-hover:text-primary" />
                </button>
              ) : (
                <span className="text-sm font-semibold text-foreground truncate">{startName}</span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide shrink-0 w-8">To</span>
              <span className="text-sm font-semibold text-foreground truncate">{endName}</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Live navigation strip (shown above tab content whenever a route is active) ── */}
      {isLive && !isComplete && (
        <div className="flex-shrink-0 px-4 pt-3 pb-2 border-b border-border/15 space-y-2">
          <div className="flex items-center gap-3 bg-primary/6 rounded-2xl px-3 py-2.5 border border-primary/15">
            <div className="relative w-2.5 h-2.5 flex-shrink-0">
              <span className="absolute inset-0 rounded-full bg-primary/40 animate-ping" />
              <span className="relative rounded-full w-2.5 h-2.5 bg-primary block" />
            </div>
            <p className="text-sm font-semibold text-foreground flex-1">Navigating · {stepCount} steps</p>
            {onToggleVoice && (
              <button onClick={onToggleVoice} className="w-7 h-7 rounded-lg bg-muted/70 flex items-center justify-center">
                {voiceEnabled
                  ? <Volume2 className="w-3.5 h-3.5 text-primary" />
                  : <VolumeX className="w-3.5 h-3.5 text-muted-foreground" />}
              </button>
            )}
            <button onClick={onReset} className="w-7 h-7 rounded-lg bg-muted/70 flex items-center justify-center">
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>
          {path && <DirectionsPanel path={path} navState={navStateCompat} pxPerMeter={pxPerMeter} />}
        </div>
      )}

      {/* ── Tab switcher ── */}
      <div className="flex-shrink-0 px-4 pt-3 pb-1">
        <div className="grid grid-cols-3 rounded-2xl p-1 bg-muted/60">
          {TAB_META.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => handleTabClick(id)}
              className="h-9 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 tap-scale transition-colors"
              style={activeTab === id
                ? { background: 'hsl(var(--primary))', color: 'white' }
                : { color: 'hsl(var(--muted-foreground))' }}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ── */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {activeTab === 'saved' ? (
          <>
            <div className="px-4 pt-3 pb-1">
              <div className="grid grid-cols-2 rounded-2xl p-1 bg-muted/60">
                <button
                  onClick={() => setPlacesSubTab('saved')}
                  className="h-9 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 tap-scale transition-colors"
                  style={placesSubTab === 'saved'
                    ? { background: 'hsl(var(--primary))', color: 'white' }
                    : { color: 'hsl(var(--muted-foreground))' }}
                >
                  Saved
                </button>
                <button
                  onClick={() => setPlacesSubTab('visited')}
                  className="h-9 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 tap-scale transition-colors"
                  style={placesSubTab === 'visited'
                    ? { background: 'hsl(var(--primary))', color: 'white' }
                    : { color: 'hsl(var(--muted-foreground))' }}
                >
                  <History className="w-3.5 h-3.5" /> Visited
                </button>
              </div>
            </div>
            {placesSubTab === 'saved' ? (
              <SavedPanel
                savedPlaces={savedPlaces}
                savedPOIs={savedPOIs}
                pois={pois}
                loading={savedLoading}
                onPOISelect={onPOISelect}
                onUnsave={(poiId) => void unsavePlace(poiId)}
              />
            ) : (
              <VisitedPanel
                visitedPlaces={visitedPlaces}
                visitedPOIs={visitedPOIs}
                pois={pois}
                loading={visitedLoading}
                onPOISelect={onPOISelect}
                onRemove={(poiId) => void removeVisit(poiId)}
              />
            )}
          </>
        ) : (
          <ExplorePanel
            pois={pois}
            nearbyPOIs={nearbyPOIs}
            onPOISelect={onPOISelect}
            isSaved={isSaved}
            onToggleSave={handleToggleSave}
            layout="vertical"
          />
        )}
      </div>

      <EmailGateDialog
        open={emailGateOpen}
        onSubmit={handleEmailGateSubmit}
        reason={pendingSavePoiId ? 'save this place' : 'view your profile'}
        onCancel={() => { setEmailGateOpen(false); setPendingSavePoiId(null); }}
      />

      {/* ── Profile overlay — full-screen, same component/behavior as mobile ── */}
      <ProfilePage
        open={activeTab === 'profile'}
        onClose={() => onTabChange('explore')}
        onTabChange={onTabChange}
        parkName={profile?.preferred_park ?? parkName}
        visitorName={profile?.full_name?.trim() || profile?.email || undefined}
        email={profile?.email ?? undefined}
        userId={profile?.id ?? undefined}
        placesVisited={visitedPlaces.length}
        stepsWalked={profile?.steps_walked}
        badgesEarned={profile?.badges_earned}
        savedCount={savedPlaces.length}
        visitedPlaces={visitedPlaces}
        visitedPOIs={visitedPOIs}
        visitedLoading={visitedLoading}
        onViewVisited={() => { setPlacesSubTab('visited'); onTabChange('saved'); }}
        stepsHistory={stepsHistory}
        language={profile?.language ?? 'English'}
        location={profile?.location ?? undefined}
        preferredPark={profile?.preferred_park ?? undefined}
        loading={profileLoading || visitedLoading}
        onSignOut={signOut}
        onUpdateProfile={updateProfile}
        onOpenQRScanner={onQRScan}
        profileError={profileError}
        desktopPanel
      />
    </div>
  );
};

export default DesktopSidebar;