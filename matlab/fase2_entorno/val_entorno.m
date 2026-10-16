%VAL_ENTORNO Reference vectors for the environment models (Radar Toolbox and ITU propagation).
%
%   Generates web/src/validation/ref_entorno.json with:
%     - sea-water permittivity (earthSurfacePermittivity, ITU-R P.527);
%     - propagation factor over the sea:
%         a) EXACT two-ray model over a spherical earth, solved numerically (reflection
%            point from Fermat's principle): a reference independent of the
%            closed-form Blake geometry used by the web;
%         b) radarpropfactor (Blake's method for coverage diagrams). It uses the
%            far-target path difference Δ = 2·h·sin θd, valid when the target is
%            much higher than the antenna; it is compared only in that regime
%            and the discrepancy is documented for the sea-skimming case;
%     - sea reflectivity σ⁰, NRL model (seareflectivity);
%     - gaseous attenuation (gaspl, ITU-R P.676) and rain attenuation (rainpl, ITU-R P.838),
%       with the P.838 k, α coefficient table extracted from rainpl. rainpl applies a
%       rate-dependent path reduction; the specific attenuation γ
%       (dB/km) is obtained with a 1 m path;
%     - surface refractivity and effective radius (refractiveidx, effearthradius).

clear; startup_if_needed();
S = sistema_ref();
f = S.face.f0;
lam = physconst('LightSpeed') / f;
Re = 4/3 * S.earthR;

% --- sea permittivity -----------------------------------------------------------
[~, ~, epsc] = earthSurfacePermittivity('sea-water', f, 20, 35);
perm = struct('f', f, 'temp', 20, 'salinidad', 35, 're', real(epsc), 'im', imag(epsc));

% --- (a) exact two-ray -------------------------------------------------------------
exacto = struct('hr', {}, 'ht', {}, 'pol', {}, 'sigmaH', {}, 'R', {}, 'FdB', {});
casos = { 20, 7, 'H', 0.01;  20, 300, 'H', 0.01;  20, 300, 'V', 0.01;  20, 1000, 'H', 0.01;  20, 300, 'H', 0.3;  20, 7, 'H', 1.0 };
for i = 1:size(casos, 1)
  [hr, ht, pol, sh] = casos{i, :};
  Rh = sqrt(2 * Re * hr) + sqrt(2 * Re * ht);
  R = linspace(max(500, 1.5 * abs(ht - hr)), 0.85 * Rh, 600);
  F = arrayfun(@(r) dos_rayos_exacto(r, hr, ht, Re, lam, epsc, pol, sh), R);
  exacto(end + 1) = struct('hr', hr, 'ht', ht, 'pol', pol, 'sigmaH', sh, 'R', R, 'FdB', round(20 * log10(F), 4)); %#ok<SAGROW>
end

% --- (b) radarpropfactor in the Blake regime (high, distant target) -------------------
patAng = (-90:0.5:90).';
patAmp = ones(size(patAng));                     % isotropic antenna in elevation
blake = struct('hr', {}, 'ht', {}, 'pol', {}, 'sigmaH', {}, 'R', {}, 'FdB', {}, 'exactoFdB', {});
bcasos = { 20, 10000, 'H', 0.01, 0.55, 0.85;  20, 7, 'H', 0.01, 0.05, 0.85 };   % the second: sea-skimming (outside the regime)
for i = 1:size(bcasos, 1)
  [hr, ht, pol, sh, r0, r1] = bcasos{i, :};
  Rh = sqrt(2 * Re * hr) + sqrt(2 * Re * ht);
  R = linspace(r0 * Rh, r1 * Rh, 600);
  F = radarpropfactor(R, f, hr, ht, 'Polarization', pol, 'SurfaceRelativePermittivity', epsc, ...
    'SurfaceHeightStandardDeviation', sh, 'AntennaPattern', patAmp, 'PatternAngles', patAng, 'EffectiveEarthRadius', Re);
  Fx = arrayfun(@(r) dos_rayos_exacto(r, hr, ht, Re, lam, epsc, pol, sh), R);
  blake(end + 1) = struct('hr', hr, 'ht', ht, 'pol', pol, 'sigmaH', sh, 'R', R, 'FdB', round(F(:).', 4), ...
    'exactoFdB', round(20 * log10(Fx), 4)); %#ok<SAGROW>
end

% --- sea reflectivity (NRL) --------------------------------------------------------
graz = logspace(-1, log10(30), 40);
sea = struct('ss', {}, 'pol', {}, 'graz', {}, 's0dB', {});
for ss = 0:6
  for pol = ['H' 'V']
    n = seareflectivity(ss, graz, f, 'Polarization', pol, 'Model', 'NRL');
    sea(end + 1) = struct('ss', ss, 'pol', pol, 'graz', graz, 's0dB', 10 * log10(n(:).')); %#ok<SAGROW>
  end
end

% --- gases and rain -------------------------------------------------------------------
gcasos = [15 1013.25 7.5; 25 1013.25 15; 5 1000 3; 30 1010 25];
gas = struct('T', {}, 'P', {}, 'rho', {}, 'dBkm', {});
for i = 1:size(gcasos, 1)
  L = gaspl(1000, f, gcasos(i, 1), gcasos(i, 2) * 100, gcasos(i, 3));
  gas(end + 1) = struct('T', gcasos(i, 1), 'P', gcasos(i, 2), 'rho', gcasos(i, 3), 'dBkm', L); %#ok<SAGROW>
end
rr = [1 5 10 25 50];
rain = struct('pol', {'H', 'V'}, 'R', {rr, rr}, ...
  'dBkm', {arrayfun(@(r) gammaR(f, r, 0), rr), arrayfun(@(r) gammaR(f, r, 90), rr)});
% P.838 k, α coefficients (power law γ = k·R^α) extracted from rainpl
fg = (1:0.1:6) * 1e9;
p838 = zeros(numel(fg), 5);
for i = 1:numel(fg)
  gh1 = gammaR(fg(i), 1, 0);  gh10 = gammaR(fg(i), 10, 0);
  gv1 = gammaR(fg(i), 1, 90); gv10 = gammaR(fg(i), 10, 90);
  p838(i, :) = [fg(i) / 1e9, gh1, log10(gh10 / gh1), gv1, log10(gv10 / gv1)];
end

% --- refraction ------------------------------------------------------------------
[~, Nstd] = refractiveidx(0);
ns = [280 300 313 330 350 380];
ke = zeros(size(ns));
for i = 1:numel(ns)
  [~, ke(i)] = effearthradius(50e3, 20, 1000, 'SurfaceRefractivity', ns(i));
end
refr = struct('Nstd', Nstd, 'ns', ns, 'k', ke);

out.meta = struct('generado', char(datetime('now', 'Format', 'yyyy-MM-dd HH:mm')), 'matlab', version, ...
  'toolbox', 'Radar Toolbox + propagación ITU', 'f', f, 'Re', Re);
out.permitividad = perm;
out.exacto = exacto;
out.blake = blake;
out.mar = sea;
out.gases = gas;
out.lluvia = rain;
out.p838 = p838;
out.refraccion = refr;
write_json(fullfile(web_validation_dir(), 'ref_entorno.json'), out);
fprintf('[%.1f, %.5e, %.5f, %.5e, %.5f],\n', p838.');

function g = gammaR(f, R, tau)
%GAMMAR ITU-R P.838 rain specific attenuation (dB/km) from rainpl (1 m path).
g = rainpl(1, f, R, 0, tau) * 1000;
end
