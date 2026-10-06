
export /* ================= OUTDOOR DATA — traced from the official Unity Park journey map =================
   All positions are in pixels of the 2000×1247 journey map; W() converts them to world units. */
const MX=860,MZ=640,MS=12;
export const W=(px,py)=>[(px-MX)/MS,(py-MZ)/MS];
export const X0=230,Y0=175,X1=1490,Y1=1105,TW=(X1-X0)/MS,TD=(Y1-Y0)/MS;
export const GY=.6;
export const ENTR:any=[1015,1032];
export const PLACES:any=[
 {n:1, cat:'PARK & PLAY',c:'#ec8a1c',px:885,py:782, ic:'tree',  en:'Green Area',               am:'አረንጓዴ ሥፍራ',              blurb:'Open lawns beside the main avenue, made for picnics and play.',sub:['Kids Playground','Mini Amphitheatre']},
 {n:2, cat:'WILDLIFE',c:'#e7bf12',px:1160,py:848,ic:'paw',   en:'Black Lion Zoo',           am:'የጥቁር አንበሳ መካነ-እንስሳት',   blurb:'Home of the Ethiopian black-maned lion, with a safari viewing loop.',sub:['Black Mane Lion','Safari'],tc:'#3a2f00',f:1},
 {n:3, cat:'GARDEN',c:'#2bb84a',px:1095,py:668,ic:'leaf',  en:'Indigenous Plants Garden', am:'የአገር በቀል እጽዋት ሥፍራ',      blurb:'Native Ethiopian flora, the camel house and a carved wood sculpture.',sub:['Indigenous Plants','Camel House','Wood Sculpture'],f:1},
 {n:4, cat:'HISTORIC PALACE',c:'#3d8fd8',px:895,py:482, ic:'palace',en:'Menelik II’s Palace',      am:'የዳግማዊ አፄ ምኒሊክ እልፍኞች',  blurb:'The historic palace compound — royal quarters, halls and the two-storey Egg House.',sub:['A · Princes’ Bedroom','B · Etege Taitu Bitul’s Quarter','C · Council of Ministers Hall','D · Egg House','E · Emperor Menelik’s Quarter','F · Ministry of Defence Waiting Room'],f:1},
 {n:5, cat:'ARCHIVE',c:'#9c8f78',px:670,py:462, ic:'book',  en:'Unity Archive',            am:'አንድነት ቤተ መዛግብት',         blurb:'The park’s archive of documents, photographs and records.',sub:[]},
 {n:6, cat:'MUSEUM',c:'#14b892',px:725,py:562, ic:'crown', en:'Throne House',             am:'ዙፋን ቤት',                  blurb:'The throne room and museum, including Emperor Haile Selassie’s car.',sub:['Emperor Haile Selassie’s Car'],f:1},
 {n:7, cat:'HISTORIC HALL',c:'#e85cbf',px:693,py:718, ic:'dine',  en:'Banquet Hall',             am:'ግብር አዳራሽ',                blurb:'The great hall where royal feasts — gibir — were held.',sub:[],f:1},
 {n:8, cat:'GARDEN',c:'#17a83f',px:505,py:292, ic:'flower',en:'Unity Botanical Garden',   am:'አንድነት የእጽዋት ማዕከል',        blurb:'Glasshouses of plants from Ethiopia’s many climate zones.',sub:[]},
 {n:9, cat:'WILDLIFE',c:'#7d8487',px:415,py:610, ic:'bino',  en:'Zoo',                      am:'መካነ-እንስሳት',               blurb:'Cheetahs, giraffes, gelada baboons, flamingos, an aviary and an aquarium.',sub:['Meerkat','Gelada Baboons','Aquarium','Aviary','Peacock','Cheetah','Flamingos','Wild Dogs','Giraffe','Lions']},
 {n:10,cat:'CULTURE',c:'#7f74ee',px:660,py:872, ic:'flag',  en:'Ethiopian Regional Pavilions',am:'የክልል እልፍኞች',           blurb:'Nine pavilions showcasing the architecture and culture of Ethiopia’s regions.',sub:['G · Tigray','H · Amhara','I · Benishangul Gumuz','J · S.N.N.P.R','K · Afar','L · Gambela','M · Somali','N · Harari','O · Oromia'],f:1}
];
PLACES.forEach(p=>{[p.x,p.z]=W(p.px,p.py);const d=Math.hypot(p.px-ENTR[0],p.py-ENTR[1])*.6*1.35;p.mn=Math.max(2,Math.round(d/72))});
export /* lettered sub-sites, as on the map */
const SUBS={3:[['A',928,560],['B',948,470],['C',942,404],['D',858,430],['E',866,505],['F',830,540]],
 9:[['G',522,890],['H',550,812],['I',662,805],['J',782,826],['K',734,834],['L',680,862],['M',602,860],['N',708,928],['O',780,912]]};
