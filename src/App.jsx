import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Popup,
  CircleMarker,
  Marker,
  Polyline,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

const MAP_LAYERS = {
  normal: {
    label: "Map",
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  autobahn: {
    label: "Autobahn",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
};

const baustelleIcon = L.divIcon({
  className: "",
  html: `<div style="width:36px;height:36px;background:#f59e0b;border:3px solid #92400e;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:17px;box-shadow:0 2px 8px rgba(0,0,0,0.4);transform:rotate(45deg)"><span style="transform:rotate(-45deg);display:block;line-height:1">🚧</span></div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});

const pendingIcon = L.divIcon({
  className: "",
  html: `<div style="width:30px;height:30px;background:#fde68a;border:2px dashed #92400e;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:14px;opacity:0.75;transform:rotate(45deg)"><span style="transform:rotate(-45deg);display:block;line-height:1">📍</span></div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

async function snapToRoad(lat, lng) {
  const res = await fetch(`https://router.project-osrm.org/nearest/v1/driving/${lng},${lat}`);
  const data = await res.json();
  const [snappedLng, snappedLat] = data.waypoints[0].location;
  return [snappedLat, snappedLng];
}

async function fetchRoute(start, end) {
  const res = await fetch(
    `https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson`
  );
  const data = await res.json();
  return data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
}

const berlinSegments = [
  { id: 1, name: "A100 / Funkturm Corridor", type: "Motorway", coords: [[52.5038,13.2788],[52.5058,13.2848],[52.5068,13.2916],[52.5063,13.299],[52.5052,13.3055]], center: [52.5058,13.29], baseCongestion: 78, baseCo2: 82, baseWear: 74, baseAccidentRisk: 61, weight: 1.15 },
  { id: 2, name: "Straße des 17. Juni", type: "Urban arterial", coords: [[52.5127,13.322],[52.5134,13.336],[52.5146,13.3502],[52.5153,13.362],[52.5163,13.3777]], center: [52.5146,13.35], baseCongestion: 58, baseCo2: 56, baseWear: 47, baseAccidentRisk: 49, weight: 0.95 },
  { id: 3, name: "Tiergarten Tunnel / Potsdamer Platz Link", type: "Critical connector", coords: [[52.5146,13.3502],[52.5133,13.358],[52.5118,13.366],[52.51,13.372],[52.5095,13.3763]], center: [52.512,13.363], baseCongestion: 64, baseCo2: 62, baseWear: 52, baseAccidentRisk: 58, weight: 1.0 },
  { id: 4, name: "Invalidenstraße / Hauptbahnhof Corridor", type: "Urban connector", coords: [[52.5272,13.3508],[52.5276,13.363],[52.5274,13.3694],[52.5269,13.382],[52.5261,13.3945]], center: [52.5274,13.3694], baseCongestion: 54, baseCo2: 51, baseWear: 43, baseAccidentRisk: 46, weight: 0.9 },
  { id: 5, name: "Spree Bridge Segment", type: "Bridge", coords: [[52.5261,13.368],[52.5252,13.3692],[52.5243,13.3708],[52.5233,13.372]], center: [52.5248,13.37], baseCongestion: 49, baseCo2: 53, baseWear: 77, baseAccidentRisk: 44, weight: 1.2 },
];

const useCases = ["Baustellenplanung vor dem Start", "CO2 Berechnung", "Unfallrisikoreduktion", "Frühwarnsystem"];
const weatherFactors = { Klar: 1, Regen: 1.12, Frost: 1.22 };
const timeFactors = { Morgen: 1.18, Mittag: 1.0, Abend: 1.22, Nacht: 0.72 };

const vehicleProfiles = [
  { id: "pkw", label: "PKW", kind: "car", minCount: 0, maxCount: 20000, countStep: 100, minWeight: 1, maxWeight: 3, weightStep: 0.1, defaultCount: 7000, defaultWeight: 1.6, congestionFactor: 1, emissionFactor: 0.9, wearFactor: 0.35, riskFactor: 0.92 },
  { id: "suv", label: "SUV", kind: "suv", minCount: 0, maxCount: 12000, countStep: 50, minWeight: 1.4, maxWeight: 4, weightStep: 0.1, defaultCount: 1800, defaultWeight: 2.1, congestionFactor: 1.05, emissionFactor: 1.05, wearFactor: 0.5, riskFactor: 0.97 },
  { id: "transporter", label: "Transporter", kind: "van", minCount: 0, maxCount: 8000, countStep: 50, minWeight: 1.8, maxWeight: 7.5, weightStep: 0.1, defaultCount: 700, defaultWeight: 3.2, congestionFactor: 1.1, emissionFactor: 1.18, wearFactor: 0.7, riskFactor: 1.02 },
  { id: "lkw", label: "LKW", kind: "truck", minCount: 0, maxCount: 6000, countStep: 50, minWeight: 8, maxWeight: 40, weightStep: 1, defaultCount: 1250, defaultWeight: 18, congestionFactor: 1.2, emissionFactor: 1.55, wearFactor: 1.9, riskFactor: 1.12 },
];

const METRIC_TOOLTIPS = {
  "Baustellenplanung vor dem Start": {
    fahrzeit: "Durch aktive Sperrungen entstehen Verzögerungen – jede Vollsperrung erhöht die Gesamtfahrzeit durch Stau und Umwege.",
    kosten: "Umfasst Kraftstoff, Maut und Zeitverluste. Vollsperrungen treiben Umwegkosten besonders stark in die Höhe.",
    co2: "Stop-and-Go und Umwege rund um Baustellen erhöhen den CO₂-Ausstoß gegenüber ungehinderter Fahrt.",
    umleitungen: "Anteil der Fahrzeuge, die wegen Vollsperrungen auf alternative Routen ausweichen müssen.",
    kosten_detail: "Kraftstoffkosten steigen durch Umwege und Stau. Mautkosten bleiben weitgehend konstant. Zeitkosten spiegeln Produktivitätsverlust wider.",
    co2_quelle: "Stauphasen erhöhen den Anteil durch häufige Brems-/Beschleunigungszyklen. Umwege erhöhen den Fahrtenanteil.",
  },
  "CO2 Berechnung": {
    fahrzeit: "Längere Fahrzeiten bedeuten mehr Kraftstoffverbrauch – dient als Basis für die CO₂-Hochrechnung.",
    kosten: "Beinhaltet Kraftstoffkosten nach aktuellem Preis und den externen CO₂-Kostensatz (€/t CO₂).",
    co2: "Berechnet aus Fahrzeugmix, Emissionsklasse und Verkehrsprognose. Euro-6d-Fahrzeuge emittieren ~12% weniger als Euro 6.",
    umleitungen: "Umleitungsfahrten erzeugen Mehremissionen durch längere Strecken und häufige Brems-/Beschleunigungszyklen.",
    kosten_detail: "Kraftstoffkosten skalieren mit dem eingestellten Treibstoffpreis. Der CO₂-Preis (€/t) fließt als externer Kostensatz ein.",
    co2_quelle: "Kaltstartanteil erhöht sich bei kurzen Strecken. Stauanteil wächst mit Verkehrsdichte und Sperrungen.",
  },
  "Unfallrisikoreduktion": {
    fahrzeit: "Tempolimits erhöhen Fahrzeiten leicht, reduzieren aber das Unfallrisiko deutlich – besonders bei schlechten Sichtverhältnissen.",
    kosten: "Berechnet mit Unfallfolgekosten (Schäden, Einsatzkräfte). Tempo 30 spart langfristig bis zu 40% dieser Kosten.",
    co2: "Geringere Geschwindigkeit senkt bei konstanter Fahrt die Emissionen, Stau-Effekte können dies teilweise kompensieren.",
    umleitungen: "Unfallsperrungen erzwingen spontane Umleitungen – häufiger bei schlechtem Straßenzustand oder fehlenden Markierungen.",
    kosten_detail: "Unfallkosten werden anteilig eingerechnet. Straßenzustand und Markierungen beeinflussen die Häufigkeit.",
    co2_quelle: "Geringere Tempolimits verändern das Fahrmuster – weniger aggressive Beschleunigung, dafür mehr Rollverhalten.",
  },
  "Frühwarnsystem": {
    fahrzeit: "Prognose der Fahrzeitverlängerung über den gewählten Zeitraum. Das Belastungsmodell bestimmt das Wachstumstempo.",
    kosten: "Hochrechnung der Kosten bei unveränderter Infrastruktur. Frühzeitige Sanierung reduziert diese Zahl erheblich.",
    co2: "CO₂-Projektion bei prognostiziertem Verkehrswachstum – exponentielles Modell zeigt besonders starkes Wachstum.",
    umleitungen: "Prognostizierter Anteil von Umleitungen bei erwarteter Infrastrukturüberlastung ohne präventiven Eingriff.",
    kosten_detail: "Kostensteigerung folgt dem gewählten Wachstumsmodell. Exponentielles Modell zeigt den worst case.",
    co2_quelle: "Bei wachsendem Verkehr verschieben sich die Anteile – Stau wird zum dominanten Emissionstreiber.",
  },
};

function getRiskColor(score) {
  if (score >= 85) return "#dc2626";
  if (score >= 70) return "#f97316";
  if (score >= 55) return "#eab308";
  return "#22c55e";
}

function getRiskLabel(score) {
  if (score >= 85) return "Critical";
  if (score >= 70) return "High";
  if (score >= 55) return "Medium";
  return "Low";
}

function badgeClass(label) {
  if (label === "Critical") return "bg-red-100 text-red-700 border-red-200";
  if (label === "High") return "bg-orange-100 text-orange-700 border-orange-200";
  if (label === "Medium") return "bg-yellow-100 text-yellow-700 border-yellow-200";
  return "bg-green-100 text-green-700 border-green-200";
}

function distanceInDegrees(a, b) {
  return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2);
}

function formatNumberDe(value) {
  return new Intl.NumberFormat("de-DE").format(value);
}

function formatWeightDe(value) {
  return new Intl.NumberFormat("de-DE", { minimumFractionDigits: value % 1 === 0 ? 0 : 1, maximumFractionDigits: 1 }).format(value);
}

function simTimeToTimeOfDay(mins) {
  const h = 6 + mins / 60;
  if (h < 9) return "Morgen";
  if (h < 14) return "Mittag";
  if (h < 19) return "Abend";
  return "Nacht";
}

function formatSimTime(mins) {
  const h = 6 + Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function interpolatePosition(path, progress) {
  if (!path || path.length < 2) return [52.516, 13.375];
  const n = path.length - 1;
  const sp = Math.min(progress, 0.9999) * n;
  const idx = Math.min(Math.floor(sp), n - 1);
  const frac = sp - idx;
  const a = path[idx], b = path[idx + 1] || path[idx];
  return [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac];
}

function spawnSimVehicles(sites) {
  const vehicles = [];

  sites.forEach((site, si) => {
    if (vehicles.length >= 10) return;
    const path = site.routeCoords;
    if (!path || path.length < 2) return;

    if (site.type === "vollsperrung") {
      // 2 stau vehicles stopped before the sperrung
      [0.28, 0.36].forEach((pos, i) => {
        if (vehicles.length >= 10) return;
        vehicles.push({ id: `stau-${site.id}-${i}`, path, progress: pos, speed: 0.00008, maxProgress: pos + 0.004, slowZone: null, color: "#dc2626", type: "stau" });
      });
      // 1 vehicle backing away slowly (stau tail)
      if (vehicles.length < 10) {
        vehicles.push({ id: `stau-${site.id}-2`, path, progress: 0.20, speed: 0.00005, maxProgress: 0.24, slowZone: null, color: "#f97316", type: "stau" });
      }
      // 2 detour vehicles on alternate routes
      const altPath = berlinSegments[si % berlinSegments.length].coords;
      [0.08, 0.52].forEach((pos, i) => {
        if (vehicles.length >= 10) return;
        vehicles.push({ id: `detour-${site.id}-${i}`, path: altPath, progress: pos, speed: 0.004, maxProgress: null, slowZone: null, color: "#3b82f6", type: "detour" });
      });
    } else {
      // teilsperrung: 3 vehicles entering and moving slowly through the zone
      [0.05, 0.22, 0.58].forEach((pos, i) => {
        if (vehicles.length >= 10) return;
        vehicles.push({ id: `slow-${site.id}-${i}`, path, progress: pos, speed: 0.0035, maxProgress: null, slowZone: [0.28, 0.72], color: "#f59e0b", type: "slow" });
      });
    }
  });

  // Fill remaining with normal vehicles along berlinSegment roads
  berlinSegments.forEach((seg, i) => {
    if (vehicles.length >= 10) return;
    vehicles.push({
      id: `normal-${i}`,
      path: seg.coords,
      progress: (i * 0.19) % 1,
      speed: 0.003 + (i % 4) * 0.0008,
      maxProgress: null,
      slowZone: null,
      color: "#64748b",
      type: "normal",
    });
  });

  return vehicles.slice(0, 10);
}

function getConstructionImpactForSegment(segment, constructionSites, laneClosure) {
  if (!constructionSites.length) return laneClosure ? 1.12 : 1;
  let impact = laneClosure ? 1.12 : 1;
  constructionSites.forEach((site) => {
    const d = distanceInDegrees(segment.center, site.center);
    if (d < 0.008) impact += 0.35;
    else if (d < 0.015) impact += 0.22;
    else if (d < 0.025) impact += 0.1;
  });
  return impact;
}

function MapClickHandler({ active, isSnapping, onMapClick }) {
  useMapEvents({
    click(e) {
      if (active && !isSnapping) onMapClick([e.latlng.lat, e.latlng.lng]);
    },
  });
  return null;
}

function InfoTooltip({ text }) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="relative ml-1 inline-block">
      <button
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-slate-100 text-[9px] font-bold text-slate-400 hover:bg-slate-200 hover:text-slate-500 transition"
      >
        i
      </button>
      {visible && (
        <span className="pointer-events-none absolute bottom-full right-0 z-50 mb-2 block w-56 rounded-xl border border-slate-200 bg-white p-2.5 text-[11px] leading-relaxed text-slate-600 shadow-xl">
          {text}
          <span className="absolute -bottom-1 right-2 block h-2 w-2 rotate-45 border-b border-r border-slate-200 bg-white" />
        </span>
      )}
    </span>
  );
}

function MetricCard({ icon, label, value, sub, tooltip }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-lg">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center text-[10px] text-slate-500">
          <span className="truncate">{label}</span>
          {tooltip && <InfoTooltip text={tooltip} />}
        </div>
        <div className="text-base font-semibold leading-tight text-slate-900">{value}</div>
        <div className="truncate text-[10px] text-slate-400">{sub}</div>
      </div>
    </div>
  );
}

function VehicleTypeIcon({ kind, active }) {
  const p = active ? { body: "#0f172a", detail: "#f8fafc", wheel: "#1e293b" } : { body: "#64748b", detail: "#e2e8f0", wheel: "#94a3b8" };
  if (kind === "truck") return (
    <svg viewBox="0 0 64 40" aria-hidden="true" className="h-6 w-9" fill="none">
      <rect x="4" y="11" width="29" height="15" rx="3" fill={p.body} />
      <path d="M33 15h9l6 6v5H33V15Z" fill={p.body} />
      <circle cx="18" cy="30" r="5" fill={p.wheel} /><circle cx="43" cy="30" r="5" fill={p.wheel} />
      <circle cx="18" cy="30" r="2.1" fill={p.detail} /><circle cx="43" cy="30" r="2.1" fill={p.detail} />
      <path d="M40 15v7h8" stroke={p.detail} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  if (kind === "van") return (
    <svg viewBox="0 0 64 40" aria-hidden="true" className="h-6 w-9" fill="none">
      <path d="M8 19c0-4.4 3.6-8 8-8h16c4.5 0 8.4 1.9 11.2 5.4l4.2 5.1V26H8v-7Z" fill={p.body} />
      <circle cx="20" cy="30" r="5" fill={p.wheel} /><circle cx="43" cy="30" r="5" fill={p.wheel} />
      <circle cx="20" cy="30" r="2.1" fill={p.detail} /><circle cx="43" cy="30" r="2.1" fill={p.detail} />
      <path d="M34 13v9h10" stroke={p.detail} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
  if (kind === "suv") return (
    <svg viewBox="0 0 64 40" aria-hidden="true" className="h-6 w-9" fill="none">
      <path d="M9 23c0-4 3.2-7.2 7.2-7.2h10l6.2-5.3c1-.8 2.2-1.3 3.5-1.3h6.6c2.7 0 5.2 1.5 6.5 3.9L54 20v6H9v-3Z" fill={p.body} />
      <circle cx="20" cy="30" r="5" fill={p.wheel} /><circle cx="44" cy="30" r="5" fill={p.wheel} />
      <circle cx="20" cy="30" r="2.1" fill={p.detail} /><circle cx="44" cy="30" r="2.1" fill={p.detail} />
      <path d="M31 13h11" stroke={p.detail} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
  return (
    <svg viewBox="0 0 64 40" aria-hidden="true" className="h-6 w-9" fill="none">
      <path d="M9 23c0-4 3.2-7.2 7.2-7.2h11.8l5.6-4.9c1.2-1 2.6-1.6 4.1-1.6h7.2c2.5 0 4.8 1.4 5.9 3.6L54 20v6H9v-3Z" fill={p.body} />
      <circle cx="20" cy="30" r="5" fill={p.wheel} /><circle cx="44" cy="30" r="5" fill={p.wheel} />
      <circle cx="20" cy="30" r="2.1" fill={p.detail} /><circle cx="44" cy="30" r="2.1" fill={p.detail} />
      <path d="M30 12.5h10.5" stroke={p.detail} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function RoadImpactBerlinMapMockup() {
  // Core state
  const [selectedUseCase, setSelectedUseCase] = useState("Baustellenplanung vor dem Start");
  const [selectedId, setSelectedId] = useState(1);
  const [selectedVehicleId, setSelectedVehicleId] = useState("pkw");
  const [vehicleMix, setVehicleMix] = useState(() =>
    vehicleProfiles.reduce((acc, p) => { acc[p.id] = { count: p.defaultCount, avgWeight: p.defaultWeight }; return acc; }, {})
  );
  const [laneClosure, setLaneClosure] = useState(true);
  const [weather, setWeather] = useState("Klar");
  const [mapView, setMapView] = useState("normal");
  const [constructionSites, setConstructionSites] = useState([]);
  const [baustelleStep, setBaustelleStep] = useState(null);
  const [pendingStart, setPendingStart] = useState(null);
  const [isSnapping, setIsSnapping] = useState(false);

  // Simulation state
  const [simTime, setSimTime] = useState(0);
  const [simPlaying, setSimPlaying] = useState(false);
  const [simSpeed, setSimSpeed] = useState(1);
  const [showSegments, setShowSegments] = useState(false);
  const [simVehicles, setSimVehicles] = useState([]);
  const simIntervalRef = useRef(null);

  // Baustellen-mode extra params
  const [arbeitsstunden, setArbeitsstunden] = useState(8);
  const [arbeiterAnzahl, setArbeiterAnzahl] = useState(15);
  const [umleitungAktiv, setUmleitungAktiv] = useState(false);
  const [maschineneinsatz, setMaschineneinsatz] = useState("mittel");

  // CO2-mode params
  const [treibstoffpreis, setTreibstoffpreis] = useState(1.65);
  const [co2Preis, setCo2Preis] = useState(55);
  const [emissionsklasse, setEmissionsklasse] = useState("Euro 6");
  const [verkehrsprognose, setVerkehrsprognose] = useState("Normal");

  // Unfallrisiko-mode params
  const [tempolimit, setTempolimit] = useState(50);
  const [strassenZustand, setStrassenZustand] = useState("mittel");
  const [beleuchtung, setBeleuchtung] = useState(true);
  const [markierungen, setMarkierungen] = useState("gut");

  // Frühwarnsystem-mode params
  const [forecastWeeks, setForecastWeeks] = useState(3);
  const [belastungsmodell, setBelastungsmodell] = useState("linear");
  const [alertSchwelle, setAlertSchwelle] = useState("mittel");

  // Simulation loop
  useEffect(() => {
    if (simPlaying) {
      simIntervalRef.current = setInterval(() => {
        setSimTime((prev) => (prev >= 720 ? 0 : prev + 1));
        setSimVehicles((prev) =>
          prev.map((v) => {
            if (v.maxProgress !== null && v.progress >= v.maxProgress) {
              return { ...v, progress: v.maxProgress };
            }
            let speed = v.speed;
            if (v.slowZone && v.progress >= v.slowZone[0] && v.progress <= v.slowZone[1]) {
              speed *= 0.2;
            }
            const next = v.progress + speed;
            return { ...v, progress: next >= 1 ? 0 : next };
          })
        );
      }, 1000 / simSpeed);
    }
    return () => clearInterval(simIntervalRef.current);
  }, [simPlaying, simSpeed]);

  // Derived time
  const timeOfDay = simTimeToTimeOfDay(simTime);
  const timeFactor = timeFactors[timeOfDay];
  const weatherFactor = weatherFactors[weather];

  // Mode-specific derived factors
  const emissionsklassenFaktor = { "Euro 4": 1.2, "Euro 5": 1.05, "Euro 6": 1.0, "Euro 6d": 0.88 }[emissionsklasse] ?? 1;
  const verkehrsprognoseFaktor = { Normal: 1.0, Hoch: 1.15, "Sehr hoch": 1.3 }[verkehrsprognose] ?? 1;
  const tempoFaktor = { 30: 0.55, 50: 0.7, 80: 0.85, 100: 1.0, 130: 1.3 }[tempolimit] ?? 0.7;
  const strassenFaktor = { gut: 0.85, mittel: 1.0, schlecht: 1.2 }[strassenZustand] ?? 1;
  const beleuchtungFaktor = beleuchtung ? 0.9 : 1.12;
  const markierungsFaktor = { gut: 0.9, alt: 1.0, keine: 1.18 }[markierungen] ?? 1;
  const belastungsmodellFaktor =
    belastungsmodell === "exponential" ? Math.pow(1.06, forecastWeeks)
    : belastungsmodell === "saisonal" ? 1 + forecastWeeks * 0.03 * (1 + 0.3 * Math.sin(forecastWeeks * 0.8))
    : 1 + forecastWeeks * 0.05;
  const maschinenFaktor = { leicht: 0.75, mittel: 1.0, schwer: 1.3 }[maschineneinsatz] ?? 1;

  // Vehicle mix calculations
  const selectedVehicleProfile = vehicleProfiles.find((p) => p.id === selectedVehicleId) ?? vehicleProfiles[0];
  const selectedVehicleValues = vehicleMix[selectedVehicleProfile.id];

  const updateVehicleMetric = (id, field, value) =>
    setVehicleMix((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));

  const profileStats = vehicleProfiles.map((p) => ({ ...p, count: vehicleMix[p.id].count, avgWeight: vehicleMix[p.id].avgWeight }));
  const totalVehicles = profileStats.reduce((s, p) => s + p.count, 0);
  const weightedCongestionLoad = profileStats.reduce((s, p) => s + p.count * p.congestionFactor, 0);
  const weightedEmissionLoad = profileStats.reduce((s, p) => s + p.count * p.emissionFactor * (p.avgWeight / p.defaultWeight), 0);
  const weightedWearLoad = profileStats.reduce((s, p) => s + p.count * p.wearFactor * (p.avgWeight / p.defaultWeight), 0);
  const weightedRiskLoad = profileStats.reduce((s, p) => s + p.count * p.riskFactor, 0);

  const truckProfiles = profileStats.filter((p) => p.kind === "truck");
  const truckCount = truckProfiles.reduce((s, p) => s + p.count, 0);
  const truckWeightAverage = truckCount ? truckProfiles.reduce((s, p) => s + p.count * p.avgWeight, 0) / truckCount : 0;
  const truckShare = totalVehicles > 0 ? truckCount / totalVehicles : 0;
  const totalTrafficFactor = Math.max(0.35, weightedCongestionLoad / 10250);
  const emissionsFactor = totalVehicles > 0 ? 0.78 + weightedEmissionLoad / totalVehicles / 2.4 : 0.78;
  const wearFactor = totalVehicles > 0 ? 0.72 + weightedWearLoad / totalVehicles : 0.72;
  const accidentMixFactor = totalVehicles > 0 ? weightedRiskLoad / totalVehicles : 0.92;

  // Construction site handlers
  const removeConstructionSite = (id) => setConstructionSites((prev) => prev.filter((s) => s.id !== id));
  const updateSperrungDauer = (id, field, value) => setConstructionSites((prev) => prev.map((s) => s.id === id ? { ...s, [field]: value } : s));
  const toggleSperrungType = (id) => setConstructionSites((prev) => prev.map((s) => s.id === id ? { ...s, type: s.type === "teilsperrung" ? "vollsperrung" : "teilsperrung" } : s));
  const cancelPlacement = () => { setBaustelleStep(null); setPendingStart(null); };

  const handleMapClick = async ([lat, lng]) => {
    setIsSnapping(true);
    try {
      const snapped = await snapToRoad(lat, lng);
      if (baustelleStep === "start") {
        setPendingStart(snapped);
        setBaustelleStep("end");
      } else if (baustelleStep === "end") {
        const routeCoords = await fetchRoute(pendingStart, snapped);
        const center = [(pendingStart[0] + snapped[0]) / 2, (pendingStart[1] + snapped[1]) / 2];
        setConstructionSites((prev) => [
          ...prev,
          { id: Date.now(), name: `Sperrung ${prev.length + 1}`, type: "teilsperrung", dauerValue: 1, dauerUnit: "Wochen", start: pendingStart, end: snapped, routeCoords, center },
        ]);
        setBaustelleStep(null);
        setPendingStart(null);
      }
    } catch {
      setBaustelleStep(null);
      setPendingStart(null);
    } finally {
      setIsSnapping(false);
    }
  };

  // Segments computation
  const segments = useMemo(() => {
    return berlinSegments.map((segment) => {
      const constructionFactor = selectedUseCase === "Baustellenplanung vor dem Start"
        ? getConstructionImpactForSegment(segment, constructionSites, laneClosure)
        : laneClosure ? 1.12 : 1;

      let congestion = segment.baseCongestion * totalTrafficFactor * timeFactor;
      let co2 = segment.baseCo2 * totalTrafficFactor * weatherFactor * emissionsFactor;
      let wear = segment.baseWear * totalTrafficFactor * wearFactor * (weather === "Frost" ? 1.16 : weather === "Regen" ? 1.08 : 1);
      let accidentRisk = segment.baseAccidentRisk * timeFactor * weatherFactor * accidentMixFactor;

      if (selectedUseCase === "Baustellenplanung vor dem Start") {
        congestion *= constructionFactor;
        wear *= constructionFactor;
        co2 *= 1 + (constructionFactor - 1) * 0.7;
        accidentRisk *= 1 + (constructionFactor - 1) * 0.35;
      }
      if (selectedUseCase === "CO2 Berechnung") {
        co2 *= (laneClosure ? 1.12 : 1) * emissionsklassenFaktor * verkehrsprognoseFaktor;
      }
      if (selectedUseCase === "Unfallrisikoreduktion") {
        accidentRisk *= (laneClosure ? 1.18 : 1) * tempoFaktor * strassenFaktor * beleuchtungFaktor * markierungsFaktor;
        congestion *= 1.05;
        wear *= strassenFaktor;
      }
      if (selectedUseCase === "Frühwarnsystem") {
        wear *= belastungsmodellFaktor;
        congestion *= 1 + (belastungsmodellFaktor - 1) * 0.6;
      }

      const congestionScore = Math.round(congestion * segment.weight);
      const co2Score = Math.round(co2 * segment.weight);
      const wearScore = Math.round(wear * segment.weight);
      const accidentScore = Math.round(accidentRisk * segment.weight);

      let combinedRisk = Math.round(congestionScore * 0.3 + co2Score * 0.15 + wearScore * 0.35 + accidentScore * 0.2);
      if (selectedUseCase === "CO2 Berechnung") combinedRisk = Math.round(co2Score * 0.55 + congestionScore * 0.2 + wearScore * 0.25);
      if (selectedUseCase === "Unfallrisikoreduktion") combinedRisk = Math.round(accidentScore * 0.45 + congestionScore * 0.3 + wearScore * 0.25);

      return { ...segment, congestionScore, co2Score, wearScore, accidentScore, combinedRisk, color: getRiskColor(combinedRisk), label: getRiskLabel(combinedRisk) };
    });
  }, [totalTrafficFactor, emissionsFactor, wearFactor, accidentMixFactor, timeFactor, weatherFactor, weather, laneClosure, selectedUseCase, constructionSites, emissionsklassenFaktor, verkehrsprognoseFaktor, tempoFaktor, strassenFaktor, beleuchtungFaktor, markierungsFaktor, belastungsmodellFaktor]);

  const selected = segments.find((s) => s.id === selectedId) || segments[0];
  const avgCongestion = Math.round(segments.reduce((s, x) => s + x.congestionScore, 0) / segments.length);
  const avgCo2 = Math.round(segments.reduce((s, x) => s + x.co2Score, 0) / segments.length);
  const avgWear = Math.round(segments.reduce((s, x) => s + x.wearScore, 0) / segments.length);
  const avgAccident = Math.round(segments.reduce((s, x) => s + x.accidentScore, 0) / segments.length);

  // Results calculations
  const baustellenCount = constructionSites.length;
  const vollsperrungen = constructionSites.filter((s) => s.type === "vollsperrung").length;
  const avgDauerDays = baustellenCount > 0
    ? Math.round(constructionSites.reduce((s, site) => {
        const d = site.dauerUnit === "Tage" ? site.dauerValue : site.dauerUnit === "Wochen" ? site.dauerValue * 7 : site.dauerValue * 30;
        return s + d;
      }, 0) / baustellenCount)
    : 0;

  const stauDelay = Math.max(0, Math.round((avgCongestion - 40) * 0.2 * weatherFactor * (baustellenCount * 0.3 + 1)));
  const gesamtfahrzeitMin = 612 + stauDelay;
  const fahrzeitStr = `${Math.floor(gesamtfahrzeitMin / 60)}h ${String(gesamtfahrzeitMin % 60).padStart(2, "0")}m`;
  const proLkwStr = `Ø pro LKW: ${Math.floor(612 / 60)}h ${String((612 % 60) + Math.round(stauDelay * 0.4)).padStart(2, "0")}m`;

  const kraftstoffKosten = Math.round(totalVehicles * 0.065 * (avgCo2 / 60) * weatherFactor * (baustellenCount * 0.18 + 1) * maschinenFaktor * (treibstoffpreis / 1.65));
  const mautKosten = Math.round(truckCount * 9.94 * (baustellenCount > 0 ? 1.08 : 1));
  const zeitKosten = Math.round(stauDelay * totalVehicles * 0.003);
  const co2ExternKosten = selectedUseCase === "CO2 Berechnung" ? Math.round((avgCo2 * totalVehicles * 0.000015 * weatherFactor * emissionsklassenFaktor * verkehrsprognoseFaktor) * co2Preis) : 0;
  const sonstigeKosten = Math.round((kraftstoffKosten + mautKosten + zeitKosten) * 0.025);
  const gesamtKosten = kraftstoffKosten + mautKosten + zeitKosten + sonstigeKosten + co2ExternKosten;

  const co2Gesamt = parseFloat((avgCo2 * totalVehicles * 0.000015 * (baustellenCount * 0.22 + 1) * weatherFactor * maschinenFaktor * emissionsklassenFaktor).toFixed(1));
  const co2ProLkw = parseFloat(((co2Gesamt / Math.max(1, truckCount)) * 1000).toFixed(1));
  const umleitungsAnteil = Math.min(40, baustellenCount * 7 + vollsperrungen * 6 + (umleitungAktiv ? 8 : 0));

  const co2FahrenBase = Math.max(40, 73 - baustellenCount * 2);
  const co2StauBase = Math.min(40, 17 + baustellenCount * 3 + (weather === "Regen" ? 2 : weather === "Frost" ? 3 : 0));
  const co2KaltstartBase = Math.max(1, 7 - baustellenCount);
  const co2SumBase = co2FahrenBase + co2StauBase + co2KaltstartBase + 3;
  const co2Pct = {
    fahren: Math.round((co2FahrenBase / co2SumBase) * 100),
    stau: Math.round((co2StauBase / co2SumBase) * 100),
    kaltstart: Math.round((co2KaltstartBase / co2SumBase) * 100),
    sonstige: Math.round((3 / co2SumBase) * 100),
  };

  const recommendation = useMemo(() => {
    if (selectedUseCase === "Baustellenplanung vor dem Start")
      return `${baustellenCount} Sperrung${baustellenCount !== 1 ? "en" : ""} gesetzt. ${vollsperrungen > 0 ? `${vollsperrungen} Vollsperrung${vollsperrungen > 1 ? "en" : ""} erhöht den Umleitungsanteil auf ${umleitungsAnteil}%.` : "Teilsperrungen halten Umleitungsanteil niedrig."} Stauverzögerung: +${stauDelay} min.`;
    if (selectedUseCase === "CO2 Berechnung")
      return `Emissionsklasse ${emissionsklasse} und Prognose „${verkehrsprognose}" ergeben ${co2Gesamt} t CO₂. Ext. Kosten: ${formatNumberDe(co2ExternKosten)} € bei ${co2Preis} €/t.`;
    if (selectedUseCase === "Unfallrisikoreduktion")
      return `Tempo ${tempolimit} km/h, ${strassenZustand}er Straßenzustand, Beleuchtung ${beleuchtung ? "aktiv" : "inaktiv"}. Unfallrisiko im Vergleich zu Baseline: ${Math.round((1 - tempoFaktor * strassenFaktor * beleuchtungFaktor) * 100)} % verändert.`;
    return `${forecastWeeks}-Wochen-Prognose (${belastungsmodell}): Belastungsfaktor ×${belastungsmodellFaktor.toFixed(2)}. Alertschwelle: ${alertSchwelle}. Präventive Prüfung der kritischsten Abschnitte empfohlen.`;
  }, [selectedUseCase, baustellenCount, vollsperrungen, umleitungsAnteil, stauDelay, emissionsklasse, verkehrsprognose, co2Gesamt, co2ExternKosten, co2Preis, tempolimit, strassenZustand, beleuchtung, tempoFaktor, strassenFaktor, beleuchtungFaktor, forecastWeeks, belastungsmodell, belastungsmodellFaktor, alertSchwelle]);

  const isBaustelleMode = selectedUseCase === "Baustellenplanung vor dem Start";
  const tooltips = METRIC_TOOLTIPS[selectedUseCase] || METRIC_TOOLTIPS["Baustellenplanung vor dem Start"];

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white text-slate-900">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-sky-700">RoadImpact AI</span>
          <span className="text-slate-300">|</span>
          <span className="text-sm font-semibold text-slate-700">Digitaler Zwilling – Baustellen Simulation Berlin</span>
        </div>
        <div className="rounded-xl border border-sky-100 bg-sky-50 px-3 py-1.5 text-xs text-sky-700">Hackathon Prototyp · OpenStreetMap Demo</div>
      </header>

      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT: NUTZERPARAMETER ── */}
        <aside className="flex w-56 shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white">
          <div className="px-4 pt-4 pb-1">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Nutzerparameter</div>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">

            {/* Zeit & Zeitraum */}
            <section>
              <div className="mb-2 text-xs font-semibold text-slate-600">Zeit &amp; Zeitraum</div>
              <div className="space-y-2">
                <div>
                  <div className="mb-1 text-[11px] text-slate-500">Datum</div>
                  <input type="date" defaultValue="2024-05-15" className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs outline-none focus:border-sky-300" />
                </div>
                <div>
                  <div className="mb-1 text-[11px] text-slate-500">Zeitraum</div>
                  <div className="flex items-center gap-1">
                    <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-xs">06:00</span>
                    <span className="text-xs text-slate-400">–</span>
                    <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-xs">18:00</span>
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-[11px] text-slate-500">Simzeit</div>
                  <div className="rounded-lg border border-sky-200 bg-sky-50 py-1 text-center font-mono text-sm font-semibold text-sky-700">{formatSimTime(simTime)}</div>
                </div>
              </div>
            </section>

            {/* Analysemodus */}
            <section>
              <div className="mb-2 text-xs font-semibold text-slate-600">Analysemodus</div>
              <select
                value={selectedUseCase}
                onChange={(e) => { setSelectedUseCase(e.target.value); cancelPlacement(); }}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs outline-none focus:border-sky-300"
              >
                {useCases.map((uc) => <option key={uc}>{uc}</option>)}
              </select>
            </section>

            {/* Fahrzeug & Flotte */}
            <section>
              <div className="mb-2 text-xs font-semibold text-slate-600">Fahrzeug &amp; Flotte</div>
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-1">
                  {vehicleProfiles.map((profile) => {
                    const active = selectedVehicleId === profile.id;
                    return (
                      <button key={profile.id} onClick={() => setSelectedVehicleId(profile.id)} title={profile.label}
                        className={`rounded-lg border p-1.5 text-center transition ${active ? "border-sky-300 bg-sky-50 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300"}`}>
                        <div className="flex justify-center"><VehicleTypeIcon kind={profile.kind} active={active} /></div>
                        <div className={`mt-1 text-[9px] font-medium ${active ? "text-sky-700" : "text-slate-400"}`}>{profile.label}</div>
                      </button>
                    );
                  })}
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[11px] text-slate-500">Anzahl {selectedVehicleProfile.label}</span>
                    <span className="text-[11px] font-semibold">{formatNumberDe(selectedVehicleValues.count)}</span>
                  </div>
                  <input type="range" min={selectedVehicleProfile.minCount} max={selectedVehicleProfile.maxCount} step={selectedVehicleProfile.countStep} value={selectedVehicleValues.count}
                    onChange={(e) => updateVehicleMetric(selectedVehicleProfile.id, "count", Number(e.target.value))} className="w-full accent-sky-600" />
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[11px] text-slate-500">Gewicht (t)</span>
                    <span className="text-[11px] font-semibold">{formatWeightDe(selectedVehicleValues.avgWeight)}</span>
                  </div>
                  <input type="range" min={selectedVehicleProfile.minWeight} max={selectedVehicleProfile.maxWeight} step={selectedVehicleProfile.weightStep} value={selectedVehicleValues.avgWeight}
                    onChange={(e) => updateVehicleMetric(selectedVehicleProfile.id, "avgWeight", Number(e.target.value))} className="w-full accent-sky-600" />
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5 text-[10px] text-slate-500">
                  {formatNumberDe(totalVehicles)} Fz. · {truckShare > 0 ? Math.round(truckShare * 100) : 0}% LKW · Ø {formatWeightDe(truckWeightAverage)} t
                </div>
              </div>
            </section>

            {/* ── MODE-SPECIFIC PARAMS ── */}

            {/* Baustellenplanung */}
            {isBaustelleMode && (
              <section>
                <div className="mb-2 text-xs font-semibold text-slate-600">Baustellen &amp; Sperrungen</div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-slate-500">{baustellenCount} gesetzt</span>
                    {!baustelleStep ? (
                      <button onClick={() => setBaustelleStep("start")} className="rounded-lg bg-amber-500 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-amber-600 transition">+ Sperrung</button>
                    ) : (
                      <button onClick={cancelPlacement} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 transition">Abbrechen</button>
                    )}
                  </div>
                  {baustelleStep && (
                    <div className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-700">
                      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white ${baustelleStep === "start" ? "bg-amber-500" : "bg-green-500"}`}>
                        {baustelleStep === "start" ? "1" : "✓"}
                      </span>
                      <span>Start</span>
                      <span className="mx-0.5 text-amber-300">—</span>
                      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${baustelleStep === "end" ? "bg-amber-500 text-white" : "bg-amber-200 text-amber-600"}`}>2</span>
                      <span>Ende</span>
                      {isSnapping && <span className="ml-1 italic">snapping...</span>}
                    </div>
                  )}
                  {constructionSites.map((site) => (
                    <div key={site.id} className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-medium text-amber-900">🚧 {site.name}</span>
                        <button onClick={() => removeConstructionSite(site.id)} className="text-[10px] text-red-400 hover:text-red-600">✕</button>
                      </div>
                      <div className="flex items-center gap-1">
                        <input type="number" min="1" max="99" value={site.dauerValue}
                          onChange={(e) => updateSperrungDauer(site.id, "dauerValue", Math.max(1, Number(e.target.value)))}
                          className="w-10 rounded border border-slate-200 bg-white px-1 py-0.5 text-center text-[10px] outline-none" />
                        <select value={site.dauerUnit} onChange={(e) => updateSperrungDauer(site.id, "dauerUnit", e.target.value)}
                          className="flex-1 rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] outline-none">
                          <option>Tage</option><option>Wochen</option><option>Monate</option>
                        </select>
                      </div>
                      <div className="flex items-center gap-0.5 rounded-full border border-slate-200 bg-white p-0.5">
                        {["teilsperrung", "vollsperrung"].map((t) => (
                          <button key={t} onClick={() => toggleSperrungType(site.id)}
                            className={`flex-1 rounded-full px-2 py-0.5 text-[9px] font-medium transition ${site.type === t ? (t === "vollsperrung" ? "bg-red-500 text-white shadow-sm" : "bg-white text-slate-900 shadow-sm") : "text-slate-400"}`}>
                            {t === "teilsperrung" ? "Teil" : "Voll"}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  <div className="space-y-2 border-t border-slate-100 pt-2">
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-[11px] text-slate-500">Arbeitsstunden / Tag</span>
                        <span className="text-[11px] font-semibold">{arbeitsstunden}h</span>
                      </div>
                      <input type="range" min="4" max="24" step="1" value={arbeitsstunden} onChange={(e) => setArbeitsstunden(Number(e.target.value))} className="w-full accent-amber-500" />
                    </div>
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-[11px] text-slate-500">Anzahl Arbeiter</span>
                        <span className="text-[11px] font-semibold">{arbeiterAnzahl}</span>
                      </div>
                      <input type="range" min="5" max="100" step="5" value={arbeiterAnzahl} onChange={(e) => setArbeiterAnzahl(Number(e.target.value))} className="w-full accent-amber-500" />
                    </div>
                    <div>
                      <div className="mb-1 text-[11px] text-slate-500">Maschineneinsatz</div>
                      <div className="flex gap-1">
                        {["leicht", "mittel", "schwer"].map((m) => (
                          <button key={m} onClick={() => setMaschineneinsatz(m)}
                            className={`flex-1 rounded-lg border py-1 text-[10px] font-medium transition ${maschineneinsatz === m ? "border-slate-700 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-500"}`}>
                            {m.charAt(0).toUpperCase() + m.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                      <span className="text-[11px] text-slate-600">Umleitung aktiv</span>
                      <button onClick={() => setUmleitungAktiv(!umleitungAktiv)} className={`relative h-5 w-9 rounded-full transition ${umleitungAktiv ? "bg-sky-600" : "bg-slate-300"}`}>
                        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${umleitungAktiv ? "left-4" : "left-0.5"}`} />
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* CO2 Berechnung */}
            {selectedUseCase === "CO2 Berechnung" && (
              <section>
                <div className="mb-2 text-xs font-semibold text-slate-600">CO₂ Parameter</div>
                <div className="space-y-3">
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[11px] text-slate-500">Treibstoffpreis (€/l)</span>
                      <span className="text-[11px] font-semibold">{treibstoffpreis.toFixed(2)}</span>
                    </div>
                    <input type="range" min="1.20" max="2.50" step="0.05" value={treibstoffpreis} onChange={(e) => setTreibstoffpreis(Number(e.target.value))} className="w-full accent-sky-600" />
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[11px] text-slate-500">CO₂-Preis (€/t)</span>
                      <span className="text-[11px] font-semibold">{co2Preis}</span>
                    </div>
                    <input type="range" min="20" max="150" step="5" value={co2Preis} onChange={(e) => setCo2Preis(Number(e.target.value))} className="w-full accent-sky-600" />
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] text-slate-500">Emissionsklasse</div>
                    <select value={emissionsklasse} onChange={(e) => setEmissionsklasse(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs outline-none">
                      {["Euro 4", "Euro 5", "Euro 6", "Euro 6d"].map((k) => <option key={k}>{k}</option>)}
                    </select>
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] text-slate-500">Verkehrsprognose</div>
                    <div className="grid grid-cols-3 gap-1">
                      {["Normal", "Hoch", "Sehr hoch"].map((v) => (
                        <button key={v} onClick={() => setVerkehrsprognose(v)}
                          className={`rounded-lg border py-1.5 text-[10px] font-medium transition ${verkehrsprognose === v ? "border-slate-700 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-500"}`}>
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* Unfallrisikoreduktion */}
            {selectedUseCase === "Unfallrisikoreduktion" && (
              <section>
                <div className="mb-2 text-xs font-semibold text-slate-600">Sicherheits-Parameter</div>
                <div className="space-y-3">
                  <div>
                    <div className="mb-1 text-[11px] text-slate-500">Tempolimit (km/h)</div>
                    <div className="grid grid-cols-5 gap-1">
                      {[30, 50, 80, 100, 130].map((t) => (
                        <button key={t} onClick={() => setTempolimit(t)}
                          className={`rounded-lg border py-1.5 text-[10px] font-medium transition ${tempolimit === t ? "border-slate-700 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-500"}`}>
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] text-slate-500">Straßenzustand</div>
                    <div className="grid grid-cols-3 gap-1">
                      {["gut", "mittel", "schlecht"].map((s) => (
                        <button key={s} onClick={() => setStrassenZustand(s)}
                          className={`rounded-lg border py-1.5 text-[10px] font-medium capitalize transition ${strassenZustand === s ? "border-slate-700 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-500"}`}>
                          {s.charAt(0).toUpperCase() + s.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                    <span className="text-[11px] text-slate-600">Straßenbeleuchtung</span>
                    <button onClick={() => setBeleuchtung(!beleuchtung)} className={`relative h-5 w-9 rounded-full transition ${beleuchtung ? "bg-sky-600" : "bg-slate-300"}`}>
                      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${beleuchtung ? "left-4" : "left-0.5"}`} />
                    </button>
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] text-slate-500">Fahrbahnmarkierungen</div>
                    <div className="grid grid-cols-3 gap-1">
                      {["gut", "alt", "keine"].map((m) => (
                        <button key={m} onClick={() => setMarkierungen(m)}
                          className={`rounded-lg border py-1.5 text-[10px] font-medium capitalize transition ${markierungen === m ? "border-slate-700 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-500"}`}>
                          {m.charAt(0).toUpperCase() + m.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* Frühwarnsystem */}
            {selectedUseCase === "Frühwarnsystem" && (
              <section>
                <div className="mb-2 text-xs font-semibold text-slate-600">Prognose-Parameter</div>
                <div className="space-y-3">
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[11px] text-slate-500">Prognosehorizont</span>
                      <span className="text-[11px] font-semibold">{forecastWeeks} Wo.</span>
                    </div>
                    <input type="range" min="1" max="8" value={forecastWeeks} onChange={(e) => setForecastWeeks(Number(e.target.value))} className="w-full accent-sky-600" />
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] text-slate-500">Belastungsmodell</div>
                    <div className="flex flex-col gap-1">
                      {["linear", "exponential", "saisonal"].map((m) => (
                        <button key={m} onClick={() => setBelastungsmodell(m)}
                          className={`rounded-lg border py-1.5 text-[10px] font-medium capitalize transition ${belastungsmodell === m ? "border-slate-700 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-500"}`}>
                          {m.charAt(0).toUpperCase() + m.slice(1)} {m === "exponential" ? `(×${Math.pow(1.06, forecastWeeks).toFixed(2)})` : m === "saisonal" ? `(×${(1 + forecastWeeks * 0.03 * (1 + 0.3 * Math.sin(forecastWeeks * 0.8))).toFixed(2)})` : `(×${(1 + forecastWeeks * 0.05).toFixed(2)})`}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] text-slate-500">Alertschwelle</div>
                    <div className="grid grid-cols-3 gap-1">
                      {["niedrig", "mittel", "hoch"].map((a) => (
                        <button key={a} onClick={() => setAlertSchwelle(a)}
                          className={`rounded-lg border py-1.5 text-[10px] font-medium capitalize transition ${alertSchwelle === a ? "border-slate-700 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-500"}`}>
                          {a.charAt(0).toUpperCase() + a.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* Umgebung */}
            <section>
              <div className="mb-2 text-xs font-semibold text-slate-600">Umgebung</div>
              <div className="space-y-2">
                <div>
                  <div className="mb-1 text-[11px] text-slate-500">Wetter-Szenario</div>
                  <div className="grid grid-cols-3 gap-1">
                    {["Klar", "Regen", "Frost"].map((w) => (
                      <button key={w} onClick={() => setWeather(w)}
                        className={`rounded-lg border py-1.5 text-[11px] font-medium transition ${weather === w ? "border-slate-700 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-600"}`}>
                        {w}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                  <span className="text-[11px] text-slate-600">Fahrspurverengung</span>
                  <button onClick={() => setLaneClosure(!laneClosure)} className={`relative h-5 w-9 rounded-full transition ${laneClosure ? "bg-sky-600" : "bg-slate-300"}`}>
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${laneClosure ? "left-4" : "left-0.5"}`} />
                  </button>
                </div>
              </div>
            </section>
          </div>

          {/* SIMULATION STARTEN */}
          <div className="shrink-0 border-t border-slate-200 p-4">
            <button
              onClick={() => { setSimTime(0); setSimPlaying(true); setSimVehicles(spawnSimVehicles(constructionSites)); }}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700"
            >
              <span>▶</span> SIMULATION STARTEN
            </button>
          </div>
        </aside>

        {/* ── CENTER: MAP + TIME PLAYER ── */}
        <main className="flex flex-1 flex-col overflow-hidden">
          {/* Map header */}
          <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5">
            <div>
              <h2 className="text-sm font-semibold">Interaktive Karte · Berlin</h2>
              <p className="text-xs text-slate-500">
                {isBaustelleMode && baustelleStep === "start" && <span className="font-medium text-amber-600">Startpunkt auf einer Straße anklicken</span>}
                {isBaustelleMode && baustelleStep === "end" && <span className="font-medium text-amber-600">Endpunkt auf einer Straße anklicken</span>}
                {isSnapping && <span className="text-slate-400">Snapping auf Straße...</span>}
                {(!isBaustelleMode || !baustelleStep) && !isSnapping && "Baustellen setzen · Simulation starten · Abschnitte anklicken"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {simVehicles.length > 0 && (
                <div className="flex items-center gap-2 text-[10px] text-slate-500">
                  <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-500" />Normal</span>
                  <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400" />Langsam</span>
                  <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />Stau</span>
                  <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-500" />Umleitung</span>
                </div>
              )}
              <button onClick={() => setShowSegments(!showSegments)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${showSegments ? "border-sky-300 bg-sky-50 text-sky-700" : "border-slate-200 bg-slate-100 text-slate-500 hover:text-slate-700"}`}>
                Segmente {showSegments ? "an" : "aus"}
              </button>
              <div className="flex items-center gap-0.5 rounded-full border border-slate-200 bg-slate-100 p-0.5">
                {Object.entries(MAP_LAYERS).map(([key, layer]) => (
                  <button key={key} onClick={() => setMapView(key)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition ${mapView === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                    {layer.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Map */}
          <div className="flex-1" style={{ cursor: baustelleStep && !isSnapping ? "crosshair" : "default" }}>
            <MapContainer center={[52.516, 13.375]} zoom={13} scrollWheelZoom={true} style={{ height: "100%", width: "100%" }}>
              <TileLayer attribution={MAP_LAYERS[mapView].attribution} url={MAP_LAYERS[mapView].url} />
              <MapClickHandler active={isBaustelleMode && !!baustelleStep} isSnapping={isSnapping} onMapClick={handleMapClick} />

              {/* Road segments (toggled) */}
              {showSegments && segments.map((segment) => (
                <CircleMarker key={segment.id} center={segment.center} radius={selectedId === segment.id ? 10 : 7}
                  pathOptions={{ color: segment.color, fillColor: segment.color, fillOpacity: 0.8 }}
                  eventHandlers={{ click: () => setSelectedId(segment.id) }}>
                  <Popup>
                    <div style={{ minWidth: 180 }}>
                      <strong>{segment.name}</strong><br />
                      Risiko: {segment.combinedRisk} · Stau: {segment.congestionScore}<br />
                      CO₂: {segment.co2Score} · Verschleiß: {segment.wearScore}<br />
                      Unfallrisiko: {segment.accidentScore}
                    </div>
                  </Popup>
                </CircleMarker>
              ))}

              {/* Construction sites */}
              {constructionSites.map((site) => (
                <Fragment key={site.id}>
                  <Polyline positions={site.routeCoords} pathOptions={{ color: site.type === "vollsperrung" ? "#dc2626" : "#f59e0b", weight: 6, opacity: 0.85, dashArray: "10, 8" }} />
                  <Marker position={site.start} icon={baustelleIcon}>
                    <Popup>
                      <div style={{ minWidth: 160 }}>
                        <strong>{site.name}</strong><br />
                        <span style={{ fontSize: "0.8em", color: "#6b7280" }}>Start</span><br />
                        <button onClick={() => removeConstructionSite(site.id)} style={{ marginTop: 8, padding: "5px 10px", border: "none", borderRadius: 8, background: "#dc2626", color: "white", cursor: "pointer", fontSize: "0.85em" }}>Entfernen</button>
                      </div>
                    </Popup>
                  </Marker>
                  <Marker position={site.end} icon={baustelleIcon}>
                    <Popup>
                      <div style={{ minWidth: 160 }}>
                        <strong>{site.name}</strong><br />
                        <span style={{ fontSize: "0.8em", color: "#6b7280" }}>Ende</span><br />
                        <button onClick={() => removeConstructionSite(site.id)} style={{ marginTop: 8, padding: "5px 10px", border: "none", borderRadius: 8, background: "#dc2626", color: "white", cursor: "pointer", fontSize: "0.85em" }}>Entfernen</button>
                      </div>
                    </Popup>
                  </Marker>
                </Fragment>
              ))}

              {pendingStart && <Marker position={pendingStart} icon={pendingIcon} />}

              {/* Simulated vehicles */}
              {simVehicles.map((v) => {
                const pos = interpolatePosition(v.path, v.progress);
                const isInSlowZone = v.slowZone && v.progress >= v.slowZone[0] && v.progress <= v.slowZone[1];
                const displayColor = isInSlowZone ? "#f59e0b" : v.color;
                return (
                  <CircleMarker key={v.id} center={pos} radius={v.type === "stau" ? 5 : 4}
                    pathOptions={{ color: "#fff", fillColor: displayColor, fillOpacity: 0.95, weight: 1.5 }}>
                    <Popup>
                      <div>
                        {v.type === "stau" && "🚨 Stau – Vollsperrung"}
                        {v.type === "slow" && (isInSlowZone ? "🐢 Langsam – Baustelle" : "🚗 Normal")}
                        {v.type === "detour" && "🔄 Umleitung"}
                        {v.type === "normal" && "🚗 Normaler Verkehr"}
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              })}

              <CircleMarker center={[52.514, 13.352]} radius={6} pathOptions={{ color: "#0f172a", fillColor: "#0f172a", fillOpacity: 0.85 }}>
                <Popup>Referenz: Tiergarten / Berlin-Mitte</Popup>
              </CircleMarker>
            </MapContainer>
          </div>

          {/* Time player */}
          <div className="flex shrink-0 items-center gap-3 border-t border-slate-200 bg-white px-5 py-3">
            <button onClick={() => setSimPlaying(!simPlaying)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-800 text-sm text-white hover:bg-slate-700 transition">
              {simPlaying ? "⏸" : "▶"}
            </button>
            <span className="w-12 shrink-0 font-mono text-xs text-slate-500">06:00</span>
            <input type="range" min={0} max={720} value={simTime}
              onChange={(e) => { setSimPlaying(false); setSimTime(Number(e.target.value)); }}
              className="flex-1 accent-sky-600" />
            <span className="w-12 shrink-0 text-right font-mono text-xs text-slate-500">18:00</span>
            <div className="w-16 shrink-0 rounded-lg border border-sky-200 bg-sky-50 py-1 text-center font-mono text-sm font-semibold text-sky-700">
              {formatSimTime(simTime)}
            </div>
            <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-slate-200 bg-slate-100 p-0.5">
              {[1, 2, 4, 8].map((s) => (
                <button key={s} onClick={() => setSimSpeed(s)}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${simSpeed === s ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                  {s}x
                </button>
              ))}
            </div>
          </div>
        </main>

        {/* ── RIGHT: ERGEBNISSE ── */}
        <aside className="flex w-72 shrink-0 flex-col overflow-hidden border-l border-slate-200 bg-white">
          <div className="shrink-0 px-4 pt-4 pb-1">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Ergebnisse</div>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">

            {/* Key metrics */}
            <div className="space-y-2">
              <MetricCard icon="⏱" label="Gesamtfahrzeit" value={fahrzeitStr} sub={proLkwStr} tooltip={tooltips.fahrzeit} />
              <MetricCard icon="💶" label="Gesamtkosten" value={`${formatNumberDe(gesamtKosten)} €`}
                sub={`Ø pro LKW: ${formatNumberDe(Math.round(gesamtKosten / Math.max(1, truckCount)))} €`}
                tooltip={tooltips.kosten} />
              <MetricCard icon="🌱" label="CO₂ Emissionen" value={`${formatWeightDe(co2Gesamt)} t`}
                sub={`Ø pro LKW: ${formatWeightDe(co2ProLkw)} kg`} tooltip={tooltips.co2} />
              <MetricCard icon="🔄" label="Umleitungsanteil" value={`${umleitungsAnteil} %`}
                sub={`${vollsperrungen} Vollsperr. · ${baustellenCount} gesamt`} tooltip={tooltips.umleitungen} />
              {selectedUseCase === "CO2 Berechnung" && (
                <MetricCard icon="🏭" label="CO₂-Kosten extern"
                  value={`${formatNumberDe(co2ExternKosten)} €`}
                  sub={`${co2Preis} €/t · ${emissionsklasse}`}
                  tooltip="Externe Klimakosten basierend auf dem eingestellten CO₂-Preis und den Gesamtemissionen." />
              )}
              {selectedUseCase === "Unfallrisikoreduktion" && (
                <MetricCard icon="🛡️" label="Risikoreduktion"
                  value={`${Math.max(0, Math.round((1 - tempoFaktor * strassenFaktor * beleuchtungFaktor) * 100))} %`}
                  sub={`Tempo ${tempolimit} · ${strassenZustand} · ${beleuchtung ? "Beleuchtung an" : "kein Licht"}`}
                  tooltip="Geschätzte Unfallrisikoreduktion gegenüber Baseline durch die gewählten Sicherheitsmaßnahmen." />
              )}
              {selectedUseCase === "Frühwarnsystem" && (
                <MetricCard icon="📈" label="Belastungsfaktor"
                  value={`×${belastungsmodellFaktor.toFixed(2)}`}
                  sub={`${forecastWeeks} Wo. · ${belastungsmodell}`}
                  tooltip={`Prognostizierter Belastungsanstieg nach ${forecastWeeks} Wochen gemäß dem ${belastungsmodell}en Modell.`} />
              )}
            </div>

            {/* Detaillierte Ergebnisse */}
            <section>
              <div className="mb-2 flex items-center text-xs font-semibold text-slate-600">
                Detaillierte Ergebnisse
                <InfoTooltip text={tooltips.kosten_detail} />
              </div>
              <div className="space-y-2">
                {[
                  { label: "Kraftstoffkosten", value: kraftstoffKosten, color: "#3b82f6" },
                  { label: "Mautkosten", value: mautKosten, color: "#f59e0b" },
                  { label: "Zeitkosten", value: zeitKosten, color: "#8b5cf6" },
                  ...(co2ExternKosten > 0 ? [{ label: "CO₂-Kosten ext.", value: co2ExternKosten, color: "#22c55e" }] : []),
                  { label: "Sonstige", value: sonstigeKosten, color: "#94a3b8" },
                ].map(({ label, value, color }) => (
                  <div key={label}>
                    <div className="mb-0.5 flex justify-between text-[11px]">
                      <span className="text-slate-600">{label}</span>
                      <span className="font-medium">{formatNumberDe(value)} €</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full transition-all duration-300" style={{ width: `${Math.round((value / Math.max(1, gesamtKosten)) * 100)}%`, backgroundColor: color }} />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* CO2 nach Quelle */}
            <section>
              <div className="mb-2 flex items-center text-xs font-semibold text-slate-600">
                CO₂ Emissionen nach Quelle
                <InfoTooltip text={tooltips.co2_quelle} />
              </div>
              <div className="space-y-1.5">
                {[
                  { label: "Fahren", pct: co2Pct.fahren, color: "#3b82f6" },
                  { label: "Stau", pct: co2Pct.stau, color: "#22c55e" },
                  { label: "Kaltstart", pct: co2Pct.kaltstart, color: "#f97316" },
                  { label: "Sonstige", pct: co2Pct.sonstige, color: "#94a3b8" },
                ].map(({ label, pct, color }) => (
                  <div key={label} className="flex items-center gap-2">
                    <span className="w-14 shrink-0 text-[11px] text-slate-500">{label}</span>
                    <div className="relative h-4 flex-1 overflow-hidden rounded bg-slate-100">
                      <div className="absolute left-0 top-0 h-full rounded transition-all duration-300" style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.75 }} />
                      <div className="absolute inset-0 flex items-center justify-end px-1.5">
                        <span className="text-[10px] font-semibold text-slate-700">{pct}%</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Baustellen-Status */}
            {baustellenCount > 0 && (
              <section>
                <div className="mb-2 flex items-center text-xs font-semibold text-slate-600">
                  Baustellen-Status
                  <InfoTooltip text="Übersicht der aktiv gesetzten Sperrungen und ihrer simulierten Auswirkungen auf Verkehr und Kosten." />
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 space-y-1.5">
                  {[
                    { label: "Aktive Sperrungen", value: baustellenCount },
                    { label: "Vollsperrungen", value: vollsperrungen },
                    { label: "Ø Dauer", value: `${avgDauerDays} Tage` },
                    { label: "Arbeiter gesamt", value: baustellenCount * arbeiterAnzahl },
                    { label: "Arbeitsstunden/Tag", value: `${arbeitsstunden}h` },
                    { label: "Maschineneinsatz", value: maschineneinsatz.charAt(0).toUpperCase() + maschineneinsatz.slice(1) },
                    { label: "Stau-Mehrbelastung", value: `+${stauDelay} min` },
                    { label: "Simulierte Fahrzeuge", value: simVehicles.length > 0 ? `${simVehicles.length} (${simVehicles.filter(v => v.type === "stau").length} Stau, ${simVehicles.filter(v => v.type === "detour").length} Umleitung)` : "—" },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between text-[11px]">
                      <span className="text-slate-500">{label}</span>
                      <span className="font-medium text-slate-800">{value}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Segment list (when visible) */}
            {showSegments && (
              <section>
                <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-600">
                  <div className="flex items-center">
                    Kritische Infrastruktur
                    <InfoTooltip text="Alle Korridore sortiert nach kombiniertem Risikowert. Klicken zum Auswählen und Details anzeigen." />
                  </div>
                  <span className="text-[10px] font-normal text-slate-400">nach Risiko</span>
                </div>
                <div className="space-y-1.5">
                  {[...segments].sort((a, b) => b.combinedRisk - a.combinedRisk).map((segment) => (
                    <button key={segment.id} onClick={() => setSelectedId(segment.id)}
                      className={`w-full rounded-xl border px-3 py-2 text-left transition ${selectedId === segment.id ? "border-sky-300 bg-sky-50" : "border-slate-200 bg-slate-50 hover:bg-slate-100"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-[11px] font-medium leading-tight text-slate-800">{segment.name}</div>
                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${badgeClass(segment.label)}`}>{segment.label}</span>
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-500">Score: {segment.combinedRisk}</div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Empfehlung */}
            <section>
              <div className="mb-2 flex items-center text-xs font-semibold text-slate-600">
                Empfehlung
                <InfoTooltip text="Automatisch generierte Handlungsempfehlung basierend auf den aktuellen Simulationsparametern und Analyseergebnissen." />
              </div>
              <div className="rounded-xl border border-green-200 bg-green-50 p-3">
                <p className="text-[11px] leading-relaxed text-green-800">{recommendation}</p>
              </div>
            </section>

          </div>
        </aside>

      </div>
    </div>
  );
}
