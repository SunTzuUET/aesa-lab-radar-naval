%MC_MONOPULSO Monopulse angle measurement of the face and its errors (antenna engineering).
%
%   Sum beam Σ with the receive weighting (Taylor 35 dB, n̄ = 5) and difference beam Δ formed by
%   halves at subarray level (sign of the subarray center), which is what allows an
%   architecture with one digital channel per subarray. Ratio r = Im{Δ/Σ}; the angle is estimated
%   by inverting the ideal curve (calibration).
%
%   M1 · Ideal curve: slope, normalized slope k·θ₃ and monotonic span.
%   M2 · Thermal noise (Monte Carlo with per-element noise) vs.
%        σ_r² = (σ_Δ² + r²·σ_Σ²)/(2|Σ|²),  σ_θ = σ_r / (dr/dθ).
%   M3 · Random amplitude and phase errors (element and subarray): on-axis bias vs. the
%        first-order prediction (only phase errors bias the on-axis ratio).
%   M4 · Gain mismatch g and phase mismatch ψ between the Σ and Δ channels: slope change g·cos ψ and
%        bias g·sin ψ·Re{δΔ/Σ} due to amplitude errors.
%   M5 · Mutual coupling (dipoles over ground, induced EMF): exact solution (Z + Zs)⁻¹ vs.
%        the web's active-impedance approximation; bias vs. scan angle.
%   Outputs: results/fase1/monopulso.json and web/src/validation/ref_monopulso.json.

clear; startup_if_needed();
t0 = tic;
S = sistema_ref();
lam = S.face.lambda; k = 2 * pi / lam; d = lam / 2;
cara = @(nSub) geometria(nSub, 8, d);
out = struct();

% ── M1: ideal curve ──
G = cara(10);
a = kron(taylorwin(G.ny, 5, -35), taylorwin(G.nx, 5, -35).'); a = reshape(a.', [], 1);   % n = iy·Nx + ix
dd = (-3:0.005:3).';
for az0 = [0 30]
  [wS, wD, ~] = pesos(G, a, az0, 0, k);
  M = monopulso_curva(G.x, G.y, wS, wD, dd, az0, 0, 'az', k);
  P = abs(M.S).^2 / max(abs(M.S).^2);
  th3 = ancho3db(dd, P);
  [~, i0] = min(abs(dd)); kd = (M.r(i0 + 1) - M.r(i0 - 1)) / (2 * 0.005);
  rango = tramo(dd, M.r);
  out.M1(1 + (az0 > 0)) = struct('az0', az0, 'theta3Deg', th3, 'pendientePorGrado', kd, 'pendienteNorm', kd * th3, 'tramoDeg', rango);
  fprintf('[M1] az0 = %2d°: θ₃ = %.3f°, slope %.3f /° (normalized k·θ₃ = %.3f), monotonic span ±%.2f°\n', az0, th3, kd, kd * th3, rango);
end

% ── M2: thermal noise ──
rng(run_id_to_seed('M2'));
[wS, wD, ~] = pesos(G, a, 0, 0, k);
Mi = monopulso_curva(G.x, G.y, wS, wD, dd, 0, 0, 'az', k); th3 = out.M1(1).theta3Deg;
offs = [0 th3 / 4]; snrs = [10 20 30];
pS = sum(abs(wS).^2);
for io = 1:numel(offs)
  Md = monopulso_curva(G.x, G.y, wS, wD, offs(io), 0, 0, 'az', k);
  M0 = monopulso_curva(G.x, G.y, wS, wD, 0, 0, 0, 'az', k);
  for is = 1:numel(snrs)
    A = sqrt(10^(snrs(is) / 10) * pS) / abs(M0.S);
    est = [];
    for b = 1:8
      n = (randn(G.N, 1000) + 1j * randn(G.N, 1000)) / sqrt(2);
      sS = A * Md.S + wS.' * n; sD = A * Md.D + wD.' * n;
      est = [est, monopulso_invertir(dd, Mi.r, imag(sD ./ sS))]; %#ok<AGROW>
    end
    medido = std(est);
    % prediction: σ_r² = (σ_Δ² + r²σ_Σ²)/(2|Σ|²) and local slope
    r = Md.r; sig2 = sum(abs(wD).^2); sigS = pS;
    sr = sqrt((sig2 + r^2 * sigS) / (2 * abs(A * Md.S)^2));
    pend = interp1(dd(1:end - 1) + 0.0025, diff(Mi.r) / 0.005, offs(io));
    pred = sr / pend;
    out.M2(io, is) = struct('offsetDeg', offs(io), 'snrDb', snrs(is), 'sigmaMedidaDeg', medido, 'sigmaPredDeg', pred, 'sesgoDeg', mean(est) - offs(io));
    fprintf('[M2] offset %.3f°, SNR %d dB: measured σ %.4f° · predicted %.4f° (θ₃/σ = %.0f) · bias %+.4f°\n', ...
      offs(io), snrs(is), medido, pred, th3 / medido, mean(est) - offs(io));
  end
