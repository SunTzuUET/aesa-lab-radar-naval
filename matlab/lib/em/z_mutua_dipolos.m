function Z = z_mutua_dipolos(k, L, dx, rho)
%Z_MUTUA_DIPOLOS Mutual impedance (Ω) between parallel dipoles (x axis) by the induced EMF method.
%
%   Z = z_mutua_dipolos(k, L, dx, rho)
%
%   Sinusoidal current I(x) = sin(k(L/2 − |x|)), referred to the input current.
%   dx: offset along the axis; rho: transverse separation (radius for the self term).
%   dx and rho may be matrices of the same size. Same formulation as
%   web/src/engine/coupling.ts:mutualZ (Balanis, ch. 8):
%     E_x1 = −j·η/(4π)·[e^{−jkR1}/R1 + e^{−jkR2}/R2 − 2cos(kL/2)·e^{−jkR0}/R0]
%     Z21  = −(1/I(0)²)·∫ E_x1·I2 dx

persistent gx gw
if isempty(gx)
    n = 32;                                     % Gauss-Legendre (Golub-Welsch)
    b = (1:n-1) ./ sqrt(4*(1:n-1).^2 - 1);
    [V, D] = eig(diag(b, 1) + diag(b, -1));
    [gx, ix] = sort(diag(D));  gw = 2 * V(1, ix).'.^2;
end
eta = 376.730313668;
h = L / 2;  c = cos(k * h);
sz = size(dx);  dx = dx(:);  rho = rho(:);
Z = zeros(numel(dx), 1);
for side = [-1 1]
    t  = side * h * (gx.' + 1) / 2;             % [1 x 32] position along dipole 2
    wq = gw.' * h / 2;
    s  = dx + t;                                % [M x 32]
    R1 = hypot(rho, s - h);  R2 = hypot(rho, s + h);  R0 = hypot(rho, s);
    E  = -1j * eta / (4*pi) * (exp(-1j*k*R1)./R1 + exp(-1j*k*R2)./R2 - 2*c*exp(-1j*k*R0)./R0);
    I2 = sin(k * (h - abs(t)));
    Z  = Z - (E .* I2) * wq.';
end
Z = reshape(Z / sin(k * h)^2, sz);
end
