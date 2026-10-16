function out = acoplamiento_tfg(opts)
%ACOPLAMIENTO_TFG Mutual coupling in the TFG multiband array (28/40/57 GHz).
%
%   out = acoplamiento_tfg(opts)
%
%   Answers the examining committee's objection "in a real environment the electromagnetic effects of
%   multiband operation would swamp everything". Takes the scenario of the TFG final experiment (8×8 TX URA
%   anchored at 57 GHz, d = λ57/2, bands 28/40/57 GHz, θ_T = 40°, N_s = 4, Saleh-Valenzuela channel)
%   and adds mutual coupling using the web's model (induced EMF, dipoles over ground).
%
%   Element [assumed]: dipole with L = 0.45·λ57 (fits in the λ57/2 cell), radius λ57/400, at
%   h = λ40/4 above an infinite ground plane. Wideband by assumption: each band has its own
%   matching network (per-band diplexer), with Z_s = Z_ref* and Z_ref the mean active Z of the array
%   under uniform broadside excitation in that band.
%
%   Exact matrix model (64 elements): currents I = (Z + Z_s·Id)⁻¹·(Z_ref + Z_s)·w = C_b·w.
%   Without coupling (TFG model) C_b = Id.
%   Realized gain (referred to available power):
%     G(θ,φ) = D_elem(θ,φ)·(R11/R_ref)·|a(θ,φ)ᴴ·I|² / ‖w‖²
%   (R11: self resistance of the isolated element with its image; consistent with Hannan).
%
%   Part A (beam physics, per band): active |Γ| vs. scan, gain at θ_T vs. the
%   ideal model and the aperture limit 4πA·cos θ/λ², pattern cuts.
%   Part B (the TFG bound): Frobenius error of the shared TTD co-design vs. N_RF in
%   three cases: ideal (the TFG), coupling ignored in the design, and coupling compensated in the
%   design (target C_b⁻¹·F_opt,b per band; the per-band digital stage absorbs the coupling).
%
%   opts.nReal (20), opts.nRestarts (8), opts.makeFigure (true), opts.tag ('').
%   Outputs in matlab/results/ampliacion_tfg/ (JSON for the video and the web, CSV and PNG).

if nargin < 1; opts = struct(); end
nReal      = local_get(opts, 'nReal', 20);
nRestarts  = local_get(opts, 'nRestarts', 8);
makeFigure = local_get(opts, 'makeFigure', true);
tag        = local_get(opts, 'tag', '');
startup_if_needed();

% ===================== TFG SCENARIO ======================================
c = 3e8;                                       % same c as the TFG (steering_vector)
NxT = 8; NyT = 8; Nt = NxT*NyT; NxR = 4; NyR = 4; Nr = NxR*NyR; Ns = 4;
thetaT = 40; phiT = 0;
fc_ref = 57e9; fcList = [28 40 57]*1e9; B = numel(fcList);
d = 0.5 * c / fc_ref;
[IX, IY] = meshgrid(0:NxT-1, 0:NyT-1);  x = IX(:)*d;  y = IY(:)*d;   % steering_vector ordering
chBase = struct('NxT',NxT,'NyT',NyT,'NxR',NxR,'NyR',NyR,'Nr',Nr,'Ns',Ns, ...
    'thetaT',thetaT,'phiT',phiT,'fc_ref',fc_ref,'fcList',fcList, ...
    'Ncl',5,'Nray',10,'angSpreadDeg',7.5,'tauMax',100e-9,'clusterDecay',0.7);

% Element [assumed]
lam57 = c/fc_ref;  lam40 = c/40e9;
L = 0.45*lam57;  a = lam57/400;  hGnd = lam40/4;

