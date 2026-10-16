function F = dos_rayos_exacto(R, h1, h2, Re, lam, epsc, pol, sh)
%DOS_RAYOS_EXACTO Propagation factor (amplitude) with exact spherical-earth geometry.
%
%   F = dos_rayos_exacto(R, h1, h2, Re, lam, epsc, pol, sh)
%
%   R      antenna-target slant range (m)
%   h1,h2  antenna and target heights above the surface (m)
%   Re     effective earth radius (m)
%   lam    wavelength (m)
%   epsc   complex surface permittivity (convention ε' − jε'')
%   pol    'H' or 'V'
%   sh     standard deviation of the surface height (m)
%
%   The reflection point is found by minimizing the reflected path length
%   (Fermat's principle). Fresnel Γ, Ament roughness exp(−2(2π·σh·sin ψ/λ)²)
%   and Kerr divergence [1 + 2·d1·d2/(Re·d·tan ψ)]^(−1/2). Isotropic antenna.
%   This is the independent reference used to validate the web's closed-form geometry.

a = Re + h1; b = Re + h2;
Th = acos((a^2 + b^2 - R^2) / (2 * a * b));            % total central angle
P1 = [0, a]; P2 = b * [sin(Th), cos(Th)];
pathLen = @(t) norm(P1 - Re * [sin(t), cos(t)]) + norm(P2 - Re * [sin(t), cos(t)]);
t = fminbnd(pathLen, 0, Th, optimset('TolX', 1e-13));
Sp = Re * [sin(t), cos(t)];
nrm = Sp / Re;                                          % surface normal
u1 = (P1 - Sp) / norm(P1 - Sp);
psi = asin(max(min(dot(u1, nrm), 1), -1));             % grazing angle
if psi <= 0, F = 1; return; end
delta = pathLen(t) - R;
s = sin(psi); c2 = cos(psi)^2; r = sqrt(epsc - c2);
if pol == 'H', G = (s - r) / (s + r); else, G = (epsc * s - r) / (epsc * s + r); end
rho = exp(-2 * (2 * pi * sh * s / lam)^2);
d1 = Re * t; d2 = Re * (Th - t); d = d1 + d2;
D = 1 / sqrt(1 + 2 * d1 * d2 / (Re * d * tan(psi)));
F = abs(1 + rho * D * G * exp(-1j * 2 * pi * delta / lam));
end
