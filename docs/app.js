/* Umm Kulthum Atlas — 3D.
   Entrance: thousands of particles (the data nodes hidden among them) form her portrait.
   Click: the portrait bursts; the data nodes spread into a 3D relationship network and the
   rest become a starfield. "Globe" re-arranges the same nodes onto a 3D globe, stacked by city. */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { forceSimulation, forceLink, forceManyBody, forceX, forceY, forceZ, forceCollide } from "d3-force-3d";

const D = window.UK_DATA;
const AI = window.UK_AI;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const empty = (s) => !s || /^(n\/a|none|not specified|unknown|not applicable)\b/i.test(String(s).trim());
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const SPEED = REDUCED ? 0.35 : 1;
let THEME = document.documentElement.dataset.theme === "light" ? "light" : "dark";

const PORTRAIT_SRC = "assets/portrait.jpg"; // stage photo: lit figure on a black background
const PORTRAIT_CROP = [0.28, 0.74];         // horizontal slice of the photo that holds the figure

/* ================================================================ data model */
const REGION_OF = {
  Egypt: "egypt", Syria: "levant", Lebanon: "levant", Palestine: "levant",
  Morocco: "maghreb", Tunisia: "maghreb", Libya: "maghreb", Sudan: "maghreb",
  Iraq: "gulf", UAE: "gulf", Kuwait: "gulf", "Saudi Arabia": "gulf", Qatar: "gulf", Bahrain: "gulf",
};
const REGIONS = [["egypt", "Egypt"], ["levant", "Levant"], ["maghreb", "North Africa & Sudan"], ["gulf", "Iraq & the Gulf"], ["world", "Europe & beyond"]];
const COLORS = {
  egypt: "#ef6f5b", levant: "#45c1a6", maghreb: "#e8bd45", gulf: "#a28ff0", world: "#5ea8f0",
  person: "#f2f2f2", song: "#f06a9e", city: "#8fcf6c",
};
const HUB_LABEL = { person: "Person", song: "Song / film", city: "City" };
const SHAPE = { place: 0, person: 1, song: 2, city: 3 };

const places = D.places.map((p) => ({ id: "p" + p.code, kind: "place", p, region: REGION_OF[p.country] || "world", hasGeo: p.lat != null, size: 8 }));
const placeByCode = new Map(places.map((n) => [n.p.code, n]));
const hubMap = new Map();
function hub(kind, label, extra) {
  const id = kind + ":" + label;
  if (!hubMap.has(id)) hubMap.set(id, { id, kind, label, places: [], ...extra });
  return hubMap.get(id);
}
const roleOf = new Map(D.people.map((x) => [x.id, x.role]));
places.forEach((n) => {
  n.p.personIds.forEach((x) => hub("person", x, { role: roleOf.get(x) }).places.push(n));
  n.p.songIds.forEach((x) => hub("song", x).places.push(n));
  hub("city", n.p.city, { country: n.p.country }).places.push(n);
});
const allHubs = [...hubMap.values()];
const hubs = allHubs.filter((h) => h.places.length >= 2); // only shared entities become nodes
hubs.forEach((h) => { h.size = 5.5 + Math.sqrt(h.places.length) * 1.8; });
const links = [];
hubs.forEach((h) => h.places.forEach((n) => links.push({ source: n, target: h })));
const nodeHubs = new Map();
allHubs.forEach((h) => h.places.forEach((n) => {
  if (!nodeHubs.has(n)) nodeHubs.set(n, []);
  nodeHubs.get(n).push(h);
}));
function relatedPlaces(n) {
  const score = new Map();
  for (const h of nodeHubs.get(n) || []) {
    const w = h.kind === "city" ? 1 : 2;
    for (const m of h.places) {
      if (m === n) continue;
      const s = score.get(m) || { m, score: 0, why: [] };
      s.score += w; s.why.push(h); score.set(m, s);
    }
  }
  return [...score.values()].sort((a, b) => b.score - a.score || a.m.p.code - b.m.p.code);
}

const G = [...places, ...hubs]; // every drawable data node
G.forEach((n, i) => {
  n.i = i;
  n.color = new THREE.Color(n.kind === "place" ? COLORS[n.region] : COLORS[n.kind]);
  n.pos = new THREE.Vector3();      // current rendered position
  n.globe = new THREE.Vector3();    // position in globe mode
  n.portrait = new THREE.Vector3(); // position inside the entrance portrait
  n.delay = Math.random() * 0.4;
  n.mdelay = Math.random() * 0.35;
  n.vis = n.kind === "place" || n.kind !== "city" ? 1 : 0; // animated visibility
});

/* ================================================================ state */
const state = {
  phase: "intro",          // intro → entering → atlas
  enterT: 0,               // 0..1 entrance progress
  mode: "network",
  modeT: 0, modeTarget: 0, // 0 network, 1 globe
  hubOn: { person: true, song: true, city: false },
  sel: null, hot: new Set(), hover: null,
};

/* ================================================================ 3D layout (network) */
const sim = forceSimulation([], 3).stop()
  .force("link", forceLink([]).distance((l) => 22 + l.target.size * 2.2).strength((l) => 0.55 / Math.sqrt(l.target.places.length)))
  .force("charge", forceManyBody().strength((d) => (d.kind === "place" ? -34 : -120)).distanceMax(500))
  .force("x", forceX(0).strength(0.035)).force("y", forceY(0).strength(0.035)).force("z", forceZ(0).strength(0.035))
  .force("collide", forceCollide((d) => d.size * 0.9 + 2));
function simNodes() { return places.concat(hubs.filter((h) => state.hubOn[h.kind])); }
function configureSim(reheat) {
  const ns = simNodes();
  ns.forEach((h) => {
    if (h.kind !== "place" && h.x === undefined) { // first appearance: start at its places' centroid
      const ps = h.places.filter((p) => p.x !== undefined);
      if (ps.length) {
        h.x = d3.mean(ps, (p) => p.x) + Math.random() - 0.5;
        h.y = d3.mean(ps, (p) => p.y) + Math.random() - 0.5;
        h.z = d3.mean(ps, (p) => p.z) + Math.random() - 0.5;
      }
    }
  });
  sim.nodes(ns);
  sim.force("link").links(links.filter((l) => state.hubOn[l.target.kind]));
  if (reheat) sim.alpha(0.7).restart();
}
configureSim(false);
sim.tick(320);
let netRadius = d3.quantile(places.map((n) => Math.hypot(n.x, n.y, n.z)).sort(d3.ascending), 0.9) || 200;

/* ================================================================ 3D layout (globe) */
const R = 220;
function latLon(lat, lon, r = R) {
  const phi = (lat * Math.PI) / 180, lam = (lon * Math.PI) / 180;
  return new THREE.Vector3(r * Math.cos(phi) * Math.sin(lam), r * Math.sin(phi), r * Math.cos(phi) * Math.cos(lam));
}
const SURF = R + 0.03;  // dots sit just above the map surface, at their true coordinates (no stacking)
const cityMarks = [];   // city name labels on the globe
(() => {
  places.forEach((n) => { if (n.hasGeo) n.gtrue = latLon(n.p.lat, n.p.lon, SURF); });
  const lost = places.filter((n) => !n.hasGeo); // no known location: a small ring under the south pole
  lost.forEach((n, k) => {
    const a = (k / Math.max(lost.length, 1)) * Math.PI * 2;
    n.gtrue = new THREE.Vector3(Math.cos(a) * 26, -R - 46, Math.sin(a) * 26);
  });
  places.forEach((n) => n.globe.copy(n.gtrue));
  for (const [city, ns] of d3.groups(places.filter((n) => n.hasGeo), (n) => n.p.city)) {
    cityMarks.push({ label: ns.length > 1 ? `${city} · ${ns.length}` : city, n: ns.length, pos: latLon(d3.mean(ns, (n) => n.p.lat), d3.mean(ns, (n) => n.p.lon), R + 0.6) });
  }
  hubs.forEach((h) => { // hubs fade out on the globe; park them above their places' centroid
    const c = new THREE.Vector3();
    h.places.forEach((n) => c.add(n.gtrue));
    h.gtrue = c.divideScalar(h.places.length).normalize().multiplyScalar(R + 70);
    h.globe.copy(h.gtrue);
  });
})();

/** Level of detail on the globe: dots never move off their true spot. Where several would crowd
    into the same few pixels, only the best-connected one is shown; the others fade in as you zoom
    in (Egypt, then Cairo, then street level). Selected and highlighted places always show. */
const DOT_PX = 6.5;      // on-screen dot size on the globe
const LOD_GAP_PX = 10;   // dots closer than this on screen are thinned out
const LOD_ORDER = places.slice().sort((a, b) =>
  relatedPlaces(b).length - relatedPlaces(a).length || a.p.code - b.p.code);
