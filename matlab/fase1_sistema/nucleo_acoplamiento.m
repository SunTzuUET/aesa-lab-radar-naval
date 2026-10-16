%NUCLEO_ACOPLAMIENTO Mutual-impedance kernel via MoM (Antenna Toolbox) for the web.
%
%   0.45λ dipoles along x (λ/100 strip) at h = λ/4 above an infinite ground plane, modeled
%   with images: a conformalArray with the real M×M array at z = 0 and its images at
%   z = −2h. With opposite image currents, the effective mutual impedance between two real
%   elements separated by Δ is Z_ef(Δ) = Z_rr(Δ) − Z_ri(Δ).
%   The row of the center element is taken (offsets 0..(M−1)/2 in x and y, by symmetry).
%   Generates web/src/engine/coupling_mom.json; the web uses this kernel at short range and induced EMF farther out.

clear; startup_if_needed();
S = sistema_ref();
f = S.face.f0; lam = S.face.lambda; d = S.face.d; h = lam / 4;
M = 21;                                          % real M×M array (offsets up to ±10)
dp = dipole(Length = 0.45 * lam, Width = lam / 100);
dp.Tilt = 90; dp.TiltAxis = [0 1 0];             % axis along x
[ix, iy] = meshgrid(-(M - 1) / 2:(M - 1) / 2);
P = [ix(:) * d, iy(:) * d, zeros(M^2, 1)];
P = [P; P(:, 1:2), -2 * h * ones(M^2, 1)];       % images
els = repmat({dp}, 1, 2 * M^2);
arr = conformalArray(Element = els, ElementPosition = P);
t0 = tic;
sp = sparameters(arr, f, 50);
Sm = sp.Parameters(:, :, 1);
Z = 50 * ((eye(2 * M^2) + Sm) / (eye(2 * M^2) - Sm));
c = (M^2 + 1) / 2;                               % central real element
K = (M - 1) / 2;
Zr = zeros(K + 1); Zi = zeros(K + 1); Zfr = zeros(K + 1); Zfi = zeros(K + 1);
for a = 0:K
  for b = 0:K
    m = find(abs(P(1:M^2, 1) - a * d) < 1e-9 & abs(P(1:M^2, 2) - b * d) < 1e-9);
    ze = Z(c, m) - Z(c, m + M^2);                % with image (opposite current)
    Zr(b + 1, a + 1) = real(ze); Zi(b + 1, a + 1) = imag(ze);
    Zfr(b + 1, a + 1) = real(Z(c, m)); Zfi(b + 1, a + 1) = imag(Z(c, m));
  end
end
out.meta = struct('generado', char(datetime('now', 'Format', 'yyyy-MM-dd HH:mm')), 'matlab', version, ...
  'toolbox', 'Antenna Toolbox (MoM, conformalArray con imágenes)', 'f', f, 'lambda', lam, 'd', d, 'h', h, ...
  'longitud', 0.45 * lam, 'anchura', lam / 100, 'M', M, 'segundos', toc(t0));
out.K = K;
out.Zre = Zr; out.Zim = Zi;                      % [y offset][x offset], with ground
out.ZfreeRe = Zfr; out.ZfreeIm = Zfi;            % without ground (to validate induced EMF)
here = fileparts(mfilename('fullpath'));
write_json(fullfile(here, '..', '..', 'web', 'src', 'engine', 'coupling_mom.json'), out);
fprintf('MoM %d ports in %.0f s · self Z with ground %.1f%+.1fj\n', 2 * M^2, toc(t0), Zr(1, 1), Zi(1, 1));
