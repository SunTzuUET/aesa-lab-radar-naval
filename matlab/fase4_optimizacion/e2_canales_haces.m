%E2_CANALES_HACES Digital channels vs. simultaneous beams (experiment E2, step P4).
%
%   Question: how many digital channels does the subarrayed face need to form K simultaneous
%   receive beams without losing gain or raising the SLL? This is the TFG bound
%   (N_RF ≥ B·N_s: each band and each stream needs its own analog dimension) carried over
%   to the radar.
%
%   Hardware model (AESA with T/R modules):
%     · The amplitude taper (Taylor) sits in the T/R module, before the split, and is common to
%       all beams. Each subarray of L elements has M analog ports; each port is a network of
%       6-bit phase shifters (phase only) feeding one digital channel.
%       Channels: N_ch = N_sub·M.  w_k = diag(t)·F_RF·f_BB,k.
%     · "Grouped" analog: the K beams are split into M contiguous groups and each port is
%       steered to the center of its group. Digital: regularized least squares against the
%       ideal beam (full-face Taylor, fully digital).
%     · TFG alternative: sub-connected PE-AltMin (hybrid_am_decomposition) with the same
%       mask, initialized from the grouped analog.
%   Beams spread in azimuth (u). The problem is separable: the elevation factor is common to
%   all beams, so the 80-element row suffices. On the 2D face, N_ch = N_sub,2D·M.
%
%   "Lossless" criterion: worst beam with gain loss ≤ 1 dB vs. ideal and maximum SLL
%   (quantization lobes included) ≤ −30 dB, a 5 dB margin over the −35 dB Taylor.
%
%   Bound hypothesis: a subarray of L elements "sees" the beam sector with resolution
%   λ/(L·d); the number of degrees of freedom it needs is the numerical rank of the
%   sector's steering-vector block, r_eff = #{σ_i/σ_1 > 10^(SLL/20)}, which grows
%   as s = Δu·L·d/λ (Landau-Pollak). The threshold is the design SLL (−35 dB). Proposed
%   bound: M ≥ min(K, r_eff), i.e. N_ch ≥ N_sub·min(K, r_eff). With spread beams
%   r_eff ≥ K and the TFG bound N_ch ≥ N_sub·K is recovered.
%
%   Cost: each port carries its own phase-shifter network, so there are M phase shifters per
%   element. This is the TFG FC/SC trade-off: large subarrays save digital channels
%   but need more ports (more phase shifters); small subarrays, the opposite.
%
%   Outputs: results/fase4/ (figures and CSV) and web/src/data/e2_canales.json.
%   Deterministic (the grouped analog uses no randomness; PE-AltMin starts from it).

clear; startup_if_needed();
t0 = tic;
S = sistema_ref();
N = S.face.Nx; n = (0:N - 1)';
dl = S.face.dLambda;
t = taylorwin(N, S.beam.nbar, -S.beam.sllDb); t = t / max(t);
bits = S.beam.psBits;
crit = struct('lossDb', 1, 'sllDb', -30);
outDir = fullfile(fileparts(mfilename('fullpath')), '..', 'results', 'fase4');
dataDir = fullfile(fileparts(mfilename('fullpath')), '..', '..', 'web', 'src', 'data');

u = linspace(-1, 1, 8001);
A = exp(1j * 2 * pi * dl * n * u);
[uNull, hpbw] = lobulo_ideal(A, t, u);
fprintf('Taylor %d dB, n̄=%d, N=%d: first null u=%.4f, HPBW u=%.4f\n', S.beam.sllDb, S.beam.nbar, N, uNull, hpbw);
ctx = struct('N', N, 'n', n, 'dl', dl, 't', t, 'bits', bits, 'u', u, 'A', A, 'uNull', uNull);

% =====================================================================================
% A · Minimum M vs. sector extent, for several subarray sizes and K
% =====================================================================================
Ls = [4 8 16]; Ks = [2 4 8 16];
sGrid = [0.05 0.1 0.15 0.2 0.3 0.4 0.6 0.8 1.2 1.6 2.4 3.2];
filas = [];
for L = Ls
  for K = Ks
    for s = sGrid
      du = s / (L * dl);                         % s = Δu·L·d/λ
      if du > 1.2 || du / (K - 1) < hpbw; continue; end   % beams resolvable and visible
      uk = linspace(-du / 2, du / 2, K);
      rEff = rango_efectivo(L, dl, du, -S.beam.sllDb);
      Mmin = NaN; Mmax = min(K, L);
      for M = 1:Mmax
        r = evaluar(ctx, L, M, uk, 'grupos');
        if r.loss <= crit.lossDb && r.sll <= crit.sllDb; Mmin = M; break; end
      end
      filas = [filas; L K s du rEff Mmin]; %#ok<AGROW>
    end
  end
