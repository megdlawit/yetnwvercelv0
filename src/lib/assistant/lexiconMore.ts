// More of the assistants' word bank (see lexicon.ts, which puts it together). Plain text
// blocks: "wrong:right" pairs, or words; "_" stands for a space inside an entry.

/** More words people commonly misspell. None of these is a real English word. */
export const MORE_MISSPELLINGS = `
  abbout:about abot:about abotu:about aboout:about absense:absence absolutly:absolutely abscence:absence acadamy:academy accesories:accessories
  accidently:accidentally acommodation:accommodation accross:across acknowlege:acknowledge acording:according acutally:actually actualy:actually
  adition:addition additonal:additional adminstration:administration advertisment:advertisement afternon:afternoon aftrenoon:afternoon agressive:aggressive
  alomst:almost allmost:almost alright:alright alternitive:alternative althought:although altough:although amung:among anaylsis:analysis anoying:annoying
  anounce:announce annoucement:announcement anwer:answer anyhting:anything anythign:anything anywere:anywhere apparantly:apparently apperance:appearance
  appologize:apologize apologise:apologise aproach:approach approch:approach apropriate:appropriate appropiate:appropriate aquire:acquire aquarium:aquarium
  arround:around aroud:around arund:around artical:article assistent:assistant asistant:assistant assitant:assistant asside:aside attatch:attach
  attendence:attendance availible:available avaliable:available availabe:available avilable:available awfull:awful awnser:answer beautifull:beautiful
  beatiful:beautiful beautful:beautiful becomeing:becoming begginer:beginner beggining:beginning behavour:behaviour belived:believed beter:better
  betwen:between betweeen:between bewteen:between bettween:between bicyle:bicycle bilding:building buidling:building builidng:building buliding:building
  buisy:busy bussiness:business buyed:bought calandar:calendar caluclate:calculate cancelation:cancellation carefull:careful carrer:career catched:caught
  celebrty:celebrity centre:centre centeral:central certian:certain certainy:certainly challange:challenge changeing:changing charachter:character
  chatting:chatting childen:children childern:children chilren:children choosen:chosen chosing:choosing cieling:ceiling ceilng:ceiling clasroom:classroom
  classrom:classroom clossed:closed closeing:closing colum:column collumn:column comfortible:comfortable comftable:comfortable comunity:community
  commitee:committee compleet:complete complte:complete computor:computer conciousness:consciousness concidering:considering confusng:confusing
  congradulations:congratulations conveniant:convenient convinient:convenient corect:correct correclty:correctly corridors:corridors couldnt:could_not
  cousre:course critisism:criticism curent:current curently:currently custumer:customer customr:customer dammage:damage decsion:decision
  defenetly:definitely definetly:definitely definantly:definitely delivary:delivery  descibe:describe desicion:decision
  desription:description diferently:differently difficult:difficult dificult:difficult difficulity:difficulty directon:direction direcions:directions
  directins:directions dirctions:directions disapointed:disappointed discription:description disign:design distanse:distance doccument:document
  doesnt:does_not donno:do_not_know dosent:does_not dosnt:does_not dissappear:disappear eachother:each_other easilly:easily eatting:eating
  efficent:efficient eigth:eighth elemnt:element embarassing:embarrassing emergancy:emergency emmediately:immediately employe:employee enought:enough
  enuff:enough enuogh:enough enterence:entrance enviorment:environment equiptment:equipment equippment:equipment escpecially:especially especialy:especially
  everybodys:everybody's everyones:everyone's evrey:every everytime:every_time exactley:exactly exagerate:exaggerate excelent:excellent excercise:exercise
  excitment:excitement exellent:excellent exept:except exersise:exercise expecially:especially experiece:experience explaination:explanation
  extremly:extremely facillity:facility facilites:facilities facilty:facility famous:famous fasinating:fascinating favorit:favourite favourate:favourite
  feburary:february finnished:finished firey:fiery flourescent:fluorescent folowing:following follwing:following foriegner:foreigner fourty:forty
  freindly:friendly frist:first frome:from fufill:fulfil furthur:further futher:further garantee:guarantee generaly:generally genious:genius gest:guest
  geust:guest gotton:gotten gradualy:gradually greatful:grateful guidence:guidance happyness:happiness heared:heard helpfull:helpful hieght:height
  holliday:holiday horible:horrible hopefuly:hopefully humerous:humorous ignorence:ignorance imagin:imagine imediate:immediate importent:important
  impresive:impressive incase:in_case incidently:incidentally increadible:incredible infomation:information infromation:information informaton:information
  inormation:information insted:instead intelligance:intelligence intrested:interested inteligent:intelligent intersting:interesting intresting:interesting
  isnt:is_not jewellry:jewellery jewelery:jewellery judgement:judgement juice:juice knowlegde:knowledge  langauge:language
  languege:language laughing:laughing leasure:leisure lenghth:length  liscense:licence litle:little littel:little lonley:lonely
  loosing:losing luckly:luckily mabye:maybe maybee:maybe medecine:medicine medicin:medicine millionare:millionaire minuite:minute minites:minutes
  mispell:misspell mistery:mystery morgage:mortgage morining:morning mornin:morning moring:morning mroning:morning mountian:mountain naturaly:naturally
  neccesary:necessary nessecary:necessary nervouse:nervous nickle:nickel ninty:ninety noone:no_one nuetral:neutral numbr:number numbe:number
  obviosly:obviously occasionaly:occasionally offical:official ofcourse:of_course oftenly:often omision:omission oppinion:opinion opposit:opposite
  orginal:original orignal:original ourselfs:ourselves outragous:outrageous overal:overall paralell:parallel parliment:parliament passtime:pastime
  peaple:people peolpe:people poeple:people pepole:people percieve:perceive perfom:perform permenant:permanent perminent:permanent personaly:personally
  persuit:pursuit pharoah:pharaoh phisical:physical photgraph:photograph plesant:pleasant pleasent:pleasant poisen:poison politican:politician
  posible:possible possable:possible potatos:potatoes practicle:practical prefrence:preference preperation:preparation prepair:prepare presense:presence
  primative:primitive prioraty:priority probabley:probably problme:problem probelm:problem porblem:problem proccess:process proceedure:procedure
  promiss:promise pronounciation:pronunciation propperly:properly proprely:properly psycology:psychology publicaly:publicly puting:putting quantaty:quantity
  questionaire:questionnaire quiting:quitting quizes:quizzes rasberry:raspberry realise:realise realy:really reasearch:research recieving:receiving
  reconize:recognize recognise:recognise refrence:reference regluar:regular regulary:regularly relevence:relevance remembr:remember rememer:remember
  rescource:resource resonable:reasonable responce:response responsability:responsibility restaraunts:restaurants rediculous:ridiculous ridiculus:ridiculous
  sandwhich:sandwich saterday:saturday satisfing:satisfying scedule:schedule schedual:schedule secratary:secretary secertary:secretary seige:siege
  sentance:sentence sargent:sergeant sevral:several shedule:schedule shoud:should shuold:should shoudl:should simpley:simply sinse:since skiing:skiing
  smoothe:smooth sofware:software somtimes:sometimes sometims:sometimes somone:someone soemthing:something somethign:something someting:something
  speciallly:specially specialy:specially speach:speech statment:statement stomache:stomach storey:storey straightfoward:straightforward stregth:strength
  studing:studying subtile:subtle succede:succeed successfull:successful sucess:success sufficent:sufficient suggestable:suggestible superintendant:superintendent
  supose:suppose suposed:supposed suprize:surprise sureley:surely surley:surely surrouding:surrounding temprature:temperature tendancy:tendency
  thanx:thanks thats:that_is theif:thief themselfs:themselves therfore:therefore thier:their thigs:things thign:thing thinsg:things thnig:thing
  thoguht:thought thougth:thought throught:through thruogh:through tied:tied togather:together togehter:together tomatos:tomatoes tonite:tonight
  totaly:totally tounament:tournament tradgedy:tragedy transfered:transferred travelling:travelling truley:truly turnament:tournament tyre:tyre
  unfortunetly:unfortunately unforunately:unfortunately unneccessary:unnecessary untill:until upto:up_to usally:usually usefull:useful useing:using
  vacum:vacuum valuble:valuable vegatable:vegetable vegtable:vegetable vehicule:vehicle visiter:visitor visitng:visiting wanna:want_to warrenty:warranty
  wating:waiting weater:weather wedensday:wednesday wendsday:wednesday welcom:welcome wellcome:welcome whcih:which wheather:weather whereever:wherever
  whihc:which whitch:which wholy:wholly withdrawl:withdrawal withing:within wonderfull:wonderful woudl:would wouldnt:would_not writen:written
  yeild:yield yesteday:yesterday youself:yourself yourselfs:yourselves zeroes:zeros
  acessible:accessible acessibility:accessibility accesibility:accessibility accomodating:accommodating adress:address aisel:aisle 
  amenitys:amenities amentities:amenities appartments:apartments atrum:atrium audotorium:auditorium balcany:balcony balconey:balcony banqet:banquet
  bassment:basement bathrooom:bathroom bedrooom:bedroom boardrom:boardroom bording:boarding bouteque:boutique boutque:boutique brakeroom:breakroom
  breakrom:breakroom cafetaria:cafeteria cafeterias:cafeterias cantine:canteen canten:canteen carpak:car_park cashire:cashier cassier:cashier chapple:chapel
  checkpont:checkpoint childrens:children's classrooom:classroom cloakrom:cloakroom clinc:clinic closetts:closets coffie:coffee comferance:conference
  conferanceroom:conference_room conferenceroom:conference_room corrdior:corridor corredor:corridor coutner:counter counteer:counter courtyrad:courtyard
  dinning:dining dinningroom:dining_room disabeled:disabled dissabled:disabled doorwya:doorway dormatory:dormitory drinkng:drinking eleavator:elevator
  elevators:elevators elivator:elevator emergancyexit:emergency_exit entrnces:entrances escallator:escalator excercize:exercise exibit:exhibit exibits:exhibits
  firealarm:fire_alarm firedoor:fire_door fireexit:fire_exit firstaid:first_aid foyay:foyer foyar:foyer fuction:function functon:function galery:gallery
  garaj:garage gaurdhouse:guardhouse gim:gym gymn:gym hallwaay:hallway hallways:hallways hospial:hospital informtion:information janiter:janitor
  janitorial:janitorial kichenette:kitchenette kitchenete:kitchenette labaratory:laboratory lavatry:lavatory lavotory:lavatory lecutre:lecture lectur:lecture
  libraray:library liberay:library lifft:lift lobbie:lobby lockr:locker lockeroom:locker_room loungue:lounge lounje:lounge mainentrance:main_entrance
  meetingroom:meeting_room mezanine:mezzanine mezzanin:mezzanine mosk:mosque musuems:museums nurserey:nursery offices:offices pantrey:pantry
  parkinglot:parking_lot pathwya:pathway phamacy:pharmacy pharmicy:pharmacy playgound:playground prayerroom:prayer_room recepton:reception reseption:reception
  restraunts:restaurants restrooom:restroom reurant:restaurant roofop:rooftop rooftp:rooftop saftey:safety secruity:security securty:security
  semminar:seminar seminer:seminar servr:server showr:shower shwoer:shower stairwel:stairwell stareway:stairway stoorage:storage storag:storage
  studdy:study sutie:suite swiming:swimming swimmingpool:swimming_pool terace:terrace terrase:terrace theator:theatre thetre:theatre tiolets:toilets
  toiltes:toilets turnstyle:turnstile vestabule:vestibule waitng:waiting waitingroom:waiting_room wardrob:wardrobe washromm:washroom whealchair:wheelchair
  wheelchare:wheelchair wheelchiars:wheelchairs workshp:workshop workshopp:workshop
  adjecent:adjacent ajacent:adjacent behinde:behind besdie:beside beisde:beside bewteen:between cloest:closest closesst:closest closets:closets
  dowstairs:downstairs downsatirs:downstairs downstaris:downstairs nearst:nearest neareast:nearest nearets:nearest nerest:nearest oposite:opposite
  oppisite:opposite infront:in_front insde:inside insdie:inside outisde:outside outsdie:outside rigth:right righ:right rihgt:right lfet:left
  letf:left leftt:left straigt:straight stright:straight upstiars:upstairs upstarirs:upstairs upsteirs:upstairs
  addd:add aded:added addign:adding connnected:connected conected:connected connectd:connected creat:create craete:create 
  delted:deleted deletd:deleted dupicate:duplicate duplciate:duplicate duplcate:duplicate measrue:measure mesure:measure meausre:measure moveing:moving
  movign:moving publsihed:published publisehd:published remvoed:removed removd:removed renmaed:renamed resiz:resize reszie:resize roatate:rotate
  roatet:rotate rotaet:rotate selcet:select slect:select seelct:select  swtich:switch swicth:switch udno:undo undoe:undo zomm:zoom zom:zoom
`;

