%E3_TTD_ANCHO_BANDA Per-subarray TTD vs. instantaneous bandwidth (experiment E3).
%
%   Question: above what instantaneous bandwidth B is per-subarray TTD needed, with what
%   subarray size and how many delay bits? Link to the TFG: there a shared TTD layer
%   corrected squint and 3 delay bits were enough.
%
%   Model (80-element row, d = λ0/2 at f0 = 3.3 GHz, Taylor −35 dB; continuous phase
%   shifters in the bandwidth analysis and 6-bit ones in the separate check of part D,
%   because their quantization lobes already exist at f0 and do not depend on B). The problem
%   is separable: squint of an azimuth scan only affects the phase along x, and the elevation
%   factor is common to all cases; the row suffices.
%   Reception at frequency f = f0 + Δf, signal from direction u0 = sin θ0:
%     · Phase shifters only:  φ_i = Q6(−k0·x_i·u0). Phase does not scale with f: the beam
%       moves to u ≈ u0·f0/f (squint).
%     · TTD per subarray of L elements: delay τ_s = xc_s·u0/c0 per subarray (quantized
%       with b bits or continuous) and, within the subarray, phase shifters at f0. The phase
%       shifters absorb the delay quantization error at f0 (common practice), so at f0
%       the beam is exact and the error only appears away from f0, proportional to (f − f0)·δτ.
%     · TTD per element (reference): exact per-element delay, no squint. Only limited
%       by grating lobes of the element spacing at high frequencies.
%   Metrics at both band edges f0 ± B/2, taking the worse of the two. The edge is the
%   instantaneous worst case: squint grows with |f − f0|, and a chirp sweeps the whole
%   band, so at the edge the range loss and beam distortion are maximal. The mean loss
%   over the band is also reported (it is what matters for SNR after pulse compression).
%     · loss: gain at u0 vs. per-element TTD at the same f (discounts the growth of
%       electrical aperture with f);
%     · squint: peak offset, in fractions of the HPBW at that f;
%     · maximum SLL outside the main lobe (±1.1 first null around u0), quantization and
%       grating lobes included.
%   Same criterion as E2: loss ≤ 1 dB and SLL ≤ −30 dB at both edges.
%   Delay bits: LSB = τ_max/(2^b − 1), with τ_max the delay of the last subarray at 60°.
%
%   Outputs: results/fase4/ (figure and CSV) and web/src/data/e3_ttd.json. Deterministic.

clear; startup_if_needed();
t0 = tic;
S = sistema_ref();
N = S.face.Nx; f0 = S.face.f0; c0 = S.c0; d = S.face.d;
x = (0:N - 1)' * d;
t = taylorwin(N, S.beam.nbar, -S.beam.sllDb); t = t / max(t);
crit = struct('lossDb', 1, 'sllDb', -30);
critG = struct('lossDb', 1, 'sllDb', Inf);           % gain loss only
outDir = fullfile(fileparts(mfilename('fullpath')), '..', 'results', 'fase4');
dataDir = fullfile(fileparts(mfilename('fullpath')), '..', '..', 'web', 'src', 'data');
% Continuous phase shifters in the bandwidth analysis: 6-bit phase quantization lobes
% already exist at f0, at specific angles, and are checked separately in part D so as not
% to mix the two effects.
ctx = struct('x', x, 't', t, 'f0', f0, 'c0', c0, 'psBits', Inf, 'N', N, ...
  'u', linspace(-1, 1, 4001), 'tauMax', NaN, 'd', d);
[ctx.uNull0, ctx.hpbw0] = lobulo_f0(ctx);
fprintf('Row of %d elements at %.1f GHz: broadside HPBW u = %.4f (%.2f°)\n', N, f0 / 1e9, ctx.hpbw0, asind(ctx.hpbw0));

Bgrid = [1:1:50, 52:2:150, 155:5:660] * 1e6;      % Hz, up to 20 % of f0
thetas = 0:5:60;
arqs = struct('nombre', {'solo desfasadores', 'TTD por subarray L = 16', 'TTD por subarray L = 8', ...
  'TTD por subarray L = 4', 'TTD por elemento'}, 'tipo', {'ps', 'sub', 'sub', 'sub', 'elem'}, 'L', {0, 16, 8, 4, 1});

