function pngPath = save_figure(fig, outDir, name, opts)
%SAVE_FIGURE Save a figure as PNG (300 DPI by default, white background).
%
%   pngPath = save_figure(fig, outDir, name, opts)
%
%   The figure is saved to outDir/figures/<name>.png. For the new flow,
%   pass outDir = results/figs/<expID>/ or equivalent.
%
%   opts.resolution : DPI (default 300)
%   opts.vector     : true|false (default false). If true, in addition to the PNG
%                     exports a vector PDF outDir/figures/<name>.pdf
%                     (ContentType 'vector') suitable for LaTeX without
%                     pixelation. Also accepts 'pdf' or 'eps' to choose the
%                     vector format.

if nargin < 4; opts = struct(); end
res    = local_get(opts, 'resolution', 300);
vector = local_get(opts, 'vector', false);

figDir = fullfile(outDir, 'figures');
if ~exist(figDir, 'dir'); mkdir(figDir); end

set(fig, 'Color', 'w');
axList = findall(fig, 'Type','axes');
for ax = axList'
    try; ax.Toolbar.Visible = 'off'; catch; end
end

% Unified formatting criteria (no internal title, large fonts,
% unobtrusive legend, tight X axis and decimal comma) before exporting.
finalize_figure_style(fig);

pngPath = fullfile(figDir, [name '.png']);
ws = warning('off', 'all');
exportgraphics(fig, pngPath, 'Resolution', res, 'BackgroundColor', 'white');

% --- Optional vector export (PDF by default, EPS if requested) ------------
if ~isequal(vector, false)
    if ischar(vector) || isstring(vector)
        ext = lower(char(vector));
    else
        ext = 'pdf';
    end
    vecPath = fullfile(figDir, [name '.' ext]);
    exportgraphics(fig, vecPath, 'ContentType', 'vector', 'BackgroundColor', 'white');
    fprintf('  -> figures/%s.%s (vector)\n', name, ext);
end
warning(ws);
fprintf('  -> figures/%s.png\n', name);
end

function v = local_get(s, name, def)
if isstruct(s) && isfield(s,name) && ~isempty(s.(name)); v = s.(name); else; v = def; end
end
