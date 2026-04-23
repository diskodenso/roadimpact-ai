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
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  autobahn: {
    label: "Autobahn",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
};

const baustelleIcon = L.divIcon({
  className: "",
  html: `<div style="
    width:36px;height:36px;
    background:#f59e0b;
    border:3px solid #92400e;
    border-radius:4px;
    display:flex;align-items:center;justify-content:center;
    font-size:17px;
    box-shadow:0 2px 8px rgba(0,0,0,0.4);
    transform:rotate(45deg);
  "><span style="transform:rotate(-45deg);display:block;line-height:1">🚧</span></div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});

const pendingIcon = L.divIcon({
  className: "",
  html: `<div style="
    width:30px;height:30px;
    background:#fde68a;
    border:2px dashed #92400e;
    border-radius:4px;
    display:flex;align-items:center;justify-content:center;
    font-size:14px;
    opacity:0.75;
    transform:rotate(45deg);
  "><span style="transform:rotate(-45deg);display:block;line-height:1">📍</span></div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

const VALHALLA = "https://valhalla1.openstreetmap.de";

function decodePolyline6(encoded) {
  const coords = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    for (const isLat of [true, false]) {
      let result = 0, shift = 0, b;
      do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1F) << shift; shift += 5; } while (b >= 0x20);
      const val = (result & 1) ? ~(result >> 1) : (result >> 1);
      if (isLat) lat += val; else lng += val;
    }
    coords.push([lat / 1e6, lng / 1e6]);
  }
  return coords;
}

