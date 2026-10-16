%VAL_RADAR Reference vectors for the radar equation, detection and horizon.
%
%   Generates web/src/validation/ref_radar.json with:
%     - single-pulse SNR with radareqsnr (Radar Toolbox) for several cases;
%     - required SNR with detectability (Swerling 0 and 1, single pulse);
%     - radar horizon with horizonrange (k = 4/3).

clear; startup_if_needed();
S = sistema_ref();
lam = S.face.lambda;

% --- radar equation ------------------------------------------------------------
casos = [ % Pt (W)   tau (s)   Gt (dBi)  Gr (dBi)  RCS (m²)  NF (dB)  L (dB)
  96000    100e-6    42.5      41.1      1         3         6
  96000    100e-6    42.5      41.1      0.1       3         6
  50000    20e-6     38        36        10        4         8
  5000     1e-6      30        30        0.01      2         3
];
R = [10e3 50e3 100e3 200e3 400e3];
eq = struct('pt', {}, 'tau', {}, 'gt', {}, 'gr', {}, 'rcs', {}, 'nf', {}, 'loss', {}, 'R', {}, 'snr', {});
for i = 1:size(casos, 1)
  c = num2cell(casos(i, :));
  [Pt, tau, Gt, Gr, rcs, nf, L] = c{:};
  Ts = S.T0 * 10^(nf / 10);
  snr = arrayfun(@(r) radareqsnr(lam, r, Pt, tau, 'Gain', [Gt Gr], 'RCS', rcs, 'Ts', Ts, 'Loss', L), R);
  eq(end + 1) = struct('pt', Pt, 'tau', tau, 'gt', Gt, 'gr', Gr, 'rcs', rcs, 'nf', nf, 'loss', L, 'R', R, 'snr', snr); %#ok<SAGROW>
end

% --- detection (single pulse, square-law detector) ------------------------------
pd = [0.5 0.6 0.7 0.8 0.9 0.95 0.99];
pfa = [1e-4 1e-6 1e-8];
det = struct('pfa', {}, 'pd', {}, 'sw0', {}, 'sw1', {});
for j = 1:numel(pfa)
  s0 = arrayfun(@(p) detectability(p, pfa(j), 1, 'Swerling0'), pd);
  s1 = arrayfun(@(p) detectability(p, pfa(j), 1, 'Swerling1'), pd);
  det(end + 1) = struct('pfa', pfa(j), 'pd', pd, 'sw0', s0, 'sw1', s1); %#ok<SAGROW>
end

% --- horizon ------------------------------------------------------------------
Re = 4/3 * S.earthR;
h = [5 10 20 30 40];
hor = struct('Re', Re, 'h', h, 'R', horizonrange(h, Re));

out.meta = struct('generado', char(datetime('now', 'Format', 'yyyy-MM-dd HH:mm')), 'matlab', version, ...
  'toolbox', 'Radar Toolbox', 'lambda', lam, 'T0', S.T0);
out.ecuacion = eq;
out.deteccion = det;
out.horizonte = hor;
write_json(fullfile(web_validation_dir(), 'ref_radar.json'), out);
disp(out.deteccion(2).sw1);
