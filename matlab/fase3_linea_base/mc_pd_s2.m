%MC_PD_S2 Signal-level chain and Monte Carlo Pd (plan step P2).
%
%   A · Ideal chain: no clutter, rectangular window, target centered in the cell.
%       Measured Pd must match Swerling 1 theory (Pd = Pfa^(1/(1+SNR)))
%       within the 95 % CI. Validates the signal simulation and processing.
%   B · Realistic S2: 0.1 m² sea-skimming missile at 7 m, sea state 5 with clutter of
%       Gaussian Doppler spectrum, target at a random position within the cell
%       (straddle losses), Chebyshev window and 2D CA-CFAR. Measures Pd and the
%       equivalent processing loss relative to the analytic curve.
%
%   Lower-bound waveform: LFM chirp τ = 20 µs, B = 5 MHz, PRF 2.5 kHz, 16 pulses.
%   Outputs: results/fase3/ (figures) and web/src/data/senal_s2.json (for the web).
%   Deterministic seeds: run_id_to_seed('P2-A') and run_id_to_seed('P2-B').

clear; startup_if_needed();
t0 = tic;
S = sistema_ref();
% S2 scenario (same values as web/src/engine/scenarios.ts)
S.env.windMs = 12; S.env.swellHm = 1.5; S.env.swellTs = 10; S.env.rhPct = 82;
S.env.tempC = 18; S.env.seaTempC = 20; S.env.pol = 'H';
S.radar.rcsM2 = 0.1; S.radar.hTargetM = 7;

W.tau = 20e-6; W.B = 5e6; W.fs = 2 * W.B; W.prf = 2.5e3; W.np = 16;
wf = phased.LinearFMWaveform('SampleRate', W.fs, 'PulseWidth', W.tau, 'SweepBandwidth', W.B, ...
  'PRF', W.prf, 'NumPulses', 1);
x = wf(); s = x(1:round(W.tau * W.fs)); s = s / norm(s);
lam = S.face.lambda; pri = 1 / W.prf; Np = W.np; c = S.c0;
pfa = 1e-6; nWin = 160; dS = c / (2 * W.fs);      % meters per output sample
outDir = fullfile(fileparts(mfilename('fullpath')), '..', 'results', 'fase3');

% =====================================================================================
% A · ideal chain versus theory
% =====================================================================================
rng(run_id_to_seed('P2-A'));
snrIntDb = 0:2:28; nA = 2000;
kBin = 3; colT = mod(kBin + Np / 2, Np) + 1;      % target Doppler column after fftshift
idxT = nWin / 2;
win = ones(Np, 1);
T = -log(pfa) * sum(abs(win).^2);                 % threshold with known noise power
P = struct('s', s, 'nWin', nWin, 'nPulses', Np, 'pri', pri, 'lam', lam, ...
  'tgt', struct('idx', idxT, 'snr1', 0, 'fd', kBin * W.prf / Np, 'swerling', 1, 'on', true), ...
  'clut', struct('cnr', zeros(nWin, 1), 'sigmaF', 0, 'fc', 0, 'on', false));
detA = zeros(size(snrIntDb)); faA = 0; cellsA = 0;
for i = 1:numel(snrIntDb)
  P.tgt.snr1 = 10^(snrIntDb(i) / 10) / Np;
  for k = 1:nA
    Z = proc_cpi(sim_cpi(P), s, win);
    detA(i) = detA(i) + (Z(idxT, colT) > T);
    msk = true(size(Z)); msk(:, colT) = false;      % outside the target column (its range sidelobes are not false alarms)
    faA = faA + nnz(Z(msk) > T); cellsA = cellsA + nnz(msk);
  end
end
[pdA, loA, hiA] = binom_ci95(detA, nA);
pdThA = pfa .^ (1 ./ (1 + 10.^(snrIntDb / 10)));
[pfaA, pfaLo, pfaHi] = binom_ci95(faA, cellsA);
dentro = pdThA >= loA & pdThA <= hiA;
fprintf('[A] Theoretical Pd within the 95 %% CI at %d of %d points · measured Pfa %.2e [%.2e, %.2e]\n', ...
  nnz(dentro), numel(dentro), pfaA, pfaLo, pfaHi);

