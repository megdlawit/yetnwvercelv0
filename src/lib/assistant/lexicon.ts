// The assistants' word bank — our own, no outside service. Used by language.ts for
// both the floor editor's assistant and the visitor's "Ask":
//
//   MISSPELLINGS    words people commonly get wrong → the word ("resturant" → "restaurant")
//   CHAT            texting and chat spellings → plain English ("bcuz" → "because")
//   FILLER          chat noise with no meaning ("lol", "fr", "innit")
//   VERBS           every way people say an editor action ("yeet", "get rid of" → remove)
//   PLACE_WORDS     names of rooms, amenities, furniture and building parts, by kind
//   SMALL_TALK      greetings, how-are-yous, thanks, goodbyes
//
// Lists are plain space-separated text so they're easy to grow: add a word and a
// test, nothing else. Multi-word entries use "_" for the space.

import { COMPOUNDS as COMPOUND_TEXT, MORE_CHAT, MORE_MISSPELLINGS, MORE_OBJECTS, MORE_PLACES, MORE_SMALL_TALK } from './lexiconMore';

/** "wrong:right" pairs; an entry that maps a word to itself is left out. */
const pairs = (s: string): Record<string, string> =>
  Object.fromEntries(s.trim().split(/\s+/).map(p => { const [a, b] = p.split(':'); return [a.replace(/_/g, ' '), b.replace(/_/g, ' ')]; }).filter(([a, b]) => a && b && a !== b));
const list = (s: string): string[] => s.trim().split(/\s+/).map(w => w.replace(/_/g, ' '));

