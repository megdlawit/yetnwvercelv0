
export const sstep=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t)};
export const cl=v=>Math.min(1,Math.max(0,v));
export const ease=u=>u<.5?2*u*u:1-Math.pow(-2*u+2,2)/2;
export const RM=matchMedia('(prefers-reduced-motion:reduce)').matches;
export function rng(a){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
export const R=rng(9);
