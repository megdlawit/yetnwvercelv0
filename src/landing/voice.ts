import { N, Z } from './state';
import { POI } from './scene/story';

export /* ================= voice: navigation always wins over narration ================= */
const SY=window.speechSynthesis||null;export let VOICES:any=[];
export const loadV=()=>{try{VOICES=SY?SY.getVoices():[]}catch(e){VOICES=[]}};if(SY){loadV();SY.onvoiceschanged=loadV}
export const vFor=l=>VOICES.find(v=>v.lang&&v.lang.toLowerCase().startsWith(l==='am'?'am':'en'));
export const hasVoice=l=>!!SY&&(l==='en'||!!vFor('am'));
export const est=(t,l)=>l==='am'?t.length*.11+.5:t.split(/\s+/).length*.37+.4;
export let TOK=0;
export function hush(){TOK++;try{SY&&SY.cancel()}catch(e){}}
export function say(text,l,cb){const tok=++TOK;let done=false;const fire=()=>{if(done||tok!==TOK)return;done=true;cb&&cb()};
 const ok=Z.voice&&hasVoice(l);
 if(!ok){setTimeout(fire,est(text,l)*1000);return}
 try{const u=new SpeechSynthesisUtterance(text);const v=vFor(l);if(v)u.voice=v;u.lang=l==='am'?'am-ET':'en-US';u.onend=fire;u.onerror=fire;SY.speak(u);
  setTimeout(()=>{if(!SY.speaking)fire()},est(text,l)*1000+2500)}catch(e){setTimeout(fire,est(text,l)*1000)}}
export const nS=()=>POI.poi2.s[Z.lang];
export const nCum=i=>{const a=nS();let s=0;for(let j=0;j<Math.min(i,a.length);j++)s+=est(a[j],Z.lang);return s};
export const nDur=()=>nCum(99);
export function narSpeak(){if(!N.on||N.ducked)return;const a=nS();if(N.i>=a.length){N.on=false;N.el=nDur();Z.bump();return}N.el=nCum(N.i);
 say(a[N.i],Z.lang,()=>{N.i++;Z.bump();narSpeak()})}
export function narStart(){hush();N.on=true;N.i=0;N.el=0;N.ducked=false;Z.duck=false;narSpeak();Z.bump()}
export function narStop(){N.on=false;N.ducked=false;Z.duck=false;hush()}
export function navSay(text){const nar=N.on;hush();if(nar){N.ducked=true;Z.duck=true;Z.bump()}
 say(text,Z.lang,()=>{if(N.ducked){N.ducked=false;Z.duck=false;Z.bump();narSpeak()}})}
export const fmtT=s=>{s=Math.max(0,Math.round(s));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')};