end

% ── M3 and M4: hardware errors and Σ/Δ mismatch ──
rng(run_id_to_seed('M3'));
sAe = 0.5; sPe = 5; sAs = 0.3; sPs = 3;                % dB, °, dB, ° (σ)
psis = [0 5 10 20]; gDb = 0.5;
nR = 400; sesgo = zeros(nR, numel(psis)); rmsq = zeros(nR, 1);
dq = linspace(-th3 / 4, th3 / 4, 21).';
M0 = monopulso_curva(G.x, G.y, wS, wD, 0, 0, 0, 'az', k); s0 = real(M0.S);
for r = 1:nR
  gs = 10.^(sAs * randn(G.nSub, 1) / 20);
  ge = 10.^(sAe * randn(G.N, 1) / 20) .* gs(G.sub);
  pe = sPe * pi / 180 * randn(G.N, 1); ps = sPs * pi / 180 * randn(G.nSub, 1); pe = pe + ps(G.sub);
  wSe = wS .* ge .* exp(1j * pe); wDe = wD .* ge .* exp(1j * pe);
  Me = monopulso_curva(G.x, G.y, wSe, wDe, [0; dq], 0, 0, 'az', k);
  q = Me.D(1) / Me.S(1);
  for ip = 1:numel(psis)
    gg = 10^(gDb / 20) * exp(1j * psis(ip) * pi / 180);
    sesgo(r, ip) = monopulso_invertir(dd, Mi.r, imag(gg * q));
  end
  rmsq(r) = sqrt(mean((monopulso_invertir(dd, Mi.r, Me.r(2:end)) - dq).^2));
end
% on-axis prediction (real ideal Σ s0): Im{δΔ}/Σ from phase, Re{δΔ}/Σ from amplitude
wa = abs(wS); As = accumarray(G.sub, wa);
Vp = (sPe * pi / 180)^2 * sum(wa.^2) + (sPs * pi / 180)^2 * sum(As.^2);
Va = (sAe * log(10) / 20)^2 * sum(wa.^2) + (sAs * log(10) / 20)^2 * sum(As.^2);
[~, i0] = min(abs(dd)); kd = (Mi.r(i0 + 1) - Mi.r(i0 - 1)) / 0.01;
g = 10^(gDb / 20);
for ip = 1:numel(psis)
  pred = g * sqrt(cosd(psis(ip))^2 * Vp + sind(psis(ip))^2 * Va) / s0 / kd;
  out.M34(ip) = struct('psiDeg', psis(ip), 'gDb', gDb, 'sesgoStdDeg', std(sesgo(:, ip)), 'sesgoPredDeg', pred);
  fprintf('[M3/M4] g = %.1f dB, ψ = %2d°: on-axis bias σ %.4f° · predicted %.4f°\n', gDb, psis(ip), std(sesgo(:, ip)), pred);