/** More texting and chat spellings. */
export const MORE_CHAT = `
  abt:about aint:is_not alr:already alrdy:already altho:although amirite:am_i_right aye:yes  bday:birthday bf:boyfriend bout:about
  brb:be_right_back bruv:mate btwn:between  cud:could cudnt:could_not cus:because da:the dat:that deets:details dem:them dis:this dnt:do_not
  dun:done em:them enuf:enough evry:every evryone:everyone evry1:everyone fav:favourite fave:favourite fone:phone fwd:forward g2g:got_to_go gf:girlfriend
  gg:good_game gn8:good_night gotchu:got_you gotcha:got_you gtg:got_to_go hbu:how_about_you hmu:message_me hru:how_are_you hrs:hours
    imma:i_am_going_to ima:i_am_going_to inb4:before irl:in_real_life iz:is jus:just juss:just kno:know knw:know l8er:later
  laterz:later lil:little luv:love  meh:meh mi:me mk:ok msgs:messages mtg:meeting nah:no nbd:no_big_deal ne1:anyone neva:never nite:night
   noob:beginner nuthin:nothing nvr:never ofc:of_course omw:on_my_way pic:picture plzz:please pwease:please  sez:says
  shud:should shudnt:should_not skool:school sme1:someone smh:smh soo:so sooo:so srsly:seriously sum1:someone sup:what_is_up tbc:to_be_continued
  tc:take_care thnk:think thot:thought thru:through tht:that tmi:too_much_information tnx:thanks togther:together tryna:trying_to tyt:take_your_time
  ugh:ugh ull:you_will urself:yourself usu:usually w8:wait wassup:what_is_up wat:what watcha:what_are_you wen:when  wiv:with wk:week
  wknd:weekend wnt:want wont:will_not wot:what woulda:would_have wud:would wudnt:would_not wuz:was xmas:christmas ya'll:you_all yall:you_all
  ye:yes yeh:yes yer:your yh:yeah yolo:yolo  yrs:years yur:your zzz:sleep
  pls:please plss:please pleeze:please pleese:please plis:please plix:please plez:please
  ok:ok okai:okay okayy:okay okkk:ok kay:okay mmk:okay mhm:yes uhuh:yes uh-huh:yes nuh-uh:no nuhuh:no
`;

