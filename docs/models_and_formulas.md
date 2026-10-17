# Implemented models and formulas

**English** · [Español](modelos_y_formulas.md)

*Technical reference for the web simulator (`web/src/engine/*.ts`) and its MATLAB validation, written on 2026-10-15 from the code as it is, not as it should be. If the code changes, this document must be reviewed. Where a constant in the code departs from theory or from the literature, it is marked **[model assumption]**; where it looks like an error, it is marked **[review]**.*

Location notation: `file:function (≈line)`. Paths are relative to `web/src/` unless stated otherwise. In the formulas, constants appear as in the code (decimal point); the text uses the same decimal-point convention.

---

## 0. Index

1. [Conventions](#1-conventions)
2. [Face geometry](#2-face-geometry)
3. [Face weights](#3-face-weights)
4. [Pattern and gain](#4-pattern-and-gain)
5. [Beam metrics](#5-beam-metrics)
6. [Radar equation and detection](#6-radar-equation-and-detection)
7. [Radar horizon](#7-radar-horizon)
8. [Sea state](#8-sea-state)
9. [Ship motion and pointing](#9-ship-motion-and-pointing)
10. [Refraction and evaporation duct](#10-refraction-and-evaporation-duct)
11. [Atmospheric attenuation](#11-atmospheric-attenuation)
12. [Sea and rain clutter](#12-sea-and-rain-clutter)
13. [Multipath over the sea](#13-multipath-over-the-sea)
14. [SINR chain, coverage and scenario metrics](#14-sinr-chain-coverage-and-scenario-metrics)
15. [Scanning of the 4 faces and waveform](#15-scanning-of-the-4-faces-and-waveform)
16. [3D ocean (Gerstner) and motion applied in the 3D view](#16-3d-ocean-gerstner-and-motion-applied-in-the-3d-view)
17. [Validation against MATLAB](#17-validation-against-matlab)
18. [Known assumptions and limitations](#18-known-assumptions-and-limitations)
19. [Inconsistencies and possible errors found](#19-inconsistencies-and-possible-errors-found)
20–21. (see body)
22. [Mutual coupling](#22-mutual-coupling-a5--websrcenginecouplingts)
23. [Parabolic equation: diffraction and evaporation duct](#23-parabolic-equation-diffraction-and-evaporation-duct--websrcenginepets-matlablibpropagacionpe_ssfm)
24. [K-distributed sea clutter](#24-k-distributed-sea-clutter--environmenttsshapek-klossdb-matlabfase3_linea_basemc_clutter_km)
25. [Clutter cancellation ceiling: window, oscillator and transmitter](#25-clutter-cancellation-ceiling-window-oscillator-and-transmitter--websrcenginemtdts-matlablibradarfuga_clutterm)
26. [Monopulse angle measurement and its errors](#26-monopulse-angle-measurement-and-its-errors--websrcenginemonopulsets-matlabfase1_sistemamc_monopulsom)
27. [Waveform, processing losses and time budget](#27-waveform-processing-losses-and-time-budget--websrcenginewaveformts-matlabfase3_linea_baseval_perdidasm)
28. [E2 · Digital channels versus simultaneous beams](#28-e2--digital-channels-vs-simultaneous-beams--matlabfase4_optimizacione2_canales_hacesm)
29. [E3 · Subarray TTD versus instantaneous bandwidth](#29-e3--subarray-ttd-vs-instantaneous-bandwidth--matlabfase4_optimizacione3_ttd_ancho_bandam)
30. [E1 · Subarray partitioning: regular, irregular or overlapped](#30-e1--subarray-partitioning-regular-irregular-or-overlapped--matlabfase4_optimizacione1_particion_subarraysm)
31. [E4 · Adaptive jammer nulling at subarray level](#31-e4--adaptive-jammer-nulling-at-the-subarray-level--matlabfase4_optimizacione4_anulacion_jammerm)
32. [E6 · Robustness to T/R module failures and calibration errors](#32-e6--robustness-to-tr-module-failures-and-calibration-errors--matlabfase4_optimizacione6_robustez_fallosm)

---

## 1. Conventions

### 1.1 Units

- The engine works in **SI** (m, s, Hz, W, K, rad). User angle inputs are in **degrees** (`azDeg`, `elDeg`, `windDirDeg`, `headingDeg`…) and are converted to radians with `deg = π/180` in each module.
- Powers and gains are in **dB** only in the interface and in some parameters (`nfDb`, `lossDb`, `sllDb`, `cancelDb`, `gtDbi`, `grDbi`). Conversion: `db(x) = 10·log10(x)`, `lin(x) = 10^(x/10)` (`engine/radar.ts:4-5`, `engine/environment.ts:9-10`).
- The propagation factor F is **in amplitude**; in dB it is given as 20·log10 F. It enters the radar equation as F⁴.
- The taper `sllDb` is **positive** (35 → sidelobes at −35 dB). The measured SLL (`metrics.ts`) is **negative** (relative to the peak).
- Ship speed in knots; converted to m/s with **0.5144** (`environment.ts:shipMotion ≈151`, `Radar3D.tsx ≈511`).

Constants (`engine/config.ts:4-7`, `engine/environment.ts:7`):

| Symbol | Value | Meaning |
|---|---|---|
| c₀ | 299 792 458 m/s | speed of light |
| k_B | 1.380649·10⁻²³ J/K | Boltzmann constant |
| T₀ | 290 K | noise reference temperature |
| a | 6 371 000 m | mean Earth radius |
| g | 9.80665 m/s² | gravity |

### 1.2 Face coordinates (sine space)

- The face is an **x–y** plane (x horizontal, y vertical) with the normal pointing outward. Element i = iy·Nx + ix (rows = vertical) (`config.ts:faceGeometry ≈67`).
- Direction cosines relative to the face (`array.ts:steerUV ≈10`):

  u = cos(el)·sin(az),  v = sin(el)

  where az is the azimuth relative to the face normal (positive toward +x) and el is the elevation relative to the horizontal plane of the face. Visible region: u² + v² ≤ 1; cos θ = √(1 − u² − v²) is the cosine of the angle relative to the normal.
- The array pattern uses the kernel e^{+jk(x·u + y·v)} and the weights carry the phase −k₀(x·u₀ + y·v₀), so that the maximum lies at (u₀, v₀).
- **The face is assumed vertical** throughout the engine: the beam elevation relative to the face is treated as elevation above the horizon. The 3D view, however, tilts the faces back by 12° (`views/Radar3D.tsx:TILT ≈36`, `panel.rotation.x = −TILT ≈220`) and `matlab/config/sistema_ref.m` declares `tiltDeg = 12`, which no calculation uses. See §19.

### 1.3 Ship faces and azimuth

- 4 faces: `FACE_AZ = [0, 270, 180, 90]` = bow, port, stern, starboard; the ship azimuth is measured **clockwise from the bow** (starboard = 90°) (`engine/scan.ts:FACE_AZ ≈35`).
- In the polar scan diagram, a local azimuth θ of face k is drawn at ship azimuth φ = FACE_AZ[k] − θ (`views/ScanViews.tsx ≈86`). That is, the positive local azimuth of a face rotates counterclockwise when viewed from above.
- Meteorological directions: `windDirDeg` and `swellDirDeg` are true directions **from** which the wind or the sea comes (0 = north). The angle relative to the bow is `relDeg(t, h) = ((t − h) mod 360 + 540) mod 360 − 180 ∈ [−180, 180)` (`environment.ts:relDeg ≈125`).
- The wave components store the **propagation direction relative to the bow**: `dirDeg = dirFrom_rel + 180 + spread`; 0° = the wave travels toward the bow (following sea), 180° = head sea (`environment.ts:discretize ≈116`).

### 1.4 Ship attitude

- Roll θr and pitch θp in rad, with **+ = port up** and **+ = bow up**; heave in m, + upward (`environment.ts:attitudeAt ≈185`).
- In the 3D view (Three.js: bow = +z, port = +x, starboard = −x, up = +y), `vessel.rotation.set(−pitch, 0, roll)` is applied with Euler order `YXZ` (`Radar3D.tsx ≈450, ≈514`). With these axes, −pitch about x raises the bow and +roll about z raises the port side: this is consistent with the engine convention.
- There is no yaw or drift.

### 1.5 Polarization

`Pol = 'H' | 'V'`, the same on transmit and receive (HH or VV). It affects the sea σ⁰, the rain attenuation (P.838) and the Fresnel coefficient.

---

## 2. Face geometry

**Location:** `engine/config.ts:faceGeometry (≈68-86)`.

Nx = nSubX·subNx,  Ny = nSubY·subNy,  N = Nx·Ny

d = dLambda·c₀/f₀

x_i = (ix − (Nx − 1)/2)·d,  y_i = (iy − (Ny − 1)/2)·d   (centered)

Subarray of the element: sx = ⌊ix/subNx⌋, sy = ⌊iy/subNy⌋, index `sub = sy·nSubX + sx`.

Subarray center: xc = ((sx + 0.5)·subNx − Nx/2)·d,  yc = ((sy + 0.5)·subNy − Ny/2)·d.

| Symbol | Meaning | Unit | Default |
|---|---|---|---|
| f₀ | design frequency | Hz | 3.3·10⁹ |
| nSubX, nSubY | subarrays per row/column | — | 10, 10 |
| subNx, subNy | elements per subarray | — | 8, 8 |
| dLambda | spacing in λ at f₀ | — | 0.5 |
| d | physical spacing | m | ≈ 0.0454 |

Assumptions: regular, fully populated rectangular grid (no irregular subarrays or partially populated face), identical point elements, **no mutual coupling**. With d = λ/2 at f₀ there are no grating lobes in the visible region at f₀ for any steering; at f > f₀ they appear when scanning far off broadside.

---

## 3. Face weights

**Location:** `engine/array.ts:computeWeights (≈30-59)`.

Complex weight of element i:

w_i = a_x[ix]·a_y[iy]·e^{jφ_i}  if the element works,  w_i = 0 if it has failed.

### 3.1 Separable taper

1D taper on each axis with the same type, SLL and n̄ (`engine/tapers.ts:taper1d ≈4`), normalized to a maximum of 1. Receive: `beam.taper`; **transmit: always uniform** (`taperOverride = 'uniform'`, saturated amplifiers; `App.tsx:useSimulation ≈29`).

#### n̄-term Taylor — `tapers.ts:taylor (≈11-34)` (Taylor, 1955)

R = 10^{SLL/20},  A = arccosh(R)/π,  σ² = n̄² / (A² + (n̄ − ½)²)

F_m = (−1)^{m+1} · Π_{n=1}^{n̄−1} [1 − m²/(σ²(A² + (n − ½)²))] / (2·Π_{n=1, n≠m}^{n̄−1} [1 − m²/n²]),  m = 1…n̄−1

w(ξ_i) = 1 + 2·Σ_{m=1}^{n̄−1} F_m·cos(2π·m·ξ_i),  ξ_i = (i − (N − 1)/2)/N

Normalized to max 1. This is the definition of MATLAB's `taylorwin` (it is validated against it, §17).

#### Exact Dolph-Chebyshev — `tapers.ts:chebyshev (≈37-60)`

M = N − 1,  R = 10^{SLL/20},  x₀ = cosh(arccosh(R)/M)

T_M(x) = cos(M·arccos x) if |x| ≤ 1;  sgn·cosh(M·arccosh|x|) if |x| > 1, with sign (−1)^M for x < −1.

Pattern: AF(ψ) = e^{jMψ/2}·T_M(x₀·cos(ψ/2)). Weights by inverse DFT sampling at ψ_k = 2πk/N:

w_n = (1/N)·Σ_{k=0}^{N−1} T_M(x₀ cos(ψ_k/2))·cos((M/2 − n)·ψ_k)

Normalized by max|w_n|. With N < 2 it returns 1.

### 3.2 Steering phase without TTD (`computeWeights ≈52`)

φ_i = Q_b(−k₀·(x_i·u₀ + y_i·v₀)),  k₀ = 2πf₀/c₀

The phase shifter carries the whole phase **computed at f₀**. At f = f₀ + Δf the phase does not scale, so the beam is deflected (squint): the maximum appears at u ≈ u₀·f₀/f.

### 3.3 Phase with subarray TTD (`computeWeights ≈47-50`)

τ_s = (xc·u₀ + yc·v₀)/c₀   (true delay of the subarray, continuous, not quantized)

φ_i = Q_b(−k₀·((x_i − xc)·u₀ + (y_i − yc)·v₀)) − 2π·f·τ_s,  f = f₀ + Δf

The delay scales with f (no squint between subarrays); only the intra-subarray residual, computed at f₀, causes squint. **[model assumption]** The TTD is ideal and continuous: the plan foresees TTD bits (E3), but they are not implemented.

### 3.4 Phase quantization — `array.ts:quantizePhase (≈15-20)`

φ_w = atan2(sin φ, cos φ) ∈ (−π, π]

Q_b(φ) = round(φ_w/Δ)·Δ,  Δ = 2π/2^b   (b = 0 → continuous)

Deterministic rounding to the nearest level, with no dither and no random phase or amplitude error. The quantization error is periodic and produces coherent quantization lobes. There are no quantized attenuators (the taper is continuous).

### 3.5 Failures

Failed element (`failed[i] = 1`) → w_i = 0 on transmit and on receive. It is also subtracted from the power: P_t = n_active·P_elem (§6). The failure is "off"; elements stuck in phase and complete subarray failures are not modeled (except by marking its 64 elements).

---

## 4. Pattern and gain

### 4.1 Gain normalization (common to all routines)

**Location:** header of `engine/pattern.ts (≈2-3)`; `uvMap ≈37`, `gainAt ≈70`, `separableCut ≈110`, `scan.ts:apertureTable ≈80`.

G(u, v) = (4π·d²/λ²) · |AF(u, v)|² / Σ_i |w_i|² · cos θ,  cos θ = √(1 − u² − v²)

AF(u, v) = Σ_i w_i·e^{jk(x_i·u + y_i·v)},  k = 2πf/c₀,  λ = c₀/f

| Symbol | Meaning | Unit |
|---|---|---|
| d | physical spacing | m |
| f | instantaneous frequency (f₀ + Δf) | Hz |
| Σ\|w\|² | weight power (active elements only) | — |

- With uniform weights and broadside steering: G = 4π·N·d²/λ² = 4πA/λ² (full aperture). With a taper, |AF|²/Σ|w|² < N and includes the taper efficiency. `App.tsx ≈44` also gives the ideal reference G_ideal = 4π·N·(dLambda·f/f₀)².
- **Element pattern**: cos θ **in power** (√cos θ in amplitude). In dB, 10·log10(√(1 − r²)) = 5·log10(1 − r²) is added. In MATLAB it is reproduced with `CosineAntennaElement` and `CosinePower [0.5 0.5]`.
- **[model assumption]** The formula is the gain of an aperture of area d² per element with a cos θ pattern. It is exact in the absence of grating lobes; with grating lobes it distributes the power approximately (as the code comment says). No ohmic or mismatch losses, no mutual coupling (the active impedance does not vary with scan) and no edge effects.
- Numerical floor: 10·log10(max(·, 10⁻³⁰)).

### 4.2 u-v map by 2D FFT — `pattern.ts:uvMap (≈23-62)`

1. P×P grid with P = max(256, next power of 2 of 4·max(Nx, Ny)) → oversampling ≥ 4× (for 80×80, P = 512, 6.4×).
2. The weights are placed in the corner (index iy·P + ix) and the 2D FFT is computed with an unnormalized e^{+j} kernel (`fft.ts:fft2d ≈36`, in-place radix-2 Cooley-Tukey, `fft1d ≈4`): AF(p_u, p_v) = Σ w·e^{+j2π(ix·p_u + iy·p_v)/P}. The origin shift relative to the centered face only adds a phase and does not affect |AF|².
3. Bin ↔ sine-space mapping: p = u·P·d/λ (`scale ≈38`), with periodic wrapping (`wrap`).
4. Each output pixel (res×res, 241 by default; the app uses 301) with u = −1 + 2a/(res − 1), v = 1 − 2b/(res − 1) (row 0 = v = +1) is obtained by **bilinear interpolation of the power** |AF|² on the FFT grid. Outside the visible region: NaN.
5. G in dBi with the normalization of §4.1. The map peak (`peakDbi`, `peakU`, `peakV`) is the maximum of the interpolated grid, not the exact maximum.

Limitation: bilinear interpolation in power slightly underestimates the maxima and smooths the nulls.

### 4.3 Exact gain in arbitrary directions — `pattern.ts:gainAt (≈67-95)`

Separable direct sum: for each (u, v), AF = Σ_iy e^{jk·y_iy·v}·Σ_ix w·e^{jk·x_ix·u}. Exact (up to rounding). It is used for G_t and G_r in the steering direction (`App.tsx ≈42-43`).

### 4.4 Separable principal cuts — `pattern.ts:separableCut (≈104-145)`

It first collapses the fixed dimension: c[a] = Σ_b w·e^{jk·pos_b·fixed}; then it evaluates the variable dimension with a trigonometric recurrence (uniform grid): e^{jk·pos_a·q} = e^{jk·pos_0·q}·(e^{jk·d·q})^a. Cost O(N + n·G).

- **Azimuth cut** `azimuthCut(el, step, span) (≈148)`: v = sin(el) fixed; u = cos(el)·sin(az), az ∈ [−span, span] (by default ±90°, step 0.1°; the app uses 0.05°).
- **Elevation cut** `elevationCut(u0, …) (≈159)`: **plane u = u₀ fixed** (that of the steering), v = sin(el), el ∈ [−span, span]. With az₀ ≠ 0 it is not a constant-azimuth cut but a constant-u cut.
- Points with u² + v² > 1: NaN.

### 4.5 Pattern shifted in sine space (scanning) — see §15.2.

---

## 5. Beam metrics

### 5.1 On a cut — `engine/metrics.ts:cutMetrics (≈12-43)`

- **Peak**: maximum sample i₀ refined with a 3-point parabola (if y₁ − 2y₂ + y₃ < 0):
  δ = ½·(y₁ − y₃)/(y₁ − 2y₂ + y₃),  θ_pk = θ_{i0} + δ·Δθ,  G_pk = y₂ − ¼·(y₁ − y₃)·δ
- **HPBW**: threshold G_pk − 3 dB; the first sample ≤ threshold is searched outward on each side from i₀ and each crossing is interpolated linearly; HPBW = θ_h − θ_l (in the angle of the cut: azimuth at fixed elevation or elevation at fixed u).
- **First nulls**: descend from the peak while the next sample is smaller (monotonic descent).
- **SLL** = max(G outside [left_null, right_null]) − G_pk (dB, negative).

Assumption: main lobe monotonic down to the nulls. With shoulders or merged lobes (very aggressive taper, heavily scanned beam, failures) the "null" can be a local minimum and the SLL can come out optimistic or pessimistic.

### 5.2 2D SLL on the u-v map — `metrics.ts:sll2D (≈49-68)`

Flood fill from the maximum pixel with 4-neighborhood, adding neighbors with G ≤ G of the current one (monotonic descent); SLL = max(G outside the region) − G_pk. Same monotonicity assumption; the resolution is set by the map (301×301 in the app).

---

## 6. Radar equation and detection

### 6.1 Radar equation (energy form) — `engine/radar.ts:snrConstant (≈18-23)`

SNR(R) = K / R⁴,  K = P_t·τ·G_t·G_r·λ²·σ·N_p / ((4π)³·k_B·T₀·F·L)

| Symbol | Meaning | Unit | Default |
|---|---|---|---|
| P_t | total peak power = n_active·P_elem | W | 6400·15 = 96 kW |
| τ | pulse width (energy E = P_t·τ, matched filter) | s | 100 µs |
| G_t | transmit gain at the steering direction (**uniform** weights, failures included) | linear | — |
| G_r | receive gain at the steering direction (weights with **taper**) | linear | — |
| λ | c₀/f at the instantaneous frequency | m | ≈ 0.091 |
| σ | RCS | m² | 1 |
| N_p | coherently integrated pulses | — | 16 |
| T₀ | 290 K | K | — |
| F | noise figure (`nfDb`) | linear | 3 dB |
| L | system losses (`lossDb`) | linear | 6 dB |

Assumptions: matched filter (pulse compression is implicit in using the energy), **ideal coherent integration** of N_p pulses (gain N_p, no integration loss), system temperature T₀·F (no separate antenna temperature or line losses), target on the beam axis in free space. Since P_t ∝ n_active and G_t ∝ n_active, the product P_t·G_t falls as n_active² with failures (correct for an array). It is validated against `radareqsnr` (§17).

`snrDbAt(K, R) = 10·log10(K/R⁴)` (≈25). Free-space detection range: R_det = (K/SNR_req)^{1/4} (`detectionRange ≈49`).

### 6.2 Swerling 1 — `radar.ts:pdSwerling1 (≈28)`, `snrReqSwerling1 (≈33)`

P_d = P_fa^{1/(1 + SNR)},  SNR_req = ln P_fa / ln P_d − 1

Linear SNR **already integrated** (coherently). Exact for a square-law detector with a single effective "pulse" and an RCS with exponential distribution that is constant during the burst (scan-to-scan fluctuation). It is the default detection model of the whole chain with environment (§14).

### 6.3 Swerling 0 via Albersheim — `radar.ts:pdSwerling0 (≈41-46)`

Albersheim's equation with N = 1:

SNR_dB = (6.2 + 4.54/√1.44)·log10(A + 0.12·A·B + 1.7·B),  A = ln(0.62/P_fa),  B = ln(P_d/(1 − P_d))

Inverted analytically:

Z = 10^{SNR_dB/(6.2 + 4.54/√1.44)},  B = (Z − A)/(0.12·A + 1.7),  P_d = 1/(1 + e^{−B})

Assumptions and limits: empirical approximation (±0.2 dB according to its author) for a non-fluctuating target and a linear detector, valid for 10⁻⁷ ≤ P_fa ≤ 10⁻³ and 0.1 ≤ P_d ≤ 0.9. The validation also uses it at P_d = 0.95 and 0.99, outside that range (tolerance 0.3 dB, §17). It is only used in the Radar tab as a comparison curve (`views/RadarTab.tsx ≈37`).

---

## 7. Radar horizon

**Location:** `engine/radar.ts:radarHorizon (≈54-57)`.

R_hor = √(2·k·a·h_r) + √(2·k·a·h_t),  k = 4/3 by default

| Symbol | Meaning | Unit |
|---|---|---|
| h_r, h_t | antenna and target height (negative → 0) | m |
| k·a | effective Earth radius | m |

Approximation for h ≪ a. The Radar tab uses k = 4/3 (`RadarTab.tsx ≈25`); the Environment tab and the scenarios use the k from the surface refractivity (§10.2): `radarHorizon(…, ae/6 371 000)` (`EnvironmentTab.tsx ≈72`) and the same formula in `scenarios.ts:evaluate ≈93`. The same visibility criterion (d < R_hor) is in `twoRayGeometry` (§13.1).

---

## 8. Sea state

### 8.1 Wind sea (fully developed Pierson-Moskowitz) — `environment.ts:windSea (≈59-62)`

H_s = 0.21·U²/g,  T_p = 2π·U/(0.877·g)   (if U < 0.3 m/s: H_s = 0, T_p = 2 s)

Fully developed sea (unlimited fetch and duration). **[model assumption]** The PM formula is for the wind at 19.5 m; the code uses the wind at ~10 m without correction (the comment acknowledges it), which underestimates H_s by a few percent.

### 8.2 Combined H_s — `totalHs (≈65-68)`

H_s = √(H_s,wind² + H_s,swell²)  (independent energies that add).

### 8.3 PM spectrum as a function of (H_s, T_p) — `pmSpectrum (≈88-91)`

S(ω) = (5/16)·H_s²·ω_p⁴/ω⁵·exp(−1.25·(ω_p/ω)⁴),  ω_p = 2π/T_p   [m²·s]

### 8.4 Spectrum discretization — `discretize (≈103-122)`, `waveField (≈127-133)`

- Band ω ∈ [0.7·ω_p, 2.6·ω_p] divided into n equal intervals Δω; ω_i at the center of each.
- Amplitude a_i = √(2·S(ω_i)·Δω); deep-water wavenumber k_i = ω_i²/g.
- Propagation direction relative to the bow: dirFrom_rel + 180° + δ_i, with δ_i uniform in ±35° (wind) or ±8° (swell).
- Phase φ_i uniform in [0, 2π).
- Park-Miller congruential generator (x ← 16807·x mod (2³¹ − 1)) with **fixed seeds** 7 (wind) and 11 (swell): the waves are deterministic.
- Final rescaling of the amplitudes so that H_s = 4·√m₀ exactly, with m₀ = Σ a_i²/2 (compensates for the part of the spectrum outside the band).
- `waveField(e, nWind, nSwell)`: 9 + 4 components by default; `shipMotion` uses 24 + 10 and the 3D ocean 10 + 5.

**[model assumption]** Uniform random directional spreading, not a cos^{2s} function; deep water; linear superposition.

### 8.5 Douglas scale — `douglas (≈71-76)`

State = number of thresholds exceeded by H_s, with thresholds [0.0001; 0.1; 0.5; 1.25; 2.5; 4; 6; 9; 14] m, capped at 9. Names in `DOUGLAS_NAME`. This integer is the "sea state" that enters the NRL model (§12.1).

### 8.6 Beaufort scale — `beaufort (≈80-85)`

Force = number of U thresholds exceeded (≥), thresholds [0.5; 1.5; 3.3; 5.5; 7.9; 10.7; 13.8; 17.1; 20.7; 24.4; 28.4; 32.6] m/s. Informational only. **[model assumption]** The WMO table starts force 1 at 0.3 m/s, not at 0.5.

---

## 9. Ship motion and pointing

### 9.1 Generic ship — `environment.ts:SHIP (≈45-51)`

Length L = 140 m, beam B = 18 m, natural roll period T_φ = 10.5 s, pitch period T_θ = 6.5 s, roll damping ζ = 0.06 without fins and 0.25 with fins. **[model assumption]** Frigate-class values, not those of a specific ship.

### 9.2 Encounter frequency — `shipMotion (≈158)`

ω_e = max(0.05, |ω − ω²·U·cos χ/g|)

| Symbol | Meaning | Unit |
|---|---|---|
| ω | absolute frequency of the component | rad/s |
| U | ship speed (knots·0.5144) | m/s |
| χ | wave propagation direction relative to the bow (0 = following sea) | rad |

Classical deep-water formula. With a following sea ω_e < ω; the absolute value folds the case in which the ship overtakes the wave. **[model assumption]** Floor of 0.05 rad/s to avoid ω_e = 0.

### 9.3 RAO (single-degree-of-freedom linear response) — `shipMotion (≈150-181)`

For each component (a, k, χ), λ_w = 2π/k:

- Wave slope: s = k·a (rad).
- Ship dimension filters: l_f = 1/(1 + (L/λ_w)²) (length), b_f = 1/(1 + (B/λ_w)²) (beam).
- Damped oscillator: RAO(r, ζ) = 1/√((1 − r²)² + (2ζr)²).

**Roll:**  a_R = min(0.6, s·|sin χ|·RAO(ω_e/ω_φ, ζ)·b_f·**0.8**)  [rad],  ω_φ = 2π/T_φ

**Pitch:**  a_P = s·|cos χ|·l_f·RAO(ω_e/ω_θ, **0.35**)  [rad],  ω_θ = 2π/T_θ

**Heave:**  a_H = a·√l_f  [m] (no resonance)

Each degree of freedom is a sum of sines at ω_e: θ(t) = Σ a·sin(ω_e·t + φ), with phases φ (roll), φ + 1.1 rad (pitch) and φ + 0.4 rad (heave) (`≈170-172`, `attitudeAt ≈186`).

Significant amplitudes (2σ): θ_r,sig = 2·√(Σ a_R²/2), likewise for pitch and heave. Roll peak period: 2π/ω_e of the component with the largest a_R.

**[model assumption]** All of the following is a simplification of this application, not a hydrodynamic RAO: the roll factor **0.8**, the cap of **0.6 rad** (≈34°) per component, the pitch damping **0.35**, the fixed phase offsets of 1.1 and 0.4 rad, the 1/(1 + (L/λ)²) filters and heave without dynamics. There is no coupling between degrees of freedom and no nonlinear damping, and the effect of the fins is reduced to raising ζ.

### 9.4 Elevation pointing error — `pointingErrorRmsDeg (≈196-201)`

δ ≈ θ_p·cos az + θ_r·sin az  (code comment; az = beam azimuth relative to the bow)

δ_rms = √((σ_p·cos az)² + (σ_r·sin az)²),  σ = (significant amplitude)/2

With electronic stabilization:

δ_rms,stab = **0.03**·δ_rms + **0.02°**

**[model assumption]** The stabilization residual (3 % of the motion + 0.02°, due to INS latency and phase recomputation) is an assumed value, not a derived one. Roll and pitch are assumed uncorrelated and only elevation error is considered (not azimuth). The `azRelDeg` argument receives `beam.azDeg`, which is the **local face azimuth**: it only coincides with the azimuth relative to the bow on the bow face (§19).

### 9.5 Pointing loss — `pointingLossDb (≈204-206)`

L_pt = 2·12·(δ_rms/θ₃)²  [dB],  θ₃ = elevation HPBW (≥ 0.05° in the function; ≥ 0.3° in the tabs)

Gaussian beam: one-way loss 12·(δ/θ₃)² dB (3 dB at δ = θ₃/2); ×2 for the round trip; mean of the loss in dB with δ of RMS value δ_rms. It is added as `extraLossDb` in the chain (§14).

---

## 10. Refraction and evaporation duct

### 10.1 Surface refractivity (ITU-R P.453) — `satVapor (≈211)`, `refractivity (≈216)`, `absHumidity (≈222)`

e_s = 6.1121·exp(17.502·t/(t + 240.97))  [hPa],  t in °C (over water)

e = (RH/100)·e_s

N = (77.6/T)·(P + 4810·e/T),  T = t + 273.15 K,  P in hPa

ρ = 216.7·e/T  [g/m³]

The e_s expression is the one from the older versions of P.453 (without the correction factor EF or the −t/d term of the current one). Valid in the lower troposphere and at radio frequencies (not optical).

### 10.2 CRPL gradient and k factor — `kFactor (≈231-235)`

ΔN = −7.32·exp(0.005577·N_s)  [N/km]  (CRPL exponential reference model, first km)

k = 1/(1 + a·ΔN·10⁻⁹),  a_e = k·a

(10⁻⁹ = 10⁻⁶ from N to n times 10⁻³ from km to m.) With the default environment (18 °C, 75 %, 1013 hPa) N_s ≈ 338 and k ≈ 1.44. This a_e is the one used by the multipath, the clutter and the horizons in the Environment tab (`envContext ≈566`, `effectiveEarth ≈636`). Linear gradient: no layers, no superrefraction and no elevated ducts.

### 10.3 Evaporation duct — `evapDuct (≈243-255)` (**informational only**)

Logarithmic profile under neutral stability (Paulus-Jeske simplification):

N(z) = N₀ + ΔN·ln(z/z₀)/ln(z_r/z₀),  z_r = 6 m,  z₀ = 1.5·10⁻⁴ m

N₀ = N(T_sea, P, RH = 98 %),  N_r = N(T_air, P, RH),  ΔN = N_r − N₀

Minimum of M(z) = N(z) + 0.157·z → duct height:

δ = −ΔN/(0.157·ln(z_r/z₀))·s_t,  bounded to [0, 40] m

Stability correction **[model assumption]**, "crude" according to the code: ΔT = T_air − T_sea; s_t = 1/(1 − 0.06·ΔT) if ΔT < 0, and s_t = 1 + 0.04·min(ΔT, 5) otherwise.

Maximum trapped wavelength (Kerr): λ_max = 0.0144·δ^{1.5} [m], f_min = c₀/λ_max (computed with the unbounded δ).

**The duct is displayed but does not enter the propagation**: neither the factor F nor the coverage uses it. See §18 and §19 regarding the constant 0.0144.

---

## 11. Atmospheric attenuation

### 11.1 Gases (ITU-R P.676, `gaspl` table) — `gasAttenDbKm`

Since 2026-10-15 the gas attenuation no longer uses the Annex 2 approximation of P.676: it is interpolated in a table generated with MATLAB's `gaspl` (`matlab/fase2_entorno/tabla_p676.m` → `web/src/engine/p676_table.json`).

γ_O2(f, T, P) = gaspl(1 km, f, T, P, ρ = 0)  ·  γ_H2O(f, T, ρ, P) = gaspl(1 km, f, T, P, ρ) − γ_O2   [dB/km]

Grid: f 2.5–4.5 GHz (step 0.25), T −10–40 °C (step 5), ρ 0–30 g/m³ (step 2.5), P 950–1050 hPa (4 values). Multilinear interpolation; outside the grid it saturates at the edge.

Reason for the change: the previous approximation omitted the water vapor pseudo-continuum and fell up to 22 % short of `gaspl` with warm, humid air (≈ 1 dB over 300 km round trip). Validation: relative error < 2 % against `gaspl` in 4 atmospheres.

### 11.2 Rain (ITU-R P.838-3) — `rainAttenDbKm (≈335-344)`, table `P838 (≈281-334)`

γ_R = k·R^α  [dB/km],  R in mm/h

The coefficients k_H, α_H, k_V, α_V come from a **table from 1 to 6 GHz in 0.1 GHz steps extracted from MATLAB's `rainpl`** (`matlab/fase2_entorno/val_entorno.m`, function `gammaR` with a 1 m path to remove the path reduction: k = γ(1 mm/h), α = log10(γ(10)/γ(1))). f is saturated to [1, 6] GHz. Interpolation in log f: k **log-linear** (ln k linear in ln f) and α **linear** in ln f. Polarization H (τ = 0°) or V (τ = 90°), with no intermediate tilt or elevation. Values at f₀ = 3.3 GHz: k_H = 3.12678·10⁻⁴, α_H = 1.33862; k_V = 5.51706·10⁻⁴, α_V = 1.10790. R ≤ 0 → 0.

### 11.3 Round-trip atmospheric loss — `atmLossDb (≈354-361)` and `atmLossCtx (≈577-582)`

L_atm = 2·[γ_o·L_eq(6000) + γ_w·L_eq(2000) + γ_R·L_rain]/1000  [dB]  (γ in dB/km, lengths in m)

L_eq(H) = R·(1 − e^{−x})/x,  x = R·max(sin el, 10⁻⁴)/H   (L_eq = R if x < 10⁻⁶)

L_rain = min(R, 25 000, 3000/max(sin el, 10⁻³))

| Symbol | Meaning | Unit |
|---|---|---|
| R | slant range | m |
| el | elevation of the direct ray, ≥ 0 in the chain (`evalPoint ≈592`) | rad |
| H | exponential scale height: 6 km (O₂), 2 km (H₂O) | m |
| 3000 m | 0 °C isotherm (`RAIN_TOP_M`) **[model assumption]** | m |
| 25 km | radius of the rain cell centered on the ship (`RAIN_RADIUS_M`) **[model assumption]** | m |

Assumptions: flat Earth for the height integral, exponential atmosphere and uniform rain inside a cylinder of 25 km radius and 3 km height around the ship.

### 11.4 Visibility (render only) — `visibilityKm (≈364-369)`

V = clamp(1/(1/V_haze + 1/V_rain), 0.4, 80) km,  V_haze = 60·((100 − min(RH, 99.5))/60)^{0.7},  V_rain = 25/R^{0.6}. Empirical; it does not enter any radar calculation.

---

## 12. Sea and rain clutter

### 12.1 Sea reflectivity, NRL model — `seaSigma0Db (≈377-385)` (Gregers-Hansen and Mital, 2012)

σ⁰_dB = c₁ + c₂·log10(sin ψ) + (27.5 + c₃·ψ)·log10(f)/(1 + 0.95·ψ) + c₄·(1 + SS)^{1/(2 + 0.085·ψ + 0.033·SS)} + c₅·ψ²

| Pol. | c₁ | c₂ | c₃ | c₄ | c₅ |
|---|---|---|---|---|---|
| H | −73.0 | 20.78 | 7.351 | 25.65 | 0.0054 |
| V | −50.79 | 25.93 | 0.7093 | 21.58 | 0.00211 |

ψ = grazing angle in degrees, saturated to [0.1°, 60°]; f in GHz; SS = sea state (Douglas, §8.5). Published validity: 0.1°–60°, 0.5–35 GHz, SS 0–6. **The code does not limit SS to 6** (§19). It is validated against `seareflectivity(…, 'Model', 'NRL')` (§17).

### 12.2 Common normalization — `clutterTerms (≈526-554)`

ΔR = c₀/(2·B)   (resolution after compression, B = `bandwidthHz`, 5 MHz by default)

unit = K/(σ·R⁴)   (SNR of a 1 m² target at R in free space)

Thus, CNR = unit·σ_c, with σ_c the clutter RCS of the cell. It inherits from K the coherent integration of N_p pulses and the peak gains G_t·G_r.

### 12.3 Sea clutter — `clutterTerms (≈533-545)`, `clutterToNoise (≈557-561)`, `evalPoint (≈595)`

Only if R < √(2·a_e·h_r) (antenna horizon for h_t = 0):

sin ψ = h_r/R − R/(2·a_e)   (grazing angle at the cell; if ψ ≤ 0 there is no clutter)

A = R·(θ_az/1.33)·ΔR/cos ψ   [m²]   (pulse-limited cell; effective two-way width θ₃/1.33, Barton)

ψ_c = λ/(4π·σ_h),  σ_h = max(H_s/4, 0.01) m

f_c = (ψ/ψ_c)⁴ if ψ < ψ_c, and 1 otherwise   (interference zone below the critical angle)

CNR_sea = unit·σ⁰·A·f_c·10^{−C/10}·f(−ψ)⁴

| Symbol | Meaning | Unit |
|---|---|---|
| θ_az | azimuth HPBW (≥ 0.3° in the tabs) | rad |
| C | MTD cancellation: computed (§25, default) or fixed `cancelDb` (35 dB) | dB |
| f(−ψ) | relative amplitude pattern toward the cell (§13.4), to the fourth power: round trip | — |

**[model assumption]**
- The factor 1.33 **divides** the beamwidth (effective width of a two-way Gaussian beam ≈ 0.75·θ₃). Until 2026-10-15 it multiplied and the clutter came out ≈ 2.5 dB high (§19, corrected).
- Cell always pulse-limited (the beam-limited regime, R·θ_el·tan ψ < ΔR, is not checked).
- The factor (ψ/ψ_c)⁴ is an interference-zone model separate from the multipath of §13; the clutter F is not applied.
- Doppler cancellation is a single number in dB per range: since 2026-10-15 it is computed with §25 (window, spectrum, oscillator, transmitter); with `cancelPhys = false` it is fixed again. No target velocity and no MTI loss on the target.
- Atmospheric losses and `extraLossDb` are not applied to the clutter.
- Single-ring clutter (the cell at the same range as the target), with no range ambiguities.

### 12.4 Rain clutter — `rainEta (≈388-393)`, `clutterTerms (≈547-552)`

Z = 200·R_r^{1.6}·10⁻¹⁸   [m⁶/m³]   (Marshall-Palmer, R_r in mm/h)

η = π⁵·|K|²·Z/λ⁴,  |K|² = 0.93   [m²/m³]

If there is rain and R < 25 km:

h_beam = min(R·θ_el, 3000 m)

V = (π/4)·(R·θ_az)·h_beam·ΔR/0.693·0.5 = (π/4)·R·θ_az·h_beam·ΔR/(2 ln 2)   [m³]

CNR_rain = unit·η·V·10^{−max(0, C − 15)/10}

The factor 1/(2 ln 2) is Probert-Jones's for a Gaussian beam.

**[model assumption]** **Uniform** rain in a cylinder of 25 km radius and 3 km height centered on the ship; no pattern (the whole volume is weighted with the peak gain); rain cancellation is 15 dB worse than sea cancellation (Doppler spread); no rain attenuation on the clutter return itself; Rayleigh scattering (valid in S band).

---

## 13. Multipath over the sea

### 13.1 Two-ray geometry over a spherical Earth (Blake) — `twoRayGeometry (≈438-455)`

Inputs: h₁ (radar), h₂ (target), d (range), a_e. They are sorted as lo = min(h₁, h₂), hi = max(h₁, h₂).

- Visibility: d < √(2a_e·lo) + √(2a_e·hi); otherwise, `visible = false` (F = 0).
- Elevation of the direct ray at the radar: θ_d = atan2(h₂ − h₁, d) − d/(2a_e).
- Reflection point (trigonometric solution of the cubic):

  p = (2/√3)·√(a_e·(lo + hi) + d²/4)

  Φ = arccos(2·a_e·(hi − lo)·d/p³)

  d₁ = d/2 − p·cos((Φ + π)/3)   (measured **from the lower antenna**), bounded to [10⁻³, d − 10⁻³];  d₂ = d − d₁

  (In the flat-Earth limit it gives d₁ = d·lo/(lo + hi), as it should.)
- Reduced heights: h₁' = lo − d₁²/(2a_e), h₂' = hi − d₂²/(2a_e); if either is ≤ 0, it returns visible with ψ = 0 (direct ray only).
- Grazing angle: ψ = atan(h₁'/d₁).
- **Path difference via the image** (exact over the tangent plane of reduced heights, not the 2h₁'h₂'/d approximation):

  Δ = √(d² + (h₁' + h₂')²) − √(d² + (h₂' − h₁')²)

- **Divergence**: D = 1/√(1 + 2·d₁·d₂/(a_e·d·tan ψ))   (tan ψ ≥ 10⁻⁹).

Assumptions: geometric optics, a single reflected ray, no intermediate or diffraction region near the horizon (beyond the horizon F = 0 abruptly; just before it, the interference continues). No ducts. `evalPoint` receives the **slant** range R and converts it to surface range with the law of cosines (`groundRange`) before the two-ray geometry; the coverage diagram uses the surface range on the axis and computes the slant range (`slantRange`) for the radar equation.

### 13.2 Smooth-sea Fresnel coefficient — `fresnel (≈410-417)`

ε = ε' − jε''

Γ_H = (sin ψ − √(ε − cos²ψ))/(sin ψ + √(ε − cos²ψ))

Γ_V = (ε·sin ψ − √(ε − cos²ψ))/(ε·sin ψ + √(ε − cos²ψ))

Principal complex root (real part ≥ 0).

### 13.3 Seawater permittivity (single Debye) — `seaPermittivity (≈398-402)`

ε' = ε_∞ + (ε_s − ε_∞)/(1 + (ωτ)²)

ε'' = (ε_s − ε_∞)·ωτ/(1 + (ωτ)²) + σ/(ω·ε₀)

ε_∞ = 4.9, ε_s = 72, τ = 9.2 ps, σ = 4.7 S/m, ε₀ = 8.854·10⁻¹² F/m. **[model assumption]** Fixed for 20 °C and 35 ‰: it does not depend on the environment's water temperature. At 3.3 GHz it gives ε ≈ 69.6 − j37.95. It is validated against `earthSurfacePermittivity` (ITU-R P.527) (§17).

### 13.4 Roughness (Ament) — `roughness (≈420-423)`

ρ_s = exp(−2·(2π·σ_h·sin ψ/λ)²),  σ_h = H_s/4

Without the Miller-Brown term (I₀); specular reflection reduced deterministically, with no diffuse component.

### 13.5 Propagation factor with pattern — `propagationFactor (≈461-474)`

F = | f(θ_d) + Γ·ρ_s·D·f(−ψ)·e^{−j2πΔ/λ} |

| Symbol | Meaning |
|---|---|
| f(θ) | receive amplitude pattern relative to the peak (§13.6) |
| θ_d | elevation of the direct ray |
| −ψ | departure direction of the reflected ray at the radar (below the horizon) |

Cases: not visible → F = 0; ψ ≤ 0 → F = f(θ_d). F is relative to free space **on the beam axis**: with f(θ_d) < 1 it also includes the off-axis loss.

**[model assumption]** The reflected ray leaves the radar with depression ψ (equal angles in the reduced-height geometry, without the curvature correction at the radar). **The same pattern (the receive one, with taper) is used for both directions**: F⁴ = F_rx², even though transmission is uniform.

### 13.6 Relative pattern from the elevation cut — `patternFromCut (≈477-499)`

Amplitude table A_i = 10^{(G_i − G_pk)/20} over the elevation cut (`elevationCut` at u = u₀); outside the table or with NaN: 10⁻⁴ (−80 dB). Linear interpolation in amplitude.

- **Fixed beam** (`envelope = false`): f(el) = A(el_pk + (el − el_beam)), with el_pk the angle of the cut maximum and el_beam the commanded elevation.
- **Envelope / search** (`envelope = true`): one beam per elevation steered at the target's direct ray: f(el) = A(el_pk + (el − θ_d)).

**[model assumption]** The pattern is shifted **rigidly in degrees** (not in sine space). This is a good approximation near the horizon; at large elevations the real beam would broaden. The envelope case assumes that at each range there is a beam steered exactly at the target (no crossover loss between bars).

---

## 14. SINR chain, coverage and scenario metrics

### 14.1 Context — `envContext (≈564-573)`

It precomputes N_s (§10.1), a_e = k·a (§10.2), total H_s, SS = Douglas(H_s), the sea ε, λ and the gas and rain γ at the link frequency. The `EnvLink` link carries K (§6.1, with uniform G_t and tapered G_r at the steering direction, n_active), f, h_r, azimuth and elevation HPBW (≥ 0.3°), `extraLossDb` = pointing loss (§9.5), τ, σ.

### 14.2 Evaluation point — `evalPoint (≈585-600)`

For a target at range R and height h_t:

geo = twoRayGeometry(h_r, h_t, R, a_e)

F = propagationFactor(geo, …) (with the pattern relative to the fixed beam or to the beam steered at θ_d)

SNR_fs = K/R⁴

SNR = SNR_fs·F⁴·10^{−(L_atm(R, max(θ_d, 0)) + L_extra)/10}

CNR = CNR_sea (with f(−ψ)⁴) + CNR_rain

**SINR = SNR/(1 + CNR)**

Assumptions: the clutter is treated as additive white Gaussian noise (no K statistics or CFAR); no jammer (S3 not implemented).

### 14.3 Curves and coverage diagram — `linkVsRange (≈603)`, `coverageGrid (≈610-623)`, `runCoverageJob (≈630)`

- Curves versus range at fixed height.
- Coverage diagram: R_i = R_max·(i + 0.5)/n_x, h_j = h_max·(1 − (j + 0.5)/n_y) (row 0 at the top); SINR in dB per cell. The clutter terms (which depend only on R) are computed once per column. It runs in a worker (`engine/coverage.worker.ts`).

### 14.4 Scenario metrics — `engine/scenarios.ts:evaluate (≈82-126)`

- SNR_req = Swerling 1 (P_d,req, P_fa) (§6.2); in dB `reqDb`.
- L_pt = pointingLossDb(pointingErrorRmsDeg(motion, az_beam, stab), HPBW_el).
- R_hor = √(2a_e·h_r) + √(2a_e·h_t) (a_e from CRPL).
- R_fs = (K/SNR_req)^{1/4} (free space).
- Grid: R_i = R_max·(i + 1)/n, with R_max = min(450 km, max(20 km, min(1.05·R_hor, 2.1·R_fs), 1.1·R_ref)). The 2.1 is justified in the code because the multipath enhancement (F⁴ up to +12 dB) allows detection up to ≈ 2·R_fs.
- P_d(R) = Swerling 1 on the SINR (0 if SINR < −150 dB).
- **First detection** R_first: the largest R_i with SINR ≥ reqDb (approaching target).
- **Continuous coverage** R_cont: R_{i−1} of the first sample i > 0 that does not detect (R_{n−1} if there is none and the first one detects).
- **Gaps**: number of detect → no-detect transitions at i ≤ index of the last detection (multipath nulls between R_cont and R_first).
- Reference point R_ref, evaluated exactly: SINR, SNR, CNR, F² in dB (20·log10 F), P_d (Swerling 1).
- **Limiting factor** (`≈118`), in this order: not visible → "horizon"; CNR_ref > 0 dB → "clutter"; 20·log10 F_ref < −6 dB → "multipath"; otherwise, "noise". **[model assumption]** Classification thresholds of our own.

Defined scenarios (`SCENARIOS ≈21-53`): S1 air surveillance (3 m², 5000 m, R_ref 200 km), S2 sea-skimmer (0.1 m², 7 m, 20 km), S5 drone (0.01 m², 100 m, 10 km). S3 (jammer) and S4 (multifunction) are declared but not implemented (`ready: false`). The sweeps (`runSweep ≈210`) repeat `evaluate` with n = 400 varying one parameter and, optionally, a series (polarization, stabilization, fins, envelope versus fixed beam).

---

## 15. Scanning of the 4 faces and waveform

### 15.1 Raster plan and clock — `engine/scan.ts:scanPlan (≈21-32)`, `beamAt (≈47-54)`, `ScanClock (≈57)`

- n_az = max(1, round(2·span/step) + 1) positions per bar, from −span to +span; elevation bars traversed in **boustrophedon** (alternating direction).
- Dwell T_d = n_pulses·PRI; frame T_f = T_d·n_positions.
- Face k is offset by k·T_f/4: t_f = (t + k·T_f/4) mod T_f; position = ⌊t_f/T_d⌋; pulse = ⌊(t_f − pos·T_d)/PRI⌋.
- Parameters set by the view (`views/ModelTab.tsx ≈39-43`): azimuth step = max(0.2°, factor·HPBW_az); bars at i·HPBW_el (i = 0…n−1); PRI = 2·R_ua/c₀; τ = min(τ_radar, 0.5·PRI); B = `bandwidthHz`.
- Clock with slow motion and pause: t = base + (now − ref)·speed.

### 15.2 Face pattern shifted in sine space — `apertureTable (≈73-97)`, `faceGain (≈100-109)`

With **unsteered** weights (taper + failures, az = el = 0, Δf = 0) the following is tabulated, collapsing the vertical dimension by columns (c[ix] = Σ_iy w):

P(Δu) = (4π·d²/λ²)·|Σ_ix c[ix]·e^{jk·x_ix·Δu}|²/Σ|w|²,  Δu ∈ [−2, 2], 2049 points

Face gain at local azimuth θ with the beam at (az₀, el₀):

u = cos el₀·sin θ,  u₀ = cos el₀·sin az₀,  v₀ = sin el₀

G(θ) = P(u − u₀) [interpolated] + 5·log10(1 − u² − v₀²)   (|θ| < 90° and u² + v₀² < 1; otherwise −∞)

**[model assumption]** **Ideal** phase shifters (continuous, without quantization or squint, at f₀) and pattern evaluated in the beam's elevation plane (v = v₀): the steered beam is the same pattern shifted in sine space. Faces 1–3 are drawn healthy unless they are all "live"; face 0 carries its failures (`ModelTab.tsx ≈47-53`).

### 15.3 Baseband LFM chirp — `lfm (≈112-116)`

t_c = t − τ/2 ∈ [−τ/2, τ/2],  φ(t) = π·(B/τ)·t_c²,  I = cos φ, Q = sin φ,  f_inst = (B/τ)·t_c

Up-chirp, unit amplitude, no window. It is only used for drawing (`views/ScanViews.tsx ≈171-177`); pulse compression is not modeled at signal level (it is implicit in the radar equation, §6.1, and in ΔR = c₀/2B, §12.2).

---

## 16. 3D ocean (Gerstner) and motion applied in the 3D view

### 16.1 Gerstner waves — `views/ocean.ts:makeOcean` (vertex shader ≈105-128) and `setWaves (≈195-208)`

Components: `waveField(e, 10, 5)` (§8.4), sorted by amplitude and truncated to `MAX_WAVES = 16`. For component i with propagation direction α_i relative to the bow:

d_i = (−sin α_i, cos α_i)   (ship frame: bow = +z, starboard = −x)

q = (x, z + U·t)   (the water flows aft at the ship's speed; `uFlow = U·t`, `Radar3D.tsx ≈517`)

θ_i = k_i·(d_i · q) − ω_i·t + φ_i

Q_i = min(1, S/(k_i·a_i·N_w + 10⁻⁴)),  S = 0.25 + 0.45·min(1, U_wind/18)

a_i ← a_i·clamp(1.6 − r·k_i/140, 0, 1)   (attenuates short waves far away, r = horizontal distance to the origin; antialiasing)

Displacement: (x, z) += Q_i·a_i·d_i·cos θ_i,  y += a_i·sin θ_i

Normal: n = (−Σ d_x·k·a·cos θ, 1 − Σ Q·k·a·sin θ, −Σ d_z·k·a·cos θ) normalized

Since Σ Q_i·k_i·a_i ≤ S < 1, no loops form. At the hull, the apparent frequency is ω − k·U·cos α = ω_e (§9.2), consistent with the ship motion. Polar mesh of 6.5 km radius with dense rings near the ship (r ∝ (i/n)^{2.3}). Foam, reflections and fog are purely graphical.

### 16.2 Motion applied to the ship — `Radar3D.tsx` (render loop ≈509-514)

position_y = freeboard + 0.85·heave(t),  rotation = (−θ_p(t), 0, θ_r(t)) with order YXZ

with θ_p, θ_r and heave from `attitudeAt(shipMotion(e), t)` (§9.3). The 0.85 on the heave is a visual adjustment. The ship motion uses a different discretization (24 + 10 components) from the ocean's (10 + 5) and phases sin(ω_e·t + φ) not tied to those of the water: the ship does not respond to the wave seen passing by (§18).

### 16.3 Beam stabilization in the 3D view — `Radar3D.tsx ≈524-545`

- Commanded direction in the face frame: (u₀, v₀, √(1 − u₀² − v₀²)) → quaternion q_b that takes +Y to that direction (`≈527-530`, and `≈667` outside scanning).
- Without stabilization: the beam is fixed to the face: q_local = q_b.
- With stabilization: with q_P the panel orientation in the world and q_M = q_ship⁻¹,

  q_local = q_P⁻¹·q_M·q_P·q_b

  which preserves in the world the orientation the beam would have with the ship upright. **Perfect stabilization** (without the 3 % + 0.02° residual of §9.4).
- The faces are tilted back by 12° (`TILT`), so in 3D the beam at el = 0 relative to the face points ≈ 12° above the horizon, whereas the engine treats it as horizontal (§19).

---

## 17. Validation against MATLAB

Workflow: `matlab/validacion_web.m` runs `matlab/fase1_sistema/val_antena.m`, `val_radar.m` and `matlab/fase2_entorno/val_entorno.m` (parameters from `matlab/config/sistema_ref.m`, identical to `DEFAULT_*`), which write `web/src/validation/ref_antena.json`, `ref_radar.json` and `ref_entorno.json`. `web/src/validation/compare.ts` performs the comparison (used by `web/tests/validation.test.ts` and the Validation tab). A check passes if |error| ≤ tolerance; checks marked *info* do not count as failures. Status according to `05_plan_ejecucion.md`: 68 checks, 65 within tolerance, 3 documented method differences (the *info* ones), 0 failures.

| Group | What is compared | MATLAB reference | Error metric | Tolerance | `compare.ts` |
|---|---|---|---|---|---|
| Antenna | Taylor weights 35 dB, n̄ = 5, 80 elements | `taylorwin(80, 5, −35)` | max \|Δw\| normalized to max 1 | 1·10⁻³ | ≈51 |
| Antenna | Chebyshev weights 30 dB, 80 elements | `chebwin(80, 30)` | max \|Δw\| | 1·10⁻³ | ≈52 |
| Antenna | 5 cases (uniform, Taylor 35 broadside, Taylor az 30°, Chebyshev 30, Taylor el 20°), 80×80 face, continuous phase shifters, no TTD, f₀ | `phased.URA` + `CosineAntennaElement [0,5 0,5]`, `pattern(…,'directivity')`, `directivity` | web peak gain − MATLAB directivity | 0.6 dB (note: integrated directivity vs. 4π·A_ef/λ²·cos θ) | ≈66 |
| Antenna | same | same | normalized main lobe, ±2.5° around the pointing direction | 0.1 dB | ≈68 |
| Antenna | same | same | normalized sidelobes > −50 dB, \|angle\| < 85° | 1.0 dB | ≈69 |
| Radar | SNR, 4 cases × 5 ranges (10–400 km), N_p = 1 | `radareqsnr` (T_s = T₀·F) | max \|ΔSNR\| | 0.01 dB | ≈87 |
| Detection | Required SNR Swerling 1, P_fa 10⁻⁴/10⁻⁶/10⁻⁸, P_d 0.5–0.99 | `detectability(…,'Swerling1')` | max \|Δ\| | 0.05 dB | ≈98 |
| Detection | Required SNR Swerling 0 (Albersheim inverted by bisection) | `detectability(…,'Swerling0')` | max \|Δ\| | 0.3 dB (note: Albersheim ±0.2 dB) | ≈99 |
| Radar | Horizon, h = 5–40 m, k = 4/3 | `horizonrange` | relative error | 0.1 % | ≈106 |
| Environment | Seawater ε' (20 °C, 35 ‰) | `earthSurfacePermittivity` (P.527) | relative error | 5 % | ≈124 |
| Environment | ε'' | same | relative error | 10 % | ≈125 |
| Propagation | F, 6 cases (radar 20 m; target 7/300/1000 m; H/V; σ_h 0.01/0.3/1 m), isotropic antenna, MATLAB ε, a_e = 4/3·a, slant range → ground range | **exact** two-ray over spherical earth, reflection point by Fermat (`dos_rayos_exacto` in `val_entorno.m`) | max linear \|ΔF\| | 0.05 (0.1 if h_t ≥ 1000 m) | ≈150 |
| Propagation | same | same | max \|ΔF\| in dB where F_ref > −10 dB | 0.5 dB (2 dB if h_t ≥ 1000 m: dense lobes, relative phase error ~10⁻³) | ≈151 |
| Propagation | Web vs. exact in the `radarpropfactor` cases (target 10 km; sea-skimmer 7 m) | exact two-ray | max linear \|ΔF\| | 0.05 (0.15 if h_t ≥ 1000 m) | ≈162 |
| Propagation (*info*) | `radarpropfactor` vs. exact | — | max linear \|ΔF\| | 0.1, informative (Blake uses Δ = 2h·sin θ_d and diffraction near the horizon) | ≈164 |
| Clutter | NRL σ⁰, SS 0–6, H and V, grazing 0.1–30° | `seareflectivity(…,'NRL')` | max \|Δ\| | 0.05 dB | ≈173 |
| Attenuation | Gases, 4 atmospheres | `gaspl` (P.676) | γ_o + γ_w web − MATLAB | 0.002 dB/km | ≈180 |
| Attenuation | Rain 1–50 mm/h, H and V | `rainpl` with a 1 m path (P.838) | max relative error | 1 % | ≈184 |
| Refraction | N_s in the standard atmosphere (15 °C, 1013.25 hPa, RH 58.5 %) | `refractiveidx(0)` | ΔN | 5 N-units | ≈189 |
| Refraction (*info*) | k factor, N_s = 280–380 | `effearthradius` (50 km path) | relative error | 10 %, informative (first-km gradient vs. radius averaged over the path) | ≈191 |

**What is not validated against MATLAB:** phase quantization, TTD and squint, failures, u-v map by FFT (only an internal test against `gainAt`), HPBW/SLL metrics (internal tests only), ship motion and pointing loss, duct, rain clutter, clutter cell area, cancellation, shifted scan pattern (internal test against `gainAt`), integrated atmospheric loss, and the full SINR chain.

---

## 18. Known assumptions and limitations

**Antenna**
1. ~~No mutual coupling~~ *Updated: optional mutual coupling (§22).* By default, an identical cos θ element pattern for all elements (no edge effects).
2. Gain from 4π·d²/λ²·|AF|²/Σ|w|²·cos θ: approximate when there are grating lobes; no ohmic or mismatch losses.
3. *Updated: random per-element and per-subarray errors, dither and TTD error implemented (A1–A3).* No quantized attenuators.
4. Transmission is always uniform; multipath and clutter use the receive pattern for both directions (two-way).
5. Vertical face in the engine (the 12° tilt only appears in the 3D view).
6. The scan pattern assumes ideal phase shifters (pattern shifted in sine space, no quantization or squint).

**Radar and detection**
7. Ideal coherent integration of N_p pulses, with no integration loss; T_sys = T₀·F.
8. Swerling 1 for the whole chain with environment; Swerling 0 via the approximate Albersheim equation (±0.2 dB, used outside its range for P_d ≥ 0.95).
9. Clutter treated as noise (SINR = S/(N + C)). *Updated (§24):* the K-distributed sea statistics enter as a CFAR loss. No jammer; pulse compression and CFAR are in the MATLAB signal chain, not in the web.

**Propagation**
10. *Updated (§23):* the parabolic equation covers the intermediate and diffraction regions below 1 km. Above that, the two-ray model is still used (F drops to 0 at the geometric horizon).
11. *Updated (§23):* the evaporation duct enters F and coverage with the Paulus-Jeske profile. No elevated ducts or measured M profiles.
12. Ament roughness with no diffuse component; sea permittivity fixed at 20 °C and 35 ‰.
13. Pattern shifted rigidly in degrees; the envelope mode assumes a beam exactly on the target at each range.
14. Simplified gas attenuation (without the water-vapor continuum above 325 GHz); exponential atmosphere over flat earth.

**Clutter**
15. **Uniform rain in a cylinder of 25 km radius and 3 km height** centered on the ship, with no pattern and no self-attenuation.
16. **Clutter cancellation as a single number in dB** (rain: 15 dB less), with no Doppler spectrum or effect on the target.
17. Sea cell always pulse-limited; empirical (ψ/ψ_c)⁴ interference zone; NRL limited to SS ≤ 6 (saturates above).

**Sea and ship**
18. Fully developed PM with U at 10 m; uniform random directional spreading; deterministic waves (fixed seeds).
19. Single-degree-of-freedom RAO with ad hoc constants (0.8 and a 0.6 rad cap in roll, ζ = 0.35 in pitch, phase lags of 1.1 and 0.4 rad, heave without dynamics); no yaw or couplings.
20. Assumed stabilization residual (3 % + 0.02°); pointing error in elevation only; roll and pitch uncorrelated.
21. In the 3D view the ship motion is not in phase with the drawn waves and beam stabilization is perfect.

---

## 19. Inconsistencies and possible errors found

Ordered by estimated impact. **Status as of 2026-10-15**: items 1, 2, 3, 8, 9 and 12 are fixed (indicated in each); the rest remain open or are accepted assumptions.

1. ✅ *Fixed (groundRange/slantRange).* **Slant range used as ground range in the two-ray model** — `engine/environment.ts:evalPoint ≈587`. `twoRayGeometry(L.hRadar, hT, R, c.ae)` is called with R = slant range (the same one that enters K/R⁴), but the geometry treats `d` as distance along the surface: horizon, d₁/d₂, θ_d = atan2(h₂ − h₁, d) and Δ. The validation does convert (`compare.ts:groundRange ≈113`), which is why it does not catch it. At low elevation the effect is negligible; for high, close targets it is not (h_t = 5 km at R = 10 km: d ≈ 8.7 km vs. 10 km, θ_d ≈ 26.6° vs. ≈ 30°).
2. ✅ *Fixed in the web and in MATLAB.* **Beam-shape loss factor of 1.33 multiplying the area** — `environment.ts:clutterTerms ≈538`. With the usual definition (effective width ≈ θ₃/1.33 for a two-way Gaussian beam) it should divide: as written, sea clutter comes out ≈ 2.5 dB too high.
3. ✅ *Fixed: gaspl table (error < 2 %).* **Water-vapor pseudo-continuum omitted** — `environment.ts:gasAttenDbKm ≈270-272`. The P.676 lines (Annex 2) above 325 GHz are missing, especially the 1780 GHz term, which dominates at 3.3 GHz: γ_w comes out ≈ 3 times too low (≈ 2·10⁻⁴ vs. ≈ 6·10⁻⁴ dB/km with the default environment). The impact is small (< 0.2 dB two-way at 200 km grazing) and stays within the 0.002 dB/km tolerance against `gaspl`, but the formula is incomplete.
4. **Duct Kerr constant** — `environment.ts:evapDuct ≈253`. λ_max = 0.0144·δ^{1.5} gives f_min ≈ 330 MHz for the default environment (δ ≈ 15.8 m). Other references (e.g., Turton et al.) give λ_max ≈ 3.77·10⁻³·δ^{1.5} (f_min ≈ 1.3 GHz for the same δ). The source should be verified. It is informative only (it does not enter the chain).
5. **Local face azimuth used as azimuth relative to the bow** — `scenarios.ts:evaluate ≈86` (`a.beamAzDeg = beam.azDeg`) and `views/EnvironmentTab.tsx ≈55`. `pointingErrorRmsDeg` expects azimuth relative to the bow; `beam.azDeg` is relative to the face normal. It is only correct for the bow face (FACE_AZ = 0).
6. **Sign of roll in the pointing error** — comment in `environment.ts:pointingErrorRmsDeg ≈192` and time series in `views/EnvironmentTab.tsx ≈113` (`err = pitch·cos az + roll·sin az`). With + = port up and az clockwise from the bow (starboard = 90°), a positive roll lowers the starboard beam: it should be θ_p·cos az − θ_r·sin az. The RMS value (`hypot`) does not change; only the sign of the plotted curve does.
7. **Inconsistent face tilt** — `views/Radar3D.tsx:TILT ≈36, ≈220` and `matlab/config/sistema_ref.m` (`tiltDeg = 12`) vs. the engine, which treats elevation relative to the face as elevation above the horizon (`patternFromCut`, `elevationCut`, scan). In 3D the beam at el = 0 points 12° upward; in the calculations, horizontally.
8. ✅ *Fixed in scenarios.ts and EnvironmentTab.tsx.* **Continuous coverage with a failed first sample** — `scenarios.ts:evaluate ≈106-111` (duplicated in `views/EnvironmentTab.tsx ≈91-96`). If sinr[0] < req, the condition `i > 0` causes R_cont = R[i−1] to be assigned at the next failed sample, even though coverage did not start at R[0]. Example: [no, yes, no, …] → R_cont = R[1]. It should be 0 if the first sample does not detect.
9. ✅ *Fixed: saturates at SS = 6 inside seaSigma0Db.* **Sea state outside the range of the NRL model** — `environment.ts:envContext ≈570` (`ss: douglas(hs)`, up to 9) → `seaSigma0Db`. NRL is fitted for SS 0–6; it is not clamped.
10. **Receive pattern used for both directions** — `evalPoint ≈593-595` and `clutterToNoise ≈560`: F⁴ and f(−ψ)⁴ use the receive cut (taper), while K uses G_t with uniform weights. It is an approximation, not an error, but it is not consistent: the transmit main lobe is narrower and its sidelobes higher.
11. **Horizon with different k depending on the tab** — `views/RadarTab.tsx ≈25` (k = 4/3) vs. Environment and scenarios (CRPL k ≈ 1.44 with the default environment). It is intentional, but the ranges do not match across tabs.
12. ✅ *Fixed: WMO thresholds.* **Beaufort** — `environment.ts:beaufort ≈81`: the force 1 threshold is 0.5 m/s (WMO: 0.3 m/s). Informative only.
13. **Old P.453** — `environment.ts:satVapor ≈212` uses the e_s formula from the old versions (a = 6.1121, b = 17.502, c = 240.97), not the one from P.453-14 (with EF and b = 18.678, c = 257.14, d = 234.5). The difference is small and the N_s validation passes (tolerance 5 N).
14. **Heave without RAO** and **roll cap per component** — `environment.ts:shipMotion ≈167-169`: `min(0,6, …)` is applied to each component and not to the total. In very rough seas the sum can exceed 0.6 rad, and heave has no resonance. These are consistent with an ad hoc model, but they are worth keeping in mind when interpreting extreme sweeps.

## 20. Signal-level chain (P2, MATLAB) — `matlab/lib/radar/*.m`, `matlab/fase3_linea_base/mc_pd_s2.m`

### 20.1 Waveform
LFM chirp with `phased.LinearFMWaveform`: τ = 20 µs, B = 5 MHz, f_s = 2B, PRF 2.5 kHz, 16 pulses per CPI. Sampled pulse normalized to unit energy (Σ|s|² = 1). Resolution c/(2B) = 30 m, unambiguous range c/(2·PRF) = 60 km, blind zone c·τ/2 = 3 km, compression gain B·τ = 100 (20 dB).

### 20.2 Per-pulse budget — `presupuesto_s2.m`
- Gains: G_t = 10·log10(4π·N·d²/λ²) (uniform); G_r = G_t + 10·log10(η_T), η_T = [(Σw)²/(N_x·Σw²)]² (separable Taylor).
- θ₃ in azimuth: numerical, at −3 dB of the array factor with the taper.
- SNR₁ = radareqsnr(λ, R, P_t, τ, G_t, G_r, σ, T_s = T₀·F, L) + 40·log10 F − L_atm, with F from the exact two-ray model (§13) and L_atm = 2·gaspl.
- CNR per cell: the same model as the web (§12): A = R·(θ₃/1.33)·ΔR/cos ψ, σ⁰ from `seareflectivity` (NRL), (ψ/ψ_c)⁴ falloff.

### 20.3 CPI simulation — `sim_cpi.m`
Data before the matched filter, complex white noise with power 1 per sample.
- **Target**: a·s(t − τ_b)·e^{j2π·f_d·p·T}; Swerling 1: a ~ CN(0, SNR₁) constant over the CPI; fractional delay applied in frequency.
- **Clutter**: independent scatterers in range, convolved with the pulse; power per scatterer CNR/Σ|χ_k|² (χ = pulse autocorrelation), so that after compression the CNR per sample is the budget value. Gaussian pulse-to-pulse correlation ρ(m) = exp(−2π²σ_f²m²T²) (Cholesky factor), σ_f = 2σ_v/λ, σ_v = 0.12·U **[model assumption]**, mean Doppler 0.

### 20.4 Processing — `proc_cpi.m`
Matched filter h = s*(−t) (unit energy: noise comes out with power 1 and the target with |a|²), Doppler FFT with window w (rectangular in A; Chebyshev 50 dB in B), power |·|².
- Ideal threshold: T = −ln(P_fa)·Σ|w|² (noise of known power, square-law).
- 2D CA-CFAR (`phased.CFARDetector2D`): training [10 1], guard [2 1] → 110 reference cells; P_fa = 10⁻⁶. The map is circularly shifted in Doppler to center the target cell (Doppler is periodic).
- Detection: any of the 6 cells neighboring the true position (2 in range × 3 in Doppler).

### 20.5 Statistics
- Theoretical Pd (Swerling 1, coherent integration): P_d = P_fa^{1/(1 + N·SNR₁)}.
- 95 % CI for proportions: Wilson (`binom_ci95.m`).
- Equivalent processing loss: the L that minimizes Σ[P_d,MC − P_fa^{1/(1+SNR·10^{−L/10})}]² over the points with 0.02 < P_d < 0.98 (`ajusta_perdida`).
- Coherent window loss: −10·log10[(Σw)²/(N·Σw²)] = 1.6 dB (Chebyshev 50 dB, N = 16).

### 20.6 Results (2026-10-15)
- A: theory within the 95 % CI at 15/15 points; measured P_fa 1.14·10⁻⁶ (95 % CI 0.92–1.41·10⁻⁶) over 72 million cells.
- B2: processing loss ≈ 2.5 dB without clutter (window + straddle + CFAR); 4.0 dB with CNR ≈ 8 dB and 5.9 dB with CNR ≈ 27 dB. The single 35 dB cancellation of the analytical model (§12) is optimistic with strong clutter.

## 21. Face hardware errors (A1–A3) — `web/src/engine/errors.ts`, `array.ts:computeWeights`

### 21.1 Composite model
For element n of subarray s:

w_n = a_n · g_n · G_s · exp(j·[Q_B(φ_n + r_n) − r_n + δφ_n + δφ_s − 2π·f·τe_s])

| Symbol | Meaning | Distribution |
|---|---|---|
| g_n, G_s | per-element and per-subarray gain | log-normal: 20·log10 g ~ N(0, σ_a,dB²) |
| δφ_n, δφ_s | per-element and per-subarray phase | N(0, σ_φ²) |
| τe_s | subarray TTD delay error | N(0, σ_τ²); at frequency f it is equivalent to a phase 2π·f·τe |
| r_n | known random phase (dither) before the B-bit quantizer | U[0, 2π) |

Same realization in transmit and receive (they are the same T/R modules). Deterministic seed (mulberry32 + Box-Muller); the normal variates are stored, so changing σ scales the error without changing its shape.

### 21.2 Predictions (exact in the moments)
Moments of the factor ε = g·e^{jδφ}: μ = E[ε] = e^{s²/2}·e^{−σ_φ²/2}, m₂ = E|ε|² = e^{2s²}, with s = σ_a,dB·ln10/20. With B-bit dither the quantization error is uniform and independent: μ is multiplied by sinc(2^{−B}) = sin(π/2^B)/(π/2^B).

- Gain in the commanded direction (receive):
  E|F(u₀)|² = μe²μs²(Σa)² + μe²(m₂s − μs²)·Σ_s(Σ_{n∈s} a_n)² + (m₂e − μe²)·m₂s·Σa²
  G/G₀ = E|F(u₀)|² / (m₂e·m₂s·(Σa)²)   → for small σ ≈ 1/(1 + σ_a² + σ_φ²) (Ruze/Hansen)
- Residual floor in (u, v), relative to the ideal peak:
  [(m₂e − μe²)·m₂s·Σa² + μe²(m₂s − μs²)·Σ_s|SA_s(u, v)|²] / (Σa)²
  The element term is flat (≈ σ²/(η·N)); the subarray term follows the subarray pattern: its mean in u matches that of the element term, but next to the beam it is larger by the ratio Σ_s(Σ_{n∈s}a_n)²/Σa², on the order of the number of elements per subarray (×64 → +18 dB with uniform weighting). `floorSubPeakDb` gives that value.
- Pointing (linearized, phase errors only): Δu = −Σ a_n x_n δφ_n / (k·Σ a_n x_n²)
  σ_u,elem = σ_φ·√(Σa²x²)/(k·Σa x²) · σ_u,sub = σ_φs·√(Σ_s(Σ_{n∈s} a_n x_n)²)/(k·Σa x²)

### 21.3 Validation (Monte Carlo, `web/tests/errors.test.ts`)
400 realizations, 80×80 face with Taylor 35 dB steered to 20°:

| Case | ΔG MC / theory | mean floor | σ_u MC / theory |
|---|---|---|---|
| element 0.5 dB / 5° | 0.047 / 0.047 dB | −0.08 dB | 1.95 / 1.93 ·10⁻⁵ |
| element 1 dB / 10° | 0.189 / 0.190 dB | −0.07 dB | 3.92 / 3.86 ·10⁻⁵ |
| subarray 0.5 dB / 5° | 0.046 / 0.047 dB | −0.21 dB | 1.52 / 1.52 ·10⁻⁴ |
| TTD 5 ps + element 5° | 0.079 / 0.079 dB | −0.05 dB | 1.83 / 1.82 ·10⁻⁴ |
| dither, 3 bits | 0.224 / 0.224 dB | −49.2 / −49.2 dB | — |

Observation: with the same phase σ, per-subarray errors mispoint the beam ≈ 8 times more than per-element errors.

## 22. Mutual coupling (A5) — `web/src/engine/coupling.ts`

### 22.1 Element
Horizontal dipole (x axis) of L = 0.45λ, strip of λ/100 (equivalent radius a = λ/400), at h = λ/4 above an infinite ground plane (image theory: image dipole at −h with opposite current). With L = λ/2 the ends of collinear neighbors would touch at d = λ/2. **[model assumption]**

Power pattern of the isolated element, normalized to broadside (u: cosine with respect to the dipole axis):
P_elem(u, v) = { [cos(kL/2·u) − cos(kL/2)] / [√(1 − u²)·(1 − cos(kL/2))] }² · [sin(kh·cos θ)/sin(kh)]²

### 22.2 Mutual impedances (induced EMF, sinusoidal current) — `mutualZ`
Field of dipole 1 along the axis (I₀ = 1): E_x = −j·η/(4π)·[e^{−jkR₁}/R₁ + e^{−jkR₂}/R₂ − 2cos(kL/2)·e^{−jkR₀}/R₀]
Z₂₁ = −(1/I(0)²)·∫ E_x1(x)·I₂(x) dx, with I₂ = sin(k(L/2 − |x|)) and I(0) = sin(kL/2); 32-point Gauss-Legendre per half. Self-impedance: ρ = a. With ground plane: Z_ef(Δ) = Z(Δ, 0) − Z(Δ, 2h).
Validation: λ/2 dipoles → Z₁₁ = 73.1 + j40.6 Ω (a = λ/200), side by side at λ/2 −12.5 − j29.9 Ω, at λ 4.0 + j17.7 Ω (Balanis, ch. 8).

### 22.3 Active Z, currents and Γ — `activeImpedance`, `applyCoupling`
Z_a,n = Σ_m Z(Δ_nm)·w_m / w_n (2D convolution by FFT; the kernel is translation-invariant).
Matching: T/R module with internal impedance Z_s = Z_ref*, with Z_ref = active Z of the center element under uniform broadside excitation. Optional per-element calibration (each one to its own active Z at broadside).
Current: I_n = w_n·(Z_s + Z_ref)/(Z_s + Z_a,n) (first-order active impedance approximation). Γ_n = (Z_a,n − Z_ref)/(Z_a,n + Z_s).
Realized gain: the pattern is computed with the currents I and the actual element (correction 10·log[P_elem/cos θ]) and normalized by the available power Σ|w|² (`powerRatioDb` = 10·log Σ|I|²/Σ|w|²).

### 22.4 Validation (`web/tests/coupling.test.ts`, Validation tab)
- Energy consistency (Hannan): R_a(θ)/R_a(0) = P_elem(θ)/cos θ in the E and H planes up to 60°: error < 0.5 %.
- Realized scan gain ≈ cos θ·(1 − |Γ|²): ±0.35 dB (the edge of the finite array departs from the center).
- Active |Γ| against the Antenna Toolbox MoM kernel (conformalArray of 21×21 dipoles plus their images, 882 ports, 31 min; `matlab/fase1_sistema/nucleo_acoplamiento.m`): difference ≤ 0.004 (E plane) and ≤ 0.007 (H plane) up to 70°.
- Pairwise Z, induced EMF vs. MoM (3×3 array): 16–35 % (informative; the MoM is not consistent with the isolated pattern and is not used in the engine).
- Result: active |Γ| of the center element ≈ 0.15 at 30° and 0.69 (E) / 0.57 (H) at 60° with broadside matching.

### 22.5 Limitations
- First order: the current distribution follows the excitation (the full coupled system is not solved).
- Failed elements: zero current; their termination is not modeled.
- Infinite ground plane; no diffraction at the face edge; no scan blindness from surface waves (there is no substrate).
- Coefficients computed at f₀ (not at the instantaneous frequency).


## 23. Parabolic equation: diffraction and evaporation duct — `web/src/engine/pe.ts`, `matlab/lib/propagacion/pe_ssf.m`

### 23.1 Model
2D tropospheric propagation (range x, height z) with an equivalent flat earth and modified refractive index m(z) = 1 + M(z)·10⁻⁶ (Levy, *Parabolic equation methods for electromagnetic wave propagation*, IEE 2000).
Split-step Fourier step with a wide-angle propagator (Feit-Fleck):
u(x+Δx, z) = e^{j·k·Δx·(m(z)−1)} · T⁻¹{ e^{j·Δx·(√(k²−p²) − k)} · T{u(x, ·)} }
T = sine transform: smooth conducting surface with H polarization (Γ = −1). Hann absorbing layer above z_max (domain 1.5·z_max).
Source: angular spectrum of the pattern f(θ)·e^{−jp·h} and its image. Normalization by stationary phase: F = |u|·√x / √(k/2π) (pattern times propagation factor, one-way).

### 23.2 Refractivity profiles (`perfil_m.m`, `pe.ts:modRefractivity`)
- Standard: M(z) = z/(k·Re)·10⁶ (0.118 M/m with k = 4/3; in the web k comes from the local refractivity).
- Paulus-Jeske evaporation duct: M(z) = s·z − 0.125·δ·ln((z + z₀)/z₀), z₀ = 1.5·10⁻⁴ m, δ = duct height (§10). **[assumption]** In MATLAB the slope is 0.125 (neutral stability); in the web, s = 1/(k·Re) so that without a duct it matches the local standard atmosphere.

### 23.3 Use in the chain (`environment.ts:evalPoint`)
Hybrid, like professional models (APM): the two-ray model with roughness (§13) in the interference region and the PE near and beyond the horizon. PE weight w = clamp((d/d_H − 0.6)/0.3, 0, 1), with d_H = √(2·a_e·h_r) + √(2·a_e·h_t); F = (1−w)·F_2r + w·F_PE·f(θ_d)/f_PE(θ_d). Web grid: 400 km × 1 km, Δx = 500 m, 4096 height points (θ_max ≈ 7°), cached by rounded (k, δ); about 0.5 s per grid. Above 1 km, two-ray only.

### 23.4 Validation (`matlab/fase2_entorno/val_pe.m`, `web/tests/pe.test.ts`)
| Check | Result |
|---|---|
| Exact two-ray, perfect conductor, h = 100 m, 4–30 km | 0.49 dB outside nulls (0.03 dB with a wide source) |
| ITU-R P.526, smooth spherical earth, h = 20 m, shadow | 0.67 dB with F > −85 dB |
| Convergence (Δx 100→50 m, n_z ×2) | 0.025 dB |
| Reciprocity inside a 15 m duct (20 m ↔ 7 m) | < 0.01 dB |
| Web vs. MATLAB (8 points, with and without duct) | < 0.3 dB |
Effect: with δ = 15 m, at 100 km and 7 m height, F goes from −112 dB (shadow) to −30 dB.

### 23.5 Real sea and inversion layer (2026-10-15)
- **Surface with Γ(ψ)** (`pe_ssf.m`, option `gamma`; `pe.ts`, field `gamma`): spectral image method. At each step the real field (z ≥ 0) is transformed over the full domain and the image in z < 0 is U_img(p) = Γ(asin|p|/k)·U_real(−p): each downgoing component comes back up with the Γ of its angle. Γ = Fresnel (H or V, Debye permittivity) × Ament roughness with σh = Hs/4. With Γ = −1 it reproduces the sine transform (difference 0.000 dB). It costs four FFTs per step instead of two; the web uses dx = 1000 m (vs. 250 m: < 0.5 dB, `tests/pe.test.ts`) and takes ~2 s per grid, cached.
- **Trilinear inversion layer** (`perfil_m('trilineal')`, `modRefractivity(…, layer)`): base zb, thickness t and drop ΔM; if M at the top ends up below M at the surface, the duct reaches the sea.
- **Validation against the exact two-ray model** (h = 100 m, 4–30 km, outside nulls): smooth sea H 0.48 dB; V 3.9 dB max / 0.85 dB RMS; rough (σh = 0.5 m) H 2.8 / 0.55 dB, V 3.1 / 0.78 dB. The large errors are in the fast fringes at 4–10 km (period ≈ 360 m, close to the comparison step), where the web uses the two-ray model; beyond 12 km: 0.5 / 0.7 dB smooth and 2.8 dB max (0.5 RMS) rough. The web matches MATLAB (< 0.3 dB) for V, rough and with layer.
- **Effect**: layer [150 m, 50 m, ΔM = 40] → F = −3 dB at 100 km and 50 m (−82 dB without the layer); roughness (σh = 0.5 m) lowers it to −4.6 dB. In the 15 m evaporation duct, roughness subtracts 0.7 dB at 100 km and 7 m.

### 23.6 Limitations
- The roughness is Ament's applied to each spectral component (no wave shadowing or Miller-Brown); the two-ray reference uses the same hypothesis, so the validation does not test it against another theory.
- Numerical floor ≈ −90 dB (residual reflections from the absorbing layer); irrelevant for the radar (−180 dB two-way).
- Horizontally homogeneous profile (no variation with range).
- The duct height comes from a simplified model (§10, inconsistency 4 on the Kerr constant).
- In the web, only up to 1 km height; the source is a 4° Gaussian beam and the actual pattern is applied in the direct direction.

## 24. K-distributed sea clutter — `environment.ts:shapeK, kLossDb`, `matlab/fase3_linea_base/mc_clutter_k.m`

### 24.1 Model (compound Gaussian)
Clutter intensity in a cell: I = τ·|g|², with complex Gaussian speckle g (decorrelating from pulse to pulse with the sea Doppler spectrum) and texture τ ~ Gamma(ν, 1/ν) with mean 1, constant over the CPI (decorrelates in seconds) and correlated in range in 60 m blocks (swell scale) **[assumption]**. The resolved intensity follows the K distribution:
P(I > t) = 2/Γ(ν)·(ν·t/μ)^{ν/2}·K_ν(2·√(ν·t/μ)),  E[I²]/E[I]² = 2·(1 + 1/ν).
Generator in `lib/radar/sim_cpi.m` (field `clut.nu`) and `textura_gamma.m` (Marsaglia-Tsang, without the Statistics Toolbox).

### 24.2 Shape ν (Ward, Tough and Watts, *Sea Clutter*, IET 2006)
log10 ν = (2/3)·log10 ψ° + (5/8)·log10 A_c − k_pol − cos(2·θ_sw)/3, k_pol = 1.39 (VV) or 2.09 (HH); ψ in [0.1°, 10°], ν limited to [0.1, 50]. In the web θ_sw = 45° **[assumption]** and A_c = R·(θ₃/1.33)·ΔR/cos ψ (the same cell as σ⁰).

### 24.3 Detection loss
Monte Carlo with 3·10⁷ cells per case (fast generator for the zero-Doppler cell, checked against the full chain): range CA-CFAR (20 cells, 2 guard cells), threshold adjusted for Pfa = 10⁻⁶ in K clutter, Swerling 1 target. Loss = extra SNR for Pd = 0.9 relative to Gaussian clutter (`clutter_k_tabla.json`):

| ν | 3 | 1 | 0.5 | 0.3 |
|---|---|---|---|---|
| CNR 10 dB | 2.7 dB | 5.0 dB | 7.6 dB | 9.1 dB |
| CNR 20 dB | 3.2 dB | 6.3 dB | 8.8 dB | 10.6 dB |
| CNR 30 dB | 2.9 dB | 6.4 dB | 9.1 dB | 11.0 dB |

With the Gaussian threshold (unadjusted) the actual Pfa rises to 1·10⁻⁴ (ν = 3) – 1·10⁻² (ν = 0.3).
In the web: linear interpolation in 1/ν and in the residual sea CNR; below 10 dB it is scaled by c/(1+c). Effective SINR = SINR − loss.

### 24.4 Validation
- Generator: CCDF of the intensity vs. the analytical K (t = 10: 1.5·10⁻² vs. 1.6·10⁻² with ν = 0.3; 4.1·10⁻⁴ vs. 3.5·10⁻⁴ with ν = 10). The second moment comes out somewhat below theory for small ν (7.6 vs. 8.7 with ν = 0.3) due to mixing of neighboring blocks during compression.
- Fast generator vs. full chain: CCDF of the cell/training ratio 0.12 / 0.048 / 0.021 vs. 0.12 / 0.05 / 0.022.
- Web: shape ν identical to `forma_k.m`, table reproduced at its nodes (`tests/clutter_k.test.ts`).

### 24.5 Finding: edge of the clutter ridge with 2D CA-CFAR
With the 2D CA-CFAR of P2 (training [10 1], guard [2 1]), in the zero-Doppler cell the actual Pfa is 3·10⁻² even with Gaussian clutter (CNR 20 dB): the training cells in the neighboring Doppler columns are noise only and lower the threshold. Off the ridge, 4·10⁻⁶. With ν = 0.5 the neighboring columns rise to 4·10⁻³. On the ridge, a range-only CFAR or a clutter map is advisable.

### 24.6 Limitations
- Texture in fixed blocks (no smooth spatial correlation or wave structure); ν from an empirical fit with large scatter in the literature.
- No discrete spikes from breaking waves in addition to the K texture (K + noise model, without a "discrete" spike component).
- The loss is computed for CA-CFAR and Swerling 1; other CFARs (OS, GO) or targets give other figures.

## 25. Clutter cancellation ceiling: window, oscillator and transmitter — `web/src/engine/mtd.ts`, `matlab/lib/radar/fuga_clutter.m`

Replaces the fixed cancellation (`cancelDb`, 35 dB) with the one that results from the processing and the hardware.

### 25.1 Leakage into the Doppler cells
MTD of Np pulses with window w (Chebyshev, Σw² = 1, so that noise comes out with power 1): Y_k = Σ_m w_m·x_m·e^{−j2πkm/Np}, k = −Np/2…Np/2−1. With clutter of power 1 per pulse, the leakage into cell k is E|Y_k|², the sum of three independent terms:

- **Clutter spread** (Gaussian spectrum σ_f centered at f_c): E|Y_k|² = Σ_d c(d)·ρ(d)·e^{j2π(f_c − f_k)dT}, c(d) = Σ_m w_m·w_{m+d}, ρ(d) = exp(−2π²σ_f²d²T²). Includes the window sidelobes.
- **Oscillator phase noise** (common to transmit and receive): clutter at range R sees Δφ(t) = φ(t − τ) − φ(t), τ = 2R/c, with density S_Δφ(f) = L(|f|)·4·sin²(πfτ). With clutter homogeneous in range, compression of a chirp of bandwidth B passes the offset f with weight (1 − |f|/B) (autocorrelation of the rectangular spectrum):
  leakage_k = ∫ L(|f|)·4sin²(πfτ)·(1 − |f|/B)·|W(f − f_k)|² df,  W(f) = Σ_m w_m·e^{−j2πfmT}.
  Numerical: exact with |W|² for |f| < 16·PRF (step PRF/(32·Np); the web folds the spectrum into one PRF period before correlating); outside, |W|² is replaced by its mean Σw² = 1 and integrated with the trapezoidal rule with step min(250 Hz, 1/(16τ)). Compared with the full integral up to B: 0.001 dB.
- **Transmitter instability** (white pulse-to-pulse phase, RMS σ): leakage = σ²·Σw² = σ².

### 25.2 Equivalent cancellation for the web
The web integrates Np pulses without a window (the window loss goes into `lossDb`), so C = −mean_k 10·log10(leakage_k/Np) over the useful cells |k| ≥ 2 (outside the clutter notch; mean in dB = target with uniform Doppler). Table at 48 ranges from 100 m to 60 km (beyond that there is no clutter: sea horizon < 30 km, 25 km rain shower), interpolated in log R and cached by parameters (~70 ms the first time).

| Input | Default value | Origin |
|---|---|---|
| Oscillator L(f) at 100 Hz/1/10/100 kHz/1 MHz | typical: −85/−110/−125/−135/−145 dBc/Hz; good and poor about 15 dB below and above | **[assumption]** orders of magnitude of S-band synthesizers; −30 dB/dec below 100 Hz, flat above 1 MHz |
| Transmitter instability | 0.2° RMS | **[assumption]** |
| Doppler window | Chebyshev 50 dB | the one from the P2 chain |
| PRF, Np | 2.5 kHz; Np from `nPulses` (even, ≥ 4) | P2 waveform |
| Sea | σ_v = 0.12·U, centered at zero Doppler | the one from P2; **[assumption]** the MTD centers the notch on the sea |
| Rain | σ_v² = (0.42·k_s·R·θ_el)² + 1 m²/s², k_s = 4 (m/s)/km; mean velocity U/√2 | shear and turbulence according to Nathanson; **[assumption]** the rain moves with the wind (root mean square over azimuth) |

### 25.3 Validation (`matlab/fase3_linea_base/mc_ruido_fase.m`, `web/tests/mtd.test.ts`)
- Phase generator (`fase_osc.m`, synthesis in frequency): periodogram vs. L(f) at 1 k/10 k/100 k/1 MHz: −0.7 / −0.09 / 0.01 / 0.0002 dB.
- **Full I/Q chain** (`sim_cpi.m` with `P.pn`: the pulse is transmitted with e^{jφ(t)} and demodulated with e^{−jφ(t)}; compression and MTD from `proc_cpi.m`), phase noise only (poor oscillator, stationary clutter, rectangular window): mean measured leakage vs. model at 1.5 / 3 / 15 / 45 km: −55.4/−55.0, −53.9/−53.7, −50.5/−50.5, −47.9/−47.8 dB; maximum error per cell 0.75 dB.
- Full chain with everything (Chebyshev 50 dB, sea at 9 m/s, oscillator, 0.5° instability), 15 km: maximum error per useful cell 0.52 dB (typical) and 0.58 dB (poor); measured cancellation 48.5 / 48.4 dB vs. 48.5 / 48.2 from the model.
- Web: leakage per cell and cancellation equal to `fuga_clutter.m` (error < 0.001 dB) in 24 cases with varied Np, PRF, B, window, oscillator, spectrum and instability.

### 25.4 Results
Sea cancellation (Chebyshev 50 dB, 0.2° instability) at 2 / 15 / 60 km, in dB:

| Wind | no phase noise | good | typical | poor |
|---|---|---|---|---|
| 5 m/s | 53/53/53 | 53/53/53 | 53/53/53 | 53/52/51 |
| 9 m/s | 52/52/52 | 52/52/52 | 52/52/52 | 51/51/50 |
| 15 m/s | 50/50/50 | 50/50/50 | 50/50/50 | 50/50/49 |

With a 70 dB window (9 m/s), 0.05° / 0.2° instability: 63/63/63 · 55/55/55 dB with a good or typical oscillator; with the poor one, 58/56/53 · 54/53/52 dB.

Interpretation: with the P2 window, the ceiling (≈ 50–53 dB) is set by the window sidelobes and the transmitter instability, not by the oscillator. Phase noise only dominates with a poor oscillator, a low-sidelobe window and long range: the white floor of L(f) folds over the whole Doppler band and the decorrelation grows with τ. Rain (typical, 9 m/s) is canceled by 50 / 49 / 46 dB at 5 / 20 / 60 km: its mean velocity falls close to the first useful cell. The previous fixed cancellation (35 dB) was conservative by about 15 dB.

### 25.5 Limitations
- Gaussian sea spectrum: the actual tails (spikes, breaking waves) are wider and would lower the ceiling; there is no tail model.
- No receiver or ADC dynamic range (B4), no I/Q imbalance (B3), and no platform motion within the CPI.
- A single figure per range (mean in dB over the useful cells); the web does not distinguish target velocity.
- Small phase noise (e^{jΔφ} ≈ 1 + jΔφ) and assumed oscillator tables, not from a specific piece of equipment.

## 26. Monopulse angle measurement and its errors — `web/src/engine/monopulse.ts`, `matlab/fase1_sistema/mc_monopulso.m`

Antenna engineering: how the face measures angle with sum and difference beams and what degrades it. Generic point source, with no target or tracking model.

### 26.1 Beams and ratio
- Σ: receive weights of the face (Taylor 35 dB, n̄ = 5, steering by phase/TTD).
- Δ_az = sign(x_c,s)·w_n and Δ_el = sign(y_c,s)·w_n, with x_c,s the center of the element's subarray: half-aperture difference formed in the digital subarray channels (100 channels; no second analog combiner is needed).
- AF(u, v) = Σ_n w_n·e^{jk(x_n·u + y_n·v)}; ratio r = Im{Δ/Σ}, purely imaginary for phase weights and odd Δ. The element pattern is common and cancels out.
- Estimator: inversion of the ideal (calibration) curve over its monotonic segment.

Ideal curve (80×80): θ₃ = 1.70° at broadside and 1.96° at 30°; normalized slope k·θ₃ = 1.34 in both cases; monotonic segment ±2.4° (±1.4·θ₃).

### 26.2 Thermal noise
First order with independent element noise (cov(n_Σ, n_Δ) = Σ s_n|w_n|² = 0 by symmetry):
σ_r² = (σ_Δ² + r²·σ_Σ²)/(2·|Σ|²),  σ_θ = σ_r/(dr/dθ). On boresight: σ_θ = √(σ_Δ²/σ_Σ²/(2·SNR))/k.
Monte Carlo with per-element noise (8000 trials): 0.283 / 0.090 / 0.029° measured vs. 0.283 / 0.090 / 0.028° predicted with SNR 10 / 20 / 30 dB on boresight, and within 1.3 % at θ₃/4. With SNR 10 dB a bias of −0.023° appears at θ₃/4 (nonlinearity of the ratio), which the first-order analysis does not give.

### 26.3 Amplitude and phase errors (A1, A2)
On boresight (real Σ), δr = Im{δΔ}/Σ: **only phase errors cause bias**; amplitude errors give a real Δ (in quadrature with the ratio):
σ_bias = √(σ_φe²·Σ a_n² + σ_φs²·Σ_s A_s²)/(Σ₀·k),  A_s = Σ_{n∈s} a_n.
With 0.5 dB / 5° per element and 0.3 dB / 3° per subarray: 0.0092° measured (400 realizations) vs. 0.0088° predicted; RMS error over ±θ₃/4 of 0.0088° (θ₃/194).

### 26.4 Mismatch between the Σ and Δ channels (A8)
Gain g and phase ψ of the Δ channel: r' = g·(cos ψ·Im{Δ/Σ} + sin ψ·Re{Δ/Σ}). With a point source and error-free weights, Re{Δ/Σ} = 0: only the slope changes, g·cos ψ (exact: 1.059 / 1.055 / 1.043 / 0.995 with 0.5 dB and ψ = 0/5/10/20°), and the error grows with the offset (δθ = (g·cos ψ − 1)·θ). With amplitude errors, the term sin ψ·Re{δΔ}/Σ adds bias on boresight:
σ_bias = g·√(cos²ψ·V_φ + sin²ψ·V_a)/(Σ₀·k), V_a with σ_a in nepers (ln10/20 per dB). Validated (0.0090° vs. 0.0085° with ψ = 20°).

### 26.5 Mutual coupling (A5)
Exact solution I = (Z + Z_s)⁻¹·(Z_s + Z_ref)·w (Z of the face with the induced-EMF kernel, built from the block-Toeplitz table, identical to `matriz_z_dipolos.m` with error 2·10⁻¹⁵), with Z_s = Z_ref* (T/R module matched to the center at broadside) and ideal calibration. Azimuth boresight bias vs. scan angle:

| Face | 10° | 30° | 50° | 60° |
|---|---|---|---|---|
| 32×32 | 0.0013° | 0.0057° | 0.0159° | 0.0272° |
| 48×48 | 0.0006° | 0.0026° | 0.0073° | 0.0118° |
| 64×64 | 0.0003° | 0.0015° | 0.0041° | 0.0066° |
| 80×80 | 0.0002° | 0.0009° | 0.0027° | 0.0042° |

It scales as ≈ 1/N² (edge effect) and is negligible for the full face (θ₃/800 at 60°). The slope changes by less than 0.3 %. **The web's active impedance approximation does not reproduce this bias** (it gives the opposite sign and up to 2.5 times the value), so the web monopulse does not apply coupling; the approximation remains valid for |Γ| and gain (§22), where the average matters and not the fine asymmetry between halves.

### 26.6 In the web
"Monopulse angle measurement" panel (Antenna tab): ideal curve and curve with errors, normalized slope, thermal noise for the chosen SNR, bias and RMS error of the current error realization (hardware errors panel), predicted bias σ, and Σ/Δ mismatch. Tests (`tests/monopulse.test.ts`): ratio equal to MATLAB (1·10⁻⁸) in azimuth and elevation at 0° and 30°, θ₃ and slope, thermal noise vs. the formula and Monte Carlo, bias σ vs. the formula and Monte Carlo, slope g·cos ψ.

### 26.7 Limitations
- Half-aperture Δ without its own weighting (no Bayliss at the subarray level): high Δ sidelobes; this does not affect the measurement in the main lobe.
- One axis at a time; no az/el cross-coupling with large errors.
- By scope decision, angle multipath and extended targets are not modeled.

## 27. Waveform, processing losses and time budget — `web/src/engine/waveform.ts`, `matlab/fase3_linea_base/val_perdidas.m`

Fixes inconsistencies that the radar equation alone does not see: with a PRF of 2.5 kHz the web reported detections at 300 km (unambiguous range 60 km); with 100 µs at 2.5 kHz the duty cycle was 25 %; the losses were a fixed 6 dB; the target velocity had no influence and there was no revisit time.

### 27.1 Waveforms
| Preset | τ | PRF | Np | Unambiguous range | Blind zone | Duty cycle | Blind speed |
|---|---|---|---|---|---|---|---|
| long-range search (default) | 100 µs | 375 Hz | 8 | 400 km | 15 km | 3.8 % | 17 m/s |
| low altitude (MTD, the P2 one) | 20 µs | 2.5 kHz | 16 | 60 km | 3 km | 5 % | 114 m/s |

Ru = c/(2·PRF), blind zone c·τ/2, duty cycle τ·PRF, blind speed λ·PRF/2, time per beam Np/PRF. `RadarParams` now includes `prfHz`, `dopplerSllDb` (previously in the environment), `beamSpacing`, `cfarCells` and `vRadialMs`.

### 27.2 Losses (replace the fixed 6 dB; `lossDb` remains for RF only: 3 dB)
| Loss | Model | Validation (val_perdidas.m) | Default |
|---|---|---|---|
| Doppler window | −10·log((Σw)²/(N·Σw²)), Chebyshev | exact | 1.49 dB (Np 8) / 1.58 dB (Np 16) |
| Doppler straddle | mean in dB over target frequency of the best cell, or the one at its velocity | ±0.01 dB | 0.54 dB |
| Range straddle | mean of −10·log sinc²(B·δ), δ uniform in ±Δ/2, fs = 2B | real LFM chain: 0.31 vs. 0.30 dB (fs/B = 1: 1.27 / 1.26) | 0.30 dB |
| Beam shape | two-way Gaussian beams, two axes: 2·4ln2·(10/ln10)·(1/θₜ² + 1/θᵣ²)·(s·θᵣ)²/12 | real 80×80 face (uniform Tx, Taylor Rx): < 0.1 dB between s = 0.5 and 1 | 2.74 dB (s = 0.7) |
| CA-CFAR | exact for Swerling 1 and square-law: SNR = (Pfa^{−1/N} − 1)/(Pd^{−1/N} − 1) − 1 | Monte Carlo 2·10⁵: Pd 0.9006 (N = 20) | 1.58 dB (N = 20) |

Default total 9.7 dB (3 RF + 6.7 processing). Transmit θₜ: 0.886·λ/(N·d)/cos(scan).

### 27.3 In the chain (`environment.ts`)
- **Eclipsing**: the receiver is blanked during [0, τ] of each PRI; fraction of the echo received f; the compressed peak drops as f² (LFM, validated: −6.02 dB with f = 0.5). It affects the target and the clutter arriving at the same time equally.
- **Ambiguous range**: detections beyond Ru do not count toward range or coverage (`EnvPoint.ambiguous`); the blind zone does not break continuity.
- **Folded clutter**: sum of the rings (R mod Ru) + n·Ru up to the sea horizon or the edge of the rain shower (assumption: fill pulses; the cancellation is the same).
- **Target velocity**: with `vRadialMs` known, the target's Doppler cell sets the straddle loss and the cancellation of that cell (§25; in the notch |k| < 2 the clutter is barely canceled); without it, averages.

### 27.4 Time budget
Beam positions = azimuth beams (step s·θ₃, θ₃ broadened by 1/cos az, integrated over the sector) × elevation bars; revisit time = positions × Np/PRF per face. With the long-range waveform, ±45° and 0–6°: 414 positions, 8.8 s; up to 20° it would be 25 s, which is why the long-range search only covers low elevations.

### 27.5 Limitations
- No mode interleaving (long-range search and low altitude in the same frame) and no resource scheduler.
- No PRF staggering to resolve range and velocity ambiguities.
- The beam-shape loss is a mean in dB (somewhat pessimistic compared with the mean over Pd).

## 28. E2 · Digital channels vs. simultaneous beams — `matlab/fase4_optimizacion/e2_canales_haces.m`

Question: how many digital channels does the subarrayed face need to form K simultaneous receive beams without losing gain or raising the SLL? It is the TFG bound (N_RF ≥ B·N_s) carried over to the radar.

### 28.1 Hardware model
- The Taylor taper (−35 dB, n̄ = 5) is in the T/R module, before the split, and is common to all beams.
- Each subarray of L elements has M ports. Each port is a 6-bit phase shifter network (phase only) and goes to its own digital channel: N_ch = N_sub·M, with M phase shifters per element.
- Weight of beam k: w_k = diag(t)·F_RF·f_BB,k.
  - Analog "by groups": the K beams are split into M contiguous groups and each port points to the center of its group.
  - Digital: regularized least squares against the ideal beam (fully digital).
- The beams are spread in azimuth. The problem is separable: the elevation factor is common, so the 80-element row suffices. For the 2D face, N_ch = (80/L)²·M.
- Criterion: in the worst beam, loss ≤ 1 dB relative to fully digital and SLL ≤ −30 dB, quantization lobes included.

### 28.2 Bound
A subarray of L elements sees the sector of the beams (width Δu in sine space) with resolution λ/(L·d). The degrees of freedom it needs are the numerical rank of the block of steering vectors for the sector:

r_eff = #{σ_i/σ_1 > 10^(−SLL_diseño/20)},  which grows with s = Δu·L·d/λ (Landau-Pollak).

**Bound: M ≥ min(K, r_eff), i.e., N_ch ≥ N_sub·min(K, r_eff).** With widely spread beams, r_eff ≥ K and the TFG form is recovered, N_ch ≥ N_sub·K: each beam needs its own analog dimension, just as each band and each stream did in the TFG. The difference is that in the radar, clustered beams share dimensions, and r_eff says how many.

### 28.3 Results
- **Bound vs. measured minimum M** (64 cases: L = 4, 8 and 16; K = 2–16; s = 0.05–3.2):
  - correct in 56 cases (88 %);
  - the minimum M never falls below the bound;
  - in 8 cases between 1 and 3 more ports are needed, when K is not a multiple of M and the groups are unequal (a limitation of the analog-by-groups scheme).
- **M = 1 is never enough** with a −35 dB design, not even for a cluster of 2 beams. The problem is not gain (< 0.5 dB) but the subarray quantization lobes. Example with L = 8 and 4 clustered beams: SLL of −13 dB with M = 1 vs. −32 dB with M = 2.
- **TFG decomposer (PE-AltMin)** vs. analog by groups (128 cases):
  - lowers the Frobenius error in 42 % of the cases;
  - improves the SLL by more than 1 dB in only 20 %, and worsens it by more than 1 dB in 29 %.
  - Conclusion: the Frobenius error, which was the right criterion in communications, does not control radar sidelobes.
- **Reference face** (100 subarrays of 8×8, 6400 elements), vs. 6400 channels with fully digital:

| Situation | M | Channels |
|---|---|---|
| 4 clustered beams (Δu = 3·HPBW) | 2 | 200 |
| 8 clustered beams (Δu = 7·HPBW) | 3 | 300 |
| 8 spread beams (Δu = 0.8) | 7 | 700 |

- **Trade-off** (figure c): large subarrays save digital channels, but require more ports and therefore more phase shifters per element; small subarrays do the opposite. It is the FC/SC trade-off of the TFG. Example with 8 clustered beams: 300 channels with 3 phase shifters per element (L = 8) vs. 125 channels with 5 (L = 16).

### 28.4 Limitations
- Analog by groups with contiguous groups; an optimal assignment would close the 8 cases above the bound.
- Beams in azimuth only and the 2D face treated as separable. For 2D clusters, the product r_x·r_y is sufficient; it has not been checked whether it is necessary.
- No overlapped or irregular subarrays, which are the classic solution to quantization lobes: that is experiment E1.
- Narrowband: no squint (E3) and no hardware errors (E6).

## 29. E3 · Subarray TTD vs. instantaneous bandwidth — `matlab/fase4_optimizacion/e3_ttd_ancho_banda.m`

Question: from what instantaneous bandwidth B is TTD needed, at what level (subarray of what size, or element) and with how many delay bits? Connection with the TFG: there, a shared TTD layer corrected the squint and 3 delay bits were enough.

### 29.1 Model
- Row of 80 elements with d = λ0/2 at f0 = 3.3 GHz and −35 dB Taylor (n̄ = 5). The problem is separable: the squint of an azimuth scan only affects the phase along x, and the elevation factor is common to all architectures.
- Architectures, on receive at frequency f = f0 + Δf:
  - **Phase shifters only:** phase −k0·x_i·u0, fixed and computed at f0. The beam shifts to u ≈ u0·f0/f (squint).
  - **Subarray TTD** with L = 4, 8 or 16 elements: one delay τ_s = xc_s·u0/c0 per subarray, plus phase shifters within the subarray computed at f0. When the delay is quantized, the phase shifters absorb the quantization error at f0 (common practice). Thus the beam is exact at f0, and the error only appears away from f0, proportional to (f − f0)·δτ.
  - **Element-level TTD** (reference): exact delay at each element. It has no squint; it is only limited by the grating lobes of the spacing at high frequencies.
- **Metrics at the two band edges f0 ± B/2**, taking the worse of the two. The edge is the instantaneous worst case: the squint grows with |f − f0| and a chirp sweeps the entire band. The mean loss over the band, which is what weighs on the SNR after pulse compression, is given as a separate figure; at the phase-shifters-only limit it is 0.30 dB, vs. 0.77 dB at the edge.
  - Loss: gain at u0 relative to element-level TTD at the same frequency, to discount the increase in electrical aperture with f.
  - Squint: shift of the maximum, in fractions of the HPBW.
  - Maximum SLL outside ±1.1 first nulls around u0, with quantization and grating lobes included.
- **Criteria:**
  - Complete, as in E2: loss ≤ 1 dB and SLL ≤ −30 dB at both edges.
  - Loss ≤ 1 dB only: used to separate what TTD corrects (squint and loss) from what it degrades (lobes).
- **Continuous phase shifters in the bandwidth analysis.** The 6-bit phase shifters already generate phase quantization lobes at f0 at specific angles (worst case −29.6 dB at 22°, 3 % of the angles above −30 dB). That effect does not depend on B, so it is checked separately (part D of the script) so as not to mix the two.
- **Delay bits:** LSB = τ_max/(2^b − 1), with τ_max the delay of the last subarray at 60° (about 10 ns). The worst angle between 5° and 60° is taken, and the minimum b is the one that reaches 90 % of the maximum B with continuous delays.
- B is swept up to 660 MHz (20 % of f0); the 660 values are the upper end of the grid. The search for the maximum B is by bisection and assumes that, once the criterion fails, it keeps failing as the band widens.

### 29.2 Results
**Conclusion:** without TTD, at 60° the face supports about 58 MHz of instantaneous bandwidth. Subarray TTD with 8×8 subarrays eliminates the squint loss up to 500 MHz, but the quantization lobes that appear away from f0 leave the limit at 47 MHz with SLL ≤ −30 dB, below the no-TTD case. With 4–5 delay bits the limit with continuous delays is reached.

Maximum B at 60° (MHz):

| Architecture | Complete criterion | Loss ≤ 1 dB only |
|---|---|---|
| Phase shifters only | 58 | 66 |
| Subarray TTD, L = 16 | 17 | 245 |
| Subarray TTD, L = 8 | 47 | 500 |
| Subarray TTD, L = 4 | 100 | ≥ 660 |
| Element-level TTD | 335 (grating lobe) | ≥ 660 |

- **Phase shifters only:** the limit is the squint and it is almost the same with both criteria: at 60°, the first B that fails (60 MHz) has 0.82 dB of loss and 0.27 HPBW of squint. The limit decreases with angle: 200 MHz at 15°, 104 MHz at 30° and 72 MHz at 45°.
- **Subarray TTD: it corrects the loss, but not the lobes.**
  - TTD fixes the array factor between subarrays, but each subarray pattern keeps drifting with frequency because its phase shifters are computed at f0. Away from f0, the subarray nulls no longer fall on the grating lobes of the inter-subarray spacing (L·d), and those quantization lobes rise.
  - Their level grows with L and with Δf. That is why the maximum B with the complete criterion goes roughly as 1/L: 17, 47 and 100 MHz for L = 16, 8 and 4 at 60°.
  - Example at 60° with a band edge at 200 MHz: L = 8 has 0.2 dB of loss but a lobe at −18 dB; phase shifters only lose 10.4 dB.
  - **Nuance relative to the TFG:** subarray TTD only extends the bandwidth if quantization lobes above the design level are accepted. With L = 8 and −30 dB it adds nothing over phase shifters only. This effect did not appear in the TFG because its TTD layer had one delay per column of the 8×8 array, which in the scan plane is equivalent to element-level TTD and does not generate quantization lobes.
- **Delay bits** (minimum b to reach 90 % of the continuous case, worst angle from 5° to 60°):

| L | Complete criterion | Loss only |
|---|---|---|
| 16 | 3 | 4 |
| 8 | 4 | 5 |
| 4 | 5 | 4, limited by the 660 MHz cap |

  - With 3 bits, which is what was enough in the TFG, the loss for L = 8 limits it to 295 MHz instead of 500.
  - The difference with the TFG is explained by the time-bandwidth product of the aperture, τ_max·B. In the TFG (8 columns at 57 GHz, 40°, 5 % bandwidth) it was 0.11. Here it ranges from 0.16 to 1.02 with the complete criterion and from 2.3 to 6.7 with loss only. The required bits grow with that product: the "3 bits" of the TFG are a particular case of an aperture that is electrically short in time, not a general rule.
- **Web waveform (5 MHz):** with phase shifters only at 60°, the loss is 0.006 dB and the squint 0.02 HPBW. The limit (58 MHz) is about 12 times higher, so the simulator's face does not need TTD with its current waveform. TTD only starts to be needed with bandwidths of tens of MHz and large scan angles; for example, for a range resolution below 3 m (B > 50 MHz) beyond 45°.
- **Element-level TTD:** at 60° it is limited by the grating lobe of the λ0/2 spacing, which enters visible space above f0·2/(1 + sin 60°). At that angle the theoretical limit is 474 MHz, and the −30 dB criterion brings it down to 335 MHz because the tail of the grating lobe enters the edge of visible space earlier.

### 29.3 Limitations
- No element pattern: in particular, the grating lobe near endfire is not attenuated, which makes the element-level TTD limit pessimistic.
- No overlapped or irregular subarrays, which are the classic solution to the quantization lobes of subarray TTD (E1).
- Delays quantized with a fixed LSB set by the range at 60°, with no manufacturing errors in the delay lines and no frequency dependence of the phase shifters. The phase shifters are assumed ideal (constant phase over f).
- Metrics at the band edges, which are the worst case. Full pulse compression with a dispersive beam (distortion of the range sidelobes) is not simulated.
- Continuous phase shifters in the bandwidth analysis. 6-bit quantization adds lobes of up to −29.6 dB at f0, independent of B. The common practice of randomizing the quantization (dithering) is not modeled.

## 30. E1 · Subarray partitioning: regular, irregular or overlapped — `matlab/fase4_optimizacion/e1_particion_subarrays.m`

Question: with the same number of digital channels, which partition minimizes the quantization lobes and how far does it allow the digital beam to be shifted from the analog pointing direction? It follows from E2 (§28): with one port per subarray, as soon as the digital beam moves away from the analog pointing direction, quantization lobes appear. The cause is that the phase centers of the subarrays form a periodic lattice with period L·d, which produces replicas of the beam (grating lobes of the subarray lattice) that are only attenuated by the subarray pattern.

### 30.1 Model
- Hardware as in E2: Taylor taper in the T/R module, 6-bit phase-only phase shifters steered to the analog center, digital by regularized least squares against the ideal beam.
- Row of 80 elements with 10 channels, equivalent to the reference face of 10×10 subarrays by separability.
- Partitions, all with 10 channels:
  - **Regular:** 10 subarrays of 8.
  - **Irregular:** 10 contiguous subarrays of 4 to 12 elements adding up to 80. It is the non-uniform SC mask of the TFG (`build_sc_mask`, layout `'nonuniform'`), which there only served so that N_t did not have to be a multiple of N_RF; here it is used deliberately to break the periodicity. Deterministic random search (3000 candidates, seed `E1-irregular`) that minimizes the worst SLL with the beam shifted by up to ±0.25 subarray beamwidths. Best partition: [12 6 9 8 5 7 5 6 10 12].
  - **Overlapped:** each channel combines o·L elements (o = 2 and 3) centered on the center of the regular subarray, with fixed amplitude weights in the combining network. Rectangular, Hann and truncated sinc windows were tested, and Hann won in both cases.
    - Hardware cost: the phase shifter goes before the split (there is still one per element and port), but each element feeds o combiners. That means a 1:o splitter per element and o times more combiner inputs (1.9 and 2.8 per element, fewer at the edges).
- Metrics:
  - maximum SLL (quantization lobes included), ISLR and loss relative to fully digital;
  - as a function of the digital beam shift δ, measured in beamwidths of the regular subarray, λ/(L·d) = 0.25 in u, which is equivalent to 8.3 HPBW of the face;
  - E2 criterion: loss ≤ 1 dB and SLL ≤ −30 dB.

### 30.2 Results
- **Maximum shift** that meets the criterion with one port per subarray:

| Partition | max δ (subarray widths) | max δ (face HPBW) | SLL at δ = 0.25 | ISLR at δ = 0.25 |
|---|---|---|---|---|
| Regular 10×8 | 0.025 | 0.2 | −9.7 dB | −6.6 dB |
| Irregular | 0.05 | 0.4 | −17.0 dB | −7.6 dB |
| Overlapped ×2 (Hann) | 0.05 | 0.4 | −13.8 dB | −13.8 dB |
| Overlapped ×3 (Hann) | **0.20** | **1.7** | **−29.6 dB** | −24.8 dB |

- **The irregular partition only redistributes the lobe energy.** It lowers the peak by 7 dB (from −9.7 to −17.0 dB), but the ISLR improves by barely 1 dB: the energy that was in a few quantization lobes is spread into a floor of lobes at −20/−30 dB (figure c). It is not suitable for a −35 dB radar.
- **The overlapped partition attacks the cause.** The subarray pattern, narrower and with low skirts, filters out the replicas of the subarray lattice. In addition, the loss stays below 0.1 dB up to δ ≈ 0.4.
- **Connection with E2** (4 clustered beams, Δu = 3·HPBW; in E2 the regular partition needed M = 2):

| Partition | Minimum M | Channels on the 2D face | SLL with M = 1 |
|---|---|---|---|
| Regular | 2 | 200 | −13.2 dB |
| Irregular | 2 | 200 | −20.3 dB |
| Overlapped ×2 | 2 | 200 | −18.5 dB |
| **Overlapped ×3** | **1** | **100** | −30.7 dB |

**Conclusion: with ×3 overlap and a Hann window, the face forms 4 clustered beams with 100 channels instead of 200 and with one phase shifter per element instead of two, at the cost of a 1:3 splitter per element in the combining network. The irregular partition lowers the lobe peak by 7 dB, but not the total energy (ISLR −6.6 → −7.6 dB).**

It is the FC/SC trade-off of the TFG in another form: overlap is a partial connection, halfway between SC (each element in a single channel) and FC (each element in all of them), and it buys analog degrees of freedom with combining network rather than with phase shifters or digital channels.

### 30.3 Limitations
- Azimuth only. Since the cluster beams are in azimuth, overlapping in x is enough (≈3 inputs per element). A 2D cluster would require overlapping in both axes, giving ≈9 inputs per element.
- Overlap weights taken from standard windows, not optimized. A flat-top pattern design (sinc-type weights with more overlap, or optimized weights) would allow larger shifts, but with more inputs per element.
- Irregular partition searched at random among contiguous 1D partitions. 2D partitions with irregular tiles (polyominoes) break the periodicity better and have not been tested.
- The margin of the ×3 overlapped partition is tight: −29.6 dB vs. the −30 dB criterion at δ = 0.25, with a small plateau around δ = 0.2–0.3.
- Combining network losses, its amplitude and phase errors, and wideband effects are not modeled.

## 31. E4 · Adaptive jammer nulling at the subarray level — `matlab/fase4_optimizacion/e4_anulacion_jammer.m`

Question: how many noise jammers can the face null with its digital degrees of freedom, how much SINR does it recover, and what does it cost the main beam? Connection with the TFG: the degrees of freedom are the digital channels (N_RF). The MVDR of the TFG worked at the element level, in a fully digital 64-element array. Here the adaptive processor only sees the 100 subarray outputs, which is what a hybrid face offers.

### 31.1 Model
- **Face:** 80×80 with 100 subarrays of 8×8 and d = λ/2. 2D Taylor taper (−35 dB, n̄ = 5) in the T/R module. The analog stage points at the target with 6-bit phase shifters.
  - Output of subarray s for a direction: b_s(u,v) = Σ_{e∈s} t_e·a0q_e*·a_e(u,v), which forms the matrix T (6400×100).
  - Thermal noise of power 1 per element: R_n = TᴴT, diagonal.
- **Target:** at (u0, v0) = (sin 20°, 0).
- **Jammers:** J uncorrelated noise jammers, with per-element JNR as a parameter (20, 30 and 40 dB). Random directions, deterministic by seed, in the visible region and outside the main lobe (|Δ| > 0.1 in sine space).
- **Beamformers** (100 degrees of freedom):
  - conventional, w = 1: the fixed Taylor beam;
  - MVDR, w = R⁻¹s, with s = Tᴴa(u0,v0);
  - MVDR with quiescent pattern, w = R⁻¹R_n·1. Without jammers it reverts to w = 1 and preserves the taper;
  - SMI with K target-free snapshots, without loading and with whitened diagonal loading R̂ + R_n (0 dB).
- **SINR(w)** ∝ |wᴴs|²/(wᴴRw). The loss is measured relative to the design Taylor beam without jammers.
- **Metrics:**
  - SINR loss;
  - pattern level at each jammer (null depth);
  - gain loss on the target;
  - mispointing of the maximum (1024² 2D FFT with parabolic interpolation);
  - SLL of the adapted pattern, outside a circle of radius 0.05 around the target.

### 31.2 Results
- **Pure MVDR vs. quiescent MVDR.** Without jammers, pure MVDR gains 1.7 dB of SINR because it undoes the taper between subarrays, but the SLL rises from −31.4 dB (Taylor with 6 bits) to −18.3 dB. That is why the rest of the analysis uses MVDR with a quiescent pattern: the same nulling and the same pattern as the design when there are no jammers.
- **Number of jammers.** What counts is not J but the **effective rank**: the number of jammers that remain above the noise at the subarray outputs. The analog stage, pointed at the target, already attenuates distant jammers.
  - Median SINR loss ≤ 1 dB up to J = 200 (the maximum tested) with JNR 20 dB, up to J = 130 with 30 dB and up to J = 110 with 40 dB. That is, more jammers than degrees of freedom.
  - The loss grows when the effective rank saturates the 100 degrees of freedom. With J = 200 the effective rank is 98, 99 and 100, and the loss is 0.65, 3.1 and 10.2 dB for 20, 30 and 40 dB.
- **Recovered SINR.** With 10 jammers, the fixed beam loses between 0 and 19 dB depending on the JNR (0–40 dB); the quiescent MVDR, less than 0.01 dB. With JNR 30 dB, the fixed beam loses between 13 dB (J = 10) and 27 dB (J = 200).
- **Cost to the main beam** (quiescent MVDR, JNR 30 dB, medians):

| J | Gain loss | Mispointing | SLL |
|---|---|---|---|
| ≤ 40 | < 0.02 dB | ≈ 0 | −31.3 dB (= design) |
| 99 | 0.11 dB | 0.04 HPBW | −24.9 dB |
| 160 | 0.28 dB | 0.07 HPBW | −19.6 dB |

- **Null depth:** from −100 to −160 dB with the exact covariance. This is not realistic: in practice it is limited by calibration errors (E6) and diagonal loading.
- **One jammer sweeping in azimuth:** the loss only exceeds 1 dB with the jammer within 0.018 in sine space of the target (0.6 HPBW). Outside that, the maximum is 0.36 dB.
  - A jammer in the direction of a quantization lobe of the target (Δu = λ/(L·d) = 0.25) is **not** a problem. There the subarray has a null, and the taper within each subarray makes the jammer response almost orthogonal to that of the target (cos² = −24 dB).
- **The key case: two jammers separated by k·λ/(L·d).** Those two directions have the same inter-subarray phase progression (aliasing at the subarray level). The adaptive processor can only distinguish them through the subarray pattern, and to null both it raises lobes near the main beam.
  - SLL of the cut: −18, −20 and −14 dB for k = 1, 2 and 3, vs. −30.6 dB away from those separations (−31.4 dB quiescent).
  - The SINR barely suffers (≤ 0.5 dB).
  - It is the same mechanism as the quantization lobes in E2. Overlapped or irregular subarrays (E1) break that periodicity.
- **Snapshots (SMI, 10 jammers):**
  - Without loading, E[ρ] matches Reed-Mallett-Brennan, (K+2−N)/(K+1), within the 95 % CI for all 9 values of K. With K = 2N = 200: −2.93 dB measured vs. −2.95 dB from theory.
  - With 0 dB diagonal loading, K = 2J = 20 snapshots are enough for −3.0 dB (Carlson's rule). The asymptote as K → ∞ is 0.00 dB: the loading introduces no bias.

**Conclusion:** with 100 subarray degrees of freedom, the face nulls noise jammers with less than 1 dB of SINR loss for up to 110 jammers at JNR 40 dB (130 at 30 dB). That is more than its degrees of freedom, because the analog stage already attenuates distant jammers and the real limit is the effective rank remaining at the subarray outputs. Compared with the fixed beam it recovers up to 19 dB with 10 jammers. With estimation, 3 dB is lost with K = 2N = 200 snapshots, or with only K = 2J = 20 if diagonal loading is used. The weak point is aliasing between subarrays: two jammers separated by k·λ/(L·d) raise the SLL to −14 dB.

### 31.3 Limitations
- Exact covariance in the J sweep: ideal nulls, with no calibration or channel errors (E6), no wideband effects (null dispersion with bandwidth), and no main-lobe jammers.
- Isotropic element and jammers over the whole visible disk. A real element pattern would further attenuate grazing jammers.
- Generic per-element JNR. Powers, ranges and specific scenarios are not modeled.
- The SLL for the two-jammer case is measured on the azimuth cut, because the jammers lie on it.

## 32. E6 · Robustness to T/R module failures and calibration errors — `matlab/fase4_optimizacion/e6_robustez_fallos.m`

Question: how much do the SLL, gain and pointing of the reference face degrade with failed T/R modules and amplitude and phase errors, and how much does a recalibration recover? Robustness was the future work item of the TFG ("tolerances and failures"); the first robustness analysis, done on the mmWave array of the TFG, is carried over here to the S-band face.

### 32.1 Model
- 80×80 face, 8×8 subarrays, Taylor −35 dB (n̄ = 5), 6-bit phase shifters on top of a subarray TTD, beam at u₀ = 0.344 (20.1°). The pattern is computed with a 2D FFT (P = 512) and the peak falls on a bin.
- **Quantization with dither (A3, §21).** Without dither, the phase shifter phase residual is the same in all 100 subarrays and the ideal face already has an SLL of −31.3 dB at 20°. With dither, −35.1 dB. Dither is used as the reference.
- A failure is one more factor in the moment model of §21: ε = b·g·e^{jδφ}, with b ~ Bernoulli(1 − p):
  μ = (1 − p)·e^{s²/2}·e^{−σ_φ²/2},  m₂ = (1 − p)·e^{2s²},  E|F(u)|² = μ²|F₀(u)|² + (m₂ − μ²)·Σa².
  With failures alone, the sidelobe floor is ≈ p/((1 − p)·η·N), with η = 0.653 for the 2D Taylor.
- Metrics:
  - Maximum SLL outside the main lobe (radius 1.15 times the first null).
  - Mean level of the far sidelobes (|u − u₀| > 0.25 in visible u-v space).
  - Receive gain loss, G = |F(u₀)|²/Σ|w|², the same definition as the web.
  - Azimuth pointing error, with Newton's method on the v = 0 cut.
- Monte Carlo with 100 realizations per point and 95 % CI. Seeds `E6-A`, `E6-B`, `E6-C` and `E6-dither`.

### 32.2 Failures and random errors: the theory holds
| Failed modules | 0 % | 1 % | 2 % | 5 % | 10 % | 15 % | 20 % |
|---|---|---|---|---|---|---|---|
| Maximum SLL (MC) | −35.1 | −34.8 | −34.5 | −33.9 | −33.2 | −32.3 | −31.6 |
| Far sidelobes MC / theory | −62.6 / −62.6 | −55.4 / −55.3 | −52.7 / −52.7 | −48.9 / −48.8 | −45.7 / −45.7 | −43.7 / −43.7 | −42.2 / −42.2 |
| Loss (dB) MC = theory | 0 | 0.04 | 0.09 | 0.22 | 0.46 | 0.71 | 0.97 |

- Per-element errors (σ_φ from 2.5° to 15°, with σ_a = σ_φ/10 dB): the far floor matches the theory to within 0.1 dB at most (−49.5 dB at 10°/1 dB). The loss also matches (0.190 dB at 10°). Pointing fits the linearized formula, σ_u = σ_φ·√(Σa²x²)/(k·Σa·x²): 3.78·10⁻⁵ measured vs. 3.86·10⁻⁵ theoretical at 10°.
- The mean floor rises quickly (from −63 to −46 dB with 10 % failures), but the maximum SLL barely moves (−33.2 dB). With N = 6400 the random floor stays about 12 dB below the first Taylor sidelobes. In the 16×16 mmWave array of that first analysis, the same 20 % brought the SLL to about −22.5 dB: **a large face is inherently robust**.

### 32.3 Correlated failure: a whole subarray costs more than its 64 elements scattered
| Failed subarrays | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| SLL, whole subarrays | −32.1 | −30.4 | −28.4 | −27.0 | −26.4 |
| SLL, same elements at random | −34.7 | −34.3 | −34.3 | −34.0 | −34.0 |

- The gain loss is the same in both cases (0.04 dB per subarray): only the lost power counts.
- What changes is the shape. An 8×8 hole subtracts a subarray pattern from the pattern, which is a wide (2/L in u), coherent lobe next to the beam, instead of a spread-out floor.
- The worst case is the central subarray, the one with the most weight in the taper: **−28.1 dB, 7 dB worse than the design**, vs. −34.7 dB with the same 64 elements scattered.

### 32.4 Recalibration with realistic hardware
- **Re-taper of the live modules** by alternating projections with FFT (Keizer, 2008): −37 dB mask, 150 iterations with P = 256.
  - Constraints: the attenuator can only attenuate (|w| ≤ 1); at the end it is quantized to 0.5 dB steps (31.5 dB range) and to 6 phase bits with dither.

  | Failed modules | Not recalibrated | Re-taper | Gain loss |
  |---|---|---|---|
  | 5 % | −33.8 | −35.1 | 0.22 → 0.24 dB |
  | 10 % | −33.2 | −35.1 | 0.46 → 0.48 dB |
  | 20 % | −30.9 | −34.8 | 0.97 → 1.04 dB |

  The final quantization costs less than 0.3 dB.
- **Calibration of 1 dB/10° errors.** They are measured with noise (1°, 0.1 dB) and corrected with the 6-bit phase shifter and the attenuator.
  - The far floor drops from −49.5 to −61.4 dB. The theory with the residual (0.18 dB, 1.91°, quantization included) gives −61.4 dB.
  - The maximum SLL drops from −33.8 to −35.2 dB. The limit is set by the hardware quantization, not by the calibration.
- **Failed subarray** (mean of 10 cases; the first is the central subarray):

  | Failed subarrays | Uncompensated | Digital weights only (99 subarrays) | Element re-taper |
  |---|---|---|---|
  | 1 | −31.4 | −32.9 | −34.2 |
  | 2 | −30.4 | −33.3 | −34.3 |
  | 3 | −27.6 | −28.8 | −32.6 |

  - The digital weights recover between 1.2 and 2.9 dB without touching the hardware, with a gain loss of 0.2–0.9 dB.
  - The element re-taper, with 64 times more degrees of freedom, recovers between 2.8 and 5 dB.
  - Here the degrees-of-freedom trade-off of the TFG and of E2 reappears.

### 32.5 Conclusion
**With 10 % of the T/R modules failed, the SLL rises from −35.1 to −33.2 dB (−31.6 dB with 20 %), and the re-taper of the live modules brings it back to −35.1 dB at the cost of 0.02 dB of gain. A whole failed subarray costs 3 dB of SLL on average and 7 dB if it is the central one, about 7 times more than its 64 elements scattered; the digital weights recover 1.5 dB and the element re-taper, 2.8 dB.**

The three formulas of §21 (sidelobe floor, gain loss and pointing), extended with failure as a Bernoulli factor, hold within the 95 % CI across the whole sweep.

### 32.6 Limitations
- Receive only. On transmit, failed modules also subtract power (1 − p), so the two-way loss is larger.
- Independent, equiprobable failures; no aging or zone-correlated thermal failures.
- The recalibration assumes that it is known which modules have failed (perfect diagnosis) and uses a uniform −37 dB mask. Keizer's algorithm is heuristic, not an optimum.
- The digital compensation of the failed subarray only controls the SLL in narrowband at f₀; the bandwidth has not been studied (E3).
- Monte Carlo of the recalibration with 10 cases per point, without CI: the figures are indicative (±0.5 dB).
- Narrowband, without mutual coupling (§22) or per-subarray errors (A2).
