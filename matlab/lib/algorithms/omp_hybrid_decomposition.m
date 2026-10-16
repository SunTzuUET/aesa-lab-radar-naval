function [F_RF, F_BB, eps_frob, n_iter, info] = omp_hybrid_decomposition( ...
        F_opt, N_RF, mode, dict, opts)
%OMP_HYBRID_DECOMPOSITION Hybrid decomposition via Orthogonal Matching Pursuit.
%
%   Implementation based on Algorithm 1 of: O. El Ayach et al.,
%   "Spatially Sparse Precoding in Millimeter Wave MIMO Systems",
%   IEEE Trans. Wireless Commun., vol. 13, no. 3, pp. 1499-1513, Mar. 2014.
%
%   Approximately solves
%       min ||F_opt - F_RF * F_BB||_F
%   where:
%     - F_RF has N_RF columns drawn from a dictionary `dict`. Each
%       column is a steering vector with constant modulus 1/sqrt(N_t).
%     - In 'SC' mode, each column k of F_RF is supported only on
%       sub-array k (block-diagonal mask `opts.subMask`).
%     - F_BB is solved by least squares on F_RF at each iteration,
%       with power normalization ||F_RF * F_BB||_F = sqrt(N_s).
%
%   Inputs:
%     F_opt : [Nt x Ns] target digital precoder.
%     N_RF  : number of RF chains (= number of selected atoms).
%     mode  : 'FC' (fully-connected) or 'SC' (sub-connected).
%     dict  : [Nt x G] dictionary of steering vectors (constant modulus
%             1/sqrt(Nt) per entry). If empty, it is built internally
%             with a uniform grid in u-v space (requires opts.Nx, opts.Ny).
%     opts  : struct with optional fields:
%       .grid_size_az  : number of points on the u-axis (default 64).
%       .grid_size_el  : number of points on the v-axis (default 32).
%       .Nx, .Ny       : URA geometry (needed if dict is empty).
%       .spacingLambda : [dx dy] lambda (default [0.5 0.5]).
%       .fc            : reference frequency (default 28e9).
%       .subMask       : [Nt x N_RF] logical mask (REQUIRED in SC mode).
%       .verbose       : bool (default false).
%
%   Outputs:
%     F_RF     : [Nt x N_RF] chosen columns (with SC mask if applicable).
%     F_BB     : [N_RF x Ns] solved by LS + power normalization.
%     eps_frob : ||F_opt - F_RF*F_BB||_F / ||F_opt||_F.
%     n_iter   : N_RF (in standard OMP, one iteration per chain).
%     info     : struct with
%                  .selected_indices [N_RF x 1] dictionary indices.
%                  .residual_norms   [N_RF x 1] ||F_residual_k||_F history.
%                  .mode             'FC' or 'SC'.
%                  .G                dictionary size.

if nargin < 4; dict = []; end
if nargin < 5; opts = struct(); end

verbose       = local_get(opts, 'verbose',       false);
gridU         = local_get(opts, 'grid_size_az',  64);   % legacy naming
gridV         = local_get(opts, 'grid_size_el',  32);
Nx            = local_get(opts, 'Nx',            []);
Ny            = local_get(opts, 'Ny',            []);
spacingLambda = local_get(opts, 'spacingLambda', [0.5 0.5]);
fc            = local_get(opts, 'fc',            28e9);
subMask       = local_get(opts, 'subMask',       []);

[Nt, Ns] = size(F_opt);

% --- Build the default dictionary ---------------------------------------
if isempty(dict)
    if isempty(Nx) || isempty(Ny)
        error('omp_hybrid_decomposition:dict', ...
              'Provide dict explicitly or pass opts.Nx, opts.Ny to build it.');
    end
    dict = local_build_dict_uv(Nx, Ny, spacingLambda, fc, gridU, gridV);
end

if size(dict, 1) ~= Nt
    error('omp_hybrid_decomposition:dictSize', ...
          'dict has %d rows, F_opt has %d rows.', size(dict,1), Nt);
end
G = size(dict, 2);

% --- Mode + SC mask validation -------------------------------------------
isSC = strcmpi(mode, 'SC') || strcmpi(mode, 'sub_connected') || strcmpi(mode, 'subconnected');
isFC = strcmpi(mode, 'FC') || strcmpi(mode, 'fully_connected') || strcmpi(mode, 'fullyconnected');
if ~(isSC || isFC)
    error('omp_hybrid_decomposition:mode', 'mode must be "FC" or "SC".');
