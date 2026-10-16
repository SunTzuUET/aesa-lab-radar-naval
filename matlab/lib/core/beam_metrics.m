function M = beam_metrics(w, Nx, Ny, spacingLambda, fc, thetaTargetDeg, phiTargetDeg, opts)
%BEAM_METRICS Unified pattern metrics for a precoder/weight w.
%
%   Convention: theta in [-90,90] or [0,180] depending on the requested grid.
%
%   Outputs:
%     M.gainDb         10*log10( sum_k |a^H w_k|^2 ) toward (thetaT, phiT) with ||w||=1
%     M.gainDbCoh      coherent gain: 10*log10( |a^H w/||w|| |^2 ) (1 stream)
%     M.hpbwAzDeg      HPBW of the phi cut (azimuth, theta=thetaT) (deg)
%     M.hpbwElDeg      HPBW of the theta cut (elevation, phi=phiT) (deg)
%     M.hpbwGeomDeg    sqrt(HPBW_az * HPBW_el)
%     M.sll1dDb        1D SLL in the phi=0 cut (theta cut) — converges to -13.26 dB
%                      for uniform illumination
%     M.sll2dDb        2D SLL outside a disk r=4/N in u-space around the peak
%     M.sllAzDb        SLL in the azimuth cut at theta=thetaT
%     M.sllElDb        SLL in the elevation cut at phi=phiT
%     M.directivityDbi Directivity by full spherical integration
%                      D = 4*pi * U_max / integral_S U(theta,phi) sin(theta) dtheta dphi
%                      with theta in [0,180] and phi in [-180,180].
%     M.directivityFront_dBi "Front hemisphere" variant, theta in [0,90]
%                      (dBi overestimated vs full-sphere; useful to compare
%                      with legacy V5/V6 metrics).
%     M.peakThetaDeg   peak theta (refined)
%     M.peakPhiDeg     peak phi   (refined)
%
%   opts.az2dStep / opts.el2dStep : 2D grid steps (default 0.5 deg)
%   opts.hpbwSpan / opts.hpbwStep : span/step of 1D cuts (auto if empty)
%   opts.freqHz                   : scalar (default fc)
%   opts.chunk                    : block size for the 2D AF (default 4096)
%   opts.refinePeak               : true|false (default false; useful for squint)
%   opts.elementQ                 : cos^q exponent of the element pattern;
%                                   0 (default) = isotropic, no element pattern.
%                                   q>0 multiplies the power by cos^(2q)(theta)
%                                   in the directivity computation.

if nargin < 8; opts = struct(); end
az2dStep = local_get(opts, 'az2dStep', 0.5);
el2dStep = local_get(opts, 'el2dStep', 0.5);
fHz      = local_get(opts, 'freqHz',   fc);
chunk    = local_get(opts, 'chunk',    4096);
refineFlag = local_get(opts, 'refinePeak', false);
elementQ   = local_get(opts, 'elementQ', 0);

Nt = Nx * Ny; %#ok<NASGU>

% --- Gain toward the target ----------------------------------------------
w_norm    = w / (norm(w(:)) + eps);
a_t       = steering_vector(Nx, Ny, spacingLambda, fc, ...
                            thetaTargetDeg, phiTargetDeg, fHz);
