function seed = run_id_to_seed(runID)
%RUN_ID_TO_SEED Deterministic hash runID-string -> uint32 for rng().
%
%   seed = run_id_to_seed(runID)
%
%   Implements the DJB2 variant (Dan Bernstein) truncated to 32 bits:
%       h(0) = 5381;  h(k) = h(k-1) * 33 + b(k)
%
%   Good enough for seeds (not for crypto). The same string always
%   yields the same seed -> strict reproducibility within the same
%   runID.
%
%   Input:
%     runID : char vector / string
%   Output:
%     seed  : uint32 (0..2^32-1)

if isstring(runID); runID = char(runID); end
b = uint64(uint8(runID(:)).');
h = uint64(5381);
mask = uint64(2^32 - 1);
for k = 1:numel(b)
    h = bitand(h*33 + b(k), mask);
end
seed = uint32(h);
end
