function [F_RF, F_BB, info] = hybrid_am_decomposition_multiband( ...
        F_opt_cell, Nrf, architecture, opts)
%HYBRID_AM_DECOMPOSITION_MULTIBAND PE-AltMin with F_RF shared across bands.
%
%   Approximately solves
%       min_{F_RF, F_BB_b}  sum_b ||F_opt_b - F_RF * F_BB_b||_F^2
%   with a single constant-modulus F_RF 1/sqrt(Nt) (in sub-connected also
%   with block-diagonal support per the mask) and a distinct F_BB_b per band.
%
%   Inputs:
%     F_opt_cell    : cell {1 x B}, F_opt_cell{b} = [Nt x Ns_b] target
%                     digital precoder of band b. All bands must
%                     have the same Nt. Ns may vary per band (rare).
%     Nrf           : number of RF chains (Nrf >= max_b Ns_b).
%     architecture  : 'FC' / 'fully_connected' or 'SC' / 'sub_connected'.
%     opts          : struct with optional fields:
%       .maxIter, .tol, .reg, .seed,
%       .initMethod ('cold'|'random'|'fopt_b1') — default 'cold'
%       .nRestarts (default 1)
%       .quantBits phase quantization of the F_RF phase shifter to 2^bits levels
%                  (0 or Inf = continuous; mirrors the single-band version).
%                  Only quantizes F_RF; an external TTD layer, if any,
%                  stays continuous. Default 0.
%       .subMask [Nt x Nrf] (REQUIRED in SC)
%
%   Outputs:
%     F_RF : [Nt x Nrf], shared by all bands, |F_RF[i,j]|=1/sqrt(Nt)
%            (zero at positions outside the mask if SC).
%     F_BB : cell {1 x B}, F_BB{b} = [Nrf x Ns_b].
%     info : struct with
%              .errorHistory   [maxIter x 1] normalized sum over bands
%              .errorFinal
%              .errorPerBand   [1 x B] eps_frob per band
%              .iterations
%              .architecture
%              .B              number of bands
%
%   Notes:
%     - Natural generalization of hybrid_am_decomposition. NOTE: the stopping
%       criterion uses the CONSISTENT metric (error of the (F_RF,F_BB) pair with
%       F_BB optimal for the current F_RF), not the lagged one. The
%       single-band version still uses the lagged one, so for B=1 it NO longer
%       matches it bit-exactly in iteration count / stopping point
%       (criterion still to be unified in single-band).
%     - Baseband F_BB is NOT quantized (only the F_RF phase shifter via
%       quantBits, same as single-band). quantBits<=0 or Inf reproduces the
%       previous continuous behavior (backward compatible).
%     - The 1/sqrt(Nt) normalization factor in F_RF is kept as in
%       single-band for consistency.

if nargin < 4 || isempty(opts); opts = struct(); end
maxIter    = local_get(opts, 'maxIter',    30);
tol        = local_get(opts, 'tol',        1e-6);
reg        = local_get(opts, 'reg',        1e-9);
seed       = local_get(opts, 'seed',       []);
initMethod = local_get(opts, 'initMethod', 'cold');
nRestarts  = local_get(opts, 'nRestarts',  1);
quantBits  = local_get(opts, 'quantBits',  0);   % phase-shifter bits (0/Inf = continuous)

if ~iscell(F_opt_cell)
    error('hybrid_am_decomposition_multiband:input', ...
          'F_opt_cell must be a cell array {1 x B}.');
end
B = numel(F_opt_cell);
if B < 1
    error('hybrid_am_decomposition_multiband:input', 'B=0 is not valid.');
end

% Validate sizes
[Nt, ~] = size(F_opt_cell{1});
NsList = nan(1, B);
for b = 1:B
    [Ntb, Nsb] = size(F_opt_cell{b});
    if Ntb ~= Nt
        error('hybrid_am_decomposition_multiband:Nt', ...
            'Band %d has Nt=%d, band 1 has Nt=%d.', b, Ntb, Nt);
    end
    NsList(b) = Nsb;