% =====================================================================================
% A · Maximum bandwidth vs. scan angle, continuous delays
% =====================================================================================
Bmax = nan(numel(arqs), numel(thetas)); BmaxG = Bmax;
for a = 1:numel(arqs)
  for j = 1:numel(thetas)
    Bmax(a, j) = buscar_bmax(ctx, arqs(a), thetas(j), Inf, Bgrid, crit);
    BmaxG(a, j) = buscar_bmax(ctx, arqs(a), thetas(j), Inf, Bgrid, critG);
  end
  sel = ismember(thetas, [15 30 45 60]);
  fprintf('[A] %-24s B_max (MHz) at 15/30/45/60°: full criterion %s · loss only %s\n', arqs(a).nombre, ...
    num2str(Bmax(a, sel) / 1e6, '%6.0f'), num2str(BmaxG(a, sel) / 1e6, '%6.0f'));
end
% spacing limit: a grating lobe enters visible space if f·d/c·(1+|u0|) > 1
Brej = 2 * (c0 ./ (d * (1 + sind(thetas))) - f0);
fprintf('[A] Grating limit (B such that f0+B/2 = c/(d(1+sin θ))): at 60° %.0f MHz\n', Brej(end) / 1e6);

% What limits each case, at 60°
for a = 1:numel(arqs)
  B = Bmax(a, end); if B >= Bgrid(end); continue; end
  Bn = Bgrid(find(Bgrid > B, 1));
  r = evaluar(ctx, arqs(a), 60, Inf, Bn);
  fprintf('[A] %-24s at 60°, first failing B %.0f MHz: loss %.2f dB, SLL %.1f dB, squint %.2f HPBW\n', ...
    arqs(a).nombre, Bn / 1e6, r.loss, r.sll, r.squint);
end

% =====================================================================================
% B · Delay bits: maximum bandwidth vs. b, worst angle from 5° to 60°
% =====================================================================================
bitsList = 1:8; Ls = [16 8 4]; thB = 5:5:60;
BmaxBits = nan(numel(Ls), numel(bitsList)); BmaxBitsG = BmaxBits;
bMin = nan(1, numel(Ls)); bMinG = bMin; tauMax = nan(1, numel(Ls));
for iL = 1:numel(Ls)
  arq = arqs([arqs.L] == Ls(iL));
  xcMax = mean(x(end - Ls(iL) + 1:end));                     % center of the last subarray
  tauMax(iL) = xcMax * sind(60) / c0;
  for ib = 1:numel(bitsList)
    bm = inf; bg = inf;
    for th = thB
      bm = min(bm, buscar_bmax(ctx, arq, th, bitsList(ib), Bgrid, crit, tauMax(iL)));
      bg = min(bg, buscar_bmax(ctx, arq, th, bitsList(ib), Bgrid, critG, tauMax(iL)));
    end
    BmaxBits(iL, ib) = bm; BmaxBitsG(iL, ib) = bg;
  end
  iA = [arqs.L] == Ls(iL); selB = ismember(thetas, thB);
  ref = min(Bmax(iA, selB)); refG = min(BmaxG(iA, selB));
  k = find(BmaxBits(iL, :) >= 0.9 * ref, 1); if ~isempty(k); bMin(iL) = bitsList(k); end
  k = find(BmaxBitsG(iL, :) >= 0.9 * refG, 1); if ~isempty(k); bMinG(iL) = bitsList(k); end
  fprintf('[B] L = %2d · τ_max(60°) = %.2f ns\n    full criterion: B_max (MHz) with b = 1..8: %s · continuous %.0f · minimum b (≥90 %%): %d\n    loss only:      B_max (MHz) with b = 1..8: %s · continuous %.0f · minimum b (≥90 %%): %d\n', ...
    Ls(iL), tauMax(iL) * 1e9, num2str(BmaxBits(iL, :) / 1e6, '%6.0f'), ref / 1e6, bMin(iL), ...
    num2str(BmaxBitsG(iL, :) / 1e6, '%6.0f'), refG / 1e6, bMinG(iL));
end
% aperture time-bandwidth product, here and in the TFG
TB = tauMax .* Bmax(2:4, thetas == 60).'; TBG = tauMax .* BmaxG(2:4, thetas == 60).';
tfgTau = 7 * (0.5 * 3e8 / 57e9) * sind(40) / 3e8; tfgB = 0.05 * 57e9;
fprintf('[B] τ_max·B_max at 60° (L = 16/8/4): full criterion %s · loss only %s · TFG (8 columns at 57 GHz, 40°, 5 %% band) %.2f\n', ...
  num2str(TB, '%6.2f'), num2str(TBG, '%6.2f'), tfgTau * tfgB);

