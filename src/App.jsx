import React, { useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Polyline,
  Popup,
  CircleMarker,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

const berlinSegments = [
  {
    // A100 (Stadtring) westlicher Bogen nahe Funkturm/Dreieck Funkturm
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
    // Straße des 17. Juni – Ernst-Reuter-Platz bis Brandenburger Tor
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
    // Tiergartentunnel / Ebertstraße – Großer Stern Richtung Potsdamer Platz
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
    // Invalidenstraße – westlich Hbf bis Alt-Moabit Kreuzung
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
    // Moltkebrücke / Spree – Überquerung nahe Hauptbahnhof
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

function getConstructionImpactForSegment(segment, constructionSites, laneClosure) {
  if (!constructionSites.length) {
    return laneClosure ? 1.12 : 1;
  }

  let impact = laneClosure ? 1.12 : 1;

  constructionSites.forEach((site) => {
    const distance = distanceInDegrees(segment.center, site.position);

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

function MapClickHandler({ selectedUseCase, onAddConstruction }) {
  useMapEvents({
    click(event) {
      if (selectedUseCase === "Baustellenplanung vor dem Start") {
        const { lat, lng } = event.latlng;
        onAddConstruction([lat, lng]);
      }
    },
  });

  return null;
}

function ConstructionSiteMarker({ site, onRemove }) {
  return (
    <CircleMarker
      center={site.position}
      radius={9}
      pathOptions={{
        color: "#b91c1c",
        fillColor: "#ef4444",
        fillOpacity: 0.85,
        weight: 2,
      }}
    >
      <Popup>
        <div style={{ minWidth: 180 }}>
          <strong>{site.name}</strong>
          <br />
          Geplante Baustelle
          <br />
          <button
            onClick={() => onRemove(site.id)}
            style={{
              marginTop: "8px",
              padding: "6px 10px",
              border: "none",
              borderRadius: "8px",
              background: "#dc2626",
              color: "white",
              cursor: "pointer",
            }}
          >
            Entfernen
          </button>
        </div>
      </Popup>
    </CircleMarker>
  );
}

export default function RoadImpactBerlinMapMockup() {
  const [selectedUseCase, setSelectedUseCase] = useState("Baustellenplanung vor dem Start");
  const [selectedId, setSelectedId] = useState(1);
  const [truckTraffic, setTruckTraffic] = useState(60);
  const [laneClosure, setLaneClosure] = useState(true);
  const [weather, setWeather] = useState("Klar");
  const [timeOfDay, setTimeOfDay] = useState("Morgen");
  const [forecastWeeks, setForecastWeeks] = useState(3);
  const [constructionSites, setConstructionSites] = useState([
    {
      id: 1,
      name: "Test-Baustelle A100",
      position: [52.5058, 13.29],
    },
  ]);

  const addConstructionSite = (position) => {
    setConstructionSites((prev) => [
      ...prev,
      {
        id: Date.now(),
        name: `Baustelle ${prev.length + 1}`,
        position,
      },
    ]);
  };

  const removeConstructionSite = (id) => {
    setConstructionSites((prev) => prev.filter((site) => site.id !== id));
  };

  const weatherFactor = weatherFactors[weather];
  const timeFactor = timeFactors[timeOfDay];
  const trafficFactor = truckTraffic / 60;

  const segments = useMemo(() => {
    return berlinSegments.map((segment) => {
      const constructionFactor =
        selectedUseCase === "Baustellenplanung vor dem Start"
          ? getConstructionImpactForSegment(segment, constructionSites, laneClosure)
          : laneClosure
            ? 1.12
            : 1;

      let congestion = segment.baseCongestion * trafficFactor * timeFactor;
      let co2 = segment.baseCo2 * trafficFactor * weatherFactor;
      let wear =
        segment.baseWear *
        trafficFactor *
        (weather === "Frost" ? 1.16 : weather === "Regen" ? 1.08 : 1);
      let accidentRisk = segment.baseAccidentRisk * timeFactor * weatherFactor;

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
    truckTraffic,
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
                    Click a corridor to inspect details and scenario effects.
                    {selectedUseCase === "Baustellenplanung vor dem Start"
                      ? " Click on the map to add construction sites."
                      : ""}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-100 px-3 py-2 text-xs font-medium text-slate-600">
                  OpenStreetMap
                </div>
              </div>

              <div className="h-[650px]">
                <MapContainer
                  center={[52.516, 13.375]}
                  zoom={13}
                  scrollWheelZoom={true}
                  style={{ height: "100%", width: "100%" }}
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />

                  <MapClickHandler
                    selectedUseCase={selectedUseCase}
                    onAddConstruction={addConstructionSite}
                  />

                  {segments.map((segment) => (
                    <React.Fragment key={segment.id}>
                      <Polyline
                        positions={segment.coords}
                        pathOptions={{
                          color: segment.color,
                          weight: selectedId === segment.id ? 10 : 7,
                          opacity: 0.9,
                        }}
                        eventHandlers={{
                          click: () => setSelectedId(segment.id),
                        }}
                      />
                      <CircleMarker
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
                    </React.Fragment>
                  ))}

                  {constructionSites.map((site) => (
                    <ConstructionSiteMarker
                      key={site.id}
                      site={site}
                      onRemove={removeConstructionSite}
                    />
                  ))}

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
                    onChange={(event) => setSelectedUseCase(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none"
                  >
                    {useCases.map((useCase) => (
                      <option key={useCase}>{useCase}</option>
                    ))}
                  </select>
                </div>

                {selectedUseCase === "Baustellenplanung vor dem Start" && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-sm font-medium text-slate-700">Baustellen auf Karte</div>
                    <div className="text-xs text-slate-500">
                      Aktuell gesetzt: {constructionSites.length}
                    </div>
                    <div className="mt-2 text-xs text-slate-500">
                      Klicke auf die Karte, um eine neue Baustelle zu platzieren.
                    </div>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-slate-700">
                      Truck traffic intensity
                    </label>
                    <span className="text-sm font-semibold text-slate-900">{truckTraffic}%</span>
                  </div>
                  <input
                    type="range"
                    min="20"
                    max="100"
                    value={truckTraffic}
                    onChange={(event) => setTruckTraffic(Number(event.target.value))}
                    className="mt-3 w-full"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-slate-700">Weather</label>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {["Klar", "Regen", "Frost"].map((item) => (
                      <button
                        key={item}
                        onClick={() => setWeather(item)}
                        className={`rounded-2xl border px-3 py-3 text-sm transition ${weather === item
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
                    className={`relative h-7 w-12 rounded-full transition ${laneClosure ? "bg-sky-600" : "bg-slate-300"
                      }`}
                  >
                    <span
                      className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${laneClosure ? "left-6" : "left-1"
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
                      className={`w-full rounded-2xl border p-4 text-left transition ${selectedId === segment.id
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