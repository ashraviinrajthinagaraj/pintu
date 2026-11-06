// Who's talking. Every character here is original, written for Pintu.
//
// The rule that keeps them safe to drive with: the instruction is always said in
// full, and always first at the moment of a turn. A joke only ever comes after an
// instruction, where the next instruction simply cuts it off, or as a word or two
// in front of one. Nothing here ever encourages going faster.

const CAST = {
  standard: {
    name: { ms: 'Biasa', en: 'Standard' },
    about: { ms: 'Arahan sahaja, tanpa gurauan.', en: 'Directions only, no jokes.' },
    voice: { pitch: 1, rate: 1 },
    lines: null,
  },

  captain: {
    name: { ms: 'Kapten', en: 'The Captain' },
    about: { ms: 'Juruterbang yang menganggap kereta anda pesawat.', en: 'A pilot who thinks your car is an airliner.' },
    voice: { pitch: 0.85, rate: 0.92 },
    lines: {
      ms: {
        lead: ['Para penumpang,', 'Dari kokpit,', 'Perhatian semua,'],
        tail: ['Sila pastikan tali pinggang dipakai.', 'Cuaca di kokpit sangat tenang.', 'Terima kasih kerana memilih Pintu Airlines.', 'Makanan ringan tidak disediakan.', 'Penerbangan ini lancar setakat ini.'],
        nowLead: ['Kru,', 'Perhatian,'],
        start: ['Selamat datang ke penerbangan Pintu. Lampu tali pinggang kini menyala.'],
        arrive: ['Kita telah mendarat. Jangan tinggal barang di tempat duduk.', 'Selamat mendarat. Sila tunggu sehingga kenderaan berhenti sepenuhnya.'],
        stop: ['Persinggahan singkat. Kita berlepas semula nanti.'],
        reroute: ['Menara kawalan sedang kira laluan baharu.', 'Kita ubah laluan penerbangan. Tiada apa yang perlu dirisaukan.'],
        overspeed: ['Kita melebihi had laju {limit}. Sila kurangkan kelajuan pesawat.'],
        rain: ['Bersedia untuk sedikit gelora.'],
        fuel: ['Ini bukan gurauan dari kokpit.'],
      },
      en: {
        lead: ['Ladies and gentlemen,', 'From the flight deck,', 'Attention all passengers,'],
        tail: ['Please keep your seatbelt fastened.', 'Conditions on the flight deck are calm.', 'Thank you for choosing Pintu Airlines.', 'No snacks will be served today.', 'So far, a very smooth flight.'],
        nowLead: ['Crew,', 'Attention,'],
        start: ['Welcome aboard Pintu Airlines. The seatbelt sign is now on.'],
        arrive: ['We have landed. Please check your seat for belongings.', 'Welcome to your destination. Remain seated until the vehicle has fully stopped.'],
        stop: ['A short layover. We depart again shortly.'],
        reroute: ['The tower is working out a new flight path.', 'We are changing our flight path. Nothing to worry about.'],
        overspeed: ['We are above the {limit} limit. Please slow the aircraft down.'],
        rain: ['Expect a little turbulence.'],
        fuel: ['This is not a joke from the flight deck.'],
      },
    },
  },

  commentator: {
    name: { ms: 'Pengulas Bola', en: 'The Commentator' },
    about: { ms: 'Setiap belokan ialah perlawanan akhir.', en: 'Every turn is a cup final.' },
    voice: { pitch: 1.15, rate: 1.18 },
    lines: {
      ms: {
        lead: ['Dan inilah dia!', 'Perhatikan gerakan ini!', 'Penonton sudah berdiri!'],
        tail: ['Hantaran yang cantik!', 'Ini taktik pengurus!', 'Stadium bergema!', 'Luar biasa, tuan-tuan!'],
        nowLead: ['Sekarang!', 'Ya!'],
        start: ['Sepak mula! Perlawanan bermula!'],
        arrive: ['Gol! Gol! Gol! Jaringan di minit akhir!', 'Wisel penamat berbunyi! Kemenangan besar!'],
        stop: ['Rehat separuh masa! Minum air dulu.'],
        reroute: ['Oh! Tersasar dari sasaran! Pengurus ubah taktik!', 'Hampir sahaja! Kita cuba dari sisi lain!'],
        overspeed: ['Kad kuning! Pengadil kata had laju {limit}!'],
        rain: ['Padang bakal basah, penonton!'],
        fuel: ['Pemain ini perlukan pengganti!'],
      },
      en: {
        lead: ['And here it comes!', 'Watch this move!', 'The crowd is on its feet!'],
        tail: ['What a pass!', 'That is the manager\'s tactic!', 'The stadium is roaring!', 'Unbelievable scenes!'],
        nowLead: ['Now!', 'Yes!'],
        start: ['Kick off! We are under way!'],
        arrive: ['Goal! Goal! Goal! A last minute winner!', 'There goes the final whistle! A famous victory!'],
        stop: ['Half time! Grab some water.'],
        reroute: ['Oh! Just wide of the target! The manager changes tactics!', 'So close! We try it down the other wing!'],
        overspeed: ['Yellow card! The referee says the limit is {limit}!'],
        rain: ['The pitch is about to get wet!'],
        fuel: ['This player needs a substitute!'],
      },
    },
  },

  makcik: {
    name: { ms: 'Mak Cik Bawang', en: 'The Nosy Aunty' },
    about: { ms: 'Tahu semua jalan, dan hal semua orang.', en: 'Knows every road, and everyone\'s business.' },
    voice: { pitch: 1.25, rate: 1.08 },
    lines: {
      ms: {
        lead: ['Eh, dengar sini,', 'Mak cik cakap ni,', 'Haa,'],
        tail: ['Jangan cakap mak cik tak bagi tau.', 'Semalam anak jiran pun lalu sini, entah nak ke mana.', 'Mak cik tahu semua jalan, tanya je.', 'Dah makan ke belum tu?', 'Kereta depan tu baru, entah macam mana boleh beli.'],
        nowLead: ['Haa, sekarang,', 'Haa,'],
        start: ['Nak ke mana tu? Mak cik tanya je.'],
        arrive: ['Sampai pun. Nanti cerita kat mak cik apa jadi.', 'Haa, dah sampai. Orang dah tanya tadi.'],
        stop: ['Singgah sini pulak? Beli apa tu? Bagi tau mak cik.'],
        reroute: ['Haa, kan dah salah jalan. Nasib baik mak cik ada.', 'Mak cik dah agak dah. Tunggu, mak cik cari jalan lain.'],
        overspeed: ['Laju-laju nak ke mana? Had laju {limit} je tau.'],
        rain: ['Jemuran dah angkat ke belum?'],
        fuel: ['Jangan sampai orang kampung tahu.'],
      },
      en: {
        lead: ['Now listen to me,', 'Aunty is telling you,', 'Haa,'],
        tail: ['Don\'t say Aunty never told you.', 'The neighbour\'s son came this way yesterday. Who knows why.', 'Aunty knows every road, just ask.', 'Have you eaten yet?', 'That car in front is new. Wonder how they paid for it.'],
        nowLead: ['Haa, now,', 'Haa,'],
        start: ['Where are you going? Aunty is only asking.'],
        arrive: ['Finally. Later you tell Aunty everything.', 'Haa, you\'re here. People were asking about you.'],
        stop: ['Stopping here? Buying what? Tell Aunty.'],
        reroute: ['Haa, wrong road. Lucky Aunty is here.', 'Aunty knew it. Wait, Aunty will find another way.'],
        overspeed: ['Why so fast? The limit is only {limit}, you know.'],
        rain: ['Have you brought in the laundry?'],
        fuel: ['Don\'t let the whole village find out.'],
      },
    },
  },

  trailer: {
    name: { ms: 'Pencerita Filem', en: 'The Trailer Voice' },
    about: { ms: 'Perjalanan ke kedai jadi filem epik.', en: 'A trip to the shops becomes an epic film.' },
    voice: { pitch: 0.7, rate: 0.85 },
    lines: {
      ms: {
        lead: ['Dalam dunia yang penuh simpang,', 'Satu pemandu. Satu misi.', 'Tahun ini,'],
        tail: ['Akan datang, di pawagam berhampiran anda.', 'Perjalanan ini akan mengubah segalanya.', 'Dan tiada apa akan sama lagi.', 'Dia tidak pernah bersedia.'],
        nowLead: ['Kini,', 'Saat itu tiba.'],
        start: ['Tahun ini. Satu perjalanan. Akan bermula.'],
        arrive: ['Dan akhirnya, dia tiba. Tamat.', 'Perjalanan berakhir. Tapi adakah tempat letak kereta? Sambungannya, tahun depan.'],
        stop: ['Satu hentian. Satu rahsia.'],
        reroute: ['Satu kesilapan. Satu laluan baharu. Satu peluang terakhir.'],
        overspeed: ['Seorang pemandu. Satu had laju, {limit}. Dan dia sudah melebihinya.'],
        rain: ['Langit semakin gelap.'],
        fuel: ['Tangki hampir kosong. Dan stesen masih jauh.'],
      },
      en: {
        lead: ['In a world full of junctions,', 'One driver. One mission.', 'This year,'],
        tail: ['Coming soon, to a cinema near you.', 'This journey will change everything.', 'And nothing will ever be the same.', 'They were never ready.'],
        nowLead: ['And now,', 'The moment arrives.'],
        start: ['This year. One journey. Begins.'],
        arrive: ['And at last, they arrived. The end.', 'The journey is over. But is there parking? Find out in the sequel.'],
        stop: ['One stop. One secret.'],
        reroute: ['One mistake. One new road. One last chance.'],
        overspeed: ['One driver. One speed limit, {limit}. And they have gone past it.'],
        rain: ['The skies are growing dark.'],
        fuel: ['The tank is nearly empty. And the station is far away.'],
      },
    },
  },

  agent: {
    name: { ms: 'Ejen Rahsia', en: 'The Secret Agent' },
    about: { ms: 'Setiap trip ialah misi sulit.', en: 'Every trip is a classified mission.' },
    voice: { pitch: 0.8, rate: 1.05 },
    lines: {
      ms: {
        lead: ['Ejen, dengar baik-baik.', 'Arahan dari ibu pejabat.', 'Sulit.'],
        tail: ['Jangan beritahu sesiapa.', 'Kereta di belakang itu mungkin bukan sesiapa. Mungkin.', 'Bertindak biasa.', 'Anda tidak pernah dengar ini.'],
        nowLead: ['Sekarang, ejen.', 'Sekarang.'],
        start: ['Misi anda bermula sekarang.'],
        arrive: ['Misi selesai, ejen. Bayaran dalam bentuk nasi lemak.', 'Sasaran dicapai. Hilangkan diri seperti biasa.'],
        stop: ['Titik pertemuan. Beli kopi, nampak biasa-biasa.'],
        reroute: ['Laluan terjejas. Ibu pejabat hantar laluan baharu.'],
        overspeed: ['Anda menarik perhatian, ejen. Perlahan ke {limit}.'],
        rain: ['Perlindungan yang baik, tapi pandu berhati-hati.'],
        fuel: ['Bekalan sudah kritikal, ejen.'],
      },
      en: {
        lead: ['Agent, listen carefully.', 'Orders from headquarters.', 'Classified.'],
        tail: ['Tell no one.', 'The car behind you may be nobody. May be.', 'Act normal.', 'You never heard this.'],
        nowLead: ['Now, agent.', 'Now.'],
        start: ['Your mission begins now.'],
        arrive: ['Mission complete, agent. Payment will be in nasi lemak.', 'Target reached. Disappear as usual.'],
        stop: ['Rendezvous point. Buy a coffee and look ordinary.'],
        reroute: ['Route compromised. Headquarters is sending a new one.'],
        overspeed: ['You are drawing attention, agent. Slow down to {limit}.'],
        rain: ['Good cover, but drive carefully.'],
        fuel: ['Supplies are critical, agent.'],
      },
    },
  },

  adik: {
    name: { ms: 'Adik di Belakang', en: 'The Kid in the Back' },
    about: { ms: 'Dah sampai ke belum? Dah sampai ke belum?', en: 'Are we there yet? Are we there yet?' },
    voice: { pitch: 1.6, rate: 1.1 },
    lines: {
      ms: {
        lead: ['Eh, eh,', 'Tahu tak,', 'Tengok tu,'],
        tail: ['Dah sampai ke belum?', 'Lama lagi ke?', 'Nak pergi tandas.', 'Boleh singgah beli aiskrim?', 'Saya bosan.'],
        nowLead: ['Sekarang! Sekarang!', 'Sekarang!'],
        start: ['Dah sampai ke belum?'],
        arrive: ['Yeay! Dah sampai! Nak aiskrim!', 'Akhirnya! Saya dah tanya seratus kali.'],
        stop: ['Yeay berhenti! Boleh beli gula-gula?'],
        reroute: ['Eh, sesat ke? Saya tak cakap apa-apa.', 'Kita sesat eh? Best!'],
        overspeed: ['Laju sangat! Had laju {limit} tau. Saya bagi tau nanti.'],
        rain: ['Boleh main hujan?'],
        fuel: ['Kereta lapar, macam saya.'],
      },
      en: {
        lead: ['Hey, hey,', 'Guess what,', 'Look,'],
        tail: ['Are we there yet?', 'How much longer?', 'I need the toilet.', 'Can we stop for ice cream?', 'I\'m bored.'],
        nowLead: ['Now! Now!', 'Now!'],
        start: ['Are we there yet?'],
        arrive: ['Yay! We\'re here! I want ice cream!', 'Finally! I asked a hundred times.'],
        stop: ['Yay, stopping! Can I get sweets?'],
        reroute: ['Are we lost? I didn\'t say anything.', 'We\'re lost? Cool!'],
        overspeed: ['Too fast! The limit is {limit}. I\'m telling.'],
        rain: ['Can I play in the rain?'],
        fuel: ['The car is hungry, like me.'],
      },
    },
  },
};

