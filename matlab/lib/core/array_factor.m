function [P_dB, P_lin, az, el] = array_factor(w, Nx, Ny, spacingLambda, fc, opts)
%ARRAY_FACTOR Pattern sum_k |a^H w_k|^2 over a (theta,phi) grid.
%
%   Convention: theta in [-90,90] (theta=0 broadside) by default, or
%   theta in [0,180] (zenith angle, broadside=0) if a thetaGridDeg grid
%   covering that range is passed. phi in [-180,180] by default.
%
%   Inputs:
%     w              : weights [Nt x 1] or precoder [Nt x Ns]
%     Nx, Ny         : URA geometry
%     spacingLambda  : [dx dy] in lambda
%     fc             : reference frequency (Hz)
%     opts.thetaGridDeg : default -90:1:90
%     opts.phiGridDeg   : default -180:1:180
%     opts.freqHz       : scalar (default fc)
%     opts.normalize    : true|false (default true)
%     opts.chunk        : columns per block (default 4096)
%
%   Outputs:
%     P_dB, P_lin : [numel(thetaGrid) x numel(phiGrid)]
%     az, el      : aliases (az=phi, el=theta) for compatibility

if nargin < 6; opts = struct(); end
phi   = local_get(opts, 'phiGridDeg',   -180:1:180);
theta = local_get(opts, 'thetaGridDeg',  -90:1:90);
fHz   = local_get(opts, 'freqHz', fc);
nrm   = local_get(opts, 'normalize', true);
chunk = local_get(opts, 'chunk', 4096);

[PHI, THETA] = meshgrid(phi, theta);
thetaVec = THETA(:).';
phiVec   = PHI(:).';
K        = numel(thetaVec);

P_lin_vec = zeros(K, 1);
nChunks   = ceil(K / chunk);

for cc = 1:nChunks
    i0 = (cc-1)*chunk + 1;
    i1 = min(K, cc*chunk);
    A  = steering_vector(Nx, Ny, spacingLambda, fc, ...
                         thetaVec(i0:i1), phiVec(i0:i1), fHz);
    resp = A' * w;
    P_lin_vec(i0:i1) = sum(abs(resp).^2, 2);
end

P_lin = reshape(P_lin_vec, numel(theta), numel(phi));
if nrm
    P_lin = P_lin / max(P_lin(:) + eps);
end
P_dB = 10*log10(P_lin + eps);

az = phi;
el = theta;
end

function v = local_get(s, name, def)
if isstruct(s) && isfield(s,name) && ~isempty(s.(name)); v = s.(name); else; v = def; end
end
