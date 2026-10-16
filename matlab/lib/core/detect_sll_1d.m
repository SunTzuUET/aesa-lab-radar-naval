function sllDb = detect_sll_1d(grid, P_lin)
%DETECT_SLL_1D Robust 1D SLL detector.
%   Finds the first sidelobe after the first null on each side of the
%   peak, and returns max(SL_left, SL_right) in dB relative to the peak.
%
%   For uniform illumination (rect window) it must converge to -13.26 dB.
%
%   grid : sorted coordinate vector (deg)
%   P_lin: linear power vector (not normalized)

P = P_lin(:);
g = grid(:); %#ok<NASGU>
P = P / (max(P) + eps);
N = numel(P); %#ok<NASGU>

[~, ip] = max(P);

slLeft  = local_first_sidelobe(P, ip, -1);
slRight = local_first_sidelobe(P, ip, +1);

slMax = max([slLeft, slRight]);
if isempty(slMax) || ~isfinite(slMax) || slMax <= 0
    sllDb = NaN;
else
    sllDb = 10*log10(slMax);
end
end

function sl = local_first_sidelobe(P, ip, direction)
%LOCAL_FIRST_SIDELOBE Walk from ip in `direction` (+/-1) looking for the first
%   minimum (null) and then the first local maximum (first SLL).
N = numel(P);
sl = NaN;
i = ip;

% Step 1: descend until the first local minimum (null)
while true
    j = i + direction;
    if j < 1 || j > N
        return;
    end
    if P(j) > P(i)
        break;
    end
    i = j;
end

% Step 2: ascend until the next local maximum
while true
    j = i + direction;
    if j < 1 || j > N
        sl = P(i);
        return;
    end
    if P(j) < P(i)
        sl = P(i);
        return;
    end
    i = j;
end
end
