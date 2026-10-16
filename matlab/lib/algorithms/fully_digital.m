function w = fully_digital(Nx, Ny, spacingLambda, fc, thetaDeg, phiDeg, varargin) %#ok<INUSD>
%FULLY_DIGITAL Precoder fully digital (MRT).
%   w = a(theta, phi) / sqrt(Nt)  with ||w|| = 1.
a = steering_vector(Nx, Ny, spacingLambda, fc, thetaDeg, phiDeg);
w = a / norm(a);
end
