function [Hcell, chinfo] = saleh_valenzuela_squint(Nt, Nr, params, freqList)
%SALEH_VALENZUELA_SQUINT Frequency-dependent Saleh-Valenzuela channel.
%
%   [Hcell, chinfo] = saleh_valenzuela_squint(Nt, Nr, params, freqList)
%
%   Extension of the thesis's Saleh-Valenzuela model to characterize beam
%   squint: each ray introduces a delay tau, and the channel is evaluated at
%   several frequencies reusing the SAME channel parameters (angles,
%   gains and delays drawn only once). Thus:
%
%       H(f) = gamma * sum_{i,l} alpha_{i,l} exp(-j 2 pi f tau_{i,l}) ...
%                              * a_R(f; ang_R) * a_T(f; ang_T)^H
%
%   where the dependence on f enters in two ways: the delay term
%   exp(-j 2 pi f tau) and the array steering a_t/a_r evaluated at frequency f
%   (with fixed physical spacing d = lambda_c/2 at the carrier fc).
%
%   theta_T <-> channel link: cluster 1 (the strongest, due to the exponential
%   variance decay across clusters) is a dominant LOS-like component
%   anchored at (theta_T, phi_T). Its rays are COINCIDENT at TX (no
%   angular spread on the transmit side), so H_cluster1 is rank 1
%   at TX and its right singular vector is exactly a_t(theta_T).
%   Clusters 2..Ncl are NLOS with random centers and full Laplacian
%   spread. This way the dominant singular vector V(:,1) of
%   H(fc) points toward theta_T and the main beam is measured cleanly against
%   that pointing direction (standard mmWave Rician/SV model).
%
%   Inputs:
%     Nt, Nr   : number of TX and RX antennas.
%     params   : struct with fields
%        .NxT, .NyT, .NxR, .NyR : TX / RX URA geometry.
%        .spacingLambda         : [dx dy] in lambda at fc (default [0.5 0.5]).
%        .fc                    : carrier (Hz) that sets the physical spacing.
%        .thetaT_deg, .phiT_deg : direction of the dominant cluster (deg).
%        .Ncl                   : number of clusters (default 5).
%        .Nray                  : rays per cluster (default 10).
%        .angSpreadDeg          : scale of the intra-cluster Laplacian
%                                 spread (deg, default 7.5).
%        .tauMax                : maximum delay, uniform [0,tauMax] (s,
%                                 default 100e-9).
%        .clusterDecay          : exponential decay rate of the variance
%                                 across clusters; P_i = exp(-decay*(i-1))
%                                 (default 0.7).
%        .thetaRange, .phiRange : uniform ranges for the NLOS cluster
%                                 centers (default [-90 90] and [-180 180]).
%     freqList : vector of frequencies (Hz) at which to evaluate H.
%
%   Outputs:
%     Hcell  : cell {1 x numel(freqList)}, Hcell{k} = [Nr x Nt] channel at f_k.
%     chinfo : struct with the drawn channel parameters (angles,
%              gains, delays, cluster powers, gamma).
%
%   Notes:
%     - The caller controls rng(seed) before calling; this function does not touch
%       the global RNG (consistent with saleh_valenzuela_multiband).
%     - Normalization: gamma is chosen so that E[||H(f)||_F^2] = Nt.

if nargin < 4
    error('saleh_valenzuela_squint:args', ...
        'Requires 4 args: Nt, Nr, params, freqList.');
end

NxT        = local_get(params, 'NxT',          round(sqrt(Nt)));
NyT        = local_get(params, 'NyT',          Nt / NxT);
NxR        = local_get(params, 'NxR',          round(sqrt(Nr)));
NyR        = local_get(params, 'NyR',          Nr / NxR);
sp         = local_get(params, 'spacingLambda',[0.5 0.5]);
fc         = local_get(params, 'fc',           28e9);
thetaT     = local_get(params, 'thetaT_deg',   0);
phiT       = local_get(params, 'phiT_deg',     0);
Ncl        = local_get(params, 'Ncl',          5);
Nray       = local_get(params, 'Nray',         10);
angSpread  = local_get(params, 'angSpreadDeg', 7.5);
tauMax     = local_get(params, 'tauMax',       100e-9);
decay      = local_get(params, 'clusterDecay', 0.7);
thetaRange = local_get(params, 'thetaRange',   [-90 90]);
phiRange   = local_get(params, 'phiRange',     [-180 180]);

freqList = freqList(:).';
nFreq    = numel(freqList);