gain_streams = sum(abs(a_t' * w_norm).^2, 2);
M.gainDb     = 10*log10( gain_streams + eps );
M.gainDbCoh  = 10*log10( gain_streams + eps );

% --- HPBW 1D cuts with auto-zoom -----------------------------------------
hpbw_theory_deg = rad2deg(0.886 / (Nx * spacingLambda(1)));
span = local_get(opts, 'hpbwSpan', max(2, 6 * hpbw_theory_deg));
step = local_get(opts, 'hpbwStep', max(0.01, hpbw_theory_deg/40));

% Azimuth cut: theta = thetaT, phi varies
phiCut = (phiTargetDeg - span):step:(phiTargetDeg + span);
phiCut = phiCut(phiCut >= -180 & phiCut <= 180);
A_phi  = steering_vector(Nx, Ny, spacingLambda, fc, ...
        repmat(thetaTargetDeg, size(phiCut)), phiCut, fHz);
P_phi  = sum(abs(A_phi' * w_norm).^2, 2);

% Elevation cut: phi = phiT, theta varies
thetaCut = (thetaTargetDeg - span):step:(thetaTargetDeg + span);
thetaCut = thetaCut(thetaCut >= -90 & thetaCut <= 90);
A_th     = steering_vector(Nx, Ny, spacingLambda, fc, ...
        thetaCut, repmat(phiTargetDeg, size(thetaCut)), fHz);
P_th     = sum(abs(A_th' * w_norm).^2, 2);

M.hpbwAzDeg = local_hpbw(phiCut,   P_phi);
M.hpbwElDeg = local_hpbw(thetaCut, P_th);
if isfinite(M.hpbwAzDeg) && isfinite(M.hpbwElDeg)
    M.hpbwGeomDeg = sqrt(M.hpbwAzDeg * M.hpbwElDeg);
else
    M.hpbwGeomDeg = NaN;
end

M.sllAzDb = detect_sll_1d(phiCut,   P_phi);
M.sllElDb = detect_sll_1d(thetaCut, P_th);

% --- 1D SLL (phi=0 cut) --------------------------------------------------
thetaCutFull = -90:0.05:90;
A_full = steering_vector(Nx, Ny, spacingLambda, fc, ...
        thetaCutFull, zeros(size(thetaCutFull)), fHz);
P_full = sum(abs(A_full' * w_norm).^2, 2);
M.sll1dDb = detect_sll_1d(thetaCutFull, P_full);

% --- 2D pattern over the full sphere -------------------------------------
%   theta in [0,180] (zenith angle), phi in [-180,180].
%   The front hemisphere (theta in [0,90]) is used for SLL2D and the peak.
%   The full sphere is used for the directivity via 4*pi integration.
phi2d   = -180:az2dStep:180;
theta2d =    0:el2dStep:180;
opts2 = struct('phiGridDeg', phi2d, 'thetaGridDeg', theta2d, 'freqHz', fHz, ...
               'normalize', false, 'chunk', chunk);
[~, P_full2d] = array_factor(w_norm, Nx, Ny, spacingLambda, fc, opts2);

% Apply element pattern (power) if requested: P_total = AF^2 * |E|^2
if elementQ > 0
    E = element_pattern(theta2d(:), elementQ);   % [Ntheta x 1]
    P_full2d = P_full2d .* (E.^2);
end

% Full-sphere directivity
M.directivityDbi = compute_directivity_full(P_full2d, theta2d, phi2d);

% Legacy directivity (front hemisphere) — for comparability
front_idx = theta2d >= 0 & theta2d <= 90;
P_front   = P_full2d(front_idx, :);
theta_fr  = theta2d(front_idx);
dTh = mean(diff(theta_fr));  dPh = mean(diff(phi2d));
sinT = sind(theta_fr(:));
intP_front = sum(sum(P_front, 2) .* sinT) * deg2rad(dTh) * deg2rad(dPh);
M.directivityFront_dBi = 10*log10( max(P_front(:)) * 4*pi / (intP_front + eps) + eps );

% 2D peak in the front hemisphere (avoids the anti-broadside replica)
[~, idxMax] = max(P_front(:));
[iTh, iPh]  = ind2sub(size(P_front), idxMax);
thMax = theta_fr(iTh);  phMax = phi2d(iPh);

if refineFlag
    [thMax, phMax] = refine_peak(w_norm, Nx, Ny, spacingLambda, fc, ...
                                 thMax, phMax, fHz, 0.01);
end
M.peakThetaDeg = thMax;
M.peakPhiDeg   = phMax;

% --- 2D SLL outside a disk r=4/Nx in u-space around the peak ------------
P_norm = P_front / max(P_front(:) + eps);
[PHI, THETA] = meshgrid(phi2d, theta_fr);
uX  = sind(THETA) .* cosd(PHI);
uY  = sind(THETA) .* sind(PHI);
uX0 = sind(thMax)  .* cosd(phMax);
uY0 = sind(thMax)  .* sind(phMax);
rMain = 4 / Nx;
mask = ((uX - uX0).^2 + (uY - uY0).^2) > rMain^2;
if any(mask(:))
    M.sll2dDb = 10*log10( max(P_norm(mask)) + eps );
else
    M.sll2dDb = NaN;
end

% Compatibility: old alias
M.sllDb = M.sll2dDb;
end

% =========================================================================
function w = local_hpbw(grid, P)
%LOCAL_HPBW HPBW (deg) by linear interpolation around the peak.
P = P(:) / (max(P) + eps);
[~, ip] = max(P);
left = NaN;  right = NaN;
for k = ip:-1:2
    if P(k-1) <= 0.5 && P(k) >= 0.5
        t = (0.5 - P(k-1)) / (P(k) - P(k-1) + eps);
        left = grid(k-1) + t*(grid(k) - grid(k-1));
        break;
    end
end
for k = ip:numel(P)-1
    if P(k) >= 0.5 && P(k+1) <= 0.5
        t = (0.5 - P(k)) / (P(k+1) - P(k) + eps);
        right = grid(k) + t*(grid(k+1) - grid(k));
        break;
    end
end
if isfinite(left) && isfinite(right)
    w = right - left;
else
    w = NaN;
end
end

function v = local_get(s, name, def)
if isstruct(s) && isfield(s,name) && ~isempty(s.(name)); v = s.(name); else; v = def; end
end
