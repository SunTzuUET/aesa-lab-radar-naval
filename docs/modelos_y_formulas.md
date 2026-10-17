# Modelos y fórmulas implementados

[English](models_and_formulas.md) · **Español**

*Referencia técnica del simulador web (`web/src/engine/*.ts`) y de su validación MATLAB, redactada el 2026-10-15 a partir del código tal como está, no de cómo debería estar. Si el código cambia, este documento hay que revisarlo. Donde una constante del código se aparta de la teoría o de la bibliografía, se marca con **[supuesto del modelo]**; donde parece un error, con **[revisar]**.*

Notación de las ubicaciones: `archivo:función (≈línea)`. Las rutas son relativas a `web/src/` salvo que se indique otra cosa. En las fórmulas las constantes aparecen como en el código (punto decimal); en el texto se usa coma decimal.

---

## 0. Índice

1. Convenciones
2. Geometría de la cara
3. Pesos de la cara
4. Patrón y ganancia
5. Métricas del haz
6. Ecuación radar y detección
7. Horizonte radar
8. Estado del mar
9. Movimiento del buque y apuntamiento
10. Refracción y conducto de evaporación
11. Atenuación atmosférica
12. Clutter de mar y de lluvia
13. Multitrayecto sobre el mar
14. Cadena SINR, cobertura y métricas de escenario
15. Escaneo de las 4 caras y forma de onda
16. Océano 3D (Gerstner) y movimiento aplicado en la vista 3D
17. Validación frente a MATLAB
18. Supuestos y limitaciones conocidas
19. Incoherencias y posibles errores detectados
20–21. (ver cuerpo)
22. Acoplamiento mutuo
23. Ecuación parabólica: difracción y conducto de evaporación
24. Clutter de mar K-distribuido
25. Techo de la cancelación de clutter: ventana, oscilador y transmisor
26. Medida angular monopulso y sus errores
27. Forma de onda, pérdidas de procesado y presupuesto de tiempo
28. E2 · Canales digitales frente a haces simultáneos
29. E3 · TTD por subarray frente al ancho de banda instantáneo
30. E1 · Partición en subarrays: regular, irregular o solapada
31. E4 · Anulación adaptativa de jammers al nivel de subarray
32. E6 · Robustez frente a fallos de módulos T/R y errores de calibración

---

## 1. Convenciones

### 1.1 Unidades

- El motor trabaja en **SI** (m, s, Hz, W, K, rad). Las entradas de usuario en ángulo van en **grados** (`azDeg`, `elDeg`, `windDirDeg`, `headingDeg`…) y se pasan a radianes con `deg = π/180` en cada módulo.
- Potencias y ganancias en **dB** solo en la interfaz y en algunos parámetros (`nfDb`, `lossDb`, `sllDb`, `cancelDb`, `gtDbi`, `grDbi`). Conversión: `db(x) = 10·log10(x)`, `lin(x) = 10^(x/10)` (`engine/radar.ts:4-5`, `engine/environment.ts:9-10`).
- El factor de propagación F es **en amplitud**; en dB se da como 20·log10 F. En la ecuación radar entra como F⁴.
- `sllDb` del taper es **positivo** (35 → lóbulos a −35 dB). La SLL medida (`metrics.ts`) es **negativa** (relativa al pico).
- Velocidad del buque en nudos; se pasa a m/s con **0,5144** (`environment.ts:shipMotion ≈151`, `Radar3D.tsx ≈511`).

Constantes (`engine/config.ts:4-7`, `engine/environment.ts:7`):

| Símbolo | Valor | Significado |
|---|---|---|
| c₀ | 299 792 458 m/s | velocidad de la luz |
| k_B | 1,380649·10⁻²³ J/K | constante de Boltzmann |
| T₀ | 290 K | temperatura de referencia de ruido |
| a | 6 371 000 m | radio terrestre medio |
| g | 9,80665 m/s² | gravedad |

### 1.2 Coordenadas de la cara (espacio seno)

- La cara es un plano **x–y** (x horizontal, y vertical) con la normal hacia fuera. El elemento i = iy·Nx + ix (filas = vertical) (`config.ts:faceGeometry ≈67`).
- Cosenos directores respecto a la cara (`array.ts:steerUV ≈10`):

  u = cos(el)·sen(az),  v = sen(el)

  con az el acimut respecto a la normal de la cara (positivo hacia +x) y el la elevación respecto al plano horizontal de la cara. Región visible: u² + v² ≤ 1; cos θ = √(1 − u² − v²) es el coseno del ángulo respecto a la normal.
- El patrón de array usa núcleo e^{+jk(x·u + y·v)} y los pesos llevan fase −k₀(x·u₀ + y·v₀), de modo que el máximo queda en (u₀, v₀).
- **La cara se supone vertical** en todo el motor: la elevación del haz respecto a la cara se trata como elevación sobre el horizonte. La vista 3D, en cambio, inclina las caras 12° hacia atrás (`views/Radar3D.tsx:TILT ≈36`, `panel.rotation.x = −TILT ≈220`) y `matlab/config/sistema_ref.m` declara `tiltDeg = 12`, que ningún cálculo usa. Ver §19.

### 1.3 Caras del buque y acimut

- 4 caras: `FACE_AZ = [0, 270, 180, 90]` = proa, babor, popa, estribor; el acimut del buque se mide **en sentido horario desde proa** (estribor = 90°) (`engine/scan.ts:FACE_AZ ≈35`).
- En el diagrama polar del escaneo, un acimut local θ de la cara k se dibuja en el acimut del buque φ = FACE_AZ[k] − θ (`views/ScanViews.tsx ≈86`). Es decir, el acimut local positivo de una cara gira en sentido antihorario visto desde arriba.
- Direcciones meteorológicas: `windDirDeg` y `swellDirDeg` son direcciones verdaderas **desde** las que viene el viento o el mar (0 = norte). El ángulo relativo a proa es `relDeg(t, h) = ((t − h) mod 360 + 540) mod 360 − 180 ∈ [−180, 180)` (`environment.ts:relDeg ≈125`).
- Las componentes de ola guardan la **dirección de propagación relativa a proa**: `dirDeg = dirFrom_rel + 180 + dispersión`; 0° = la ola avanza hacia proa (mar de popa), 180° = mar de proa (`environment.ts:discretize ≈116`).

### 1.4 Actitud del buque

- Balance θr (roll) y cabeceo θp (pitch) en rad, con **+ = babor arriba** y **+ = proa arriba**; arfada en m, + hacia arriba (`environment.ts:attitudeAt ≈185`).
- En la vista 3D (Three.js: proa = +z, babor = +x, estribor = −x, arriba = +y) se aplica `vessel.rotation.set(−pitch, 0, roll)` con orden de Euler `YXZ` (`Radar3D.tsx ≈450, ≈514`). Con esos ejes, −pitch en torno a x levanta la proa y +roll en torno a z levanta el costado de babor: es coherente con la convención del motor.
- No hay guiñada (yaw) ni deriva.

### 1.5 Polarización

`Pol = 'H' | 'V'`, la misma en transmisión y recepción (HH o VV). Afecta a σ⁰ del mar, a la atenuación por lluvia (P.838) y al coeficiente de Fresnel.

---

## 2. Geometría de la cara

**Ubicación:** `engine/config.ts:faceGeometry (≈68-86)`.

Nx = nSubX·subNx,  Ny = nSubY·subNy,  N = Nx·Ny

d = dLambda·c₀/f₀

x_i = (ix − (Nx − 1)/2)·d,  y_i = (iy − (Ny − 1)/2)·d   (centrada)

Subarray del elemento: sx = ⌊ix/subNx⌋, sy = ⌊iy/subNy⌋, índice `sub = sy·nSubX + sx`.

Centro del subarray: xc = ((sx + 0,5)·subNx − Nx/2)·d,  yc = ((sy + 0,5)·subNy − Ny/2)·d.

| Símbolo | Significado | Unidad | Por defecto |
|---|---|---|---|
| f₀ | frecuencia de diseño | Hz | 3,3·10⁹ |
| nSubX, nSubY | subarrays por fila/columna | — | 10, 10 |
| subNx, subNy | elementos por subarray | — | 8, 8 |
| dLambda | espaciado en λ a f₀ | — | 0,5 |
| d | espaciado físico | m | ≈ 0,0454 |

Hipótesis: rejilla rectangular regular y completa (sin subarrays irregulares ni cara parcialmente poblada), elementos puntuales idénticos, **sin acoplamiento mutuo**. Con d = λ/2 a f₀ no hay grating lobes en la región visible a f₀ para cualquier apuntamiento; a f > f₀ aparecen al barrer lejos.

---

## 3. Pesos de la cara

**Ubicación:** `engine/array.ts:computeWeights (≈30-59)`.

Peso complejo del elemento i:

w_i = a_x[ix]·a_y[iy]·e^{jφ_i}  si el elemento funciona,  w_i = 0 si ha fallado.

### 3.1 Taper separable

Taper 1D en cada eje con el mismo tipo, SLL y n̄ (`engine/tapers.ts:taper1d ≈4`), normalizado a máximo 1. Recepción: `beam.taper`; **transmisión: uniforme siempre** (`taperOverride = 'uniform'`, amplificadores saturados; `App.tsx:useSimulation ≈29`).

#### Taylor de n̄ términos — `tapers.ts:taylor (≈11-34)` (Taylor, 1955)

R = 10^{SLL/20},  A = arccosh(R)/π,  σ² = n̄² / (A² + (n̄ − ½)²)

F_m = (−1)^{m+1} · Π_{n=1}^{n̄−1} [1 − m²/(σ²(A² + (n − ½)²))] / (2·Π_{n=1, n≠m}^{n̄−1} [1 − m²/n²]),  m = 1…n̄−1

w(ξ_i) = 1 + 2·Σ_{m=1}^{n̄−1} F_m·cos(2π·m·ξ_i),  ξ_i = (i − (N − 1)/2)/N

Normalizado a máx 1. Es la definición de `taylorwin` de MATLAB (se valida contra ella, §17).

#### Dolph-Chebyshev exacto — `tapers.ts:chebyshev (≈37-60)`

M = N − 1,  R = 10^{SLL/20},  x₀ = cosh(arccosh(R)/M)

T_M(x) = cos(M·arccos x) si |x| ≤ 1;  sgn·cosh(M·arccosh|x|) si |x| > 1, con signo (−1)^M para x < −1.

Patrón: AF(ψ) = e^{jMψ/2}·T_M(x₀·cos(ψ/2)). Pesos por DFT inversa muestreando en ψ_k = 2πk/N:

w_n = (1/N)·Σ_{k=0}^{N−1} T_M(x₀ cos(ψ_k/2))·cos((M/2 − n)·ψ_k)

Normalizados por max|w_n|. Con N < 2 devuelve 1.

### 3.2 Fase de apuntamiento sin TTD (`computeWeights ≈52`)

φ_i = Q_b(−k₀·(x_i·u₀ + y_i·v₀)),  k₀ = 2πf₀/c₀

El desfasador lleva toda la fase **calculada a f₀**. A f = f₀ + Δf la fase no escala, así que el haz se desvía (squint): el máximo aparece en u ≈ u₀·f₀/f.

### 3.3 Fase con TTD por subarray (`computeWeights ≈47-50`)

τ_s = (xc·u₀ + yc·v₀)/c₀   (retardo real del subarray, continuo, sin cuantizar)

φ_i = Q_b(−k₀·((x_i − xc)·u₀ + (y_i − yc)·v₀)) − 2π·f·τ_s,  f = f₀ + Δf

El retardo escala con f (sin squint entre subarrays); solo el residuo intra-subarray, calculado a f₀, provoca squint. **[supuesto del modelo]** El TTD es ideal y continuo: la planificación prevé bits de TTD (E3), pero no están implementados.

### 3.4 Cuantización de fase — `array.ts:quantizePhase (≈15-20)`

φ_w = atan2(sen φ, cos φ) ∈ (−π, π]

Q_b(φ) = round(φ_w/Δ)·Δ,  Δ = 2π/2^b   (b = 0 → continuo)

Redondeo determinista al nivel más cercano, sin dither ni error aleatorio de fase o amplitud. El error de cuantización es periódico y produce lóbulos de cuantización coherentes. No hay atenuadores cuantizados (el taper es continuo).

### 3.5 Fallos

Elemento fallado (`failed[i] = 1`) → w_i = 0 en transmisión y en recepción. Se descuenta también de la potencia: P_t = n_activos·P_elem (§6). El fallo es "apagado"; no se modelan elementos atascados en fase ni fallos de subarray completos (salvo marcando sus 64 elementos).

---

## 4. Patrón y ganancia

### 4.1 Normalización de la ganancia (común a todas las rutinas)

**Ubicación:** cabecera de `engine/pattern.ts (≈2-3)`; `uvMap ≈37`, `gainAt ≈70`, `separableCut ≈110`, `scan.ts:apertureTable ≈80`.

G(u, v) = (4π·d²/λ²) · |AF(u, v)|² / Σ_i |w_i|² · cos θ,  cos θ = √(1 − u² − v²)

AF(u, v) = Σ_i w_i·e^{jk(x_i·u + y_i·v)},  k = 2πf/c₀,  λ = c₀/f

| Símbolo | Significado | Unidad |
|---|---|---|
| d | espaciado físico | m |
| f | frecuencia instantánea (f₀ + Δf) | Hz |
| Σ\|w\|² | potencia de los pesos (solo elementos activos) | — |

- Con pesos uniformes y apuntamiento broadside: G = 4π·N·d²/λ² = 4πA/λ² (apertura llena). Con taper, |AF|²/Σ|w|² < N e incluye la eficiencia de taper. `App.tsx ≈44` da además la referencia ideal G_ideal = 4π·N·(dLambda·f/f₀)².
- **Patrón de elemento**: cos θ **en potencia** (√cos θ en amplitud). En dB se suma 10·log10(√(1 − r²)) = 5·log10(1 − r²). En MATLAB se reproduce con `CosineAntennaElement` y `CosinePower [0,5 0,5]`.
- **[supuesto del modelo]** La fórmula es la ganancia de una apertura de área d² por elemento con patrón cos θ. Es exacta en ausencia de grating lobes; con grating lobes reparte la potencia de forma aproximada (lo dice el comentario del código). Sin pérdidas óhmicas ni de desadaptación, sin acoplamiento mutuo (la impedancia activa no varía con el barrido) y sin efectos de borde.
- Suelo numérico: 10·log10(max(·, 10⁻³⁰)).

### 4.2 Mapa u-v por FFT 2D — `pattern.ts:uvMap (≈23-62)`

1. Rejilla P×P con P = max(256, siguiente potencia de 2 de 4·max(Nx, Ny)) → sobremuestreo ≥ 4× (para 80×80, P = 512, 6,4×).
2. Los pesos se colocan en la esquina (índice iy·P + ix) y se hace la FFT 2D con núcleo e^{+j} sin normalizar (`fft.ts:fft2d ≈36`, radix-2 Cooley-Tukey in situ, `fft1d ≈4`): AF(p_u, p_v) = Σ w·e^{+j2π(ix·p_u + iy·p_v)/P}. El desplazamiento de origen respecto a la cara centrada solo añade una fase y no afecta a |AF|².
3. Correspondencia bin ↔ espacio seno: p = u·P·d/λ (`scale ≈38`), con envoltura periódica (`wrap`).
4. Cada píxel de salida (res×res, por defecto 241; la app usa 301) con u = −1 + 2a/(res − 1), v = 1 − 2b/(res − 1) (fila 0 = v = +1) se obtiene por **interpolación bilineal de la potencia** |AF|² en la rejilla FFT. Fuera de la región visible: NaN.
5. G en dBi con la normalización de §4.1. El pico del mapa (`peakDbi`, `peakU`, `peakV`) es el máximo de la rejilla interpolada, no el máximo exacto.

Limitación: la interpolación bilineal en potencia subestima ligeramente los máximos y suaviza los nulos.

### 4.3 Ganancia exacta en direcciones arbitrarias — `pattern.ts:gainAt (≈67-95)`

Suma directa separable: para cada (u, v), AF = Σ_iy e^{jk·y_iy·v}·Σ_ix w·e^{jk·x_ix·u}. Exacta (salvo el redondeo). Se usa para G_t y G_r en la dirección de apuntamiento (`App.tsx ≈42-43`).

### 4.4 Cortes principales separables — `pattern.ts:separableCut (≈104-145)`

Colapsa primero la dimensión fija: c[a] = Σ_b w·e^{jk·pos_b·fijo}; luego evalúa la dimensión variable con recurrencia trigonométrica (rejilla uniforme): e^{jk·pos_a·q} = e^{jk·pos_0·q}·(e^{jk·d·q})^a. Coste O(N + n·G).

- **Corte en acimut** `azimuthCut(el, step, span) (≈148)`: v = sen(el) fijo; u = cos(el)·sen(az), az ∈ [−span, span] (por defecto ±90°, paso 0,1°; la app usa 0,05°).
- **Corte en elevación** `elevationCut(u0, …) (≈159)`: **plano u = u₀ fijo** (el del apuntamiento), v = sen(el), el ∈ [−span, span]. Con az₀ ≠ 0 no es un corte a acimut constante, sino a u constante.
- Puntos con u² + v² > 1: NaN.

### 4.5 Diagrama desplazado en espacio seno (escaneo) — ver §15.2.

---

## 5. Métricas del haz

### 5.1 Sobre un corte — `engine/metrics.ts:cutMetrics (≈12-43)`

- **Pico**: muestra máxima i₀ refinada con una parábola por 3 puntos (si y₁ − 2y₂ + y₃ < 0):
  δ = ½·(y₁ − y₃)/(y₁ − 2y₂ + y₃),  θ_pk = θ_{i0} + δ·Δθ,  G_pk = y₂ − ¼·(y₁ − y₃)·δ
- **HPBW**: umbral G_pk − 3 dB; se busca hacia los lados desde i₀ la primera muestra ≤ umbral y se interpola linealmente cada cruce; HPBW = θ_h − θ_l (en el ángulo del corte: acimut a elevación fija o elevación a u fijo).
- **Primeros nulos**: se desciende desde el pico mientras la muestra siguiente sea menor (descenso monótono).
- **SLL** = max(G fuera de [nulo_izq, nulo_der]) − G_pk (dB, negativo).

Hipótesis: lóbulo principal monótono hasta los nulos. Con hombros o lóbulos fundidos (taper muy agresivo, haz muy barrido, fallos) el "nulo" puede ser un mínimo local y la SLL salir optimista o pesimista.

