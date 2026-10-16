%E1_PARTICION_SUBARRAYS Subarray partitioning: regular, irregular or overlapped (experiment E1).
%
%   Question: with the same number of digital channels, which partition of the face minimizes
%   quantization lobes, and how far can the digital beam be steered away from the analog
%   pointing? Follows from E2: with one port per subarray, as soon as the digital beam departs
%   from the analog pointing, quantization lobes appear (−13 dB with L = 8 and a 4-beam
%   cluster), because the subarray phase centers form a periodic lattice of pitch L·d.
%
%   Hardware model: same as E2 (e2_canales_haces.m).
%     · Taylor taper in the T/R module, common to all channels.
%     · 6-bit phase shifters (phase only) per element and port, steered to the analog center.
%     · Digital: regularized least squares against the ideal (fully digital) beam.
%     · Row of 80 elements and 10 channels (the 10×10-subarray reference face, separable).
%   Partitions, all with 10 channels:
%     · Regular: 10 subarrays of 8.
%     · Irregular: 10 contiguous subarrays of different sizes (4 to 12) summing to 80. This is
%       the TFG's non-uniform SC mask (build_sc_mask, layout 'nonuniform'). Found by
%       deterministic random search (3000 candidates) minimizing the worst SLL with the beam
%       steered up to 0.25 subarray beamwidths. Aperiodicity breaks the phase-center
%       lattice that creates the quantization lobes.
%     · Overlapped: each channel combines o·L elements centered on the regular subarray
%       center, with fixed amplitude weights in the combining network (o = 2 and 3). The
%       phase shifter sits before the split (still one per element and port), but each
%       element feeds o combiners: o 1:o dividers per element and o times more combiner
%       inputs. Rectangular, Hann and truncated-sinc windows are tried (approximating the
%       flat-topped subarray pattern) and the best is kept with the same criterion as the irregular.
%   Metrics: maximum SLL (quantization lobes included) and loss versus the digital beam
%   offset δ, in units of the regular subarray beamwidth λ/(L·d) (= 0.25 in u).
%   E2 criterion: loss ≤ 1 dB and SLL ≤ −30 dB.
%   Extra: minimum M for a "4-beam cluster" (Δu = 3·HPBW), which in E2 was M = 2 with the regular.
%
%   Outputs: results/fase4/ (figure and CSV) and web/src/data/e1_particion.json.
%   Deterministic seed: run_id_to_seed('E1-irregular').

clear; startup_if_needed();
t0 = tic;
S = sistema_ref();
N = S.face.Nx; n = (0:N - 1)'; dl = S.face.dLambda;
L = S.face.subNx; Nch = N / L;
t = taylorwin(N, S.beam.nbar, -S.beam.sllDb); t = t / max(t);
bits = S.beam.psBits;
crit = struct('lossDb', 1, 'sllDb', -30);
bwSub = 1 / (L * dl);                                % regular subarray beamwidth (u)
outDir = fullfile(fileparts(mfilename('fullpath')), '..', 'results', 'fase4');
dataDir = fullfile(fileparts(mfilename('fullpath')), '..', '..', 'web', 'src', 'data');

u = linspace(-1, 1, 8001); A = exp(1j * 2 * pi * dl * n * u);
[uNull, hpbw] = lobulo_ideal(A, t, u);
ctx = struct('n', n, 'dl', dl, 't', t, 'bits', bits, 'u', u, 'A', A, 'uNull', uNull);
uS = linspace(-1, 1, 2001);                           % coarse grid for the search
ctxS = ctx; ctxS.u = uS; ctxS.A = exp(1j * 2 * pi * dl * n * uS);
dDis = [-0.25 -0.2 -0.15 -0.1 -0.05 0.05 0.1 0.15 0.2 0.25] * bwSub;   % design offsets
fprintf('L = %d, %d channels, subarray beamwidth %.3f in u, face HPBW %.4f\n', L, Nch, bwSub, hpbw);

% =====================================================================================
% Partitions
% =====================================================================================
P = particion_contigua('regular (10×8)', L * ones(1, Nch));