/** Words people commonly misspell → the word. Only ever-wrong spellings: none of these is a real word. */
export const MISSPELLINGS: Record<string, string> = { ...pairs(MORE_MISSPELLINGS), ...pairs(`
  accomodate:accommodate acommodate:accommodate accomodation:accommodation acheive:achieve accross:across adress:address adresses:addresses
  agian:again agin:again alot:a_lot allready:already alredy:already allways:always alwasy:always amature:amateur anual:annual anwser:answer
  aparent:apparent apparant:apparent appartment:apartment apartmant:apartment aproximately:approximately arguement:argument atleast:at_least
  awsome:awesome awesom:awesome basicly:basically becuase:because becasue:because beacuse:because becouse:because befor:before begining:beginning
  beleive:believe belive:believe benifit:benefit bizzare:bizarre buisness:business busness:business calender:calendar catagory:category
  cemetary:cemetery changable:changeable cheif:chief collegue:colleague comming:coming commited:committed comittee:committee completly:completely
  concious:conscious copywrite:copyright curiousity:curiosity decison:decision definately:definitely definatly:definitely definitly:definitely
  defintely:definitely desparate:desperate diffrent:different diferent:different differnt:different dilema:dilemma dissapear:disappear
  dissapoint:disappoint embarass:embarrass enviroment:environment existance:existence experiance:experience familar:familiar finaly:finally
  foriegn:foreign foward:forward freind:friend fullfil:fulfil gaurd:guard goverment:government gaurantee:guarantee grammer:grammar happend:happened
  harrass:harass heigth:height hieght:height heigt:height hight:height humourous:humorous immediatly:immediately imediately:immediately
  independant:independent intresting:interesting interseting:interesting knowlege:knowledge lenght:length lengh:length libary:library liason:liaison
  lisence:licence maintainance:maintenance maintenence:maintenance managment:management millenium:millennium mischievious:mischievous neccessary:necessary
  necesary:necessary nieghbor:neighbour  noticable:noticeable occassion:occasion occured:occurred occurence:occurrence ocurred:occurred
  oppurtunity:opportunity paralel:parallel parrallel:parallel particulary:particularly peice:piece persue:pursue posession:possession prefered:preferred
  presance:presence privelege:privilege probaly:probably probly:probably proffesional:professional promiss:promise publically:publicly realy:really
  reallly:really recieve:receive recieved:received reccomend:recommend recomend:recommend reccommend:recommend refered:referred relevent:relevant
  religous:religious remeber:remember rember:remember repitition:repetition rythm:rhythm saftey:safety sieze:seize sence:sense seperate:separate seperately:separately
   similiar:similar sincerly:sincerely speach:speech stoped:stopped strenght:strength succesful:successful sucessful:successful supercede:supersede
  suprise:surprise suprised:surprised tecnology:technology temperture:temperature tendancy:tendency therefor:therefore thier:their threshhold:threshold
  tommorow:tomorrow tommorrow:tomorrow tomorow:tomorrow tounge:tongue truely:truly twelth:twelfth tyrany:tyranny untill:until unfortunatly:unfortunately
  usualy:usually vaccuum:vacuum vehical:vehicle visable:visible wierd:weird whereever:wherever wich:which wether:whether writting:writing
  yesturday:yesterday youre:you_are thankyou:thank_you pleae:please pleas:please plase:please pls:please plz:please
   wat:what waht:what whta:what hwat:what whre:where wehre:where whee:where wher:where hwere:where whereis:where_is
  waer:where howto:how_to hwo:how hw:how teh:the hte:the tge:the th:the adn:and nad:and ot:to tot:to fro:for fo:for
  wiht:with wtih:with iwth:with  taht:that htat:that thta:that tihs:this htis:this thsi:this jsut:just juts:just
  dont:do_not didnt:did_not doesnt:does_not isnt:is_not arent:are_not wasnt:was_not werent:were_not wont:will_not cant:can_not
  couldnt:could_not shouldnt:should_not wouldnt:would_not havent:have_not hasnt:has_not im:i_am ive:i_have youve:you_have
  theyre:they_are theres:there_is heres:here_is whats:what_is wheres:where_is hows:how_is thats:that_is lets:let_us
  resturant:restaurant restaraunt:restaurant restraunt:restaurant restuarant:restaurant resteraunt:restaurant restaurent:restaurant
  bathrom:bathroom bathroon:bathroom bathrooom:bathroom batroom:bathroom bthroom:bathroom washrom:washroom restrom:restroom resroom:restroom
  restoom:restroom reatroom:restroom toliet:toilet toilett:toilet toilette:toilet tiolet:toilet toilt:toilet tolet:toilet toillet:toilet
  entrence:entrance entrace:entrance enterance:entrance entrnace:entrance entance:entrance entrnce:entrance exitt:exit exitway:exit
  elevater:elevator elevatr:elevator elavator:elevator elevetor:elevator elevtor:elevator eleavtor:elevator escelator:escalator escalater:escalator
  stiars:stairs stair_case:staircase staris:stairs starcase:staircase starecase:staircase steircase:staircase
  cafateria:cafeteria cafetria:cafeteria cafeterria:cafeteria caffeteria:cafeteria caffe:cafe cofee:coffee coffe:coffee cofe:coffee
  conferance:conference confrence:conference conferece:conference confernce:conference meetting:meeting meating:meeting meetin:meeting
  recption:reception recepion:reception receprion:reception reciption:reception receeption:reception lobyy:lobby lobi:lobby
  ofice:office offfice:office offce:office offic:office officee:office libray:library liberary:library labratory:laboratory laboritory:laboratory
  corridoor:corridor coridor:corridor corrider:corridor hallwy:hallway halway:hallway hallwya:hallway walkwya:walkway walkay:walkway
  kitchn:kitchen kitchin:kitchen kichen:kitchen ktichen:kitchen storgae:storage storeage:storage storrage:storage closit:closet closset:closet
  bedrom:bedroom bedroon:bedroom bedrooom:bedroom livingroom:living_room diningroom:dining_room famliy:family
  parkign:parking parkng:parking parkin:parking garrage:garage garag:garage pharmasy:pharmacy pharmcy:pharmacy farmacy:pharmacy
  clnic:clinic clinik:clinic hospitl:hospital hosptial:hospital emergancy:emergency emergecy:emergency ambulence:ambulance
  galery:gallery gallary:gallery gallerie:gallery musuem:museum museam:museum musem:museum exibition:exhibition exhibtion:exhibition
  auditorim:auditorium auditoriam:auditorium thearter:theatre  cinima:cinema gymnasiun:gymnasium gymnaseum:gymnasium
  playgroud:playground playgorund:playground nursury:nursery
  conect:connect connet:connect conncet:connect connnect:connect cnnect:connect coonect:connect connecct:connect conecct:connect
  dissconnect:disconnect disconect:disconnect disconnnect:disconnect
  remvoe:remove reomve:remove rmove:remove remov:remove romove:remove delte:delete deleat:delete delet:delete dleete:delete
  moev:move mvoe:move mov:move moove:move renmae:rename renme:rename rname:rename rotat:rotate roate:rotate rotae:rotate
  undoo:undo udno:undo unod:undo redoo:redo publsh:publish pubish:publish pulbish:publish publsih:publish
  chekc:check chck:check cehck:check fixx:fix fxi:fix shwo:show sohw:show shw:show
  doorr:door dor:door windwo:window windw:window widow:window wal:wall wll:wall walll:wall flor:floor floore:floor flooor:floor
  rom:room roon:room roomm:room rooom:room romm:room plcae:place palce:place plac:place spcae:space spce:space
  bigegr:bigger biger:bigger smallr:smaller smaler:smaller  widder:wider tallr:taller
    metrs:metres meteres:metres degres:degrees degress:degrees dgrees:degrees
  frist:first fisrt:first secnod:second scond:second thrid:third thrd:third fourht:fourth  fith:fifth
  grond:ground groud:ground gorund:ground basment:basement basemnt:basement baement:basement upsatirs:upstairs upstair:upstairs downstair:downstairs
  accesible:accessible accessable:accessible accesable:accessible wheelchar:wheelchair wheelchiar:wheelchair weelchair:wheelchair
`) };

