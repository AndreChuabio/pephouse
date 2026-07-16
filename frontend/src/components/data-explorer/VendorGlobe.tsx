import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Icon } from "@iconify/react";
import * as THREE from "three";

type Vendor = {
  id?: number;
  name?: string;
  country?: string | null;
  source_type?: string;
  reliability_score?: number;
  finnrick_rating?: string | null;
  manufacturer?: string | null;
  third_party_tested?: boolean;
  gmp_certified?: boolean;
};

const SOURCE_LABEL: Record<string, string> = {
  compounding_pharmacy: "Compounding pharmacy",
  vendor_tested: "Gray-market, lab-tested",
  gray_market: "Gray-market, untested",
  research_chem: "Research chemical",
  brand: "Brand / pharma-grade",
};

// Source trust ramp, recolored to the Instrument system: pharma-grade origins
// read as an independently measured fact (teal), gray-market origins as the
// brand's caution voice (amber), and research chemicals as neutral/unknown.
type SourceTone = "verified" | "caution" | "neutral";

const SOURCE_TONE: Record<string, SourceTone> = {
  compounding_pharmacy: "verified",
  brand: "verified",
  vendor_tested: "caution",
  gray_market: "caution",
  research_chem: "neutral",
};

const TONE_CLASS: Record<SourceTone, string> = {
  verified: "bg-measured/10 text-measured border-measured/30",
  caution: "bg-signal/10 text-signal border-signal/30",
  neutral: "bg-surface text-faint border-line",
};

function Badge({ tone, children }: { tone: SourceTone; children: React.ReactNode }) {
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-[10px] font-medium border uppercase tracking-wider whitespace-nowrap shrink-0 ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

const EARTH_TEXTURE_URL = "https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg";

const COUNTRY_COORDS: Record<string, [number, number]> = {
  "united states": [39.8283, -98.5795],
  usa: [39.8283, -98.5795],
  us: [39.8283, -98.5795],
  "u.s.": [39.8283, -98.5795],
  "u.s.a.": [39.8283, -98.5795],
  america: [39.8283, -98.5795],
  canada: [56.1304, -106.3468],
  mexico: [23.6345, -102.5528],
  brazil: [-14.235, -51.9253],
  argentina: [-38.4161, -63.6167],
  "united kingdom": [54.7584, -2.6918],
  uk: [54.7584, -2.6918],
  "great britain": [54.7584, -2.6918],
  england: [52.3555, -1.1743],
  ireland: [53.4129, -8.2439],
  france: [46.6034, 1.8883],
  germany: [51.1657, 10.4515],
  netherlands: [52.1326, 5.2913],
  belgium: [50.5039, 4.4699],
  spain: [40.4637, -3.7492],
  portugal: [39.3999, -8.2245],
  italy: [41.8719, 12.5674],
  switzerland: [46.8182, 8.2275],
  austria: [47.5162, 14.5501],
  denmark: [56.2639, 9.5018],
  sweden: [60.1282, 18.6435],
  norway: [60.472, 8.4689],
  finland: [61.9241, 25.7482],
  poland: [51.9194, 19.1451],
  "czech republic": [49.8175, 15.473],
  czechia: [49.8175, 15.473],
  hungary: [47.1625, 19.5033],
  greece: [39.0742, 21.8243],
  turkey: [38.9637, 35.2433],
  russia: [61.524, 105.3188],
  ukraine: [48.3794, 31.1656],
  romania: [45.9432, 24.9668],
  bulgaria: [42.7339, 25.4858],
  israel: [31.0461, 34.8516],
  iran: [32.4279, 53.688],
  iraq: [33.2232, 43.6793],
  "saudi arabia": [23.8859, 45.0792],
  uae: [23.4241, 53.8478],
  "united arab emirates": [23.4241, 53.8478],
  india: [20.5937, 78.9629],
  pakistan: [30.3753, 69.3451],
  bangladesh: [23.685, 90.3563],
  china: [35.8617, 104.1954],
  "hong kong": [22.3193, 114.1694],
  taiwan: [23.6978, 120.9605],
  japan: [36.2048, 138.2529],
  "south korea": [35.9078, 127.7669],
  korea: [35.9078, 127.7669],
  "north korea": [40.3399, 127.5101],
  vietnam: [14.0583, 108.2772],
  thailand: [15.87, 100.9925],
  malaysia: [4.2105, 101.9758],
  singapore: [1.3521, 103.8198],
  indonesia: [-0.7893, 113.9213],
  philippines: [12.8797, 121.774],
  australia: [-25.2744, 133.7751],
  "new zealand": [-40.9006, 174.886],
  "south africa": [-30.5595, 22.9375],
  egypt: [26.0975, 30.0444],
  nigeria: [9.082, 8.6753],
  kenya: [-0.0236, 37.9062],
  morocco: [31.7917, -7.0926],
  algeria: [28.0339, 1.6596],
  chile: [-35.6751, -71.543],
  colombia: [4.5709, -74.2973],
  peru: [-9.19, -75.0152],
};

function normalize(c: string): string {
  return c
    .toLowerCase()
    .trim()
    .replace(/[,].*$/, "")
    .replace(/\([^)]*\)/g, "")
    .trim();
}

