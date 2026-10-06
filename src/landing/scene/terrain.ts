// @ts-nocheck -- imperative three.js scene ported verbatim from the prototype; typed loosely on purpose
import * as THREE0 from 'three-r128';
const THREE:any=THREE0;
import { A, Z } from '../state';
import { GY, MS, MX, MZ, X0, X1, Y0, Y1 } from './places';
import { rng } from './util';
import { FOOT, PARK, PATHS, WATER, Z_FOREST, Z_MID, Z_PLAZA, Z_SAND } from './parkShapes';

export function merge(parts){const pos=[],nor=[];
  for(const [g0,m] of parts){const g=g0.index?g0.toNonIndexed():g0;g.applyMatrix4(m);g.computeVertexNormals();pos.push(...g.attributes.position.array);nor.push(...g.attributes.normal.array)}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3));return g}
export const T=(x,y,z,s=1,sy)=>new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion(),new THREE.Vector3(s,sy||s,s));
export function crownGeo(r,d=1){const g=new THREE.IcosahedronGeometry(r,d),p=g.attributes.position;
  for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),k=1+.12*Math.sin(x*6+y*3.1)*Math.cos(z*5.3+x*2)+.07*Math.sin(y*9+z*4);p.setXYZ(i,x*k,y*k*.9,z*k)}return g}
export function facade(base,win,rx,ry,arch){const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');
  x.fillStyle=base;x.fillRect(0,0,64,64);x.fillStyle='rgba(0,0,0,.08)';x.fillRect(0,58,64,6);x.fillStyle='rgba(255,255,255,.18)';x.fillRect(0,0,64,3);
  x.fillStyle=win;if(arch){x.beginPath();x.moveTo(20,50);x.lineTo(20,26);x.arc(32,26,12,Math.PI,0);x.lineTo(44,50);x.fill()}else x.fillRect(20,16,24,34);
  x.fillStyle='rgba(255,255,255,.28)';x.fillRect(20,16,24,5);x.fillStyle='rgba(0,0,0,.18)';x.fillRect(31,16,2,34);x.fillStyle='rgba(0,0,0,.1)';x.fillRect(18,50,28,3);
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(rx,ry);t.anisotropy=4;return new THREE.MeshStandardMaterial({map:t,roughness:.88})}
export /* hip / gable roof: ridge runs along the longer side (or along z when alongZ) */
function hipGeo(w,d,h,o=.12,gable,alongZ){if(alongZ){const g=hipGeo(d,w,h,o,gable);g.rotateY(Math.PI/2);return g}
  const X=w/2+o,Z=d/2+o,lx=gable?X:Math.max(0,X-Z);const v=[];const q=(a,b,c)=>v.push(...a,...b,...c);
  const A=[-X,0,Z],B=[X,0,Z],C=[X,0,-Z],D=[-X,0,-Z],r0=[-lx,h,0],r1=[lx,h,0];
  q(A,B,r1);q(A,r1,r0);q(C,D,r0);q(C,r0,r1);q(B,C,r1);q(D,A,r0);
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.computeVertexNormals();return g}

export /* ---- the map painter: one set of shapes, painted three ways (colour, height, tree density) ---- */
function sPoly(x,p,closed){const n=p.length,m=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2];x.beginPath();
  if(closed){const s=m(p[n-1],p[0]);x.moveTo(s[0],s[1]);for(let i=0;i<n;i++){const e=m(p[i],p[(i+1)%n]);x.quadraticCurveTo(p[i][0],p[i][1],e[0],e[1])}x.closePath()}
  else{x.moveTo(p[0][0],p[0][1]);for(let i=1;i<n-1;i++){const e=m(p[i],p[i+1]);x.quadraticCurveTo(p[i][0],p[i][1],e[0],e[1])}x.lineTo(p[n-1][0],p[n-1][1])}}