end
T = array2table(filas, 'VariableNames', {'L', 'K', 's', 'du', 'rEff', 'Mmin'});
pred = min(T.K, T.rEff);
ok = T.Mmin == pred;
fprintf('[A] %d cases · M_min = min(K, r_eff) in %d (%.0f %%) · below the bound: %d · above: %d (max. +%d) · no solution: %d\n', ...
  height(T), nnz(ok), 100 * mean(ok), nnz(T.Mmin < pred), nnz(T.Mmin > pred), max(T.Mmin - pred), nnz(isnan(T.Mmin)));

% =====================================================================================
% B · TFG decomposer (PE-AltMin) vs. grouped analog, at M = M_min and M_min−1
% =====================================================================================
cmp = [];
for i = 1:height(T)
  if isnan(T.Mmin(i)); continue; end
  uk = linspace(-T.du(i) / 2, T.du(i) / 2, T.K(i));
  for M = unique(max(1, [T.Mmin(i) - 1, T.Mmin(i)]))
    if (N / T.L(i)) * M < T.K(i); continue; end
    g = evaluar(ctx, T.L(i), M, uk, 'grupos');
    a = evaluar(ctx, T.L(i), M, uk, 'altmin');
    cmp = [cmp; T.L(i) T.K(i) T.s(i) M g.loss g.sll a.loss a.sll g.frob a.frob]; %#ok<AGROW>
  end
end
C = array2table(cmp, 'VariableNames', {'L', 'K', 's', 'M', 'lossG', 'sllG', 'lossA', 'sllA', 'frobG', 'frobA'});
fprintf('[B] %d cases · PE-AltMin lowers the Frobenius error in %.0f %%, but SLL only improves >1 dB in %.0f %% and worsens >1 dB in %.0f %%\n', ...
  height(C), 100 * mean(C.frobA < C.frobG), 100 * mean(C.sllA < C.sllG - 1), 100 * mean(C.sllA > C.sllG + 1));

% =====================================================================================
% C · Channels of the 2D face (80×80) vs. subarray size, in three scenarios
% =====================================================================================
Lc = [2 4 5 8 10 16 20 40];
casos = struct('nombre', {'4 haces en racimo (Δu = 3·HPBW)', '8 haces en racimo (Δu = 7·HPBW)', '8 haces repartidos (Δu = 0,8)'}, ...
  'K', {4, 8, 8}, 'du', {3 * hpbw, 7 * hpbw, 0.8});
nch = nan(numel(casos), numel(Lc)); mC = nch;
for c = 1:numel(casos)
  uk = linspace(-casos(c).du / 2, casos(c).du / 2, casos(c).K);
  for j = 1:numel(Lc)
    L = Lc(j);
    for M = 1:min(casos(c).K, L)
      r = evaluar(ctx, L, M, uk, 'grupos');
      if r.loss <= crit.lossDb && r.sll <= crit.sllDb
        mC(c, j) = M; nch(c, j) = (N / L)^2 * M; break;
      end
    end
  end
  fprintf('[C] %s\n    L    = [%s]\n    M    = [%s]\n    N_ch = [%s]\n', casos(c).nombre, ...
    num2str(Lc), num2str(mC(c, :)), num2str(nch(c, :)));
end
mRef = mC(:, Lc == S.face.subNx);
fprintf('[C] Reference face (8×8 subarrays, 100 subarrays): M = [%s] → N_ch = [%s]\n', ...
  num2str(mRef.'), num2str(100 * mRef.'));

% =====================================================================================
% Figure example: L = 8, 4-beam cluster, M = 1, M = M_min and fully digital
% =====================================================================================
ukE = linspace(-1.5 * hpbw, 1.5 * hpbw, 4);
ej = struct([]);
MminE = mC(1, Lc == 8);
for M = unique([1 MminE])
  r = evaluar(ctx, 8, M, ukE, 'grupos');
  ej(end + 1).M = M; ej(end).pDb = r.pDb(:, end).'; ej(end).loss = r.loss; ej(end).sll = r.sll; %#ok<SAGROW>