places.forEach((n) => { n.lod = 1; });
const lodScreen = new THREE.Vector3();
function relaxGlobe() { // (name kept: runs every frame while the globe is shown)
  const shown = [];
  for (const n of LOD_ORDER) {
    n.globe.copy(n.gtrue);
    lodScreen.copy(n.gtrue).project(camera);
    const x = (lodScreen.x * 0.5 + 0.5) * innerWidth, y = (-lodScreen.y * 0.5 + 0.5) * innerHeight;
    const forced = n === state.sel || (state.sel && state.hot.has(n));
    let keep = forced || !shown.some((s) => (s[0] - x) ** 2 + (s[1] - y) ** 2 < LOD_GAP_PX * LOD_GAP_PX);
    if (lodScreen.z > 1) keep = forced; // behind the camera
    if (keep) shown.push([x, y]);
    n.lodTarget = keep ? 1 : 0;
  }
}

/* ================================================================ renderer & scene */
const canvas = $("#scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.setClearColor(0x0e0f11, 1);
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0e0f11, 0.00028);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 1, 8000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.enabled = false;
controls.autoRotateSpeed = 0.35;
controls.minDistance = 40;
controls.maxDistance = 2400;
controls.addEventListener("start", () => { controls.autoRotate = false; tween = null; });

const PORTRAIT_H = 480, PORTRAIT_Y = 40;
// Wide screens: the singer stands right of centre and the title sits in the dark space on the left.
// Narrow screens: centred, with the title over the lower part of the gown.
const introWide = () => camera.aspect > 1.25;
const introLook = () => (introWide()
  ? new THREE.Vector3(-PORTRAIT_H * 0.42, PORTRAIT_Y - PORTRAIT_H * 0.02, 0)
  : new THREE.Vector3(0, PORTRAIT_Y + PORTRAIT_H * 0.04, 0)); // narrow: between the music card and the title
function introDistance() {
  const vFov = (camera.fov * Math.PI) / 180;
  const fitH = PORTRAIT_H / (introWide() ? 0.95 : 0.46) / 2 / Math.tan(vFov / 2);
  const fitW = PORTRAIT_H / 0.92 / 2 / Math.tan(vFov / 2) / camera.aspect;
  return introWide() ? fitH : Math.max(fitH, fitW);
}
{
  const l = introLook();
  camera.position.set(l.x, l.y, introDistance());
  camera.lookAt(l);
}

/* ---------- shaders */
const dustMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: {
    uEnter: { value: 0 }, uTime: { value: 0 }, uPR: { value: renderer.getPixelRatio() }, uScale: { value: 700 },
    uStar: { value: new THREE.Vector3(0.93, 0.96, 1.0) }, uStarMix: { value: 0.5 }, uStarAlpha: { value: 0.75 },
  },
  vertexShader: /* glsl */`
    attribute vec3 aSpace; attribute float aDelay; attribute float aSeed; attribute vec3 aColor;
    uniform float uEnter, uTime, uPR, uScale, uStarMix, uStarAlpha; uniform vec3 uStar;
    varying vec3 vColor; varying float vAlpha;
    void main() {
      float t = clamp((uEnter - aDelay * 0.45) / 0.55, 0.0, 1.0);
      float e = t * t * (3.0 - 2.0 * t);
      vec3 breathe = vec3(sin(uTime * 0.9 + aSeed * 40.0), cos(uTime * 0.7 + aSeed * 31.0), sin(uTime * 0.6 + aSeed * 17.0)) * 1.3;
      vec3 p = mix(position + breathe * (1.0 - e), aSpace, e);
      float s = sin(e * 3.14159);
      p.xz += vec2(cos(aSeed * 6.2831), sin(aSeed * 6.2831)) * s * 160.0;
      p += vec3(sin(uTime * 0.05 + aSeed * 9.0), cos(uTime * 0.04 + aSeed * 7.0), 0.0) * 18.0 * e; // slow drift as stars
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = min(mix(2.7, 6.5 + 4.0 * fract(aSeed * 13.7), e) * (uScale / -mv.z), mix(40.0, 3.2, e)) * uPR;
      vColor = mix(aColor, uStar, e * uStarMix);
      vAlpha = mix(1.0, uStarAlpha, e) * (0.75 + 0.25 * sin(uTime * 1.7 + aSeed * 50.0) * e + 0.25 * (1.0 - e)); // stars twinkle
    }`,
  fragmentShader: /* glsl */`
    varying vec3 vColor; varying float vAlpha;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      if (d > 0.5) discard;
      gl_FragColor = vec4(vColor, smoothstep(0.5, 0.05, d) * vAlpha);
    }`,
});

const nodeMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: true,
  uniforms: { uPR: { value: renderer.getPixelRatio() }, uScale: { value: 700 } },
  vertexShader: /* glsl */`
    attribute float aSize; attribute float aShape; attribute float aAlpha; attribute vec3 aColor;
    uniform float uPR, uScale;
    varying vec3 vColor; varying float vShape; varying float vAlpha;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = aSize * uPR * (uScale / -mv.z);
      vColor = aColor; vShape = aShape; vAlpha = aAlpha;
    }`,
  fragmentShader: /* glsl */`
    varying vec3 vColor; varying float vShape; varying float vAlpha;
    void main() {
      vec2 c = gl_PointCoord * 2.0 - 1.0; c.y = -c.y;
      float d;
      if (vShape < 0.5) d = length(c);
      else if (vShape < 1.5) d = abs(c.x) + abs(c.y);
      else if (vShape < 2.5) d = max((abs(c.x) * 1.732 + c.y) * 0.85, -c.y * 1.7);
      else d = max(abs(c.x), abs(c.y)) * 1.12;
      if (d > 1.0 || vAlpha < 0.01) discard;
      float rim = smoothstep(0.72, 0.9, d);
      vec3 col = mix(vColor * 1.12, vColor * 0.35, rim);
      float glow = 1.0 - smoothstep(0.0, 0.7, d);
      gl_FragColor = vec4(col + glow * 0.18, vAlpha);
    }`,
});

/* ---------- data nodes */
const nodeGeo = new THREE.BufferGeometry();
const nPos = new Float32Array(G.length * 3), nCol = new Float32Array(G.length * 3);
const nSize = new Float32Array(G.length), nAlpha = new Float32Array(G.length), nShape = new Float32Array(G.length);
G.forEach((n, i) => { nShape[i] = SHAPE[n.kind]; });
nodeGeo.setAttribute("position", new THREE.BufferAttribute(nPos, 3).setUsage(THREE.DynamicDrawUsage));
nodeGeo.setAttribute("aColor", new THREE.BufferAttribute(nCol, 3).setUsage(THREE.DynamicDrawUsage));
nodeGeo.setAttribute("aSize", new THREE.BufferAttribute(nSize, 1).setUsage(THREE.DynamicDrawUsage));
nodeGeo.setAttribute("aAlpha", new THREE.BufferAttribute(nAlpha, 1).setUsage(THREE.DynamicDrawUsage));
nodeGeo.setAttribute("aShape", new THREE.BufferAttribute(nShape, 1));
const nodePoints = new THREE.Points(nodeGeo, nodeMat);
nodePoints.frustumCulled = false;
nodePoints.renderOrder = 2;
scene.add(nodePoints);

/* ---------- links */
function lineLayer(color, opacity) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6 * 4000), 3).setUsage(THREE.DynamicDrawUsage));
  geo.setDrawRange(0, 0);
  const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  l.frustumCulled = false;
  l.renderOrder = 1; // after the globe surface, before the nodes
  scene.add(l);
  return l;
}
const baseLines = lineLayer(0xc5ccd6, 0.13);
const hotLines = lineLayer(0xf4f6f8, 0.85);

/* ---------- globe: a real map (web-map tiles) wrapped onto the sphere
   A shader turns each point of the sphere into Web-Mercator texture coordinates, so ordinary map
   tiles can be painted on it. A low-zoom world texture covers the whole globe; when you zoom in,
   a sharper "detail" texture is fetched for just the area you are looking at (down to street level). */
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/";
const TILESETS = { // free, keyless, CORS-enabled
  dark: { base: "World_Dark_Gray_Base", ref: "World_Dark_Gray_Reference", polar: "#24272b" },
  light: { base: "World_Light_Gray_Base", ref: "World_Light_Gray_Reference", polar: "#dcdedf" },
};
const tileUrl = (layer, z, x, y) => `${ESRI}${layer}/MapServer/tile/${z}/${y}/${x}`;
function makeCanvasTexture(size) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const tex = new THREE.CanvasTexture(cv);
  tex.flipY = false;
  tex.generateMipmaps = false;           // no mip seam at the date line
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { cv, ctx: cv.getContext("2d"), tex };
}
const baseTex = makeCanvasTexture(2048);  // zoom 3: 8 x 8 tiles of the whole world
const detailTex = makeCanvasTexture(2048); // 8 x 8 tiles around the view

