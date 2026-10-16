function Z = matriz_z_dipolos(x, y, f, L, a, hGnd)
%MATRIZ_Z_DIPOLOS Impedance matrix (N×N) of an array of parallel dipoles (x axis) over ground.
%
%   Z = matriz_z_dipolos(x, y, f, L, a, hGnd)
%
%   x, y: center positions (m), N×1 vectors. f: frequency (Hz). L: length (m),
%   a: equivalent radius (m), hGnd: height above the infinite ground plane (m; Inf = free space).
%   Ground plane via images (opposite current at −h): Z(Δ) = Z_fs(Δx, Δy) − Z_fs(Δx, √(Δy² + 4h²)).

c = 299792458;  k = 2*pi*f/c;
x = x(:);  y = y(:);  N = numel(x);
DX = x.' - x;  DY = abs(y.' - y);
rho = DY;  rho(1:N+1:end) = a;                  % self term: equivalent radius
Z = z_mutua_dipolos(k, L, DX, rho);
if isfinite(hGnd)
    Z = Z - z_mutua_dipolos(k, L, DX, hypot(DY, 2*hGnd));
end
end