/** Texting and chat spellings → plain English. */
export const CHAT: Record<string, string> = { ...pairs(MORE_CHAT), ...pairs(`
  u:you ya:you yu:you yuo:you uu:you r:are ur:your urs:yours yr:your ure:you_are
  pls:please plz:please plez:please pleez:please plox:please pleaze:please plss:please plzz:please
  thx:thanks thnx:thanks thanx:thanks thnks:thanks thks:thanks tnx:thanks tx:thanks tq:thank_you ty:thanks tyty:thanks tysm:thank_you_so_much
  tyvm:thank_you_very_much thankz:thanks thanku:thank_you thanq:thank_you thnq:thank_you
  wat:what wht:what wut:what whut:what wot:what wha:what wats:what_is whatchu:what_you whatcha:what_are_you
  wr:where whr:where wer:where wre:where wea:where wherez:where_is
  hw:how hws:how_is howz:how_is hows:how_is
  wy:why coz:because cuz:because cos:because bc:because bcz:because bcuz:because becuz:because cause:because
  gimme:give_me lemme:let_me lemmie:let_me gotta:have_to wanna:want_to gonna:going_to hafta:have_to oughta:ought_to
  kinda:kind_of sorta:sort_of dunno:do_not_know dno:do_not_know idk:i_do_not_know idc:i_do_not_care ikr:i_know
  tho:though thru:through tru:true rly:really rlly:really rli:really srsly:seriously sry:sorry srry:sorry soz:sorry
  nvm:never_mind nm:never_mind np:no_problem nps:no_problem npp:no_problem
  rn:right_now asap:now atm:at_the_moment b4:before l8r:later l8:late gr8:great m8:mate str8:straight 2day:today 2nite:tonight
  tmrw:tomorrow tmr:tomorrow tmrrw:tomorrow  2moro:tomorrow 2morrow:tomorrow ystrdy:yesterday
  dat:that dis:this dem:them dey:they der:there da:the dese:these dose:those
  n:and  nd:and  
  w/:with w/o:without wo:without b/w:between bw:between btwn:between btw:by_the_way
  yea:yes yeah:yes yah:yes ye:yes yass:yes yas:yes yup:yes yep:yes yeap:yes  
  okie:ok oki:ok okies:ok okey:okay okk:ok okayy:okay k:ok kk:ok kay:okay mkay:okay alrighty:alright aight:alright ight:alright
  nah:no naw:no nope:no nop:no noo:no nahh:no
  gud:good gd:good gr8t:great nyc:nice nic:nice kool:cool kewl:cool
  ppl:people ppls:people peeps:people
  sumthin:something somethin:something smth:something sth:something sumthing:something
  nothin:nothing nuthin:nothing nuffin:nothing everythin:everything evrything:everything everyting:everything
  anythin:anything anyting:anything sumwhere:somewhere somewher:somewhere evrywhere:everywhere
  bout:about abt:about abut:about prolly:probably probs:probably def:definitely deffo:definitely defo:definitely
  msg:message pic:picture pix:pictures info:information inf:information
  hii:hi hiii:hi hai:hi hy:hi hiya:hi heyy:hey heyya:hey heya:hey helo:hello hellow:hello heloo:hello hallo:hello ello:hello
  cya:bye byee:bye bai:bye bbye:bye byebye:bye gn:good_night gm:good_morning
  nr:near nxt:next fl:floor flr:floor flrs:floors lvl:level lvls:levels rm:room rms:rooms bldg:building bld:building
  ent:entrance entr:entrance elev:elevator elv:elevator   ave:avenue apt:apartment dept:department
  conf:conference mtg:meeting mtng:meeting rec:reception recep:reception  wc:toilet loo:toilet
  sec:second secs:seconds min:minute mins:minutes hr:hour hrs:hours m:metres mtrs:metres mtr:metre ft:feet
  qty:quantity approx:about abt:about vs:versus etc:and_so_on eg:for_example ie:that_is
`) };