export function mkCanvas(sc){const c=document.createElement('canvas');c.width=Math.round((X1-X0)*sc);c.height=Math.round((Y1-Y0)*sc);const x=c.getContext('2d');x.setTransform(sc,0,0,sc,-X0*sc,-Y0*sc);return[c,x]}
export function paintColor(){const [c,x]=mkCanvas(1.7),r=rng(21);
  x.fillStyle='#e6e2d8';x.fillRect(X0,Y0,X1-X0,Y1-Y0);
  x.lineJoin='round';x.lineCap='round';
  sPoly(x,PARK,1);x.strokeStyle='#d2cec4';x.lineWidth=64;x.stroke();x.strokeStyle='#dcd8cf';x.lineWidth=18;x.setLineDash([2,14]);x.stroke();x.setLineDash([]);
  /* the two city roads leaving the park, as on the map */
  [[[1050,1014],[1060,1110]],[[420,935],[330,1110]]].forEach(p=>{sPoly(x,p,0);x.strokeStyle='#d2cec4';x.lineWidth=46;x.stroke()});
  sPoly(x,PARK,1);x.fillStyle='#8fca4e';x.fill();x.strokeStyle='#e4efc6';x.lineWidth=6;x.stroke();
  x.save();sPoly(x,PARK,1);x.clip();
  Z_MID.forEach(p=>{sPoly(x,p,1);x.fillStyle='#6fb43a';x.fill()});
  Z_FOREST.forEach(p=>{sPoly(x,p,1);x.fillStyle='#4a9a35';x.fill()});
  Z_SAND.forEach(p=>{sPoly(x,p,1);x.fillStyle='#c8b28c';x.fill();x.strokeStyle='rgba(120,95,60,.25)';x.lineWidth=3;x.stroke()});
  /* grass grain */
  for(let i=0;i<26000;i++){const px=X0+r()*(X1-X0),py=Y0+r()*(Y1-Y0);x.fillStyle=r()<.5?'rgba(220,255,160,.12)':'rgba(30,80,20,.10)';x.fillRect(px,py,1.6+r()*2,1.2)}
  Z_PLAZA.forEach(e=>{x.beginPath();x.ellipse(e[0],e[1],e[2],e[3],0,0,7);x.fillStyle='#e9e3d4';x.fill();x.strokeStyle='rgba(150,135,110,.35)';x.lineWidth=1.5;x.stroke()});
  FOOT.forEach(f=>{x.fillStyle='rgba(60,50,30,.16)';x.fillRect(f[0]-f[2]/2-3,f[1]-f[3]/2-1,f[2]+8,f[3]+8)});
  PATHS.forEach(p=>{sPoly(x,p[1],0);x.strokeStyle='rgba(120,110,90,.28)';x.lineWidth=p[0]+3;x.stroke()});
  PATHS.forEach(p=>{sPoly(x,p[1],0);x.strokeStyle='#f6f3ea';x.lineWidth=p[0];x.stroke()});
  PATHS.forEach(p=>{if(!p[2])return;sPoly(x,p[1],0);x.strokeStyle='rgba(98,170,220,.75)';x.lineWidth=1.6;x.setLineDash([2,5]);x.stroke();x.setLineDash([])});
  WATER.line.forEach(l=>{sPoly(x,l,0);x.strokeStyle='#d9e9df';x.lineWidth=13;x.stroke();x.strokeStyle='#4f9fbd';x.lineWidth=8;x.stroke()});
  WATER.ell.forEach(e=>{x.beginPath();x.ellipse(e[0],e[1],e[2]+3,e[3]+3,e[4]*Math.PI/180,0,7);x.fillStyle='#e3eee2';x.fill();
    const g=x.createRadialGradient(e[0],e[1],1,e[0],e[1],Math.max(e[2],e[3]));g.addColorStop(0,'#6cc0d6');g.addColorStop(1,'#3f8fae');
    x.beginPath();x.ellipse(e[0],e[1],e[2],e[3],e[4]*Math.PI/180,0,7);x.fillStyle=g;x.fill()});
  x.restore();
  /* soft fade into the page */
  const [m,mx]=mkCanvas(1.7);mx.lineJoin='round';sPoly(mx,PARK,1);mx.fillStyle='#fff';mx.fill();mx.strokeStyle='#fff';mx.lineWidth=110;mx.stroke();
  const [m2,mx2]=mkCanvas(1.7);mx2.setTransform(1,0,0,1,0,0);mx2.filter='blur(34px)';mx2.drawImage(m,0,0);
  x.setTransform(1,0,0,1,0,0);x.globalCompositeOperation='destination-in';x.drawImage(m2,0,0);x.globalCompositeOperation='source-over';
  const t=new THREE.CanvasTexture(c);t.anisotropy=8;return t}