% --- Cluster powers (exponential decay) ---------------------------------
Pcl = exp(-decay * (0:Ncl-1));          % [1 x Ncl], P_1 = 1 (strong cluster)

% --- Per-ray parameter draw (only once) ---------------------------------
nPath = Ncl * Nray;
thT = nan(1, nPath);  phT = nan(1, nPath);
thR = nan(1, nPath);  phR = nan(1, nPath);
alpha = nan(1, nPath);
tau   = nan(1, nPath);

idx = 0;
for i = 1:Ncl
    if i == 1
        % Dominant cluster anchored at the pointing direction.
        thT_c = thetaT;
        phT_c = phiT;
    else
        thT_c = thetaRange(1) + (thetaRange(2)-thetaRange(1)) * rand;
        phT_c = phiRange(1)   + (phiRange(2)  -phiRange(1))   * rand;
    end
    thR_c = thetaRange(1) + (thetaRange(2)-thetaRange(1)) * rand;
    phR_c = phiRange(1)   + (phiRange(2)  -phiRange(1))   * rand;

    sigA  = sqrt(Pcl(i));
    isLOS = (i == 1);   % cluster 1 = dominant LOS-like component
    for l = 1:Nray
        idx = idx + 1;
        if isLOS
            % Dominant cluster anchored at theta_T with NO spread at TX:
            % the TX components coincide, so H_cluster1 is rank 1
            % at TX and its right singular vector is exactly
            % a_t(theta_T). This way V(:,1) of H points to theta_T and the
            % beam is not "split" among the cluster's rays (needed
            % for the drift to be ~0 at broadside).
            thT(idx) = thT_c;
            phT(idx) = phT_c;
        else
            thT(idx) = local_clamp(thT_c + local_laplace(angSpread), -90, 90);
            phT(idx) = phT_c + local_laplace(angSpread);
        end
        thR(idx) = local_clamp(thR_c + local_laplace(angSpread), -90, 90);
        phR(idx) = phR_c + local_laplace(angSpread);
        alpha(idx) = sigA * (randn + 1j*randn) / sqrt(2);   % CN(0, P_i)
        tau(idx)   = tauMax * rand;
    end
end

% --- Normalizer gamma : E[||H||_F^2] = Nt -------------------------------
%   E[||sum||_F^2] = Nr*Nt*Nray*sum(Pcl) (i.i.d. zero-mean rays).
gamma = sqrt(1 / (Nr * Nray * sum(Pcl)));

% --- Steering vectors of all rays at all frequencies --------------------
%   steering_vector returns [Nant x nPath x nFreq] when vectors of angles
%   and frequencies are passed.
AT = steering_vector(NxT, NyT, sp, fc, thT, phT, freqList);   % [Nt x nPath x nFreq]
AR = steering_vector(NxR, NyR, sp, fc, thR, phR, freqList);   % [Nr x nPath x nFreq]
if nFreq == 1
    AT = reshape(AT, Nt, nPath, 1);
    AR = reshape(AR, Nr, nPath, 1);
end

% --- Assemble H(f) per frequency ---------------------------------------
Hcell = cell(1, nFreq);
for kf = 1:nFreq
    f    = freqList(kf);
    coef = alpha .* exp(-1j * 2*pi * f * tau);   % [1 x nPath]
    AT_f = AT(:, :, kf);                          % [Nt x nPath]
    AR_f = AR(:, :, kf);                          % [Nr x nPath]
    % sum_p coef_p * aR_p * aT_p^H  =  (AR_f .* coef) * AT_f'
    Hcell{kf} = gamma * ((AR_f .* coef) * AT_f');
end

chinfo = struct('thetaT_TX', thT, 'phiT_TX', phT, ...
                'thetaR_RX', thR, 'phiR_RX', phR, ...
                'alpha', alpha, 'tau', tau, ...
                'clusterPower', Pcl, 'gamma', gamma, ...
                'Ncl', Ncl, 'Nray', Nray);
end

% =========================================================================
function x = local_laplace(b)
%LOCAL_LAPLACE Scalar sample from a zero-mean Laplacian with scale b.
u = rand - 0.5;
x = -b * sign(u) * log(1 - 2*abs(u));
end

function y = local_clamp(x, lo, hi)
y = max(min(x, hi), lo);
end

function v = local_get(s, name, def)
if isstruct(s) && isfield(s, name) && ~isempty(s.(name)); v = s.(name); else; v = def; end
end
