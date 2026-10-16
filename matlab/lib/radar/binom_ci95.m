function [p, lo, hi] = binom_ci95(k, n)
%BINOM_CI95 Proportion and its 95 % confidence interval (Wilson).
%   [p, lo, hi] = binom_ci95(k, n): k successes in n trials (scalars or arrays).
z = 1.959963984540054;
p = k ./ n;
den = 1 + z^2 ./ n;
c = (p + z^2 ./ (2 * n)) ./ den;
h = z * sqrt(p .* (1 - p) ./ n + z^2 ./ (4 * n.^2)) ./ den;
lo = max(0, c - h); hi = min(1, c + h);
end
