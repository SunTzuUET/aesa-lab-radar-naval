%MC_RUIDO_FASE Physical ceiling of clutter cancellation: Doppler spread, oscillator phase
%   noise and transmitter instability.
%
%   F0 · Integration in fuga_clutter.m (exact for |f| < 16·PRF, mean of |W|² outside) versus
%        the full integral with exact |W|² up to B.
%   F1 · Phase generator (fase_osc.m): periodogram versus L(f).
%   F2 · Full I/Q chain (sim_cpi + proc_cpi) with phase noise only (stationary clutter,
%        rectangular window, whose k ≠ 0 cells do not receive the carrier): leakage per cell
%        versus the model, at four ranges.
%   F3 · Full chain with everything (Chebyshev 50 dB, sea spectrum, oscillator, instability)
%        versus the sum of the three terms.
%   F4 · Equivalent cancellation versus range, oscillator, wind and rain.
%   Outputs: results/fase3/ruido_fase.json and web/src/validation/ref_ruido_fase.json.

clear; startup_if_needed();
t0 = tic;
S = sistema_ref();
W.tau = 20e-6; W.B = 5e6; W.fs = 2 * W.B; W.prf = 2.5e3; W.np = 16;
wf = phased.LinearFMWaveform('SampleRate', W.fs, 'PulseWidth', W.tau, 'SweepBandwidth', W.B, 'PRF', W.prf, 'NumPulses', 1);
x = wf(); s = x(1:round(W.tau * W.fs)); s = s / norm(s);
lam = S.face.lambda; pri = 1 / W.prf; Np = W.np; c0 = 299792458;
cheb = chebwin(Np, 50); rect = ones(Np, 1);
out = struct();

% ── F0: integration ──
Q = struct('w', cheb, 'pri', pri, 'B', W.B, 'sigmaF', 0, 'fc', 0, 'osc', 'tipico', 'tau', [10e-6 100e-6 300e-6], 'jitDeg', 0);
Fm = fuga_clutter(Q);
M = 512; df = W.prf / M; W2 = abs(fft(cheb / norm(cheb), M)).^2;
i = (-round(W.B / df):round(W.B / df)).'; f = i * df;
Lw = ruido_fase(f, 'tipico') .* max(0, 1 - abs(f) / W.B); Lw(i == 0) = 0;
kk = -Np / 2:Np / 2 - 1; ref = zeros(numel(Q.tau), Np);
for it = 1:numel(Q.tau)
  Sx = Lw .* 4 .* sin(pi * f * Q.tau(it)).^2;
  for j = 1:Np, ref(it, j) = sum(Sx .* W2(mod(i - kk(j) * M / Np, M) + 1)) * df; end
end
out.F0 = struct('tau', Q.tau, 'errMaxDb', max(abs(10 * log10(Fm.pn ./ ref)), [], 'all'));
fprintf('[F0] split versus full integration: max error %.3f dB\n', out.F0.errMaxDb);

% ── F1: generator ──
rng(run_id_to_seed('F1'));
Ng = 2^18; fsg = W.fs; acc = zeros(Ng, 1);
for r = 1:30, ph = fase_osc('tipico', fsg, Ng); acc = acc + abs(fft(ph)).^2 / (fsg * Ng); end
acc = acc / 30; fg = (0:Ng - 1).' * fsg / Ng;
fo = [1e3 1e4 1e5 1e6]; med = zeros(size(fo));
for q = 1:numel(fo)
  b = fg > fo(q) * 0.9 & fg < fo(q) * 1.1;          % mean over ±10 %, versus the model mean
  med(q) = 10 * log10(mean(acc(b)) / mean(ruido_fase(fg(b), 'tipico')));
end
out.F1 = struct('f', fo, 'errDb', med);
fprintf('[F1] periodogram / L(f) at %s Hz: %s dB\n', mat2str(fo), mat2str(med, 2));

% ── F2: chain with phase noise only ──
nWin = 200; cnr = 1e9; celdas = 61:140;
P = struct('s', s, 'nWin', nWin, 'nPulses', Np, 'pri', pri, 'lam', lam, 'tgt', struct('on', false), ...
  'clut', struct('on', true, 'cnr', cnr * ones(nWin, 1), 'sigmaF', 0, 'fc', 0));
