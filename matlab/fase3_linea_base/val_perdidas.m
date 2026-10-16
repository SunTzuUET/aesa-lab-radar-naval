%VAL_PERDIDAS Processing and waveform losses that the web computes instead of using a fixed figure.
%
%   L1 · Doppler window (Chebyshev): coherent gain loss and Doppler straddle loss
%        (mean in dB over target frequency, best cell).
%   L2 · Range straddle loss: actual LFM chain (τ = 20 µs, B = 5 MHz) sampled at fs,
%        versus the web's sinc²(B·δ) model, with fs/B = 1, 1.5 and 2.
%   L3 · Beam shape: mean two-way loss (uniform transmit, Taylor receive) with the actual
%        80×80 face over a search cell of side s·θ₃ versus the Gaussian model.
%   L4 · CA-CFAR with N cells, Swerling 1: exact required SNR versus Monte Carlo.
%   L5 · Eclipsing: received fraction f of the echo; peak after compression versus f².
%   Output: web/src/validation/ref_perdidas.json.

clear; startup_if_needed();
S = sistema_ref(); out = struct();

% ── L1 ──
L1 = struct('np', {}, 'sll', {}, 'ventanaDb', {}, 'celdaDb', {});
for np = [8 16 32]
  for sll = [40 50 60]
    w = chebwin(np, sll); w = w / norm(w);
    lw = -10 * log10(sum(w)^2 / np);
    f = (0:4095).' / 4096;                                   % frequency normalized to the PRF
    best = zeros(size(f));
    for k = 0:np - 1                                         % |W(f − k/Np)|², best cell
      best = max(best, abs(exp(-1j * 2 * pi * (f - k / np) * (0:np - 1)) * w).^2);
    end
    lc = mean(-10 * log10(best / sum(w)^2));
    L1(end + 1) = struct('np', np, 'sll', sll, 'ventanaDb', lw, 'celdaDb', lc); %#ok<SAGROW>
  end
end
out.L1 = L1;
fprintf('[L1] Np = 16, Chebyshev 50 dB: window %.2f dB · Doppler straddle %.2f dB\n', L1(5).ventanaDb, L1(5).celdaDb);

% ── L2 ──
tau = 20e-6; B = 5e6;
L2 = struct('ratio', {}, 'medidaDb', {}, 'modeloDb', {});
for ratio = [1 1.5 2]
  fs = ratio * B; up = 64;                                   % oversampling to shift the target
  wf = phased.LinearFMWaveform('SampleRate', fs * up, 'PulseWidth', tau, 'SweepBandwidth', B, 'PRF', 1 / (4 * tau), 'NumPulses', 1);
  x = wf(); s = x(1:round(tau * fs * up)); s = s / norm(s);
  y = abs(conv(s, conj(flipud(s)))).^2; y = y / max(y);
  [~, ip] = max(y);
  off = 0:up - 1;                                            % target offset relative to the sample grid
  pk = arrayfun(@(o) max(y(mod(ip + o - 1, up) + 1:up:end)), off);
  med = mean(-10 * log10(pk));
  d = (off - up / 2) / (up * fs);                            % distance to the nearest sample ∈ [−Δ/2, Δ/2)
  mod_ = mean(-10 * log10(sinc(B * d).^2));
  L2(end + 1) = struct('ratio', ratio, 'medidaDb', med, 'modeloDb', mod_); %#ok<SAGROW>
  fprintf('[L2] fs/B = %.1f: measured %.2f dB · sinc² model %.2f dB\n', ratio, med, mod_);
end
out.L2 = L2;

