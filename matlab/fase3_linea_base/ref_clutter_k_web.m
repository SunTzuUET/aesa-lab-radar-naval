%REF_CLUTTER_K_WEB Shape parameter ν values (forma_k.m) for the web test (environment.ts:shapeK).
clear; startup_if_needed();
psi = [0.05 0.1 0.3 1 3 10 20]; area = [100 1e3 1e4 1e5]; pols = 'HV'; asp = [0 45 90];
r = struct('psi', {}, 'area', {}, 'pol', {}, 'aspecto', {}, 'nu', {});
for p = psi, for a = area, for q = pols, for t = asp
  r(end + 1) = struct('psi', p, 'area', a, 'pol', q, 'aspecto', t, 'nu', forma_k(p, a, q, t)); %#ok<SAGROW>
end, end, end, end
write_json(fullfile(web_validation_dir(), 'ref_clutter_k.json'), struct('casos', r));
