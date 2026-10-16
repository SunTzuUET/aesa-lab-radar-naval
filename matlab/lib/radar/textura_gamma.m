function g = textura_gamma(nu, n)
%TEXTURA_GAMMA Gamma(ν, 1/ν) samples (unit mean) without the Statistics Toolbox.
%
%   g = textura_gamma(nu, n)   n×1, Marsaglia-Tsang method (2000); for ν < 1 uses
%   G(ν) = G(ν+1)·U^{1/ν}. This is the texture of the compound-Gaussian model (K distribution).

if isinf(nu), g = ones(n, 1); return; end
a = nu; boost = a < 1;
if boost, a = a + 1; end
d = a - 1 / 3; c = 1 / sqrt(9 * d);
g = zeros(n, 1); todo = true(n, 1);
while any(todo)
  m = nnz(todo);
  x = randn(m, 1); v = (1 + c * x).^3;
  u = rand(m, 1);
  ok = v > 0 & log(u) < 0.5 * x.^2 + d - d * v + d * log(max(v, eps));
  idx = find(todo);
  g(idx(ok)) = d * v(ok);
  todo(idx(ok)) = false;
end
if boost, g = g .* rand(n, 1).^(1 / nu); end
g = g / nu;                                   % 1/ν scale: unit mean
end
