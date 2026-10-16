%MC_CLUTTER_K K-distributed sea clutter: generator, CA-CFAR false alarms and detection loss.
%
%   K1 · Generator: single-pulse intensity after pulse compression (clutter only, high CNR)
%        versus the analytic K-distribution CCDF and its second moment 2·(1 + 1/ν).
%   K2 · 2D CA-CFAR designed for Gaussian clutter (Pfa = 10⁻⁶) on the range-Doppler map
%        with K clutter: actual Pfa versus ν and CNR.
%   K3 · Loss: threshold factor that restores Pfa to 10⁻⁶, and Pd of a Swerling 1 target
%        with that threshold → equivalent loss relative to the Gaussian case.
%   Waveform and CFAR from mc_pd_s2.m. Outputs in results/fase3/clutter_k.json.

clear; startup_if_needed();
t0 = tic;
S = sistema_ref();
W.tau = 20e-6; W.B = 5e6; W.fs = 2 * W.B; W.prf = 2.5e3; W.np = 16;
wf = phased.LinearFMWaveform('SampleRate', W.fs, 'PulseWidth', W.tau, 'SweepBandwidth', W.B, 'PRF', W.prf, 'NumPulses', 1);
x = wf(); s = x(1:round(W.tau * W.fs)); s = s / norm(s);
lam = S.face.lambda; pri = 1 / W.prf; Np = W.np; pfa = 1e-6; nWin = 200;
texS = 4;                                       % texture correlation: 4 samples = 60 m
sigmaV = 1.44; sigmaF = 2 * sigmaV / lam;       % sea Doppler spectrum (S2)
win = chebwin(Np, 50); win = win / norm(win);
out = struct();

% ── K1: generator ──
rng(run_id_to_seed('K1'));
nus = [0.3 1 3 10];
P = struct('s', s, 'nWin', nWin, 'nPulses', 1, 'pri', pri, 'lam', lam, 'tgt', struct('on', false), ...
  'clut', struct('on', true, 'cnr', 1e4 * ones(nWin, 1), 'sigmaF', sigmaF, 'fc', 0, 'texSamples', texS));
h = conj(flipud(s));
for i = 1:numel(nus)
  P.clut.nu = nus(i); I = [];
  for r = 1:400
    X = sim_cpi(P);
    y = conv(X(:, 1), h, 'valid');
    I = [I; abs(y(texS / 2 + 1:texS:end - texS)).^2]; %#ok<AGROW>   % center of each texture block
  end
  I = I / mean(I);
  tt = [1 3 5 10 15];
  ccdfEmp = arrayfun(@(t) mean(I > t), tt);
  ccdfK = arrayfun(@(t) 2 / gamma(nus(i)) * (nus(i) * t)^(nus(i) / 2) * besselk(nus(i), 2 * sqrt(nus(i) * t)), tt);
  out.K1(i) = struct('nu', nus(i), 'm2', mean(I.^2), 'm2Teo', 2 * (1 + 1 / nus(i)), 't', tt, 'ccdf', ccdfEmp, 'ccdfK', ccdfK);
  fprintf('[K1] ν=%4.1f  E[I²]/E[I]² = %.2f (theory %.2f)  CCDF(t=10): %.1e (K %.1e)\n', nus(i), out.K1(i).m2, out.K1(i).m2Teo, ccdfEmp(4), ccdfK(4));
end

% ── K2a: 2D CA-CFAR with the full chain: edge of the clutter ridge ──
cfar = phased.CFARDetector2D('TrainingBandSize', [10 1], 'GuardBandSize', [2 1], ...
  'ProbabilityFalseAlarm', pfa, 'Method', 'CA', 'ThresholdFactor', 'Custom', 'CustomThresholdFactor', 1, 'ThresholdOutputPort', true);
