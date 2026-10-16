function M = monopulso_curva(x, y, wS, wD, ejeDeg, az0, el0, eje, k)
%MONOPULSO_CURVA Sum and difference beams and monopulse ratio along one axis.
%
%   M = monopulso_curva(x, y, wS, wD, ejeDeg, az0, el0, eje, k)
%     x, y     element positions (m)
%     wS, wD   receive weights of the Σ and Δ beams (complex, N×1)
%     ejeDeg   offsets from the pointing direction (degrees)
%     az0, el0 pointing direction (degrees);  eje 'az' or 'el'
%     k        wavenumber (rad/m)
%   AF(u, v) = Σ_n w_n·e^{jk(x_n·u + y_n·v)},  u = cos(el)·sin(az),  v = sin(el).
%   M.S, M.D  beams at each offset;  M.r = Im{Δ/Σ}  (monopulse ratio: with phase
%   weights and an odd-sign Δ it is purely imaginary and grows with the offset).
%   The element pattern is common to Σ and Δ and does not change the ratio.

d = ejeDeg(:);
if strcmp(eje, 'az')
  az = az0 + d; el = el0 + 0 * d;
else
  az = az0 + 0 * d; el = el0 + d;
end
u = cosd(el) .* sind(az); v = sind(el);
E = exp(1j * k * (u * x(:).' + v * y(:).'));
M.S = E * wS(:); M.D = E * wD(:);
M.r = imag(M.D ./ M.S);
M.d = d;
end