/**
 * Words people write as two (or with a hyphen) that are one: "good bye", "rest room", "wheel chair".
 * Read joined, so "good bye" and "goodbye" mean the same. Never joined: words that are also two
 * ordinary words in a sentence ("into" from "zoom in to", "maybe" from "may be").
 */
export const COMPOUNDS = `
  goodbye     restroom restrooms bathroom bathrooms washroom washrooms bedroom bedrooms classroom
  classrooms boardroom boardrooms storeroom storerooms stockroom showroom showrooms playroom staffroom cloakroom cloakrooms breakroom
  checkroom courtroom darkroom guestroom mailroom schoolroom sickroom stateroom tearoom backroom workroom wheelchair wheelchairs staircase staircases
  stairway stairways stairwell stairwells doorway doorways hallway hallways walkway walkways gateway gateways pathway pathways entryway footpath
  footpaths passageway driveway upstairs downstairs everything everyone everywhere everybody something someone somewhere somebody anything anyone
  anywhere anybody nothing nowhere nobody myself yourself himself herself itself ourselves themselves inside outside nearby today tonight
  tomorrow afternoon alright cafeteria kitchenette lighthouse guardhouse greenhouse warehouse storehouse townhouse outhouse playground
  courtyard backyard frontyard schoolyard rooftop rooftops basement basements checkpoint checkpoints bookshelf bookshelves bookcase
  cupboard cupboards countertop tabletop desktop laptop doorbell doorknob doormat signpost lamppost noticeboard whiteboard blackboard
  billboard carpark carparks underground overground skylight skylights fireplace firewall fireproof lifeguard lifeboat landmark landmarks
  sidewalk crosswalk boardwalk catwalk headquarters homepage website online offline       
           overview viewpoint standpoint someday anyway anyways
  somehow however whatever wherever whenever whoever forever meanwhile otherwise elsewhere throughout without within 
`;

