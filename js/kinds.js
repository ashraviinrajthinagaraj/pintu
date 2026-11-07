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
};

export function kindLabel(kind, lang) {
  const words = WORDS[lang === 'ms' ? 'ms' : 'en'];
  for (const k of [].concat(kind || [])) {
    if (words[k]) return words[k];
  }
  const first = [].concat(kind || []).find(Boolean);
  if (!first || lang === 'ms') return '';
  const plain = first.replace(/_/g, ' ');
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}