const globeMat = new THREE.ShaderMaterial({
  transparent: true,
  uniforms: {
    uBase: { value: baseTex.tex }, uDetail: { value: detailTex.tex },
    uBounds: { value: new THREE.Vector4(0, 0, 0, 0) }, uDetailOn: { value: 0 },
    uOpacity: { value: 0 }, uPolar: { value: new THREE.Color("#24272b") },
  },
  vertexShader: /* glsl */`
    varying vec3 vDir;
    void main() {
      vDir = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D uBase, uDetail;
    uniform vec4 uBounds; uniform float uDetailOn, uOpacity; uniform vec3 uPolar;
    varying vec3 vDir;
    const float PI = 3.141592653589793;
    const float MAXLAT = 1.4844222297453324; // 85.0511° — the edge of Web-Mercator maps
    void main() {
      vec3 d = normalize(vDir);
      float lat = asin(clamp(d.y, -1.0, 1.0));
      float lon = atan(d.x, d.z);
      float u = (lon + PI) / (2.0 * PI);
      float v = (1.0 - log(tan(PI / 4.0 + clamp(lat, -MAXLAT, MAXLAT) / 2.0)) / PI) / 2.0;
      vec3 col = texture2D(uBase, vec2(u, v)).rgb;
      if (uDetailOn > 0.5 && u > uBounds.x && u < uBounds.z && v > uBounds.y && v < uBounds.w) {
        col = texture2D(uDetail, (vec2(u, v) - uBounds.xy) / (uBounds.zw - uBounds.xy)).rgb;
      }
      if (abs(lat) > MAXLAT) col = uPolar;
      gl_FragColor = vec4(col, uOpacity);
      #include <colorspace_fragment>
    }`,
});
const globe = new THREE.Group();
scene.add(globe);
// many segments so the faceted sphere stays within a few metres of the true surface at street zoom
const globeSurface = new THREE.Mesh(new THREE.SphereGeometry(R, 360, 240), globeMat);
globeSurface.renderOrder = -2;
globe.add(globeSurface);
const haloMat = new THREE.MeshBasicMaterial({ color: 0xc8d0dc, transparent: true, opacity: 0, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false });
const halo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.06, 48, 32), haloMat);
halo.renderOrder = -1;
globe.add(halo);

/** Draws a block of tiles (base + labels) into a canvas; resolves false if superseded. */
async function paintTiles(target, z, x0, y0, cols, rows, isCurrent) {
  const set = TILESETS[THEME];
  const n = 2 ** z;
  const jobs = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const y = y0 + j;
    if (y < 0 || y >= n) continue;
    const x = (((x0 + i) % n) + n) % n;
    for (const layer of [set.base, set.ref]) {
      jobs.push(loadImage(tileUrl(layer, z, x, y)).then((img) => ({ img, i, j, layer })).catch(() => null));
    }
  }
  const tiles = (await Promise.all(jobs)).filter(Boolean);
  if (!isCurrent()) return false;
  target.ctx.fillStyle = set.polar;
  target.ctx.fillRect(0, 0, target.cv.width, target.cv.height);
  const s = target.cv.width / cols;
  for (const layer of [set.base, set.ref]) { // labels on top of the base map
    tiles.filter((t) => t.layer === layer).forEach((t) => target.ctx.drawImage(t.img, t.i * s, t.j * s, s, s));
  }
  target.tex.needsUpdate = true;
  return true;
}

let baseKey = "";
function loadBaseMap() {
  const key = THEME;
  baseKey = key;
  globeMat.uniforms.uPolar.value.set(TILESETS[THEME].polar);
  return paintTiles(baseTex, 3, 0, 0, 8, 8, () => baseKey === key);
}

let detailKey = "", detailTimer = 0;
/** Picks a tile zoom for what the camera can see and paints an 8×8-tile window around it. */
function updateDetailMap() {
  const alt = altitude();
  if (state.modeT < 0.5 || alt > 110) { globeMat.uniforms.uDetailOn.value = 0; detailKey = ""; return; }
  const c = (controls.target.length() > R * 0.5 ? controls.target : camera.position).clone().normalize();
  const lat = Math.asin(c.y), lon = Math.atan2(c.x, c.z);
  const dist = camera.position.distanceTo(c.clone().multiplyScalar(R));
  const viewW = 2 * dist * Math.tan((camera.fov * Math.PI) / 360) * Math.max(camera.aspect, 1) * 1.5;
  const frac = viewW / (2 * Math.PI * R * Math.cos(lat));            // share of the world's width in view
  const z = Math.max(4, Math.min(16, Math.floor(Math.log2(7 / frac))));
  const n = 2 ** z;
  const u = (lon + Math.PI) / (2 * Math.PI);
  const v = (1 - Math.log(Math.tan(Math.PI / 4 + Math.max(-1.484, Math.min(1.484, lat)) / 2)) / Math.PI) / 2;
  const x0 = Math.floor(u * n - 4), y0 = Math.max(0, Math.min(n - 8, Math.floor(v * n - 4.5)));
  const key = `${THEME}/${z}/${x0}/${y0}`;
  if (key === detailKey) return;
  detailKey = key;
  paintTiles(detailTex, z, x0, y0, 8, 8, () => detailKey === key).then((ok) => {
    if (!ok) return;
    globeMat.uniforms.uBounds.value.set(x0 / n, y0 / n, (x0 + 8) / n, (y0 + 8) / n);
    globeMat.uniforms.uDetailOn.value = 1;
  });
}

/* ================================================================ portrait particles */
const N_DUST = innerWidth < 760 ? 7000 : 12000;
let dust = null;
let portraitReady = false;

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

/** Weighted samples from the stage photo: lit areas (face, hands, embroidery) become particles. */
function samplesFromImage(img, n) {
  const sx = img.width * PORTRAIT_CROP[0], sw = img.width * (PORTRAIT_CROP[1] - PORTRAIT_CROP[0]);
  const w = 280, h = Math.round((w * img.height) / sw);
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, sx, 0, sw, img.height, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255;
  const wts = new Float32Array(w * h);
  let maxE = 0;
  const edge = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const L = (dx, dy) => lum[(y + dy) * w + x + dx];
    const gx = -L(-1, -1) - 2 * L(-1, 0) - L(-1, 1) + L(1, -1) + 2 * L(1, 0) + L(1, 1);
    const gy = -L(-1, -1) - 2 * L(0, -1) - L(1, -1) + L(-1, 1) + 2 * L(0, 1) + L(1, 1);
    const e = Math.hypot(gx, gy);
    edge[y * w + x] = e;
    if (e > maxE) maxE = e;
  }
  for (let i = 0; i < w * h; i++) {
    const e = edge[i] / (maxE || 1);
    // the stage background is near-black, so it simply gets (almost) no particles
    wts[i] = lum[i] < 0.07 ? 0.0004 : 0.015 + Math.pow(lum[i], 2.6) * 1.6 + Math.pow(e, 1.1) * 0.4;
  }
  return weightedSamples(wts, w, h, n, (i) => lum[i], 1, (i) => Math.min(1, 0.06 + Math.pow(lum[i], 1.3) * 1.15));
}
// centre of her face inside the cropped photo (u: across, v: down) — the burst starts here
const FACE_UV = [0.42, 0.19];

/** Fallback when the photo can't load (offline): her name in Arabic calligraphy. */
async function samplesFromName(n) {
  await document.fonts.load("700 160px Amiri").catch(() => {});
  const w = 620, h = 300;
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 170px Amiri, serif";
  ctx.direction = "rtl";
  ctx.fillText("أم كلثوم", w / 2, h / 2);
  const px = ctx.getImageData(0, 0, w, h).data;
  const wts = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) wts[i] = px[i * 4 + 3] / 255;
  return weightedSamples(wts, w, h, n, () => 0.5, 0.62, () => 0.8);
}

function weightedSamples(wts, w, h, n, lumAt, scaleH = 1, brightAt = (i) => Math.min(1, wts[i] / 1.2)) {
  const cdf = new Float32Array(wts.length);
  let acc = 0;
  for (let i = 0; i < wts.length; i++) { acc += wts[i]; cdf[i] = acc; }
  const scale = (PORTRAIT_H * scaleH) / h;
  const out = [];
  for (let k = 0; k < n; k++) {
    const r = Math.random() * acc;
    let lo = 0, hi = cdf.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < r) lo = mid + 1; else hi = mid; }
    const x = lo % w, y = (lo / w) | 0;
    const L = lumAt(lo);
    out.push({
      x: (x + Math.random() - w / 2) * scale,
      y: (h / 2 - y - Math.random()) * scale + PORTRAIT_Y,
      z: (L - 0.5) * 46 + (Math.random() - 0.5) * 10, // bas-relief: lighter areas come forward
      wgt: brightAt(lo),
    });
  }
  return out;
}

