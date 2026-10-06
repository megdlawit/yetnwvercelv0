import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DesktopSidebar from './DesktopSidebar';

vi.mock('@/contexts/UserProfileContext', () => ({
  useProfile: () => ({
    profile: null,
    hasEmail: true,
    updateEmail: vi.fn(),
    signOut: vi.fn(),
    updateProfile: vi.fn(),
    loading: false,
    error: null,
  }),
}));

vi.mock('@/hooks/useSavedPlaces', () => ({
  useSavedPlaces: () => ({
    savedPlaces: [],
    savedPOIs: [],
    loading: false,
    isSaved: () => false,
    toggleSave: vi.fn().mockResolvedValue(true),
    unsavePlace: vi.fn(),
    error: null,
  }),
}));

vi.mock('@/hooks/useVisitedPlaces', () => ({
  useVisitedPlaces: () => ({
    visitedPlaces: [],
    visitedPOIs: [],
    loading: false,
    removeVisit: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('./MapSearchBar', () => ({
  default: () => <div data-testid="map-search" />,
}));

vi.mock('./ExplorePanel', () => ({
  default: () => <div data-testid="explore-panel" />,
}));

vi.mock('./SavedPanel', () => ({
  default: () => <div data-testid="saved-panel" />,
}));

vi.mock('./VisitedPanel', () => ({
  default: () => <div data-testid="visited-panel" />,
}));

vi.mock('./DirectionsPanel', () => ({
  default: () => <div data-testid="directions-panel" />,
}));

vi.mock('./EmailGateDialog', () => ({
  default: () => null,
}));

vi.mock('./ProfilePage', () => ({
  default: () => null,
}));

describe('DesktopSidebar', () => {
  it('renders without crashing when allPois is omitted', () => {
    render(
      <DesktopSidebar
        parkName="Test Park"
        buildings={[]}
        buildingsLoading={false}
        onBuildingSelect={() => {}}
        onOutdoorPlaceSelect={() => {}}
        onCategorySelect={() => {}}
        onQRScan={() => {}}
        outdoorPois={[]}
        onOutdoorPOISelect={() => {}}
        gpsActive={false}
        onToggleGPS={() => {}}
        pois={[]}
        nearbyPOIs={[]}
        onPOISelect={() => {}}
        activeTab="explore"
        onTabChange={() => {}}
        isLive={false}
        isComplete={false}
        hasPath={false}
        path={null}
        navStateCompat={{
          isNavigating: false,
          isPaused: false,
          currentPosition: { x: 0, y: 0 },
          currentNodeIndex: 0,
          progress: 0,
          isComplete: false,
        }}
        stepCount={0}
        onReset={() => {}}
      />
    );

    expect(screen.getByTestId('map-search')).toBeInTheDocument();
    expect(screen.getByTestId('explore-panel')).toBeInTheDocument();
  });
});