/** Chat noise with no meaning: dropped before understanding. */
export const FILLER: string[] = list(`
  lol lolz lool loool lmao lmfao rofl roflmao haha hahah hahaha hahahaha hehe hehehe hihi huhu xd xdd 
  bruh bruhh bro broo bruv  brah dude dudes mate m8s fam fammm buddy bud pal homie homey  yall  guys
  smh tbh tbf imo imho ngl fr frfr ong lowkey highkey literally basically honestly actually totally seriously
  innit init  anyways anyway welp yikes oof ugh meh hmm hmmm hm um umm ummm uh uhh uhm er erm eh ah ahh oh ohh
  omg omfg  wtf wth jk jkjk lmk  yolo
`);

/**
 * Every way people say an editor action. language.ts turns "<word> X" into the action's plain
 * verb ("yeet the bench" → "remove the bench"); multi-word ones with "_".
 */
export const VERBS: Record<string, string[]> = {
  remove: list(`delete remove erase nuke yeet trash ditch kill scrap bin axe toss zap dump wipe junk scrub nix  eliminate
    get_rid_of take_away take_out throw_away throw_out chuck_out chuck_away kick_out wipe_out clear_out cut_out strip_out rip_out
    knock_down tear_down pull_down demolish destroy obliterate annihilate vaporize vaporise purge discard  `),
  add: list(`add put place insert     stick pop slap throw chuck plonk drop whack bung toss  
    stick_in pop_in put_in throw_in slap_in drop_in add_in plop plunk    `),
  move: list(`move shift shove slide drag push pull yank nudge scoot budge inch relocate reposition  bump 
        budge_over scoot_over shift_over slide_over move_over`),
  connect: list(`connect link join attach hook_up wire_up link_up tie_up join_up bridge hook wire tie patch plug 
        `),
  disconnect: list(`disconnect unlink unhook detach   unplug cut_off sever  decouple untie`),
  rename: list(`rename call name label tag title retitle rebrand relabel`),
  rotate: list(`rotate spin turn twist swivel flip pivot revolve `),
  bigger: list(`enlarge expand grow widen  stretch beef_up bulk_up blow_up pump_up supersize upsize scale_up `),
  smaller: list(`shrink reduce squish squash compress narrow shorten tighten downsize scale_down minimize minimise trim_down`),
  undo: list(`undo revert reverse rollback roll_back scratch_that take_it_back go_back my_bad oops whoops oopsie ctrl_z cmd_z control_z back_it_out
    nevermind never_mind cancel_that forget_that forget_it`),
  redo: list(`redo ctrl_y cmd_shift_z control_y do_it_again again`),
  check: list(`check inspect review audit test verify examine scan diagnose validate sanity_check health_check`),
  fix: list(`fix repair sort_out clean_up tidy_up patch_up mend resolve heal solve straighten_out sort_it_out clean_it_up`),
  publish: list(`publish ship_it go_live push_it_live send_it_live launch release deploy make_it_public put_it_out_there`),
  show: list(`show find locate where_is spot highlight point_to zoom_to   reveal`),
};