end
if isSC
    if isempty(subMask)
        error('omp_hybrid_decomposition:subMask', ...
              'SC mode requires opts.subMask [Nt x N_RF].');
    end
    if ~isequal(size(subMask), [Nt, N_RF])
        error('omp_hybrid_decomposition:subMaskSize', ...
              'opts.subMask must be [%d x %d], got [%d x %d].', ...
              Nt, N_RF, size(subMask,1), size(subMask,2));
    end
    subMask = logical(subMask);
end

% --- Main loop -----------------------------------------------------------
F_residual = F_opt;
F_RF = zeros(Nt, N_RF);
selected = zeros(N_RF, 1);
residual_norms = zeros(N_RF, 1);

for k = 1:N_RF
    if isSC
        mk = subMask(:, k);                 % logical [Nt x 1]
        dict_k = dict .* mk;                % atoms restricted to sub-array k
        psi = dict_k' * F_residual;         % [G x Ns]
    else
        psi = dict' * F_residual;           % [G x Ns]
    end
    pow = real(sum(psi .* conj(psi), 2));   % power per atom, [G x 1]

    % FC: avoid reusing selected atoms. SC: each chain has its own
    % sub-array, so there is no overlap between chains.
    if isFC && k > 1
        pow(selected(1:k-1)) = -Inf;
    end

    [~, k_star] = max(pow);
    selected(k) = k_star;

    if isSC
        F_RF(:, k) = dict(:, k_star) .* mk;
    else
        F_RF(:, k) = dict(:, k_star);
    end

    % LS for F_BB using the k atoms selected so far.
    F_RF_k = F_RF(:, 1:k);
    F_BB_k = pinv(F_RF_k) * F_opt;
    nrm = norm(F_RF_k * F_BB_k, 'fro');
    if nrm > eps
        F_BB_k = F_BB_k * sqrt(Ns) / nrm;
    end

    % Update the normalized residual (step 7 of El Ayach 2014).
    R = F_opt - F_RF_k * F_BB_k;
    residual_norms(k) = norm(R, 'fro');
    if residual_norms(k) > eps
        F_residual = R / residual_norms(k);
    else
        F_residual = R;
    end

    if verbose
        fprintf('[OMP][%s] iter %d: idx=%d, ||residual||_F=%.4e\n', ...
                mode, k, k_star, residual_norms(k));
    end
end

% --- Final LS + power normalization + eps_frob --------------------------
F_BB = pinv(F_RF) * F_opt;
nrm_final = norm(F_RF * F_BB, 'fro');
if nrm_final > eps
    F_BB = F_BB * sqrt(Ns) / nrm_final;
end
eps_frob = norm(F_opt - F_RF * F_BB, 'fro') / (norm(F_opt, 'fro') + eps);
n_iter = N_RF;
info = struct( ...
    'selected_indices', selected, ...
    'residual_norms',   residual_norms, ...
    'mode',             mode, ...
    'G',                G);
end

% =========================================================================
function dict = local_build_dict_uv(Nx, Ny, spacingLambda, fc, gridU, gridV)
%LOCAL_BUILD_DICT_UV Uniform dictionary in u-v space, filtered to the physical region.
%
%   gridU x gridV points in u, v ∈ [-1, 1]. Only keeps points with
%   u² + v² <= 1 (physical region). Each atom is a(theta, phi)/sqrt(Nt)
%   with |entry| = 1/sqrt(Nt).
u_grid = linspace(-1, 1, gridU + 1);  u_grid(end) = [];   % avoid the u=+1 edge
v_grid = linspace(-1, 1, gridV + 1);  v_grid(end) = [];
[U, V] = meshgrid(u_grid, v_grid);
phys = (U.^2 + V.^2) <= (1 - 1e-9);
uVec = U(phys).';
vVec = V(phys).';
% u = sin(theta) cos(phi), v = sin(theta) sin(phi)
theta = asind(min(1, sqrt(uVec.^2 + vVec.^2)));    % [0, 90]
phi   = atan2d(vVec, uVec);                          % [-180, 180]
A = steering_vector(Nx, Ny, spacingLambda, fc, theta, phi);
Nt = Nx * Ny;
dict = A / sqrt(Nt);
end

% =========================================================================
function v = local_get(s, name, def)
if isstruct(s) && isfield(s, name) && ~isempty(s.(name)); v = s.(name); else; v = def; end
end
