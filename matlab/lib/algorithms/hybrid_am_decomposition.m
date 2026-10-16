function [F_RF, F_BB, info] = hybrid_am_decomposition(F_opt, Nrf, architecture, opts)
%HYBRID_AM_DECOMPOSITION Hybrid decomposition via PE-AltMin.
%
%   Approximately solves   min ||F_opt - F_RF * F_BB||_F
%   with F_RF of constant modulus 1/sqrt(Nt) (hardware constraint of a pure
%   phase shifter: |F_RF[i,j]| = constant). In sub-connected mode the
%   support is also block-diagonal according to the mask.
%
%   opts:
%     .maxIter, .tol, .reg, .quantBits, .seed,
%     .initMethod ('fopt'|'random'), .nRestarts, .subMask
%
%   Internal helper used by hybrid_fc / hybrid_sc.

if nargin < 4 || isempty(opts); opts = struct(); end
maxIter    = local_get(opts, 'maxIter',    30);
tol        = local_get(opts, 'tol',        1e-5);
reg        = local_get(opts, 'reg',        1e-9);
quantBits  = local_get(opts, 'quantBits',  0);
seed       = local_get(opts, 'seed',       []);
initMethod = local_get(opts, 'initMethod', 'fopt');
nRestarts  = local_get(opts, 'nRestarts',  1);
warmInit   = local_get(opts, 'F_RF_init',  []);   % explicit warm start (continuation)

[Nt, Ns] = size(F_opt);
if Nrf < Ns
    error('hybrid_am_decomposition:Nrf','Nrf (%d) must be >= Ns (%d).', Nrf, Ns);
end

isSub = strcmpi(architecture, 'sub_connected') || strcmpi(architecture, 'sc');
isFC  = strcmpi(architecture, 'fully_connected') || strcmpi(architecture, 'fc');
if ~(isSub || isFC)
    error('hybrid_am_decomposition:arch', 'Unknown architecture: %s', architecture);
end

hasCustomMask = isfield(opts,'subMask') && ~isempty(opts.subMask);
if isSub && mod(Nt, Nrf) ~= 0 && ~hasCustomMask
    error('hybrid_am_decomposition:SubDiv', ...
          'Sub-connected requires mod(Nt,Nrf)=0 without opts.subMask.');
end

if nRestarts > 1
    best = struct('errorFinal', inf);
    for r = 1:nRestarts
        opts_r = opts;
        opts_r.nRestarts = 1;
        if ~isempty(seed); opts_r.seed = seed + (r-1); end
        [F_RF_r, F_BB_r, info_r] = hybrid_am_decomposition(F_opt, Nrf, ...
                                                  architecture, opts_r);
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

