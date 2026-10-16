function ok = md_to_pdf_wrapper(mdPath)
%MD_TO_PDF_WRAPPER Convert a markdown report to PDF using convert_md.py.
ok = false;
repRoot = fileparts(mfilename('fullpath'));
script  = fullfile(repRoot, 'convert_md.py');
if ~exist(script, 'file')
    warning('md_to_pdf_wrapper: %s not found', script);
    return;
end
pythonExe = 'python';   % resolved via PATH (portable across machines)
cmd = sprintf('"%s" "%s" "%s"', pythonExe, script, mdPath);
[status, out] = system(cmd);
if status ~= 0
    warning('md_to_pdf_wrapper: conversion failed (%d)\n%s', status, out);
    return;
end
ok = true;
fprintf('  -> PDF: %s\n', strrep(mdPath, '.md', '.pdf'));
end
