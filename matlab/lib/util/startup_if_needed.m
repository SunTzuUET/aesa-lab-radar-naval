function startup_if_needed()
%STARTUP_IF_NEEDED Run startup.m if config/ is not on the path (standalone scripts and -batch).
if isempty(which('sistema_ref'))
  here = fileparts(mfilename('fullpath'));
  run(fullfile(here, '..', '..', 'startup.m'));
end
end
