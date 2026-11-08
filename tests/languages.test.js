// Chinese and Tamil: directions, numbers, voices and voice search.
import test from 'node:test';
import assert from 'node:assert/strict';
import { describe as describeTurn, laneAdvice, speech } from '../js/instructions.js';
import { fmtClock, fmtDuration, sayDistance, sayDuration } from '../js/format.js';
import { kindLabel } from '../js/kinds.js';
import { dress, pick, sample } from '../js/characters.js';
import { chooseVoice } from '../js/voice.js';
import { understand } from '../js/voice-search.js';
import { commuteMessage } from '../server/hub.js';
import { prepareTrip } from '../js/routing.js';
import { cityTrip } from './helpers/fixtures.js';
import { STRINGS_FOR_TEST as STRINGS } from '../js/i18n.js';

const route = prepareTrip(cityTrip());

test('directions are spoken in Chinese and Tamil', () => {
  assert.equal(speech({ kind: 'far', index: 1, distance: 500 }, route.maneuvers, 'zh'), '500米后，右转，进入 Jalan Tun Razak。');
  assert.equal(speech({ kind: 'now', index: 1, distance: 20, thenIndex: 2 }, route.maneuvers, 'zh'), '右转，进入 Jalan Tun Razak，然后左转。');
  assert.equal(speech({ kind: 'arrive', index: 2 }, route.maneuvers, 'zh'), '您已到达目的地。');
  assert.equal(speech({ kind: 'far', index: 1, distance: 500 }, route.maneuvers, 'ta'), '500 மீட்டர் தூரத்தில், Jalan Tun Razak-இல் வலதுபுறம் திரும்புங்கள்.');
  assert.equal(speech({ kind: 'continue', index: 1, distance: 2000 }, route.maneuvers, 'ta'), '2 கிலோமீட்டர் நேராகச் செல்லுங்கள்.');
  assert.equal(describeTurn({ type: 26, roundabout_exit_count: 2 }, 'zh').action, '在圆环，走第二个出口');
  assert.equal(describeTurn({ type: 26, roundabout_exit_count: 3 }, 'ta').action, 'சுற்றுவட்டத்தில், மூன்றாவது வெளியேறும் வழியை எடுங்கள்');
  // Malay and English are as they were.
  assert.equal(speech({ kind: 'far', index: 1, distance: 500 }, route.maneuvers, 'ms'), 'Dalam 500 meter, belok kanan ke Jalan Tun Razak.');
  assert.equal(speech({ kind: 'far', index: 1, distance: 500 }, route.maneuvers, 'en'), 'In 500 metres, turn right onto Jalan Tun Razak.');
});

test('lanes are said in Chinese and Tamil', () => {
  const lanes = [{ directions: 8, active: 8 }, { directions: 2 }, { directions: 2 }];
  assert.equal(laneAdvice(lanes, 'zh'), '走最左边的车道。');
  assert.equal(laneAdvice(lanes, 'ta'), 'மிக இடது வழித்தடத்தைப் பயன்படுத்துங்கள்.');
});

test('distances, times and clocks in each language', () => {
  assert.equal(sayDistance(300, 'zh'), '300米');
  assert.equal(sayDistance(2500, 'zh'), '2.5公里');
  assert.equal(sayDistance(300, 'ta'), '300 மீட்டர்');
  assert.equal(fmtDuration(65 * 60, 'zh'), '1 小时 5 分钟');
  assert.equal(fmtDuration(20 * 60, 'ta'), '20 நிமி');
  assert.equal(sayDuration(65 * 60, 'zh'), '1小时5分钟');
  assert.equal(sayDuration(65 * 60, 'ta'), '1 மணி நேரம் 5 நிமிடம்');
  assert.equal(fmtDuration(65 * 60, 'en'), '1 hr 5 min');
  assert.match(fmtClock(new Date(2026, 10, 9, 8, 5), 'zh'), /上午\s?8:05/);
});