export const HSC=.5;export let HMAP:any=null,DMAP=null;
export function paintHeight(){const [c,x]=mkCanvas(HSC);x.fillStyle='#000';x.fillRect(X0,Y0,X1-X0,Y1-Y0);x.lineJoin='round';
  sPoly(x,PARK,1);x.fillStyle='rgb(128,128,128)';x.fill();
  x.save();sPoly(x,PARK,1);x.clip();
  Z_SAND.forEach(p=>{sPoly(x,p,1);x.fillStyle='rgb(119,119,119)';x.fill()});
  x.globalCompositeOperation='lighter';
  [[1250,700,150,38],[1320,640,90,24],[700,520,80,12],[470,330,70,18],[1200,880,70,16],[400,560,80,12]].forEach(h=>{const g=x.createRadialGradient(h[0],h[1],0,h[0],h[1],h[2]);g.addColorStop(0,`rgb(${h[3]},${h[3]},${h[3]})`);g.addColorStop(1,'rgb(0,0,0)');x.fillStyle=g;x.fillRect(h[0]-h[2],h[1]-h[2],h[2]*2,h[2]*2)});
  x.globalCompositeOperation='source-over';
  /* flatten paths and plazas back to ground level */
  PATHS.forEach(p=>{sPoly(x,p[1],0);x.strokeStyle='rgba(128,128,128,.85)';x.lineWidth=p[0]+10;x.stroke()});
  FOOT.forEach(f=>{x.fillStyle='rgb(128,128,128)';x.fillRect(f[0]-f[2]/2-6,f[1]-f[3]/2-6,f[2]+12,f[3]+12)});
  WATER.ell.forEach(e=>{x.beginPath();x.ellipse(e[0],e[1],e[2],e[3],e[4]*Math.PI/180,0,7);x.fillStyle='rgb(96,96,96)';x.fill()});
  WATER.line.forEach(l=>{sPoly(x,l,0);x.strokeStyle='rgb(104,104,104)';x.lineWidth=8;x.stroke()});
  x.restore();
  const [c2,x2]=mkCanvas(HSC);x2.setTransform(1,0,0,1,0,0);x2.filter='blur(2.5px)';x2.drawImage(c,0,0);
  const d=x2.getImageData(0,0,c2.width,c2.height).data,f=new Float32Array(c2.width*c2.height);for(let i=0;i<f.length;i++)f[i]=d[i*4]/255;
  HMAP={w:c2.width,h:c2.height,f}}
export function paintDensity(){const [c,x]=mkCanvas(HSC);x.fillStyle='#000';x.fillRect(X0,Y0,X1-X0,Y1-Y0);x.lineJoin='round';x.lineCap='round';
  sPoly(x,PARK,1);x.fillStyle='rgb(26,0,0)';x.fill();x.save();sPoly(x,PARK,1);x.clip();
  Z_MID.forEach((p,i)=>{sPoly(x,p,1);x.fillStyle=i===2?'rgb(30,0,0)':'rgb(60,0,0)';x.fill()});
  Z_FOREST.forEach((p,i)=>{sPoly(x,p,1);x.fillStyle=i===0?'rgb(120,0,0)':'rgb(235,0,0)';x.fill()});
  Z_SAND.forEach(p=>{sPoly(x,p,1);x.fillStyle='rgb(40,0,0)';x.fill()});
  x.fillStyle='#000';
  Z_PLAZA.forEach(e=>{x.beginPath();x.ellipse(e[0],e[1],e[2]+8,e[3]+8,0,0,7);x.fill()});
  FOOT.forEach(f=>x.fillRect(f[0]-f[2]/2-8,f[1]-f[3]/2-8,f[2]+16,f[3]+16));
  x.fillRect(880,545,100,70);x.fillRect(800,600,190,40);
  PATHS.forEach(p=>{sPoly(x,p[1],0);x.strokeStyle='#000';x.lineWidth=p[0]+14;x.stroke()});
  WATER.ell.forEach(e=>{x.beginPath();x.ellipse(e[0],e[1],e[2]+8,e[3]+8,e[4]*Math.PI/180,0,7);x.fill()});
  WATER.line.forEach(l=>{sPoly(x,l,0);x.lineWidth=22;x.stroke()});
  x.restore();
  const d=x.getImageData(0,0,c.width,c.height).data,f=new Float32Array(c.width*c.height);for(let i=0;i<f.length;i++)f[i]=d[i*4]/255;DMAP={w:c.width,h:c.height,f}}
export const samp=(M_,x,z)=>{if(!M_)return 0;const u=((x*MS+MX)-X0)*HSC,v=((z*MS+MZ)-Y0)*HSC;const i=Math.floor(u),j=Math.floor(v);if(i<0||j<0||i>=M_.w-1||j>=M_.h-1)return 0;
  const a=u-i,b=v-j,f=M_.f,w=M_.w;return (f[j*w+i]*(1-a)+f[j*w+i+1]*a)*(1-b)+(f[(j+1)*w+i]*(1-a)+f[(j+1)*w+i+1]*a)*b};
export const TH=(x,z)=>samp(HMAP,x,z)*255/128*GY;
export const DEN=(x,z)=>samp(DMAP,x,z);
