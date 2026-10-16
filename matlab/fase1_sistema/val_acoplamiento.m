%VAL_ACOPLAMIENTO Mutual-impedance reference with Antenna Toolbox (method of moments).
%
%   3×3 array of 0.45λ dipoles oriented along x (λ/100 strip), λ/2 spacing at f0,
%   in free space. sparameters → Z = Z0·(I + S)/(I − S). The web engine
%   (coupling.ts:mutualZ, induced EMF with sinusoidal current) is compared against this Z.
%   Generates web/src/validation/ref_acoplamiento.json.

clear; startup_if_needed();
S = sistema_ref();
f = S.face.f0; lam = S.face.lambda; d = S.face.d;
dp = dipole(Length = 0.45 * lam, Width = lam / 100);
dp.Tilt = 90; dp.TiltAxis = [0 1 0];               % dipole axis along x
arr = rectangularArray(Element = dp, Size = [3 3], RowSpacing = d, ColumnSpacing = d);
t0 = tic;
sp = sparameters(arr, f, 50);
Sm = sp.Parameters(:, :, 1);
Z0 = 50;
Z = Z0 * ((eye(9) + Sm) / (eye(9) - Sm));
pos = arr.FeedLocation;                             % [x y z] of each element's feed point
out.meta = struct('generado', char(datetime('now', 'Format', 'yyyy-MM-dd HH:mm')), 'matlab', version, ...
  'toolbox', 'Antenna Toolbox (MoM)', 'f', f, 'lambda', lam, 'd', d, 'longitud', 0.45 * lam, 'anchura', lam / 100, ...
  'segundos', toc(t0));
out.x = pos(:, 1).'; out.y = pos(:, 2).';
out.Zre = real(Z); out.Zim = imag(Z);
write_json(fullfile(web_validation_dir(), 'ref_acoplamiento.json'), out);
c = 5;                                               % central element
fprintf('Self Z %.1f%+.1fj · %.1f s\n', real(Z(c, c)), imag(Z(c, c)), toc(t0));
for m = [2 4 1]
  fprintf('Z(%d,%d): Δ = (%.3f, %.3f) λ → %.2f%+.2fj\n', c, m, (pos(m, 1) - pos(c, 1)) / lam, (pos(m, 2) - pos(c, 2)) / lam, real(Z(c, m)), imag(Z(c, m)));
end
