function [D_dBi, D_lin, info] = compute_directivity_full(P_lin, thetaGridDeg, phiGridDeg)
%COMPUTE_DIRECTIVITY_FULL Directivity by full spherical integration.
%
%   D = 4*pi * U_max / integral_S U(theta, phi) sin(theta) dtheta dphi
%
%   Physics convention: theta is the zenith angle, theta=0 broadside (z+),
%   theta=pi anti-broadside (z-). The grid MUST cover the whole sphere,
%   theta in [0,180] and phi in [0,360] or [-180,180]. If the grid does not
%   cover the full sphere the function issues a warning and returns a biased value.
%
%   Inputs:
%     P_lin        : [numel(thetaGrid) x numel(phiGrid)] linear power
%                    (not necessarily normalized; internally only the
%                    pattern shape matters, via U(theta,phi)/U_max).
%     thetaGridDeg : sorted vector, in degrees, within [0,180]
%     phiGridDeg   : sorted vector, in degrees, within [-180,180] or [0,360]
%
%   Outputs:
%     D_dBi : directivity in dBi
%     D_lin : linear directivity
%     info  : struct with fields
%              .integralU  value of the integral (linear, with U_max=1)
%              .Umax       max(P_lin)
%              .span_theta_deg  range covered in theta
%              .span_phi_deg    range covered in phi
%              .full_sphere     true if span_theta>=180 and span_phi>=360-tol

theta = thetaGridDeg(:);           % [Ntheta x 1]
phi   = phiGridDeg(:);             % [Nphi   x 1]
if size(P_lin, 1) ~= numel(theta) || size(P_lin, 2) ~= numel(phi)
    error('compute_directivity_full:Size', ...
        'P_lin must be [numel(theta) x numel(phi)] = [%d x %d], got [%d x %d].', ...
        numel(theta), numel(phi), size(P_lin,1), size(P_lin,2));
end

Umax = max(P_lin(:));
if ~(Umax > 0) || ~isfinite(Umax)
    D_lin = NaN;  D_dBi = NaN;
    info  = struct('integralU',NaN,'Umax',Umax, ...
                   'span_theta_deg',0,'span_phi_deg',0,'full_sphere',false);
    return;
end

U = P_lin / Umax;                   % normalization to the peak

sinTheta = sind(theta);             % [Ntheta x 1]
integrand = U .* sinTheta;          % broadcast over theta (col 1)

thetaRad = deg2rad(theta);
phiRad   = deg2rad(phi);

% Double trapezoid: first over theta (dim 1), then over phi (dim 2)
inner = trapz(thetaRad, integrand, 1);     % [1 x Nphi]
intU  = trapz(phiRad, inner, 2);            % scalar

D_lin = 4*pi / max(intU, eps);
D_dBi = 10*log10(D_lin);

span_theta = max(theta) - min(theta);
span_phi   = max(phi)   - min(phi);
full_sphere = (span_theta >= 180 - 1e-6) && (span_phi >= 360 - 1e-6);

info = struct( ...
    'integralU',      intU, ...
    'Umax',           Umax, ...
    'span_theta_deg', span_theta, ...
    'span_phi_deg',   span_phi, ...
    'full_sphere',    full_sphere);

if ~full_sphere
    warning('compute_directivity_full:NotFullSphere', ...
        ['Grid does not cover 4*pi (theta-span=%g deg, phi-span=%g deg). ' ...
         'Directivity will be biased upward if the pattern has ' ...
         'lobes outside the grid.'], span_theta, span_phi);
end
end
