/**
 * ProfilePage — the visitor's profile: level and streak, this week against
 * their goal, the monthly challenge, an activity calendar, achievements,
 * personal records, recent activity and saved places — plus settings.
 * Activity comes from the shared visitor store (lib/visitor/visitorStore)
 * and the step log (useUserProfile); the numbers from lib/visitor/progress.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronRight, ChevronLeft, Shield, LogOut, MapPin, Footprints, QrCode, Bell, Globe, Moon, Sun, UserPen, Mail,
  Flame, Trophy, Medal, Bookmark, Library, Zap, Building2, Sunrise, MoonStar, Mountain, Route, Compass, Map as MapIcon,
  Settings, Share2, Target, Pencil, CalendarDays, Sparkles, CloudUpload, Check, Store, type LucideIcon,
} from 'lucide-react';
import BottomNavPill from './BottomNavPill';
import EditProfileDialog from './EditProfileDialog';
import CreateProfilePrompt from './CreateProfilePrompt';
import StepsDetailModal from './StepsDetailModal';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { ProfileUpdate, DailyStepEntry } from '@/hooks/useUserProfile';
import type { VisitedPlace, VisitedPOISnapshot } from '@/hooks/useVisitedPlaces';
import { useProfile } from '@/contexts/UserProfileContext';
import { useGuidanceLang } from '@/lib/guidanceLang';
import { useVisitorStore, setWeeklyGoal, clearVisitorData, deviceSteps, type ActivityEntry, type SavedEntry } from '@/lib/visitor/visitorStore';
import {
  dailyStats, streaks, totalsOf, badgesOf, xpOf, levelOf, thisWeek, monthlyChallenge, recordsOf,
  formatDistance, formatSteps, timeAgo, STRIDE_M, type BadgeIcon, type BadgeState, type DayStat,
} from '@/lib/visitor/progress';

const LANGUAGES: { id: string; label: string; native: string; guidance: 'en' | 'am' | null }[] = [
  { id: 'English', label: 'English', native: 'English', guidance: 'en' },
  { id: 'Amharic', label: 'Amharic', native: 'አማርኛ', guidance: 'am' },
  { id: 'Oromo', label: 'Afaan Oromoo', native: 'Coming soon', guidance: null },
];
const NOTIFICATIONS_KEY = 'ethi_notifications';
const GOAL_PRESETS = [10_000, 20_000, 35_000, 50_000, 70_000];

const BADGE_ICONS: Record<BadgeIcon, LucideIcon> = {
  pin: MapPin, compass: Compass, map: MapIcon, footprints: Footprints, trophy: Trophy, medal: Medal, bookmark: Bookmark, library: Library,
  flame: Flame, zap: Zap, building: Building2, sunrise: Sunrise, moon: MoonStar, mountain: Mountain, route: Route,
};

function readNotificationsEnabled(): boolean {
  try { return localStorage.getItem(NOTIFICATIONS_KEY) !== 'off'; } catch { return true; }
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
  /** Last 7 local days of step counts (oldest first). The profile prefers the 12-week log from the profile context. */
  stepsHistory?: DailyStepEntry[];
  language?: string;
  parkName?: string;
  location?: string;
  preferredPark?: string;
  loading?: boolean;
  /** Scoped to the desktop sidebar's bounds instead of covering the viewport. */
  desktopPanel?: boolean;
}

