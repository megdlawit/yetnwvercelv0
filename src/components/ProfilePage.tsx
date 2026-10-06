/**
 * ProfilePage — Full-screen profile overlay.
 * Connected to Supabase profile, saved places, navigation stats, and app tools.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronRight, ChevronLeft, Shield, LogOut, Compass,
  MapPin, Footprints, Store, QrCode,
  Bell, Globe, Moon, Sun, UserPen, BookmarkPlus, Mail, History, Navigation as NavigationIcon,
} from 'lucide-react';
import BottomNavPill from './BottomNavPill';
import EditProfileDialog from './EditProfileDialog';
import CreateProfilePrompt from './CreateProfilePrompt';
import BadgeGrid from './BadgeGrid';
import StepsDetailModal from './StepsDetailModal';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import type { ProfileUpdate, DailyStepEntry } from '@/hooks/useUserProfile';
import type { VisitedPlace, VisitedPOISnapshot } from '@/hooks/useVisitedPlaces';
import { formatVisitedWhen } from '@/hooks/useVisitedPlaces';

const LANGUAGES = ['English', 'Amharic', 'Oromo'] as const;
const NOTIFICATIONS_KEY = 'ethi_notifications';

function readNotificationsEnabled(): boolean {
  try {
    return localStorage.getItem(NOTIFICATIONS_KEY) !== 'off';
  } catch {
    return true;
  }
}

function readTheme(): 'light' | 'dark' {
  try {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || saved === 'light') return saved;
  } catch { /* ignore */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

interface ProfilePageProps {
  open: boolean;
  onClose: () => void;
  onTabChange?: (tab: 'explore' | 'saved' | 'profile') => void;
  onSignOut?: () => Promise<boolean>;
  onUpdateProfile?: (updates: ProfileUpdate) => Promise<boolean>;
  onOpenQRScanner?: () => void;
  profileError?: string | null;
  visitorName?: string;
  email?: string;
  userId?: string;
  placesVisited?: number;
  stepsWalked?: number;
  badgesEarned?: number;
  savedCount?: number;
  visitedPlaces?: VisitedPlace[];
  visitedPOIs?: Map<string, VisitedPOISnapshot>;
  visitedLoading?: boolean;
  onViewVisited?: () => void;
  /** Last 7 local days of step counts (oldest first), for the step-detail
   *  ring + chart. Undefined/empty just means the chart shows zeros until
   *  useUserProfile's fetchStepsHistory resolves. */
  stepsHistory?: DailyStepEntry[];
  language?: string;
  parkName?: string;
  location?: string;
  preferredPark?: string;
  loading?: boolean;
  /** When true, renders scoped to the desktop sidebar's bounds (left-anchored,
   *  fixed width) instead of covering the whole viewport. Used when this
   *  component is rendered inside DesktopSidebar. */
  desktopPanel?: boolean;
}

