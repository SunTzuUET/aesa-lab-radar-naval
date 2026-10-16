function [mask, info] = build_sc_mask(Nx, Ny, Nrf, layout)
%BUILD_SC_MASK Antenna-to-RF-chain mask for a sub-connected architecture.
%
%   layout = 'square' (default): partitions the URA into (px x qy) sub-arrays
%            with px*qy = Nrf, px|Nx, qy|Ny and block aspect ratio
%            ax/ay = (Nx/px)/(Ny/qy) as close to 1 as possible. If no valid
%            2D partition exists, falls back to 'linear'.
%   layout = 'linear': contiguous blocks in linear order.
%   layout = 'nonuniform': allows mod(Nt,Nrf) != 0 (contiguous sub-arrays
%            of size floor(Nt/Nrf) or floor(Nt/Nrf)+1).
%
%   Linear ordering convention: meshgrid(0:Nx-1, 0:Ny-1) -> [Ny,Nx] matrices
%   in column-major order. Index n = iy + ix*Ny + 1.

if nargin < 4 || isempty(layout); layout = 'square'; end

Nt = Nx*Ny;
mask = false(Nt, Nrf);

if strcmpi(layout, 'linear')
    if mod(Nt, Nrf) ~= 0
        error('build_sc_mask:Div','Nt (%d) not divisible by Nrf (%d).', Nt, Nrf);
    end
    Nsub = Nt / Nrf;
    for n = 1:Nrf
        mask((n-1)*Nsub+1 : n*Nsub, n) = true;
    end
    info = struct('layout','linear','px',1,'qy',Nrf,'ax',NaN,'ay',NaN,'aspect',NaN);
    return;
end

if strcmpi(layout, 'nonuniform')
    if Nrf > Nt
        error('build_sc_mask:NrfGtNt','Nrf (%d) > Nt (%d).', Nrf, Nt);
    end
    base = floor(Nt / Nrf);
    extra = mod(Nt, Nrf);
    sizes = base * ones(1, Nrf);
    sizes(1:extra) = base + 1;
    cur = 0;
    for n = 1:Nrf
        mask(cur+1 : cur+sizes(n), n) = true;
        cur = cur + sizes(n);
    end
    info = struct('layout','nonuniform','px',1,'qy',Nrf, ...
                  'ax',NaN,'ay',NaN,'aspect',NaN, ...
                  'subSizes', sizes);
    return;
end

bestErr = inf;  bestPx = []; bestQy = [];
for px = 1:Nrf
    if mod(Nrf, px) ~= 0; continue; end
    qy = Nrf / px;
    if mod(Nx, px) ~= 0 || mod(Ny, qy) ~= 0; continue; end
    ax = Nx/px;  ay = Ny/qy;
    asp = max(ax,ay) / min(ax,ay);
    err = asp - 1;
    if err < bestErr - 1e-12
        bestErr = err;  bestPx = px;  bestQy = qy;
    end
end

if isempty(bestPx)
    [mask, info] = build_sc_mask(Nx, Ny, Nrf, 'linear');
    info.layout = 'linear-fallback';
    return;
end

px = bestPx;  qy = bestQy;
ax = Nx/px;   ay = Ny/qy;

n_sub = 0;
for bx = 0:px-1
    for by = 0:qy-1
        n_sub = n_sub + 1;
        for ix = (bx*ax):(bx*ax + ax - 1)
            for iy = (by*ay):(by*ay + ay - 1)
                lin = iy + ix*Ny + 1;
                mask(lin, n_sub) = true;
            end
        end
    end
end

info = struct('layout','square','px',px,'qy',qy,'ax',ax,'ay',ay,'aspect',ax/ay);
end
