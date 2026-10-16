function Z = proc_cpi(X, s, win)
%PROC_CPI Pulse compression and Doppler processing of a CPI.
%
%   Z = proc_cpi(X, s, win)
%     X    I/Q data (input samples × pulses), from sim_cpi
%     s    transmitted pulse (column, unit energy)
%     win  Doppler window (column, length = pulses)
%   Z    power in the range-Doppler map (output samples × Doppler cells),
%        with zero Doppler frequency at the center (fftshift).
%
%   Matched filter h = s*(−t) with unit energy: unit-power input noise
%   comes out with power 1 and a target of amplitude a gives a peak |a|². The Doppler FFT with
%   window w scales the noise by Σ|w|² and the coherent target by |Σw|².

h = conj(flipud(s(:)));
nOut = size(X, 1) - numel(s) + 1;
Y = zeros(nOut, size(X, 2));
for p = 1:size(X, 2)
  Y(:, p) = conv(X(:, p), h, 'valid');
end
Z = abs(fftshift(fft(Y .* win(:).', [], 2), 2)).^2;
end