end
maxNs = max(NsList);
if Nrf < maxNs
    error('hybrid_am_decomposition_multiband:Nrf', ...
        'Nrf (%d) must be >= max Ns per band (%d).', Nrf, maxNs);
end

isSub = strcmpi(architecture, 'sub_connected') || strcmpi(architecture, 'sc');
isFC  = strcmpi(architecture, 'fully_connected') || strcmpi(architecture, 'fc');
if ~(isSub || isFC)
    error('hybrid_am_decomposition_multiband:arch', ...
          'Unknown architecture: %s', architecture);
end

% --- Restarts wrapper ---------------------------------------------------
if nRestarts > 1
    best = struct('errorFinal', inf);
    for r = 1:nRestarts
        opts_r = opts;
        opts_r.nRestarts = 1;
        if ~isempty(seed); opts_r.seed = seed + (r-1); end
        [F_RF_r, F_BB_r, info_r] = hybrid_am_decomposition_multiband( ...
            F_opt_cell, Nrf, architecture, opts_r);
        if info_r.errorFinal < best.errorFinal
            best.F_RF = F_RF_r; best.F_BB = F_BB_r;
            best.info = info_r; best.errorFinal = info_r.errorFinal;
        end
    end
    F_RF = best.F_RF; F_BB = best.F_BB; info = best.info;
    info.nRestarts = nRestarts;
    return;
end

if ~isempty(seed); rng(seed); end

% --- Initialization -----------------------------------------------------
if isSub
    if ~isfield(opts, 'subMask') || isempty(opts.subMask)
        error('hybrid_am_decomposition_multiband:subMask', ...
            'SC mode requires opts.subMask [Nt x Nrf].');
    end
    mask = logical(opts.subMask);
    if ~isequal(size(mask), [Nt, Nrf])
        error('hybrid_am_decomposition_multiband:subMaskSize', ...
            'opts.subMask must be [%d x %d].', Nt, Nrf);
    end
end

if strcmpi(initMethod, 'fopt_b1')
    % Warm initialization from band 1 (similar to single-band 'fopt').
    F_opt1 = F_opt_cell{1};
    Ns1 = size(F_opt1, 2);
    colNorms = vecnorm(F_opt1, 2, 1);
    nz       = find(colNorms > eps);
    nNZ      = numel(nz);
    F_RF     = zeros(Nt, Nrf);
    if nNZ == 0
        F_RF = exp(1j * 2*pi * rand(Nt, Nrf)) / sqrt(Nt);
    else
        ncopy = min(Nrf, nNZ);
        F_RF(:, 1:ncopy) = exp(1j * angle(F_opt1(:, nz(1:ncopy)))) / sqrt(Nt);
        if Nrf > ncopy
            for kk = (ncopy+1):Nrf
                src   = nz(mod(kk-1, nNZ) + 1);
                shift = 2*pi * (kk - ncopy) / (Nrf - ncopy + 1);
                perturb = 0.2 * pi * (2*rand(Nt,1) - 1);
                F_RF(:, kk) = exp(1j * (angle(F_opt1(:, src)) + shift + perturb)) / sqrt(Nt);
            end
        end
    end
else
    % 'cold' / 'random' or unknown: uniformly random phase.
    F_RF = exp(1j * 2*pi * rand(Nt, Nrf)) / sqrt(Nt);
end

if isSub
    F_RF = F_RF .* mask;
end
if quantBits > 0
    F_RF = quantize_phase(F_RF, quantBits);   % quantizes the phase shifter, not the TTD
    if isSub; F_RF = F_RF .* mask; end
end

% --- Multiband PE-AltMin loop -------------------------------------------
F_BB = cell(1, B);
errorHistory = zeros(maxIter, 1);
% Total norm for error normalization
normTotalSq = 0;
for b = 1:B
    normTotalSq = normTotalSq + norm(F_opt_cell{b}, 'fro')^2;
end
normTotal = sqrt(normTotalSq) + eps;

