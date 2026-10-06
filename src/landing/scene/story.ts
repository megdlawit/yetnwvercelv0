import * as THREE0 from 'three-r128';
const THREE:any=THREE0;
import { cl } from './util';

export /* ================= OUTDOOR JOURNEY: 4 meaningful stages ================= */
const OUT_STAGES=[
 {t:'Let’s go.',s:'Follow me to the palace.',u:.36},
 {t:'Follow me.',s:'Up the main avenue.',u:.7},
 {t:'There it is.',s:'Menelik II Palace, straight ahead.',u:.92},
 {t:'We’re here.',s:'Menelik II Palace.',u:1}
];

export /* ================= INDOOR: plan, paths, copy ================= */
const WH=4.2,DH=2.9,WT=.3;
class Path{
 p:any[];d:number[];L:number;man:any;
 constructor(a:any[]){this.p=a.map(q=>new THREE.Vector3(q[0],q[2]||0,q[1]));this.d=[0];for(let i=1;i<this.p.length;i++)this.d.push(this.d[i-1]+this.p[i].distanceTo(this.p[i-1]));this.L=this.d[this.d.length-1];this.man=this.mk()}
 seg(s){let i=1;while(i<this.p.length-1&&this.d[i]<s)i++;return i}
 at(s,o=new THREE.Vector3()){s=Math.max(0,Math.min(this.L,s));const i=this.seg(s),a=this.p[i-1],b=this.p[i],l=(this.d[i]-this.d[i-1])||1;return o.copy(a).lerp(b,(s-this.d[i-1])/l)}
 dir(s,o=new THREE.Vector3()){s=Math.max(0,Math.min(this.L,s));const i=this.seg(s);return o.subVectors(this.p[i],this.p[i-1]).normalize()}
 atX(s,o=new THREE.Vector3()){if(s<0)return this.at(0,o).addScaledVector(this.dir(0),s);if(s>this.L)return this.at(this.L,o).addScaledVector(this.dir(this.L),s-this.L);return this.at(s,o)}
 near(q){let best={s:0,d:1e9};const ab=new THREE.Vector3(),aq=new THREE.Vector3(),pt=new THREE.Vector3();for(let i=1;i<this.p.length;i++){const a=this.p[i-1],b=this.p[i];ab.subVectors(b,a);const l2=ab.lengthSq()||1;const t=cl(aq.subVectors(q,a).dot(ab)/l2);pt.copy(a).addScaledVector(ab,t);const d=pt.distanceTo(q);if(d<best.d)best={s:this.d[i-1]+t*Math.sqrt(l2),d}}return best}
 mk(){const m=[];for(let i=1;i<this.p.length-1;i++){const a=this.p[i-1],b=this.p[i],c=this.p[i+1];if(c.y-b.y>.5){m.push({s:this.d[i],k:'up'});continue}if(b.y-a.y>.5)continue;
   const d1x=b.x-a.x,d1z=b.z-a.z,d2x=c.x-b.x,d2z=c.z-b.z,l1=Math.hypot(d1x,d1z),l2=Math.hypot(d2x,d2z);if(l1<.01||l2<.01)continue;
   const cr=(d1x*d2z-d1z*d2x)/(l1*l2),dt=(d1x*d2x+d1z*d2z)/(l1*l2);if(dt<.85)m.push({s:this.d[i],k:cr>0?'right':'left'})}return m}
}
export /* coordinates are [x, z, y] in metres; +z is towards the palace front door */
const P={
 enter:new Path([[0,17.6],[0,9]]),
 r1:new Path([[0,9],[0,2.4],[-9,2.4],[-13.4,2.4]]),                         /* hall → Menelik II's reception room */
 r2:new Path([[-13.4,2.4],[-9,2.4],[0,2.4],[0,-15.5],[0,-19.8]]),           /* planned route to the Egg House */
 w2:new Path([[-13.4,2.4],[-9,2.4],[-1.4,2.4],[3,2.6],[7.4,2.4]]),          /* where the visitor actually walks (drifts east) */
 r3:new Path([[7.4,2.4],[14,2.4],[14,-21],[5.5,-21],[1.6,-21]]),            /* re-route via Empress Taytu's rooms + east passage */
 r4:new Path([[1.6,-21],[1.6,-16.6],[-3.4,-16.6],[-3.4,-17.2],[-3.4,-24.2,WH],[-3.4,-24.9,WH],[.4,-22.4,WH]]) /* up the Egg House stairs */
};
export const POI1_STOP=10.2,POI3_STOP=20;
export const TX:any={
 en:{straight:'Continue straight',left:'Turn left',right:'Turn right',up:'Take the stairs up',ahead:'Destination ahead',here:'You’ve arrived',off:'Off route',rr:'Finding another way…',paused:'Paused · route kept',m:'m',to:'To',lt1:'<1 min',min:n=>n+' min',
  say:{left:d=>`In ${d} metres, turn left.`,right:d=>`In ${d} metres, turn right.`,up:d=>`In ${d} metres, take the stairs up.`,straight:d=>`Continue straight for ${d} metres.`,here:'You have arrived.',rr:'Finding another way.'},
  nav:'Navigate',upstairs:'Go upstairs',cont:'Continue tour',duck:'Story paused — directions first',pos:'INDOOR POSITIONING · LIVE',listen:'Listen to the story',watch:'Watch the film',look:'Take a closer look',ground:'GROUND',upper:'UPPER',nowp:'Now playing'},
 am:{straight:'ቀጥታ ይቀጥሉ',left:'ወደ ግራ ይታጠፉ',right:'ወደ ቀኝ ይታጠፉ',up:'በደረጃው ወደ ላይ ይውጡ',ahead:'መድረሻዎ ከፊት ነው',here:'ደርሰዋል',off:'ከመንገድ ወጥተዋል',rr:'ሌላ መንገድ በመፈለግ ላይ…',paused:'ቆሟል · መንገዱ ተይዟል',m:'ሜ',to:'ወደ',lt1:'<1 ደቂቃ',min:n=>n+' ደቂቃ',
  say:{left:d=>`በ${d} ሜትር ወደ ግራ ይታጠፉ።`,right:d=>`በ${d} ሜትር ወደ ቀኝ ይታጠፉ።`,up:d=>`በ${d} ሜትር በደረጃው ወደ ላይ ይውጡ።`,straight:d=>`ለ${d} ሜትር ቀጥታ ይሂዱ።`,here:'ደርሰዋል።',rr:'ሌላ መንገድ በመፈለግ ላይ።'},
  nav:'አቅጣጫ ጀምር',upstairs:'ወደ ላይ ውጣ',cont:'ጉብኝቱን ቀጥል',duck:'ታሪኩ ቆሟል — መጀመሪያ አቅጣጫ',pos:'የቤት ውስጥ አቀማመጥ · ቀጥታ',listen:'ታሪኩን ያዳምጡ',watch:'ፊልሙን ይመልከቱ',look:'በቅርበት ይመልከቱ',ground:'ምድር ቤት',upper:'ላይኛው ፎቅ',nowp:'በመጫወት ላይ'}
};
export const DEST:any={recep:{en:'Menelik II’s reception room',am:'የዳግማዊ አፄ ምኒልክ እንግዳ መቀበያ'},egg:{en:'Egg House',am:'እንቁላል ቤት'},upper:{en:'Egg House · Upper level',am:'እንቁላል ቤት · ላይኛው ፎቅ'}};
export /* POI content — sample copy to be replaced with the venue's own */
const POI={
 poi1:{type:'gallery',ic:'i',lab:'look',pos:[-4,2.05,-.3],
  kick:{en:'Exhibit · Court life',am:'ኤግዚቢት · የቤተ መንግሥት ሕይወት'},
  t:{en:'Court treasures',am:'የቤተ መንግሥት ቅርሶች'},
  d:{en:'Ceremonial objects like these were part of life at Menelik II’s court — brought out for receptions, feasts and religious occasions. Lean in and look at the metalwork up close.',
     am:'እንደነዚህ ያሉ የክብር ዕቃዎች በዳግማዊ አፄ ምኒልክ ቤተ መንግሥት ሕይወት ውስጥ ቦታ ነበራቸው — ለእንግዳ አቀባበል፣ ለግብር እና ለሃይማኖታዊ በዓላት ይወጡ ነበር። ቀረብ ብለው የብረት ሥራውን ይመልከቱ።'},
  cap:{en:['The display case','Seen from the main hall','Metalwork detail'],am:['የማሳያ ሣጥኑ','ከዋናው አዳራሽ ሲታይ','የብረት ሥራ ዝርዝር']}},
 poi2:{type:'audio',ic:'♪',lab:'listen',pos:[-17,2.75,2.4],
  kick:{en:'Audio story',am:'የድምፅ ታሪክ'},
  t:{en:'The reception room',am:'የእንግዳ መቀበያ ክፍሉ'},
  d:{en:'A short narrated story about how this room was used.',am:'ይህ ክፍል እንዴት ይሠራበት እንደነበር የሚተርክ አጭር ታሪክ።'},
  s:{en:['This is Menelik II’s reception room.','Guests, envoys and officials were received in rooms like this one.','Look at the raised dais at the far end.','It set the emperor apart, and drew every eye in the room toward him.','Take a moment, and imagine this room full of people, conversation and ceremony.'],
     am:['ይህ የዳግማዊ አፄ ምኒልክ የእንግዳ መቀበያ ክፍል ነው።','እንግዶች፣ መልዕክተኞች እና ባለሥልጣናት በእንደዚህ ዓይነት ክፍሎች ይስተናገዱ ነበር።','በክፍሉ መጨረሻ ያለውን ከፍ ያለ መድረክ ይመልከቱ።','ንጉሠ ነገሥቱን ከሌሎች ይለይ፣ የሁሉንም ዓይን ወደ እርሳቸው ይስብ ነበር።','ለአፍታ ይህ ክፍል በሰዎች፣ በውይይት እና በሥነ ሥርዓት ተሞልቶ እንደነበር ያስቡ።']}},
 poi3:{type:'video',ic:'▶',lab:'watch',pos:[12.75,3.0,-11],dur:24,
  kick:{en:'Film · 0:24',am:'ፊልም · 0:24'},
  t:{en:'The palace from above',am:'ቤተ መንግሥቱ ከላይ ሲታይ'},
  d:{en:'Fly over the palace compound and the gardens of Unity Park.',am:'በቤተ መንግሥቱ ግቢ እና በአንድነት ፓርክ የአትክልት ሥፍራዎች ላይ ይብረሩ።'},
  sub:{en:['Unity Park, inside the palace compound.','Opened to the public in 2019.','Gardens, pavilions and palace buildings — all connected.'],am:['በቤተ መንግሥቱ ግቢ ውስጥ ያለው የአንድነት ፓርክ።','በ2019 እ.ኤ.አ. ለሕዝብ ክፍት ሆነ።','የአትክልት ሥፍራዎች፣ ድንኳኖች እና የቤተ መንግሥት ሕንፃዎች — ሁሉም የተያያዙ።']}}
};
export const PAUSE=new Set(['poi1p','poi1','poi3p','poi3','lang']);
export const BEATS:any=['enter','ask','nav1','poi1p','poi1','nav1b','arr1','poi2','ask2','nav2','reroute','nav3','poi3p','poi3','lang','nav3b','egg','eggup','climb','upper'];
export const SEQ:any=['go','travel','see','arrive',...BEATS];
