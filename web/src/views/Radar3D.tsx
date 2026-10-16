// Procedural 3D model: truncated-pyramid mast with 4 tilted AESA faces, on
// a generic ship sailing a modeled sea (waves, wind, rain, haze).
// - Realistic mode: closed radome with module seams, bolted frame.
// - Technical mode: no radome; modules (subarrays) and elements colored by phase/amplitude.
// Face 0 mirrors the live simulation and emits the beam. The mast is sized from the face.
// The ship rolls, pitches, and heaves per the environment.ts model; with
// electronic stabilization the beam holds its direction in space.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { FaceConfig, FaceGeometry } from '../engine/config';
import type { Weights } from '../engine/array';
import {
  attitudeAt, relDeg, shipMotion, totalHs, visibilityKm, waveField, windSea,
  type EnvConfig, type ShipMotion,
} from '../engine/environment';
import { makeOcean, makeRain, makeSky, type Ocean, type Rain } from './ocean';
import { C0 } from '../engine/config';
import { tr } from '../i18n';
import { FACE_COLOR, beamAt, type ScanClock, type ScanConfig, type ScanPlan } from '../engine/scan';

/** Ongoing scan: the render loop drives the 4 beams with this plan. */
export interface ScanDrive { clock: ScanClock; plan: ScanPlan; cfg: ScanConfig; }
import { fmt } from '../ui/controls';

export interface Radar3DProps {
  face: FaceConfig; g: FaceGeometry; w: Weights; failed: Uint8Array;
  u0: number; v0: number; hpbwDeg: number;
  showBeam: boolean; autoRotate: boolean; allFacesLive: boolean; technical: boolean;
  env: EnvConfig;
  className?: string;
  scan?: ScanDrive | null;
  wBroad?: Weights;            // unsteered weights (taper + failures) for coloring during scan
}

const TILT = 12 * Math.PI / 180;      // face tilt

interface Rig {
  group: THREE.Group;
  elems: THREE.InstancedMesh[];     // elements per face (technical mode)
  technical: THREE.Object3D[];      // layers visible only in technical mode
  radomes: THREE.Object3D[];        // layers visible only in realistic mode
  panel0: THREE.Group;
  panels: THREE.Group[];
  navBar: THREE.Object3D;
  focusY: number; size: number;
}

interface ShipModel { group: THREE.Group; L: number; B: number; sternZ: number; freeboard: number; }

interface Scene {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
  controls: OrbitControls; beams: THREE.Group[]; rig: Rig | null; ship: ShipModel | null; key: string;
  vessel: THREE.Group; ocean: Ocean; rain: Rain; sky: Record<string, THREE.IUniform>;
  sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight;
  motion: ShipMotion; env: EnvConfig; beamQs: THREE.Quaternion[];
  scan: ScanDrive | null; technical: boolean;
  live: { g: FaceGeometry; f: number; amp: Float32Array; failed: Uint8Array } | null;
  frame: number; resume: number;
}

// --- shared materials ------------------------------------------------------------
const MAT = {
  hull: new THREE.MeshStandardMaterial({ color: '#737d85', roughness: 0.62, metalness: 0.2 }),
  hullDark: new THREE.MeshStandardMaterial({ color: '#5d666e', roughness: 0.6, metalness: 0.3 }),
  shipHull: new THREE.MeshStandardMaterial({ color: '#6b757d', roughness: 0.7, metalness: 0.15 }),
  boot: new THREE.MeshStandardMaterial({ color: '#2a2f33', roughness: 0.8 }),
  deck: new THREE.MeshStandardMaterial({ color: '#3d454c', roughness: 0.95 }),
  steel: new THREE.MeshStandardMaterial({ color: '#3a434b', roughness: 0.35, metalness: 0.85 }),
  bezel: new THREE.MeshStandardMaterial({ color: '#4a535b', roughness: 0.4, metalness: 0.7 }),
  radome: new THREE.MeshStandardMaterial({ color: '#59636c', roughness: 0.82, metalness: 0.05 }),
  seam: new THREE.LineBasicMaterial({ color: '#4c565e', transparent: true, opacity: 0.6 }),
  tile: new THREE.MeshStandardMaterial({ color: '#141b22', roughness: 0.5, metalness: 0.8 }),
  backplane: new THREE.MeshStandardMaterial({ color: '#0b1015', roughness: 0.9 }),
  bolt: new THREE.MeshStandardMaterial({ color: '#9aa4ac', roughness: 0.3, metalness: 0.9 }),
  white: new THREE.MeshStandardMaterial({ color: '#e3e7ea', roughness: 0.45 }),
  rail: new THREE.MeshStandardMaterial({ color: '#c9cfd4', roughness: 0.5, metalness: 0.4 }),
  glass: new THREE.MeshStandardMaterial({ color: '#0d2233', roughness: 0.05, metalness: 0.9 }),
  person: new THREE.MeshStandardMaterial({ color: '#ff8a1f', roughness: 0.7 }),
  grid: new THREE.LineBasicMaterial({ color: '#7f93a6', transparent: true, opacity: 0.55 }),
  paint: new THREE.LineBasicMaterial({ color: '#d8dde0', transparent: true, opacity: 0.7 }),
};
const SHARED = new Set<THREE.Material>(Object.values(MAT));