% ===================== PART A: BEAM PHYSICS ==============================
scanDeg = 0:2:70;
cutDeg = -90:0.25:90;
bandas = struct([]);
C = cell(1, B);
for b = 1:B
    f = fcList(b);  k = 2*pi*f/c;  lam = c/f;
    Z = matriz_z_dipolos(x, y, f, L, a, hGnd);
    Zact0 = sum(Z, 2);                          % active Z at broadside, uniform excitation
    Zref = mean(Zact0);  Zs = conj(Zref);
    C{b} = (Z + Zs*eye(Nt)) \ ((Zref + Zs)*eye(Nt));
    R11 = real(Z(1,1));
    Delem = @(th, ph) elem_directividad(th, ph, k, L, hGnd);
    ganancia = @(I, w, th, ph) Delem(th, ph) .* (R11/real(Zref)) .* ...
        abs(sv(x, y, k, th, ph)' * I).^2 / norm(w)^2;
    ganIdeal = @(w, th, ph) Delem(th, ph) .* abs(sv(x, y, k, th, ph)' * w).^2 / norm(w)^2;

    % active |Γ| vs. scan (E plane: φ=0 and H plane: φ=90), uniform beam
    ic = sub2ind([NyT NxT], 4, 4);              % interior element (ix=iy=3)
    gE = nan(numel(scanDeg), 2);  gH = gE;  Gscan = nan(numel(scanDeg), 3);
    for is = 1:numel(scanDeg)
        for p = 1:2
            ph = (p-1)*90;
            w = sv(x, y, k, scanDeg(is), ph) / sqrt(Nt);
            Za = (Z*w) ./ w;
            G = abs((Za - Zref) ./ (Za + Zs));
            if p == 1; gE(is,:) = [G(ic) max(G)]; else; gH(is,:) = [G(ic) max(G)]; end
            if p == 1
                Gscan(is,:) = [ganIdeal(w, scanDeg(is), 0), ganancia(C{b}*w, w, scanDeg(is), 0), ...
                    4*pi*(NxT*d)*(NyT*d)*cosd(scanDeg(is))/lam^2];
            end
        end
    end
    % pattern cuts (φ = 0) with the beam at θ_T
    w = sv(x, y, k, thetaT, phiT) / sqrt(Nt);
    I = C{b}*w;
    th = cutDeg(:).';
    cutIdeal = 10*log10(max(ganIdeal(w, abs(th), 180*(th<0)), 1e-12));
    cutAcop  = 10*log10(max(ganancia(I, w, abs(th), 180*(th<0)), 1e-12));
    iT = find(scanDeg == thetaT);
    bandas(b).fGHz = f/1e9;  bandas(b).dLambda = d/lam;
    bandas(b).Z11 = [real(Z(1,1)) imag(Z(1,1))];  bandas(b).Zref = [real(Zref) imag(Zref)];
    bandas(b).gammaE_centro = gE(:,1).';  bandas(b).gammaE_max = gE(:,2).';
    bandas(b).gammaH_centro = gH(:,1).';  bandas(b).gammaH_max = gH(:,2).';
    bandas(b).GidealDb = 10*log10(Gscan(:,1)).';  bandas(b).GacopDb = 10*log10(Gscan(:,2)).';
    bandas(b).GaperturaDb = 10*log10(Gscan(:,3)).';
    bandas(b).GT = struct('ideal', 10*log10(Gscan(iT,1)), 'acoplado', 10*log10(Gscan(iT,2)), ...
        'apertura', 10*log10(Gscan(iT,3)), 'isotropoTFG', 10*log10(Nt));
    bandas(b).cutIdealDb = cutIdeal;  bandas(b).cutAcopDb = cutAcop;
    bandas(b).condC = cond(C{b});
    fprintf('[A] %2.0f GHz  d=%.3fλ  Z11=%5.1f%+6.1fj  Zref=%5.1f%+6.1fj  |Γ|(40°,E) center=%.2f max=%.2f  G(40°): ideal %.1f · coupled %.1f · aperture %.1f dBi  cond(C)=%.1f\n', ...
        f/1e9, d/lam, bandas(b).Z11, bandas(b).Zref, gE(iT,1), gE(iT,2), ...
        bandas(b).GT.ideal, bandas(b).GT.acoplado, bandas(b).GT.apertura, bandas(b).condC);
end

% ===================== PART B: THE BOUND N_RF ≥ B·N_s ====================
nrfList = [4 6 8 12 16];
casos = {'ideal (TFG)', 'acoplamiento ignorado', 'acoplamiento compensado'};
amOpts = struct('maxIter',800,'tol',1e-7,'initMethod','cold','nRestarts',nRestarts,'quantBits',0);
% shared TTD layer of the TFG (one delay per x column)
ixAnt = floor(((1:Nt)-1)/NyT)';
tau = (ixAnt*d*sind(thetaT)*cosd(phiT))/c;
D = exp(1j*2*pi*(tau*fcList));                  % [Nt x B]
err = nan(nReal, numel(nrfList), 3);  pot = nan(nReal, numel(nrfList));
t0 = tic;
for rr = 1:nReal
    rng(run_id_to_seed(sprintf('fig2_ch_%d', rr)), 'twister');   % same channels as the TFG
    Fopt = fopt_bands_sv(chBase);
    den = 0;  tgtI = cell(1,B);  tgtC = cell(1,B);
    for b = 1:B
        den = den + norm(Fopt{b},'fro')^2;
        tgtI{b} = conj(D(:,b)) .* Fopt{b};
        tgtC{b} = conj(D(:,b)) .* (C{b} \ Fopt{b});
    end
    for in = 1:numel(nrfList)
        amo = amOpts;  amo.seed = run_id_to_seed(sprintf('fig2_am_%d_%d', rr, nrfList(in)));
        [Frf, Fbb] = hybrid_am_decomposition_multiband(tgtI, nrfList(in), 'fully_connected', amo);
        e1 = 0; e2 = 0;
        for b = 1:B
            P = D(:,b) .* (Frf*Fbb{b});
            e1 = e1 + norm(Fopt{b} - P,'fro')^2;
            e2 = e2 + err_escala(Fopt{b}, C{b}*P);
        end
        [Frf, Fbb] = hybrid_am_decomposition_multiband(tgtC, nrfList(in), 'fully_connected', amo);
        e3 = 0; pw = 0;
        for b = 1:B
            P = D(:,b) .* (Frf*Fbb{b});
            e3 = e3 + err_escala(Fopt{b}, C{b}*P);  pw = pw + norm(P,'fro')^2;
        end
        err(rr,in,:) = [e1 e2 e3]/den;  pot(rr,in) = pw/den;
    end
    fprintf('  real %d/%d (%.0f s)\n', rr, nReal, toc(t0));
end
errMean = squeeze(mean(err, 1));
potDb = 10*log10(mean(pot, 1));
fprintf('\n[B] mean ε² (with TTD, continuous phase shifter)\n   N_RF |   ideal   ignored  compensated | compensated power (dB)\n');
for in = 1:numel(nrfList)
    fprintf('   %4d | %7.4f  %8.4f  %10.4f | %+.2f\n', nrfList(in), errMean(in,:), potDb(in));
end

% ===================== OUTPUT ===========================================
root = fileparts(fileparts(mfilename('fullpath')));
outDir = fullfile(root, 'results', 'ampliacion_tfg');
if ~exist(outDir, 'dir'); mkdir(outDir); end
sfx = '';  if ~isempty(tag); sfx = ['_' tag]; end
out = struct();
out.meta = struct('generado', char(datetime('now','Format','yyyy-MM-dd HH:mm')), 'matlab', version, ...
    'escenario', 'TFG exp. final: URA 8x8, d = lambda57/2, fc = 28/40/57 GHz, thetaT = 40, Ns = 4', ...
    'elemento', sprintf('dipolo L = 0.45 lambda57, a = lambda57/400, h = lambda40/4 sobre masa'), ...
    'nReal', nReal, 'nRestarts', nRestarts);
out.scanDeg = scanDeg;  out.cutDeg = cutDeg;  out.bandas = bandas;
out.nrfList = nrfList;  out.casos = casos;  out.errMean = errMean;  out.potDb = potDb;
write_json(fullfile(outDir, ['acoplamiento_tfg' sfx '.json']), out);
T = array2table([nrfList(:) errMean potDb(:)], 'VariableNames', {'N_RF','ideal','ignorado','compensado','potencia_dB'});
writetable(T, fullfile(outDir, ['cota_acoplamiento' sfx '.csv']));
if makeFigure; local_figuras(out, outDir, sfx); end
fprintf('[acoplamiento_tfg] done in %s\n', outDir);
end

% =========================================================================
function e = err_escala(F, M)
%ERR_ESCALA ‖F − α·M‖² with the optimal complex scalar per band: coupling is not penalized
%   for a global amplitude or phase change (that is gain, already measured in Part A), only for
%   distortion of the precoder's shape.
alpha = (M(:)'*F(:)) / (M(:)'*M(:));
e = norm(F - alpha*M, 'fro')^2;
end

function a = sv(x, y, k, thDeg, phDeg)
%SV Array response [N x K] at (θ, φ): exp(+j k (x ux + y uy)), TFG convention.
th = deg2rad(thDeg(:).');  ph = deg2rad(phDeg(:).');
a = exp(1j*k*(x*(sin(th).*cos(ph)) + y*(sin(th).*sin(ph))));
end

function D = elem_directividad(thDeg, phDeg, k, L, hGnd)
%ELEM_DIRECTIVIDAD Directivity of the dipole (x axis) at h above ground, in the upper half-space.
persistent cache
key = sprintf('%.6g_%.6g_%.6g', k, L, hGnd);
if isempty(cache) || ~isfield(cache, 'key') || ~strcmp(cache.key, key)
    [tt, pp] = meshgrid(linspace(0, pi/2, 721), linspace(0, 2*pi, 1441));
    P = patron(tt, pp, k, L, hGnd);
    integ = trapz(pp(:,1), trapz(tt(1,:), P.*sin(tt), 2));
    cache = struct('key', key, 'norm', 4*pi/integ);
end
D = cache.norm * patron(deg2rad(thDeg), deg2rad(phDeg), k, L, hGnd);
end

function P = patron(th, ph, k, L, hGnd)
ux = sin(th).*cos(ph);
kl = k*L/2;
Fd = (cos(kl*ux) - cos(kl)) ./ sqrt(max(1 - ux.^2, 1e-12));
Fg = sin(k*hGnd*cos(th));
P = (Fd.*Fg).^2;
end

function local_figuras(out, outDir, sfx)
col = [0.15 0.35 0.75; 0.85 0.45 0.1; 0.2 0.6 0.3];
f1 = figure('Visible','off','Position',[100 100 1100 380]);
tiledlayout(1, 3, 'TileSpacing','compact');
nexttile; hold on; grid on;
for b = 1:numel(out.bandas)
    plot(out.scanDeg, out.bandas(b).gammaE_centro, '-', 'Color', col(b,:), 'LineWidth', 1.6);
    plot(out.scanDeg, out.bandas(b).gammaH_centro, '--', 'Color', col(b,:), 'LineWidth', 1.2);
end
xlabel('scan \theta (°)'); ylabel('active |\Gamma| (interior element)'); title('Mismatch (— E, -- H)');
legend(arrayfun(@(b) sprintf('%g GHz', b.fGHz), out.bandas, 'UniformOutput', false), 'Location','northwest');
nexttile; hold on; grid on;
for b = 1:numel(out.bandas)
    plot(out.scanDeg, out.bandas(b).GidealDb, ':', 'Color', col(b,:), 'LineWidth', 1.2);
    plot(out.scanDeg, out.bandas(b).GacopDb, '-', 'Color', col(b,:), 'LineWidth', 1.6);
    plot(out.scanDeg, out.bandas(b).GaperturaDb, '-.', 'Color', [col(b,:) 0.5], 'LineWidth', 1);
end
xlabel('scan \theta (°)'); ylabel('gain (dBi)'); title('Ideal (···), coupled (—), aperture (-·)');
nexttile; hold on; grid on;
plot(out.nrfList, out.errMean(:,1), '-o', 'LineWidth', 1.6);
plot(out.nrfList, out.errMean(:,2), '-s', 'LineWidth', 1.6);
plot(out.nrfList, out.errMean(:,3), '-^', 'LineWidth', 1.6);
xline(12, 'k:', 'B·N_s'); set(gca, 'YScale', 'log');
xlabel('N_{RF}'); ylabel('mean \epsilon^2'); title('TFG bound with coupling'); legend(out.casos, 'Location','southwest');
exportgraphics(f1, fullfile(outDir, ['acoplamiento_tfg' sfx '.png']), 'Resolution', 150);
close(f1);
end

function v = local_get(s, name, def)
if isstruct(s) && isfield(s,name) && ~isempty(s.(name)); v = s.(name); else; v = def; end
end
