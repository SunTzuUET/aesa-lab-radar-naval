function e = monopulso_invertir(dRef, rRef, r)
%MONOPULSO_INVERTIR Angle estimate from the ratio, using the ideal calibration curve.
%
%   e = monopulso_invertir(dRef, rRef, r)
%   dRef, rRef: calibration curve (offset in degrees, ratio). The monotonically
%   increasing segment around 0 is used; outside it the estimator saturates at its ends.

dRef = dRef(:); rRef = rRef(:);
[~, i0] = min(abs(dRef));
a = i0; while a > 1 && rRef(a - 1) < rRef(a), a = a - 1; end
b = i0; while b < numel(rRef) && rRef(b + 1) > rRef(b), b = b + 1; end
rr = rRef(a:b); dd = dRef(a:b);
e = interp1(rr, dd, min(max(r, rr(1)), rr(end)));
end
