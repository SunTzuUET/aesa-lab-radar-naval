function w = chebyshev_weights(Nx, Ny, spacingLambda, fc, thetaDeg, phiDeg, sllDb)
%CHEBYSHEV_WEIGHTS Separable 2D Dolph-Chebyshev beamformer with steering.
%   sllDb: target SLL in dB (positive, e.g. 25 -> SLL=-25 dB).
if nargin < 7 || isempty(sllDb); sllDb = 25; end

w_x = local_dc_1d(Nx, sllDb);
w_y = local_dc_1d(Ny, sllDb);

c = 3e8;
lambda_c = c / fc;
dx = spacingLambda(1) * lambda_c;
dy = spacingLambda(2) * lambda_c;

thR = deg2rad(thetaDeg);  phR = deg2rad(phiDeg);
ux = sin(thR) * cos(phR);  uy = sin(thR) * sin(phR);

k = 2*pi*fc/c;
ix = (0:Nx-1)';  iy = (0:Ny-1)';
wx_s = w_x(:) .* exp(1j * k * dx * ix * ux);
wy_s = w_y(:) .* exp(1j * k * dy * iy * uy);

% meshgrid(0:Nx-1, 0:Ny-1) in steering_vector: ix=col, iy=row,
% linear index Nt = sub2ind([Ny, Nx], iy+1, ix+1) = iy + ix*Ny + 1.
% Hence kron(wx_s, wy_s) matches.
w = kron(wx_s, wy_s);
w = w / norm(w);
end

function w = local_dc_1d(N, sll_dB)
%LOCAL_DC_1D Dolph-Chebyshev window of length N (Helms algorithm).
if N == 1; w = 1; return; end

if exist('chebwin', 'file') == 2
    w = chebwin(N, sll_dB);
    w = w(:);
    w = w / max(abs(w));
    return;
end

gamma = 10^(-sll_dB/20);
beta  = cosh(acosh(1/gamma) / (N - 1));
k     = (0:N-1);
xk    = beta * cos(pi*k/N);
pk    = local_chebyshev(N-1, xk);

if mod(N, 2) == 1
    Wf = real(fft(pk));
    M  = (N+1)/2;
    h  = Wf(1:M) / Wf(1);
    w  = [h(M:-1:2), h].';
else
    pk = pk .* exp(1j*pi/N * (0:N-1));
    Wf = real(fft(pk));
    M  = N/2 + 1;
    h  = Wf(1:M) / Wf(1);
    w  = [h(M:-1:2), h].';
end
w = w / max(abs(w));
end

function T = local_chebyshev(n, x)
x = x(:).';  T = zeros(size(x));
m_in = abs(x) <= 1;
T(m_in)  = cos(n * acos(x(m_in)));
xo = x(~m_in);
T(~m_in) = cosh(n * acosh(abs(xo))) .* (sign(xo).^n);
end
