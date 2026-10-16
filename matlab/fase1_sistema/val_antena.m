%VAL_ANTENA Reference vectors for the AESA face with Phased Array System Toolbox.
%
%   Generates web/src/validation/ref_antena.json with:
%     - 80-element taper weights (taylorwin, chebwin);
%     - directivity cuts (dBi) of the 80×80 face for several cases.
%   The web engine is compared against these vectors (web/tests/validation.test.ts).
%
%   Conventions: phased.URA in the y-z plane (normal +x); MATLAB azimuth
%   matches the web's in the 0 elevation plane. Element with a cos θ
%   power pattern in the principal cuts: CosineAntennaElement with
%   CosinePower [0.5 0.5] (cos^0.5 amplitude in azimuth and elevation).
%   Continuous phase shifters and frequency f0 (no quantization or squint).

clear; startup_if_needed();
S = sistema_ref();
F = S.face; c = S.c0; f = F.f0;

el = phased.CosineAntennaElement('FrequencyRange', [1e9 6e9], 'CosinePower', [0.5 0.5]);
ura = phased.URA('Size', [F.Ny F.Nx], 'ElementSpacing', [F.d F.d], 'Element', el);
sv = phased.SteeringVector('SensorArray', ura, 'PropagationSpeed', c);

ang = -90:0.1:90;
casos = {
  % name                      taper        sll  nbar  az   el   cut
  'uniforme_broadside',       'uniform',   0,   0,    0,   0,   'az'
  'taylor35_broadside',       'taylor',    35,  5,    0,   0,   'az'
  'taylor35_az30',            'taylor',    35,  5,    30,  0,   'az'
  'chebyshev30_broadside',    'chebyshev', 30,  0,    0,   0,   'az'
  'taylor35_el20',            'taylor',    35,  5,    0,   20,  'el'
};

out.meta = struct('generado', char(datetime('now', 'Format', 'yyyy-MM-dd HH:mm')), ...
  'matlab', version, 'toolbox', 'Phased Array System Toolbox', ...
  'f0', f, 'Nx', F.Nx, 'Ny', F.Ny, 'd', F.d, 'elemento', 'CosineAntennaElement [0.5 0.5]');
out.taylor80 = taylorwin(F.Nx, 5, -35).';
out.cheb80 = chebwin(F.Nx, 30).';
out.casos = struct('nombre', {}, 'taper', {}, 'sll', {}, 'nbar', {}, 'az', {}, 'el', {}, 'corte', {}, 'ang', {}, 'dbi', {}, 'pico', {});

for i = 1:size(casos, 1)
  [nombre, taper, sll, nbar, az0, el0, corte] = casos{i, :};
  switch taper
    case 'uniform',   t = ones(F.Nx, 1);
    case 'taylor',    t = taylorwin(F.Nx, nbar, -sll);
    case 'chebyshev', t = chebwin(F.Nx, sll);
  end
  T = t * t.';                                   % separable (rows = z, columns = y)
  w = T(:) .* sv(f, [az0; el0]);
  if strcmp(corte, 'az')
    d = pattern(ura, f, ang, el0, 'Type', 'directivity', 'Weights', w, 'PropagationSpeed', c);
  else
    d = pattern(ura, f, az0, ang, 'Type', 'directivity', 'Weights', w, 'PropagationSpeed', c);
  end
  d = d(:).';
  pico = directivity(ura, f, [az0; el0], 'Weights', w, 'PropagationSpeed', c);
  out.casos(end + 1) = struct('nombre', nombre, 'taper', taper, 'sll', sll, 'nbar', nbar, ...
    'az', az0, 'el', el0, 'corte', corte, 'ang', ang, 'dbi', round(d, 4), 'pico', pico);
  fprintf('%-24s peak %.2f dBi\n', nombre, pico);
end

write_json(fullfile(web_validation_dir(), 'ref_antena.json'), out);