rng(run_id_to_seed('E1-irregular'));
nCand = 3000; best = inf; tamBest = [];
for c = 1:nCand
  tam = randi([4 12], 1, Nch);
  while sum(tam) ~= N; tam = randi([4 12], 1, Nch); end
  Pc = particion_contigua('', tam);
  f = peor_sll(ctxS, Pc, dDis);
  if f < best; best = f; tamBest = tam; end
end
P(2) = particion_contigua('irregular', tamBest);
fprintf('Irregular: best of %d candidates, sizes [%s], worst design SLL %.1f dB\n', nCand, num2str(tamBest), best);

ventanas = {'rect', 'hann', 'sinc'};
for o = [2 3]
  best = inf;
  for v = 1:numel(ventanas)
    Pc = particion_solapada('', N, L, o, ventanas{v});
    f = peor_sll(ctxS, Pc, dDis);
    fprintf('  overlapped ×%d, window %-4s: worst design SLL %.1f dB\n', o, ventanas{v}, f);
    if f < best; best = f; vBest = ventanas{v}; end
  end
  P(end + 1) = particion_solapada(sprintf('solapada ×%d (%s)', o, vBest), N, L, o, vBest); %#ok<SAGROW>
end

% =====================================================================================
% A · Single beam offset by δ from the analog pointing (M = 1, 10 channels)
% =====================================================================================
dGrid = linspace(0, 1, 41);                           % δ in subarray beamwidths
sll = nan(numel(P), numel(dGrid)); loss = sll; islr = sll;
for p = 1:numel(P)
  for j = 1:numel(dGrid)
    r = evaluar(ctx, P(p), 1, dGrid(j) * bwSub, 0);
    sll(p, j) = r.sll; loss(p, j) = r.loss; islr(p, j) = r.islr;
  end
end
dMax = nan(1, numel(P));
for p = 1:numel(P)
  ok = sll(p, :) <= crit.sllDb & loss(p, :) <= crit.lossDb;
  k = find(~ok, 1); if isempty(k); dMax(p) = dGrid(end); elseif k > 1; dMax(p) = dGrid(k - 1); else; dMax(p) = 0; end
  fprintf('[A] %-22s max δ with SLL ≤ %d dB and loss ≤ %d dB: %.3f subarray widths (%.4f in u = %.1f HPBW)\n', ...
    P(p).nombre, crit.sllDb, crit.lossDb, dMax(p), dMax(p) * bwSub, dMax(p) * bwSub / hpbw);
end

% example pattern at δ = 0.25 subarray widths
dE = 0.25; [~, jE] = min(abs(dGrid - dE));
ej = struct([]);
for p = 1:numel(P)
  r = evaluar(ctx, P(p), 1, dE * bwSub, 0);
  ej(p).pDb = r.pDb.'; ej(p).sll = r.sll; ej(p).islr = r.islr; %#ok<SAGROW>
  fprintf('[A] δ = %.2f: %-22s SLL %6.1f dB · ISLR %6.1f dB · loss %.2f dB\n', dE, P(p).nombre, r.sll, r.islr, r.loss);
