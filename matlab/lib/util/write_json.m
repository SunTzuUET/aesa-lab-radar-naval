function write_json(path, data)
%WRITE_JSON Write a struct as JSON (UTF-8), creating the folder if needed.
%   Vectors are exported as rows. Used for the reference vectors that
%   verify the web engine (web/src/validation/).
folder = fileparts(path);
if ~isempty(folder) && ~isfolder(folder), mkdir(folder); end
fid = fopen(path, 'w', 'n', 'UTF-8');
assert(fid > 0, 'Cannot write %s', path);
cleaner = onCleanup(@() fclose(fid));
fwrite(fid, jsonencode(data, 'PrettyPrint', false), 'char');
fprintf('[write_json] %s\n', path);
end
