function nu = forma_k(psiDeg, areaM2, pol, swellAspectDeg)
%FORMA_K Shape parameter ν of the K distribution of sea clutter.
%
%   nu = forma_k(psiDeg, areaM2, pol, swellAspectDeg)
%
%   Empirical fit by Ward, Tough and Watts («Sea Clutter: Scattering, the K Distribution and
%   Radar Performance», IET 2006, ch. 2), for grazing angles from 0.1° to 10°:
%     log10 ν = (2/3)·log10 ψ + (5/8)·log10 A_c − k_pol − cos(2·θ_sw)/3
%   ψ in degrees, A_c resolved cell area (m²), k_pol = 1.39 (VV) or 2.09 (HH),
%   θ_sw angle between the look direction and the swell direction (0 = up- or
%   down-swell). Small ν = spiky clutter; ν → ∞ = Gaussian (Rayleigh).
%   Clamped to [0.1, 50] (outside that range the fit has no support).

if nargin < 4, swellAspectDeg = 45; end
kp = 2.09; if upper(pol) == 'V', kp = 1.39; end
psi = min(max(psiDeg, 0.1), 10);
lnu = (2 / 3) * log10(psi) + (5 / 8) * log10(areaM2) - kp - cosd(2 * swellAspectDeg) / 3;
nu = min(max(10.^lnu, 0.1), 50);
end