function box(w: number, h: number, d: number, m: THREE.Material) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.castShadow = true; b.receiveShadow = true; return b;
}
function cyl(rt: number, rb: number, h: number, m: THREE.Material, seg = 16) {
  const c = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  c.castShadow = true; return c;
}

/** Square railing (handrail + stanchions) with half-side a, resting at y. */
function railing(a: number, y: number, h: number): THREE.Group {
  const gr = new THREE.Group();
  for (const s of [-1, 1]) {
    for (const yy of [h, h * 0.5]) {
      const r1 = box(2 * a, 0.04, 0.04, MAT.rail); r1.position.set(0, y + yy, s * a); gr.add(r1);
      const r2 = box(0.04, 0.04, 2 * a, MAT.rail); r2.position.set(s * a, y + yy, 0); gr.add(r2);
    }
  }
  const n = Math.max(2, Math.round(2 * a / 1.2));
  for (let i = 0; i <= n; i++) {
    const t = -a + 2 * a * i / n;
    for (const [x, z] of [[t, -a], [t, a], [-a, t], [a, t]]) {
      const p = cyl(0.025, 0.025, h, MAT.rail, 6); p.position.set(x, y + h / 2, z); gr.add(p);
    }
  }
  return gr;
}

/** One AESA face in local coordinates (x right, y up, z outward normal). */
function buildPanel(face: FaceConfig, g: FaceGeometry, rig: Rig, isFront: boolean): THREE.Group {
  const panel = new THREE.Group();
  const Aw = g.Nx * g.d, Ah = g.Ny * g.d;
  const A = Math.max(Aw, Ah);
  const bz = Math.max(0.05, 0.035 * A);            // frame width
  const depth = Math.max(0.08, 0.05 * A);
  const m4 = new THREE.Matrix4();

  // frame and backplate
  const fw = Aw + 2 * bz, fh = Ah + 2 * bz;
  for (const [w, h, x, y] of [[fw, bz, 0, (Ah + bz) / 2], [fw, bz, 0, -(Ah + bz) / 2], [bz, Ah, (Aw + bz) / 2, 0], [bz, Ah, -(Aw + bz) / 2, 0]]) {
    const b = box(w, h, depth, MAT.bezel); b.position.set(x, y, depth / 2); panel.add(b);
  }
  const back = box(Aw, Ah, 0.02, MAT.backplane); back.position.z = 0.01; panel.add(back);

  // frame bolts
  const nb = Math.max(4, Math.round((Aw + Ah) / 0.25));
  const bolts = new THREE.InstancedMesh(new THREE.CylinderGeometry(bz * 0.12, bz * 0.12, 0.02, 8), MAT.bolt, 4 * nb);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
  const one = new THREE.Vector3(1, 1, 1);
  let k = 0;
  for (let i = 0; i < nb; i++) {
    const tx = -fw / 2 + bz / 2 + (fw - bz) * i / (nb - 1), ty = -fh / 2 + bz / 2 + (fh - bz) * i / (nb - 1);
    for (const [x, y] of [[tx, (Ah + bz) / 2], [tx, -(Ah + bz) / 2], [(Aw + bz) / 2, ty], [-(Aw + bz) / 2, ty]]) {
      m4.compose(new THREE.Vector3(x, y, depth + 0.005), q, one);
      bolts.setMatrixAt(k++, m4);
    }
  }
  panel.add(bolts);

  // --- technical mode: modules (subarrays) and elements --------------------
  const tech = new THREE.Group();
  const sw = face.subNx * g.d, sh = face.subNy * g.d, gap = Math.min(0.012, 0.06 * g.d);
  const tiles = new THREE.InstancedMesh(new THREE.BoxGeometry(sw - gap, sh - gap, depth * 0.5), MAT.tile, face.nSubX * face.nSubY);
  let t = 0;
  for (let sy = 0; sy < face.nSubY; sy++) for (let sx = 0; sx < face.nSubX; sx++) {
    m4.makeTranslation(-Aw / 2 + (sx + 0.5) * sw, -Ah / 2 + (sy + 0.5) * sh, depth * 0.25 + 0.02);
    tiles.setMatrixAt(t++, m4);
  }
  tiles.castShadow = true; tech.add(tiles);
  const zEl = depth * 0.5 + 0.022;
  const elems = new THREE.InstancedMesh(new THREE.PlaneGeometry(g.d * 0.72, g.d * 0.72),
    new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), g.N);
  const c0 = new THREE.Color('#14324a');
  for (let i = 0; i < g.N; i++) {
    m4.makeTranslation(g.x[i], g.y[i], zEl);
    elems.setMatrixAt(i, m4);
    elems.setColorAt(i, c0);
  }
  tech.add(elems);
  if (face.nSubX * face.nSubY > 1) {
    const gp: number[] = [], zg = zEl + 0.002;
    for (let sx = 0; sx <= face.nSubX; sx++) { const x = -Aw / 2 + sx * sw; gp.push(x, -Ah / 2, zg, x, Ah / 2, zg); }
    for (let sy = 0; sy <= face.nSubY; sy++) { const y = -Ah / 2 + sy * sh; gp.push(-Aw / 2, y, zg, Aw / 2, y, zg); }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
    tech.add(new THREE.LineSegments(lg, MAT.grid));
  }
  rig.elems.push(elems);
  rig.technical.push(tech);
  panel.add(tech);

  // --- realistic mode: radome with module seams --------------------------------
  const rad = new THREE.Group();
  const shell = box(Aw, Ah, 0.03, MAT.radome); shell.position.z = depth * 0.5 + 0.03; rad.add(shell);
  const pts: number[] = [], z = depth * 0.5 + 0.047;
  for (let sx = 1; sx < face.nSubX; sx++) { const x = -Aw / 2 + sx * sw; pts.push(x, -Ah / 2, z, x, Ah / 2, z); }
  for (let sy = 1; sy < face.nSubY; sy++) { const y = -Ah / 2 + sy * sh; pts.push(-Aw / 2, y, z, Aw / 2, y, z); }
  if (pts.length) {
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    rad.add(new THREE.LineSegments(lg, MAT.seam));
  }
  rig.radomes.push(rad);
  panel.add(rad);

  if (isFront) rig.panel0 = panel;
  rig.panels.push(panel);
  return panel;
}

