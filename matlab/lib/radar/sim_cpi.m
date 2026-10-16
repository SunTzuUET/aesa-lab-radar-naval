function X = sim_cpi(P)
%SIM_CPI I/Q data of a coherent processing interval (CPI) at the sum-beam output.
%
%   X = sim_cpi(P) returns a matrix (fast-time samples × pulses), BEFORE the
%   matched filter, with unit-power thermal noise per sample.
%
%   Fields of P:
%     s        sampled transmitted pulse (column, unit energy)
%     nWin     receive-window samples after compression
%     nPulses  pulses in the CPI;  pri (s);  lam (m)
%     tgt      struct: idx (target sample after compression, may be fractional),
%              snr1 (mean linear SNR per pulse after compression), fd (Hz),
%              swerling (0 or 1), on (logical)
%     clut     struct: cnr (nWin vector, clutter/noise per sample after compression, linear),
%              sigmaF (Hz, width of the Gaussian Doppler spectrum), fc (Hz, center), on
%
%   Model:
%     - target: a·s(t − τ)·e^{j2π·fd·p·T}; a is complex Gaussian, constant over the CPI
%       (Swerling 1), or fixed-modulus with random phase (Swerling 0). The fractional
%       delay is applied in frequency.
%     - clutter: independent scatterers at each range sample, convolved with
%       the pulse; Gaussian pulse-to-pulse correlation ρ(m) = exp(−2π²σf²m²T²). Scatterer
%       power is scaled by Σ|χ_k|² (pulse autocorrelation) so that, after
%       compression, the CNR per sample is the requested one.
%       Optional (finite P.clut.nu): K texture, Gamma(ν, 1/ν) power in blocks of
%       P.clut.texSamples samples (texture correlation length, default 4),
%       constant over the CPI: compound-Gaussian clutter with K intensity (Ward, Tough and Watts).
%       Optional (P.pn): oscillator phase noise common to transmit and receive.
%       P.pn.phi phase φ(t) (rad) at P.pn.fs (fase_osc.m), P.pn.d0 delay (samples) of the
%       first window sample; pulse p is transmitted with e^{jφ(t)} and demodulated with
%       e^{−jφ(t)}, so scatterer k sees φ(t − τ_k) − φ(t). Applied to clutter only.
%       Optional (P.jitDeg): random pulse-to-pulse transmitter phase (RMS degrees).
%     - noise: white complex Gaussian with unit power per sample.

s = P.s(:); L = numel(s);
nIn = P.nWin + L - 1;                 % input samples that produce nWin valid outputs
Np = P.nPulses;
X = (randn(nIn, Np) + 1j * randn(nIn, Np)) / sqrt(2);

% --- target ---------------------------------------------------------------------
if P.tgt.on
  if P.tgt.swerling == 1
    a = sqrt(P.tgt.snr1 / 2) * (randn + 1j * randn);
  else
    a = sqrt(P.tgt.snr1) * exp(1j * 2 * pi * rand);
  end
  % delayed pulse: the compression peak falls on output sample tgt.idx
  Nf = 2^nextpow2(nIn + L);
  f = (0:Nf - 1).' / Nf; f(f >= 0.5) = f(f >= 0.5) - 1;
  S = fft(s, Nf) .* exp(-1j * 2 * pi * f * (P.tgt.idx - 1));   % the pulse starts at idx
  st = ifft(S); st = st(1:nIn);
  ph = exp(1j * 2 * pi * P.tgt.fd * (0:Np - 1) * P.pri);
  X = X + a * st * ph;
end

% --- clutter --------------------------------------------------------------------
if P.clut.on && any(P.clut.cnr > 0)
  chi2 = sum(abs(conv(s, conj(flipud(s)))).^2);           % Σ|χ_k|²
  m = (0:Np - 1);
  C = exp(-2 * pi^2 * P.clut.sigmaF^2 * (m - m.').^2 * P.pri^2);
  Lc = chol(C + 1e-9 * eye(Np), 'lower');
  % scatterer k → pulse starting at input sample k → peak at output k
  A = (randn(P.nWin, Np) + 1j * randn(P.nWin, Np)) / sqrt(2);
  % K texture (compound Gaussian): Gamma(ν, 1/ν) power per correlation block,
  % constant over the CPI (sea texture decorrelates in seconds, the CPI lasts milliseconds)
  tex = ones(P.nWin, 1);
  if isfield(P.clut, 'nu') && isfinite(P.clut.nu)
    nRes = max(1, round(getf(P.clut, 'texSamples', 4)));
    t = textura_gamma(P.clut.nu, ceil(P.nWin / nRes));
    tex = repelem(t, nRes); tex = tex(1:P.nWin);
  end
  A = (A * Lc.') .* sqrt(P.clut.cnr(:) .* tex / chi2);
  A = A .* exp(1j * 2 * pi * P.clut.fc * (0:Np - 1) * P.pri);
  pn = isfield(P, 'pn') && ~isempty(P.pn);
  jit = zeros(1, Np);                                     % no random draw if there is no instability
  if getf(P, 'jitDeg', 0) > 0, jit = P.jitDeg * pi / 180 * randn(1, Np); end
  for p = 1:Np
    if pn
      tp = round((p - 1) * P.pri * P.pn.fs);
      u = s .* exp(1j * P.pn.phi(tp + (1:L)));
      X(:, p) = X(:, p) + exp(1j * jit(p)) * conv(A(:, p), u) .* exp(-1j * P.pn.phi(tp + P.pn.d0 + (1:nIn)));
    else
      X(:, p) = X(:, p) + exp(1j * jit(p)) * conv(A(:, p), s);
    end
  end
end
end

function v = getf(s, n, d)
if isfield(s, n) && ~isempty(s.(n)), v = s.(n); else, v = d; end
end