let faceCenter = { x: 0, y: PORTRAIT_Y };
async function buildPortrait() {
  let samples, credit;
  try {
    const img = await loadImage(PORTRAIT_SRC);
    samples = samplesFromImage(img, N_DUST + G.length);
    const cw = img.width * (PORTRAIT_CROP[1] - PORTRAIT_CROP[0]);
    const worldW = (PORTRAIT_H * cw) / img.height;
    faceCenter = { x: (FACE_UV[0] - 0.5) * worldW, y: (0.5 - FACE_UV[1]) * PORTRAIT_H + PORTRAIT_Y };
    credit = "Umm Kulthum in concert";
  } catch (e) {
    samples = await samplesFromName(N_DUST + G.length);
    credit = "Portrait unavailable — showing her name instead";
  }
  $("#credit").textContent = credit;

  // the first G.length samples hold the real data nodes
  const gold = new THREE.Color("#eef1f5"), amber = new THREE.Color("#5b636e"); // silver-white highlights, slate shadows
  G.forEach((n, i) => {
    const s = samples[i];
    n.portrait.set(s.x, s.y, s.z);
    n.pcolor = amber.clone().lerp(gold, 0.35 + 0.65 * s.wgt);
  });

  const m = N_DUST;
  const pos = new Float32Array(m * 3), space = new Float32Array(m * 3), col = new Float32Array(m * 3);
  const delay = new Float32Array(m), seed = new Float32Array(m);
  const c = new THREE.Color();
  for (let k = 0; k < m; k++) {
    const s = samples[G.length + k];
    pos.set([s.x, s.y, s.z], k * 3);
    // starfield: a thick shell around everything
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, rr = 700 + Math.pow(Math.random(), 0.7) * 1700;
    const q = Math.sqrt(1 - u * u);
    space.set([rr * q * Math.cos(th), rr * u * 0.75, rr * q * Math.sin(th)], k * 3);
    c.copy(amber).lerp(gold, 0.25 + 0.75 * s.wgt).multiplyScalar(0.55 + 0.6 * s.wgt);
    col.set([c.r, c.g, c.b], k * 3);
    // particles burst from her face outwards
    delay[k] = Math.min(1, Math.hypot(s.x - faceCenter.x, s.y - faceCenter.y) / (PORTRAIT_H * 0.8)) * 0.6 + Math.random() * 0.4;
    seed[k] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aSpace", new THREE.BufferAttribute(space, 3));
  geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("aDelay", new THREE.BufferAttribute(delay, 1));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  dust = new THREE.Points(geo, dustMat);
  dust.frustumCulled = false;
  scene.add(dust);
  portraitReady = true;
}

/* ================================================================ camera tween */
let tween = null;
function flyTo(pos, target, ms = 1400) {
  tween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos.clone(), t1: target.clone(), start: performance.now(), ms: ms * SPEED };
}
function networkView() {
  const d = netRadius * 2.9;
  return { pos: new THREE.Vector3(d * 0.35, d * 0.25, d * 0.9), target: new THREE.Vector3(0, 0, 0) };
}
/* Three viewing levels, shared by the 3D globe and the real map. The globe cameras for Egypt and
   Cairo sit a little south of their target and look north, like a tilted map. */
const LEVELS = {
  world: { cam: [27, 25, R * 1.75], target: null, bounds: [[-30, -85], [62, 75]] },
  egypt: { cam: [21.2, 30.8, 62], target: [26.8, 30.8], bounds: [[21.8, 24.6], [31.7, 35.9]] },
  cairo: { cam: [30.0, 31.24, 1.5], target: [30.048, 31.24], bounds: [[29.94, 31.12], [30.14, 31.37]] },
};
function levelView(name) {
  const L = LEVELS[name];
  return {
    pos: latLon(L.cam[0], L.cam[1], R + L.cam[2]),
    target: L.target ? latLon(L.target[0], L.target[1], R) : new THREE.Vector3(0, 0, 0),
  };
}

/* ================================================================ entering */
function enter() {
  if (state.phase !== "intro" || !portraitReady) return;
  state.phase = "entering";
  state.enterStart = performance.now();
  $("#intro").classList.add("gone");
  document.body.classList.add("entered");
  const v = networkView();
  setTimeout(() => flyTo(v.pos, v.target, 3200), 250 * SPEED);
  setTimeout(() => {
    controls.enabled = true;
    controls.autoRotate = !REDUCED && !state.sel;
    fromHash();
  }, 3300 * SPEED);
}
function introClick() { enter(); }
$("#intro").addEventListener("click", introClick);
addEventListener("keydown", (e) => { if (state.phase === "intro" && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); introClick(); } });

/* ================================================================ per-frame update */
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Color();
let mouseX = 0, mouseY = 0;
addEventListener("pointermove", (e) => { mouseX = e.clientX / innerWidth - 0.5; mouseY = e.clientY / innerHeight - 0.5; });

function visTarget(n) {
  if (n.kind === "place") return 1;
  return state.hubOn[n.kind] ? 1 - ease(clamp01(state.modeT * 1.6)) : 0;
}

function updateNodes(dt) {
  const enterT = state.enterT;
  const sel = state.sel, hot = state.hot;
  for (const n of G) {
    n.vis += (visTarget(n) - n.vis) * Math.min(1, dt * 4);
    // layout position: network ↔ globe, staggered per node
    const mT = ease(clamp01((state.modeT - n.mdelay) / 0.65));
    tmpA.set(n.x ?? 0, n.y ?? 0, n.z ?? 0).lerp(n.globe, mT);
    // entrance: from portrait to layout, staggered, with a sideways swirl mid-flight
    const eT = ease(clamp01((enterT - n.delay) / 0.6));
    const swirl = Math.sin(eT * Math.PI) * 120;
    n.pos.copy(n.portrait).lerp(tmpA, eT);
    n.pos.x += Math.cos(n.i * 2.4) * swirl;
    n.pos.z += Math.sin(n.i * 2.4) * swirl;
    if (eT < 1) n.pos.y += Math.sin(performance.now() / 1000 * 0.8 + n.i) * 1.3 * (1 - eT);

    const big = n === sel ? 1.7 : n === state.hover ? 1.35 : 1;
    // on the globe, dots keep a small fixed on-screen size at every zoom level
    const globeSize = n.kind === "place" ? DOT_PX * big * (camera.position.distanceTo(n.pos) / 700) : 0;
    const layoutSize = n.size * big + (globeSize - n.size * big) * mT;
    // globe level-of-detail: thinned-out dots shrink and fade away until you zoom in
    let lodF = 1;
    if (n.kind === "place") {
      n.lod += ((state.modeT > 0 ? n.lodTarget ?? 1 : 1) - n.lod) * Math.min(1, dt * 6);
      lodF = 1 - mT * (1 - n.lod);
    }
    const size = (3.4 + (layoutSize - 3.4) * eT) * (n.kind === "place" ? lodF : n.vis);
    let alpha = lodF;
    if (sel && eT >= 1) alpha *= hot.has(n) ? 1 : 0.13;
    if (n.kind !== "place") alpha *= Math.min(1, n.vis * 1.4);
    tmpC.copy(n.pcolor).lerp(n.color, eT);

    const i = n.i;
    nPos[i * 3] = n.pos.x; nPos[i * 3 + 1] = n.pos.y; nPos[i * 3 + 2] = n.pos.z;
    nCol[i * 3] = tmpC.r; nCol[i * 3 + 1] = tmpC.g; nCol[i * 3 + 2] = tmpC.b;
    nSize[i] = size;
    nAlpha[i] = alpha;
  }
  for (const k of ["position", "aColor", "aSize", "aAlpha"]) nodeGeo.attributes[k].needsUpdate = true;
}

function writeSegments(layer, pairs) {
  const arr = layer.geometry.attributes.position.array;
  let k = 0;
  for (const [a, b] of pairs) {
    if (k + 6 > arr.length) break;
    arr[k++] = a.x; arr[k++] = a.y; arr[k++] = a.z;
    arr[k++] = b.x; arr[k++] = b.y; arr[k++] = b.z;
  }
  layer.geometry.setDrawRange(0, k / 3);
  layer.geometry.attributes.position.needsUpdate = true;
}

function arc(a, b, segs = 24) { // great-circle-ish arc lifted above the globe
  const pts = [];
  const la = a.length(), lb = b.length();
  const lift = Math.min(R * 0.5, a.distanceTo(b) * 0.4) + 0.05;
  for (let s = 0; s <= segs; s++) {
    const t = s / segs;
    const p = a.clone().lerp(b, t);
    const len = la + (lb - la) * t + Math.sin(t * Math.PI) * lift;
    pts.push(p.normalize().multiplyScalar(len));
  }
  const pairs = [];
  for (let s = 1; s < pts.length; s++) pairs.push([pts[s - 1], pts[s]]);
  return pairs;
}

function updateLines() {
  const entered = state.enterT >= 0.98;
  const inNet = state.modeT < 0.5;
  if (!entered) { writeSegments(baseLines, []); writeSegments(hotLines, []); return; }
  const sel = state.sel;
  const base = [], hotP = [];
  if (inNet) {
    for (const l of links) {
      if (l.target.vis < 0.5) continue;
      const pair = [l.source.pos, l.target.pos];
      if (sel && (l.source === sel || l.target === sel)) hotP.push(pair);
      else if (!sel) base.push(pair);
    }
  } else if (sel) {
    const origin = sel.kind === "place" ? sel.pos : null;
    const targets = [...state.hot].filter((m) => m.kind === "place" && m !== sel).slice(0, 60);
    if (origin) targets.forEach((m) => hotP.push(...arc(origin, m.pos)));
    else if (targets.length > 1) targets.slice(1).forEach((m) => hotP.push(...arc(targets[0].pos, m.pos)));
  }
  baseLines.material.opacity = 0.13 * (1 - state.modeT);
  writeSegments(baseLines, base);
  writeSegments(hotLines, hotP);
}

