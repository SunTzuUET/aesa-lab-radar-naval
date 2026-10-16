%REF_PE_WEB Parabolic-equation reference points for the web test (web/src/engine/pe.ts).
%
%   Same profile as the web engine: M(z) = z/(k·Re)·10⁶ − 0.125·δ·ln((z + z0)/z0), with k = 4/3
%   and δ = 0 (standard) or 15 m (duct). Antenna at 20 m with a 6° Gaussian beam.
%   Generates web/src/validation/ref_pe.json.

clear; startup_if_needed();
S = sistema_ref();
f = S.face.f0; ha = S.radar.hRadarM; Re = S.earthR; k = 4 / 3; z0 = 1.5e-4;
src = @(th) exp(-2 * log(2) * (rad2deg(th) / 6).^2);
o = struct('xMax', 120e3, 'dx', 100, 'zMax', 600, 'nz', 8192, 'zOut', (0:0.5:400).');
pts = [5e3 100; 12e3 30; 25e3 10; 40e3 7; 60e3 20; 80e3 7; 100e3 50; 120e3 7];
out.meta = struct('generado', char(datetime('now', 'Format', 'yyyy-MM-dd HH:mm')), 'matlab', version, ...
  'f', f, 'hAnt', ha, 'k', k, 'bwDeg', 6, 'xMax', o.xMax, 'dx', o.dx, 'zMax', o.zMax, 'nz', o.nz);
for delta = [0 15]
  prof = @(z) z / (k * Re) * 1e6 - (delta > 0) * 0.125 * delta * log((z + z0) / z0);
  P = pe_ssf(f, ha, src, prof, o);
  Fdb = arrayfun(@(i) interp2(P.x, P.z, P.Fdb, pts(i, 1), pts(i, 2)), 1:size(pts, 1));
  out.(sprintf('d%d', delta)) = struct('ductM', delta, 'x', pts(:, 1).', 'z', pts(:, 2).', 'Fdb', Fdb);
  fprintf('δ = %2d m: %s dB\n', delta, mat2str(round(Fdb, 2)));
end
% real surface (spectral image with Γ) and trilinear layer
lam = S.c0 / f; w_ = 2 * pi * f; wt = w_ * 9.2e-12; den = 1 + wt^2;
epsSea = (4.9 + (72 - 4.9) / den) - 1j * ((72 - 4.9) * wt / den + 4.7 / (w_ * 8.854e-12));
casos = struct('pol', {'V', 'H', 'H'}, 'sigmaH', {0, 0.5, 0.5}, 'ductM', {0, 0, 0}, 'capa', {[], [], [150 50 40]});
out.superficie = struct('pol', {}, 'sigmaH', {}, 'ductM', {}, 'capa', {}, 'x', {}, 'z', {}, 'Fdb', {});
for c = casos
  prof = @(z) z / (k * Re) * 1e6;
  if ~isempty(c.capa)
    zb = c.capa(1); t = c.capa(2); dM = c.capa(3);
    g = 1e6 / (k * Re);                     % as in perfil_m('trilineal'): within the layer M drops by dM in absolute value
    prof = @(z) g * z - (dM + g * t) * min(max((z - zb) / t, 0), 1);
  end
  o2 = o; o2.gamma = @(psi) fresnelG(psi, epsSea, c.pol) .* exp(-2 * (2 * pi * c.sigmaH * sin(psi) / lam).^2);
  P = pe_ssf(f, ha, src, prof, o2);
  Fdb = arrayfun(@(i) interp2(P.x, P.z, P.Fdb, pts(i, 1), pts(i, 2)), 1:size(pts, 1));
  out.superficie(end + 1) = struct('pol', c.pol, 'sigmaH', c.sigmaH, 'ductM', c.ductM, 'capa', c.capa, 'x', pts(:, 1).', 'z', pts(:, 2).', 'Fdb', Fdb);
  fprintf('%s, σh %.1f, layer %s: %s dB\n', c.pol, c.sigmaH, mat2str(c.capa), mat2str(round(Fdb, 2)));
end
write_json(fullfile(web_validation_dir(), 'ref_pe.json'), out);

function G = fresnelG(psi, ec, pol)
s = sin(psi); c2 = cos(psi).^2; r = sqrt(ec - c2);
if pol == 'H', G = (s - r) ./ (s + r); else, G = (ec * s - r) ./ (ec * s + r); end
end