function coordsFor(country?: string | null): [number, number] | null {
  if (!country) return null;
  const key = normalize(country);
  if (COUNTRY_COORDS[key]) return COUNTRY_COORDS[key];
  for (const k of Object.keys(COUNTRY_COORDS)) {
    if (key.includes(k) || k.includes(key)) return COUNTRY_COORDS[k];
  }
  return null;
}

// Equirectangular projection: lat/lon → unit sphere vector. The texture's
// seam sits at lon=180 with the default mapping; we offset by π to align
// landmasses correctly under the Blue Marble texture.
function latLonToVec3(lat: number, lon: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

function EarthSphere() {
  const texture = useLoader(THREE.TextureLoader, EARTH_TEXTURE_URL, (loader) => {
    loader.setCrossOrigin("anonymous");
  });
  texture.colorSpace = THREE.SRGBColorSpace;
  return (
    <mesh>
      <sphereGeometry args={[1, 96, 96]} />
      <meshStandardMaterial map={texture} roughness={0.9} metalness={0} />
    </mesh>
  );
}

function FallbackSphere() {
  return (
    <mesh>
      <sphereGeometry args={[1, 64, 64]} />
      <meshStandardMaterial color="#1c2a32" roughness={0.95} metalness={0} />
    </mesh>
  );
}

function Atmosphere() {
  return (
    <mesh scale={1.04}>
      <sphereGeometry args={[1, 64, 64]} />
      <meshBasicMaterial
        color="#3a7ab0"
        transparent
        opacity={0.12}
        side={THREE.BackSide}
        depthWrite={false}
      />
    </mesh>
  );
}

function Marker({ position, pulseSeed }: { position: THREE.Vector3; pulseSeed: number }) {
  const haloRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!haloRef.current) return;
    const t = clock.getElapsedTime() + pulseSeed;
    const s = 1 + 0.45 * (0.5 + 0.5 * Math.sin(t * 1.8));
    haloRef.current.scale.setScalar(s);
    const mat = haloRef.current.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.55 - 0.35 * (0.5 + 0.5 * Math.sin(t * 1.8));
  });
  return (
    <group position={position}>
      <mesh>
        <sphereGeometry args={[0.02, 16, 16]} />
        {/* --color-measured: an independently measured data point on the globe. */}
        <meshBasicMaterial color="#46d6bd" />
      </mesh>
      <mesh ref={haloRef}>
        <sphereGeometry args={[0.032, 16, 16]} />
        <meshBasicMaterial color="#46d6bd" transparent opacity={0.45} />
      </mesh>
    </group>
  );
}

function ControlledGlobeGroup({
  targetRotationY,
  children,
}: {
  targetRotationY: number | null;
  children: React.ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (!ref.current) return;
    if (targetRotationY === null) {
      ref.current.rotation.y += delta * 0.08;
      return;
    }
    const cur = ref.current.rotation.y;
    let diff = targetRotationY - cur;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    ref.current.rotation.y = cur + diff * Math.min(1, delta * 3);
  });
  return <group ref={ref}>{children}</group>;
}

