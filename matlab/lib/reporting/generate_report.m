function pdfPath = generate_report(outDir, expName, runID, sysCfg, expCfg, blocks, opts)
%GENERATE_REPORT Single orchestrator for report generation.
%
%   pdfPath = generate_report(outDir, expName, runID, sysCfg, expCfg, blocks, opts)
%
%   Inputs:
%     outDir   : experiment directory (usually contains data/, figures/)
%     expName  : experiment title ("Exp 01 — Array baseline")
%     runID    : run identifier
%     sysCfg   : struct with system parameters (fc, spacing, ...)
%     expCfg   : struct with experiment parameters (Nlist, nReal, ...)
%     blocks   : cell array of blocks. Each cell is a cell array:
%                {'subhead',   'title'}
%                {'text',      'markdown paragraph'}   <- raw md
%                {'table',     T}                       <- table -> md
%                {'table',     T, 'caption'}
%                {'kvtable',   struct('a',1,'b','x')}   <- key-value pairs
%                {'image',     'figName'}               <- embeds figures/<name>.png
%                {'image',     'figName', 'caption'}
%                {'rawmd',     'any markdown'}
%     opts     : optional struct with
%                .toPdf    (default true)        — convert md to pdf
%                .fileName (default 'report.md') — file name inside outDir
%
%   Output:
%     pdfPath : absolute path of the generated PDF, '' if none was generated.

if nargin < 6 || isempty(blocks); blocks = {}; end
if nargin < 7; opts = struct(); end
toPdf    = local_get(opts, 'toPdf', true);
fileName = local_get(opts, 'fileName', 'report.md');

mdPath = fullfile(outDir, fileName);
fid = write_report_header(mdPath, expName, runID, sysCfg, expCfg);

for k = 1:numel(blocks)
    b = blocks{k};
    if ~iscell(b) || isempty(b); continue; end
    btype = lower(b{1});
    switch btype
        case 'subhead'
            fprintf(fid, '### %s\n\n', b{2});
        case 'text'
            fprintf(fid, '%s\n\n', b{2});
        case 'rawmd'
            fprintf(fid, '%s\n\n', b{2});
        case 'table'
            T = b{2};
            local_write_table_md(fid, T);
            if numel(b) >= 3 && ~isempty(b{3})
                fprintf(fid, '_%s_\n\n', b{3});
            end
        case 'kvtable'
            local_write_kvtable_md(fid, b{2});
        case 'image'
            name = b{2};
            relPath = sprintf('figures/%s.png', name);
            fprintf(fid, '![%s](%s)\n\n', name, relPath);
            if numel(b) >= 3 && ~isempty(b{3})
                fprintf(fid, '_%s_\n\n', b{3});
            end
        otherwise
            warning('generate_report: unknown block type: %s', btype);
    end
end
fclose(fid);
fprintf('  -> %s\n', mdPath);

pdfPath = '';
if toPdf
    ok = md_to_pdf_wrapper(mdPath);
    if ok
        pdfPath = strrep(mdPath, '.md', '.pdf');
    end
end
end

% =========================================================================
function local_write_table_md(fid, T)
%LOCAL_WRITE_TABLE_MD Write a MATLAB table as a markdown table.
varNames = T.Properties.VariableNames;
ncol = numel(varNames);
fprintf(fid, '| %s |\n', strjoin(varNames, ' | '));
fprintf(fid, '|%s\n', repmat('---|', 1, ncol));
for r = 1:height(T)
    cells = cell(1, ncol);
    for c = 1:ncol
        v = T{r, c};
        if iscell(v); v = v{1}; end
        if isnumeric(v) && isscalar(v)
            if isnan(v)
                cells{c} = '—';
            elseif isinf(v)
                cells{c} = sprintf('%g', v);   % literal "Inf" or "-Inf"
            elseif mod(v,1) == 0
                cells{c} = sprintf('%d', v);
            else
                cells{c} = sprintf('%.4g', v);
            end
        elseif ischar(v)
            cells{c} = v;
        elseif isstring(v)
            cells{c} = char(v);
        elseif islogical(v) && isscalar(v)
            if v; cells{c} = 'true'; else; cells{c} = 'false'; end
        else
            cells{c} = mat2str(v);
        end
    end
    fprintf(fid, '| %s |\n', strjoin(cells, ' | '));
end
fprintf(fid, '\n');
end

% =========================================================================
function local_write_kvtable_md(fid, S)
%LOCAL_WRITE_KVTABLE_MD Key-value table of a struct.
fprintf(fid, '| Parametro | Valor |\n|---|---|\n');
flds = fieldnames(S);
for k = 1:numel(flds)
    v = S.(flds{k});
    if isnumeric(v) && isscalar(v)
        if mod(v,1) == 0
            sv = sprintf('%d', v);
        else
            sv = sprintf('%.4g', v);
        end
    elseif isnumeric(v) && numel(v) <= 12
        sv = mat2str(v);
    elseif ischar(v)
        sv = v;
    elseif isstring(v) && isscalar(v)
        sv = char(v);
    elseif islogical(v) && isscalar(v)
        if v; sv = 'true'; else; sv = 'false'; end
    else
        sv = '...';
    end
    fprintf(fid, '| %s | %s |\n', flds{k}, sv);
end
fprintf(fid, '\n');
end

% =========================================================================
function v = local_get(s, name, def)
if isstruct(s) && isfield(s,name) && ~isempty(s.(name)); v = s.(name); else; v = def; end
end