/** Complete mast sized from the face. */
function buildRig(face: FaceConfig, g: FaceGeometry): Rig {
  const rig: Rig = { group: new THREE.Group(), elems: [], technical: [], radomes: [], panel0: new THREE.Group(), panels: [], navBar: new THREE.Group(), focusY: 0, size: 0 };
  const A = Math.max(g.Nx * g.d, g.Ny * g.d);
  const margin = 0.28 * A + 0.35;
  const H = 2.3 * A + 2.2;                       // frustum height
  const y0 = 0.35;                               // plinth height
  const yc = 0.55 * H;                           // face center above the plinth
  const B = A / 2 + margin + H * Math.tan(TILT) * (yc / H);
  const T = B - H * Math.tan(TILT);
  const half = (y: number) => B - (B - T) * y / H;   // frustum half-width at height y
  rig.size = H;

  const plinth = box(2 * B + 0.4, y0, 2 * B + 0.4, MAT.hullDark); plinth.position.y = y0 / 2; rig.group.add(plinth);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(T * Math.SQRT2, B * Math.SQRT2, H, 4, 1), MAT.hull);
  mast.rotation.y = Math.PI / 4; mast.position.y = y0 + H / 2; mast.castShadow = true; mast.receiveShadow = true;
  rig.group.add(mast);

  for (let k = 0; k < 4; k++) {
    const yaw = new THREE.Group(); yaw.rotation.y = k * Math.PI / 2;
    // maintenance door, offset to one side
    const dh = Math.min(2.0, 0.22 * H), dw = Math.min(0.9, 0.5 * dh), yD = 0.08 + dh / 2;
    const door = box(dw, dh, 0.05, MAT.hullDark);
    door.position.set(0.55 * B, y0 + yD, half(yD) + 0.01); door.rotation.x = -TILT; yaw.add(door);
    // AESA face
    const panel = buildPanel(face, g, rig, k === 0);
    panel.position.set(0, y0 + yc, half(yc) + 0.005);
    panel.rotation.x = -TILT;
    yaw.add(panel);
    rig.group.add(yaw);
  }

  // top deck, railing, and superstructure
  const yTop = y0 + H;
  const deck = box(2 * T + 0.3, 0.12, 2 * T + 0.3, MAT.hullDark); deck.position.y = yTop + 0.06; rig.group.add(deck);
  rig.group.add(railing(T + 0.1, yTop + 0.12, Math.min(1.0, 0.18 * H)));
  const houseH = 0.16 * H + 0.4;
  const house = box(1.1 * T, houseH, 1.1 * T, MAT.hull); house.position.y = yTop + 0.12 + houseH / 2; rig.group.add(house);
  const yH = yTop + 0.12 + houseH;
  // pole mast, yardarms, rotating navigation radar, domes
  const poleH = 0.55 * H + 1.5;
  const pole = cyl(0.06 + 0.012 * H, 0.1 + 0.02 * H, poleH, MAT.steel); pole.position.y = yH + poleH / 2; rig.group.add(pole);
  const yard1 = box(1.6 * T, 0.08, 0.12, MAT.steel); yard1.position.y = yH + 0.45 * poleH; rig.group.add(yard1);
  const yard2 = box(1.0 * T, 0.07, 0.1, MAT.steel); yard2.position.y = yH + 0.75 * poleH; rig.group.add(yard2);
  for (const s of [-1, 1]) {
    const rD = 0.12 + 0.03 * H;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(rD, 24, 16), MAT.white);
    dome.position.set(s * 0.75 * T, yH + 0.45 * poleH + rD + 0.04, 0); dome.castShadow = true; rig.group.add(dome);
    const whip = cyl(0.015, 0.02, 0.35 * poleH, MAT.steel, 6); whip.position.set(s * 0.48 * T, yH + 0.925 * poleH, 0); rig.group.add(whip);
  }
  const nav = new THREE.Group();
  const navW = Math.min(4, 0.9 * T + 0.6);
  const bar = box(navW, 0.16, 0.22, MAT.white); bar.position.y = 0.25; nav.add(bar);
  const ped = cyl(0.12, 0.16, 0.3, MAT.steel); ped.position.y = 0.08; nav.add(ped);
  nav.position.y = yH + 0.6 * poleH; rig.group.add(nav); rig.navBar = nav;
  const topBall = new THREE.Mesh(new THREE.SphereGeometry(0.1 + 0.025 * H, 24, 16), MAT.white);
  topBall.position.y = yH + poleH + 0.05; rig.group.add(topBall);
  // electro-optical sensor at a corner of the superstructure
  const eo = new THREE.Group();
  const yoke = cyl(0.08, 0.1, 0.25, MAT.hullDark); yoke.position.y = 0.12; eo.add(yoke);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 16), MAT.hullDark); ball.position.y = 0.42; eo.add(ball);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.1, 20), MAT.glass); lens.position.set(0, 0.42, 0.221); eo.add(lens);
  eo.position.set(0.4 * T, yH, 0.4 * T); rig.group.add(eo);

  // human figure for scale (1.8 m) next to the base
  const person = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 1.0, 4, 12), MAT.person); body.position.y = 0.7; person.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), MAT.white); head.position.y = 1.58; person.add(head);
  person.traverse(o => { o.castShadow = true; });
  person.position.set(B + 1.2, 0, B * 0.6);
  rig.group.add(person);

  const total = yH + poleH;                     // total height including the pole mast
  rig.focusY = 0.45 * total;
  rig.size = total;
  return rig;
}

