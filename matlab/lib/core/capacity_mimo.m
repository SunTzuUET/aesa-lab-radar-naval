function C = capacity_mimo(H, F, W, snrLin)
%CAPACITY_MIMO MIMO capacity with precoder F and combiner W.
%
%   C = log2 det( I + (snr/Ns) * (W^H W)^-1 W^H H F F^H H^H W )
%
%   F : [Nt x Ns] TX precoder (||F||_F^2 = Ns after internal normalization)
%   W : [Nr x Ns] RX combiner (empty -> optimal MMSE with noise cov = I)
%   H : [Nr x Nt]
%   snrLin : linear SNR (P/sigma^2)

if nargin < 3 || isempty(W)
    W = [];
end
[~, Nt] = size(H); %#ok<ASGLU>
Ns = size(F, 2);

% Normalize F to power Ns: ||F||_F^2 = Ns
fro = norm(F, 'fro') + eps;
F = F * sqrt(Ns) / fro;

HF = H * F;                    % [Nr x Ns]

if isempty(W)
    W = (HF * HF' + (Ns/snrLin) * eye(size(H,1))) \ HF;
end

WHW    = W' * W + 1e-12*eye(Ns);
WHHF   = W' * HF;
M      = (WHW \ (WHHF * WHHF')) * (snrLin / Ns);
C      = real(log2(det(eye(Ns) + M)));
end
