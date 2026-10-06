import * as THREE0 from 'three-r128';
const THREE:any=THREE0;
import { rng } from './util';

export /* ================= textures ================= */
function cvTex(w,hh,fn){const c=document.createElement('canvas');c.width=w;c.height=hh;fn(c.getContext('2d'),w,hh);const t=new THREE.CanvasTexture(c);t.anisotropy=4;return t}
export function woodTex(){const r=rng(4);const t=cvTex(256,256,(x)=>{for(let i=0;i<8;i++){const g=150+Math.floor(r()*34);x.fillStyle=`rgb(${g},${Math.round(g*.66)},${Math.round(g*.42)})`;x.fillRect(0,i*32,256,32);
  for(let k=0;k<26;k++){x.fillStyle=`rgba(70,35,12,${.04+r()*.07})`;x.fillRect(r()*256,i*32+r()*32,20+r()*80,1)}
  x.fillStyle='rgba(40,20,8,.35)';x.fillRect(0,i*32,256,1.5);const o=Math.floor(r()*256);x.fillRect(o,i*32,1.5,32);x.fillRect((o+128)%256,i*32,1.5,32)}});t.wrapS=t.wrapT=THREE.RepeatWrapping;return t}
export function carpetTex(base,b2){return cvTex(256,256,(x)=>{x.fillStyle=base;x.fillRect(0,0,256,256);x.strokeStyle='#d4ad55';x.lineWidth=6;x.strokeRect(14,14,228,228);x.lineWidth=2;x.strokeRect(26,26,204,204);
  x.fillStyle=b2;for(let i=0;i<5;i++)for(let j=0;j<5;j++){const cx=48+i*40,cy=48+j*40;x.beginPath();x.moveTo(cx,cy-12);x.lineTo(cx+12,cy);x.lineTo(cx,cy+12);x.lineTo(cx-12,cy);x.fill()}
  x.fillStyle='rgba(212,173,85,.75)';x.beginPath();x.arc(128,128,30,0,7);x.fill()})}
export function artTex(kind,seed){const r=rng(seed);return cvTex(192,240,(x,w,hh)=>{
 if(kind==='p'){const g=x.createLinearGradient(0,0,0,hh);g.addColorStop(0,['#3d4a33','#4a3a2a','#2f3d48'][seed%3]);g.addColorStop(1,'#16140f');x.fillStyle=g;x.fillRect(0,0,w,hh);
  x.fillStyle='#2a1a12';x.beginPath();x.ellipse(96,262,86,110,0,0,7);x.fill();x.fillStyle='#e9e2d0';x.beginPath();x.ellipse(96,250,46,96,0,0,7);x.fill();
  x.fillStyle='#c9a24a';x.fillRect(66,176,60,6);x.fillStyle='#5a3a26';x.beginPath();x.ellipse(96,112,30,38,0,0,7);x.fill();
  x.fillStyle='#1d140e';x.beginPath();x.ellipse(96,82,32,16,0,Math.PI,0);x.fill();x.fillRect(66,112,4,20);x.fillRect(122,112,4,20)}
 else{const g=x.createLinearGradient(0,0,0,hh);g.addColorStop(0,'#9ec3cf');g.addColorStop(.6,'#efe0bd');x.fillStyle=g;x.fillRect(0,0,w,hh);
  for(let k=0;k<3;k++){x.fillStyle=['#6f8f4a','#55763c','#3f5e2f'][k];x.beginPath();x.moveTo(0,hh);for(let i=0;i<=8;i++)x.lineTo(i*w/8,130+k*30+Math.sin(i*1.3+seed+k)*18);x.lineTo(w,hh);x.fill()}
  for(let i=0;i<6;i++){const tx=r()*w,ty=160+r()*50;x.fillStyle='#2e4a24';x.beginPath();x.arc(tx,ty,8+r()*8,0,7);x.fill()}}
 x.fillStyle='rgba(255,240,200,.06)';for(let i=0;i<300;i++)x.fillRect(r()*w,r()*hh,2,1)})}
export function chevTex(){const t=cvTex(64,128,(x)=>{x.fillStyle='#2bbf45';x.fillRect(0,0,64,128);x.fillStyle='#1f9a37';x.fillRect(0,0,6,128);x.fillRect(58,0,6,128);
  x.strokeStyle='rgba(235,255,230,.95)';x.lineWidth=9;x.lineCap='round';x.lineJoin='round';x.beginPath();x.moveTo(17,82);x.lineTo(32,58);x.lineTo(47,82);x.stroke()});t.wrapS=t.wrapT=THREE.RepeatWrapping;return t}