end
pIdeal = abs(A' * (t .* exp(1j * 2 * pi * dl * n * ukE(end)))).^2;
pIdealDb = 10 * log10(pIdeal / max(pIdeal)).';

% =====================================================================================
% Outputs
% =====================================================================================
if ~isfolder(outDir); mkdir(outDir); end
writetable(T, fullfile(outDir, 'e2_mmin.csv'));
writetable(C, fullfile(outDir, 'e2_altmin.csv'));
dec = 1:4:numel(u);
out = struct('criterio', crit, 'taylor', struct('sllDb', S.beam.sllDb, 'nbar', S.beam.nbar), ...
  'N', N, 'hpbwU', hpbw, 'mmin', table2struct(T), ...
  'caras', struct('L', Lc, 'casos', {{casos.nombre}}, 'K', [casos.K], 'du', [casos.du], 'M', mC, 'nch', nch), ...
  'ejemplo', struct('L', 8, 'uk', ukE, 'u', u(dec), 'idealDb', pIdealDb(dec), ...
     'M', [ej.M], 'pDb', vertcat(ej.pDb), 'loss', [ej.loss], 'sll', [ej.sll]));
for e = 1:numel(ej); out.ejemplo.pDb(e, :) = ej(e).pDb; end
out.ejemplo.pDb = out.ejemplo.pDb(:, dec);
write_json(fullfile(dataDir, 'e2_canales.json'), out);

sty = plot_style(); col = lines(4);
fig = figure('Visible', 'off', 'Position', [100 100 1500 560]);
tl = tiledlayout(fig, 1, 3, 'TileSpacing', 'compact');
% (a) minimum M vs. s
ax = nexttile(tl); hold(ax, 'on'); mk = {'o', 's', '^'};
sF = linspace(0.05, 3.2, 200); rF = arrayfun(@(x) rango_efectivo(8, dl, x / (8 * dl), -S.beam.sllDb), sF);
stairs(ax, sF, rF, '-', 'Color', [0.5 0.5 0.5], 'LineWidth', 1.5, 'DisplayName', 'r_{eff} bound (L = 8)');
for iL = 1:numel(Ls)
  for iK = 1:numel(Ks)
    m = T.L == Ls(iL) & T.K == Ks(iK) & ~isnan(T.Mmin);
    if ~any(m); continue; end
    h = plot(ax, T.s(m) .* (1 + 0.03 * (iK - 2.5)), T.Mmin(m), mk{iL}, 'Color', col(iK, :), 'MarkerSize', 7, 'LineWidth', 1.2);
    if iL == 2; h.DisplayName = sprintf('K = %d', Ks(iK)); else; h.HandleVisibility = 'off'; end
  end
end
for iL = 1:numel(Ls)
  plot(ax, NaN, NaN, mk{iL}, 'Color', [0.3 0.3 0.3], 'DisplayName', sprintf('L = %d', Ls(iL)));
end
set(ax, 'XScale', 'log'); ylim(ax, [0.5 8.5]); xlabel(ax, 's = Δu·L·d/λ'); ylabel(ax, 'minimum M (ports per subarray)');
legend(ax, 'Location', 'northwest', 'NumColumns', 2); grid(ax, 'on'); title(ax, '(a) Ports per subarray');
% (b) example pattern
ax = nexttile(tl); hold(ax, 'on');
plot(ax, u, pIdealDb, 'k-', 'LineWidth', 1, 'DisplayName', 'fully digital');
cE = [0.85 0.33 0.10; 0.18 0.44 0.71];
for e = 1:numel(ej)
  plot(ax, u, ej(e).pDb, '-', 'Color', cE(e, :), 'LineWidth', 1.2, ...
    'DisplayName', sprintf('M = %d (%d channels): SLL %.0f dB', ej(e).M, 100 * ej(e).M, ej(e).sll));
end
xlim(ax, [-0.6 0.6]); ylim(ax, [-60 2]); xlabel(ax, 'u = sin θ'); ylabel(ax, 'dB');
legend(ax, 'Location', 'southoutside'); grid(ax, 'on'); title(ax, '(b) Edge beam, 4 beams, L = 8');
% (c) digital channels ↔ phase shifters per element trade-off (TFG FC/SC)
ax = nexttile(tl); hold(ax, 'on');
for c = 1:numel(casos)
  plot(ax, mC(c, :), nch(c, :), '-o', 'Color', col(c, :), 'LineWidth', 1.5, 'DisplayName', casos(c).nombre);
  for j = 1:numel(Lc)
    text(ax, mC(c, j) + 0.12, nch(c, j), sprintf('%d', Lc(j)), 'FontSize', 9, 'Color', col(c, :));
  end
end
yline(ax, N^2, 'k--', 'fully digital', 'HandleVisibility', 'off', 'LabelHorizontalAlignment', 'left');
set(ax, 'YScale', 'log'); ylim(ax, [10 1e4]); xlim(ax, [1.5 8.8]); xlabel(ax, 'phase shifters per element (M)'); ylabel(ax, 'digital channels of the face');
legend(ax, 'Location', 'southoutside'); grid(ax, 'on'); title(ax, '(c) 80×80 face (label: L)');
save_figure(fig, outDir, 'e2_canales_haces');
fprintf('Done in %.0f s\n', toc(t0));

% =====================================================================================
function [uNull, hpbw] = lobulo_ideal(A, t, u)
p = abs(A' * t).^2; p = p / max(p);
[~, i0] = max(p); k = i0;
while p(k + 1) < p(k); k = k + 1; end
uNull = u(k) - u(i0);
k = i0; while p(k) > 0.5; k = k + 1; end
hpbw = 2 * (u(k) - u(i0));
end

function r = rango_efectivo(L, dl, du, sllDb)
% Numerical rank of a subarray's steering-vector block over the sector.
m = (0:L - 1)'; uu = linspace(-du / 2, du / 2, max(64, 8 * L));
sv = svd(exp(1j * 2 * pi * dl * m * uu));
r = nnz(sv / sv(1) > 10^(sllDb / 20));
end

function r = evaluar(ctx, L, M, uk, metodo)
N = ctx.N; n = ctx.n; t = ctx.t; Nsub = N / L; K = numel(uk);
F = t .* exp(1j * 2 * pi * ctx.dl * n * uk); F = F ./ vecnorm(F);   % ideal beams (fully digital)
mask = false(N, Nsub * M);
for b = 1:Nsub; mask((b - 1) * L + (1:L), (b - 1) * M + (1:M)) = true; end
g = min(max(floor(((1:K) - 1) * M / K) + 1, 1), M);                   % K beams in M contiguous groups
cm = arrayfun(@(m) mean(uk(g == m)), 1:M);
FR = zeros(N, Nsub * M);
for b = 1:Nsub
  for m = 1:M
    c = (b - 1) * M + m; FR(:, c) = mask(:, c) .* exp(1j * 2 * pi * ctx.dl * n * cm(m)) / sqrt(N);
  end
end
FR = quantize_phase(FR, ctx.bits) .* mask;
if strcmp(metodo, 'altmin')
  Ak = exp(1j * 2 * pi * ctx.dl * n * uk) / sqrt(N);
  o = struct('maxIter', 300, 'tol', 1e-8, 'quantBits', ctx.bits, 'subMask', mask, 'F_RF_init', FR);
  FR = hybrid_am_decomposition(Ak, Nsub * M, 'sc', o);
end
G = t .* FR;                                                         % T/R module taper
GG = G' * G; lam = 1e-6 * real(trace(GG)) / size(GG, 1);
W = G * ((GG + lam * eye(size(GG))) \ (G' * F));                       % digital: regularized LS
P = abs(ctx.A' * W).^2;
r.loss = 0; r.sll = -inf; r.pDb = zeros(numel(ctx.u), K);
for k = 1:K
  [~, ik] = min(abs(ctx.u - uk(k)));
  gk = P(ik, k) / norm(W(:, k))^2; g0 = abs(ctx.A(:, ik)' * F(:, k))^2;
  r.loss = max(r.loss, 10 * log10(g0 / gk));
  pk = max(P(abs(ctx.u - uk(k)) < ctx.uNull, k));
  r.sll = max(r.sll, 10 * log10(max(P(abs(ctx.u - uk(k)) >= 1.1 * ctx.uNull, k)) / pk));
  r.pDb(:, k) = 10 * log10(P(:, k) / pk);
end
r.frob = norm(W - F, 'fro') / norm(F, 'fro');
end
