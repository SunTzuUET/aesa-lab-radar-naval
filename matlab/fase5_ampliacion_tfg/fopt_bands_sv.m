% Verbatim copy of 02_codigo/04_multibanda_codiseno/code/fopt_bands_sv.m (TFG) to reuse its channels.
function Fopt = fopt_bands_sv(p)
%FOPT_BANDS_SV F_opt_b at the center of each band with shared angular
%   geometry (angles drawn once; alpha and tau redrawn per band).
%   Wideband Saleh-Valenzuela channel. The caller sets rng BEFORE calling.
%
%   Fopt = fopt_bands_sv(p)
%
%   p struct with: NxT,NyT,NxR,NyR,Nr,Ns,thetaT,phiT,fc_ref,fcList,
%   Ncl,Nray,angSpreadDeg,tauMax,clusterDecay.
%
%   Shared by exp_final_fig2_frobenius and exp_final_fig_convergencia to
%   guarantee an IDENTICAL channel (same seeds -> same realizations), so
%   that the N_RF=8 point of the convergence plot reproduces the N_RF=8 row of Fig 2.
Ncl = p.Ncl;  Nray = p.Nray;  ang = p.angSpreadDeg;
nPath = Ncl*Nray;  Pcl = exp(-p.clusterDecay*(0:Ncl-1));
thT=nan(1,nPath); phT=nan(1,nPath); thR=nan(1,nPath); phR=nan(1,nPath);
idx = 0;
for ic = 1:Ncl
    if ic == 1
        tc = p.thetaT;  pc = p.phiT;            % dominant LOS cluster at theta_T
    else
        tc = -90+180*rand;  pc = -180+360*rand;
    end
    tcR = -90+180*rand;  pcR = -180+360*rand;
    for il = 1:Nray
        idx = idx + 1;
        if ic == 1
            thT(idx) = tc;  phT(idx) = pc;      % coincident at TX (rank 1)
        else
            thT(idx) = local_clamp(tc + local_lap(ang), -90, 90);
            phT(idx) = pc + local_lap(ang);
        end
        thR(idx) = local_clamp(tcR + local_lap(ang), -90, 90);
        phR(idx) = pcR + local_lap(ang);
    end
end
gamma = sqrt(1/(p.Nr*Nray*sum(Pcl)));           % E[||H||_F^2] = Nt
B = numel(p.fcList);  Fopt = cell(1, B);
for b = 1:B
    fc_b = p.fcList(b);
    sp_b = [0.5 0.5] * (fc_b/p.fc_ref);         % d/lambda scales with fc
    alpha = nan(1,nPath);  tau = nan(1,nPath);
    for ic = 1:Ncl
        ii = (ic-1)*Nray + (1:Nray);
        alpha(ii) = sqrt(Pcl(ic)) .* (randn(1,Nray)+1j*randn(1,Nray))/sqrt(2);
        tau(ii)   = p.tauMax * rand(1,Nray);
    end
    AT = steering_vector(p.NxT,p.NyT,sp_b,fc_b, thT,phT, fc_b);   % [Nt x nPath]
    AR = steering_vector(p.NxR,p.NyR,sp_b,fc_b, thR,phR, fc_b);   % [Nr x nPath]
    coef = alpha .* exp(-1j*2*pi*fc_b*tau);
    H = gamma * ((AR .* coef) * AT');
    [~,~,V] = svd(H);
    Fopt{b} = V(:,1:p.Ns);
end
end

% =========================================================================
function x = local_lap(b)
u = rand - 0.5;
x = -b * sign(u) * log(1 - 2*abs(u));
end

function y = local_clamp(x, lo, hi)
y = max(min(x, hi), lo);
end