/** More names of places (by room kind) and objects. */
export const MORE_PLACES = {
  restroom: `family_restroom all_gender_toilet gender_neutral_toilet baby_changing nappy_change diaper_change shower_room washbasin
    hand_wash wash_area ablution ablution_room wudu wudu_area foot_wash`,
  reception: `welcome_centre visitor_centre visitor_center information_point info_point help_point customer_service guest_services
    front_office registration_desk security_desk check_in_desk queue queue_area ticketing ticket_desk ticket_counter`,
  meeting: `meeting_space meeting_pod pod phone_booth focus_room collaboration_space event_space event_hall function_room banquet_hall
    ballroom conference_hall lecture_theatre lecture_theater seminar_hall tutorial_room computer_room media_room projection_room`,
  entrance: `back_door side_door front_gate back_gate main_gate service_entrance staff_entrance delivery_entrance north_entrance
    south_entrance east_entrance west_entrance revolving_door sliding_door automatic_door security_gate ticket_gate`,
  stairs: `back_stairs front_stairs main_stairs service_stairs emergency_stairs ladder ramp ramps wheelchair_ramp slope`,
  elevator: `passenger_lift passenger_elevator freight_elevator cargo_lift platform_lift stair_lift`,
  utility: `plant_room riser shaft duct duct_room meter_room switch_room transformer_room ups_room battery_room water_tank tank_room
    cleaners_cupboard cleaner_room housekeeping linen_room linen_store waste_room trash_room loading_area service_corridor back_of_house`,
  office: `reception_area hotel_room guest_room suite presidential_suite junior_suite twin_room double_room single_room family_room
    standard_room deluxe_room executive_room conference_centre business_centre co_working coworking open_office open_plan_office
    hot_desk hot_desking manager_office directors_office ceo_office head_office admin_office administration finance hr accounts
    sales marketing it_department engineering design_studio art_studio music_room dance_studio yoga_room meditation_room massage_room
    treatment_room salon barber hairdresser nail_bar beauty_salon gift_shop souvenir_shop bookshop bookstore newsagent electronics
    clothing fashion shoe_shop jewellery_shop jewelry_store toy_shop sports_shop phone_shop optician florist laundromat dry_cleaner
    travel_agent car_rental bureau_de_change money_exchange bank_branch insurance post_box courier parcel_lockers food_hall juice_bar
    tea_room tea_house coffee_bar espresso_bar ice_cream gelato bakery_cafe sandwich_bar pizza burger fast_food buffet bistro brasserie
    grill steakhouse rooftop_bar sky_bar wine_bar cocktail_bar nightclub club arcade cinema_hall bowling games_room library_cafe
    exhibition_hall gallery_space art_gallery museum_shop archive_room collection_store reading_room study_area quiet_zone silent_room
    tv_room family_lounge vip_lounge business_lounge departure_lounge arrival_hall arrivals departures gate_area baggage_claim
    check_in_hall security_check customs immigration duty_free platform platforms waiting_hall ticket_hall concourse mall shopping_centre
    food_court_area kids_zone kids_club soft_play ball_pit nursing_room feeding_room sensory_room first_aid_room medical_centre
    health_centre consulting_room examination_room operating_theatre emergency_room a_and_e icu maternity ward_a ward_b pharmacy_store
    dispensary lab_room blood_test radiology_room scan_room x_ray_room physiotherapy dentist_room eye_clinic`,
};

