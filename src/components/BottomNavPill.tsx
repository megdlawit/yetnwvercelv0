import React from 'react';
import { Compass, BookmarkPlus, CircleUserRound } from 'lucide-react';

export interface BottomNavPillProps {
  activeTab?: 'explore' | 'saved' | 'profile';
  onTabChange?: (tab: 'explore' | 'saved' | 'profile') => void;
}

const BottomNavPill: React.FC<BottomNavPillProps> = ({ activeTab = 'explore', onTabChange }) => (
  <div className="px-4 pt-1 pb-safe" style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 16px)' }}>
    <div className="bottom-nav-pill flex items-center justify-between px-2 py-1.5">
      <button
        onClick={() => onTabChange?.('explore')}
        className={`flex items-center gap-2 rounded-full px-4 py-2.5 transition-all tap-scale ${activeTab === 'explore' ? 'nav-tab-active' : ''}`}
      >
        <Compass className={`w-5 h-5 ${activeTab === 'explore' ? 'text-white' : 'text-white/60'}`} strokeWidth={2} />
        {activeTab === 'explore' && <span className="text-sm font-bold text-white">Explore</span>}
      </button>

      <button
        onClick={() => onTabChange?.('saved')}
        className={`flex items-center gap-2 rounded-full px-4 py-2.5 transition-all tap-scale ${activeTab === 'saved' ? 'nav-tab-active' : ''}`}
      >
        <BookmarkPlus className={`w-5 h-5 ${activeTab === 'saved' ? 'text-white' : 'text-white/60'}`} strokeWidth={2} />
        {activeTab === 'saved' && <span className="text-sm font-bold text-white">Saved</span>}
      </button>

      <button
        onClick={() => onTabChange?.('profile')}
        className={`flex items-center gap-2 rounded-full px-4 py-2.5 transition-all tap-scale ${activeTab === 'profile' ? 'nav-tab-active' : ''}`}
      >
        <CircleUserRound className={`w-5 h-5 ${activeTab === 'profile' ? 'text-white' : 'text-white/60'}`} strokeWidth={2} />
        {activeTab === 'profile' && <span className="text-sm font-bold text-white">Profile</span>}
      </button>
    </div>
  </div>
);

export default BottomNavPill;
