import React, { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import { motion } from 'framer-motion';

const ThemeToggle: React.FC = () => {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const dark = saved === 'dark' || (!saved && prefersDark);
    setIsDark(dark);
    document.documentElement.classList.toggle('dark', dark);
  }, []);

  const toggle = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  };

  return (
    <motion.button
      onClick={toggle}
      whileTap={{ scale: 0.95 }}
      className="w-10 h-10 rounded-2xl bg-card border border-border/50 flex items-center justify-center hover:border-primary/30 transition-colors shadow-lg"
      style={{ boxShadow: '0 2px 12px -2px hsl(220 25% 10% / 0.1)' }}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark
        ? <Sun className="w-4 h-4 text-amber-400" />
        : <Moon className="w-4 h-4 text-muted-foreground" />
      }
    </motion.button>
  );
};

export default ThemeToggle;
