function E = element_pattern(thetaDeg, q)
%ELEMENT_PATTERN Element pattern cos^q(theta) clipped to theta<=pi/2.
%
%   E = element_pattern(thetaDeg, q)
%
%   Returns the AMPLITUDE of the element pattern as a function of the
%   zenith angle theta. The power is E^2.
%
%   Convention:
%     - theta=0      : broadside (z+), E=1
%     - theta=pi/2   : horizon, E=0
%     - theta>pi/2   : back-lobe, E=0  (clipped)
%
%   q controls the element directivity:
%     q = 0          : isotropic   (E = 1 over the whole front)
%     q = 1          : cos(theta)  (~6 dBi element)
%     q = 1.5        : approx. microstrip patch
%     q = 2          : cos^2(theta)
%
%   The array power pattern is:  P_total = AF^2 .* E^2
%   or, equivalently, replace w by (E .* w) in the AF if E is per
%   element. Here E depends only on theta (identical pattern per element).
%
%   Inputs:
%     thetaDeg : scalar, vector or matrix (deg). Accepts theta in [-90,90]
%                (elevation from broadside) or [0,180] (zenith angle).
%                |theta|>90 is treated as back-lobe -> E=0.
%     q        : exponent >=0 (default 1)
%
%   Output:
%     E : same shape as thetaDeg, in [0,1] (amplitude)

if nargin < 2 || isempty(q); q = 1; end
if q < 0
    error('element_pattern:Q','q must be >= 0 (got %g).', q);
end

theta = thetaDeg;
% Clipping: any abs(theta)>90 deg -> back-lobe -> 0.
% This covers both the [-90,90] and the [0,180] conventions:
%   in [-90,90]   broadside is 0, |theta|<=90 front
%   in [0,180]    broadside is 0, theta<=90  front, theta>90 back
mask_back = abs(theta) > 90;

cosT = cosd(theta);
cosT(mask_back) = 0;
% Ensure numerical non-negativity (cos near 90 can give -eps)
cosT = max(cosT, 0);

E = cosT.^q;
end