export const CHARACTER_IDS = Object.keys(CAST);
export const characterName = (id, lang) => (CAST[id] || CAST.standard).name[lang === 'ms' ? 'ms' : 'en'];
export const characterAbout = (id, lang) => (CAST[id] || CAST.standard).about[lang === 'ms' ? 'ms' : 'en'];
export const characterVoice = (id) => (CAST[id] || CAST.standard).voice;

const last = new Map();

// A line of this kind, avoiding the one just used. Empty if there's none.
export function pick(id, key, lang, { rand = Math.random, vars = {} } = {}) {
  const lines = CAST[id]?.lines?.[lang === 'ms' ? 'ms' : 'en']?.[key];
  if (!lines?.length) return '';
  let i = Math.floor(rand() * lines.length) % lines.length;
  const memo = `${id}:${key}:${lang}`;
  if (lines.length > 1 && last.get(memo) === i) i = (i + 1) % lines.length;
  last.set(memo, i);
  return lines[i].replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const joinLead = (lead, text) => (/,$/.test(lead) ? `${lead} ${lowerFirst(text)}` : `${lead} ${text}`);

// `base` is the plain instruction. Whatever else is said, all of it stays.
export function dress(id, kind, base, lang, { rand = Math.random, vars = {} } = {}) {
  if (!CAST[id]?.lines || !base) return base;
  switch (kind) {
    // The moment of the turn: a word or two at most, sometimes.
    case 'now': {
      if (rand() > 0.35) return base;
      const lead = pick(id, 'nowLead', lang, { rand });
      return lead ? joinLead(lead, base) : base;
    }
    // Plenty of time before the turn.
    case 'far':
    case 'intro':
    case 'continue': {
      let text = base;
      if (rand() < 0.3) {
        const lead = pick(id, 'lead', lang, { rand });
        if (lead) text = joinLead(lead, text);
      }
      if (rand() < 0.55) {
        const tail = pick(id, 'tail', lang, { rand });
        if (tail) text = `${text} ${tail}`;
      }
      return text;
    }
    case 'arrive':
    case 'stop':
    case 'rain':
    case 'fuel': {
      const line = pick(id, kind, lang, { rand, vars });
      return line ? `${base} ${line}` : base;
    }
    // Their own words carry the same message.
    case 'overspeed':
    case 'reroute':
      return pick(id, kind, lang, { rand, vars }) || base;
    // Asked to say it again: just say it.
    default:
      return base;
  }
}

// A short sample, for choosing a voice.
export function sample(id, lang, base) {
  if (!CAST[id]?.lines) return base;
  const lead = pick(id, 'start', lang);
  const tail = pick(id, 'tail', lang);
  return [lead, base, tail].filter(Boolean).join(' ');
}