% Supported initMethod values:
%   'fopt'     (default, backward compatible) - copies F_opt phases for
%              the first min(Nrf,Ns) cols + random perturbation for
%              extra cols. Warm/random hybrid.
%   'cold' or 'random' - uniform phases in [0, 2*pi) for all
%              cols. Intended for use with nRestarts > 1.
%   'warm_svd' - pure F_opt: copies phases for the first min(Nrf,Ns)
%              cols + DETERMINISTIC extension (phase shift) for extra
%              cols. No randomness. Intended for use with nRestarts=1.
%   'omp_init' - initializes F_RF by calling omp_hybrid_decomposition with
%              the same F_opt and a dictionary of steering vectors uniform
%              in u-v. Each F_RF col is aligned with a dictionary atom
%              informed by the array geometry. Requires
%              opts.Nx, opts.Ny, opts.spacingLambda, opts.fc.
%              Deterministic (OMP uses no randomness). Intended for nRestarts=1.
if ~isempty(warmInit)
    % Explicit warm start (e.g. the previous ratio's solution, extended).
    if ~isequal(size(warmInit), [Nt Nrf])
        error('hybrid_am_decomposition:F_RF_init', ...
              'opts.F_RF_init must be [%d x %d].', Nt, Nrf);
    end
    F_RF = warmInit;
elseif strcmpi(initMethod, 'fopt')
    colNorms = vecnorm(F_opt, 2, 1);
    nz       = find(colNorms > eps);
    nNZ      = numel(nz);
    F_RF     = zeros(Nt, Nrf);
    if nNZ == 0
        F_RF = exp(1j * 2*pi * rand(Nt, Nrf)) / sqrt(Nt);
    else
        ncopy = min(Nrf, nNZ);
        F_RF(:, 1:ncopy) = exp(1j * angle(F_opt(:, nz(1:ncopy)))) / sqrt(Nt);
        if Nrf > ncopy
            for kk = (ncopy+1):Nrf
                src   = nz(mod(kk-1, nNZ) + 1);
                shift = 2*pi * (kk - ncopy) / (Nrf - ncopy + 1);
                perturb = 0.2 * pi * (2*rand(Nt,1) - 1);
                F_RF(:, kk) = exp(1j * (angle(F_opt(:, src)) + shift + perturb)) / sqrt(Nt);
            end
        end
    end
elseif strcmpi(initMethod, 'warm_svd')
    % Pure F_opt with no random component. F_RF[:,1:Ns] = exp(j angle(F_opt)).
    % For Nrf > Ns: deterministic extension with a uniform phase shift.
    colNorms = vecnorm(F_opt, 2, 1);
    nz       = find(colNorms > eps);
    nNZ      = numel(nz);
    F_RF     = zeros(Nt, Nrf);
    if nNZ == 0
        % No information from F_opt: fall back to cold so as not to fail.
        F_RF = exp(1j * 2*pi * rand(Nt, Nrf)) / sqrt(Nt);
    else
        ncopy = min(Nrf, nNZ);
        F_RF(:, 1:ncopy) = exp(1j * angle(F_opt(:, nz(1:ncopy)))) / sqrt(Nt);
        for kk = (ncopy+1):Nrf
            src   = nz(mod(kk-1, nNZ) + 1);
            shift = 2*pi * (kk - ncopy) / (Nrf - ncopy + 1);
            F_RF(:, kk) = exp(1j * (angle(F_opt(:, src)) + shift)) / sqrt(Nt);
        end
    end
elseif strcmpi(initMethod, 'omp_init')
    % Initialization via OMP-based Sparse Precoding (El Ayach 2014). F_RF
    % consists of Nrf steering vectors chosen from the u-v dictionary.
    % Deterministic, uses NO randomness. Reuses omp_hybrid_decomposition.
    if ~all(isfield(opts, {'Nx','Ny','spacingLambda','fc'}))
        error('hybrid_am_decomposition:omp_init', ...
              'omp_init requires opts.Nx, opts.Ny, opts.spacingLambda, opts.fc.');
    end
    ompOpts = struct('Nx', opts.Nx, 'Ny', opts.Ny, ...
                     'spacingLambda', opts.spacingLambda, ...
                     'fc', opts.fc, ...
                     'grid_size_az', 64, 'grid_size_el', 32);
    if isSub
        if ~isfield(opts,'subMask') || isempty(opts.subMask)
            error('hybrid_am_decomposition:omp_init', ...
                  'omp_init in SC requires opts.subMask.');
        end
        ompOpts.subMask = opts.subMask;
        omp_mode = 'SC';
    else
        omp_mode = 'FC';
    end
    [F_RF, ~] = omp_hybrid_decomposition(F_opt, Nrf, omp_mode, [], ompOpts);
    % F_RF has |entry| = 1/sqrt(Nt) by construction of the dictionary.
else
    % 'cold', 'random' or unknown -> uniform random.
    F_RF = exp(1j * 2*pi * rand(Nt, Nrf)) / sqrt(Nt);
end
if isSub
    if isfield(opts,'subMask') && ~isempty(opts.subMask)
        mask = logical(opts.subMask);
        if ~isequal(size(mask), [Nt Nrf])
            error('hybrid_am_decomposition:Mask','opts.subMask must be [Nt x Nrf].');
        end
    else
        mask = local_subarray_mask(Nt, Nrf);
    end
    F_RF = F_RF .* mask;
end
if quantBits > 0; F_RF = quantize_phase(F_RF, quantBits); end

errorHistory = zeros(maxIter, 1);
normFopt = norm(F_opt, 'fro') + eps;

for it = 1:maxIter
    G    = F_RF' * F_RF + reg * eye(Nrf);
    F_BB = G \ (F_RF' * F_opt);

    Z = F_opt * F_BB';
    if isSub; Z = Z .* mask; end
    F_RF = exp(1j * angle(Z)) / sqrt(Nt);
    if isSub; F_RF = F_RF .* mask; end
    if quantBits > 0
        F_RF = quantize_phase(F_RF, quantBits);
        if isSub; F_RF = F_RF .* mask; end
    end

    errorHistory(it) = norm(F_opt - F_RF*F_BB, 'fro') / normFopt;
    if it > 1 && abs(errorHistory(it-1) - errorHistory(it)) < tol
        errorHistory = errorHistory(1:it);
        break;
    end
end

G    = F_RF' * F_RF + reg * eye(Nrf);
F_BB = G \ (F_RF' * F_opt);

abs_active = abs(F_RF(F_RF ~= 0));
if ~isempty(abs_active)
    cm_err = max(abs(abs_active - 1/sqrt(Nt)));
    assert(cm_err < 1e-10, ...
        'hybrid_am_decomposition: constant-modulus violation (err=%.3e)', cm_err);
end

info = struct( ...
    'errorHistory', errorHistory, ...
    'errorFinal',   errorHistory(end), ...
    'iterations',   numel(errorHistory), ...
    'architecture', architecture, ...
    'quantBits',    quantBits);
end

function mask = local_subarray_mask(Nt, Nrf)
Nsub = Nt / Nrf;
mask = false(Nt, Nrf);
for n = 1:Nrf
    mask((n-1)*Nsub+1 : n*Nsub, n) = true;
end
end

function v = local_get(s, name, def)
if isstruct(s) && isfield(s,name) && ~isempty(s.(name)); v = s.(name); else; v = def; end
end
