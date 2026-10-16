function M = perfil_m(tipo, z, par)
%PERFIL_M Modified refractivity profile M(z) (M units) over the sea.
%
%   M = perfil_m('estandar', z)            standard atmosphere: dM/dz = 0.118 M/m (k = 4/3)
%   M = perfil_m('evaporacion', z, delta)  Paulus-Jeske evaporation duct:
%       M(z) = M0 + 0.125·[z − δ·ln((z + z0)/z0)],  z0 = 1.5·10⁻⁴ m
%   The minimum of M is at z = δ (duct height). M0 = 330 (only sets a reference).
%   M = perfil_m('trilineal', z, [zb, t, dM])  (trapping) inversion layer with base zb and thickness t
%       in which M drops by dM units; standard below and above. If M at the top of the layer
%       is below M at the surface, the duct reaches the sea (surface-based duct).

M0 = 330;
switch tipo
  case 'estandar'
    M = M0 + 0.118 * z;
  case 'evaporacion'
    z0 = 1.5e-4;
    M = M0 + 0.125 * (z - par * log((z + z0) / z0));
  case 'trilineal'
    zb = par(1); t = par(2); dM = par(3); g = 0.118;
    M = M0 + g * z;
    in = z > zb & z <= zb + t; M(in) = M0 + g * zb - dM * (z(in) - zb) / t;
    up = z > zb + t; M(up) = M0 + g * zb - dM + g * (z(up) - zb - t);
  otherwise
    error('perfil_m:tipo', 'Unknown profile: %s', tipo);
end
end
