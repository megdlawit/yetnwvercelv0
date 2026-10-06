// The landing page: the Indoor experience — intro, the 3D park hero, the
// journey to Menelik II Palace and the indoor museum tour — exactly as the
// original prototype (src/landing), on its own full-screen page.

import App from '@/landing/ui/App';

export default function Landing() {
  return (
    <div className="indoor-landing fixed inset-0 overflow-hidden bg-paper font-inter text-ink [color-scheme:light] [padding-bottom:env(safe-area-inset-bottom,0px)] [padding-top:env(safe-area-inset-top,0px)]">
      <App />
    </div>
  );
}