ga = 10; gd = 2; c0 = Np / 2 + 1;               % zero-Doppler column after fftshift
[ri, di] = ndgrid(ga + 3:nWin - ga - 2, gd + 1:Np - gd);
cut = [ri(:) di(:)].';
nRef2 = (2 * 12 + 1) * (2 * 2 + 1) - (2 * 2 + 1) * (2 * 1 + 1);
alpha2 = nRef2 * (pfa^(-1 / nRef2) - 1);
rng(run_id_to_seed('K2a'));
for in = 1:2
  nuA = [Inf 0.5]; P = struct('s', s, 'nWin', nWin, 'nPulses', Np, 'pri', pri, 'lam', lam, 'tgt', struct('on', false), ...
    'clut', struct('on', true, 'cnr', 100 * ones(nWin, 1), 'sigmaF', sigmaF, 'fc', 0, 'nu', nuA(in), 'texSamples', texS));
  fa = zeros(1, 3); nc = zeros(1, 3);           % [zero Doppler, ±1 neighbors, rest]
  for r = 1:300
    Z = proc_cpi(sim_cpi(P), s, win);
    [~, th] = cfar(Z, cut);
    d = abs(cut(2, :) - c0); grp = 1 + (d >= 1) + (d >= 2);
    hit = Z(sub2ind(size(Z), cut(1, :), cut(2, :))) > alpha2 * th(:).';
    for g = 1:3, fa(g) = fa(g) + nnz(hit(grp == g)); nc(g) = nc(g) + nnz(grp == g); end
  end
  out.K2a(in) = struct('nu', nuA(in), 'cnrDb', 20, 'pfaDopplerCero', fa(1) / nc(1), 'pfaVecinas', fa(2) / nc(2), 'pfaResto', fa(3) / nc(3));
  fprintf('[K2a] 2D CFAR, CNR 20 dB, ν=%s: Pfa at zero Doppler %.1e · neighbors %.1e · rest %.1e (design 1e-6)\n', ...
    num2str(nuA(in)), fa(1) / nc(1), fa(2) / nc(2), fa(3) / nc(3));
end

% ── K2b: fast generator of the zero-Doppler column versus the full chain ──
chi = conv(s, conj(flipud(s))); chi = chi / norm(chi);    % autocorrelation of the compressed pulse
nG = 10; gG = 2; Nref = 2 * nG; alphaG = Nref * (pfa^(-1 / Nref) - 1);   % range CA, 20 cells
ratioFn = @(Z) cfar1d(Z, nG, gG);
rng(run_id_to_seed('K2b'));
P = struct('s', s, 'nWin', nWin, 'nPulses', Np, 'pri', pri, 'lam', lam, 'tgt', struct('on', false), ...
  'clut', struct('on', true, 'cnr', 100 * ones(nWin, 1), 'sigmaF', sigmaF, 'fc', 0, 'nu', 0.5, 'texSamples', texS));
rc = []; m0 = [];
for r = 1:600
  Z = proc_cpi(sim_cpi(P), s, win); z0 = Z(:, c0);
  rc = [rc; ratioFn(z0)]; m0 = [m0; mean(z0)]; %#ok<AGROW>
end
cint = mean(m0) - 1;                           % CNR in the zero-Doppler cell
[zr, ~, ~] = perfil_rapido(cint, 0.5, texS, chi, 2e6);
rr = ratioFn(zr);
thr = [3 6 10];
out.K2b = struct('nu', 0.5, 'cintDb', 10 * log10(cint), 'umbral', thr, ...
  'ccdfCadena', arrayfun(@(t) mean(rc > t), thr), 'ccdfRapido', arrayfun(@(t) mean(rr > t), thr));
fprintf('[K2b] zero-Doppler CNR %.1f dB · CCDF of the CUT/training ratio (t = 3, 6, 10): chain %s · fast %s\n', ...
  10 * log10(cint), mat2str(out.K2b.ccdfCadena, 2), mat2str(out.K2b.ccdfRapido, 2));