% =====================================================================================
% C · Current web waveform (5 MHz) and mean loss over the band
% =====================================================================================
Bweb = S.env.bandwidthHz;
rPS = evaluar(ctx, arqs(1), 60, Inf, Bweb);
fprintf('[C] Phase shifters only at 60° with B = %.0f MHz: loss %.3f dB, squint %.3f HPBW (limit %.0f MHz, margin ×%.0f)\n', ...
  Bweb / 1e6, rPS.loss, rPS.squint, Bmax(1, end) / 1e6, Bmax(1, end) / Bweb);
for a = 1:numel(arqs)
  if isnan(Bmax(a, end)); continue; end
  cm = ctx; cm.media = true;
  r = evaluar(cm, arqs(a), 60, Inf, Bmax(a, end));
  fprintf('[C] %-24s at its B_max at 60°: edge loss %.2f dB, mean over the band %.2f dB\n', ...
    arqs(a).nombre, r.loss, r.lossMedia);
end

% =====================================================================================
% D · 6-bit phase shifters at f0: phase quantization lobes (independent of B)
% =====================================================================================
c6 = ctx; c6.psBits = S.beam.psBits; th6 = 0:0.5:60; sll6 = nan(size(th6));
for j = 1:numel(th6)
  r = evaluar(c6, arqs(1), th6(j), Inf, 0); sll6(j) = r.sll;
end
[s6, j6] = max(sll6);
fprintf('[D] 6 bits at f0, phase shifters only: worst SLL %.1f dB at %.1f° · %.0f %% of angles above −30 dB\n', ...
  s6, th6(j6), 100 * mean(sll6 > -30));

% =====================================================================================
% Figure example: 60°, B = 200 MHz, upper edge, three architectures
% =====================================================================================
Bej = 200e6; fEj = f0 + Bej / 2;
ej = struct([]);
for a = [1 3 5]
  r = evaluar(ctx, arqs(a), 60, Inf, Bej);
  ej(end + 1).nombre = arqs(a).nombre; ej(end).pDb = r.pAltaDb; ej(end).loss = r.loss; ej(end).sll = r.sll; %#ok<SAGROW>
end

% =====================================================================================
% Outputs
% =====================================================================================
if ~isfolder(outDir); mkdir(outDir); end
T = array2table([thetas.' Bmax.' / 1e6 BmaxG.' / 1e6 Brej.' / 1e6], 'VariableNames', ...
  {'theta', 'B_ps', 'B_sub16', 'B_sub8', 'B_sub4', 'B_elem', 'Bg_ps', 'Bg_sub16', 'Bg_sub8', 'Bg_sub4', 'Bg_elem', 'B_rejilla'});