/* ---------- labels (HTML, projected) */
const labelLayer = $("#labels");
const pool = [];
function labelEl(i) {
  if (!pool[i]) { pool[i] = document.createElement("span"); labelLayer.appendChild(pool[i]); }
  return pool[i];
}
const camDir = new THREE.Vector3();
function facing(p) { // false for points beyond the globe's horizon
  if (state.modeT < 0.5) return true;
  const c = camera.position.length();
  return tmpA.copy(p).normalize().dot(camDir.copy(camera.position).normalize()) > R / c - 0.002;
}
const altitude = () => camera.position.length() - R;
function updateLabels() {
  const items = [];
  if (state.phase === "atlas") {
    const sel = state.sel;
    if (state.hover) items.push([state.hover, "hot"]);
    if (sel) {
      items.push([sel, "sel"]);
      const hotList = [...state.hot].filter((n) => n !== sel && n !== state.hover && n.vis > 0.5);
      hotList.sort((a, b) => (a.kind === "place") - (b.kind === "place"));
      hotList.slice(0, 26).forEach((n) => items.push([n, "hot"]));
    } else if (state.modeT < 0.5) {
      hubs.filter((h) => h.vis > 0.6 && h.places.length >= 5).forEach((h) => items.push([h, "hub"]));
    } else if (altitude() < 14) { // street level: name every place in view
      LOD_ORDER.forEach((n) => { if (n.lod > 0.6) items.push([n, ""]); });
    } else { // world / country level: city names (all of them once zoomed to a country)
      const minN = altitude() > 150 ? 2 : 1;
      cityMarks.filter((c) => c.n >= minN).forEach((c) => items.push([c, "city"]));
    }
  }
  let used = 0;
  const boxes = []; // greedy de-cluttering: skip a label that would overlap one already placed
  for (const [n, cls] of items) {
    if (used >= 60) break;
    if (!facing(n.pos)) continue;
    tmpB.copy(n.pos).project(camera);
    if (tmpB.z > 1 || Math.abs(tmpB.x) > 1.05 || Math.abs(tmpB.y) > 1.05) continue;
    const text = n.label ?? n.p.name;
    const x = (tmpB.x * 0.5 + 0.5) * innerWidth, y = (-tmpB.y * 0.5 + 0.5) * innerHeight;
    const box = [x + 9, y - 8, x + 9 + text.length * 6.3, y + 7];
    if (cls !== "sel" && boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
    boxes.push(box);
    const el = labelEl(used++);
    if (el.textContent !== text) el.textContent = text;
    el.className = cls + (n.kind && n.kind !== "place" ? " hub" : "");
    el.style.transform = `translate(${x + 9}px, ${y - 7}px)`;
    el.style.display = "";
  }
  for (let k = used; k < pool.length; k++) pool[k].style.display = "none";
}

/* ---------- keep the scene centred in the part of the screen the panel leaves free */
const viewOff = { x: 0, y: 0 };
function updateViewOffset() {
  const open = !panel.hidden;
  const phone = innerWidth <= 760;
  const tx = open && !phone ? panel.offsetWidth / 2 : 0;
  const ty = open && phone ? panel.offsetHeight / 2 : 0;
  viewOff.x += (tx - viewOff.x) * 0.12;
  viewOff.y += (ty - viewOff.y) * 0.12;
  if (Math.abs(viewOff.x) < 0.5 && Math.abs(viewOff.y) < 0.5 && !tx && !ty) {
    if (camera.view && camera.view.enabled) camera.clearViewOffset();
    return;
  }
  camera.setViewOffset(innerWidth, innerHeight, viewOff.x, viewOff.y, innerWidth, innerHeight);
}

/* ---------- loop */
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  dustMat.uniforms.uTime.value = now / 1000;

  if (state.phase === "entering") {
    state.enterT = clamp01((now - state.enterStart) / (3600 * SPEED));
    if (state.enterT >= 1) state.phase = "atlas";
  }
  dustMat.uniforms.uEnter.value = state.enterT;

  // mode morph
  const dir = Math.sign(state.modeTarget - state.modeT);
  if (dir) state.modeT = clamp01(state.modeT + (dir * dt) / (2.2 * SPEED));
  const g = ease(state.modeT);
  globeMat.uniforms.uOpacity.value = g;
  globeMat.transparent = g < 0.999;
  globeMat.depthWrite = g > 0.5;
  haloMat.opacity = SCENE_THEME[THEME].halo * g;
  globe.visible = g > 0.001;
  sceneBackground();
  if (now - detailTimer > 350) { detailTimer = now; updateDetailMap(); }

  if (state.phase === "intro") { // gentle parallax so the relief portrait reads as 3D
    const look = introLook();
    camera.position.x += (look.x + mouseX * 140 - camera.position.x) * 0.04;
    camera.position.y += (look.y - mouseY * 90 - camera.position.y) * 0.04;
    camera.position.z = introDistance();
    camera.lookAt(look);
    controls.target.copy(look);
  } else if (tween) {
    const t = ease(clamp01((now - tween.start) / tween.ms));
    camera.position.lerpVectors(tween.p0, tween.p1, t);
    controls.target.lerpVectors(tween.t0, tween.t1, t);
    if (t >= 1) tween = null;
  }
  if (controls.enabled) controls.update();
  else camera.lookAt(controls.target);
  if (state.modeT > 0.5 && camera.position.length() < R + 0.02) camera.position.setLength(R + 0.02); // never dive under the map
  // near plane follows the zoom so street-level views don't clip
  camera.near = Math.min(1, Math.max(0.0005, Math.min(camera.position.distanceTo(controls.target), camera.position.length() - R) * 0.02));
  camera.updateProjectionMatrix();
  updateViewOffset();

  if (state.modeT > 0) relaxGlobe();
  updateNodes(dt);
  updateLines();
  updateLabels();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

/* ================================================================ picking & interaction */
const tip = $("#tooltip");
function pick(cx, cy) {
  let best = null, bestD = Infinity;
  for (const n of G) {
    // sizes are in world units (on the globe they shrink as you zoom in), so judge by on-screen pixels
    const px = (nSize[n.i] * 700) / Math.max(1e-6, camera.position.distanceTo(n.pos));
    if (nAlpha[n.i] < 0.3 || px < 2) continue;
    if (!facing(n.pos)) continue;
    tmpB.copy(n.pos).project(camera);
    if (tmpB.z > 1) continue;
    const x = (tmpB.x * 0.5 + 0.5) * innerWidth, y = (-tmpB.y * 0.5 + 0.5) * innerHeight;
    const d = (x - cx) ** 2 + (y - cy) ** 2;
    const r = Math.max(9, px / 2 + 4); // on-screen radius in CSS px
    if (d < r * r && d < bestD) { bestD = d; best = n; }
  }
  return best;
}
let down = null;
canvas.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
canvas.addEventListener("pointermove", (e) => {
  if (state.phase !== "atlas" || e.buttons) { tip.hidden = true; return; }
  const n = pick(e.clientX, e.clientY);
  state.hover = n;
  document.body.classList.toggle("hovering", !!n);
  if (!n) { tip.hidden = true; return; }
  tip.innerHTML = n.kind === "place"
    ? `<b>${n.p.code} · ${esc(n.p.name)}</b>${n.p.nameAr ? `<div class="t-ar" dir="rtl">${esc(n.p.nameAr)}</div>` : ""}<div class="t-meta">${esc(n.p.city)}, ${esc(n.p.country)} · ${esc(String(n.p.date).slice(0, 60))}</div>`
    : `<b>${esc(n.label)}</b><div class="t-meta">${HUB_LABEL[n.kind]}${n.role ? " · " + n.role : ""} · ${n.places.length} places</div>`;
  tip.hidden = false;
  tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + "px";
  tip.style.top = Math.max(e.clientY - tip.offsetHeight - 10, 6) + "px";
});
canvas.addEventListener("pointerleave", () => { tip.hidden = true; state.hover = null; });
canvas.addEventListener("pointerup", (e) => {
  if (!down || state.phase !== "atlas") return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  if (moved > 6 || performance.now() - down.t > 600) return;
  const n = pick(e.clientX, e.clientY);
  // on the globe, a click on a spot that hides other dots zooms in to reveal them all
  if (state.mode === "globe" && state.modeT > 0.9) {
    const cluster = clusterAt(n, e.clientX, e.clientY);
    if (cluster.length > 1 && cluster.some((m) => m.lodTarget === 0)) return zoomToCluster(cluster);
  }
  select(n, { fly: !!n });
});

/** Places drawn within a few pixels of the clicked dot (or click point), hidden ones included. */
function clusterAt(n, cx, cy) {
  if (n && n.kind === "place") {
    tmpB.copy(n.gtrue).project(camera);
    cx = (tmpB.x * 0.5 + 0.5) * innerWidth;
    cy = (-tmpB.y * 0.5 + 0.5) * innerHeight;
  }
  const r = LOD_GAP_PX * 1.6;
  return places.filter((m) => {
    if (!m.hasGeo || !facing(m.gtrue)) return false;
    tmpB.copy(m.gtrue).project(camera);
    if (tmpB.z > 1) return false;
    const x = (tmpB.x * 0.5 + 0.5) * innerWidth, y = (-tmpB.y * 0.5 + 0.5) * innerHeight;
    return (x - cx) ** 2 + (y - cy) ** 2 < r * r;
  });
}

/** Flies down until a cluster's dots spread apart; if they share one spot, lists them instead. */
function zoomToCluster(cluster) {
  const center = new THREE.Vector3();
  cluster.forEach((m) => center.add(m.gtrue));
  center.setLength(R);
  const spread = Math.max(...cluster.map((m) => m.gtrue.clone().setLength(R).distanceTo(center)));
  // altitude at which the cluster fills ~30% of the view height
  const want = Math.max(0.03, (spread * 2) / (0.3 * 2 * Math.tan((camera.fov * Math.PI) / 360)));
  const alt = altitude();
  if (spread < 0.004 || want > alt * 0.85) return openClusterPanel(cluster); // same address: can't separate
  const up = center.clone().normalize();
  const north = new THREE.Vector3(0, 1, 0).addScaledVector(up, -up.y).normalize();
  flyTo(center.clone().addScaledVector(up, want).addScaledVector(north, -want * 0.55), center, 1400);
  controls.autoRotate = false;
  document.querySelectorAll("#levels button").forEach((b) => b.classList.remove("on")); // now between levels
}

function openClusterPanel(cluster) {
  select(null);
  panel.hidden = false;
  document.body.classList.add("panel-open");
  const list = cluster.slice().sort((a, b) => a.p.code - b.p.code);
  body.innerHTML = `
    <p class="kicker">${list.length} places at this spot</p>
    <h2 class="p-title">${esc(list[0].p.city)}</h2>
    <p class="muted">These places share (nearly) the same coordinates in the dataset. Pick one:</p>
    <ul class="related">${list.map((m) => `<li><button data-code="${m.p.code}">
      <span class="code">${m.p.code}</span><span>${esc(m.p.name)}</span><span class="why">${esc(String(m.p.date).slice(0, 48))}</span></button></li>`).join("")}</ul>`;
  panel.scrollTop = 0;
}

function select(d, opts = {}) {
  state.sel = d;
  const hot = new Set();
  if (d) {
    hot.add(d);
    if (d.kind === "place") {
      (nodeHubs.get(d) || []).forEach((h) => hot.add(h));
      relatedPlaces(d).forEach((r) => hot.add(r.m));
    } else d.places.forEach((n) => hot.add(n));
  }
  state.hot = hot;
  if (d) {
    controls.autoRotate = false;
    openPanel(d);
    history.replaceState(null, "", "#" + (d.kind === "place" ? "code=" + d.p.code : "hub=" + encodeURIComponent(d.id)));
    if (opts.fly) focusOn(d);
  } else {
    closePanel();
    history.replaceState(null, "", location.pathname + location.search);
  }
}

function focusOn(d) {
  if (state.mode === "globe") {
    // look at the place from a tilted viewpoint just south of it, keeping the current zoom
    // (or zooming to country level when coming from the whole-world view)
    const target = d.gtrue.clone().setLength(R);
    const up = target.clone().normalize();
    const north = new THREE.Vector3(0, 1, 0).addScaledVector(up, -up.y).normalize();
    const alt = altitude();
    const a = alt > 120 ? 55 : Math.max(alt, 0.3);
    flyTo(target.clone().addScaledVector(up, a).addScaledVector(north, -a * 0.55), target, 1400);
    return;
  }
  const target = new THREE.Vector3(d.x ?? 0, d.y ?? 0, d.z ?? 0);
  const dirV = camera.position.clone().sub(controls.target).normalize();
  const dist = d.kind === "place" ? 170 : 300;
  flyTo(target.clone().addScaledVector(dirV, dist), target, 1200);
}

/* ================================================================ panel */
const panel = $("#panel");
const body = $("#panel-body");
let seminarAbort = null;
function closePanel() { panel.hidden = true; document.body.classList.remove("panel-open"); body.innerHTML = ""; if (seminarAbort) seminarAbort.abort(); }
function decodeURISafe(u) { try { return decodeURI(u); } catch (e) { return u; } }
const linkList = (urls) => `<ul class="links-list">${urls.map((u) => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(decodeURISafe(u))}</a></li>`).join("")}</ul>`;
function chip(h) {
  const shape = h.kind === "person" ? "transform:rotate(45deg) scale(.8)" : h.kind === "song" ? "clip-path:polygon(50% 0,100% 100%,0 100%)" : "border-radius:1px";
  return `<button class="chip" data-hub="${esc(h.id)}"><i style="background:${COLORS[h.kind]};${shape}"></i>${esc(h.label)}${h.places.length > 1 ? `<span class="n">${h.places.length}</span>` : ""}</button>`;
}
function openPanel(d) {
  if (seminarAbort) seminarAbort.abort();
  panel.hidden = false;
  document.body.classList.add("panel-open");
  body.innerHTML = d.kind === "place" ? placeHTML(d) : hubHTML(d);
  panel.scrollTop = 0;
  if (d.kind === "place") wireSeminar(d);
}
function placeHTML(n) {
  const p = n.p;
  const hubsOf = nodeHubs.get(n) || [];
  const ppl = hubsOf.filter((h) => h.kind === "person");
  const sng = hubsOf.filter((h) => h.kind === "song");
  const acc = String(p.accuracy).trim();
  const weak = /low|medium|unconfirmed|not confirmed|estimated|oral/i.test(acc);
  const relAll = relatedPlaces(n);
  const rel = relAll.slice(0, 14);
  const osm = n.hasGeo
    ? (() => {
        const dlt = p.approx ? 0.06 : 0.008;
        const bbox = [p.lon - dlt, p.lat - dlt * 0.7, p.lon + dlt, p.lat + dlt * 0.7].join(",");
        return `<iframe class="osm" loading="lazy" title="Street map of ${esc(p.name)}" src="https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${p.lat},${p.lon}"></iframe>
          <p class="muted">${p.approx ? "Approximate: no exact coordinates in the dataset, shown at the city average. " : ""}${esc(p.coordNote)}
          <a href="https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=${p.approx ? 12 : 17}/${p.lat}/${p.lon}" target="_blank" rel="noopener">Open in OpenStreetMap ↗</a></p>`;
      })()
    : `<p class="muted">No location recorded: ${esc(p.coordNote || "unknown")}</p>`;
  return `
    <p class="kicker">CODE ${p.code} · ${esc(p.city)}, ${esc(p.country)}</p>
    <h2 class="p-title">${esc(p.name)}</h2>
    ${p.nameAr ? `<p class="p-ar" dir="rtl" lang="ar">${esc(p.nameAr)}</p>` : ""}
    <div class="meta">
      <span class="pill">${esc(p.category)}</span>
      <span class="pill${weak ? " warn" : ""}" title="Accuracy level">✓ ${esc(acc || "accuracy n/a")}</span>
      ${p.approx ? `<span class="pill warn">approx. location</span>` : ""}
    </div>
    <dl class="facts">
      <dt>When</dt><dd>${esc(p.date)}</dd>
      <dt>Where</dt><dd>${esc(p.cityRaw)}</dd>
      <dt>Event</dt><dd>${esc(p.eventType)}</dd>
    </dl>
    ${!empty(p.description) ? `<h3>Story</h3><p class="prose">${esc(p.description)}</p>` : ""}
    ${!empty(p.locationInfo) ? `<h3>About the place</h3><p class="prose">${esc(p.locationInfo)}</p>` : ""}
    <h3>People</h3>
    ${ppl.length ? `<div class="chips">${ppl.map(chip).join("")}</div>` : ""}
    <p class="raw">${esc(p.people) || "—"}</p>
    <h3>Works &amp; songs</h3>
    ${sng.length ? `<div class="chips">${sng.map(chip).join("")}</div>` : ""}
    <p class="raw">${esc(p.works) || "—"}</p>
    ${(p.youtube || p.avLinks.length || p.imageLinks.length) ? `<h3>Listen &amp; see</h3>
      ${p.youtube ? `<div class="video"><iframe loading="lazy" src="https://www.youtube-nocookie.com/embed/${esc(p.youtube)}" title="Video for ${esc(p.name)}" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe></div>` : ""}
      ${p.avLinks.length ? `<p class="muted">Audio / video</p>${linkList(p.avLinks)}` : ""}
      ${p.imageLinks.length ? `<p class="muted" style="margin-top:8px">Images &amp; references</p>${linkList(p.imageLinks)}` : ""}` : ""}
    <h3>On the map</h3>
    ${osm}
    ${p.tags.length ? `<h3>Tags</h3><div class="tags">${p.tags.map((t) => `<span>#${esc(t)}</span>`).join("")}</div>` : ""}
    <h3>Connected places ${relAll.length ? `<span class="muted">(${relAll.length})</span>` : ""}</h3>
    ${rel.length ? `<ul class="related">${rel.map((r) => `<li><button data-code="${r.m.p.code}">
        <span class="code">${r.m.p.code}</span><span>${esc(r.m.p.name)}</span>
        <span class="why">${r.why.map((h) => esc(h.label)).join(" · ")}</span></button></li>`).join("")}</ul>`
      : `<p class="muted">No shared people, songs or city with other places in the dataset.</p>`}
    <h3>Seminar · three voices</h3>
    <p class="muted">Umm Kulthum remembers, Pierre Nora reads it as a site of memory, Henri Lefebvre as produced space. In English and Arabic, generated from this record only.</p>
    <div class="seminar-actions">
      <button class="primary" id="run-seminar">Generate seminar</button>
      <span class="muted" id="seminar-provider"></span>
      <button class="ghost" id="seminar-settings">Change model</button>
    </div>
    <div id="voices"></div>`;
}
function hubHTML(h) {
  const co = new Map();
  h.places.forEach((n) => (nodeHubs.get(n) || []).forEach((o) => { if (o !== h && o.kind !== "city") co.set(o, (co.get(o) || 0) + 1); }));
  const top = [...co.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([o]) => o);
  const cities = d3.rollups(h.places, (v) => v.length, (n) => n.p.city).sort((a, b) => b[1] - a[1]);
  return `
    <p class="kicker">${HUB_LABEL[h.kind]}${h.role ? " · " + esc(h.role) : ""}${h.country ? " · " + esc(h.country) : ""}</p>
    <h2 class="p-title">${esc(h.label)}</h2>
    <div class="meta"><span class="pill">${h.places.length} place${h.places.length === 1 ? "" : "s"}</span>
      ${h.kind !== "city" ? cities.slice(0, 6).map(([c, k]) => `<span class="pill">${esc(c)} ${k}</span>`).join("") : ""}</div>
    <h3>Places</h3>
    <ul class="related ${h.places.length > 10 ? "place-list" : ""}">${h.places.slice().sort((a, b) => a.p.code - b.p.code).map((n) => `<li><button data-code="${n.p.code}">
      <span class="code">${n.p.code}</span><span>${esc(n.p.name)}</span><span class="why">${esc(String(n.p.date).slice(0, 48))}</span></button></li>`).join("")}</ul>
    ${top.length ? `<h3>Often appears with</h3><div class="chips">${top.map(chip).join("")}</div>` : ""}`;
}
function showHubKind(kind) {
  if (state.hubOn[kind]) return;
  state.hubOn[kind] = true;
  $(`#hub-toggles input[data-hub="${kind}"]`).checked = true;
  configureSim(true);
}
body.addEventListener("click", (e) => {
  const b = e.target.closest("[data-code],[data-hub]");
  if (!b) return;
  const d = b.dataset.code ? placeByCode.get(+b.dataset.code) : hubMap.get(b.dataset.hub);
  if (!d) return;
  if (d.kind !== "place" && d.places.length > 1) showHubKind(d.kind);
  select(d, { fly: true });
});
$("#close-panel").addEventListener("click", () => select(null));
addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#settings").open && !$("#about").open && state.phase === "atlas") select(null); });

