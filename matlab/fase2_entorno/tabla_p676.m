%TABLA_P676 Gaseous specific-attenuation table (ITU-R P.676, gaspl) for the web.
%
%   Generates web/src/engine/p676_table.json with γ_O2 (dry air, ρ = 0) and γ_H2O (remainder)
%   in dB/km over an f × T × ρ × P grid. The web interpolates linearly.
%   Replaces the P.676 Annex 2 approximation, which under warm, humid air
%   underestimated gaspl by up to 22 %.

clear; startup_if_needed();
f = (2.5:0.25:4.5) * 1e9;          % Hz
T = -10:5:40;                      % °C
rho = 0:2.5:30;                    % g/m³
P = [950 1000 1013.25 1050];       % hPa
o2 = zeros(numel(f), numel(T), numel(P));
h2o = zeros(numel(f), numel(T), numel(rho), numel(P));
for a = 1:numel(f)
  for b = 1:numel(T)
    for d = 1:numel(P)
      dry = gaspl(1000, f(a), T(b), P(d) * 100, 0);
      o2(a, b, d) = dry;
      for c = 1:numel(rho)
        h2o(a, b, c, d) = gaspl(1000, f(a), T(b), P(d) * 100, rho(c)) - dry;
      end
    end
  end
end
out.fGHz = f / 1e9; out.T = T; out.rho = rho; out.P = P;
% flattening order: index = ((a*nT + b)*nP + d) for o2 and (((a*nT + b)*nR + c)*nP + d) for h2o
out.o2 = round(reshape(permute(o2, [3 2 1]), 1, []), 7);
out.h2o = round(reshape(permute(h2o, [4 3 2 1]), 1, []), 7);
here = fileparts(mfilename('fullpath'));
write_json(fullfile(here, '..', '..', 'web', 'src', 'engine', 'p676_table.json'), out);
