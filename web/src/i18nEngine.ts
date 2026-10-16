// English translation of the texts defined by the engine (scenarios, sweeps, scales).
// The engine stays in Spanish; views pass them through dict(text, ENGINE_EN).
export const ENGINE_EN: Record<string, string> = {
  // scenarios
  'Vigilancia aérea': 'Air surveillance',
  'Ecuación radar, ganancia y pérdida de barrido frente a un caza a gran distancia con mar en calma.':
    'Radar equation, gain and scan loss against a fighter at long range with a calm sea.',
  'caza · 3 m² · 5 000 m': 'fighter · 3 m² · 5,000 m',
  'Misil rozaolas': 'Sea-skimming missile',
  'Horizonte, multitrayecto sobre el mar y clutter frente a un misil a 7 m con mar de estado 4–5.':
    'Horizon, sea multipath and clutter against a missile at 7 m with sea state 4–5.',
  'misil · 0,1 m² · 7 m': 'missile · 0.1 m² · 7 m',
  'Jammer de ruido': 'Noise jammer',
  'Lóbulos secundarios y anulación adaptativa frente a un jammer fuera del haz.':
    'Sidelobes and adaptive nulling against an off-beam jammer.',
  'blanco + jammer': 'target + jammer',
  'Multifunción': 'Multifunction',
  'Búsqueda más seguimiento de N blancos: haces simultáneos frente a canales digitales.':
    'Search plus tracking of N targets: simultaneous beams versus digital channels.',
  'N blancos': 'N targets',
  'Dron a baja cota': 'Low-altitude drone',
  'Sensibilidad y clutter frente a un dron pequeño a 100 m sobre mar de estado 3.':
    'Sensitivity and clutter against a small drone at 100 m over sea state 3.',
  'dron · 0,01 m² · 100 m': 'drone · 0.01 m² · 100 m',
  // sweep parameters
  'Altura de la antena': 'Antenna height',
  'Altura del blanco': 'Target height',
  'RCS del blanco': 'Target RCS',
  'Viento (estado del mar)': 'Wind (sea state)',
  'Mar de fondo': 'Swell',
  'Humedad relativa': 'Relative humidity',
  'Lluvia': 'Rain',
  'Ancho de banda': 'Bandwidth',
  'Cancelación de clutter (fija)': 'Clutter cancellation (fixed)',
  'Inestabilidad del transmisor': 'Transmitter instability',
  'Rumbo (respecto al viento)': 'Heading (relative to wind)',
  'Potencia por elemento': 'Power per element',
  'Pulsos integrados': 'Integrated pulses',
  'Ventana Doppler (lóbulos)': 'Doppler window (sidelobes)',
  'Paso de la rejilla de búsqueda': 'Search grid spacing',
  'Elevación del haz fijo': 'Fixed-beam elevation',
  // sweep metrics
  'Primera detección': 'First detection',
  'Cobertura continua': 'Continuous coverage',
  'Huecos por nulos': 'Gaps from nulls',
  'Pd a la distancia de referencia': 'Pd at reference range',
  'SINR a la distancia de referencia': 'SINR at reference range',
  'CNR a la distancia de referencia': 'CNR at reference range',
  // sweep series
  'ninguna': 'none', 'actual': 'current', 'polarización': 'polarization',
  'estabilización del haz': 'beam stabilization', 'estabilizado': 'stabilized', 'sin estabilizar': 'unstabilized',
  'aletas': 'fins', 'con aletas': 'with fins', 'sin aletas': 'without fins',
  'haz': 'beam', 'barrido en elevación': 'elevation scan', 'haz fijo': 'fixed beam',
  // limiting factor
  'horizonte': 'horizon', 'multitrayecto': 'multipath', 'ruido': 'noise',
  // Douglas scale
  'calma': 'calm', 'rizada': 'rippled', 'marejadilla': 'smooth', 'marejada': 'slight', 'fuerte marejada': 'moderate',
  'gruesa': 'rough', 'muy gruesa': 'very rough', 'arbolada': 'high', 'montañosa': 'very high', 'enorme': 'phenomenal',
};

