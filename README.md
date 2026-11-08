# Pintu

A private navigation web app for a small group: a 3D map with your own vehicle on it,
place search, routes, stops along the way, fuel and charge planning, solat times, a
lane-by-lane road view and spoken
turn-by-turn directions in Bahasa Melayu and English. No accounts and no install file;
open the link and add it to the home screen.

It's plain HTML, CSS and JavaScript with no build step, so GitHub Pages can serve this
folder as it is.

## What it relies on

| Job | Service | Notes |
| --- | --- | --- |
| Map display | [MapLibre GL JS](https://maplibre.org/), loaded from a CDN | Version set in `js/config.js` |
| Map tiles | [OpenFreeMap](https://openfreemap.org/) | No key. No guarantee of uptime |
| Place search | [Photon](https://photon.komoot.io/) public server | Fair use. Heavy use is throttled |
| Routing, lane arrows and lane counts | [Stadia Maps](https://stadiamaps.com/), then the [FOSSGIS Valhalla](https://valhalla.openstreetmap.de/) public server | See below |
| Rain forecast | [Open-Meteo](https://open-meteo.com/) | Free for non-commercial use, with credit |
| Official warnings | [MET Malaysia via data.gov.my](https://developer.data.gov.my/realtime-api/weather) | 4 requests a minute |
| Pump prices | [data.gov.my fuel prices](https://data.gov.my/data-catalogue/fuelprice), through the small server | Set weekly. 4 requests a minute, so the server keeps the answer 6 hours |
| Stops along the route | The map's own tiles first, then the [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API) and Photon | See below. Results are cached for 15 minutes |
| Solat times | [Waktu Solat API](https://api.waktusolat.app/), from JAKIM e-Solat | Not run by JAKIM. If it's down, Pintu shows no times |

### Routing

Pintu tries Stadia Maps first and falls back to FOSSGIS. Stadia refuses until this
site's address is added to a free account, so FOSSGIS does the work until then.

FOSSGIS is a volunteer server. Its maintainers say it isn't meant for production
services, so treat it as a way to try Pintu, and move to Stadia for regular use:

1. Create a free account at [stadiamaps.com](https://stadiamaps.com/). Its free tier
   covers non-commercial use and needs no card.
2. In the dashboard, open **Manage Properties** and add your domain under
   **Authentication Configuration**. For this site, the subdomain is
   `ashraviinrajthinagaraj` and the domain is `github.io`.

Pintu needs no change: Stadia starts answering and is used from then on.

If both are down or busy, TomTom answers through the server's `/route`, which turns TomTom's
directions into the same shape as Valhalla's (`server/tomtom.js`): one line per leg, and each of
TomTom's turns as Valhalla's numbered kind, with street names, road numbers, exit numbers, signs,
roundabout exits, and toll and motorway stretches. Lane arrows and the speed limits Valhalla adds
aren't there, and points to pass through without stopping are left to TomTom.

### Stops

Public Overpass servers are often overloaded, so Pintu doesn't wait on them. It reads places
straight out of the map's vector tiles (`js/tiles.js`), nearest first, showing them as they
arrive. If the map shows, this works.

- The tiles only say a place of worship is one, not which kind, so a surau or mosque is
  recognised by its name. An R&R is also recognised by its name.
- Charging stations and R&Rs may be missing from the tiles, so those also ask Overpass and,
  failing that, Photon. For anything else, those two are asked only if the tiles found nothing
  or couldn't be read.
- A whole search ends within about 22 seconds whatever the network does, with what it found,
  or an offer to try again.

## Choosing where to start

The route screen has a start and a destination, either of which can be changed, or swapped.
A start can be searched for or chosen on the map. Away from a chosen start, the main button
previews the route as a simulated drive, and "drive to the start first" makes it the first stop
of a trip from where you are. Within 300 m of it, the trip starts as usual.

## Simulated drives

A simulated drive has a pause button, speeds from 1× to 30×, and a jump to the next turn or any
turn on a list. The trip line can be dragged or tapped to go anywhere, forward or back. None of
this counts as leaving the route. From 10× it's silent apart from arriving, and the lane view
is off. Ending the drive returns to the route screen with the plan unchanged.

## Voices

Settings has how much Pintu talks (full directions, or turns only) and who's talking. Each
character (`js/characters.js`) has its own lines and its own pitch and pace, in Malay and English.
They're all original. Characters from films are protected, so there are none here, but the
Trailer Voice and the Secret Agent are written in that spirit.

The instruction is never lost: it's said in full, jokes come after it where the next instruction
cuts them off, and at the moment of a turn a character says a word or two at most.

## Speed limit

Comes from the routing service with the lane counts, wherever OpenStreetMap has it. Where it
doesn't, nothing is shown rather than a guess. Over by more than 5 km/h for a few seconds, the
speed turns red and Pintu says so once.

## Speed cameras

AES and AwAS cameras come from OpenStreetMap (`highway=speed_camera`), asked for once along the
whole route when a trip starts (`js/cameras.js`). A camera counts if it's mapped within 18 m of the
route. The warning shows from 300 to 800 m ahead, depending on speed, and is said once. Only mapped
cameras are known, so no warning never means no camera.

## Traffic and TomTom

Live traffic and a few other things come from [TomTom](https://developer.tomtom.com), always through
the server so the key stays there (`server/tomtom.js`). The app side is `js/traffic.js`,
`js/traffic-map.js` and `js/tomtom.js`. Everything is free within TomTom's monthly allowances.

- **Traffic on the map.** Roads coloured by speed against normal (green, orange, red, dark red),
  drawn on the side cars drive on, plus markers for accidents, floods, broken-down vehicles,
  roadworks, lane and road closures. Tiles are asked for no closer than zoom 14 and stretched beyond,
  and the server keeps each one a minute or two, which keeps requests down. While driving only the
  slow parts are drawn. A button on the map and a switch in Settings turn it off.
- **Jams and incidents on the route.** When a trip starts, and every 3 minutes while driving, the
  rest of the route goes to TomTom as up to 1,500 points; TomTom follows it with today's traffic and
  answers with each slow stretch and what caused it. The next one within 10 km shows on the driving
  screen and the HUD, is said once about 2.5 km before, and its delay is added to the arrival time.
  Holdups under a minute aren't mentioned, but accidents, floods, breakdowns, hazards and closures
  always are.
- **A quicker way round.** The same request asks TomTom for a better route that stays on the
  current one for at least 500 m. If it saves 3 minutes and 8% of the trip or more, Pintu asks the
  route planner to pass through points along TomTom's way (so turn-by-turn still comes from
  OpenStreetMap), checks it's about as long, and offers it: "Laluan lebih cepat: jimat 12 min",
  with Tukar and Kekal. Said no once, it only asks again if the saving grows by 5 minutes. Only on
  trips with no stops still to come.
- **Route choices with traffic.** Each option shows its time with today's traffic, tagged with the
  delay or "Trafik lancar"; the quickest now is chosen unless you've already picked one. The
  chosen route's traffic is used when the trip starts.
- **Leave by, from usual traffic.** With an arrival time set, TomTom works out when to leave from
  how traffic usually is at that hour.
- **Speed limits.** Once per trip (at most three times, with new routes), TomTom's speed limits
  along the route fill in wherever OpenStreetMap has none.
- **Addresses.** Search also asks TomTom, which knows more Malaysian street addresses. When the
  search looks like an address (a number, "Jalan", "Taman" and so on), its answers come first.
- **Charging an electric car.** On a trip an electric car can't make in one go, "Rancang hentian
  cas" asks TomTom where to charge, for how long, and to what level, arriving everywhere with at
  least a tenth left. The chargers become stops on the trip. The battery size comes from the car's
  saved range and consumption; Type 2 and CCS2 plugs are assumed, at up to 100 kW.

A simulated drive asks for traffic once, at the start, and never for a quicker way. Traffic can be
switched off in Settings. Free allowances per month: about 20,000 route checks, 2,500 speed-limit
and charging plans, 20,000 address searches and 200,000 map tiles. TomTom's coverage is best on
highways and main city roads; it has accidents and roadworks, but not driver reports like Waze.

## Tolls

Each route option shows roughly how far it runs on toll roads, from the toll mark on each of
Valhalla's manoeuvres. Prices aren't shown: there's no reliable free source for Malaysia's rates,
which on PLUS depend on where you enter and leave.

## Home and work

Saved on the phone, set from the main screen or settings. With a position, each shows the journey
time and arrival clock, asked again after 5 minutes or a 500 m move.

## Home-screen shortcuts

Holding Pintu's icon on the home screen offers Rumah, Kerja, Cari, Kereta and Minyak
(`shortcuts` in `manifest.webmanifest`). Each opens `./?go=…`: straight to the route home or to work
(or to setting it, if it isn't set), the search box, where the car is, or petrol stations nearby.
Phones only pick up shortcuts when Pintu is added to the home screen again, or after Chrome
refreshes its copy of the app, which can take a day.

## Saying where to go

The microphone beside "Nak ke mana?" and in the search box uses the phone's own speech service
(`js/voice-search.js`; on Android that is Google's, in Malay or English to match Pintu). "Rumah",
"pergi kerja", "kereta saya" and "stesen minyak terdekat" (and the English for each) go straight
there; anything else is searched for without the "bawa saya ke". When choosing a stop or a start,
what you say is only ever searched for.

## Pump prices

The government sets Malaysia's pump prices every Wednesday and data.gov.my publishes them. The
server's `/fuel` passes on the newest week (`server/fuel.js`), and the phone keeps it for 12 hours
(`js/fuel-price.js`). A vehicle with no price typed in uses the official price for the fuel it
takes: RON95 BUDI95 unless RON95 at full price, RON97 or diesel is chosen. Each route choice
shows its cost, the plan says which price it used, and a price older than about two weeks says
how old it is. Electric cars need a price typed in, because charging prices differ by station.

## Monthly summary

Settings has "Ringkasan bulanan": each real drive leaves one line on the phone (`js/trips.js`):
distance, time, time below 10 km/h, the fuel cost at the price then, and the destination's name.
Simulated drives and walking aren't counted. The summary shows the month's distance, trips, a bar
for each day, driving time, time stuck, fuel cost, the longest trip and where you went most, with
the months before. Lines older than 13 months are dropped, it can be switched off, and "Padam
semua ringkasan" (two taps) deletes them.

## Sharing a trip

While driving, "Kongsi" sends a link through the phone's share sheet. Whoever opens it sees
where you are, where you're going and when you'll arrive, updated every 15 seconds, and "dah
sampai" when you get there (`js/together.js`, `server/hub.js`). It ends when you arrive or stop
it, after 30 minutes without word from your phone, or after 12 hours at most. Your name is asked
once, the first time, and can be changed in Settings.

## Road reports

The orange button while driving reports police, an accident, a hazard, a jam or a closed road
where you are (`js/road-reports.js`). Everyone else whose route passes that spot, on the same side
of the road, sees it ahead and hears it once, and just after passing is asked "masih ada?".
Reports last from 45 minutes (a jam) to 6 hours (a closed road); "masih ada" keeps one going,
and two people saying it's gone, or whoever reported it, clears it. Each phone can make 12
reports an hour.

## Driving together

"Pandu bersama kawan" in the plan starts a convoy to that destination and sends a link. Friends
who open it join with their name, get the route there, and everyone sees everyone on the map, with
how far ahead or behind each is. Up to 12 cars; it ends 12 hours after the last move.

## Morning alert

Settings → Amaran pagi: on the days and at the time you choose, a notification says how long the
drive from home to work is today and how that compares with usual (TomTom's traffic, checked by
the server's five-minute schedule). "Only when it's slower than usual" keeps quiet on normal days,
and "Hantar contoh sekarang" sends one at once. This is the one feature that keeps something
of yours on the server: your home and work, until it's switched off. The notification itself
carries nothing; the phone asks the server what to show. On an iPhone it needs Pintu on the
home screen.

## The hub

`server/hub.js` is one Durable Object with its own small SQLite database, on Cloudflare's free
plan: shared trips, reports, convoys and morning alerts. Phones send plain text and the server
checks every figure; each connection gets 120 requests a minute. Notifications go only to the
known push services (Google, Apple, Mozilla, Microsoft). The key that signs them is made by the
hub the first time and kept there. Every five minutes it sends what's due and deletes what's over.
`.github/workflows/check.yml` checks the live server by hand: Actions → Check the server.

## Battery saver

With it on, the map is drawn at 1.5 times the screen's pixels instead of 2, at 30 frames a second
instead of 60, and without 3D buildings (`js/battery.js`). Directions, voice and GPS don't change.
"Auto", the default, turns it on when the phone says its battery is at 20% or less and not
charging; iPhones don't say, so there it only comes on when set to "Hidup".

## Parking

Car parks within 500 m of the destination come from the map's own tiles (`js/parking.js`).
Choosing one ends the drive there, and the walk to the door picks up from it.

## Leaving on time

Pick an arrival time in the plan and Pintu works out when to leave (`js/leaveby.js`), from the
route's time without live traffic.

## Junction views

Before a highway exit, ramp or fork (manoeuvre types 17 to 24), a picture shows the branch to take,
its exit number and signs, and how close it is: from 1.5 km on highways and 500 m elsewhere
(`js/junction.js`).

## Where's my car

When a real drive ends, Pintu remembers where (with an optional note, like a level or pillar),
shows it on the main screen and the map, and offers a walking route back. Tapping your own position
saves it by hand. Starting a drive within 300 m of it, or walking to it, forgets it. Kept for a week.

## Places on the map, and nearby

Tapping a named place on the map opens a card with what it is and how far, and a way to go there
(`_placeTap` in `js/map.js`, words from `js/kinds.js`). The chips at the top find places to visit,
food, petrol, EV charging and hotels near you, or near the middle of the map without a position:
from the map's tiles within 2.5 km, and from Overpass further out when there are fewer than eight
(`js/nearby.js`).

## Rain and floods

- **Rain:** the Open-Meteo forecast at each point along the route, at the time you'd get there.
- **Official warnings:** MET Malaysia's, through data.gov.my, kept if they name a state the route
  passes through. Continuous rain warnings are the ones that come with a flood risk.
- **Rivers and closed roads:** one tap to JPS Public Infobanjir and JKR Bencana. Neither offers
  data a page can read, and the old data.gov.my flood endpoint was reported to have stopped
  updating in 2024, so Pintu doesn't show live river levels itself.

These are forecasts and area warnings, not road conditions, so Pintu never says a road is safe. A
failed check says it failed.

## HUD mode

A black screen with the next turn, the distance and your speed, flipped top to bottom. Lay the phone
flat on the dashboard and it reads correctly in the windscreen. It works best at night, on full
brightness. Tap the screen to turn the mirror off, pick a colour (white, green, light blue or yellow)
or leave.

It also shows:

- **Lanes** before a turn or exit, with the lane to be in lit and underlined.
- **A toll plaza ahead**, within 2 km, so there's time to get the Touch 'n Go card ready. Plazas
  come from OpenStreetMap, so only mapped ones are known, and they're only looked for on routes
  with tolls.
- **A break reminder** after two hours at the wheel. Driving time carries on into the next trip
  unless there's been a stop of 15 minutes or more.
- **Traffic ahead**, the same as on the driving screen: what it is, how far, and the minutes it adds.

Held upright, there's only room for one of these: a toll plaza first, then traffic, then the break.

## Sharing a location

Search takes Google Maps, Waze, Apple Maps and OpenStreetMap links, whole messages with a link in
them, and coordinates. On Android, once installed, Pintu can also be chosen from the share menu.
Opening `?to=3.15,101.71&name=Rumah` goes straight to a place.

Short links such as `maps.app.goo.gl` only say where they lead when followed, and a web page isn't
allowed to do that, so they go through the small server below.

## Walking to the door

The arrival screen offers walking directions to the destination, and Walk is a mode of its own. On
foot the instructions come closer to each turn, and GPS is allowed to wander more before it counts
as leaving the route.

### Malls

Pintu can't guide you inside a building. GPS is unreliable indoors, and a web page can't use the
Wi-Fi or Bluetooth signals that indoor positioning needs. So for a mall listed in `js/malls.js`, it
opens the mall's own interactive map and shop list, and with the server running it can search the
shop list for a lot number.

## The small server

`server/worker.js` runs on Cloudflare Workers (the free plan is plenty). It resolves short map links,
passes on MET warnings if the browser can't get them directly, passes on this week's pump prices,
and reads a mall's shop list. It only
answers this site, and only ever contacts the sites named in the file.

It's live at `https://pintu.ashraviinrajthinagaraj.workers.dev`, set as `server` in `js/config.js`. To
change it, push to `main`: `.github/workflows/server.yml` deploys it using a repository secret called
`CLOUDFLARE_API_TOKEN` and the settings in `wrangler.toml`, whose `name` must match the Worker's name.
Secrets set in the Cloudflare dashboard stay as they are.

### Traffic key

The TomTom key is a Worker secret called `TOMTOM_API_KEY`: sign up free at
[my.tomtom.com](https://my.tomtom.com) (no card), and copy "My first API key" from API & SDK Keys.
Opening `https://pintu.ashraviinrajthinagaraj.workers.dev/traffic?check=1` in a browser says whether
it works. Without a key, Pintu simply shows no traffic.

### Human voices

Switched off for now with `humanVoices: false` in `js/config.js`: Google's free allowance ran out within a
single drive. Everything below still works if it's switched back on.

Characters speak through the server's `/speak`, using one of two services:

- [Gemini](https://ai.google.dev/gemini-api/docs/speech-generation): the key is a Worker secret called
  `GEMINI_API_KEY`, made at [AI Studio](https://aistudio.google.com/apikey). No card is needed. Each
  character gets a voice designed with their accent the first time they speak. People report the free
  tier allows about 100 lines a day per model, resetting at midnight Pacific time, and Google may use
  what's sent to improve its products. Its terms require users to be 18 or over.
- [Azure Speech](https://azure.microsoft.com/products/ai-services/ai-speech): the secret is
  `AZURE_SPEECH_KEY`, from a Speech resource on the Free F0 tier in Southeast Asia (or set
  `AZURE_SPEECH_REGION`). It allows 500,000 characters a month but needs a card to sign up.

With both, Gemini goes first and Azure takes over when its allowance runs out.

Without a key, or with no signal, Pintu uses the phone's own voice. A direction never waits long for a
recording (`WAIT_TURN_MS` in `js/voice.js`), and the next ones are fetched early and kept on the phone.

Each character's voices are `ACTORS` (Gemini) and `SPEAKERS` (Azure) in `server/worker.js`. Lines in
`js/cast/` carry delivery marks like `[tease]`, with `…` for a pause. A whole line is one recording, so
it flows naturally, with each part of it directed separately.
Change `SPEECH_VERSION` in both `server/worker.js` and `js/voice.js` if a voice changes, so old
recordings aren't reused.

## The lane view

When the road has lanes mapped, Pintu draws them on the map in 3D: road surface, dividers,
painted arrows, a stop line, and a blue carpet leading into the lane you want.

- Lane arrows at a junction come with the route (Valhalla's `turn_lanes`). These decide the
  recommended lane, and are the only source for spoken lane advice.
- Lane counts come from a separate request for the road ahead (`trace_attributes`). With a
  count but no arrows, a turn uses the matching side: right turns from the right, left
  from the left. That's an estimate for a keep-left country, not mapped data.
- A phone's GPS isn't accurate enough to tell lanes apart. **The car on the map shows the
  lane to be in, not the lane you're in**, and the app says so the first time it appears.

The vehicles are general body shapes built in code (`js/car-mesh.js`), not models of any
real car, so there's nothing to download or license.

## Car figures

The models in the "my car" panel are starting points, not measurements of anyone's car.

- Petrol use: [WapCar](https://wapcar.my/news/bezza-more-fuelefficient-than-axia-top-5-most-efficient-cars-under-rm-100k-35618)
  for the Axia, City, Vios and Almera. The Myvi is the middle of the real-world estimates on
  [Mudah](https://www.mudah.my/malaysia/cars-for-sale/perodua/myvi/fuel-consumption).
- Electric range: WLTP figures from [paultan.org](https://paultan.org/2026/06/11/2026-proton-emas-7-premium-plus-launched-with-68-39-kwh-battery-115-kw-dc-450-km-wltp-rm119k-otr/)
  and [Motorist](https://www.motorist.my/article/6007/proton-e-mas-5-vs-byd-atto-3-2026-which-ev-should-you-buy-in-malaysia).
  Energy use is battery size divided by that range.

## No signal

When a trip starts, Pintu quietly fetches the map along the route, three pieces at a time, and
the app's offline store keeps them (`js/offline.js`): zoom 14 within 350 m of the road, 12 within
1.5 km, and 10 within 6 km, at most 900 pieces, nearest first. A long trip is about 5 to 20 MB,
once; pieces already kept cost nothing. It waits a few seconds so the first directions come first,
gives up quietly after a run of failures, skips simulated drives and Data Saver, and can be turned
off in Settings. The offline store keeps up to 4,000 pieces.

## Losing the route in the city

Among tall buildings and where roads run over and under each other, GPS often puts you beside the
route. If you're still heading the same way (within 25°) and within 120 m of it, Pintu waits 15
seconds rather than 6 before deciding you've left it (`js/guidance.js`).

## Reports

Settings has "Laporkan masalah": it puts together the app version, the phone and browser, screen,
settings, location permission, TomTom use, which route server answered, the last 20 errors the app
hit, and a note, and opens the phone's share sheet (or copies it). Nothing is sent by itself.

The last real drive is kept on the phone (`js/report.js`): every GPS reading, plus events such as
reroutes, quicker ways and leaving the app, replaced by the next drive. It can be attached to a
report as `pintu-drive.txt` (JSON inside, since phones only share text files), so a fault can be replayed exactly. Keeping it can be turned off,
which deletes it.

## Fair use of TomTom

The TomTom allowance is shared by everyone using Pintu. The server allows each connection 40
requests and 400 map tiles a minute (`PER_MINUTE` in `server/tomtom.js`), and uses a Cloudflare
rate limiting binding called `TOMTOM_LIMITER` too if one is set up. Each phone stops asking for the
day after 500 requests (`js/usage.js`), and Settings shows how many it has made today and this
month. TomTom's own dashboard at [my.tomtom.com](https://my.tomtom.com) shows the total. With no
card on the TomTom account, running out costs nothing: TomTom simply stops answering until the
next month, and Pintu carries on without traffic.

## Limits

- Guidance stops when the phone locks or another app is on screen, because browsers don't give
  web pages your location then. Pintu says so once a trip, and picks the trip back up when you
  return. Only a proper app could keep going.
- Map, road names, search, stops and lane data are only as good as OpenStreetMap's.
- Fuel and range figures are estimates from what you enter. Costs use the official pump price,
  which is what most stations charge, or the price you type in.
- Voice search needs the internet and the phone's speech service.
- A shared trip or a convoy only updates while Pintu is on screen, for the same reason.
- Voice depends on the voices installed on each phone.

## Tests

```
node --test tests/*.test.js   # navigation logic, routing and search
node tests/e2e/run.js         # the whole app in a browser, needs Playwright
MAPLIBRE_DIR=/path node tests/e2e/real-map.js   # the same on the real map library
```

`run.js` uses stand-ins for the map library and services. `real-map.js` uses the real
library and real style files from a local folder, with stand-in map data and services.
Neither talks to the real servers.

Fonts are [Barlow](https://github.com/jpt/barlow), under the licence in `fonts/OFL.txt`.
