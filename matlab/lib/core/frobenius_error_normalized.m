function epsFrob = frobenius_error_normalized(F_opt, F_RF, F_BB)
%FROBENIUS_ERROR_NORMALIZED Normalized hybrid decomposition error.
%
%   epsFrob = frobenius_error_normalized(F_opt, F_RF, F_BB)
%
%   Computes
%       epsFrob = ||F_opt - F_RF * F_BB||_F  /  ||F_opt||_F
%
%   Inputs:
%     F_opt : [Nt x Ns] optimal precoder (reference).
%     F_RF  : [Nt x Nrf] RF precoder (constant modulus, or zero by mask).
%     F_BB  : [Nrf x Ns] baseband precoder.
%
%   Output:
%     epsFrob : real scalar >= 0. = 0 if the decomposition is exact.

E = F_opt - F_RF * F_BB;
denom = norm(F_opt, 'fro');
if denom < eps
    epsFrob = norm(E, 'fro');
else
    epsFrob = norm(E, 'fro') / denom;
end
end
