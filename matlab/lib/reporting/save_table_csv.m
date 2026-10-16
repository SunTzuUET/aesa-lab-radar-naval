function csvPath = save_table_csv(T, outDir, name, runID, expLabel)
%SAVE_TABLE_CSV Save a table to outDir/data/<name>.csv with a Run ID header.
%   Header: "% Run ID: ... | Exp: ... | Generado: ..."
%   readtable(..., 'CommentStyle', '%') imports it correctly.

if nargin < 4; runID    = ''; end
if nargin < 5; expLabel = ''; end

dataDir = fullfile(outDir, 'data');
if ~exist(dataDir, 'dir'); mkdir(dataDir); end
csvPath = fullfile(dataDir, [name '.csv']);

ts = char(datetime('now','TimeZone','local'),'yyyy-MM-dd HH:mm:ss');
fid = fopen(csvPath, 'w');
fprintf(fid, '%% Run ID: %s | Exp: %s | Generado: %s\n', runID, expLabel, ts);
fclose(fid);

writetable(T, csvPath, 'WriteMode', 'append', 'WriteVariableNames', true);
fprintf('  -> data/%s.csv\n', name);
end