// Validation tab: labels from validation/compare.ts (kept in Spanish because the tests use them).
export const VAL_EN: Record<string, string> = {
  'directividad integrada por MATLAB frente a 4π·A_ef/λ²·cos θ': 'directivity integrated by MATLAB versus 4π·A_ef/λ²·cos θ',
  'Albersheim es una aproximación (±0,2 dB según su autor)': 'Albersheim is an approximation (±0.2 dB according to its author)',
  'lóbulos muy densos: error de fase relativo ~1e-3 de la geometría parabólica cerrada':
    'very dense lobes: relative phase error ~1e-3 from the closed-form parabolic geometry',
  'radarpropfactor usa Blake (Δ = 2·h·sen θd, blanco lejano y alto: con el blanco bajo la antena subestima Δ ≈ 35 %) y, cerca del horizonte, la región intermedia y de difracción, que la web no modela':
    'radarpropfactor uses Blake (Δ = 2·h·sin θd, distant high target: with the target below the antenna it underestimates Δ by ≈ 35 %) and, near the horizon, the intermediate and diffraction region, which the web does not model',
  'gradiente del primer km (web) frente a radio efectivo promediado en el trayecto (MATLAB)':
    'first-km gradient (web) versus path-averaged effective radius (MATLAB)',
  'la FEM inducida supone corriente sinusoidal; el MoM resuelve la corriente real. Se usa la FEM en el motor por coherencia energética con el diagrama de elemento':
    'induced EMF assumes a sinusoidal current; MoM solves the actual current. The engine uses induced EMF for energy consistency with the element pattern',
  'SNR requerida Swerling 0 (Albersheim) frente a detectability': 'required Swerling 0 SNR (Albersheim) versus detectability',
  'SNR requerida Swerling 1 frente a detectability': 'required Swerling 1 SNR versus detectability',
  'SNR requerida · Pfa = 1e-6 (Swerling 1)': 'Required SNR · Pfa = 1e-6 (Swerling 1)',
  'σ⁰ NRL frente a seareflectivity': 'NRL σ⁰ versus seareflectivity',
  'Antena': 'Antenna', 'Detección': 'Detection', 'Entorno': 'Environment', 'Propagación': 'Propagation',
  'Atenuación': 'Attenuation', 'Refracción': 'Refraction', 'Acoplamiento': 'Coupling',
};
export const VAL_FRAGS: [string, string][] = [
  ['agua de mar', 'seawater'], ['σ⁰ del mar · estado', 'sea σ⁰ · state'], ['Factor de propagación', 'Propagation factor'],
  ['Exacto frente a', 'Exact versus'], ['dos rayos exacto', 'exact two-ray'], ['fuera de los nulos', 'outside the nulls'],
  ['F (lineal)', 'F (linear)'], ['ganancia de pico', 'peak gain'], ['lóbulo principal', 'main lobe'],
  ['lóbulos secundarios', 'sidelobes'], ['(normalizado)', '(normalized)'], ['Patrón', 'Pattern'], ['pesos', 'weights'],
  ['uniforme', 'uniform'], ['dB rel. pico', 'dB rel. peak'], ['acimut', 'azimuth'], ['elevación', 'elevation'],
  ['horizonte', 'horizon'], ['(relativo)', '(relative)'], ['permitividad', 'permittivity'], ['antena', 'antenna'],
  ['blanco', 'target'], ['distancia', 'range'], ['log₁₀ rasante', 'log₁₀ grazing'], ['mar ', 'sea '],
  ['atenuación específica', 'specific attenuation'], ['lluvia', 'rain'], ['atmósfera estándar', 'standard atmosphere'],
  ['refractividad', 'refractivity'], ['factor k', 'k factor'], ['dipolos 0,45λ', '0.45λ dipoles'], ['propia', 'self'],
  ['colineal', 'collinear'], ['lado a lado', 'side by side'], ['Z de FEM inducida', 'Induced-EMF Z'],
  ['FEM inducida', 'induced EMF'], ['núcleo de MoM', 'MoM kernel'], ['elemento central', 'central element'],
  ['plano E', 'E-plane'], ['plano H', 'H-plane'], ['activo frente al barrido', 'active versus scan'], ['activo', 'active'],
  ['ángulo de barrido', 'scan angle'], [' frente a ', ' versus '],
];

// Experiments tab: names coming from the MATLAB JSON files.
export const EXP_FRAGS: [string, string][] = [
  ['solapada', 'overlapped'], ['haces en racimo', 'clustered beams'], ['haces repartidos', 'spread beams'],
  ['0,8', '0.8'], ['solo desfasadores', 'phase shifters only'], ['TTD por subarray', 'TTD per subarray'],
  ['TTD por elemento', 'TTD per element'],
];