export const MORE_OBJECTS = `
  armchairs beanbag beanbags footstool ottoman recliner sofa_bed rocking_chair high_chair baby_seat pew pews bleachers grandstand
  coffee_table side_table dining_table picnic_table workbench conference_table reception_desk standing_desk filing_cabinet safe
  coat_rack coat_hook hanger mirror mirrors curtain curtains blind blinds rug carpet mat doormat_mat
  hand_dryer paper_towel soap_dispenser sanitizer hand_sanitizer toilet_roll baby_changer changing_table urinal_trough bidet bathtub
  water_cooler coffee_machine microwave fridge refrigerator freezer oven stove dishwasher kettle toaster vending snack_machine
  ticket_machine parking_meter pay_station card_reader barrier_gate boom_gate speed_bump bollards cone cones fire_hose sprinkler
  smoke_detector emergency_light exit_sign evacuation_map assembly_point muster_point fire_assembly_point eyewash first_aid_box
  stretcher wheelchair_spot hearing_loop braille_sign tactile_paving handrails lift_button intercom doorbell_button
  potted_plant pot_plant flower_pot hanging_basket palm palm_tree fern cactus shrub shrubs lawn grass flower_bed fountain_feature pond
  pool_table ping_pong table_tennis foosball arcade_machine slide swing swings seesaw climbing_frame sandpit trampoline
  bike_shed bike_stand ev_charger charging_point locker_bank luggage_storage left_luggage trolley trolleys baggage_trolley
  display_case showcase glass_case plinth pedestal banner flag flags poster posters screen_wall video_wall digital_sign wayfinding_sign
  directory_board floor_plan_map you_are_here_map information_board donation_box suggestion_box comment_box`;

