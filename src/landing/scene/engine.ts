// @ts-nocheck -- imperative three.js scene ported verbatim from the prototype; typed loosely on purpose
import * as THREE0 from 'three-r128';
const THREE:any=THREE0;
import { DEN, T, TH, crownGeo, facade, hipGeo, merge, paintColor, paintDensity, paintHeight } from './terrain';
import { GY, PLACES, TD, TW, W } from './places';
import { R, RM, cl, ease, sstep } from './util';
import { ROUTE } from './parkShapes';
import { A, N, V, Z } from '../state';
import { ASSETS, LIONGEO } from './models';
import { artTex, carpetTex, chevTex, woodTex } from './textures';
import { DEST, DH, OUT_STAGES, P, PAUSE, POI, POI1_STOP, POI3_STOP, TX, WH, WT } from './story';
import { fmtT, hush, nCum, nDur, nS, narSpeak, narStart, narStop, navSay } from '../voice';
import { icoHTML } from '../ui/hudIcons';

export function createEngine(mount:HTMLElement,Rf:any):()=>void{
    const el=mount,css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const bg=new THREE.Color(css('--bg')||'#f8f6f1');
    const renderer=new THREE.WebGLRenderer({antialias:true});
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    const scene=new THREE.Scene();scene.background=bg;scene.fog=new THREE.Fog(bg,170,330);
    const cam=new THREE.PerspectiveCamera(32,1,1,500);
    scene.add(new THREE.HemisphereLight(0xffffff,0xcfe0a8,.5));
    const sun=new THREE.DirectionalLight(0xfff0d8,.72);
    sun.position.set(-60,85,35);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.radius=3;
    Object.assign(sun.shadow.camera,{left:-75,right:75,top:60,bottom:-60,near:10,far:260});
    scene.add(sun);
    const outdoorG=new THREE.Group();scene.add(outdoorG);

    /* ---------- OUTDOOR: Unity Park, rebuilt from the official journey map ---------- */
    paintHeight();paintDensity();
    {let tg=new THREE.PlaneGeometry(TW,TD,252,186);tg.rotateX(-Math.PI/2);
     const P0=tg.attributes.position;for(let i=0;i<P0.count;i++)P0.setY(i,TH(P0.getX(i),P0.getZ(i)));tg.computeVertexNormals();
     const terrain=new THREE.Mesh(tg,new THREE.MeshStandardMaterial({map:paintColor(),roughness:.96,transparent:true}));terrain.receiveShadow=true;outdoorG.add(terrain)}
    const mats={};const M=(c,f,o)=>mats[c+(f?1:0)+(o||'')]||(mats[c+(f?1:0)+(o||'')]=new THREE.MeshStandardMaterial({color:c,roughness:.85,flatShading:!!f}));
    const add=(g,geo,mat,x,y,z,ry)=>{const m=new THREE.Mesh(geo,typeof mat==='string'?M(mat):mat);m.position.set(x,y,z);if(ry)m.rotation.y=ry;m.castShadow=m.receiveShadow=true;g.add(m);return m};
    const B=(g,w,hh,d,c,x,z,yo=0,ry)=>add(g,new THREE.BoxGeometry(w,hh,d),c,x,hh/2+yo,z,ry);
    const Cy=(g,r,hh,c,x,z,yo=0,seg=18,r2)=>add(g,new THREE.CylinderGeometry(r,r2==null?r:r2,hh,seg),c,x,hh/2+yo,z);
    const FB=(g,w,hh,d,base,roofC,x,z,yo=0,win='#5d6f7d',arch,ry)=>{const ry2=Math.max(1,Math.round(hh/.55)),a=facade(base,win,Math.max(1,Math.round(d/.55)),ry2,arch),b=facade(base,win,Math.max(1,Math.round(w/.55)),ry2,arch),r=M(roofC);return add(g,new THREE.BoxGeometry(w,hh,d),[a,a,r,r,b,b],x,hh/2+yo,z,ry)};
    const roof=(g,w,d,hh,c,x,z,yo,o,gable,alongZ)=>add(g,hipGeo(w,d,hh,o==null?.14:o,gable,alongZ),M(c,1),x,yo,z);
    const placeG=(px,py,deg)=>{const [x,z]=W(px,py),g=new THREE.Group();g.position.set(x,TH(x,z),z);g.rotation.y=-(deg||0)*Math.PI/180;outdoorG.add(g);return g};
    const posts=(g,x0,z0,x1,z1,n,hh,c,r=.05)=>{for(let i=0;i<n;i++){const u=n<2?.5:i/(n-1);Cy(g,r,hh,c,x0+(x1-x0)*u,z0+(z1-z0)*u,0,8)}};
    const hut=(g,x,z,r,hh,wall,rf,rh,yo=0)=>{Cy(g,r,hh,wall,x,z,yo,20);add(g,new THREE.ConeGeometry(r*1.28,rh,20),M(rf,1),x,yo+hh+rh/2,z)};
    const CR='#f0e7d4',RF='#9b4a36',PW='#e9e1cf';

    /* --- 4 · Menelik II's Palace compound --- */
    const palG=placeG(925,537,0);            /* A · Princes' Bedroom — the building we walk into */
    FB(palG,4.2,1.5,2.9,CR,CR,0,0,0,'#55636c',1);roof(palG,4.2,2.9,1.05,RF,0,0,1.5);
    B(palG,4.5,.08,.9,'#d9cfba',0,1.9,0);posts(palG,-2.1,2.25,2.1,2.25,7,1.42,'#fbf7ee',.055);B(palG,4.7,.1,1.1,RF,0,1.85,1.42);
    B(palG,.62,1.0,.05,'#6b4a35',0,1.47,0);B(palG,.46,.84,.03,'#ffe2a8',0,1.5,.02);
    {const g=placeG(918,486,0);FB(g,3.6,2.4,5.4,CR,CR,0,0,0,'#55636c',1);roof(g,3.6,5.4,1.2,RF,0,0,2.4,.16,0,1);   /* B · Etege Taitu Bitul's Quarter */
     posts(g,-1.95,-2.6,-1.95,2.6,8,2.3,'#fbf7ee',.05);B(g,.8,.08,5.6,'#d9cfba',-2.2,0,0);B(g,.9,.1,5.8,RF,-2.15,0,2.3);
     FB(g,1.4,1.6,2.6,CR,CR,2.5,-.3,0);roof(g,1.4,2.6,.8,RF,2.5,-.3,1.6,.12,0,1)}
    {const g=placeG(940,421,-14);FB(g,2.8,1.25,1.7,CR,CR,0,0,0,'#55636c',1);roof(g,2.8,1.7,.75,RF,0,0,1.25)}          /* C · Council of Ministers Hall */
    {const g=placeG(875,428,0);const oct=(r,hh,yo)=>{const s=facade(CR,'#55636c',8,Math.max(1,Math.round(hh/.55)),1),rm=M('#e8dcc6');add(g,new THREE.CylinderGeometry(r,r,hh,8),[s,rm,rm],0,yo+hh/2,0)};  /* D · Egg House */
     oct(1.05,1.05,0);add(g,new THREE.CylinderGeometry(1.3,1.3,.08,8),M(RF),0,1.09,0);oct(.86,.9,1.13);
     const d=add(g,new THREE.SphereGeometry(.9,20,10,0,Math.PI*2,0,Math.PI/2),M('#7f9a8a',1),0,2.03,0);d.scale.y=.75;Cy(g,.05,.45,'#d1a84c',0,0,2.6,6)}
    {const g=placeG(853,486,0);FB(g,2.7,1.35,2.7,CR,CR,0,0,0,'#55636c',1);roof(g,2.7,2.7,1.0,RF,0,0,1.35);B(g,2.9,.08,.7,RF,0,1.6,1.2)}   /* E · Menelik's Quarter */
    {const g=placeG(823,525,0);FB(g,1.7,1.0,1.7,CR,CR,0,0,0);roof(g,1.7,1.7,.7,RF,0,0,1.0)}                                 /* F · Defence Waiting Room */
    {const g=placeG(816,582,0);FB(g,1.8,1.0,2.8,CR,CR,0,0,0);roof(g,1.8,2.8,.7,'#7d8f86',0,0,1.0,.12,0,1)}
    /* covered galleries between the palace buildings */
    [[[884,436],[905,458]],[[868,502],[898,506]],[[836,516],[846,500]],[[887,426],[925,421]]].forEach(s=>{const [a,b]=s.map(p=>W(...p)),L=Math.hypot(b[0]-a[0],b[1]-a[1]),g=new THREE.Group();
      g.position.set((a[0]+b[0])/2,GY,(a[1]+b[1])/2);g.rotation.y=-Math.atan2(b[1]-a[1],b[0]-a[0]);outdoorG.add(g);B(g,L,.06,.6,PW,0,0,0);posts(g,-L/2,.27,L/2,.27,Math.max(2,Math.round(L/.7)),.8,'#fbf7ee',.035);posts(g,-L/2,-.27,L/2,-.27,Math.max(2,Math.round(L/.7)),.8,'#fbf7ee',.035);roof(g,L,.75,.28,RF,0,0,.82,.05,1)});
    /* low compound wall along the palace road */
    {const [a]=[W(800,600)],[b]=[W(985,600)];const g=new THREE.Group();g.position.set((a[0]+b[0])/2,GY,a[1]);outdoorG.add(g);
     B(g,b[0]-a[0]-1.6,.32,.16,'#e8dcc4',-.8,0,0);[-7.7,-3,1.2,5.5].forEach(x=>B(g,.3,.5,.3,'#e8dcc4',x,0,0))}

    /* --- 6 · Throne House: four wings around a courtyard, domed throne hall at the centre --- */
    {const g=placeG(725,562,0),TC='#e9dfcb',TR='#7d8f86';
     FB(g,10.4,1.35,1.4,TC,TC,0,-2.3,0,'#55636c',1);roof(g,10.4,1.4,.7,TR,0,-2.3,1.35);
     FB(g,10.4,1.35,1.4,TC,TC,0,2.3,0,'#55636c',1);roof(g,10.4,1.4,.7,TR,0,2.3,1.35);
     FB(g,1.4,1.35,3.2,TC,TC,-4.5,0,0,'#55636c',1);roof(g,1.4,3.2,.7,TR,-4.5,0,1.35,.14,0,1);
     FB(g,1.4,1.35,3.2,TC,TC,4.5,0,0,'#55636c',1);roof(g,1.4,3.2,.7,TR,4.5,0,1.35,.14,0,1);
     FB(g,3.0,1.9,2.2,'#f3ebdb',TC,0,0,0,'#55636c',1);roof(g,3.0,2.2,.6,TR,0,0,1.9);
     const d=add(g,new THREE.SphereGeometry(.75,20,10,0,Math.PI*2,0,Math.PI/2),M('#c9a24a',1),0,2.35,0);d.scale.y=.85;
     B(g,1.6,1.1,.5,'#f3ebdb',0,3.2,0);posts(g,-.7,3.5,.7,3.5,4,1.05,'#fbf7ee',.05);roof(g,1.8,.9,.35,TR,0,3.2,1.1,.06,1,1);
     /* Haile Selassie's car under a glass canopy */
     const cg=new THREE.Group();cg.position.set(5.6,0,4.3);g.add(cg);B(cg,1.5,.06,.9,'#d9d2c2',0,0,0);
     B(cg,.95,.2,.42,'#1c2733',0,.12,0);B(cg,.5,.16,.36,'#2a3a4c',-.05,0,.32);
     add(cg,new THREE.BoxGeometry(1.5,.85,.9),new THREE.MeshStandardMaterial({color:'#dff2f4',transparent:true,opacity:.25,roughness:.05}),0,.48,0).castShadow=false}

    /* --- 5 · Unity Archive: a classical colonnaded hall --- */
    {const g=placeG(670,465,0),Wt='#f6f2ea';B(g,5.0,.14,3.0,'#ded6c6',0,0,0);B(g,4.7,.12,2.7,'#e8e1d2',0,0,.14);
     B(g,3.6,1.2,1.7,'#efe9dc',0,0,.26);posts(g,-2.1,1.15,2.1,1.15,8,1.26,Wt,.09);posts(g,-2.1,-1.15,2.1,-1.15,8,1.26,Wt,.09);
     posts(g,-2.1,0,-2.1,0,1,1.26,Wt,.09);posts(g,2.1,0,2.1,0,1,1.26,Wt,.09);
     B(g,4.7,.22,2.7,Wt,0,0,1.52);roof(g,4.7,2.7,.55,'#e2dacb',0,0,1.74,.08,1)}
    {const g=placeG(730,460,0);FB(g,2.3,.85,1.5,'#f2ead9','#f2ead9',0,0,0);roof(g,2.3,1.5,.55,'#7d8f86',0,0,.85);B(g,2.6,.04,.8,'#e7a24a',0,1.1,.7)}

    /* --- 7 · Banquet Hall (Gibir Adarash) --- */
    {const g=placeG(693,718,0);FB(g,14.6,1.7,5.4,'#e6dccb','#d7cfbf',0,0,0,'#5a6872',1);
     [[0,-2.7,14.7,.18],[0,2.7,14.7,.18],[-7.3,0,.18,5.5],[7.3,0,.18,5.5]].forEach(p=>B(g,p[2],.22,p[3],'#d2c8b5',p[0],p[1],1.7));
     [-4.5,0,4.5].forEach(x=>{B(g,2.8,.12,1.5,'#d8d0c0',x,0,1.7);roof(g,2.8,1.5,.3,'#bcd3d6',x,0,1.82,.02,1)});
     B(g,4.2,.1,1.2,'#d2c8b5',0,3.25,1.25);posts(g,-1.9,3.75,1.9,3.75,6,1.25,'#fbf7ee',.06)}

    /* --- 8 · Unity Botanical Garden: two glasshouse domes --- */
    {const g=placeG(505,292,-28);const glass=new THREE.MeshStandardMaterial({color:'#9fdcb0',transparent:true,opacity:.62,roughness:.12,metalness:.15}),
       wire=c=>new THREE.MeshBasicMaterial({color:c,wireframe:true,transparent:true,opacity:.5});
     const dome=(x,z,sx,sy,sz,m,wc)=>{const geo=new THREE.SphereGeometry(1,28,14,0,Math.PI*2,0,Math.PI/2);const a=add(g,geo,m,x,.12,z);a.scale.set(sx,sy,sz);
       const b=new THREE.Mesh(new THREE.SphereGeometry(1.01,14,6,0,Math.PI*2,0,Math.PI/2),wire(wc));b.position.set(x,.12,z);b.scale.set(sx,sy,sz);g.add(b);Cy(g,1,.12,'#e9e2d2',x,z,0,32).scale.set(sx*1.05,1,sz*1.05)};
     dome(0,-1.4,3.1,2.1,2.2,glass,'#ffffff');dome(-.3,2.4,2.3,1.35,1.9,M('#b9895a',1),'#6b4a2c');
     for(let i=0;i<7;i++){const a=i/7*6.28;add(g,crownGeo(.42+R()*.2),M(['#3f8f3c','#5aa63e','#2f7a35'][i%3],1),Math.cos(a)*1.6,.6,-1.4+Math.sin(a)*1.0)}}

    /* --- 9 · Zoo --- */
    {const g=placeG(458,388,22);FB(g,6.4,1.0,3.2,'#ebe2cf','#c9bfae',0,0,0);B(g,6.6,.12,3.4,'#cdbf9e',0,0,1.0)}       /* zoo administration */
    {const g=placeG(410,705,0);Cy(g,2.7,.25,'#e2d9c5',0,0,0,32);                                                        /* aviary */
     const n=new THREE.Mesh(new THREE.SphereGeometry(2.6,20,10,0,Math.PI*2,0,Math.PI/2),new THREE.MeshBasicMaterial({color:'#f6f6f2',wireframe:true,transparent:true,opacity:.6}));n.position.y=.25;n.scale.y=.75;g.add(n);
     Cy(g,.07,2.2,'#bfb7a8',0,0,.25,8);for(let i=0;i<5;i++){const a=i*1.3;add(g,crownGeo(.38),M('#4f9a3a',1),Math.cos(a)*1.4,.7,Math.sin(a)*1.2)}}
    [[470,505],[455,585],[335,690],[392,845],[372,520]].forEach((p,i)=>{const g=placeG(p[0],p[1],0);hut(g,0,0,.55,.45,'#cdb78f',i%2?'#8a6a43':'#a8875a',.55)});
    for(let i=0;i<6;i++){const g=placeG(527,470+i*24,8);B(g,.9,.5,.55,'#efe7d6',0,0,0);B(g,1.05,.06,.75,['#d9583f','#2f8f5b','#e7a24a'][i%3],0,.1,.52)}  /* kiosks */
    const giraffe=(g,x,z,ry)=>{const s=new THREE.Group();s.position.set(x,0,z);s.rotation.y=ry;g.add(s);const c='#d9a548';B(s,.5,.22,.18,c,0,0,.42);
      [[-.18,-.06],[.18,-.06],[-.18,.06],[.18,.06]].forEach(l=>B(s,.04,.42,.04,c,l[0],l[1],0));const nk=add(s,new THREE.BoxGeometry(.08,.6,.08),M(c),.24,.82,0);nk.rotation.z=-.3;B(s,.2,.08,.1,c,.36,0,1.06)};
    {const g=placeG(372,615,0);giraffe(g,0,0,.4);giraffe(g,1.2,.8,-.6)}
    {const g=placeG(452,642,0);for(let i=0;i<5;i++){const s=add(g,new THREE.ConeGeometry(.06,.5,6),M('#f29fa5'),(R()-.5)*1.2,.25,(R()-.5)*.8)}}

    /* --- 2 · Black Lion Zoo --- */
    const rocks=(px,py,n,sp,c)=>{const g=placeG(px,py,0);for(let i=0;i<n;i++){const r=add(g,new THREE.DodecahedronGeometry(.25+R()*.45),M(c||(R()<.5?'#bfae8e':'#a9987a'),1),(R()-.5)*sp*1.6,.1,(R()-.5)*sp);r.scale.y=.7;r.rotation.y=R()*6}return g};
    rocks(1265,850,9,2.6,'#9d8b6c');rocks(1210,900,5,2);rocks(1060,820,4,1.6);rocks(1120,905,4,1.5);
    {const g=placeG(1265,850,0);const c=add(g,new THREE.DodecahedronGeometry(1.4),M('#a38f6d',1),0,.6,-.3);c.scale.set(1.3,.75,1)}
    const lion=(g,x,z,ry,mane)=>{const s=new THREE.Group();s.position.set(x,0,z);s.rotation.y=ry;g.add(s);const c='#c9944a';B(s,.62,.26,.24,c,0,0,.18);
      [[-.22,-.08],[.22,-.08],[-.22,.08],[.22,.08]].forEach(l=>B(s,.06,.2,.06,c,l[0],l[1],0));add(s,new THREE.SphereGeometry(.14,10,8),M(c),.36,.48,0);if(mane)add(s,new THREE.SphereGeometry(.2,10,8),M('#2b1d12'),.31,.46,0)};
    {const g=placeG(1170,830,0);lion(g,0,0,.3,1);lion(g,1.4,1.1,-2.2,0);lion(g,-1.6,1.6,1.4,0)}
    {const g=placeG(1180,790,-12);B(g,2.4,.14,1.1,'#8a6a48',0,0,.5);posts(g,-1.1,-.45,1.1,-.45,5,.5,'#7a5a3a',.05);posts(g,-1.1,.45,1.1,.45,5,.5,'#7a5a3a',.05);B(g,2.4,.05,.05,'#7a5a3a',0,.5,1.0)}

    /* --- 3 · Indigenous Plants Garden --- */
    {const g=placeG(1082,668,10);posts(g,-1.1,-.7,1.1,-.7,4,.75,'#8a6a48',.06);posts(g,-1.1,.7,1.1,.7,4,.75,'#8a6a48',.06);roof(g,2.6,1.8,.55,'#b09060',0,0,.75,.1,1);   /* camel house */
     const cm=(x,z,ry)=>{const s=new THREE.Group();s.position.set(x,0,z);s.rotation.y=ry;g.add(s);const c='#c7a26b';B(s,.6,.24,.24,c,0,0,.38);add(s,new THREE.SphereGeometry(.15,8,6),M(c),0,.66,0);
       [[-.2,-.08],[.2,-.08],[-.2,.08],[.2,.08]].forEach(l=>B(s,.05,.4,.05,c,l[0],l[1],0));const n=add(s,new THREE.BoxGeometry(.08,.4,.08),M(c),.32,.72,0);n.rotation.z=-.5;B(s,.18,.08,.1,c,.44,0,.86)};
     cm(2.2,.6,.4);cm(2.6,-.9,2.6)}
    {const g=placeG(1032,612,0);Cy(g,.7,.12,'#d9cdb6',0,0,0,16);for(let i=0;i<5;i++){const t=add(g,new THREE.CylinderGeometry(.07,.13,1.5+R()*.8,6),M('#7a5232',1),(R()-.5)*.6,.8,(R()-.5)*.6);t.rotation.set((R()-.5)*.7,0,(R()-.5)*.7)}}   /* wood sculpture */

    /* --- 1 · Green Area: amphitheatre + kids playground --- */
    {const g=placeG(872,636,0);const pr=[[.8,0],[.8,.07],[1.25,.07],[1.25,.17],[1.7,.17],[1.7,.27],[2.15,.27],[2.15,.37],[2.5,.37],[2.5,0]].map(p=>new THREE.Vector2(p[0],p[1]));
     add(g,new THREE.LatheGeometry(pr,28,Math.PI/2,Math.PI),M('#e4dbc8',1),0,0,0);add(g,new THREE.CylinderGeometry(.75,.75,.05,24,1,false,Math.PI/2,Math.PI),M('#c9b996'),0,.03,0)}
    {const g=placeG(858,912,0);B(g,.9,.5,.35,'#e85d3f',-.8,0,0);const sl=add(g,new THREE.BoxGeometry(.25,.04,1.1),M('#f2c230'),-.8,.28,.6);sl.rotation.x=.45;
     posts(g,.2,-.4,1.2,-.4,2,.7,'#3d8fd8',.04);B(g,1.1,.05,.05,'#3d8fd8',.7,-.4,.7);const d=add(g,new THREE.SphereGeometry(.45,10,6,0,Math.PI*2,0,Math.PI/2),new THREE.MeshStandardMaterial({color:'#2bb84a',wireframe:true}),.6,0,.6)}
    [[860,700],[950,740],[880,820],[935,870]].forEach(p=>{const g=placeG(p[0],p[1],0);B(g,.6,.2,.25,'#8a6a48',0,0,0)});

    /* --- entrance, visitor centre, fountain --- */
    {const g=placeG(1018,958,0);FB(g,5,.95,2.3,'#efe7d6','#d9d0bf',0,0,0);B(g,5.3,.07,1.0,'#cfc6b3',0,1.55,.85);posts(g,-2.4,1.3,2.4,1.3,6,.95,'#efe7d6',.05)}
    {const g=placeG(1015,1024,0);[-1.5,1.5].forEach(x=>B(g,.45,1.5,.45,'#e9dfcb',x,0,0));B(g,3.6,.26,.45,'#2f5a3f',0,0,1.5)}
    {const g=placeG(1097,935,0);add(g,new THREE.CylinderGeometry(2.55,2.6,.22,40,1,true),M('#e8e0cf'),0,.0,0);Cy(g,.35,.3,'#efe7d6',0,0,-.1,16);Cy(g,.12,.7,'#e6f6fb',0,0,.1,10)}

    /* --- 10 · Regional pavilions G–O --- */
    {const g=placeG(522,892,0);B(g,1.2,.16,1.2,'#d8ccb4',0,0,0);   /* G · Tigray: an Aksumite stele */
     const s=facade('#bfae8e','#6e5d48',1,9);add(g,new THREE.BoxGeometry(.42,3.2,.28),s,0,1.76,0);const t=add(g,new THREE.SphereGeometry(.21,12,6,0,Math.PI*2,0,Math.PI/2),M('#bfae8e'),0,3.36,0);t.scale.z=.67}
    {const g=placeG(552,822,0);hut(g,0,0,1.25,.85,'#eee3cc','#7a4a34',1.0);for(let i=0;i<10;i++){const a=i/10*6.28;Cy(g,.04,.8,'#fbf7ee',Math.cos(a)*1.5,Math.sin(a)*1.5,0,6)}
     add(g,new THREE.ConeGeometry(1.75,.4,24,1,true),M('#7a4a34',1),0,.95,0)}                                           /* H · Amhara */
    {const g=placeG(662,815,0);hut(g,0,0,1.05,.7,'#a87b50','#b99a5e',1.35)}                                             /* I · Benishangul Gumuz */
    {const g=placeG(782,835,0);const d=add(g,new THREE.SphereGeometry(.95,18,12),M('#9e8150',1),0,.6,0);d.scale.y=1.9;B(g,.4,.5,.4,'#9e8150',0,.9,0)}  /* J · SNNPR: Dorze-style beehive */
    {const g=placeG(734,842,0);const d=add(g,new THREE.SphereGeometry(1,16,8,0,Math.PI*2,0,Math.PI/2),M('#cdb68a',1),0,0,0);d.scale.set(1.25,.65,.95)}   /* K · Afar */
    {const g=placeG(680,872,0);Cy(g,2.3,.06,'#e2d7c0',0,0,0,36);for(let i=0;i<14;i++){const a=i/14*6.28;Cy(g,.07,.55,'#8a6a48',Math.cos(a)*2,Math.sin(a)*2,0,6)}hut(g,0,0,.85,.6,'#a87b50','#c2a066',.9)}  /* L · Gambela */
    {const g=placeG(602,870,0);const d=add(g,new THREE.SphereGeometry(1.1,18,8,0,Math.PI*2,0,Math.PI/2),M('#dccaa4',1),0,0,0);d.scale.y=.8;B(g,.4,.5,.3,'#8a6a48',0,1.05,0)}  /* M · Somali aqal */
    {const g=placeG(708,935,0);FB(g,2.0,1.0,1.7,'#f7f4ec','#efe9dc',0,0,0,'#2f6f5a');[[0,-.85,2.05,.12],[0,.85,2.05,.12],[-1,0,.12,1.75],[1,0,.12,1.75]].forEach(p=>B(g,p[2],.18,p[3],'#f2eee4',p[0],p[1],1.0))}  /* N · Harari jugol house */
    {const g=placeG(780,922,0);hut(g,-.6,.3,1.0,.75,'#e6d6b8','#8a5a3a',.9);B(g,.08,1.1,.08,'#5a3e28',1.1,-.2,0);  /* O · Oromia, with an odaa tree */
     const c=add(g,crownGeo(1.2,2),M('#3f7d34',1),1.1,1.7,-.2);c.scale.set(1.35,.55,1.2)}

    /* --- trees: placed from the map's own vegetation zones --- */
    const conG=merge([[new THREE.ConeGeometry(.75,1.3,7),T(0,1.25,0)],[new THREE.ConeGeometry(.58,1.1,7),T(0,1.9,0)],[new THREE.ConeGeometry(.38,.9,7),T(0,2.5,0)]]);
    const rndG=merge([[crownGeo(.95),T(0,1.9,0)],[crownGeo(.62),T(.5,1.45,.3)]]);
    const acaG=merge([[crownGeo(1.0),T(0,1.95,0,1,.38)],[crownGeo(.65),T(.55,1.8,-.3,1,.4)]]);
    const trG=new THREE.CylinderGeometry(.08,.14,1,5);trG.translate(0,.5,0);
    const NT=2600,trunk=new THREE.InstancedMesh(trG,M('#6f5038'),NT);
    const flat=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.9,flatShading:true});
    const con=new THREE.InstancedMesh(conG,flat,NT),rnd=new THREE.InstancedMesh(rndG,flat,NT),aca=new THREE.InstancedMesh(acaG,flat,NT);
    con.castShadow=rnd.castShadow=aca.castShadow=trunk.castShadow=true;
    const CC=['#2b6b35','#2f7a39','#255f30','#3a8540'],RC=['#5c9e37','#6faf3d','#4f9234','#82bb46','#477f33'],AC=['#7aa43c','#8db248','#6c9a36'];
    const d0=new THREE.Object3D(),cc=new THREE.Color(),grid=new Map();let nC=0,nR=0,nA=0,nT=0;
    const free=(x,z,r)=>{const cx=Math.floor(x/1.5),cz=Math.floor(z/1.5);for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++){const l=grid.get((cx+a)+','+(cz+b));if(l)for(const q of l)if(Math.hypot(q[0]-x,q[1]-z)<r)return false}return true};
    for(let t=0;t<90000&&nT<NT;t++){
      const x=-TW/2+R()*TW,z=-TD/2+R()*TD,dn=DEN(x,z);if(dn<.04||R()>dn*1.05)continue;
      const dense=dn>.6,sp=dense?1.05:1.6;if(!free(x,z,sp))continue;
      const k=Math.floor(x/1.5)+','+Math.floor(z/1.5);(grid.get(k)||grid.set(k,[]).get(k)).push([x,z]);
      const type=dense?(R()<.5?0:1):(R()<.45?2:R()<.6?1:0),s=(dense?.5+R()*.35:.42+R()*.3),y=TH(x,z)-.02;
      d0.position.set(x,y,z);d0.rotation.set(0,0,0);d0.scale.set(s,(type===0?1.6:1.15)*s,s);d0.updateMatrix();trunk.setMatrixAt(nT++,d0.matrix);
      d0.rotation.y=R()*6;d0.scale.set(s,s*(.9+R()*.3),s);d0.updateMatrix();
      if(type===0){con.setMatrixAt(nC,d0.matrix);con.setColorAt(nC++,cc.set(CC[Math.floor(R()*4)]).multiplyScalar(.9+R()*.2))}
      else if(type===1){rnd.setMatrixAt(nR,d0.matrix);rnd.setColorAt(nR++,cc.set(RC[Math.floor(R()*5)]).multiplyScalar(.92+R()*.16))}
      else{aca.setMatrixAt(nA,d0.matrix);aca.setColorAt(nA++,cc.set(AC[Math.floor(R()*3)]).multiplyScalar(.92+R()*.16))}
    }
    trunk.count=nT;con.count=nC;rnd.count=nR;aca.count=nA;outdoorG.add(trunk,con,rnd,aca);

    /* --- park name, set into the ground beyond the north edge --- */
    const cv2=document.createElement('canvas');cv2.width=1024;cv2.height=300;const tex=new THREE.CanvasTexture(cv2);
    const paint=()=>{const x=cv2.getContext('2d');x.clearRect(0,0,1024,300);x.textAlign='center';
      x.font='600 120px Newsreader,Georgia,serif';x.fillStyle='rgba(15,61,38,.82)';x.fillText('Unity Park',512,130);
      x.font='800 64px "Noto Sans Ethiopic",sans-serif';x.fillStyle='rgba(47,107,47,.7)';x.fillText('አንድነት ፓርክ',512,240);tex.needsUpdate=true};
    paint();if(document.fonts&&document.fonts.ready)document.fonts.ready.then(paint);
    const title=new THREE.Mesh(new THREE.PlaneGeometry(20,5.9),new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false,fog:false}));
    {const [x,z]=W(800,282);title.position.set(x+1,.7,z-3.4);title.rotation.x=-Math.PI/2;title.visible=false}

    /* --- outdoor route: entrance → Princes' Bedroom door; walked part turns grey --- */
    palG.updateMatrixWorld(true);
    const entry=palG.localToWorld(new THREE.Vector3(0,0,2.75));entry.y=GY+.12;
    const doorW=palG.localToWorld(new THREE.Vector3(0,.5,1.5));
    const rpts=ROUTE.map(p=>{const [x,z]=W(...p);return new THREE.Vector3(x,TH(x,z)+.12,z)});rpts[rpts.length-1].copy(entry);
    const rc=new THREE.CatmullRomCurve3(rpts,false,'centripetal',.2);
    const tubeGeo=new THREE.TubeGeometry(rc,220,.17,8,false),tubeN=tubeGeo.index.count;
    const tube=new THREE.Mesh(tubeGeo,new THREE.MeshStandardMaterial({color:'#6aea2c',emissive:'#33b510',emissiveIntensity:.55,roughness:.5}));
    const tubeDone=new THREE.Mesh(tubeGeo.clone(),new THREE.MeshStandardMaterial({color:'#c4ccc0',roughness:.8}));
    outdoorG.add(tube,tubeDone);
    const OUTM=Math.round(rc.getLength()*7/10)*10;Z.outM=OUTM;
    const [px0,pz0]=[rpts[0].x,rpts[0].z],pin=new THREE.Group();pin.position.set(px0,GY,pz0);
    const cone=add(pin,new THREE.ConeGeometry(.6,1.7,16),M('#2f6bff'),0,.85,0);cone.rotation.x=Math.PI;
    const pinBall=add(pin,new THREE.SphereGeometry(.85,20,14),M('#2f6bff'),0,2.4,0);add(pin,new THREE.SphereGeometry(.32,10,8),M('#ffffff'),0,2.45,.55);
    const rings=[0,1,2].map(()=>{const m=new THREE.Mesh(new THREE.RingGeometry(.7,.85,40),new THREE.MeshBasicMaterial({color:'#4f8dff',transparent:true,depthWrite:false,side:THREE.DoubleSide}));m.rotation.x=-Math.PI/2;m.position.y=.12;pin.add(m);return m});
    pin.scale.setScalar(.62);outdoorG.add(pin);
    const ringM=c=>{const m=new THREE.Mesh(new THREE.RingGeometry(.9,1.12,56),new THREE.MeshBasicMaterial({color:c,transparent:true,depthWrite:false,side:THREE.DoubleSide}));m.rotation.x=-Math.PI/2;m.visible=false;outdoorG.add(m);return m};
    const hl=ringM('#6aea2c');hl.position.set(palG.position.x,GY+.15,palG.position.z);
    const actRing=ringM('#ffffff');
    /* --- floating 3D landmarks above each destination --- */
    const FM=(c,o)=>new THREE.MeshStandardMaterial(Object.assign({color:c,roughness:.42,metalness:.05,emissive:c,emissiveIntensity:.08},o||{}));
    const fadd=(g,geo,m,x,y,z,rx,ry,rz)=>{const me=new THREE.Mesh(geo,m);me.position.set(x,y,z);me.rotation.set(rx||0,ry||0,rz||0);me.castShadow=true;g.add(me);return me};
    const GOLD=FM('#e8b53a',{metalness:.55,roughness:.28}),RED=FM('#c8343b'),DK=FM('#2b1d12');
    const SATC=(attr,ks=1.3,kl=1.05)=>{const c=new THREE.Color(),h={};for(let k=0;k<attr.count;k++){c.setRGB(attr.getX(k),attr.getY(k),attr.getZ(k));c.getHSL(h);c.setHSL(h.h,Math.min(1,h.s*ks+(ks>1?.05:0)),Math.min(.72,h.l*kl+(kl>1?.02:0)));attr.setXYZ(k,c.r,c.g,c.b)}attr.needsUpdate=true};
    const FCLR={4:3.2,6:2.6,7:3.0,5:2.0,8:2.0,10:2.2};
    const ASSETMESH=(g,key,ry,sc,yo)=>{g.userData.noOutline=1;const A=ASSETS[key],b64=(t,T)=>{const s=atob(t),u=new Uint8Array(s.length);for(let k=0;k<s.length;k++)u[k]=s.charCodeAt(k);return new T(u.buffer)};
      const q=b64(A.p,Int16Array),fc=b64(A.c,Uint8Array),n=q.length/3,pos=new Float32Array(n*3),col=new Float32Array(n*3);
      for(let k=0;k<n;k++)for(let a=0;a<3;a++){pos[k*3+a]=A.mn[a]+(q[k*3+a]+32768)/65535*(A.mx[a]-A.mn[a]);col[k*3+a]=fc[Math.floor(k/3)*3+a]/255}
      const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));const AK={'1':[1.0,.8],'8':[.85,.97],'3':[1.15,.86]}[key]||[1.3,1.05];SATC(geo.attributes.color,AK[0],AK[1]);geo.computeVertexNormals();
      const m=fadd(g,geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.6,metalness:.05,flatShading:true,side:THREE.DoubleSide,emissive:'#2a1a0a',emissiveIntensity:.18}),0,0,0);m.rotation.y=ry;m.scale.setScalar(sc);m.position.y=yo||0};
    const FLOAT={
     1:g=>ASSETMESH(g,'1',0.785,1.45,.15),
     2:g=>{g.userData.noOutline=1;const b64=(t,T)=>{const s=atob(t),u=new Uint8Array(s.length);for(let k=0;k<s.length;k++)u[k]=s.charCodeAt(k);return new T(u.buffer)};
        let geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(b64(LIONGEO.p,Float32Array),3));geo.setAttribute('uv',new THREE.BufferAttribute(b64(LIONGEO.uv,Float32Array),2));geo.setIndex(new THREE.BufferAttribute(b64(LIONGEO.i,Uint16Array),1));
        geo=geo.toNonIndexed();geo.computeVertexNormals();
        {const fc=b64(LIONGEO.c,Uint8Array),n=geo.attributes.position.count,cc=new Float32Array(n*3);for(let k=0;k<n;k++){const f=Math.floor(k/3);for(let q=0;q<3;q++)cc[k*3+q]=fc[f*3+q]/255}geo.setAttribute('color',new THREE.BufferAttribute(cc,3));SATC(geo.attributes.color)}
        const m=fadd(g,geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.72,metalness:0,flatShading:true,side:THREE.DoubleSide,emissive:'#3a1a08',emissiveIntensity:.25}),0,0,0);m.scale.setScalar(1.15)},
     3:g=>ASSETMESH(g,'3',0,1.25),
     4:g=>ASSETMESH(g,'4',0,1.25),
     5:g=>{[-1,1].forEach(s=>{const p=new THREE.Group();p.rotation.z=s*.28;g.add(p);fadd(p,new THREE.BoxGeometry(.5,.04,.66),FM('#6b3a24'),s*.26,-.02,0);fadd(p,new THREE.BoxGeometry(.46,.07,.6),FM('#fbf6ea'),s*.25,.03,0);
        for(let k=0;k<4;k++)fadd(p,new THREE.BoxGeometry(.32,.075,.02),FM('#cbbfa6'),s*.25,.035,-.18+k*.12)});
        fadd(g,new THREE.CylinderGeometry(.02,.02,.66,6),FM('#6b3a24'),0,-.02,0,Math.PI/2)},
     6:g=>ASSETMESH(g,'6',0.35,1.35),
     7:g=>ASSETMESH(g,'7',-1.5708,1.25,.6),
     8:g=>ASSETMESH(g,'8',0,1.5),
     9:g=>ASSETMESH(g,'9',-0.7,2.0),
     10:g=>{fadd(g,new THREE.CylinderGeometry(.025,.025,1.2,8),FM('#d9d4c8',{metalness:.4}),-.38,-.05,0);fadd(g,new THREE.SphereGeometry(.05,10,8),GOLD,-.38,.57,0);
        const geo=new THREE.PlaneGeometry(.8,.54,16,6),pp=geo.attributes.position,cols=[];
        for(let i=0;i<pp.count;i++){const x=pp.getX(i),y=pp.getY(i);pp.setZ(i,Math.sin((x+.4)*5)*.06*(x+.4));const c=new THREE.Color(y>.09?'#1f9a45':y<-.09?'#d6303a':'#f2c62e');cols.push(c.r,c.g,c.b)}
        geo.setAttribute('color',new THREE.Float32BufferAttribute(cols,3));geo.computeVertexNormals();
        fadd(g,geo,new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.5}),.02,.28,0);
        fadd(g,new THREE.CircleGeometry(.11,24),FM('#2f5fb3',{side:THREE.DoubleSide}),.04,.28,.06)}
    };
    const TG=new THREE.DataTexture(new Uint8Array([115,175,225]),3,1,THREE.LuminanceFormat);TG.minFilter=TG.magFilter=THREE.NearestFilter;TG.needsUpdate=true;
    const OUTL=new THREE.MeshBasicMaterial({color:'#ffffff',side:THREE.BackSide});
    const toonify=g=>{if(g.userData.noToon)return;const ms=[];g.traverse(o=>{if(o.isMesh)ms.push(o)});ms.forEach(o=>{const m=o.material;
      o.material=new THREE.MeshToonMaterial({color:m.color?m.color.clone():new THREE.Color('#fff'),gradientMap:TG,vertexColors:!!m.vertexColors,side:m.side,emissive:m.vertexColors?new THREE.Color('#ffffff'):(m.color?m.color.clone():new THREE.Color(0)),emissiveIntensity:m.vertexColors?.03:.12});
      if(g.userData.noOutline)return;if(!o.geometry.boundingSphere)o.geometry.computeBoundingSphere();const r=o.geometry.boundingSphere.radius||.1,ol=new THREE.Mesh(o.geometry,OUTL);ol.scale.setScalar((r+.05)/r);ol.position.copy(o.geometry.boundingSphere.center).multiplyScalar(-(ol.scale.x-1));o.add(ol)})};
    const FLOATS=PLACES.map((pl,i)=>{const g=new THREE.Group();FLOAT[pl.n](g);toonify(g);g.userData.s=pl.n===4?4.3:3.8;g.userData.i=i;g.traverse(o=>{if(o.isMesh){o.userData.pi=i}});g.userData.y=TH(pl.x,pl.z)+3.7;g.position.set(pl.x,g.userData.y,pl.z);outdoorG.add(g);return g});
    const HALOS=PLACES.map(pl=>{const m=new THREE.Mesh(new THREE.RingGeometry(.75,1.0,48),new THREE.MeshBasicMaterial({color:pl.c,transparent:true,depthWrite:false,side:THREE.DoubleSide}));m.rotation.x=-Math.PI/2;m.position.set(pl.x,TH(pl.x,pl.z)+.14,pl.z);outdoorG.add(m);return m});
    const ray=new THREE.Raycaster(),mv=new THREE.Vector2();

    /* ---------- INDOOR: human-scale palace digital twin ---------- */
    const inS=new THREE.Scene();inS.background=new THREE.Color('#dfe8e6');
    inS.add(new THREE.HemisphereLight(0xfff6e8,0x8a7058,.62));
    inS.add(new THREE.AmbientLight(0xffe8c8,.16));
    const dl=new THREE.DirectionalLight(0xfff0d8,.5);dl.position.set(-12,34,14);dl.target.position.set(0,0,-6);dl.castShadow=true;dl.shadow.mapSize.set(2048,2048);
    Object.assign(dl.shadow.camera,{left:-28,right:28,top:30,bottom:-30,near:2,far:90});dl.shadow.bias=-.0008;inS.add(dl,dl.target);
    const SM=(c,o)=>new THREE.MeshStandardMaterial(Object.assign({color:c,roughness:.82},o||{}));
    const woodT=woodTex();
    const IM={wall:SM('#f1e5cb'),ext:SM('#eadcc5'),wain:SM('#6b462c',{roughness:.55}),trim:SM('#c9a45e',{roughness:.4,metalness:.4}),ceil:SM('#f6efe1'),beam:SM('#7b5234',{roughness:.7}),
      frame:SM('#4a2f1f',{roughness:.5}),gold:SM('#d1a84c',{roughness:.3,metalness:.65}),gold2:SM('#d9b456',{roughness:.28,metalness:.7,side:THREE.DoubleSide}),red:SM('#8e1f27',{roughness:.9}),
      win:new THREE.MeshStandardMaterial({color:'#fff8e8',emissive:'#fff1d2',emissiveIntensity:.85,roughness:.3}),stone:SM('#d9cfbb'),roof:SM('#b9603f'),
      glass:new THREE.MeshStandardMaterial({color:'#e3f4f6',transparent:true,opacity:.16,roughness:.05,metalness:.1,depthWrite:false}),white:SM('#f7f2e8'),blue:SM('#3b5a86'),
      wood:SM('#ffffff',{map:woodT,roughness:.6}),bulb:new THREE.MeshBasicMaterial({color:'#fff3c4'}),
      dome:SM('#f4ead6',{side:THREE.DoubleSide}),screen:new THREE.MeshBasicMaterial({color:'#ffffff'})};
    const iadd=(geo,m,x,y,z,ry,cast)=>{const me=new THREE.Mesh(geo,m);me.position.set(x,y,z);me.rotation.y=ry||0;me.castShadow=cast!==false;me.receiveShadow=true;inS.add(me);return me};
    const ibox=(w,hh,d,m,x,y,z,ry,cast)=>iadd(new THREE.BoxGeometry(w,hh,d),m,x,y,z,ry,cast);
    const floor=(x0,z0,x1,z1,m,y=0)=>{const g=new THREE.PlaneGeometry(x1-x0,z1-z0);g.rotateX(-Math.PI/2);const uv=g.attributes.uv;for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*(x1-x0)/3,uv.getY(i)*(z1-z0)/3);iadd(g,m||IM.wood,(x0+x1)/2,y+.005,(z0+z1)/2,0,false)};
    const ceil=(x0,z0,x1,z1,beams)=>{ibox(x1-x0,.14,z1-z0,IM.ceil,(x0+x1)/2,WH+.07,(z0+z1)/2,0,false);
      if(beams)for(let z=z0+1;z<z1-.5;z+=2)ibox(x1-x0,.22,.22,IM.beam,(x0+x1)/2,WH-.11,z,0,false);
      ibox(x1-x0,.12,.12,IM.trim,(x0+x1)/2,WH-.06,z0+.21,0,false);ibox(x1-x0,.12,.12,IM.trim,(x0+x1)/2,WH-.06,z1-.21,0,false)};
    const wall=(ax,az,bx,bz,gaps,o)=>{o=o||{};gaps=gaps||[];const y0=o.y0||0,hh=o.h||WH,m=o.m||IM.wall,dx=bx-ax,dz=bz-az,L=Math.hypot(dx,dz),ux=dx/L,uz=dz/L,ry=-Math.atan2(dz,dx);
      const seg=(t0,t1,ya,yb,mm,th,cast)=>{if(t1-t0<.01||yb-ya<.01)return;const tcn=(t0+t1)/2;ibox(t1-t0,yb-ya,th||WT,mm,ax+ux*tcn,y0+(ya+yb)/2,az+uz*tcn,ry,cast)};
      const gs=gaps.slice().sort((a,b)=>a[0]-b[0]);let t=0;const so=[];gs.forEach(g=>{so.push([t,g[0]]);t=g[1]});so.push([t,L]);
      so.forEach(s=>{seg(s[0],s[1],0,hh,m);if(!o.plain){seg(s[0],s[1],0,1.05,IM.wain,WT+.06);seg(s[0],s[1],1.05,1.13,IM.trim,WT+.09);seg(s[0],s[1],hh-.32,hh-.16,IM.trim,WT+.1)}});
      gs.forEach(g=>{const gh=g[2]||DH;seg(g[0],g[1],gh,hh,m);seg(g[0]-.16,g[0],0,gh+.16,IM.frame,WT+.14);seg(g[1],g[1]+.16,0,gh+.16,IM.frame,WT+.14);seg(g[0]-.16,g[1]+.16,gh,gh+.16,IM.frame,WT+.14)});
      (o.win||[]).forEach(w=>{seg(w-.65,w+.65,1.35,3.1,IM.win,WT+.03,false);seg(w-.03,w+.03,1.35,3.1,IM.frame,WT+.08,false);seg(w-.65,w+.65,2.2,2.26,IM.frame,WT+.08,false);seg(w-.8,w+.8,1.25,1.35,IM.frame,WT+.16);seg(w-.8,w+.8,3.1,3.2,IM.frame,WT+.12,false)})};
    const hw=(z,x0,x1,g,o)=>wall(x0,z,x1,z,(g||[]).map(a=>[a[0]-x0,a[1]-x0,a[2]]),o&&o.win?Object.assign({},o,{win:o.win.map(w=>w-x0)}):o);
    const vw=(x,z0,z1,g,o)=>wall(x,z0,x,z1,(g||[]).map(a=>[a[0]-z0,a[1]-z0,a[2]]),o&&o.win?Object.assign({},o,{win:o.win.map(w=>w-z0)}):o);
    const painting=(x,y,z,ry,w,hh,t)=>{ibox(w+.2,hh+.2,.07,IM.gold,x,y,z,ry);const m=iadd(new THREE.PlaneGeometry(w,hh),SM('#fff',{map:t,roughness:.75}),x+Math.sin(ry)*.04,y,z+Math.cos(ry)*.04,ry,false)};
    const carpet=(x0,z0,x1,z1,t)=>{const g=new THREE.PlaneGeometry(x1-x0,z1-z0);g.rotateX(-Math.PI/2);iadd(g,SM('#fff',{map:t,roughness:.95}),(x0+x1)/2,.022,(z0+z1)/2,0,false)};
    const column=(x,z)=>{iadd(new THREE.CylinderGeometry(.26,.3,WH-.55,18),IM.white,x,(WH-.55)/2+.28,z);ibox(.75,.28,.75,IM.stone,x,.14,z);ibox(.7,.26,.7,IM.trim,x,WH-.13,z)};
    const chand=(x,z,y=WH)=>{ibox(.04,.7,.04,IM.gold,x,y-.35,z,0,false);const r=new THREE.Mesh(new THREE.TorusGeometry(.5,.035,8,32),IM.gold);r.rotation.x=Math.PI/2;r.position.set(x,y-.72,z);inS.add(r);
      for(let i=0;i<8;i++){const a=i/8*6.283,b=new THREE.Mesh(new THREE.SphereGeometry(.06,8,6),IM.bulb);b.position.set(x+Math.cos(a)*.5,y-.64,z+Math.sin(a)*.5);inS.add(b)}
      const L=new THREE.PointLight(0xffd8a0,.55,15,1.6);L.position.set(x,y-.95,z);inS.add(L)};
    const bench=(x,z,ry)=>{ibox(1.6,.08,.5,IM.wain,x,.46,z,ry);ibox(1.6,.42,.08,IM.red,x,.24,z,ry)};
    /* exterior facade so we walk *through* the front door */
    wall(-22,16.32,22,16.32,[[20.8,23.2,DH]],{h:7.4,m:IM.ext,plain:true,win:[6,10,34,38]});
    ibox(44.4,.4,.9,IM.roof,0,7.6,16.5);
    floor(-40,16.4,40,60,SM('#d3c7ae'));floor(-2.4,16.4,2.4,24,IM.stone,.01);
    ibox(1.2,2.8,.08,IM.frame,1.15,1.4,15.4,Math.PI/2);ibox(1.2,2.8,.08,IM.frame,-1.15,1.4,15.4,Math.PI/2);
    /* vestibule + hall */
    vw(-3,10,16);vw(3,10,16);hw(16,-3,3,[[-1.2,1.2]]);
    hw(10,-9,9,[[-1.6,1.6]]);hw(-4,-9,9,[[-1.5,1.5]]);vw(-9,-4,10,[[1,3.8]]);vw(9,-4,10,[[1,3.8]]);
    floor(-3,10,3,16);floor(-9,-4,9,10);ceil(-3,10,3,16);ceil(-9,-4,9,10,1);
    const ct=carpetTex('#7d1c24','#5a1219');carpet(-1.1,-4,1.1,10,ct);carpet(-9,1.55,-1.1,3.25,ct);carpet(-1.6,11,1.6,15.6,ct);
    [[6,-1.5],[6,5.5],[-6,-1.5],[-6,5.5]].forEach(c=>column(c[0],c[1]));
    chand(0,6.2);chand(0,-1.2);chand(0,13);
    painting(-5,2.3,-3.8,0,1.3,1.6,artTex('p',1));painting(5,2.3,-3.8,0,1.3,1.6,artTex('p',2));painting(-5.5,2.3,9.8,Math.PI,1.8,1.3,artTex('l',3));painting(5.5,2.3,9.8,Math.PI,1.8,1.3,artTex('l',4));
    painting(-8.8,2.3,7,Math.PI/2,1.2,1.5,artTex('p',5));painting(8.8,2.3,7,-Math.PI/2,1.2,1.5,artTex('p',6));painting(-2.8,2.2,13,Math.PI/2,.9,1.1,artTex('l',7));
    bench(-7.5,8.6,0);bench(7.5,8.6,0);
    /* POI 1 — display case */
    ibox(1.3,.95,.9,IM.wain,-4,.475,-.3);ibox(1.36,.06,.96,IM.trim,-4,.97,-.3);ibox(.9,.03,.5,IM.red,-4,1.015,-.3);
    iadd(new THREE.BoxGeometry(1.2,.72,.82),IM.glass,-4,1.36,-.3,0,false);
    iadd(new THREE.CylinderGeometry(.16,.13,.2,24,1,true),IM.gold2,-4.22,1.13,-.3);
    for(let i=0;i<8;i++){const a=i/8*6.283;iadd(new THREE.SphereGeometry(.028,8,6),IM.gold,-4.22+Math.cos(a)*.16,1.25,-.3+Math.sin(a)*.16)}
    iadd(new THREE.SphereGeometry(.035,10,8),SM('#c0182a',{roughness:.2,metalness:.3}),-4.22,1.15,-.14);
    iadd(new THREE.LatheGeometry([[0,0],[.08,0],[.025,.03],[.015,.14],[.065,.2],[.08,.29],[.075,.29]].map(p=>new THREE.Vector2(p[0],p[1])),20),IM.gold2,-3.78,1.03,-.25);
    ibox(.34,.02,.14,IM.trim,-4,1.0,.17);
    /* Menelik II's reception room */
    hw(-3,-19,-9);hw(8,-19,-9);vw(-19,-3,8,[],{win:[0,5]});floor(-19,-3,-9,8);ceil(-19,-3,-9,8,1);
    carpet(-18.4,-1.6,-10.6,6.4,carpetTex('#6e1b22','#4d1016'));
    iadd(new THREE.CylinderGeometry(1.6,1.7,.3,28),IM.red,-17,.15,2.4);iadd(new THREE.CylinderGeometry(1.72,1.72,.04,28),IM.trim,-17,.31,2.4);
    ibox(.9,.5,.85,IM.gold,-17.1,.55,2.4);ibox(.8,.12,.75,IM.red,-17.05,.86,2.4);ibox(.14,1.7,.95,IM.gold,-17.55,1.6,2.4);ibox(.04,1.3,.7,IM.red,-17.47,1.6,2.4);
    ibox(.7,.4,.1,IM.gold,-17.05,1.05,2.85);ibox(.7,.4,.1,IM.gold,-17.05,1.05,1.95);iadd(new THREE.SphereGeometry(.12,12,8),IM.gold,-17.55,2.55,2.4);
    painting(-16,2.4,-2.8,0,1.3,1.6,artTex('p',8));painting(-12,2.4,-2.8,0,1.3,1.6,artTex('p',9));painting(-14,2.4,7.8,Math.PI,2,1.4,artTex('l',10));
    [-1,5.8].forEach(z=>{ibox(.6,.45,.6,IM.red,-12.5,.3,z);ibox(.6,.9,.1,IM.wain,-12.5,.7,z+(z<0?-.3:.3))});
    chand(-14,2.4);
    /* Empress Taytu's rooms */
    hw(-3,9,19,[[13,15]]);hw(8,9,19);vw(19,-3,8,[],{win:[.5,5]});floor(9,-3,19,8);ceil(9,-3,19,8,1);
    carpet(15,3.6,18.6,7.6,carpetTex('#2f4a6e','#22344f'));
    ibox(2.1,.45,1.6,IM.wain,17.7,.225,5.6);ibox(2,.18,1.5,IM.white,17.7,.54,5.6);ibox(1.4,.06,1.54,IM.blue,17.4,.66,5.6);ibox(.12,1.4,1.7,IM.wain,18.8,.7,5.6);
    ibox(1.6,.9,.55,IM.wain,10.6,.45,-2.4);ibox(.9,1.1,.05,SM('#cfe0e6',{metalness:.6,roughness:.15}),10.6,1.65,-2.6);
    painting(16.5,2.4,-2.8,0,1.4,1.1,artTex('l',11));painting(12,2.4,7.8,Math.PI,1.2,1.5,artTex('p',12));
    chand(14,2.4);
    /* north corridor */
    vw(-1.5,-15.5,-4);vw(1.5,-15.5,-4);floor(-1.5,-15.5,1.5,-4);ceil(-1.5,-15.5,1.5,-4);carpet(-.8,-15.5,.8,-4,ct);
    painting(-1.32,2.2,-8,Math.PI/2,.9,1.2,artTex('p',13));painting(1.32,2.2,-11,-Math.PI/2,.9,1.2,artTex('l',14));
    {const L=new THREE.PointLight(0xffd8a0,.45,10,1.6);L.position.set(0,3.4,-10);inS.add(L)}
    /* east passage (the re-route) */
    vw(12.5,-19.5,-3);vw(15.5,-22.5,-3,[],{win:[-16,-6.5]});hw(-19.5,5.5,12.5);hw(-22.5,5.3,15.5);
    floor(12.5,-22.5,15.5,-3);floor(5.5,-22.5,12.5,-19.5);ceil(12.5,-22.5,15.5,-3);ceil(5.5,-22.5,12.5,-19.5);
    carpet(13.2,-19,14.8,-3.4,ct);
    const vcan=document.createElement('canvas');vcan.width=448;vcan.height=252;const vctx=vcan.getContext('2d');
    {const g=vctx.createLinearGradient(0,0,448,252);g.addColorStop(0,'#21342a');g.addColorStop(1,'#0e1712');vctx.fillStyle=g;vctx.fillRect(0,0,448,252);vctx.fillStyle='#fff';vctx.font='600 26px "Indoor Inter",Inter,sans-serif';vctx.textAlign='center';vctx.fillText('▶  The palace from above',224,134)}
    const vTex=new THREE.CanvasTexture(vcan);IM.screen.map=vTex;
    ibox(.08,1.16,2.0,IM.frame,12.68,1.9,-11);iadd(new THREE.PlaneGeometry(1.84,1.03),IM.screen,12.73,1.9,-11,Math.PI/2,false);
    ibox(.5,.44,1.5,IM.wain,15.05,.22,-11);
    painting(12.68,2.2,-16,Math.PI/2,.9,1.2,artTex('p',15));painting(12.68,2.2,-6.5,Math.PI/2,.9,1.2,artTex('l',16));
    {const L=new THREE.PointLight(0xffd8a0,.45,12,1.6);L.position.set(14,3.4,-11);inS.add(L)}
    /* Egg House: octagon, two levels */
    const EA=5.5,ER=EA/Math.cos(Math.PI/8),EZ=-21;
    const ov=k=>{const a=Math.PI/8+k*Math.PI/4;return[ER*Math.cos(a),EZ+ER*Math.sin(a)]};
    for(let k=0;k<8;k++){const a=ov(k),b=ov(k+1),L=Math.hypot(b[0]-a[0],b[1]-a[1]);wall(a[0],a[1],b[0],b[1],(k===1||k===7)?[[L/2-1.2,L/2+1.2]]:[]);wall(a[0],a[1],b[0],b[1],[],{y0:WH,h:3.6,win:k%2===0?[L/2]:[]})}
    {const g=new THREE.CircleGeometry(ER,8,-Math.PI/8);g.rotateX(-Math.PI/2);const uv=g.attributes.uv;for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*ER*2/3,uv.getY(i)*ER*2/3);iadd(g,IM.wood,0,.005,EZ,0,false)}
    {const sh=new THREE.Shape();for(let k=0;k<8;k++){const v=ov(k);k?sh.lineTo(v[0],v[1]):sh.moveTo(v[0],v[1])}sh.closePath();
     const ho=new THREE.Path();ho.moveTo(-4.15,-24.3);ho.lineTo(-4.15,-17.1);ho.lineTo(-2.65,-17.1);ho.lineTo(-2.65,-24.3);ho.closePath();sh.holes.push(ho);
     const sg=new THREE.ExtrudeGeometry(sh,{depth:.22,bevelEnabled:false});sg.rotateX(Math.PI/2);const uv=sg.attributes.uv;for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)/3,uv.getY(i)/3);
     iadd(sg,IM.wood,0,WH,0)}
    {const d=new THREE.Mesh(new THREE.SphereGeometry(ER*.98,40,16,0,Math.PI*2,0,Math.PI/2),IM.dome);d.scale.y=.72;d.position.set(0,WH+3.6,EZ);inS.add(d)}
    for(let i=0;i<14;i++){const rr=WH/14;ibox(1.3,(i+1)*rr,.5,IM.stone,-3.4,(i+1)*rr/2,-17.2-(i+.5)*.5);ibox(1.3,.04,.52,IM.wain,-3.4,(i+1)*rr+.02,-17.2-(i+.5)*.5)}
    {const rl=iadd(new THREE.BoxGeometry(.06,.06,8.2),IM.gold,-2.72,WH/2+.95,-20.7);rl.rotation.x=Math.atan2(WH,7);for(let i=0;i<5;i++){const zz=-17.6-i*1.6,yy=(17.6+zz>0?0:(-17.2-zz)/7*WH);ibox(.04,.95,.04,IM.gold,-2.72,yy+.47,zz)}}
    ibox(.06,.06,7.2,IM.gold,-2.62,WH+1,-20.7);for(let i=0;i<6;i++)ibox(.04,1,.04,IM.gold,-2.62,WH+.5,-17.3-i*1.38);ibox(1.5,.06,.06,IM.gold,-3.4,WH+1,-17.1);
    carpet(-1.6,-23.6,1.9,-18.4,carpetTex('#7d1c24','#5a1219'));
    iadd(new THREE.CylinderGeometry(.35,.42,.9,20),IM.white,-.6,.45,-22.6);{const eg=iadd(new THREE.SphereGeometry(.26,24,16),IM.gold,-.6,1.16,-22.6);eg.scale.y=1.3}
    painting(3.9,2.3,-25.0,-Math.PI/4,1,1.3,artTex('p',17));
    chand(0,-21);
    ibox(1.6,.08,.8,IM.wain,2.6,WH+.78,-24.4,-Math.PI/4);[[-.6,-.25],[.6,.25]].forEach(o=>ibox(.08,.76,.08,IM.wain,2.6+o[0]*.7,WH+.38,-24.4-o[0]*.7+o[1],-Math.PI/4));
    ibox(.9,.02,1.5,IM.red,1.6,WH+.02,-19.6);ibox(.55,.5,.55,IM.red,1.7,WH+.25,-23.2);
    {const L=new THREE.PointLight(0xffe2b8,.55,12,1.6);L.position.set(0,WH+2.8,EZ);inS.add(L)}

    /* navigator (blue) */
    const navG=new THREE.Group();inS.add(navG);
    const bm=new THREE.MeshStandardMaterial({color:'#2f6bff',emissive:'#1b3fa8',emissiveIntensity:.4,roughness:.35});
    const ncone=new THREE.Mesh(new THREE.ConeGeometry(.22,.66,16),bm);ncone.rotation.x=Math.PI;ncone.position.y=.4;ncone.castShadow=true;navG.add(ncone);
    const nball=new THREE.Mesh(new THREE.SphereGeometry(.29,24,16),bm);nball.position.y=.98;nball.castShadow=true;navG.add(nball);
    const ndot=new THREE.Mesh(new THREE.SphereGeometry(.1,12,8),new THREE.MeshBasicMaterial({color:'#fff'}));ndot.position.set(0,1.0,.24);navG.add(ndot);
    const ndisc=new THREE.Mesh(new THREE.CircleGeometry(.48,32),new THREE.MeshBasicMaterial({color:'#2f6bff',transparent:true,opacity:.22,depthWrite:false}));ndisc.rotation.x=-Math.PI/2;ndisc.position.y=.035;navG.add(ndisc);
    {const s=new THREE.Shape();s.moveTo(0,-.95);s.lineTo(-.26,-.55);s.lineTo(.26,-.55);s.closePath();const g=new THREE.ShapeGeometry(s);g.rotateX(-Math.PI/2);const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:'#2f6bff',transparent:true,opacity:.75,depthWrite:false}));m.position.y=.04;navG.add(m)}
    const nrings=[0,1].map(()=>{const m=new THREE.Mesh(new THREE.RingGeometry(.44,.52,40),new THREE.MeshBasicMaterial({color:'#4f8dff',transparent:true,depthWrite:false}));m.rotation.x=-Math.PI/2;m.position.y=.04;navG.add(m);return m});
    /* destination marker */
    const dRing=new THREE.Group();inS.add(dRing);dRing.visible=false;
    const dr1=new THREE.Mesh(new THREE.RingGeometry(.5,.62,40),new THREE.MeshBasicMaterial({color:'#3fdc2c',transparent:true,depthWrite:false,side:THREE.DoubleSide}));dr1.rotation.x=-Math.PI/2;dr1.position.y=.05;dRing.add(dr1);
    const dr2=new THREE.Mesh(new THREE.CircleGeometry(.3,24),new THREE.MeshBasicMaterial({color:'#3fdc2c',transparent:true,opacity:.6,depthWrite:false}));dr2.rotation.x=-Math.PI/2;dr2.position.y=.05;dRing.add(dr2);
    /* route ribbon: chevrons flow toward the destination; walked part turns grey */
    const chev=chevTex();
    const rMat=new THREE.MeshBasicMaterial({map:chev,transparent:true,opacity:.95,depthWrite:false,side:THREE.DoubleSide,color:'#ffffff'});
    const dMat=new THREE.MeshBasicMaterial({color:'#9aa49e',transparent:true,opacity:.55,depthWrite:false,side:THREE.DoubleSide});
    let rMesh=null,dMesh=null;
    const buildRibbon=path=>{const ds=.12,n=Math.max(2,Math.ceil(path.L/ds)+1),pos=[],uv=[],idx=[],p=new THREE.Vector3(),d=new THREE.Vector3();
      for(let i=0;i<n;i++){const s=Math.min(path.L,i*ds);path.at(s,p);path.dir(s,d);let nx=-d.z,nz=d.x;const l=Math.hypot(nx,nz)||1;nx/=l;nz/=l;const y=p.y+.045+(Math.abs(d.y)>.2?.32:0),w=.24;
        pos.push(p.x+nx*w,y,p.z+nz*w,p.x-nx*w,y,p.z-nz*w);uv.push(0,s/.9,1,s/.9);if(i){const k=i*2;idx.push(k-2,k-1,k,k-1,k+1,k)}}
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);return{g,n,ds}};
    const setRoute=(path,dest)=>{clearRoute();const rb=buildRibbon(path);rMesh=new THREE.Mesh(rb.g,rMat);dMesh=new THREE.Mesh(rb.g,dMat);rMesh.renderOrder=3;dMesh.renderOrder=2;
      rMesh.onBeforeRender=()=>rb.g.setDrawRange(rb.rs,rb.rc);dMesh.onBeforeRender=()=>rb.g.setDrawRange(0,rb.dc);rb.rs=0;rb.rc=0;rb.dc=0;
      inS.add(rMesh,dMesh);Z.route={path,dest,t0:performance.now(),ann:new Set(),rb,arr:false};dRing.position.copy(path.p[path.p.length-1]);dRing.visible=true};
    const clearRoute=()=>{if(rMesh){inS.remove(rMesh,dMesh);rMesh.geometry.dispose()}rMesh=dMesh=null;Z.route=null;dRing.visible=false};

    const inCam=new THREE.PerspectiveCamera(58,1,.08,200);
    const droneCam=new THREE.PerspectiveCamera(40,16/9,1,500);
    const rtV=new THREE.WebGLRenderTarget(448,252),pxV=new Uint8Array(448*252*4),idV=vctx.createImageData(448,252);
    const droneFrame=t=>{const c=palG.position,a=2.1+t*.1,r=26-t*.35,hh=13-t*.22;droneCam.position.set(c.x+Math.sin(a)*r,hh,c.z+Math.cos(a)*r);droneCam.lookAt(c.x,1.5,c.z);
      const vis=[tube.visible,tubeDone.visible,pin.visible,hl.visible];tube.visible=tubeDone.visible=pin.visible=hl.visible=false;actRing.visible=false;FLOATS.forEach(g=>g.visible=false);HALOS.forEach(g=>g.visible=false);
      renderer.setRenderTarget(rtV);renderer.render(scene,droneCam);renderer.readRenderTargetPixels(rtV,0,0,448,252,pxV);renderer.setRenderTarget(null);
      [tube.visible,tubeDone.visible,pin.visible,hl.visible]=vis;
      for(let y=0;y<252;y++)idV.data.set(pxV.subarray((251-y)*448*4,(252-y)*448*4),y*448*4);vctx.putImageData(idV,0,0);vTex.needsUpdate=true};
    const snap=(pos,look,w,hh)=>{w=w||960;hh=hh||600;const W2=Math.round(w*1.5),H2=Math.round(hh*1.5);const c=new THREE.PerspectiveCamera(46,W2/H2,.05,200);c.position.set(...pos);c.lookAt(...look);
      const rt=new THREE.WebGLRenderTarget(W2,H2),px=new Uint8Array(W2*H2*4);const nv=navG.visible,rv=rMesh&&rMesh.visible,dv=dRing.visible;navG.visible=false;dRing.visible=false;if(rMesh){rMesh.visible=dMesh.visible=false}
      renderer.setRenderTarget(rt);renderer.render(inS,c);renderer.readRenderTargetPixels(rt,0,0,W2,H2,px);renderer.setRenderTarget(null);rt.dispose();
      navG.visible=nv;dRing.visible=dv;if(rMesh){rMesh.visible=dMesh.visible=rv}
      const a=document.createElement('canvas');a.width=W2;a.height=H2;const ax=a.getContext('2d'),id=ax.createImageData(W2,H2);for(let y=0;y<H2;y++)id.data.set(px.subarray((H2-1-y)*W2*4,(H2-y)*W2*4),y*W2*4);ax.putImageData(id,0,0);
      const b=document.createElement('canvas');b.width=w;b.height=hh;const bx=b.getContext('2d');bx.imageSmoothingQuality='high';bx.drawImage(a,0,0,w,hh);return b.toDataURL('image/jpeg',.86)};

    /* ---------- beats (the indoor story) ---------- */
    const now=()=>performance.now();
    const bump=()=>Z.bump();
    const later=(ms,fn)=>Z.q.push({t:now()+ms,fn,b:Z.beat});
    const fr=(pos,look,look2)=>{Z.cam={t:'frame',pos,look,look2}};
    const wp=new THREE.Vector3(0,0,17.6);let yaw=Math.PI;
    const setWalk=(path,s0,s1,v,cb,ex)=>{Z.walk={path,s:s0,s1,v,cb,ex:!!ex,done:false,lead:Z.cp?Z.cp.clone():null};Z.cam={t:'follow'}};
    const routeState=()=>{const r=Z.route,W=Z.walk;if(!r)return null;let sR=0,od=0;if(W&&W.path===r.path)sR=W.s;else{const nn=r.path.near(wp);sR=nn.s;od=nn.d}
      const rem=Math.max(0,r.path.L-sR),nx=r.path.man.map((m,i)=>Object.assign({i},m)).find(m=>m.s>sR+.3);return{r,sR,od,rem,nx}};
    const announce=()=>{const q=routeState();if(!q)return;const Lx=TX[Z.lang];if(q.nx){const d=q.nx.s-q.sR;if(d<=14){q.r.ann.add(q.nx.i);navSay(Lx.say[q.nx.k](Math.max(1,Math.round(d))));return}navSay(Lx.say.straight(Math.round(d)))}else navSay(Lx.say.straight(Math.round(q.rem)))};
    const go=id=>{Z.beat=id;Z.bt0=now();Z.nudged=false;Z.wait='none';Z.coach=null;Z.onNext=Z.onClick=null;BT[id]();bump()};
    const BT={
      enter(){Z.cap=null;Z.hud=false;Z.hs=null;setWalk(P.enter,0,P.enter.L,2.0,()=>{Z.cap={eye:'MENELIK II PALACE',h:'Inside the palace.',p:'GPS can’t follow us in here — indoor positioning takes over.'};Z.wait='scroll';Z.onNext=()=>go('ask');bump()},true);Z.wait='walk'},
      ask(){Z.cap={h:'Where should we go next?',dest:'recep'};Z.preview={pt:P.r1.p[P.r1.p.length-1],k:'recep'};dRing.position.copy(Z.preview.pt);dRing.visible=true;fr([1.0,2.6,8.4],[-8,1.3,2.4]);Z.wait='click';Z.nudgeKey='nav';Z.onClick=A.navigate},
      nav1(){Z.cap=null;Z.preview=null;Z.hud=true;setRoute(P.r1,'recep');setWalk(P.r1,0,POI1_STOP,1.9,()=>go('poi1p'));Z.wait='walk';announce()},
      poi1p(){Z.hs='poi1';Z.coach={h:'See something interesting?',p:'Select the glowing point to take a closer look.'};fr([-1.4,2.2,4.6],[-4,1.1,-.3]);Z.wait='click';Z.nudgeKey='poi1';Z.onClick=()=>A.openPoi('poi1')},
      poi1(){Z.card='poi1';Z.gi=0;if(!Z.imgs.poi1)Z.imgs.poi1=[snap([-3.05,1.55,1.25],[-4,1.0,-.3]),snap([6.5,3.0,8.8],[-5,1.2,0]),snap([-4.25,1.95,.45],[-4.05,1.05,-.32])];fr([-1.9,2.0,3.2],[-4.4,1.2,-.3]);Z.wait='click';Z.nudgeKey='close';Z.onClick=A.closeCard},
      nav1b(){Z.hs=null;setWalk(P.r1,POI1_STOP,P.r1.L,1.9,()=>go('arr1'));Z.wait='walk'},
      arr1(){Z.cap={h:'Menelik II’s reception room.',p:'One of the historic spaces preserved inside the palace.'};Z.hs='poi2';fr([-10.4,2.5,6.6],[-17.2,1.4,2.4],[-15.2,1.9,-2]);Z.wait='click';Z.nudgeKey='poi2';Z.onClick=()=>A.openPoi('poi2')},
      poi2(){Z.cap=null;Z.card='poi2';if(!Z.imgs.poi2)Z.imgs.poi2=snap([-12.8,1.9,4.4],[-17.2,1.4,2.4],420,420);narStart();fr([-11.6,2.3,5.6],[-17.4,1.4,2.4]);Z.wait='click';Z.nudgeKey='close';Z.onClick=A.closeCard},
      ask2(){Z.hs=null;clearRoute();Z.hud=false;Z.cap={h:'Next: the Egg House.',p:N.on?'Your story keeps playing while we walk.':'The route continues deeper into the palace.',dest:'egg'};Z.preview={pt:P.r2.p[P.r2.p.length-1],k:'egg'};dRing.position.copy(Z.preview.pt);dRing.visible=true;fr([-16.6,2.5,4.8],[-4,1.4,2.4]);Z.wait='click';Z.nudgeKey='nav';Z.onClick=A.navigate},
      nav2(){Z.cap=null;Z.preview=null;Z.hud=true;setRoute(P.r2,'egg');setWalk(P.w2,0,P.w2.L,1.8,()=>go('reroute'));Z.wait='walk';announce()},
      reroute(){Z.rr=true;navSay(TX[Z.lang].say.rr);later(1800,()=>{Z.rr=false;Z.off=false;setRoute(P.r3,'egg');go('nav3')})},
      nav3(){setWalk(P.r3,0,POI3_STOP,1.9,()=>go('poi3p'));Z.wait='walk';announce()},
      poi3p(){Z.hs='poi3';Z.coach={h:'Something’s playing here.',p:'Select the screen to watch.'};fr([14.6,2.3,-7.6],[12.7,1.9,-11.3]);Z.wait='click';Z.nudgeKey='poi3';Z.onClick=()=>A.openPoi('poi3')},
      poi3(){Z.card='poi3';if(N.on)narStop();V.t=0;V.playing=true;droneFrame(0);Z.wait='click';Z.nudgeKey='close';Z.onClick=A.closeCard},
      lang(){Z.hs=null;Z.langDone=false;Z.wait='click';Z.nudgeKey='lang';Z.onClick=()=>A.setLang('am')},
      nav3b(){setWalk(P.r3,POI3_STOP,P.r3.L,1.9,()=>go('egg'));Z.wait='walk'},
      egg(){Z.cap={eye:'EGG HOUSE',h:'This is the Egg House.',p:'A two-story part of the historic palace complex.'};fr([4.4,2.4,-18.6],[-3.4,1.9,-21]);Z.wait='scroll';Z.onNext=()=>go('eggup')},
      eggup(){Z.cap={eye:'EGG HOUSE',h:'Looks like the route continues above us.',p:'One building. Two levels.',btn:1};Z.showFloor=true;Z.floor=0;setRoute(P.r4,'upper');fr([3.6,3.2,-17.2],[-3,2.6,-21.5]);Z.wait='click';Z.nudgeKey='up';Z.onClick=A.upstairs;announce()},
      climb(){Z.cap=null;setWalk(P.r4,0,P.r4.L,1.6,()=>go('upper'));Z.wait='walk'},
      upper(){Z.cap={eye:'EGG HOUSE · UPPER LEVEL',h:'Now we’re upstairs.',p:'It once served as a prayer room, observation balcony and office.',end:1};fr([3.0,WH+2.5,-17.8],[-1.6,WH+1.6,-24.2]);Z.wait='none'}
    };

    /* ---------- actions ---------- */
    const V0={az:.62,el:.62,dist:121,tx:-6.2,tz:4.8};
    const S={az:V0.az,el:V0.el,dist:V0.dist,tx:V0.tx,tz:V0.tz,ty:0,az0:V0.az,el0:V0.el,dist0:V0.dist,mx:0,my:0};
    const setStage=n=>{Z.stage=n;Z.uT=n<0?0:OUT_STAGES[n].u;if(n===0&&!Z.tubeT0)Z.tubeT0=now();bump()};
    A.begin=()=>{Z.started=true;Z.tubeT0=now();setStage(0)};
    A.stepInside=()=>{if(Z.mode!=='out'||Z.stage!==3)return;Z.mode='door';Z.doorT0=now();Z.dS={tx:S.tx,tz:S.tz,ty:S.ty,dist:S.dist,el:S.el,az:S.az};bump()};
    A.navigate=()=>{if(Z.beat==='ask')go('nav1');else if(Z.beat==='ask2')go('nav2')};
    A.openPoi=id=>{if(Z.hs===id&&!Z.card)go(id)};
    A.closeCard=()=>{const c=Z.card;if(!c)return;Z.card=null;Z.lb=null;if(c==='poi3')V.playing=false;go({poi1:'nav1b',poi2:'ask2',poi3:'lang'}[c])};
    A.setLang=l=>{const ch=l!==Z.lang;Z.lang=l;if(ch&&N.on&&!N.ducked){hush();narSpeak()}if(Z.beat==='lang'&&!Z.langDone){Z.langDone=true;later(1500,()=>go('nav3b'))}bump()};
    A.upstairs=()=>{if(Z.beat==='eggup')go('climb')};
    A.voice=()=>{Z.voice=!Z.voice;if(N.on&&!N.ducked){hush();narSpeak()}bump()};
    A.narToggle=()=>{if(N.on){narStop()}else{if(N.i>=nS().length)N.i=0;N.on=true;narSpeak()}bump()};
    A.vidToggle=()=>{if(V.playing)V.playing=false;else{if(V.t>=V.dur)V.t=0;V.playing=true}bump()};
    A.lb=i=>{Z.lb=i;bump()};A.lbClose=()=>{Z.lb=null;bump()};A.lbStep=d=>{Z.lb=(Z.lb+d+3)%3;Z.gi=Z.lb;bump()};
    A.advance=()=>{
      if(Z.mode==='out'){if(!Z.started)return;if(Z.stage<3)setStage(Z.stage+1);else A.stepInside();return}
      if(Z.mode==='door'||Z.lb!=null)return;
      if(Z.wait==='scroll'&&Z.onNext)Z.onNext();
      else if(Z.wait==='click'){if(Z.nudged&&Z.onClick)Z.onClick();else{Z.nudged=true;bump()}}
      else if(Z.wait==='walk')Z.ffT=now()+1500};
    A.back=()=>{if(Z.mode!=='out'||Z.stage<0)return;if(Z.stage===0){Z.stage=-1;Z.uT=0;Z.started=false;Z.tubeT0=0;bump()}else setStage(Z.stage-1)};
    A.replay=()=>{narStop();V.playing=false;clearRoute();Object.assign(Z,{stage:-1,mode:'out',started:false,u:0,uT:0,beat:null,cap:null,coach:null,hud:false,walk:null,hs:null,card:null,lb:null,preview:null,wait:'none',rr:false,off:false,duck:false,showFloor:false,q:[],tubeT0:0,cp:null,cl:null});
      wp.set(0,0,17.6);A.reset();bump()};
    A.zoom=dv=>{if(dv>0&&Z.active==null&&S.dist0+dv>=V0.dist*.97){goHome();return}S.dist0=Math.max(24,Math.min(170,S.dist0+dv))};
    const isMob=()=>el.clientWidth<=900&&el.clientHeight>=el.clientWidth;
    const MOFF=()=>{if(!isMob())return[0,0,1,0];const a=el.clientWidth/el.clientHeight,H=el.clientHeight,rem=Math.max(H*.3,H-(Z.heroB||H*.3));return[2-V0.tx,4-V0.tz,Math.min(3.2,Math.max(.95,(a<.62?.59:.5)/a*(H/rem))),a<.62?1.0:.55]};
    A.reset=()=>{S.az0=V0.az;S.el0=V0.el;S.dist0=V0.dist;S.px=V0.tx;S.pz=V0.tz;Z.saved=null};A.reset();
    S.dist=V0.dist*2.1;S.el=V0.el+.42;S.az=V0.az-.7;Z.holdCam=true;
    Z.introCover=true;Z.introFrame=0;
    A.introReveal=()=>{Z.introCover=false;Z.holdCam=false;Z.slowUntil=now()+3000};
    const PD={4:32,10:42};
    A.focus=i=>{if(i!=null){const p=PLACES[i];if(!Z.saved)Z.saved={px:S.px,pz:S.pz,d:S.dist0,az:S.az0,el:S.el0};const o=MOFF();S.px=p.x-o[0];S.pz=p.z+(isMob()?6:0)-o[1];S.dist0=(PD[p.n]||38)*(isMob()?1.5:1)/o[2]}
      else if(Z.saved){const v=Z.saved;S.px=v.px;S.pz=v.pz;S.dist0=v.d;S.az0=v.az;S.el0=v.el;Z.saved=null}};
    const clampPan=()=>{S.px=Math.max(-52,Math.min(52,S.px));S.pz=Math.max(-42,Math.min(42,S.pz))};
    const gplane=new THREE.Plane(new THREE.Vector3(0,1,0),-GY),gpt=new THREE.Vector3();
    const goHome=()=>{S.px=V0.tx;S.pz=V0.tz;S.dist0=V0.dist;const k=Math.round((S.az-V0.az)/(2*Math.PI));S.az-=k*2*Math.PI;S.az0=V0.az;S.el0=V0.el};
    const zoomAt=(cx,cy,f)=>{if(f>1&&Z.active==null&&S.dist0*f>=V0.dist*.97){goHome();return}const nd=Math.max(24,Math.min(170,S.dist0*f));const r=el.getBoundingClientRect();mv.set((cx-r.left)/r.width*2-1,-(cy-r.top)/r.height*2+1);ray.setFromCamera(mv,cam);
      if(ray.ray.intersectPlane(gplane,gpt)){const k=1-nd/S.dist0;S.px+=(gpt.x-S.px)*k;S.pz+=(gpt.z-S.pz)*k;clampPan()}S.dist0=nd};
    const enterIndoor=()=>{Z.mode='in';Z.doorFadeT0=now();Z.u=1;Z.snapCam=true;wp.set(0,0,17.6);go('enter')};

    /* ---------- input: one gesture = one meaningful step ---------- */
    let lock=false,lastW=0,trigT=0,acc=0;
    const inUI=e=>e.target&&e.target.closest&&e.target.closest('.poi,.lbx');
    const gesture=dir=>{lock=true;trigT=now();dir>0?A.advance():A.back()};
    const wheelEv=e=>{if(inUI(e))return;e.preventDefault();if(Z.mode==='out'&&!Z.started){if(e.target&&e.target.closest&&e.target.closest('.copy,.hd,.ctl'))return;zoomAt(e.clientX,e.clientY,Math.exp((e.deltaY*(e.deltaMode===1?16:1))*.0016));if(!Z.explored){Z.explored=true;Z.bump()}return}const n=now();if(n-lastW>260)acc=0;lastW=n;if(lock)return;acc+=e.deltaY*(e.deltaMode===1?16:1);if(Math.abs(acc)>36){gesture(Math.sign(acc));acc=0}};
    let ty0=null;const ts=e=>{ty0=inUI(e)?null:e.touches[0].clientY},te=e=>{if(ty0==null)return;const dy=ty0-e.changedTouches[0].clientY;ty0=null;if(Math.abs(dy)>44&&!lock)gesture(Math.sign(dy))};
    const kd=e=>{if(e.target&&/INPUT|TEXTAREA/.test(e.target.tagName))return;if([' ','ArrowDown','PageDown'].includes(e.key)){e.preventDefault();if(!lock)gesture(1)}else if(['ArrowUp','PageUp'].includes(e.key)){e.preventDefault();if(!lock)gesture(-1)}else if(e.key==='Escape'){if(Z.lb!=null)A.lbClose();else if(Z.card)A.closeCard()}};
    addEventListener('touchstart',ts,{passive:true});addEventListener('touchend',te,{passive:true});addEventListener('keydown',kd);addEventListener('wheel',wheelEv,{passive:false});
    let drag=false,lx=0,ly=0;const cv=renderer.domElement;
    let dx0=0,dy0=0;const hitF=e=>{const r=cv.getBoundingClientRect();mv.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);ray.setFromCamera(mv,cam);const h=ray.intersectObjects(FLOATS.filter(g=>g.visible),true)[0];return h?h.object.userData.pi:null};
    const ptrs=new Map();let pmode='',pinch0=0,pd0=0,moved=0;
    const idle=()=>Z.stage<0&&Z.mode==='out';
    const pdist=()=>{const v=[...ptrs.values()];return Math.hypot(v[0].x-v[1].x,v[0].y-v[1].y)};
    const down=e=>{if(!idle())return;ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});cv.setPointerCapture(e.pointerId);
      if(ptrs.size===1){dx0=e.clientX;dy0=e.clientY;moved=0;const zin=S.dist0<V0.dist*.82;pmode=(e.button===2||e.shiftKey||e.ctrlKey||e.altKey)?(zin?'rot':'pan'):(zin?'pan':'rot');drag=true;cv.style.cursor='grabbing'}
      else if(ptrs.size===2){pmode='pinch';pinch0=pdist();pd0=S.dist0}};
    const up=e=>{if(!ptrs.has(e.pointerId))return;ptrs.delete(e.pointerId);if(ptrs.size>0){if(ptrs.size===1)pmode=S.dist0<V0.dist*.82?'pan':'rot';return}
      drag=false;cv.style.cursor='';if(idle()&&pmode!=='pinch'&&moved<6){const i=hitF(e);if(i!=null)A.pick(i)}pmode=''};
    const move=e=>{const r=cv.getBoundingClientRect();S.mx=(e.clientX-r.left)/r.width-.5;S.my=(e.clientY-r.top)/r.height-.5;
      if(idle()&&!ptrs.size){const i=hitF(e);if(i!==Z.hov)Z.hov=i;cv.style.cursor=i!=null?'pointer':(S.dist0<V0.dist*.82?'move':'grab')}
      if(!ptrs.has(e.pointerId)||!idle())return;const pr=ptrs.get(e.pointerId),dx=e.clientX-pr.x,dy=e.clientY-pr.y;ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});moved+=Math.abs(dx)+Math.abs(dy);
      if(pmode==='pinch'&&ptrs.size===2){const d=pdist();if(d>10){const v=[...ptrs.values()];zoomAt((v[0].x+v[1].x)/2,(v[0].y+v[1].y)/2,(pd0*pinch0/d)/S.dist0)}}
      else if(pmode==='rot'){S.az0=S.az0-dx*.005;S.el0=Math.max(.4,Math.min(1.3,S.el0+dy*.004));if(moved>6&&!Z.explored){Z.explored=true;Z.bump()}}
      else if(pmode==='pan'){const k=2*S.dist*Math.tan(cam.fov*Math.PI/360)/el.clientHeight,ca=Math.cos(S.az),sa=Math.sin(S.az),se=Math.max(.4,Math.sin(S.el));
        S.px-=ca*dx*k;S.pz+=sa*dx*k;S.px-=sa*dy*k/se;S.pz-=ca*dy*k/se;clampPan();if(moved>6&&!Z.explored){Z.explored=true;Z.bump()}}};
    cv.addEventListener('contextmenu',e=>{if(idle())e.preventDefault()});cv.addEventListener('pointercancel',up);
    cv.addEventListener('pointerdown',down);cv.addEventListener('pointermove',move);cv.addEventListener('pointerup',up);
    const resize=()=>{const w=el.clientWidth,hh=el.clientHeight;{const hx=document.querySelector('[data-hero]');Z.heroB=hx?hx.getBoundingClientRect().bottom:0}renderer.setSize(w,hh);cam.aspect=w/hh;const por=w<=900&&hh>=w;cam.fov=por?40:32;cam.updateProjectionMatrix();
      if(!por)cam.setViewOffset(w,hh,-w*(w<=900?.13:.098),(hh<=560&&w<=1000)?-hh*.04:0,w,hh);else{const hb=Math.min(hh*.7,Z.heroB||hh*.3);cam.setViewOffset(w,hh,0,-((hb+hh)/2-hh/2)+8,w,hh)}
      inCam.aspect=w/hh;inCam.fov=w/hh<1?72:56;if(!(w<=900&&hh>=w))inCam.setViewOffset(w,hh,-w*.06,0,w,hh);else inCam.clearViewOffset();inCam.updateProjectionMatrix()};
    const ro=new ResizeObserver(resize);ro.observe(el);resize();setTimeout(resize,300);setTimeout(resize,1200);if(document.fonts&&document.fonts.ready)document.fonts.ready.then(()=>setTimeout(resize,50));

    /* ---------- frame loop ---------- */
    const v=new THREE.Vector3(),tv1=new THREE.Vector3(),tv2=new THREE.Vector3(),dP=new THREE.Vector3(),dL=new THREE.Vector3(),clock=new THREE.Clock();
    const proj=(x,y,z,c,w,hh)=>{v.set(x,y,z).project(c);return[(v.x*.5+.5)*w,(-v.y*.5+.5)*hh,v.z]};
    let raf,vf=0;const hudK={};
    const tick=()=>{
      raf=requestAnimationFrame(tick);
      const dt=Math.min(clock.getDelta(),.05),t=clock.elapsedTime,n=now(),w=el.clientWidth,hh=el.clientHeight;
      if(lock&&n-lastW>220&&n-trigT>520)lock=false;
      if(Z.q.length){const due=Z.q.filter(q=>q.t<=n);Z.q=Z.q.filter(q=>q.t>n);due.forEach(q=>{if(q.b===Z.beat)q.fn()})}
      if(N.on&&!N.ducked)N.el=Math.min(N.el+dt,nCum(N.i+1));
      if(V.playing){V.t+=dt;if(V.t>=V.dur){V.t=V.dur;V.playing=false;bump()}if((vf++)%2===0)droneFrame(V.t)}
      const doorEl=Rf.door;

      if(Z.mode!=='in'){
        /* ===== OUTDOOR ===== */
        const st=Z.stage,p=Z.active!=null?PLACES[Z.active]:null,journey=st>=0||Z.mode==='door';
        if(journey){const d=Z.uT-Z.u;Z.u+=Math.sign(d)*Math.min(Math.abs(d),dt*(.05+Math.abs(d)*1.35));const q=rc.getPointAt(cl(Z.u));pin.position.set(q.x,q.y-.1,q.z)}
        else{Z.u=0;pin.position.set(px0,rpts[0].y-.1,pz0)}
        const rev=journey?cl((n-(Z.tubeT0||n))/900):0,eI=Math.floor(rev*tubeN/3)*3,sI=Math.min(eI,Math.floor(cl(Z.u)*tubeN/3)*3);
        tube.visible=tubeDone.visible=journey;tubeGeo.setDrawRange(sI,eI-sI);tubeDone.geometry.setDrawRange(0,sI);
        hl.visible=journey&&st>=2;hl.position.set(palG.position.x,GY+.12,palG.position.z+.6);hl.scale.setScalar(1.6+((t*.9)%1)*3);hl.material.opacity=1-((t*.9)%1);
        const k=1-Math.pow(.06,dt);
        if(Z.mode==='door'){const u=cl((n-Z.doorT0)/1600),e=ease(u),a=Z.dS;
          S.tx=a.tx+(doorW.x-a.tx)*e;S.tz=a.tz+(doorW.z-a.tz)*e;S.ty=a.ty+(doorW.y-a.ty)*e;S.dist=a.dist+(1.7-a.dist)*e;S.el=a.el+(.1-a.el)*e;S.az=a.az+(-.12-a.az)*e;
          if(u>=1)enterIndoor()}
        else if(st>=0){const pp=pin.position,pal=palG.position;let tX,tZ,tD,tE,tA;
          if(st===0){tX=pp.x;tZ=pp.z;tD=40;tE=.8;tA=-.06}else if(st===1){tX=pp.x;tZ=pp.z;tD=33;tE=.66;tA=-.24}
          else if(st===2){tX=pp.x+(pal.x-pp.x)*.5;tZ=pp.z+(pal.z-pp.z)*.5;tD=29;tE=.6;tA=.18}else{tX=entry.x;tZ=entry.z-2.6;tD=19;tE=.62;tA=.1}
          S.tx+=(tX-S.tx)*k;S.tz+=(tZ-S.tz)*k;S.ty+=(0-S.ty)*k;S.dist+=(tD-S.dist)*k;S.el+=(tE-S.el)*k;S.az+=(tA-S.az)*k}
        else{const k2=Z.holdCam?0:1-Math.pow((Z.slowUntil||0)>n?.2:.001,dt);const mo=MOFF(),tX=S.px+mo[0],tZ=S.pz+mo[1],tD=S.dist0*mo[2];
          S.tx+=(tX-S.tx)*k2;S.tz+=(tZ-S.tz)*k2;S.ty+=(0-S.ty)*k2;S.dist+=(tD-S.dist)*k2;S.az+=(S.az0+(mo[3]||0)+(RM?0:S.mx*.08)-S.az)*k2;S.el+=(S.el0+(RM?0:S.my*.04)-S.el)*k2}
        cam.position.set(S.tx+S.dist*Math.sin(S.az)*Math.cos(S.el),S.ty+S.dist*Math.sin(S.el),S.tz+S.dist*Math.cos(S.az)*Math.cos(S.el));cam.lookAt(S.tx,S.ty,S.tz);
        pinBall.position.y=2.4+(RM?0:Math.sin(t*3)*.15);
        const fk=journey?.75:Math.min(1,Math.max(.42,S.dist/121));
        FLOATS.forEach((g,i)=>{const pl=PLACES[i];g.visible=!journey||(pl.n===4&&st>=1);const hv=Z.hov===i||Z.active===i,ph=((t*.55)%PLACES.length)-i,bounce=(!Z.explored&&!journey&&!RM&&ph>0&&ph<1)?Math.sin(ph*Math.PI)*1.1:0;g.userData.k=(g.userData.k||1)+((hv?1.22:1)-(g.userData.k||1))*.18;g.scale.setScalar(g.userData.s*fk*g.userData.k);
          g.traverse(o=>{if(o.isMesh&&o.material.emissive)o.material.emissiveIntensity=hv?.32:.08});HALOS[i].visible=!journey;const hp=RM?.4:((t*.6+i*.13)%1);HALOS[i].scale.setScalar((1.8+hp*2.6)*fk*(hv?1.3:1));HALOS[i].material.opacity=(1-hp)*(hv?.95:.55);
          g.position.y=TH(pl.x,pl.z)+(FCLR[pl.n]||1.8)+2.25*fk+bounce*fk+(RM?0:Math.sin(t*1.5+i*1.7)*.28)+(pl.n===4&&journey?1.2:0);g.rotation.y=S.az+(RM?0:Math.sin(t*.7+i*1.3)*.55)});
        actRing.visible=!journey&&!!p;if(p){actRing.position.set(p.x,TH(p.x,p.z)+.1,p.z);const ph=RM?.3:(t*.7)%1;actRing.scale.setScalar(2.2+ph*4);actRing.material.opacity=(1-ph)*.85}
        if(Rf.comp)Rf.comp.style.transform=`rotate(${S.az}rad)`;
        rings.forEach((m,i)=>{const ph=RM?.4:(t*.45+i/3)%1;m.scale.setScalar(1+ph*4.5);m.material.opacity=(1-ph)*.55});
        if(!Z.introCover||Z.introFrame++%20===0)renderer.render(scene,cam);
        if(Rf.bubble){const [x,y,z]=proj(pin.position.x,pin.position.y+2.3,pin.position.z,cam,w,hh);Rf.bubble.style.visibility=z<1?'visible':'hidden';Rf.bubble.style.transform=`translate(${x}px,${Math.max(w>900?300:340,y)}px) translate(-50%,-100%)`;
          if(Rf.eta){const rem=Math.max(0,Math.round(OUTM*(1-cl(Z.u))/10)*10);Rf.eta.textContent=rem<15?'Arrived':`${rem} m · ${Math.max(1,Math.ceil(rem/70))} min`}}
        if(Rf.pal){const [x,y,z]=proj(palG.position.x,GY+3.4,palG.position.z,cam,w,hh);Rf.pal.style.visibility=z<1?'visible':'hidden';Rf.pal.style.transform=`translate(${x}px,${y}px) translate(-50%,-100%)`}
        PLACES.forEach((pl,i)=>{const b=Rf.lab[i];if(!b)return;const fk2=Math.min(1,Math.max(.42,S.dist/121)),[x,y,z]=proj(pl.x,TH(pl.x,pl.z)+(FCLR[pl.n]||1.8)+2.4*fk2,pl.z,cam,w,hh),off=Math.max(26,32*121/S.dist*fk2);
          b.style.visibility=(z>1||journey)?'hidden':'visible';b.classList.toggle('dim',Z.active!=null&&Z.active!==i);b.style.zIndex=Math.round((1-z)*1000);
          b.classList.toggle('hv',Z.hov===i);b.style.transform=`translate(${x+off}px,${y}px) translate(0,-50%)`});
        Object.keys(Rf.sub).forEach(k=>{const b=Rf.sub[k];if(!b)return;const [pi,l,px,py]=b._d;const [wx,wz]=W(px,py);const [x,y,z]=proj(wx,TH(wx,wz)+1.4,wz,cam,w,hh);b.style.visibility=(z>1||journey||Z.active!==+pi)?'hidden':'visible';b.style.transform=`translate(${x}px,${y}px) translate(-50%,-100%)`});
        if(doorEl){if(Z.mode==='door'){const u=(n-Z.doorT0)/1600,[x,y]=proj(doorW.x,doorW.y,doorW.z,cam,w,hh),r=sstep(.42,1,u)*Math.max(w,hh)*1.5;
            doorEl.style.opacity=1;doorEl.style.background=`radial-gradient(circle at ${x}px ${y}px,#fff7e4 0,#fff2da ${r*.55}px,rgba(255,242,218,0) ${r+1}px)`}else doorEl.style.opacity=0}
      }else{
        /* ===== INDOOR ===== */
        const W=Z.walk;
        if(W&&!W.done){W.s=Math.min(W.s1,W.s+W.v*dt*((Z.ffT||0)>n?2.6:1));if(W.s>=W.s1-1e-6){W.done=true;const cb=W.cb;W.cb=null;cb&&cb()}}
        const Wn=Z.walk;
        if(Wn){Wn.path.at(Wn.s,wp);const dv=Wn.path.dir(Wn.s);if(Math.hypot(dv.x,dv.z)>.1){const ty=Math.atan2(dv.x,dv.z);let dd=ty-yaw;dd=Math.atan2(Math.sin(dd),Math.cos(dd));yaw+=dd*(1-Math.pow(.002,dt))}}
        navG.position.copy(wp);navG.rotation.y=yaw;nball.position.y=.98+(RM?0:Math.sin(t*3)*.05);ndot.position.y=nball.position.y+.02;
        nrings.forEach((m,i)=>{const ph=RM?.4:(t*.6+i/2)%1;m.scale.setScalar(1+ph*2.2);m.material.opacity=(1-ph)*.6});
        const C=Z.cam||{t:'frame',pos:[0,2.3,13],look:[0,1.3,5]};
        if(C.t==='follow'&&Wn){const sc=Wn.s-4.2;Wn.path.atX(Wn.ex?sc:Math.max(0,sc),tv1);tv1.y+=2.25;
          if(!Wn.ex&&sc<0&&Wn.lead){dP.copy(Wn.lead).lerp(tv1,sstep(-1.8,0,sc))}else dP.copy(tv1);
          Wn.path.atX(Wn.s+3.4,tv2);dL.copy(tv2);dL.y+=1.15}
        else if(C.t==='frame'){dP.set(...C.pos);dL.set(...C.look);if(C.look2){const f=.5-.5*Math.cos((n-Z.bt0)/1000*.3);dL.lerp(tv2.set(...C.look2),f)}if(!RM){dP.x+=Math.sin(t*.23)*.12;dP.y+=Math.sin(t*.31)*.05}}
        if(Z.snapCam||!Z.cp){Z.cp=dP.clone();Z.cl=dL.clone();Z.snapCam=false}
        Z.cp.lerp(dP,1-Math.pow(.05,dt));Z.cl.lerp(dL,1-Math.pow(.035,dt));inCam.position.copy(Z.cp);inCam.lookAt(Z.cl);
        /* route progress */
        const q=routeState();
        if(q){const rb=q.r.rb,tot=(rb.n-1)*6,rev=cl((n-q.r.t0)/900),eI=Math.floor(rev*(rb.n-1))*6,sI=Math.min(eI,Math.floor(q.sR/rb.ds)*6);rb.rs=sI;rb.rc=eI-sI;rb.dc=sI;
          chev.offset.y-=dt*(RM?0:1.1);rMat.color.set(q.od>1.6||Z.rr?'#ffc35a':'#ffffff');
          dRing.visible=q.rem>1.2;}
        dr1.scale.setScalar(1+((t*.8)%1)*1.4);dr1.material.opacity=1-((t*.8)%1);
        if(q&&Z.hud&&Rf.hud){const Lx=TX[Z.lang],paused=PAUSE.has(Z.beat);let kk,tx,dd='',cls='';
          const fm=d=>Math.max(1,Math.round(d))+' '+Lx.m,eta=d=>{const s=d/1.2;return s<60?Lx.lt1:Lx.min(Math.round(s/60))};
          if(Z.rr){kk='rr';tx=Lx.rr;cls='off'}
          else if(q.od>1.6){kk='off';tx=Lx.off;cls='off'}
          else if(paused){kk='pause';tx=Lx.paused;dd=fm(q.rem);cls='pause'}
          else if(q.rem<1.5){kk='here';tx=Lx.here;cls='done'}
          else if(!q.nx){kk='straight';tx=q.rem<10?Lx.ahead:Lx.straight;dd=fm(q.rem);if(q.rem<6)cls='near'}
          else{const d=q.nx.s-q.sR;if(d>14){kk='straight';tx=Lx.straight;dd=fm(d)}else{kk=q.nx.k;tx=Lx[q.nx.k];dd=fm(d);if(d<6)cls='near'}}
          const sub=`${Lx.to} ${DEST[q.r.dest][Z.lang]} · ${q.rem<1.5?'0 '+Lx.m:fm(q.rem)+' · '+eta(q.rem)}`;
          if(hudK.k!==kk||hudK.el!==Rf.hIco){hudK.k=kk;hudK.el=Rf.hIco;if(Rf.hIco){Rf.hIco.innerHTML=icoHTML(kk);Rf.hIco.classList.toggle('spin',kk==='rr')}}
          if(Rf.hTx&&Rf.hTx.textContent!==tx)Rf.hTx.textContent=tx;if(Rf.hSub&&Rf.hSub.textContent!==sub)Rf.hSub.textContent=sub;if(Rf.hD&&Rf.hD.textContent!==dd)Rf.hD.textContent=dd;
          const hc=Rf.hud.classList;hc.toggle('side',!!Z.card);['near','off','done','pause'].forEach(k=>hc.toggle(k,cls===k));
          if(Rf.hBar)Rf.hBar.style.width=(100*(1-q.rem/q.r.path.L))+'%';
          if(!paused&&!Z.rr&&q.od<1.6&&Wn&&!Wn.done){q.r.path.man.forEach((m,i)=>{const d=m.s-q.sR;if(d>0&&d<8.5&&!q.r.ann.has(i)){q.r.ann.add(i);navSay(Lx.say[m.k](Math.max(1,Math.round(d))))}})}
          if(q.rem<1.5&&!q.r.ann.has('h')){q.r.ann.add('h');navSay(Lx.say.here)}}
        if(q){const off=q.od>1.6;if(off!==Z.off){Z.off=off;bump()}}
        if(Z.showFloor){const f=wp.y>WH*.5?1:0;if(f!==Z.floor){Z.floor=f;bump()}}
        renderer.render(inS,inCam);
        ['poi1','poi2','poi3'].forEach(id=>{const b=Rf.hs[id];if(!b)return;const [x,y,z]=proj(...POI[id].pos,inCam,w,hh);b.style.visibility=z<1&&x>-40&&x<w+40?'visible':'hidden';b.style.transform=`translate(${x}px,${y}px) translate(-24px,-50%)`});
        if(Rf.dl){const pt=Z.preview?Z.preview.pt:(Z.route?Z.route.path.p[Z.route.path.p.length-1]:null);if(pt&&(!q||q.rem>1.5)){const [x,y,z]=proj(pt.x,pt.y+1.9,pt.z,inCam,w,hh);Rf.dl.style.visibility=z<1?'visible':'hidden';Rf.dl.style.transform=`translate(${x}px,${y}px) translate(-50%,-100%)`}else Rf.dl.style.visibility='hidden'}
        if(doorEl){const u=cl((n-Z.doorFadeT0)/1300);doorEl.style.opacity=1-sstep(0,1,u);if(u<1)doorEl.style.background='#fff4dd'}
      }
      /* audio + video UI */
      if(Rf.narBar){const d=nDur();Rf.narBar.style.width=(100*N.el/d)+'%';if(Rf.narT)Rf.narT.textContent=fmtT(N.el)+' / '+fmtT(d)}
      if(Rf.vc&&(V.playing||Rf.vcDirty)){Rf.vc.getContext('2d').drawImage(vcan,0,0);Rf.vcDirty=false}
      if(Rf.vBar){Rf.vBar.style.width=(100*V.t/V.dur)+'%';if(Rf.vT)Rf.vT.textContent=fmtT(V.t)+' / '+fmtT(V.dur);if(Rf.vsub){const L=POI.poi3.sub[Z.lang],s=V.t>0&&V.t<V.dur?L[Math.min(2,Math.floor(V.t/V.dur*3))]:'';if(Rf.vsub.textContent!==s)Rf.vsub.textContent=s}}
    };
    tick();
    return()=>{cancelAnimationFrame(raf);ro.disconnect();hush();cv.removeEventListener('pointerdown',down);cv.removeEventListener('pointermove',move);cv.removeEventListener('pointerup',up);
      removeEventListener('wheel',wheelEv);removeEventListener('touchstart',ts);removeEventListener('touchend',te);removeEventListener('keydown',kd);
      renderer.dispose();el.removeChild(cv)};
}
