function phi = fase_osc(osc, fs, N)
%FASE_OSC One realization of the oscillator phase φ(t) (rad), N samples at fs (Hz).
%
%   Frequency-domain synthesis: complex Gaussian noise with two-sided density L(|f|)
%   (ruido_fase.m), no DC component; φ = √2·Re{IFFT}, a real process with
%   S_φ(f) = L(|f|). Offsets below fs/N are not represented (the
%   cancellation depends on them only through 4·sin²(πfτ) ≈ (2πfτ)², negligible).

f = (0:N - 1).' * fs / N; f(f >= fs / 2) = f(f >= fs / 2) - fs;
A = sqrt(ruido_fase(f, osc) * fs * N); A(1) = 0;
X = A .* (randn(N, 1) + 1j * randn(N, 1)) / sqrt(2);
phi = sqrt(2) * real(ifft(X));
end
