function [thetaPeakDeg, phiPeakDeg, P_peak] = refine_peak(w, Nx, Ny, spacingLambda, fc, ...
                                                          theta0Deg, phi0Deg, freqHz, finalStepDeg)
%REFINE_PEAK Locate the pattern peak by iterative refinement.
%   Starts around (theta0, phi0) and refines the grid x10 until
%   reaching finalStepDeg (default 0.01). In the last iteration it applies
%   separable 1D parabolic interpolation in theta and phi to extract the
%   peak with sub-grid precision. This avoids the "staircase" in the measured
%   squint when the true offset is only a few grid steps.
%   w can be [Nt x 1] or [Nt x Ns] (power = sum_k |a^H w_k|^2).

if nargin < 8 || isempty(freqHz);     freqHz = fc; end
if nargin < 9 || isempty(finalStepDeg); finalStepDeg = 0.01; end

step = 1.0;
span = 2.0;
thetaCenter = theta0Deg;
phiCenter   = phi0Deg;
P_peak = -inf;

% Variables kept across iterations to reuse the last grid
% in the parabolic interpolation.
Pgrid_last  = [];
thetaGrid_last = [];
phiGrid_last   = [];
step_last      = [];
it_last        = [];
ip_last        = [];

while step >= finalStepDeg/1.5
    thetaGrid = (thetaCenter - span):step:(thetaCenter + span);
    phiGrid   = (phiCenter   - span):step:(phiCenter   + span);
    % theta restricted to the front hemisphere (zenith angle); avoids the spurious
    % replica (theta,phi) <-> (-theta, phi+/-180), which has the same u-space.
    thetaGrid = thetaGrid(thetaGrid >= 0 & thetaGrid <= 90);
    phiGrid   = phiGrid(phiGrid   >= -180 & phiGrid   <= 180);

    [PHI, THETA] = meshgrid(phiGrid, thetaGrid);
    A = steering_vector(Nx, Ny, spacingLambda, fc, THETA(:)', PHI(:)', freqHz);
    resp = A' * w;
    Pgrid = reshape(sum(abs(resp).^2, 2), numel(thetaGrid), numel(phiGrid));
    [P_peak, idx] = max(Pgrid(:));
    [it, ip]      = ind2sub(size(Pgrid), idx);
    thetaCenter   = thetaGrid(it);
    phiCenter     = phiGrid(ip);

    Pgrid_last     = Pgrid;
    thetaGrid_last = thetaGrid;
    phiGrid_last   = phiGrid;
    step_last      = step;
    it_last        = it;
    ip_last        = ip;

    span = step * 1.5;
    step = step / 10;
end

% --- Separable 1D parabolic interpolation in (theta, phi) ---
% Only applied if the peak is not on the grid edge.
[ntheta, nphi] = size(Pgrid_last);
delta_theta = 0;
delta_phi   = 0;

if it_last > 1 && it_last < ntheta
    p_minus = Pgrid_last(it_last - 1, ip_last);
    p_zero  = Pgrid_last(it_last,     ip_last);
    p_plus  = Pgrid_last(it_last + 1, ip_last);
    den = (p_minus - 2*p_zero + p_plus);
    if abs(den) > eps && p_minus < p_zero && p_plus < p_zero
        % delta in [-0.5, 0.5] grid units; capped for safety
        delta_theta = 0.5 * (p_minus - p_plus) / den;
        delta_theta = max(min(delta_theta, 0.5), -0.5);
    end
end

if ip_last > 1 && ip_last < nphi
    p_minus = Pgrid_last(it_last, ip_last - 1);
    p_zero  = Pgrid_last(it_last, ip_last);
    p_plus  = Pgrid_last(it_last, ip_last + 1);
    den = (p_minus - 2*p_zero + p_plus);
    if abs(den) > eps && p_minus < p_zero && p_plus < p_zero
        delta_phi = 0.5 * (p_minus - p_plus) / den;
        delta_phi = max(min(delta_phi, 0.5), -0.5);
    end
end

thetaPeakDeg = thetaGrid_last(it_last) + delta_theta * step_last;
phiPeakDeg   = phiGrid_last(ip_last)   + delta_phi   * step_last;

% Clamp to the front hemisphere for safety
thetaPeakDeg = min(max(thetaPeakDeg, 0), 90);
phiPeakDeg   = min(max(phiPeakDeg, -180), 180);
end