/** Names of rooms, amenities, furniture and building parts, by the room kind the editor gives them. */
export const PLACE_WORDS: Record<string, string[]> = {
  restroom: list(`restroom restrooms toilet toilets bathroom bathrooms washroom washrooms lavatory lavatories loo loos wc water_closet
    gents ladies mens womens men's women's unisex_toilet accessible_toilet disabled_toilet baby_change changing_room shower showers
    powder_room comfort_room cr latrine privy urinal urinals`),
  reception: list(`reception front_desk help_desk info_desk information_desk information concierge lobby foyer vestibule atrium
    entrance_hall welcome_desk check_in registration ticket_office box_office cashier till counter service_desk waiting_room waiting_area
    waiting_lounge lounge`),
  meeting: list(`meeting_room conference_room boardroom board_room seminar_room classroom class_room lecture_hall lecture_room training_room
    workshop huddle_room breakout_room auditorium hall assembly_hall theatre theater cinema studio presentation_room exam_room library
    reading_room study_room`),
  entrance: list(`entrance entrances entry way_in main_entrance side_entrance back_entrance front_door main_door gate gates gateway
    exit exits way_out emergency_exit fire_exit door doors portal turnstile`),
  stairs: list(`stairs stair staircase stairway stairwell steps flight_of_stairs fire_escape escape_stairs spiral_stairs`),
  elevator: list(`elevator elevators lift lifts escalator escalators travelator moving_walkway goods_lift service_lift dumbwaiter`),
  utility: list(`storage store store_room storeroom stockroom stock_room closet cupboard janitor janitor_room cleaning_room server_room
    data_room it_room comms_room electrical_room electric_room plant_room boiler_room mechanical_room hvac_room pump_room generator_room
    kitchen kitchenette pantry scullery laundry laundry_room utility_room workshop maintenance loading_bay loading_dock garbage_room
    bin_store refuse_room recycling_room mail_room post_room archive archives file_room records_room vault strong_room security_room
    control_room cctv_room guard_room guard_house`),
  office: list(`office offices room space area zone hall gallery shop store boutique cafe café coffee_shop canteen cafeteria restaurant
    diner food_court bar pub lounge_bar kiosk stall stand booth bakery deli grocery supermarket market pharmacy chemist drugstore clinic
    surgery dentist doctor nurse first_aid medical_room sick_bay ward bedroom master_bedroom guest_room living_room sitting_room
    dining_room family_room den study bedroom_suite suite apartment flat unit studio_flat penthouse balcony terrace veranda porch patio
    deck courtyard garden yard rooftop roof_terrace gym gymnasium fitness_room sports_hall pool swimming_pool spa sauna steam_room
    changing_rooms locker_room lockers playroom play_area playground creche nursery kids_room childrens_area prayer_room mosque chapel
    church temple multi_faith_room quiet_room nursing_room mothers_room lactation_room smoking_area atm bank currency_exchange post_office
    museum exhibition exhibit display showroom lab laboratory research_lab computer_lab workshop_room staff_room break_room staffroom
    common_room hostel dorm dormitory ward_room consultation_room treatment_room x_ray radiology pharmacy_counter`),
};

for (const [kind, words] of Object.entries(MORE_PLACES)) PLACE_WORDS[kind] = [...(PLACE_WORDS[kind] ?? []), ...list(words)];

/** Words people write as two that are one ("good bye", "rest room", "wheel chair"): read joined. */
export const COMPOUNDS: Set<string> = new Set(list(COMPOUND_TEXT));