end
pIdeal = abs(A' * (t .* exp(1j * 2 * pi * dl * n * dE * bwSub))).^2;
pIdealDb = 10 * log10(pIdeal / max(pIdeal)).';
islrIdeal = islr_de(ctx, pIdeal, dE * bwSub);

% =====================================================================================
% B · Link to E2: minimum M for a 4-beam cluster (Δu = 3·HPBW)
% =====================================================================================
K = 4; uk = linspace(-1.5 * hpbw, 1.5 * hpbw, K);
Mmin = nan(1, numel(P)); resB = cell(1, numel(P));
for p = 1:numel(P)
  for M = 1:K
    g = min(max(floor(((1:K) - 1) * M / K) + 1, 1), M);
    cm = arrayfun(@(m) mean(uk(g == m)), 1:M);
    r = evaluar(ctx, P(p), M, uk, cm);
    resB{p}(M, :) = [r.loss r.sll];
    if r.loss <= crit.lossDb && r.sll <= crit.sllDb; Mmin(p) = M; break; end
  end
  fprintf('[B] %-22s min M = %d → %3d channels in the row, %4d on the 2D face · M=1: SLL %.1f dB, loss %.2f dB\n', ...
    P(p).nombre, Mmin(p), Nch * Mmin(p), Nch^2 * Mmin(p), resB{p}(1, 2), resB{p}(1, 1));
end

% hardware cost per element (with M ports): phase shifters and combiner inputs
for p = 1:numel(P)
  P(p).entradasPorElem = sum(cellfun(@numel, P(p).idx)) / N;
end

% =====================================================================================
% Outputs
% =====================================================================================
if ~isfolder(outDir); mkdir(outDir); end
nombres = {P.nombre}.';
Tab = table(nombres, dMax.', dMax.' * bwSub / hpbw, Mmin.', Nch * Mmin.', Nch^2 * Mmin.', [P.entradasPorElem].', ...
  [ej.sll].', [ej.islr].', 'VariableNames', {'particion', 'dMaxSub', 'dMaxHPBW', 'MminRacimo4', 'canalesFila', ...
  'canalesCara', 'entradasCombPorElem', 'sllDelta025', 'islrDelta025'});
writetable(Tab, fullfile(outDir, 'e1_particion.csv'));
dec = 1:4:numel(u);
out = struct('criterio', crit, 'L', L, 'canales', Nch, 'bwSub', bwSub, 'hpbwU', hpbw, ...
  'particiones', struct('nombre', nombres, 'tam', {P.tam}.', 'entradasPorElem', {P.entradasPorElem}.'), ...
  'delta', dGrid, 'sllDb', sll, 'lossDb', loss, 'islrDb', islr, 'deltaMax', dMax, ...
  'racimo4', struct('K', K, 'uk', uk, 'Mmin', Mmin), ...
  'ejemplo', struct('delta', dE, 'u', u(dec), 'idealDb', pIdealDb(dec), ...
     'pDb', cell2mat(arrayfun(@(e) e.pDb(dec), ej(:), 'UniformOutput', false)), ...
     'sll', [ej.sll], 'islr', [ej.islr], 'islrIdeal', islrIdeal));
write_json(fullfile(dataDir, 'e1_particion.json'), out);

plot_style(); col = lines(numel(P)); col(1, :) = [0.1 0.1 0.1];
fig = figure('Visible', 'off', 'Position', [100 100 1500 600]);
tl = tiledlayout(fig, 1, 3, 'TileSpacing', 'compact');
ax = nexttile(tl); hold(ax, 'on');
for p = 1:numel(P)
  plot(ax, dGrid, sll(p, :), '-', 'Color', col(p, :), 'LineWidth', 1.6, 'DisplayName', P(p).nombre);
end
yline(ax, crit.sllDb, 'k--', 'HandleVisibility', 'off');
xline(ax, 0.18, ':', '4-beam cluster', 'HandleVisibility', 'off', 'LabelVerticalAlignment', 'bottom');
xlabel(ax, 'δ (subarray beamwidths, λ/(L·d))'); ylabel(ax, 'maximum SLL (dB)'); ylim(ax, [-40 0]);
grid(ax, 'on'); title(ax, '(a) Sidelobes vs. offset');
legend(ax, 'Location', 'southoutside');
ax = nexttile(tl); hold(ax, 'on');
for p = 1:numel(P)
  plot(ax, dGrid, loss(p, :), '-', 'Color', col(p, :), 'LineWidth', 1.6, 'DisplayName', P(p).nombre);
end
yline(ax, crit.lossDb, 'k--', 'HandleVisibility', 'off');
xlabel(ax, 'δ (subarray beamwidths)'); ylabel(ax, 'loss vs. fully digital (dB)'); ylim(ax, [0 6]);
grid(ax, 'on'); title(ax, '(b) Gain loss');
ax = nexttile(tl); hold(ax, 'on');
plot(ax, u, pIdealDb, '-', 'Color', [0.6 0.6 0.6], 'LineWidth', 1, 'DisplayName', 'fully digital');
for p = [1 2 numel(P)]
  plot(ax, u, ej(p).pDb, '-', 'Color', col(p, :), 'LineWidth', 1.1, ...
    'DisplayName', sprintf('%s: SLL %.0f dB', P(p).nombre, ej(p).sll));
end
xlim(ax, [-0.6 0.6]); ylim(ax, [-60 2]); xlabel(ax, 'u = sin θ'); ylabel(ax, 'dB');
grid(ax, 'on'); title(ax, sprintf('(c) Pattern at δ = %.2f', dE));
legend(ax, 'Location', 'southoutside');
save_figure(fig, outDir, 'e1_particion_subarrays');
fprintf('Done in %.0f s\n', toc(t0));

% =====================================================================================
function P = particion_contigua(nombre, tam)
fin = cumsum(tam); ini = [1 fin(1:end - 1) + 1];
P.nombre = nombre; P.tam = tam;
P.idx = arrayfun(@(a, b) (a:b)', ini, fin, 'UniformOutput', false);
P.amp = cellfun(@(i) ones(numel(i), 1), P.idx, 'UniformOutput', false);
end

function P = particion_solapada(nombre, N, L, o, ventana)
Nch = N / L; Lo = o * L;
P.nombre = nombre; P.tam = Lo * ones(1, Nch);
P.idx = cell(1, Nch); P.amp = cell(1, Nch);
for c = 1:Nch
  cen = (c - 1) * L + (L + 1) / 2;                   % regular subarray center (index 1..N)
  x = (1:Lo) - (Lo + 1) / 2;                         % position relative to the center
  switch ventana
    case 'rect'; w = ones(1, Lo);
    case 'hann'; w = 0.5 + 0.5 * cos(2 * pi * x / Lo);
    case 'sinc'; w = sinc(x / L) .* (0.5 + 0.5 * cos(2 * pi * x / Lo));
  end
  idx = round(cen + x);
  keep = idx >= 1 & idx <= N;                        % clipped at the face edges
  P.idx{c} = idx(keep)'; P.amp{c} = w(keep)';
end
end

function f = peor_sll(ctx, P, dDis)
f = -inf;
for d = dDis
  r = evaluar(ctx, P, 1, d, 0, true);
  f = max(f, r.sll);
end
end

function r = evaluar(ctx, P, M, uk, cm, rapido)
% M ports per channel of partition P, steered to cm; digital beams at uk.
if nargin < 6; rapido = false; end
n = ctx.n; t = ctx.t; Nsub = numel(P.idx); K = numel(uk); N = numel(n);
F = t .* exp(1j * 2 * pi * ctx.dl * n * uk); F = F ./ vecnorm(F);
step = 2 * pi / 2^ctx.bits;
G = zeros(N, Nsub * M);
for b = 1:Nsub
  i = P.idx{b};
  for m = 1:M
    ph = round(2 * pi * ctx.dl * n(i) * cm(m) / step) * step;   % 6-bit phase shifters
    G(i, (b - 1) * M + m) = t(i) .* P.amp{b} .* exp(1j * ph);
  end
end
GG = G' * G; lam = 1e-6 * real(trace(GG)) / size(GG, 1);
W = G * ((GG + lam * eye(size(GG))) \ (G' * F));
Pw = abs(ctx.A' * W).^2;
r.loss = 0; r.sll = -inf; r.islr = -inf;
if ~rapido; r.pDb = zeros(numel(ctx.u), K); end
for k = 1:K
  [~, ik] = min(abs(ctx.u - uk(k)));
  gk = Pw(ik, k) / norm(W(:, k))^2; g0 = abs(ctx.A(:, ik)' * F(:, k))^2;
  r.loss = max(r.loss, 10 * log10(g0 / gk));
  main = abs(ctx.u - uk(k)) < ctx.uNull;
  pk = max(Pw(main, k));
  r.sll = max(r.sll, 10 * log10(max(Pw(abs(ctx.u - uk(k)) >= 1.1 * ctx.uNull, k)) / pk));
  if ~rapido
    r.islr = max(r.islr, islr_de(ctx, Pw(:, k), uk(k)));
    r.pDb(:, k) = 10 * log10(Pw(:, k) / pk);
  end
end
end

function v = islr_de(ctx, p, u0)
% Integrated sidelobe ratio: power outside the main lobe / inside (in u).
main = abs(ctx.u - u0) < ctx.uNull;
v = 10 * log10(sum(p(~main)) / sum(p(main)));
end

function [uNull, hpbw] = lobulo_ideal(A, t, u)
p = abs(A' * t).^2; p = p / max(p);
[~, i0] = max(p); k = i0;
while p(k + 1) < p(k); k = k + 1; end
uNull = u(k) - u(i0);
k = i0; while p(k) > 0.5; k = k + 1; end
hpbw = 2 * (u(k) - u(i0));
end