### 5.2 SLL 2D sobre el mapa u-v — `metrics.ts:sll2D (≈49-68)`

Relleno por inundación desde el píxel máximo con vecindad 4, añadiendo vecinos con G ≤ G del actual (descenso monótono); SLL = max(G fuera de la región) − G_pk. Misma hipótesis de monotonía; la resolución la fija el mapa (301×301 en la app).

---

## 6. Ecuación radar y detección

### 6.1 Ecuación radar (forma de energía) — `engine/radar.ts:snrConstant (≈18-23)`

SNR(R) = K / R⁴,  K = P_t·τ·G_t·G_r·λ²·σ·N_p / ((4π)³·k_B·T₀·F·L)

| Símbolo | Significado | Unidad | Por defecto |
|---|---|---|---|
| P_t | potencia de pico total = n_activos·P_elem | W | 6400·15 = 96 kW |
| τ | ancho de pulso (energía E = P_t·τ, filtro adaptado) | s | 100 µs |
| G_t | ganancia de transmisión en el apuntamiento (pesos **uniformes**, fallos incluidos) | lineal | — |
| G_r | ganancia de recepción en el apuntamiento (pesos con **taper**) | lineal | — |
| λ | c₀/f a la frecuencia instantánea | m | ≈ 0,091 |
| σ | RCS | m² | 1 |
| N_p | pulsos integrados coherentemente | — | 16 |
| T₀ | 290 K | K | — |
| F | figura de ruido (`nfDb`) | lineal | 3 dB |
| L | pérdidas del sistema (`lossDb`) | lineal | 6 dB |

Hipótesis: filtro adaptado (la compresión de pulso está implícita en usar la energía), **integración coherente ideal** de N_p pulsos (ganancia N_p, sin pérdida de integración), temperatura de sistema T₀·F (sin temperatura de antena ni pérdidas de línea separadas), blanco en el eje del haz en espacio libre. Al ser P_t ∝ n_activos y G_t ∝ n_activos, el producto P_t·G_t cae como n_activos² con los fallos (correcto para un array). Se valida contra `radareqsnr` (§17).

`snrDbAt(K, R) = 10·log10(K/R⁴)` (≈25). Alcance de detección en espacio libre: R_det = (K/SNR_req)^{1/4} (`detectionRange ≈49`).

### 6.2 Swerling 1 — `radar.ts:pdSwerling1 (≈28)`, `snrReqSwerling1 (≈33)`

P_d = P_fa^{1/(1 + SNR)},  SNR_req = ln P_fa / ln P_d − 1

SNR lineal **ya integrado** (coherente). Exacta para detector de ley cuadrática con un solo "pulso" efectivo y RCS con distribución exponencial constante durante la ráfaga (fluctuación de barrido a barrido). Es el modelo de detección por defecto de toda la cadena con entorno (§14).

### 6.3 Swerling 0 por Albersheim — `radar.ts:pdSwerling0 (≈41-46)`

Ecuación de Albersheim con N = 1:

SNR_dB = (6.2 + 4.54/√1.44)·log10(A + 0.12·A·B + 1.7·B),  A = ln(0.62/P_fa),  B = ln(P_d/(1 − P_d))

Invertida analíticamente:

Z = 10^{SNR_dB/(6.2 + 4.54/√1.44)},  B = (Z − A)/(0.12·A + 1.7),  P_d = 1/(1 + e^{−B})

Hipótesis y límites: aproximación empírica (±0,2 dB según su autor) para blanco no fluctuante y detector lineal, válida en 10⁻⁷ ≤ P_fa ≤ 10⁻³ y 0,1 ≤ P_d ≤ 0,9. La validación la usa también en P_d = 0,95 y 0,99, fuera de ese rango (tolerancia 0,3 dB, §17). Solo se usa en la pestaña Radar como curva comparativa (`views/RadarTab.tsx ≈37`).

---

## 7. Horizonte radar

**Ubicación:** `engine/radar.ts:radarHorizon (≈54-57)`.

R_hor = √(2·k·a·h_r) + √(2·k·a·h_t),  k = 4/3 por defecto

| Símbolo | Significado | Unidad |
|---|---|---|
| h_r, h_t | altura de la antena y del blanco (negativas → 0) | m |
| k·a | radio terrestre efectivo | m |

Aproximación de h ≪ a. La pestaña Radar usa k = 4/3 (`RadarTab.tsx ≈25`); la pestaña Entorno y los escenarios usan el k de la refractividad de superficie (§10.2): `radarHorizon(…, ae/6 371 000)` (`EnvironmentTab.tsx ≈72`) y la misma fórmula en `scenarios.ts:evaluate ≈93`. El mismo criterio de visibilidad (d < R_hor) está en `twoRayGeometry` (§13.1).

---

## 8. Estado del mar

### 8.1 Mar de viento (Pierson-Moskowitz desarrollado) — `environment.ts:windSea (≈59-62)`

H_s = 0.21·U²/g,  T_p = 2π·U/(0.877·g)   (si U < 0,3 m/s: H_s = 0, T_p = 2 s)

Mar totalmente desarrollado (fetch y duración ilimitados). **[supuesto del modelo]** La fórmula de PM es para el viento a 19,5 m; el código usa el viento a ~10 m sin corregir (el comentario lo reconoce), lo que subestima H_s unos pocos por ciento.

### 8.2 H_s combinada — `totalHs (≈65-68)`

H_s = √(H_s,viento² + H_s,fondo²)  (energías independientes que se suman).

### 8.3 Espectro PM en función de (H_s, T_p) — `pmSpectrum (≈88-91)`

S(ω) = (5/16)·H_s²·ω_p⁴/ω⁵·exp(−1.25·(ω_p/ω)⁴),  ω_p = 2π/T_p   [m²·s]

### 8.4 Discretización del espectro — `discretize (≈103-122)`, `waveField (≈127-133)`

- Banda ω ∈ [0,7·ω_p, 2,6·ω_p] dividida en n intervalos iguales Δω; ω_i en el centro de cada uno.
- Amplitud a_i = √(2·S(ω_i)·Δω); número de onda de aguas profundas k_i = ω_i²/g.
- Dirección de propagación relativa a proa: dirFrom_rel + 180° + δ_i, con δ_i uniforme en ±35° (viento) o ±8° (mar de fondo).
- Fase φ_i uniforme en [0, 2π).
- Generador congruencial de Park-Miller (x ← 16807·x mod (2³¹ − 1)) con **semillas fijas** 7 (viento) y 11 (fondo): el oleaje es determinista.
- Reescalado final de las amplitudes para que H_s = 4·√m₀ exacto, con m₀ = Σ a_i²/2 (compensa la parte del espectro fuera de la banda).
- `waveField(e, nWind, nSwell)`: 9 + 4 componentes por defecto; `shipMotion` usa 24 + 10 y el océano 3D 10 + 5.

**[supuesto del modelo]** Dispersión direccional uniforme aleatoria, no una función cos^{2s}; aguas profundas; superposición lineal.

### 8.5 Escala Douglas — `douglas (≈71-76)`

Estado = número de umbrales superados por H_s, con umbrales [0,0001; 0,1; 0,5; 1,25; 2,5; 4; 6; 9; 14] m, limitado a 9. Nombres en `DOUGLAS_NAME`. Este entero es el "sea state" que entra en el modelo NRL (§12.1).

### 8.6 Escala Beaufort — `beaufort (≈80-85)`

Fuerza = número de umbrales de U superados (≥), umbrales [0,5; 1,5; 3,3; 5,5; 7,9; 10,7; 13,8; 17,1; 20,7; 24,4; 28,4; 32,6] m/s. Solo informativa. **[supuesto del modelo]** La tabla de la OMM empieza la fuerza 1 en 0,3 m/s, no en 0,5.

---

## 9. Movimiento del buque y apuntamiento

### 9.1 Buque genérico — `environment.ts:SHIP (≈45-51)`

Eslora L = 140 m, manga B = 18 m, periodo natural de balance T_φ = 10,5 s, de cabeceo T_θ = 6,5 s, amortiguamiento de balance ζ = 0,06 sin aletas y 0,25 con aletas. **[supuesto del modelo]** Valores de clase fragata, no de un buque concreto.

### 9.2 Frecuencia de encuentro — `shipMotion (≈158)`

ω_e = max(0.05, |ω − ω²·U·cos χ/g|)

| Símbolo | Significado | Unidad |
|---|---|---|
| ω | frecuencia absoluta de la componente | rad/s |
| U | velocidad del buque (nudos·0,5144) | m/s |
| χ | dirección de propagación de la ola relativa a proa (0 = mar de popa) | rad |

Fórmula clásica de aguas profundas. Con mar de popa ω_e < ω; el valor absoluto pliega el caso en que el buque adelanta a la ola. **[supuesto del modelo]** Suelo de 0,05 rad/s para evitar ω_e = 0.

### 9.3 RAO (respuesta lineal de un grado de libertad) — `shipMotion (≈150-181)`

Para cada componente (a, k, χ), λ_w = 2π/k:

- Pendiente de la ola: s = k·a (rad).
- Filtros de dimensión del buque: l_f = 1/(1 + (L/λ_w)²) (eslora), b_f = 1/(1 + (B/λ_w)²) (manga).
- Oscilador amortiguado: RAO(r, ζ) = 1/√((1 − r²)² + (2ζr)²).

**Balance:**  a_R = min(0.6, s·|sen χ|·RAO(ω_e/ω_φ, ζ)·b_f·**0.8**)  [rad],  ω_φ = 2π/T_φ

**Cabeceo:**  a_P = s·|cos χ|·l_f·RAO(ω_e/ω_θ, **0.35**)  [rad],  ω_θ = 2π/T_θ

**Arfada:**  a_H = a·√l_f  [m] (sin resonancia)

Cada grado de libertad es una suma de senos a ω_e: θ(t) = Σ a·sen(ω_e·t + φ), con fases φ (balance), φ + 1,1 rad (cabeceo) y φ + 0,4 rad (arfada) (`≈170-172`, `attitudeAt ≈186`).

Amplitudes significativas (2σ): θ_r,sig = 2·√(Σ a_R²/2), igual para cabeceo y arfada. Periodo de pico del balance: 2π/ω_e de la componente con mayor a_R.

**[supuesto del modelo]** Todo lo siguiente es una simplificación de esta aplicación, no un RAO hidrodinámico: el factor **0,8** del balance, el tope de **0,6 rad** (≈34°) por componente, el amortiguamiento de cabeceo **0,35**, los desfases fijos 1,1 y 0,4 rad, los filtros 1/(1 + (L/λ)²) y la arfada sin dinámica. No hay acoplamientos entre grados de libertad ni amortiguamiento no lineal, y el efecto de las aletas se reduce a subir ζ.

### 9.4 Error de apuntamiento en elevación — `pointingErrorRmsDeg (≈196-201)`

δ ≈ θ_p·cos az + θ_r·sen az  (comentario del código; az = acimut del haz relativo a proa)

δ_rms = √((σ_p·cos az)² + (σ_r·sen az)²),  σ = (amplitud significativa)/2

Con estabilización electrónica:

δ_rms,estab = **0.03**·δ_rms + **0.02°**

**[supuesto del modelo]** El residuo de estabilización (3 % del movimiento + 0,02°, por latencia de la INS y del recálculo de fases) es un valor supuesto, no derivado. Se supone que balance y cabeceo están incorrelados y que solo hay error en elevación (no en acimut). El argumento `azRelDeg` recibe `beam.azDeg`, que es el acimut **local de la cara**: solo coincide con el acimut relativo a proa en la cara de proa (§19).

### 9.5 Pérdida de apuntamiento — `pointingLossDb (≈204-206)`

L_pt = 2·12·(δ_rms/θ₃)²  [dB],  θ₃ = HPBW en elevación (≥ 0,05° en la función; ≥ 0,3° en las pestañas)

Haz gaussiano: pérdida de ida 12·(δ/θ₃)² dB (3 dB a δ = θ₃/2); ×2 por la ida y vuelta; media de la pérdida en dB con δ de valor eficaz δ_rms. Se suma como `extraLossDb` en la cadena (§14).

---

## 10. Refracción y conducto de evaporación

### 10.1 Refractividad de superficie (ITU-R P.453) — `satVapor (≈211)`, `refractivity (≈216)`, `absHumidity (≈222)`

e_s = 6.1121·exp(17.502·t/(t + 240.97))  [hPa],  t en °C (sobre agua)

e = (HR/100)·e_s

N = (77.6/T)·(P + 4810·e/T),  T = t + 273.15 K,  P en hPa

ρ = 216.7·e/T  [g/m³]

La expresión de e_s es la de las versiones antiguas de P.453 (sin el factor de corrección EF ni el término −t/d de la actual). Válida en la troposfera baja y frecuencias de radio (no óptica).

### 10.2 Gradiente CRPL y factor k — `kFactor (≈231-235)`

ΔN = −7.32·exp(0.005577·N_s)  [N/km]  (modelo exponencial de referencia CRPL, primer km)

k = 1/(1 + a·ΔN·10⁻⁹),  a_e = k·a

(10⁻⁹ = 10⁻⁶ de N a n por 10⁻³ de km a m.) Con el entorno por defecto (18 °C, 75 %, 1013 hPa) N_s ≈ 338 y k ≈ 1,44. Este a_e es el que usan el multitrayecto, el clutter y los horizontes de la pestaña Entorno (`envContext ≈566`, `effectiveEarth ≈636`). Gradiente lineal: sin capas, sin superrefracción ni conductos elevados.

### 10.3 Conducto de evaporación — `evapDuct (≈243-255)` (**solo informativo**)

Perfil logarítmico en estabilidad neutra (simplificación de Paulus-Jeske):

N(z) = N₀ + ΔN·ln(z/z₀)/ln(z_r/z₀),  z_r = 6 m,  z₀ = 1,5·10⁻⁴ m

N₀ = N(T_mar, P, HR = 98 %),  N_r = N(T_aire, P, HR),  ΔN = N_r − N₀

Mínimo de M(z) = N(z) + 0,157·z → altura del conducto:

δ = −ΔN/(0.157·ln(z_r/z₀))·s_t,  acotada a [0, 40] m

Corrección de estabilidad **[supuesto del modelo]**, "grosera" según el código: ΔT = T_aire − T_mar; s_t = 1/(1 − 0,06·ΔT) si ΔT < 0, y s_t = 1 + 0,04·min(ΔT, 5) si no.

Longitud de onda máxima atrapada (Kerr): λ_max = 0,0144·δ^{1,5} [m], f_min = c₀/λ_max (se calcula con δ sin acotar).

**El conducto se muestra pero no entra en la propagación**: ni el factor F ni la cobertura lo usan. Ver §18 y §19 sobre la constante 0,0144.

---

## 11. Atenuación atmosférica

### 11.1 Gases (ITU-R P.676, tabla de `gaspl`) — `gasAttenDbKm`

Desde el 2026-10-15 la atenuación de gases ya no usa la aproximación del anexo 2 de P.676: se interpola en una tabla generada con `gaspl` de MATLAB (`matlab/fase2_entorno/tabla_p676.m` → `web/src/engine/p676_table.json`).

γ_O2(f, T, P) = gaspl(1 km, f, T, P, ρ = 0)  ·  γ_H2O(f, T, ρ, P) = gaspl(1 km, f, T, P, ρ) − γ_O2   [dB/km]

Rejilla: f 2,5–4,5 GHz (paso 0,25), T −10–40 °C (paso 5), ρ 0–30 g/m³ (paso 2,5), P 950–1050 hPa (4 valores). Interpolación multilineal; fuera de la rejilla se satura en el borde.

Motivo del cambio: la aproximación anterior omitía el pseudo-continuo del vapor de agua y se quedaba hasta un 22 % corta frente a `gaspl` con aire cálido y húmedo (≈ 1 dB en 300 km de ida y vuelta). Validación: error relativo < 2 % frente a `gaspl` en 4 atmósferas.

### 11.2 Lluvia (ITU-R P.838-3) — `rainAttenDbKm (≈335-344)`, tabla `P838 (≈281-334)`

γ_R = k·R^α  [dB/km],  R en mm/h

Los coeficientes k_H, α_H, k_V, α_V salen de una **tabla de 1 a 6 GHz con paso de 0,1 GHz extraída de `rainpl` de MATLAB** (`matlab/fase2_entorno/val_entorno.m`, función `gammaR` con trayecto de 1 m para eliminar la reducción de trayecto: k = γ(1 mm/h), α = log10(γ(10)/γ(1))). f se satura a [1, 6] GHz. Interpolación en log f: k **log-lineal** (ln k lineal en ln f) y α **lineal** en ln f. Polarización H (τ = 0°) o V (τ = 90°), sin inclinación ni elevación intermedias. Valores en f₀ = 3,3 GHz: k_H = 3,12678·10⁻⁴, α_H = 1,33862; k_V = 5,51706·10⁻⁴, α_V = 1,10790. R ≤ 0 → 0.

### 11.3 Pérdida atmosférica de ida y vuelta — `atmLossDb (≈354-361)` y `atmLossCtx (≈577-582)`

L_atm = 2·[γ_o·L_eq(6000) + γ_w·L_eq(2000) + γ_R·L_lluvia]/1000  [dB]  (γ en dB/km, longitudes en m)

L_eq(H) = R·(1 − e^{−x})/x,  x = R·max(sen el, 10⁻⁴)/H   (L_eq = R si x < 10⁻⁶)

L_lluvia = min(R, 25 000, 3000/max(sen el, 10⁻³))

| Símbolo | Significado | Unidad |
|---|---|---|
| R | distancia oblicua | m |
| el | elevación del rayo directo, ≥ 0 en la cadena (`evalPoint ≈592`) | rad |
| H | altura de escala exponencial: 6 km (O₂), 2 km (H₂O) | m |
| 3000 m | isoterma de 0 °C (`RAIN_TOP_M`) **[supuesto del modelo]** | m |
| 25 km | radio del chubasco centrado en el buque (`RAIN_RADIUS_M`) **[supuesto del modelo]** | m |

Hipótesis: tierra plana para la integral de altura, atmósfera exponencial y lluvia uniforme dentro de un cilindro de 25 km de radio y 3 km de altura alrededor del buque.

### 11.4 Visibilidad (solo para el render) — `visibilityKm (≈364-369)`