Rkm = [1.5 3 15 45];
rng(run_id_to_seed('F2'));
L = numel(s); nIn = nWin + L - 1;
for ir = 1:numel(Rkm)
  d0 = max(0, round(2 * Rkm(ir) * 1e3 / c0 * W.fs) - nWin / 2);   % window centered at R
  Nphi = 2^nextpow2((Np - 1) * pri * W.fs + d0 + nIn + L + 1);
  acc = zeros(1, Np); nRep = 120;
  for r = 1:nRep
    P.pn = struct('phi', fase_osc('pobre', W.fs, Nphi), 'fs', W.fs, 'd0', d0);
    Z = proc_cpi(sim_cpi(P), s, rect / norm(rect));
    acc = acc + mean(Z(celdas, :), 1);
  end
  med = (acc / nRep - 1) / cnr;                           % leakage per cell (without thermal noise)
  tauC = (d0 + nWin / 2) / W.fs;
  Fa = fuga_clutter(struct('w', rect, 'pri', pri, 'B', W.B, 'sigmaF', 0, 'fc', 0, 'osc', 'pobre', 'tau', tauC, 'jitDeg', 0));
  u = Fa.utiles;
  e = 10 * log10(med(u) ./ Fa.pn(u));
  out.F2(ir) = struct('Rkm', Rkm(ir), 'tauUs', tauC * 1e6, 'medidaDb', 10 * log10(med), 'modeloDb', 10 * log10(Fa.pn), ...
    'errMedioDb', mean(e), 'errMaxDb', max(abs(e)));
  fprintf('[F2] R = %4.1f km · mean leakage in useful cells: measured %.1f dB · model %.1f dB · mean error %+.2f dB, max %.2f dB\n', ...
    Rkm(ir), 10 * log10(mean(med(u))), 10 * log10(mean(Fa.pn(u))), mean(e), max(abs(e)));
end

% ── F3: everything combined ──
sigmaV = 0.12 * S.env.windMs; sigF = 2 * sigmaV / lam;
P.clut.sigmaF = sigF; P.jitDeg = 0.5;
rng(run_id_to_seed('F3'));
for io = 1:2
  oscs = {'tipico', 'pobre'};
  d0 = round(2 * 15e3 / c0 * W.fs) - nWin / 2;
  Nphi = 2^nextpow2((Np - 1) * pri * W.fs + d0 + nIn + L + 1);
  acc = zeros(1, Np); nRep = 150;
  for r = 1:nRep
    P.pn = struct('phi', fase_osc(oscs{io}, W.fs, Nphi), 'fs', W.fs, 'd0', d0);
    Z = proc_cpi(sim_cpi(P), s, cheb / norm(cheb));
    acc = acc + mean(Z(celdas, :), 1);
  end
  med = (acc / nRep - 1) / cnr;
  Fa = fuga_clutter(struct('w', cheb, 'pri', pri, 'B', W.B, 'sigmaF', sigF, 'fc', 0, 'osc', oscs{io}, ...
    'tau', (d0 + nWin / 2) / W.fs, 'jitDeg', 0.5));
  e = 10 * log10(med ./ Fa.total);
  out.F3(io) = struct('osc', oscs{io}, 'medidaDb', 10 * log10(med), 'modeloDb', 10 * log10(Fa.total), ...
    'dispDb', 10 * log10(Fa.disp), 'pnDb', 10 * log10(Fa.pn), 'jitDb', 10 * log10(Fa.jit), ...
    'errMaxUtilesDb', max(abs(e(Fa.utiles))), 'cancelMedidaDb', -mean(10 * log10(med(Fa.utiles) / Np)), 'cancelModeloDb', Fa.cancelDb);
  fprintf('[F3] %s, 15 km: max error in useful cells %.2f dB · measured cancellation %.1f dB, model %.1f dB\n', ...
    oscs{io}, out.F3(io).errMaxUtilesDb, out.F3(io).cancelMedidaDb, Fa.cancelDb);
end