/* ---------- seminar */
function voiceHTML(v, text) {
  const parts = text.split(/\[\s*(?:العربية|Arabic)\s*\]/i);
  const para = (s) => s.replace(/\[\s*English\s*\]/i, "").trim().split(/\n\s*\n|\n/).filter((x) => x.trim())
    .map((x) => `<p>${esc(x.trim()).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</p>`).join("");
  return `<h4>${v.name} <small>· ${v.lens}</small></h4>${para(parts[0])}${parts[1] ? `<div class="ar-block" dir="rtl" lang="ar">${para(parts[1])}</div>` : ""}`;
}
function providerLabel() {
  const s = AI.settings;
  return `${AI.PROVIDERS[s.provider].label.split(" (")[0]} · ${s.model}`;
}
function wireSeminar(n) {
  const btn = $("#run-seminar");
  const box = $("#voices");
  $("#seminar-provider").textContent = providerLabel();
  $("#seminar-settings").addEventListener("click", openSettings);
  btn.addEventListener("click", async () => {
    if (seminarAbort) seminarAbort.abort();
    seminarAbort = new AbortController();
    btn.disabled = true;
    btn.textContent = "Generating…";
    box.innerHTML = AI.VOICES.map((v, i) => `<div class="voice loading" id="voice-${i}"><h4>${v.name} <small>· ${v.lens}</small></h4>${i === 0 ? "Writing…" : "Waiting for the previous voice…"}</div>`).join("");
    AI.onProgress = (txt) => {
      const el = box.querySelector(".voice.loading");
      if (el && txt) el.lastChild.textContent = txt;
    };
    const res = await AI.seminar(n.p, (i, text, err) => {
      const el = $("#voice-" + i);
      if (!el) return;
      if (err) {
        el.className = "voice err";
        el.innerHTML = `<h4>${AI.VOICES[i].name}</h4><p>${esc(err.message)}</p><button class="ghost" data-open-settings>Open settings</button>`;
        el.querySelector("[data-open-settings]").addEventListener("click", openSettings);
        for (let j = i + 1; j < 3; j++) $("#voice-" + j)?.remove();
        return;
      }
      el.className = "voice";
      el.innerHTML = voiceHTML(AI.VOICES[i], text);
      const next = $("#voice-" + (i + 1));
      if (next) next.lastChild.textContent = "Writing…";
    }, seminarAbort.signal);
    if (!$("#run-seminar")) return;
    btn.disabled = false;
    btn.textContent = res.cached ? "Saved seminar ✓" : res.error ? "Try again" : "Regenerate";
  });
}