/**
 * Generic surface combatant hull, sized from the mast.
 * Bow toward +z, deck at y = 0, waterline at y = −freeboard.
 */
function buildShip(rigSize: number, rigBase: number): ShipModel {
  const L = Math.min(150, Math.max(30, 5.5 * rigSize));
  const B = Math.max(0.13 * L, 2 * rigBase + 3);
  const fb = 0.055 * L, draft = 0.035 * L;
  const sternZ = -0.62 * L, bowZ = 0.38 * L;
  const group = new THREE.Group();

  const outline = (inset: number) => {
    const s = new THREE.Shape();
    const hw = B / 2 - inset;
    s.moveTo(-hw, sternZ + inset);
    s.lineTo(hw, sternZ + inset);
    s.lineTo(hw, 0.02 * L);
    s.quadraticCurveTo(hw * 0.95, 0.27 * L, 0, bowZ - inset);
    s.quadraticCurveTo(-hw * 0.95, 0.27 * L, -hw, 0.02 * L);
    s.closePath();
    return s;
  };
  // hull: (x, z) shape extruded downward; dark band at the waterline
  const ext = (shape: THREE.Shape, depth: number, m: THREE.Material, y: number) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 18 });
    g.rotateX(Math.PI / 2);         // (x, y_forma, z_ext) → (x, −z_ext, y_forma)
    const mesh = new THREE.Mesh(g, m);
    mesh.position.y = y; mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  ext(outline(0), fb - 0.6, MAT.shipHull, 0);
  ext(outline(0.02), 1.2, MAT.boot, -(fb - 0.6));
  ext(outline(0.06), draft, MAT.boot, -(fb + 0.6));
  const deckG = new THREE.ShapeGeometry(outline(0.15), 18);
  deckG.rotateX(Math.PI / 2);
  const deck = new THREE.Mesh(deckG, MAT.deck);
  deck.position.y = 0.01; deck.receiveShadow = true;
  // after rotation ShapeGeometry faces −y: flipped so the deck faces up
  deck.scale.y = -1; (deck.material as THREE.Material).side = THREE.DoubleSide;
  group.add(deck);

  const u = L / 140;                                         // scale relative to a 140 m frigate
  // bow gun mount
  const gun = new THREE.Group();
  const turret = cyl(1.6 * u, 2.1 * u, 1.6 * u, MAT.hull, 7); turret.position.y = 0.8 * u; gun.add(turret);
  const barrel = cyl(0.13 * u, 0.18 * u, 6 * u, MAT.steel, 8); barrel.rotation.x = Math.PI / 2 - 0.12; barrel.position.set(0, 1.05 * u, 3.2 * u); gun.add(barrel);
  gun.position.z = 0.24 * L; group.add(gun);
  // vertical launchers
  const vls = box(0.45 * B, 0.12, 0.07 * L, MAT.boot); vls.position.set(0, 0.06, 0.13 * L); group.add(vls);
  // aft superstructure: funnel, hangar, and flight deck
  const funnel = box(0.32 * B, 7 * u, 9 * u, MAT.hull); funnel.position.set(0, 3.5 * u, -0.17 * L); group.add(funnel);
  const funTop = box(0.26 * B, 0.6 * u, 7 * u, MAT.boot); funTop.position.set(0, 7.3 * u, -0.17 * L); group.add(funTop);
  const hangarL = 0.16 * L;
  const hangar = box(0.72 * B, 6 * u, hangarL, MAT.hull); hangar.position.set(0, 3 * u, -0.29 * L); group.add(hangar);
  const ring: number[] = [];
  const zH = -0.5 * L, rH = 0.3 * B;
  for (let i = 0; i < 48; i++) {
    const a = 2 * Math.PI * i / 48, b = 2 * Math.PI * (i + 1) / 48;
    ring.push(rH * Math.cos(a), 0.03, zH + rH * Math.sin(a), rH * Math.cos(b), 0.03, zH + rH * Math.sin(b));
  }
  ring.push(-0.38 * B, 0.03, sternZ + 1, -0.38 * B, 0.03, -0.37 * L, 0.38 * B, 0.03, sternZ + 1, 0.38 * B, 0.03, -0.37 * L);
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(ring, 3));
  group.add(new THREE.LineSegments(rg, MAT.paint));
  // boats along the side
  for (const s of [-1, 1]) {
    const boat = new THREE.Mesh(new THREE.CapsuleGeometry(0.9 * u, 5 * u, 4, 8), MAT.white);
    boat.rotation.x = Math.PI / 2; boat.position.set(s * (B / 2 - 1.1 * u), 1.6 * u, -0.2 * L - 6 * u); boat.castShadow = true;
    group.add(boat);
  }
  return { group, L, B, sternZ, freeboard: fb };
}

