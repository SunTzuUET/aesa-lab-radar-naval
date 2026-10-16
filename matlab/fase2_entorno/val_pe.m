%VAL_PE Validation of the parabolic equation (lib/propagacion/pe_ssf.m).
%
%   1. Interference zone, standard atmosphere: vs. the exact two-ray model
%      (lib/radar/dos_rayos_exacto.m) with a perfect conductor and k = 4/3.
%   2. Shadow zone: vs. ITU-R P.526 spherical-earth diffraction.
%   3. Convergence: range and height steps halved.
%   4. 15 m evaporation duct: trapped energy vs. the standard atmosphere.
%   Saves results/propagacion/val_pe.json and a figure.

clear; startup_if_needed();
S = sistema_ref();
f = S.face.f0; lam = S.c0 / f; Re = S.earthR; ha = S.radar.hRadarM;
bw = 6;                                       % 6° Gaussian beam for the reference cases
src = @(th) exp(-2 * log(2) * (rad2deg(th) / bw).^2);
pe = @(perfil, o) pe_ssf(f, ha, src, perfil, o);
estd = @(z) perfil_m('estandar', z);
o = struct('xMax', 160e3, 'dx', 100, 'zMax', 600, 'nz', 16384, 'zOut', (0:0.5:400).');
t0 = tic; P = pe(estd, o); fprintf('Standard PE: %.1f s, dz = %.3f m, θmax = %.1f°\n', toc(t0), P.dz, P.thMaxDeg);
F = @(P, x, h) interp2(P.x, P.z, P.Fdb, x, h);
out = struct();

% ── 1. two-ray (perfect conductor, k = 4/3) ──
ae = 4 / 3 * Re; epsc = 1e7 - 1e7j;
h2 = 100; xs = 4e3:200:30e3;                % multiples of dx: no interpolation between fringes
Fr = zeros(size(xs)); Fp = Fr;
for i = 1:numel(xs)
  d = xs(i);
  R = sqrt((ae + ha)^2 + (ae + h2)^2 - 2 * (ae + ha) * (ae + h2) * cos(d / ae));   % exact slant range
  th = atan((h2 - ha) / d - d / (2 * ae));    % direct-ray angle including curvature
  Fr(i) = 20 * log10(dos_rayos_exacto(R, ha, h2, ae, lam, epsc, 'H', 0) * src(th));
  Fp(i) = F(P, d, h2);
end
m = Fr > -10;
out.dosRayos = struct('h2', h2, 'x', xs, 'Fref', Fr, 'Fpe', Fp, 'errMaxFueraNulos', max(abs(Fp(m) - Fr(m))));
fprintf('[1] two-ray h=%g m: max error outside nulls %.2f dB\n', h2, out.dosRayos.errMaxFueraNulos);

% ── 2. P.526 diffraction (shadow) ──
h2 = 20; xs = 70e3:5e3:160e3;
dh = sqrt(2 * ae * ha) + sqrt(2 * ae * h2);
Fd = arrayfun(@(d) difraccion_p526(d / 1e3, ha, h2, f, ae / 1e3), xs);
Fp = arrayfun(@(d) F(P, d, h2), xs);
v = Fd > -85;                                 % below this, PE numerical floor (≈ −90 dB)
out.difraccion = struct('h2', h2, 'horizonteKm', dh / 1e3, 'x', xs, 'Fref', Fd, 'Fpe', Fp, 'errMax', max(abs(Fp(v) - Fd(v))), 'sueloDb', -85);
fprintf('[2] P.526 h=%g m (horizon %.1f km): max error %.2f dB with F > −85 dB\n', h2, dh / 1e3, out.difraccion.errMax);

% ── 3. convergence ──
o2 = o; o2.dx = 50; o2.nz = 32768;
P2 = pe(estd, o2);
pts = [20e3 50; 40e3 300; 60e3 20; 75e3 20];      % all above the numerical floor
dd = arrayfun(@(i) abs(F(P, pts(i, 1), pts(i, 2)) - F(P2, pts(i, 1), pts(i, 2))), 1:size(pts, 1));
out.convergencia = struct('puntos', pts, 'difDb', dd);
fprintf('[3] convergence (dx 100→50 m, nz ×2): max diff. %.3f dB\n', max(dd));

% ── 4. evaporation duct ──
delta = 15;
Pd = pe(@(z) perfil_m('evaporacion', z, delta), o);
xs = (10:2:160) * 1e3;
out.conducto = struct('delta', delta, 'h', 7, 'x', xs, 'Festandar', F(P, xs, 7), 'Fconducto', F(Pd, xs, 7));
fprintf('[4] duct %g m, target at 7 m: F at 100 km %.1f dB (standard %.1f dB)\n', delta, F(Pd, 100e3, 7), F(P, 100e3, 7));

% ── 5. reciprocity inside the duct (nearly isotropic source) ──
srcA = @(th) exp(-2 * log(2) * (rad2deg(th) / 30).^2);
duct = @(z) perfil_m('evaporacion', z, delta);
Pa = pe_ssf(f, ha, srcA, duct, o);           % antenna at 20 m, receiver at 7 m
Pb = pe_ssf(f, 7, srcA, duct, o);            % reversed
xr = (40:10:150) * 1e3;
Fa = F(Pa, xr, 7); Fb = F(Pb, xr, ha);
out.reciprocidad = struct('x', xr, 'F20a7', Fa, 'F7a20', Fb, 'difMax', max(abs(Fa - Fb)));
fprintf('[5] reciprocity in the duct (20 m ↔ 7 m, 40–150 km): max diff. %.2f dB\n', out.reciprocidad.difMax);

% ── 6. real surface (spectral image with Γ): conductor, smooth sea H and V, rough sea ──
w_ = 2 * pi * f; wt = w_ * 9.2e-12; den = 1 + wt^2;
epsSea = (4.9 + (72 - 4.9) / den) - 1j * ((72 - 4.9) * wt / den + 4.7 / (w_ * 8.854e-12));   % Debye (= web)
gam = @(pol, sh) @(psi) fresnelG(psi, epsSea, pol) .* exp(-2 * (2 * pi * sh * sin(psi) / lam).^2);
oG = o; oG.xMax = 32e3;
P0 = pe_ssf(f, ha, src, estd, setfield(oG, 'gamma', @(psi) -ones(size(psi))));    % Γ = −1
h2 = 100; xs = 4e3:200:30e3;
out.imagenConductor = max(abs(F(P0, xs, h2) - F(P, xs, h2)));
fprintf('[6] spectral image with Γ = −1 vs. sine transform: max diff. %.3f dB\n', out.imagenConductor);
casos = {'H', 0; 'V', 0; 'H', 0.5; 'V', 0.5};
for ic = 1:size(casos, 1)
  pol = casos{ic, 1}; sh = casos{ic, 2};
  Pg = pe_ssf(f, ha, src, estd, setfield(oG, 'gamma', gam(pol, sh)));
  Fr = zeros(size(xs)); Fp = Fr;
  for i = 1:numel(xs)
    d = xs(i);
    R = sqrt((ae + ha)^2 + (ae + h2)^2 - 2 * (ae + ha) * (ae + h2) * cos(d / ae));
    th = atan((h2 - ha) / d - d / (2 * ae));
    Fr(i) = 20 * log10(dos_rayos_exacto(R, ha, h2, ae, lam, epsSea, pol, sh) * src(th));
    Fp(i) = F(Pg, d, h2);
  end
  m = Fr > -10;
  out.superficie(ic) = struct('pol', pol, 'sigmaH', sh, 'x', xs, 'Fref', Fr, 'Fpe', Fp, 'errMaxFueraNulos', max(abs(Fp(m) - Fr(m))), ...
    'errRms', sqrt(mean((Fp(m) - Fr(m)).^2)));
  fprintf('[6] sea %s, σh = %.1f m: max error outside nulls %.2f dB (RMS %.2f dB)\n', pol, sh, out.superficie(ic).errMaxFueraNulos, out.superficie(ic).errRms);
end

% ── 7. surface duct (trilinear layer) and roughness inside the duct ──
tri = [150 50 40];                            % base 150 m, 50 m thick, ΔM = 40
Pt = pe(@(z) perfil_m('trilineal', z, tri), o);
Ptr = pe_ssf(f, ha, src, @(z) perfil_m('trilineal', z, tri), setfield(o, 'gamma', gam('H', 0.5)));
Pdr = pe_ssf(f, ha, src, duct, setfield(o, 'gamma', gam('H', 0.5)));
out.conductoSuperficie = struct('capa', tri, 'F100kmEstandar', F(P, 100e3, 50), 'F100km', F(Pt, 100e3, 50), 'F100kmRugoso', F(Ptr, 100e3, 50), ...
  'evapF100kmLiso', F(Pd, 100e3, 7), 'evapF100kmRugoso', F(Pdr, 100e3, 7));
fprintf('[7] trilinear layer %s: F at 100 km and 50 m %.1f dB (smooth), %.1f dB (σh 0.5 m), standard %.1f dB\n', mat2str(tri), ...
  out.conductoSuperficie.F100km, out.conductoSuperficie.F100kmRugoso, out.conductoSuperficie.F100kmEstandar);
fprintf('[7] 15 m evaporation duct, 7 m at 100 km: %.1f dB smooth · %.1f dB with σh 0.5 m\n', out.conductoSuperficie.evapF100kmLiso, out.conductoSuperficie.evapF100kmRugoso);

root = fileparts(fileparts(mfilename('fullpath')));
od = fullfile(root, 'results', 'propagacion'); if ~exist(od, 'dir'), mkdir(od); end
write_json(fullfile(od, 'val_pe.json'), out);

fg = figure('Visible', 'off', 'Position', [100 100 1200 360]);
tiledlayout(1, 3, 'TileSpacing', 'compact');
nexttile; plot(out.dosRayos.x / 1e3, out.dosRayos.Fref, 'k', out.dosRayos.x / 1e3, out.dosRayos.Fpe, 'r--'); grid on; ylim([-40 10]);
xlabel('km'); ylabel('F (dB)'); title('Two-ray, h = 100 m'); legend('two-ray', 'PE');
nexttile; plot(out.difraccion.x / 1e3, out.difraccion.Fref, 'k', out.difraccion.x / 1e3, out.difraccion.Fpe, 'r--'); grid on;
xlabel('km'); title('Shadow, P.526, h = 20 m'); legend('P.526', 'PE');
nexttile; plot(out.conducto.x / 1e3, out.conducto.Festandar, 'k', out.conducto.x / 1e3, out.conducto.Fconducto, 'b'); grid on;
xlabel('km'); title('Target at 7 m'); legend('standard', '15 m duct');
exportgraphics(fg, fullfile(od, 'val_pe.png'), 'Resolution', 130); close(fg);

function G = fresnelG(psi, ec, pol)
s = sin(psi); c2 = cos(psi).^2; r = sqrt(ec - c2);
if pol == 'H', G = (s - r) ./ (s + r); else, G = (ec * s - r) ./ (ec * s + r); end
end
