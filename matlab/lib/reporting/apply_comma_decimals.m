function apply_comma_decimals(fig)
%APPLY_COMMA_DECIMALS Convert the decimal separator from point to COMMA in a
%   figure (Spanish typography), right before exporting. Affects:
%     - X/Y/Z axis tick labels (including log and custom scales),
%     - texts (titles, xlabel/ylabel, sgtitle, annotations, legends),
%     - colorbar labels and ticks.
%   Only replaces a point located BETWEEN two digits ("0.443" -> "0,443"),
%   so it does NOT touch things like "F_{opt}", "10^{0}" or dotted names.
%
%   Does NOT modify data (CSV): purely presentational. Called from
%   save_figure (and from generators that export directly with
%   exportgraphics) before exporting the PNG.

if nargin < 1 || isempty(fig) || ~isgraphics(fig); return; end

% --- Axis ticks ----------------------------------------------------------
axs = findall(fig, 'Type', 'axes');
for i = 1:numel(axs)
    ax = axs(i);
    for c = 'XYZ'
        tickProp = [c 'Tick'];  lblProp = [c 'TickLabel'];  modeProp = [c 'TickMode'];
        try
            tv = get(ax, tickProp);
            if isempty(tv); continue; end
            lbl = get(ax, lblProp);
            if isempty(lbl) || numel(cellstr(lbl)) ~= numel(tv)
                lbl = arrayfun(@(v) num2str(v), tv(:), 'UniformOutput', false);
            end
            lbl = cellfun(@(s) strrep(char(s), '.', ','), cellstr(lbl), ...
                          'UniformOutput', false);
            set(ax, modeProp, 'manual');   % freeze ticks so they are not regenerated
            set(ax, lblProp, lbl);
        catch
        end
    end
end

% --- Texts (titles, labels, sgtitle, annotations) ------------------------
txts = findall(fig, 'Type', 'text');
for i = 1:numel(txts)
    try; set(txts(i), 'String', local_comma(get(txts(i), 'String'))); catch; end
end

% --- Legends -------------------------------------------------------------
lgs = findall(fig, 'Type', 'legend');
for i = 1:numel(lgs)
    try; lgs(i).String = local_comma(lgs(i).String); catch; end
end

% --- Colorbars (label + ticks) -------------------------------------------
cbs = findall(fig, 'Type', 'colorbar');
for i = 1:numel(cbs)
    try; cbs(i).Label.String = local_comma(cbs(i).Label.String); catch; end
    try
        if ~isempty(cbs(i).TickLabels)
            cbs(i).TickLabels = cellfun(@(s) strrep(char(s), '.', ','), ...
                cellstr(cbs(i).TickLabels), 'UniformOutput', false);
        end
    catch
    end
end
end

% =========================================================================
function out = local_comma(s)
%LOCAL_COMMA Replace 'digit.digit' with 'digit,digit' in a string or cell.
if iscell(s)
    out = cellfun(@local_comma, s, 'UniformOutput', false);
    return;
end
if isstring(s); s = char(s); end
if isempty(s) || ~ischar(s); out = s; return; end
out = regexprep(s, '(\d)\.(\d)', '$1,$2');
end
