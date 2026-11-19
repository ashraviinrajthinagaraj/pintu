// What Transitous answers for a trip, cut down from a real one: KL Sentral to
// Suria KLCC, walking to the station, the Kelana Jaya Line, then a walk.
import { encodePolyline } from '../../js/geo.js';

const line = (coords) => ({ points: encodePolyline(coords, 6), precision: 6, length: coords.length });
const at = (base, min) => new Date(Date.parse(base) + min * 60000).toISOString().replace('.000', '');

export function klTrip(base = '2026-11-20T00:32:00Z', { live = false, late = 0 } = {}) {
  return {
    duration: 18 * 60 + late * 60,
    startTime: at(base, 0),
    endTime: at(base, 18 + late),
    transfers: 0,
    legs: [
      {
        mode: 'WALK', duration: 60, distance: 84.3, startTime: at(base, 0), endTime: at(base, 1),
        from: { name: 'START', lat: 3.1336, lon: 101.6862, departure: at(base, 0), vertexType: 'NORMAL' },
        to: { name: 'KL SENTRAL - REDONE', stopId: 'rail-kl_KJ15', lat: 3.13442, lon: 101.68625, arrival: at(base, 1), vertexType: 'TRANSIT' },
        legGeometry: line([[101.6862, 3.1336], [101.68625, 3.13442]]),
      },
      {
        mode: 'SUBWAY', duration: 13 * 60, startTime: at(base, 1 + late), endTime: at(base, 14 + late),
        scheduledStartTime: at(base, 1), scheduledEndTime: at(base, 14), realTime: live, scheduled: true,
        headsign: 'From Putra Heights to Gombak', tripTo: { name: 'GOMBAK', lat: 3.2316, lon: 101.7243 },
        routeColor: 'd50032', routeTextColor: 'ffffff', routeType: 1, agencyName: 'rapidrail', routeShortName: 'KJL',
        routeLongName: 'LRT KELANA JAYA LINE', displayName: 'KJL', tripId: 'x', cancelled: false, source: 'rail-kl/stop_times.txt:1',
        from: { name: 'KL SENTRAL - REDONE', stopId: 'rail-kl_KJ15', lat: 3.13442, lon: 101.68625, departure: at(base, 1 + late), scheduledDeparture: at(base, 1), track: '2' },
        to: { name: 'KLCC', stopId: 'rail-kl_KJ10', lat: 3.15894, lon: 101.71362, arrival: at(base, 14 + late), scheduledArrival: at(base, 14) },
        intermediateStops: [
          { name: 'PASAR SENI', lat: 3.1424, lon: 101.6955, arrival: at(base, 4) },
          { name: 'MASJID JAMEK', lat: 3.1494, lon: 101.6964, arrival: at(base, 6) },
          { name: 'DANG WANGI', lat: 3.1568, lon: 101.7016, arrival: at(base, 9) },
          { name: 'KAMPUNG BARU', lat: 3.1614, lon: 101.7067, arrival: at(base, 11) },
        ],
        legGeometry: line([[101.68625, 3.13442], [101.6955, 3.1424], [101.6964, 3.1494], [101.7016, 3.1568], [101.7067, 3.1614], [101.71362, 3.15894]]),
      },
      {
        mode: 'WALK', duration: 240, distance: 310.5, startTime: at(base, 14 + late), endTime: at(base, 18 + late),
        from: { name: 'KLCC', lat: 3.15894, lon: 101.71362, departure: at(base, 14 + late) },
        to: { name: 'END', lat: 3.1579, lon: 101.7123, arrival: at(base, 18 + late) },
        legGeometry: line([[101.71362, 3.15894], [101.7130, 3.1584], [101.7123, 3.1579]]),
      },
    ],
  };
}

// A bus first: Petaling Jaya, Rapid KL's PJ05 to the LRT, with no colour of its own given.
export function pjTrip(base = '2026-11-20T00:47:00Z') {
  return {
    duration: 37 * 60, startTime: at(base, 0), endTime: at(base, 37), transfers: 1,
    legs: [
      { mode: 'WALK', duration: 420, distance: 520, startTime: at(base, 0), endTime: at(base, 7), from: { name: 'START', lat: 3.1186, lon: 101.6224 }, to: { name: 'PJ347 KOMERSIAL SS2 (POH KONG)', lat: 3.1201, lon: 101.6200 }, legGeometry: line([[101.6224, 3.1186], [101.62, 3.1201]]) },
      { mode: 'BUS', duration: 120, startTime: at(base, 7), endTime: at(base, 9), scheduledStartTime: at(base, 7), scheduledEndTime: at(base, 9), realTime: false, routeShortName: 'PJ05', routeColor: '', agencyName: 'Rapid KL', tripTo: { name: 'LRT Taman Bahagia' }, from: { name: 'PJ347 KOMERSIAL SS2 (POH KONG)', lat: 3.1201, lon: 101.62, departure: at(base, 7) }, to: { name: 'PJ343 LRT TAMAN BAHAGIA', lat: 3.1077, lon: 101.6127, arrival: at(base, 9) }, intermediateStops: [{ name: 'PJ345 SS2/24', arrival: at(base, 8) }], legGeometry: line([[101.62, 3.1201], [101.6127, 3.1077]]) },
      { mode: 'WALK', duration: 120, distance: 90, startTime: at(base, 9), endTime: at(base, 11), from: { name: 'PJ343 LRT TAMAN BAHAGIA', lat: 3.1077, lon: 101.6127 }, to: { name: 'TAMAN BAHAGIA', lat: 3.1076, lon: 101.6122 }, legGeometry: line([[101.6127, 3.1077], [101.6122, 3.1076]]) },
      { mode: 'SUBWAY', duration: 660, startTime: at(base, 13), endTime: at(base, 24), scheduledStartTime: at(base, 13), scheduledEndTime: at(base, 24), routeShortName: 'KJL', routeColor: 'd50032', agencyName: 'rapidrail', tripTo: { name: 'GOMBAK' }, from: { name: 'TAMAN BAHAGIA', lat: 3.1076, lon: 101.6122, departure: at(base, 13) }, to: { name: 'UNIVERSITI', lat: 3.1146, lon: 101.6618, arrival: at(base, 24) }, intermediateStops: [{ name: 'TAMAN PARAMOUNT' }, { name: 'ASIA JAYA' }, { name: 'TAMAN JAYA' }], legGeometry: line([[101.6122, 3.1076], [101.6618, 3.1146]]) },
      { mode: 'WALK', duration: 780, distance: 1040, startTime: at(base, 24), endTime: at(base, 37), from: { name: 'UNIVERSITI', lat: 3.1146, lon: 101.6618 }, to: { name: 'END', lat: 3.1105, lon: 101.6656 }, legGeometry: line([[101.6618, 3.1146], [101.6656, 3.1105]]) },
    ],
  };
}

export function plan(itineraries = [klTrip()], extra = {}) {
  return {
    requestParameters: {}, debugOutput: {},
    from: { name: 'START', lat: 3.1336, lon: 101.6862 }, to: { name: 'END', lat: 3.1579, lon: 101.7123 },
    direct: [], itineraries,
    previousPageCursor: 'EARLIER|1795134720', nextPageCursor: 'LATER|1795136520',
    ...extra,
  };
}
