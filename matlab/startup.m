function startup()
%STARTUP Set up the MATLAB path for the naval radar project.
%
%   Usage: open MATLAB in matlab/ and run
%        >> startup
%
%   Adds lib/ (thesis library + radar modules) and config/ (reference
%   system parameters) to the path. Each phase lives in its own folder
%   faseN_*/; regenerated outputs are written to results/ (ignored by git).

root = fileparts(mfilename('fullpath'));
addpath(genpath(fullfile(root, 'lib')));
addpath(fullfile(root, 'config'));
fprintf('[startup] lib/ and config/ added to path. Root: %s\n', root);
end
