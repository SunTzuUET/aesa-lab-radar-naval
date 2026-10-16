%E6_ROBUSTEZ_FALLOS Face robustness against T/R module failures and calibration errors (E6).
%
%   Question: how much do SLL, gain and pointing of the reference face degrade
%   (80×80, 8×8 subarrays, Taylor −35 dB, 6-bit phase shifters, per-subarray TTD) with failed T/R
%   modules and amplitude/phase errors, and how much does recalibration recover? This is the TFG's
%   future-work line ("tolerances and failures") carried over to the radar.
%
%   A · Random failures (0–20 %) and per-element errors (σ_a, σ_φ). Monte Carlo with 95 % CI against
%       the moment-based theory of web/src/engine/errors.ts, with failure as one more
%       factor: ε = b·g·e^{jδφ}, b ~ Bernoulli(1 − p) →  μ = (1 − p)·e^{s²/2}·e^{−σ_φ²/2},
%       m₂ = (1 − p)·e^{2s²}.  E|F(u)|² = μ²|F₀(u)|² + (m₂ − μ²)·Σa²  (floor ≈ p/((1−p)·η·N)).
%       Metrics: peak SLL, mean far-sidelobe level (|u − u₀| > 0.25), receive gain loss
%       G = |F(u₀)|²/Σ|w|², and pointing error (Newton on the cuts).
%   B · Correlated failure: 1–5 whole subarrays down (one power supply) versus the same
%       number of randomly failed elements.
%   C · Recalibration with realistic hardware:
%       C1 · re-taper of the live modules (attenuator ≤ 1, 0.5 dB steps, 6-bit phase) via
%            FFT-based alternating projections (Keizer, 2008);
%       C2 · error calibration: errors are measured with noise (1°, 0.1 dB) and corrected with the
%            6-bit phase shifters and the attenuator; the residual is compared against theory;
%       C3 · failed subarray: compensation using only the digital weights of the 99 live subarrays,
%            versus element-level re-taper.
%
%   Steering to u₀ = 0.344 (20.1°), on an FFT bin (P = 512) so the peak is measured without
%   sampling error. Outputs: results/fase4/ (figure and CSV) and web/src/data/e6_robustez.json.
%   Deterministic seeds: run_id_to_seed('E6-A'), ('E6-B'), ('E6-C').

clear; startup_if_needed();
t0 = tic;
S = sistema_ref();
Nx = S.face.Nx; Ny = S.face.Ny; L = S.face.subNx; N = Nx * Ny;
bits = S.beam.psBits; qStep = 2 * pi / 2^bits;
outDir = fullfile(fileparts(mfilename('fullpath')), '..', 'results', 'fase4');
dataDir = fullfile(fileparts(mfilename('fullpath')), '..', '..', 'web', 'src', 'data');

