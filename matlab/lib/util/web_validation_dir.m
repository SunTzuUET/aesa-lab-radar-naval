function p = web_validation_dir()
%WEB_VALIDATION_DIR Web app folder where the reference vectors are stored.
here = fileparts(mfilename('fullpath'));              % matlab/lib/util
p = fullfile(here, '..', '..', '..', 'web', 'src', 'validation');
end