% ── F4: equivalent cancellation ──
R = logspace(log10(300), log10(150e3), 60); tau = 2 * R / c0;
oscs = {'', 'bueno', 'tipico', 'pobre'};
vientos = [5 9 15];
for iw = 1:numel(vientos)
  sf = 2 * 0.12 * vientos(iw) / lam;
  for io = 1:numel(oscs)
    for jt = [0 0.2]
      Fa = fuga_clutter(struct('w', cheb, 'pri', pri, 'B', W.B, 'sigmaF', sf, 'fc', 0, 'osc', oscs{io}, 'tau', tau, 'jitDeg', jt));
      out.F4(iw, io, 1 + (jt > 0)) = struct('viento', vientos(iw), 'osc', oscs{io}, 'jitDeg', jt, 'Rkm', R / 1e3, 'cancelDb', Fa.cancelDb.');
    end
  end
  fprintf('[F4] wind %2d m/s · cancellation at 2 / 15 / 60 km (no phase noise, good, typical, poor; instab. 0.2°):', vientos(iw));
  for io = 1:numel(oscs)
    cc = out.F4(iw, io, 2).cancelDb; fprintf(' %.0f/%.0f/%.0f', interp1(R, cc, 2e3), interp1(R, cc, 15e3), interp1(R, cc, 60e3));
  end
  fprintf('\n');
end
% rain: wide spectrum (shear + turbulence, Nathanson) shifted by the wind
for io = 1:numel(oscs)
  sv = sqrt((0.42 * 4e-3 * R * 1.7 * pi / 180).^2 + 1);
  cc = zeros(size(R));
  for ir = 1:numel(R)
    Fa = fuga_clutter(struct('w', cheb, 'pri', pri, 'B', W.B, 'sigmaF', 2 * sv(ir) / lam, 'fc', 2 * S.env.windMs / sqrt(2) / lam, ...
      'osc', oscs{io}, 'tau', tau(ir), 'jitDeg', 0.2));
    cc(ir) = Fa.cancelDb;
  end
  out.F4lluvia(io) = struct('osc', oscs{io}, 'Rkm', R / 1e3, 'cancelDb', cc);
end
fprintf('[F4] rain (wind %d m/s, typical): cancellation at 5 / 20 / 60 km: %.1f / %.1f / %.1f dB\n', S.env.windMs, ...
  interp1(R, out.F4lluvia(3).cancelDb, 5e3), interp1(R, out.F4lluvia(3).cancelDb, 20e3), interp1(R, out.F4lluvia(3).cancelDb, 60e3));

% 70 dB window: the window is no longer the ceiling and the oscillator shows up
cheb70 = chebwin(Np, 70); sf9 = 2 * 0.12 * S.env.windMs / lam;
for io = 1:numel(oscs)
  for jt = [0.05 0.2]
    Fa = fuga_clutter(struct('w', cheb70, 'pri', pri, 'B', W.B, 'sigmaF', sf9, 'fc', 0, 'osc', oscs{io}, 'tau', tau, 'jitDeg', jt));
    out.F5(io, 1 + (jt > 0.1)) = struct('osc', oscs{io}, 'jitDeg', jt, 'Rkm', R / 1e3, 'cancelDb', Fa.cancelDb.');
  end
  fprintf('[F5] 70 dB window, %-6s · instab. 0.05° / 0.2° · cancellation at 2 / 15 / 60 km: %.0f/%.0f/%.0f · %.0f/%.0f/%.0f\n', oscs{io}, ...
    interp1(R, out.F5(io, 1).cancelDb, [2e3 15e3 60e3]), interp1(R, out.F5(io, 2).cancelDb, [2e3 15e3 60e3]));
end

root = fileparts(fileparts(mfilename('fullpath')));
od = fullfile(root, 'results', 'fase3'); if ~exist(od, 'dir'), mkdir(od); end
write_json(fullfile(od, 'ruido_fase.json'), out);

% reference for the web (engine/environment.ts:clutterLeak): varied cases
rng(run_id_to_seed('F-web'));
casos = struct('osc', {}, 'sigmaF', {}, 'fc', {}, 'jitDeg', {}, 'tau', {}, 'np', {}, 'prf', {}, 'B', {}, 'sll', {}, 'total', {}, 'cancelDb', {});
oscW = {'', 'bueno', 'tipico', 'pobre'};
for q = 1:24
  o = oscW{1 + mod(q, 4)}; np = 8 * (1 + mod(q, 3)); prf = [1e3 2.5e3 4e3]; prf = prf(1 + mod(floor(q / 3), 3));
  Bq = [1e6 5e6 10e6]; Bq = Bq(1 + mod(floor(q / 2), 3));
  sll = 40 + 10 * mod(floor(q / 5), 3);
  sfq = 5 + 60 * rand; fcq = 80 * rand - 40; jq = 0.5 * rand; tq = 2 * (300 + 1e5 * rand) / c0;
  Fa = fuga_clutter(struct('w', chebwin(np, sll), 'pri', 1 / prf, 'B', Bq, 'sigmaF', sfq, 'fc', fcq, 'osc', o, 'tau', tq, 'jitDeg', jq));
  casos(end + 1) = struct('osc', o, 'sigmaF', sfq, 'fc', fcq, 'jitDeg', jq, 'tau', tq, 'np', np, 'prf', prf, 'B', Bq, 'sll', sll, ...
    'total', Fa.total, 'cancelDb', Fa.cancelDb); %#ok<SAGROW>
end
write_json(fullfile(web_validation_dir(), 'ref_ruido_fase.json'), struct('casos', casos));
fprintf('mc_ruido_fase: %.0f s\n', toc(t0));
