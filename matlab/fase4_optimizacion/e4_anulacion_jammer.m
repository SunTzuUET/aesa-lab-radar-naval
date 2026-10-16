%E4_ANULACION_JAMMER Adaptive nulling of noise jammers at subarray level (experiment E4, step P3).
%
%   Question: how many noise jammers can the subarrayed face null with its digital degrees of
%   freedom, how much SINR does it recover, and what does it cost the main beam?
%   Link to the TFG: the degrees of freedom are the digital channels (N_RF in the TFG). The TFG
%   MVDR was at
%   element level and fully digital (64 degrees of freedom); here the adaptive processor only sees
%   the 100 subarray outputs, which is what a hybrid face provides.
%
%   Model (generic, textbook; everything relative to thermal noise):
%     · 80×80 face, 100 subarrays of 8×8, d = λ/2. 2D Taylor taper in the T/R module and analog
%       steering to the target with 6-bit phase shifters: subarray s → b_s(u,v) = Σ_e∈s t_e·a0q_e*·a_e.
%       Matrix T (6400×100). Per-element thermal noise of unit power: R_n = TᴴT (diagonal).
%     · Target at (u0, v0) = (sin 20°, 0). J uncorrelated noise jammers, per-element JNR as a
%       parameter (30 dB by default), at random directions in visible space outside the
%       main lobe (|Δ| > 0.1 in sine space).
%     · Subarray-level beamformers (100 degrees of freedom):
%         conventional  w = 1 (the fixed Taylor beam);
%         MVDR          w = R⁻¹·s, s = Tᴴa(u0,v0) (maximum SINR);
%         quiescent MVDR w = R⁻¹·R_n·1 (without jammers reverts to w = 1: preserves the taper);
%         SMI           R̂ = (1/K)·Σ x xᴴ with K target-free snapshots, with and without diagonal loading.
%     · SINR(w) ∝ |wᴴs|²/(wᴴRw). SINR loss relative to the jammer-free design Taylor beam
%       (negative = better than design; pure MVDR gains ~1.7 dB by undoing the taper).
%   Metrics: SINR loss, pattern level at each jammer (null depth), target gain loss relative
%   to the Taylor beam, peak mispointing, and SLL of the adapted pattern (outside a circle of
%   radius 0.05 in sine space around the target).
%   Validation: Reed-Mallett-Brennan, E[ρ] = (K+2−N)/(K+1), with N = 100 degrees of freedom.
%
%   Outputs: results/fase4/ (figure and CSV) and web/src/data/e4_jammer.json.
%   Deterministic Monte Carlo: run_id_to_seed('E4-...').

clear; startup_if_needed();
t0 = tic;
S = sistema_ref();
Nx = S.face.Nx; Ny = S.face.Ny; L = S.face.subNx; dl = S.face.dLambda;
nS = (Nx / L) * (Ny / L);                                     % 100 degrees of freedom
ix = (0:Nx - 1)'; iy = (0:Ny - 1)';
sv = @(u, v) reshape(permute(exp(1j * 2 * pi * dl * iy * v), [1 3 2]) .* ...
  permute(exp(1j * 2 * pi * dl * ix * u), [3 1 2]), Nx * Ny, []);      % one column per direction; order vec([Ny×Nx])