for it = 1:maxIter
    % Step 1: independent F_BB_b per band via LS on the CURRENT F_RF.
    % G = F_RF^H F_RF (+ reg): diagonal in SC due to disjoint support; reg
    % avoids degeneracy if a column is all zeros. Factored once
    % for all bands.
    G = F_RF' * F_RF + reg * eye(Nrf);
    [Lc, U_chol, p] = cholesky_or_lu(G);  %#ok<ASGLU>

    Z_sum = zeros(Nt, Nrf);
    errSq = 0;
    for b = 1:B
        rhs = F_RF' * F_opt_cell{b};
        if p == 0
            F_BB{b} = U_chol \ (Lc \ rhs);   % chol path: G = Lc' * Lc, used via U_chol = Lc'
        else
            F_BB{b} = G \ rhs;               % LU fallback for non-PD
        end
        Z_sum = Z_sum + F_opt_cell{b} * F_BB{b}';
        % CONSISTENT error: F_BB{b} is the LS optimum for the current F_RF, so
        % (F_RF, F_BB) form a matched pair. It is the SAME metric as the final
        % LS; the stopping criterion uses it (not the lagged version that measured
        % the updated F_RF against the previous step's F_BB, noisy and unsettled).
        errSq = errSq + norm(F_opt_cell{b} - F_RF * F_BB{b}, 'fro')^2;
    end
    errorHistory(it) = sqrt(errSq) / normTotal;

    % Stop on the consistent metric. On convergence, (F_RF, F_BB) is already the
    % returned pair: no extra phase projection is needed.
    if it > 1 && abs(errorHistory(it-1) - errorHistory(it)) < tol
        errorHistory = errorHistory(1:it);
        break;
    end

    % Step 2: update the shared F_RF via phase projection of the aggregate Z.
    if isSub
        Z_masked = Z_sum .* mask;
        F_RF = exp(1j * angle(Z_masked)) / sqrt(Nt);
        F_RF = F_RF .* mask;
    else
        F_RF = exp(1j * angle(Z_sum)) / sqrt(Nt);
    end
    if quantBits > 0
        F_RF = quantize_phase(F_RF, quantBits);
        if isSub; F_RF = F_RF .* mask; end
    end
end

% --- Final LS with converged F_RF ---------------------------------------
G = F_RF' * F_RF + reg * eye(Nrf);
errPerBand = nan(1, B);
for b = 1:B
    F_BB{b} = G \ (F_RF' * F_opt_cell{b});
    errPerBand(b) = norm(F_opt_cell{b} - F_RF * F_BB{b}, 'fro') / ...
                    (norm(F_opt_cell{b}, 'fro') + eps);
end

% --- Constant-modulus sanity check at active positions ------------------
abs_active = abs(F_RF(F_RF ~= 0));
if ~isempty(abs_active)
    cm_err = max(abs(abs_active - 1/sqrt(Nt)));
    assert(cm_err < 1e-10, ...
        'hybrid_am_decomposition_multiband: constant modulus violation (err=%.3e)', cm_err);
end

info = struct( ...
    'errorHistory', errorHistory, ...
    'errorFinal',   errorHistory(end), ...
    'errorPerBand', errPerBand, ...
    'iterations',   numel(errorHistory), ...
    'architecture', architecture, ...
    'quantBits',    quantBits, ...
    'B',            B);
end

% =========================================================================
function [Lc, U_out, isLU] = cholesky_or_lu(G)
% Tries Cholesky on G (should be SPD). If it fails, falls back to LU.
% Returns isLU=0 if chol succeeded, isLU=1 if LU is used.
[Lc, flag] = chol(G, 'lower');
if flag == 0
    U_out = Lc';
    isLU = 0;
else
    Lc = []; U_out = [];
    isLU = 1;
end
end

% =========================================================================
function v = local_get(s, name, def)
if isstruct(s) && isfield(s, name) && ~isempty(s.(name)); v = s.(name); else; v = def; end
end
