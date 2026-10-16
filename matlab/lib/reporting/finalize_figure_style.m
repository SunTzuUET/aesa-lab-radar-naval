function finalize_figure_style(fig, opts)
%FINALIZE_FIGURE_STYLE Apply the thesis's unified formatting criteria to a
%   figure, right BEFORE exporting it. It is the only style/finishing function
%   that should touch any figure (criterion 9: centralization). Covers:
%
%     (2) No OVERALL title: always removes the sgtitle and the tiledlayout
%         title (a title describing the whole figure; the description goes in
%         the document). Keeps PANEL titles in multi-panel figures
%         (e.g. "N_s = 2" / "N_s = 4", "AltMin" / "OMP"), which identify each
%         subplot. In single-axes figures the title is descriptive and IS
%         removed.
%     (3) Large, readable typography: sets large font sizes on axes,
%         labels, legend and colorbar (inherited from plot_style()).
%     (5) Decimal comma separator: delegates to apply_comma_decimals().
%     (6) Unobtrusive legend: no box (Box off). Does NOT move legends
%         deliberately placed outside (overlays with many series): the criterion
%         asks for "inside when there is room".
%     (7) Tight limits: fits the X axis to the useful data range on linear
%         axes with automatic limits (no bars), removing dead margin.
%         Respects any xlim/ylim set by hand in the generator.
%
%   Resolution (1) and physical size (3,8) are ensured by save_figure /
%   export_figure_png (300 DPI) and plot_style().figSize.
%
%   opts.keepTitle : true to keep titles (default false).
%   opts.tightX    : false to not adjust the X axis (default true).

if nargin < 1 || isempty(fig) || ~isgraphics(fig); return; end
if nargin < 2; opts = struct(); end
stripTitles = ~(isfield(opts,'keepTitle') && opts.keepTitle);
tightX      = ~(isfield(opts,'tightX')    && ~opts.tightX);

sty = plot_style();

axs = findall(fig, 'Type', 'axes');
% Single axes -> its title is descriptive (removed). Several axes ->
% titles are panel identifiers (kept).
singlePanel = numel(axs) <= 1;
for i = 1:numel(axs)
    ax = axs(i);

    % (3) Typography: large axes and labels.
    try; ax.FontSize = sty.fontSize.axis; catch; end
    try; if ax.LineWidth < 1.0; ax.LineWidth = 1.0; end; catch; end
    try; ax.XLabel.FontSize = sty.fontSize.label; catch; end
    try; ax.YLabel.FontSize = sty.fontSize.label; catch; end
    try; ax.ZLabel.FontSize = sty.fontSize.label; catch; end

    % (2) Descriptive title (only in single-panel figures).
    if stripTitles && singlePanel
        try; ax.Title.String = ''; catch; end
    end

    % (7) X-axis fit (linear, automatic, no bars only).
    if tightX
        try
            isLin  = strcmpi(ax.XScale, 'linear');
            isAuto = strcmpi(ax.XLimMode, 'auto');
            hasBar = ~isempty(findobj(ax, 'Type', 'bar')) || ...
                     ~isempty(findobj(ax, 'Type', 'histogram'));
            if isLin && isAuto && ~hasBar
                sp = local_xspan(ax);
                if ~isempty(sp) && diff(sp) > 0
                    ax.XLim = sp;
                end
            end
        catch
        end
    end
end

% (2) tiledlayout titles and sgtitle.
if stripTitles
    tls = findall(fig, 'Type', 'tiledlayout');
    for i = 1:numel(tls)
        try; tls(i).Title.String = ''; catch; end
        try; tls(i).Subtitle.String = ''; catch; end
    end
    % sgtitle: overall text parented directly to the figure (not to an axes).
    tx = findall(fig, 'Type', 'text');
    for i = 1:numel(tx)
        try
            p = get(tx(i), 'Parent');
            if isgraphics(p) && strcmp(get(p, 'Type'), 'figure')
                tx(i).String = '';
            end
        catch
        end
    end
end

% (3)(6) Legends: large typography + unobtrusive (no box).
lgs = findall(fig, 'Type', 'legend');
for i = 1:numel(lgs)
    try; lgs(i).FontSize = sty.fontSize.legend; catch; end
    try; lgs(i).Box = 'off'; catch; end
end

% (3) Colorbars.
cbs = findall(fig, 'Type', 'colorbar');
for i = 1:numel(cbs)
    try; cbs(i).FontSize = sty.fontSize.cbar; catch; end
    try; cbs(i).Label.FontSize = sty.fontSize.label; catch; end
end

% (5) Decimal comma separator (always the last step before exporting).
apply_comma_decimals(fig);
end

% =========================================================================
function sp = local_xspan(ax)
%LOCAL_XSPAN [min max] range of the X data plotted in the axes (ignores
%   zero-width auxiliary objects such as xline, which carry no data).
sp = [];
kids = findobj(ax, '-property', 'XData');
xs = [];
for k = 1:numel(kids)
    h = kids(k);
    % xline/yline (ConstantLine) have no useful XData; skipped.
    if isa(h, 'matlab.graphics.chart.decoration.ConstantLine'); continue; end
    try
        xd = h.XData(:)';
        xd = xd(isfinite(xd));
        xs = [xs, xd]; %#ok<AGROW>
    catch
    end
end
if ~isempty(xs)
    sp = [min(xs), max(xs)];
end
end
