%VALIDACION_WEB Regenerate all reference vectors used to validate the web app.
%
%   Run from matlab/:   >> validacion_web
%   Then, in web/:      npm test
%
%   Outputs in web/src/validation/ref_*.json. val_antena takes a few minutes
%   (numerical integration of the directivity of a 6400-element face).

t0 = tic;
run(fullfile('fase1_sistema', 'val_antena.m'));
run(fullfile('fase1_sistema', 'val_radar.m'));
run(fullfile('fase2_entorno', 'val_entorno.m'));
fprintf('[validacion_web] references regenerated in %.0f s\n', toc(t0));