V = clamp(1/(1/V_bruma + 1/V_lluvia), 0.4, 80) km,  V_bruma = 60·((100 − min(HR, 99.5))/60)^{0.7},  V_lluvia = 25/R^{0.6}. Empírica, no entra en ningún cálculo radar.

---

## 12. Clutter de mar y de lluvia

### 12.1 Reflectividad del mar, modelo NRL — `seaSigma0Db (≈377-385)` (Gregers-Hansen y Mital, 2012)

σ⁰_dB = c₁ + c₂·log10(sen ψ) + (27.5 + c₃·ψ)·log10(f)/(1 + 0.95·ψ) + c₄·(1 + SS)^{1/(2 + 0.085·ψ + 0.033·SS)} + c₅·ψ²

| Pol. | c₁ | c₂ | c₃ | c₄ | c₅ |
|---|---|---|---|---|---|
| H | −73,0 | 20,78 | 7,351 | 25,65 | 0,0054 |
| V | −50,79 | 25,93 | 0,7093 | 21,58 | 0,00211 |

ψ = rasante en grados, saturada a [0,1°, 60°]; f en GHz; SS = estado de la mar (Douglas, §8.5). Validez publicada: 0,1°–60°, 0,5–35 GHz, SS 0–6. **El código no limita SS a 6** (§19). Se valida contra `seareflectivity(…, 'Model', 'NRL')` (§17).

### 12.2 Normalización común — `clutterTerms (≈526-554)`

ΔR = c₀/(2·B)   (resolución tras compresión, B = `bandwidthHz`, por defecto 5 MHz)

unit = K/(σ·R⁴)   (SNR de un blanco de 1 m² a R en espacio libre)

Así, CNR = unit·σ_c, con σ_c la RCS de clutter de la celda. Hereda de K la integración coherente de N_p pulsos y las ganancias de pico G_t·G_r.

### 12.3 Clutter de mar — `clutterTerms (≈533-545)`, `clutterToNoise (≈557-561)`, `evalPoint (≈595)`

Solo si R < √(2·a_e·h_r) (horizonte de la antena para h_t = 0):

sen ψ = h_r/R − R/(2·a_e)   (rasante en la celda; si ψ ≤ 0 no hay clutter)

A = R·(θ_az/1,33)·ΔR/cos ψ   [m²]   (celda limitada por el pulso; anchura efectiva de ida y vuelta θ₃/1,33, Barton)

ψ_c = λ/(4π·σ_h),  σ_h = max(H_s/4, 0.01) m

f_c = (ψ/ψ_c)⁴ si ψ < ψ_c, y 1 si no   (zona de interferencia por debajo del ángulo crítico)

CNR_mar = unit·σ⁰·A·f_c·10^{−C/10}·f(−ψ)⁴

| Símbolo | Significado | Unidad |
|---|---|---|
| θ_az | HPBW en acimut (≥ 0,3° en las pestañas) | rad |
| C | cancelación del MTD: calculada (§25, por defecto) o `cancelDb` fija (35 dB) | dB |
| f(−ψ) | patrón relativo en amplitud hacia la celda (§13.4), a la cuarta: ida y vuelta | — |

**[supuesto del modelo]**
- El factor 1,33 **divide** la anchura del haz (anchura efectiva de un haz gaussiano de ida y vuelta ≈ 0,75·θ₃). Hasta el 2026-10-15 multiplicaba y el clutter salía ≈ 2,5 dB alto (§19, corregido).
- Celda siempre limitada por el pulso (no se comprueba el régimen limitado por el haz, R·θ_el·tan ψ < ΔR).
- El factor (ψ/ψ_c)⁴ es un modelo de zona de interferencia aparte del multitrayecto de §13; no se aplica el F del clutter.
- La cancelación Doppler es un único número en dB por distancia: desde el 2026-10-15 se calcula con §25 (ventana, espectro, oscilador, transmisor); con `cancelPhys = false` vuelve a ser fija. Sin velocidad del blanco ni pérdida de MTI sobre el blanco.
- No se aplican al clutter las pérdidas atmosféricas ni `extraLossDb`.
- Clutter de un solo anillo (la celda a la misma distancia que el blanco), sin ambigüedades en distancia.

### 12.4 Clutter de lluvia — `rainEta (≈388-393)`, `clutterTerms (≈547-552)`

Z = 200·R_ll^{1.6}·10⁻¹⁸   [m⁶/m³]   (Marshall-Palmer, R_ll en mm/h)

η = π⁵·|K|²·Z/λ⁴,  |K|² = 0.93   [m²/m³]

Si hay lluvia y R < 25 km:

h_haz = min(R·θ_el, 3000 m)

V = (π/4)·(R·θ_az)·h_haz·ΔR/0.693·0.5 = (π/4)·R·θ_az·h_haz·ΔR/(2 ln 2)   [m³]

CNR_lluvia = unit·η·V·10^{−max(0, C − 15)/10}

El factor 1/(2 ln 2) es el de Probert-Jones para un haz gaussiano.

**[supuesto del modelo]** Lluvia **uniforme** en un cilindro de 25 km de radio y 3 km de altura centrado en el buque; sin patrón (todo el volumen se pondera con la ganancia de pico); la cancelación de la lluvia es 15 dB peor que la del mar (dispersión Doppler); sin atenuación de la lluvia en el propio retorno de clutter; dispersión Rayleigh (válida en banda S).

---

## 13. Multitrayecto sobre el mar

### 13.1 Geometría de dos rayos sobre tierra esférica (Blake) — `twoRayGeometry (≈438-455)`

Entradas: h₁ (radar), h₂ (blanco), d (distancia), a_e. Se ordenan lo = min(h₁, h₂), hi = max(h₁, h₂).

- Visibilidad: d < √(2a_e·lo) + √(2a_e·hi); si no, `visible = false` (F = 0).
- Elevación del rayo directo en el radar: θ_d = atan2(h₂ − h₁, d) − d/(2a_e).
- Punto de reflexión (solución trigonométrica de la cúbica):

  p = (2/√3)·√(a_e·(lo + hi) + d²/4)

  Φ = arccos(2·a_e·(hi − lo)·d/p³)

  d₁ = d/2 − p·cos((Φ + π)/3)   (medida **desde la antena más baja**), acotada a [10⁻³, d − 10⁻³];  d₂ = d − d₁

  (En el límite de tierra plana da d₁ = d·lo/(lo + hi), como debe.)
