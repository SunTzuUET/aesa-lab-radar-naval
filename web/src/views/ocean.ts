// Procedural ocean and sky for the 3D view.
// - Ocean: sum of Gerstner waves (the same spectral components that move
//   the ship), wind-driven whitecaps, and hull foam and wake that scale with
//   speed. The water "flows" aft at ship speed (ship frame).
// - Sky: zenith-to-horizon gradient with humidity haze and rain-driven overcast.
import * as THREE from 'three';
import type { WaveComp } from '../engine/environment';

export const MAX_WAVES = 16;

const SKY_GLSL = /* glsl */`
uniform vec3 uZenith, uHorizon, uSunDir, uSunColor;
uniform float uHaze;
vec3 skyColor(vec3 d) {
  float h = max(d.y, 0.0);
  vec3 c = mix(uHorizon, uZenith, pow(h, 0.45 + 0.5 * uHaze));
  float s = max(dot(d, uSunDir), 0.0);
  c += uSunColor * (pow(s, 900.0) * 6.0 * (1.0 - uHaze) + pow(s, 12.0) * 0.25 + pow(s, 3.0) * 0.08 * (1.0 - 0.5 * uHaze));
  return c;
}
`;

export function makeSky(uniforms: Record<string, THREE.IUniform>): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
        vec4 p = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: SKY_GLSL + /* glsl */`
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = d.y < 0.0 ? uHorizon : skyColor(d);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
  m.scale.setScalar(8000);
  m.frustumCulled = false;
  m.renderOrder = -1;
  return m;
}

/** Polar mesh: dense near the ship, sparse far away. */
function polarGrid(rMax: number, nr: number, na: number): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= nr; i++) {
    const r = rMax * Math.pow(i / nr, 2.3);
    for (let j = 0; j < na; j++) {
      const a = 2 * Math.PI * j / na;
      pos.push(r * Math.cos(a), 0, r * Math.sin(a));
    }
  }
  for (let i = 0; i < nr; i++) for (let j = 0; j < na; j++) {
    const a = i * na + j, b = i * na + (j + 1) % na, c = (i + 1) * na + j, d = (i + 1) * na + (j + 1) % na;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), rMax + 50);
  return g;
}

export interface Ocean {
  mesh: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;
  setWaves(w: WaveComp[], hs: number, windMs: number): void;
  setHull(lengthM: number, beamM: number, sternZ: number, speedMs: number): void;
}

export function makeOcean(sky: Record<string, THREE.IUniform>): Ocean {
  const uniforms: Record<string, THREE.IUniform> = {
    ...sky,
    uTime: { value: 0 },
    uFlow: { value: 0 },
    uWaveA: { value: Array.from({ length: MAX_WAVES }, () => new THREE.Vector4()) },   // dx, dz, k, amp
    uWaveB: { value: Array.from({ length: MAX_WAVES }, () => new THREE.Vector2()) },   // ω, phase
    uNWaves: { value: 0 },
    uSteep: { value: 0.5 },
    uHs: { value: 1 },
    uWind: { value: 0 },
    uDeep: { value: new THREE.Color('#06202e') },
    uShallow: { value: new THREE.Color('#1d5466') },
    uFogColor: { value: new THREE.Color('#9fb3c4') },
    uFogDensity: { value: 0.0002 },
    uHull: { value: new THREE.Vector4(140, 18, -86, 0) },   // length, beam, stern z, speed
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      #define MAXW ${MAX_WAVES}
      uniform float uTime, uFlow, uSteep;
      uniform vec4 uWaveA[MAXW];
      uniform vec2 uWaveB[MAXW];
      uniform int uNWaves;
      varying vec3 vWorld, vNormal;
      varying float vCrest;
      void main() {
        vec3 p = position;
        vec2 q = p.xz + vec2(0.0, uFlow);
        vec3 disp = vec3(0.0);
        vec3 n = vec3(0.0, 1.0, 0.0);
        float crest = 0.0;
        // attenuate short waves far from the camera (avoids aliasing)
        float dist = length(p.xz);
        for (int i = 0; i < MAXW; i++) {
          if (i >= uNWaves) break;
          vec4 A = uWaveA[i];
          vec2 d = A.xy; float k = A.z, a = A.w;
          float fade = clamp(1.6 - dist * k / 140.0, 0.0, 1.0);
          a *= fade;
          float th = k * dot(d, q) - uWaveB[i].x * uTime + uWaveB[i].y;
          float c = cos(th), s = sin(th);
          float Q = uSteep / (k * max(a, 1e-4) * float(uNWaves) + 1e-4);
          Q = min(Q, 1.0);
          disp.xz += Q * a * d * c;
          disp.y += a * s;
          n.xz -= d * k * a * c;
          n.y -= Q * k * a * s;
          crest += a * s;
        }
        p += disp;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorld = wp.xyz;
        vNormal = normalize(n);
        vCrest = crest;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: SKY_GLSL + /* glsl */`
      uniform float uTime, uFlow, uHs, uWind, uFogDensity;
      uniform vec3 uDeep, uShallow, uFogColor;
      uniform vec4 uHull;
      varying vec3 vWorld, vNormal;
      varying float vCrest;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      void main() {
        vec2 q = vWorld.xz + vec2(0.0, uFlow);
        // procedural wind ripple on the normal
        float r1 = noise(q * 0.35 + uTime * 0.6), r2 = noise(q * 0.9 - uTime * 0.9);
        float rip = (0.15 + 0.6 * clamp(uWind / 12.0, 0.0, 1.0));
        vec3 n = normalize(vNormal + vec3(r1 - 0.5, 0.0, r2 - 0.5) * rip * 0.35);
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = 0.02 + 0.6 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
        vec3 R = reflect(-V, n); R.y = abs(R.y);
        vec3 refl = mix(uZenith, skyColor(R), 0.55) * 0.75;
        float sss = pow(max(dot(V, -uSunDir), 0.0), 3.0) * clamp(vCrest / max(uHs, 0.2) + 0.4, 0.0, 1.0);
        vec3 body = mix(uDeep, uShallow, 0.25 + 0.35 * sss);
        vec3 col = mix(body, refl, fres);
        // sun specular highlight
        vec3 H = normalize(V + uSunDir);
        col += uSunColor * pow(max(dot(n, H), 0.0), 220.0) * 2.5 * (1.0 - uHaze);
        // crest foam (whitecaps): appears with wind > ~5 m/s
        float wc = smoothstep(4.5, 13.0, uWind);
        float foamN = noise(q * 0.7) * 0.6 + noise(q * 2.3 + uTime * 0.3) * 0.4;
        float crestF = smoothstep(0.35, 0.9, vCrest / max(uHs * 0.5, 0.15)) * wc * smoothstep(0.35, 0.7, foamN);
        // hull foam and wake (ship frame, stern toward −z)
        float L = uHull.x, B = uHull.y, zs = uHull.z, U = uHull.w;
        vec2 p = vWorld.xz;
        float zb = zs + L;                                 // bow
        float halfW = B * 0.5 * clamp((zb - p.y) / (0.25 * L), 0.0, 1.0);
        float side = abs(p.x) - halfW;
        float onHull = step(zs, p.y) * step(p.y, zb);
        float hullF = onHull * smoothstep(3.0 + 0.25 * U, 0.0, side) * clamp(U / 6.0, 0.0, 1.0);
        float behind = zs - p.y;
        float wakeW = B * 0.5 + behind * 0.18;
        float wakeF = step(0.0, behind) * smoothstep(wakeW, wakeW * 0.4, abs(p.x)) * exp(-behind / (40.0 + 25.0 * U)) * clamp(U / 5.0, 0.0, 1.0);
        float foam = clamp(crestF + (hullF + wakeF) * smoothstep(0.25, 0.75, noise(q * 1.6 + uTime)), 0.0, 1.0);
        col = mix(col, vec3(0.86, 0.9, 0.93) * (0.65 + 0.35 * uSunColor.r), foam * 0.85);
        // exponential fog (same as the scene)
        float d = length(vWorld - cameraPosition);
        float fog = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
        col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(polarGrid(6500, 150, 160), mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = false;

  return {
    mesh, uniforms,
    setWaves(w, hs, windMs) {
      // the MAX_WAVES most energetic components
      const sorted = [...w].sort((a, b) => b.amp - a.amp).slice(0, MAX_WAVES);
      const A = uniforms.uWaveA.value as THREE.Vector4[], Bv = uniforms.uWaveB.value as THREE.Vector2[];
      sorted.forEach((c, i) => {
        const a = c.dirDeg * Math.PI / 180;            // propagation, clockwise from bow (starboard = −x)
        A[i].set(-Math.sin(a), Math.cos(a), c.k, c.amp);
        Bv[i].set(c.omega, c.phase);
      });
      uniforms.uNWaves.value = sorted.length;
      uniforms.uHs.value = Math.max(hs, 0.05);
      uniforms.uWind.value = windMs;
      uniforms.uSteep.value = 0.25 + 0.45 * Math.min(1, windMs / 18);
    },
    setHull(L, B, zs, U) { (uniforms.uHull.value as THREE.Vector4).set(L, B, zs, U); },
  };
}

/** Rain: falling segments with wind drift around the camera. */
export interface Rain { lines: THREE.LineSegments; update(dt: number, center: THREE.Vector3, wind: THREE.Vector3, rate: number): void; }
export function makeRain(max = 5000): Rain {
  const pos = new Float32Array(max * 6);
  const seed = new Float32Array(max * 3);
  for (let i = 0; i < max; i++) { seed[3 * i] = Math.random(); seed[3 * i + 1] = Math.random(); seed[3 * i + 2] = Math.random(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({ color: '#c9d6e2', transparent: true, opacity: 0.32, depthWrite: false });
  const lines = new THREE.LineSegments(g, mat);
  lines.frustumCulled = false;
  let t = 0;
  return {
    lines,
    update(dt, c, wind, rate) {
      t += dt;
      const n = Math.min(max, Math.round(rate * 120));
      lines.visible = n > 0;
      if (!n) return;
      g.setDrawRange(0, n * 2);
      const S = 70, H = 45, vFall = 8.5;
      const v = new THREE.Vector3(wind.x, -vFall, wind.z);
      const dir = v.clone().normalize().multiplyScalar(0.9 + rate * 0.02);
      for (let i = 0; i < n; i++) {
        const y = H - ((seed[3 * i + 1] * H + t * vFall) % H);
        const fall = (H - y) / vFall;
        const x = c.x + (((seed[3 * i] * S + v.x * fall) % S) + S) % S - S / 2;
        const z = c.z + (((seed[3 * i + 2] * S + v.z * fall) % S) + S) % S - S / 2;
        const yy = c.y - H / 2 + y;
        const o = i * 6;
        pos[o] = x; pos[o + 1] = yy; pos[o + 2] = z;
        pos[o + 3] = x + dir.x; pos[o + 4] = yy + dir.y; pos[o + 5] = z + dir.z;
      }
      g.attributes.position.needsUpdate = true;
    },
  };
}
