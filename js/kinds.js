// What a place is, in a word or two, from the map's own description of it.
const WORDS = {
  ms: {
    attraction: 'Tarikan', museum: 'Muzium', viewpoint: 'Tempat pemandangan', theme_park: 'Taman tema', zoo: 'Zoo',
    aquarium: 'Akuarium', gallery: 'Galeri', artwork: 'Karya seni', monument: 'Monumen', memorial: 'Tugu peringatan',
    castle: 'Istana', ruins: 'Runtuhan', fort: 'Kubu', restaurant: 'Restoran', fast_food: 'Makanan segera', cafe: 'Kafe',
    food_court: 'Medan selera', fuel: 'Stesen minyak', charging_station: 'Cas EV', hotel: 'Hotel', motel: 'Motel',
    guest_house: 'Rumah tumpangan', hostel: 'Asrama', resort: 'Resort', lodging: 'Penginapan', parking: 'Tempat letak kereta',
    hospital: 'Hospital', clinic: 'Klinik', pharmacy: 'Farmasi', school: 'Sekolah', college: 'Kolej', university: 'Universiti',
    place_of_worship: 'Rumah ibadat', mosque: 'Masjid', bank: 'Bank', atm: 'ATM', post_office: 'Pejabat pos',
    police: 'Balai polis', supermarket: 'Pasar raya', mall: 'Pusat beli-belah', shop: 'Kedai', convenience: 'Kedai serbaneka',
    park: 'Taman', bus: 'Perhentian bas', bus_stop: 'Perhentian bas', railway: 'Stesen', station: 'Stesen', aerodrome: 'Lapangan terbang',
    stadium: 'Stadium', sports_centre: 'Pusat sukan', cinema: 'Pawagam', library: 'Perpustakaan', town_hall: 'Dewan bandaran',
  },
  en: {
    attraction: 'Attraction', museum: 'Museum', viewpoint: 'Viewpoint', theme_park: 'Theme park', zoo: 'Zoo',
    aquarium: 'Aquarium', gallery: 'Gallery', artwork: 'Artwork', monument: 'Monument', memorial: 'Memorial',
    castle: 'Palace', ruins: 'Ruins', fort: 'Fort', restaurant: 'Restaurant', fast_food: 'Fast food', cafe: 'Café',
    food_court: 'Food court', fuel: 'Petrol station', charging_station: 'EV charging', hotel: 'Hotel', motel: 'Motel',
    guest_house: 'Guest house', hostel: 'Hostel', resort: 'Resort', lodging: 'Place to stay', parking: 'Car park',
    hospital: 'Hospital', clinic: 'Clinic', pharmacy: 'Pharmacy', school: 'School', college: 'College', university: 'University',
    place_of_worship: 'Place of worship', mosque: 'Mosque', bank: 'Bank', atm: 'ATM', post_office: 'Post office',
    police: 'Police station', supermarket: 'Supermarket', mall: 'Shopping centre', shop: 'Shop', convenience: 'Convenience store',
    park: 'Park', bus: 'Bus stop', bus_stop: 'Bus stop', railway: 'Station', station: 'Station', aerodrome: 'Airport',
    stadium: 'Stadium', sports_centre: 'Sports centre', cinema: 'Cinema', library: 'Library', town_hall: 'Town hall',
  },
  zh: {
    attraction: '景点', museum: '博物馆', viewpoint: '观景台', theme_park: '主题公园', zoo: '动物园',
    aquarium: '水族馆', gallery: '画廊', artwork: '艺术品', monument: '纪念碑', memorial: '纪念馆',
    castle: '王宫', ruins: '遗迹', fort: '城堡', restaurant: '餐厅', fast_food: '快餐', cafe: '咖啡馆',
    food_court: '美食中心', fuel: '油站', charging_station: '电动车充电', hotel: '酒店', motel: '汽车旅馆',
    guest_house: '民宿', hostel: '青年旅舍', resort: '度假村', lodging: '住宿', parking: '停车场',
    hospital: '医院', clinic: '诊所', pharmacy: '药房', school: '学校', college: '学院', university: '大学',
    place_of_worship: '宗教场所', mosque: '清真寺', bank: '银行', atm: '提款机', post_office: '邮局',
    police: '警察局', supermarket: '超市', mall: '购物中心', shop: '商店', convenience: '便利店',
    park: '公园', bus: '巴士站', bus_stop: '巴士站', railway: '车站', station: '车站', aerodrome: '机场',
    stadium: '体育场', sports_centre: '运动中心', cinema: '电影院', library: '图书馆', town_hall: '市政厅',
  },
  ta: {
    attraction: 'சுற்றுலாத் தலம்', museum: 'அருங்காட்சியகம்', viewpoint: 'காட்சி முனை', theme_park: 'கருப்பொருள் பூங்கா', zoo: 'விலங்கியல் பூங்கா',
    aquarium: 'மீன் காட்சியகம்', gallery: 'கலைக்கூடம்', artwork: 'கலைப்படைப்பு', monument: 'நினைவுச்சின்னம்', memorial: 'நினைவகம்',
    castle: 'அரண்மனை', ruins: 'இடிபாடுகள்', fort: 'கோட்டை', restaurant: 'உணவகம்', fast_food: 'துரித உணவு', cafe: 'காபிக் கடை',
    food_court: 'உணவுக் கூடம்', fuel: 'பெட்ரோல் நிலையம்', charging_station: 'மின்வாகன சார்ஜிங்', hotel: 'ஹோட்டல்', motel: 'மோட்டல்',
    guest_house: 'விருந்தினர் இல்லம்', hostel: 'விடுதி', resort: 'ரிசார்ட்', lodging: 'தங்குமிடம்', parking: 'கார் நிறுத்துமிடம்',
    hospital: 'மருத்துவமனை', clinic: 'மருந்தகம்', pharmacy: 'மருந்துக் கடை', school: 'பள்ளி', college: 'கல்லூரி', university: 'பல்கலைக்கழகம்',
    place_of_worship: 'வழிபாட்டுத் தலம்', mosque: 'பள்ளிவாசல்', bank: 'வங்கி', atm: 'ATM', post_office: 'தபால் நிலையம்',
    police: 'காவல் நிலையம்', supermarket: 'பேரங்காடி', mall: 'வணிக வளாகம்', shop: 'கடை', convenience: 'வசதிக் கடை',
    park: 'பூங்கா', bus: 'பேருந்து நிறுத்தம்', bus_stop: 'பேருந்து நிறுத்தம்', railway: 'நிலையம்', station: 'நிலையம்', aerodrome: 'விமான நிலையம்',
    stadium: 'விளையாட்டரங்கம்', sports_centre: 'விளையாட்டு மையம்', cinema: 'திரையரங்கம்', library: 'நூலகம்', town_hall: 'நகர மண்டபம்',
  },
};

export function kindLabel(kind, lang) {
  const words = WORDS[lang] || WORDS.en;
  for (const k of [].concat(kind || [])) {
    if (words[k]) return words[k];
  }
  const first = [].concat(kind || []).find(Boolean);
  if (!first || lang !== 'en') return '';
  const plain = first.replace(/_/g, ' ');
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}