end
out.M3 = struct('sigmas', [sAe sPe sAs sPs], 'rmsErrorQuartoDeg', sqrt(mean(rmsq.^2)), 'theta3Deg', th3);
fprintf('[M3] RMS error over ±θ₃/4 with hardware errors: %.4f° (θ₃/%.0f)\n', out.M3.rmsErrorQuartoDeg, th3 / out.M3.rmsErrorQuartoDeg);
% slope with mismatch: g·cos ψ (exact for a point target and error-free weights)
pend = arrayfun(@(p) mean(diff(imag(g * exp(1j * p * pi / 180) * Mi.D(i0 - 2:i0 + 2) ./ Mi.S(i0 - 2:i0 + 2)))) / 0.005 / kd, psis);
out.M4 = struct('psiDeg', psis, 'pendienteRel', pend, 'pendienteTeo', g * cosd(psis));
fprintf('[M4] measured relative slope %s · g·cos ψ %s\n', mat2str(pend, 4), mat2str(g * cosd(psis), 4));

% ── M5: mutual coupling ──
L = 0.45 * lam; ar = lam / 400; hg = lam / 4; f0 = S.face.f0;
scans = 0:10:60;
ref = struct('nSub', {}, 'az0', {}, 'sesgoAproxDeg', {}, 'sesgoExactoDeg', {}, 'pendAprox', {}, 'pendExacta', {}, 'rAprox', {}, 'rExacto', {}, 'd', {});
for nSub = [4 6 8 10]
  Gc = cara(nSub);
  ac = kron(taylorwin(Gc.ny, 5, -35), taylorwin(Gc.nx, 5, -35).'); ac = reshape(ac.', [], 1);
  Z = z_tabla(Gc, k, L, ar, hg, d);
  if nSub == 4   % check of the table-based construction
    fprintf('[M5] table-based Z vs. matriz_z_dipolos.m: relative error %.1e\n', ...
      norm(Z - matriz_z_dipolos(Gc.x, Gc.y, f0, L, ar, hg), 'fro') / norm(Z, 'fro'));
  end
  ctr = (Gc.ny / 2) * Gc.nx + Gc.nx / 2 + 1;
  zRef = sum(Z(ctr, :)); Zs = conj(zRef);
  Zl = Z; Zl(1:Gc.N + 1:end) = Zl(1:Gc.N + 1:end) + Zs;
  Fz = decomposition(Zl); clear Zl
  ddc = (-1.5:0.005:1.5).' * 80 / Gc.nx;
  for az0 = scans
    [wS, wD] = pesos(Gc, ac, az0, 0, k);
    Mi = monopulso_curva(Gc.x, Gc.y, wS, wD, ddc, az0, 0, 'az', k);
    % exact: I = (Z + Zs)⁻¹·(Zs + Zref)·w
    ISx = Fz \ (wS * (Zs + zRef)); IDx = Fz \ (wD * (Zs + zRef));
    % active-impedance approximation: I_n = w_n·(Zs + Zref)/(Zs + (Zw)_n/w_n)
    apr = @(w) w .* (Zs + zRef) ./ (Zs + (Z * w) ./ w);
    ISa = apr(wS); IDa = apr(wD);
    dq = [0; 0.1; -0.1] * 80 / Gc.nx;
    Mx = monopulso_curva(Gc.x, Gc.y, ISx, IDx, dq, az0, 0, 'az', k);
    Ma = monopulso_curva(Gc.x, Gc.y, ISa, IDa, dq, az0, 0, 'az', k);
    [~, j0] = min(abs(ddc)); kd0 = (Mi.r(j0 + 1) - Mi.r(j0 - 1)) / (ddc(j0 + 1) - ddc(j0 - 1));
    ref(end + 1) = struct('nSub', nSub, 'az0', az0, ...
      'sesgoAproxDeg', monopulso_invertir(ddc, Mi.r, Ma.r(1)), 'sesgoExactoDeg', monopulso_invertir(ddc, Mi.r, Mx.r(1)), ...
      'pendAprox', (Ma.r(2) - Ma.r(3)) / (dq(2) - dq(3)) / kd0, 'pendExacta', (Mx.r(2) - Mx.r(3)) / (dq(2) - dq(3)) / kd0, ...
      'rAprox', Ma.r.', 'rExacto', Mx.r.', 'd', dq.'); %#ok<SAGROW>
    fprintf('[M5] %2d×%2d, az0 = %2d°: exact bias %+.4f° · approximate %+.4f° · relative slope %.4f / %.4f\n', ...
      Gc.nx, Gc.ny, az0, ref(end).sesgoExactoDeg, ref(end).sesgoAproxDeg, ref(end).pendExacta, ref(end).pendAprox);
  end
end
out.M5 = ref;

root = fileparts(fileparts(mfilename('fullpath')));
od = fullfile(root, 'results', 'fase1'); if ~exist(od, 'dir'), mkdir(od); end
write_json(fullfile(od, 'monopulso.json'), out);
% web reference: ideal 80×80 curve (az0 = 0 and 30) and 32×32 coupling
G = cara(10); cur = struct('az0', {}, 'eje', {}, 'd', {}, 'r', {});
for az0 = [0 30]
  [wS, wD, wDe] = pesos(G, a, az0, 0, k);
  dv = (-1:0.25:1);
  M = monopulso_curva(G.x, G.y, wS, wD, dv, az0, 0, 'az', k); cur(end + 1) = struct('az0', az0, 'eje', 'az', 'd', dv, 'r', M.r.'); %#ok<SAGROW>
  M = monopulso_curva(G.x, G.y, wS, wDe, dv, az0, 0, 'el', k); cur(end + 1) = struct('az0', az0, 'eje', 'el', 'd', dv, 'r', M.r.'); %#ok<SAGROW>
end
write_json(fullfile(web_validation_dir(), 'ref_monopulso.json'), struct('curvas', cur, 'm1', out.M1, 'm2', out.M2, 'm34', out.M34));
fprintf('mc_monopulso: %.0f s\n', toc(t0));

function Z = z_tabla(G, k, L, a, h, d)
%Z_TABLA Face Z matrix built from the table Z(|Δix|, |Δiy|) (block Toeplitz; same kernel
%   as matriz_z_dipolos.m without forming the N² separations in z_mutua_dipolos, which does not fit in memory).
[ii, jj] = meshgrid(0:G.nx - 1, 0:G.ny - 1);
dx = ii * d; dy = jj * d; rho = dy; rho(1, 1) = a;
T = z_mutua_dipolos(k, L, dx, rho) - z_mutua_dipolos(k, L, dx, hypot(dy, 2 * h));
ix = int32(mod((0:G.N - 1).', G.nx)); iy = int32(floor((0:G.N - 1).' / G.nx));
Z = complex(zeros(G.N));
for c = 1:G.N
  Z(:, c) = T(abs(iy - iy(c)) + 1 + G.ny * abs(ix - ix(c)));
end
end

function G = geometria(nSub, nE, d)
%GEOMETRIA Square face of nSub×nSub subarrays of nE×nE, ordering n = iy·Nx + ix (as in the web).
G.nx = nSub * nE; G.ny = G.nx; G.N = G.nx * G.ny; G.nSub = nSub^2;
[ix, iy] = meshgrid(0:G.nx - 1, 0:G.ny - 1); ix = reshape(ix.', [], 1); iy = reshape(iy.', [], 1);
G.x = (ix - (G.nx - 1) / 2) * d; G.y = (iy - (G.ny - 1) / 2) * d;
sx = floor(ix / nE); sy = floor(iy / nE);
G.sub = sy * nSub + sx + 1;
G.xc = ((sx + 0.5) * nE - G.nx / 2) * d; G.yc = ((sy + 0.5) * nE - G.ny / 2) * d;
end

function [wS, wD, wDe] = pesos(G, a, az0, el0, k)
%PESOS Σ with steering phase; azimuth and elevation Δ from the sign of the subarray center.
u0 = cosd(el0) * sind(az0); v0 = sind(el0);
wS = a .* exp(-1j * k * (G.x * u0 + G.y * v0));
wD = sign(G.xc) .* wS; wDe = sign(G.yc) .* wS;
end

function th = ancho3db(d, P)
i = find(P >= 0.5); th = d(i(end)) - d(i(1));
end

function r = tramo(d, rr)
[~, i0] = min(abs(d)); b = i0; while b < numel(rr) && rr(b + 1) > rr(b), b = b + 1; end
r = d(b);
end