/* ---------- settings dialog */
const dlg = $("#settings");
const selProv = $("#ai-provider");
selProv.innerHTML = Object.entries(AI.PROVIDERS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join("");
let draftKeys = {};
function syncSettingsForm(changedProvider) {
  const p = AI.PROVIDERS[selProv.value];
  $("#ai-provider-note").textContent = p.note;
  $("#ai-key-row").hidden = !p.key;
  $("#ai-key").value = draftKeys[selProv.value] || "";
  if (changedProvider) $("#ai-model").value = p.model;
}
function openSettings() {
  const s = AI.settings;
  draftKeys = { ...s.keys };
  selProv.value = s.provider;
  $("#ai-model").value = s.model;
  syncSettingsForm(false);
  dlg.showModal();
}
selProv.addEventListener("change", () => syncSettingsForm(true));
$("#ai-key").addEventListener("input", (e) => { draftKeys[selProv.value] = e.target.value.trim(); });
$("#open-settings").addEventListener("click", openSettings);
$("#clear-cache").addEventListener("click", () => { AI.clearCache(); $("#clear-cache").textContent = "Cleared ✓"; });
dlg.addEventListener("close", () => {
  $("#clear-cache").textContent = "Clear saved seminars";
  if (dlg.returnValue !== "save") return;
  AI.saveSettings({ provider: selProv.value, model: $("#ai-model").value.trim() || AI.PROVIDERS[selProv.value].model, keys: draftKeys });
  const lbl = $("#seminar-provider");
  if (lbl) lbl.textContent = providerLabel();
});

/* ================================================================ header controls */
state.level = "world";
function setMode(m) {
  if (m === state.mode) return;
  state.mode = m;
  for (const k of ["network", "globe"]) {
    $("#mode-" + k).classList.toggle("on", k === m);
    $("#mode-" + k).setAttribute("aria-selected", k === m);
  }
  $("#hub-toggles").hidden = m !== "network";
  $("#levels").hidden = m !== "globe";
  controls.autoRotate = false;
  tip.hidden = true;
  state.hover = null;
  legend();
  state.modeTarget = m === "globe" ? 1 : 0;
  controls.minDistance = m === "globe" ? 0.05 : 40;
  const v = m === "globe" ? levelView(state.level) : networkView();
  flyTo(v.pos, v.target, 2200);
}
function setLevel(name) {
  state.level = name;
  document.querySelectorAll("#levels button").forEach((b) => b.classList.toggle("on", b.dataset.level === name));
  if (state.mode === "globe") {
    const v = levelView(name);
    flyTo(v.pos, v.target, 2000);
  }
}
for (const k of ["network", "globe"]) $("#mode-" + k).addEventListener("click", () => setMode(k));
document.querySelectorAll("#levels button").forEach((b) => b.addEventListener("click", () => setLevel(b.dataset.level)));

/* ---------- light / dark mode */
const SCENE_THEME = {
  dark: {
    bg: new THREE.Color("#0e0f11"), person: "#f2f2f2", line: 0xc5ccd6, hot: 0xf4f6f8,
    star: new THREE.Vector3(0.93, 0.96, 1.0), starMix: 0.5, starAlpha: 0.75, additive: true, halo: 0.07,
  },
  light: {
    bg: new THREE.Color("#eef0f2"), person: "#2f343b", line: 0x5d646e, hot: 0x1b1d21,
    star: new THREE.Vector3(0.45, 0.48, 0.53), starMix: 1.0, starAlpha: 0.55, additive: false, halo: 0.0,
  },
};
const INTRO_BG = new THREE.Color("#0e0f11"); // the entrance is always a dark stage
const bgNow = new THREE.Color();
function applyTheme(name, persist) {
  THEME = name;
  document.documentElement.dataset.theme = name;
  if (persist) { try { localStorage.setItem("uk-theme", name); } catch (e) { /* private mode */ } }
  const t = SCENE_THEME[name];
  COLORS.person = t.person;
  hubs.filter((h) => h.kind === "person").forEach((h) => h.color.set(t.person));
  for (const [layer, color, blend] of [[baseLines, t.line, t.additive], [hotLines, t.hot, t.additive]]) {
    layer.material.color.setHex(color);
    layer.material.blending = blend ? THREE.AdditiveBlending : THREE.NormalBlending;
  }
  dustMat.uniforms.uStar.value.copy(t.star);
  dustMat.uniforms.uStarMix.value = t.starMix;
  dustMat.uniforms.uStarAlpha.value = t.starAlpha;
  haloMat.opacity = 0;
  $("#theme-toggle").textContent = name === "dark" ? "☾" : "☀";
  $("#theme-toggle").setAttribute("aria-label", name === "dark" ? "Switch to light mode" : "Switch to dark mode");
  loadBaseMap();
  detailKey = ""; // repaint the zoomed-in map in the new colours
  legend();
  if (state.sel) openPanel(state.sel);
}
function sceneBackground() {
  const t = SCENE_THEME[THEME];
  // fade from the dark stage to the theme background while the portrait bursts
  bgNow.copy(INTRO_BG).lerp(t.bg, state.phase === "intro" ? 0 : ease(clamp01(state.enterT * 1.2)));
  renderer.setClearColor(bgNow, 1);
  scene.fog.color.copy(bgNow);
  // additive glow only works on a dark background
  dustMat.blending = THEME === "light" && state.enterT > 0.5 ? THREE.NormalBlending : THREE.AdditiveBlending;
}
$("#open-about").addEventListener("click", () => $("#about").showModal());
$("#intro-about").addEventListener("click", (e) => { e.stopPropagation(); $("#about").showModal(); }); // don't enter
$("#theme-toggle").addEventListener("click", () => applyTheme(THEME === "dark" ? "light" : "dark", true));

/* ---------- music: a tiny player that starts with يا ليلة العيد and shuffles through songs
   from the dataset. All recordings stream from archive.org as plain audio (music.js).
   It tries to play with sound straight away. Browsers only allow that after the visitor has
   interacted with the site, so if it's blocked it starts on the first click or key press —
   usually the click that enters the atlas. It keeps playing inside the atlas. */
const SONGS = (window.UK_MUSIC || []).filter((s) => s.url);
const music = {
  audio: new Audio(),
  i: 0,
  started: false,
  get song() { return SONGS[this.i]; },
  load(i) {
    this.i = i;
    this.audio.src = this.song.url;
    $("#music-title").textContent = this.song.ar;
    $("#music-title").href = this.song.page;
    $("#music").title = `${this.song.title} — archive.org`;
  },
  play() {
    return this.audio.play().then(() => { this.started = true; }).catch(() => { /* blocked until a click */ });
  },
  shuffle() {
    if (SONGS.length < 2) return;
    let j = this.i;
    while (j === this.i) j = Math.floor(Math.random() * SONGS.length);
    this.load(j);
    this.play();
  },
};
function syncMusicButton() {
  const playing = !music.audio.paused;
  $("#music-play").textContent = playing ? "❚❚" : "▶";
  $("#music-play").setAttribute("aria-label", playing ? "Pause" : "Play");
  $("#music").classList.toggle("playing", playing);
}
function setupMusic() {
  if (!SONGS.length) return;
  music.audio.preload = "auto";
  music.audio.addEventListener("play", syncMusicButton);
  music.audio.addEventListener("pause", syncMusicButton);
  music.audio.addEventListener("ended", () => music.shuffle());
  music.audio.addEventListener("error", () => { if (music.started) music.shuffle(); });
  music.load(0); // يا ليلة العيد
  $("#music").hidden = false;
  music.play();
  // if autoplay with sound was blocked, start on the visitor's first click / key press
  const kick = () => {
    if (!music.started && music.audio.paused) music.play();
    removeEventListener("pointerdown", kick, true);
    removeEventListener("keydown", kick, true);
  };
  addEventListener("pointerdown", kick, true);
  addEventListener("keydown", kick, true);
}
$("#music-play").addEventListener("click", (e) => {
  e.stopPropagation();
  if (music.audio.paused) music.play(); else music.audio.pause();
});
$("#music-shuffle").addEventListener("click", (e) => { e.stopPropagation(); music.shuffle(); });
$("#music").addEventListener("click", (e) => e.stopPropagation());
document.querySelectorAll("#hub-toggles input").forEach((cb) => cb.addEventListener("change", () => {
  state.hubOn[cb.dataset.hub] = cb.checked;
  if (state.sel && state.sel.kind === cb.dataset.hub && !cb.checked) select(null);
  configureSim(true);
}));

/* ---------- search */
const options = [
  ...places.map((n) => `${n.p.code} · ${n.p.name}`),
  ...allHubs.filter((h) => h.kind !== "city" || h.places.length > 1).map((h) => `${h.label} — ${HUB_LABEL[h.kind].toLowerCase()}`),
];
$("#search-list").innerHTML = options.map((o) => `<option value="${esc(o)}"></option>`).join("");
function runSearch(q) {
  q = q.trim();
  if (!q) return;
  let d = null;
  const num = q.match(/^(\d{1,3})\b/);
  if (num) d = placeByCode.get(+num[1]);
  if (!d) {
    const m = q.match(/^(.*) — (person|song \/ film|city)$/);
    if (m) d = allHubs.find((h) => h.label === m[1]);
  }
  if (!d) {
    const f = q.toLowerCase();
    d = places.find((n) => n.p.name.toLowerCase().includes(f) || (n.p.nameAr || "").includes(q))
      || allHubs.find((h) => h.label.toLowerCase().includes(f))
      || places.find((n) => (n.p.description + " " + n.p.tags.join(" ")).toLowerCase().includes(f));
  }
  if (!d) {
    $("#search").setCustomValidity("Nothing found");
    $("#search").reportValidity();
    setTimeout(() => $("#search").setCustomValidity(""), 1500);
    return;
  }
  if (d.kind !== "place" && d.places.length > 1) showHubKind(d.kind);
  select(d, { fly: true });
}
$("#search").addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch(e.target.value); });
$("#search").addEventListener("change", (e) => { if (options.includes(e.target.value)) runSearch(e.target.value); });

