// System parameters. Defaults: generic S-band naval AESA radar
// (see README). All in SI units.

export const C0 = 299_792_458;          // m/s
export const K_BOLTZ = 1.380649e-23;    // J/K
export const T0 = 290;                  // K
export const EARTH_R = 6_371_000;       // m

export interface FaceConfig {
  f0: number;        // design frequency (Hz)
  nSubX: number;     // horizontal subarrays
  nSubY: number;     // vertical subarrays
  subNx: number;     // elements per subarray, horizontal
  subNy: number;     // elements per subarray, vertical
  dLambda: number;   // element spacing in λ at f0
}

export type TaperKind = 'uniform' | 'taylor' | 'chebyshev';

export interface BeamConfig {
  azDeg: number;         // azimuth steering relative to the face normal
  elDeg: number;         // elevation steering
  freqOffsetHz: number;  // instantaneous frequency - f0 (squint)
  taper: TaperKind;      // receive taper
  sllDb: number;         // taper target SLL (dB, positive)
  nbar: number;          // Taylor n̄
  psBits: number;        // phase shifter bits (0 = continuous)
  ttd: boolean;          // per-subarray TTD
}

export interface RadarParams {
  pElemW: number;     // peak power per element (W)
  tauS: number;       // pulse width (s)
  nPulses: number;    // coherently integrated pulses
  nfDb: number;       // noise figure (dB)
  lossDb: number;     // system losses (dB)
  rcsM2: number;      // target RCS (m²)
  pfa: number;        // probability of false alarm
  pdReq: number;      // required Pd for detection range
  hRadarM: number;    // antenna height above sea level (m)
  hTargetM: number;   // target height (m)
  prfHz: number;      // pulse repetition frequency
  dopplerSllDb: number;   // Doppler window (Chebyshev, sidelobes in dB)
  beamSpacing: number;    // search grid spacing in units of θ₃
  cfarCells: number;      // CA-CFAR reference cells
  vRadialMs: number | null;   // target radial velocity (null = averaged over Doppler)
}

export const DEFAULT_FACE: FaceConfig = {
  f0: 3.3e9, nSubX: 10, nSubY: 10, subNx: 8, subNy: 8, dLambda: 0.5,
};

export const DEFAULT_BEAM: BeamConfig = {
  azDeg: 0, elDeg: 0, freqOffsetHz: 0,
  taper: 'taylor', sllDb: 35, nbar: 5,
  psBits: 6, ttd: true,
};

// Long-range search waveform (waveform.ts:WAVEFORMS). lossDb: RF losses only (radome,
// feed network, mismatch); processing losses are computed separately (waveform.ts:lossBreakdown).
export const DEFAULT_RADAR: RadarParams = {
  pElemW: 15, tauS: 100e-6, nPulses: 8, nfDb: 3, lossDb: 3,
  rcsM2: 1, pfa: 1e-6, pdReq: 0.9, hRadarM: 20, hTargetM: 5000,
  prfHz: 375, dopplerSllDb: 50, beamSpacing: 0.7, cfarCells: 20, vRadialMs: null,
};

export interface FaceGeometry {
  Nx: number; Ny: number; N: number;
  d: number;                 // physical spacing (m)
  x: Float64Array; y: Float64Array;     // position of each element (m), centered
  sub: Int32Array;           // subarray index of each element
  xc: Float64Array; yc: Float64Array;   // subarray center of each element
}

/** Face geometry. Element i = iy*Nx + ix (rows = vertical). */
export function faceGeometry(f: FaceConfig): FaceGeometry {
  const Nx = f.nSubX * f.subNx, Ny = f.nSubY * f.subNy, N = Nx * Ny;
  const d = f.dLambda * C0 / f.f0;
  const x = new Float64Array(N), y = new Float64Array(N);
  const xc = new Float64Array(N), yc = new Float64Array(N);
  const sub = new Int32Array(N);
  for (let iy = 0; iy < Ny; iy++) {
    for (let ix = 0; ix < Nx; ix++) {
      const i = iy * Nx + ix;
      x[i] = (ix - (Nx - 1) / 2) * d;
      y[i] = (iy - (Ny - 1) / 2) * d;
      const sx = Math.floor(ix / f.subNx), sy = Math.floor(iy / f.subNy);
      sub[i] = sy * f.nSubX + sx;
      xc[i] = ((sx + 0.5) * f.subNx - Nx / 2) * d;
      yc[i] = ((sy + 0.5) * f.subNy - Ny / 2) * d;
    }
  }
  return { Nx, Ny, N, d, x, y, sub, xc, yc };
}