% --- ideal face -------------------------------------------------------------------------
tx = taylorwin(Nx, S.beam.nbar, -S.beam.sllDb); tx = tx / max(tx);
ty = taylorwin(Ny, S.beam.nbar, -S.beam.sllDb); ty = ty / max(ty);
A0 = tx * ty.';                                    % amplitudes [Nx × Ny], index (ix, iy)
P = 512;
uAx = mod(-2 * (0:P - 1)' / P + 1, 2) - 1;         % F(m) = Σ w·e^{−j2π·ix·m/P} = Σ w·e^{jπ·ix·u}
u0 = 2 * round(sind(20) * P / 2) / P;              % on a bin
[ix, iy] = ndgrid(0:Nx - 1, 0:Ny - 1);
ixc = floor(ix / L) * L + (L - 1) / 2;             % subarray center (exact TTD at f0)
phiSub = -pi * ixc * u0;
phiRes = -pi * ix * u0 - phiSub;                   % residual applied by the phase shifter
% Dithered quantization (A3): known random phase r_n added before the quantizer. Without it,
% the phase-shifter residual repeats identically across the 100 subarrays and the ideal face
% already sits at −31 dB SLL at 20° (periodic quantization lobes); with it, at −35 dB.
rng(run_id_to_seed('E6-dither')); rD = 2 * pi * rand(Nx, Ny);
Q = @(x) round((x + rD) / qStep) * qStep - rD;
Qnd = @(x) round(x / qStep) * qStep;
W0 = A0 .* exp(1j * (phiSub + Q(phiRes)));
W0nd = A0 .* exp(1j * (phiSub + Qnd(phiRes)));
subId = floor(ix / L) * (Ny / L) + floor(iy / L) + 1;   % subarray of each element (1..100)
nSub = max(subId(:));

[U, V] = ndgrid(uAx, uAx);
uNull = primer_nulo(tx);
ctx.P = P; ctx.i0 = find(abs(uAx - u0) < 1e-12, 1); ctx.j0 = find(abs(uAx) < 1e-12, 1);
ctx.vis = U.^2 + V.^2 <= 1;
ctx.ml = hypot(U - u0, V) < 1.15 * uNull;
ctx.side = ctx.vis & ~ctx.ml;
ctx.far = ctx.vis & hypot(U - u0, V) > 0.25;
ctx.u0 = u0; ctx.ix = (0:Nx - 1)'; ctx.iy = (0:Ny - 1)';
ref = medir(W0, ctx, []);
ctx.ref = ref;
refNd = medir(W0nd, ctx, []);
% coarse grid (P = 256) for the recalibration iterations; measurement always uses P = 512
uR = mod(-2 * (0:255)' / 256 + 1, 2) - 1; [Ur, Vr] = ndgrid(uR, uR);
ctxR.P = 256; ctxR.ml = hypot(Ur - u0, Vr) < 1.15 * uNull; ctxR.side = (Ur.^2 + Vr.^2 <= 1) & ~ctxR.ml;
F0 = abs(fft2(W0, P, P)).^2;
sA = sum(A0(:)); sA2 = sum(A0(:).^2); eta = sA^2 / (N * sA2);
xi = ctx.ix - mean(ctx.ix);
sigU1 = sqrt(sum(A0.^2 .* xi.^2, 'all')) / (pi * sum(A0 .* xi.^2, 'all'));   % σ_u per rad of phase
fprintf('Ideal face (dither): SLL %.1f dB, far sidelobes %.1f dB, η = %.3f, first null u = %.4f · no dither: SLL %.1f dB\n', ...
  ref.sll, 10 * log10(ref.far), eta, uNull, refNd.sll);
F0c = abs(fft2(A0 .* exp(1j * (phiSub + phiRes)), P, P)).^2;     % continuous phase (C2 theory)
teoria = @(p, sa, sp) teoria_momentos(p, sa, sp, F0, ctx, sA2);

% =====================================================================================
% A · random failures and per-element errors, versus theory
% =====================================================================================
rng(run_id_to_seed('E6-A'));
nMC = 100;
pF = [0 1 2 5 10 15 20] / 100;
A_f = barrido(nMC, numel(pF), @(i) caso_aleatorio(W0, pF(i), 0, 0, ctx, Q, phiSub, phiRes, A0));
sP = [0 2.5 5 10 15]; sAm = sP / 10;                % σ_φ (°) and σ_a (dB) together
A_e = barrido(nMC, numel(sP), @(i) caso_aleatorio(W0, 0, sAm(i), sP(i), ctx, Q, phiSub, phiRes, A0));
thF = arrayfun(@(p) teoria(p, 0, 0), pF); thE = arrayfun(@(i) teoria(0, sAm(i), sP(i)), 1:numel(sP));
thSigU = sigU1 * sP * pi / 180;
fprintf('[A] failures p(%%)       %s\n', sprintf('%7.0f', 100 * pF));
fprintf('    peak SLL MC (dB)     %s\n', sprintf('%7.1f', A_f.sll));
fprintf('    far      MC / theory %s\n             %s\n', sprintf('%7.1f', A_f.farDb), sprintf('%7.1f', [thF.farDb]));
fprintf('    loss     MC / theory %s\n             %s\n', sprintf('%7.2f', A_f.loss), sprintf('%7.2f', [thF.loss]));
fprintf('[A] errors   σφ(°)/σa    %s\n', sprintf('%7.1f', sP));
fprintf('    peak SLL MC (dB)     %s\n', sprintf('%7.1f', A_e.sll));
fprintf('    far      MC / theory %s\n             %s\n', sprintf('%7.1f', A_e.farDb), sprintf('%7.1f', [thE.farDb]));
fprintf('    loss     MC / theory %s\n             %s\n', sprintf('%7.3f', A_e.loss), sprintf('%7.3f', [thE.loss]));
fprintf('    σu·1e5   MC / theory %s\n             %s\n', sprintf('%7.2f', 1e5 * A_e.sigU), sprintf('%7.2f', 1e5 * thSigU));

% =====================================================================================
% B · whole subarrays down versus the same number of random elements
% =====================================================================================
rng(run_id_to_seed('E6-B'));
nS = 1:5; nMCb = 100;
B_sub = barrido(nMCb, numel(nS), @(i) caso_subarrays(W0, subId, nSub, nS(i), [], ctx));
B_ele = barrido(nMCb, numel(nS), @(i) caso_aleatorio(W0, nS(i) * L^2 / N, 0, 0, ctx, Q, phiSub, phiRes, A0));
sumSub = accumarray(subId(:), A0(:));
[~, sCen] = max(sumSub);
cen = caso_subarrays(W0, subId, nSub, 1, sCen, ctx);
fprintf('[B] failed subarrays     %s\n', sprintf('%7d', nS));
fprintf('    SLL subarrays (dB)    %s\n', sprintf('%7.1f', B_sub.sll));
fprintf('    SLL elements (dB)     %s\n', sprintf('%7.1f', B_ele.sll));
fprintf('    loss subarrays/elem   %s\n                          %s\n', sprintf('%7.2f', B_sub.loss), sprintf('%7.2f', B_ele.loss));
fprintf('    central subarray (worst case): SLL %.1f dB, loss %.2f dB\n', cen.sll, cen.loss);

% =====================================================================================
% C · recalibration
% =====================================================================================
rng(run_id_to_seed('E6-C'));
nMCc = 10; nIt = 150; mascDb = -37;
% C1 · random failures with re-taper of the live modules
pC = [5 10 20] / 100;
C1 = struct('antes', zeros(nMCc, numel(pC)), 'despues', zeros(nMCc, numel(pC)), ...
  'lossA', zeros(nMCc, numel(pC)), 'lossD', zeros(nMCc, numel(pC)));
for j = 1:numel(pC)
  for r = 1:nMCc
    vivo = true(Nx, Ny); vivo(randperm(N, round(pC(j) * N))) = false;
    m = medir(W0 .* vivo, ctx, []); C1.antes(r, j) = m.sll; C1.lossA(r, j) = m.loss;
    W = recal(W0 .* vivo, vivo, ctxR, 'elemento', nIt, mascDb, W0, subId);
    m = medir(W, ctx, []); C1.sinQ(r, j) = m.sll;
    m = medir(cuantizar_hw(W, phiSub, Q), ctx, []); C1.despues(r, j) = m.sll; C1.lossD(r, j) = m.loss;
  end
end
% C2 · 1 dB / 10° errors calibrated (noisy measurement, correction with 6 bits and a 0.5 dB attenuator)
sa = 1; sp = 10; sm = 1; sma = 0.1; nMC2 = 100;
C2 = zeros(nMC2, 4);
for r = 1:nMC2
  g = 10.^(sa * randn(Nx, Ny) / 20); dp = sp * pi / 180 * randn(Nx, Ny);
  m = medir(W0 .* g .* exp(1j * dp), ctx, []); C2(r, 1:2) = [m.sll m.far];
  gm = g .* 10.^(sma * randn(Nx, Ny) / 20); dpm = dp + sm * pi / 180 * randn(Nx, Ny);
  aC = A0 ./ gm; aC = aC / max(aC(:)); aC = 10.^(round(20 * log10(aC) / 0.5) * 0.5 / 20);
  Wc = aC .* g .* exp(1j * (phiSub + Q(phiRes - dpm) + dp));
  m = medir(Wc, ctx, []); C2(r, 3:4) = [m.sll m.far];
end
resPh = sqrt(sm^2 + (qStep * 180 / pi)^2 / 12); resA = sqrt(sma^2 + 0.5^2 / 12);
thC2 = [teoria(0, sa, sp) teoria_momentos(0, resA, resPh, F0c, ctx, sA2)];
fprintf('[C2] errors %g dB/%g°: far MC %.1f / theory %.1f dB → calibrated MC %.1f / theory %.1f dB (residual %.2f dB, %.2f°)\n', ...
  sa, sp, 10 * log10(mean(C2(:, 2))), thC2(1).farDb, 10 * log10(mean(C2(:, 4))), thC2(2).farDb, resA, resPh);
% C3 · failed subarrays: digital compensation versus element re-taper
nC = 1:3;
C3 = struct('antes', zeros(nMCc, numel(nC)), 'digital', zeros(nMCc, numel(nC)), 'elemento', zeros(nMCc, numel(nC)), ...
  'lossDig', zeros(nMCc, numel(nC)));
for j = 1:numel(nC)
  for r = 1:nMCc
    if nC(j) == 1 && r == 1; caidos = sCen; else; caidos = randperm(nSub, nC(j)); end
    vivo = ~ismember(subId, caidos);
    m = medir(W0 .* vivo, ctx, []); C3.antes(r, j) = m.sll;
    Wd = recal(W0 .* vivo, vivo, ctxR, 'digital', nIt, mascDb, W0, subId);
    m = medir(Wd, ctx, []); C3.digital(r, j) = m.sll; C3.lossDig(r, j) = m.loss;
    We = recal(W0 .* vivo, vivo, ctxR, 'elemento', nIt, mascDb, W0, subId);
    m = medir(We, ctx, []); C3.elemSinQ(r, j) = m.sll;
    m = medir(cuantizar_hw(We, phiSub, Q), ctx, []); C3.elemento(r, j) = m.sll;
  end
end
fprintf('[C1] failures %s %%: SLL before %s → re-taper %s dB (unquantized %s) (loss %s → %s dB)\n', num2str(100 * pC), ...
  sprintf('%6.1f', mean(C1.antes)), sprintf('%6.1f', mean(C1.despues)), sprintf('%6.1f', mean(C1.sinQ)), sprintf('%5.2f', mean(C1.lossA)), sprintf('%5.2f', mean(C1.lossD)));
fprintf('[C2] SLL before %.1f → calibrated %.1f dB\n', mean(C2(:, 1)), mean(C2(:, 3)));
fprintf('[C3] subarrays %s: SLL before %s → digital %s → element %s dB (unquantized %s) (digital loss %s dB)\n', num2str(nC), ...
  sprintf('%6.1f', mean(C3.antes)), sprintf('%6.1f', mean(C3.digital)), sprintf('%6.1f', mean(C3.elemento)), sprintf('%6.1f', mean(C3.elemSinQ)), sprintf('%5.2f', mean(C3.lossDig)));

% =====================================================================================
% Outputs
% =====================================================================================
if ~isfolder(outDir); mkdir(outDir); end
writetable(table(100 * pF', A_f.sll', A_f.sllLo', A_f.sllHi', A_f.farDb', [thF.farDb]', A_f.loss', [thF.loss]', ...
  'VariableNames', {'pct', 'sllDb', 'sllLo', 'sllHi', 'farDb', 'farTeoDb', 'lossDb', 'lossTeoDb'}), fullfile(outDir, 'e6_fallos.csv'));
writetable(table(sP', sAm', A_e.sll', A_e.farDb', [thE.farDb]', A_e.loss', [thE.loss]', A_e.sigU', thSigU', ...
  'VariableNames', {'sigPhDeg', 'sigADb', 'sllDb', 'farDb', 'farTeoDb', 'lossDb', 'lossTeoDb', 'sigU', 'sigUTeo'}), fullfile(outDir, 'e6_errores.csv'));
writetable(table(nS', B_sub.sll', B_ele.sll', B_sub.loss', B_ele.loss', ...
  'VariableNames', {'nSub', 'sllSubDb', 'sllEleDb', 'lossSubDb', 'lossEleDb'}), fullfile(outDir, 'e6_subarrays.csv'));
out = struct('ideal', struct('sllDb', ref.sll, 'farDb', 10 * log10(ref.far), 'eta', eta, 'u0', u0, 'sllSinDitherDb', refNd.sll), ...
  'fallos', struct('pct', 100 * pF, 'sllDb', A_f.sll, 'sllLo', A_f.sllLo, 'sllHi', A_f.sllHi, 'farDb', A_f.farDb, ...
     'farLo', A_f.farLo, 'farHi', A_f.farHi, 'farTeoDb', [thF.farDb], 'lossDb', A_f.loss, 'lossTeoDb', [thF.loss]), ...
  'errores', struct('sigPhDeg', sP, 'sigADb', sAm, 'sllDb', A_e.sll, 'farDb', A_e.farDb, 'farTeoDb', [thE.farDb], ...
     'lossDb', A_e.loss, 'lossTeoDb', [thE.loss], 'sigU', A_e.sigU, 'sigUTeo', thSigU), ...
  'subarrays', struct('n', nS, 'sllSubDb', B_sub.sll, 'sllEleDb', B_ele.sll, 'lossSubDb', B_sub.loss, ...
     'lossEleDb', B_ele.loss, 'centralSllDb', cen.sll), ...
  'recal', struct('fallosPct', 100 * pC, 'fallosAntes', mean(C1.antes), 'fallosDespues', mean(C1.despues), ...
     'erroresAntes', mean(C2(:, 1)), 'erroresDespues', mean(C2(:, 3)), 'subN', nC, 'subAntes', mean(C3.antes), ...
     'subDigital', mean(C3.digital), 'subElemento', mean(C3.elemento)));
write_json(fullfile(dataDir, 'e6_robustez.json'), out);

plot_style(); col = lines(4);
fig = figure('Visible', 'off', 'Position', [100 100 1500 1000]);
tl = tiledlayout(fig, 2, 2, 'TileSpacing', 'compact', 'Padding', 'compact');
% (a) random failures
ax = nexttile(tl); hold(ax, 'on');
x = 100 * pF;
errorbar(ax, x, A_f.sll, A_f.sll - A_f.sllLo, A_f.sllHi - A_f.sll, 'o-', 'Color', col(1, :), 'LineWidth', 1.4, 'DisplayName', 'peak SLL (MC, 95 % CI)');
errorbar(ax, x, A_f.farDb, A_f.farDb - A_f.farLo, A_f.farHi - A_f.farDb, 's', 'Color', col(2, :), 'LineWidth', 1.4, 'DisplayName', 'far sidelobes (MC)');
plot(ax, x, [thF.farDb], '-', 'Color', col(2, :), 'LineWidth', 1.2, 'DisplayName', 'far sidelobes (theory)');
yline(ax, -S.beam.sllDb, 'k--', 'Taylor −35 dB', 'HandleVisibility', 'off', 'LabelHorizontalAlignment', 'left');
xlabel(ax, 'failed T/R modules (%)'); ylabel(ax, 'dB relative to peak'); ylim(ax, [-68 -26]);
legend(ax, 'Location', 'southeast'); grid(ax, 'on'); title(ax, '(a) Random failures');
% (b) amplitude and phase errors
ax = nexttile(tl); hold(ax, 'on');
errorbar(ax, sP, A_e.sll, A_e.sll - A_e.sllLo, A_e.sllHi - A_e.sll, 'o-', 'Color', col(1, :), 'LineWidth', 1.4, 'DisplayName', 'peak SLL (MC, 95 % CI)');
errorbar(ax, sP, A_e.farDb, A_e.farDb - A_e.farLo, A_e.farHi - A_e.farDb, 's', 'Color', col(2, :), 'LineWidth', 1.4, 'DisplayName', 'far sidelobes (MC)');
plot(ax, sP, [thE.farDb], '-', 'Color', col(2, :), 'LineWidth', 1.2, 'DisplayName', 'far sidelobes (theory)');
yline(ax, -S.beam.sllDb, 'k--', 'Taylor −35 dB', 'HandleVisibility', 'off', 'LabelHorizontalAlignment', 'left');
xlabel(ax, 'σ_φ (°), with σ_a = σ_φ/10 dB'); ylabel(ax, 'dB relative to peak'); ylim(ax, [-68 -26]);
legend(ax, 'Location', 'southeast'); grid(ax, 'on'); title(ax, '(b) Per-element amplitude and phase errors');
% (c) whole subarrays versus scattered elements
ax = nexttile(tl); hold(ax, 'on');
errorbar(ax, nS, B_sub.sll, B_sub.sll - B_sub.sllLo, B_sub.sllHi - B_sub.sll, 'o-', 'Color', col(3, :), 'LineWidth', 1.4, 'DisplayName', 'whole subarrays down');
errorbar(ax, nS, B_ele.sll, B_ele.sll - B_ele.sllLo, B_ele.sllHi - B_ele.sll, 's-', 'Color', col(1, :), 'LineWidth', 1.4, 'DisplayName', 'same elements, random');
plot(ax, nC, mean(C3.digital), 'd--', 'Color', col(4, :), 'LineWidth', 1.4, 'DisplayName', 'subarrays: digital compensation');
plot(ax, nC, mean(C3.elemento), '^--', 'Color', col(2, :), 'LineWidth', 1.4, 'DisplayName', 'subarrays: element re-taper');
plot(ax, 1, cen.sll, 'kp', 'MarkerSize', 12, 'MarkerFaceColor', 'k', 'DisplayName', 'central subarray');
yline(ax, -S.beam.sllDb, 'k--', 'HandleVisibility', 'off');
xlabel(ax, 'failed subarrays (64 elements each)'); ylabel(ax, 'peak SLL (dB)'); xlim(ax, [0.7 5.3]); set(ax, 'XTick', 1:5);
legend(ax, 'Location', 'northwest'); grid(ax, 'on'); title(ax, '(c) Correlated versus random failure');
% (d) recalibration
ax = nexttile(tl);
etq = [compose('%g %%', 100 * pC), {sprintf('%g dB / %g°', sa, sp)}, compose('%d', nC)];
antes = [mean(C1.antes) mean(C2(:, 1)) mean(C3.antes)];
desp = [mean(C1.despues) mean(C2(:, 3)) mean(C3.elemento)];
dig = [nan(1, numel(pC) + 1) mean(C3.digital)];
b = bar(ax, [antes; desp; dig]' + 60, 'grouped', 'BaseValue', 0);
b(1).FaceColor = [0.75 0.75 0.75]; b(2).FaceColor = col(2, :); b(3).FaceColor = col(4, :);
set(ax, 'XTickLabel', etq, 'YTick', 0:5:40, 'YTickLabel', compose('%d', (0:5:40) - 60)); xtickangle(ax, 0);
yline(ax, -S.beam.sllDb + 60, 'k--', 'HandleVisibility', 'off');
ylabel(ax, 'peak SLL (dB)'); xlabel(ax, 'failed modules  ·  calibrated errors  ·  failed subarrays'); ylim(ax, [20 40]);
legend(ax, {'not recalibrated', 'recalibrated (element: attenuator + 6 bits)', 'digital weights only'}, 'Location', 'northwest');
grid(ax, 'on'); title(ax, '(d) Recalibration');
save_figure(fig, outDir, 'e6_robustez');
fprintf('Done in %.0f s\n', toc(t0));

% =====================================================================================
function R = barrido(nMC, nCasos, fun)
% Monte Carlo over a family of cases: means with 95 % CI (SLL in dB; far sidelobes linear → dB).
sll = nan(nMC, nCasos); far = sll; loss = sll; du = sll;
for i = 1:nCasos
  for r = 1:nMC
    m = fun(i); sll(r, i) = m.sll; far(r, i) = m.far; loss(r, i) = m.loss; du(r, i) = m.du;
  end
end
[R.sll, R.sllLo, R.sllHi] = mean_ci95(sll, 1);
[fm, flo, fhi] = mean_ci95(far, 1);
R.farDb = 10 * log10(fm); R.farLo = 10 * log10(max(flo, eps)); R.farHi = 10 * log10(fhi);
R.loss = mean(loss, 1); R.sigU = sqrt(mean(du.^2, 1));
end

function m = caso_aleatorio(W0, p, sa, sp, ctx, Q, phiSub, phiRes, A0)
[Nx, Ny] = size(W0); N = Nx * Ny;
vivo = true(Nx, Ny); vivo(randperm(N, round(p * N))) = false;
g = 10.^(sa * randn(Nx, Ny) / 20); dp = sp * pi / 180 * randn(Nx, Ny);
W = A0 .* g .* exp(1j * (phiSub + Q(phiRes) + dp)) .* vivo;
m = medir(W, ctx, ctx.ref);
end

function m = caso_subarrays(W0, subId, nSub, n, cuales, ctx)
if isempty(cuales); cuales = randperm(nSub, n); end
m = medir(W0 .* ~ismember(subId, cuales), ctx, ctx.ref);
end

function m = medir(W, ctx, ref)
F = abs(fft2(W, ctx.P, ctx.P)).^2;
pkMax = max(F(ctx.ml));
m.sll = 10 * log10(max(F(ctx.side)) / pkMax);
m.far = mean(F(ctx.far)) / pkMax;
G = F(ctx.i0, ctx.j0) / sum(abs(W(:)).^2);
m.G = G;
if isfield(ctx, 'ref'); m.loss = 10 * log10(ctx.ref.G / G); else; m.loss = 0; end
% azimuth pointing: Newton on the v = 0 cut
c = sum(W, 2); n = ctx.ix * pi; u = ctx.u0;
for it = 1:4
  e = exp(1j * n * u); F0 = sum(c .* e); F1 = sum(1j * n .* c .* e); F2 = sum(-(n.^2) .* c .* e);
  u = u - real(F1 * conj(F0)) / (real(F2 * conj(F0)) + abs(F1)^2);
end
m.u = u;
if ~isempty(ref); m.du = u - ref.u; else; m.du = 0; end
end

function th = teoria_momentos(p, sa, sp, F0, ctx, sA2)
s = sa * log(10) / 20; sph = sp * pi / 180;
mu = (1 - p) * exp(s^2 / 2) * exp(-sph^2 / 2); m2 = (1 - p) * exp(2 * s^2);
pk = mu^2 * F0(ctx.i0, ctx.j0) + (m2 - mu^2) * sA2;
th.farDb = 10 * log10((mu^2 * mean(F0(ctx.far)) + (m2 - mu^2) * sA2) / pk);
th.loss = -10 * log10(pk / (m2 * sA2) / (F0(ctx.i0, ctx.j0) / sA2));
end

function W = recal(W, vivo, ctx, modo, nIt, mascDb, W0, subId)
% Alternating projections (Keizer): clip sidelobes above the mask in the pattern domain and
% return to weight space under the hardware constraints.
[Nx, Ny] = size(W); mA = 10^(mascDb / 20);
if strcmp(modo, 'digital')
  den = accumarray(subId(:), abs(W0(:)).^2);
  muerto = accumarray(subId(:), ~vivo(:)) > 0;
end
for it = 1:nIt
  F = fft2(W, ctx.P, ctx.P);
  pk = max(abs(F(ctx.ml)));
  idx = ctx.side & abs(F) > mA * pk;
  F(idx) = mA * pk * F(idx) ./ abs(F(idx));
  Wn = ifft2(F); Wn = Wn(1:Nx, 1:Ny);
  if strcmp(modo, 'elemento')
    Wn(~vivo) = 0;
    a = abs(Wn); k = a > 1; Wn(k) = Wn(k) ./ a(k);             % the attenuator can only attenuate
    W = Wn;
  else
    c = accumarray(subId(:), conj(W0(:)) .* Wn(:)) ./ den;    % one digital weight per subarray
    c(muerto) = 0;
    W = W0 .* reshape(c(subId), Nx, Ny);
  end
end
end

function W = cuantizar_hw(W, phiSub, Q)
% 6-bit attenuator (0.5 dB steps, 31.5 dB range) and 6-bit phase shifter on top of the TTD.
a = abs(W); vivo = a > 0;
aDb = max(round(20 * log10(a(vivo) / max(a(:))) / 0.5) * 0.5, -31.5);
a(vivo) = 10.^(aDb / 20);
W = a .* exp(1j * (phiSub + Q(angle(W .* exp(-1j * phiSub))))) .* vivo;
end

function uN = primer_nulo(t)
n = (0:numel(t) - 1)'; u = linspace(0, 0.2, 4001);
p = abs(exp(1j * pi * n * u).' * t).^2;
k = 1; while p(k + 1) < p(k); k = k + 1; end
uN = u(k);
end
