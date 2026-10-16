function export_figure_png(fig, fullPath, res)
%EXPORT_FIGURE_PNG Export a figure to PNG applying the unified style criteria.
%
%   export_figure_png(fig, fullPath)        % 300 DPI
%   export_figure_png(fig, fullPath, res)   % custom DPI
%
%   Single export point for generators that write to arbitrary paths
%   (not outDir/figures/). Applies finalize_figure_style() —no title,
%   decimal comma, large fonts, unobtrusive legend, tight X axis—
%   and exports with exportgraphics at 300 DPI on a white background (criteria 1 and 9).
%   For the outDir/figures/ flow use save_figure (which calls the same
%   finishing logic).

if nargin < 3 || isempty(res); res = 300; end

set(fig, 'Color', 'w');
finalize_figure_style(fig);

d = fileparts(fullPath);
if ~isempty(d) && ~exist(d, 'dir'); mkdir(d); end

ws = warning('off', 'all');
exportgraphics(fig, fullPath, 'Resolution', res, 'BackgroundColor', 'white');
warning(ws);
end