- Alturas reducidas: h₁' = lo − d₁²/(2a_e), h₂' = hi − d₂²/(2a_e); si alguna es ≤ 0, se devuelve visible con ψ = 0 (solo rayo directo).
- Rasante: ψ = atan(h₁'/d₁).
- **Diferencia de caminos por la imagen** (exacta sobre el plano tangente de alturas reducidas, no la aproximación 2h₁'h₂'/d):

  Δ = √(d² + (h₁' + h₂')²) − √(d² + (h₂' − h₁')²)

- **Divergencia**: D = 1/√(1 + 2·d₁·d₂/(a_e·d·tan ψ))   (tan ψ ≥ 10⁻⁹).

Hipótesis: óptica geométrica, un único rayo reflejado, sin región intermedia ni de difracción cerca del horizonte (más allá del horizonte F = 0 de golpe; justo antes, la interferencia sigue). Sin conductos. `evalPoint` recibe la distancia **oblicua** R y la convierte a distancia sobre la superficie con la ley de cosenos (`groundRange`) antes de la geometría de dos rayos; el diagrama de cobertura usa la distancia sobre la superficie en el eje y calcula la oblicua (`slantRange`) para la ecuación radar.

### 13.2 Coeficiente de Fresnel del mar liso — `fresnel (≈410-417)`

ε = ε' − jε''

Γ_H = (sen ψ − √(ε − cos²ψ))/(sen ψ + √(ε − cos²ψ))

Γ_V = (ε·sen ψ − √(ε − cos²ψ))/(ε·sen ψ + √(ε − cos²ψ))

Raíz compleja principal (parte real ≥ 0).

### 13.3 Permitividad del agua de mar (Debye simple) — `seaPermittivity (≈398-402)`

ε' = ε_∞ + (ε_s − ε_∞)/(1 + (ωτ)²)

ε'' = (ε_s − ε_∞)·ωτ/(1 + (ωτ)²) + σ/(ω·ε₀)

ε_∞ = 4,9, ε_s = 72, τ = 9,2 ps, σ = 4,7 S/m, ε₀ = 8,854·10⁻¹² F/m. **[supuesto del modelo]** Fijo para 20 °C y 35 ‰: no depende de la temperatura del agua del entorno. A 3,3 GHz da ε ≈ 69,6 − j37,95. Se valida contra `earthSurfacePermittivity` (ITU-R P.527) (§17).

### 13.4 Rugosidad (Ament) — `roughness (≈420-423)`

ρ_s = exp(−2·(2π·σ_h·sen ψ/λ)²),  σ_h = H_s/4

Sin el término de Miller-Brown (I₀); reflexión especular reducida de forma determinista, sin componente difusa.

### 13.5 Factor de propagación con patrón — `propagationFactor (≈461-474)`

F = | f(θ_d) + Γ·ρ_s·D·f(−ψ)·e^{−j2πΔ/λ} |

| Símbolo | Significado |
|---|---|
| f(θ) | patrón de recepción en amplitud relativo al pico (§13.6) |
| θ_d | elevación del rayo directo |
| −ψ | dirección de salida del rayo reflejado en el radar (por debajo del horizonte) |

Casos: no visible → F = 0; ψ ≤ 0 → F = f(θ_d). F es relativo al espacio libre **en el eje del haz**: con f(θ_d) < 1 incluye también la pérdida por estar fuera del eje.

**[supuesto del modelo]** El rayo reflejado sale del radar con depresión ψ (igualdad de ángulos en la geometría de alturas reducidas, sin la corrección por curvatura en el radar). Se usa **el mismo patrón (el de recepción, con taper) para ida y vuelta**: F⁴ = F_rx², aunque la transmisión es uniforme.

### 13.6 Patrón relativo a partir del corte en elevación — `patternFromCut (≈477-499)`

Tabla de amplitud A_i = 10^{(G_i − G_pk)/20} sobre el corte en elevación (`elevationCut` en u = u₀); fuera de la tabla o con NaN: 10⁻⁴ (−80 dB). Interpolación lineal en amplitud.

- **Haz fijo** (`envelope = false`): f(el) = A(el_pk + (el − el_haz)), con el_pk el ángulo del máximo del corte y el_haz la elevación mandada.
- **Envolvente / búsqueda** (`envelope = true`): un haz por elevación apuntado al rayo directo del blanco: f(el) = A(el_pk + (el − θ_d)).

**[supuesto del modelo]** El patrón se desplaza **rígidamente en grados** (no en espacio seno). Es buena aproximación cerca del horizonte; para elevaciones grandes el haz real se ensancharía. El caso envolvente supone que en cada distancia hay un haz exactamente apuntado al blanco (sin pérdida de cruce entre barras).

---

## 14. Cadena SINR, cobertura y métricas de escenario

### 14.1 Contexto — `envContext (≈564-573)`

Precalcula N_s (§10.1), a_e = k·a (§10.2), H_s total, SS = Douglas(H_s), ε del mar, λ y los γ de gases y lluvia en la frecuencia del enlace. El enlace `EnvLink` lleva K (§6.1, con G_t uniforme y G_r con taper en el apuntamiento, n_activos), f, h_r, HPBW en acimut y elevación (≥ 0,3°), `extraLossDb` = pérdida de apuntamiento (§9.5), τ, σ.

### 14.2 Punto de evaluación — `evalPoint (≈585-600)`

Para un blanco a distancia R y altura h_t:

geo = twoRayGeometry(h_r, h_t, R, a_e)

F = propagationFactor(geo, …) (con el patrón relativo al haz fijo o al apuntado a θ_d)

SNR_ls = K/R⁴

SNR = SNR_ls·F⁴·10^{−(L_atm(R, max(θ_d, 0)) + L_extra)/10}

CNR = CNR_mar (con f(−ψ)⁴) + CNR_lluvia

**SINR = SNR/(1 + CNR)**

Hipótesis: el clutter se trata como ruido blanco gaussiano añadido (sin estadística K ni CFAR); sin jammer (S3 no implementado).

### 14.3 Curvas y diagrama de cobertura — `linkVsRange (≈603)`, `coverageGrid (≈610-623)`, `runCoverageJob (≈630)`

- Curvas frente a distancia a altura fija.
- Diagrama de cobertura: R_i = R_max·(i + 0,5)/n_x, h_j = h_max·(1 − (j + 0,5)/n_y) (fila 0 arriba); SINR en dB por celda. Los términos de clutter (que solo dependen de R) se calculan una vez por columna. Se ejecuta en un worker (`engine/coverage.worker.ts`).

### 14.4 Métricas de escenario — `engine/scenarios.ts:evaluate (≈82-126)`

- SNR_req = Swerling 1 (P_d,req, P_fa) (§6.2); en dB `reqDb`.
- L_pt = pointingLossDb(pointingErrorRmsDeg(movimiento, az_haz, estab), HPBW_el).
- R_hor = √(2a_e·h_r) + √(2a_e·h_t) (a_e de CRPL).
- R_ls = (K/SNR_req)^{1/4} (espacio libre).
- Rejilla: R_i = R_max·(i + 1)/n, con R_max = min(450 km, max(20 km, min(1,05·R_hor, 2,1·R_ls), 1,1·R_ref)). El 2,1 se justifica en el código porque el refuerzo de multitrayecto (F⁴ hasta +12 dB) permite detectar hasta ≈ 2·R_ls.
- P_d(R) = Swerling 1 sobre la SINR (0 si SINR < −150 dB).
- **Primera detección** R_first: la mayor R_i con SINR ≥ reqDb (blanco que se acerca).
- **Cobertura continua** R_cont: R_{i−1} de la primera muestra i > 0 que no detecta (R_{n−1} si no hay ninguna y la primera detecta).
- **Huecos**: número de transiciones detecta → no detecta en i ≤ índice de la última detección (nulos de multitrayecto entre R_cont y R_first).
- Punto de referencia R_ref, evaluado exactamente: SINR, SNR, CNR, F² en dB (20·log10 F), P_d (Swerling 1).
- **Factor limitante** (`≈118`), en este orden: no visible → «horizonte»; CNR_ref > 0 dB → «clutter»; 20·log10 F_ref < −6 dB → «multitrayecto»; si no, «ruido». **[supuesto del modelo]** Umbrales de clasificación propios.

Escenarios definidos (`SCENARIOS ≈21-53`): S1 vigilancia aérea (3 m², 5000 m, R_ref 200 km), S2 rozaolas (0,1 m², 7 m, 20 km), S5 dron (0,01 m², 100 m, 10 km). S3 (jammer) y S4 (multifunción) están declarados pero sin implementar (`ready: false`). Los barridos (`runSweep ≈210`) repiten `evaluate` con n = 400 variando un parámetro y, opcionalmente, una serie (polarización, estabilización, aletas, envolvente frente a haz fijo).

---

## 15. Escaneo de las 4 caras y forma de onda

### 15.1 Plan raster y reloj — `engine/scan.ts:scanPlan (≈21-32)`, `beamAt (≈47-54)`, `ScanClock (≈57)`

- n_az = max(1, round(2·span/paso) + 1) posiciones por barra, de −span a +span; barras de elevación recorridas en **bustrófedon** (sentido alterno).
- Dwell T_d = n_pulsos·PRI; cuadro T_f = T_d·n_posiciones.
- La cara k va desfasada k·T_f/4: t_f = (t + k·T_f/4) mod T_f; posición = ⌊t_f/T_d⌋; pulso = ⌊(t_f − pos·T_d)/PRI⌋.
- Parámetros que fija la vista (`views/ModelTab.tsx ≈39-43`): paso en acimut = max(0,2°, factor·HPBW_az); barras a i·HPBW_el (i = 0…n−1); PRI = 2·R_ua/c₀; τ = min(τ_radar, 0,5·PRI); B = `bandwidthHz`.
- Reloj con cámara lenta y pausa: t = base + (ahora − ref)·velocidad.

### 15.2 Diagrama de la cara desplazado en espacio seno — `apertureTable (≈73-97)`, `faceGain (≈100-109)`

Con pesos **sin apuntar** (taper + fallos, az = el = 0, Δf = 0) se tabula, colapsando la dimensión vertical por columnas (c[ix] = Σ_iy w):

P(Δu) = (4π·d²/λ²)·|Σ_ix c[ix]·e^{jk·x_ix·Δu}|²/Σ|w|²,  Δu ∈ [−2, 2], 2049 puntos

Ganancia de la cara en el acimut local θ con el haz en (az₀, el₀):

u = cos el₀·sen θ,  u₀ = cos el₀·sen az₀,  v₀ = sen el₀

G(θ) = P(u − u₀) [interpolado] + 5·log10(1 − u² − v₀²)   (|θ| < 90° y u² + v₀² < 1; si no, −∞)

**[supuesto del modelo]** Desfasadores **ideales** (continuos, sin cuantización ni squint, a f₀) y patrón evaluado en el plano de elevación del haz (v = v₀): el haz apuntado es el mismo patrón desplazado en espacio seno. Las caras 1–3 se dibujan sanas salvo que estén todas "vivas"; la cara 0 lleva sus fallos (`ModelTab.tsx ≈47-53`).

### 15.3 Chirp LFM en banda base — `lfm (≈112-116)`

t_c = t − τ/2 ∈ [−τ/2, τ/2],  φ(t) = π·(B/τ)·t_c²,  I = cos φ, Q = sin φ,  f_inst = (B/τ)·t_c

Chirp ascendente, amplitud unidad, sin ventana. Solo se usa para dibujar (`views/ScanViews.tsx ≈171-177`); la compresión de pulso no está modelada a nivel de señal (está implícita en la ecuación radar, §6.1, y en ΔR = c₀/2B, §12.2).

---

## 16. Océano 3D (Gerstner) y movimiento aplicado en la vista 3D

### 16.1 Olas de Gerstner — `views/ocean.ts:makeOcean` (vertex shader ≈105-128) y `setWaves (≈195-208)`

Componentes: `waveField(e, 10, 5)` (§8.4), ordenadas por amplitud y recortadas a `MAX_WAVES = 16`. Para la componente i con dirección de propagación α_i relativa a proa:

d_i = (−sen α_i, cos α_i)   (marco del buque: proa = +z, estribor = −x)

q = (x, z + U·t)   (el agua fluye hacia popa a la velocidad del buque; `uFlow = U·t`, `Radar3D.tsx ≈517`)

θ_i = k_i·(d_i · q) − ω_i·t + φ_i

Q_i = min(1, S/(k_i·a_i·N_w + 10⁻⁴)),  S = 0.25 + 0.45·min(1, U_viento/18)

a_i ← a_i·clamp(1.6 − r·k_i/140, 0, 1)   (atenúa las ondas cortas lejos, r = distancia horizontal al origen; antialiasing)

Desplazamiento: (x, z) += Q_i·a_i·d_i·cos θ_i,  y += a_i·sen θ_i

Normal: n = (−Σ d_x·k·a·cos θ, 1 − Σ Q·k·a·sen θ, −Σ d_z·k·a·cos θ) normalizada

Como Σ Q_i·k_i·a_i ≤ S < 1, no se forman bucles. En el casco, la frecuencia aparente es ω − k·U·cos α = ω_e (§9.2), coherente con el movimiento del buque. Malla polar de 6,5 km de radio con anillos densos cerca del buque (r ∝ (i/n)^{2,3}). Espuma, reflejos y niebla son puramente gráficos.

### 16.2 Movimiento aplicado al buque — `Radar3D.tsx` (bucle de render ≈509-514)

posición_y = francobordo + 0,85·arfada(t),  rotación = (−θ_p(t), 0, θ_r(t)) con orden YXZ

con θ_p, θ_r y la arfada de `attitudeAt(shipMotion(e), t)` (§9.3). El 0,85 de la arfada es un ajuste visual. El movimiento del buque usa una discretización distinta (24 + 10 componentes) de la del océano (10 + 5) y fases sen(ω_e·t + φ) no ligadas a las del agua: el buque no responde a la ola que se ve pasar (§18).

### 16.3 Estabilización del haz en la vista 3D — `Radar3D.tsx ≈524-545`

- Dirección mandada en el marco de la cara: (u₀, v₀, √(1 − u₀² − v₀²)) → cuaternión q_b que lleva +Y a esa dirección (`≈527-530`, y `≈667` fuera del escaneo).
- Sin estabilización: el haz va fijo a la cara: q_local = q_b.
- Con estabilización: con q_P la orientación del panel en el mundo y q_M = q_buque⁻¹,

  q_local = q_P⁻¹·q_M·q_P·q_b

  que conserva en el mundo la orientación que tendría el haz con el buque adrizado. **Estabilización perfecta** (sin el residuo de 3 % + 0,02° de §9.4).
- Las caras están inclinadas 12° hacia atrás (`TILT`), así que en 3D el haz a el = 0 respecto a la cara sale ≈ 12° por encima del horizonte, mientras que el motor lo trata como horizontal (§19).

---

## 17. Validación frente a MATLAB

Flujo: `matlab/validacion_web.m` ejecuta `matlab/fase1_sistema/val_antena.m`, `val_radar.m` y `matlab/fase2_entorno/val_entorno.m` (parámetros de `matlab/config/sistema_ref.m`, idénticos a `DEFAULT_*`), que escriben `web/src/validation/ref_antena.json`, `ref_radar.json` y `ref_entorno.json`. `web/src/validation/compare.ts` compara (lo usan `web/tests/validation.test.ts` y la pestaña Validación). Una comprobación pasa si |error| ≤ tolerancia; las marcadas *info* no cuentan como fallo. Estado según `05_plan_ejecucion.md`: 68 comprobaciones, 65 en tolerancia, 3 diferencias de método documentadas (las *info*), 0 fallos.

| Grupo | Qué se contrasta | Referencia MATLAB | Métrica de error | Tolerancia | `compare.ts` |
|---|---|---|---|---|---|
| Antena | Pesos Taylor 35 dB, n̄ = 5, 80 elementos | `taylorwin(80, 5, −35)` | máx \|Δw\| normalizado a máx 1 | 1·10⁻³ | ≈51 |
| Antena | Pesos Chebyshev 30 dB, 80 elementos | `chebwin(80, 30)` | máx \|Δw\| | 1·10⁻³ | ≈52 |
| Antena | 5 casos (uniforme, Taylor 35 broadside, Taylor az 30°, Chebyshev 30, Taylor el 20°), cara 80×80, desfasadores continuos, sin TTD, f₀ | `phased.URA` + `CosineAntennaElement [0,5 0,5]`, `pattern(…,'directivity')`, `directivity` | ganancia de pico web − directividad MATLAB | 0,6 dB (nota: directividad integrada frente a 4π·A_ef/λ²·cos θ) | ≈66 |
| Antena | ídem | ídem | lóbulo principal normalizado, ±2,5° alrededor del apuntamiento | 0,1 dB | ≈68 |
| Antena | ídem | ídem | lóbulos secundarios normalizados > −50 dB, \|ángulo\| < 85° | 1,0 dB | ≈69 |
| Radar | SNR, 4 casos × 5 distancias (10–400 km), N_p = 1 | `radareqsnr` (T_s = T₀·F) | máx \|ΔSNR\| | 0,01 dB | ≈87 |
| Detección | SNR requerida Swerling 1, P_fa 10⁻⁴/10⁻⁶/10⁻⁸, P_d 0,5–0,99 | `detectability(…,'Swerling1')` | máx \|Δ\| | 0,05 dB | ≈98 |
| Detección | SNR requerida Swerling 0 (Albersheim invertido por bisección) | `detectability(…,'Swerling0')` | máx \|Δ\| | 0,3 dB (nota: Albersheim ±0,2 dB) | ≈99 |
| Radar | Horizonte, h = 5–40 m, k = 4/3 | `horizonrange` | error relativo | 0,1 % | ≈106 |
| Entorno | ε' del agua de mar (20 °C, 35 ‰) | `earthSurfacePermittivity` (P.527) | error relativo | 5 % | ≈124 |
| Entorno | ε'' | ídem | error relativo | 10 % | ≈125 |
| Propagación | F, 6 casos (radar 20 m; blanco 7/300/1000 m; H/V; σ_h 0,01/0,3/1 m), antena isótropa, ε de MATLAB, a_e = 4/3·a, distancia oblicua → horizontal | dos rayos **exacto** en tierra esférica, punto de reflexión por Fermat (`dos_rayos_exacto` en `val_entorno.m`) | máx \|ΔF\| lineal | 0,05 (0,1 si h_t ≥ 1000 m) | ≈150 |
| Propagación | ídem | ídem | máx \|ΔF\| en dB donde F_ref > −10 dB | 0,5 dB (2 dB si h_t ≥ 1000 m: lóbulos densos, error de fase relativo ~10⁻³) | ≈151 |
| Propagación | Web frente a exacto en los casos de `radarpropfactor` (blanco 10 km; rozaolas 7 m) | dos rayos exacto | máx \|ΔF\| lineal | 0,05 (0,15 si h_t ≥ 1000 m) | ≈162 |
| Propagación (*info*) | `radarpropfactor` frente a exacto | — | máx \|ΔF\| lineal | 0,1, informativa (Blake usa Δ = 2h·sen θ_d y difracción cerca del horizonte) | ≈164 |
| Clutter | σ⁰ NRL, SS 0–6, H y V, rasante 0,1–30° | `seareflectivity(…,'NRL')` | máx \|Δ\| | 0,05 dB | ≈173 |
| Atenuación | Gases, 4 atmósferas | `gaspl` (P.676) | γ_o + γ_w web − MATLAB | 0,002 dB/km | ≈180 |
| Atenuación | Lluvia 1–50 mm/h, H y V | `rainpl` con trayecto de 1 m (P.838) | error relativo máx | 1 % | ≈184 |
| Refracción | N_s en atmósfera estándar (15 °C, 1013,25 hPa, HR 58,5 %) | `refractiveidx(0)` | ΔN | 5 unidades N | ≈189 |
| Refracción (*info*) | factor k, N_s = 280–380 | `effearthradius` (trayecto de 50 km) | error relativo | 10 %, informativa (gradiente del primer km frente a radio promediado en el trayecto) | ≈191 |

**Lo que no se valida contra MATLAB:** cuantización de fase, TTD y squint, fallos, mapa u-v por FFT (solo un test interno contra `gainAt`), métricas HPBW/SLL (solo tests internos), movimiento del buque y pérdida de apuntamiento, conducto, clutter de lluvia, área de la celda de clutter, cancelación, patrón desplazado del escaneo (test interno contra `gainAt`), pérdida atmosférica integrada y la cadena SINR completa.

---

## 18. Supuestos y limitaciones conocidas

**Antena**
1. ~~Sin acoplamiento mutuo~~ *Actualizado: acoplamiento mutuo opcional (§22).* Por defecto, patrón de elemento cos θ idéntico para todos (sin efectos de borde).
2. Ganancia por 4π·d²/λ²·|AF|²/Σ|w|²·cos θ: aproximada si hay grating lobes; sin pérdidas óhmicas ni de desadaptación.
3. *Actualizado: errores aleatorios por elemento y subarray, dither y error del TTD implementados (A1–A3).* Sin atenuadores cuantizados.
4. Transmisión siempre uniforme; el multitrayecto y el clutter usan el patrón de recepción para ida y vuelta.
5. Cara vertical en el motor (la inclinación de 12° solo aparece en la vista 3D).
6. El diagrama del escaneo supone desfasadores ideales (patrón desplazado en espacio seno, sin cuantización ni squint).

**Radar y detección**
7. Integración coherente ideal de N_p pulsos, sin pérdida de integración; T_sis = T₀·F.
8. Swerling 1 para toda la cadena con entorno; Swerling 0 por Albersheim aproximado (±0,2 dB, usado fuera de su rango en P_d ≥ 0,95).
9. Clutter tratado como ruido (SINR = S/(N + C)). *Actualizado (§24):* la estadística K del mar entra como pérdida del CFAR. Sin jammer; la compresión de pulso y el CFAR están en la cadena de señal de MATLAB, no en la web.

**Propagación**
10. *Actualizado (§23):* la ecuación parabólica cubre la región intermedia y la de difracción por debajo de 1 km. Por encima, sigue el dos rayos (F salta a 0 en el horizonte geométrico).
11. *Actualizado (§23):* el conducto de evaporación entra en F y en la cobertura con el perfil de Paulus-Jeske. Sin conductos elevados ni perfiles M medidos.
12. Rugosidad de Ament sin componente difusa; permitividad del mar fija a 20 °C y 35 ‰.
13. Patrón desplazado rígidamente en grados; el modo envolvente supone un haz exactamente sobre el blanco en cada distancia.
14. Atenuación de gases simplificada (sin el continuo de vapor por encima de 325 GHz); atmósfera exponencial sobre tierra plana.

**Clutter**
15. **Lluvia uniforme en un cilindro de 25 km de radio y 3 km de altura** centrado en el buque, sin patrón ni atenuación propia.
16. **Cancelación de clutter como un único número en dB** (lluvia: 15 dB menos), sin espectro Doppler ni efecto sobre el blanco.
17. Celda de mar siempre limitada por el pulso; zona de interferencia (ψ/ψ_c)⁴ empírica; NRL limitado a SS ≤ 6 (por encima se satura).

**Mar y buque**
18. PM desarrollado con U a 10 m; dispersión direccional uniforme aleatoria; oleaje determinista (semillas fijas).
19. RAO de un grado de libertad con constantes ad hoc (0,8 y tope de 0,6 rad en balance, ζ = 0,35 en cabeceo, desfases 1,1 y 0,4 rad, arfada sin dinámica); sin guiñada ni acoplamientos.
20. Residuo de estabilización supuesto (3 % + 0,02°); error de apuntamiento solo en elevación; balance y cabeceo incorrelados.
21. En la vista 3D el movimiento del buque no está en fase con las olas dibujadas y la estabilización del haz es perfecta.

---

## 19. Incoherencias y posibles errores detectados

Ordenadas por impacto estimado. **Estado a 2026-10-15**: corregidas las 1, 2, 3, 8, 9 y 12 (se indica en cada una); el resto siguen abiertas o son supuestos aceptados.

1. ✅ *Corregida (groundRange/slantRange).* **Distancia oblicua usada como horizontal en el dos rayos** — `engine/environment.ts:evalPoint ≈587`. Se llama `twoRayGeometry(L.hRadar, hT, R, c.ae)` con R = distancia oblicua (la misma que entra en K/R⁴), pero la geometría trata `d` como distancia sobre la superficie: horizonte, d₁/d₂, θ_d = atan2(h₂ − h₁, d) y Δ. La validación sí convierte (`compare.ts:groundRange ≈113`) y por eso no lo detecta. A baja elevación el efecto es despreciable; para blancos altos y cercanos no (h_t = 5 km a R = 10 km: d ≈ 8,7 km frente a 10 km, θ_d ≈ 26,6° frente a ≈ 30°).
2. ✅ *Corregida en la web y en MATLAB.* **Factor 1,33 de "pérdida de forma del haz" multiplicando el área** — `environment.ts:clutterTerms ≈538`. Con la definición habitual (anchura efectiva ≈ θ₃/1,33 para un haz gaussiano de ida y vuelta) debería dividir: tal como está, el clutter de mar sale ≈ 2,5 dB más alto.
3. ✅ *Corregida: tabla de gaspl (error < 2 %).* **Pseudo-continuo de vapor de agua omitido** — `environment.ts:gasAttenDbKm ≈270-272`. Faltan las líneas de P.676 (anexo 2) por encima de 325 GHz, sobre todo el término de 1780 GHz, que a 3,3 GHz domina: γ_w sale ≈ 3 veces por debajo (≈ 2·10⁻⁴ frente a ≈ 6·10⁻⁴ dB/km con el entorno por defecto). El impacto es pequeño (< 0,2 dB de ida y vuelta a 200 km rasantes) y queda dentro de la tolerancia de 0,002 dB/km frente a `gaspl`, pero la fórmula está incompleta.
4. **Constante de Kerr del conducto** — `environment.ts:evapDuct ≈253`. λ_max = 0,0144·δ^{1,5} da para el entorno por defecto (δ ≈ 15,8 m) f_min ≈ 330 MHz. Otras referencias (p. ej. Turton et al.) dan λ_max ≈ 3,77·10⁻³·δ^{1,5} (f_min ≈ 1,3 GHz para el mismo δ). Conviene verificar la fuente. Es solo informativo (no entra en la cadena).
5. **Acimut local de la cara usado como acimut relativo a proa** — `scenarios.ts:evaluate ≈86` (`a.beamAzDeg = beam.azDeg`) y `views/EnvironmentTab.tsx ≈55`. `pointingErrorRmsDeg` espera el acimut respecto a proa; `beam.azDeg` es respecto a la normal de la cara. Solo es correcto para la cara de proa (FACE_AZ = 0).
6. **Signo del balance en el error de apuntamiento** — comentario de `environment.ts:pointingErrorRmsDeg ≈192` y serie temporal en `views/EnvironmentTab.tsx ≈113` (`err = pitch·cos az + roll·sin az`). Con + = babor arriba y az horario desde proa (estribor = 90°), un balance positivo baja el haz de estribor: debería ser θ_p·cos az − θ_r·sen az. El valor eficaz (`hypot`) no cambia; solo el signo de la curva dibujada.
7. **Inclinación de las caras incoherente** — `views/Radar3D.tsx:TILT ≈36, ≈220` y `matlab/config/sistema_ref.m` (`tiltDeg = 12`) frente al motor, que trata la elevación respecto a la cara como elevación sobre el horizonte (`patternFromCut`, `elevationCut`, escaneo). En 3D el haz a el = 0 sale 12° hacia arriba; en los cálculos, horizontal.
8. ✅ *Corregida en scenarios.ts y EnvironmentTab.tsx.* **Cobertura continua con la primera muestra fallida** — `scenarios.ts:evaluate ≈106-111` (duplicado en `views/EnvironmentTab.tsx ≈91-96`). Si sinr[0] < req, la condición `i > 0` hace que en la siguiente muestra fallida se asigne R_cont = R[i−1], aunque la cobertura no empezara en R[0]. Ejemplo: [no, sí, no, …] → R_cont = R[1]. Debería ser 0 si la primera muestra no detecta.
9. ✅ *Corregida: se satura en SS = 6 dentro de seaSigma0Db.* **Estado de la mar fuera del rango del modelo NRL** — `environment.ts:envContext ≈570` (`ss: douglas(hs)`, hasta 9) → `seaSigma0Db`. NRL está ajustado para SS 0–6; no se limita.
10. **Patrón de recepción para ida y vuelta** — `evalPoint ≈593-595` y `clutterToNoise ≈560`: F⁴ y f(−ψ)⁴ usan el corte de recepción (taper), mientras que K usa G_t con pesos uniformes. Es una aproximación, no un error, pero no es coherente: el lóbulo principal de transmisión es más estrecho y sus lóbulos secundarios más altos.
11. **Horizonte con k distinto según la pestaña** — `views/RadarTab.tsx ≈25` (k = 4/3) frente a Entorno y escenarios (k CRPL ≈ 1,44 con el entorno por defecto). Es intencionado, pero los alcances no coinciden entre pestañas.
12. ✅ *Corregida: umbrales de la OMM.* **Beaufort** — `environment.ts:beaufort ≈81`: el umbral de la fuerza 1 es 0,5 m/s (OMM: 0,3 m/s). Solo informativo.
13. **P.453 antigua** — `environment.ts:satVapor ≈212` usa la fórmula de e_s de las versiones antiguas (a = 6,1121, b = 17,502, c = 240,97), no la de P.453-14 (con EF y b = 18,678, c = 257,14, d = 234,5). La diferencia es pequeña y la validación de N_s pasa (tolerancia 5 N).
14. **Arfada sin RAO** y **tope de balance por componente** — `environment.ts:shipMotion ≈167-169`: `min(0,6, …)` se aplica a cada componente y no al total. Con mar muy gruesa la suma puede superar 0,6 rad, y la arfada no tiene resonancia. Son coherentes con un modelo ad hoc, pero conviene saberlo al interpretar barridos extremos.

## 20. Cadena a nivel de señal (P2, MATLAB) — `matlab/lib/radar/*.m`, `matlab/fase3_linea_base/mc_pd_s2.m`

### 20.1 Forma de onda
Chirp LFM con `phased.LinearFMWaveform`: τ = 20 µs, B = 5 MHz, f_s = 2B, PRF 2,5 kHz, 16 pulsos por CPI. Pulso muestreado normalizado a energía unidad (Σ|s|² = 1). Resolución c/(2B) = 30 m, alcance no ambiguo c/(2·PRF) = 60 km, zona ciega c·τ/2 = 3 km, ganancia de compresión B·τ = 100 (20 dB).

### 20.2 Presupuesto por pulso — `presupuesto_s2.m`
- Ganancias: G_t = 10·log10(4π·N·d²/λ²) (uniforme); G_r = G_t + 10·log10(η_T), η_T = [(Σw)²/(N_x·Σw²)]² (Taylor separable).
- θ₃ en acimut: numérica a −3 dB del factor de array con el taper.
- SNR₁ = radareqsnr(λ, R, P_t, τ, G_t, G_r, σ, T_s = T₀·F, L) + 40·log10 F − L_atm, con F del dos rayos exacto (§13) y L_atm = 2·gaspl.
- CNR por celda: el mismo modelo que la web (§12): A = R·(θ₃/1,33)·ΔR/cos ψ, σ⁰ de `seareflectivity` (NRL), caída (ψ/ψ_c)⁴.

### 20.3 Simulación del CPI — `sim_cpi.m`
Datos antes del filtro adaptado, ruido blanco complejo de potencia 1 por muestra.
- **Blanco**: a·s(t − τ_b)·e^{j2π·f_d·p·T}; Swerling 1: a ~ CN(0, SNR₁) constante en el CPI; retardo fraccionario aplicado en frecuencia.
- **Clutter**: dispersores independientes en rango, convolucionados con el pulso; potencia por dispersor CNR/Σ|χ_k|² (χ = autocorrelación del pulso), de modo que tras comprimir la CNR por muestra es la del presupuesto. Correlación entre pulsos gaussiana ρ(m) = exp(−2π²σ_f²m²T²) (factor de Cholesky), σ_f = 2σ_v/λ, σ_v = 0,12·U **[supuesto del modelo]**, Doppler medio 0.

### 20.4 Procesado — `proc_cpi.m`
Filtro adaptado h = s*(−t) (energía unidad: el ruido sale con potencia 1 y el blanco con |a|²), FFT Doppler con ventana w (rectangular en A; Chebyshev 50 dB en B), potencia |·|².
- Umbral ideal: T = −ln(P_fa)·Σ|w|² (ruido de potencia conocida, ley cuadrática).
- CA-CFAR 2D (`phased.CFARDetector2D`): entrenamiento [10 1], guarda [2 1] → 110 celdas de referencia; P_fa = 10⁻⁶. El mapa se desplaza circularmente en Doppler para centrar la celda del blanco (el Doppler es periódico).
- Detección: cualquiera de las 6 celdas vecinas a la posición verdadera (2 en rango × 3 en Doppler).

### 20.5 Estadística
- Pd teórica (Swerling 1, integración coherente): P_d = P_fa^{1/(1 + N·SNR₁)}.
- IC95 % de proporciones: Wilson (`binom_ci95.m`).
- Pérdida de procesado equivalente: L que minimiza Σ[P_d,MC − P_fa^{1/(1+SNR·10^{−L/10})}]² sobre los puntos con 0,02 < P_d < 0,98 (`ajusta_perdida`).
- Pérdida coherente de la ventana: −10·log10[(Σw)²/(N·Σw²)] = 1,6 dB (Chebyshev 50 dB, N = 16).

### 20.6 Resultados (2026-10-15)
- A: teoría dentro del IC95 % en 15/15 puntos; P_fa medida 1,14·10⁻⁶ (IC95 % 0,92–1,41·10⁻⁶) en 72 millones de celdas.
- B2: pérdida de procesado ≈ 2,5 dB sin clutter (ventana + straddle + CFAR); 4,0 dB con CNR ≈ 8 dB y 5,9 dB con CNR ≈ 27 dB. La cancelación única de 35 dB del modelo analítico (§12) es optimista con clutter fuerte.

## 21. Errores de hardware de la cara (A1–A3) — `web/src/engine/errors.ts`, `array.ts:computeWeights`

### 21.1 Modelo compuesto
Para el elemento n del subarray s:

w_n = a_n · g_n · G_s · exp(j·[Q_B(φ_n + r_n) − r_n + δφ_n + δφ_s − 2π·f·τe_s])

| Símbolo | Significado | Distribución |
|---|---|---|
| g_n, G_s | ganancia por elemento y por subarray | log-normal: 20·log10 g ~ N(0, σ_a,dB²) |
| δφ_n, δφ_s | fase por elemento y por subarray | N(0, σ_φ²) |
| τe_s | error de retardo del TTD del subarray | N(0, σ_τ²); a la frecuencia f equivale a una fase 2π·f·τe |
| r_n | fase aleatoria conocida (dither) antes del cuantizador de B bits | U[0, 2π) |

Misma realización en transmisión y recepción (son los mismos T/R). Semilla determinista (mulberry32 + Box-Muller); las normales se guardan, así que cambiar σ escala el error sin cambiar su forma.

### 21.2 Predicciones (exactas en momentos)
Momentos del factor ε = g·e^{jδφ}: μ = E[ε] = e^{s²/2}·e^{−σ_φ²/2}, m₂ = E|ε|² = e^{2s²}, con s = σ_a,dB·ln10/20. Con dither de B bits el error de cuantización es uniforme e independiente: μ se multiplica por sinc(2^{−B}) = sin(π/2^B)/(π/2^B).

- Ganancia en la dirección mandada (recepción):
  E|F(u₀)|² = μe²μs²(Σa)² + μe²(m₂s − μs²)·Σ_s(Σ_{n∈s} a_n)² + (m₂e − μe²)·m₂s·Σa²
  G/G₀ = E|F(u₀)|² / (m₂e·m₂s·(Σa)²)   → para σ pequeños ≈ 1/(1 + σ_a² + σ_φ²) (Ruze/Hansen)
- Fondo residual en (u, v), relativo al pico ideal:
  [(m₂e − μe²)·m₂s·Σa² + μe²(m₂s − μs²)·Σ_s|SA_s(u, v)|²] / (Σa)²
  El término de elemento es plano (≈ σ²/(η·N)); el de subarray sigue el diagrama de subarray: su media en u coincide con la del de elemento, pero junto al haz es mayor en la proporción Σ_s(Σ_{n∈s}a_n)²/Σa², del orden del número de elementos por subarray (×64 → +18 dB con uniforme). `floorSubPeakDb` da ese valor.
- Apuntamiento (linealizado, solo errores de fase): Δu = −Σ a_n x_n δφ_n / (k·Σ a_n x_n²)
  σ_u,elem = σ_φ·√(Σa²x²)/(k·Σa x²) · σ_u,sub = σ_φs·√(Σ_s(Σ_{n∈s} a_n x_n)²)/(k·Σa x²)

### 21.3 Validación (Monte Carlo, `web/tests/errors.test.ts`)
400 realizaciones, cara 80×80 con Taylor 35 dB apuntada a 20°:

| Caso | ΔG MC / teoría | fondo medio | σ_u MC / teoría |
|---|---|---|---|
| elemento 0,5 dB / 5° | 0,047 / 0,047 dB | −0,08 dB | 1,95 / 1,93 ·10⁻⁵ |
| elemento 1 dB / 10° | 0,189 / 0,190 dB | −0,07 dB | 3,92 / 3,86 ·10⁻⁵ |
| subarray 0,5 dB / 5° | 0,046 / 0,047 dB | −0,21 dB | 1,52 / 1,52 ·10⁻⁴ |
| TTD 5 ps + elemento 5° | 0,079 / 0,079 dB | −0,05 dB | 1,83 / 1,82 ·10⁻⁴ |
| dither, 3 bits | 0,224 / 0,224 dB | −49,2 / −49,2 dB | — |

Observación: con el mismo σ de fase, los errores por subarray desapuntan ≈ 8 veces más que los de elemento.

## 22. Acoplamiento mutuo (A5) — `web/src/engine/coupling.ts`

### 22.1 Elemento
Dipolo horizontal (eje x) de L = 0,45λ, tira de λ/100 (radio equivalente a = λ/400), a h = λ/4 sobre un plano de masa infinito (teoría de imágenes: dipolo imagen a −h con corriente opuesta). Con L = λ/2 los extremos de los vecinos colineales se tocarían a d = λ/2. **[supuesto del modelo]**

Diagrama de potencia del elemento aislado, normalizado a broadside (u: coseno con el eje del dipolo):
P_elem(u, v) = { [cos(kL/2·u) − cos(kL/2)] / [√(1 − u²)·(1 − cos(kL/2))] }² · [sin(kh·cos θ)/sin(kh)]²

### 22.2 Impedancias mutuas (FEM inducida, corriente sinusoidal) — `mutualZ`
Campo del dipolo 1 a lo largo del eje (I₀ = 1): E_x = −j·η/(4π)·[e^{−jkR₁}/R₁ + e^{−jkR₂}/R₂ − 2cos(kL/2)·e^{−jkR₀}/R₀]
Z₂₁ = −(1/I(0)²)·∫ E_x1(x)·I₂(x) dx, con I₂ = sin(k(L/2 − |x|)) e I(0) = sin(kL/2); Gauss-Legendre de 32 puntos por mitad. Propia: ρ = a. Con masa: Z_ef(Δ) = Z(Δ, 0) − Z(Δ, 2h).
Validación: dipolos λ/2 → Z₁₁ = 73,1 + j40,6 Ω (a = λ/200), lado a lado λ/2 −12,5 − j29,9 Ω, a λ 4,0 + j17,7 Ω (Balanis, cap. 8).

### 22.3 Z activa, corrientes y Γ — `activeImpedance`, `applyCoupling`
Z_a,n = Σ_m Z(Δ_nm)·w_m / w_n (convolución 2D por FFT, el núcleo es invariante a la traslación).
Adaptación: T/R con impedancia interna Z_s = Z_ref*, con Z_ref = Z activa del centro con excitación uniforme a broadside. Calibración opcional por elemento (cada uno a su Z activa a broadside).
Corriente: I_n = w_n·(Z_s + Z_ref)/(Z_s + Z_a,n) (aproximación de impedancia activa de primer orden). Γ_n = (Z_a,n − Z_ref)/(Z_a,n + Z_s).
Ganancia realizada: el diagrama se calcula con las corrientes I y el elemento real (corrección 10·log[P_elem/cos θ]) y se normaliza por la potencia disponible Σ|w|² (`powerRatioDb` = 10·log Σ|I|²/Σ|w|²).

### 22.4 Validación (`web/tests/coupling.test.ts`, pestaña Validación)
- Coherencia energética (Hannan): R_a(θ)/R_a(0) = P_elem(θ)/cos θ en los planos E y H hasta 60°: error < 0,5 %.
- Ganancia de barrido realizada ≈ cos θ·(1 − |Γ|²): ±0,35 dB (el borde del array finito se aparta del centro).
- |Γ| activo con el núcleo de MoM de Antenna Toolbox (conformalArray de 21×21 dipolos más sus imágenes, 882 puertos, 31 min; `matlab/fase1_sistema/nucleo_acoplamiento.m`): diferencia ≤ 0,004 (plano E) y ≤ 0,007 (plano H) hasta 70°.
- Z par a par FEM inducida frente a MoM (array 3×3): 16–35 % (informativo; el MoM no es coherente con el diagrama aislado y no se usa en el motor).
- Resultado: |Γ| activo del centro ≈ 0,15 a 30° y 0,69 (E) / 0,57 (H) a 60° con adaptación a broadside.

### 22.5 Limitaciones
- Primer orden: la distribución de corrientes sigue a la excitación (sin resolver el sistema acoplado completo).
- Elementos caídos: corriente nula; sin modelar su terminación.
- Plano de masa infinito; sin difracción en el borde de la cara; sin ceguera de barrido por ondas de superficie (no hay sustrato).
- Coeficientes calculados a f₀ (no a la frecuencia instantánea).


## 23. Ecuación parabólica: difracción y conducto de evaporación — `web/src/engine/pe.ts`, `matlab/lib/propagacion/pe_ssf.m`

### 23.1 Modelo
Propagación troposférica 2D (distancia x, altura z) con tierra plana equivalente e índice de refracción modificado m(z) = 1 + M(z)·10⁻⁶ (Levy, *Parabolic equation methods for electromagnetic wave propagation*, IEE 2000).
Paso de split-step Fourier con propagador de ángulo ancho (Feit-Fleck):
u(x+Δx, z) = e^{j·k·Δx·(m(z)−1)} · T⁻¹{ e^{j·Δx·(√(k²−p²) − k)} · T{u(x, ·)} }
T = transformada seno: superficie lisa conductora con polarización H (Γ = −1). Capa absorbente de Hann por encima de z_max (dominio 1,5·z_max).
Fuente: espectro angular del diagrama f(θ)·e^{−jp·h} y su imagen. Normalización por fase estacionaria: F = |u|·√x / √(k/2π) (diagrama por factor de propagación, un sentido).

### 23.2 Perfiles de refractividad (`perfil_m.m`, `pe.ts:modRefractivity`)
- Estándar: M(z) = z/(k·Re)·10⁶ (0,118 M/m con k = 4/3; en la web k sale de la refractividad local).
- Conducto de evaporación de Paulus-Jeske: M(z) = s·z − 0,125·δ·ln((z + z₀)/z₀), z₀ = 1,5·10⁻⁴ m, δ = altura del conducto (§10). **[supuesto]** En MATLAB la pendiente es 0,125 (estabilidad neutra); en la web, s = 1/(k·Re) para que sin conducto coincida con la atmósfera estándar local.

### 23.3 Uso en la cadena (`environment.ts:evalPoint`)
Híbrido, como los modelos profesionales (APM): el dos rayos con rugosidad (§13) en la zona de interferencia y la PE cerca y más allá del horizonte. Peso de la PE w = clamp((d/d_H − 0,6)/0,3, 0, 1), con d_H = √(2·a_e·h_r) + √(2·a_e·h_t); F = (1−w)·F_2r + w·F_PE·f(θ_d)/f_PE(θ_d). Malla web: 400 km × 1 km, Δx = 500 m, 4096 puntos en altura (θ_max ≈ 7°), en caché por (k, δ) redondeados; unos 0,5 s por malla. Por encima de 1 km, solo dos rayos.

### 23.4 Validación (`matlab/fase2_entorno/val_pe.m`, `web/tests/pe.test.ts`)
| Comprobación | Resultado |
|---|---|
| Dos rayos exacto, conductor perfecto, h = 100 m, 4–30 km | 0,49 dB fuera de nulos (0,03 dB con fuente ancha) |
| ITU-R P.526, tierra esférica lisa, h = 20 m, sombra | 0,67 dB con F > −85 dB |
| Convergencia (Δx 100→50 m, n_z ×2) | 0,025 dB |
| Reciprocidad dentro de un conducto de 15 m (20 m ↔ 7 m) | < 0,01 dB |
| Web frente a MATLAB (8 puntos, con y sin conducto) | < 0,3 dB |
Efecto: con δ = 15 m, a 100 km y 7 m de altura, F pasa de −112 dB (sombra) a −30 dB.

### 23.5 Mar real y capa de inversión (2026-10-15)
- **Superficie con Γ(ψ)** (`pe_ssf.m`, opción `gamma`; `pe.ts`, campo `gamma`): método de la imagen espectral. En cada paso el campo real (z ≥ 0) se transforma en el dominio completo y la imagen en z < 0 es U_img(p) = Γ(asin|p|/k)·U_real(−p): cada componente que baja vuelve a subir con el Γ de su ángulo. Γ = Fresnel (H o V, permitividad de Debye) × rugosidad de Ament con σh = Hs/4. Con Γ = −1 reproduce la transformada seno (diferencia 0,000 dB). Cuesta cuatro FFT por paso en lugar de dos; la web usa dx = 1000 m (frente a 250 m: < 0,5 dB, `tests/pe.test.ts`) y tarda ~2 s por malla, en caché.
- **Capa de inversión trilineal** (`perfil_m('trilineal')`, `modRefractivity(…, layer)`): base zb, espesor t y caída ΔM; si M en la cima queda por debajo de M en la superficie, el conducto llega al mar.
- **Validación frente al dos rayos exacto** (h = 100 m, 4–30 km, fuera de nulos): mar liso H 0,48 dB; V 3,9 dB máx. / 0,85 dB eficaz; rugoso (σh = 0,5 m) H 2,8 / 0,55 dB, V 3,1 / 0,78 dB. Los errores grandes están en las franjas rápidas de 4–10 km (periodo ≈ 360 m, cerca del paso de la comparación), donde la web usa el dos rayos; más allá de 12 km: 0,5 / 0,7 dB liso y 2,8 dB máx. (0,5 eficaz) rugoso. La web coincide con MATLAB (< 0,3 dB) en V, rugoso y con capa.
- **Efecto**: capa [150 m, 50 m, ΔM = 40] → F = −3 dB a 100 km y 50 m (−82 dB sin capa); la rugosidad (σh = 0,5 m) lo baja a −4,6 dB. En el conducto de evaporación de 15 m la rugosidad resta 0,7 dB a 100 km y 7 m.

### 23.6 Limitaciones
- La rugosidad es la de Ament sobre cada componente espectral (sin sombreado de olas ni Miller-Brown); la referencia de dos rayos usa la misma hipótesis, así que la validación no la contrasta con otra teoría.
- Suelo numérico ≈ −90 dB (reflexiones residuales de la capa absorbente); irrelevante para el radar (−180 dB de ida y vuelta).
- Perfil horizontalmente homogéneo (sin variación con la distancia).
- La altura del conducto sale de un modelo simplificado (§10, incoherencia 4 sobre la constante de Kerr).
- En la web, solo hasta 1 km de altura; la fuente es un haz gaussiano de 4° y el diagrama real se aplica en la dirección directa.

## 24. Clutter de mar K-distribuido — `environment.ts:shapeK, kLossDb`, `matlab/fase3_linea_base/mc_clutter_k.m`

### 24.1 Modelo (gaussiano compuesto)
Intensidad del clutter en una celda: I = τ·|g|², con speckle g complejo gaussiano (decorrela entre pulsos con el espectro Doppler del mar) y textura τ ~ Gamma(ν, 1/ν) de media 1, constante en el CPI (decorrela en segundos) y correlada en distancia en bloques de 60 m (escala del mar de fondo) **[supuesto]**. La intensidad resuelta sigue la distribución K:
P(I > t) = 2/Γ(ν)·(ν·t/μ)^{ν/2}·K_ν(2·√(ν·t/μ)),  E[I²]/E[I]² = 2·(1 + 1/ν).
Generador en `lib/radar/sim_cpi.m` (campo `clut.nu`) y `textura_gamma.m` (Marsaglia-Tsang, sin Statistics Toolbox).

### 24.2 Forma ν (Ward, Tough y Watts, *Sea Clutter*, IET 2006)
log10 ν = (2/3)·log10 ψ° + (5/8)·log10 A_c − k_pol − cos(2·θ_sw)/3, k_pol = 1,39 (VV) o 2,09 (HH); ψ en [0,1°, 10°], ν limitado a [0,1, 50]. En la web θ_sw = 45° **[supuesto]** y A_c = R·(θ₃/1,33)·ΔR/cos ψ (la misma celda que σ⁰).

### 24.3 Pérdida de detección
Monte Carlo con 3·10⁷ celdas por caso (generador rápido de la celda de Doppler cero, contrastado con la cadena completa): CA-CFAR en distancia (20 celdas, 2 de guarda), umbral ajustado para Pfa = 10⁻⁶ en clutter K, blanco Swerling 1. Pérdida = SNR extra para Pd = 0,9 frente a clutter gaussiano (`clutter_k_tabla.json`):

| ν | 3 | 1 | 0,5 | 0,3 |
|---|---|---|---|---|
| CNR 10 dB | 2,7 dB | 5,0 dB | 7,6 dB | 9,1 dB |
| CNR 20 dB | 3,2 dB | 6,3 dB | 8,8 dB | 10,6 dB |
| CNR 30 dB | 2,9 dB | 6,4 dB | 9,1 dB | 11,0 dB |

Con el umbral gaussiano (sin ajustar) la Pfa real sube a 1·10⁻⁴ (ν = 3) – 1·10⁻² (ν = 0,3).
En la web: interpolación lineal en 1/ν y en la CNR residual del mar; por debajo de 10 dB se escala con c/(1+c). SINR efectiva = SINR − pérdida.

### 24.4 Validación
- Generador: CCDF de la intensidad frente a la K analítica (t = 10: 1,5·10⁻² frente a 1,6·10⁻² con ν = 0,3; 4,1·10⁻⁴ frente a 3,5·10⁻⁴ con ν = 10). El segundo momento sale algo por debajo de la teoría con ν pequeño (7,6 frente a 8,7 con ν = 0,3) por la mezcla de bloques vecinos en la compresión.
- Generador rápido frente a la cadena completa: CCDF del cociente celda/entrenamiento 0,12 / 0,048 / 0,021 frente a 0,12 / 0,05 / 0,022.
- Web: forma ν idéntica a `forma_k.m`, tabla reproducida en sus nodos (`tests/clutter_k.test.ts`).

### 24.5 Hallazgo: borde de la cresta de clutter con CA-CFAR 2D
Con el CA-CFAR 2D de P2 (entrenamiento [10 1], guarda [2 1]), en la celda de Doppler cero la Pfa real es 3·10⁻² aun con clutter gaussiano (CNR 20 dB): las celdas de entrenamiento de las columnas Doppler vecinas son solo ruido y bajan el umbral. Fuera de la cresta, 4·10⁻⁶. Con ν = 0,5 las columnas vecinas suben a 4·10⁻³. Sobre la cresta conviene CFAR solo en distancia o un mapa de clutter.

### 24.6 Limitaciones
- Textura en bloques fijos (sin correlación espacial suave ni estructura de olas); ν de un ajuste empírico con dispersión grande en la literatura.
- Sin espigas discretas por rotura de olas además de la textura K (modelo K + ruido, sin componente de espigas «discretas»).
- La pérdida se calcula para el CA-CFAR y Swerling 1; otros CFAR (OS, GO) o blancos dan otras cifras.

## 25. Techo de la cancelación de clutter: ventana, oscilador y transmisor — `web/src/engine/mtd.ts`, `matlab/lib/radar/fuga_clutter.m`

Sustituye la cancelación fija (`cancelDb`, 35 dB) por la que resulta del procesado y del hardware.

### 25.1 Fuga a las celdas Doppler
MTD de Np pulsos con ventana w (Chebyshev, Σw² = 1, de modo que el ruido sale con potencia 1): Y_k = Σ_m w_m·x_m·e^{−j2πkm/Np}, k = −Np/2…Np/2−1. Con clutter de potencia 1 por pulso, la fuga a la celda k es E|Y_k|², suma de tres términos independientes:

- **Dispersión del clutter** (espectro gaussiano σ_f centrado en f_c): E|Y_k|² = Σ_d c(d)·ρ(d)·e^{j2π(f_c − f_k)dT}, c(d) = Σ_m w_m·w_{m+d}, ρ(d) = exp(−2π²σ_f²d²T²). Incluye los lóbulos secundarios de la ventana.
- **Ruido de fase del oscilador** (común a transmisión y recepción): el clutter a distancia R ve Δφ(t) = φ(t − τ) − φ(t), τ = 2R/c, de densidad S_Δφ(f) = L(|f|)·4·sin²(πfτ). Con clutter homogéneo en distancia, la compresión de un chirp de ancho B deja pasar el desplazamiento f con peso (1 − |f|/B) (autocorrelación del espectro rectangular):
  fuga_k = ∫ L(|f|)·4sin²(πfτ)·(1 − |f|/B)·|W(f − f_k)|² df,  W(f) = Σ_m w_m·e^{−j2πfmT}.
  Numérica: exacta con |W|² en |f| < 16·PRF (paso PRF/(32·Np); la web pliega el espectro en un periodo de la PRF antes de correlar); fuera, |W|² se sustituye por su media Σw² = 1 y se integra por trapecios con paso min(250 Hz, 1/(16τ)). Frente a la integral completa hasta B: 0,001 dB.
- **Inestabilidad del transmisor** (fase blanca pulso a pulso, σ eficaz): fuga = σ²·Σw² = σ².

### 25.2 Cancelación equivalente para la web
La web integra Np pulsos sin ventana (la pérdida de la ventana va en `lossDb`), así que C = −media_k 10·log10(fuga_k/Np) en las celdas útiles |k| ≥ 2 (fuera de la muesca de clutter; media en dB = blanco con Doppler uniforme). Tabla en 48 distancias de 100 m a 60 km (más allá no hay clutter: horizonte del mar < 30 km, chubasco de 25 km), interpolada en log R y en caché por parámetros (~70 ms la primera vez).

| Entrada | Valor por defecto | Origen |
|---|---|---|
| Oscilador L(f) en 100 Hz/1/10/100 kHz/1 MHz | típico: −85/−110/−125/−135/−145 dBc/Hz; bueno y pobre unos 15 dB por encima y por debajo | **[supuesto]** órdenes de magnitud de sintetizadores en banda S; −30 dB/déc por debajo de 100 Hz, plano por encima de 1 MHz |
| Inestabilidad del transmisor | 0,2° eficaces | **[supuesto]** |
| Ventana Doppler | Chebyshev 50 dB | la de la cadena de P2 |
| PRF, Np | 2,5 kHz; Np de `nPulses` (par, ≥ 4) | forma de onda de P2 |
| Mar | σ_v = 0,12·U, centrado en Doppler cero | el de P2; **[supuesto]** el MTD centra la muesca en el mar |
| Lluvia | σ_v² = (0,42·k_s·R·θ_el)² + 1 m²/s², k_s = 4 (m/s)/km; velocidad media U/√2 | cizalladura y turbulencia según Nathanson; **[supuesto]** la lluvia va con el viento (media cuadrática sobre el acimut) |

### 25.3 Validación (`matlab/fase3_linea_base/mc_ruido_fase.m`, `web/tests/mtd.test.ts`)
- Generador de fase (`fase_osc.m`, síntesis en frecuencia): periodograma frente a L(f) en 1 k/10 k/100 k/1 MHz: −0,7 / −0,09 / 0,01 / 0,0002 dB.
- **Cadena I/Q completa** (`sim_cpi.m` con `P.pn`: el pulso sale con e^{jφ(t)} y se demodula con e^{−jφ(t)}; compresión y MTD de `proc_cpi.m`), solo ruido de fase (oscilador pobre, clutter quieto, ventana rectangular): fuga media medida frente al modelo a 1,5 / 3 / 15 / 45 km: −55,4/−55,0, −53,9/−53,7, −50,5/−50,5, −47,9/−47,8 dB; error máximo por celda 0,75 dB.
- Cadena completa con todo (Chebyshev 50 dB, mar a 9 m/s, oscilador, 0,5° de inestabilidad), 15 km: error máximo por celda útil 0,52 dB (típico) y 0,58 dB (pobre); cancelación medida 48,5 / 48,4 dB frente a 48,5 / 48,2 del modelo.
- Web: fuga por celda y cancelación iguales a `fuga_clutter.m` (error < 0,001 dB) en 24 casos con Np, PRF, B, ventana, oscilador, espectro e inestabilidad variados.

### 25.4 Resultados
Cancelación del mar (Chebyshev 50 dB, 0,2° de inestabilidad) a 2 / 15 / 60 km, en dB:

| Viento | sin ruido de fase | bueno | típico | pobre |
|---|---|---|---|---|
| 5 m/s | 53/53/53 | 53/53/53 | 53/53/53 | 53/52/51 |
| 9 m/s | 52/52/52 | 52/52/52 | 52/52/52 | 51/51/50 |
| 15 m/s | 50/50/50 | 50/50/50 | 50/50/50 | 50/50/49 |

Con ventana de 70 dB (9 m/s), 0,05° / 0,2° de inestabilidad: 63/63/63 · 55/55/55 dB con oscilador bueno o típico; con el pobre, 58/56/53 · 54/53/52 dB.

Lectura: con la ventana de P2 el techo (≈ 50–53 dB) lo ponen los lóbulos de la ventana y la inestabilidad del transmisor, no el oscilador. El ruido de fase solo manda con un oscilador pobre, ventana baja y distancia grande: el suelo blanco de L(f) se pliega sobre toda la banda Doppler y la decorrelación crece con τ. La lluvia (típico, 9 m/s) se cancela 50 / 49 / 46 dB a 5 / 20 / 60 km: su velocidad media cae cerca de la primera celda útil. La cancelación fija anterior (35 dB) era conservadora en unos 15 dB.

### 25.5 Limitaciones
- Espectro del mar gaussiano: las colas reales (espigas, rotura de olas) son más anchas y bajarían el techo; no hay modelo de colas.
- Sin rango dinámico del receptor ni del ADC (B4), ni desequilibrio I/Q (B3), ni movimiento de la plataforma dentro del CPI.
- Una sola cifra por distancia (media en dB sobre las celdas útiles); la web no distingue la velocidad del blanco.
- Ruido de fase pequeño (e^{jΔφ} ≈ 1 + jΔφ) y tablas de oscilador supuestas, no de un equipo concreto.

## 26. Medida angular monopulso y sus errores — `web/src/engine/monopulse.ts`, `matlab/fase1_sistema/mc_monopulso.m`

Ingeniería de antena: cómo mide ángulo la cara con haces suma y diferencia y qué lo degrada. Fuente puntual genérica, sin modelo de blanco ni de seguimiento.

### 26.1 Haces y cociente
- Σ: pesos de recepción de la cara (Taylor 35 dB, n̄ = 5, apuntamiento por fase/TTD).
- Δ_az = sign(x_c,s)·w_n y Δ_el = sign(y_c,s)·w_n, con x_c,s el centro del subarray del elemento: diferencia por mitades formada en los canales digitales de subarray (100 canales; no hace falta un segundo combinador analógico).
- AF(u, v) = Σ_n w_n·e^{jk(x_n·u + y_n·v)}; cociente r = Im{Δ/Σ}, imaginario puro para pesos de fase y Δ impar. El diagrama del elemento es común y se cancela.
- Estimador: inversión de la curva ideal (calibración) en su tramo monótono.

Curva ideal (80×80): θ₃ = 1,70° a broadside y 1,96° a 30°; pendiente normalizada k·θ₃ = 1,34 en ambos casos; tramo monótono ±2,4° (±1,4·θ₃).

### 26.2 Ruido térmico
Primer orden con ruido de elemento independiente (cov(n_Σ, n_Δ) = Σ s_n|w_n|² = 0 por simetría):
σ_r² = (σ_Δ² + r²·σ_Σ²)/(2·|Σ|²),  σ_θ = σ_r/(dr/dθ). En el eje: σ_θ = √(σ_Δ²/σ_Σ²/(2·SNR))/k.
Monte Carlo con ruido por elemento (8000 ensayos): 0,283 / 0,090 / 0,029° medidos frente a 0,283 / 0,090 / 0,028° predichos con SNR 10 / 20 / 30 dB en el eje, y dentro del 1,3 % a θ₃/4. Con SNR 10 dB aparece un sesgo de −0,023° a θ₃/4 (no linealidad del cociente), que el primer orden no da.

### 26.3 Errores de amplitud y fase (A1, A2)
En el eje (Σ real), δr = Im{δΔ}/Σ: **solo los errores de fase sesgan**; los de amplitud dan un Δ real (en cuadratura con el cociente):
σ_sesgo = √(σ_φe²·Σ a_n² + σ_φs²·Σ_s A_s²)/(Σ₀·k),  A_s = Σ_{n∈s} a_n.
Con 0,5 dB / 5° por elemento y 0,3 dB / 3° por subarray: 0,0092° medido (400 realizaciones) frente a 0,0088° predicho; error eficaz en ±θ₃/4 de 0,0088° (θ₃/194).

### 26.4 Desajuste entre canales Σ y Δ (A8)
Ganancia g y fase ψ del canal Δ: r' = g·(cos ψ·Im{Δ/Σ} + sin ψ·Re{Δ/Σ}). Con fuente puntual y pesos sin errores, Re{Δ/Σ} = 0: solo cambia la pendiente, g·cos ψ (exacto: 1,059 / 1,055 / 1,043 / 0,995 con 0,5 dB y ψ = 0/5/10/20°), y el error crece con el desplazamiento (δθ = (g·cos ψ − 1)·θ). Con errores de amplitud, el término sin ψ·Re{δΔ}/Σ añade sesgo en el eje:
σ_sesgo = g·√(cos²ψ·V_φ + sin²ψ·V_a)/(Σ₀·k), V_a con σ_a en neperios (ln10/20 por dB). Validado (0,0090° frente a 0,0085° con ψ = 20°).

### 26.5 Acoplamiento mutuo (A5)
Solución exacta I = (Z + Z_s)⁻¹·(Z_s + Z_ref)·w (Z de la cara con el núcleo de FEM inducida, construida por la tabla Toeplitz por bloques, idéntica a `matriz_z_dipolos.m` con error 2·10⁻¹⁵), con Z_s = Z_ref* (T/R adaptado al centro a broadside) y calibración ideal. Sesgo del eje en acimut frente al barrido:

| Cara | 10° | 30° | 50° | 60° |
|---|---|---|---|---|
| 32×32 | 0,0013° | 0,0057° | 0,0159° | 0,0272° |
| 48×48 | 0,0006° | 0,0026° | 0,0073° | 0,0118° |
| 64×64 | 0,0003° | 0,0015° | 0,0041° | 0,0066° |
| 80×80 | 0,0002° | 0,0009° | 0,0027° | 0,0042° |

Escala ≈ 1/N² (efecto de borde) y es despreciable en la cara completa (θ₃/800 a 60°). La pendiente cambia menos de un 0,3 %. **La aproximación de impedancia activa de la web no reproduce este sesgo** (da otro signo y hasta 2,5 veces el valor), así que el monopulso de la web no aplica el acoplamiento; la aproximación sigue siendo válida para |Γ| y la ganancia (§22), donde importa el promedio y no la asimetría fina entre mitades.

### 26.6 En la web
Panel «Medida angular monopulso» (pestaña Antena): curva ideal y con errores, pendiente normalizada, ruido térmico para la SNR elegida, sesgo y error eficaz de la realización actual de errores (panel de errores de hardware), σ del sesgo predicha y desajuste Σ/Δ. Tests (`tests/monopulse.test.ts`): cociente igual que MATLAB (1·10⁻⁸) en acimut y elevación a 0° y 30°, θ₃ y pendiente, ruido térmico frente a la fórmula y al Monte Carlo, σ del sesgo frente a la fórmula y al Monte Carlo, pendiente g·cos ψ.

### 26.7 Limitaciones
- Δ por mitades sin ponderación propia (sin Bayliss a nivel de subarray): lóbulos de Δ altos; no afecta a la medida en el lóbulo principal.
- Un solo eje cada vez; sin acoplamiento cruzado az/el con errores grandes.
- No se modelan, por decisión de alcance, el multitrayecto en ángulo ni el blanco extenso.

## 27. Forma de onda, pérdidas de procesado y presupuesto de tiempo — `web/src/engine/waveform.ts`, `matlab/fase3_linea_base/val_perdidas.m`

Corrige incoherencias que la ecuación radar sola no ve: con PRF de 2,5 kHz la web daba detecciones a 300 km (alcance no ambiguo 60 km); con 100 µs a 2,5 kHz el ciclo de trabajo era del 25 %; las pérdidas eran 6 dB fijos; la velocidad del blanco no influía y no había tiempo de refresco.

### 27.1 Formas de onda
| Preajuste | τ | PRF | Np | Alcance no ambiguo | Zona ciega | Ciclo | Velocidad ciega |
|---|---|---|---|---|---|---|---|
| búsqueda lejana (por defecto) | 100 µs | 375 Hz | 8 | 400 km | 15 km | 3,8 % | 17 m/s |
| cota baja (MTD, la de P2) | 20 µs | 2,5 kHz | 16 | 60 km | 3 km | 5 % | 114 m/s |

Ru = c/(2·PRF), zona ciega c·τ/2, ciclo τ·PRF, velocidad ciega λ·PRF/2, tiempo por haz Np/PRF. `RadarParams` incluye ahora `prfHz`, `dopplerSllDb` (antes en el entorno), `beamSpacing`, `cfarCells` y `vRadialMs`.

### 27.2 Pérdidas (sustituyen a los 6 dB fijos; `lossDb` queda solo para RF: 3 dB)
| Pérdida | Modelo | Validación (val_perdidas.m) | Por defecto |
|---|---|---|---|
| Ventana Doppler | −10·log((Σw)²/(N·Σw²)), Chebyshev | exacta | 1,49 dB (Np 8) / 1,58 dB (Np 16) |
| Entre celdas Doppler | media en dB sobre la frecuencia del blanco de la mejor celda, o la de su velocidad | ±0,01 dB | 0,54 dB |
| Entre muestras de distancia | media de −10·log sinc²(B·δ), δ uniforme en ±Δ/2, fs = 2B | cadena LFM real: 0,31 frente a 0,30 dB (fs/B = 1: 1,27 / 1,26) | 0,30 dB |
| Forma del haz | haces gaussianos de ida y vuelta, dos ejes: 2·4ln2·(10/ln10)·(1/θₜ² + 1/θᵣ²)·(s·θᵣ)²/12 | cara real 80×80 (Tx uniforme, Rx Taylor): < 0,1 dB entre s = 0,5 y 1 | 2,74 dB (s = 0,7) |
| CA-CFAR | exacta para Swerling 1 y ley cuadrática: SNR = (Pfa^{−1/N} − 1)/(Pd^{−1/N} − 1) − 1 | Monte Carlo 2·10⁵: Pd 0,9006 (N = 20) | 1,58 dB (N = 20) |

Total por defecto 9,7 dB (3 de RF + 6,7 de procesado). θₜ de transmisión: 0,886·λ/(N·d)/cos(barrido).

### 27.3 En la cadena (`environment.ts`)
- **Eclipsado**: el receptor está cerrado en [0, τ] de cada PRI; fracción del eco recibida f; el pico comprimido cae con f² (LFM, validado: −6,02 dB con f = 0,5). Afecta igual al blanco y al clutter que llega a la vez.
- **Alcance ambiguo**: las detecciones más allá de Ru no cuentan para el alcance ni la cobertura (`EnvPoint.ambiguous`); la zona ciega no rompe la continuidad.
- **Clutter plegado**: suma de los anillos (R mod Ru) + n·Ru hasta el horizonte del mar o el borde del chubasco (supuesto: pulsos de relleno, la cancelación es la misma).
- **Velocidad del blanco**: con `vRadialMs` conocida, la celda Doppler del blanco fija la pérdida entre celdas y la cancelación de esa celda (§25; en la muesca |k| < 2 el clutter apenas se cancela); sin ella, medias.

### 27.4 Presupuesto de tiempo
Posiciones de haz = haces en acimut (paso s·θ₃, θ₃ ensanchado por 1/cos az, integrado en el sector) × barras de elevación; refresco = posiciones × Np/PRF por cara. Con la forma de onda lejana, ±45° y 0–6°: 414 posiciones, 8,8 s; hasta 20° serían 25 s, por eso la búsqueda lejana solo cubre elevaciones bajas.

### 27.5 Limitaciones
- Sin entrelazado de modos (búsqueda lejana y cota baja en el mismo cuadro) ni planificador de recursos.
- Sin escalonamiento de PRF para resolver ambigüedades de distancia y velocidad.
- La pérdida de forma del haz es una media en dB (algo pesimista frente a la media sobre la Pd).

## 28. E2 · Canales digitales frente a haces simultáneos — `matlab/fase4_optimizacion/e2_canales_haces.m`

Pregunta: ¿cuántos canales digitales necesita la cara por subarrays para formar K haces de recepción simultáneos sin perder ganancia ni subir el SLL? Es la cota del TFG (N_RF ≥ B·N_s) llevada al radar.

### 28.1 Modelo de hardware
- El taper de Taylor (−35 dB, n̄ = 5) está en el módulo T/R, antes del reparto, y es común a todos los haces.
- Cada subarray de L elementos tiene M puertos. Cada puerto es una red de desfasadores de 6 bits (solo fase) y sale a su propio canal digital: N_ch = N_sub·M, con M desfasadores por elemento.
- Peso del haz k: w_k = diag(t)·F_RF·f_BB,k.
  - Analógico «por grupos»: los K haces se reparten en M grupos contiguos y cada puerto apunta al centro de su grupo.
  - Digital: mínimos cuadrados regularizados frente al haz ideal (digital puro).
- Los haces se reparten en acimut. El problema es separable: el factor en elevación es común, así que basta la fila de 80 elementos. En la cara 2D, N_ch = (80/L)²·M.
- Criterio: en el peor haz, pérdida ≤ 1 dB frente al digital puro y SLL ≤ −30 dB, lóbulos de cuantización incluidos.

### 28.2 Cota
Un subarray de L elementos ve el sector de los haces (anchura Δu en seno) con resolución λ/(L·d). Los grados de libertad que necesita son el rango numérico del bloque de steering vectors del sector:

r_eff = #{σ_i/σ_1 > 10^(−SLL_diseño/20)},  que crece con s = Δu·L·d/λ (Landau-Pollak).

**Cota: M ≥ min(K, r_eff), es decir, N_ch ≥ N_sub·min(K, r_eff).** Con haces dispersos, r_eff ≥ K y se recupera la forma del TFG, N_ch ≥ N_sub·K: cada haz necesita su propia dimensión analógica, igual que cada banda y cada flujo en el TFG. La diferencia es que en el radar los haces en racimo comparten dimensiones, y r_eff dice cuántas.

### 28.3 Resultados
- **Cota frente a M mínimo medido** (64 casos: L = 4, 8 y 16; K = 2–16; s = 0,05–3,2):
  - acierta en 56 casos (88 %);
  - el M mínimo nunca queda por debajo de la cota;
  - en 8 casos se necesitan entre 1 y 3 puertos más, cuando K no es múltiplo de M y los grupos quedan desiguales (limitación del analógico por grupos).
- **M = 1 nunca basta** con −35 dB de diseño, ni siquiera en un racimo de 2 haces. El problema no es la ganancia (< 0,5 dB) sino los lóbulos de cuantización de los subarrays. Ejemplo con L = 8 y 4 haces en racimo: SLL de −13 dB con M = 1 frente a −32 dB con M = 2.
- **Descompositor del TFG (PE-AltMin)** frente al analógico por grupos (128 casos):
  - baja el error de Frobenius en el 42 % de los casos;
  - mejora el SLL más de 1 dB solo en el 20 %, y lo empeora más de 1 dB en el 29 %.
  - Conclusión: el error de Frobenius, que era el criterio correcto en comunicaciones, no controla los lóbulos secundarios del radar.
- **Cara de referencia** (100 subarrays de 8×8, 6400 elementos), frente a 6400 canales con digital puro:

| Situación | M | Canales |
|---|---|---|
| 4 haces en racimo (Δu = 3·HPBW) | 2 | 200 |
| 8 haces en racimo (Δu = 7·HPBW) | 3 | 300 |
| 8 haces repartidos (Δu = 0,8) | 7 | 700 |

- **Compromiso** (figura c): subarrays grandes ahorran canales digitales, pero piden más puertos y, por tanto, más desfasadores por elemento; subarrays pequeños hacen lo contrario. Es el compromiso FC/SC del TFG. Ejemplo con 8 haces en racimo: 300 canales con 3 desfasadores por elemento (L = 8) frente a 125 canales con 5 (L = 16).

### 28.4 Limitaciones
- Analógico por grupos con grupos contiguos; un reparto óptimo cerraría los 8 casos por encima de la cota.
- Haces solo en acimut y la cara 2D tratada como separable. Para racimos en 2D, el producto r_x·r_y es suficiente; no se ha comprobado que sea necesario.
- Sin subarrays solapados ni irregulares, que son la solución clásica a los lóbulos de cuantización: es el experimento E1.
- Banda estrecha: sin squint (E3) y sin errores de hardware (E6).

## 29. E3 · TTD por subarray frente al ancho de banda instantáneo — `matlab/fase4_optimizacion/e3_ttd_ancho_banda.m`

Pregunta: ¿a partir de qué ancho de banda instantáneo B hace falta TTD, a qué nivel (subarray de qué tamaño o elemento) y con cuántos bits de retardo? Conexión con el TFG: allí una capa TTD compartida corregía el squint y bastaban 3 bits de retardo.

### 29.1 Modelo
- Fila de 80 elementos con d = λ0/2 a f0 = 3,3 GHz y Taylor de −35 dB (n̄ = 5). El problema es separable: el squint de un barrido en acimut solo afecta a la fase a lo largo de x, y el factor en elevación es común a todas las arquitecturas.
- Arquitecturas, en recepción a la frecuencia f = f0 + Δf:
  - **Solo desfasadores:** fase −k0·x_i·u0, fija y calculada a f0. El haz se desplaza a u ≈ u0·f0/f (squint).
  - **TTD por subarray** de L = 4, 8 o 16 elementos: un retardo τ_s = xc_s·u0/c0 por subarray, más desfasadores dentro del subarray calculados a f0. Cuando el retardo está cuantizado, los desfasadores absorben a f0 el error de cuantización (práctica habitual). Así el haz es exacto a f0, y el error solo aparece fuera de f0, proporcional a (f − f0)·δτ.
  - **TTD por elemento** (referencia): retardo exacto en cada elemento. No tiene squint; solo lo limitan los lóbulos de rejilla del espaciado a frecuencias altas.
- **Métricas en los dos bordes de banda f0 ± B/2**, tomando el peor de los dos. El borde es el peor caso instantáneo: el squint crece con |f − f0| y un chirp barre la banda entera. La pérdida media sobre la banda, que es la que pesa en la SNR tras la compresión de pulso, se da como dato aparte; en el límite de solo desfasadores es 0,30 dB, frente a 0,77 dB en el borde.
  - Pérdida: ganancia en u0 frente al TTD por elemento a la misma frecuencia, para descontar el aumento de apertura eléctrica con f.
  - Squint: desplazamiento del máximo, en fracciones del HPBW.
  - SLL máximo fuera de ±1,1 primeros nulos alrededor de u0, con los lóbulos de cuantización y de rejilla incluidos.
- **Criterios:**
  - Completo, igual que en E2: pérdida ≤ 1 dB y SLL ≤ −30 dB en los dos bordes.
  - Solo pérdida ≤ 1 dB: sirve para separar lo que corrige el TTD (squint y pérdida) de lo que estropea (lóbulos).
- **Desfasadores continuos en el análisis de banda.** Los desfasadores de 6 bits ya generan lóbulos de cuantización de fase a f0 en ángulos concretos (peor caso −29,6 dB a 22°, un 3 % de los ángulos por encima de −30 dB). Ese efecto no depende de B, así que se comprueba aparte (parte D del script) para no mezclar los dos.
- **Bits de retardo:** LSB = τ_max/(2^b − 1), con τ_max el retardo del último subarray a 60° (unos 10 ns). Se toma el peor ángulo entre 5° y 60°, y el b mínimo es el que alcanza el 90 % del B máximo con retardos continuos.
- B se barre hasta 660 MHz (20 % de f0); los valores de 660 son el tope de la rejilla. La búsqueda de B máximo es por bisección y supone que, una vez que el criterio falla, sigue fallando al ensanchar la banda.

### 29.2 Resultados
**Conclusión:** sin TTD, a 60° la cara admite unos 58 MHz de ancho de banda instantáneo. El TTD por subarray de 8×8 elimina la pérdida por squint hasta 500 MHz, pero los lóbulos de cuantización que aparecen fuera de f0 dejan el límite en 47 MHz con SLL ≤ −30 dB, por debajo del caso sin TTD. Con 4–5 bits de retardo se alcanza el límite con retardos continuos.

B máximo a 60° (MHz):

| Arquitectura | Criterio completo | Solo pérdida ≤ 1 dB |
|---|---|---|
| Solo desfasadores | 58 | 66 |
| TTD por subarray, L = 16 | 17 | 245 |
| TTD por subarray, L = 8 | 47 | 500 |
| TTD por subarray, L = 4 | 100 | ≥ 660 |
| TTD por elemento | 335 (lóbulo de rejilla) | ≥ 660 |

- **Solo desfasadores:** el límite es el squint y es casi el mismo con los dos criterios: a 60°, el primer B que falla (60 MHz) tiene 0,82 dB de pérdida y 0,27 HPBW de squint. El límite cae con el ángulo: 200 MHz a 15°, 104 MHz a 30° y 72 MHz a 45°.
- **TTD por subarray: corrige la pérdida, pero no los lóbulos.**
  - El TTD fija el factor de array entre subarrays, pero el diagrama de cada subarray sigue desviándose con la frecuencia porque sus desfasadores están calculados a f0. Fuera de f0, los nulos del subarray dejan de caer sobre los lóbulos de rejilla del espaciado entre subarrays (L·d), y esos lóbulos de cuantización suben.
  - Su nivel crece con L y con Δf. Por eso el B máximo con el criterio completo va aproximadamente como 1/L: 17, 47 y 100 MHz para L = 16, 8 y 4 a 60°.
  - Ejemplo a 60° con un borde de banda de 200 MHz: L = 8 tiene 0,2 dB de pérdida pero un lóbulo a −18 dB; solo desfasadores pierde 10,4 dB.
  - **Matiz frente al TFG:** el TTD por subarray solo amplía la banda si se aceptan lóbulos de cuantización por encima del diseño. Con L = 8 y −30 dB no aporta nada frente a solo desfasadores. En el TFG no apareció este efecto porque su capa TTD tenía un retardo por columna del array 8×8, que en el plano de barrido equivale a TTD por elemento y no genera lóbulos de cuantización.
- **Bits de retardo** (b mínimo para alcanzar el 90 % del caso continuo, peor ángulo de 5° a 60°):

| L | Criterio completo | Solo pérdida |
|---|---|---|
| 16 | 3 | 4 |
| 8 | 4 | 5 |
| 4 | 5 | 4, limitado por el tope de 660 MHz |

  - Con 3 bits, que es lo que bastaba en el TFG, la pérdida en L = 8 limita a 295 MHz en lugar de 500.
  - La diferencia con el TFG se explica por el producto tiempo-ancho de banda de la apertura, τ_max·B. En el TFG (8 columnas a 57 GHz, 40°, banda del 5 %) valía 0,11. Aquí vale de 0,16 a 1,02 con el criterio completo y de 2,3 a 6,7 con solo pérdida. Los bits necesarios crecen con ese producto: los «3 bits» del TFG son un caso particular de una apertura eléctricamente corta en tiempo, no una regla general.
- **Forma de onda de la web (5 MHz):** con solo desfasadores a 60° la pérdida es de 0,006 dB y el squint de 0,02 HPBW. El límite (58 MHz) está unas 12 veces por encima, así que la cara del simulador no necesita TTD con su forma de onda actual. El TTD solo empieza a hacer falta con anchos de banda de decenas de MHz y barridos grandes; por ejemplo, para una resolución en distancia por debajo de 3 m (B > 50 MHz) a más de 45°.
- **TTD por elemento:** a 60° lo limita el lóbulo de rejilla del espaciado λ0/2, que entra en el espacio visible por encima de f0·2/(1 + sen 60°). En ese ángulo el límite teórico es 474 MHz, y el criterio de −30 dB lo adelanta a 335 MHz porque la cola del lóbulo de rejilla entra antes en el borde del espacio visible.

### 29.3 Limitaciones
- Sin diagrama de elemento: en particular, no se atenúa el lóbulo de rejilla cerca de endfire, lo que hace pesimista el límite del TTD por elemento.
- Sin subarrays solapados ni irregulares, que son la solución clásica a los lóbulos de cuantización del TTD por subarray (E1).
- Retardos cuantizados con un LSB fijo por el rango a 60°, sin errores de fabricación de las líneas de retardo ni dependencia de la frecuencia de los desfasadores. Los desfasadores se suponen ideales (de fase constante con f).
- Métricas en los bordes de banda, que son el peor caso. No se simula la compresión de pulso completa con un haz dispersivo (deformación de los lóbulos en distancia).
- Desfasadores continuos en el análisis de banda. La cuantización de 6 bits añade lóbulos de hasta −29,6 dB a f0, independientes de B. La práctica habitual de aleatorizar la cuantización (dithering) no está modelada.

## 30. E1 · Partición en subarrays: regular, irregular o solapada — `matlab/fase4_optimizacion/e1_particion_subarrays.m`

Pregunta: con el mismo número de canales digitales, ¿qué partición minimiza los lóbulos de cuantización y cuánto deja desplazar el haz digital respecto al apuntamiento analógico? Viene de E2 (§28): con un puerto por subarray, en cuanto el haz digital se aparta del apuntamiento analógico aparecen lóbulos de cuantización. La causa es que los centros de fase de los subarrays forman una red periódica de paso L·d, que produce réplicas del haz (lóbulos de rejilla de la red de subarrays) solo atenuadas por el diagrama del subarray.

### 30.1 Modelo
- Hardware igual que en E2: taper de Taylor en el módulo T/R, desfasadores de 6 bits solo de fase apuntados al centro analógico, digital por mínimos cuadrados regularizados frente al haz ideal.
- Fila de 80 elementos con 10 canales, equivalente a la cara de referencia de 10×10 subarrays por separabilidad.
- Particiones, todas con 10 canales:
  - **Regular:** 10 subarrays de 8.
  - **Irregular:** 10 subarrays contiguos de 4 a 12 elementos que suman 80. Es la máscara SC no uniforme del TFG (`build_sc_mask`, layout `'nonuniform'`), que allí solo servía para que N_t no tuviera que ser múltiplo de N_RF; aquí se usa a propósito para romper la periodicidad. Búsqueda aleatoria determinista (3000 candidatos, semilla `E1-irregular`) que minimiza el peor SLL con el haz desplazado hasta ±0,25 anchos de haz del subarray. Mejor partición: [12 6 9 8 5 7 5 6 10 12].
  - **Solapada:** cada canal combina o·L elementos (o = 2 y 3) centrados en el centro del subarray regular, con pesos de amplitud fijos en la red de combinación. Se probaron ventanas rectangular, Hann y sinc truncada, y ganó Hann en ambos casos.
    - Coste de hardware: el desfasador va antes del reparto (sigue habiendo uno por elemento y puerto), pero cada elemento alimenta o combinadores. Eso supone un divisor 1:o por elemento y o veces más entradas de combinador (1,9 y 2,8 por elemento, menos en los bordes).
- Métricas:
  - SLL máximo (lóbulos de cuantización incluidos), ISLR y pérdida frente al digital puro;
  - en función del desplazamiento δ del haz digital, medido en anchos de haz del subarray regular, λ/(L·d) = 0,25 en u, que equivale a 8,3 HPBW de la cara;
  - criterio de E2: pérdida ≤ 1 dB y SLL ≤ −30 dB.

### 30.2 Resultados
- **Desplazamiento máximo** que cumple el criterio con un puerto por subarray:

| Partición | δ máx. (anchos de subarray) | δ máx. (HPBW de la cara) | SLL con δ = 0,25 | ISLR con δ = 0,25 |
|---|---|---|---|---|
| Regular 10×8 | 0,025 | 0,2 | −9,7 dB | −6,6 dB |
| Irregular | 0,05 | 0,4 | −17,0 dB | −7,6 dB |
| Solapada ×2 (Hann) | 0,05 | 0,4 | −13,8 dB | −13,8 dB |
| Solapada ×3 (Hann) | **0,20** | **1,7** | **−29,6 dB** | −24,8 dB |

- **La partición irregular solo reparte la energía de los lóbulos.** Baja el pico 7 dB (de −9,7 a −17,0 dB), pero el ISLR apenas mejora 1 dB: la energía que estaba en unos pocos lóbulos de cuantización se reparte en un suelo de lóbulos a −20/−30 dB (figura c). No sirve para un radar de −35 dB.
- **La partición solapada ataca la causa.** El diagrama del subarray, más estrecho y con flancos bajos, filtra las réplicas de la red de subarrays. Además, la pérdida se mantiene por debajo de 0,1 dB hasta δ ≈ 0,4.
- **Conexión con E2** (4 haces en racimo, Δu = 3·HPBW; en E2 la regular necesitaba M = 2):

| Partición | M mínimo | Canales en la cara 2D | SLL con M = 1 |
|---|---|---|---|
| Regular | 2 | 200 | −13,2 dB |
| Irregular | 2 | 200 | −20,3 dB |
| Solapada ×2 | 2 | 200 | −18,5 dB |
| **Solapada ×3** | **1** | **100** | −30,7 dB |

**Conclusión: con solape ×3 y ventana de Hann, la cara forma 4 haces en racimo con 100 canales en vez de 200 y con un desfasador por elemento en vez de dos, a cambio de un divisor 1:3 por elemento en la red de combinación. La partición irregular baja el pico de los lóbulos 7 dB, pero no la energía total (ISLR −6,6 → −7,6 dB).**

Es el compromiso FC/SC del TFG en otra forma: el solape es una conexión parcial, a medio camino entre SC (cada elemento en un solo canal) y FC (cada elemento en todos), y compra grados de libertad analógicos con red de combinación en vez de con desfasadores o canales digitales.

### 30.3 Limitaciones
- Solo en acimut. Como los haces del racimo están en acimut, basta solapar en x (≈3 entradas por elemento). Un racimo en 2D obligaría a solapar en los dos ejes y serían ≈9 entradas por elemento.
- Pesos del solape tomados de ventanas estándar, sin optimizar. Un diseño de patrón plano (pesos tipo sinc con más solape o pesos optimizados) dejaría desplazar más, pero con más entradas por elemento.
- Partición irregular buscada al azar entre particiones contiguas en 1D. Las particiones 2D con teselas irregulares (poliominós) rompen mejor la periodicidad y no se han probado.
- El margen de la solapada ×3 es justo: −29,6 dB frente al −30 dB del criterio con δ = 0,25, con una pequeña meseta alrededor de δ = 0,2–0,3.
- Pérdidas de la red de combinación, sus errores de amplitud y fase, y la banda ancha no modelados.

## 31. E4 · Anulación adaptativa de jammers al nivel de subarray — `matlab/fase4_optimizacion/e4_anulacion_jammer.m`

Pregunta: ¿cuántos jammers de ruido puede anular la cara con sus grados de libertad digitales, cuánta SINR recupera y qué le cuesta al haz principal? Conexión con el TFG: los grados de libertad son los canales digitales (N_RF). El MVDR del TFG trabajaba al nivel de elemento, en un array completamente digital de 64 elementos. Aquí el adaptativo solo ve las 100 salidas de subarray, que es lo que ofrece una cara híbrida.

### 31.1 Modelo
- **Cara:** 80×80 con 100 subarrays de 8×8 y d = λ/2. Taper Taylor 2D (−35 dB, n̄ = 5) en el módulo T/R. El analógico apunta al blanco con desfasadores de 6 bits.
  - Salida del subarray s para una dirección: b_s(u,v) = Σ_{e∈s} t_e·a0q_e*·a_e(u,v), que forma la matriz T (6400×100).
  - Ruido térmico de potencia 1 por elemento: R_n = TᴴT, diagonal.
- **Blanco:** en (u0, v0) = (sen 20°, 0).
- **Jammers:** J jammers de ruido incorrelados, con JNR por elemento como parámetro (20, 30 y 40 dB). Direcciones aleatorias, deterministas por semilla, en la región visible y fuera del lóbulo principal (|Δ| > 0,1 en seno).
- **Beamformers** (100 grados de libertad):
  - convencional, w = 1: el haz Taylor fijo;
  - MVDR, w = R⁻¹s, con s = Tᴴa(u0,v0);
  - MVDR con patrón quiescente, w = R⁻¹R_n·1. Sin jammers vuelve a w = 1 y conserva el taper;
  - SMI con K snapshots sin blanco, sin carga y con carga diagonal blanqueada R̂ + R_n (0 dB).
- **SINR(w)** ∝ |wᴴs|²/(wᴴRw). La pérdida se mide frente al haz Taylor de diseño sin jammers.
- **Métricas:**
  - pérdida de SINR;
  - nivel del diagrama en cada jammer (profundidad del nulo);
  - pérdida de ganancia en el blanco;
  - desapuntamiento del máximo (FFT 2D de 1024² con interpolación parabólica);
  - SLL del diagrama adaptado, fuera de un círculo de radio 0,05 alrededor del blanco.

### 31.2 Resultados
- **MVDR puro frente a MVDR quiescente.** Sin jammers, el MVDR puro gana 1,7 dB de SINR porque deshace el taper entre subarrays, pero el SLL sube de −31,4 dB (Taylor con 6 bits) a −18,3 dB. Por eso el resto del análisis usa el MVDR con patrón quiescente: misma anulación y mismo diagrama que el diseño cuando no hay jammers.
- **Número de jammers.** Lo que cuenta no es J sino el **rango efectivo**: el número de jammers que quedan por encima del ruido a la salida de los subarrays. El analógico, apuntado al blanco, ya atenúa los jammers lejanos.
  - Pérdida mediana de SINR ≤ 1 dB hasta J = 200 (el máximo probado) con JNR 20 dB, hasta J = 130 con 30 dB y hasta J = 110 con 40 dB. Es decir, más jammers que grados de libertad.
  - La pérdida crece cuando el rango efectivo satura los 100 grados de libertad. Con J = 200 el rango efectivo es 98, 99 y 100, y la pérdida es 0,65, 3,1 y 10,2 dB para 20, 30 y 40 dB.
- **SINR recuperada.** Con 10 jammers, el haz fijo pierde entre 0 y 19 dB según la JNR (0–40 dB); el MVDR quiescente, menos de 0,01 dB. Con JNR 30 dB, el haz fijo pierde entre 13 dB (J = 10) y 27 dB (J = 200).
- **Coste para el haz principal** (MVDR quiescente, JNR 30 dB, medianas):

| J | Pérdida de ganancia | Desapuntamiento | SLL |
|---|---|---|---|
| ≤ 40 | < 0,02 dB | ≈ 0 | −31,3 dB (= diseño) |
| 99 | 0,11 dB | 0,04 HPBW | −24,9 dB |
| 160 | 0,28 dB | 0,07 HPBW | −19,6 dB |

- **Profundidad de los nulos:** de −100 a −160 dB con covarianza exacta. No es realista: en la práctica la limitan los errores de calibración (E6) y la carga diagonal.
- **Un jammer barriendo el acimut:** la pérdida solo supera 1 dB con el jammer a menos de 0,018 en seno del blanco (0,6 HPBW). Fuera de ahí, la máxima es 0,36 dB.
  - Un jammer en la dirección de un lóbulo de cuantización del blanco (Δu = λ/(L·d) = 0,25) **no** es un problema. Ahí el subarray tiene un nulo, y el taper dentro de cada subarray hace que la respuesta del jammer sea casi ortogonal a la del blanco (cos² = −24 dB).
- **El caso clave: dos jammers separados k·λ/(L·d).** Esas dos direcciones tienen la misma progresión de fase entre subarrays (aliasing al nivel de subarray). El adaptativo solo puede distinguirlas por el diagrama del subarray, y para anular las dos levanta lóbulos cerca del haz principal.
  - SLL del corte: −18, −20 y −14 dB para k = 1, 2 y 3, frente a −30,6 dB lejos de esas separaciones (−31,4 dB quiescente).
  - La SINR casi no sufre (≤ 0,5 dB).
  - Es el mismo mecanismo que los lóbulos de cuantización de E2. Los subarrays solapados o irregulares (E1) rompen esa periodicidad.
- **Snapshots (SMI, 10 jammers):**
  - Sin carga, E[ρ] coincide con Reed-Mallett-Brennan, (K+2−N)/(K+1), dentro del IC95 % en los 9 valores de K. Con K = 2N = 200: −2,93 dB medidos frente a −2,95 dB de teoría.
  - Con carga diagonal de 0 dB bastan K = 2J = 20 snapshots para −3,0 dB (regla de Carlson). La asíntota con K → ∞ es 0,00 dB: la carga no introduce sesgo.

**Conclusión:** con 100 grados de libertad de subarray, la cara anula jammers de ruido con menos de 1 dB de pérdida de SINR hasta 110 jammers a JNR 40 dB (130 a 30 dB). Son más que sus grados de libertad, porque el analógico ya atenúa los jammers lejanos y el límite real es el rango efectivo que queda a la salida de los subarrays. Frente al haz fijo recupera hasta 19 dB con 10 jammers. Con estimación, se pierden 3 dB con K = 2N = 200 snapshots, o con solo K = 2J = 20 si se usa carga diagonal. El punto débil es el aliasing entre subarrays: dos jammers separados k·λ/(L·d) suben el SLL hasta −14 dB.

### 31.3 Limitaciones
- Covarianza exacta en el barrido de J: nulos ideales, sin errores de calibración ni de canal (E6), sin banda ancha (dispersión del nulo con el ancho de banda) y sin jammers en el lóbulo principal.
- Elemento isótropo y jammers en todo el disco visible. Un patrón de elemento real atenuaría más los jammers rasantes.
- JNR genérica por elemento. No se modelan potencias, distancias ni escenarios concretos.
- El SLL del caso de dos jammers se mide en el corte de acimut, porque los jammers están en él.

## 32. E6 · Robustez frente a fallos de módulos T/R y errores de calibración — `matlab/fase4_optimizacion/e6_robustez_fallos.m`

Pregunta: ¿cuánto se degradan el SLL, la ganancia y el apuntamiento de la cara de referencia con módulos T/R caídos y errores de amplitud y fase, y cuánto recupera una recalibración? La robustez era la línea futura del TFG («tolerancias y fallos»); el primer análisis de robustez, hecho sobre el array mmWave del TFG, se lleva aquí a la cara en banda S.

### 32.1 Modelo
- Cara 80×80, subarrays de 8×8, Taylor −35 dB (n̄ = 5), desfasadores de 6 bits sobre un TTD por subarray, haz a u₀ = 0,344 (20,1°). El patrón se calcula con FFT 2D (P = 512) y el pico cae en un bin.
- **Cuantización con dither (A3, §21).** Sin dither, el residuo de fase del desfasador es el mismo en los 100 subarrays y la cara ideal ya tiene un SLL de −31,3 dB a 20°. Con dither, −35,1 dB. Se usa dither como referencia.
- Un fallo es un factor más del modelo de momentos del §21: ε = b·g·e^{jδφ}, con b ~ Bernoulli(1 − p):
  μ = (1 − p)·e^{s²/2}·e^{−σ_φ²/2},  m₂ = (1 − p)·e^{2s²},  E|F(u)|² = μ²|F₀(u)|² + (m₂ − μ²)·Σa².
  Con fallos solos, el suelo de lóbulos es ≈ p/((1 − p)·η·N), con η = 0,653 para el Taylor 2D.
- Métricas:
  - SLL máximo fuera del lóbulo principal (radio 1,15 veces el primer nulo).
  - Nivel medio de los lóbulos lejanos (|u − u₀| > 0,25 en el espacio u-v visible).
  - Pérdida de ganancia en recepción, G = |F(u₀)|²/Σ|w|², la misma definición que la web.
  - Error de apuntamiento en acimut, con Newton sobre el corte v = 0.
- Monte Carlo con 100 realizaciones por punto e IC95 %. Semillas `E6-A`, `E6-B`, `E6-C` y `E6-dither`.

### 32.2 Fallos y errores aleatorios: la teoría se cumple
| Módulos caídos | 0 % | 1 % | 2 % | 5 % | 10 % | 15 % | 20 % |
|---|---|---|---|---|---|---|---|
| SLL máximo (MC) | −35,1 | −34,8 | −34,5 | −33,9 | −33,2 | −32,3 | −31,6 |
| Lóbulos lejanos MC / teoría | −62,6 / −62,6 | −55,4 / −55,3 | −52,7 / −52,7 | −48,9 / −48,8 | −45,7 / −45,7 | −43,7 / −43,7 | −42,2 / −42,2 |
| Pérdida (dB) MC = teoría | 0 | 0,04 | 0,09 | 0,22 | 0,46 | 0,71 | 0,97 |

- Errores por elemento (σ_φ de 2,5° a 15°, con σ_a = σ_φ/10 dB): el suelo lejano coincide con la teoría con 0,1 dB de diferencia como mucho (−49,5 dB a 10°/1 dB). La pérdida también coincide (0,190 dB a 10°). El apuntamiento se ajusta a la fórmula linealizada, σ_u = σ_φ·√(Σa²x²)/(k·Σa·x²): 3,78·10⁻⁵ medido frente a 3,86·10⁻⁵ teórico a 10°.
- El suelo medio sube rápido (de −63 a −46 dB con un 10 % de fallos), pero el SLL máximo apenas se mueve (−33,2 dB). Con N = 6400 el suelo aleatorio queda unos 12 dB por debajo de los primeros lóbulos del Taylor. En el array mmWave de 16×16 de ese primer análisis el mismo 20 % llevaba el SLL a unos −22,5 dB: **una cara grande es robusta de por sí**.

### 32.3 Fallo correlado: un subarray entero cuesta más que sus 64 elementos sueltos
| Subarrays caídos | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| SLL, subarrays enteros | −32,1 | −30,4 | −28,4 | −27,0 | −26,4 |
| SLL, mismos elementos al azar | −34,7 | −34,3 | −34,3 | −34,0 | −34,0 |

- La pérdida de ganancia es la misma en los dos casos (0,04 dB por subarray): solo cuenta la potencia perdida.
- Lo que cambia es la forma. Un hueco de 8×8 resta al patrón el diagrama de un subarray, que es un lóbulo ancho (2/L en u) y coherente junto al haz, en vez de un suelo repartido.
- El peor caso es el subarray central, el de más peso en el taper: **−28,1 dB, 7 dB peor que el diseño**, frente a −34,7 dB con los mismos 64 elementos repartidos.

### 32.4 Recalibración con hardware realista
- **Re-taper de los módulos vivos** por proyecciones alternadas con FFT (Keizer, 2008): máscara de −37 dB, 150 iteraciones con P = 256.
  - Restricciones: el atenuador solo atenúa (|w| ≤ 1); al final se cuantiza a pasos de 0,5 dB (rango de 31,5 dB) y a 6 bits de fase con dither.

  | Módulos caídos | Sin recalibrar | Re-taper | Pérdida de ganancia |
  |---|---|---|---|
  | 5 % | −33,8 | −35,1 | 0,22 → 0,24 dB |
  | 10 % | −33,2 | −35,1 | 0,46 → 0,48 dB |
  | 20 % | −30,9 | −34,8 | 0,97 → 1,04 dB |

  La cuantización final cuesta menos de 0,3 dB.
- **Calibración de errores de 1 dB/10°.** Se miden con ruido (1°, 0,1 dB) y se corrigen con el desfasador de 6 bits y el atenuador.
  - El suelo lejano baja de −49,5 a −61,4 dB. La teoría con el residuo (0,18 dB, 1,91°, cuantización incluida) da −61,4 dB.
  - El SLL máximo baja de −33,8 a −35,2 dB. El límite lo pone la cuantización del hardware, no la calibración.
- **Subarray caído** (media de 10 casos; el primero es el subarray central):

  | Subarrays caídos | Sin compensar | Solo pesos digitales (99 subarrays) | Re-taper de elemento |
  |---|---|---|---|
  | 1 | −31,4 | −32,9 | −34,2 |
  | 2 | −30,4 | −33,3 | −34,3 |
  | 3 | −27,6 | −28,8 | −32,6 |

  - Los pesos digitales recuperan entre 1,2 y 2,9 dB sin tocar el hardware, con una pérdida de ganancia de 0,2–0,9 dB.
  - El re-taper de elemento, con 64 veces más grados de libertad, recupera entre 2,8 y 5 dB.
  - Aquí reaparece el compromiso de grados de libertad del TFG y de E2.

### 32.5 Conclusión
**Con un 10 % de módulos T/R caídos el SLL sube de −35,1 a −33,2 dB (−31,6 dB con un 20 %) y el re-taper de los módulos vivos lo devuelve a −35,1 dB a cambio de 0,02 dB de ganancia. Un subarray entero caído cuesta 3 dB de SLL de media y 7 dB si es el central, unas 7 veces más que sus 64 elementos repartidos; los pesos digitales recuperan 1,5 dB y el re-taper de elemento, 2,8 dB.**

Las tres fórmulas del §21 (suelo de lóbulos, pérdida de ganancia y apuntamiento), ampliadas con el fallo como un factor de Bernoulli, se cumplen dentro del IC95 % en todo el barrido.

### 32.6 Limitaciones
- Solo recepción. En transmisión, los módulos caídos también restan potencia (1 − p), así que la pérdida a dos caminos es mayor.
- Fallos independientes y equiprobables; sin envejecimiento ni fallos térmicos correlados por zonas.
- La recalibración supone que se sabe qué módulos han caído (diagnóstico perfecto) y usa una máscara uniforme de −37 dB. El algoritmo de Keizer es heurístico, no un óptimo.
- La compensación digital del subarray caído solo controla el SLL en banda estrecha a f₀; no se ha estudiado el ancho de banda (E3).
- Monte Carlo de la recalibración con 10 casos por punto, sin IC: las cifras son orientativas (±0,5 dB).
- Banda estrecha, sin acoplamiento mutuo (§22) ni errores por subarray (A2).
