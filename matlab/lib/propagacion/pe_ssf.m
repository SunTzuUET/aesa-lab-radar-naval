function P = pe_ssf(f, hAnt, src, perfil, opts)
%PE_SSF Wide-angle parabolic equation solved by split-step Fourier.
%
%   P = pe_ssf(f, hAnt, src, perfil, opts)
%
%   2D tropospheric propagation (range x, height z) over the sea, with an equivalent
%   flat earth: the curvature enters through the modified refractive index
%   m(z) = 1 + M(z)·10⁻⁶, with M = N + z/Re·10⁶ (Levy, «Parabolic equation methods for
%   electromagnetic wave propagation», IEE, 2000).
%
%   Step (Feit-Fleck wide-angle propagator and phase screen):
%     u(x+Δx, z) = e^{j·k·Δx·(m(z)−1)} · T⁻¹{ e^{j·Δx·(√(k²−p²) − k)} · T{u(x, ·)} }
%   T = discrete sine transform: perfectly conducting surface with horizontal
%   polarization (Γ = −1, a good approximation of the sea at grazing angles in S band).
%   Absorbing layer (Hann window) above zMax.
%
%   f      frequency (Hz)
%   hAnt   height of the antenna phase center (m)
%   src    antenna elevation pattern: function of θ (rad, vector) returning the
%          complex amplitude normalized to peak 1, with pointing included
%   perfil function M(z) (M units, z in m)
%   opts   .xMax, .dx (m) · .zMax (useful height, m) · .nz (power of 2)
%          .xOut (output ranges, multiples of dx) · .zOut (output heights, m)
%          .gamma (optional) surface function Γ(ψ) (grazing ψ in rad, complex): real sea
%          (Fresnel H or V times roughness). Without it, perfect conductor with the sine transform.
%
%   Surface with Γ(ψ) (spectral image method): at each step, the real field (z ≥ 0) is
%   transformed over the full domain (−zTop, zTop); the image at z < 0 is the weighted specular
%   spectrum, U_img(p) = Γ(asin|p|/k)·U_real(−p), so that downgoing components come back
%   up reflected with the Γ of their angle. With Γ = −1 the odd extension of the conductor is recovered.
%
%   Output: P.F = one-way |F| (linear) including the antenna pattern,
%   zOut × xOut grid; P.Fdb = 20·log10 F; P.x, P.z, P.dz.
%
%   Normalization: by stationary phase, in free space |u(x,z)|·√x → √(k/2π)·|f(θ)|,
%   so F = |u|·√x / √(k/2π) is the pattern times the propagation factor.

if nargin < 5, opts = struct(); end
c0 = 299792458; k = 2 * pi * f / c0; lam = c0 / f;
xMax = opt(opts, 'xMax', 100e3);
dx = opt(opts, 'dx', 200);
zMax = opt(opts, 'zMax', 1000);
nz = opt(opts, 'nz', 4096);
xOut = opt(opts, 'xOut', dx:dx:xMax);
zOut = opt(opts, 'zOut', (0:1:zMax).');

zTop = zMax * 1.5;                          % total domain, with the absorbing layer on top
dz = zTop / nz;
thMax = asind(min(1, lam / (2 * dz)));
z = (0:nz - 1).' * dz;
pPos = (0:nz - 1).' * pi / zTop;            % sine-transform wavenumbers

% initial field: angular spectrum f(θ)·e^{−jp·h} → distribution v(z) on (−zTop, zTop) via FFT,
% and odd part v(z) − v(−z) (opposite image of the conductor)
m = (-nz:nz - 1).';
p = m * pi / zTop;
A = zeros(2 * nz, 1);
ok = abs(p) < k;
A(ok) = src(asin(p(ok) / k)) .* exp(-1j * p(ok) * hAnt);
v = (pi / zTop) / (2 * pi) * (2 * nz) * fftshift(ifft(ifftshift(A)));   % v(z_n), n = −nz..nz−1
iz0 = nz + 1;                                  % index of z = 0
u = v(iz0:iz0 + nz - 1) - [0; flipud(v(iz0 - nz + 1:iz0 - 1))];
u(1) = 0;

kz2 = k^2 - pPos.^2;
prop = exp(1j * dx * (sqrt(complex(kz2)) - k));
prop(kz2 < 0) = 0;                             % drop evanescent waves
Mz = perfil(z);
screen = exp(1j * k * dx * (Mz - Mz(1)) * 1e-6);
w = ones(nz, 1);
iA = z > zMax;
w(iA) = 0.5 * (1 + cos(pi * (z(iA) - zMax) / (zTop - zMax)));

nx = round(xMax / dx);
xo = round(xOut / dx);
F = nan(numel(zOut), numel(xOut));
c = sqrt(k / (2 * pi));
G = opt(opts, 'gamma', []);
if ~isempty(G)
  % full domain: indices 0..2nz−1, z ≥ 0 at 0..nz−1, z < 0 at the end (wrap-around)
  zf = [z; -(nz:-1:1).' * dz];
  pf = [(0:nz - 1).'; (-nz:-1).'] * pi / zTop;
  ok = abs(pf) < k;
  Gp = zeros(2 * nz, 1); Gp(ok) = G(asin(abs(pf(ok)) / k));
  propF = zeros(2 * nz, 1); propF(ok) = exp(1j * dx * (sqrt(k^2 - pf(ok).^2) - k));
  mir = [1; (2 * nz:-1:2).'];                  % index of −p
  scrF = exp(1j * k * dx * (perfil(abs(zf)) - Mz(1)) * 1e-6);
  wF = [w; ones(nz, 1)];
  real_ = zf >= 0;
  vf = [v(iz0:iz0 + nz - 1); zeros(nz, 1)];    % direct source field at z ≥ 0
end
for ix = 1:nx
  if isempty(G)
    u = screen .* isin(prop .* fsin(u)) .* w;
  else
    vr = vf .* real_;
    Vr = fft(vr);
    vi = ifft(Gp .* Vr(mir));
    vf = vr + vi .* ~real_;
    vf = scrF .* ifft(propF .* fft(vf)) .* wF;
    u = vf(1:nz);
  end
  j = find(xo == ix);
  if ~isempty(j)
    F(:, j) = repmat(abs(interp1(z, u, zOut(:), 'linear', 0)) * sqrt(ix * dx) / c, 1, numel(j));
  end
end
P.F = F; P.Fdb = 20 * log10(max(F, 1e-12)); P.x = xOut; P.z = zOut(:); P.dz = dz; P.thMaxDeg = thMax;

  function S = fsin(x)        % S_m = Σ_n x_n·sin(π·m·n/nz)   (x_1 = 0 at z = 0)
    E = fft([x; 0; -flipud(x(2:end))]);
    S = 0.5j * E(1:nz);
  end
  function x = isin(S)        % x_n = (2/nz)·Σ_m S_m·sin(π·m·n/nz)
    S(1) = 0;
    e = ifft([S; 0; -flipud(S(2:end))]);
    x = -2j * e(1:nz);
  end
end

function v = opt(s, n, d)
if isfield(s, n) && ~isempty(s.(n)), v = s.(n); else, v = d; end
end