% ── K3: threshold for Pfa = 10⁻⁶ and detection loss (Swerling 1) in K clutter ──
cints = [10 20 30]; nusK = [Inf 3 1 0.5 0.3]; nCell = 3e7;
pdT = [0.5 0.9];
rng(run_id_to_seed('K3'));
for ic = 1:numel(cints)
  C = 10^(cints(ic) / 10);
  for in = 1:numel(nusK)
    [zr, tau, ~] = perfil_rapido(C, nusK(in), texS, chi, nCell);
    [ra, est, ix] = ratioFn(zr);
    q = sort(ra, 'descend'); alphaK = q(round(numel(ra) * pfa));
    pfaG = mean(ra > alphaG);
    % Pd of a Swerling 1 target with SNR S: E[exp(−α·est/(S + C·τ + 1))] over actual cells
    sub = 1:20:numel(ix); tc = tau(ix(sub)); es = est(sub);
    pdF = @(S, a) mean(exp(-a * es ./ (S + C * tc + 1)));
    sReq = zeros(2, 2);
    for k = 1:2
      sReq(k, 1) = fzero(@(x) pdF(10^(x / 10), alphaG) - pdT(k), [-20 90]);   % Gaussian threshold
      sReq(k, 2) = fzero(@(x) pdF(10^(x / 10), alphaK) - pdT(k), [-20 90]);   % threshold for actual 1e-6
    end
    out.K3(ic, in) = struct('cintDb', cints(ic), 'nu', nusK(in), 'pfaUmbralGauss', pfaG, ...
      'umbralExtraDb', 10 * log10(alphaK / alphaG), 'snrPd50', sReq(1, :), 'snrPd90', sReq(2, :));
    fprintf('[K3] CNR %2d dB ν=%4s · Pfa with Gaussian threshold %.1e · threshold +%.1f dB · SNR for Pd 0.9: %.1f dB (Gaussian: %.1f)\n', ...
      cints(ic), num2str(nusK(in)), pfaG, 10 * log10(alphaK / alphaG), sReq(2, 2), sReq(2, 1));
  end
end

root = fileparts(fileparts(mfilename('fullpath')));
od = fullfile(root, 'results', 'fase3'); if ~exist(od, 'dir'), mkdir(od); end
write_json(fullfile(od, 'clutter_k.json'), out);
% table for the web engine: loss (extra SNR for Pd 0.9 relative to Gaussian clutter) per ν and CNR
T = struct('nu', nusK(2:end), 'cnrDb', cints, 'perdidaDb', [], 'pfaUmbralGauss', []);
for ic = 1:numel(cints)
  g = out.K3(ic, 1).snrPd90(2);
  T.perdidaDb(ic, :) = arrayfun(@(k) out.K3(ic, k).snrPd90(2) - g, 2:numel(nusK));
  T.pfaUmbralGauss(ic, :) = arrayfun(@(k) out.K3(ic, k).pfaUmbralGauss, 2:numel(nusK));
end
T.meta = struct('generado', char(datetime('now', 'Format', 'yyyy-MM-dd HH:mm')), 'origen', 'matlab/fase3_linea_base/mc_clutter_k.m', ...
  'cfar', 'CA en distancia, 20 celdas, 2 de guarda, Pfa 1e-6', 'blanco', 'Swerling 1, Pd 0,9', 'texturaM', texS * 15);
write_json(fullfile(web_validation_dir(), '..', 'engine', 'clutter_k_tabla.json'), T);
fprintf('mc_clutter_k: %.0f s\n', toc(t0));

function [r, est, ix] = cfar1d(z, n, g)
%CFAR1D Ratio of cell to the mean of the 2n training cells (n per side, g guard cells).
z = z(:); M = numel(z); c = cumsum([0; z]);
ix = (n + g + 1:M - n - g).';
est = ((c(ix - g) - c(ix - g - n)) + (c(ix + g + n + 1) - c(ix + g + 1))) / (2 * n);
r = z(ix) ./ est;
end

function [z, tau, sp] = perfil_rapido(C, nu, texS, chi, M)
%PERFIL_RAPIDO Zero-Doppler cell output for a range profile of M samples:
%   |√C·Σ_k χ_{r−k}·√τ_k·a_k + n_r|², Gamma(ν) texture in blocks of texS samples,
%   speckle correlated in range by the compressed-pulse autocorrelation, unit noise.
nb = ceil((M + numel(chi)) / texS) + 1;
tau = repelem(textura_gamma(nu, nb), texS); tau = tau(1:M + numel(chi) - 1);
a = (randn(numel(tau), 1) + 1j * randn(numel(tau), 1)) / sqrt(2) .* sqrt(tau);
sp = conv(a, chi, 'valid');
sp = [sp; zeros(M - numel(sp), 1)];
L = (numel(chi) - 1) / 2; tau = tau(L + 1:L + M);
n = (randn(M, 1) + 1j * randn(M, 1)) / sqrt(2);
z = abs(sqrt(C) * sp + n).^2;
end
