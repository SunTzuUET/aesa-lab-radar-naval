function Edb = difraccion_p526(dKm, h1, h2, fHz, aeKm)
%DIFRACCION_P526 Field relative to free space due to diffraction over a smooth spherical earth.
%
%   Edb = difraccion_p526(dKm, h1, h2, fHz, aeKm)
%
%   ITU-R P.526-15, §3.1.1.2 (first term of the residue series), horizontal
%   polarization over sea in S band: K ≈ 10⁻⁵, so β = 1 and G(Y) does not saturate.
%   Valid in the shadow region, well beyond the horizon.
%     X = 2.188·β·f^{1/3}·ae^{−2/3}·d     Y = 9.575·10⁻³·β·f^{2/3}·ae^{−1/3}·h
%     20·log(E/E0) = F(X) + G(Y1) + G(Y2)       (f in MHz, ae and d in km, h in m)

f = fHz / 1e6; b = 1;
X = 2.188 * b * f^(1/3) * aeKm^(-2/3) * dKm;
FX = 11 + 10 * log10(X) - 17.6 * X;
lo = X < 1.6;
FX(lo) = -20 * log10(X(lo)) - 5.6488 * X(lo).^1.425;
Edb = FX + G(9.575e-3 * b * f^(2/3) * aeKm^(-1/3) * h1) + G(9.575e-3 * b * f^(2/3) * aeKm^(-1/3) * h2);
end

function g = G(Y)
if Y > 2
  g = 17.6 * sqrt(Y - 1.1) - 5 * log10(Y - 1.1) - 8;
else
  g = 20 * log10(Y + 0.1 * Y^3);
end
end