writetable(T, fullfile(outDir, 'e3_bmax.csv'));
Tb = array2table([bitsList.' BmaxBits.' / 1e6 BmaxBitsG.' / 1e6], 'VariableNames', ...
  {'bits', 'B_sub16', 'B_sub8', 'B_sub4', 'Bg_sub16', 'Bg_sub8', 'Bg_sub4'});
writetable(Tb, fullfile(outDir, 'e3_bits.csv'));
dec = 1:2:numel(ctx.u);
out = struct('criterio', crit, 'f0', f0, 'N', N, 'thetas', thetas, ...
  'arquitecturas', {{arqs.nombre}}, 'BmaxMHz', Bmax / 1e6, 'BmaxSoloPerdidaMHz', BmaxG / 1e6, 'BrejillaMHz', Brej / 1e6, ...
  'fase6bits', struct('thetaDeg', th6, 'sllDb', sll6), ...
  'bits', struct('L', Ls, 'b', bitsList, 'BmaxMHz', BmaxBits / 1e6, 'bMin', bMin, ...
     'BmaxSoloPerdidaMHz', BmaxBitsG / 1e6, 'bMinSoloPerdida', bMinG, 'tauMaxNs', tauMax * 1e9), ...
  'web', struct('BMHz', Bweb / 1e6, 'perdidaDb', rPS.loss, 'BmaxPsMHz', Bmax(1, end) / 1e6), ...
  'ejemplo', struct('thetaDeg', 60, 'BMHz', Bej / 1e6, 'fGHz', fEj / 1e9, 'u', ctx.u(dec), ...
     'nombres', {{ej.nombre}}, 'pDb', vertcat(ej.pDb), 'loss', [ej.loss], 'sll', [ej.sll]));
out.ejemplo.pDb = out.ejemplo.pDb(:, dec);
write_json(fullfile(dataDir, 'e3_ttd.json'), out);

plot_style(); col = lines(5);
fig = figure('Visible', 'off', 'Position', [100 100 1500 560]);
tl = tiledlayout(fig, 1, 3, 'TileSpacing', 'compact');
% (a) B_max vs. angle
ax = nexttile(tl); hold(ax, 'on');
for a = 1:numel(arqs)
  plot(ax, thetas, Bmax(a, :) / 1e6, '-o', 'Color', col(a, :), 'LineWidth', 1.5, 'MarkerSize', 5, 'DisplayName', arqs(a).nombre);
  plot(ax, thetas, BmaxG(a, :) / 1e6, '--', 'Color', col(a, :), 'LineWidth', 1, 'HandleVisibility', 'off');
end
plot(ax, NaN, NaN, 'k--', 'DisplayName', 'loss only ≤ 1 dB');
plot(ax, thetas, min(Brej, 660e6) / 1e6, 'k-.', 'LineWidth', 1, 'DisplayName', 'spacing grating limit');
yline(ax, Bweb / 1e6, ':', 'Color', [0.4 0.4 0.4], 'LineWidth', 1.2, 'DisplayName', 'web waveform (5 MHz)');
set(ax, 'YScale', 'log'); ylim(ax, [1 1000]); xlim(ax, [5 60]);
xlabel(ax, 'scan angle θ_0 (°)'); ylabel(ax, 'maximum B (MHz)');
legend(ax, 'Location', 'southoutside', 'NumColumns', 2); grid(ax, 'on'); title(ax, '(a) Maximum bandwidth');
% (b) patterns at the upper edge
ax = nexttile(tl); hold(ax, 'on');
cE = col([1 3 5], :);
for e = 1:numel(ej)
  plot(ax, ctx.u, ej(e).pDb, '-', 'Color', cE(e, :), 'LineWidth', 1.2, ...
    'DisplayName', sprintf('%s: loss %.1f dB, SLL %.0f dB', ej(e).nombre, ej(e).loss, ej(e).sll));
end
xline(ax, sind(60), 'k:', 'HandleVisibility', 'off');
xlim(ax, [0.3 1]); ylim(ax, [-60 2]); xlabel(ax, 'u = sin θ'); ylabel(ax, 'dB');
legend(ax, 'Location', 'southoutside'); grid(ax, 'on');
title(ax, sprintf('(b) 60°, edge of %.0f MHz', Bej / 1e6));
% (c) delay bits
ax = nexttile(tl); hold(ax, 'on');
for iL = 1:numel(Ls)
  a = find([arqs.L] == Ls(iL));
  plot(ax, bitsList, BmaxBits(iL, :) / 1e6, '-o', 'Color', col(a, :), 'LineWidth', 1.5, ...
    'DisplayName', sprintf('L = %d', Ls(iL)));
  plot(ax, bitsList, BmaxBitsG(iL, :) / 1e6, '--s', 'Color', col(a, :), 'LineWidth', 1, 'MarkerSize', 4, ...
    'HandleVisibility', 'off');
end
plot(ax, NaN, NaN, 'k-o', 'DisplayName', 'full criterion');
plot(ax, NaN, NaN, 'k--s', 'DisplayName', 'loss only ≤ 1 dB');
xline(ax, 3, '--', 'TFG: 3 bits', 'Color', [0.4 0.4 0.4], 'HandleVisibility', 'off', 'LabelVerticalAlignment', 'bottom');
set(ax, 'YScale', 'log'); ylim(ax, [1 1000]);
xlabel(ax, 'delay bits b'); ylabel(ax, 'maximum B, worst θ_0 ≤ 60° (MHz)');
legend(ax, 'Location', 'southoutside', 'NumColumns', 2); grid(ax, 'on'); title(ax, '(c) Delay bits');
save_figure(fig, outDir, 'e3_ttd_ancho_banda');
fprintf('Done in %.0f s\n', toc(t0));

% =====================================================================================
function Bm = buscar_bmax(ctx, arq, th, bits, Bgrid, crit, tauMax)
% Largest B on the grid that meets the criterion. Bisection: assumes that once it fails,
% it keeps failing as the band widens (squint and delay error grow with |f − f0|).
if nargin >= 7; ctx.tauMax = tauMax; end
cumple = @(B) local_cumple(evaluar(ctx, arq, th, bits, B), crit);
if ~cumple(Bgrid(1)); Bm = 0; return; end
if cumple(Bgrid(end)); Bm = Bgrid(end); return; end
lo = 1; hi = numel(Bgrid);
while hi - lo > 1
  mid = floor((lo + hi) / 2);
  if cumple(Bgrid(mid)); lo = mid; else; hi = mid; end
end
Bm = Bgrid(lo);
end

function ok = local_cumple(r, crit)
ok = r.loss <= crit.lossDb && r.sll <= crit.sllDb;
end

function [uNull, hpbw] = lobulo(ctx, f, u0) %#ok<INUSD>
% First null and HPBW of the ideal Taylor. The pattern depends only on k·(u − u0), so
% they scale with f0/f.
uNull = ctx.uNull0 * ctx.f0 / f; hpbw = ctx.hpbw0 * ctx.f0 / f;
end

function [uNull, hpbw] = lobulo_f0(ctx)
k = 2 * pi * ctx.f0 / ctx.c0;
uu = linspace(-0.2, 0.2, 8001);
p = abs(diagrama(ctx, ctx.t, k, uu)).^2; p = p / max(p);
i0 = 4001; j = i0;
while p(j + 1) < p(j); j = j + 1; end
uNull = uu(j);
j = i0; while p(j) > 0.5; j = j + 1; end
hpbw = 2 * uu(j);
end

function y = diagrama(ctx, w, k, u)
% Σ w_i·z^i with z = exp(j·k·d·u) (equispaced elements), via Horner.
z = exp(1j * k * ctx.d * u(:));
y = zeros(size(z)); y(:) = w(end);
for i = numel(w) - 1:-1:1; y = y .* z + w(i); end
end

function w = pesos(ctx, arq, u0, bits, f)
% Receive weights at frequency f: output Σ w_i·exp(j·k·x_i·u), coherent if the applied
% phase is −k·x_i·u0.
k0 = 2 * pi * ctx.f0 / ctx.c0; x = ctx.x;
switch arq.tipo
  case 'ps'
    phi = q(-k0 * x * u0, ctx.psBits);                      % fixed phase, computed at f0
  case 'elem'
    phi = -2 * pi * f * x * u0 / ctx.c0;                     % exact per-element delay
  case 'sub'
    L = arq.L; s = floor((0:ctx.N - 1)' / L);
    xc = accumarray(s + 1, x, [], @mean); xc = xc(s + 1);
    tau = xc * u0 / ctx.c0;                                  % ideal subarray delay
    if isfinite(bits)
      lsb = ctx.tauMax / (2^bits - 1);
      tq = min(round(tau / lsb), 2^bits - 1) * lsb;
    else
      tq = tau;
    end
    % phase shifters complete the exact phase at f0 (absorbing the quantized-delay error)
    phi = q(-k0 * x * u0 + 2 * pi * ctx.f0 * tq, ctx.psBits) - 2 * pi * f * tq;
end
w = ctx.t .* exp(1j * phi);
end

function p = q(ph, b)
if ~isfinite(b) || b <= 0; p = ph; return; end
step = 2 * pi / 2^b; p = round(ph / step) * step;
end

function r = evaluar(ctx, arq, th, bits, B)
u0 = sind(th);
fs = ctx.f0 + [-1 1] * B / 2;
r.loss = 0; r.sll = -inf; r.squint = 0;
for f = fs
  k = 2 * pi * f / ctx.c0;
  w = pesos(ctx, arq, u0, bits, f);
  g = abs(sum(w .* exp(1j * k * ctx.x * u0)))^2;
  g0 = sum(ctx.t)^2;                                         % per-element TTD at the same f
  r.loss = max(r.loss, 10 * log10(g0 / g));
  [uNull, hpbw] = lobulo(ctx, f, u0);
  P = abs(diagrama(ctx, w, k, ctx.u)).^2;
  main = abs(ctx.u - u0) < uNull;
  pk = max(P(main));
  if isempty(pk) || pk == 0; pk = max(P); end
  r.sll = max(r.sll, 10 * log10(max(P(abs(ctx.u - u0) >= 1.1 * uNull)) / pk));
  ul = u0 + linspace(-2, 2, 401) * hpbw;
  pl = abs(diagrama(ctx, w, k, ul)).^2;
  [~, im] = max(pl);
  r.squint = max(r.squint, abs(ul(im) - u0) / hpbw);
  if f == fs(end); r.pAltaDb = (10 * log10(P / pk)).'; end
end
r.lossMedia = NaN;
if ~isfield(ctx, 'media') || ~ctx.media; return; end
% mean loss over the band (11 frequencies)
gm = 0; g0m = 0;
for f = linspace(fs(1), fs(2), 11)
  k = 2 * pi * f / ctx.c0; w = pesos(ctx, arq, u0, bits, f);
  gm = gm + abs(sum(w .* exp(1j * k * ctx.x * u0)))^2; g0m = g0m + sum(ctx.t)^2;
end
r.lossMedia = 10 * log10(g0m / gm);
end
