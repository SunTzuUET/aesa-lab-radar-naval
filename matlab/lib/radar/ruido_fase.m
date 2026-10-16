function [L, tab] = ruido_fase(f, osc)
%RUIDO_FASE Single-sideband phase noise L(f) of the oscillator (linear, 1/Hz).
%
%   [L, tab] = ruido_fase(f, osc)
%     f    offsets from the carrier (Hz); |f| is used
%     osc  'bueno', 'tipico', 'pobre' or an N×2 table [f (Hz), L (dBc/Hz)]
%   Linear interpolation in log-log between table points; below the first one
%   the slope is −30 dB/decade (flicker frequency noise) and above the
%   last one L is flat (white noise floor). For small phase noise, the two-sided
%   spectral density of the phase φ(t) is S_φ(f) = L(|f|).
%
%   Tables: S-band reference oscillator in three quality grades (orders of magnitude of
%   commercial synthesizers; assumed values, not a specific unit).

if ischar(osc) || isstring(osc)
  switch lower(char(osc))
    case 'bueno',  tab = [100 -100; 1e3 -125; 1e4 -140; 1e5 -150; 1e6 -160];
    case 'tipico', tab = [100  -85; 1e3 -110; 1e4 -125; 1e5 -135; 1e6 -145];
    case 'pobre',  tab = [100  -70; 1e3  -90; 1e4 -105; 1e5 -120; 1e6 -130];
    otherwise, error('ruido_fase:osc', 'unknown oscillator: %s', osc);
  end
else
  tab = osc;
end
x = log10(max(abs(f), 1e-3));
lf = log10(tab(:, 1)); ld = tab(:, 2);
y = interp1(lf, ld, min(max(x, lf(1)), lf(end)));
y(x < lf(1)) = ld(1) - 30 * (x(x < lf(1)) - lf(1));
L = 10.^(y / 10);
end