test('places are named in each language', () => {
  assert.equal(kindLabel('fuel', 'zh'), '油站');
  assert.equal(kindLabel('restaurant', 'ta'), 'உணவகம்');
  assert.equal(kindLabel('something_odd', 'zh'), '', 'no English left in a Chinese line');
});

test('the characters joke in Malay and English only; otherwise Pintu speaks plainly', () => {
  assert.equal(pick('uncle', 'tail', 'zh'), '');
  assert.equal(dress('uncle', 'far', '500米后，右转。', 'zh', { rand: () => 0 }), '500米后，右转。');
  assert.equal(dress('uncle', 'jam', '', 'ta', { rand: () => 0 }), '');
  assert.equal(sample('uncle', 'ta', 'மாதிரி'), 'மாதிரி');
  assert.notEqual(pick('uncle', 'tail', 'ms', { rand: () => 0 }), '');
});

test('the phone\'s Chinese or Tamil voice, or the right language tag without one', () => {
  const list = [{ lang: 'en-US', name: 'E' }, { lang: 'zh-CN', name: 'Z' }, { lang: 'zh-TW', name: 'T' }, { lang: 'ta-IN', name: 'Ta' }];
  assert.deepEqual(chooseVoice(list, 'zh'), { voice: list[1], tag: 'zh-CN', match: 'exact' });
  assert.equal(chooseVoice([list[2]], 'zh').match, 'near');
  assert.deepEqual(chooseVoice(list, 'ta'), { voice: list[3], tag: 'ta-IN', match: 'exact' });
  assert.deepEqual(chooseVoice([list[0]], 'ta'), { voice: null, tag: 'ta-IN', match: 'none' });
});

test('voice search understands Chinese and Tamil', () => {
  assert.deepEqual(understand('回家'), { kind: 'saved', which: 'home' });
  assert.deepEqual(understand('带我去公司'), { kind: 'saved', which: 'work' });
  assert.deepEqual(understand('最近的油站'), { kind: 'nearby', category: 'fuel' });
  assert.deepEqual(understand('我的车在哪里'), { kind: 'car' });
  assert.deepEqual(understand('去双子塔'), { kind: 'search', query: '双子塔', nearest: false });
  assert.deepEqual(understand('வீட்டுக்கு போ'), { kind: 'saved', which: 'home' });
  assert.deepEqual(understand('வேலைக்கு'), { kind: 'saved', which: 'work' });
  assert.deepEqual(understand('அருகிலுள்ள பெட்ரோல் நிலையம்'), { kind: 'nearby', category: 'fuel' });
  assert.equal(understand('KLCC போ').query, 'KLCC');
});

test('the morning alert comes in each language', () => {
  const now = Date.parse('2026-11-09T00:00:00Z');
  const zh = commuteMessage({ travel: 2700, usual: 1800 }, now, 'zh');
  assert.equal(zh.title, '去公司：45 分钟');
  assert.equal(zh.body, '比平常慢 15 分钟。现在出发，大约 上午8:45 到达。');
  const ta = commuteMessage({ travel: 1800, usual: 1800 }, now, 'ta');
  assert.equal(ta.title, 'வேலைக்கு: 30 நிமி');
  assert.equal(ta.body, 'வழக்கம் போலவே. இப்போது புறப்பட்டால் சுமார் காலை 8:30 மணிக்குச் சேர்வீர்கள்.');
});

test('every screen word exists in Chinese and Tamil, and none was left in English', () => {
  const same = (l) => Object.keys(STRINGS.en).filter((k) => STRINGS[l][k] === STRINGS.en[k] && /[a-z]{4,}/.test(STRINGS.en[k]) && !/^(RON|SUV|MPV|R&R|HUD|km\/h|Auto|\{|\+)/.test(STRINGS.en[k]));
  assert.deepEqual(same('zh'), []);
  assert.deepEqual(same('ta'), []);
});
