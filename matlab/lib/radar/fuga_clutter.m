function F = fuga_clutter(Q)
%FUGA_CLUTTER Clutter leakage into each MTD Doppler cell and equivalent cancellation.
%
%   F = fuga_clutter(Q)
%   Fields of Q:
%     w       Doppler window (Np pulses); normalized to Σw² = 1 (unit-power noise)
%     pri     (s);  B  pulse bandwidth (Hz)
%     sigmaF  width of the Gaussian clutter Doppler spectrum (Hz); fc its center (Hz)
%     osc     oscillator (ruido_fase.m) or '' for no phase noise
%     tau     round-trip delay (s), scalar or vector
%     jitDeg  pulse-to-pulse transmitter phase instability (RMS degrees)
%   Output (unit-power clutter per pulse; cells in fftshift order, f_k = k/(Np·T)):
%     F.fk                      cell frequencies (Hz)
%     F.disp, F.pn, F.jit, F.total   leakage in each cell (numel(tau) × Np), relative to noise
%     F.utiles                  cells |k| ≥ 2 (outside the clutter notch)
%     F.cancelDb                equivalent cancellation for the web app: −mean_k 10·log10(leak_k/Np)
%                               over the useful cells (the web app integrates Np pulses without a window)
%
%   Model. The MTD output in cell k is Y_k = Σ_m w_m x_m e^{−j2πkm/Np}; the leakage is
%   E|Y_k|². Three independent terms:
%   · spread: E|Y_k|² = e_kᴴ(wwᵀ∘C)e_k, C_mn = exp(−2π²σf²(m−n)²T²)·e^{j2πfc(m−n)T}.
%   · phase noise: clutter at range R sees the residual phase Δφ(t) = φ(t−τ) − φ(t),
%     with density S_Δφ(f) = L(|f|)·4·sin²(πfτ). With range-homogeneous clutter, pulse
%     compression passes the offset f with weight (1 − |f|/B) (correlation of the chirp's
%     rectangular spectrum with a shifted copy of itself), and in slow time
%       leak_k = ∫ L(|f|)·4sin²(πfτ)·(1 − |f|/B)·|W(f − f_k)|² df,  W(f) = Σ w_m e^{−j2πfmT}.
%     Exact integral with |W|² for |f| < 16·PRF (step PRF/(32·Np)); beyond that, |W|² is replaced by
%     its mean Σw² = 1 and integrated with trapezoids of step min(250 Hz, 1/(16τ)).
%   · transmitter instability: white pulse-to-pulse phase of variance σ²: leakage = σ²·Σw².

w = Q.w(:); w = w / norm(w); Np = numel(w); T = Q.pri; prf = 1 / T;
k = (-Np / 2:Np / 2 - 1); F.fk = k * prf / Np;
tau = Q.tau(:); nt = numel(tau);
m = (0:Np - 1).';
% spread
C =exp(-2 * pi^2 * Q.sigmaF^2 * (m - m.').^2 * T^2) .* exp(1j * 2 * pi * Q.fc * (m - m.') * T);
E = exp(1j * 2 * pi * m * k / Np);
F.disp = repmat(real(sum(conj(E) .* ((w * w.' .* C) * E), 1)), nt, 1);
% phase noise
F.pn = zeros(nt, Np);
if ~isempty(Q.osc)
  M = 32 * Np; df = prf / M; f1 = 16 * prf;               % M multiple of Np: cells lie on the grid
  W2 = abs(fft(w, M)).^2;                                  % |W(i·df)|², period PRF
  i = (-f1 / df:f1 / df).'; f = i * df;
  Lw = ruido_fase(f, Q.osc) .* max(0, 1 - abs(f) / Q.B); Lw(i == 0) = 0;
  for it = 1:nt
    S = Lw .* 4 .* sin(pi * f * tau(it)).^2;
    for j = 1:Np
      idx = mod(i - k(j) * M / Np, M) + 1;
      F.pn(it, j) = sum(S .* W2(idx)) * df;
    end
    fo = (f1:min(250, 1 / (16 * tau(it))):Q.B).';          % step fine compared to 1/τ (sin² oscillation)
    So = ruido_fase(fo, Q.osc) .* (1 - fo / Q.B) .* 4 .* sin(pi * fo * tau(it)).^2;
    F.pn(it, :) = F.pn(it, :) + 2 * trapz(fo, So);
  end
end
% transmitter
F.jit = (getf(Q, 'jitDeg', 0) * pi / 180)^2 * ones(nt, Np);
F.total = F.disp + F.pn + F.jit;
F.utiles = abs(k) >= 2;
F.cancelDb = -mean(10 * log10(F.total(:, F.utiles) / Np), 2);
end

function v = getf(s, n, d)
if isfield(s, n) && ~isempty(s.(n)), v = s.(n); else, v = d; end
end
