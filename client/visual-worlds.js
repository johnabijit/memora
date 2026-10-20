// Distinct layout/surface worlds, separate from the existing 120 color palettes.
// Date-based suggestions never use geolocation, religion, or personal memories.
export const visualWorlds=[
 {id:'gallery',name:'Gallery',group:'Minimal',style:'gallery',scene:'modern museum neutral architecture',note:'Light, calm, uncluttered'},
 {id:'paper',name:'Paper Journal',group:'Minimal',style:'paper',scene:'warm paper stationery writing desk',note:'Warm, tactile and quiet'},
 {id:'zen',name:'Zen',group:'Minimal',style:'zen',scene:'zen garden Japanese architecture',note:'Open space and gentle surfaces'},
 {id:'noir',name:'Midnight Noir',group:'Minimal',style:'noir',scene:'black and white night city architecture',note:'Dark editorial contrast'},
 {id:'editorial',name:'Editorial',group:'Minimal',style:'editorial',scene:'minimal architectural photography',note:'Type-led magazine feel'},
 {id:'graphite',name:'Graphite',group:'Minimal',style:'graphite',scene:'dark graphite mountain photography',note:'Refined industrial'},
 {id:'aurora',name:'Northern Lights',group:'Nature',style:'aurora',scene:'aurora borealis arctic night',note:'Vivid northern skies'},
 {id:'ocean',name:'Ocean Blue',group:'Nature',style:'ocean',scene:'ocean coastline turquoise sea',note:'Deep water and light'},
 {id:'forest',name:'Forest Escape',group:'Nature',style:'forest',scene:'misty green forest',note:'Lush canopy'},
 {id:'monsoon',name:'Monsoon',group:'Nature',style:'monsoon',scene:'rain monsoon tropical forest',note:'Rain and lush green'},
 {id:'desert',name:'Golden Desert',group:'Nature',style:'desert',scene:'golden desert dunes sunset',note:'Warm sand and glow'},
 {id:'mountain',name:'Alpine',group:'Nature',style:'mountain',scene:'alpine mountain valley',note:'Crisp and spacious'},
 {id:'sakura',name:'Cherry Blossoms',group:'Nature',style:'sakura',scene:'cherry blossom spring garden',note:'Soft spring blooms'},
 {id:'sunset',name:'Golden Hour',group:'Nature',style:'sunset',scene:'golden sunset Mediterranean coast',note:'Warm sunset light'},
 {id:'winter',name:'Winter Calm',group:'Seasons',style:'winter',scene:'snowy pine forest winter',note:'Snowfall and frost'},
 {id:'spring',name:'Spring Meadow',group:'Seasons',style:'spring',scene:'spring meadow wildflowers',note:'Fresh morning light'},
 {id:'summer',name:'Summer Coast',group:'Seasons',style:'summer',scene:'sunny summer beach',note:'Bright airy coastline'},
 {id:'autumn',name:'Autumn Amber',group:'Seasons',style:'autumn',scene:'autumn orange leaves mountain',note:'Copper woodland'},
 {id:'tropical',name:'Tropical Breeze',group:'Locations',style:'tropical',scene:'Kerala backwaters coconut palms',note:'Coastal green'},
 {id:'city',name:'City Lights',group:'Locations',style:'city',scene:'Tokyo nighttime city neon street',note:'Urban after dark'},
 {id:'mediterranean',name:'Mediterranean',group:'Locations',style:'mediterranean',scene:'Greek island white buildings sea',note:'Sunlit white and blue'},
 {id:'nordic',name:'Nordic',group:'Locations',style:'nordic',scene:'Scandinavian minimalist interiors',note:'Natural soft woods'},
 {id:'deepavali',name:'Festival of Lights',group:'Celebrations',style:'deepavali',scene:'Diwali diyas festive lights',note:'Golden lights, manually chosen'},
 {id:'christmas',name:'Christmas Glow',group:'Celebrations',style:'christmas',scene:'Christmas winter festive lights',note:'Evergreen and candlelight'},
 {id:'onam',name:'Onam Flowers',group:'Celebrations',style:'onam',scene:'Onam pookalam Kerala flowers',note:'Floral celebration, manually chosen'},
 {id:'new-year',name:'New Year Sparkle',group:'Celebrations',style:'new-year',scene:'fireworks city celebration',note:'Festive night skies'},
 {id:'eid',name:'Eid Lanterns',group:'Celebrations',style:'eid',scene:'ornate lanterns festival evening',note:'Lantern glow, manually chosen'},
 {id:'halloween',name:'Autumn Lanterns',group:'Celebrations',style:'halloween',scene:'autumn pumpkin candles',note:'Warm seasonal lanterns'},
 {id:'pongal',name:'Harvest Day',group:'Celebrations',style:'pongal',scene:'Pongal Tamil Nadu harvest kolam',note:'Harvest warmth, manually chosen'},
 {id:'birthday',name:'Birthday Confetti',group:'Celebrations',style:'birthday',scene:'abstract joyful confetti lights',note:'Colorful confetti'}
]
export const worldRegions=[
 {id:'global',name:'Global (no region selected)',hemisphere:'north',tropical:false},
 {id:'india',name:'India',hemisphere:'north',tropical:true},
 {id:'uk',name:'United Kingdom',hemisphere:'north',tropical:false},
 {id:'us',name:'United States',hemisphere:'north',tropical:false},
 {id:'eu',name:'Europe',hemisphere:'north',tropical:false},
 {id:'japan',name:'Japan',hemisphere:'north',tropical:false},
 {id:'mena',name:'Middle East / North Africa',hemisphere:'north',tropical:false},
 {id:'australia',name:'Australia / New Zealand',hemisphere:'south',tropical:false},
 {id:'south-america',name:'South America',hemisphere:'south',tropical:true},
 {id:'southeast-asia',name:'Southeast Asia',hemisphere:'north',tropical:true}
]
export function suggestedWorld(date=new Date(),region='global'){
 const d=date instanceof Date?date:new Date(date)
 if(!Number.isFinite(d.getTime()))return 'gallery'
 const month=d.getMonth()+1,day=d.getDate()
 const place=worldRegions.find(r=>r.id===region)||worldRegions[0]
 // Only fixed-date civil holidays are applied automatically. Dates for
 // Deepavali, Eid, Onam and other moveable festivals require manual selection.
 if(month===1&&day<=2)return 'new-year'
 if(month===12&&day>=20&&day<=27)return 'christmas'
 if(month===10&&day>=28&&day<=31&&(region==='us'||region==='uk'))return 'halloween'
 if(place.tropical){
   if(month>=6&&month<=9)return region==='india'?'monsoon':'tropical'
   return month>=3&&month<=5?'summer':'forest'
 }
 const shifted=place.hemisphere==='south'?(month+5)%12+1:month
 if([12,1,2].includes(shifted))return 'winter'
 if([3,4,5].includes(shifted))return region==='japan'?'sakura':'spring'
 if([6,7,8].includes(shifted))return 'summer'
 return 'autumn'
}
export function getVisualWorld(id){
 return visualWorlds.find(world=>world.id===id)||visualWorlds[0]
}