function disposeTree(o: THREE.Object3D) {
  o.traverse(c => {
    const m = c as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach(x => { if (!SHARED.has(x)) x.dispose(); });
    else if (mat && !SHARED.has(mat)) mat.dispose();
  });
}

const SUN_DIR = new THREE.Vector3(0.55, 0.42, 0.72).normalize();

/** Applies weather to the sky, fog, lights, and ocean. */
function applyEnv(s: Scene, e: EnvConfig) {
  const cloud = Math.min(1, e.rainMmH / 8 + Math.max(0, e.rhPct - 80) / 60);
  const haze = Math.min(1, Math.max(0, (e.rhPct - 35) / 65) * 0.7 + cloud * 0.5);
  const sk = s.sky;
  (sk.uZenith.value as THREE.Color).set('#2f6ea8').lerp(new THREE.Color('#5d6a76'), cloud);
  (sk.uHorizon.value as THREE.Color).set('#bcd3e4').lerp(new THREE.Color('#d9e0e4'), haze * 0.6).lerp(new THREE.Color('#7f8a93'), cloud * 0.8);
  (sk.uSunColor.value as THREE.Color).set('#fff1dc').multiplyScalar(1 - 0.75 * cloud);
  sk.uHaze.value = haze;
  const vis = visibilityKm(e) * 1000;
  const dens = 3.912 / vis * 0.9;
  const fogColor = (sk.uHorizon.value as THREE.Color).clone();
  (s.scene.fog as THREE.FogExp2).color.copy(fogColor);
  (s.scene.fog as THREE.FogExp2).density = dens;
  s.ocean.uniforms.uFogColor.value.copy(fogColor);
  s.ocean.uniforms.uFogDensity.value = dens;
  (s.ocean.uniforms.uDeep.value as THREE.Color).set('#03141f').lerp(new THREE.Color('#1e2a30'), cloud * 0.7);
  (s.ocean.uniforms.uShallow.value as THREE.Color).set('#0e4552').lerp(new THREE.Color('#3b4d55'), cloud * 0.7);
  s.sun.intensity = 2.6 * (1 - 0.7 * cloud);
  s.hemi.intensity = 0.7 + 0.5 * cloud;
  s.scene.environmentIntensity = 0.35 + 0.25 * cloud;

  const waves = waveField(e, 10, 5);
  s.ocean.setWaves(waves, totalHs(e), e.windMs);
  s.motion = shipMotion(e);
  s.env = e;
}