/** Furniture and objects people place on a map (vocabulary for spelling, and "add a …"). */
export const OBJECT_WORDS: string[] = [...list(MORE_OBJECTS), ...list(`
  bench benches chair chairs seat seats seating sofa couch armchair stool stools table tables desk desks counter counters shelf shelves
  bookshelf bookcase cabinet cabinets cupboard wardrobe locker lockers bed beds bunk crib cot sink sinks basin basins tap taps fountain
  water_fountain drinking_fountain bin bins trash_can rubbish_bin recycling_bin plant plants tree trees bush bushes hedge planter flowerbed
  lamp lamps light lights streetlight sign signs signpost board noticeboard notice_board whiteboard screen tv television projector
  kiosk vending_machine atm charger charging_station socket fire_extinguisher extinguisher alarm defibrillator aed first_aid_kit
  statue sculpture monument artwork painting mural pillar column post bollard railing handrail fence wall gate turnstile barrier
  stage podium lectern piano speaker microphone camera cctv clock map info_point help_point qr_code beacon
  car bike bicycle bike_rack scooter bus_stop taxi_rank parking_space`)];

/** Small talk, by kind: what language.ts adds to the editor's and visitor's greetings. */
export const SMALL_TALK: Record<'greeting' | 'howareyou' | 'thanks' | 'bye' | 'compliment', string[]> = {
  greeting: list(`hi hello hey heya hiya howdy yo sup wassup wazzup whaddup what_is_up what_is_good what_is_happening what_is_cracking
    greetings salutations good_morning good_afternoon good_evening good_day morning afternoon evening hey_there hi_there hello_there
    hey_hey hi_hi hello_hello ello oi aloha hola bonjour ciao namaste salaam salam selam shalom g_day gday g'day top_of_the_morning
    hey_you hi_you hello_friend hey_friend hi_friend hey_mate hi_mate yo_yo what_up whats_new what_is_new long_time_no_see`),
  howareyou: list(`how_are_you how_are_you_doing how_are_you_today how_is_it_going how_is_everything how_are_things how_is_life
    how_is_your_day how_is_your_day_going how_has_your_day_been how_have_you_been how_have_you_been_doing how_you_doing how_you_been
    you_good you_ok you_okay are_you_ok are_you_okay are_you_good are_you_well how_are_you_holding_up how_is_it_hanging
    how_goes_it how_goes how_do_you_do how_are_you_feeling what_is_the_story how_is_your_week how_is_your_morning hope_you_are_well
    hope_you_are_good how_are_ya how_is_tricks you_alright alright`),
  thanks: list(`thanks thank_you thank_you_so_much thank_you_very_much thanks_a_lot thanks_so_much thanks_a_million many_thanks
    much_appreciated appreciate_it i_appreciate_it cheers ta nice_one thanks_mate thanks_buddy thanks_bro great_thanks perfect_thanks
    awesome_thanks thank_you_kindly bless_you you_are_a_star you_are_a_lifesaver lifesaver legend you_are_a_legend thanks_heaps`),
  bye: list(`bye goodbye bye_bye see_you see_ya see_you_later see_you_soon later laters catch_you_later talk_later talk_soon ttyl
    take_care farewell good_night night_night cheerio ta_ta peace peace_out i_am_off i_am_out gotta_go got_to_go have_to_go
    signing_off adios au_revoir ciao_for_now so_long until_next_time have_a_good_day have_a_nice_day`),
  compliment: list(`good_job well_done great_job nice_work nice_one brilliant amazing awesome excellent fantastic perfect superb
    good_bot good_assistant smart_bot you_are_smart you_are_clever you_are_great you_are_awesome you_are_amazing you_are_the_best
    you_rock love_it love_this i_love_it i_love_this so_helpful very_helpful really_helpful you_nailed_it nailed_it spot_on top_notch
    ten_out_of_ten 10_out_of_10 chef_kiss you_are_a_genius genius`),
};

for (const [kind, phrases] of Object.entries(MORE_SMALL_TALK) as [keyof typeof SMALL_TALK, string][]) SMALL_TALK[kind] = [...SMALL_TALK[kind], ...list(phrases)];

/** Every word in the bank, for the size check and the spelling vocabulary. */
export function lexiconSize(): number {
  return Object.keys(MISSPELLINGS).length + Object.keys(CHAT).length + FILLER.length
    + Object.values(VERBS).reduce((n, l) => n + l.length, 0) + Object.values(PLACE_WORDS).reduce((n, l) => n + l.length, 0)
    + OBJECT_WORDS.length + Object.values(SMALL_TALK).reduce((n, l) => n + l.length, 0) + COMPOUNDS.size;
}