% =====================================================================================
% B · realistic S2
%   B1: nominal target (0.1 m²) versus range, with clutter and CA-CFAR.
%   B2: in 4 clutter conditions the target SNR is swept so that Pd crosses the
%       transition, and the equivalent processing loss is fitted (with and without clutter).
% =====================================================================================
rng(run_id_to_seed('P2-B'));
Rg = (1:0.05:32) * 1e3;                            % grid for the per-sample CNR
Bg = presupuesto_s2(S, W, Rg);
sigmaV = 0.12 * S.env.windMs;                      % clutter velocity spread (assumed)
winB = chebwin(Np, 50);
TB = -log(pfa) * sum(winB.^2);
cfar = phased.CFARDetector2D('TrainingBandSize', [10 1], 'GuardBandSize', [2 1], ...
  'ProbabilityFalseAlarm', pfa, 'Method', 'CA', 'ThresholdFactor', 'Auto');
cnrLin = 10.^(Bg.cnrDb / 10); cnrLin(~isfinite(Bg.cnrDb)) = 0;
P.clut.sigmaF = 2 * sigmaV / lam; P.clut.fc = 0;
ctx = struct('s', s, 'win', winB, 'T', TB, 'cfar', cfar, 'prf', W.prf, 'lam', lam, 'Np', Np, ...
  'nWin', nWin, 'dS', dS, 'Rg', Rg, 'cnr', cnrLin);

% --- B1 · nominal versus range ---------------------------------------------------------
Rkm = 4:2:28; nB = 300;
Bt = presupuesto_s2(S, W, Rkm * 1e3);
detI = zeros(size(Rkm)); detC = zeros(size(Rkm));
for i = 1:numel(Rkm)
  for k = 1:nB
    [dI, dC] = ensayo_b(P, ctx, Rkm(i) * 1e3, 10^(Bt.snr1Db(i) / 10), true);
    detI(i) = detI(i) + dI; detC(i) = detC(i) + dC;
  end
  fprintf('[B1] R = %2d km · integrated SNR %5.1f dB · CNR %6.1f dB · ideal Pd %.2f · CFAR %.2f\n', Rkm(i), ...
    Bt.snr1Db(i) + 10 * log10(Np), Bt.cnrDb(i), detI(i) / nB, detC(i) / nB);
end
[pdI, loI, hiI] = binom_ci95(detI, nB);
[pdC, loC, hiC] = binom_ci95(detC, nB);
pdThB = pfa .^ (1 ./ (1 + 10.^((Bt.snr1Db + 10 * log10(Np)) / 10)));

% --- B2 · processing loss --------------------------------------------------------------
Rsel = [8 12 16 22]; snrSw = 4:2:30; nB2 = 300;
Bs = presupuesto_s2(S, W, Rsel * 1e3);
pdTh2 = pfa .^ (1 ./ (1 + 10.^(snrSw / 10)));
b2 = struct('Rkm', {}, 'cnrDb', {}, 'pdCfar', {}, 'loCfar', {}, 'hiCfar', {}, 'pdLimpio', {}, ...
  'loLimpio', {}, 'hiLimpio', {}, 'perdidaDb', {}, 'perdidaLimpioDb', {});
for i = 1:numel(Rsel)
  dC = zeros(size(snrSw)); dN = zeros(size(snrSw));
  for j = 1:numel(snrSw)
    snr1 = 10^(snrSw(j) / 10) / Np;
    for k = 1:nB2
      [~, c1] = ensayo_b(P, ctx, Rsel(i) * 1e3, snr1, true);
      [~, c0] = ensayo_b(P, ctx, Rsel(i) * 1e3, snr1, false);
      dC(j) = dC(j) + c1; dN(j) = dN(j) + c0;
    end
  end
  [pc, lc, hc] = binom_ci95(dC, nB2); [pn, ln, hn] = binom_ci95(dN, nB2);
  Lc = ajusta_perdida(snrSw, pc, pfa); Ln = ajusta_perdida(snrSw, pn, pfa);
  b2(end + 1) = struct('Rkm', Rsel(i), 'cnrDb', Bs.cnrDb(i), 'pdCfar', pc, 'loCfar', lc, 'hiCfar', hc, ...
    'pdLimpio', pn, 'loLimpio', ln, 'hiLimpio', hn, 'perdidaDb', Lc, 'perdidaLimpioDb', Ln); %#ok<SAGROW>
  fprintf('[B2] R = %2d km · CNR %6.1f dB · equivalent loss %.2f dB (without clutter %.2f dB)\n', Rsel(i), Bs.cnrDb(i), Lc, Ln);
