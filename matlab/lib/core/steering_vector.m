function a = steering_vector(Nx, Ny, spacingLambda, fc, thetaDeg, phiDeg, freqHz)
%STEERING_VECTOR Vectorized 2D URA steering vector(s).
%
%   a = steering_vector(Nx, Ny, spacingLambda, fc, thetaDeg, phiDeg, freqHz)
%
%   Convention (broadside = z):
%     ux = sin(theta) * cos(phi)
%     uy = sin(theta) * sin(phi)
%   Fixed physical spacing: dx = spacingLambda(1) * lambda_c, likewise dy.
%   Phase at frequency f: k(f) * (ix*dx*ux + iy*dy*uy), k(f)=2*pi*f/c.
%
%   Inputs:
%     Nx, Ny           : number of elements in x and y
%     spacingLambda    : [dx_lambda dy_lambda] (in lambda at fc)
%     fc               : reference frequency that sets dx, dy (Hz)
%     thetaDeg, phiDeg : scalars or 1xK vectors of the same size
%                        accepted theta: [0,180] (zenith angle) or [-90,90]
%                        (elevation from broadside). The code uses the
%                        relation ux=sin(theta), valid in both ranges
%                        as long as phi covers [0,360] or [-180,180]
%                        consistently.
%     freqHz           : scalar or 1xF vector (default fc)
%
%   Output:
%     a : [Nt x K x F] (squeezed to [Nt x K] if F=1)

if nargin < 7 || isempty(freqHz);  freqHz = fc;  end
c = 3e8;

thetaDeg = thetaDeg(:)';
phiDeg   = phiDeg(:)';
freqHz   = freqHz(:)';
F        = numel(freqHz);

lambda_c = c / fc;
dx = spacingLambda(1) * lambda_c;
dy = spacingLambda(2) * lambda_c;

[IX, IY] = meshgrid(0:Nx-1, 0:Ny-1);
ix = IX(:);  iy = IY(:);

thetaRad = deg2rad(thetaDeg).';
phiRad   = deg2rad(phiDeg).';
ux = sin(thetaRad) .* cos(phiRad);
uy = sin(thetaRad) .* sin(phiRad);

spatial = ix * (dx*ux).' + iy * (dy*uy).';     % [Nt x K]

k_f    = reshape(2*pi*freqHz/c, [1 1 F]);
phases = bsxfun(@times, spatial, k_f);
a      = exp(1j * phases);

if F == 1
    a = squeeze(a);
end
end