export function VendorGlobe({ vendors, compoundName }: { vendors: Vendor[]; compoundName: string }) {
  const [activeCountry, setActiveCountry] = useState<string | null>(null);

  useEffect(() => {
    setActiveCountry(null);
  }, [vendors]);

  const { markers, byCountry, unmapped } = useMemo(() => {
    const counts = new Map<string, { count: number; coords: [number, number]; display: string }>();
    let unmapped = 0;
    for (const v of vendors) {
      const coords = coordsFor(v.country);
      if (!coords) {
        if (v.country) unmapped++;
        continue;
      }
      const display = v.country!.trim();
      const key = normalize(display);
      const prev = counts.get(key);
      if (prev) prev.count += 1;
      else counts.set(key, { count: 1, coords, display });
    }
    const list = Array.from(counts.values()).sort((a, b) => b.count - a.count);
    const markers = list.map((c, i) => ({
      position: latLonToVec3(c.coords[0], c.coords[1], 1.01),
      pulseSeed: i * 0.7,
    }));
    return { markers, byCountry: list, unmapped };
  }, [vendors]);

  const vendorTotal = vendors.length;
  const countryTotal = byCountry.length;

  const activeVendors = useMemo(() => {
    if (!activeCountry) return [];
    const key = normalize(activeCountry);
    return vendors.filter((v) => v.country && normalize(v.country) === key);
  }, [activeCountry, vendors]);

  const targetRotationY = useMemo<number | null>(() => {
    if (!activeCountry) return null;
    const entry = byCountry.find((c) => c.display === activeCountry);
    if (!entry) return null;
    const pos = latLonToVec3(entry.coords[0], entry.coords[1], 1);
    return Math.atan2(-pos.x, pos.z);
  }, [activeCountry, byCountry]);

  return (
    <div className="bg-surface/30 border border-line rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center gap-2 flex-wrap">
        <Icon icon="solar:global-linear" className="text-signal" />
        <h3 className="eyebrow !text-muted">Global Sourcing</h3>
        <span className="text-xs text-faint">
          {compoundName} &middot; <span className="readout">{vendorTotal}</span> vendor
          {vendorTotal === 1 ? "" : "s"} across <span className="readout">{countryTotal}</span>{" "}
          countr{countryTotal === 1 ? "y" : "ies"}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] items-stretch">
        <div
          className="relative w-full"
          style={{
            aspectRatio: "1 / 1",
            maxHeight: 380,
            background: "radial-gradient(circle at center, #0c1015 0%, #050608 70%)",
          }}
        >
          <Canvas
            camera={{ position: [0, 0, 2.6], fov: 45 }}
            gl={{ antialias: true, alpha: true }}
            dpr={[1, 2]}
          >
            <ambientLight intensity={0.6} />
            <directionalLight position={[5, 3, 5]} intensity={1.2} />
            <ControlledGlobeGroup targetRotationY={targetRotationY}>
              <Suspense fallback={<FallbackSphere />}>
                <EarthSphere />
              </Suspense>
              {markers.map((m, i) => (
                <Marker key={i} position={m.position} pulseSeed={m.pulseSeed} />
              ))}
            </ControlledGlobeGroup>
            <Atmosphere />
            <OrbitControls
              enablePan={false}
              enableZoom={false}
              rotateSpeed={0.4}
              minPolarAngle={Math.PI / 4}
              maxPolarAngle={(3 * Math.PI) / 4}
            />
          </Canvas>
          {markers.length === 0 && (
            <div className="absolute inset-x-0 bottom-3 flex items-center justify-center pointer-events-none">
              <p className="text-xs text-faint italic bg-base/60 px-2 py-1 rounded">
                no mapped vendor origins
              </p>
            </div>
          )}

          {activeCountry && (
            <div className="absolute bottom-3 left-3 right-3 md:right-auto md:max-w-xs z-10 bg-base/95 border border-line rounded-lg shadow-2xl backdrop-blur-md p-3 animate-in fade-in duration-150">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Icon icon="solar:map-point-linear" className="text-measured/80 shrink-0" />
                  <h4 className="font-display tracking-tight text-sm font-semibold text-ink truncate">
                    {activeCountry}
                  </h4>
                  <span className="readout text-[10px] text-faint shrink-0">
                    {activeVendors.length} vendor{activeVendors.length === 1 ? "" : "s"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveCountry(null)}
                  className="text-faint hover:text-ink shrink-0 -m-1 p-1"
                  aria-label="Close"
                >
                  <Icon icon="solar:close-circle-linear" className="text-base" />
                </button>
              </div>
              <ul className="space-y-1.5 max-h-48 overflow-y-auto">
                {activeVendors.map((v) => (
                  <li key={v.id ?? v.name} className="flex items-center gap-2 text-xs">
                    <Badge tone={SOURCE_TONE[v.source_type ?? ""] ?? "neutral"}>
                      {SOURCE_LABEL[v.source_type ?? ""] ?? v.source_type ?? "unknown"}
                    </Badge>
                    <span className="font-display tracking-tight text-ink truncate flex-1">
                      {v.name}
                    </span>
                    {v.reliability_score != null && (
                      <span className="readout text-faint shrink-0">{v.reliability_score}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="border-t md:border-t-0 md:border-l border-line p-3 space-y-1 max-h-[380px] overflow-y-auto">
          <p className="eyebrow px-1 pb-1">Vendors &amp; Sellers</p>
          {vendors.length === 0 ? (
            <p className="text-xs text-faint italic px-1">none</p>
          ) : (
            vendors.map((v) => {
              const country = v.country?.trim();
              const isActive = !!country && activeCountry === country;
              return (
                <button
                  key={v.id ?? v.name ?? Math.random()}
                  type="button"
                  onClick={() => country && setActiveCountry(isActive ? null : country)}
                  className={`w-full flex items-center justify-between gap-2 text-xs px-1.5 py-1 rounded text-left transition-colors ${
                    isActive ? "bg-measured/10 ring-1 ring-measured/30" : "hover:bg-surface-2"
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-measured/80 shrink-0" />
                    <span
                      className={`font-display tracking-tight truncate ${
                        isActive ? "text-measured" : "text-muted"
                      }`}
                    >
                      {v.name ?? "unknown vendor"}
                    </span>
                  </span>
                  <span className="readout text-[10px] text-faint shrink-0 uppercase tracking-wider">
                    {country ?? "—"}
                  </span>
                </button>
              );
            })
          )}
          {unmapped > 0 && (
            <p className="text-[10px] text-faint italic px-1 pt-1">
              <span className="readout">+{unmapped}</span> country unmapped on globe
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
