function W_q = quantize_phase(W, bits)
%QUANTIZE_PHASE Quantize the phase of W to 2^bits uniform levels in [-pi, pi).
%   Preserves per-element magnitude. bits=0 or non-finite -> identity.
if nargin < 2 || isempty(bits) || ~isfinite(bits) || bits <= 0
    W_q = W;
    return;
end
nLevels = 2^bits;
step = 2*pi / nLevels;
ph = angle(W);
ph_q = round(ph / step) * step;
ph_q = mod(ph_q + pi, 2*pi) - pi;
W_q = abs(W) .* exp(1j * ph_q);
end