/** More small talk. */
export const MORE_SMALL_TALK = {
  greeting: `hi_all hello_all hey_all hi_everyone hello_everyone hey_everyone hiya_mate hey_buddy hi_buddy hello_buddy morning_all
    good_morning_everyone hey_hey_hey hello_hello_hello yoo yooo hey_yo whats_up_man sup_bro sup_dude heyo hiyaa wagwan wassup_bro
    howdy_partner ahoy greetings_friend hi_bot hello_bot hey_bot hi_assistant hello_assistant hey_assistant hi_robot hello_robot`,
  howareyou: `how_are_u how_r_you how_is_you how_you_been_doing what_is_up_with_you are_you_doing_ok are_you_doing_okay how_is_everything_going
    how_are_you_this_morning how_are_you_this_afternoon how_are_you_this_evening how_are_you_doing_today hope_all_is_well
    you_doing_good you_doing_ok you_doing_alright are_you_alright how_is_the_day how_is_work how_is_it_going_today`,
  thanks: `thanks_a_bunch thanks_heaps thanks_loads thanks_ever_so_much thank_u thank_u_so_much tysm_bro thanks_dude thanks_man
    thanks_buddy_appreciate_it appreciated much_obliged obliged grateful i_am_grateful so_grateful merci gracias danke arigato
    thanks_for_the_help thanks_for_helping thank_you_for_your_help thanks_for_that thank_you_for_that great_help big_help
    you_are_the_best_thanks you_helped_a_lot`,
  bye: `good_bye goodbye_for_now bye_for_now bye_now see_you_around see_you_tomorrow see_you_next_time catch_ya catch_ya_later
    later_gator laters_mate gotta_run i_have_to_go i_need_to_go i_will_be_back be_back_later brb byeee byeeee bye_bye_now
    have_a_good_one have_a_great_day have_a_good_night take_it_easy stay_safe all_the_best cheers_bye ciao_bye`,
  compliment: `you_are_brilliant you_are_fantastic you_are_so_good you_are_very_good you_are_really_good you_are_really_helpful
    great_work great_stuff good_stuff awesome_work amazing_work fantastic_job excellent_job well_played very_good very_nice
    so_good so_cool that_is_great that_is_amazing that_is_awesome that_was_quick that_was_fast impressive wow_thanks wonderful
    love_you thanks_genius best_bot best_assistant`,
};

/**
 * Everyday English: real words, never "corrected" into a word the assistant knows ("tear" is
 * not "tea", "bear" is not "bar"). The more of these, the safer the spelling correction.
 */