async function snapToRoad(lat, lng) {
  const res = await fetch(`${VALHALLA}/locate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locations: [{ lat, lon: lng }], costing: "auto" }),
  });
  const data = await res.json();
  const edge = data[0].edges[0];
  return [edge.correlated_lat, edge.correlated_lon];
}

async function fetchRoute(start, end) {
  const res = await fetch(`${VALHALLA}/route`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      locations: [{ lat: start[0], lon: start[1] }, { lat: end[0], lon: end[1] }],
      costing: "auto",
      shape_format: "polyline6",
    }),
  });
  const data = await res.json();
  return decodePolyline6(data.trip.legs[0].shape);
}

// Fixed start/end for the demo simulation corridor (Charlottenburg → Brandenburger Tor area)
const SIM_START   = [52.5063, 13.2990];
const SIM_END     = [52.5163, 13.3777];
const SIM_ALT_VIA = [52.5260, 13.3420]; // northern bypass via Alt-Moabit

const CAR_SPEED = 0.0009;
const JAM_SPEED = 0.000055;

async function fetchRouteMulti(waypoints) {
  const res = await fetch(`${VALHALLA}/route`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      locations: waypoints.map(([lat, lon]) => ({ lat, lon })),
      costing: "auto",
      shape_format: "polyline6",
    }),
  });
  const data = await res.json();
  return data.trip.legs.flatMap((leg) => decodePolyline6(leg.shape));
}

function interpolateRoute(coords, t) {
  const clamped = Math.max(0, Math.min(1, t));
  const total = coords.length - 1;
  const pos = clamped * total;
  const idx = Math.min(Math.floor(pos), total - 1);
  const frac = pos - idx;
  const [lat1, lng1] = coords[idx];
  const [lat2, lng2] = coords[idx + 1];
  return [lat1 + (lat2 - lat1) * frac, lng1 + (lng2 - lng1) * frac];
}

function findClosestT(coords, [targetLat, targetLng]) {
  let minDist = Infinity;
  let bestT = 0;
  const total = coords.length - 1;
  for (let i = 0; i < total; i++) {
    const [lat1, lng1] = coords[i];
    const [lat2, lng2] = coords[i + 1];
    for (let f = 0; f <= 1; f += 0.1) {
      const lat = lat1 + (lat2 - lat1) * f;
      const lng = lng1 + (lng2 - lng1) * f;
      const dist = Math.sqrt((lat - targetLat) ** 2 + (lng - targetLng) ** 2);
      if (dist < minDist) { minDist = dist; bestT = (i + f) / total; }
    }
  }
  return { t: bestT, dist: minDist };
}

function initCars() {
  return Array.from({ length: 20 }, (_, i) => ({
    id: i,
    t: i / 20,
    route: "main",
    isJammed: false,
    decided: false,
  }));
}

const berlinSegments = [
  {
    id: 1,
    name: "A100 / Funkturm Corridor",
    type: "Motorway",
    coords: [
      [52.5038, 13.2788],
      [52.5058, 13.2848],
      [52.5068, 13.2916],
      [52.5063, 13.299],
      [52.5052, 13.3055],
    ],
    center: [52.5058, 13.29],
    baseCongestion: 78,
    baseCo2: 82,
    baseWear: 74,
    baseAccidentRisk: 61,
    weight: 1.15,
  },
  {
    id: 2,
    name: "Straße des 17. Juni",
    type: "Urban arterial",
    coords: [
      [52.5127, 13.322],
      [52.5134, 13.336],
      [52.5146, 13.3502],
      [52.5153, 13.362],
      [52.5163, 13.3777],
    ],
    center: [52.5146, 13.35],
    baseCongestion: 58,
    baseCo2: 56,
    baseWear: 47,
    baseAccidentRisk: 49,
    weight: 0.95,
  },
  {
    id: 3,
    name: "Tiergarten Tunnel / Potsdamer Platz Link",
    type: "Critical connector",
    coords: [
      [52.5146, 13.3502],
      [52.5133, 13.358],
      [52.5118, 13.366],
      [52.51, 13.372],
      [52.5095, 13.3763],
    ],
    center: [52.512, 13.363],
    baseCongestion: 64,
    baseCo2: 62,
    baseWear: 52,
    baseAccidentRisk: 58,
    weight: 1.0,
  },
  {
    id: 4,
    name: "Invalidenstraße / Hauptbahnhof Corridor",
    type: "Urban connector",
    coords: [
      [52.5272, 13.3508],
      [52.5276, 13.363],
      [52.5274, 13.3694],
      [52.5269, 13.382],
      [52.5261, 13.3945],
    ],
    center: [52.5274, 13.3694],
    baseCongestion: 54,
    baseCo2: 51,
    baseWear: 43,
    baseAccidentRisk: 46,
    weight: 0.9,
  },
  {
    id: 5,
    name: "Spree Bridge Segment",
    type: "Bridge",
    coords: [
      [52.5261, 13.368],
      [52.5252, 13.3692],
      [52.5243, 13.3708],
      [52.5233, 13.372],
    ],
    center: [52.5248, 13.37],
    baseCongestion: 49,
    baseCo2: 53,
    baseWear: 77,
    baseAccidentRisk: 44,
    weight: 1.2,
  },
];

const useCases = [
  "Baustellenplanung vor dem Start",
  "CO2 Berechnung",
  "Unfallrisikoreduktion",
  "Frühwarnsystem",
];

const weatherFactors = {
  Klar: 1,
  Regen: 1.12,
  Frost: 1.22,
};

const timeFactors = {
  Morgen: 1.18,
  Mittag: 1.0,
  Abend: 1.22,
  Nacht: 0.72,
};

const vehicleProfiles = [
  {
    id: "pkw",
    label: "PKW",
    kind: "car",
    minCount: 0,
    maxCount: 20000,
    countStep: 100,
    minWeight: 1,
    maxWeight: 3,
    weightStep: 0.1,
    defaultCount: 7000,
    defaultWeight: 1.6,
    congestionFactor: 1,
    emissionFactor: 0.9,
    wearFactor: 0.35,
    riskFactor: 0.92,
  },
  {
    id: "suv",
    label: "SUV",
    kind: "suv",
    minCount: 0,
    maxCount: 12000,
    countStep: 50,
    minWeight: 1.4,
    maxWeight: 4,
    weightStep: 0.1,
    defaultCount: 1800,
    defaultWeight: 2.1,
    congestionFactor: 1.05,
    emissionFactor: 1.05,
    wearFactor: 0.5,
    riskFactor: 0.97,
  },
  {
    id: "transporter",
    label: "Transporter",
    kind: "van",
    minCount: 0,
    maxCount: 8000,
    countStep: 50,
    minWeight: 1.8,
    maxWeight: 7.5,
    weightStep: 0.1,
    defaultCount: 700,
    defaultWeight: 3.2,
    congestionFactor: 1.1,
    emissionFactor: 1.18,
    wearFactor: 0.7,
    riskFactor: 1.02,
  },
  {
    id: "lkw",
    label: "LKW",
    kind: "truck",
    minCount: 0,
    maxCount: 6000,
    countStep: 50,
    minWeight: 8,
    maxWeight: 40,
    weightStep: 1,
    defaultCount: 1250,
    defaultWeight: 18,
    congestionFactor: 1.2,
    emissionFactor: 1.55,
    wearFactor: 1.9,
    riskFactor: 1.12,
  },
];

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
  const latDiff = a[0] - b[0];
  const lngDiff = a[1] - b[1];
  return Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
}

function formatNumberDe(value) {
  return new Intl.NumberFormat("de-DE").format(value);
}

function formatWeightDe(value) {
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: value % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 1,
  }).format(value);
}

function VehicleTypeIcon({ kind, active }) {
  const palette = active
    ? {
        body: "#0f172a",
        detail: "#f8fafc",
        wheel: "#1e293b",
      }
    : {
        body: "#64748b",
        detail: "#e2e8f0",
        wheel: "#94a3b8",
      };

  if (kind === "truck") {
    return (
      <svg viewBox="0 0 64 40" aria-hidden="true" className="h-7 w-11" fill="none">
        <rect x="4" y="11" width="29" height="15" rx="3" fill={palette.body} />
        <path d="M33 15h9l6 6v5H33V15Z" fill={palette.body} />
        <circle cx="18" cy="30" r="5" fill={palette.wheel} />
        <circle cx="43" cy="30" r="5" fill={palette.wheel} />
        <circle cx="18" cy="30" r="2.1" fill={palette.detail} />
        <circle cx="43" cy="30" r="2.1" fill={palette.detail} />
        <path
          d="M40 15v7h8"
          stroke={palette.detail}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (kind === "van") {
    return (
      <svg viewBox="0 0 64 40" aria-hidden="true" className="h-7 w-11" fill="none">
        <path
          d="M8 19c0-4.4 3.6-8 8-8h16c4.5 0 8.4 1.9 11.2 5.4l4.2 5.1V26H8v-7Z"
          fill={palette.body}
        />
        <circle cx="20" cy="30" r="5" fill={palette.wheel} />
        <circle cx="43" cy="30" r="5" fill={palette.wheel} />
        <circle cx="20" cy="30" r="2.1" fill={palette.detail} />
        <circle cx="43" cy="30" r="2.1" fill={palette.detail} />
        <path d="M34 13v9h10" stroke={palette.detail} strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }

  if (kind === "suv") {
    return (
      <svg viewBox="0 0 64 40" aria-hidden="true" className="h-7 w-11" fill="none">
        <path
          d="M9 23c0-4 3.2-7.2 7.2-7.2h10l6.2-5.3c1-.8 2.2-1.3 3.5-1.3h6.6c2.7 0 5.2 1.5 6.5 3.9L54 20v6H9v-3Z"
          fill={palette.body}
        />
        <circle cx="20" cy="30" r="5" fill={palette.wheel} />
        <circle cx="44" cy="30" r="5" fill={palette.wheel} />
        <circle cx="20" cy="30" r="2.1" fill={palette.detail} />
        <circle cx="44" cy="30" r="2.1" fill={palette.detail} />
        <path d="M31 13h11" stroke={palette.detail} strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 64 40" aria-hidden="true" className="h-7 w-11" fill="none">
      <path
        d="M9 23c0-4 3.2-7.2 7.2-7.2h11.8l5.6-4.9c1.2-1 2.6-1.6 4.1-1.6h7.2c2.5 0 4.8 1.4 5.9 3.6L54 20v6H9v-3Z"
        fill={palette.body}
      />
      <circle cx="20" cy="30" r="5" fill={palette.wheel} />
      <circle cx="44" cy="30" r="5" fill={palette.wheel} />
      <circle cx="20" cy="30" r="2.1" fill={palette.detail} />
      <circle cx="44" cy="30" r="2.1" fill={palette.detail} />
      <path d="M30 12.5h10.5" stroke={palette.detail} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function getConstructionImpactForSegment(segment, constructionSites, laneClosure) {
  if (!constructionSites.length) {
    return laneClosure ? 1.12 : 1;
  }

  let impact = laneClosure ? 1.12 : 1;

  constructionSites.forEach((site) => {
    const distance = distanceInDegrees(segment.center, site.center);

    if (distance < 0.008) {
      impact += 0.35;
    } else if (distance < 0.015) {
      impact += 0.22;
    } else if (distance < 0.025) {
      impact += 0.1;
    }
  });

  return impact;
}

function MapClickHandler({ active, isSnapping, onMapClick }) {
  useMapEvents({
    click(event) {
      if (active && !isSnapping) {
        const { lat, lng } = event.latlng;
        onMapClick([lat, lng]);
      }
    },
  });
  return null;
}

export default function RoadImpactBerlinMapMockup() {
  const [selectedUseCase, setSelectedUseCase] = useState("Baustellenplanung vor dem Start");
  const [selectedId, setSelectedId] = useState(1);
  const [selectedVehicleId, setSelectedVehicleId] = useState("pkw");
  const [vehicleMix, setVehicleMix] = useState(() =>
    vehicleProfiles.reduce((accumulator, profile) => {
      accumulator[profile.id] = {
        count: profile.defaultCount,
        avgWeight: profile.defaultWeight,
      };
      return accumulator;
    }, {})
  );
  const [laneClosure, setLaneClosure] = useState(true);
  const [weather, setWeather] = useState("Klar");
  const [timeOfDay, setTimeOfDay] = useState("Morgen");
  const [forecastWeeks, setForecastWeeks] = useState(3);
  const [mapView, setMapView] = useState("normal");

  // Baustellen state
  const [constructionSites, setConstructionSites] = useState([]);
  const [baustelleStep, setBaustelleStep] = useState(null); // null | 'start' | 'end'
  const [pendingStart, setPendingStart] = useState(null);
  const [isSnapping, setIsSnapping] = useState(false);

  const [simActive, setSimActive] = useState(false);
  const [cars, setCars] = useState([]);
  const [mainRoute, setMainRoute] = useState(null);
  const [altRoute, setAltRoute] = useState(null);
  const constructionSitesRef = useRef([]);
  const mainRouteRef = useRef(null);
  const altRouteRef = useRef(null);
  const intervalRef = useRef(null);

  useEffect(() => { constructionSitesRef.current = constructionSites; }, [constructionSites]);
  useEffect(() => { mainRouteRef.current = mainRoute; }, [mainRoute]);
  useEffect(() => { altRouteRef.current = altRoute; }, [altRoute]);

  useEffect(() => {
    fetchRouteMulti([SIM_START, SIM_END]).then(setMainRoute).catch(() => {});
    fetchRouteMulti([SIM_START, SIM_ALT_VIA, SIM_END]).then(setAltRoute).catch(() => {});
  }, []);

  useEffect(() => {
    if (!simActive) {
      clearInterval(intervalRef.current);
      setCars([]);
      return;
    }
    setCars(initCars());
    intervalRef.current = setInterval(() => {
      const sites = constructionSitesRef.current;
      const main = mainRouteRef.current;
      if (!main) return;

      // Compute jam zones: find where each Sperrung sits on the main route by t value
      const jamZones = sites.flatMap((site) => {
        const { t, dist } = findClosestT(main, site.center);
        return dist < 0.015 ? [{ center: t, half: 0.10 }] : [];
      });

      setCars((prev) =>
        prev.map((car) => {
          let { t, route, isJammed, decided } = car;

          if (jamZones.length > 0 && route === "main") {
            const approaching = !decided && jamZones.find(
              (z) => t > z.center - z.half - 0.13 && t < z.center - z.half
            );
            if (approaching) {
              if (car.id % 3 === 0) {
                return { ...car, route: "alt", t: 0, isJammed: false, decided: true };
              }
              return { ...car, decided: true };
            }
            const inJam = jamZones.some((z) => t >= z.center - z.half && t <= z.center + z.half);
            if (inJam) {
              isJammed = true;
              t += JAM_SPEED;
            } else {
              isJammed = false;
              t += CAR_SPEED;
            }
          } else {
            isJammed = false;
            t += CAR_SPEED;
          }

          if (t > 1) {
            return { ...car, t: t - 1, route: "main", isJammed: false, decided: false };
          }
          return { ...car, t, route, isJammed, decided };
        })
      );
    }, 80);
    return () => clearInterval(intervalRef.current);
  }, [simActive]);

  const removeConstructionSite = (id) => {
    setConstructionSites((prev) => prev.filter((site) => site.id !== id));
  };

  const updateSperrungDauer = (id, field, value) => {
    setConstructionSites((prev) =>
      prev.map((site) => (site.id === id ? { ...site, [field]: value } : site))
    );
  };

  const toggleSperrungType = (id) => {
    setConstructionSites((prev) =>
      prev.map((site) =>
        site.id === id
          ? { ...site, type: site.type === "teilsperrung" ? "vollsperrung" : "teilsperrung" }
          : site
      )
    );
  };

  const handleMapClick = async ([lat, lng]) => {
    setIsSnapping(true);
    try {
      const snapped = await snapToRoad(lat, lng);

      if (baustelleStep === "start") {
        setPendingStart(snapped);
        setBaustelleStep("end");
      } else if (baustelleStep === "end") {
        const routeCoords = await fetchRoute(pendingStart, snapped);
        const center = [
          (pendingStart[0] + snapped[0]) / 2,
          (pendingStart[1] + snapped[1]) / 2,
        ];
        setConstructionSites((prev) => [
          ...prev,
          {
            id: Date.now(),
            name: `Sperrung ${prev.length + 1}`,
            type: "teilsperrung",
            dauerValue: 1,
            dauerUnit: "Wochen",
            start: pendingStart,
            end: snapped,
            routeCoords,
            center,
          },
        ]);
        setBaustelleStep(null);
        setPendingStart(null);
      }
    } catch {
      // fallback: if OSRM fails, cancel placement
      setBaustelleStep(null);
      setPendingStart(null);
    } finally {
      setIsSnapping(false);
    }
  };

  const cancelPlacement = () => {
    setBaustelleStep(null);
    setPendingStart(null);
  };

  const weatherFactor = weatherFactors[weather];
  const timeFactor = timeFactors[timeOfDay];
  const selectedVehicleProfile =
    vehicleProfiles.find((profile) => profile.id === selectedVehicleId) ?? vehicleProfiles[0];
  const selectedVehicleValues = vehicleMix[selectedVehicleProfile.id];

  const updateVehicleMetric = (vehicleId, field, value) => {
    setVehicleMix((prev) => ({
      ...prev,
      [vehicleId]: {
        ...prev[vehicleId],
        [field]: value,
      },
    }));
  };

  const profileStats = vehicleProfiles.map((profile) => {
    const values = vehicleMix[profile.id];
    return {
      ...profile,
      count: values.count,
      avgWeight: values.avgWeight,
    };
  });

  const totalVehicles = profileStats.reduce((sum, profile) => sum + profile.count, 0);
  const weightedCongestionLoad = profileStats.reduce(
    (sum, profile) => sum + profile.count * profile.congestionFactor,
    0
  );
  const weightedEmissionLoad = profileStats.reduce((sum, profile) => {
    const weightRatio = profile.avgWeight / profile.defaultWeight;
    return sum + profile.count * profile.emissionFactor * weightRatio;
  }, 0);
  const weightedWearLoad = profileStats.reduce((sum, profile) => {
    const weightRatio = profile.avgWeight / profile.defaultWeight;
    return sum + profile.count * profile.wearFactor * weightRatio;
  }, 0);
  const weightedRiskLoad = profileStats.reduce(
    (sum, profile) => sum + profile.count * profile.riskFactor,
    0
  );

  const truckProfiles = profileStats.filter((profile) => profile.kind === "truck");
  const truckCount = truckProfiles.reduce((sum, profile) => sum + profile.count, 0);
  const truckWeightAverage = truckCount
    ? truckProfiles.reduce((sum, profile) => sum + profile.count * profile.avgWeight, 0) /
      truckCount
    : 0;
  const truckShare = totalVehicles > 0 ? truckCount / totalVehicles : 0;
  const totalTrafficFactor = Math.max(0.35, weightedCongestionLoad / 10250);
  const emissionsFactor =
    totalVehicles > 0 ? 0.78 + weightedEmissionLoad / totalVehicles / 2.4 : 0.78;
  const wearFactor = totalVehicles > 0 ? 0.72 + weightedWearLoad / totalVehicles : 0.72;
  const accidentMixFactor = totalVehicles > 0 ? weightedRiskLoad / totalVehicles : 0.92;

  const segments = useMemo(() => {
    return berlinSegments.map((segment) => {
      const constructionFactor =
        selectedUseCase === "Baustellenplanung vor dem Start"
          ? getConstructionImpactForSegment(segment, constructionSites, laneClosure)
          : laneClosure
            ? 1.12
            : 1;

      let congestion = segment.baseCongestion * totalTrafficFactor * timeFactor;
      let co2 = segment.baseCo2 * totalTrafficFactor * weatherFactor * emissionsFactor;
      let wear =
        segment.baseWear *
        totalTrafficFactor *
        wearFactor *
        (weather === "Frost" ? 1.16 : weather === "Regen" ? 1.08 : 1);
      let accidentRisk =
        segment.baseAccidentRisk *
        timeFactor *
        weatherFactor *
        accidentMixFactor;

      if (selectedUseCase === "Baustellenplanung vor dem Start") {
        congestion *= constructionFactor;
        wear *= constructionFactor;
        co2 *= 1 + (constructionFactor - 1) * 0.7;
        accidentRisk *= 1 + (constructionFactor - 1) * 0.35;
      }

      if (selectedUseCase === "CO2 Berechnung") {
        co2 *= laneClosure ? 1.12 : 1;
      }

      if (selectedUseCase === "Unfallrisikoreduktion") {
        accidentRisk *= laneClosure ? 1.18 : 1;
        congestion *= 1.05;
      }

      if (selectedUseCase === "Frühwarnsystem") {
        wear *= 1 + forecastWeeks * 0.05;
        congestion *= 1 + forecastWeeks * 0.03;
      }

      const congestionScore = Math.round(congestion * segment.weight);
      const co2Score = Math.round(co2 * segment.weight);
      const wearScore = Math.round(wear * segment.weight);
      const accidentScore = Math.round(accidentRisk * segment.weight);

      let combinedRisk = Math.round(
        congestionScore * 0.3 +
        co2Score * 0.15 +
        wearScore * 0.35 +
        accidentScore * 0.2
      );

      if (selectedUseCase === "CO2 Berechnung") {
        combinedRisk = Math.round(
          co2Score * 0.55 + congestionScore * 0.2 + wearScore * 0.25
        );
      }

      if (selectedUseCase === "Unfallrisikoreduktion") {
        combinedRisk = Math.round(
          accidentScore * 0.45 + congestionScore * 0.3 + wearScore * 0.25
        );
      }

      return {
        ...segment,
        congestionScore,
        co2Score,
        wearScore,
        accidentScore,
        combinedRisk,
        color: getRiskColor(combinedRisk),
        label: getRiskLabel(combinedRisk),
      };
    });
  }, [
    totalTrafficFactor,
    emissionsFactor,
    wearFactor,
    accidentMixFactor,
    timeFactor,
    weatherFactor,
    weather,
    laneClosure,
    selectedUseCase,
    forecastWeeks,
    constructionSites,
  ]);

  const selected = segments.find((segment) => segment.id === selectedId) || segments[0];

  const avgCongestion = Math.round(
    segments.reduce((sum, s) => sum + s.congestionScore, 0) / segments.length
  );
  const avgCo2 = Math.round(
    segments.reduce((sum, s) => sum + s.co2Score, 0) / segments.length
  );
  const avgWear = Math.round(
    segments.reduce((sum, s) => sum + s.wearScore, 0) / segments.length
  );
  const avgAccident = Math.round(
    segments.reduce((sum, s) => sum + s.accidentScore, 0) / segments.length
  );

  const recommendation = useMemo(() => {
    if (selectedUseCase === "Baustellenplanung vor dem Start") {
      return `Klicke auf die Karte, um Baustellen zu platzieren. Aktuell sind ${constructionSites.length} Baustellen gesetzt. Das Modell zeigt, wie Sperrungen oder Verengungen auf nahen Abschnitten Stau, CO2 und zusätzlichen Verschleiß erhöhen können.`;
    }
    if (selectedUseCase === "CO2 Berechnung") {
      return "Für diesen Abschnitt steigt die geschätzte CO2-Belastung unter höherem Verkehrsaufkommen deutlich an. Besonders relevant, wenn in der Nähe sensible Nutzungen wie Schulen oder Wohngebiete geplant sind.";
    }
    if (selectedUseCase === "Unfallrisikoreduktion") {
      return "Diese Zone zeigt unter aktueller Kombination aus Zeit, Wetter und Verkehrsaufkommen ein erhöhtes Unfallrisiko. Empfehlung: Temporeduktion, Warnhinweise oder temporäre Verkehrslenkung bewerten.";
    }
    return `In den nächsten ${forecastWeeks} Wochen könnte dieser Abschnitt zunehmend kritisch werden. Empfehlung: präventive Prüfung und priorisierte Beobachtung durch Kommune oder Straßenbehörde.`;
  }, [selectedUseCase, forecastWeeks, constructionSites.length]);

  const isBaustelleMode = selectedUseCase === "Baustellenplanung vor dem Start";

  return (
    <div className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-medium uppercase tracking-[0.2em] text-sky-700">
                RoadImpact AI
              </div>
              <h1 className="mt-2 text-3xl font-semibold">
                Interactive Berlin infrastructure simulator
              </h1>
              <p className="mt-2 max-w-3xl text-slate-600">
                OpenStreetMap-based mockup for simulating congestion, carbon dioxide,
                accident risk and road wear on critical corridors in Berlin.
              </p>
            </div>
            <div className="rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-800">
              Hackathon prototype · OpenStreetMap demo
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.45fr,430px]">
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-sm text-slate-500">Congestion</div>
                <div className="mt-2 text-4xl font-semibold">{avgCongestion}</div>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-sm text-slate-500">CO2</div>
                <div className="mt-2 text-4xl font-semibold">{avgCo2}</div>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-sm text-slate-500">Road wear</div>
                <div className="mt-2 text-4xl font-semibold">{avgWear}</div>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-sm text-slate-500">Accident risk</div>
                <div className="mt-2 text-4xl font-semibold">{avgAccident}</div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <div>
                  <h2 className="text-lg font-semibold">Interactive map · Berlin</h2>
                  <p className="text-sm text-slate-500">
                    {isBaustelleMode && baustelleStep === "start" && (
                      <span className="font-medium text-amber-600">Click on a road to set the start point of the Baustelle.</span>
                    )}
                    {isBaustelleMode && baustelleStep === "end" && (
                      <span className="font-medium text-amber-600">Now click the end point on a road.</span>
                    )}
                    {isBaustelleMode && isSnapping && (
                      <span className="text-slate-400">Snapping to road...</span>
                    )}
                    {(!isBaustelleMode || !baustelleStep) && !isSnapping && (
                      "Click a corridor to inspect details and scenario effects."
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 p-1">
                  {Object.entries(MAP_LAYERS).map(([key, layer]) => (
                    <button
                      key={key}
                      onClick={() => setMapView(key)}
                      className={`rounded-full px-4 py-1.5 text-xs font-medium transition ${
                        mapView === key
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      {layer.label}
                    </button>
                  ))}
                </div>
              </div>

              <div
                className="h-[650px]"
                style={{ cursor: baustelleStep && !isSnapping ? "crosshair" : "default" }}
              >
                <MapContainer
                  center={[52.516, 13.375]}
                  zoom={13}
                  scrollWheelZoom={true}
                  style={{ height: "100%", width: "100%" }}
                >
                  <TileLayer
                    attribution={MAP_LAYERS[mapView].attribution}
                    url={MAP_LAYERS[mapView].url}
                  />

                  <MapClickHandler
                    active={isBaustelleMode && !!baustelleStep}
                    isSnapping={isSnapping}
                    onMapClick={handleMapClick}
                  />

                  {/* Data segment dots */}
                  {segments.map((segment) => (
                    <CircleMarker
                      key={segment.id}
                      center={segment.center}
                      radius={selectedId === segment.id ? 10 : 7}
                      pathOptions={{
                        color: segment.color,
                        fillColor: segment.color,
                        fillOpacity: 0.8,
                      }}
                      eventHandlers={{
                        click: () => setSelectedId(segment.id),
                      }}
                    >
                      <Popup>
                        <div style={{ minWidth: 180 }}>
                          <strong>{segment.name}</strong>
                          <br />
                          Risk: {segment.combinedRisk}
                          <br />
                          Congestion: {segment.congestionScore}
                          <br />
                          CO2: {segment.co2Score}
                          <br />
                          Wear: {segment.wearScore}
                          <br />
                          Accident risk: {segment.accidentScore}
                        </div>
                      </Popup>
                    </CircleMarker>
                  ))}

                  {/* Construction sites */}
                  {constructionSites.map((site) => (
                    <Fragment key={site.id}>
                      <Polyline
                        positions={site.routeCoords}
                        pathOptions={{
                          color: site.type === "vollsperrung" ? "#dc2626" : "#f59e0b",
                          weight: 6,
                          opacity: 0.85,
                          dashArray: "10, 8",
                        }}
                      />
                      <Marker position={site.start} icon={baustelleIcon}>
                        <Popup>
                          <div style={{ minWidth: 160 }}>
                            <strong>{site.name}</strong>
                            <br />
                            <span style={{ fontSize: "0.8em", color: "#6b7280" }}>Start</span>
                            <br />
                            <button
                              onClick={() => removeConstructionSite(site.id)}
                              style={{
                                marginTop: "8px",
                                padding: "5px 10px",
                                border: "none",
                                borderRadius: "8px",
                                background: "#dc2626",
                                color: "white",
                                cursor: "pointer",
                                fontSize: "0.85em",
                              }}
                            >
                              Remove Baustelle
                            </button>
                          </div>
                        </Popup>
                      </Marker>
                      <Marker position={site.end} icon={baustelleIcon}>
                        <Popup>
                          <div style={{ minWidth: 160 }}>
                            <strong>{site.name}</strong>
                            <br />
                            <span style={{ fontSize: "0.8em", color: "#6b7280" }}>End</span>
                            <br />
                            <button
                              onClick={() => removeConstructionSite(site.id)}
                              style={{
                                marginTop: "8px",
                                padding: "5px 10px",
                                border: "none",
                                borderRadius: "8px",
                                background: "#dc2626",
                                color: "white",
                                cursor: "pointer",
                                fontSize: "0.85em",
                              }}
                            >
                              Remove Baustelle
                            </button>
                          </div>
                        </Popup>
                      </Marker>
                    </Fragment>
                  ))}

                  {/* Pending start marker while placing */}
                  {pendingStart && (
                    <Marker position={pendingStart} icon={pendingIcon} />
                  )}

                  {/* Car simulation route guides */}
                  {simActive && mainRoute && (
                    <Polyline
                      positions={mainRoute}
                      pathOptions={{ color: "#3b82f6", weight: 3, opacity: 0.2, dashArray: "6 4" }}
                    />
                  )}
                  {simActive && altRoute && (
                    <Polyline
                      positions={altRoute}
                      pathOptions={{ color: "#f59e0b", weight: 3, opacity: 0.2, dashArray: "6 4" }}
                    />
                  )}

                  {/* Moving cars */}
                  {cars.map((car) => {
                    const coords = car.route === "alt" ? altRoute : mainRoute;
                    if (!coords) return null;
                    const pos = interpolateRoute(coords, car.t);
                    const color = car.isJammed ? "#dc2626" : car.route === "alt" ? "#f59e0b" : "#3b82f6";
                    return (
                      <CircleMarker
                        key={car.id}
                        center={pos}
                        radius={4}
                        pathOptions={{ color, fillColor: color, fillOpacity: 0.9, weight: 1 }}
                      />
                    );
                  })}

                  <CircleMarker
                    center={[52.514, 13.352]}
                    radius={6}
                    pathOptions={{
                      color: "#0f172a",
                      fillColor: "#0f172a",
                      fillOpacity: 0.85,
                    }}
                  >
                    <Popup>Reference area: Tiergarten / Berlin center</Popup>
                  </CircleMarker>
                </MapContainer>
              </div>

              <div className="border-t border-slate-200 bg-white px-5 py-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                      Selected segment
                    </div>
                    <div className="mt-1 text-lg font-semibold">{selected.name}</div>
                    <div className="text-sm text-slate-500">{selected.type}</div>
                  </div>

                  <div className="flex flex-wrap gap-3 text-sm">
                    <div className="rounded-2xl bg-slate-100 px-3 py-2">
                      Congestion: <span className="font-semibold">{selected.congestionScore}</span>
                    </div>
                    <div className="rounded-2xl bg-slate-100 px-3 py-2">
                      CO2: <span className="font-semibold">{selected.co2Score}</span>
                    </div>
                    <div className="rounded-2xl bg-slate-100 px-3 py-2">
                      Wear: <span className="font-semibold">{selected.wearScore}</span>
                    </div>
                    <div className="rounded-2xl bg-slate-100 px-3 py-2">
                      Accident risk: <span className="font-semibold">{selected.accidentScore}</span>
                    </div>
                    <div className="rounded-2xl bg-slate-900 px-3 py-2 text-white">
                      Risk: <span className="font-semibold">{selected.combinedRisk}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold">Scenario controls</h2>

              <div className="mt-5 space-y-5">
                <div>
                  <label className="text-sm font-medium text-slate-700">Use case</label>
                  <select
                    value={selectedUseCase}
                    onChange={(event) => {
                      setSelectedUseCase(event.target.value);
                      cancelPlacement();
                    }}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none"
                  >
                    {useCases.map((useCase) => (
                      <option key={useCase}>{useCase}</option>
                    ))}
                  </select>
                </div>

                {isBaustelleMode && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium text-amber-900">Sperrungen</div>
                        <div className="text-xs text-amber-700">
                          {constructionSites.length} gesetzt
                        </div>
                      </div>
                      {!baustelleStep ? (
                        <button
                          onClick={() => setBaustelleStep("start")}
                          className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 transition"
                        >
                          + Add Sperrung
                        </button>
                      ) : (
                        <button
                          onClick={cancelPlacement}
                          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition"
                        >
                          Cancel
                        </button>
                      )}
                    </div>

                    {baustelleStep && (
                      <div className="flex items-center gap-2 text-xs text-amber-800">
                        <span className={`flex h-5 w-5 items-center justify-center rounded-full text-white text-[10px] font-bold ${baustelleStep === "start" ? "bg-amber-500" : "bg-green-500"}`}>
                          {baustelleStep === "start" ? "1" : "✓"}
                        </span>
                        <span>Start</span>
                        <span className="mx-1 text-amber-300">—</span>
                        <span className={`flex h-5 w-5 items-center justify-center rounded-full text-white text-[10px] font-bold ${baustelleStep === "end" ? "bg-amber-500" : "bg-amber-200 text-amber-600"}`}>
                          2
                        </span>
                        <span>End</span>
                        {isSnapping && (
                          <span className="ml-2 text-amber-600 italic">snapping...</span>
                        )}
                      </div>
                    )}

                    {constructionSites.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        {constructionSites.map((site) => (
                          <div key={site.id} className="rounded-xl bg-white border border-amber-200 px-3 py-2 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-amber-900">🚧 {site.name}</span>
                              <button
                                onClick={() => removeConstructionSite(site.id)}
                                className="text-xs text-red-400 hover:text-red-600"
                              >
                                Remove
                              </button>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-slate-600">
                              <span className="font-medium text-amber-900">Dauer:</span>
                              <input
                                type="number"
                                min="1"
                                max="99"
                                value={site.dauerValue}
                                onChange={(e) => updateSperrungDauer(site.id, "dauerValue", Math.max(1, Number(e.target.value)))}
                                className="w-12 rounded-lg border border-slate-200 bg-white px-2 py-1 text-center text-xs font-medium outline-none focus:border-amber-400"
                              />
                              <select
                                value={site.dauerUnit}
                                onChange={(e) => updateSperrungDauer(site.id, "dauerUnit", e.target.value)}
                                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium outline-none focus:border-amber-400"
                              >
                                <option>Tage</option>
                                <option>Wochen</option>
                                <option>Monate</option>
                              </select>
                            </div>
                            <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 p-0.5 w-fit">
                              {["teilsperrung", "vollsperrung"].map((t) => (
                                <button
                                  key={t}
                                  onClick={() => toggleSperrungType(site.id)}
                                  className={`rounded-full px-3 py-1 text-[11px] font-medium transition capitalize ${
                                    site.type === t
                                      ? t === "vollsperrung"
                                        ? "bg-red-500 text-white shadow-sm"
                                        : "bg-white text-slate-900 shadow-sm"
                                      : "text-slate-400 hover:text-slate-600"
                                  }`}
                                >
                                  {t === "teilsperrung" ? "Teilsperrung" : "Vollsperrung"}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
                    <div className="text-base font-semibold text-slate-900">Fahrzeug &amp; Flotte</div>
                    <div className="mt-1 text-xs text-slate-500">Mehrere Typen gleichzeitig im Mix</div>

                    <div className="mt-4 grid grid-cols-4 gap-2">
                      {vehicleProfiles.map((profile) => {
                        const active = selectedVehicleId === profile.id;
                        return (
                          <button
                            key={profile.id}
                            onClick={() => setSelectedVehicleId(profile.id)}
                            className={`rounded-2xl border p-3 text-center transition ${
                              active
                                ? "border-sky-300 bg-white shadow-sm ring-1 ring-sky-200"
                                : "border-slate-200 bg-white hover:border-slate-300"
                            }`}
                            title={profile.label}
                          >
                            <div className="flex justify-center">
                              <VehicleTypeIcon kind={profile.kind} active={active} />
                            </div>
                            <div
                              className={`mt-2 text-[11px] font-medium ${
                                active ? "text-slate-900" : "text-slate-500"
                              }`}
                            >
                              {profile.label}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-5">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-slate-700">
                          Anzahl {selectedVehicleProfile.label}
                        </label>
                        <span className="rounded-xl border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-900">
                          {formatNumberDe(selectedVehicleValues.count)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={selectedVehicleProfile.minCount}
                        max={selectedVehicleProfile.maxCount}
                        step={selectedVehicleProfile.countStep}
                        value={selectedVehicleValues.count}
                        onChange={(event) =>
                          updateVehicleMetric(
                            selectedVehicleProfile.id,
                            "count",
                            Number(event.target.value)
                          )
                        }
                        className="mt-3 w-full"
                      />
                    </div>

                    <div className="mt-5">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-slate-700">
                          Durchschnittsgewicht {selectedVehicleProfile.label} (t)
                        </label>
                        <span className="rounded-xl border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-900">
                          {formatWeightDe(selectedVehicleValues.avgWeight)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={selectedVehicleProfile.minWeight}
                        max={selectedVehicleProfile.maxWeight}
                        step={selectedVehicleProfile.weightStep}
                        value={selectedVehicleValues.avgWeight}
                        onChange={(event) =>
                          updateVehicleMetric(
                            selectedVehicleProfile.id,
                            "avgWeight",
                            Number(event.target.value)
                          )
                        }
                        className="mt-3 w-full"
                      />
                    </div>

                    <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-xs text-slate-500">
                      Aktiver Mix: {formatNumberDe(totalVehicles)} Fahrzeuge, davon{" "}
                      {truckShare > 0 ? Math.round(truckShare * 100) : 0}% schwere Fahrzeuge bei{" "}
                      {formatWeightDe(truckWeightAverage)} t Durchschnittsgewicht.
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-slate-700">Weather</label>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {["Klar", "Regen", "Frost"].map((item) => (
                      <button
                        key={item}
                        onClick={() => setWeather(item)}
                        className={`rounded-2xl border px-3 py-3 text-sm transition ${
                          weather === item
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-200 bg-slate-50 text-slate-700"
                        }`}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-slate-700">Time of day</label>
                  <select
                    value={timeOfDay}
                    onChange={(event) => setTimeOfDay(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none"
                  >
                    <option>Morgen</option>
                    <option>Mittag</option>
                    <option>Abend</option>
                    <option>Nacht</option>
                  </select>
                </div>

                <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium text-slate-700">
                      Lane closure / narrowing
                    </div>
                    <div className="text-xs text-slate-500">
                      Relevant for construction and rerouting scenarios
                    </div>
                  </div>
                  <button
                    onClick={() => setLaneClosure(!laneClosure)}
                    className={`relative h-7 w-12 rounded-full transition ${
                      laneClosure ? "bg-sky-600" : "bg-slate-300"
                    }`}
                  >
                    <span
                      className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${
                        laneClosure ? "left-6" : "left-1"
                      }`}
                    />
                  </button>
                </div>

                {selectedUseCase === "Frühwarnsystem" && (
                  <div>
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-slate-700">
                        Forecast horizon
                      </label>
                      <span className="text-sm font-semibold text-slate-900">
                        {forecastWeeks} weeks
                      </span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="8"
                      value={forecastWeeks}
                      onChange={(event) => setForecastWeeks(Number(event.target.value))}
                      className="mt-3 w-full"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold">Recommendation</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">{recommendation}</p>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold">Verkehrssimulation</h2>
              <p className="mt-2 text-xs text-slate-500">
                Fahrzeuge als Punkte auf echten Straßen — Sperrung setzen um Stau und Umweg zu sehen.
              </p>
              {!mainRoute && (
                <p className="mt-2 text-xs text-amber-600">Routen werden geladen…</p>
              )}
              <button
                disabled={!mainRoute}
                onClick={() => setSimActive((v) => !v)}
                className={`mt-4 w-full rounded-2xl px-4 py-3 text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed ${
                  simActive
                    ? "bg-red-500 text-white hover:bg-red-600"
                    : "bg-sky-600 text-white hover:bg-sky-700"
                }`}
              >
                {simActive ? "Simulation stoppen" : "Simulation starten"}
              </button>
              {simActive && (
                <div className="mt-3 flex gap-4 text-xs text-slate-600">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-500" /> Normal
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" /> Stau
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400" /> Umweg
                  </span>
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Critical infrastructure view</h2>
                <span className="text-sm text-slate-500">Ranked by risk</span>
              </div>

              <div className="mt-4 space-y-3">
                {[...segments]
                  .sort((a, b) => b.combinedRisk - a.combinedRisk)
                  .map((segment) => (
                    <button
                      key={segment.id}
                      onClick={() => setSelectedId(segment.id)}
                      className={`w-full rounded-2xl border p-4 text-left transition ${
                        selectedId === segment.id
                          ? "border-sky-300 bg-sky-50"
                          : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium">{segment.name}</div>
                          <div className="mt-1 text-sm text-slate-500">
                            Priority score: {segment.combinedRisk}
                          </div>
                        </div>
                        <span
                          className={`rounded-full border px-3 py-1 text-xs font-medium ${badgeClass(
                            segment.label
                          )}`}
                        >
                          {segment.label}
                        </span>
                      </div>
                    </button>
                  ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
