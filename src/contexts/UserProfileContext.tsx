import { createContext, useContext, type ReactNode } from 'react';
import { useUserProfile } from '@/hooks/useUserProfile';

type UserProfileContextValue = ReturnType<typeof useUserProfile>;

const UserProfileContext = createContext<UserProfileContextValue | null>(null);

export function UserProfileProvider({ children }: { children: ReactNode }) {
  const value = useUserProfile();
  return (
    <UserProfileContext.Provider value={value}>
      {children}
    </UserProfileContext.Provider>
  );
}

export function useProfile() {
  const ctx = useContext(UserProfileContext);
  if (!ctx) {
    throw new Error('useProfile must be used within UserProfileProvider');
  }
  return ctx;
}
