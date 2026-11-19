# Data kept with the app

`states.json`: Malaysia's 16 states and federal territories, simplified (to about a fifth of the
points, small islands dropped) from the [geoBoundaries](https://www.geoboundaries.org/) Malaysia
ADM1 release, which is drawn from OpenStreetMap.

© OpenStreetMap contributors. Available under the
[Open Database License](https://opendatacommons.org/licenses/odbl/1-0/); see
<https://www.openstreetmap.org/copyright>. This simplified copy is offered under the same licence.
Each state keeps only its name.

`along.json`: every toll plaza booth, toll gantry, speed camera, R&R and lay-by in Malaysia that
OpenStreetMap has, as short lists (`[id, lat, lng, …]`, the id's first letter for node, way or
relation). Rebuilt every Monday by `scripts/along-data.mjs` through
`.github/workflows/along-data.yml`. © OpenStreetMap contributors, under the same licence.

`wildlife.json`: the roads where wild elephants are known to cross, named in public reports (each
zone lists its sources), as lines along each road found by the public routing server (FOSSGIS
Valhalla) between the two towns, by `scripts/wildlife-data.mjs`. The lines are © OpenStreetMap
contributors, under the same licence.