export const COMMON_ENGLISH = `
  able about above accept across act action actually add after again against age ago agree ahead air all allow almost alone along
  already also although always among amount and angle animal another answer any appear apply area arm army around arrive art as ask
  attack attention avoid away baby back bad bag ball bank bar base basket bath bay be bear beat beautiful became because become bed been
  before began begin behind being believe bell belong below beneath bent beside best better between beyond big bill bird bit bite black
  blade blank blend block blood blow blue board boat body bone book boot border born both bottle bottom bought bowl box boy brain branch
  brave bread break brick bridge brief bright bring broad broke brother brought brown brush build built burn burst bus business busy but
  buy by call calm came camp can capital captain car card care carry case cast cat catch cause cell cent center central century certain
  chain chair chance change chapter charge chart cheap check cheese chest chick chief child choice choose church circle city claim class
  clean clear climb clock close cloth cloud coast coat code coin cold collect college colour color column come common company compare
  complete condition consider contain continue control cook cool copy corn corner correct cost cotton could count country course cover cow
  crash cream crew crop cross crowd cry cup current cut dad dance danger dark data date daughter day dead deal dear death decide deep
  degree depend describe desert design detail develop die differ difficult dinner direct discuss distant divide doctor dog dollar done
  double down draw dream dress drink drive drop dry duck during dust duty each ear early earth ease east easy eat edge effect egg eight
  either electric element else end enemy energy engine enough enter equal even evening event ever every exact example except excite
  exercise expect experience expert explain eye face fact fair fall family famous far farm fast fat father favour fear feed feel feet
  fell felt few field fig fight figure fill final find fine finger finish fire firm first fish fit five flat floor flow flower fly follow
  food foot for force forest form forward found four frame free fresh friend from front fruit full fun game garden gas gather gave general
  gentle get gift girl give glad glass go goal gold gone good got govern grand grass gray great green grew ground group grow guess guide
  gun hair half hand happen happy hard has hat have he head hear heard heart heat heavy held help her here high hill him his history hit
  hold hole home hope horse hot hour house how huge human hundred hunt hurry hurt ice idea if image imagine in inch include increase
  indicate industry insect instant instead interest invent iron island it job join joy judge jump just keep key kid kill kind king knew
  know lady lake land language large last late laugh law lay lead learn least leave led left leg length less let letter level lie life
  lift light like line liquid list listen little live load local long look lose loss lost lot loud love low machine made main major make
  man many map mark market mass master match material matter may me mean measure meat meet melody member memory men mention metal method
  middle might mile milk million mind mine minute miss mix model modern moment money month moon more morning most mother motion mountain
  mouth move much music must my name nation natural nature near necessary neck need neighbor never new next nice night nine no noise none
  nor north nose not note nothing notice noun now number object observe occur ocean of off offer office often oil old on once one only
  open operate opposite or order organ other our out over own page paint pair paper paragraph parent part particular party pass past path
  pattern pay peace people per perhaps period person pick picture piece pitch plain plan plane plant play please plural poem point poor
  populate port pose position possible post pound power practice prepare present press pretty print probable problem process produce
  product proper protect proud prove provide pull push put quart question quick quiet quite race radio rail rain raise ran range rather
  reach read ready real reason receive record red region remember repeat reply represent require rest result rich ride right ring rise
  river road rock roll room root rope rose round row rub rule run safe said sail salt same sand sat save saw say scale school science
  score sea search season seat second section see seed seem segment select self sell send sense sentence separate serve set settle seven
  several shall shape share sharp she sheet shell shine ship shoe shop shore short should shoulder shout show side sight sign silent
  silver similar simple since sing single sister sit six size skill skin sky sleep slip slow small smell smile snow so soft soil soldier
  solution some son song soon sound south space speak special speech speed spell spend spoke spot spread spring square stand star start
  state station stay steam steel step stick still stone stood stop store story straight strange stream street stretch string strong
  student study subject such sudden suffix sugar suit summer sun supply support sure surface surprise swim system table tail take talk
  tall teach team tear teeth tell temperature ten term test than thank that the their them then there these they thick thin thing think
  third this those though thought thousand three through throw thus tie time tiny tire to together told tone too took tool top total
  touch toward town track trade train travel tree triangle trip trouble truck true try tube turn twenty two type under unit until up us
  use usual valley value vary verb very view village visit voice vowel wait walk wall want war warm was wash watch water wave way we
  wear weather week weight well went were west what wheel when where whether which while white who whole why wide wife wild will win
  wind window wing winter wire wise wish with woman women wonder wood word work world would write written wrong wrote yard year yellow
  yes yet you young your
`;
