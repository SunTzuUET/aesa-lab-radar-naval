function H = saleh_valenzuela(Nt, Nr, params)
%SALEH_VALENZUELA Clustered mmWave channel (Saleh-Valenzuela model).
%
%   H = saleh_valenzuela(Nt, Nr, params)
%
%   Model:
%     H = sqrt(Nt*Nr/(L*Nray)) * sum_l sum_n alpha_{l,n} *
%         a_R(theta_R, phi_R) * a_T(theta_T, phi_T)^H
%
%   with alpha i.i.d. complex CN(0,1).
%
%   params.NxT, params.NyT, params.NxR, params.NyR : TX/RX URA geometries
%   params.spacingLambda                            : [dx dy] in lambda
%   params.fc                                       : frequency (Hz)
%   params.L          : number of clusters (default 4)
%   params.Nray       : rays per cluster (default 1)
%   params.sigmaAngle : intra-cluster angular spread (deg, default 5)
%   params.thetaRange : [min max] uniform range for AoD/AoA theta (default [-60 60])
%   params.phiRange   : same for phi (default [-180 180])

if nargin < 3; params = struct(); end
NxT = local_get(params, 'NxT', round(sqrt(Nt)));
NyT = local_get(params, 'NyT', Nt / NxT);
NxR = local_get(params, 'NxR', round(sqrt(Nr)));
NyR = local_get(params, 'NyR', Nr / NxR);
spacingLambda = local_get(params, 'spacingLambda', [0.5 0.5]);
fc            = local_get(params, 'fc', 28e9);
L             = local_get(params, 'L', 4);
Nray          = local_get(params, 'Nray', 1);
sigmaAngle    = local_get(params, 'sigmaAngle', 5);
thetaRange    = local_get(params, 'thetaRange', [-60 60]);
phiRange      = local_get(params, 'phiRange',   [-180 180]);

H = zeros(Nr, Nt);
for l = 1:L
    thetaT_c = thetaRange(1) + (thetaRange(2)-thetaRange(1))*rand;
    phiT_c   = phiRange(1)   + (phiRange(2)  -phiRange(1))*rand;
    thetaR_c = thetaRange(1) + (thetaRange(2)-thetaRange(1))*rand;
    phiR_c   = phiRange(1)   + (phiRange(2)  -phiRange(1))*rand;
    for n = 1:Nray
        thT = thetaT_c + sigmaAngle * randn;
        phT = phiT_c   + sigmaAngle * randn;
        thR = thetaR_c + sigmaAngle * randn;
        phR = phiR_c   + sigmaAngle * randn;
        thT = max(min(thT,  90), -90);
        thR = max(min(thR,  90), -90);
        alpha = (randn + 1j*randn)/sqrt(2);
        aT = steering_vector(NxT, NyT, spacingLambda, fc, thT, phT);
        aR = steering_vector(NxR, NyR, spacingLambda, fc, thR, phR);
        H = H + alpha * (aR * aT');
    end
end
H = sqrt(Nt*Nr/(L*Nray)) * H / sqrt(Nt*Nr);
end

function v = local_get(s, name, def)
if isstruct(s) && isfield(s,name) && ~isempty(s.(name)); v = s.(name); else; v = def; end
end
