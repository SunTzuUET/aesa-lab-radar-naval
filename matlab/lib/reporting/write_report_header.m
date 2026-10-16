function fid = write_report_header(reportPath, expName, runID, sysCfg, expCfg)
%WRITE_REPORT_HEADER Standard report header (no interpretive text).
%   Metadata and parameters only. Returns a fid opened in 'w' mode.

fid = fopen(reportPath, 'w');
if fid < 0
    error('write_report_header: could not create %s', reportPath);
end
ts = char(datetime('now','TimeZone','local'),'yyyy-MM-dd HH:mm:ss');

fprintf(fid, '## %s\n\n', expName);
fprintf(fid, '| Parametro | Valor |\n|---|---|\n');
fprintf(fid, '| Run ID | `%s` |\n', runID);
fprintf(fid, '| Generado | %s |\n', ts);

if nargin >= 4 && ~isempty(sysCfg) && isstruct(sysCfg)
    flds = fieldnames(sysCfg);
    for k = 1:numel(flds)
        v = sysCfg.(flds{k});
        s = local_format_value(v);
        if ~isempty(s)
            fprintf(fid, '| %s | %s |\n', flds{k}, s);
        end
    end
end
if nargin >= 5 && ~isempty(expCfg) && isstruct(expCfg)
    flds = fieldnames(expCfg);
    for k = 1:numel(flds)
        v = expCfg.(flds{k});
        s = local_format_value(v);
        if ~isempty(s)
            fprintf(fid, '| %s | %s |\n', flds{k}, s);
        end
    end
end
fprintf(fid, '\n');
end

function s = local_format_value(v)
s = '';
if isempty(v); return; end
if isnumeric(v) && isscalar(v)
    if mod(v,1) == 0
        s = sprintf('%d', v);
    else
        s = sprintf('%.4g', v);
    end
elseif isnumeric(v) && numel(v) <= 12
    s = mat2str(v);
elseif islogical(v) && isscalar(v)
    if v; s = 'true'; else; s = 'false'; end
elseif ischar(v)
    s = v;
elseif isstring(v) && isscalar(v)
    s = char(v);
end
end
