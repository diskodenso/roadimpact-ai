# RoadImpact AI

Hackathon prototype — interactive Berlin road infrastructure simulator. Simulates the impact of Baustellen (construction sites), weather, time of day, and truck traffic on congestion, CO2, road wear, and accident risk across key Berlin corridors.

## Stack

- **React 19** + **Vite** (requires Node.js 20.19+)
- **React Leaflet 5** + **Leaflet** — map rendering
- **CartoDB tiles** — two map styles (light / dark Autobahn view), no API key needed
- **OSRM public API** — road snapping and routing for Baustellen, no API key needed
- **Tailwind CSS 3**

## Getting started

```bash
nvm use 20        # Node 20.19+ required, Vite 8 won't start on Node 16
npm install
npm run dev       # http://localhost:5173
```

## Project structure

```
src/
  App.jsx         # entire app — one file for now (hackathon speed)
public/
  icons.svg
  favicon.svg
```

## Key concepts

### Map views
Two tile layer styles toggled via the pill in the map header:
- **Map** — CartoDB Positron (clean light background)
- **Autobahn** — CartoDB Dark Matter (dark, roads pop)

### Baustellen (construction sites)
Placed interactively on the map with a two-click flow:
1. Select use case **"Baustellenplanung vor dem Start"**
2. Click **+ Add Baustelle** in the sidebar
3. Click on a road → snapped to nearest road via OSRM `/nearest`
4. Click a second point → route fetched via OSRM `/route`, drawn as a dashed amber polyline
5. Start/end marked with 🚧 diamond icons (Leaflet `divIcon`)

Each Baustelle has `{ id, name, start, end, routeCoords, center }`. Impact on nearby segments is calculated via `getConstructionImpactForSegment` using distance-based buckets from `site.center`.

### Simulation segments
Five hardcoded Berlin corridors in `berlinSegments` (A100, Straße des 17. Juni, etc.) with base scores for congestion, CO2, wear, and accident risk. Scores are multiplied by weather/time/traffic/construction factors and shown as colored dots on the map.

### Adding a new use case
1. Add the label to the `useCases` array
2. Add a factor block in the `segments` `useMemo`
3. Add a `combinedRisk` weight block
4. Add a recommendation string in the `recommendation` `useMemo`

## External APIs used (free, no key)

| API | Endpoint | Purpose |
|-----|----------|---------|
| OSRM demo | `/nearest/v1/driving/{lng},{lat}` | Snap click to nearest road |
| OSRM demo | `/route/v1/driving/{coords}?overview=full&geometries=geojson` | Road-following route geometry |
| CartoDB | `basemaps.cartocdn.com` | Map tiles |
| OpenStreetMap | Attribution only | Tile data source |

> OSRM demo server is rate-limited — fine for demo use, don't hammer it.