/* ---------- legend & stats */
function legend() {
  const counts = d3.rollup(places, (v) => v.length, (n) => n.region);
  $("#legend").innerHTML = `<b>Places by region</b>` +
    REGIONS.map(([k, l]) => `<span><i style="background:${COLORS[k]}"></i>${l} <span class="muted">${counts.get(k) || 0}</span></span>`).join("") +
    (state.mode === "network"
      ? `<b style="margin-top:4px">Shared by 2+ places</b>
         <span><i class="sw person" style="border-radius:0"></i>Person</span>
         <span><i class="sw song" style="border-radius:0"></i>Song / film</span>
         <span><i class="sw city" style="border-radius:1px"></i>City</span>`
      : `<span class="muted" style="margin-top:4px">Dots at their real locations.<br>Zoom in (Egypt, Cairo) to separate them.</span>`);
}
legend();
const countries = new Set(places.map((n) => n.p.country).filter((c) => c !== "Unknown"));
$("#stats").textContent = `${places.length} places · ${D.people.length} people · ${D.songs.length} songs & films · ${countries.size} countries`;

/* ---------- deep links & resize */
function fromHash() {
  const h = decodeURIComponent(location.hash.slice(1));
  const mCode = h.match(/^code=(\d+)/);
  const mHub = h.match(/^hub=(.+)/);
  const d = mCode ? placeByCode.get(+mCode[1]) : mHub ? hubMap.get(mHub[1]) : null;
  if (d && d !== state.sel && state.phase === "atlas") {
    if (d.kind !== "place" && d.places.length > 1) showHubKind(d.kind);
    select(d, { fly: true });
  }
}
addEventListener("hashchange", fromHash);
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
});

/* ================================================================ boot */
G.forEach((n) => { n.pcolor = new THREE.Color("#eef1f5"); n.portrait.set(0, PORTRAIT_Y, 0); });
applyTheme(THEME, false);
$("#enter").textContent = "Gathering the portrait…";
setupMusic();
buildPortrait().then(() => { $("#enter").textContent = "Click anywhere to enter"; });
requestAnimationFrame(frame);
window.__atlas = { state, G, camera, controls, select, setMode, music, applyTheme }; // handy for debugging in the console