tx = taylorwin(Nx, S.beam.nbar, -S.beam.sllDb); ty = taylorwin(Ny, S.beam.nbar, -S.beam.sllDb);
t2 = kron(tx, ty);
u0 = sind(20); v0 = 0;
a0 = sv(u0, v0);
ph = angle(a0); q = 2 * pi / 2^S.beam.psBits; a0q = exp(1j * q * round(ph / q));
we = t2 .* a0q;                                               % per-element analog weights
[IX, IY] = meshgrid(ix, iy);
sub = floor(IX(:) / L) * (Ny / L) + floor(IY(:) / L) + 1;
T = sparse((1:Nx * Ny)', sub, we, Nx * Ny, nS);
Rn = full(T' * T); rn = real(diag(Rn));
s = full(T' * a0);
sinrRef = sinr(ones(nS, 1), s, Rn);                             % reference: design Taylor beam without jammers
hpbwU = 0.0300;                                                % HPBW in sine space of the 80-element Taylor (E2)
ctx = struct('T', T, 'Nx', Nx, 'Ny', Ny, 'u0', u0, 'v0', v0, 'a0', a0, 'Nf', 1024, 'rMain', 0.05);
jnrDb = 30;
outDir = fullfile(fileparts(mfilename('fullpath')), '..', 'results', 'fase4');
dataDir = fullfile(fileparts(mfilename('fullpath')), '..', '..', 'web', 'src', 'data');

q0 = patron(ctx, ones(nS, 1));
fprintf('Quiescent (Taylor %d dB, %d-bit phase shifters): SLL %.1f dB\n', S.beam.sllDb, S.beam.psBits, q0.sll);
wM0 = Rn \ s; p = patron(ctx, wM0);
fprintf('MVDR without jammers (w = R_n⁻¹s): SINR %+.2f dB vs Taylor, but SLL %.1f dB (undoes the taper across subarrays)\n', ...
  10 * log10(sinr(wM0, s, Rn) / sinrRef), p.sll);

% =====================================================================================
% A · Sweep of the number of jammers (exact covariance)
% =====================================================================================
Js = [1 2 5 10 20 40 60 80 90 95 99 100 101 110 130 160 200];
nGeo = 10;
met = {'conv', 'mvdr', 'mvdrq'};
A = struct();
for m = met; A.(m{1}) = nan(numel(Js), nGeo, 6); end      % [lossSINR, null, gLoss, mispoint, SLL, maxNull]
jnrA = [20 30 40]; LA = nan(numel(Js), nGeo, numel(jnrA), 3); RK = nan(numel(Js), nGeo, numel(jnrA));
rnh = 1 ./ sqrt(rn);
for iJ = 1:numel(Js)
  J = Js(iJ);
  for g = 1:nGeo
    rng(run_id_to_seed(sprintf('E4-geo-%d-%d', J, g)));
    [uj, vj] = dir_jammers(J, u0, v0);
    B = full(T' * sv(uj, vj));                                  % 100×J
    ev = eig((rnh .* B) * (rnh .* B)'); ev = sort(real(ev), 'descend');
    for ij = 1:numel(jnrA)                                   % SINR only, for three JNRs
      Rx = Rn + 10^(jnrA(ij) / 10) * (B * B');
      ws = {ones(nS, 1), Rx \ s, Rx \ (Rn * ones(nS, 1))};
      LA(iJ, g, ij, :) = cellfun(@(w) -10 * log10(sinr(w, s, Rx) / sinrRef), ws);
      RK(iJ, g, ij) = nnz(10^(jnrA(ij) / 10) * ev > 1);       % jammers above noise after the subarray
    end
    R = Rn + 10^(jnrDb / 10) * (B * B');
    W = struct('conv', ones(nS, 1), 'mvdr', R \ s, 'mvdrq', R \ (Rn * ones(nS, 1)));
    for m = met
      w = W.(m{1});
      p = patron(ctx, w);
      lv = nivel_dir(ctx, w, uj, vj);                           % dB relative to peak
      A.(m{1})(iJ, g, :) = [-10 * log10(sinr(w, s, R) / sinrRef), median(lv), q0.gDb - p.gDb, p.desap, p.sll, max(lv)];
    end
  end
  fprintf('[A] J=%3d  SINR loss (median): conv %5.1f · MVDR %5.2f · MVDR-q %5.2f dB · MVDR null %5.0f dB · SLL MVDR %5.1f / MVDR-q %5.1f dB\n', ...
    J, median(A.conv(iJ, :, 1)), median(A.mvdr(iJ, :, 1)), median(A.mvdrq(iJ, :, 1)), median(A.mvdr(iJ, :, 2)), ...
    median(A.mvdr(iJ, :, 5)), median(A.mvdrq(iJ, :, 5)));
  fprintf('       JNR 20/30/40 dB: effective jammer rank %s · MVDR-q loss %s dB\n', ...
    mat2str(round(median(squeeze(RK(iJ, :, :)), 1))), mat2str(round(median(squeeze(LA(iJ, :, :, 3)), 1), 2)));
end
for jj = [10 40 99 160]
  k = find(Js == jj);
  fprintf('[A] J=%3d MVDR-q: target gain loss %.2f dB · mispointing %.4f (%.2f HPBW) · median null %.0f dB · SLL %.1f dB\n', ...
    jj, median(A.mvdrq(k, :, 3)), median(A.mvdrq(k, :, 4)), median(A.mvdrq(k, :, 4)) / hpbwU, median(A.mvdrq(k, :, 2)), median(A.mvdrq(k, :, 5)));
end
mx = @(ij) max([0 Js(squeeze(median(LA(:, :, ij, 3), 2))' <= 1)]);
fprintf('[A] Max J with median MVDR-q loss <= 1 dB: JNR 20 dB → %d · 30 dB → %d · 40 dB → %d\n', mx(1), mx(2), mx(3));

% --- JNR sweep with 10 jammers --------------------------------------------------------
jnrs = 0:5:40; Jf = 10; lossJnr = nan(numel(jnrs), 3);
rng(run_id_to_seed('E4-jnr'));
[ujF, vjF] = dir_jammers(Jf, u0, v0); BF = full(T' * sv(ujF, vjF));
for i = 1:numel(jnrs)
  R = Rn + 10^(jnrs(i) / 10) * (BF * BF');
  ws = {ones(nS, 1), R \ s, R \ (Rn * ones(nS, 1))};
  lossJnr(i, :) = cellfun(@(w) -10 * log10(sinr(w, s, R) / sinrRef), ws);
end
fprintf('[A] 10 jammers, JNR 0→40 dB: conventional %.1f→%.1f dB · MVDR %.2f→%.2f dB · MVDR-q %.2f→%.2f dB\n', ...
  lossJnr(1, 1), lossJnr(end, 1), lossJnr(1, 2), lossJnr(end, 2), lossJnr(1, 3), lossJnr(end, 3));

% =====================================================================================
% B · One jammer sweeping azimuth: subarray quantization lobes
% =====================================================================================
uj1 = u0 + (0.005:0.0025:0.75); uj1 = uj1(uj1 < 1);
lossU = nan(numel(uj1), 3); gU = nan(numel(uj1), 1);
for i = 1:numel(uj1)
  b = full(T' * sv(uj1(i), v0));
  R = Rn + 10^(jnrDb / 10) * (b * b');
  ws = {ones(nS, 1), R \ s, R \ (Rn * ones(nS, 1))};
  lossU(i, :) = cellfun(@(w) -10 * log10(sinr(w, s, R) / sinrRef), ws);
  gU(i) = 10 * log10(abs(b' * s)^2 / (norm(b)^2 * norm(s)^2));  % cosine² between jammer and target (subarray)
end
uGL = u0 + (1:2) / (L * dl);                                    % quantization lobes: Δu = k·λ/(L·d)
for k = 1:numel(uGL)
  [~, i] = min(abs(uj1 - uGL(k)));
  fprintf('[B] jammer on quantization lobe u0+%.3f: MVDR %.1f dB · MVDR-q %.1f dB · conv %.1f dB · cos² with target %.1f dB\n', ...
    uGL(k) - u0, lossU(i, 2), lossU(i, 3), lossU(i, 1), gU(i));
end
iCerca = find(lossU(:, 3) > 1, 1, 'last');
fprintf('[B] MVDR-q: loss > 1 dB only with the jammer closer than Δu = %.3f to the target (%.1f HPBW); beyond that, median %.2f dB and max %.2f dB\n', ...
  uj1(iCerca) - u0, (uj1(iCerca) - u0) / hpbwU, median(lossU(iCerca + 1:end, 3)), max(lossU(iCerca + 1:end, 3)));

% --- two jammers: the second sweeps its separation from the first -----------------------------
% Two directions separated by k·λ/(L·d) have the same inter-subarray phase progression (aliasing
% at subarray level): the adaptive processor can only tell them apart via the subarray pattern.
uc = linspace(-1, 1, 4001); mainC = abs(uc - u0) < ctx.rMain;
qCut = corte(T, ones(nS, 1), Nx, Ny, dl, v0, uc); sllQc = max(qCut(~mainC));
uA = u0 - 0.33; dd = 0.04:0.0025:0.95;
sll2 = nan(size(dd)); loss2 = nan(size(dd));
for i = 1:numel(dd)
  u2 = uA + dd(i);
  if abs(u2 - u0) < 0.06 || u2 >= 0.99; continue; end
  B2 = full(T' * sv([uA u2], [v0 v0]));
  R = Rn + 10^(jnrDb / 10) * (B2 * B2');
  w = R \ (Rn * ones(nS, 1));
  loss2(i) = -10 * log10(sinr(w, s, R) / sinrRef);
  pc = corte(T, w, Nx, Ny, dl, v0, uc);
  sll2(i) = max(pc(~mainC));
end
cerca = @(k) abs(dd - k / (L * dl)) < 0.01;
lejos = ~(cerca(1) | cerca(2) | cerca(3)) & ~isnan(sll2);
fprintf('[B] Two jammers separated by Δ: cut SLL with MVDR-q %.1f / %.1f / %.1f dB at Δ ≈ λ/(Ld)·{1,2,3}; median elsewhere %.1f dB (quiescent %.1f dB)\n', ...
  max(sll2(cerca(1))), max(sll2(cerca(2))), max(sll2(cerca(3))), median(sll2(lejos)), sllQc);
fprintf('[B] Two jammers: max MVDR-q SINR loss %.2f dB (median %.2f dB)\n', max(loss2), median(loss2, 'omitnan'));

% =====================================================================================
% C · SMI with K snapshots: Reed-Mallett-Brennan and diagonal loading
% =====================================================================================
Ks = [102 105 110 120 150 200 300 500 1000]; KsL = [10 20 30 50 100 200 500];
nTr = 300; Jc = 10;
rng(run_id_to_seed('E4-smi-geo'));
[ujc, vjc] = dir_jammers(Jc, u0, v0); Bc = full(T' * sv(ujc, vjc));
Rc = Rn + 10^(jnrDb / 10) * (Bc * Bc');
sOpt = sinr(Rc \ s, s, Rc);
Lc = chol(Rc, 'lower');
rho = nan(numel(Ks), nTr); rhoL = nan(numel(KsL), nTr);
for i = 1:numel(Ks)
  rng(run_id_to_seed(sprintf('E4-smi-%d', Ks(i))));
  for tr = 1:nTr
    X = Lc * (randn(nS, Ks(i)) + 1j * randn(nS, Ks(i))) / sqrt(2);
    Rh = (X * X') / Ks(i);
    rho(i, tr) = sinr(Rh \ s, s, Rc) / sOpt;
  end
end
% whitened diagonal loading: σ_L·R_n with σ_L = 1 (0 dB above each subarray's noise)
for i = 1:numel(KsL)
  rng(run_id_to_seed(sprintf('E4-smiL-%d', KsL(i))));
  for tr = 1:nTr
    X = Lc * (randn(nS, KsL(i)) + 1j * randn(nS, KsL(i))) / sqrt(2);
    Rh = (X * X') / KsL(i) + Rn;
    rhoL(i, tr) = sinr(Rh \ s, s, Rc) / sOpt;
  end
end
rhoTh = (Ks + 2 - nS) ./ (Ks + 1);
rhoLinf = sinr((Rc + Rn) \ s, s, Rc) / sOpt;            % K → ∞ asymptote with loading
mr = mean(rho, 2)'; ser = std(rho, 0, 2)' / sqrt(nTr);
dentro = abs(mr - rhoTh) <= 1.96 * ser;
fprintf('[C] RMB: theoretical E[ρ] within the 95%% CI for %d of %d values of K · K = 2N = 200: measured %.2f dB, theory %.2f dB\n', ...
  nnz(dentro), numel(Ks), 10 * log10(mr(Ks == 200)), 10 * log10(rhoTh(Ks == 200)));
fprintf('[C] SMI with 0 dB loading and %d jammers: K = 2·J = 20 → %.2f dB · asymptote (K → ∞) %.2f dB · unloaded, K = 2N = 200 → −3 dB\n', ...
  Jc, 10 * log10(mean(rhoL(KsL == 20, :))), 10 * log10(rhoLinf));
for i = 1:numel(KsL); fprintf('      K=%4d  loaded: %.2f dB\n', KsL(i), 10 * log10(mean(rhoL(i, :)))); end

% =====================================================================================
% Figure example: azimuth cut with 3 jammers on the cut
% =====================================================================================
ujE = u0 + [-0.33 0.17 0.41]; vjE = [0 0 0];
BE = full(T' * sv(ujE, vjE)); RE = Rn + 10^(jnrDb / 10) * (BE * BE');
wE = {ones(nS, 1), RE \ s, RE \ (Rn * ones(nS, 1))};
uc = linspace(-1, 1, 4001);
cut = nan(3, numel(uc));
for k = 1:3
  Wm = reshape(T * wE{k}, Ny, Nx);
  pc = abs((exp(1j * 2 * pi * dl * iy * v0).' * conj(Wm)) * exp(1j * 2 * pi * dl * ix * uc)).^2;
  cut(k, :) = 10 * log10(pc / max(pc));
end
nivE = cellfun(@(w) nivel_dir(ctx, w, ujE, vjE), wE, 'UniformOutput', false);
fprintf('[Ex] levels at the jammers (dB rel. peak): conv [%s] · MVDR [%s] · MVDR-q [%s]\n', ...
  num2str(nivE{1}, '%.0f '), num2str(nivE{2}, '%.0f '), num2str(nivE{3}, '%.0f '));

% =====================================================================================
% Outputs
% =====================================================================================
if ~isfolder(outDir); mkdir(outDir); end
med = @(X, k) median(X(:, :, k), 2)';
tab = table(Js', med(A.conv, 1)', med(A.mvdr, 1)', med(A.mvdrq, 1)', med(A.mvdr, 2)', med(A.mvdrq, 2)', ...
  med(A.mvdr, 3)', med(A.mvdrq, 3)', med(A.mvdr, 4)', med(A.mvdrq, 4)', med(A.mvdr, 5)', med(A.mvdrq, 5)', ...
  'VariableNames', {'J', 'lossConv', 'lossMvdr', 'lossMvdrQ', 'nuloMvdr', 'nuloMvdrQ', 'gLossMvdr', 'gLossMvdrQ', ...
  'desapMvdr', 'desapMvdrQ', 'sllMvdr', 'sllMvdrQ'});
writetable(tab, fullfile(outDir, 'e4_jammers.csv'));
writetable(table(Ks', mr', rhoTh', 'VariableNames', {'K', 'rhoMedido', 'rhoTeoria'}), fullfile(outDir, 'e4_rmb.csv'));
q25 = @(X, k) prctile(X(:, :, k), 25, 2)'; q75 = @(X, k) prctile(X(:, :, k), 75, 2)';
dec = 1:4:numel(uc);
out = struct('dof', nS, 'jnrDb', jnrDb, 'u0', u0, 'quiescente', struct('sllDb', q0.sll), ...
  'jammers', struct('J', Js, 'lossConv', med(A.conv, 1), 'lossMvdr', med(A.mvdr, 1), 'lossMvdrQ', med(A.mvdrq, 1), ...
    'lossMvdrQ25', q25(A.mvdr, 1), 'lossMvdrQ75', q75(A.mvdr, 1), 'nuloMvdr', med(A.mvdr, 2), 'nuloMvdrQ', med(A.mvdrq, 2), ...
    'gLossMvdr', med(A.mvdr, 3), 'gLossMvdrQ', med(A.mvdrq, 3), 'desapMvdr', med(A.mvdr, 4), 'desapMvdrQ', med(A.mvdrq, 4), ...
    'sllMvdr', med(A.mvdr, 5), 'sllMvdrQ', med(A.mvdrq, 5)), ...
  'jnr', struct('jnrDb', jnrs, 'J', Jf, 'loss', lossJnr'), ...
  'lobulos', struct('uj', uj1, 'loss', lossU', 'uGL', uGL, 'dosDelta', dd, 'dosSll', sll2, 'dosLoss', loss2), ...
  'rmb', struct('K', Ks, 'rho', mr, 'rhoTeoria', rhoTh, 'KL', KsL, 'rhoCarga', mean(rhoL, 2)', 'cargaDb', 0, 'rhoCargaInf', rhoLinf), ...
  'ejemplo', struct('u', uc(dec), 'uj', ujE, 'cutDb', cut(:, dec)));
write_json(fullfile(dataDir, 'e4_jammer.json'), out);

plot_style(); col = lines(3);
fig = figure('Visible', 'off', 'Position', [100 100 1400 900]);
tl = tiledlayout(fig, 2, 2, 'TileSpacing', 'compact', 'Padding', 'compact');
% (a) SINR loss vs number of jammers
ax = nexttile(tl); hold(ax, 'on');
nom = {'conventional (fixed Taylor)', 'MVDR', 'MVDR with quiescent pattern'};
gr = [0.55 0.55 0.55];
plot(ax, Js, squeeze(median(LA(:, :, 2, 1), 2)), '--', 'Color', gr, 'LineWidth', 1.3, 'DisplayName', 'conventional, JNR 30 dB');
est = {':', '-', '-.'};
for ij = 1:numel(jnrA)
  plot(ax, Js, squeeze(median(LA(:, :, ij, 3), 2)), est{ij}, 'Color', col(3, :), 'LineWidth', 1.6, 'Marker', 'o', 'MarkerSize', 4, ...
    'DisplayName', sprintf('quiescent MVDR, JNR %d dB', jnrA(ij)));
end
xline(ax, nS, 'k--', '100 degrees of freedom', 'LabelVerticalAlignment', 'top', 'LabelHorizontalAlignment', 'left', 'HandleVisibility', 'off');
set(ax, 'XScale', 'log'); ylim(ax, [-0.5 30]); xlim(ax, [1 200]);
xlabel(ax, 'number of jammers J'); ylabel(ax, 'SINR loss vs design (dB)');
legend(ax, 'Location', 'northwest'); grid(ax, 'on'); title(ax, '(a) SINR loss (median of 10 geometries)');
% (b) pattern cut
ax = nexttile(tl); hold(ax, 'on');
for k = 1:3; plot(ax, uc, cut(k, :), '-', 'Color', col(k, :), 'LineWidth', 1.1, 'DisplayName', nom{k}); end
for k = 1:numel(ujE); xline(ax, ujE(k), ':', 'Color', [0.4 0.4 0.4], 'HandleVisibility', 'off'); end
xlim(ax, [-0.4 1]); ylim(ax, [-90 3]); xlabel(ax, 'u = sin θ (v = 0)'); ylabel(ax, 'dB');
legend(ax, 'Location', 'southoutside', 'NumColumns', 2); grid(ax, 'on'); title(ax, '(b) Azimuth cut with 3 jammers (dotted lines)');
% (c) two jammers: aliasing at subarray level
ax = nexttile(tl); hold(ax, 'on');
plot(ax, dd, sll2, '-', 'Color', col(3, :), 'LineWidth', 1.4, 'DisplayName', 'cut SLL, quiescent MVDR (2 jammers)');
yline(ax, sllQc, 'k--', 'quiescent', 'HandleVisibility', 'off');
for k = 1:3; xline(ax, k / (L * dl), ':', sprintf('%d·λ/(L·d)', k), 'LabelVerticalAlignment', 'bottom', 'HandleVisibility', 'off'); end
ylim(ax, [-45 0]); xlim(ax, [0 0.95]);
xlabel(ax, 'separation between the two jammers Δu'); ylabel(ax, 'adapted pattern SLL (dB)');
legend(ax, 'Location', 'northeast'); grid(ax, 'on'); title(ax, '(c) Jammers separated by k·λ/(L·d): subarray aliasing');
% (d) SMI: Reed-Mallett-Brennan
ax = nexttile(tl); hold(ax, 'on');
Kf = linspace(nS + 1, 1000, 400);
plot(ax, Kf / nS, 10 * log10((Kf + 2 - nS) ./ (Kf + 1)), 'k-', 'LineWidth', 1.3, 'DisplayName', 'RMB theory');
errorbar(ax, Ks / nS, 10 * log10(mr), 10 * log10(mr) - 10 * log10(mr - 1.96 * ser), 10 * log10(mr + 1.96 * ser) - 10 * log10(mr), ...
  'o', 'Color', col(2, :), 'LineWidth', 1.2, 'DisplayName', 'SMI, Monte Carlo (95 % CI)');
plot(ax, KsL / nS, 10 * log10(mean(rhoL, 2)), '-s', 'Color', col(3, :), 'LineWidth', 1.3, 'DisplayName', 'SMI with diagonal loading (0 dB)');
yline(ax, 10 * log10(rhoLinf), ':', 'Color', col(3, :), 'HandleVisibility', 'off');
xline(ax, 2, 'k:', 'K = 2N', 'HandleVisibility', 'off');
set(ax, 'XScale', 'log'); ylim(ax, [-25 1]); xlabel(ax, 'K / N (snapshots / degrees of freedom)'); ylabel(ax, 'E[ρ] (dB)');
legend(ax, 'Location', 'southeast'); grid(ax, 'on'); title(ax, sprintf('(d) Snapshots, %d jammers', Jc));
save_figure(fig, outDir, 'e4_anulacion_jammer');
fprintf('Done in %.0f s\n', toc(t0));

% =====================================================================================
function r = sinr(w, s, R)
r = abs(w' * s)^2 / real(w' * R * w);
end

function [uj, vj] = dir_jammers(J, u0, v0)
% Uniform directions over the visible disk, outside the main lobe.
uj = zeros(1, J); vj = zeros(1, J); k = 0;
while k < J
  c = 2 * rand(1, 2) - 1;
  if norm(c) < 0.98 && hypot(c(1) - u0, c(2) - v0) > 0.1
    k = k + 1; uj(k) = c(1); vj(k) = c(2);
  end
end
end

function p = patron(ctx, w)
% 2D pattern via FFT, target gain, mispointing and SLL.
we = ctx.T * w; Nf = ctx.Nf;
Wm = reshape(we, ctx.Ny, ctx.Nx);
P = abs(fftshift(ifft2(conj(Wm), Nf, Nf)) * Nf^2).^2;           % P(v, u), u = 2k/Nf
g = (-Nf / 2:Nf / 2 - 1) * 2 / Nf;
[UU, VV] = meshgrid(g, g);
vis = UU.^2 + VV.^2 <= 1;
mainR = hypot(UU - ctx.u0, VV - ctx.v0) < ctx.rMain;
Pm = P; Pm(~mainR) = 0; [pk, i] = max(Pm(:));
[iv, iu] = ind2sub(size(P), i);
du = parab(P(iv, iu - 1:iu + 1)) * 2 / Nf; dv = parab(P(iv - 1:iv + 1, iu)) * 2 / Nf;
p.desap = hypot(g(iu) + du - ctx.u0, g(iv) + dv - ctx.v0);
p.sll = 10 * log10(max(P(vis & ~mainR)) / pk);
p.gDb = 10 * log10(abs(we' * ctx.a0)^2 / norm(we)^2);
end

function d = parab(y)
y = 10 * log10(y(:)'); den = y(1) - 2 * y(2) + y(3);
if den == 0; d = 0; else; d = 0.5 * (y(1) - y(3)) / den; end
end

function lv = nivel_dir(ctx, w, uj, vj)
% Pattern level in each direction, in dB relative to the target gain.
we = ctx.T * w; Nx = ctx.Nx; Ny = ctx.Ny;
ix = (0:Nx - 1)'; iy = (0:Ny - 1)';
lv = zeros(1, numel(uj));
pk = abs(we' * ctx.a0)^2;
for k = 1:numel(uj)
  a = kron(exp(1j * pi * ix * uj(k)), exp(1j * pi * iy * vj(k)));
  lv(k) = 10 * log10(abs(we' * a)^2 / pk);
end
end

function pDb = corte(T, w, Nx, Ny, dl, v0, uc)
% Azimuth pattern cut (v = v0), in dB relative to the peak.
Wm = reshape(T * w, Ny, Nx);
pc = abs((exp(1j * 2 * pi * dl * (0:Ny - 1)' * v0).' * conj(Wm)) * exp(1j * 2 * pi * dl * (0:Nx - 1)' * uc)).^2;
pDb = 10 * log10(pc / max(pc));
end