/** Colors the elements of face k with the phase law for steering (u0, v0). */
function paintFace(s: Scene, k: number, u0: number, v0: number, c: THREE.Color) {
  const lv = s.live, inst = s.rig?.elems[k];
  if (!lv || !inst || inst.count !== lv.g.N) return;
  const kw = 2 * Math.PI * lv.f / C0, { x, y } = lv.g;
  for (let i = 0; i < lv.g.N; i++) {
    if (k === 0 && lv.failed[i]) { c.set('#ff2a2a'); inst.setColorAt(i, c); continue; }
    const ph = -kw * (x[i] * u0 + y[i] * v0);
    const h = ((ph / (2 * Math.PI)) % 1 + 1 + 0.52) % 1;
    c.setHSL(h, 0.75, 0.16 + 0.42 * lv.amp[i]);
    inst.setColorAt(i, c);
  }
  inst.instanceColor!.needsUpdate = true;
}

export function Radar3D(p: Radar3DProps) {
  const host = useRef<HTMLDivElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  const S = useRef<Scene | null>(null);

  // --- base scene ------------------------------------------------------------------
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    // adaptive resolution: drops if frames are slow, rises when there is headroom
    const dprMax = Math.min(window.devicePixelRatio, 1.5);
    let dpr = dprMax;
    renderer.setPixelRatio(dpr);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2('#b5c6d4', 0.0002);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    scene.environmentIntensity = 0.4;

    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 20000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.53;
    controls.autoRotateSpeed = 0.6;

    const hemi = new THREE.HemisphereLight('#c4d6e6', '#1b2a33', 0.7);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight('#fff1dc', 2.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);

    const sky: Record<string, THREE.IUniform> = {
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
      uSunDir: { value: SUN_DIR.clone() }, uSunColor: { value: new THREE.Color() }, uHaze: { value: 0 },
    };
    scene.add(makeSky(sky));
    const ocean = makeOcean(sky);
    scene.add(ocean.mesh);
    const rain = makeRain();
    scene.add(rain.lines);

    const vessel = new THREE.Group();
    vessel.rotation.order = 'YXZ';
    scene.add(vessel);

    // one beam per face (in normal mode only face 0 is live)
    const beams = FACE_COLOR.map(col => {
      const b = new THREE.Group();
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 48, 1, true), new THREE.MeshBasicMaterial({
        color: col, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      }));
      cone.name = 'cone';
      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 8),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(col).lerp(new THREE.Color('#ffffff'), 0.4), transparent: true, opacity: 0.85, fog: false }));
      core.name = 'core';
      b.add(cone, core);
      b.position.set(0, 0, 0.15);
      return b;
    });
    const cones = beams.map(b => b.getObjectByName('cone') as THREE.Mesh);

    const s: Scene = {
      renderer, scene, camera, controls, beams, rig: null, ship: null, key: '', vessel, ocean, rain, sky, sun, hemi,
      motion: shipMotion(p.env), env: p.env, beamQs: beams.map(() => new THREE.Quaternion()), frame: 0, resume: 0,
      scan: null, technical: false, live: null,
    };
    S.current = s;
    applyEnv(s, p.env);

    controls.addEventListener('start', () => { controls.autoRotate = false; clearTimeout(s.resume); });
    controls.addEventListener('end', () => {
      clearTimeout(s.resume);
      s.resume = window.setTimeout(() => { controls.autoRotate = el.dataset.auto === '1'; }, 2500);
    });

    const ro = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    });
    ro.observe(el);

    const timer = new THREE.Timer();
    const qM = new THREE.Quaternion(), qP = new THREE.Quaternion(), qTmp = new THREE.Quaternion();
    const wind = new THREE.Vector3();
    let hudT = 0, colT = 0;
    const Y = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), col = new THREE.Color();
    // only render while the canvas is on screen
    let visible = true;
    const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; });
    io.observe(el);
    let ft = 16, slow = 0, fast = 0;
    const loop = () => {
      s.frame = requestAnimationFrame(loop);
      timer.update();
      const dt = Math.min(timer.getDelta(), 0.1), t = timer.getElapsed();
      if (!visible) return;
      ft = 0.9 * ft + 0.1 * dt * 1000;
      if (ft > 24) { slow++; fast = 0; } else if (ft < 13) { fast++; slow = 0; } else { slow = fast = 0; }
      if (slow > 40 && dpr > 0.6) { dpr = Math.max(0.6, dpr - 0.2); renderer.setPixelRatio(dpr); slow = 0; }
      if (fast > 180 && dpr < dprMax) { dpr = Math.min(dprMax, dpr + 0.1); renderer.setPixelRatio(dpr); fast = 0; }
      const e = s.env;
      const U = e.speedKn * 0.5144;
      // ship motion
      const a = attitudeAt(s.motion, t);
      const fb = s.ship?.freeboard ?? 0;
      vessel.position.y = fb + a.heave * 0.85;
      vessel.rotation.set(-a.pitch, 0, a.roll);
      vessel.updateMatrixWorld(true);
      ocean.uniforms.uTime.value = t;
      ocean.uniforms.uFlow.value = U * t;
      // scan: the plan sets each face's pointing at this instant
      const sc = s.scan;
      if (sc && s.rig) {
        const ts = sc.clock.now();
        colT += dt;
        const recolor = s.technical && s.live && colT > 0.1;
        if (recolor) colT = 0;
        for (let k = 0; k < 4; k++) {
          const st = beamAt(sc.plan, sc.cfg, k, ts);
          const ce = Math.cos(st.elDeg * Math.PI / 180);
          const u0 = ce * Math.sin(st.azDeg * Math.PI / 180), v0 = Math.sin(st.elDeg * Math.PI / 180);
          dir.set(u0, v0, Math.sqrt(Math.max(0, 1 - u0 * u0 - v0 * v0)));
          s.beamQs[k].setFromUnitVectors(Y, dir);
          if (recolor) paintFace(s, k, u0, v0, col);
        }
      }
      // beams: with stabilization they hold the commanded direction in space
      if (s.rig) {
        qM.copy(vessel.quaternion).invert();
        for (let k = 0; k < 4; k++) {
          if (!beams[k].visible) continue;
          if (e.beamStab) {
            s.rig.panels[k].getWorldQuaternion(qP);
            qTmp.copy(qP).invert().multiply(qM).multiply(qP).multiply(s.beamQs[k]);
            beams[k].quaternion.copy(qTmp);
          } else beams[k].quaternion.copy(s.beamQs[k]);
        }
        s.rig.navBar.rotation.y += dt * 2.6;
      }
      // rain with wind drift (blows FROM windDir, toward the stern if coming from the bow)
      const wr = relDeg(e.windDirDeg, e.headingDeg) * Math.PI / 180;
      wind.set(Math.sin(wr), 0, -Math.cos(wr)).multiplyScalar(e.windMs * 0.6);
      wind.z -= U * 0.6;
      rain.update(dt, controls.target, wind, e.rainMmH);
      controls.update();
      // keep the camera above the water
      if (camera.position.y < 1.5) camera.position.y = 1.5;
      for (const c of cones) (c.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.05 * Math.sin(t * 3);
      renderer.render(scene, camera);
      hudT += dt;
      if (hud.current && hudT > 0.12) {
        hudT = 0;
        const d = (x: number) => (x >= 0 ? '+' : '−') + fmt(Math.abs(x * 180 / Math.PI), 1) + '°';
        hud.current.textContent = tr(`balance ${d(a.roll)}   cabeceo ${d(a.pitch)}   arfada ${a.heave >= 0 ? '+' : '−'}${fmt(Math.abs(a.heave), 1)} m   ·   haz ${e.beamStab ? 'estabilizado' : 'SIN estabilizar'}`,
          `roll ${d(a.roll)}   pitch ${d(a.pitch)}   heave ${a.heave >= 0 ? '+' : '−'}${fmt(Math.abs(a.heave), 1)} m   ·   beam ${e.beamStab ? 'stabilized' : 'NOT stabilized'}`);
      }
    };
    loop();

    return () => {
      cancelAnimationFrame(s.frame); clearTimeout(s.resume); ro.disconnect(); io.disconnect();
      controls.dispose(); disposeTree(scene); envTex.dispose(); pmrem.dispose(); renderer.dispose();
      el.removeChild(renderer.domElement);
      S.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- environment -----------------------------------------------------------------
  useEffect(() => { const s = S.current; if (s) applyEnv(s, p.env); }, [p.env]);

  // --- mast, ship, and faces (rebuilt when geometry changes) -------------------------
  useEffect(() => {
    const s = S.current; if (!s) return;
    const key = `${p.g.Nx}x${p.g.Ny}:${p.face.subNx}x${p.face.subNy}:${p.g.d}`;
    if (key === s.key) return;
    s.key = key;
    s.beams.forEach(b => b.removeFromParent());
    if (s.rig) { s.vessel.remove(s.rig.group); disposeTree(s.rig.group); }
    if (s.ship) { s.vessel.remove(s.ship.group); disposeTree(s.ship.group); }
    const rig = buildRig(p.face, p.g);
    const A = Math.max(p.g.Nx * p.g.d, p.g.Ny * p.g.d);
    const ship = buildShip(rig.size, A / 2 + 0.28 * A + 0.35 + 0.6);
    s.rig = rig; s.ship = ship;
    s.vessel.add(ship.group, rig.group);
    rig.panels.forEach((pn, k) => pn.add(s.beams[k]));
    s.ocean.setHull(ship.L, ship.B, ship.sternZ, s.env.speedKn * 0.5144);

    const R = Math.max(rig.size * 0.9, ship.L * 0.55);
    const sun = s.sun;
    sun.position.copy(SUN_DIR).multiplyScalar(R * 3); sun.target.position.set(0, 0, 0);
    Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 0.5, far: R * 7 });
    sun.shadow.camera.updateProjectionMatrix();

    const d = Math.max(rig.size * 1.9 + 4, ship.L * 0.85);
    const fy = ship.freeboard + rig.focusY * 0.6;
    s.controls.target.set(0, fy, -0.1 * ship.L);
    s.camera.position.set(d * 0.72, fy + d * 0.16, d * 0.62);
    s.controls.minDistance = rig.size * 0.25; s.controls.maxDistance = Math.max(d * 3, ship.L * 2.2);
    s.controls.update();
  }, [p.g, p.face]);

  useEffect(() => { const s = S.current; if (s?.ship) s.ocean.setHull(s.ship.L, s.ship.B, s.ship.sternZ, p.env.speedKn * 0.5144); }, [p.env.speedKn, p.g]);

  // --- realistic / technical mode ---------------------------------------------------
  useEffect(() => {
    const s = S.current, r = s?.rig; if (!s || !r) return;
    s.technical = p.technical;
    r.technical.forEach(o => { o.visible = p.technical; });
    r.radomes.forEach(o => { o.visible = !p.technical; });
  }, [p.technical, p.g, p.face]);

  // --- element colors (phase · amplitude · failures) -----------------------
  useEffect(() => {
    const s = S.current, r = s?.rig; if (!s || !r) return;
    // data for recoloring during scan (normalized taper amplitude)
    if (p.wBroad && p.wBroad.re.length === p.g.N) {
      const amp = new Float32Array(p.g.N); let m = 0;
      for (let i = 0; i < p.g.N; i++) { amp[i] = Math.hypot(p.wBroad.re[i], p.wBroad.im[i]); m = Math.max(m, amp[i]); }
      for (let i = 0; i < p.g.N; i++) amp[i] /= m || 1;
      s.live = { g: p.g, f: p.face.f0, amp, failed: p.failed };
    }
    if (p.scan) return;                        // during scan the render loop does the coloring
    const { w, failed, g } = p;
    if (w.re.length !== g.N || failed.length !== g.N) return;
    let amax = 0;
    for (let i = 0; i < g.N; i++) amax = Math.max(amax, Math.hypot(w.re[i], w.im[i]));
    const c = new THREE.Color();
    r.elems.forEach((inst, k) => {
      const live = k === 0 || p.allFacesLive;
      for (let i = 0; i < g.N; i++) {
        if (live && failed[i]) c.set('#ff2a2a');
        else if (!live) c.setRGB(0.05, 0.13, 0.19);
        else {
          const a = Math.hypot(w.re[i], w.im[i]) / (amax || 1);
          const h = ((Math.atan2(w.im[i], w.re[i]) / (2 * Math.PI)) + 1.52) % 1;   // phase 0 → cyan
          c.setHSL(h, 0.75, 0.16 + 0.42 * a);
        }
        inst.setColorAt(i, c);
      }
      inst.instanceColor!.needsUpdate = true;
    });
  }, [p.w, p.failed, p.allFacesLive, p.g, p.face, p.scan, p.wBroad]);

  // --- beams ---------------------------------------------------------------------
  useEffect(() => { const s = S.current; if (s) s.scan = p.scan ?? null; }, [p.scan]);
  useEffect(() => {
    const s = S.current; if (!s?.rig) return;
    const L = s.rig.size * 1.6;
    // width exaggerated ×4 (at true scale a ~1.7° beam is a needle); capped at 35°
    const halfAng = Math.min(35, p.hpbwDeg * 2) * Math.PI / 180;
    const r = Math.max(Math.tan(halfAng) * L, 0.02 * L);
    s.beams.forEach((b, k) => {
      b.visible = p.showBeam && (k === 0 || !!p.scan);
      const cone = b.getObjectByName('cone') as THREE.Mesh, core = b.getObjectByName('core') as THREE.Mesh;
      cone.scale.set(r, L, r); cone.position.set(0, L / 2, 0); cone.rotation.set(Math.PI, 0, 0);
      core.scale.set(1, L, 1); core.position.set(0, L / 2, 0);
    });
    if (!p.scan) {
      const wv = Math.sqrt(Math.max(0, 1 - p.u0 * p.u0 - p.v0 * p.v0));
      s.beamQs[0].setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(p.u0, p.v0, wv).normalize());
    }
  }, [p.u0, p.v0, p.hpbwDeg, p.showBeam, p.g, p.face, p.scan]);

  useEffect(() => {
    const s = S.current; if (!s) return;
    host.current!.dataset.auto = p.autoRotate ? '1' : '0';
    s.controls.autoRotate = p.autoRotate;
  }, [p.autoRotate]);

  const ws = windSea(p.env.windMs);
  return (
    <div className={'r3d-wrap ' + (p.className ?? '')}>
      <div ref={host} className="r3d" />
      <div ref={hud} className="hud" />
      <div className="hud-tl">
        {tr('viento', 'wind')} {fmt(p.env.windMs, 0)} m/s · Hs {fmt(Math.hypot(ws.hs, p.env.swellHm), 1)} m · {fmt(p.env.speedKn, 0)} kn
      </div>
    </div>
  );
}