% ── L3 ──
N = 80; d = 0.5; k = 2 * pi;                                 % in λ
x = ((0:N - 1) - (N - 1) / 2) * d;
ar = taylorwin(N, 5, -35); at = ones(N, 1);
th = linspace(-3, 3, 6001).';
pat = @(a) abs(exp(1j * k * sind(th) * x) * a).^2 / sum(a)^2;
Pr = pat(ar); Pt = pat(at);
w3 = @(P) th(find(P >= 0.5, 1, 'last')) - th(find(P >= 0.5, 1, 'first'));
thR = w3(Pr); thT = w3(Pt);
L3 = struct('s', {}, 'medidaDb', {}, 'modeloDb', {});
for s = [0.5 0.7 0.8 1.0]
  q = linspace(-s * thR / 2, s * thR / 2, 401).';
  l1 = -10 * log10(interp1(th, Pr .* Pt, q));               % two-way loss along one axis
  med = 2 * mean(l1);                                       % separable: azimuth + elevation
  mod_ = 2 * 4 * log(2) * 10 / log(10) * (1 / thT^2 + 1 / thR^2) * (s * thR)^2 / 12;
  L3(end + 1) = struct('s', s, 'medidaDb', med, 'modeloDb', mod_); %#ok<SAGROW>
  fprintf('[L3] step %.1f·θ₃: mean loss %.2f dB (actual face) · %.2f dB (Gaussian)\n', s, med, mod_);
end
out.L3 = struct('casos', L3, 'theta3RxDeg', thR, 'theta3TxDeg', thT);

% ── L4 ──
rng(run_id_to_seed('L4'));
L4 = struct('n', {}, 'pfa', {}, 'pd', {}, 'snrReqDb', {}, 'snrIdealDb', {}, 'pdMc', {});
for n = [10 20 40]
  pfa = 1e-6; pd = 0.9;
  sr = (pfa^(-1 / n) - 1) / (pd^(-1 / n) - 1) - 1;          % exact SNR with CA-CFAR (square-law)
  si = log(pfa) / log(pd) - 1;
  alpha = n * (pfa^(-1 / n) - 1);
  nt = 2e5;
  cut = (1 + sr) * (-log(rand(nt, 1)));                     % Swerling 1: exponential with mean 1 + SNR
  ref = sum(-log(rand(nt, n)), 2) / n;
  pdmc = mean(cut > alpha * ref);
  L4(end + 1) = struct('n', n, 'pfa', pfa, 'pd', pd, 'snrReqDb', 10 * log10(sr), 'snrIdealDb', 10 * log10(si), 'pdMc', pdmc); %#ok<SAGROW>
  fprintf('[L4] N = %d: required SNR %.2f dB (ideal %.2f; loss %.2f dB) · Monte Carlo Pd %.4f\n', n, 10 * log10(sr), 10 * log10(si), 10 * log10(sr / si), pdmc);
end
out.L4 = L4;

% ── L5 ──
fs = 2 * B;
wf = phased.LinearFMWaveform('SampleRate', fs, 'PulseWidth', tau, 'SweepBandwidth', B, 'PRF', 1 / (4 * tau), 'NumPulses', 1);
x = wf(); s = x(1:round(tau * fs)); s = s / norm(s); Ls = numel(s);
fr = [0.1 0.25 0.5 0.75 0.9 1];
L5 = struct('f', {}, 'inicioDb', {}, 'finDb', {}, 'modeloDb', {});
for f = fr
  m = round(f * Ls);
  a = [s(1:m); zeros(Ls - m, 1)]; b = [zeros(Ls - m, 1); s(Ls - m + 1:end)];
  pa = max(abs(conv(a, conj(flipud(s)))).^2); pb = max(abs(conv(b, conj(flipud(s)))).^2);
  L5(end + 1) = struct('f', f, 'inicioDb', 10 * log10(pa), 'finDb', 10 * log10(pb), 'modeloDb', 20 * log10(f)); %#ok<SAGROW>
  fprintf('[L5] fraction %.2f: peak %.2f / %.2f dB (start / end) · f² %.2f dB\n', f, 10 * log10(pa), 10 * log10(pb), 20 * log10(f));
end
out.L5 = L5;

write_json(fullfile(web_validation_dir(), 'ref_perdidas.json'), out);
