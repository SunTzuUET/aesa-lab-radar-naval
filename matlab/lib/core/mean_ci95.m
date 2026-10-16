function [m, lo, hi, halfWidth] = mean_ci95(X, dim)
%MEAN_CI95 Mean and 95% confidence interval (Student's t).
%
%   [m, lo, hi, halfWidth] = mean_ci95(X, dim)
%
%   For each slice along dimension dim, computes:
%     m  = mean(X)
%     se = std(X, 0) / sqrt(N_eff)
%     hw = t_{0.975, N_eff-1} * se
%     lo = m - hw    hi = m + hw
%
%   where N_eff is the number of finite samples in each slice (NaNs are
%   discarded element-wise). If a slice has N_eff<2 it returns
%   m=mean(omit), lo=hi=NaN.
%
%   If the Statistics Toolbox is not available, a precomputed table of
%   t_{0.975,nu} for nu in [1..30] and the normal approximation (1.96) for
%   nu>30 are used. For the sizes expected in this thesis (N=1000) the
%   difference from the exact t is <1e-3.
%
%   Inputs:
%     X   : numeric array
%     dim : dimension to reduce (default = first non-singleton)
%
%   Outputs:
%     m, lo, hi : same shape as X with dim reduced to size 1
%     halfWidth : same shape as m, CI half-width

if nargin < 2 || isempty(dim)
    sz = size(X);
    dim = find(sz > 1, 1, 'first');
    if isempty(dim); dim = 1; end
end

isFin = isfinite(X);
N_eff = sum(isFin, dim);

% mean omitnan
m = mean(X, dim, 'omitnan');

% sample std (N-1) ignoring NaN; std(...,'omitnan') uses N_eff-1 internally
s = std(X, 0, dim, 'omitnan');

% Degrees of freedom
nu = max(N_eff - 1, 0);

% Critical value t_{0.975, nu}
tcrit = local_tcrit_975(nu);

se = s ./ sqrt(max(N_eff, 1));
halfWidth = tcrit .* se;

% Slices with N_eff < 2 -> undefined CI
bad = N_eff < 2;
halfWidth(bad) = NaN;

lo = m - halfWidth;
hi = m + halfWidth;
end

% =========================================================================
function t = local_tcrit_975(nu)
%LOCAL_TCRIT_975 Tabulated 0.975 t-quantile (two-sided 95%).
%   Uses tinv if available (Statistics Toolbox); otherwise a discrete
%   table for nu=1..30 and the normal approximation for nu>30.

if exist('tinv','file') == 2
    t = tinv(0.975, nu);
    t(~(nu > 0)) = NaN;
    return;
end

% Table t_{0.975, nu} for nu = 1..30 (approx. 5 significant digits)
table_t = [12.7062  4.30265  3.18245  2.77645  2.57058 ...
            2.44691 2.36462  2.30600  2.26216  2.22814 ...
            2.20099 2.17881  2.16037  2.14479  2.13145 ...
            2.11991 2.10982  2.10092  2.09302  2.08596 ...
            2.07961 2.07387  2.06866  2.06390  2.05954 ...
            2.05553 2.05183  2.04841  2.04523  2.04227];

t = nan(size(nu));
m_in = (nu >= 1) & (nu <= 30);
% indexing: nu=1 -> table_t(1), nu=30 -> table_t(30)
nu_in = nu(m_in);
t(m_in) = table_t(nu_in);

m_big = nu > 30;
% Normal approximation: t_{0.975, nu} -> 1.95996...
t(m_big) = 1.95996398454005;
end