end
% theoretical reference losses: window (coherent) and CFAR (CA, Swerling 1 with N reference cells)
lossWin = -10 * log10(sum(winB)^2 / (Np * sum(winB.^2)));
Nref = (2 * (10 + 2) + 1) * (2 * (1 + 1) + 1) - (2 * 2 + 1) * (2 * 1 + 1);

% =====================================================================================
% Snapshot for the web: range-Doppler map and profile before and after compression
% =====================================================================================
rng(run_id_to_seed('P2-snap'));
Rs = 12e3;
nSnap = 400; idx = nSnap / 2 + 0.3; v = 290;
rs = Rs + ((1:nSnap).' - idx) * dS;
Ps = P; Ps.nWin = nSnap; Ps.clut.on = true;
Ps.tgt = struct('idx', idx, 'snr1', 10^(28 / 10) / Np, 'fd', 2 * v / lam, 'swerling', 0, 'on', true);
Ps.clut.cnr = interp1(Rg, cnrLin, rs, 'linear', 0);
Xs = sim_cpi(Ps);
Zs = proc_cpi(Xs, s, winB);
% single-pulse profile without clutter and with high SNR to show the compression gain
Pp = Ps; Pp.clut.on = false; Pp.nPulses = 1; Pp.tgt.snr1 = 10^(30 / 10);
Xp = sim_cpi(Pp);
Ys = conv(Xp(:, 1), conj(flipud(s)), 'valid');
snap.rangeKm = rs.' / 1e3;
snap.dopplerHz = ((0:Np - 1) - Np / 2) * W.prf / Np;
snap.rdDb = round(10 * log10(Zs / sum(winB.^2)).', 2);           % rows = Doppler, relative to noise
snap.rawDb = round(20 * log10(abs(Xp(numel(s):end, 1))).', 2);   % aligned with the filter output
snap.mfDb = round(20 * log10(abs(Ys)).', 2);
snap.tgtKm = Rs / 1e3; snap.tgtSnrIntDb = 28; snap.cnrDb = interp1(Rg, Bg.cnrDb, Rs); snap.tgtFdHz = mod(2 * v / lam + W.prf / 2, W.prf) - W.prf / 2;
snap.chirpI = real(s.' / max(abs(s))); snap.chirpQ = imag(s.' / max(abs(s)));

% =====================================================================================
% Outputs
% =====================================================================================
out.meta = struct('generado', char(datetime('now', 'Format', 'yyyy-MM-dd HH:mm')), 'matlab', version, ...
  'tau', W.tau, 'B', W.B, 'fs', W.fs, 'prf', W.prf, 'np', Np, 'pfa', pfa, 'ventana', 'Chebyshev 50 dB', ...
  'cfar', 'CA 2D · entrenamiento [10 1] · guarda [2 1]', 'sigmaV', sigmaV, 'nA', nA, 'nB', nB, 'nB2', nB2, 'perdidaVentanaDb', lossWin, 'celdasRefCfar', Nref, ...
  'Gt', Bt.Gt, 'Gr', Bt.Gr, 'hpbwAz', Bt.hpbwAz, 'seaState', Bt.seaState, 'sigmaH', Bt.sigmaH, ...
  'segundos', toc(t0));
out.ideal = struct('snrIntDb', snrIntDb, 'pd', pdA, 'lo', loA, 'hi', hiA, 'pdTh', pdThA, ...
  'pfa', pfaA, 'pfaLo', pfaLo, 'pfaHi', pfaHi, 'celdas', cellsA);
out.s2 = struct('Rkm', Rkm, 'snrIntDb', Bt.snr1Db + 10 * log10(Np), 'cnrDb', Bt.cnrDb, 'FdB', Bt.FdB, ...
  'pdTh', pdThB, 'pdIdeal', pdI, 'loIdeal', loI, 'hiIdeal', hiI, 'pdCfar', pdC, 'loCfar', loC, 'hiCfar', hiC);
out.perdida = struct('snrIntDb', snrSw, 'pdTh', pdTh2, 'casos', b2);
out.snap = snap;
dataDir = fullfile(fileparts(mfilename('fullpath')), '..', '..', 'web', 'src', 'data');
write_json(fullfile(dataDir, 'senal_s2.json'), out);

fig = figure('Visible', 'off', 'Position', [100 100 1100 420]);
subplot(1, 2, 1);
errorbar(snrIntDb, pdA, pdA - loA, hiA - pdA, 'o'); hold on; plot(snrIntDb, pdThA, '-'); grid on;
xlabel('Integrated SNR (dB)'); ylabel('P_d'); title('A · ideal chain vs. Swerling 1'); legend('Monte Carlo (95 % CI)', 'theory', 'Location', 'southeast');
subplot(1, 2, 2);
plot(snrSw, pdTh2, 'k-', 'LineWidth', 1.5); hold on;
for i = 1:numel(b2), plot(snrSw, b2(i).pdCfar, 'o-'); end
grid on; xlabel('Integrated SNR (dB)'); ylabel('P_d'); title('B2 · CA-CFAR with clutter');
legend(['theory', arrayfun(@(b) sprintf('%d km (%.1f dB)', b.Rkm, b.perdidaDb), b2, 'UniformOutput', false)], 'Location', 'southeast');
save_figure(fig, outDir, 'p2_pd_monte_carlo');
fprintf('[mc_pd_s2] %.0f s\n', toc(t0));

% =====================================================================================
function [dIdeal, dCfar] = ensayo_b(P, c, R, snr1, conClutter)
%ENSAYO_B One CPI with the target at random position and velocity; detection in neighboring cells.
idx = c.nWin / 2 + rand;                           % random position within the cell
v = 250 + 80 * rand;                               % closing radial velocity (m/s)
rs = R + ((1:c.nWin).' - idx) * c.dS;              % range of each output sample
P.tgt = struct('idx', idx, 'snr1', snr1, 'fd', 2 * v / c.lam, 'swerling', 1, 'on', true);
P.clut.on = conClutter;
P.clut.cnr = interp1(c.Rg, c.cnr, rs, 'linear', 0);
Z = proc_cpi(sim_cpi(P), c.s, c.win);
% target Doppler cell (with aliasing) and circular centering (Doppler is periodic)
fa = mod(2 * v / c.lam + c.prf / 2, c.prf) - c.prf / 2;
col = round(fa / (c.prf / c.Np)) + c.Np / 2 + 1; col = mod(col - 1, c.Np) + 1;
Zc = circshift(Z, [0, c.Np / 2 + 1 - col]);
r0 = floor(idx); rows = [r0 r0 + 1]; cols = c.Np / 2 + 1 + [-1 0 1];
cut = [repelem(rows, numel(cols)); repmat(cols, 1, numel(rows))];
dIdeal = any(Zc(sub2ind(size(Zc), cut(1, :), cut(2, :))) > c.T);
dCfar = any(c.cfar(Zc, cut));
end

function L = ajusta_perdida(snrDb, pd, pfa)
%AJUSTA_PERDIDA Loss L (dB) that best fits Pd(SNR) = Pfa^(1/(1 + SNR·10^(−L/10))).
m = pd > 0.02 & pd < 0.98;
if nnz(m) < 2, L = NaN; return; end
f = @(L) sum((pd(m) - pfa .^ (1 ./ (1 + 10.^((snrDb(m) - L) / 10)))).^2);
L = fminbnd(f, -5, 20);
end