const ProfilePage: React.FC<ProfilePageProps> = ({
  open,
  onClose,
  onTabChange,
  onSignOut,
  onUpdateProfile,
  onOpenQRScanner,
  profileError,
  visitorName,
  email,
  userId,
  placesVisited,
  stepsWalked,
  badgesEarned,
  savedCount = 0,
  visitedPlaces = [],
  visitedPOIs,
  visitedLoading = false,
  onViewVisited,
  stepsHistory = [],
  language = 'English',
  parkName = 'Unity Park',
  location = 'Addis Ababa',
  preferredPark,
  loading = false,
  desktopPanel = false,
}) => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [editOpen, setEditOpen] = useState(false);
  const [verifyEmailOpen, setVerifyEmailOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [notificationsOn, setNotificationsOn] = useState(readNotificationsEnabled);
  const [appearance, setAppearance] = useState<'light' | 'dark'>(readTheme);
  const [stepsModalOpen, setStepsModalOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setNotificationsOn(readNotificationsEnabled());
      setAppearance(readTheme());
    }
  }, [open]);

  const displayName = loading ? 'Loading…' : (visitorName ?? 'Guest');
  // For initials: if it looks like an email, use first two chars of local part
  const isEmail = displayName.includes('@');
  const initialsSource = isEmail ? displayName.split('@')[0] : displayName;
  const nameParts = initialsSource.trim().split(/\s+/);
  const initials = nameParts.length >= 2
    ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
    : initialsSource.slice(0, 2).toUpperCase();

  const stepsLabel = (loading || stepsWalked == null)
    ? '—'
    : stepsWalked >= 1000
      ? `${(stepsWalked / 1000).toFixed(1)}k`
      : String(stepsWalked);

  const displayPlaces = (loading || placesVisited == null) ? '—' : String(placesVisited);
  const displayBadges = (loading || badgesEarned == null) ? '—' : String(badgesEarned);
  const displayLocation = location || 'Add location';
  const displayPark = preferredPark || parkName;
  const todaySteps = stepsHistory.length > 0
    ? stepsHistory[stepsHistory.length - 1].steps
    : (stepsWalked ?? 0);

  const handleSaveProfile = useCallback(async (updates: ProfileUpdate) => {
    if (!onUpdateProfile) return false;
    const ok = await onUpdateProfile(updates);
    if (ok) {
      toast({ title: 'Profile updated', description: 'Your changes have been saved.' });
    }
    return ok;
  }, [onUpdateProfile, toast]);

  const handleLanguageSelect = async (lang: string) => {
    if (!onUpdateProfile) return;
    const ok = await onUpdateProfile({ language: lang });
    if (ok) {
      setLanguageOpen(false);
      toast({ title: 'Language updated', description: `Language set to ${lang}.` });
    }
  };

  const handleToggleNotifications = () => {
    const next = !notificationsOn;
    setNotificationsOn(next);
    try {
      localStorage.setItem(NOTIFICATIONS_KEY, next ? 'on' : 'off');
    } catch { /* ignore */ }
    toast({
      title: next ? 'Notifications on' : 'Notifications off',
      description: next ? 'You will receive park alerts and offers.' : 'Notifications are paused.',
    });
  };

  const handleToggleAppearance = () => {
    const next = appearance === 'dark' ? 'light' : 'dark';
    setAppearance(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    try {
      localStorage.setItem('theme', next);
    } catch { /* ignore */ }
    toast({
      title: next === 'dark' ? 'Dark mode' : 'Light mode',
      description: `Appearance set to ${next === 'dark' ? 'Dark' : 'Light'}.`,
    });
  };

  const handleClearLocalData = () => {
    const keys = ['ethi_sensor_seen', 'ethi_onboarded', 'theme', NOTIFICATIONS_KEY];
    keys.forEach((key) => {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    });
    setPrivacyOpen(false);
    toast({
      title: 'Local data cleared',
      description: 'Onboarding and preference caches were reset on this device.',
    });
  };

  const handleMerchantPortal = () => {
    onClose();
    navigate('/merchant');
  };

  const handleScanQR = () => {
    onClose();
    onOpenQRScanner?.();
  };

  const handleSignOut = async () => {
    const ok = await onSignOut?.();
    setSignOutOpen(false);
    if (ok) {
      onClose();
      toast({ title: 'Signed out', description: 'Your session has been cleared.' });
    } else if (profileError) {
      toast({ title: 'Sign out failed', description: profileError, variant: 'destructive' });
    }
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            key="profile-page"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
            className={desktopPanel
              ? 'fixed left-0 top-0 z-40 flex flex-col overflow-hidden bg-white w-[400px] h-full border-r border-border/20'
              : 'fixed inset-0 z-40 flex flex-col overflow-hidden bg-white'
            }
          >
            <div className="flex-1 overflow-y-auto overscroll-contain scroll-touch" style={{ scrollbarWidth: 'none' }}>
              <div
                className="relative px-5 pt-12 pb-5"
                style={{ background: 'hsl(152 70% 18%)' }}
              >
                <button
                  onClick={onClose}
                  aria-label="Close profile"
                  className="absolute top-4 left-4 w-9 h-9 rounded-full flex items-center justify-center tap-scale"
                  style={{ background: 'rgba(255,255,255,0.12)' }}
                >
                  <ChevronLeft className="w-5 h-5 text-white" />
                </button>

                <div className="flex items-center gap-4 mb-5">
                  <div
                    className="w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0 text-xl font-black text-white"
                    style={{
                      background: 'hsl(133 55% 38%)',
                      border: '2.5px solid rgba(255,255,255,0.35)',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
                    }}
                  >
                    {initials}
                  </div>

                  <div className="min-w-0">
                    <p className="text-lg font-black text-white leading-tight truncate">{displayName}</p>
                    {email && (
                      <div className="flex items-center gap-1.5 mt-1">
                        <Mail className="w-3 h-3 text-white/50 flex-shrink-0" />
                        <span className="text-[11px] text-white/65 truncate">{email}</span>
                      </div>
                    )}
                    <div
                      className="inline-flex items-center gap-1.5 mt-1 rounded-full px-2.5 py-1"
                      style={{ background: 'rgba(255,255,255,0.12)' }}
                    >
                      <Compass className="w-3 h-3 text-white/80" />
                      <span className="text-[11px] font-bold text-white/90">Explorer</span>
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      <MapPin className="w-3 h-3 text-white/50" />
                      <span className="text-xs text-white/55 truncate">{displayLocation}</span>
                    </div>
                    <p className="text-[11px] text-white/45 mt-0.5 truncate">{displayPark}</p>
                  </div>
                </div>

                <div
                  className="grid grid-cols-3 rounded-2xl overflow-hidden"
                  style={{ background: 'rgba(255,255,255,0.08)', gap: 1 }}
                >
                  {[
                    { value: displayPlaces, label: 'Visits', onClick: onViewVisited },
                    { value: stepsLabel, label: 'Steps', onClick: () => setStepsModalOpen(true) },
                    { value: displayBadges, label: 'Badges' },
                  ].map(({ value, label, onClick }) => (
                    <div
                      key={label}
                      role={onClick ? 'button' : undefined}
                      tabIndex={onClick ? 0 : undefined}
                      onClick={onClick}
                      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
                      className={`flex flex-col items-center py-3 ${onClick ? 'tap-scale cursor-pointer' : ''}`}
                      style={{ background: 'rgba(255,255,255,0.06)' }}
                    >
                      <span className="text-[22px] font-black text-white leading-none">{value}</span>
                      <span
                        className="text-[9px] font-bold uppercase tracking-widest mt-1"
                        style={{ color: 'rgba(255,255,255,0.45)' }}
                      >
                        {label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="px-4 py-3 space-y-4 bg-white">
                <Section title="Activity">
                  <Row
                    icon={<MapPin className="w-4 h-4" />} iconColor="green"
                    label="Places visited" value={displayPlaces}
                    onClick={onViewVisited}
                  />
                  <Row
                    icon={<Footprints className="w-4 h-4" />} iconColor="green"
                    label="Steps walked" value={stepsLabel}
                    onClick={() => setStepsModalOpen(true)}
                  />
                  <Row icon={<BookmarkPlus className="w-4 h-4" />} iconColor="green" label="Saved places" value={String(savedCount)} last />
                </Section>

                <div>
                  <p
                    className="text-[10px] font-black uppercase tracking-widest mb-2 px-1"
                    style={{ color: 'hsl(var(--muted-foreground))' }}
                  >
                    Badges
                  </p>
                  <BadgeGrid
                    placesVisited={placesVisited ?? 0}
                    stepsWalked={stepsWalked ?? 0}
                  />
                </div>

                <RecentlyVisitedSection
                  visitedPlaces={visitedPlaces}
                  visitedPOIs={visitedPOIs}
                  loading={visitedLoading}
                  onViewAll={onViewVisited}
                />

                <Section title="Tools">
                  <Row
                    icon={<Store className="w-4 h-4" />}
                    iconColor="green"
                    label="Merchant Portal"
                    sub="Broadcast offers nearby"
                    onClick={handleMerchantPortal}
                  />
                  <Row
                    icon={<QrCode className="w-4 h-4" />}
                    iconColor="blue"
                    label="Scan QR Code"
                    sub="Check in at any location"
                    onClick={handleScanQR}
                    last
                  />
                </Section>

                <Section title="Preferences">
                  <Row
                    icon={<Bell className="w-4 h-4" />}
                    iconColor="gray"
                    label="Notifications"
                    value={notificationsOn ? 'On' : 'Off'}
                    onClick={handleToggleNotifications}
                  />
                  <Row
                    icon={<Globe className="w-4 h-4" />}
                    iconColor="gray"
                    label="Language"
                    value={language}
                    onClick={() => setLanguageOpen(true)}
                  />
                  <Row
                    icon={appearance === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                    iconColor="gray"
                    label="Appearance"
                    value={appearance === 'dark' ? 'Dark' : 'Light'}
                    onClick={handleToggleAppearance}
                    last
                  />
                </Section>

                <Section title="Account">
                  <Row
                    icon={<UserPen className="w-4 h-4" />}
                    iconColor="gray"
                    label="Edit Profile"
                    onClick={() => setEditOpen(true)}
                  />
                  {!email && (
                    <Row
                      icon={<Mail className="w-4 h-4" />}
                      iconColor="green"
                      label="Verify Email"
                      sub="Secure your account with a magic link"
                      onClick={() => setVerifyEmailOpen(true)}
                    />
                  )}
                  <Row
                    icon={<Shield className="w-4 h-4" />}
                    iconColor="gray"
                    label="Privacy & Data"
                    onClick={() => setPrivacyOpen(true)}
                  />
                  <Row
                    icon={<LogOut className="w-4 h-4" />}
                    iconColor="red"
                    label="Sign Out"
                    labelColor="hsl(var(--destructive))"
                    last
                    hideChevron
                    onClick={() => setSignOutOpen(true)}
                  />
                </Section>
              </div>

              <div style={{ height: 80 }} />
            </div>

            <div
              className="flex-shrink-0 bg-white border-t border-border/20"
              style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 16px)' }}
            >
              <BottomNavPill activeTab="profile" onTabChange={onTabChange} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <EditProfileDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        initialValues={{
          fullName: (visitorName && !visitorName.includes('@')) ? visitorName : '',
          location: location ?? '',
          preferredPark: preferredPark ?? parkName,
        }}
        onSave={handleSaveProfile}
        error={profileError}
      />

      <CreateProfilePrompt
        open={verifyEmailOpen}
        onOpenChange={setVerifyEmailOpen}
      />

      <StepsDetailModal
        open={stepsModalOpen}
        onOpenChange={setStepsModalOpen}
        todaySteps={todaySteps}
        history={stepsHistory}
      />

      <Dialog open={languageOpen} onOpenChange={setLanguageOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Language</DialogTitle>
            <DialogDescription>Choose your preferred language.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            {LANGUAGES.map((lang) => (
              <button
                key={lang}
                onClick={() => void handleLanguageSelect(lang)}
                className={`w-full text-left px-4 py-3 rounded-xl text-sm font-semibold transition-colors ${
                  language === lang ? 'bg-primary/10 text-primary' : 'hover:bg-muted/60'
                }`}
              >
                {lang}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={privacyOpen} onOpenChange={setPrivacyOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Privacy & Data</AlertDialogTitle>
            <AlertDialogDescription>
              Your profile, saved places, and activity stats are stored in Supabase.
              Navigation preferences and onboarding state are kept locally on this device.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearLocalData}>
              Clear local cache
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={signOutOpen} onOpenChange={setSignOutOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out?</AlertDialogTitle>
            <AlertDialogDescription>
              This clears your session on this device. You will be asked to set up your profile again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleSignOut()}>
              Sign Out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

const RecentlyVisitedSection: React.FC<{
  visitedPlaces: VisitedPlace[];
  visitedPOIs?: Map<string, VisitedPOISnapshot>;
  loading?: boolean;
  onViewAll?: () => void;
}> = ({ visitedPlaces, visitedPOIs, loading, onViewAll }) => {
  if (loading) return null;
  if (visitedPlaces.length === 0) return null;

  const recent = visitedPlaces.slice(0, 8);

  return (
    <div>
      <div className="flex items-center justify-between px-1 mb-2">
        <p
          className="text-[10px] font-black uppercase tracking-widest"
          style={{ color: 'hsl(var(--muted-foreground))' }}
        >
          Recently Visited
        </p>
        {onViewAll && (
          <button
            onClick={onViewAll}
            className="text-[11px] font-bold flex items-center gap-0.5"
            style={{ color: 'hsl(152 70% 26%)' }}
          >
            View all <ChevronRight className="w-3 h-3" />
          </button>
        )}
      </div>
      <div className="flex gap-2.5 overflow-x-auto scroll-touch pb-1 -mx-1 px-1">
        {recent.map((vp) => {
          const snapshot = visitedPOIs?.get(vp.poi_id);
          const name = snapshot?.name ?? 'Visited Place';
          const img = snapshot?.imageUrl?.trim()
            || 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=300&q=70';
          return (
            <button
              key={vp.poi_id}
              onClick={onViewAll}
              className="flex-shrink-0 w-24 rounded-2xl overflow-hidden text-left tap-scale"
              style={{ background: 'hsl(var(--card))', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
            >
              <div className="w-24 h-16 bg-muted overflow-hidden">
                <img src={img} alt={name} className="w-full h-full object-cover" />
              </div>
              <div className="px-2 py-1.5">
                <p className="text-[11px] font-bold text-foreground leading-tight truncate">{name}</p>
                <p className="text-[9px] text-muted-foreground leading-tight mt-0.5 flex items-center gap-1">
                  {vp.source === 'manual' ? <History className="w-2.5 h-2.5" /> : <NavigationIcon className="w-2.5 h-2.5" />}
                  {formatVisitedWhen(vp.last_visited_at)}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <p
      className="text-[10px] font-black uppercase tracking-widest mb-2 px-1"
      style={{ color: 'hsl(var(--muted-foreground))' }}
    >
      {title}
    </p>
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: 'hsl(var(--card))', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
    >
      {children}
    </div>
  </div>
);

const ICON_BG: Record<string, string> = {
  green: 'hsl(152 70% 22% / 0.10)',
  amber: 'hsl(38 80% 50% / 0.12)',
  blue: 'hsl(210 80% 50% / 0.10)',
  gray: 'hsl(var(--muted))',
  red: 'hsl(var(--destructive) / 0.10)',
};
const ICON_COLOR: Record<string, string> = {
  green: 'hsl(152 70% 26%)',
  amber: 'hsl(38 70% 40%)',
  blue: 'hsl(210 70% 40%)',
  gray: 'hsl(var(--muted-foreground))',
  red: 'hsl(var(--destructive))',
};

interface RowProps {
  icon: React.ReactNode;
  iconColor: 'green' | 'amber' | 'blue' | 'gray' | 'red';
  label: string;
  labelColor?: string;
  sub?: string;
  value?: string;
  last?: boolean;
  hideChevron?: boolean;
  onClick?: () => void;
}

const Row: React.FC<RowProps> = ({
  icon, iconColor, label, labelColor, sub, value, last, hideChevron, onClick,
}) => (
  <div
    role={onClick ? 'button' : undefined}
    tabIndex={onClick ? 0 : undefined}
    onClick={onClick}
    onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
    className="flex items-center gap-3 px-4 active:bg-muted/40 transition-colors cursor-pointer"
    style={{
      paddingTop: 13,
      paddingBottom: 13,
      borderBottom: last ? 'none' : '0.5px solid hsl(var(--border) / 0.5)',
    }}
  >
    <div
      className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
      style={{ background: ICON_BG[iconColor], color: ICON_COLOR[iconColor] }}
    >
      {icon}
    </div>

    <div className="flex-1 min-w-0">
      <p
        className="text-sm font-semibold leading-tight"
        style={{ color: labelColor ?? 'hsl(var(--foreground))' }}
      >
        {label}
      </p>
      {sub && (
        <p className="text-[11px] mt-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
          {sub}
        </p>
      )}
    </div>

    <div className="flex items-center gap-1 flex-shrink-0">
      {value && (
        <span className="text-[13px] font-medium" style={{ color: 'hsl(var(--muted-foreground))' }}>
          {value}
        </span>
      )}
      {!hideChevron && (
        <ChevronRight className="w-4 h-4" style={{ color: 'hsl(var(--border))' }} />
      )}
    </div>
  </div>
);

export default ProfilePage;