const ProfilePage: React.FC<ProfilePageProps> = ({
  open, onClose, onTabChange, onSignOut, onUpdateProfile, onOpenQRScanner, profileError,
  visitorName, email, stepsWalked, onViewVisited, stepsHistory = [], language = 'English',
  parkName = 'Unity Park', location, preferredPark, loading = false, desktopPanel = false,
}) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { stepsLog } = useProfile();
  const store = useVisitorStore();
  const [, setGuidanceLang] = useGuidanceLang();
  const scroller = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [verifyEmailOpen, setVerifyEmailOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const [notificationsOn, setNotificationsOn] = useState(readNotificationsEnabled);
  const [appearance, setAppearance] = useState<'light' | 'dark'>(readTheme);
  const [stepsModalOpen, setStepsModalOpen] = useState(false);

  useEffect(() => {
    if (open) { setNotificationsOn(readNotificationsEnabled()); setAppearance(readTheme()); }
  }, [open]);

  // ── the numbers ──
  // The profile's count, or this device's if that's further along (the profile may not have caught up yet).
  const steps = Math.max(stepsWalked ?? 0, deviceSteps(store));
  const stepsByDay = useMemo(() => {
    const m = new Map((stepsLog?.length ? stepsLog : stepsHistory).map(d => [d.date, d.steps]));
    for (const [k, n] of Object.entries(store.steps)) m.set(k, Math.max(m.get(k) ?? 0, n));
    return m;
  }, [stepsLog, stepsHistory, store.steps]);
  const days = useMemo(() => dailyStats(stepsByDay, store.activity, 84), [stepsByDay, store.activity]);
  const streak = useMemo(() => streaks(days), [days]);
  const totals = useMemo(() => totalsOf({ stepsWalked: steps, saved: store.saved, visits: store.visits, activity: store.activity, days }), [steps, store, days]);
  const badges = useMemo(() => badgesOf(totals), [totals]);
  const unlocked = badges.filter(b => b.unlocked).length;
  const level = levelOf(xpOf(totals, unlocked));
  const week = useMemo(() => thisWeek(days), [days]);
  const challenge = useMemo(() => monthlyChallenge(store.visits, store.activity), [store.visits, store.activity]);
  const records = recordsOf(totals, days);
  const todaySteps = days.length ? days[days.length - 1].steps : 0;

  const displayName = loading ? 'Loading…' : (visitorName ?? 'Guest explorer');
  const initialsSource = displayName.includes('@') ? displayName.split('@')[0] : displayName;
  const parts = initialsSource.trim().split(/\s+/);
  const initials = (parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : initialsSource.slice(0, 2)).toUpperCase();

  // ── actions ──
  const handleSaveProfile = useCallback(async (updates: ProfileUpdate) => {
    if (!onUpdateProfile) return false;
    const ok = await onUpdateProfile(updates);
    if (ok) toast({ title: 'Profile updated', description: 'Your changes have been saved.' });
    return ok;
  }, [onUpdateProfile, toast]);

  const handleLanguageSelect = async (lang: typeof LANGUAGES[number]) => {
    if (!lang.guidance) return;
    setGuidanceLang(lang.guidance);
    await onUpdateProfile?.({ language: lang.id });
    setLanguageOpen(false);
    toast({ title: 'Language updated', description: lang.guidance === 'am' ? 'Directions will be spoken in Amharic.' : 'Directions will be spoken in English.' });
  };

  const handleToggleNotifications = () => {
    const next = !notificationsOn;
    setNotificationsOn(next);
    try { localStorage.setItem(NOTIFICATIONS_KEY, next ? 'on' : 'off'); } catch { /* ignore */ }
    if (next && 'Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
    toast({ title: next ? 'Notifications on' : 'Notifications off', description: next ? 'You will hear about events and offers at venues you visit.' : 'Notifications are paused.' });
  };

  const handleToggleAppearance = () => {
    const next = appearance === 'dark' ? 'light' : 'dark';
    setAppearance(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    try { localStorage.setItem('theme', next); } catch { /* ignore */ }
  };

  const handleClearLocalData = () => {
    for (const key of ['ethi_sensor_seen', 'ethi_onboarded', 'theme', NOTIFICATIONS_KEY]) { try { localStorage.removeItem(key); } catch { /* ignore */ } }
    setPrivacyOpen(false);
    toast({ title: 'Local data cleared', description: 'Onboarding and preference caches were reset on this device.' });
  };

  const handleSignOut = async () => {
    const ok = await onSignOut?.();
    setSignOutOpen(false);
    if (ok) {
      clearVisitorData();
      onClose();
      toast({ title: 'Signed out', description: 'Your session has been cleared on this device.' });
    } else if (profileError) {
      toast({ title: 'Sign out failed', description: profileError, variant: 'destructive' });
    }
  };

  const shareWeek = async () => {
    const text = `My week on Yet New: ${week.steps.toLocaleString('en')} steps · ${formatDistance(week.meters)} · ${week.activeDays} active day${week.activeDays === 1 ? '' : 's'}`
      + (streak.current > 1 ? ` · ${streak.current}-day streak` : '') + ` · Level ${level.level} ${level.title}`;
    try {
      if (navigator.share) { await navigator.share({ title: 'My week on Yet New', text, url: window.location.origin }); return; }
      await navigator.clipboard.writeText(`${text}\n${window.location.origin}`);
      toast({ title: 'Copied', description: 'Your week is ready to paste anywhere.' });
    } catch { /* cancelled */ }
  };

  const openSaved = (e: SavedEntry) => {
    if (e.buildingId) { onClose(); navigate(`/venue/${e.buildingId}?place=${encodeURIComponent(e.nodeId ?? e.id)}`); }
    else onTabChange?.('saved');
  };
  const openActivity = (a: ActivityEntry) => {
    if (a.buildingId && a.placeId) {
      const entry = store.saved.find(s => s.id === a.placeId) ?? store.visits.find(v => v.id === a.placeId);
      onClose(); navigate(`/venue/${a.buildingId}?place=${encodeURIComponent(entry?.nodeId ?? a.placeId)}`);
    }
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            key="profile-page"
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
            className={desktopPanel
              ? 'visitor-surface fixed left-0 top-0 z-40 flex h-full w-[400px] flex-col overflow-hidden border-r border-border/20 bg-background text-foreground'
              : 'visitor-surface fixed inset-0 z-40 flex flex-col overflow-hidden bg-background text-foreground'}
          >
            <div ref={scroller} className="flex-1 overflow-y-auto overscroll-contain scroll-touch" style={{ scrollbarWidth: 'none' }}>
              {/* ── Hero ── */}
              <div className="relative overflow-hidden px-5 pb-5 pt-14 text-white"
                style={{ background: 'linear-gradient(155deg, hsl(152 72% 14%) 0%, hsl(158 62% 22%) 55%, hsl(186 58% 26%) 100%)' }}>
                <IsoPattern />
                <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-lime-300/20 blur-3xl" />
                <button onClick={onClose} aria-label="Close profile" className="absolute left-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-white/15 backdrop-blur tap-scale">
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button onClick={() => settingsRef.current?.scrollIntoView({ behavior: 'smooth' })} aria-label="Settings" className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-white/15 backdrop-blur tap-scale">
                  <Settings className="h-[18px] w-[18px]" />
                </button>

                <div className="relative flex items-center gap-4">
                  <LevelAvatar initials={initials} progress={level.progress} level={level.level} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xl font-black leading-tight">{displayName}</p>
                    <p className="mt-0.5 text-[13px] font-semibold text-lime-200">Level {level.level} · {level.title}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold', streak.current ? 'bg-orange-500/90 text-white' : 'bg-white/15 text-white/85')}>
                        <Flame className="h-3.5 w-3.5" />
                        {streak.current ? `${streak.current}-day streak` : 'Start a streak today'}
                      </span>
                      {(location || preferredPark) && (
                        <span className="inline-flex min-w-0 items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px] text-white/80">
                          <MapPin className="h-3 w-3 shrink-0" /> <span className="truncate">{location || preferredPark}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Experience to the next level */}
                <div className="relative mt-4">
                  <div className="h-2 overflow-hidden rounded-full bg-white/15">
                    <motion.div className="h-full rounded-full" style={{ background: 'linear-gradient(90deg, #a3e635, #22d3ee)' }}
                      initial={{ width: 0 }} animate={{ width: `${Math.max(3, level.progress * 100)}%` }} transition={{ duration: 0.9, ease: 'easeOut' }} />
                  </div>
                  <p className="mt-1.5 text-[11px] text-white/70">{level.into.toLocaleString('en')} / {level.need.toLocaleString('en')} XP to Level {level.level + 1}</p>
                </div>

                {/* Lifetime numbers */}
                <div className="relative mt-4 grid grid-cols-4 gap-2">
                  {[
                    { v: loading ? '—' : String(totals.places), l: 'Places', on: onViewVisited },
                    { v: loading ? '—' : formatSteps(steps), l: 'Steps', on: () => setStepsModalOpen(true) },
                    { v: loading ? '—' : formatDistance(steps * STRIDE_M), l: 'Walked' },
                    { v: loading ? '—' : String(totals.venues), l: 'Venues' },
                  ].map(s => (
                    <button key={s.l} onClick={s.on} disabled={!s.on}
                      className="rounded-2xl bg-white/10 px-1 py-2.5 text-center backdrop-blur-sm transition enabled:hover:bg-white/15 enabled:active:scale-95">
                      <span className="block text-lg font-black leading-none tabular-nums">{s.v}</span>
                      <span className="mt-1 block text-[9px] font-bold uppercase tracking-widest text-white/55">{s.l}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-4 px-4 py-4">
                {/* Keep it safe */}
                {!email && (
                  <button onClick={() => setVerifyEmailOpen(true)} className="flex w-full items-center gap-3 rounded-2xl border border-primary/25 bg-primary/5 p-3.5 text-left">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><CloudUpload className="h-5 w-5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold">Keep your progress safe</span>
                      <span className="block text-xs text-muted-foreground">Add your email to keep your saves, streak and badges on every device.</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                )}

                {/* This week */}
                <Card>
                  <div className="flex items-center justify-between">
                    <SectionTitle icon={CalendarDays}>This week</SectionTitle>
                    <button onClick={() => setGoalOpen(true)} className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-muted">
                      <Target className="h-3.5 w-3.5" /> Goal {formatSteps(store.weeklyGoal)} <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="mt-3 flex items-center gap-4">
                    <GoalRing value={week.steps} goal={store.weeklyGoal} />
                    <div className="min-w-0 flex-1">
                      <WeekBars week={week.week} goalPerDay={store.weeklyGoal / 7} />
                      <p className="mt-2 text-xs text-muted-foreground">
                        <b className="text-foreground">{formatDistance(week.meters)}</b> · {week.activeDays} active day{week.activeDays === 1 ? '' : 's'}
                        {week.steps >= store.weeklyGoal && <span className="ml-1 font-semibold text-primary">· Goal reached!</span>}
                      </p>
                    </div>
                  </div>
                </Card>

                {/* Monthly challenge */}
                <div className="relative overflow-hidden rounded-3xl p-4 text-white shadow-sm"
                  style={{ background: challenge.done ? 'linear-gradient(135deg, #15803d, #0d9488)' : 'linear-gradient(135deg, #f97316, #db2777 60%, #7c3aed)' }}>
                  <Trophy className="pointer-events-none absolute -bottom-3 -right-2 h-24 w-24 rotate-12 text-white/15" />
                  <p className="text-[10px] font-black uppercase tracking-widest text-white/75">Monthly challenge</p>
                  <p className="mt-1 text-lg font-black leading-tight">{challenge.title}</p>
                  <p className="text-xs text-white/85">{challenge.goal}</p>
                  <div className="mt-3 flex items-center gap-2">
                    {Array.from({ length: challenge.target }, (_, i) => (
                      <span key={i} className={cn('grid h-7 flex-1 place-items-center rounded-lg text-[11px] font-bold', i < challenge.current ? 'bg-white text-[#be185d]' : 'bg-white/20 text-white/70')}>
                        {i < challenge.current ? <Check className="h-4 w-4" /> : i + 1}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] font-semibold text-white/85">
                    {challenge.done ? 'Challenge complete — see you next month!' : `${challenge.current} of ${challenge.target} · ${challenge.daysLeft} day${challenge.daysLeft === 1 ? '' : 's'} left`}
                  </p>
                </div>

                {/* Activity calendar */}
                <Card>
                  <div className="flex items-center justify-between">
                    <SectionTitle icon={Flame}>Activity</SectionTitle>
                    <span className="text-[11px] text-muted-foreground">Last 12 weeks</span>
                  </div>
                  <Heatmap days={days} />
                  <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                    <MiniStat value={`${streak.current}`} label="Current streak" unit={streak.current === 1 ? 'day' : 'days'} accent />
                    <MiniStat value={`${streak.best}`} label="Best streak" unit={streak.best === 1 ? 'day' : 'days'} />
                  </div>
                </Card>

                {/* Achievements */}
                <Card>
                  <div className="flex items-center justify-between">
                    <SectionTitle icon={Medal}>Achievements</SectionTitle>
                    <span className="text-[11px] font-semibold text-muted-foreground">{unlocked} / {badges.length}</span>
                  </div>
                  <Achievements badges={badges} />
                </Card>

                {/* Personal records */}
                <Card>
                  <SectionTitle icon={Sparkles}>Personal records</SectionTitle>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Record icon={Mountain} label="Best day" value={records.bestDaySteps ? `${records.bestDaySteps.toLocaleString('en')} steps` : '—'} />
                    <Record icon={Flame} label="Longest streak" value={records.bestStreak ? `${records.bestStreak} day${records.bestStreak === 1 ? '' : 's'}` : '—'} />
                    <Record icon={MapPin} label="Most places in a day" value={records.mostPlacesInDay ? String(records.mostPlacesInDay) : '—'} />
                    <Record icon={Route} label="Longest walk" value={records.longestWalkM ? formatDistance(records.longestWalkM) : '—'} />
                  </div>
                </Card>

                {/* Recent activity */}
                <Card>
                  <div className="flex items-center justify-between">
                    <SectionTitle icon={Footprints}>Recent activity</SectionTitle>
                    {onViewVisited && store.visits.length > 0 && (
                      <button onClick={onViewVisited} className="flex items-center gap-0.5 text-[11px] font-bold text-primary">Places you've been <ChevronRight className="h-3 w-3" /></button>
                    )}
                  </div>
                  <ActivityFeed items={store.activity.slice(0, 8)} onOpen={openActivity} onExplore={onClose} />
                </Card>

                {/* Saved places */}
                <Card>
                  <div className="flex items-center justify-between">
                    <SectionTitle icon={Bookmark}>Saved places</SectionTitle>
                    {store.saved.length > 0 && (
                      <button onClick={() => onTabChange?.('saved')} className="flex items-center gap-0.5 text-[11px] font-bold text-primary">View all {store.saved.length} <ChevronRight className="h-3 w-3" /></button>
                    )}
                  </div>
                  {store.saved.length ? (
                    <div className="-mx-1 mt-3 flex gap-2.5 overflow-x-auto px-1 pb-1 scroll-touch">
                      {store.saved.slice(0, 10).map(e => (
                        <button key={e.id} onClick={() => openSaved(e)} className="w-28 shrink-0 overflow-hidden rounded-2xl border bg-background text-left tap-scale">
                          <div className="h-16 w-full bg-gradient-to-br from-emerald-100 to-sky-100 dark:from-emerald-950 dark:to-sky-950">
                            {e.imageUrl
                              ? <img src={e.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" onError={ev => { ev.currentTarget.style.display = 'none'; }} />
                              : <div className="grid h-full place-items-center text-primary/60"><MapPin className="h-5 w-5" /></div>}
                          </div>
                          <div className="px-2 py-1.5">
                            <p className="truncate text-[11px] font-bold leading-tight">{e.name}</p>
                            <p className="truncate text-[10px] text-muted-foreground">{e.venueName ?? e.detail ?? ''}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">Tap the bookmark on any place to keep it here for your next visit.</p>
                  )}
                </Card>

                {/* Share */}
                <button onClick={() => void shareWeek()} className="flex w-full items-center gap-3 rounded-2xl border bg-card p-3.5 text-left tap-scale">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white" style={{ background: 'linear-gradient(135deg, #16a34a, #0891b2)' }}><Share2 className="h-5 w-5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold">Share your week</span>
                    <span className="block truncate text-xs text-muted-foreground">{week.steps.toLocaleString('en')} steps · {formatDistance(week.meters)}{streak.current > 1 ? ` · ${streak.current}-day streak` : ''}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>

                {/* ── Settings ── */}
                <div ref={settingsRef} className="scroll-mt-4 space-y-4 pt-2">
                  <Section title="Tools">
                    <Row icon={<QrCode className="h-4 w-4" />} iconColor="blue" label="Scan QR Code" sub="Check in at any location" onClick={() => { onClose(); onOpenQRScanner?.(); }} />
                    <Row icon={<Bookmark className="h-4 w-4" />} iconColor="green" label="Saved places" value={String(store.saved.length)} onClick={() => onTabChange?.('saved')} />
                    <Row icon={<Store className="h-4 w-4" />} iconColor="amber" label="For businesses & venues" sub="Put your venue on Yet New" onClick={() => { onClose(); navigate('/signup'); }} last />
                  </Section>

                  <Section title="Preferences">
                    <Row icon={<Bell className="h-4 w-4" />} iconColor="gray" label="Notifications" toggle={notificationsOn} onClick={handleToggleNotifications} />
                    <Row icon={<Globe className="h-4 w-4" />} iconColor="gray" label="Language" value={LANGUAGES.find(l => l.id === language)?.label ?? language} onClick={() => setLanguageOpen(true)} />
                    <Row icon={appearance === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />} iconColor="gray" label="Dark mode" toggle={appearance === 'dark'} onClick={handleToggleAppearance} last />
                  </Section>

                  <Section title="Account">
                    <Row icon={<UserPen className="h-4 w-4" />} iconColor="gray" label="Edit profile" onClick={() => setEditOpen(true)} />
                    {email
                      ? <Row icon={<Mail className="h-4 w-4" />} iconColor="green" label="Email" value={email} hideChevron />
                      : <Row icon={<Mail className="h-4 w-4" />} iconColor="green" label="Add your email" sub="Keep your progress on every device" onClick={() => setVerifyEmailOpen(true)} />}
                    <Row icon={<Shield className="h-4 w-4" />} iconColor="gray" label="Privacy & data" onClick={() => setPrivacyOpen(true)} />
                    <Row icon={<LogOut className="h-4 w-4" />} iconColor="red" label="Sign out" labelColor="hsl(var(--destructive))" last hideChevron onClick={() => setSignOutOpen(true)} />
                  </Section>
                  <p className="pb-2 text-center text-[11px] text-muted-foreground">Exploring {preferredPark || parkName}</p>
                </div>
              </div>
              <div style={{ height: 80 }} />
            </div>

            <div className="flex-shrink-0 border-t border-border/20 bg-background" style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 16px)' }}>
              <BottomNavPill activeTab="profile" onTabChange={onTabChange} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <EditProfileDialog
        open={editOpen} onOpenChange={setEditOpen}
        initialValues={{ fullName: (visitorName && !visitorName.includes('@')) ? visitorName : '', location: location ?? '', preferredPark: preferredPark ?? parkName }}
        onSave={handleSaveProfile} error={profileError}
      />
      <CreateProfilePrompt open={verifyEmailOpen} onOpenChange={setVerifyEmailOpen} />
      <StepsDetailModal open={stepsModalOpen} onOpenChange={setStepsModalOpen} todaySteps={todaySteps} history={stepsHistory} />

      <Dialog open={goalOpen} onOpenChange={setGoalOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Weekly step goal</DialogTitle>
            <DialogDescription>How many steps do you want to walk each week?</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {GOAL_PRESETS.map(g => (
              <button key={g} onClick={() => { setWeeklyGoal(g); setGoalOpen(false); toast({ title: 'Goal set', description: `${g.toLocaleString('en')} steps a week — about ${formatDistance(g * STRIDE_M)}.` }); }}
                className={cn('rounded-xl border px-3 py-3 text-left transition-colors', store.weeklyGoal === g ? 'border-primary bg-primary/10' : 'hover:bg-muted')}>
                <span className="block text-sm font-bold">{g.toLocaleString('en')}</span>
                <span className="block text-[11px] text-muted-foreground">≈ {formatDistance(g * STRIDE_M)} a week</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={languageOpen} onOpenChange={setLanguageOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Language</DialogTitle>
            <DialogDescription>The language your directions are spoken in.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            {LANGUAGES.map(lang => (
              <button key={lang.id} onClick={() => void handleLanguageSelect(lang)} disabled={!lang.guidance}
                className={cn('flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-sm font-semibold transition-colors disabled:opacity-50',
                  language === lang.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted/60')}>
                <span>{lang.label}</span>
                <span className="text-xs font-normal text-muted-foreground">{lang.native}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={privacyOpen} onOpenChange={setPrivacyOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Privacy & data</AlertDialogTitle>
            <AlertDialogDescription>
              Your saved places, visits and activity are kept on this device, and in your profile once you add an email.
              Navigation preferences and onboarding state stay on this device only.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearLocalData}>Clear local cache</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={signOutOpen} onOpenChange={setSignOutOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out?</AlertDialogTitle>
            <AlertDialogDescription>
              This device forgets your profile, saves and activity. {email ? 'Sign in again with your email to get them back.' : 'Without an email, they can’t be recovered.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleSignOut()}>Sign out</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

// ── pieces ───────────────────────────────────────────────────────────────────

/** A faint isometric grid, the plan-paper of the brand. */
const IsoPattern = () => (
  <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.09]" aria-hidden>
    <defs>
      <pattern id="profile-iso" width="34.64" height="20" patternUnits="userSpaceOnUse">
        <path d="M0 10 L17.32 0 L34.64 10 L17.32 20 Z" fill="none" stroke="white" strokeWidth="1" />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#profile-iso)" />
  </svg>
);

const LevelAvatar = ({ initials, progress, level }: { initials: string; progress: number; level: number }) => {
  const r = 36, c = 2 * Math.PI * r;
  return (
    <div className="relative h-[84px] w-[84px] shrink-0">
      <svg viewBox="0 0 84 84" className="absolute inset-0 -rotate-90">
        <circle cx="42" cy="42" r={r} fill="none" stroke="rgba(255,255,255,.18)" strokeWidth="5" />
        <motion.circle cx="42" cy="42" r={r} fill="none" stroke="url(#lvl)" strokeWidth="5" strokeLinecap="round"
          strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - Math.max(0.03, progress)) }} transition={{ duration: 1, ease: 'easeOut' }} />
        <defs><linearGradient id="lvl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#a3e635" /><stop offset="1" stopColor="#22d3ee" /></linearGradient></defs>
      </svg>
      <div className="absolute inset-[9px] grid place-items-center rounded-full text-xl font-black" style={{ background: 'linear-gradient(145deg, hsl(133 55% 42%), hsl(160 60% 28%))', boxShadow: 'inset 0 2px 8px rgba(0,0,0,.25)' }}>
        {initials}
      </div>
      <span className="absolute -bottom-0.5 right-0 grid h-7 min-w-7 place-items-center rounded-full border-2 border-[hsl(158_62%_20%)] bg-lime-300 px-1 text-xs font-black text-[hsl(152_72%_14%)]">{level}</span>
    </div>
  );
};

const Card = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-3xl border bg-card p-4 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">{children}</div>
);

const SectionTitle = ({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) => (
  <p className="flex items-center gap-1.5 text-sm font-black"><Icon className="h-4 w-4 text-primary" /> {children}</p>
);

const GoalRing = ({ value, goal }: { value: number; goal: number }) => {
  const r = 34, c = 2 * Math.PI * r, k = Math.min(1, value / Math.max(1, goal));
  return (
    <div className="relative h-[88px] w-[88px] shrink-0">
      <svg viewBox="0 0 88 88" className="-rotate-90">
        <circle cx="44" cy="44" r={r} fill="none" className="stroke-muted" strokeWidth="9" />
        <motion.circle cx="44" cy="44" r={r} fill="none" stroke={k >= 1 ? '#16a34a' : 'hsl(var(--primary))'} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - k) }} transition={{ duration: 1, ease: 'easeOut' }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="text-base font-black leading-none tabular-nums">{formatSteps(value)}</p>
          <p className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{Math.round(k * 100)}%</p>
        </div>
      </div>
    </div>
  );
};

const WeekBars = ({ week, goalPerDay }: { week: ReturnType<typeof thisWeek>['week']; goalPerDay: number }) => {
  const max = Math.max(goalPerDay, ...week.map(d => d.steps), 1);
  return (
    <div className="flex h-16 items-end gap-1.5">
      {week.map(d => (
        <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
          <div className="relative flex h-12 w-full items-end overflow-hidden rounded-md bg-muted">
            <motion.div className={cn('w-full rounded-md', d.steps >= goalPerDay ? 'bg-emerald-500' : 'bg-primary/70')}
              initial={{ height: 0 }} animate={{ height: `${(d.steps / max) * 100}%` }} transition={{ duration: 0.6, ease: 'easeOut' }} />
          </div>
          <span className={cn('text-[10px] font-bold', d.today ? 'text-primary' : d.future ? 'text-muted-foreground/40' : 'text-muted-foreground')}>{d.label}</span>
        </div>
      ))}
    </div>
  );
};

const HEAT = ['bg-muted', 'bg-emerald-200 dark:bg-emerald-900', 'bg-emerald-400 dark:bg-emerald-700', 'bg-emerald-600 dark:bg-emerald-500', 'bg-emerald-800 dark:bg-emerald-300'];
const heatLevel = (d: DayStat) => (!d.active ? 0 : d.steps >= 10_000 || d.places >= 4 ? 4 : d.steps >= 5000 || d.places >= 3 ? 3 : d.steps >= 2000 || d.places >= 2 ? 2 : 1);

const Heatmap = ({ days }: { days: DayStat[] }) => {
  // Columns are weeks (Monday at the top), the last one this week.
  const first = new Date(days[0].date + 'T00:00:00');
  const pad = (first.getDay() + 6) % 7;
  const cells: (DayStat | null)[] = [...Array.from({ length: pad }, () => null), ...days];
  const weeks: (DayStat | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return (
    <div className="mt-3">
      <div className="flex gap-[3px]">
        <div className="mr-1 grid grid-rows-7 gap-[3px] text-[8px] font-bold leading-none text-muted-foreground">
          {['M', '', 'W', '', 'F', '', 'S'].map((l, i) => <span key={i} className="flex h-[13px] items-center">{l}</span>)}
        </div>
        {weeks.map((w, i) => (
          <div key={i} className="grid flex-1 grid-rows-7 gap-[3px]">
            {Array.from({ length: 7 }, (_, j) => {
              const d = w[j];
              return <span key={j} title={d ? `${d.date}: ${d.steps.toLocaleString('en')} steps${d.places ? `, ${d.places} place${d.places > 1 ? 's' : ''}` : ''}` : undefined}
                className={cn('h-[13px] rounded-[3px]', d ? HEAT[heatLevel(d)] : 'bg-transparent')} />;
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-end gap-1 text-[9px] text-muted-foreground">
        Less {HEAT.map(c => <span key={c} className={cn('h-2.5 w-2.5 rounded-[3px]', c)} />)} More
      </div>
    </div>
  );
};

const MiniStat = ({ value, label, unit, accent }: { value: string; label: string; unit: string; accent?: boolean }) => (
  <div className={cn('rounded-2xl px-3 py-2.5', accent ? 'bg-orange-500/10' : 'bg-muted/60')}>
    <p className={cn('text-xl font-black leading-none tabular-nums', accent && 'text-orange-600 dark:text-orange-400')}>{value} <span className="text-xs font-semibold text-muted-foreground">{unit}</span></p>
    <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
  </div>
);

const Achievements = ({ badges }: { badges: BadgeState[] }) => {
  const next = [...badges].filter(b => !b.unlocked).sort((a, b) => b.progress - a.progress)[0];
  const [picked, setPicked] = useState<string | null>(null);
  const shown = badges.find(b => b.def.id === picked) ?? next ?? null;
  return (
    <div className="mt-3">
      <div className="grid grid-cols-5 gap-x-1 gap-y-3">
        {badges.map((b, i) => {
          const Icon = BADGE_ICONS[b.def.icon];
          const r = 19, c = 2 * Math.PI * r;
          return (
            <motion.button key={b.def.id} onClick={() => setPicked(b.def.id)} aria-label={`${b.def.label}: ${b.unlocked ? 'unlocked' : b.def.hint}`}
              initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.03 }}
              className={cn('flex flex-col items-center gap-1 rounded-xl p-0.5', shown?.def.id === b.def.id && 'bg-muted')}>
              <span className="relative grid h-11 w-11 place-items-center">
                {!b.unlocked && (
                  <svg viewBox="0 0 44 44" className="absolute inset-0 -rotate-90">
                    <circle cx="22" cy="22" r={r} fill="none" className="stroke-muted" strokeWidth="3" />
                    <circle cx="22" cy="22" r={r} fill="none" stroke={b.def.color} strokeOpacity={0.7} strokeWidth="3" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - b.progress)} />
                  </svg>
                )}
                <span className={cn('grid h-9 w-9 place-items-center rounded-full', !b.unlocked && 'bg-muted text-muted-foreground')}
                  style={b.unlocked ? { background: `linear-gradient(145deg, ${b.def.color}, ${b.def.color}cc)`, color: 'white', boxShadow: `0 4px 12px -4px ${b.def.color}` } : undefined}>
                  <Icon className="h-[18px] w-[18px]" />
                </span>
              </span>
              <span className={cn('line-clamp-2 text-center text-[9px] font-bold leading-tight', b.unlocked ? 'text-foreground' : 'text-muted-foreground')}>{b.def.label}</span>
            </motion.button>
          );
        })}
      </div>
      {shown && (
        <div className="mt-3 flex items-center gap-3 rounded-2xl bg-muted/60 p-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white" style={{ background: shown.unlocked ? shown.def.color : 'hsl(var(--muted-foreground))' }}>
            {React.createElement(BADGE_ICONS[shown.def.icon], { className: 'h-4 w-4' })}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold">{shown.unlocked ? `${shown.def.label} — unlocked` : picked ? shown.def.label : `Next up: ${shown.def.label}`}</p>
            <p className="text-[11px] text-muted-foreground">{shown.def.hint}</p>
            {!shown.unlocked && (
              <div className="mt-1.5 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-background"><div className="h-full rounded-full" style={{ width: `${shown.progress * 100}%`, background: shown.def.color }} /></div>
                <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">{Math.min(shown.current, shown.def.target).toLocaleString('en')} / {shown.def.target.toLocaleString('en')}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const Record = ({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) => (
  <div className="rounded-2xl bg-muted/60 p-3">
    <Icon className="h-4 w-4 text-primary" />
    <p className="mt-1.5 text-sm font-black leading-tight">{value}</p>
    <p className="text-[10px] font-semibold text-muted-foreground">{label}</p>
  </div>
);

const ACTIVITY_LOOK: Record<ActivityEntry['kind'], { icon: LucideIcon; color: string }> = {
  walk: { icon: Footprints, color: '#16a34a' },
  visit: { icon: MapPin, color: '#0891b2' },
  save: { icon: Bookmark, color: '#db2777' },
};

const ActivityFeed = ({ items, onOpen, onExplore }: { items: ActivityEntry[]; onOpen: (a: ActivityEntry) => void; onExplore: () => void }) => {
  if (!items.length) {
    return (
      <div className="mt-3 rounded-2xl bg-muted/50 p-4 text-center">
        <p className="text-sm font-bold">Nothing here yet</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Walk to a place with directions, scan a QR code or save a place — it all shows up here.</p>
        <button onClick={onExplore} className="mt-3 rounded-full bg-primary px-4 py-2 text-xs font-bold text-primary-foreground">Start exploring</button>
      </div>
    );
  }
  return (
    <ol className="relative mt-3 space-y-1">
      {items.map(a => {
        const look = ACTIVITY_LOOK[a.kind];
        const clickable = !!(a.buildingId && a.placeId);
        return (
          <li key={a.id}>
            <button onClick={() => onOpen(a)} disabled={!clickable} className="flex w-full items-start gap-3 rounded-2xl p-2 text-left enabled:hover:bg-muted/60">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: `${look.color}1a`, color: look.color }}><look.icon className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold leading-tight">{a.title}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{[a.venueName, timeAgo(a.at)].filter(Boolean).join(' · ')}</span>
                {a.kind === 'walk' && (a.steps || a.meters || a.seconds) ? (
                  <span className="mt-1 flex flex-wrap gap-1">
                    {a.steps ? <Chip>{a.steps.toLocaleString('en')} steps</Chip> : null}
                    {a.meters ? <Chip>{formatDistance(a.meters)}</Chip> : null}
                    {a.seconds ? <Chip>{a.seconds >= 60 ? `${Math.round(a.seconds / 60)} min` : `${a.seconds} s`}</Chip> : null}
                  </span>
                ) : null}
              </span>
              {clickable && <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-muted-foreground/60" />}
            </button>
          </li>
        );
      })}
    </ol>
  );
};

const Chip = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{children}</span>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <p className="mb-2 px-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground">{title}</p>
    <div className="overflow-hidden rounded-2xl border bg-card">{children}</div>
  </div>
);

const ICON_BG: Record<string, string> = {
  green: 'hsl(152 70% 22% / 0.10)', amber: 'hsl(38 80% 50% / 0.12)', blue: 'hsl(210 80% 50% / 0.10)', gray: 'hsl(var(--muted))', red: 'hsl(var(--destructive) / 0.10)',
};
const ICON_COLOR: Record<string, string> = {
  green: 'hsl(152 60% 32%)', amber: 'hsl(38 70% 40%)', blue: 'hsl(210 70% 45%)', gray: 'hsl(var(--muted-foreground))', red: 'hsl(var(--destructive))',
};

interface RowProps {
  icon: React.ReactNode;
  iconColor: 'green' | 'amber' | 'blue' | 'gray' | 'red';
  label: string;
  labelColor?: string;
  sub?: string;
  value?: string;
  /** Shows a switch instead of a value. */
  toggle?: boolean;
  last?: boolean;
  hideChevron?: boolean;
  onClick?: () => void;
}

const Row: React.FC<RowProps> = ({ icon, iconColor, label, labelColor, sub, value, toggle, last, hideChevron, onClick }) => (
  <div
    role={onClick ? (toggle !== undefined ? 'switch' : 'button') : undefined}
    aria-checked={toggle !== undefined ? toggle : undefined}
    tabIndex={onClick ? 0 : undefined}
    onClick={onClick}
    onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    className={cn('flex items-center gap-3 px-4 py-[13px] transition-colors', onClick && 'cursor-pointer active:bg-muted/40 hover:bg-muted/30', !last && 'border-b border-border/50')}
  >
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: ICON_BG[iconColor], color: ICON_COLOR[iconColor] }}>{icon}</div>
    <div className="min-w-0 flex-1">
      <p className="text-sm font-semibold leading-tight" style={{ color: labelColor ?? 'hsl(var(--foreground))' }}>{label}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
    <div className="flex shrink-0 items-center gap-1">
      {toggle !== undefined ? (
        <span className={cn('relative h-6 w-10 rounded-full transition-colors', toggle ? 'bg-primary' : 'bg-muted-foreground/30')}>
          <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', toggle ? 'left-[18px]' : 'left-0.5')} />
        </span>
      ) : (
        <>
          {value && <span className="max-w-[160px] truncate text-[13px] font-medium text-muted-foreground">{value}</span>}
          {!hideChevron && onClick && <ChevronRight className="h-4 w-4 text-border" />}
        </>
      )}
    </div>
  </div>
);

export default ProfilePage;
